import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
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
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MediumBadge = ({ medium }) => {
  const c = { TV: ['#1e3a5f', '#dbeafe'], RADIO: ['#E85D24', '#fff5f0'], PRINT: ['#059669', '#ecfdf5'], DIGITAL: ['#6B3FB5', '#efe9fb'], CINEMA: ['#C2185B', '#fce7f0'], OOH: ['#0E7490', '#e0f4f8'] };
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
  const [searchParams] = useSearchParams();
  const urlClientId = searchParams.get('clientId');
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  // When arriving from a client context (?clientId=), scope every number to that
  // client. SUPER_ADMIN can toggle back to overall (all-clients) numbers.
  const [scopeOverall, setScopeOverall] = useState(false);
  const [showRcVersions, setShowRcVersions] = useState(false);
  const [year, setYear] = useState(String(new Date().getFullYear())); // '' = All
  const scopedClientId = (urlClientId && !scopeOverall) ? urlClientId : null;
  const scopeParams = {
    ...(scopedClientId ? { clientId: scopedClientId } : {}),
    ...(year ? { year } : {}),
  };

  const [summary, setSummary] = useState(null);
  const [monthly, setMonthly] = useState({ years: [], data: [] });
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

  // Monthly Spend Trend drill-down: which (year, month) point the user clicked
  const [monthDetail, setMonthDetail] = useState(null); // { year, month, total, clients } | null
  const [monthDetailLoading, setMonthDetailLoading] = useState(false);
  const [monthDetailError, setMonthDetailError] = useState('');
  const [expandedDetailClients, setExpandedDetailClients] = useState({});

  useEffect(() => {
    const load = async () => {
      try {
        const [sumRes, monthRes, clientRes, propRes, agRes] = await Promise.all([
          api.get(`/analytics/channel/${id}/summary`, { params: scopeParams }),
          api.get(`/analytics/channel/${id}/monthly-spend`, { params: scopeParams }),
          api.get(`/analytics/channel/${id}/clients`, { params: scopeParams }),
          api.get(`/analytics/channel/${id}/property-history`, { params: scopeParams }),
          api.get(`/analytics/channel/${id}/agency-monthly`, { params: scopeParams }),
        ]);
        setSummary(sumRes.data);
        setMonthly(monthRes.data && Array.isArray(monthRes.data.data) ? monthRes.data : { years: [], data: [] });
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
    setLoading(true);
    load();
  }, [id, scopedClientId, year]);

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

  // Derived monthly insights - one line per year, so totals/peak are computed
  // across every (year, month) cell rather than a single flat series.
  const monthlyInsights = useMemo(() => {
    const years = monthly.years || [];
    const rows = monthly.data || [];
    if (!years.length) return null;
    let total = 0, count = 0, peak = null;
    for (const row of rows) {
      for (const y of years) {
        const v = Number(row[y] || 0);
        if (v <= 0) continue;
        total += v;
        count++;
        if (!peak || v > peak.value) peak = { year: y, month: row.label, value: v };
      }
    }
    return {
      months: count,
      total,
      avg: count ? total / count : 0,
      peakMonth: peak ? `${peak.month} ${peak.year}` : null,
      peakValue: peak?.value || 0,
    };
  }, [monthly]);

  const toggleProp = name => setExpandedProps(p => ({ ...p, [name]: !p[name] }));
  const toggleClientSort = field => setClientSort(s => ({
    field,
    dir: s.field === field && s.dir === 'desc' ? 'asc' : 'desc',
  }));

  const openMonthDetail = async (monthNum, year) => {
    setMonthDetailLoading(true);
    setMonthDetailError('');
    setExpandedDetailClients({});
    setMonthDetail({ year, month: monthNum, total: 0, clients: [], label: `${MONTH_NAMES[monthNum - 1]} ${year}` });
    try {
      const res = await api.get(`/analytics/channel/${id}/month-detail`, { params: { year, month: monthNum, ...scopeParams } });
      setMonthDetail({ ...res.data, label: `${MONTH_NAMES[monthNum - 1]} ${year}` });
    } catch {
      setMonthDetailError('Failed to load schedule logs for this month.');
    } finally {
      setMonthDetailLoading(false);
    }
  };
  const toggleDetailClient = clientId => setExpandedDetailClients(p => ({ ...p, [clientId]: !p[clientId] }));

  // Export the month drill-down (this month's schedule logs on this channel) to
  // Excel: a By Client summary sheet + a per-log Detail sheet.
  const exportMonthDetail = async () => {
    if (!monthDetail || !monthDetail.clients?.length) return;
    const XLSX = await import('xlsx');
    const channelName = summary?.channel?.name || 'Channel';
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Channel', channelName],
      ['Month', monthDetail.label],
      ['Clients', monthDetail.clients.length],
      ['Total Schedule Value', Number(monthDetail.total) || 0],
      [],
      ['Client', 'Agency', 'Schedule Value'],
      ...monthDetail.clients.map(c => [c.clientName, c.agencyName || '', Number(c.value) || 0]),
    ]), 'By Client');
    const detail = [['Client', 'Agency', 'RO Number', 'Brand', 'Schedule Value', 'With VAT']];
    monthDetail.clients.forEach(c => (c.logs || []).forEach(l => {
      detail.push([c.clientName, c.agencyName || '', l.roNumber || '', l.brandName || '', Number(l.scheduleValue) || 0, Number(l.scheduleValueWithVat) || 0]);
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detail), 'Detail');
    const safe = (s) => String(s).replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    XLSX.writeFile(wb, `channel-${safe(channelName)}-${safe(monthDetail.label)}.xlsx`);
  };

  if (loading) return <div className="content-narrow fade-in"><OrbitLoader fullHeight label="Loading channel intelligence…" /></div>;
  if (error) return <div className="content-narrow fade-in" style={{ padding: '60px 0', textAlign: 'center', color: 'var(--red-600)' }}>{error}</div>;

  const ch = summary?.channel || {};

  // Fetch the rate card PDF (auth-protected) as a blob, then view it in a new tab
  // or download it.
  const openRateCard = async (download, driveId) => {
    try {
      const params = {};
      if (download) params.download = 1;
      if (driveId) params.driveId = driveId;
      const res = await api.get(`/analytics/channel/${id}/rate-card`, {
        params,
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data); // blob carries the right MIME
      if (download) {
        const a = document.createElement('a');
        a.href = url;
        a.download = summary?.rateCard?.fileName || 'rate-card';
        document.body.appendChild(a); a.click(); a.remove();
      } else {
        window.open(url, '_blank');
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      alert('Could not load the rate card.');
    }
  };
  const chartData = monthly.data || [];
  const chartYears = monthly.years || [];

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
    { label: 'Peak Month', value: monthlyInsights?.peakMonth || '-', sub: monthlyInsights ? fmtLKR(monthlyInsights.peakValue) : '', icon: 'arrowUp' },
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
          <p className="page-sub">
            Channel Intelligence Report{ch.mediaGroup ? ` · ${ch.mediaGroup}` : ''}
            {summary?.scopedClient && <> · <b style={{ color: 'var(--ink)' }}>{summary.scopedClient.name}</b> only</>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="field" style={{ margin: 0 }}>
            <label style={{ fontSize: 11 }}>Year</label>
            <select className="select" value={year} onChange={e => setYear(e.target.value)}>
              <option value="">All time</option>
              {(summary?.availableYears || [new Date().getFullYear()]).map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          {/* Rate card (latest) - view / download, + version history */}
          {summary?.rateCard ? (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => openRateCard(false)} title={summary.rateCard.fileName}>
                <Icon name="file" size={15} /> Rate card{summary.rateCard.versions?.length > 1 ? ` (v${summary.rateCard.versions[0].version})` : ''}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => openRateCard(true)}>
                <Icon name="download" size={15} /> Download
              </button>
              {summary.rateCard.versions?.length > 1 && (
                <button className="btn btn-ghost btn-sm" onClick={() => setShowRcVersions(v => !v)}>
                  <Icon name="clock" size={14} /> {summary.rateCard.versions.length} versions
                </button>
              )}
            </>
          ) : (
            <span className="ci-meta" title={isSuperAdmin ? 'Upload it in Admin → Channels' : ''}>No rate card</span>
          )}
        </div>
      </div>

      {/* Rate card version history (newest first; the first is the current one) */}
      {showRcVersions && summary?.rateCard?.versions?.length > 0 && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, background: 'var(--card)' }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink)', marginBottom: 6 }}>Rate card versions</div>
          {summary.rateCard.versions.map((v, i) => (
            <div key={v.driveId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: i === 0 ? '#15814B' : 'var(--muted)', minWidth: 62 }}>
                v{v.version}{i === 0 ? ' · latest' : ''}
              </span>
              <span style={{ fontSize: 12, color: 'var(--muted)', flex: 1, minWidth: 120 }}>
                {v.fileName}{v.uploadedAt ? ` · ${new Date(v.uploadedAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
              </span>
              <button className="btn btn-ghost btn-sm" onClick={() => openRateCard(false, v.driveId)}><Icon name="file" size={13} /> View</button>
              <button className="btn btn-ghost btn-sm" onClick={() => openRateCard(true, v.driveId)}><Icon name="download" size={13} /></button>
            </div>
          ))}
        </div>
      )}

      {/* Client-scoped view banner + SUPER_ADMIN overall toggle */}
      {urlClientId && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', background: scopeOverall ? 'var(--bg-sunken)' : '#EDF3FD', border: '1px solid ' + (scopeOverall ? 'var(--border)' : '#d4e2f7'), borderRadius: 10, padding: '9px 14px', marginBottom: 16, fontSize: 12.5, color: 'var(--ink-soft)' }}>
          <Icon name="alert" size={14} style={{ color: '#1F5BB5' }} />
          <span style={{ flex: 1, minWidth: 180 }}>
            {scopeOverall
              ? <>Showing <b>overall</b> numbers for this channel (all clients).</>
              : <>Showing <b>{summary?.scopedClient?.name || 'this client'}</b>&rsquo;s spend on this channel only.</>}
          </span>
          {isSuperAdmin && (
            <button className="btn btn-ghost btn-sm" onClick={() => setScopeOverall(v => !v)}>
              {scopeOverall ? `Show ${summary?.scopedClient?.name || 'client'} only` : 'Show overall (all clients)'}
            </button>
          )}
        </div>
      )}

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
            <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--muted)' }}>One line per year, Jan-Dec. Click a dot to see the schedule logs behind that month</p>
          </div>
          {monthlyInsights && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span className="ci-meta">{monthlyInsights.months} active months</span>
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
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={{ stroke: 'var(--border)' }} />
              <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} width={48} />
              <Tooltip formatter={(v, n) => [fmtLKR(v), n]} labelFormatter={l => l} contentStyle={{ borderRadius: 9, border: '1px solid var(--border)', fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {chartYears.map((y, i) => {
                const color = AGENCY_COLORS[i % AGENCY_COLORS.length];
                return (
                  <Line
                    key={y}
                    type="monotone"
                    dataKey={String(y)}
                    name={String(y)}
                    stroke={color}
                    strokeWidth={2.4}
                    dot={(dotProps) => {
                      const { cx, cy, payload, index } = dotProps;
                      if (payload[y] == null) return null;
                      return (
                        <circle
                          key={`${y}-${index}`}
                          cx={cx} cy={cy} r={3.5}
                          fill={color} stroke="#fff" strokeWidth={1.5}
                          style={{ cursor: payload[y] > 0 ? 'pointer' : 'default' }}
                          onClick={() => payload[y] > 0 && openMonthDetail(payload.monthNum, y)}
                        />
                      );
                    }}
                    activeDot={{ r: 6, style: { cursor: 'pointer' }, onClick: (_, p) => p?.payload?.[y] > 0 && openMonthDetail(p.payload.monthNum, y) }}
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Month Detail Drill-down Modal */}
      {monthDetail && (
        <div className="modal-scrim show" onClick={e => { if (e.target === e.currentTarget) setMonthDetail(null); }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 640, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
            <div className="modal-head">
              <h2>{monthDetail.label}: Schedule Logs</h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {monthDetail.clients.length > 0 && (
                  <button className="btn btn-ghost btn-sm" onClick={exportMonthDetail} title="Export to Excel" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Icon name="download" size={15} /> Export
                  </button>
                )}
                <button className="act-btn" onClick={() => setMonthDetail(null)}><Icon name="x" size={18} /></button>
              </div>
            </div>
            <div className="modal-body" style={{ overflow: 'auto', flex: 1 }}>
              {monthDetailLoading ? (
                <OrbitLoader label="Loading schedule logs…" />
              ) : monthDetailError ? (
                <div style={{ color: 'var(--red-600)', fontSize: 13 }}>{monthDetailError}</div>
              ) : monthDetail.clients.length === 0 ? (
                <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>No schedule logs for this month.</div>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
                    <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{monthDetail.clients.length} client{monthDetail.clients.length === 1 ? '' : 's'}</span>
                    <span style={{ fontSize: 16, fontWeight: 750, fontFamily: "'Spline Sans Mono', monospace" }}>{fmtLKR(monthDetail.total)}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {monthDetail.clients.map(c => {
                      const expanded = !!expandedDetailClients[c.clientId];
                      return (
                        <div key={c.clientId} style={{ border: '1px solid var(--border)', borderRadius: 9, overflow: 'hidden' }}>
                          <div
                            onClick={() => toggleDetailClient(c.clientId)}
                            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', cursor: 'pointer', background: '#F8F9FB' }}
                          >
                            <Icon name={expanded ? 'chevD' : 'chevR'} size={13} style={{ color: 'var(--muted)', flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{c.clientName}</div>
                              {c.agencyName && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{c.agencyName}</div>}
                            </div>
                            <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "'Spline Sans Mono', monospace" }}>{fmtLKR(c.value)}</span>
                          </div>
                          {expanded && (
                            <table className="tbl" style={{ margin: 0 }}>
                              <thead>
                                <tr>
                                  <th>RO Number</th>
                                  <th>Brand</th>
                                  <th style={{ textAlign: 'right' }}>Schedule Value</th>
                                  <th style={{ textAlign: 'right' }}>With VAT</th>
                                </tr>
                              </thead>
                              <tbody>
                                {c.logs.map(l => (
                                  <tr key={l.id}>
                                    <td style={{ fontSize: 12.5 }}>{l.roNumber || '-'}</td>
                                    <td style={{ fontSize: 12.5 }}>{l.brandName || '-'}</td>
                                    <td className="mono" style={{ textAlign: 'right', fontSize: 12.5 }}>{fmtLKR(l.scheduleValue)}</td>
                                    <td className="mono" style={{ textAlign: 'right', fontSize: 12.5 }}>{fmtLKR(l.scheduleValueWithVat)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

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
          <p style={{ margin: '0 0 16px', fontSize: 12.5, color: 'var(--muted)' }}>Which clients drive this channel's spend. Bars are each client's spend, the line is the running share of the total (dashed = 80%)</p>
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
                  { key: 'meName', label: 'ME / Contact' },
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
                    <td>
                      {c.meName ? (
                        <div>
                          <div style={{ fontSize: 12.5 }}>{c.meName}</div>
                          {(c.meEmail || c.meMobile) && (
                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{[c.meEmail, c.meMobile].filter(Boolean).join(' · ')}</div>
                          )}
                        </div>
                      ) : <span style={{ color: 'var(--muted-2, #9aa3b2)' }}>-</span>}
                    </td>
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
