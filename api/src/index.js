import dotenv from 'dotenv';
dotenv.config();

import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

import authRoutes from './routes/auth.routes.js';
import adminRoutes from './routes/admin.routes.js';
import agencyRoutes from './routes/agency.routes.js';
import clientRoutes from './routes/client.routes.js';
import channelRoutes from './routes/channel.routes.js';
import propertyRoutes from './routes/property.routes.js';
import reportRoutes from './routes/report.routes.js';
import brandRoutes from './routes/brand.routes.js';
import scheduleLogRoutes from './routes/schedulelog.routes.js';
import analyticsRoutes from './routes/analytics.routes.js';
import packageRoutes from './routes/package.routes.js';
import requisitionRoutes from './routes/requisition.routes.js';
import databaseRoutes from './routes/database.routes.js';
import masterdataRoutes from './routes/masterdata.routes.js';
import notificationRoutes from './routes/notification.routes.js';
import searchRoutes from './routes/search.routes.js';
import forecastingRoutes from './routes/forecasting.routes.js';
import forecastInsightsRoutes from './routes/forecastInsights.routes.js';
import mediaBuyingRoutes from './routes/mediabuying.routes.js';
import profitRoutes from './routes/profit.routes.js';
import revenueRoutes from './routes/revenue.routes.js';
import backupRoutes from './routes/backup.routes.js';
import errorLogRoutes from './routes/errorlog.routes.js';
import financialRoutes from './routes/financial.routes.js';
import { financialCors, financialCorsConfigured } from './middleware/financialCors.js';
import { logError } from './services/errorLog.service.js';
import { startBackupScheduler } from './services/backup.service.js';
import { startDataExportScheduler } from './services/dataExport.service.js';
import { startForecastEmailScheduler } from './services/forecastEmail.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// Behind Railway's proxy - trust the first hop so req.ip is the real client
// IP (used by the auth rate limiter), not the proxy's address.
app.set('trust proxy', 1);

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));

// The external financial tracker (see routes/financial.routes.js) has its own
// origin allow-list. It must be the ONLY CORS handler for /api/financial/* —
// two handlers would both set Access-Control-Allow-Origin and browsers reject a
// response carrying it twice — so the app's own CORS below skips that prefix.
// Nothing about the existing frontend's CORS behaviour changes.
const FINANCIAL_PREFIX = '/api/financial';
app.use(FINANCIAL_PREFIX, financialCors);

const appCors = cors({
  origin: process.env.FRONTEND_URL
    ? process.env.FRONTEND_URL.split(',').map((u) => u.trim())
    : '*',
  credentials: true,
});
app.use((req, res, next) => (
  req.path.startsWith(FINANCIAL_PREFIX) ? next() : appCors(req, res, next)
));
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());

// Capture any 5xx API response into the error log so admins can see failures
// users hit (Admin → Errors). Wraps res.json to inspect the final status; the
// controllers mostly handle their own errors and return 500 directly, so a
// plain error-handling middleware alone would miss them. Skips the reporter
// endpoints (no loops) and dedupes against the final error middleware below.
app.use((req, res, next) => {
  if (!req.originalUrl.startsWith('/api') || req.originalUrl.startsWith('/api/errors')) return next();
  const origJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 500 && !res.locals.__errLogged) {
      res.locals.__errLogged = true;
      logError({
        source: 'backend',
        message: (body && body.error) || `HTTP ${res.statusCode}`,
        url: req.originalUrl,
        method: req.method,
        statusCode: res.statusCode,
        user: req.user,
        userAgent: req.headers['user-agent'],
      });
    }
    return origJson(body);
  };
  next();
});

// API routes under /api prefix
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/agencies', agencyRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/properties', propertyRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/brands', brandRoutes);
app.use('/api/schedule-logs', scheduleLogRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/packages', packageRoutes);
app.use('/api/requisitions', requisitionRoutes);
app.use('/api/database', databaseRoutes);
app.use('/api/masterdata', masterdataRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/forecasting', forecastingRoutes);
app.use('/api/forecasting', forecastInsightsRoutes);
app.use('/api/media-buying', mediaBuyingRoutes);
app.use('/api/profit', profitRoutes);
app.use('/api/revenue', revenueRoutes);
app.use('/api/admin/backup', backupRoutes);
app.use('/api/errors', errorLogRoutes);

// Isolated financial-tracker API (feature-flagged; nothing above is affected).
if (String(process.env.FINANCIAL_API_ENABLED || 'true') !== 'false') {
  app.use(FINANCIAL_PREFIX, financialRoutes);
  if (!financialCorsConfigured()) {
    console.warn('[financial] ALLOWED_FINANCIAL_ORIGIN is not set — /api/financial is reachable server-to-server but blocked for browsers on other origins.');
  }
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve React frontend
const distPath = path.resolve(__dirname, '../../web/dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// 404 handler (for API routes when frontend isn't built)
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  // Log with the full stack, and flag so the res.json wrapper above doesn't
  // also record it as a second (stackless) row.
  res.locals.__errLogged = true;
  logError({
    source: 'backend',
    message: err.message || 'Unhandled error',
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    statusCode: err.status || 500,
    user: req.user,
    userAgent: req.headers['user-agent'],
  });
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message,
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  // Daily database backup to Google Drive (no-op unless configured via env).
  startBackupScheduler();
  // Daily per-tab Excel export to Google Drive (no-op unless configured via env).
  startDataExportScheduler();
  // Monthly forecast open (15th) + reminder (25th) emails to Hub heads
  // (no-op unless GOOGLE_SCRIPT_URL is configured).
  startForecastEmailScheduler();
});

export default app;
