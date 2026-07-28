import axios from 'axios';
import { reportError } from './errorReporter';

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor: attach Authorization Bearer token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor: handle 401 with token refresh
let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return api(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refreshToken = localStorage.getItem('refreshToken');
        if (!refreshToken) {
          throw new Error('No refresh token');
        }

        const { data } = await axios.post(
          `/api/auth/refresh`,
          { refreshToken }
        );

        const newAccessToken = data.accessToken;
        localStorage.setItem('accessToken', newAccessToken);
        if (data.refreshToken) {
          localStorage.setItem('refreshToken', data.refreshToken);
        }

        api.defaults.headers.common.Authorization = `Bearer ${newAccessToken}`;
        processQueue(null, newAccessToken);

        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('user');
        window.location.href = '/login';
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    // Report genuine failures the user hit, so Admin → Database → Errors shows
    // what the user actually saw:
    //  - network failures (the request never returned a response), and
    //  - 4xx responses, whose `error` message is the exact text the UI puts in
    //    front of the user. 401 is skipped (normal token churn, handled above)
    //    and 5xx is skipped because the backend already logs those itself, so
    //    logging here would duplicate them.
    try {
      const cfg = error.config || {};
      const urlp = cfg.url || '';
      const method = cfg.method ? cfg.method.toUpperCase() + ' ' : '';
      const internal = urlp.includes('/errors/client') || urlp.includes('/auth/refresh');
      const status = error.response?.status;
      if (!error.response && !internal) {
        reportError({
          message: `Network request failed: ${method}${urlp || 'unknown'}${error.message ? ` (${error.message})` : ''}`,
          url: window.location.href,
        });
      } else if (!internal && status >= 400 && status < 500 && status !== 401) {
        const d = error.response.data;
        const shown = (d && (d.error || d.message)) || error.message || 'Request failed';
        reportError({
          message: `${shown} — ${method}${urlp} (HTTP ${status})`,
          stack: d && d.detail ? String(d.detail) : undefined,
          url: window.location.href,
          statusCode: status,
        });
      }
    } catch { /* never let reporting break the request flow */ }

    return Promise.reject(error);
  }
);

export default api;
