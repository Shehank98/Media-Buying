import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../components/Icon';
import api from '../lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!email.trim()) { setError('Please enter your email address.'); return; }

    setSubmitting(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to send reset email. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-wrap" style={{ gridTemplateColumns: '1fr' }}>
      <div className="login-card-side">
        <div className="login-card fade-in">
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 28 }}>
            <div className="brand-mark" style={{ width: 40, height: 40, fontSize: 19 }}>O</div>
            <div>
              <div className="brand-name" style={{ fontSize: 17, color: 'var(--ink)' }}>Ogilvy</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '.3px', marginTop: 2 }}>Media Buying Records</div>
            </div>
          </div>

          {sent ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{ width: 48, height: 48, borderRadius: 24, background: 'var(--green-50)', color: 'var(--green-600)', display: 'grid', placeItems: 'center', margin: '0 auto 16px' }}>
                <Icon name="mail" size={24} />
              </div>
              <h1 style={{ fontSize: 20, fontWeight: 720, margin: '0 0 8px' }}>Check your inbox</h1>
              <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 24 }}>
                We sent password reset instructions to <b style={{ color: 'var(--ink)' }}>{email}</b>.
              </p>
              <button className="btn btn-ghost" onClick={() => navigate('/login')}>
                <Icon name="chevR" size={14} style={{ transform: 'rotate(180deg)' }} />Back to login
              </button>
            </div>
          ) : (
            <>
              <h1>Forgot password?</h1>
              <div className="sub">Enter your email and we'll send you reset instructions.</div>

              {error && (
                <div style={{ marginBottom: 16, padding: '10px 13px', borderRadius: 9, background: 'var(--red-100)', color: 'var(--red-600)', fontSize: 13, fontWeight: 600 }}>
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit}>
                <div className="field">
                  <label className="field-label">Email address</label>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 12, top: 11, color: 'var(--muted-2)' }}>
                      <Icon name="mail" size={18} />
                    </span>
                    <input
                      className="input"
                      type="email"
                      value={email}
                      style={{ paddingLeft: 38 }}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@agency.com"
                      autoFocus
                    />
                  </div>
                </div>

                <button className="btn btn-primary btn-lg" type="submit" style={{ width: '100%', marginTop: 8 }} disabled={submitting}>
                  {submitting ? 'Sending…' : 'Send Reset Instructions'}
                </button>
              </form>

              <div className="login-foot">
                <a onClick={() => navigate('/login')}>Back to login</a>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
