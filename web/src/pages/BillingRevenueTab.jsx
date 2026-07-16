import { useState, useEffect, useMemo, useRef, Fragment } from 'react';
import api from '../lib/api';
import Icon from '../components/Icon';
import OrbitLoader from '../components/OrbitLoader';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  Area, AreaChart, LabelList,
} from 'recharts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtLKR = (v) => 'LKR ' + (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtLKRm = (v) => 'LKR ' + ((Number(v) || 0) / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + 'M';
const fmtShort = (v) => {
  const n = Number(v) || 0; const a = Math.abs(n); const s = n < 0 ? '-' : '';
  if (a >= 1e9) return s + (a / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return s + (a / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return s + Math.round(a / 1e3) + 'K';
  return String(Math.round(n));
};
const fmtMonth = (ym) => { if (!ym) return ''; const [y, m] = ym.split('-'); return `${MONTHS[+m - 1]} ${y}`; };
const C = { revenue: '#1F5BB5', navy: '#0A1729' };

export default function BillingRevenueTab({ agencies = [], clients = [] }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [availableYears, setAvailableYears] = useState([]);
  const [agencyId, setAgencyId] = useState('');
  const [clientIds, setClientIds] = useState([]);
  const [clientMenuOpen, setClientMenuOpen] = useState(false);
  const clientMenuRef = useRef(null);

  const [summary, setSummary] = useState(null);
  const [monthly, setMonthly] = useState([]);
  const [byAgency, setByAgency] = useState([]);
  const [byClient, setByClient] = useState([]);
  const [breakdown, setBreakdown] = useState([]);
  const [expanded, setExpanded] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const onDoc = (e) => { if (clientMenuRef.current && !clientMenuRef.current.contains(e.target)) setClientMenuOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const clientOptions = useMemo(
    () => clients.filter((c) => !agencyId || String(c.agencyId) === String(agencyId)).sort((a, b) => a.name.localeCompare(b.name)),
    [clients, agencyId],
  );
  useEffect(() => {
    setClientIds((ids) => ids.filter((id) => clients.some((c) => c.id === id && (!agencyId || String(c.agencyId) === String(agencyId)))));
  }, [agencyId, clients]);

  const toggleClient = (id) => setClientIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      const params = { year };
      if (agencyId) params.agencyId = agencyId;
      if (clientIds.length) params.clientId = clientIds.join(',');
      try {
        const [s, m, a, c, b] = await Promise.all([
          api.get('/profit/billing/summary', { params }),
          api.get('/profit/billing/monthly', { params }),
          api.get('/profit/billing/by-agency', { params }),
          api.get('/profit/billing/by-client', { params }),
          api.get('/profit/billing/client-breakdown', { params }),
        ]);
        if (cancelled) return;
        setSummary(s.data);
        setAvailableYears(s.data.availableYears || []);
        setMonthly(m.data.months || []);
        setByAgency(a.data.agencies || []);
        setByClient(c.data.clients || []);
        setBreakdown(b.data.clients || []);
      } catch {
        if (!cancelled) setError('Failed to load billing revenue.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [year, agencyId, clientIds]);

  // Monthly series padded to a fixed Jan–Dec axis.
  const monthlyData = useMemo(() => {
    const byYm = new Map(monthly.map((r) => [r.month, r.revenue]));
    return MONTHS.map((_, i) => {
      const ym = `${year}-${String(i + 1).padStart(2, '0')}`;
      return { month: ym, label: MONTHS[i], revenue: Number(byYm.get(ym) || 0) };
    });
  }, [monthly, year]);

  const cumulative = useMemo(() => {
    let run = 0;
    const lastActive = monthlyData.reduce((acc, m, i) => (m.revenue ? i : acc), -1);
    return monthlyData.map((m, i) => {
      run += m.revenue;
      return { ...m, cumulative: i <= lastActive ? run : null };
    });
  }, [monthlyData]);

  const toggleExpand = (id) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const exportExcel = async () => {
    setExporting(true);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();
      const scope = agencies.find((a) => String(a.id) === String(agencyId))?.name || 'All agencies';
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['Revenue by Billing', `${year}`],
        ['Scope', scope],
        ['Total Billing Revenue', Number(summary?.revenue || 0)],
        ['Active Clients', Number(summary?.clientCount || 0)],
        ['Avg Revenue / Client', Number(summary?.avgRevenuePerClient || 0)],
      ]), 'Summary');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
        monthlyData.filter((m) => m.revenue).map((m) => ({ Month: fmtMonth(m.month), 'Billing Revenue': m.revenue })),
      ), 'Monthly');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
        byAgency.map((a) => ({ Agency: a.agency, 'Billing Revenue': a.revenue, Clients: a.clients })),
      ), 'By Agency');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
        byClient.map((c) => ({ Client: c.client, Agency: c.agency, 'Billing Revenue': c.revenue })),
      ), 'By Client');
      XLSX.writeFile(wb, `Billing_Revenue_${year}${agencyId ? '_' + scope.replace(/\W+/g, '') : ''}.xlsx`);
    } finally {
      setExporting(false);
    }
  };

  const throughMonth = summary?.comparisonThroughMonth && summary.comparisonThroughMonth !== '12'
    ? MONTHS[parseInt(summary.comparisonThroughMonth) - 1] : null;
  const yoyLabel = summary ? `vs ${summary.prevYear}${throughMonth ? ` (Jan–${throughMonth})` : ''}` : '';
  const periodLabel = throughMonth ? `Jan–${throughMonth} ${year}` : `${year}`;
  const topClient = byClient[0];

  return (
    <div>
      {/* Filters + export */}
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
          <button className="select" onClick={() => setClientMenuOpen((o) => !o)} style={{ minWidth: 190, textAlign: 'left', cursor: 'pointer' }}>
            {clientIds.length ? `${clientIds.length} selected` : 'All clients'}
          </button>
          {clientMenuOpen && (
            <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 20, background: '#fff', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 10px 30px rgba(15,31,61,.12)', marginTop: 4, maxHeight: 280, overflowY: 'auto', minWidth: 240, padding: 6 }}>
              {clientIds.length > 0 && (
                <button className="btn btn-ghost btn-sm" onClick={() => setClientIds([])} style={{ width: '100%', marginBottom: 4 }}>Clear selection</button>
              )}
              {clientOptions.length === 0 && <div style={{ padding: 10, fontSize: 12.5, color: 'var(--muted)' }}>No clients</div>}
              {clientOptions.map((c) => (
                <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', fontSize: 13, cursor: 'pointer', borderRadius: 6 }}>
                  <input type="checkbox" checked={clientIds.includes(c.id)} onChange={() => toggleClient(c.id)} />
                  {c.name}
                </label>
              ))}
            </div>
          )}
        </div>
        <button className="btn btn-ghost" onClick={exportExcel} disabled={exporting || loading} style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <Icon name="download" size={15} />{exporting ? 'Exporting…' : 'Export Excel'}
        </button>
      </div>

      {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#b91c1c', marginBottom: 16 }}>{error}</div>}

      {loading && !summary ? <OrbitLoader label="Loading billing revenue…" /> : (
        <>
          {/* KPI cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 14, marginBottom: 16 }}>
            <Card label="Total Billing Revenue" value={fmtLKRm(summary?.revenue)} title={fmtLKR(summary?.revenue)} sub="Admin-entered client billing" yoy={summary?.revenueYoYPct} yoyLabel={yoyLabel} accent={C.revenue} />
            <Card label="Active Clients" value={String(summary?.clientCount ?? 0)} plain sub="With billing entered" />
            <Card label="Avg Revenue / Client" value={fmtLKRm(summary?.avgRevenuePerClient)} title={fmtLKR(summary?.avgRevenuePerClient)} sub="Mean across clients" />
            <Card label="Top Client" value={topClient?.client || '-'} valueSize={16} plain sub={topClient ? `${fmtLKRm(topClient.revenue)} billed` : 'No data'} />
          </div>

          {/* Monthly Billing */}
          <Panel title="Monthly Billing Revenue" note={`${periodLabel} · billing per month`}>
            {monthlyData.every((m) => !m.revenue) ? <Empty /> : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={monthlyData} margin={{ top: 20, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EEF0F3" />
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#6B7790' }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11, fill: '#6B7790' }} axisLine={false} tickLine={false} width={54} />
                  <Tooltip formatter={(v) => fmtLKR(v)} labelFormatter={(l) => `${l} ${year}`} />
                  <Bar dataKey="revenue" fill={C.revenue} radius={[5, 5, 0, 0]} maxBarSize={44}>
                    <LabelList dataKey="revenue" position="top" formatter={(v) => (v ? fmtShort(v) : '')} style={{ fontSize: 10, fill: '#6B7790' }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </Panel>

          {/* Cumulative Billing */}
          <Panel title="Cumulative Billing Revenue" note={`${year} · running total`}>
            {cumulative.every((m) => !m.revenue) ? <Empty /> : (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={cumulative} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="billCum" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.revenue} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={C.revenue} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EEF0F3" />
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#6B7790' }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11, fill: '#6B7790' }} axisLine={false} tickLine={false} width={54} />
                  <Tooltip formatter={(v) => fmtLKR(v)} labelFormatter={(l) => `${l} ${year}`} />
                  <Area type="monotone" dataKey="cumulative" stroke={C.revenue} strokeWidth={2} fill="url(#billCum)" connectNulls={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </Panel>

          {/* Billing by Agency */}
          <Panel title="Billing Revenue by Agency" note={periodLabel}>
            {byAgency.length === 0 ? <Empty /> : (
              <ResponsiveContainer width="100%" height={Math.max(160, byAgency.length * 46 + 20)}>
                <BarChart data={byAgency} layout="vertical" margin={{ top: 4, right: 60, left: 10, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#EEF0F3" />
                  <XAxis type="number" tickFormatter={fmtShort} tick={{ fontSize: 11, fill: '#6B7790' }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="agency" width={120} tick={{ fontSize: 12, fill: '#16243C' }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v) => fmtLKR(v)} />
                  <Bar dataKey="revenue" fill={C.revenue} radius={[0, 5, 5, 0]} maxBarSize={30}>
                    <LabelList dataKey="revenue" position="right" formatter={(v) => fmtShort(v)} style={{ fontSize: 11, fill: '#6B7790' }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </Panel>

          {/* Billing by Client */}
          <Panel title="Billing Revenue by Client" note={`${periodLabel} · every client, ranked`}>
            {byClient.length === 0 ? <Empty /> : (
              <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                <table className="tbl">
                  <thead>
                    <tr><th style={{ width: 44 }}>#</th><th>Client</th><th>Agency</th><th style={{ textAlign: 'right' }}>Billing Revenue</th></tr>
                  </thead>
                  <tbody>
                    {byClient.map((c, i) => (
                      <tr key={c.clientId}>
                        <td style={{ color: 'var(--muted)' }}>{i + 1}</td>
                        <td className="strong">{c.client}</td>
                        <td style={{ color: 'var(--muted)', fontSize: 12.5 }}>{c.agency}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{fmtLKR(c.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          {/* Detailed breakdown - expandable per client */}
          <Panel title="Detailed Breakdown" note="one row per client · expand for month-by-month">
            {breakdown.length === 0 ? <Empty /> : (
              <div style={{ overflowX: 'auto' }}>
                <table className="tbl">
                  <thead>
                    <tr><th style={{ width: 32 }} /><th>Client</th><th>Agency</th><th style={{ textAlign: 'right' }}>Billing Revenue</th></tr>
                  </thead>
                  <tbody>
                    {breakdown.map((c) => (
                      <Fragment key={c.clientId}>
                        <tr onClick={() => toggleExpand(c.clientId)} style={{ cursor: 'pointer' }}>
                          <td><Icon name={expanded.has(c.clientId) ? 'chevD' : 'chevR'} size={14} /></td>
                          <td className="strong">{c.client}</td>
                          <td style={{ color: 'var(--muted)', fontSize: 12.5 }}>{c.agency}</td>
                          <td className="mono" style={{ textAlign: 'right' }}>{fmtLKR(c.revenue)}</td>
                        </tr>
                        {expanded.has(c.clientId) && c.months.map((m) => (
                          <tr key={m.month} style={{ background: 'var(--bg-sunken)' }}>
                            <td />
                            <td colSpan={2} style={{ paddingLeft: 22, color: 'var(--ink-soft)' }}>{fmtMonth(m.month)}</td>
                            <td className="mono" style={{ textAlign: 'right' }}>{fmtLKR(m.revenue)}</td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

function Card({ label, value, title, sub, yoy, yoyLabel, accent, plain, valueSize }) {
  const hasYoy = yoy != null;
  const up = hasYoy && yoy >= 0;
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 18, borderTop: accent ? `3px solid ${accent}` : undefined }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.4px' }}>{label}</div>
      <div className={plain ? '' : 'mono'} style={{ fontSize: valueSize || 24, fontWeight: 750, color: 'var(--ink)', marginTop: 6, letterSpacing: '-.4px' }} title={title || undefined}>{value}</div>
      {hasYoy && (
        <div style={{ fontSize: 12, fontWeight: 700, marginTop: 6, color: up ? '#15814B' : '#C5391F' }}>
          {up ? '▲' : '▼'} {Math.abs(yoy).toFixed(2)}%
        </div>
      )}
      {sub && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{sub}{hasYoy && yoyLabel ? ` · ${yoyLabel}` : ''}</div>}
    </div>
  );
}

function Panel({ title, note, children }) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', marginBottom: note ? 4 : 12 }}>
        {title}
        {note && <span style={{ fontWeight: 500, color: 'var(--muted)', fontSize: 12 }}> · {note}</span>}
      </div>
      {note && <div style={{ height: 8 }} />}
      {children}
    </div>
  );
}

function Empty() {
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 160, color: 'var(--muted)', fontSize: 13.5 }}>No data for the selected filters.</div>;
}
