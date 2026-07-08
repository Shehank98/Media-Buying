import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Icon, { Avatar, RoleBadge } from '../components/Icon';

const CARD_STYLE = {
  background: '#fff',
  border: '1px solid #E5E8ED',
  borderRadius: 14,
  boxShadow: '0 1px 2px rgba(15,31,61,.06)',
};

const INPUT_BASE = {
  width: '100%',
  background: '#F7F8FA',
  border: '1px solid #E5E8ED',
  borderRadius: 10,
  padding: '11px 13px',
  fontSize: 14,
  color: '#16243C',
  outline: 'none',
  transition: 'background .15s, border-color .15s',
};

const LABEL_STYLE = {
  display: 'block',
  fontSize: 12.5,
  fontWeight: 600,
  color: '#3B4A63',
  marginBottom: 7,
};

const ROLE_PILL_COLORS = {
  SUPER_ADMIN: { color: '#6B3FB5', background: '#E8DEF8' },
  ADMIN_LEVEL_1: { color: '#1F5BB5', background: '#EDF3FD' },
  GROUP_HEAD: { color: '#D9521C', background: '#FDF1EB' },
  PLANNER: { color: '#3B4A63', background: '#EEF0F3' },
};

const ROLE_LABELS = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN_LEVEL_1: 'ADMIN_LEVEL_1',
  GROUP_HEAD: 'Group Head',
  PLANNER: 'Planner',
};

function initialsOf(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

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
  const pill = ROLE_PILL_COLORS[userRole] || ROLE_PILL_COLORS.PLANNER;
  const roleLabel = ROLE_LABELS[userRole] || userRole;

  const handleFocus = (e) => {
    e.target.style.background = '#fff';
    e.target.style.borderColor = '#E85D24';
  };
  const handleBlur = (e) => {
    e.target.style.background = '#F7F8FA';
    e.target.style.borderColor = '#E5E8ED';
  };

  return (
    <div className="fade-in" style={{ maxWidth: 640, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-.6px', color: '#16243C', margin: 0 }}>
          Profile
        </h1>
        <p style={{ fontSize: 13.5, color: '#6B7790', margin: '6px 0 0' }}>
          Manage your account &amp; password
        </p>
      </div>

      <div style={{ ...CARD_STYLE, padding: 24, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 18 }}>
        <div
          style={{
            width: 60,
            height: 60,
            flexShrink: 0,
            borderRadius: '50%',
            background: '#E85D24',
            color: '#fff',
            fontWeight: 700,
            fontSize: 21,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {initialsOf(userName)}
        </div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-.3px', color: '#16243C' }}>
            {userName}
          </div>
          <div style={{ fontSize: 13, color: '#6B7790', marginTop: 2, fontFamily: 'var(--font-mono, monospace)' }}>
            {user?.email}
          </div>
          <div style={{ marginTop: 9 }}>
            <span
              style={{
                display: 'inline-block',
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: '.3px',
                padding: '3px 10px',
                borderRadius: 20,
                color: pill.color,
                background: pill.background,
              }}
            >
              {roleLabel}
            </span>
          </div>
        </div>
      </div>

      <div style={{ ...CARD_STYLE, overflow: 'hidden' }}>
        <div
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid #E5E8ED',
            display: 'flex',
            alignItems: 'center',
            gap: 9,
          }}
        >
          <span style={{ color: '#3B4A63', display: 'inline-flex' }}>
            <Icon name="lock" size={16} />
          </span>
          <span style={{ fontSize: 14.5, fontWeight: 700, color: '#16243C' }}>Change Password</span>
        </div>

        <div style={{ padding: '22px 24px' }}>
          {error && (
            <div style={{ marginBottom: 16, padding: '10px 13px', borderRadius: 10, background: 'var(--red-100)', color: 'var(--red-600)', fontSize: 13, fontWeight: 600 }}>
              {error}
            </div>
          )}
          {success && (
            <div style={{ marginBottom: 16, padding: '10px 13px', borderRadius: 10, background: 'var(--green-100)', color: 'var(--green-600)', fontSize: 13, fontWeight: 600 }}>
              {success}
            </div>
          )}

          <form onSubmit={handleChangePassword}>
            <div style={{ marginBottom: 18 }}>
              <label style={LABEL_STYLE}>Current password</label>
              <input
                style={INPUT_BASE}
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                onFocus={handleFocus}
                onBlur={handleBlur}
                placeholder="Enter current password"
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
              <div>
                <label style={LABEL_STYLE}>New password</label>
                <input
                  style={INPUT_BASE}
                  type="password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  onFocus={handleFocus}
                  onBlur={handleBlur}
                  placeholder="At least 8 characters"
                />
              </div>
              <div>
                <label style={LABEL_STYLE}>Confirm password</label>
                <input
                  style={INPUT_BASE}
                  type="password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onFocus={handleFocus}
                  onBlur={handleBlur}
                  placeholder="Confirm new password"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                background: '#E85D24',
                color: '#fff',
                border: 'none',
                borderRadius: 10,
                padding: '11px 18px',
                fontSize: 13.5,
                fontWeight: 700,
                cursor: submitting ? 'default' : 'pointer',
                opacity: submitting ? 0.7 : 1,
              }}
              onMouseEnter={(e) => { if (!submitting) e.currentTarget.style.background = '#D9521C'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = '#E85D24'; }}
            >
              <Icon name="check" size={16} />
              {submitting ? 'Updating…' : 'Update password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
