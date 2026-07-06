import { useEffect, useState, useCallback } from 'react';

// Lightweight "a new version is available" prompt — no service worker.
// On load we note the hashed entry bundle the page is running; periodically (and
// whenever the tab regains focus) we re-fetch index.html and compare its entry
// hash. If a deploy changed it, we surface a one-click Refresh so a long-lived
// tab / installed PWA never gets stuck on an old build.
const ENTRY_RE = /\/assets\/index-[A-Za-z0-9_-]+\.js/;

function currentEntry() {
  const el = document.querySelector('script[type="module"][src*="/assets/index-"]');
  const src = el?.getAttribute('src') || '';
  const m = src.match(ENTRY_RE);
  return m ? m[0] : null;
}

export default function UpdateBanner() {
  const [outdated, setOutdated] = useState(false);
  // Captured once; null in dev (Vite serves /src/main.jsx, not a hashed bundle),
  // which disables the whole check so it never false-triggers locally.
  const [baseline] = useState(currentEntry);

  const check = useCallback(async () => {
    if (!baseline || outdated) return;
    try {
      const res = await fetch('/index.html', { cache: 'no-store' });
      if (!res.ok) return;
      const html = await res.text();
      const m = html.match(ENTRY_RE);
      if (m && m[0] !== baseline) setOutdated(true);
    } catch { /* offline / mid-deploy — ignore */ }
  }, [baseline, outdated]);

  useEffect(() => {
    if (!baseline) return undefined;
    const id = setInterval(check, 5 * 60 * 1000); // every 5 min
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', check);
    const first = setTimeout(check, 15000); // one early check after load
    return () => {
      clearInterval(id); clearTimeout(first);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', check);
    };
  }, [baseline, check]);

  if (!outdated) return null;
  return (
    <div style={{
      position: 'fixed', left: '50%', bottom: 20, transform: 'translateX(-50%)', zIndex: 95,
      display: 'flex', alignItems: 'center', gap: 14, maxWidth: 'calc(100vw - 32px)',
      background: '#0A1729', color: '#fff', borderRadius: 12, padding: '12px 14px 12px 18px',
      boxShadow: '0 12px 34px rgba(10,23,41,.34)', fontSize: 13.5,
    }}>
      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: '#E85D24', flex: 'none' }} />
      <span style={{ fontWeight: 600 }}>A new version of Ogilvy Trading is available.</span>
      <button
        onClick={() => window.location.reload()}
        style={{ background: '#E85D24', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
      >
        Refresh
      </button>
      <button
        onClick={() => setOutdated(false)}
        aria-label="Dismiss"
        style={{ background: 'transparent', color: '#9FB0CE', border: 'none', fontSize: 18, lineHeight: 1, cursor: 'pointer', padding: '0 4px' }}
      >
        ×
      </button>
    </div>
  );
}
