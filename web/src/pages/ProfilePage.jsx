import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Icon, { Avatar, RoleBadge } from '../components/Icon';

export default function ProfilePage() {
  const { user, changePassword } = useAuth();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }
    if (currentPassword === newPassword) {
      setError('New password must be different from current password.');
      return;
    }

    setSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
      setSuccess('Password changed successfully.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(
        err.response?.data?.error ||
        err.response?.data?.message ||
        'Failed to change password. Please check your current password.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const userName = user?.name || 'User';
  const userRole = user?.role || 'PLANNER';

  return (
    <div className="content-narrow fade-in" style={{ maxWidth: 640 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">Profile</h1>
          <p className="page-sub">Manage your account & password</p>
        </div>
      </div>

      <div className="section-card" style={{ marginBottom: 20 }}>
        <div style={{ padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Avatar name={userName} size={56} />
            <div>
              <div style={{ fontSize: 18, fontWeight: 720, color: 'var(--ink)', letterSpacing: '-.3px' }}>{userName}</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>{user?.email}</div>
              <div style={{ marginTop: 8 }}><RoleBadge role={userRole} /></div>
            </div>
          </div>
        </div>
      </div>

      <div className="section-card">
        <div className="section-head">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="lock" size={16} />
            Change Password
          </h3>
        </div>
        <div style={{ padding: '22px 24px' }}>
          {error && (
            <div style={{ marginBottom: 16, padding: '10px 13px', borderRadius: 9, background: 'var(--red-100)', color: 'var(--red-600)', fontSize: 13, fontWeight: 600 }}>
              {error}
            </div>
          )}
          {success && (
            <div style={{ marginBottom: 16, padding: '10px 13px', borderRadius: 9, background: 'var(--green-100)', color: 'var(--green-600)', fontSize: 13, fontWeight: 600 }}>
              {success}
            </div>
          )}

          <form onSubmit={handleChangePassword}>
            <div className="field">
              <label className="field-label">Current Password <span className="req">*</span></label>
              <input
                className="input"
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
              />
            </div>
            <div className="field-grid2">
              <div className="field">
                <label className="field-label">New Password <span className="req">*</span></label>
                <input
                  className="input"
                  type="password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                />
              </div>
              <div className="field">
                <label className="field-label">Confirm Password <span className="req">*</span></label>
                <input
                  className="input"
                  type="password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                />
              </div>
            </div>
            <button
              className="btn btn-primary"
              type="submit"
              disabled={submitting}
              style={{ marginTop: 4 }}
            >
              <Icon name="check" size={16} />
              {submitting ? 'Updating…' : 'Update Password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
