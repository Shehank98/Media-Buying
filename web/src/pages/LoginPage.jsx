import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Icon from '../components/Icon';

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
        <div className="brand" style={{ padding: 0, position: 'relative', zIndex: 1 }}>
          <div className="brand-mark" style={{ width: 40, height: 40, fontSize: 19 }}>O</div>
          <div>
            <div className="brand-name" style={{ fontSize: 17 }}>Ogilvy</div>
            <div className="brand-sub">Media Buying Records</div>
          </div>
        </div>

        <div style={{ marginTop: 'auto', position: 'relative', zIndex: 1 }}>
          <div style={{ fontSize: 32, fontWeight: 770, letterSpacing: '-1px', lineHeight: 1.15, maxWidth: 420 }}>
            Every buy, every channel, every change - on the record.
          </div>
          <p style={{ color: 'var(--navy-300)', fontSize: 15, lineHeight: 1.6, marginTop: 18, maxWidth: 420 }}>
            Plan, track and audit airtime, sponsorships and print across agencies and clients - with a full change history behind every property.
          </p>
          <div style={{ display: 'flex', gap: 28, marginTop: 36 }}>
            {['3 agencies', '240+ properties', 'Full audit trail'].map((s, i) => (
              <div key={i}>
                <div style={{ fontSize: 19, fontWeight: 750, color: '#fff' }}>{s.split(' ')[0]}</div>
                <div style={{ fontSize: 12.5, color: 'var(--navy-300)', marginTop: 2 }}>{s.split(' ').slice(1).join(' ')}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 40, fontSize: 12, color: 'var(--navy-400)', position: 'relative', zIndex: 1 }}>
          © 2026 Ogilvy Media · Colombo
        </div>
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
