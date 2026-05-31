import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Icon, { Avatar, RoleBadge } from './Icon';

const NAV = [
  { key: '/', label: 'Dashboard', icon: 'grid' },
  { key: '/executive-dashboard', label: 'Executive Dashboard', icon: 'bar-chart', roles: ['SUPER_ADMIN', 'MANAGER'] },
  { key: '/agencies', label: 'Agencies', icon: 'building' },
  { key: '/clients', label: 'Clients', icon: 'folder' },
  { key: '/reports', label: 'Reports', icon: 'chart', roles: ['SUPER_ADMIN', 'MANAGER'] },
];
const NAV_ADMIN = [
  { key: '/admin', label: 'Admin', icon: 'shield', roles: ['SUPER_ADMIN'] },
  { key: '/profile', label: 'Profile', icon: 'user' },
];

function Breadcrumbs({ go }) {
  const location = useLocation();
  const path = location.pathname;

  const home = <a onClick={() => go('/')}>Ogilvy Media</a>;
  const sep = <Icon name="chevR" size={14} />;

  if (path === '/') return <><b>Dashboard</b></>;
  if (path === '/agencies') return <>{home}{sep}<b>Agencies</b></>;
  if (path === '/clients') return <>{home}{sep}<b>Clients</b></>;
  if (path.startsWith('/clients/')) return <>{home}{sep}<a onClick={() => go('/clients')}>Clients</a>{sep}<b>Client</b></>;
  if (path.startsWith('/channels/')) return <>{home}{sep}<a onClick={() => go('/clients')}>Clients</a>{sep}<b>Channel</b></>;
  if (path === '/reports') return <>{home}{sep}<b>Buying Report</b></>;
  if (path === '/admin') return <>{home}{sep}<a>Super Admin</a>{sep}<b>User Management</b></>;
  if (path === '/profile') return <>{home}{sep}<b>Profile</b></>;
  return <>{home}</>;
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const go = (path) => { navigate(path); window.scrollTo?.(0, 0); };

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
          <div className="brand-mark">O</div>
          <div>
            <div className="brand-name">Ogilvy</div>
            <div className="brand-sub">MEDIA BUYING RECORDS</div>
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
          <button className="icon-btn">
            <Icon name="bell" size={18} />
            <span className="dot" />
          </button>
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
