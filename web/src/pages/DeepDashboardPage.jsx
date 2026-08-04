import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { canExport } from '../lib/permissions';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Brush,
  Cell, BarChart, Bar,
} from 'recharts';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';
import Icon from '../components/Icon';
import OrbitLoader from '../components/OrbitLoader';
import api from '../lib/api';
import { loadBrandLogo, fitLogo } from '../lib/brandLogo';
import { writeBrandedWorkbook } from '../lib/brandedXlsx';

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
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(Math.round(n));
};
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-');

const YEAR_COLORS = ['#E85D24', '#1F5BB5', '#15814B', '#6B3FB5', '#9A5B00', '#C5391F', '#0891b2', '#D9521C'];
const CAT_COLORS = ['#1F5BB5', '#E85D24', '#15814B', '#6B3FB5', '#9A5B00', '#C5391F', '#0891b2', '#93A0B5'];

function Chip({ dir = 'flat', children }) {
  const palette = {
    up: { color: '#15814B', bg: '#ECF8F1' },
    down: { color: '#C5391F', bg: '#FBE0DA' },
    flat: { color: '#6B7790', bg: '#EEF0F3' },
  };
  const p = palette[dir] || palette.flat;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', fontSize: 11.5, fontWeight: 700,
      padding: '3px 9px', borderRadius: 7, color: p.color, background: p.bg,
      fontFamily: "'Spline Sans Mono', monospace",
    }}>
      {children}
    </span>
  );
}

function Kpi({ icon, tone, label, value, chip }) {
  return (
    <div className="dd-kpi">
      <div className="dd-kpi-top">
        <div className="dd-kpi-ico" style={{ background: tone[0], color: tone[1] }}><Icon name={icon} size={18} /></div>
        {chip}
      </div>
      <div className="dd-kpi-val">{value}</div>
      <div className="dd-kpi-label">{label}</div>
    </div>
  );
}

export default function DeepDashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
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
  const channelDistribution = data?.channelDistribution || [];
  const latestYear = kpis.latestYear || new Date().getFullYear();
  const previousYear = kpis.previousYear || latestYear - 1;

  // Property table rows (search + sort)
  const tableRows = useMemo(() => {
    let rows = (data?.properties || []).map((r) => ({
      ...r,
      bonusYield: Number(r.value) > 0 ? (Number(r.bonusValue || 0) / Number(r.value)) * 100 : 0,
    }));
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((r) => `${r.category} ${r.type} ${r.name} ${r.channel} ${r.client}`.toLowerCase().includes(q));
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[sortField], bv = b[sortField];
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av || '').localeCompare(String(bv || '')) * dir;
    });
  }, [data, search, sortField, sortDir]);

  const sortBy = (f) => { if (sortField === f) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); else { setSortField(f); setSortDir('desc'); } };
  const sortArrow = (f) => (sortField === f ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '');

  const exportExcel = async () => {
    const rows = tableRows.map((r) => ({
      Year: r.year, Channel: r.channel, Client: r.client, 'Property Category': r.category, 'Property Type': r.type, 'Property Name': r.name,
      'Property Value': r.value, 'Bonus Value': r.bonusValue, 'Bonus %': r.bonusCount,
      'Bonus Yield %': Number(r.value) > 0 ? Number(((Number(r.bonusValue || 0) / Number(r.value)) * 100).toFixed(1)) : 0,
      'Start Date': r.startDate ? r.startDate.slice(0, 10) : '', 'End Date': r.endDate ? r.endDate.slice(0, 10) : 'Ongoing',
    }));
    const json = rows.length ? rows : [{ Year: '', Channel: '', Client: '', 'Property Category': '', 'Property Type': '', 'Property Name': '', 'Property Value': '', 'Bonus Value': '', 'Bonus %': '', 'Bonus Yield %': '', 'Start Date': '', 'End Date': '' }];
    await writeBrandedWorkbook([{ name: 'Properties', json }], `deep-dashboard-properties-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const exportTablePdf = async () => {
    const doc = new jsPDF({ orientation: 'landscape' });
    // Brand logo, top-right (white background, so no chip).
    const brandLogo = await loadBrandLogo();
    if (brandLogo) {
      const { width, height } = fitLogo(brandLogo, 38, 15);
      try { doc.addImage(brandLogo.dataUrl, brandLogo.format, doc.internal.pageSize.getWidth() - 14 - width, 8, width, height); } catch { /* keep the report */ }
    }
    doc.setFontSize(14); doc.setTextColor(0); doc.text('Property Performance', 14, 16);
    doc.setFontSize(9); doc.setTextColor(120);
    doc.text(`Generated ${new Date().toLocaleDateString('en-GB')}`, 14, 22);
    autoTable(doc, {
      startY: 27,
      head: [['Year', 'Channel', 'Client', 'Category', 'Type', 'Name', 'Value (LKR)', 'Bonus (LKR)', 'Bonus %', 'Bonus Yield', 'Duration']],
      body: tableRows.map((r) => [r.year, r.channel, r.client, r.category, r.type, r.name, Math.round(r.value).toLocaleString('en-US'), Math.round(r.bonusValue).toLocaleString('en-US'), r.bonusCount ? r.bonusCount + '%' : '-', (Number(r.value) > 0 ? ((Number(r.bonusValue || 0) / Number(r.value)) * 100).toFixed(1) + '%' : '-'), r.startDate ? `${r.startDate.slice(0, 10)} - ${r.endDate ? r.endDate.slice(0, 10) : 'Ongoing'}` : '-']),
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
      // Brand logo, top-right (white background, so no chip).
      const brandLogo = await loadBrandLogo();
      if (brandLogo) {
        const { width, height } = fitLogo(brandLogo, 34, 13);
        try { doc.addImage(brandLogo.dataUrl, brandLogo.format, doc.internal.pageSize.getWidth() - 14 - width, 6, width, height); } catch { /* keep the chart */ }
      }
      doc.setFontSize(14); doc.text('Multi-Year Monthly Spend Trend', 14, 14);
      doc.addImage(img, 'PNG', 10, 20, w, h);
      doc.save('spend-trend.pdf');
    }
  };

  const yoyUp = (kpis.yoyValue || 0) >= 0;
  const activeFilterCount = [agencyId, clientId, channelMasterId].filter(Boolean).length;

  return (
    <div className="fade-in dd-page" style={{ maxWidth: 1440, margin: '0 auto' }}>
      <style>{`
        .dd-hero {
          position: relative; overflow: hidden; border-radius: 18px; margin-bottom: 20px;
          background: linear-gradient(135deg, #0A1729 0%, #122842 55%, #0F1F3D 100%);
          padding: 26px 28px; color: #fff;
        }
        .dd-hero::before {
          content: ''; position: absolute; top: -60px; right: -60px; width: 240px; height: 240px;
          background: radial-gradient(circle, rgba(232,93,36,.30), transparent 70%); border-radius: 50%;
        }
        .dd-hero::after {
          content: ''; position: absolute; bottom: -80px; left: 20%; width: 200px; height: 200px;
          background: radial-gradient(circle, rgba(31,91,181,.22), transparent 70%); border-radius: 50%;
        }
        .dd-hero-inner { position: relative; z-index: 1; }
        .dd-back { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; color: rgba(255,255,255,.65); background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.14); border-radius: 8px; padding: 6px 11px; cursor: pointer; transition: background .15s; }
        .dd-back:hover { background: rgba(255,255,255,.16); color: #fff; }
        .dd-title { font-size: 25px; font-weight: 750; letter-spacing: -.6px; margin: 14px 0 0; }
        .dd-sub { font-size: 13.5px; color: rgba(255,255,255,.55); margin: 6px 0 0; }
        .dd-filters { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 20px; }
        .dd-field { display: flex; flex-direction: column; gap: 5px; min-width: 180px; }
        .dd-field label { font-size: 10.5px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; color: rgba(255,255,255,.45); }
        .dd-select { background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.16); color: #fff; border-radius: 9px; padding: 9px 12px; font-size: 13px; font-weight: 500; outline: none; cursor: pointer; }
        .dd-select option { color: #16243C; }
        .dd-select:disabled { opacity: .45; cursor: not-allowed; }
        .dd-filter-badge { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 700; color: #E85D24; background: rgba(232,93,36,.16); border: 1px solid rgba(232,93,36,.3); border-radius: 7px; padding: 4px 10px; align-self: flex-start; margin-top: 21px; }

        .dd-kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 20px; }
        .dd-kpi { position: relative; overflow: hidden; background: #fff; border: 1px solid #E5E8ED; border-radius: 14px; box-shadow: 0 1px 2px rgba(15,31,61,.06); padding: 18px 20px; transition: box-shadow .15s, transform .15s; }
        .dd-kpi::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg,#E85D24,rgba(232,93,36,.1) 70%,transparent); }
        .dd-kpi:hover { box-shadow: 0 6px 16px rgba(15,31,61,.10); transform: translateY(-1px); }
        .dd-kpi-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
        .dd-kpi-ico { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; }
        .dd-kpi-val { font-size: 25px; font-weight: 750; letter-spacing: -.5px; font-family: 'Spline Sans Mono', monospace; color: #16243C; line-height: 1; }
        .dd-kpi-label { font-size: 12px; font-weight: 600; color: #6B7790; margin-top: 8px; }

        .dd-card { background: #fff; border: 1px solid #E5E8ED; border-radius: 14px; box-shadow: 0 1px 2px rgba(15,31,61,.06); margin-bottom: 20px; overflow: hidden; }
        .dd-card-head { padding: 17px 22px 4px; display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
        .dd-card-title { font-size: 14.5px; font-weight: 720; margin: 0; letter-spacing: -.2px; color: #16243C; }
        .dd-card-sub { font-size: 12.5px; color: #6B7790; margin: 4px 0 0; }
        .dd-export-btn { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 650; padding: 7px 12px; border-radius: 8px; border: 1px solid #D5DAE2; background: #fff; color: #3B4A63; cursor: pointer; transition: background .15s, border-color .15s; }
        .dd-export-btn:hover { background: #F5F6F8; border-color: #C2C9D4; }
        .dd-export-btn.primary { background: #16243C; border-color: #16243C; color: #fff; }
        .dd-export-btn.primary:hover { background: #0F1F3D; }

        .dd-metric-grid { padding: 14px 22px 22px; display: grid; gap: 11px; }
        .dd-metric { display: flex; align-items: center; gap: 11px; background: #FAFBFC; border: 1px solid #EEF0F3; border-radius: 11px; padding: 12px 14px; }
        .dd-metric-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
        .dd-metric-label { font-size: 11.5px; color: #6B7790; margin-bottom: 4px; }
        .dd-metric-val { font-size: 15.5px; font-weight: 700; color: #16243C; font-family: 'Spline Sans Mono', monospace; }

        .dd-search { display: flex; align-items: center; gap: 8px; background: #EEF0F3; border-radius: 9px; padding: 8px 12px; width: 250px; }
        .dd-search input { border: none; background: none; outline: none; flex: 1; font-size: 13px; color: #16243C; }
        .dd-th { text-align: left; font-size: 10.5px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; color: #6B7790; padding: 12px 16px; background: #F5F6F8; border-bottom: 1px solid #E5E8ED; cursor: pointer; white-space: nowrap; user-select: none; transition: color .15s; }
        .dd-th:hover { color: #16243C; }
        .dd-td { padding: 12px 16px; border-bottom: 1px solid #EEF0F3; white-space: nowrap; }
        .dd-row:hover { background: #F7F8FA; }
        .dd-cat-pill { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: #3B4A63; }
        .dd-cat-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }

        .dd-rank-list { max-height: 460px; overflow-y: auto; padding: 6px 12px 14px; }
        .dd-rank-row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 9px; cursor: pointer; transition: background .12s; }
        .dd-rank-row:hover { background: #F5F6F8; }
        .dd-rank-num { width: 20px; height: 20px; border-radius: 6px; display: grid; place-items: center; font-size: 10.5px; font-weight: 700; font-family: 'Spline Sans Mono', monospace; background: #EEF0F3; color: #6B7790; flex-shrink: 0; }
        .dd-rank-main { flex: 1; min-width: 0; }
        .dd-rank-name { font-size: 12.5px; font-weight: 650; color: #16243C; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .dd-rank-bar-track { height: 6px; border-radius: 4px; background: #EEF0F3; overflow: hidden; margin-top: 5px; }
        .dd-rank-bar-fill { height: 100%; border-radius: 4px; transition: width .4s ease; }
        .dd-rank-val { font-size: 12px; font-weight: 700; font-family: 'Spline Sans Mono', monospace; color: #16243C; flex-shrink: 0; min-width: 72px; text-align: right; }

        @media (max-width: 1100px) { .dd-kpi-grid { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 900px) { .dd-insights-grid { grid-template-columns: 1fr !important; } }
      `}</style>

      {/* Hero header with filters */}
      <div className="dd-hero">
        <div className="dd-hero-inner">
          <button className="dd-back" onClick={() => navigate('/executive-dashboard')}><Icon name="chevL" size={13} /> Executive Dashboard</button>
          <h1 className="dd-title">Deep Dashboard</h1>
          <p className="dd-sub">Sponsorship investment, spend trends &amp; property performance</p>

          <div className="dd-filters">
            <div className="dd-field">
              <label>Agency</label>
              <select className="dd-select" value={agencyId} onChange={(e) => setAgencyId(e.target.value)}>
                <option value="">All agencies</option>
                {agencies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div className="dd-field">
              <label>Client</label>
              <select className="dd-select" value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={!agencyId}>
                <option value="">All clients</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="dd-field">
              <label>Channel</label>
              <select className="dd-select" value={channelMasterId} onChange={(e) => setChannelMasterId(e.target.value)}>
                <option value="">All channels</option>
                {channelMasters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            {activeFilterCount > 0 && (
              <div className="dd-filter-badge">
                <Icon name="filter" size={12} /> {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''} applied
              </div>
            )}
          </div>
        </div>
      </div>

      {loading && !data ? (
        <OrbitLoader label="Loading deep dashboard…" />
      ) : (
        <>
          {/* KPI cards */}
          <div className="dd-kpi-grid">
            <Kpi icon="money" tone={['#FDF1EB', '#D9521C']} label="Total Spend" value={fmtShort(kpis.totalSpend)} chip={<Chip dir="flat">All time</Chip>} />
            <Kpi icon="calendar" tone={['#EDF3FD', '#1F5BB5']} label={`${latestYear} Spend`} value={fmtShort(kpis.currentYearSpend)} chip={<Chip dir="flat">Latest</Chip>} />
            <Kpi icon="calendar" tone={['#ECF8F1', '#15814B']} label={`${previousYear} Spend`} value={fmtShort(kpis.previousYearSpend)} chip={<Chip dir="flat">Previous</Chip>} />
            <Kpi
              icon={yoyUp ? 'trending-up' : 'trending-down'}
              tone={yoyUp ? ['#ECF8F1', '#15814B'] : ['#FBE0DA', '#C5391F']}
              label="YoY Growth"
              value={kpis.yoyPct == null ? '-' : `${yoyUp ? '+' : ''}${kpis.yoyPct}%`}
              chip={kpis.yoyPct == null ? <Chip dir="flat">No prior year</Chip> : <Chip dir={yoyUp ? 'up' : 'down'}>{fmtShort(Math.abs(kpis.yoyValue))}</Chip>}
            />
          </div>

          {/* Multi-year monthly trend */}
          <div className="dd-card">
            <div className="dd-card-head">
              <div>
                <h3 className="dd-card-title">Multi-Year Monthly Spend Trend</h3>
                <p className="dd-card-sub">Monthly committed media value by year - drag the slider below to zoom</p>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {canExport(user) && <button className="dd-export-btn" onClick={() => exportChart('png')}><Icon name="download" size={14} /> PNG</button>}
                {canExport(user) && <button className="dd-export-btn" onClick={() => exportChart('pdf')}><Icon name="file" size={14} /> PDF</button>}
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
          <div className="dd-card">
            <div className="dd-card-head" style={{ paddingBottom: 4 }}>
              <div>
                <h3 className="dd-card-title">Client Investment Contribution</h3>
                <p className="dd-card-sub">How media investment is distributed across clients (from schedule logs)</p>
              </div>
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

          {/* All clients + all channels, ranked by spend, linking to their intelligence pages */}
          <div className="dd-insights-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 0 }}>
            <div className="dd-card" style={{ marginBottom: 20 }}>
              <div className="dd-card-head" style={{ paddingBottom: 4 }}>
                <div>
                  <h3 className="dd-card-title">All Clients</h3>
                  <p className="dd-card-sub">Ranked by spend for the selected filters - click a client to open its profile</p>
                </div>
              </div>
              {clientDistribution.length === 0 ? (
                <div style={{ height: 120, display: 'grid', placeItems: 'center', color: '#93A0B5', fontSize: 13 }}>No schedule data for the selected filters</div>
              ) : (
                <div className="dd-rank-list">
                  {clientDistribution.map((c, i) => (
                    <div key={c.clientId} className="dd-rank-row" onClick={() => navigate(`/clients/${c.clientId}/dashboard`)}>
                      <span className="dd-rank-num">{i + 1}</span>
                      <div className="dd-rank-main">
                        <div className="dd-rank-name">{c.client}</div>
                        <div className="dd-rank-bar-track">
                          <div className="dd-rank-bar-fill" style={{ width: `${(c.value / clientDistribution[0].value) * 100}%`, background: CAT_COLORS[i % CAT_COLORS.length] }} />
                        </div>
                      </div>
                      <span className="dd-rank-val">{fmtShort(c.value)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="dd-card" style={{ marginBottom: 20 }}>
              <div className="dd-card-head" style={{ paddingBottom: 4 }}>
                <div>
                  <h3 className="dd-card-title">All Channels</h3>
                  <p className="dd-card-sub">Ranked by spend for the selected filters - click a channel to open its intelligence page</p>
                </div>
              </div>
              {channelDistribution.length === 0 ? (
                <div style={{ height: 120, display: 'grid', placeItems: 'center', color: '#93A0B5', fontSize: 13 }}>No schedule data for the selected filters</div>
              ) : (
                <div className="dd-rank-list">
                  {channelDistribution.map((c, i) => (
                    <div key={c.channelMasterId} className="dd-rank-row" onClick={() => navigate(`/channel-masters/${c.channelMasterId}`)}>
                      <span className="dd-rank-num">{i + 1}</span>
                      <div className="dd-rank-main">
                        <div className="dd-rank-name">{c.channel}</div>
                        <div className="dd-rank-bar-track">
                          <div className="dd-rank-bar-fill" style={{ width: `${(c.value / channelDistribution[0].value) * 100}%`, background: YEAR_COLORS[i % YEAR_COLORS.length] }} />
                        </div>
                      </div>
                      <span className="dd-rank-val">{fmtShort(c.value)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Property performance table */}
          <div className="dd-card" style={{ marginBottom: 0 }}>
            <div style={{ padding: '15px 22px', borderBottom: '1px solid #E5E8ED', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <h3 className="dd-card-title" style={{ flex: 1 }}>Property Performance <span style={{ color: '#93A0B5', fontWeight: 600 }}>({tableRows.length})</span></h3>
              <div className="dd-search">
                <Icon name="search" size={15} style={{ color: '#6B7790' }} />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search properties…" />
              </div>
              {canExport(user) && <button className="dd-export-btn" onClick={exportTablePdf}><Icon name="file" size={14} /> PDF</button>}
              {canExport(user) && <button className="dd-export-btn primary" onClick={exportExcel}><Icon name="download" size={14} /> Excel</button>}
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 860 }}>
                <thead>
                  <tr>
                    <th className="dd-th" onClick={() => sortBy('year')}>Year{sortArrow('year')}</th>
                    <th className="dd-th" onClick={() => sortBy('channel')}>Channel{sortArrow('channel')}</th>
                    <th className="dd-th" onClick={() => sortBy('client')}>Client{sortArrow('client')}</th>
                    <th className="dd-th" onClick={() => sortBy('category')}>Category{sortArrow('category')}</th>
                    <th className="dd-th" onClick={() => sortBy('type')}>Type{sortArrow('type')}</th>
                    <th className="dd-th" onClick={() => sortBy('name')}>Property Name{sortArrow('name')}</th>
                    <th className="dd-th" style={{ textAlign: 'right' }} onClick={() => sortBy('value')}>Value{sortArrow('value')}</th>
                    <th className="dd-th" style={{ textAlign: 'right' }} onClick={() => sortBy('bonusValue')}>Bonus Value{sortArrow('bonusValue')}</th>
                    <th className="dd-th" style={{ textAlign: 'right' }} onClick={() => sortBy('bonusCount')}>Bonus %{sortArrow('bonusCount')}</th>
                    <th className="dd-th" style={{ textAlign: 'right' }} onClick={() => sortBy('bonusYield')}>Bonus Yield{sortArrow('bonusYield')}</th>
                    <th className="dd-th" onClick={() => sortBy('startDate')}>Duration{sortArrow('startDate')}</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.length === 0 && <tr><td colSpan={11} className="dd-td" style={{ textAlign: 'center', color: '#93A0B5' }}>No properties for the selected filters.</td></tr>}
                  {tableRows.map((r, i) => {
                    const catColor = CAT_COLORS[Math.abs((r.category || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % CAT_COLORS.length];
                    return (
                      <tr key={i} className="dd-row">
                        <td className="dd-td" style={{ fontFamily: "'Spline Sans Mono', monospace", color: '#6B7790' }}>{r.year}</td>
                        <td className="dd-td" style={{ color: '#3B4A63' }}>{r.channel || '-'}</td>
                        <td className="dd-td" style={{ color: '#3B4A63' }}>{r.client || '-'}</td>
                        <td className="dd-td"><span className="dd-cat-pill"><span className="dd-cat-dot" style={{ background: catColor }} />{r.category}</span></td>
                        <td className="dd-td" style={{ color: '#3B4A63' }}>{r.type || '-'}</td>
                        <td className="dd-td" style={{ fontWeight: 600, color: '#16243C' }}>{r.name}</td>
                        <td className="dd-td" style={{ textAlign: 'right', fontFamily: "'Spline Sans Mono', monospace", fontWeight: 600 }}>{fmtLKR(r.value)}</td>
                        <td className="dd-td" style={{ textAlign: 'right', fontFamily: "'Spline Sans Mono', monospace", color: '#15814B' }}>{r.bonusValue > 0 ? fmtLKR(r.bonusValue) : '-'}</td>
                        <td className="dd-td" style={{ textAlign: 'right', fontFamily: "'Spline Sans Mono', monospace" }}>{r.bonusCount ? r.bonusCount + '%' : '-'}</td>
                        <td className="dd-td" style={{ textAlign: 'right', fontFamily: "'Spline Sans Mono', monospace", fontWeight: 600, color: r.bonusYield > 0 ? '#15814B' : '#93A0B5' }}>{r.bonusYield > 0 ? r.bonusYield.toFixed(1) + '%' : '-'}</td>
                        <td className="dd-td" style={{ fontSize: 12, color: '#3B4A63' }}>
                          {r.startDate ? <>{fmtDate(r.startDate)} &rarr; {r.endDate ? fmtDate(r.endDate) : <span style={{ color: '#15814B', fontWeight: 600 }}>Ongoing</span>}</> : '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

    </div>
  );
}
