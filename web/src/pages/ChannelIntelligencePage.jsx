import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Icon from '../components/Icon';
import OrbitLoader from '../components/OrbitLoader';
import api from '../lib/api';
import {
  ResponsiveContainer, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ComposedChart, Bar, Cell, ReferenceLine,
} from 'recharts';

const fmtLKR = (v) => {
  if (v == null || v === '') return '-';
  const n = Number(v); const a = Math.abs(n);
  if (a >= 1e9) return 'LKR ' + (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return 'LKR ' + (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return 'LKR ' + (n / 1e3).toFixed(1) + 'K';
  return 'LKR ' + Math.round(n).toLocaleString('en-US');
};
const fmtShort = v => {
  const n = Number(v) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(Math.round(n));
};
const fmtMonth = ym => {
  if (!ym) return '-';
  const [y, m] = ym.split('-');
  return new Date(+y, +m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
};
const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
const MediumBadge = ({ medium }) => {
  const c = { TV: ['#1e3a5f', '#dbeafe'], RADIO: ['#E85D24', '#fff5f0'], PRINT: ['#059669', '#ecfdf5'], DIGITAL: ['#6B3FB5', '#efe9fb'] };
  const [fg, bg] = c[medium] || ['#6b7280', '#f3f4f6'];
  return <span style={{ background: bg, color: fg, borderRadius: 5, padding: '2px 8px', fontSize: 12, fontWeight: 700 }}>{medium}</span>;
};

const AGENCY_COLORS = ['#E85D24', '#1F5BB5', '#15814B', '#6B3FB5', '#9A5B00', '#C5391F', '#0891b2'];
const TYPE_LABELS = { BOUGHT_AIRTIME: 'Bought Airtime', SPONSORSHIP: 'Sponsorship', BONUS_COMMERCIAL: 'Bonus Commercial', OTHER: 'Other' };
const FIELD_LABELS = { cost: 'Rate', name: 'Name', type: 'Type', category: 'Category', notes: 'Notes', bonusValue: 'Bonus Value', bonusCount: 'Bonus %', bonusPct: 'Bonus %', sponsorshipDetails: 'Sponsorship', startDate: 'Start Date', endDate: 'End Date' };

const fmtFieldVal = (key, val) => {
  if (val == null || val === '') return '-';
  if (key === 'cost' || key === 'bonusValue') return fmtLKR(val);
  if (key === 'startDate' || key === 'endDate') return fmtDate(val) || String(val).slice(0, 10);
  return String(val);
};

export default function ChannelIntelligencePage() {
  const { channelMasterId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const id = parseInt(channelMasterId);

  const [summary, setSummary] = useState(null);
  const [monthly, setMonthly] = useState([]);
  const [clients, setClients] = useState([]);
  const [propGroups, setPropGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');
  const [propSearch, setPropSearch] = useState('');
  const [propClientFilter, setPropClientFilter] = useState('');
  const [expandedProps, setExpandedProps] = useState({});

  const [clientSort, setClientSort] = useState({ field: 'totalScheduleValue', dir: 'desc' });

  const [agencyMonthly, setAgencyMonthly] = useState({ agencies: [], data: [] });

  useEffect(() => {
    const load = async () => {
      try {
        const [sumRes, monthRes, clientRes, propRes, agRes] = await Promise.all([
          api.get(`/analytics/channel/${id}/summary`),
          api.get(`/analytics/channel/${id}/monthly-spend`),
          api.get(`/analytics/channel/${id}/clients`),
          api.get(`/analytics/channel/${id}/property-history`),
          api.get(`/analytics/channel/${id}/agency-monthly`),
        ]);
        setSummary(sumRes.data);
        setMonthly(Array.isArray(monthRes.data) ? monthRes.data : []);
        setClients(Array.isArray(clientRes.data) ? clientRes.data : []);
        const raw = Array.isArray(propRes.data) ? propRes.data : [];
        setPropGroups(raw);
        const exp = {};
        raw.forEach(g => { exp[g.propertyName] = true; });
        setExpandedProps(exp);
        setAgencyMonthly(agRes.data && Array.isArray(agRes.data.agencies) ? agRes.data : { agencies: [], data: [] });
      } catch {
        setError('Failed to load channel intelligence data.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  const sortedClients = useMemo(() => {
    return [...clients].sort((a, b) => {
      const v = clientSort.dir === 'asc' ? 1 : -1;
      return (a[clientSort.field] > b[clientSort.field] ? v : -v);
    });
  }, [clients, clientSort]);

  // Client spend concentration on this channel: top clients as bars + a running
  // cumulative-% line (Pareto). cumPct is over ALL clients' spend so the curve
  // and the 80% reference line read true even though we only show the top bars.
  const clientPareto = useMemo(() => {
    const ranked = [...clients].sort((a, b) => (b.totalScheduleValue || 0) - (a.totalScheduleValue || 0));
    const total = ranked.reduce((s, c) => s + (c.totalScheduleValue || 0), 0) || 1;
    let run = 0;
    return ranked.slice(0, 12).map(c => {
      run += c.totalScheduleValue || 0;
      return {
        name: c.clientName,
        value: c.totalScheduleValue || 0,
        share: Number((((c.totalScheduleValue || 0) / total) * 100).toFixed(1)),
        cumPct: Number(((run / total) * 100).toFixed(1)),
      };
    });
  }, [clients]);

  const filteredProps = useMemo(() => {
    return propGroups
      .filter(g => !propSearch || g.propertyName.toLowerCase().includes(propSearch.toLowerCase()))
      .map(g => ({
        ...g,
        entries: g.entries.filter(e => {
          if (propClientFilter && e.clientName !== propClientFilter) return false;
          if (yearFrom && e.year < parseInt(yearFrom)) return false;
          if (yearTo && e.year > parseInt(yearTo)) return false;
          return true;
        }),
      }))
      .filter(g => g.entries.length > 0);
  }, [propGroups, propSearch, propClientFilter, yearFrom, yearTo]);

  const allPropClients = useMemo(() => {
    const s = new Set();
    propGroups.forEach(g => g.entries.forEach(e => s.add(e.clientName)));
    return [...s].filter(Boolean).sort();
  }, [propGroups]);

  // Derived monthly insights
  const monthlyInsights = useMemo(() => {
    if (!monthly.length) return null;
    const vals = monthly.map(m => Number(m.scheduleValue || 0));
    const total = vals.reduce((a, b) => a + b, 0);
    const peakIdx = vals.indexOf(Math.max(...vals));
    return {
      months: monthly.length,
      total,
      avg: total / monthly.length,
      peakMonth: monthly[peakIdx]?.month,
      peakValue: vals[peakIdx] || 0,
    };
  }, [monthly]);

  const toggleProp = name => setExpandedProps(p => ({ ...p, [name]: !p[name] }));
  const toggleClientSort = field => setClientSort(s => ({
    field,
    dir: s.field === field && s.dir === 'desc' ? 'asc' : 'desc',
  }));

  if (loading) return <div className="content-narrow fade-in"><OrbitLoader fullHeight label="Loading channel intelligence…" /></div>;
  if (error) return <div className="content-narrow fade-in" style={{ padding: '60px 0', textAlign: 'center', color: 'var(--red-600)' }}>{error}</div>;

  const ch = summary?.channel || {};
  const chartData = monthly.map(m => ({
    ...m,
    label: fmtMonth(m.month),
    scheduleValue: Number(m.scheduleValue || 0),
    withVat: Number(m.scheduleValueWithVat || 0),
  }));

  // One spend card per year that has data (auto-expands as new years arrive).
  const yearCards = (summary?.byYear?.length
    ? summary.byYear
    : [
        summary?.latestYear ? { year: summary.latestYear, spend: summary.ytdSpend } : null,
        summary?.previousYear ? { year: summary.previousYear, spend: summary.lastYearSpend } : null,
      ].filter(Boolean)
  ).map(y => ({ label: `${y.year} Spend`, value: fmtLKR(y.spend), icon: 'dollar' }));

  const statCards = [
    ...yearCards,
    { label: 'YoY Growth', value: summary?.yoyGrowthPct != null ? `${summary.yoyGrowthPct >= 0 ? '+' : ''}${summary.yoyGrowthPct.toFixed(1)}%` : '-', icon: summary?.yoyGrowthPct >= 0 ? 'trending-up' : 'trending-down', color: summary?.yoyGrowthPct >= 0 ? 'var(--green-600)' : 'var(--red-600)' },
    { label: 'Active Clients', value: summary?.activeClientsCount ?? 0, icon: 'users' },
    { label: 'Total Log Entries', value: (summary?.totalEntries ?? 0).toLocaleString(), icon: 'database' },
    { label: 'Avg Monthly Spend', value: monthlyInsights ? fmtLKR(monthlyInsights.avg) : '-', icon: 'activity' },
    { label: 'Peak Month', value: monthlyInsights?.peakMonth ? fmtMonth(monthlyInsights.peakMonth) : '-', sub: monthlyInsights ? fmtLKR(monthlyInsights.peakValue) : '', icon: 'arrowUp' },
    { label: 'Media Group', value: ch.mediaGroup || '-', icon: 'grid' },
  ];

  return (
    <div className="content-narrow fade-in">
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        .ci-stat { position:relative; overflow:hidden; background:#fff; border:1px solid var(--border); border-radius:12px; box-shadow:0 1px 2px rgba(15,31,61,.06); padding:14px 16px; transition:transform .16s ease, box-shadow .16s ease; }
        .ci-stat::before { content:''; position:absolute; top:0; left:0; right:0; height:3px; background:linear-gradient(90deg,#E85D24,rgba(232,93,36,.1) 70%,transparent); }
        .ci-stat:hover { transform:translateY(-3px); box-shadow:0 10px 26px rgba(15,31,61,.10); }
        .ci-stat-top { display:flex; align-items:center; gap:8px; margin-bottom:10px; }
        .ci-stat-ico { width:30px; height:30px; border-radius:8px; display:grid; place-items:center; color:#fff; flex:none; }
        .ci-stat-label { font-size:11.5px; font-weight:600; color:var(--muted); }
        .ci-stat-val { font-size:18px; font-weight:720; letter-spacing:-.3px; color:var(--ink); line-height:1.15; font-family:'Spline Sans Mono', monospace; word-break:break-word; }
        .ci-stat-sub { font-size:11px; color:var(--muted); margin-top:3px; }
        .ci-chip { display:inline-flex; align-items:center; gap:5px; font-size:11.5px; font-weight:700; padding:3px 9px; border-radius:7px; }
        .ci-meta { font-size:11px; color:var(--muted); background:var(--bg-sunken); border-radius:5px; padding:2px 8px; font-weight:600; }
        .ci-tl-node { position:relative; padding:16px 18px 16px 40px; border-top:1px solid var(--border); }
        .ci-tl-node:first-child { border-top:none; }
        .ci-tl-node::before { content:''; position:absolute; left:18px; top:22px; width:11px; height:11px; border-radius:50%; background:var(--navy-900); border:2px solid #fff; box-shadow:0 0 0 1px var(--border); }
        .ci-tl-node::after { content:''; position:absolute; left:23px; top:33px; bottom:-16px; width:1px; background:var(--border); }
        .ci-tl-node:last-child::after { display:none; }
        .ci-change { display:flex; gap:8px; flex-wrap:wrap; align-items:center; font-size:11.5px; padding:6px 10px; background:#FFF8F4; border:1px solid #FBE3D6; border-radius:8px; margin-top:6px; }
        .ci-diff { font-family:'Spline Sans Mono', monospace; }
      `}</style>

      <button onClick={() => navigate(-1)} className="btn btn-ghost" style={{ marginBottom: 12, gap: 6 }}>
        <Icon name="chevL" size={16} /> Back
      </button>

      <div className="page-head">
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {ch.name} <MediumBadge medium={ch.medium} />
          </h1>
          <p className="page-sub">Channel Intelligence Report{ch.mediaGroup ? ` · ${ch.mediaGroup}` : ''}</p>
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 28 }}>
        {statCards.map(c => (
          <div key={c.label} className="ci-stat">
            <div className="ci-stat-top">
              <div className="ci-stat-ico" style={{ background: c.color || 'var(--navy-900)' }}>
                <Icon name={c.icon} size={15} />
              </div>
              <span className="ci-stat-label">{c.label}</span>
            </div>
            <div className="ci-stat-val" style={{ color: c.color }}>{c.value}</div>
            {c.sub && <div className="ci-stat-sub">{c.sub}</div>}
          </div>
        ))}
      </div>

      {/* Monthly Spend Trend (line chart) */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, marginBottom: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          <div>
            <h3 style={{ margin: 0, fontWeight: 700, color: 'var(--ink)' }}>Monthly Spend Trend</h3>
            <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--muted)' }}>Committed schedule value across all recorded months</p>
          </div>
          {monthlyInsights && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span className="ci-meta">{monthlyInsights.months} months</span>
              <span className="ci-meta">Total {fmtLKR(monthlyInsights.total)}</span>
            </div>
          )}
        </div>
        {chartData.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--muted)' }}>
            <Icon name="bar-chart" size={36} style={{ opacity: 0.3, marginBottom: 8 }} />
            <div style={{ fontSize: 14 }}>No data for selected period</div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={340}>
            <LineChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="ciFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0A1729" stopOpacity={0.12} />
                  <stop offset="100%" stopColor="#0A1729" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={{ stroke: 'var(--border)' }} interval="preserveStartEnd" />
              <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} width={48} />
              <Tooltip formatter={(v, n) => [fmtLKR(v), n]} labelFormatter={l => l} contentStyle={{ borderRadius: 9, border: '1px solid var(--border)', fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="scheduleValue" name="Schedule Value" stroke="#0A1729" strokeWidth={2.4} dot={{ r: 2 }} activeDot={{ r: 5 }} fill="url(#ciFill)" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Spend by Agency over time */}
      {agencyMonthly.agencies.length > 0 && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, marginBottom: 32 }}>
          <h3 style={{ margin: '0 0 4px', fontWeight: 700, color: 'var(--ink)' }}>Spend by Agency Over Time</h3>
          <p style={{ margin: '0 0 16px', fontSize: 12.5, color: 'var(--muted)' }}>How much each agency spent on this channel, month by month</p>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={agencyMonthly.data.map(r => ({ ...r, label: fmtMonth(r.month) }))} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={{ stroke: 'var(--border)' }} interval="preserveStartEnd" />
              <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} width={48} />
              <Tooltip formatter={(v, n) => [fmtLKR(v), n]} contentStyle={{ borderRadius: 9, border: '1px solid var(--border)', fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {agencyMonthly.agencies.map((a, i) => (
                <Line key={a} type="monotone" dataKey={a} stroke={AGENCY_COLORS[i % AGENCY_COLORS.length]} strokeWidth={2.2} dot={false} activeDot={{ r: 4 }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Client spend concentration (Pareto) */}
      {clientPareto.length > 0 && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, marginBottom: 32 }}>
          <h3 style={{ margin: '0 0 4px', fontWeight: 700, color: 'var(--ink)' }}>Client Spend Concentration</h3>
          <p style={{ margin: '0 0 16px', fontSize: 12.5, color: 'var(--muted)' }}>Which clients drive this channel's spend — bars are each client's spend, the line is the running share of the total (dashed = 80%)</p>
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={clientPareto} margin={{ top: 8, right: 16, bottom: 64, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={{ stroke: 'var(--border)' }} interval={0} angle={-35} textAnchor="end" height={70} />
              <YAxis yAxisId="left" tickFormatter={fmtShort} tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} width={48} />
              <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} width={40} />
              <Tooltip formatter={(v, n) => (n === 'cumPct' ? [`${v}%`, 'Cumulative share'] : [fmtLKR(v), 'Spend'])} contentStyle={{ borderRadius: 9, border: '1px solid var(--border)', fontSize: 12 }} />
              <ReferenceLine yAxisId="right" y={80} stroke="#C5391F" strokeDasharray="5 4" />
              <Bar yAxisId="left" dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={46}>
                {clientPareto.map((_, i) => <Cell key={i} fill={AGENCY_COLORS[i % AGENCY_COLORS.length]} fillOpacity={0.85} />)}
              </Bar>
              <Line yAxisId="right" type="monotone" dataKey="cumPct" name="cumPct" stroke="#0A1729" strokeWidth={2.4} dot={{ r: 2.5 }} activeDot={{ r: 5 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Client Breakdown */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, marginBottom: 32 }}>
        <h3 style={{ margin: '0 0 4px', fontWeight: 700, color: 'var(--ink)' }}>Clients on this Channel</h3>
        <p style={{ margin: '0 0 16px', fontSize: 12.5, color: 'var(--muted)' }}>Click a client to open their full dashboard</p>
        {sortedClients.length === 0 ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--muted)' }}>No client data available.</div>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr>
                {[
                  { key: 'clientName', label: 'Client' },
                  { key: 'agencyName', label: 'Agency' },
                  { key: 'totalScheduleValue', label: 'Schedule Value' },
                  { key: 'entryCount', label: 'Entries' },
                  { key: 'monthsActive', label: 'Months Active' },
                  { key: 'lastActive', label: 'Last Active' },
                ].map(col => (
                  <th key={col.key} style={{ cursor: 'pointer' }} onClick={() => toggleClientSort(col.key)}>
                    {col.label} {clientSort.field === col.key ? (clientSort.dir === 'asc' ? '↑' : '↓') : ''}
                  </th>
                ))}
              </tr></thead>
              <tbody>
                {sortedClients.map(c => (
                  <tr key={c.clientId} className="clickable" onClick={() => navigate(`/clients/${c.clientId}/dashboard`)}>
                    <td className="strong">{c.clientName}</td>
                    <td style={{ color: 'var(--muted)' }}>{c.agencyName}</td>
                    <td className="mono">{fmtLKR(c.totalScheduleValue)}</td>
                    <td style={{ textAlign: 'center' }}>{c.entryCount ?? '-'}</td>
                    <td style={{ textAlign: 'center' }}>{c.monthsActive}</td>
                    <td style={{ color: 'var(--muted)' }}>{fmtMonth(c.lastActive)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Property History Timeline */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 24 }}>
        <h3 style={{ margin: '0 0 4px', fontWeight: 700, color: 'var(--ink)' }}>Property History Timeline</h3>
        <p style={{ margin: '0 0 18px', fontSize: 12.5, color: 'var(--muted)' }}>Every negotiated property on this channel, with full deal terms and the audit trail of rate &amp; term changes over time.</p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
          <div style={{ position: 'relative', flex: '1 1 180px', maxWidth: 260 }}>
            <Icon name="search" size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }} />
            <input className="input" placeholder="Search property…" value={propSearch} onChange={e => setPropSearch(e.target.value)} style={{ paddingLeft: 30, fontSize: 13 }} />
          </div>
          <select className="select" value={propClientFilter} onChange={e => setPropClientFilter(e.target.value)} style={{ flex: '0 0 180px', fontSize: 13 }}>
            <option value="">All clients</option>
            {allPropClients.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <input type="number" className="input" placeholder="From year" value={yearFrom} onChange={e => setYearFrom(e.target.value)} style={{ flex: '0 0 100px', fontSize: 13 }} />
          <input type="number" className="input" placeholder="To year" value={yearTo} onChange={e => setYearTo(e.target.value)} style={{ flex: '0 0 100px', fontSize: 13 }} />
        </div>

        {filteredProps.length === 0 ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--muted)' }}>No property history found.</div>
        ) : (
          filteredProps.map(group => {
            const s = group.summary || {};
            const open = expandedProps[group.propertyName];
            return (
              <div key={group.propertyName} style={{ marginBottom: 16, border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                <button
                  onClick={() => toggleProp(group.propertyName)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 18px', background: 'var(--bg-sunken)', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: 'var(--ink)', fontSize: 14.5 }}>{group.propertyName}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                      <span className="ci-meta">{s.entryCount} {s.entryCount === 1 ? 'record' : 'records'}</span>
                      <span className="ci-meta">{s.clientCount} {s.clientCount === 1 ? 'client' : 'clients'}</span>
                      {s.firstYear && <span className="ci-meta">{s.firstYear === s.latestYear ? s.firstYear : `${s.firstYear}–${s.latestYear}`}</span>}
                      {s.totalChanges > 0 && <span className="ci-meta" style={{ color: 'var(--coral-600)' }}>{s.totalChanges} rate/term {s.totalChanges === 1 ? 'change' : 'changes'}</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                    <div style={{ textAlign: 'right' }}>
                      <div className="mono" style={{ fontWeight: 700, color: 'var(--ink)', fontSize: 14 }}>{fmtLKR(s.latestCost)}</div>
                      {s.minCost !== s.maxCost && <div style={{ fontSize: 11, color: 'var(--muted)' }}>range {fmtShort(s.minCost)}–{fmtShort(s.maxCost)}</div>}
                    </div>
                    <Icon name={open ? 'chevDown' : 'chevR'} size={16} style={{ color: 'var(--muted)' }} />
                  </div>
                </button>

                {open && (
                  <div>
                    {group.entries.map((e, i) => (
                      <div key={e.id || i} className="ci-tl-node">
                        {/* Top line: year, client, type, cost, change */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <span style={{ background: 'var(--navy-900)', color: '#fff', borderRadius: 6, padding: '3px 10px', fontWeight: 700, fontSize: 12 }}>{e.year}</span>
                          <span style={{ color: 'var(--ink)', fontWeight: 700, fontSize: 13.5 }}>{e.clientName || '-'}</span>
                          {e.agencyName && <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>· {e.agencyName}</span>}
                          <span style={{ flex: 1 }} />
                          <span className="mono" style={{ fontWeight: 700, color: 'var(--ink)', fontSize: 14 }}>{e.cost > 0 ? fmtLKR(e.cost) : 'Added value'}</span>
                          {e.changeFromPrev != null && (
                            <span className="ci-chip" style={{
                              color: e.changeDirection === 'up' ? 'var(--green-600)' : e.changeDirection === 'down' ? 'var(--red-600)' : 'var(--muted)',
                              background: e.changeDirection === 'up' ? 'var(--green-100)' : e.changeDirection === 'down' ? 'var(--red-50)' : 'var(--bg-sunken)',
                            }}>
                              {e.changeDirection === 'up' ? '↑' : e.changeDirection === 'down' ? '↓' : '='} {Math.abs(e.changeFromPrev).toFixed(1)}%
                            </span>
                          )}
                        </div>

                        {/* Badges row: type, category, duration, bonus */}
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                          {e.type && <span className="ci-meta">{TYPE_LABELS[e.type] || e.type}</span>}
                          {e.category && <span className="ci-meta" style={{ background: '#EDF3FD', color: '#1F5BB5' }}>{e.category}</span>}
                          {e.startDate && (
                            <span className="ci-meta" style={{ background: '#F1F8F4', color: '#15814B' }}>
                              {fmtDate(e.startDate)} → {e.endDate ? fmtDate(e.endDate) : 'Ongoing'}
                            </span>
                          )}
                          {e.bonusValue > 0 && <span className="ci-meta" style={{ background: '#F1F8F4', color: '#15814B' }}>Bonus {fmtLKR(e.bonusValue)}</span>}
                          {e.bonusCount > 0 && <span className="ci-meta">{e.bonusCount} bonus spots</span>}
                          {e.bonusPct != null && <span className="ci-meta" style={{ background: '#FFF5F0', color: 'var(--coral-600)' }}>{Number(e.bonusPct).toFixed(1)}% bonus</span>}
                        </div>

                        {/* Sponsorship details */}
                        {e.sponsorshipDetails && (
                          <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--ink-soft)' }}>
                            <span style={{ fontWeight: 600 }}>Sponsorship: </span>{e.sponsorshipDetails}
                          </div>
                        )}

                        {/* Notes */}
                        {e.notes && (
                          <div style={{ marginTop: 6, fontSize: 12.5, color: 'var(--muted)' }}>{e.notes}</div>
                        )}

                        {/* Audit-trail changes */}
                        {e.changes && e.changes.length > 0 && (
                          <div style={{ marginTop: 10 }}>
                            {e.changes.map((chg, ci) => {
                              const keys = Array.from(new Set([...Object.keys(chg.previous || {}), ...Object.keys(chg.next || {})]));
                              return (
                                <div key={ci} className="ci-change">
                                  <Icon name="history" size={13} style={{ color: 'var(--coral-600)', flexShrink: 0 }} />
                                  <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{fmtDate(chg.changedAt)}</span>
                                  <span style={{ color: 'var(--muted)' }}>by {chg.changedBy}</span>
                                  {keys.map(k => (
                                    <span key={k} className="ci-diff" style={{ color: 'var(--ink-soft)' }}>
                                      <b style={{ fontWeight: 600 }}>{FIELD_LABELS[k] || k}:</b> {fmtFieldVal(k, chg.previous?.[k])} → <b style={{ fontWeight: 700, color: 'var(--ink)' }}>{fmtFieldVal(k, chg.next?.[k])}</b>
                                    </span>
                                  ))}
                                  {chg.note && <span style={{ color: 'var(--muted)', fontStyle: 'italic' }}>“{chg.note}”</span>}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Footer: creator + created date */}
                        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--muted-2, var(--muted))' }}>
                          Added by {e.creatorName || 'Unknown'}{e.createdAt ? ` · ${fmtDate(e.createdAt)}` : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
