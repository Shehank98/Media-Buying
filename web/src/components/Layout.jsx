import { useState, useEffect, useCallback } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Icon, { Avatar, RoleBadge } from './Icon';
import api from '../lib/api';
import { hasPageAccess } from '../lib/permissions';

const NAV = [
  { key: '/executive-dashboard', label: 'Executive Dashboard', icon: 'bar-chart', roles: ['SUPER_ADMIN', 'MANAGER'] },
  { key: '/forecasting', label: 'Forecasting', icon: 'calendar', roles: ['SUPER_ADMIN', 'GROUP_HEAD'] },
  { key: '/database', label: 'Database', icon: 'database' },
  { key: '/spend-analytics', label: 'Spend Analytics', icon: 'trending-up', roles: ['SUPER_ADMIN', 'MANAGER', 'GROUP_HEAD', 'PLANNER'] },
  { key: '/agencies', label: 'Agencies', icon: 'building' },
  { key: '/my-packages', label: 'Media Packages', icon: 'mail', roles: ['GROUP_HEAD'] },
  { key: '/reports', label: 'Reports', icon: 'chart', roles: ['SUPER_ADMIN', 'MANAGER'] },
];
const NAV_ADMIN = [
  { key: '/media-buying', label: 'Media Buying', icon: 'sparkle', roles: ['SUPER_ADMIN'] },
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
  if (path === '/clients') return <>{home}{sep}<a onClick={() => go('/agencies')}>Agencies</a>{sep}<b>Clients</b></>;
  if (path.startsWith('/clients/') && path.endsWith('/dashboard')) return <>{home}{sep}<a onClick={() => go('/agencies')}>Agencies</a>{sep}<b>Client Dashboard</b></>;
  if (path.startsWith('/clients/')) return <>{home}{sep}<a onClick={() => go('/agencies')}>Agencies</a>{sep}<b>Client</b></>;
  if (path.startsWith('/channels/')) return <>{home}{sep}<a onClick={() => go('/agencies')}>Agencies</a>{sep}<b>Channel</b></>;
  if (path.startsWith('/channel-masters/')) return <>{home}{sep}<b>Channel Intelligence</b></>;
  if (path === '/spend-analytics') return <>{home}{sep}<b>Spend Analytics</b></>;
  if (path === '/executive-dashboard') return <>{home}{sep}<b>Executive Dashboard</b></>;
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

  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);

  // Mobile: the sidebar collapses into a hamburger-triggered drawer.
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    const q = searchQ.trim();
    if (q.length < 2) { setSearchResults([]); setSearchOpen(false); return; }
    const t = setTimeout(() => {
      api.get('/search', { params: { q } })
        .then((r) => { setSearchResults(r.data?.results || []); setSearchOpen(true); })
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [searchQ]);

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

  // Where a notification should take the user when clicked.
  const notifLink = (n) => {
    if (n?.link) return n.link; // explicit deep link wins
    switch (n?.type) {
      case 'PACKAGE_SHARED': return '/my-packages';
      case 'PACKAGE_RESPONSE': return '/packages';
      case 'CLIENT_REQUEST':
      case 'CHANNEL_REQUEST': return '/admin';
      case 'CLIENT_REQUEST_RESULT':
      case 'CHANNEL_REQUEST_RESULT': return '/forecasting';
      default: return null;
    }
  };

  const openNotif = (n) => {
    if (!n.isRead) markRead(n.id);
    const to = notifLink(n);
    if (to) { setShowNotifs(false); navigate(to); }
  };

  const go = (path) => { navigate(path); window.scrollTo?.(0, 0); setShowNotifs(false); setNavOpen(false); };

  const activeKey = (key) => {
    if (key === '/') return location.pathname === '/';
    return location.pathname.startsWith(key);
  };

  // Clients & channels live under Agencies now (no separate Clients tab).
  const agenciesActive = location.pathname.startsWith('/agencies')
    || location.pathname.startsWith('/clients')
    || location.pathname.startsWith('/channels/');

  const userName = user?.name || 'User';
  const userRole = user?.role || 'PLANNER';

  const filteredNav = NAV.filter(n => (!n.roles || n.roles.includes(userRole)) && hasPageAccess(user, n.key));
  const filteredAdminNav = NAV_ADMIN.filter(n => (!n.roles || n.roles.includes(userRole)) && hasPageAccess(user, n.key));

  return (
    <div className="app">
      <div className={`sidebar-scrim${navOpen ? ' show' : ''}`} onClick={() => setNavOpen(false)} />
      <div className={`sidebar${navOpen ? ' open' : ''}`}>
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
              className={`nav-item${n.key === '/agencies' ? (agenciesActive ? ' active' : '') : (activeKey(n.key) ? ' active' : '')}`}
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
          <button className="menu-btn" aria-label="Open menu" onClick={() => setNavOpen(true)}>
            <Icon name="menu" size={20} />
          </button>
          <div className="crumb">
            <Breadcrumbs go={go} />
          </div>
          <div style={{ position: 'relative' }}>
            <div className="topbar-search">
              <Icon name="search" size={16} />
              <input
                placeholder="Search agencies, clients, channels, properties…"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                onFocus={() => { if (searchResults.length) setSearchOpen(true); }}
              />
              {searchQ
                ? <button className="icon-btn" style={{ width: 22, height: 22 }} onClick={() => { setSearchQ(''); setSearchOpen(false); }}><Icon name="x" size={13} /></button>
                : <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted-2)', border: '1px solid var(--border-strong)', borderRadius: 5, padding: '1px 5px' }}>⌘K</span>}
            </div>
            {searchOpen && searchQ.trim().length >= 2 && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setSearchOpen(false)} />
                <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 8, width: 380, maxWidth: '90vw', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: '0 8px 30px rgba(0,0,0,0.12)', zIndex: 100, overflow: 'hidden' }}>
                  {searchResults.length === 0 ? (
                    <div style={{ padding: '22px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No matches for “{searchQ.trim()}”</div>
                  ) : (
                    <div style={{ maxHeight: 380, overflowY: 'auto', padding: 6 }}>
                      {searchResults.map((r, i) => (
                        <button
                          key={`${r.type}-${i}`}
                          onClick={() => { setSearchOpen(false); setSearchQ(''); go(r.to); }}
                          style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', textAlign: 'left', border: 'none', background: 'none', borderRadius: 8, padding: '9px 10px', cursor: 'pointer' }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
                        >
                          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.3px', textTransform: 'uppercase', color: 'var(--muted)', background: 'var(--bg-sunken)', borderRadius: 5, padding: '3px 7px', flex: 'none', width: 64, textAlign: 'center' }}>{r.type}</span>
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</span>
                            {r.sub && <span style={{ display: 'block', fontSize: 11.5, color: 'var(--muted)' }}>{r.sub}</span>}
                          </span>
                          <Icon name="chevR" size={15} style={{ color: 'var(--muted-2)' }} />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
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
                        onClick={() => openNotif(n)}
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
            <div className="topbar-user-meta" style={{ textAlign: 'right' }}>
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
