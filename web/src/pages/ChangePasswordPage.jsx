import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Icon from '../components/Icon';

export default function ChangePasswordPage() {
  const { changePassword, user } = useAuth();
  const navigate = useNavigate();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 8) { setError('New password must be at least 8 characters.'); return; }
    if (newPassword !== confirmPassword) { setError('Passwords do not match.'); return; }
    if (currentPassword === newPassword) { setError('New password must be different from current.'); return; }

    setSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || err.response?.data?.message || 'Failed to change password.');
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
              <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '.3px', marginTop: 2 }}>Orbit</div>
            </div>
          </div>

          <h1>Change Password</h1>
          <div className="sub">
            {user?.mustChangePassword
              ? 'You must change your temporary password before continuing.'
              : 'Update your account password.'}
          </div>

          {error && (
            <div style={{ marginBottom: 16, padding: '10px 13px', borderRadius: 9, background: 'var(--red-100)', color: 'var(--red-600)', fontSize: 13, fontWeight: 600 }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="field">
              <label className="field-label">Current password <span className="req">*</span></label>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 12, top: 11, color: 'var(--muted-2)' }}>
                  <Icon name="lock" size={18} />
                </span>
                <input className="input" type="password" required value={currentPassword}
                  style={{ paddingLeft: 38 }} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Enter current password" />
              </div>
            </div>

            <div className="field">
              <label className="field-label">New password <span className="req">*</span></label>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 12, top: 11, color: 'var(--muted-2)' }}>
                  <Icon name="lock" size={18} />
                </span>
                <input className="input" type="password" required minLength={8} value={newPassword}
                  style={{ paddingLeft: 38 }} onChange={(e) => setNewPassword(e.target.value)} placeholder="At least 8 characters" />
              </div>
            </div>

            <div className="field">
              <label className="field-label">Confirm new password <span className="req">*</span></label>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 12, top: 11, color: 'var(--muted-2)' }}>
                  <Icon name="lock" size={18} />
                </span>
                <input className="input" type="password" required minLength={8} value={confirmPassword}
                  style={{ paddingLeft: 38 }} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm password" />
              </div>
            </div>

            <button className="btn btn-primary btn-lg" type="submit" style={{ width: '100%', marginTop: 8 }} disabled={submitting}>
              {submitting ? 'Changing…' : 'Change Password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
