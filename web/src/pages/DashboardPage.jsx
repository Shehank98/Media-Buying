import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, PieChart, Pie, Cell,
} from 'recharts';
import { useAuth } from '../contexts/AuthContext';
import Icon from '../components/Icon';
import api from '../lib/api';

const fmtLKR = (v) => (v == null ? '-' : 'LKR ' + Math.round(Number(v)).toLocaleString('en-US'));
const fmtShort = (v) => {
  if (v == null || v === 0) return '0';
  const n = Number(v);
  if (Math.abs(n) >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (Math.abs(n) >= 1000) return (n / 1000).toFixed(0) + 'K';
  return String(Math.round(n));
};
const fmtMonth = (ym) => {
  if (!ym) return '-';
  const [y, m] = ym.split('-');
  return new Date(+y, +m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
};
const fmtMonthShort = (ym) => {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  return new Date(+y, +m - 1, 1).toLocaleDateString('en-US', { month: 'short' });
};
const timeAgo = (iso) => {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

const MEDIUM_COLORS = { TV: '#1e3a5f', RADIO: '#E85D24', PRINT: '#059669' };

function Kpi({ icon, ig, ifg, label, val, sub, trend, dir }) {
  const tColor = dir === 'up' ? 'var(--green-600)' : dir === 'down' ? '#DC2626' : 'var(--muted)';
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
        {trend != null && (
          <span style={{ color: tColor, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <Icon name={dir === 'down' ? 'trending-down' : 'trending-up'} size={13} />
            {Math.abs(trend)}%
          </span>
        )}
        {sub}
      </div>
    </div>
  );
}

function Mini({ icon, label, val }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 11, padding: '13px 15px',
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 'var(--r-lg)', boxShadow: 'var(--sh-xs)',
    }}>
      <div style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--bg-sunken)', color: 'var(--navy-700)', display: 'grid', placeItems: 'center', flex: 'none' }}>
        <Icon name={icon} size={16} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 18, fontWeight: 740, color: 'var(--ink)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{val}</div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
      </div>
    </div>
  );
}

const ChartEmpty = ({ h = 180 }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: h, color: 'var(--muted)' }}>
    <Icon name="bar-chart" size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
    <div style={{ fontSize: 13 }}>No data yet</div>
  </div>
);

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const role = user?.role;
  const isExec = ['SUPER_ADMIN', 'MANAGER'].includes(role);

  const [agencies, setAgencies] = useState([]);
  const [clientTotal, setClientTotal] = useState(0);
  const [summary, setSummary] = useState(null);
  const [trend, setTrend] = useState([]);
  const [medium, setMedium] = useState([]);
  const [topClients, setTopClients] = useState([]);
  const [topChannels, setTopChannels] = useState([]);
  const [uploads, setUploads] = useState([]);

  useEffect(() => {
    api.get('/agencies').then(({ data }) => {
      const raw = data.agencies || data;
      const list = Array.isArray(raw) ? raw : [];
      setAgencies(list);
      setClientTotal(list.reduce((s, a) => s + (a._count?.clients || a.clientCount || 0), 0));
    }).catch(() => {});

    if (isExec) {
      api.get('/analytics/dashboard/summary').then(({ data }) => setSummary(data)).catch(() => {});
      api.get('/analytics/dashboard/monthly-trend').then(({ data }) => setTrend((data.combined || []).slice(-12))).catch(() => {});
      api.get('/analytics/dashboard/medium-split').then(({ data }) => setMedium((data.ytd || []).filter(d => d.value > 0))).catch(() => {});
      api.get('/analytics/dashboard/top-clients').then(({ data }) => setTopClients((data || []).slice(0, 6))).catch(() => {});
      api.get('/analytics/dashboard/top-channels').then(({ data }) => setTopChannels((data || []).slice(0, 6))).catch(() => {});
      api.get('/analytics/dashboard/recent-uploads').then(({ data }) => setUploads((data || []).slice(0, 5))).catch(() => {});
    }
  }, [isExec]);

  const go = (path) => { navigate(path); window.scrollTo?.(0, 0); };

  const firstName = user?.name?.split(' ')[0] || 'User';
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const mediumTotal = medium.reduce((s, m) => s + m.value, 0);

  const quickItems = [
    { ic: 'database', t: 'Database', s: 'Upload & manage schedules', v: '/database' },
    { ic: 'folder', t: 'Clients', s: 'Browse all clients', v: '/clients', roles: ['SUPER_ADMIN', 'MANAGER', 'GROUP_HEAD'] },
    { ic: 'chart', t: 'Spend analytics', s: 'Charts & breakdowns', v: '/spend-analytics', roles: ['SUPER_ADMIN', 'MANAGER'] },
    { ic: 'bar-chart', t: 'Executive dashboard', s: 'Full overview', v: '/executive-dashboard', roles: ['SUPER_ADMIN', 'MANAGER'] },
    { ic: 'file', t: 'Buying report', s: 'Filter & export buys', v: '/reports', roles: ['SUPER_ADMIN', 'MANAGER'] },
    { ic: 'upload', t: 'Upload tracker', s: 'Monthly upload status', v: '/upload-tracker', roles: ['SUPER_ADMIN'] },
    { ic: 'shield', t: 'User management', s: 'Roles & access', v: '/admin', roles: ['SUPER_ADMIN'] },
  ].filter((q) => !q.roles || q.roles.includes(role));

  // ── Reusable cards ────────────────────────────────────────────────────────
  const QuickAccess = () => (
    <div className="section-card">
      <div className="section-head"><h3>Quick access</h3></div>
      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {quickItems.map((q) => (
          <button
            key={q.v}
            onClick={() => go(q.v)}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: 'none', background: 'none', borderRadius: 10, textAlign: 'left', width: '100%', cursor: 'pointer' }}
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
  );

  const Agencies = () => (
    <div className="section-card">
      <div className="section-head">
        <h3>Your agencies</h3>
        <span className="link" style={{ fontSize: 12.5 }} onClick={() => go('/agencies')}>View all</span>
      </div>
      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {agencies.length === 0 && (
          <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No agencies assigned.</div>
        )}
        {agencies.map((ag) => (
          <button
            key={ag.id}
            onClick={() => go(`/agencies/${ag.id}`)}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: 'none', background: 'none', borderRadius: 10, textAlign: 'left', width: '100%', cursor: 'pointer' }}
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
  );

  return (
    <div className="content-narrow fade-in">
      <div className="page-head">
        <div>
          <h1 className="page-title">{greeting}, {firstName}</h1>
          <p className="page-sub">Here's what's moving across Ogilvy Media today - {dateStr}.</p>
        </div>
        {isExec && (
          <button className="btn btn-primary" onClick={() => go('/reports')}>
            <Icon name="chart" size={16} />New report
          </button>
        )}
      </div>

      {/* KPI cards */}
      {isExec ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18, marginBottom: 16 }}>
          <Kpi
            icon="money" ig="var(--navy-900)" ifg="#fff"
            label="Billings this month" val={fmtShort(summary?.billingsThisMonth)}
            sub={fmtMonth(new Date().toISOString().slice(0, 7))}
          />
          <Kpi
            icon="dollar" ig="var(--coral-50)" ifg="var(--coral-600)"
            label="Billings YTD" val={fmtShort(summary?.billingsYTD)}
            trend={summary?.yoyGrowthPct} dir={summary?.yoyGrowthPct > 0 ? 'up' : summary?.yoyGrowthPct < 0 ? 'down' : 'same'}
            sub="YoY"
          />
          <Kpi
            icon="folder" ig="var(--green-50)" ifg="var(--green-600)"
            label="Active clients" val={String(summary?.activeClients ?? clientTotal)}
            sub="billing this year"
          />
          <Kpi
            icon="tv" ig="var(--blue-50)" ifg="var(--blue-700)"
            label="Active channels" val={String(summary?.activeChannelsThisMonth ?? 0)}
            sub="this month"
          />
        </div>
      ) : (
        <div className="summary-grid">
          <Kpi icon="building" ig="var(--navy-900)" ifg="#fff" label="My agencies" val={String(agencies.length)} sub={agencies.map(a => a.name).join(' · ') || '-'} />
          <Kpi icon="folder" ig="var(--coral-50)" ifg="var(--coral-600)" label="Clients" val={String(clientTotal)} sub="across your agencies" />
          <Kpi icon="database" ig="var(--green-50)" ifg="var(--green-600)" label="Database" val="" sub="Upload & manage schedule logs" />
        </div>
      )}

      {/* Secondary metric strip (exec) */}
      {isExec && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 26 }}>
          <Mini icon="database" label="Schedule logs this month" val={String(summary?.logsThisMonth ?? 0)} />
          <Mini icon="upload" label="Uploads this month" val={String(summary?.uploadsThisMonth ?? 0)} />
          <Mini icon="edit" label="Manual entries" val={String(summary?.manualEntriesThisMonth ?? 0)} />
          <Mini icon="building" label="Agencies" val={String(agencies.length)} />
        </div>
      )}

      {/* Charts row (exec) */}
      {isExec && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.55fr 1fr', gap: 20, marginBottom: 20, alignItems: 'start' }}>
          <div className="section-card">
            <div className="section-head">
              <h3>Billings trend</h3>
              <span className="link" style={{ fontSize: 12.5 }} onClick={() => go('/executive-dashboard')}>Details</span>
            </div>
            <div style={{ padding: '16px 14px 8px' }}>
              {trend.length === 0 ? <ChartEmpty h={220} /> : (
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="dashTrend" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#E85D24" stopOpacity={0.32} />
                        <stop offset="95%" stopColor="#E85D24" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="month" tickFormatter={fmtMonthShort} tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={42} />
                    <Tooltip formatter={(v) => [fmtLKR(v), 'Billings']} labelFormatter={fmtMonth} contentStyle={{ borderRadius: 9, border: '1px solid var(--border)', fontSize: 12 }} />
                    <Area type="monotone" dataKey="scheduleValue" stroke="#E85D24" strokeWidth={2.2} fill="url(#dashTrend)" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="section-card">
            <div className="section-head">
              <h3>Medium split (YTD)</h3>
              <span className="link" style={{ fontSize: 12.5 }} onClick={() => go('/spend-analytics')}>Analytics</span>
            </div>
            <div style={{ padding: '12px 16px 16px' }}>
              {medium.length === 0 ? <ChartEmpty h={180} /> : (
                <>
                  <ResponsiveContainer width="100%" height={170}>
                    <PieChart>
                      <Pie data={medium} dataKey="value" nameKey="medium" innerRadius={48} outerRadius={72} paddingAngle={2}>
                        {medium.map((d) => <Cell key={d.medium} fill={MEDIUM_COLORS[d.medium] || '#94a3b8'} />)}
                      </Pie>
                      <Tooltip formatter={(v) => fmtLKR(v)} contentStyle={{ borderRadius: 9, border: '1px solid var(--border)', fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
                    {medium.map((d) => (
                      <div key={d.medium} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                        <span style={{ width: 9, height: 9, borderRadius: 3, background: MEDIUM_COLORS[d.medium] || '#94a3b8', flex: 'none' }} />
                        <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{d.medium}</span>
                        <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
                          {fmtShort(d.value)} · {mediumTotal > 0 ? Math.round((d.value / mediumTotal) * 100) : 0}%
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Top lists (exec) */}
      {isExec && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20, alignItems: 'start' }}>
          <div className="section-card">
            <div className="section-head">
              <h3>Top clients (YTD)</h3>
              <span className="link" style={{ fontSize: 12.5 }} onClick={() => go('/clients')}>All clients</span>
            </div>
            <div style={{ padding: 10 }}>
              {topClients.length === 0 && <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No client billings yet.</div>}
              {topClients.map((c) => (
                <button
                  key={c.clientId}
                  onClick={() => go(`/clients/${c.clientId}`)}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 10px', border: 'none', background: 'none', borderRadius: 10, textAlign: 'left', width: '100%', cursor: 'pointer' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
                >
                  <div style={{ width: 24, height: 24, borderRadius: 7, background: 'var(--bg-sunken)', color: 'var(--ink-soft)', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 11.5, flex: 'none' }}>{c.rank}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.clientName}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{c.agencyName}</div>
                  </div>
                  <div style={{ textAlign: 'right', flex: 'none' }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{fmtShort(c.ytdBilling)}</div>
                    {c.momTrend != null && (
                      <div style={{ fontSize: 11, fontWeight: 700, color: c.momDirection === 'up' ? 'var(--green-600)' : c.momDirection === 'down' ? '#DC2626' : 'var(--muted)' }}>
                        {c.momDirection === 'down' ? '▼' : '▲'} {Math.abs(c.momTrend)}%
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="section-card">
            <div className="section-head">
              <h3>Top channels (YTD)</h3>
              <span className="link" style={{ fontSize: 12.5 }} onClick={() => go('/spend-analytics')}>Analytics</span>
            </div>
            <div style={{ padding: 10 }}>
              {topChannels.length === 0 && <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No channel spend yet.</div>}
              {topChannels.map((c) => (
                <button
                  key={c.channelMasterId}
                  onClick={() => go(`/channel-masters/${c.channelMasterId}`)}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 10px', border: 'none', background: 'none', borderRadius: 10, textAlign: 'left', width: '100%', cursor: 'pointer' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
                >
                  <div style={{ width: 24, height: 24, borderRadius: 7, background: 'var(--bg-sunken)', color: 'var(--ink-soft)', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 11.5, flex: 'none' }}>{c.rank}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.channelName}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{c.mediaGroup || c.medium} · {c.clientCount} clients</div>
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums', flex: 'none' }}>{fmtShort(c.ytdSpend)}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Lower split: activity/uploads + quick access/agencies */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.55fr 1fr', gap: 20, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {isExec ? (
            <div className="section-card">
              <div className="section-head">
                <h3>Recent uploads</h3>
                <span className="link" style={{ fontSize: 12.5 }} onClick={() => go('/database')}>Database</span>
              </div>
              <div style={{ padding: '6px 10px 8px' }}>
                {uploads.length === 0 ? (
                  <div style={{ padding: '28px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No uploads yet.</div>
                ) : (
                  <div className="feed">
                    {uploads.map((u) => {
                      const failed = u.failedRows > 0;
                      return (
                        <div key={u.id} className="feed-item">
                          <div className="feed-ico" style={{ background: failed ? 'var(--amber-50)' : 'var(--green-50)', color: failed ? '#B45309' : 'var(--green-600)' }}>
                            <Icon name={failed ? 'alert' : 'upload'} />
                          </div>
                          <div className="feed-body">
                            <div className="feed-text">
                              <b>{u.uploadedBy}</b> uploaded <b>{u.fileName || 'a file'}</b> · {u.successfulRows}/{u.totalRows} rows
                              {u.agencyName ? ` · ${u.agencyName}` : ''}{u.scheduleMonth ? ` · ${fmtMonth(u.scheduleMonth)}` : ''}
                            </div>
                            <div className="feed-time">{timeAgo(u.createdAt)}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <Agencies />
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <QuickAccess />
          {isExec && <Agencies />}
        </div>
      </div>
    </div>
  );
}
