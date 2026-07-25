import cors from 'cors';

// CORS for /api/financial/* only — scoped to the external financial frontend's
// origins via ALLOWED_FINANCIAL_ORIGIN so it can be changed per environment
// without a code change. The app's own CORS config (FRONTEND_URL) is untouched;
// index.js skips the global handler for this prefix so the two never both write
// Access-Control-Allow-Origin (duplicate headers make browsers reject the
// response).
//
// ALLOWED_FINANCIAL_ORIGIN is a comma-separated list. Entries may contain `*`
// as a wildcard, which is what Lovable preview URLs need:
//   https://*.lovable.app,https://tracker.example.com
// Unset = no cross-origin access at all (same-origin requests still work).

function patterns() {
  return (process.env.ALLOWED_FINANCIAL_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function matches(origin, pattern) {
  if (pattern === '*') return true;
  if (!pattern.includes('*')) return origin === pattern;
  const rx = new RegExp(`^${pattern.split('*').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`);
  return rx.test(origin);
}

export const financialCors = cors({
  origin(origin, cb) {
    // No Origin header = same-origin / server-to-server (curl, Postman) — allow,
    // the bearer token is the actual access control.
    if (!origin) return cb(null, true);
    const list = patterns();
    if (list.some((p) => matches(origin, p))) return cb(null, true);
    // Reject by omitting the header rather than erroring, so the browser shows a
    // normal CORS failure instead of a 500.
    return cb(null, false);
  },
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type'],
  // Bearer tokens only — no cookies are used by this API.
  credentials: false,
  maxAge: 600,
});

export function financialCorsConfigured() {
  return patterns().length > 0;
}
