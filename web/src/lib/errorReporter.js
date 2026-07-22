// Global client-side error reporter. Posts crashes to /api/errors/client so an
// admin can review them in Admin -> Errors. Uses a raw fetch (not the axios
// instance) to avoid recursing through the API interceptor, and dedupes/throttles
// so a repeating error can't flood the log.

const recent = new Map(); // signature -> last-sent timestamp
const WINDOW_MS = 30000;

function currentUser() {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null');
  } catch {
    return null;
  }
}

export function reportError({ message, stack, url, statusCode } = {}) {
  try {
    const msg = String(message || 'Unknown error');
    const sig = `${msg}|${(stack || '').slice(0, 120)}|${statusCode || ''}`;
    const now = Date.now();
    const last = recent.get(sig);
    if (last && now - last < WINDOW_MS) return; // throttle duplicates
    recent.set(sig, now);
    if (recent.size > 200) recent.clear();

    const u = currentUser();
    const body = JSON.stringify({
      message: msg.slice(0, 2000),
      stack: stack ? String(stack).slice(0, 8000) : undefined,
      url: url || window.location.href,
      statusCode: Number.isInteger(statusCode) ? statusCode : undefined,
      userId: u?.id,
      userEmail: u?.email,
      userRole: u?.role,
    });
    // keepalive lets the report still flush if the page is navigating/unloading.
    fetch('/api/errors/client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* the reporter must never throw */
  }
}

let installed = false;
export function installGlobalErrorReporter() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (e) => {
    // Ignore resource-load errors (img/script) with no error object + message.
    if (!e || (!e.message && !e.error)) return;
    reportError({
      message: e.message || (e.error && e.error.message),
      stack: e.error && e.error.stack,
      url: window.location.href,
    });
  });

  window.addEventListener('unhandledrejection', (e) => {
    const r = e && e.reason;
    reportError({
      message: (r && (r.message || String(r))) || 'Unhandled promise rejection',
      stack: r && r.stack,
      url: window.location.href,
    });
  });
}
