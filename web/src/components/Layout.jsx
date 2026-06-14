import { useState, useEffect, useCallback } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Icon, { Avatar, RoleBadge } from './Icon';
import api from '../lib/api';

const NAV = [
  { key: '/', label: 'Dashboard', icon: 'grid' },
  { key: '/database', label: 'Database', icon: 'database' },
  { key: '/spend-analytics', label: 'Spend Analytics', icon: 'trending-up', roles: ['SUPER_ADMIN', 'MANAGER'] },
  { key: '/executive-dashboard', label: 'Executive Dashboard', icon: 'bar-chart', roles: ['SUPER_ADMIN', 'MANAGER'] },
  { key: '/decisions', label: 'Decision Center', icon: 'sparkle', roles: ['SUPER_ADMIN', 'MANAGER'] },
  { key: '/agencies', label: 'Agencies', icon: 'building' },
  { key: '/clients', label: 'Clients', icon: 'folder' },
  { key: '/my-packages', label: 'Media Packages', icon: 'mail', roles: ['GROUP_HEAD'] },
  { key: '/reports', label: 'Reports', icon: 'chart', roles: ['SUPER_ADMIN', 'MANAGER'] },
];
const NAV_ADMIN = [
  { key: '/packages', label: 'Media Packages', icon: 'mail', roles: ['SUPER_ADMIN'] },
  { key: '/upload-tracker', label: 'Upload Tracker', icon: 'upload', roles: ['SUPER_ADMIN'] },
  { key: '/admin', label: 'Admin', icon: 'shield', roles: ['SUPER_ADMIN'] },
  { key: '/profile', label: 'Profile', icon: 'user' },
];

function Breadcrumbs({ go }) {
  const location = useLocation();
  const path = location.pathname;

  const home = <a onClick={() => go('/')}>Ogilvy Media</a>;
  const sep = <Icon name="chevR" size={14} />;

  if (path === '/') return <><b>Dashboard</b></>;
  if (path === '/database') return <>{home}{sep}<b>Database</b></>;
  if (path === '/agencies') return <>{home}{sep}<b>Agencies</b></>;
  if (path.startsWith('/agencies/')) return <>{home}{sep}<a onClick={() => go('/agencies')}>Agencies</a>{sep}<b>Agency</b></>;
  if (path === '/clients') return <>{home}{sep}<b>Clients</b></>;
  if (path.startsWith('/clients/')) return <>{home}{sep}<a onClick={() => go('/clients')}>Clients</a>{sep}<b>Client</b></>;
  if (path.startsWith('/channels/')) return <>{home}{sep}<a onClick={() => go('/clients')}>Clients</a>{sep}<b>Channel</b></>;
  if (path.startsWith('/channel-masters/')) return <>{home}{sep}<b>Channel Intelligence</b></>;
  if (path === '/spend-analytics') return <>{home}{sep}<b>Spend Analytics</b></>;
  if (path === '/executive-dashboard') return <>{home}{sep}<b>Executive Dashboard</b></>;
  if (path === '/decisions') return <>{home}{sep}<b>Decision Center</b></>;
  if (path === '/reports') return <>{home}{sep}<b>Buying Report</b></>;
  if (path === '/packages') return <>{home}{sep}<a>Super Admin</a>{sep}<b>Media Packages</b></>;
  if (path === '/my-packages') return <>{home}{sep}<b>Media Packages</b></>;
  if (path === '/upload-tracker') return <>{home}{sep}<a>Super Admin</a>{sep}<b>Upload Tracker</b></>;
  if (path === '/admin') return <>{home}{sep}<a>Super Admin</a>{sep}<b>User Management</b></>;
  if (path === '/profile') return <>{home}{sep}<b>Profile</b></>;
  return <>{home}</>;
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifs, setShowNotifs] = useState(false);

  const fetchNotifications = useCallback(() => {
    if (!user) return;
    api.get('/notifications', { params: { unreadOnly: 'false' } })
      .then(r => {
        const n = r.data?.notifications;
        setNotifications(Array.isArray(n) ? n : []);
        setUnreadCount(r.data?.unreadCount || 0);
      })
      .catch(() => {});
  }, [user]);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(fetchNotifications, 60000);
    return () => clearInterval(interval);
  }, [fetchNotifications, user]);

  const markRead = async (id) => {
    try {
      await api.patch(`/notifications/${id}/read`);
      fetchNotifications();
    } catch {}
  };

  const markAllRead = async () => {
    try {
      await api.patch('/notifications/read-all');
      fetchNotifications();
    } catch {}
  };

  const go = (path) => { navigate(path); window.scrollTo?.(0, 0); setShowNotifs(false); };

  const activeKey = (key) => {
    if (key === '/') return location.pathname === '/';
    return location.pathname.startsWith(key);
  };

  const isClientOrChannel = location.pathname.startsWith('/clients/') || location.pathname.startsWith('/channels/');
  const clientsActive = location.pathname === '/clients' || isClientOrChannel;

  const userName = user?.name || 'User';
  const userRole = user?.role || 'PLANNER';

  const filteredNav = NAV.filter(n => !n.roles || n.roles.includes(userRole));
  const filteredAdminNav = NAV_ADMIN.filter(n => !n.roles || n.roles.includes(userRole));

  return (
    <div className="app">
      <div className="sidebar">
        <div className="brand">
          <div className="brand-orbit">
            <span className="bo-ring" />
            <span className="bo-track"><span className="bo-dot" /></span>
            <span className="bo-core">O</span>
          </div>
          <div>
            <div className="brand-name">Ogilvy</div>
            <div className="brand-sub">ORBIT</div>
          </div>
        </div>

        <div className="nav-group">
          <div className="nav-label">Workspace</div>
          {filteredNav.map(n => (
            <button
              key={n.key}
              className={`nav-item${n.key === '/clients' ? (clientsActive ? ' active' : '') : (activeKey(n.key) ? ' active' : '')}`}
              onClick={() => go(n.key)}
            >
              <Icon name={n.icon} size={18} />
              {n.label}
            </button>
          ))}
          <div className="nav-label">Administration</div>
          {filteredAdminNav.map(n => (
            <button
              key={n.key}
              className={`nav-item${activeKey(n.key) ? ' active' : ''}`}
              onClick={() => go(n.key)}
            >
              <Icon name={n.icon} size={18} />
              {n.label}
            </button>
          ))}
        </div>

        <div className="sidebar-foot">
          <div className="user-chip">
            <Avatar name={userName} size={32} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="nm">{userName}</div>
              <div className="rl">{userRole.replace('_', ' ')}</div>
            </div>
            <button
              className="nav-item"
              style={{ width: 'auto', padding: 6 }}
              title="Sign out"
              onClick={logout}
            >
              <Icon name="logout" size={17} />
            </button>
          </div>
        </div>
      </div>

      <div className="main">
        <div className="topbar">
          <div className="crumb">
            <Breadcrumbs go={go} />
          </div>
          <div className="topbar-search">
            <Icon name="search" size={16} />
            <input placeholder="Search clients, channels, properties…" />
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted-2)', border: '1px solid var(--border-strong)', borderRadius: 5, padding: '1px 5px' }}>⌘K</span>
          </div>
          <div className="topbar-spacer" />
          <div style={{ position: 'relative' }}>
            <button className="icon-btn" onClick={() => setShowNotifs(p => !p)}>
              <Icon name="bell" size={18} />
              {unreadCount > 0 && <span className="dot" />}
            </button>
            {showNotifs && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setShowNotifs(false)} />
                <div style={{
                  position: 'absolute', top: '100%', right: 0, marginTop: 8, width: 360,
                  background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12,
                  boxShadow: '0 8px 30px rgba(0,0,0,0.12)', zIndex: 100, overflow: 'hidden',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 14, fontWeight: 720, color: 'var(--ink)' }}>Notifications</span>
                    {unreadCount > 0 && (
                      <button onClick={markAllRead} style={{ fontSize: 12, fontWeight: 600, color: 'var(--coral-600)', background: 'none', border: 'none', cursor: 'pointer' }}>
                        Mark all read
                      </button>
                    )}
                  </div>
                  <div style={{ maxHeight: 380, overflowY: 'auto' }}>
                    {notifications.length === 0 ? (
                      <div style={{ padding: '30px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No notifications</div>
                    ) : notifications.slice(0, 20).map(n => (
                      <div
                        key={n.id}
                        onClick={() => { if (!n.isRead) markRead(n.id); }}
                        style={{
                          padding: '10px 16px', borderBottom: '1px solid var(--border)', cursor: 'pointer',
                          background: n.isRead ? 'transparent' : 'var(--coral-50, #fff7ed)',
                        }}
                      >
                        <div style={{ fontSize: 13, fontWeight: n.isRead ? 500 : 650, color: 'var(--ink)', marginBottom: 2 }}>{n.title}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.4 }}>{n.message}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted-2)', marginTop: 4 }}>
                          {new Date(n.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 6 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--ink)', lineHeight: 1.1, whiteSpace: 'nowrap' }}>{userName}</div>
              <div style={{ marginTop: 3 }}><RoleBadge role={userRole} small /></div>
            </div>
            <Avatar name={userName} size={36} />
          </div>
        </div>

        <div className="content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
