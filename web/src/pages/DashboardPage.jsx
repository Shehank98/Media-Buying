import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Icon from '../components/Icon';
import api from '../lib/api';

function Stat({ icon, ig, ifg, label, val, meta, trend, trendCls }) {
  return (
    <div className="stat">
      <div className="stat-top">
        <div className="stat-ico" style={{ background: ig, color: ifg }}>
          <Icon name={icon} size={19} />
        </div>
        <div className="stat-label">{label}</div>
      </div>
      <div className="stat-val">{val}</div>
      <div className="stat-meta">
        {trend && <span className={`stat-trend ${trendCls}`}>{trend}</span>}
        {meta}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [agencies, setAgencies] = useState([]);
  const [stats, setStats] = useState({ agencies: 0, clients: 0 });

  useEffect(() => {
    api.get('/agencies').then(({ data }) => {
      const raw = data.agencies || data;
      const list = Array.isArray(raw) ? raw : [];
      setAgencies(list);
      const totalClients = list.reduce((s, a) => s + (a._count?.clients || a.clientCount || 0), 0);
      setStats({ agencies: list.length, clients: totalClients });
    }).catch(() => {});
  }, []);

  const go = (path) => { navigate(path); window.scrollTo?.(0, 0); };

  const firstName = user?.name?.split(' ')[0] || 'User';
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="content-narrow fade-in">
      <div className="page-head">
        <div>
          <h1 className="page-title">{greeting}, {firstName}</h1>
          <p className="page-sub">Here's what's moving across Ogilvy Media today - {dateStr}.</p>
        </div>
        {['SUPER_ADMIN', 'MANAGER'].includes(user?.role) && (
          <button className="btn btn-primary" onClick={() => go('/reports')}>
            <Icon name="chart" size={16} />New report
          </button>
        )}
      </div>

      <div className="summary-grid">
        <Stat
          icon="building" ig="var(--navy-900)" ifg="#fff"
          label="My Agencies" val={String(stats.agencies)}
          meta={agencies.map(a => a.name).join(' · ') || '-'}
        />
        <Stat
          icon="folder" ig="var(--coral-50)" ifg="var(--coral-600)"
          label="Clients" val={String(stats.clients)}
          meta="across your agencies"
        />
        <Stat
          icon="database" ig="var(--green-50)" ifg="var(--green-600)"
          label="Database" val=""
          meta="Upload & manage schedule logs"
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.55fr 1fr', gap: 20, alignItems: 'start' }}>
        <div className="section-card">
          <div className="section-head">
            <h3>Recent activity</h3>
            <span className="link" style={{ fontSize: 12.5 }}>View all</span>
          </div>
          <div style={{ padding: '6px 20px 8px' }}>
            <div className="feed">
              <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                Activity feed will populate as your team makes changes.
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="section-card">
            <div className="section-head"><h3>Quick access</h3></div>
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {[
                { ic: 'database', t: 'Database', s: 'Upload & manage schedules', v: '/database' },
                { ic: 'folder', t: 'Clients', s: 'Browse all clients', v: '/clients', roles: ['SUPER_ADMIN', 'MANAGER', 'GROUP_HEAD'] },
                { ic: 'chart', t: 'Buying report', s: 'Filter & export buys', v: '/reports', roles: ['SUPER_ADMIN', 'MANAGER'] },
                { ic: 'shield', t: 'User management', s: 'Roles & access', v: '/admin', roles: ['SUPER_ADMIN'] },
              ].filter((q) => !q.roles || q.roles.includes(user?.role)).map((q) => (
                <button
                  key={q.v}
                  onClick={() => go(q.v)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '11px 12px',
                    border: 'none', background: 'none', borderRadius: 10, textAlign: 'left', width: '100%',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
                >
                  <div style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--bg-sunken)', display: 'grid', placeItems: 'center', color: 'var(--navy-700)', flex: 'none' }}>
                    <Icon name={q.ic} size={18} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 650, color: 'var(--ink)' }}>{q.t}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>{q.s}</div>
                  </div>
                  <Icon name="chevR" size={16} style={{ color: 'var(--muted-2)' }} />
                </button>
              ))}
            </div>
          </div>

          <div className="section-card">
            <div className="section-head"><h3>Your agencies</h3></div>
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {agencies.map((ag) => (
                <button
                  key={ag.id}
                  onClick={() => go(`/agencies/${ag.id}`)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                    border: 'none', background: 'none', borderRadius: 10, textAlign: 'left', width: '100%',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
                >
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--navy-900)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 13, flex: 'none' }}>
                    {ag.name?.[0] || 'A'}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 650, color: 'var(--ink)' }}>{ag.name}</div>
                  </div>
                  <span className="count-badge">{ag._count?.clients || ag.clientCount || 0} clients</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
