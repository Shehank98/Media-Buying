import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon';
import api from '../lib/api';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return; }
    if (!token) { setError('Invalid or missing reset token.'); return; }

    setSubmitting(true);
    try {
      await api.post('/auth/reset-password', { token, newPassword: password });
      navigate('/login', { state: { message: 'Password reset successfully. Please sign in.' }, replace: true });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to reset password. The link may have expired.');
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

          <h1>Reset your password</h1>
          <div className="sub">Enter your new password below.</div>

          {error && (
            <div style={{ marginBottom: 16, padding: '10px 13px', borderRadius: 9, background: 'var(--red-100)', color: 'var(--red-600)', fontSize: 13, fontWeight: 600 }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="field">
              <label className="field-label">New password <span className="req">*</span></label>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 12, top: 11, color: 'var(--muted-2)' }}>
                  <Icon name="lock" size={18} />
                </span>
                <input className="input" type="password" required minLength={8} value={password}
                  style={{ paddingLeft: 38 }} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
              </div>
            </div>

            <div className="field">
              <label className="field-label">Confirm password <span className="req">*</span></label>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 12, top: 11, color: 'var(--muted-2)' }}>
                  <Icon name="lock" size={18} />
                </span>
                <input className="input" type="password" required minLength={8} value={confirmPassword}
                  style={{ paddingLeft: 38 }} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm password" />
              </div>
            </div>

            <button className="btn btn-primary btn-lg" type="submit" style={{ width: '100%', marginTop: 8 }} disabled={submitting}>
              {submitting ? 'Resetting…' : 'Reset Password'}
            </button>
          </form>

          <div className="login-foot">
            <a onClick={() => navigate('/login')}>Back to login</a>
          </div>
        </div>
      </div>
    </div>
  );
}
