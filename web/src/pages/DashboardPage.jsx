import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, PieChart, Pie, Cell, BarChart, Bar,
} from 'recharts';
import { useAuth } from '../contexts/AuthContext';
import Icon from '../components/Icon';
import api from '../lib/api';

// ── formatting ────────────────────────────────────────────────────────────
const fmtRs = (v) => {
  if (v == null) return 'Rs 0';
  const n = Number(v);
  if (Math.abs(n) >= 1e9) return 'Rs ' + (n / 1e9).toFixed(2) + 'B';
  if (Math.abs(n) >= 1e6) { const m = n / 1e6; return 'Rs ' + (Math.abs(m) >= 100 ? Math.round(m) : m.toFixed(1)) + 'M'; }
  if (Math.abs(n) >= 1e3) return 'Rs ' + Math.round(n).toLocaleString('en-US');
  return 'Rs ' + Math.round(n);
};
const fmtNum = (v) => (v == null ? '0' : Number(v).toLocaleString('en-US'));
const mShort = (ym) => { if (!ym) return ''; const [y, m] = ym.split('-'); return new Date(+y, +m - 1, 1).toLocaleDateString('en-US', { month: 'short' }); };
const mFull = (ym) => { if (!ym) return ''; const [y, m] = ym.split('-'); return new Date(+y, +m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }); };
const initials = (name) => (name ? name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() : '?');
const timeAgo = (iso) => {
  if (!iso) return '';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
};

// ── design tokens ─────────────────────────────────────────────────────────
const CARD = { background: '#fff', border: '1px solid #E5E8ED', borderRadius: 14, boxShadow: '0 1px 2px rgba(15,31,61,.06)' };
const MEDIUM = { TV: '#1F5BB5', RADIO: '#E85D24', PRINT: '#15814B' };
const MEDIUM_LABEL = { TV: 'Television', RADIO: 'Radio', PRINT: 'Print' };
const DOTS = [['#FDF1EB', '#D9521C'], ['#EDF3FD', '#1F5BB5'], ['#ECF8F1', '#15814B'], ['#E8DEF8', '#6B3FB5'], ['#FCF4E2', '#9A5B00'], ['#FBE0DA', '#C5391F']];
const trendChip = (kind) => {
  const c = kind === 'up' ? ['#15814B', '#ECF8F1'] : kind === 'down' ? ['#C5391F', '#FBE0DA'] : ['#6B7790', '#EEF0F3'];
  return { color: c[0], background: c[1], display: 'inline-flex', alignItems: 'center', fontSize: 11.5, fontWeight: 700, padding: '3px 8px', borderRadius: 7, fontFamily: "'Spline Sans Mono', monospace" };
};
const COL_HEAD = { textAlign: 'left', fontSize: 10.5, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: '#6B7790', padding: '11px 22px', background: '#F5F6F8', borderBottom: '1px solid #E5E8ED' };
const CELL = { padding: '12px 22px', borderBottom: '1px solid #E5E8ED' };

function StatCard({ tone, icon, value, label, meta, trend, trendKind }) {
  return (
    <div style={{ ...CARD, padding: '18px 20px', position: 'relative', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ width: 38, height: 38, borderRadius: 11, display: 'grid', placeItems: 'center', background: tone[0], color: tone[1] }}>
          <Icon name={icon} size={19} />
        </div>
        {trend && <span style={trendChip(trendKind)}>{trend}</span>}
      </div>
      <div style={{ fontSize: 31, fontWeight: 700, letterSpacing: '-1px', lineHeight: 1, fontFamily: "'Spline Sans Mono', monospace", color: '#16243C' }}>{value}</div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: '#6B7790', marginTop: 9 }}>{label}</div>
      {meta && <div style={{ fontSize: 12, color: '#93A0B5', marginTop: 4 }}>{meta}</div>}
    </div>
  );
}

function CardHead({ title, sub, right }) {
  return (
    <div style={{ padding: '18px 22px 6px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
      <div>
        <h3 style={{ fontSize: 14.5, fontWeight: 700, margin: 0, letterSpacing: '-.2px' }}>{title}</h3>
        {sub && <p style={{ fontSize: 12.5, color: '#6B7790', margin: '4px 0 0' }}>{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const role = user?.role;
  const isExec = ['SUPER_ADMIN', 'MANAGER'].includes(role);
  const [range, setRange] = useState('QTD');

  const [agencies, setAgencies] = useState([]);
  const [clientTotal, setClientTotal] = useState(0);
  const [summary, setSummary] = useState(null);
  const [trend, setTrend] = useState([]);
  const [medium, setMedium] = useState([]);
  const [clients, setClients] = useState([]);
  const [uploads, setUploads] = useState([]);
  const [agencyComp, setAgencyComp] = useState([]);
  const [topChannels, setTopChannels] = useState([]);

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
      api.get('/analytics/dashboard/top-clients').then(({ data }) => setClients((data || []).slice(0, 6))).catch(() => {});
      api.get('/analytics/dashboard/recent-uploads').then(({ data }) => setUploads((data || []).slice(0, 5))).catch(() => {});
      api.get('/analytics/dashboard/agency-comparison').then(({ data }) => setAgencyComp(Array.isArray(data) ? data : [])).catch(() => {});
      api.get('/analytics/dashboard/top-channels').then(({ data }) => setTopChannels((data || []).slice(0, 6))).catch(() => {});
    }
  }, [isExec]);

  const go = (path) => { navigate(path); window.scrollTo?.(0, 0); };
  const firstName = user?.name?.split(' ')[0] || 'there';
  const hour = new Date().getHours();
  const greeting = `${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}, ${firstName}`;
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const mediumData = medium.map(m => ({ name: m.medium, value: m.value, pct: m.pct }));
  const mediumTotal = medium.reduce((s, m) => s + m.value, 0);
  const channelsCenter = summary?.activeChannelsThisMonth ?? mediumData.length;

  const yoy = summary?.yoyGrowthPct;

  // ── Header ────────────────────────────────────────────────────────────────
  const Header = () => (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, marginBottom: 22, flexWrap: 'wrap' }}>
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-.6px', margin: 0 }}>{greeting}</h1>
        <p style={{ fontSize: 13.5, color: '#6B7790', margin: '6px 0 0' }}>
          {isExec ? 'Network-wide media buying overview' : 'Your media buying workspace'} · {today}
        </p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {isExec && (
          <div style={{ display: 'flex', background: '#EEF0F3', border: '1px solid #E5E8ED', borderRadius: 10, padding: 3 }}>
            {['30D', 'QTD', 'YTD'].map((r) => {
              const on = range === r;
              return (
                <button key={r} onClick={() => setRange(r)} style={{ border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, padding: '6px 12px', borderRadius: 7, fontFamily: 'inherit', background: on ? '#fff' : 'transparent', color: on ? '#16243C' : '#6B7790', boxShadow: on ? '0 1px 2px rgba(15,31,61,.08)' : 'none' }}>{r}</button>
              );
            })}
          </div>
        )}
        {isExec && (
          <button onClick={() => go('/reports')} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, borderRadius: 10, fontSize: 13, fontWeight: 600, padding: '9px 14px', border: '1px solid #D5DAE2', background: '#fff', color: '#3B4A63', boxShadow: '0 1px 2px rgba(15,31,61,.06)', cursor: 'pointer' }}>
            <Icon name="download" size={16} />Export
          </button>
        )}
        <button onClick={() => go('/database')} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, borderRadius: 10, fontSize: 13, fontWeight: 600, padding: '9px 15px', border: 'none', background: '#E85D24', color: '#fff', boxShadow: '0 1px 2px rgba(232,93,36,.4)', cursor: 'pointer' }}>
          <Icon name="plus" size={16} />Add record
        </button>
      </div>
    </div>
  );

  // ── Non-exec (GROUP_HEAD / PLANNER) compact view ────────────────────────────
  if (!isExec) {
    const quick = [
      { ic: 'database', t: 'Database', s: 'Upload & manage schedules', v: '/database' },
      { ic: 'folder', t: 'Clients', s: 'Browse your clients', v: '/clients', roles: ['GROUP_HEAD'] },
      { ic: 'building', t: 'Agencies', s: 'Your agencies', v: '/agencies' },
      { ic: 'user', t: 'Profile', s: 'Account & password', v: '/profile' },
    ].filter(q => !q.roles || q.roles.includes(role));
    return (
      <div style={{ maxWidth: 1240, margin: '0 auto' }}>
        <Header />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 18, marginBottom: 20 }}>
          <StatCard tone={DOTS[0]} icon="building" value={String(agencies.length)} label="My Agencies" meta={agencies.map(a => a.name).join(' · ') || '-'} />
          <StatCard tone={DOTS[1]} icon="folder" value={String(clientTotal)} label="Clients" meta="Across your agencies" />
          <StatCard tone={DOTS[2]} icon="database" value="-" label="Database" meta="Upload & manage schedule logs" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          <div style={{ ...CARD, overflow: 'hidden' }}>
            <CardHead title="Quick access" />
            <div style={{ padding: '6px 12px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {quick.map(q => (
                <button key={q.v} onClick={() => go(q.v)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 10px', border: 'none', background: 'none', borderRadius: 10, textAlign: 'left', width: '100%', cursor: 'pointer' }} onMouseEnter={(e) => { e.currentTarget.style.background = '#F5F6F8'; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}>
                  <div style={{ width: 36, height: 36, borderRadius: 9, background: '#EEF0F3', display: 'grid', placeItems: 'center', color: '#274069', flex: 'none' }}><Icon name={q.ic} size={18} /></div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 650, color: '#16243C' }}>{q.t}</div>
                    <div style={{ fontSize: 12, color: '#6B7790', marginTop: 1 }}>{q.s}</div>
                  </div>
                  <Icon name="chevR" size={16} style={{ color: '#93A0B5' }} />
                </button>
              ))}
            </div>
          </div>
          <div style={{ ...CARD, overflow: 'hidden' }}>
            <CardHead title="Your agencies" />
            <div style={{ padding: '6px 12px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {agencies.length === 0 && <div style={{ padding: '24px 0', textAlign: 'center', color: '#6B7790', fontSize: 13 }}>No agencies assigned.</div>}
              {agencies.map(ag => (
                <button key={ag.id} onClick={() => go(`/agencies/${ag.id}`)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 10px', border: 'none', background: 'none', borderRadius: 10, textAlign: 'left', width: '100%', cursor: 'pointer' }} onMouseEnter={(e) => { e.currentTarget.style.background = '#F5F6F8'; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: '#0F1F3D', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 13, flex: 'none' }}>{ag.name?.[0] || 'A'}</div>
                  <div style={{ flex: 1, fontSize: 13.5, fontWeight: 650, color: '#16243C' }}>{ag.name}</div>
                  <span style={{ fontSize: 11, fontWeight: 600, background: '#EEF0F3', color: '#6B7790', padding: '2px 8px', borderRadius: 20 }}>{ag._count?.clients || ag.clientCount || 0} clients</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Exec dashboard (the design) ─────────────────────────────────────────────
  const stats = [
    { tone: DOTS[0], icon: 'money', value: fmtRs(summary?.billingsYTD), label: 'Total Media Spend', meta: `Across all agencies · ${range}`, trend: yoy != null ? `${yoy >= 0 ? '▲' : '▼'} ${Math.abs(yoy)}%` : null, trendKind: yoy > 0 ? 'up' : yoy < 0 ? 'down' : 'flat' },
    { tone: DOTS[1], icon: 'folder', value: fmtNum(summary?.activeClients ?? clientTotal), label: 'Active Clients', meta: 'Billing this year' },
    { tone: DOTS[2], icon: 'database', value: fmtNum(channelsCenter), label: 'Channels Tracked', meta: 'TV · Radio · Print', trend: 'flat', trendKind: 'flat' },
    { tone: DOTS[3], icon: 'activity', value: fmtNum(summary?.logsThisMonth), label: 'Schedule Logs (MTD)', meta: `${summary?.uploadsThisMonth ?? 0} uploads this month` },
  ];

  return (
    <div style={{ maxWidth: 1240, margin: '0 auto' }}>
      <Header />

      {/* stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 18, marginBottom: 20 }}>
        {stats.map((s, i) => <StatCard key={i} {...s} />)}
      </div>

      {/* trend + donut */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.62fr 1fr', gap: 18, marginBottom: 20 }}>
        <div style={CARD}>
          <CardHead
            title="Monthly Spend Trend" sub="Total committed media value · last 12 months"
            right={(
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'Spline Sans Mono', monospace", letterSpacing: '-.5px' }}>{fmtRs(summary?.billingsYTD)}</div>
                {yoy != null && <div style={{ fontSize: 12, fontWeight: 700, color: yoy >= 0 ? '#15814B' : '#C5391F' }}>{yoy >= 0 ? '▲' : '▼'} {Math.abs(yoy)}% YoY</div>}
              </div>
            )}
          />
          <div style={{ padding: '6px 14px 16px' }}>
            {trend.length === 0 ? (
              <div style={{ height: 200, display: 'grid', placeItems: 'center', color: '#93A0B5', fontSize: 13 }}>No spend data yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={trend} margin={{ top: 8, right: 14, left: 6, bottom: 0 }}>
                  <defs>
                    <linearGradient id="obArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#E85D24" stopOpacity={0.26} />
                      <stop offset="100%" stopColor="#E85D24" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="#EEF0F3" />
                  <XAxis dataKey="month" tickFormatter={mShort} tick={{ fontSize: 10.5, fill: '#93A0B5', fontWeight: 600 }} axisLine={{ stroke: '#E5E8ED' }} tickLine={false} interval="preserveStartEnd" minTickGap={4} />
                  <YAxis hide domain={['dataMin', 'dataMax']} />
                  <Tooltip formatter={(v) => [fmtRs(v), 'Spend']} labelFormatter={mFull} contentStyle={{ borderRadius: 9, border: '1px solid #E5E8ED', fontSize: 12 }} />
                  <Area type="monotone" dataKey="scheduleValue" stroke="#E85D24" strokeWidth={2.5} fill="url(#obArea)" dot={false} activeDot={{ r: 4.5, fill: '#fff', stroke: '#E85D24', strokeWidth: 2.5 }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div style={CARD}>
          <CardHead title="Medium Split" sub="Spend share by channel type" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '14px 22px 22px' }}>
            <div style={{ position: 'relative', width: 140, height: 140, flex: 'none' }}>
              {mediumData.length > 0 && (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={mediumData} dataKey="value" cx="50%" cy="50%" innerRadius={44} outerRadius={62} startAngle={90} endAngle={-270} stroke="none" paddingAngle={1.5}>
                      {mediumData.map((d) => <Cell key={d.name} fill={MEDIUM[d.name] || '#93A0B5'} />)}
                    </Pie>
                    <Tooltip formatter={(v, n) => [fmtRs(v), MEDIUM_LABEL[n] || n]} contentStyle={{ borderRadius: 9, border: '1px solid #E5E8ED', fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
              <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontFamily: "'Spline Sans Mono', monospace", fontSize: 21, fontWeight: 600, color: '#16243C', lineHeight: 1 }}>{fmtNum(channelsCenter)}</div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: '#93A0B5', marginTop: 2 }}>channels</div>
                </div>
              </div>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 13 }}>
              {mediumData.length === 0 && <div style={{ fontSize: 13, color: '#93A0B5' }}>No spend data yet</div>}
              {mediumData.map((d) => (
                <div key={d.name}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600 }}>
                      <span style={{ width: 9, height: 9, borderRadius: 3, background: MEDIUM[d.name] || '#93A0B5' }} />{MEDIUM_LABEL[d.name] || d.name}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "'Spline Sans Mono', monospace" }}>{mediumTotal > 0 ? Math.round((d.value / mediumTotal) * 100) : 0}%</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: '#93A0B5', marginLeft: 16 }}>{fmtRs(d.value)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* top clients + activity */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 18 }}>
        <div style={{ ...CARD, overflow: 'hidden' }}>
          <div style={{ padding: '16px 22px', borderBottom: '1px solid #E5E8ED', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ fontSize: 14.5, fontWeight: 700, margin: 0, letterSpacing: '-.2px' }}>Top Clients by Spend</h3>
            <span onClick={() => go('/clients')} style={{ fontSize: 12.5, fontWeight: 600, color: '#D9521C', cursor: 'pointer' }}>View all</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={COL_HEAD}>Client</th>
                <th style={COL_HEAD}>Agency</th>
                <th style={{ ...COL_HEAD, textAlign: 'right' }}>Spend</th>
                <th style={{ ...COL_HEAD, textAlign: 'right' }}>MoM</th>
              </tr>
            </thead>
            <tbody>
              {clients.length === 0 && (
                <tr><td colSpan={4} style={{ ...CELL, textAlign: 'center', color: '#93A0B5' }}>No client billings yet.</td></tr>
              )}
              {clients.map((c, i) => {
                const dot = DOTS[i % DOTS.length];
                const kind = c.momDirection === 'up' ? 'up' : c.momDirection === 'down' ? 'down' : 'flat';
                return (
                  <tr key={c.clientId} onClick={() => go(`/clients/${c.clientId}`)} style={{ cursor: 'pointer' }} onMouseEnter={(e) => { e.currentTarget.style.background = '#F5F6F8'; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                    <td style={CELL}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ width: 28, height: 28, borderRadius: 8, background: dot[0], color: dot[1], display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, flex: 'none' }}>{initials(c.clientName)}</span>
                        <span style={{ fontWeight: 600, color: '#16243C' }}>{c.clientName}</span>
                      </div>
                    </td>
                    <td style={{ ...CELL, color: '#3B4A63' }}>{c.agencyName}</td>
                    <td style={{ ...CELL, textAlign: 'right', fontWeight: 600, color: '#16243C', fontFamily: "'Spline Sans Mono', monospace" }}>{fmtRs(c.ytdBilling)}</td>
                    <td style={{ ...CELL, textAlign: 'right' }}>
                      {c.momTrend != null ? <span style={trendChip(kind)}>{kind === 'down' ? '▼' : '▲'} {Math.abs(c.momTrend)}%</span> : <span style={{ color: '#93A0B5' }}>-</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ ...CARD, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #E5E8ED', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ fontSize: 14.5, fontWeight: 700, margin: 0, letterSpacing: '-.2px' }}>Recent Activity</h3>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#15814B', boxShadow: '0 0 0 3px #ECF8F1' }} />
          </div>
          <div style={{ padding: '6px 18px 10px' }}>
            {uploads.length === 0 && <div style={{ padding: '28px 0', textAlign: 'center', color: '#93A0B5', fontSize: 13 }}>No recent activity.</div>}
            {uploads.map((u) => {
              const failed = u.failedRows > 0;
              return (
                <div key={u.id} style={{ display: 'flex', gap: 12, padding: '13px 2px', borderBottom: '1px solid #EEF0F3' }}>
                  <div style={{ width: 32, height: 32, borderRadius: 9, flex: 'none', display: 'grid', placeItems: 'center', background: failed ? '#FCF4E2' : '#ECF8F1', color: failed ? '#9A5B00' : '#15814B' }}>
                    <Icon name={failed ? 'alert' : 'check'} size={15} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, color: '#3B4A63', lineHeight: 1.45 }}>
                      <b style={{ color: '#16243C' }}>{u.uploadedBy}</b> uploaded {u.fileName || 'a batch'} · {u.successfulRows}/{u.totalRows} rows{u.agencyName ? ` · ${u.agencyName}` : ''}
                    </div>
                    <div style={{ fontSize: 11, color: '#93A0B5', marginTop: 3 }}>{timeAgo(u.createdAt)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* spend by agency + top channels */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 18, marginTop: 20 }}>
        <div style={{ ...CARD, overflow: 'hidden' }}>
          <CardHead title="Spend by Agency" sub="YTD committed media value per agency" />
          <div style={{ padding: '10px 16px 18px' }}>
            {agencyComp.length === 0 ? (
              <div style={{ height: 220, display: 'grid', placeItems: 'center', color: '#93A0B5', fontSize: 13 }}>No agency data yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(180, Math.min(agencyComp.length, 8) * 40 + 20)}>
                <BarChart data={[...agencyComp].sort((a, b) => b.ytdBillings - a.ytdBillings).slice(0, 8)} layout="vertical" margin={{ top: 4, right: 20, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F3" horizontal={false} />
                  <XAxis type="number" tickFormatter={(v) => fmtRs(v).replace('Rs ', '')} tick={{ fontSize: 10.5, fill: '#93A0B5' }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="agencyName" tick={{ fontSize: 11.5, fill: '#16243C' }} axisLine={false} tickLine={false} width={120} />
                  <Tooltip formatter={(v) => [fmtRs(v), 'YTD Spend']} contentStyle={{ borderRadius: 9, border: '1px solid #E5E8ED', fontSize: 12 }} />
                  <Bar dataKey="ytdBillings" radius={[0, 6, 6, 0]}>
                    {agencyComp.slice(0, 8).map((_, i) => <Cell key={i} fill={DOTS[i % DOTS.length][1]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div style={{ ...CARD, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #E5E8ED', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ fontSize: 14.5, fontWeight: 700, margin: 0, letterSpacing: '-.2px' }}>Top Channels</h3>
            <span onClick={() => go('/spend-analytics')} style={{ fontSize: 12.5, fontWeight: 600, color: '#D9521C', cursor: 'pointer' }}>Analytics</span>
          </div>
          <div style={{ padding: '8px 16px 12px' }}>
            {topChannels.length === 0 && <div style={{ padding: '28px 0', textAlign: 'center', color: '#93A0B5', fontSize: 13 }}>No channel data yet.</div>}
            {(() => {
              const max = Math.max(...topChannels.map(c => c.ytdSpend || 0), 1);
              return topChannels.map((c, i) => {
                const color = MEDIUM[c.medium] || DOTS[i % DOTS.length][1];
                const pct = Math.max(3, Math.round((c.ytdSpend / max) * 100));
                return (
                  <div key={c.channelMasterId} onClick={() => go(`/channel-masters/${c.channelMasterId}`)} style={{ padding: '9px 6px', borderRadius: 8, cursor: 'pointer' }} onMouseEnter={(e) => { e.currentTarget.style.background = '#F5F6F8'; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 650, color: '#16243C' }}>{c.channelName}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, fontFamily: "'Spline Sans Mono', monospace", color: '#16243C' }}>{fmtRs(c.ytdSpend)}</span>
                    </div>
                    <div style={{ height: 6, borderRadius: 4, background: '#EEF0F3', overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', borderRadius: 4, background: color }} />
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
