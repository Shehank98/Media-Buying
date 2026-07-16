import { useState, useEffect, useMemo, useRef, Fragment } from 'react';
import api from '../lib/api';
import Icon from '../components/Icon';
import OrbitLoader from '../components/OrbitLoader';
import BillingRevenueTab from './BillingRevenueTab';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  Area, AreaChart, PieChart, Pie, LabelList,
} from 'recharts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Finance figures: LKR with exactly 2 decimals + thousands separators.
const fmtLKR = (v) => 'LKR ' + (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtShort = (v) => {
  const n = Number(v) || 0; const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return Math.round(n / 1e3) + 'K';
  return String(Math.round(n));
};
// Compact LKR in millions for the headline cards (full value shown on hover / export).
const fmtLKRm = (v) => 'LKR ' + ((Number(v) || 0) / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + 'M';
const fmtPct = (v) => `${(Number(v) || 0).toFixed(2)}%`;
const fmtMonth = (ym) => { if (!ym) return ''; const [y, m] = ym.split('-'); return `${MONTHS[+m - 1]} ${y}`; };
const margin = (profit, revenue) => (revenue > 0 ? (profit / revenue) * 100 : 0);

// Commission label for the detail table: "4%" for COMMISSION, "AOR LKR X" for AOR.
const commissionLabel = (type, value) => {
  if (type === 'MIXED') return 'Mixed';
  if (!type) return 'Not set';
  return type === 'COMMISSION' ? `${Number(value)}%` : `AOR ${fmtLKR(value)}`;
};

const C = {
  profit: '#15814B',
  revenue: '#1F5BB5',
  margin: '#E85D24',
  navy: '#0A1729',
};
// Fixed categorical order for the client-contribution donut (9th+ folds to "Other").
const CAT = ['#1F5BB5', '#E85D24', '#15814B', '#7c3aed', '#C2185B', '#0891b2', '#9A5B00', '#0E7490'];
// Commission-mix bucket meta.
const MIX_META = {
  COMMISSION: { label: 'Commission %', color: '#1F5BB5' },
  AOR: { label: 'AOR (fixed fee)', color: '#9A5B00' },
  NONE: { label: 'No commission', color: '#93A0B5' },
};

export default function ProfitPage() {
  const [view, setView] = useState('billing'); // 'schedule' | 'billing' (billing shown first)
  const [year, setYear] = useState(new Date().getFullYear());
  const [availableYears, setAvailableYears] = useState([]);
  const [agencyId, setAgencyId] = useState('');
  const [clientIds, setClientIds] = useState([]);
  const [agencies, setAgencies] = useState([]);
  const [clients, setClients] = useState([]);
  const [clientMenuOpen, setClientMenuOpen] = useState(false);
  const clientMenuRef = useRef(null);

  const [summary, setSummary] = useState(null);
  const [monthly, setMonthly] = useState([]);
  const [byAgency, setByAgency] = useState([]);
  const [byClient, setByClient] = useState([]);
  const [commissionMix, setCommissionMix] = useState([]);
  const [breakdown, setBreakdown] = useState([]);
  const [expanded, setExpanded] = useState(() => new Set()); // clientIds expanded to show months
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const [sortBy, setSortBy] = useState('profit');
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => {
    api.get('/agencies').then((r) => setAgencies(r.data.agencies || r.data || [])).catch(() => {});
    api.get('/admin/clients').then((r) => setClients(Array.isArray(r.data) ? r.data : [])).catch(() => {});
  }, []);

  // Close the client menu on outside click.
  useEffect(() => {
    const onDoc = (e) => { if (clientMenuRef.current && !clientMenuRef.current.contains(e.target)) setClientMenuOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const clientOptions = useMemo(
    () => clients.filter((c) => !agencyId || String(c.agencyId) === String(agencyId)).sort((a, b) => a.name.localeCompare(b.name)),
    [clients, agencyId],
  );

  // Drop selected clients that fall outside a newly-chosen agency.
  useEffect(() => {
    if (!agencyId) return;
    setClientIds((ids) => ids.filter((id) => clients.some((c) => c.id === id && String(c.agencyId) === String(agencyId))));
  }, [agencyId, clients]);

  const params = useMemo(() => {
    const p = { year };
    if (agencyId) p.agencyId = agencyId;
    if (clientIds.length) p.clientId = clientIds.join(',');
    return p;
  }, [year, agencyId, clientIds]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.all([
      api.get('/profit/summary', { params }),
      api.get('/profit/monthly', { params }),
      api.get('/profit/by-agency', { params }),
      api.get('/profit/by-client', { params }),
      api.get('/profit/by-commission-type', { params }),
    ]).then(([s, m, a, c, mix]) => {
      if (cancelled) return;
      setSummary(s.data);
      setAvailableYears(s.data.availableYears || []);
      setMonthly(m.data.months || []);
      setByAgency(a.data.agencies || []);
      setByClient(c.data.clients || []);
      setCommissionMix(mix.data.types || []);
    }).catch(() => { if (!cancelled) setError('Failed to load profit data.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [params]);

  useEffect(() => {
    api.get('/profit/client-breakdown', { params })
      .then((r) => setBreakdown(r.data.clients || []))
      .catch(() => setBreakdown([]));
  }, [params]);

  const toggleClient = (id) => setClientIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const toggleExpand = (id) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const setSort = (key) => {
    if (sortBy === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(key); setSortDir(key === 'client' || key === 'agency' ? 'asc' : 'desc'); }
  };
  const sortArrow = (key) => (sortBy === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

  // Client-side sort of the breakdown rows (full year, so no pagination needed).
  const breakdownSorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const withMargin = breakdown.map((c) => ({ ...c, marginPct: margin(c.profit, c.revenue) }));
    return withMargin.sort((a, b) => {
      const va = a[sortBy], vb = b[sortBy];
      if (typeof va === 'string' || typeof vb === 'string') return String(va ?? '').localeCompare(String(vb ?? '')) * dir;
      return ((va ?? 0) - (vb ?? 0)) * dir;
    });
  }, [breakdown, sortBy, sortDir]);

  // Fixed Jan–Dec for the selected year; months with no schedule data show 0.
  // Adds a running cumulative-profit series (stops after the last active month)
  // and a per-month blended-margin %.
  const monthlyData = useMemo(() => {
    const byMonth = new Map(monthly.map((m) => [m.month, m]));
    const rows = MONTHS.map((label, i) => {
      const key = `${year}-${String(i + 1).padStart(2, '0')}`;
      const m = byMonth.get(key);
      return { label, month: key, revenue: m?.revenue || 0, profit: m?.profit || 0 };
    });
    let lastActive = -1;
    rows.forEach((r, i) => { if (r.revenue > 0 || r.profit > 0) lastActive = i; });
    let running = 0;
    rows.forEach((r, i) => {
      running += r.profit;
      r.cumulative = i <= lastActive ? running : null;
      r.marginPct = r.revenue > 0 ? margin(r.profit, r.revenue) : null;
    });
    return rows;
  }, [monthly, year]);

  // All clients (backend already sorts by profit desc), with margin for the list.
  const clientsRanked = useMemo(
    () => byClient.map((c) => ({ ...c, marginPct: margin(c.profit, c.revenue) })),
    [byClient],
  );

  const mixData = useMemo(
    () => commissionMix.filter((t) => t.profit > 0 || t.revenue > 0).map((t) => ({
      ...t, name: MIX_META[t.type]?.label || t.type, color: MIX_META[t.type]?.color || '#93A0B5',
    })),
    [commissionMix],
  );

  // Profit contribution donut - top 8 clients by profit, the rest folded to "Other".
  const clientDonut = useMemo(() => {
    const sorted = byClient.filter((c) => c.profit > 0).slice().sort((a, b) => b.profit - a.profit);
    const top = sorted.slice(0, 8).map((c, i) => ({ name: c.client, profit: c.profit, color: CAT[i % CAT.length] }));
    const restProfit = sorted.slice(8).reduce((s, c) => s + c.profit, 0);
    if (restProfit > 0) top.push({ name: `Other (${sorted.length - 8})`, profit: Math.round(restProfit * 100) / 100, color: '#C7D0DD' });
    return top;
  }, [byClient]);
  const totalClientProfit = clientDonut.reduce((s, c) => s + c.profit, 0);
  const clientTotals = useMemo(
    () => byClient.reduce((a, c) => ({ revenue: a.revenue + c.revenue, profit: a.profit + c.profit }), { revenue: 0, profit: 0 }),
    [byClient],
  );

  const exportExcel = async () => {
    setExporting(true);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();
      const scope = agencyId ? (agencies.find((a) => String(a.id) === String(agencyId))?.name || 'Agency') : 'All agencies';
      const sumRows = [
        ['Profit report', `${year}`],
        ['Scope', scope],
        ['Clients', clientIds.length ? `${clientIds.length} selected` : 'All'],
        [],
        ['Total Revenue', Number(summary?.revenue || 0)],
        ['Total Profit', Number(summary?.profit || 0)],
        ['Blended Commission %', Number(summary?.blendedCommissionPct || 0)],
        ['Active Clients', Number(summary?.clientCount || 0)],
        ['Avg Profit / Client', Number(summary?.avgProfitPerClient || 0)],
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sumRows), 'Summary');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
        monthlyData.filter((m) => m.revenue || m.profit).map((m) => ({ Month: fmtMonth(m.month), Revenue: m.revenue, Profit: m.profit, 'Margin %': m.marginPct ?? 0 })),
      ), 'Monthly');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
        byAgency.map((a) => ({ Agency: a.agency, Revenue: a.revenue, Profit: a.profit, 'Margin %': margin(a.profit, a.revenue) })),
      ), 'By Agency');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
        breakdown.map((c) => ({ Client: c.client, Agency: c.agency, Commission: commissionLabel(c.commissionType, c.commissionValue), Revenue: c.revenue, Profit: c.profit, 'Margin %': margin(c.profit, c.revenue) })),
      ), 'By Client');
      XLSX.writeFile(wb, `Profit_${year}${agencyId ? '_' + scope.replace(/\W+/g, '') : ''}.xlsx`);
    } catch { /* ignore */ } finally { setExporting(false); }
  };

  const tooltipStyle = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 };
  const totalMixProfit = mixData.reduce((s, t) => s + t.profit, 0);
  // YoY compares the same month window (Jan..latest data month) against last year.
  const throughMonth = summary?.comparisonThroughMonth ? MONTHS[parseInt(summary.comparisonThroughMonth, 10) - 1] : 'Dec';
  const yoyLabel = summary
    ? `vs ${summary.prevYear}${summary.comparisonThroughMonth && summary.comparisonThroughMonth !== '12' ? ` (Jan–${throughMonth})` : ''}`
    : '';
  // The data window covered, e.g. "Jan–Jun 2026" for a mid-year selection.
  const periodLabel = summary ? `Jan–${throughMonth} ${year}` : `${year}`;

  return (
    <div className="fade-in" style={{ maxWidth: 1320, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-.6px', margin: 0, color: 'var(--ink)' }}>Revenue</h1>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
            {view === 'schedule'
              ? 'Agency commission on confirmed actual spend · by schedule (flight) month'
              : 'Admin-entered billing revenue per client · by billing month'}
          </div>
        </div>
        {view === 'schedule' && (
          <button className="btn btn-ghost" onClick={exportExcel} disabled={exporting || loading} style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <Icon name="download" size={15} />{exporting ? 'Exporting…' : 'Export Excel'}
          </button>
        )}
      </div>

      {/* Tab switcher */}
      <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 18 }}>
        {[['billing', 'Revenue by billing'], ['schedule', 'Revenue by schedule value']].map(([k, lbl]) => (
          <button key={k} onClick={() => setView(k)}
            style={{ border: 'none', padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', background: view === k ? '#0A1729' : '#fff', color: view === k ? '#fff' : 'var(--ink-soft)' }}>
            {lbl}
          </button>
        ))}
      </div>

      {view === 'billing' && <BillingRevenueTab agencies={agencies} clients={clients} />}

      {view === 'schedule' && (<>
      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 18 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.4px' }}>
          Year
          <select className="select" value={year} onChange={(e) => setYear(parseInt(e.target.value))} style={{ maxWidth: 140 }}>
            {(availableYears.length ? availableYears : [year]).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.4px' }}>
          Agency
          <select className="select" value={agencyId} onChange={(e) => setAgencyId(e.target.value)} style={{ maxWidth: 200 }}>
            <option value="">All agencies</option>
            {agencies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <div ref={clientMenuRef} style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.4px' }}>Clients</span>
          <button type="button" className="btn btn-ghost" onClick={() => setClientMenuOpen((o) => !o)} style={{ minWidth: 170, justifyContent: 'space-between', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {clientIds.length ? `${clientIds.length} selected` : 'All clients'} <Icon name="chevD" size={13} />
          </button>
          {clientMenuOpen && (
            <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 30, marginTop: 4, width: 260, maxHeight: 300, overflow: 'auto', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: '0 8px 24px rgba(15,31,61,.14)', padding: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 6px 8px' }}>
                <button type="button" className="link-btn" onClick={() => setClientIds(clientOptions.map((c) => c.id))} style={{ fontSize: 12, background: 'none', border: 'none', color: 'var(--coral-700, #C44A18)', cursor: 'pointer', fontWeight: 600 }}>Select all</button>
                <button type="button" onClick={() => setClientIds([])} style={{ fontSize: 12, background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontWeight: 600 }}>Clear</button>
              </div>
              {clientOptions.length === 0 ? <div style={{ padding: 8, fontSize: 12.5, color: 'var(--muted)' }}>No clients.</div> : clientOptions.map((c) => (
                <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', fontSize: 13, cursor: 'pointer', borderRadius: 6 }}>
                  <input type="checkbox" checked={clientIds.includes(c.id)} onChange={() => toggleClient(c.id)} />
                  {c.name}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#b91c1c', marginBottom: 16 }}>{error}</div>}

      {loading && !summary ? <OrbitLoader label="Loading profit…" /> : (
        <>
          {/* KPI cards - Revenue & Profit (in millions; full value on hover / in export) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 14, marginBottom: 16 }}>
            <Card label="Total Revenue" value={fmtLKRm(summary?.revenue)} title={fmtLKR(summary?.revenue)} sub="Actual spend, ex-VAT" yoy={summary?.revenueYoYPct} yoyLabel={yoyLabel} />
            <Card label="Total Profit" value={fmtLKRm(summary?.profit)} title={fmtLKR(summary?.profit)} sub="Agency commission earned" yoy={summary?.profitYoYPct} yoyLabel={yoyLabel} accent={C.profit} />
            <Card label="Blended Commission" value={fmtPct(summary?.blendedCommissionPct)} sub="Profit ÷ revenue" accent={C.margin} />
            <Card label="Active Clients" value={String(summary?.clientCount ?? 0)} plain sub="With confirmed spend" />
            <Card label="Top Client" value={clientsRanked[0]?.client || '-'} valueSize={16} plain sub={clientsRanked[0] ? `${fmtLKRm(clientsRanked[0].profit)} profit` : 'No data'} />
          </div>

          {/* Monthly Profit (per schedule month) */}
          <Panel title="Monthly Profit" note={`${periodLabel} · profit per schedule month`}>
            {monthlyData.every((m) => !m.profit) ? <Empty /> : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={monthlyData} margin={{ top: 22, right: 12, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={{ stroke: 'var(--border)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} tickFormatter={fmtShort} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => [fmtLKR(v), 'Profit']} labelStyle={{ fontWeight: 700 }} cursor={{ fill: 'rgba(21,129,75,0.06)' }} />
                  <Bar dataKey="profit" name="Profit" fill={C.profit} radius={[4, 4, 0, 0]} maxBarSize={48}>
                    <LabelList dataKey="profit" position="top" formatter={(v) => (v > 0 ? fmtShort(v) : '')} style={{ fontSize: 10.5, fill: 'var(--ink)', fontWeight: 700 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </Panel>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 16, marginBottom: 16 }}>
            {/* Cumulative profit */}
            <Panel title="Cumulative Profit" note={`${year} · running total`} noMargin>
              {monthlyData.every((m) => m.cumulative == null) ? <Empty /> : (
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={monthlyData} margin={{ top: 10, right: 12, left: 8, bottom: 4 }}>
                    <defs>
                      <linearGradient id="cumFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={C.profit} stopOpacity={0.32} />
                        <stop offset="100%" stopColor={C.profit} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={{ stroke: 'var(--border)' }} />
                    <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} tickFormatter={fmtShort} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v) => [fmtLKR(v), 'Cumulative profit']} labelStyle={{ fontWeight: 700 }} />
                    <Area type="monotone" dataKey="cumulative" stroke={C.profit} strokeWidth={2.4} fill="url(#cumFill)" connectNulls />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </Panel>

            {/* Commission mix */}
            <Panel title="Commission Mix" note="Share of profit by commission type" noMargin>
              {mixData.length === 0 ? <Empty /> : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <ResponsiveContainer width="55%" height={220} minWidth={180}>
                    <PieChart>
                      <Pie data={mixData} dataKey="profit" nameKey="name" cx="50%" cy="50%" innerRadius={54} outerRadius={90} paddingAngle={2}>
                        {mixData.map((t) => <Cell key={t.type} fill={t.color} />)}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} formatter={(v, n, p) => [`${fmtLKR(v)} (${((p.payload.profit / (totalMixProfit || 1)) * 100).toFixed(1)}%)`, n]} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ flex: 1, minWidth: 150, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {mixData.map((t) => (
                      <div key={t.type} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 3, background: t.color, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{t.name}</div>
                          <div style={{ color: 'var(--muted)', fontSize: 11.5 }}>{t.clients} client(s) · rev {fmtShort(t.revenue)}</div>
                        </div>
                        <span className="mono" style={{ fontWeight: 700, color: 'var(--ink)' }}>{((t.profit / (totalMixProfit || 1)) * 100).toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Panel>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 16, marginBottom: 16 }}>
            {/* Profit Margin by Month */}
            <Panel title="Profit Margin by Month" note="Profit ÷ revenue per month" noMargin>
              {monthlyData.every((m) => m.marginPct == null) ? <Empty /> : (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={monthlyData} margin={{ top: 12, right: 16, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={{ stroke: 'var(--border)' }} />
                    <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} width={44} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v) => [fmtPct(v), 'Margin']} labelStyle={{ fontWeight: 700 }} />
                    <Line type="monotone" dataKey="marginPct" stroke={C.margin} strokeWidth={2.4} dot={{ r: 3, fill: C.margin, stroke: '#fff', strokeWidth: 1.5 }} activeDot={{ r: 5 }} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </Panel>

            {/* Profit Contribution by Client */}
            <Panel title="Profit Contribution by Client" note="Top 8 by profit share" noMargin>
              {clientDonut.length === 0 ? <Empty /> : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <ResponsiveContainer width="55%" height={220} minWidth={180}>
                    <PieChart>
                      <Pie data={clientDonut} dataKey="profit" nameKey="name" cx="50%" cy="50%" innerRadius={54} outerRadius={90} paddingAngle={2}>
                        {clientDonut.map((c, i) => <Cell key={i} fill={c.color} />)}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [`${fmtLKR(v)} (${((v / (totalClientProfit || 1)) * 100).toFixed(1)}%)`, n]} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ flex: 1, minWidth: 150, display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {clientDonut.map((c, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 3, background: c.color, flexShrink: 0 }} />
                        <span style={{ flex: 1, minWidth: 0, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.name}>{c.name}</span>
                        <span className="mono" style={{ fontWeight: 700, color: 'var(--ink)' }}>{((c.profit / (totalClientProfit || 1)) * 100).toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Panel>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 16, marginBottom: 16 }}>
            {/* Profit by Agency */}
            <Panel title="Profit by Agency" note={periodLabel} noMargin>
              {byAgency.length === 0 ? <Empty /> : (
                <ResponsiveContainer width="100%" height={Math.max(170, byAgency.length * 48 + 30)}>
                  <BarChart data={byAgency} layout="vertical" margin={{ top: 4, right: 60, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} tickFormatter={fmtShort} />
                    <YAxis type="category" dataKey="agency" tick={{ fontSize: 12, fill: 'var(--ink)' }} tickLine={false} axisLine={false} width={120} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmtLKR(v), n]} />
                    <Bar dataKey="profit" name="Profit" radius={[0, 4, 4, 0]} maxBarSize={30} fill={C.profit}>
                      <LabelList dataKey="profit" position="right" formatter={fmtShort} style={{ fontSize: 11, fill: 'var(--ink)', fontWeight: 700 }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Panel>

            {/* Profit by Client - every client, ranked by profit */}
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px 10px' }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Profit by Client</span>
                <span style={{ fontWeight: 500, color: 'var(--muted)', fontSize: 12 }}> · {clientsRanked.length} client(s) · {periodLabel}</span>
              </div>
              {clientsRanked.length === 0 ? <div style={{ padding: 20 }}><Empty /></div> : (
                <div style={{ maxHeight: 380, overflow: 'auto' }}>
                  <table className="tbl" style={{ margin: 0, fontSize: 12.5 }}>
                    <thead><tr><th style={{ width: 34 }}>#</th><th>Client</th><th style={{ textAlign: 'right' }}>Revenue</th><th style={{ textAlign: 'right' }}>Profit</th></tr></thead>
                    <tbody>
                      {clientsRanked.map((c, i) => (
                        <tr key={c.clientId}>
                          <td style={{ color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>{i + 1}</td>
                          <td className="strong">{c.client}<div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>{c.agency}</div></td>
                          <td className="mono" style={{ textAlign: 'right', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>{fmtLKR(c.revenue)}</td>
                          <td className="mono" style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtLKR(c.profit)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                        <td></td>
                        <td style={{ fontWeight: 700 }}>Total</td>
                        <td className="mono" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtLKR(clientTotals.revenue)}</td>
                        <td className="mono" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtLKR(clientTotals.profit)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Detailed Breakdown - per client (year totals), expand for months */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>Detailed Breakdown</span>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{breakdown.length} client(s) · {year} · expand a row for monthly figures</span>
            </div>
            <div style={{ overflow: 'auto' }}>
              <table className="tbl" style={{ margin: 0, fontSize: 12.5 }}>
                <thead>
                  <tr>
                    <th style={{ width: 30 }}></th>
                    <Th onClick={() => setSort('client')}>Client{sortArrow('client')}</Th>
                    <Th onClick={() => setSort('agency')}>Agency{sortArrow('agency')}</Th>
                    <Th onClick={() => setSort('revenue')} right>Revenue{sortArrow('revenue')}</Th>
                    <Th onClick={() => setSort('commission')} right>Commission{sortArrow('commission')}</Th>
                    <Th onClick={() => setSort('marginPct')} right>Margin{sortArrow('marginPct')}</Th>
                    <Th onClick={() => setSort('profit')} right>Profit{sortArrow('profit')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {breakdownSorted.length === 0 ? (
                    <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--muted)', padding: 24 }}>No confirmed actuals in {year}.</td></tr>
                  ) : breakdownSorted.map((c) => {
                    const open = expanded.has(c.clientId);
                    return (
                      <Fragment key={c.clientId}>
                        <tr style={{ cursor: 'pointer' }} onClick={() => toggleExpand(c.clientId)}>
                          <td style={{ textAlign: 'center' }}><Icon name={open ? 'chevD' : 'chevR'} size={14} style={{ color: 'var(--muted)' }} /></td>
                          <td className="strong">{c.client}</td>
                          <td style={{ color: 'var(--muted)' }}>{c.agency}</td>
                          <td className="mono" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtLKR(c.revenue)}</td>
                          <td className="mono" style={{ textAlign: 'right', color: c.commissionType ? 'var(--ink)' : '#9A5B00' }}>{commissionLabel(c.commissionType, c.commissionValue)}</td>
                          <td className="mono" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--muted)' }}>{fmtPct(c.marginPct)}</td>
                          <td className="mono" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{fmtLKR(c.profit)}</td>
                        </tr>
                        {open && c.months.map((m) => (
                          <tr key={m.month} style={{ background: 'var(--bg,#F5F6F8)' }}>
                            <td></td>
                            <td colSpan={2} style={{ paddingLeft: 24, color: 'var(--ink-soft)' }}>{fmtMonth(m.month)}</td>
                            <td className="mono" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--muted)' }}>{fmtLKR(m.revenue)}</td>
                            <td></td>
                            <td className="mono" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--muted)' }}>{fmtPct(margin(m.profit, m.revenue))}</td>
                            <td className="mono" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtLKR(m.profit)}</td>
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      </>)}
    </div>
  );
}

function Card({ label, value, title, sub, yoy, yoyLabel, accent, valueSize = 26, plain }) {
  const hasYoy = yoy != null;
  const up = (yoy || 0) >= 0;
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px', position: 'relative', overflow: 'hidden' }}>
      {accent && <span style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: 3, background: accent }} />}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase', color: 'var(--muted)' }}>{label}</div>
        {hasYoy && (
          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 6, color: up ? '#15814B' : '#C5391F', background: up ? '#ECF8F1' : '#FBE0DA', whiteSpace: 'nowrap' }}>
            {up ? '▲' : '▼'} {Math.abs(yoy).toFixed(1)}%
          </span>
        )}
      </div>
      <div className={plain ? '' : 'mono'} title={plain ? String(value) : undefined} style={{ fontSize: valueSize, fontWeight: 700, color: 'var(--ink)', marginTop: 8, fontVariantNumeric: 'tabular-nums', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
      {title && <div className="mono" style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{title}</div>}
      {sub && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{sub}{hasYoy && yoyLabel ? ` · ${yoyLabel}` : ''}</div>}
    </div>
  );
}

function Panel({ title, note, children, noMargin }) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, marginBottom: noMargin ? 0 : 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', marginBottom: note ? 4 : 12 }}>
        {title}
        {note && <span style={{ fontWeight: 500, color: 'var(--muted)', fontSize: 12 }}> · {note}</span>}
      </div>
      {note && <div style={{ height: 8 }} />}
      {children}
    </div>
  );
}

function Th({ children, onClick, right }) {
  return (
    <th onClick={onClick} style={{ cursor: 'pointer', userSelect: 'none', textAlign: right ? 'right' : 'left', whiteSpace: 'nowrap' }}>{children}</th>
  );
}

function Empty() {
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 160, color: 'var(--muted)', fontSize: 13.5 }}>No data for the selected filters.</div>;
}
