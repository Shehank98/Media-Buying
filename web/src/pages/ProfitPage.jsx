import { useState, useEffect, useMemo, useRef } from 'react';
import api from '../lib/api';
import Icon from '../components/Icon';
import OrbitLoader from '../components/OrbitLoader';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Finance figures: LKR with exactly 2 decimals + thousands separators.
const fmtLKR = (v) => 'LKR ' + (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (v) => `${(Number(v) || 0).toFixed(2)}%`;
const fmtMonth = (ym) => { if (!ym) return ''; const [y, m] = ym.split('-'); return `${MONTHS[+m - 1]} ${y}`; };

// Commission label for the detail table: "4%" for COMMISSION, "AOR LKR X" for AOR.
const commissionLabel = (type, value) => {
  if (!type) return '-';
  return type === 'COMMISSION' ? `${Number(value)}%` : `AOR ${fmtLKR(value)}`;
};

const AGENCY_COLOR = '#1F5BB5';

export default function ProfitPage() {
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
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [page, setPage] = useState(1);
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
    ]).then(([s, m, a, c]) => {
      if (cancelled) return;
      setSummary(s.data);
      setAvailableYears(s.data.availableYears || []);
      setMonthly(m.data.months || []);
      setByAgency(a.data.agencies || []);
      setByClient(c.data.clients || []);
    }).catch(() => { if (!cancelled) setError('Failed to load profit data.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [params]);

  useEffect(() => { setPage(1); }, [params, sortBy, sortDir]);

  useEffect(() => {
    api.get('/profit/details', { params: { ...params, page, pageSize: 50, sortBy, sortDir } })
      .then((r) => setDetails(r.data))
      .catch(() => setDetails(null));
  }, [params, page, sortBy, sortDir]);

  const toggleClient = (id) => setClientIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const setSort = (key) => {
    if (sortBy === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(key); setSortDir('desc'); }
  };
  const sortArrow = (key) => (sortBy === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

  // Fixed Jan–Dec for the selected year; months with no schedule data show 0.
  const monthlyData = useMemo(() => {
    const byMonth = new Map(monthly.map((m) => [m.month, m]));
    return MONTHS.map((label, i) => {
      const key = `${year}-${String(i + 1).padStart(2, '0')}`;
      const m = byMonth.get(key);
      return { label, month: key, revenue: m?.revenue || 0, profit: m?.profit || 0 };
    });
  }, [monthly, year]);

  const Card = ({ label, value, sub }) => (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 20px' }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase', color: 'var(--muted)' }}>{label}</div>
      <div className="mono" style={{ fontSize: 26, fontWeight: 700, color: 'var(--ink)', marginTop: 8, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  );

  const tooltipStyle = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 };

  return (
    <div className="fade-in" style={{ maxWidth: 1320, margin: '0 auto' }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-.6px', margin: 0, color: 'var(--ink)' }}>Profit</h1>
      </div>

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
          {/* Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 18 }}>
            <Card label="Total Revenue" value={fmtLKR(summary?.revenue)} sub="Actual spend, ex-VAT" />
            <Card label="Total Profit" value={fmtLKR(summary?.profit)} sub="Agency commission earned" />
            <Card label="Blended Commission" value={fmtPct(summary?.blendedCommissionPct)} sub="Profit / Revenue" />
          </div>

          {/* Monthly Profit Trend */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', marginBottom: 12 }}>Monthly Profit Trend <span style={{ fontWeight: 500, color: 'var(--muted)', fontSize: 12 }}>· {year} · by schedule month</span></div>
            {monthlyData.length === 0 ? <Empty /> : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={monthlyData} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={{ stroke: 'var(--border)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} tickFormatter={(v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}K` : v)} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmtLKR(v), n === 'profit' ? 'Profit' : 'Revenue']} labelStyle={{ fontWeight: 700 }} />
                  <Bar dataKey="profit" name="Profit" fill="#15814B" radius={[4, 4, 0, 0]} maxBarSize={46} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 16, marginBottom: 16 }}>
            {/* Profit by Agency */}
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', marginBottom: 12 }}>Profit by Agency</div>
              {byAgency.length === 0 ? <Empty /> : (
                <ResponsiveContainer width="100%" height={Math.max(160, byAgency.length * 46 + 30)}>
                  <BarChart data={byAgency} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} tickFormatter={(v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}K` : v)} />
                    <YAxis type="category" dataKey="agency" tick={{ fontSize: 12, fill: 'var(--ink)' }} tickLine={false} axisLine={false} width={120} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v) => [fmtLKR(v), 'Profit']} />
                    <Bar dataKey="profit" radius={[0, 4, 4, 0]} maxBarSize={30}>
                      {byAgency.map((_, i) => <Cell key={i} fill={AGENCY_COLOR} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Profit by Client (ranked table) */}
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px 10px', fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Profit by Client <span style={{ fontWeight: 500, color: 'var(--muted)', fontSize: 12 }}>· {byClient.length} client(s)</span></div>
              <div style={{ maxHeight: 360, overflow: 'auto' }}>
                {byClient.length === 0 ? <div style={{ padding: 20 }}><Empty /></div> : (
                  <table className="tbl" style={{ margin: 0, fontSize: 12.5 }}>
                    <thead><tr><th>Client</th><th style={{ textAlign: 'right' }}>Revenue</th><th style={{ textAlign: 'right' }}>Profit</th></tr></thead>
                    <tbody>
                      {byClient.map((c) => (
                        <tr key={c.clientId}>
                          <td className="strong">{c.client}<div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>{c.agency}</div></td>
                          <td className="mono" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--muted)' }}>{fmtLKR(c.revenue)}</td>
                          <td className="mono" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmtLKR(c.profit)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>

          {/* Detail table (ground truth) */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>Detailed Breakdown</span>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{details ? `${details.total} rows` : ''}</span>
            </div>
            <div style={{ overflow: 'auto' }}>
              <table className="tbl" style={{ margin: 0, fontSize: 12.5 }}>
                <thead>
                  <tr>
                    <Th onClick={() => setSort('client')}>Client{sortArrow('client')}</Th>
                    <Th onClick={() => setSort('agency')}>Agency{sortArrow('agency')}</Th>
                    <Th onClick={() => setSort('revenue')} right>Revenue{sortArrow('revenue')}</Th>
                    <Th onClick={() => setSort('commission')} right>Commission (at entry){sortArrow('commission')}</Th>
                    <Th onClick={() => setSort('profit')} right>Profit{sortArrow('profit')}</Th>
                    <Th onClick={() => setSort('month')}>Month{sortArrow('month')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {(details?.rows || []).length === 0 ? (
                    <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)', padding: 24 }}>No confirmed actuals in this period.</td></tr>
                  ) : details.rows.map((r, i) => (
                    <tr key={i}>
                      <td className="strong">{r.client}</td>
                      <td style={{ color: 'var(--muted)' }}>{r.agency}</td>
                      <td className="mono" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtLKR(r.revenue)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{commissionLabel(r.commissionType, r.commissionValue)}</td>
                      <td className="mono" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{fmtLKR(r.profit)}</td>
                      <td>{fmtMonth(r.month)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {details && details.totalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderTop: '1px solid var(--border)', fontSize: 12.5 }}>
                <span style={{ color: 'var(--muted)' }}>Page {details.page} of {details.totalPages}</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</button>
                  <button className="btn btn-ghost btn-sm" disabled={page >= details.totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
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
