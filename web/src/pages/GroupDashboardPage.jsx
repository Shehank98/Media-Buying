import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import Icon from '../components/Icon';
import OrbitLoader from '../components/OrbitLoader';
import api from '../lib/api';

const fmtLKR = (v) => {
  if (v == null || v === '') return '-';
  const n = Number(v); const a = Math.abs(n);
  if (a >= 1e9) return 'LKR ' + (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return 'LKR ' + (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return 'LKR ' + (n / 1e3).toFixed(1) + 'K';
  return 'LKR ' + Math.round(n).toLocaleString('en-US');
};
const fmtShort = (v) => {
  const n = Number(v) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(Math.round(n));
};

const CARD = { background: '#fff', border: '1px solid #E5E8ED', borderRadius: 14, boxShadow: '0 1px 2px rgba(15,31,61,.06)' };
const MEDIUM_COLORS = { TV: '#1F5BB5', RADIO: '#E85D24', PRINT: '#15814B', DIGITAL: '#6B3FB5', CINEMA: '#C2185B', OOH: '#0E7490' };
const COLORS = ['#1e3a5f', '#E85D24', '#059669', '#7c3aed', '#0ea5e9', '#d97706', '#dc2626', '#6366f1', '#14b8a6', '#f43f5e'];
const YEAR_COLORS = ['#E85D24', '#1F5BB5', '#15814B', '#6B3FB5', '#9A5B00', '#C5391F', '#0891b2', '#D9521C'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function Stat({ label, value, sub, tone, icon, accent }) {
  return (
    <div style={{ ...CARD, padding: '16px 18px', position: 'relative', overflow: 'hidden' }}>
      <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${tone[1]}, ${tone[1]}1A 70%, transparent)` }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, display: 'grid', placeItems: 'center', background: `linear-gradient(135deg, ${tone[0]}, #ffffff)`, color: tone[1], boxShadow: `inset 0 0 0 1px ${tone[1]}22` }}><Icon name={icon} size={15} /></div>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: '#93A0B5' }}>{label}</span>
      </div>
      <div style={{ fontSize: 19, fontWeight: 750, letterSpacing: '-.3px', fontFamily: "'Spline Sans Mono', monospace", color: accent || '#16243C', lineHeight: 1.15, wordBreak: 'break-word' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#93A0B5', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// Parent-company dashboard: the group's clients aggregated, with a client filter
// (All clients in the group, or one member). Mirrors the Client Dashboard.
export default function GroupDashboardPage() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [clientFilter, setClientFilter] = useState(''); // '' = all clients in group
  const [year, setYear] = useState('all'); // 'all' or a YYYY string

  useEffect(() => {
    setLoading(true);
    const params = {};
    if (clientFilter) params.clientId = clientFilter;
    if (/^\d{4}$/.test(year)) params.year = year;
    api.get(`/analytics/client-group/${groupId}/overview`, { params })
      .then(({ data }) => setData(data))
      .catch(() => setError('Failed to load group dashboard.'))
      .finally(() => setLoading(false));
  }, [groupId, clientFilter, year]);

  if (loading) return <div className="content-narrow fade-in"><OrbitLoader fullHeight label="Loading group dashboard…" /></div>;
  if (error) return <div className="content-narrow fade-in" style={{ padding: '60px 0', textAlign: 'center', color: 'var(--red-600)' }}>{error}</div>;
  if (!data) return null;

  const g = data.group || {};
  const members = data.clients || [];

  // Pivot monthly spend into one series per year (X axis = Jan–Dec).
  const yearMap = {}; const yearsSet = new Set();
  (data.byMonth || []).forEach(m => {
    const mm = String(m.month).match(/^(\d{4})-(\d{2})$/);
    if (!mm) return;
    const y = mm[1], mi = parseInt(mm[2]) - 1;
    yearsSet.add(y);
    (yearMap[mi] ||= {})[y] = (yearMap[mi][y] || 0) + (m.value || 0);
  });
  const trendYears = [...yearsSet].sort();
  const yearTrend = MONTHS.map((name, i) => {
    const row = { month: name };
    trendYears.forEach(y => { row[y] = yearMap[i]?.[y] || 0; });
    return row;
  });

  const topChannels = (data.byChannel || []).slice(0, 12);
  const mediumData = (data.byMedium || []).filter(m => m.value > 0);
  const avgMonth = data.monthsActive ? data.totalValue / data.monthsActive : 0;
  const filterName = clientFilter ? (members.find(m => String(m.id) === String(clientFilter))?.name || 'Client') : 'All companies';

  return (
    <div className="content-narrow fade-in">
      <button onClick={() => navigate(-1)} className="btn btn-ghost" style={{ marginBottom: 12, gap: 6 }}>
        <Icon name="chevL" size={16} /> Back
      </button>

      <div className="page-head">
        <div>
          <h1 className="page-title">{g.name}</h1>
          <p className="page-sub">Group Dashboard{g.agencyName ? ` · ${g.agencyName}` : ''} · {members.length} compan{members.length === 1 ? 'y' : 'ies'}</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="field" style={{ margin: 0 }}>
            <label style={{ fontSize: 11 }}>Year</label>
            <select className="select" value={year} onChange={e => setYear(e.target.value)}>
              <option value="all">All time</option>
              {(data.availableYears || []).map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0, minWidth: 200 }}>
            <label style={{ fontSize: 11 }}>Filter by company</label>
            <select className="select" value={clientFilter} onChange={e => setClientFilter(e.target.value)}>
              <option value="">All companies in group</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {clientFilter && (
        <div style={{ marginBottom: 16, fontSize: 12.5, color: 'var(--muted)' }}>
          Showing <b style={{ color: 'var(--ink)' }}>{filterName}</b> only.{' '}
          <button onClick={() => setClientFilter('')} style={{ background: 'none', border: 'none', color: 'var(--coral-700,#C44A18)', fontWeight: 600, cursor: 'pointer', padding: 0 }}>Show whole group</button>
        </div>
      )}

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))', gap: 14, marginBottom: 24 }}>
        <Stat label="Total Spend" value={fmtLKR(data.totalValue)} sub={`${data.totalEntries} schedule entries`} tone={['#FDF1EB', '#D9521C']} icon="money" accent="#D9521C" />
        <Stat label="Avg / Month" value={fmtLKR(avgMonth)} sub={`${data.monthsActive} active months`} tone={['#EEF0F3', '#3B4A63']} icon="activity" />
        <Stat label="Channels" value={String(data.channelCount || 0)} sub={`${data.brandCount || 0} brands`} tone={['#EDF3FD', '#1F5BB5']} icon="tv" accent="#1F5BB5" />
        <Stat label="Companies" value={String(members.length)} sub={clientFilter ? '1 in view' : 'in this group'} tone={['#F3ECFB', '#6B34C0']} icon="users" accent="#6B34C0" />
      </div>

      {/* Monthly spend trend - one line per year */}
      <div style={{ ...CARD, padding: 24, marginBottom: 24 }}>
        <h3 style={{ margin: '0 0 4px', fontWeight: 700, color: 'var(--ink)' }}>Monthly Spend Trend</h3>
        <p style={{ margin: '0 0 16px', fontSize: 12.5, color: 'var(--muted)' }}>Spend by calendar month, one line per year</p>
        {trendYears.length === 0 ? (
          <div style={{ height: 200, display: 'grid', placeItems: 'center', color: '#93A0B5', fontSize: 13 }}>No spend recorded</div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={yearTrend} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={{ stroke: 'var(--border)' }} />
              <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} width={48} />
              <Tooltip formatter={(v, n) => [fmtLKR(v), n]} contentStyle={{ borderRadius: 9, border: '1px solid var(--border)', fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {trendYears.map((y, i) => (
                <Line key={y} type="monotone" dataKey={y} name={y} stroke={YEAR_COLORS[i % YEAR_COLORS.length]} strokeWidth={2.4} dot={{ r: 2.5 }} activeDot={{ r: 5 }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Spend by channel + medium split */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 24, marginBottom: 24 }}>
        <div style={{ ...CARD, padding: 24 }}>
          <h3 style={{ margin: '0 0 16px', fontWeight: 700, color: 'var(--ink)' }}>Spend by Channel (Top 12)</h3>
          {topChannels.length === 0 ? (
            <div style={{ height: 200, display: 'grid', placeItems: 'center', color: '#93A0B5', fontSize: 13 }}>No channel data</div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(200, topChannels.length * 30 + 20)}>
              <BarChart data={topChannels} layout="vertical" margin={{ top: 4, right: 20, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F3" horizontal={false} />
                <XAxis type="number" tickFormatter={fmtShort} tick={{ fontSize: 11, fill: '#93A0B5' }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#16243C' }} tickLine={false} axisLine={false} width={120} />
                <Tooltip formatter={(v) => [fmtLKR(v), 'Spend']} contentStyle={{ borderRadius: 9, border: '1px solid #E5E8ED', fontSize: 12 }} />
                <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                  {topChannels.map((ch, i) => <Cell key={i} fill={MEDIUM_COLORS[ch.medium] || COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div style={{ ...CARD, padding: 24 }}>
          <h3 style={{ margin: '0 0 16px', fontWeight: 700, color: 'var(--ink)' }}>Medium Split</h3>
          {mediumData.length === 0 ? (
            <div style={{ height: 200, display: 'grid', placeItems: 'center', color: '#93A0B5', fontSize: 13 }}>No data</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={210}>
                <PieChart>
                  <Pie data={mediumData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={84} paddingAngle={2}>
                    {mediumData.map((m, i) => <Cell key={i} fill={MEDIUM_COLORS[m.name] || COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v, n) => [fmtLKR(v), n]} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                {mediumData.map((m, i) => (
                  <div key={m.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: MEDIUM_COLORS[m.name] || COLORS[i] }} />
                    <span style={{ flex: 1, fontWeight: 600 }}>{m.name}</span>
                    <span className="mono">{fmtLKR(m.value)}</span>
                    <span style={{ color: 'var(--muted)', minWidth: 42, textAlign: 'right' }}>{data.totalValue > 0 ? ((m.value / data.totalValue) * 100).toFixed(1) + '%' : ''}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Channel + brand tables */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 24 }}>
        <div style={{ ...CARD, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 14 }}>All Channels ({data.byChannel?.length || 0})</div>
          <div style={{ maxHeight: 320, overflow: 'auto' }}>
            <table className="tbl" style={{ margin: 0 }}>
              <thead><tr><th>Channel</th><th>Medium</th><th style={{ textAlign: 'right' }}>Entries</th><th style={{ textAlign: 'right' }}>Spend</th></tr></thead>
              <tbody>
                {(data.byChannel || []).map(ch => (
                  <tr key={ch.name} className={ch.id ? 'clickable' : ''} onClick={() => ch.id && navigate(`/channel-masters/${ch.id}`)}>
                    <td className="strong">{ch.name}</td>
                    <td>{ch.medium ? <span className="medium-tag" data-medium={ch.medium}>{ch.medium}</span> : '-'}</td>
                    <td style={{ textAlign: 'right' }}>{ch.count}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{fmtLKR(ch.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ ...CARD, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 14 }}>Brands ({data.byBrand?.length || 0})</div>
          <div style={{ maxHeight: 320, overflow: 'auto' }}>
            <table className="tbl" style={{ margin: 0 }}>
              <thead><tr><th>Brand</th><th style={{ textAlign: 'right' }}>Entries</th><th style={{ textAlign: 'right' }}>Spend</th></tr></thead>
              <tbody>
                {(data.byBrand || []).map(b => (
                  <tr key={b.name}>
                    <td className="strong">{b.name}</td>
                    <td style={{ textAlign: 'right' }}>{b.count}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{fmtLKR(b.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
