import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Brush,
  Cell, BarChart, Bar,
} from 'recharts';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';
import Icon from '../components/Icon';
import api from '../lib/api';

const fmtLKR = (v) => (v == null ? '-' : 'LKR ' + Math.round(Number(v)).toLocaleString('en-US'));
const fmtShort = (v) => {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(Math.round(n));
};
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-');

const CARD = { background: '#fff', border: '1px solid #E5E8ED', borderRadius: 14, boxShadow: '0 1px 2px rgba(15,31,61,.06)' };
const YEAR_COLORS = ['#E85D24', '#1F5BB5', '#15814B', '#6B3FB5', '#9A5B00', '#C5391F', '#0891b2', '#D9521C'];
const CAT_COLORS = ['#1F5BB5', '#E85D24', '#15814B', '#6B3FB5', '#9A5B00', '#C5391F', '#0891b2', '#93A0B5'];
const COL_HEAD = { textAlign: 'left', fontSize: 10.5, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: '#6B7790', padding: '11px 16px', background: '#F5F6F8', borderBottom: '1px solid #E5E8ED', cursor: 'pointer', whiteSpace: 'nowrap' };
const CELL = { padding: '11px 16px', borderBottom: '1px solid #EEF0F3', whiteSpace: 'nowrap' };

function Kpi({ icon, tone, label, value, sub, subColor }) {
  return (
    <div style={{ ...CARD, padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, display: 'grid', placeItems: 'center', background: tone[0], color: tone[1] }}><Icon name={icon} size={18} /></div>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: '#6B7790' }}>{label}</div>
      </div>
      <div style={{ fontSize: 26, fontWeight: 750, letterSpacing: '-.5px', fontFamily: "'Spline Sans Mono', monospace", color: '#16243C', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, marginTop: 8, fontWeight: 700, color: subColor || '#93A0B5' }}>{sub}</div>}
    </div>
  );
}

function Metric({ label, value, accent }) {
  return (
    <div style={{ background: '#FAFBFC', border: '1px solid #EEF0F3', borderRadius: 11, padding: '13px 15px' }}>
      <div style={{ fontSize: 11.5, color: '#6B7790', marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: accent || '#16243C', fontFamily: "'Spline Sans Mono', monospace" }}>{value}</div>
    </div>
  );
}

export default function DeepDashboardPage() {
  const navigate = useNavigate();
  const chartRef = useRef(null);

  const [agencies, setAgencies] = useState([]);
  const [clients, setClients] = useState([]);
  const [channelMasters, setChannelMasters] = useState([]);

  const [agencyId, setAgencyId] = useState('');
  const [clientId, setClientId] = useState('');
  const [channelMasterId, setChannelMasterId] = useState('');

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState('year');
  const [sortDir, setSortDir] = useState('desc');

  // Filter option lists
  useEffect(() => {
    api.get('/agencies').then(({ data }) => setAgencies(data.agencies || data || [])).catch(() => {});
    api.get('/masterdata/channel-masters').then(({ data }) => setChannelMasters(data.channelMasters || data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!agencyId) { setClients([]); setClientId(''); return; }
    api.get(`/agencies/${agencyId}/clients`).then(({ data }) => setClients(data.clients || data || [])).catch(() => setClients([]));
    setClientId('');
  }, [agencyId]);

  useEffect(() => {
    setLoading(true);
    const params = {};
    if (agencyId) params.agencyId = agencyId;
    if (clientId) params.clientId = clientId;
    if (channelMasterId) params.channelMasterId = channelMasterId;
    api.get('/analytics/deep-dashboard', { params })
      .then(({ data }) => setData(data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [agencyId, clientId, channelMasterId]);

  const kpis = data?.kpis || {};
  const trendYears = data?.trendYears || [];
  const monthlyTrend = data?.monthlyTrend || [];
  const clientDistribution = data?.clientDistribution || [];
  const insights = data?.channelInsights || {};
  const history = data?.clientHistory || {};
  const latestYear = kpis.latestYear || new Date().getFullYear();
  const previousYear = kpis.previousYear || latestYear - 1;

  // Property table rows (search + sort)
  const tableRows = useMemo(() => {
    let rows = data?.properties || [];
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((r) => `${r.category} ${r.type} ${r.name}`.toLowerCase().includes(q));
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[sortField], bv = b[sortField];
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av || '').localeCompare(String(bv || '')) * dir;
    });
  }, [data, search, sortField, sortDir]);

  const sortBy = (f) => { if (sortField === f) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); else { setSortField(f); setSortDir('desc'); } };
  const sortArrow = (f) => (sortField === f ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '');

  const exportExcel = () => {
    const rows = tableRows.map((r) => ({
      Year: r.year, 'Property Category': r.category, 'Property Type': r.type, 'Property Name': r.name,
      'Property Value': r.value, 'Bonus Value': r.bonusValue, 'Bonus %': r.bonusCount,
    }));
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Year: '', 'Property Category': '', 'Property Type': '', 'Property Name': '', 'Property Value': '', 'Bonus Value': '', 'Bonus %': '' }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Properties');
    XLSX.writeFile(wb, `deep-dashboard-properties-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const exportTablePdf = () => {
    const doc = new jsPDF({ orientation: 'landscape' });
    doc.setFontSize(14); doc.text('Property Performance', 14, 16);
    doc.setFontSize(9); doc.setTextColor(120);
    doc.text(`Generated ${new Date().toLocaleDateString('en-GB')}`, 14, 22);
    autoTable(doc, {
      startY: 27,
      head: [['Year', 'Category', 'Type', 'Name', 'Value (LKR)', 'Bonus (LKR)', 'Bonus %']],
      body: tableRows.map((r) => [r.year, r.category, r.type, r.name, Math.round(r.value).toLocaleString('en-US'), Math.round(r.bonusValue).toLocaleString('en-US'), r.bonusCount ? r.bonusCount + '%' : '-']),
      styles: { fontSize: 8 }, headStyles: { fillColor: [10, 23, 41] },
    });
    doc.save(`deep-dashboard-properties-${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const exportChart = async (kind) => {
    if (!chartRef.current) return;
    const canvas = await html2canvas(chartRef.current, { backgroundColor: '#ffffff', scale: 2 });
    if (kind === 'png') {
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png'); a.download = 'spend-trend.png'; a.click();
    } else {
      const img = canvas.toDataURL('image/png');
      const doc = new jsPDF({ orientation: 'landscape' });
      const w = doc.internal.pageSize.getWidth() - 20;
      const h = canvas.height * (w / canvas.width);
      doc.setFontSize(14); doc.text('Multi-Year Monthly Spend Trend', 14, 14);
      doc.addImage(img, 'PNG', 10, 20, w, h);
      doc.save('spend-trend.pdf');
    }
  };

  const yoyUp = (kpis.yoyValue || 0) >= 0;

  return (
    <div className="fade-in" style={{ maxWidth: 1440, margin: '0 auto' }}>
      {/* Header */}
      <div className="page-head">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/executive-dashboard')}><Icon name="chevL" size={14} /> Executive</button>
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-.6px', color: '#16243C', margin: '10px 0 0' }}>Deep Dashboard</h1>
          <p style={{ fontSize: 13.5, color: '#6B7790', margin: '6px 0 0' }}>Sponsorship investment, spend trends & property performance</p>
        </div>
      </div>

      {/* Filters */}
      <div style={{ ...CARD, padding: 16, marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ margin: 0, minWidth: 180 }}>
            <label className="field-label">Agency</label>
            <select className="select" value={agencyId} onChange={(e) => setAgencyId(e.target.value)}>
              <option value="">All agencies</option>
              {agencies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0, minWidth: 180 }}>
            <label className="field-label">Client</label>
            <select className="select" value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={!agencyId}>
              <option value="">All clients</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0, minWidth: 180 }}>
            <label className="field-label">Channel</label>
            <select className="select" value={channelMasterId} onChange={(e) => setChannelMasterId(e.target.value)}>
              <option value="">All channels</option>
              {channelMasters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {loading && !data ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#6B7790' }}>Loading…</div>
      ) : (
        <>
          {/* KPI cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 18 }}>
            <Kpi icon="money" tone={['#FDF1EB', '#D9521C']} label="Total Spend" value={fmtShort(kpis.totalSpend)} sub="From schedule logs" />
            <Kpi icon="calendar" tone={['#EDF3FD', '#1F5BB5']} label={`${latestYear} Spend`} value={fmtShort(kpis.currentYearSpend)} sub="Latest year" />
            <Kpi icon="calendar" tone={['#ECF8F1', '#15814B']} label={`${previousYear} Spend`} value={fmtShort(kpis.previousYearSpend)} sub="Previous year" />
            <Kpi
              icon={yoyUp ? 'trending-up' : 'trending-down'}
              tone={yoyUp ? ['#ECF8F1', '#15814B'] : ['#FBE0DA', '#C5391F']}
              label="YoY Growth"
              value={kpis.yoyPct == null ? '-' : `${yoyUp ? '↑' : '↓'} ${Math.abs(kpis.yoyPct)}%`}
              sub={kpis.yoyPct == null ? 'No prior year' : `${yoyUp ? '+' : '-'}${fmtShort(Math.abs(kpis.yoyValue))} vs prev year`}
              subColor={yoyUp ? '#15814B' : '#C5391F'}
            />
          </div>

          {/* Multi-year monthly trend */}
          <div style={{ ...CARD, marginBottom: 18 }}>
            <div style={{ padding: '16px 20px 4px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
              <div>
                <h3 style={{ fontSize: 14.5, fontWeight: 700, margin: 0, letterSpacing: '-.2px' }}>Multi-Year Monthly Spend Trend</h3>
                <p style={{ fontSize: 12.5, color: '#6B7790', margin: '4px 0 0' }}>Monthly committed media value by year — drag the slider below to zoom</p>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => exportChart('png')}><Icon name="download" size={14} /> PNG</button>
                <button className="btn btn-ghost btn-sm" onClick={() => exportChart('pdf')}><Icon name="file" size={14} /> PDF</button>
              </div>
            </div>
            <div ref={chartRef} style={{ padding: '8px 14px 18px', background: '#fff' }}>
              {trendYears.length === 0 ? (
                <div style={{ height: 300, display: 'grid', placeItems: 'center', color: '#93A0B5', fontSize: 13 }}>No schedule data for the selected filters</div>
              ) : (
                <ResponsiveContainer width="100%" height={340}>
                  <LineChart data={monthlyTrend} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EEF0F3" />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#6B7790' }} axisLine={{ stroke: '#E5E8ED' }} tickLine={false} />
                    <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11, fill: '#93A0B5' }} axisLine={false} tickLine={false} width={48} />
                    <Tooltip formatter={(v, n) => [fmtLKR(v), n]} contentStyle={{ borderRadius: 9, border: '1px solid #E5E8ED', fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {trendYears.map((y, i) => (
                      <Line key={y} type="monotone" dataKey={String(y)} name={String(y)} stroke={YEAR_COLORS[i % YEAR_COLORS.length]} strokeWidth={2.4} dot={{ r: 2.5 }} activeDot={{ r: 5 }} />
                    ))}
                    <Brush dataKey="month" height={20} stroke="#E85D24" travellerWidth={8} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Client-wise investment contribution */}
          <div style={{ ...CARD, marginBottom: 18 }}>
            <div style={{ padding: '16px 20px 4px' }}>
              <h3 style={{ fontSize: 14.5, fontWeight: 700, margin: 0 }}>Client Investment Contribution</h3>
              <p style={{ fontSize: 12.5, color: '#6B7790', margin: '4px 0 0' }}>How media investment is distributed across clients (from schedule logs)</p>
            </div>
            <div style={{ padding: '10px 16px 18px' }}>
              {clientDistribution.length === 0 ? (
                <div style={{ height: 200, display: 'grid', placeItems: 'center', color: '#93A0B5', fontSize: 13 }}>No schedule data for the selected filters</div>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(180, Math.min(clientDistribution.length, 12) * 34 + 30)}>
                  <BarChart data={clientDistribution.slice(0, 12)} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#EEF0F3" />
                    <XAxis type="number" tickFormatter={fmtShort} tick={{ fontSize: 11, fill: '#93A0B5' }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="client" tick={{ fontSize: 11.5, fill: '#16243C' }} axisLine={false} tickLine={false} width={140} />
                    <Tooltip formatter={(v) => [fmtLKR(v), 'Investment']} contentStyle={{ borderRadius: 9, border: '1px solid #E5E8ED', fontSize: 12 }} />
                    <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                      {clientDistribution.slice(0, 12).map((c, i) => <Cell key={c.client} fill={CAT_COLORS[i % CAT_COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Channel insights + Client history */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 18, marginBottom: 18 }}>
            <div style={CARD}>
              <div style={{ padding: '16px 20px 4px' }}><h3 style={{ fontSize: 14.5, fontWeight: 700, margin: 0 }}>Channel Performance Insights</h3></div>
              <div style={{ padding: '12px 20px 20px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                <Metric label="Total properties" value={insights.totalProperties ?? 0} />
                <Metric label="Total bonus value" value={fmtShort(insights.totalBonusValue)} accent="#15814B" />
                <Metric label="Avg property value" value={fmtShort(insights.avgPropertyValue)} />
                <Metric label="Top category" value={insights.mostPurchasedCategory || '-'} />
                <Metric label="Highest property" value={insights.highestProperty ? fmtShort(insights.highestProperty.value) : '-'} accent="#D9521C" />
              </div>
            </div>
            <div style={CARD}>
              <div style={{ padding: '16px 20px 4px' }}><h3 style={{ fontSize: 14.5, fontWeight: 700, margin: 0 }}>Client Investment History</h3></div>
              <div style={{ padding: '12px 20px 20px', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
                <Metric label="First sponsorship" value={fmtDate(history.firstDate)} />
                <Metric label="Latest sponsorship" value={fmtDate(history.latestDate)} />
                <Metric label="Years active" value={history.yearsActive ?? 0} />
                <Metric label="Total properties" value={history.totalProperties ?? 0} />
                <Metric label="Lifetime spend" value={fmtShort(history.lifetimeSpend)} accent="#D9521C" />
                <Metric label="Lifetime bonus" value={fmtShort(history.lifetimeBonusValue)} accent="#15814B" />
              </div>
            </div>
          </div>

          {/* Property performance table */}
          <div style={{ ...CARD, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #E5E8ED', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <h3 style={{ fontSize: 14.5, fontWeight: 700, margin: 0, flex: 1 }}>Property Performance ({tableRows.length})</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#EEF0F3', borderRadius: 9, padding: '7px 11px', width: 240 }}>
                <Icon name="search" size={15} style={{ color: '#6B7790' }} />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search properties…" style={{ border: 'none', background: 'none', outline: 'none', flex: 1, fontSize: 13, color: '#16243C' }} />
              </div>
              <button className="btn btn-ghost btn-sm" onClick={exportTablePdf}><Icon name="file" size={14} /> PDF</button>
              <button className="btn btn-primary btn-sm" onClick={exportExcel}><Icon name="download" size={14} /> Excel</button>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 860 }}>
                <thead>
                  <tr>
                    <th style={COL_HEAD} onClick={() => sortBy('year')}>Year{sortArrow('year')}</th>
                    <th style={COL_HEAD} onClick={() => sortBy('category')}>Category{sortArrow('category')}</th>
                    <th style={COL_HEAD} onClick={() => sortBy('type')}>Type{sortArrow('type')}</th>
                    <th style={COL_HEAD} onClick={() => sortBy('name')}>Property Name{sortArrow('name')}</th>
                    <th style={{ ...COL_HEAD, textAlign: 'right' }} onClick={() => sortBy('value')}>Value{sortArrow('value')}</th>
                    <th style={{ ...COL_HEAD, textAlign: 'right' }} onClick={() => sortBy('bonusValue')}>Bonus Value{sortArrow('bonusValue')}</th>
                    <th style={{ ...COL_HEAD, textAlign: 'right' }} onClick={() => sortBy('bonusCount')}>Bonus %{sortArrow('bonusCount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.length === 0 && <tr><td colSpan={7} style={{ ...CELL, textAlign: 'center', color: '#93A0B5' }}>No properties for the selected filters.</td></tr>}
                  {tableRows.map((r, i) => (
                    <tr key={i} onMouseEnter={(e) => { e.currentTarget.style.background = '#F7F8FA'; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                      <td style={{ ...CELL, fontFamily: "'Spline Sans Mono', monospace", color: '#6B7790' }}>{r.year}</td>
                      <td style={CELL}>{r.category}</td>
                      <td style={{ ...CELL, color: '#3B4A63' }}>{r.type || '-'}</td>
                      <td style={{ ...CELL, fontWeight: 600, color: '#16243C' }}>{r.name}</td>
                      <td style={{ ...CELL, textAlign: 'right', fontFamily: "'Spline Sans Mono', monospace", fontWeight: 600 }}>{fmtLKR(r.value)}</td>
                      <td style={{ ...CELL, textAlign: 'right', fontFamily: "'Spline Sans Mono', monospace", color: '#15814B' }}>{r.bonusValue > 0 ? fmtLKR(r.bonusValue) : '-'}</td>
                      <td style={{ ...CELL, textAlign: 'right', fontFamily: "'Spline Sans Mono', monospace" }}>{r.bonusCount ? r.bonusCount + '%' : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
