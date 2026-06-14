import { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const rnd = (a, b) => a + Math.random() * (b - a);

export default function LoginPage() {
  const [email, setEmail] = useState('shehan.kavishka@ogilvy.com');
  const [pw, setPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || '/';
  const rootRef = useRef(null);

  const stars = useMemo(() => Array.from({ length: 76 }, () => {
    const sz = +rnd(1, 2.8).toFixed(2);
    return {
      top: rnd(0, 100).toFixed(2) + '%',
      left: rnd(0, 100).toFixed(2) + '%',
      size: sz + 'px',
      glow: (sz * 2).toFixed(1) + 'px',
      lo: rnd(0.12, 0.35).toFixed(2),
      hi: rnd(0.7, 1).toFixed(2),
      tw: rnd(2.5, 6).toFixed(2) + 's',
      dr: rnd(9, 20).toFixed(1) + 's',
      delay: rnd(0, 6).toFixed(2) + 's',
    };
  }), []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onMove = (e) => {
      const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
      const dx = (e.clientX - cx) / cx, dy = (e.clientY - cy) / cy;
      root.querySelectorAll('[data-parallax]').forEach((layer) => {
        const depth = parseFloat(layer.getAttribute('data-parallax')) || 0;
        layer.style.transform = `translate(${-dx * depth}px, ${-dy * depth}px)`;
        layer.style.transition = 'transform .35s cubic-bezier(.22,.61,.36,1)';
      });
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  if (isAuthenticated) {
    navigate(from, { replace: true });
    return null;
  }

  async function submit() {
    if (!email.trim() || !pw) {
      setErr('Enter your email and password to continue.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setErr('Enter a valid email address.');
      return;
    }
    setLoading(true);
    setErr('');
    try {
      const userData = await login(email, pw);
      if (userData?.mustChangePassword) navigate('/change-password', { replace: true });
      else navigate(from, { replace: true });
    } catch (e) {
      setErr(
        e.response?.data?.message ||
        e.response?.data?.error ||
        'Invalid email or password. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  }

  const onKey = (e) => { if (e.key === 'Enter') submit(); };

  return (
    <div
      ref={rootRef}
      className="ob-login"
      style={{
        position: 'fixed', inset: 0, overflow: 'hidden',
        background: 'radial-gradient(120% 90% at 78% 8%, #14224A 0%, #0A1430 36%, #060C1C 64%, #04080F 100%)',
        fontFamily: "'Hanken Grotesk', sans-serif", color: '#fff',
      }}
    >
      {/* nebula glow layer */}
      <div data-parallax="6" style={{ position: 'absolute', inset: -40, zIndex: 0 }}>
        <div style={{ position: 'absolute', top: '-12%', right: '-6%', width: 560, height: 560, borderRadius: '50%', background: 'radial-gradient(circle,rgba(232,93,36,.34),rgba(232,93,36,0) 64%)', filter: 'blur(18px)', animation: 'ob-pulse 11s ease-in-out infinite' }} />
        <div style={{ position: 'absolute', bottom: '-22%', left: '-12%', width: 680, height: 680, borderRadius: '50%', background: 'radial-gradient(circle,rgba(78,96,196,.30),rgba(78,96,196,0) 66%)', filter: 'blur(22px)', animation: 'ob-pulse 14s ease-in-out infinite 2s' }} />
        <div style={{ position: 'absolute', top: '30%', left: '38%', width: 340, height: 340, borderRadius: '50%', background: 'radial-gradient(circle,rgba(56,150,180,.16),rgba(56,150,180,0) 70%)', filter: 'blur(20px)', animation: 'ob-pulse 16s ease-in-out infinite 4s' }} />
      </div>

      {/* stars + shooting */}
      <div data-parallax="14" style={{ position: 'absolute', inset: 0, zIndex: 1 }}>
        {stars.map((s, i) => (
          <div
            key={i}
            style={{
              position: 'absolute', borderRadius: '50%', background: '#EAF2FF',
              top: s.top, left: s.left, width: s.size, height: s.size,
              boxShadow: `0 0 ${s.glow} rgba(220,235,255,.8)`,
              '--lo': s.lo, '--hi': s.hi,
              animation: `ob-twinkle ${s.tw} ease-in-out infinite ${s.delay}, ob-drift ${s.dr} linear infinite alternate ${s.delay}`,
            }}
          />
        ))}
        <div style={{ position: 'absolute', top: '16%', left: '8%', width: 90, height: 2, background: 'linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.9))', borderRadius: 2, animation: 'ob-shoot 9s ease-in infinite 3s' }} />
        <div style={{ position: 'absolute', top: '54%', left: '2%', width: 70, height: 1.5, background: 'linear-gradient(90deg,rgba(255,255,255,0),rgba(255,220,200,.9))', borderRadius: 2, animation: 'ob-shoot 13s ease-in infinite 7s' }} />
      </div>

      {/* planet */}
      <div data-parallax="26" style={{ position: 'absolute', zIndex: 1, right: -130, bottom: -150, width: 430, height: 430, borderRadius: '50%', background: 'radial-gradient(circle at 32% 28%, #F2A07C 0%, #D9521C 30%, #7A2E12 70%, #43160A 100%)', boxShadow: 'inset -36px -26px 80px rgba(0,0,0,.62), 0 0 120px rgba(232,93,36,.34)', opacity: 0.92 }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', overflow: 'hidden', opacity: 0.4 }}>
          <div style={{ position: 'absolute', top: '30%', left: '-10%', width: '120%', height: 14, background: 'rgba(120,46,18,.7)', borderRadius: '50%', filter: 'blur(2px)' }} />
          <div style={{ position: 'absolute', top: '52%', left: '-10%', width: '120%', height: 22, background: 'rgba(90,34,14,.6)', borderRadius: '50%', filter: 'blur(3px)' }} />
          <div style={{ position: 'absolute', top: '70%', left: '-10%', width: '120%', height: 10, background: 'rgba(150,60,26,.6)', borderRadius: '50%', filter: 'blur(2px)' }} />
        </div>
      </div>

      {/* content */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 3, overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 40px' }}>
        <div style={{ width: 418, maxWidth: '100%', animation: 'ob-rise .8s cubic-bezier(.22,.61,.36,1) both' }}>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 20 }}>
            <div style={{ position: 'relative', width: 90, height: 90, display: 'grid', placeItems: 'center', marginBottom: 14 }}>
              <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1px solid rgba(255,255,255,.14)', boxShadow: 'inset 0 0 40px rgba(232,93,36,.12)' }} />
              <div style={{ position: 'absolute', inset: 14, borderRadius: '50%', border: '1px solid rgba(255,255,255,.07)' }} />
              <div style={{ position: 'absolute', inset: 0, animation: 'ob-spin 14s linear infinite' }}>
                <div style={{ position: 'absolute', top: -4, left: '50%', marginLeft: -4.5, width: 9, height: 9, borderRadius: '50%', background: '#FF7A45', boxShadow: '0 0 14px 2px rgba(255,122,69,.85)' }} />
              </div>
              <div style={{ position: 'absolute', inset: 14, animation: 'ob-spin-rev 20s linear infinite' }}>
                <div style={{ position: 'absolute', bottom: -3, left: '50%', marginLeft: -3, width: 6, height: 6, borderRadius: '50%', background: '#9FB6FF', boxShadow: '0 0 10px 1px rgba(159,182,255,.8)' }} />
              </div>
              <div style={{ width: 54, height: 54, borderRadius: '50%', background: 'radial-gradient(circle at 34% 30%, #F2A07C, #C16645 58%, #8A3A1E)', display: 'grid', placeItems: 'center', fontFamily: "'Newsreader', serif", fontSize: 30, color: '#FFF3EC', boxShadow: '0 8px 26px rgba(193,102,69,.5), inset -4px -4px 12px rgba(0,0,0,.3)' }}>O</div>
            </div>
            <div style={{ fontSize: 12, letterSpacing: '5px', textTransform: 'uppercase', color: '#7F92B8', fontWeight: 600, marginBottom: 5 }}>Ogilvy Media</div>
            <div style={{ fontSize: 33, fontWeight: 700, letterSpacing: '-1px', lineHeight: 1 }}>Ogilvy <span style={{ fontFamily: "'Newsreader', serif", fontWeight: 500, fontStyle: 'italic', color: '#F2A07C' }}>Orbit</span></div>
          </div>

          <div style={{ background: 'rgba(14,24,46,.58)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 20, padding: '26px 28px 24px', boxShadow: '0 30px 80px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.08)' }}>
            <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-.3px', marginBottom: 4 }}>Sign in to mission control</div>
            <div style={{ fontSize: 13.5, color: '#8493B5', marginBottom: 22 }}>Use your agency credentials to continue.</div>

            {err && (
              <div style={{ marginBottom: 16, padding: '10px 13px', borderRadius: 10, background: 'rgba(197,57,31,.16)', border: '1px solid rgba(197,57,31,.3)', color: '#FFB4A2', fontSize: 13, fontWeight: 600 }}>{err}</div>
            )}

            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#AEBBD6', marginBottom: 7 }}>Email address</label>
            <div style={{ position: 'relative', marginBottom: 18 }}>
              <span style={{ position: 'absolute', left: 13, top: 12, color: '#5D6E92', display: 'grid', placeItems: 'center' }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6" /></svg>
              </span>
              <input
                value={email}
                onChange={(e) => { setEmail(e.target.value); setErr(''); }}
                onKeyDown={onKey}
                placeholder="you@agency.com"
                autoFocus
                style={{ width: '100%', background: 'rgba(8,14,28,.66)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 11, padding: '12px 14px 12px 40px', fontSize: 14, color: '#EAF1FF', fontFamily: 'inherit', outline: 'none' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
              <label style={{ fontSize: 12.5, fontWeight: 600, color: '#AEBBD6' }}>Password</label>
              <span onClick={() => navigate('/forgot-password')} style={{ fontSize: 12, color: '#F2A07C', fontWeight: 600, cursor: 'pointer' }}>Forgot password?</span>
            </div>
            <div style={{ position: 'relative', marginBottom: 22 }}>
              <span style={{ position: 'absolute', left: 13, top: 12, color: '#5D6E92', display: 'grid', placeItems: 'center' }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2zM7 11V7a5 5 0 0 1 10 0v4" /></svg>
              </span>
              <input
                value={pw}
                onChange={(e) => { setPw(e.target.value); setErr(''); }}
                onKeyDown={onKey}
                type={showPw ? 'text' : 'password'}
                placeholder="••••••••"
                style={{ width: '100%', background: 'rgba(8,14,28,.66)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 11, padding: '12px 42px 12px 40px', fontSize: 14, color: '#EAF1FF', fontFamily: 'inherit', outline: 'none' }}
              />
              <button onClick={() => setShowPw(s => !s)} type="button" style={{ position: 'absolute', right: 8, top: 8, border: 'none', background: 'none', color: '#5D6E92', padding: 5, cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" /></svg>
              </button>
            </div>

            <button onClick={submit} type="button" disabled={loading} style={{ width: '100%', border: 'none', borderRadius: 12, padding: 14, fontSize: 14.5, fontWeight: 700, fontFamily: 'inherit', color: '#fff', cursor: loading ? 'default' : 'pointer', background: 'linear-gradient(180deg,#F0703F,#D9521C)', boxShadow: '0 10px 28px rgba(217,82,28,.42), inset 0 1px 0 rgba(255,255,255,.25)', letterSpacing: '.2px', opacity: loading ? 0.8 : 1 }}>
              {loading ? 'Launching…' : 'Launch session'}
            </button>
          </div>

          <div style={{ textAlign: 'center', fontSize: 12.5, color: '#6B7CA0', marginTop: 20 }}>
            Trouble signing in? <span onClick={() => alert('Contact your super admin.')} style={{ color: '#AEBBD6', fontWeight: 600, cursor: 'pointer' }}>Contact your admin</span>
          </div>
          <div style={{ textAlign: 'center', fontSize: 11.5, letterSpacing: '.4px', color: '#46557A', marginTop: 26 }}>© 2026 Ogilvy Media · Colombo · Secured workspace</div>
        </div>
      </div>
    </div>
  );
}
