import { useState, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Icon from '../components/Icon';

// Anthropic-style sunburst accent
function Burst({ size = 18, style }) {
  const spokes = Array.from({ length: 8 }, (_, i) => (i * 360) / 8);
  return (
    <svg className="spark" width={size} height={size} viewBox="0 0 24 24" style={style} aria-hidden="true">
      {spokes.map((a) => (
        <line
          key={a}
          x1="12" y1="12" x2="12" y2="2"
          transform={`rotate(${a} 12 12)`}
          stroke="currentColor" strokeWidth="2" strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

export default function LoginPage() {
  const [email, setEmail] = useState('shehan.kavishka@ogilvy.com');
  const [pw, setPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [errs, setErrs] = useState({});
  const [loading, setLoading] = useState(false);
  const [serverErr, setServerErr] = useState('');

  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || '/';

  const sparks = useMemo(() => Array.from({ length: 9 }, () => ({
    top: Math.random() * 90 + 4,
    left: Math.random() * 90 + 4,
    size: Math.round(Math.random() * 14 + 12),
    dur: +(Math.random() * 5 + 7).toFixed(2),
    delay: +(Math.random() * 6).toFixed(2),
  })), []);

  if (isAuthenticated) {
    navigate(from, { replace: true });
    return null;
  }

  async function submit(ev) {
    ev.preventDefault();
    const n = {};
    if (!email.trim()) n.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) n.email = 'Enter a valid email address';
    if (!pw) n.pw = 'Password is required';
    else if (pw.length < 6) n.pw = 'Password must be at least 6 characters';
    setErrs(n);
    if (Object.keys(n).length) return;

    setLoading(true);
    setServerErr('');
    try {
      const userData = await login(email, pw);
      if (userData?.mustChangePassword) {
        navigate('/change-password', { replace: true });
      } else {
        navigate(from, { replace: true });
      }
    } catch (err) {
      setServerErr(
        err.response?.data?.message ||
        err.response?.data?.error ||
        'Invalid email or password. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-art">
        <div className="sparks">
          {sparks.map((s, i) => (
            <Burst
              key={i}
              size={s.size}
              style={{ top: `${s.top}%`, left: `${s.left}%`, '--dur': `${s.dur}s`, '--delay': `${s.delay}s` }}
            />
          ))}
        </div>

        <div className="orbit-hero">
          <div className="orbit-ring"><div className="orbit-core">O</div></div>
          <div className="orbit-title">Ogilvy <span>Orbit</span></div>
        </div>

        <div className="login-art-foot">© 2026 Ogilvy Media · Colombo</div>
      </div>

      <div className="login-card-side">
        <form className="login-card fade-in" onSubmit={submit} noValidate>
          <h1>Sign in</h1>
          <div className="sub">Welcome back. Use your agency credentials to continue.</div>

          {serverErr && (
            <div style={{ marginBottom: 16, padding: '10px 13px', borderRadius: 9, background: 'var(--red-100)', color: 'var(--red-600)', fontSize: 13, fontWeight: 600 }}>
              {serverErr}
            </div>
          )}

          <div className="field">
            <label className="field-label">Email address</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 12, top: 11, color: 'var(--muted-2)' }}>
                <Icon name="mail" size={18} />
              </span>
              <input
                className={`input${errs.email ? ' err' : ''}`}
                type="email"
                value={email}
                style={{ paddingLeft: 38 }}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@agency.com"
                autoFocus
              />
            </div>
            {errs.email && <div className="field-err"><Icon name="alert" size={13} />{errs.email}</div>}
          </div>

          <div className="field">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label className="field-label" style={{ marginBottom: 0 }}>Password</label>
              <span className="link" style={{ fontSize: 12 }} onClick={() => navigate('/forgot-password')}>Forgot password?</span>
            </div>
            <div style={{ position: 'relative', marginTop: 7 }}>
              <span style={{ position: 'absolute', left: 12, top: 11, color: 'var(--muted-2)' }}>
                <Icon name="lock" size={18} />
              </span>
              <input
                className={`input${errs.pw ? ' err' : ''}`}
                type={showPw ? 'text' : 'password'}
                value={pw}
                style={{ paddingLeft: 38, paddingRight: 40 }}
                onChange={(e) => setPw(e.target.value)}
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPw(s => !s)}
                style={{ position: 'absolute', right: 8, top: 8, border: 'none', background: 'none', color: 'var(--muted)', padding: 4 }}
              >
                <Icon name="eye" size={18} />
              </button>
            </div>
            {errs.pw && <div className="field-err"><Icon name="alert" size={13} />{errs.pw}</div>}
          </div>

          <button className="btn btn-primary btn-lg" type="submit" style={{ width: '100%', marginTop: 8 }} disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>

          <div className="login-foot">
            Trouble signing in?{' '}
            <a onClick={() => alert('Contact your super admin.')}>Contact your admin</a>
          </div>
        </form>
      </div>
    </div>
  );
}
