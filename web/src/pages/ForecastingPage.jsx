import { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Icon from '../components/Icon';
import OrbitLoader from '../components/OrbitLoader';
import api from '../lib/api';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';
import {
  BarChart, Bar, PieChart, Pie, Cell, LineChart, Line, ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const AVATAR = ['#E85D24', '#1F5BB5', '#15814B', '#6B3FB5', '#9A5B00', '#C5391F', '#0891b2', '#38527E'];
const STATUS = {
  submitted: { dot: '#15814B', label: 'Submitted' },
  pending: { dot: '#9A5B00', label: 'Pending' },
  none: { dot: '#C7D0DD', label: 'Not started' },
};
const MEDIUM_ORDER = ['TV', 'RADIO', 'PRINT', 'CINEMA', 'OOH', 'DIGITAL'];
const MEDIUM_COLORS = { TV: '#1e3a5f', RADIO: '#E85D24', PRINT: '#059669', DIGITAL: '#6B3FB5', CINEMA: '#C2185B', OOH: '#0E7490' };
const CHART_COLORS = ['#1e3a5f', '#E85D24', '#059669', '#6B3FB5', '#C2185B', '#0E7490', '#d97706', '#dc2626', '#0ea5e9', '#14b8a6'];

const fmtM = (v) => (v == null ? '—' : `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}M`);
const fmtPct = (v) => (v == null ? '—' : `${v >= 0 ? '' : ''}${Number(v).toFixed(1)}%`);
const monthName = (m) => MONTHS[m - 1] || m;

// The month group heads forecast (client-side mirror of the server helper):
// current month through the 14th, then next month from the 15th onward.
function clientNextMonth() {
  const d = new Date();
  const roll = d.getDate() >= 15;
  let y = d.getFullYear(), m = d.getMonth() + 1;
  if (roll) { m += 1; if (m > 12) { m = 1; y += 1; } }
  return { year: y, month: m };
}

const varianceColor = (flag) => (flag === 'positive' ? 'var(--green-600)' : flag === 'negative' ? 'var(--red-600)' : '#6B7790');

// Trigger a client-side CSV download from stacked sheet definitions.
function downloadCSV(sheets, filename) {
  const rows = [];
  sheets.forEach((s, i) => {
    if (i > 0) rows.push([]);
    if (s.name) rows.push([s.name]);
    s.rows.forEach((r) => rows.push(r));
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Export');
  const out = XLSX.write(wb, { bookType: 'csv', type: 'array' });
  const blob = new Blob([out], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadXLSX(sheets, filename) {
  const wb = XLSX.utils.book_new();
  sheets.forEach((s) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.rows), (s.name || 'Sheet').slice(0, 31)));
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

// Small three-button export cluster.
function ExportButtons({ onExcel, onCsv, onPdf, busy }) {
  return (
    <div style={{ display: 'inline-flex', gap: 8 }}>
      <button className="btn btn-ghost btn-sm" onClick={onExcel} disabled={busy}><Icon name="download" size={13} /> Excel</button>
      <button className="btn btn-ghost btn-sm" onClick={onCsv} disabled={busy}><Icon name="download" size={13} /> CSV</button>
      <button className="btn btn-ghost btn-sm" onClick={onPdf} disabled={busy}>{busy ? 'Exporting…' : <><Icon name="download" size={13} /> PDF</>}</button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Insights — SUPER_ADMIN-only analytics suite (lives inside the Forecast tab).
// ════════════════════════════════════════════════════════════════════════════
function InsightsTab() {
  const def = clientNextMonth();
  const [filters, setFilters] = useState({ year: def.year, month: def.month, agencyId: '', clientId: '', medium: '', channelMasterId: '', teamId: '' });
  const [sub, setSub] = useState('summary'); // 'summary' | 'variance' | 'accuracy' | 'trends'

  // Dropdown sources (loaded once).
  const [filterClients, setFilterClients] = useState([]);
  const [channelMasters, setChannelMasters] = useState([]);
  const [teams, setTeams] = useState([]);

  // Per-sub-tab data.
  const [summary, setSummary] = useState(null);
  const [variance, setVariance] = useState(null);
  const [accuracy, setAccuracy] = useState(null);
  const [trend, setTrend] = useState(null);
  const [loading, setLoading] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  // Summary client table sort + search.
  const [sortKey, setSortKey] = useState('totalForecastMillions');
  const [sortDir, setSortDir] = useState('desc');
  const [clientSearch, setClientSearch] = useState('');
  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
  };

  const [vGroupBy, setVGroupBy] = useState('client'); // 'client' | 'channel'
  const [vSortKey, setVSortKey] = useState('varianceMillions');
  const [vSortDir, setVSortDir] = useState('desc');
  const toggleVSort = (key) => {
    if (vSortKey === key) setVSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setVSortKey(key); setVSortDir('desc'); }
  };

  const chartFvA = useRef(null);
  const chartVar = useRef(null);
  const chartPie = useRef(null);
  const chartTopCh = useRef(null);
  const chartTopCl = useRef(null);

  useEffect(() => {
    Promise.all([
      api.get('/forecasting/clients').catch(() => ({ data: { clients: [] } })),
      api.get('/masterdata/channel-masters').catch(() => ({ data: { channelMasters: [] } })),
      api.get('/admin/teams').catch(() => ({ data: [] })),
    ]).then(([cl, ch, tm]) => {
      setFilterClients(cl.data.clients || []);
      setChannelMasters(ch.data.channelMasters || []);
      setTeams(Array.isArray(tm.data) ? tm.data : []);
    });
  }, []);

  const agencyOptions = useMemo(() => {
    const m = new Map();
    filterClients.forEach((c) => { if (c.agencyId) m.set(c.agencyId, c.agencyName); });
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [filterClients]);

  const clientOptions = useMemo(() => {
    let list = filterClients;
    if (filters.agencyId) list = list.filter((c) => String(c.agencyId) === String(filters.agencyId));
    return list.slice().sort((a, b) => a.name.localeCompare(b.name));
  }, [filterClients, filters.agencyId]);

  const channelOptions = useMemo(() => {
    let list = channelMasters.filter((c) => c.isActive !== false);
    if (filters.medium) list = list.filter((c) => c.medium === filters.medium);
    return list.slice().sort((a, b) => (MEDIUM_ORDER.indexOf(a.medium) - MEDIUM_ORDER.indexOf(b.medium)) || a.name.localeCompare(b.name));
  }, [channelMasters, filters.medium]);

  // Query params common to every insights endpoint.
  const params = useMemo(() => {
    const p = { year: filters.year, month: filters.month };
    if (filters.agencyId) p.agencyId = filters.agencyId;
    if (filters.clientId) p.clientId = filters.clientId;
    if (filters.medium) p.medium = filters.medium;
    if (filters.channelMasterId) p.channelMasterId = filters.channelMasterId;
    if (filters.teamId) p.teamId = filters.teamId;
    return p;
  }, [filters]);

  // Human-readable list of the applied filters (for headers + exports).
  const appliedFilters = useMemo(() => {
    const rows = [['Forecast month', `${monthName(filters.month)} ${filters.year}`]];
    if (filters.agencyId) rows.push(['Agency', agencyOptions.find((a) => String(a.id) === String(filters.agencyId))?.name || filters.agencyId]);
    if (filters.clientId) rows.push(['Client', filterClients.find((c) => String(c.id) === String(filters.clientId))?.name || filters.clientId]);
    if (filters.medium) rows.push(['Medium', filters.medium]);
    if (filters.channelMasterId) rows.push(['Channel', channelMasters.find((c) => String(c.id) === String(filters.channelMasterId))?.name || filters.channelMasterId]);
    if (filters.teamId) {
      const t = teams.find((x) => String(x.id) === String(filters.teamId));
      rows.push(['Account Manager', t?.head?.name || t?.name || filters.teamId]);
    }
    return rows;
  }, [filters, agencyOptions, filterClients, channelMasters, teams]);

  // Fetch summary whenever filters change (used by Summary + Trends pie).
  useEffect(() => {
    if (sub !== 'summary' && sub !== 'trends') return;
    setLoading(true);
    api.get('/forecasting/insights/summary', { params })
      .then((r) => setSummary(r.data))
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
  }, [params, sub]);

  useEffect(() => {
    if (sub !== 'variance') return;
    setLoading(true);
    api.get('/forecasting/insights/variance', { params: { ...params, groupBy: vGroupBy } })
      .then((r) => setVariance(r.data))
      .catch(() => setVariance(null))
      .finally(() => setLoading(false));
  }, [params, sub, vGroupBy]);

  useEffect(() => {
    if (sub !== 'accuracy') return;
    setLoading(true);
    api.get('/forecasting/insights/accuracy', { params })
      .then((r) => setAccuracy(r.data))
      .catch(() => setAccuracy(null))
      .finally(() => setLoading(false));
  }, [params, sub]);

  useEffect(() => {
    if (sub !== 'trends') return;
    setLoading(true);
    api.get('/forecasting/insights/trend', { params: { ...params, months: 12 } })
      .then((r) => setTrend(r.data))
      .catch(() => setTrend(null))
      .finally(() => setLoading(false));
  }, [params, sub]);

  const yearOptions = useMemo(() => {
    const cur = new Date().getFullYear();
    const top = Math.max(cur + 1, def.year);
    const out = [];
    for (let y = top; y >= cur - 3; y--) out.push(y);
    return out;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setF = (patch) => setFilters((p) => ({ ...p, ...patch }));
  const resetFilters = () => setFilters({ year: def.year, month: def.month, agencyId: '', clientId: '', medium: '', channelMasterId: '', teamId: '' });

  const sortArrow = (active, dir) => (active ? (dir === 'asc' ? ' ▲' : ' ▼') : '');

  // ── Summary derived ──
  const summaryClients = useMemo(() => {
    if (!summary) return [];
    let list = summary.clients || [];
    if (clientSearch.trim()) {
      const q = clientSearch.toLowerCase();
      list = list.filter((c) => c.clientName.toLowerCase().includes(q) || (c.agencyName || '').toLowerCase().includes(q) || (c.accountManager || '').toLowerCase().includes(q));
    }
    const dir = sortDir === 'asc' ? 1 : -1;
    return list.slice().sort((a, b) => {
      const va = a[sortKey], vb = b[sortKey];
      if (typeof va === 'string') return va.localeCompare(vb) * dir;
      return ((va ?? 0) - (vb ?? 0)) * dir;
    });
  }, [summary, clientSearch, sortKey, sortDir]);

  const varianceRows = useMemo(() => {
    if (!variance) return [];
    const dir = vSortDir === 'asc' ? 1 : -1;
    return (variance.rows || []).slice().sort((a, b) => {
      const va = a[vSortKey], vb = b[vSortKey];
      if (typeof va === 'string') return va.localeCompare(vb) * dir;
      return ((va ?? 0) - (vb ?? 0)) * dir;
    });
  }, [variance, vSortKey, vSortDir]);

  // ── Exports ──
  const filterSheet = { name: 'Filters', rows: [['Forecasting Insights'], [], ...appliedFilters, ['Generated', new Date().toLocaleString('en-GB')]] };
  const baseName = `forecast-insights-${filters.year}-${String(filters.month).padStart(2, '0')}`;

  const summarySheets = () => {
    const clientRows = [
      ['Client', 'Account Manager', 'Agency', 'Forecast Month', 'Total Forecast (M LKR)', 'Status'],
      ...summaryClients.map((c) => [c.clientName, c.accountManager, c.agencyName, `${monthName(c.month)} ${c.year}`, c.totalForecastMillions, c.status === 'submitted' ? 'Submitted' : 'Pending']),
      ['TOTAL', '', '', '', summary?.totalForecastMillions ?? 0, ''],
    ];
    const chRows = [
      ['Medium', 'Forecast (M LKR)', '% of Total'],
      ...(summary?.channelBreakdown || []).map((m) => [m.medium, m.forecastMillions, `${m.pctOfTotal}%`]),
      ['TOTAL', summary?.channelBreakdownTotalMillions ?? 0, '100%'],
    ];
    return [filterSheet, { name: 'Client Forecast', rows: clientRows }, { name: 'Channel Breakdown', rows: chRows }];
  };

  const varianceSheets = () => {
    const head = vGroupBy === 'client'
      ? ['Client', 'Account Manager', 'Agency', 'Forecast (M)', 'Actual (M)', 'Variance (M)', 'Variance %']
      : ['Channel', 'Medium', 'Forecast (M)', 'Actual (M)', 'Variance (M)', 'Variance %'];
    const body = varianceRows.map((r) => vGroupBy === 'client'
      ? [r.clientName, r.accountManager, r.agencyName, r.forecastMillions, r.actualMillions, r.varianceMillions, r.variancePct == null ? '—' : `${r.variancePct}%`]
      : [r.channelName, r.medium, r.forecastMillions, r.actualMillions, r.varianceMillions, r.variancePct == null ? '—' : `${r.variancePct}%`]);
    const totalRow = vGroupBy === 'client'
      ? ['TOTAL', '', '', variance?.totals.forecastMillions ?? 0, variance?.totals.actualMillions ?? 0, variance?.totals.varianceMillions ?? 0, variance?.totals.variancePct == null ? '—' : `${variance.totals.variancePct}%`]
      : ['TOTAL', '', variance?.totals.forecastMillions ?? 0, variance?.totals.actualMillions ?? 0, variance?.totals.varianceMillions ?? 0, variance?.totals.variancePct == null ? '—' : `${variance.totals.variancePct}%`];
    return [filterSheet, { name: 'Forecast vs Actual', rows: [head, ...body, totalRow] }];
  };

  const accuracySheets = () => {
    const t = accuracy?.totals || {};
    const rows = [
      ['Metric', 'Value'],
      ['Total Forecast (M LKR)', t.forecastMillions ?? 0],
      ['Total Actual (M LKR)', t.actualMillions ?? 0],
      ['Total Variance (M LKR)', t.varianceMillions ?? 0],
      ['Forecast Accuracy %', t.forecastAccuracyPct == null ? '—' : `${t.forecastAccuracyPct}%`],
      [],
      ['Best Forecasting Client', accuracy?.bestClient ? `${accuracy.bestClient.clientName} (${accuracy.bestClient.accuracyPct}%)` : '—'],
      ['Least Accurate Client', accuracy?.leastAccurateClient ? `${accuracy.leastAccurateClient.clientName} (${accuracy.leastAccurateClient.accuracyPct}%)` : '—'],
      ['Highest Spending Client', accuracy?.highestSpendingClient ? `${accuracy.highestSpendingClient.clientName} (${fmtM(accuracy.highestSpendingClient.actualMillions)})` : '—'],
    ];
    return [filterSheet, { name: 'Accuracy', rows }];
  };

  const trendSheets = () => {
    const monthRows = [
      ['Month', 'Forecast (M)', 'Actual (M)', 'Variance (M)', 'Growth % (vs prev)'],
      ...(trend?.months || []).map((m) => [m.label, m.forecastMillions, m.actualMillions, m.varianceMillions, m.growthPct == null ? '—' : `${m.growthPct}%`]),
    ];
    const topChRows = [['Channel', 'Medium', 'Actual (M)'], ...(trend?.topChannels || []).map((c) => [c.channelName, c.medium, c.actualMillions])];
    const topClRows = [['Client', 'Actual (M)'], ...(trend?.topClients || []).map((c) => [c.clientName, c.actualMillions])];
    return [filterSheet, { name: 'Monthly Trend', rows: monthRows }, { name: 'Top Channels', rows: topChRows }, { name: 'Top Clients', rows: topClRows }];
  };

  const sheetsForSub = () => (sub === 'summary' ? summarySheets() : sub === 'variance' ? varianceSheets() : sub === 'accuracy' ? accuracySheets() : trendSheets());

  const onExcel = () => downloadXLSX(sheetsForSub(), `${baseName}-${sub}`);
  const onCsv = () => downloadCSV(sheetsForSub(), `${baseName}-${sub}`);

  const onPdf = async () => {
    setPdfBusy(true);
    try {
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageW = pdf.internal.pageSize.getWidth();
      const margin = 15;
      const contentW = pageW - margin * 2;
      const title = sub === 'summary' ? 'Next Month Forecast Summary' : sub === 'variance' ? 'Forecast vs Actual' : sub === 'accuracy' ? 'Forecast Accuracy' : 'Trend Analysis';
      pdf.setFontSize(18); pdf.setTextColor(30, 58, 95); pdf.text(`Forecasting · ${title}`, margin, 20);
      pdf.setFontSize(9); pdf.setTextColor(100);
      pdf.text(appliedFilters.map((f) => `${f[0]}: ${f[1]}`).join('   |   '), margin, 27, { maxWidth: contentW });
      pdf.setDrawColor(232, 93, 36); pdf.setLineWidth(0.5); pdf.line(margin, 30, pageW - margin, 30);

      const tableStyles = { styles: { fontSize: 8, cellPadding: 2 }, headStyles: { fillColor: [30, 58, 95], textColor: 255, fontStyle: 'bold' }, margin: { left: margin, right: margin } };

      if (sub === 'summary') {
        const s = summarySheets();
        autoTable(pdf, { startY: 35, head: [s[1].rows[0]], body: s[1].rows.slice(1), ...tableStyles });
        autoTable(pdf, { startY: pdf.lastAutoTable.finalY + 8, head: [s[2].rows[0]], body: s[2].rows.slice(1), ...tableStyles });
      } else if (sub === 'variance') {
        const s = varianceSheets();
        autoTable(pdf, { startY: 35, head: [s[1].rows[0]], body: s[1].rows.slice(1), ...tableStyles });
      } else if (sub === 'accuracy') {
        const s = accuracySheets();
        autoTable(pdf, { startY: 35, head: [s[1].rows[0]], body: s[1].rows.slice(1), ...tableStyles });
      } else {
        const captureChart = async (ref) => {
          if (!ref?.current) return null;
          const canvas = await html2canvas(ref.current, { scale: 2, backgroundColor: '#ffffff', logging: false });
          return { src: canvas.toDataURL('image/png'), w: canvas.width, h: canvas.height };
        };
        const addChart = (chart, y, maxW, maxH) => {
          if (!chart) return y;
          const ratio = chart.w / chart.h;
          let imgW = maxW, imgH = imgW / ratio;
          if (imgH > maxH) { imgH = maxH; imgW = imgH * ratio; }
          pdf.addImage(chart.src, 'PNG', margin + (maxW - imgW) / 2, y, imgW, imgH);
          return y + imgH;
        };
        let y = 36;
        const c1 = await captureChart(chartFvA);
        y = addChart(c1, y, contentW, 80) + 4;
        const c2 = await captureChart(chartVar);
        y = addChart(c2, y, contentW, 70) + 6;
        const s = trendSheets();
        autoTable(pdf, { startY: y, head: [s[1].rows[0]], body: s[1].rows.slice(1), ...tableStyles });
        pdf.addPage();
        autoTable(pdf, { startY: 20, head: [s[2].rows[0]], body: s[2].rows.slice(1), ...tableStyles });
        autoTable(pdf, { startY: pdf.lastAutoTable.finalY + 8, head: [s[3].rows[0]], body: s[3].rows.slice(1), ...tableStyles });
      }
      pdf.save(`${baseName}-${sub}.pdf`);
    } catch (e) {
      console.error('PDF export failed', e);
    } finally {
      setPdfBusy(false);
    }
  };

  const tooltipStyle = { borderRadius: 9, border: '1px solid #E5E8ED', fontSize: 12 };
  const axisTick = { fontSize: 11, fill: '#93A0B5' };

  return (
    <div>
      {/* Filter bar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', background: '#fff', border: '1px solid #E5E8ED', borderRadius: 14, padding: 14, marginBottom: 16 }}>
        <FilterField label="Year">
          <select className="select" value={filters.year} onChange={(e) => setF({ year: Number(e.target.value) })} style={{ minWidth: 100 }}>
            {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </FilterField>
        <FilterField label="Month">
          <select className="select" value={filters.month} onChange={(e) => setF({ month: Number(e.target.value) })} style={{ minWidth: 130 }}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </FilterField>
        <FilterField label="Agency">
          <select className="select" value={filters.agencyId} onChange={(e) => setF({ agencyId: e.target.value, clientId: '' })} style={{ minWidth: 150 }}>
            <option value="">All agencies</option>
            {agencyOptions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </FilterField>
        <FilterField label="Client">
          <select className="select" value={filters.clientId} onChange={(e) => setF({ clientId: e.target.value })} style={{ minWidth: 160 }}>
            <option value="">All clients</option>
            {clientOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </FilterField>
        <FilterField label="Medium">
          <select className="select" value={filters.medium} onChange={(e) => setF({ medium: e.target.value, channelMasterId: '' })} style={{ minWidth: 110 }}>
            <option value="">All media</option>
            {MEDIUM_ORDER.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </FilterField>
        <FilterField label="Channel">
          <select className="select" value={filters.channelMasterId} onChange={(e) => setF({ channelMasterId: e.target.value })} style={{ minWidth: 150 }}>
            <option value="">All channels</option>
            {channelOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </FilterField>
        <FilterField label="Account Manager">
          <select className="select" value={filters.teamId} onChange={(e) => setF({ teamId: e.target.value })} style={{ minWidth: 160 }}>
            <option value="">All managers</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.head?.name || t.name}</option>)}
          </select>
        </FilterField>
        <button className="btn btn-ghost btn-sm" onClick={resetFilters} style={{ marginLeft: 'auto' }}><Icon name="x" size={13} /> Reset</button>
      </div>

      {/* Sub-tabs + export */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', background: '#EEF0F3', border: '1px solid #E5E8ED', borderRadius: 10, padding: 3 }}>
          {[['summary', 'Summary'], ['variance', 'Forecast vs Actual'], ['accuracy', 'Accuracy'], ['trends', 'Trends']].map(([k, label]) => (
            <button key={k} onClick={() => setSub(k)} style={{ border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, padding: '6px 14px', borderRadius: 7, fontFamily: 'inherit', background: sub === k ? '#fff' : 'transparent', color: sub === k ? '#16243C' : '#6B7790', boxShadow: sub === k ? '0 1px 2px rgba(15,31,61,.08)' : 'none' }}>{label}</button>
          ))}
        </div>
        <ExportButtons onExcel={onExcel} onCsv={onCsv} onPdf={onPdf} busy={pdfBusy} />
      </div>

      {loading ? <OrbitLoader label="Loading insights…" /> : (
        <>
          {/* ── SUMMARY ── */}
          {sub === 'summary' && (
            <div style={{ display: 'grid', gap: 16 }}>
              <Card title="Client-wise Forecast" right={(
                <div style={{ position: 'relative' }}>
                  <Icon name="search" size={14} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
                  <input className="input" placeholder="Search…" value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} style={{ paddingLeft: 30, height: 32, maxWidth: 220, fontSize: 12.5 }} />
                </div>
              )}>
                {summaryClients.length === 0 ? <Empty /> : (
                  <table className="tbl" style={{ fontSize: 12.5 }}>
                    <thead><tr>
                      <Th onClick={() => toggleSort('clientName')}>Client{sortArrow(sortKey === 'clientName', sortDir)}</Th>
                      <Th onClick={() => toggleSort('accountManager')}>Account Manager{sortArrow(sortKey === 'accountManager', sortDir)}</Th>
                      <Th onClick={() => toggleSort('agencyName')}>Agency{sortArrow(sortKey === 'agencyName', sortDir)}</Th>
                      <Th onClick={() => toggleSort('totalForecastMillions')} right>Total Forecast{sortArrow(sortKey === 'totalForecastMillions', sortDir)}</Th>
                      <Th onClick={() => toggleSort('status')}>Status{sortArrow(sortKey === 'status', sortDir)}</Th>
                    </tr></thead>
                    <tbody>
                      {summaryClients.map((c) => {
                        const st = STATUS[c.status] || STATUS.none;
                        return (
                          <tr key={c.clientId}>
                            <td className="strong">{c.clientName}</td>
                            <td>{c.accountManager}</td>
                            <td>{c.agencyName || '—'}</td>
                            <td className="mono" style={{ textAlign: 'right' }}>{fmtM(c.totalForecastMillions)}</td>
                            <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#6B7790' }}><span style={{ width: 9, height: 9, borderRadius: '50%', background: st.dot }} />{st.label}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot><tr style={{ fontWeight: 700 }}><td colSpan={3}>Total ({summaryClients.length})</td><td className="mono" style={{ textAlign: 'right' }}>{fmtM(summary?.totalForecastMillions)}</td><td /></tr></tfoot>
                  </table>
                )}
              </Card>

              <Card title="Channel-wise Forecast (by medium)">
                {(summary?.channelBreakdown || []).length === 0 ? <Empty /> : (
                  <table className="tbl" style={{ fontSize: 12.5 }}>
                    <thead><tr><th>Medium</th><th style={{ textAlign: 'right' }}>Forecast</th><th style={{ width: '40%' }}>% of Total</th></tr></thead>
                    <tbody>
                      {summary.channelBreakdown.map((m) => (
                        <tr key={m.medium}>
                          <td><span className="medium-tag" data-medium={m.medium}>{m.medium}</span></td>
                          <td className="mono" style={{ textAlign: 'right' }}>{fmtM(m.forecastMillions)}</td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ flex: 1, height: 8, borderRadius: 4, background: '#EEF0F3', overflow: 'hidden' }}>
                                <div style={{ width: `${m.pctOfTotal}%`, height: '100%', background: MEDIUM_COLORS[m.medium] || '#1e3a5f' }} />
                              </div>
                              <span className="mono" style={{ fontSize: 11.5, width: 44, textAlign: 'right' }}>{m.pctOfTotal}%</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot><tr style={{ fontWeight: 700 }}><td>Total</td><td className="mono" style={{ textAlign: 'right' }}>{fmtM(summary?.channelBreakdownTotalMillions)}</td><td>100%</td></tr></tfoot>
                  </table>
                )}
              </Card>
            </div>
          )}

          {/* ── FORECAST VS ACTUAL ── */}
          {sub === 'variance' && (
            <Card title={`Forecast vs Actual · ${monthName(filters.month)} ${filters.year}`} right={(
              <div style={{ display: 'inline-flex', background: '#EEF0F3', border: '1px solid #E5E8ED', borderRadius: 8, padding: 2 }}>
                {[['client', 'Client-wise'], ['channel', 'Channel-wise']].map(([k, label]) => (
                  <button key={k} onClick={() => setVGroupBy(k)} style={{ border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 6, fontFamily: 'inherit', background: vGroupBy === k ? '#fff' : 'transparent', color: vGroupBy === k ? '#16243C' : '#6B7790' }}>{label}</button>
                ))}
              </div>
            )}>
              {varianceRows.length === 0 ? <Empty text="No forecast or actual data for this selection." /> : (
                <table className="tbl" style={{ fontSize: 12.5 }}>
                  <thead><tr>
                    {vGroupBy === 'client' ? <>
                      <Th onClick={() => toggleVSort('clientName')}>Client{sortArrow(vSortKey === 'clientName', vSortDir)}</Th>
                      <Th onClick={() => toggleVSort('accountManager')}>Account Manager{sortArrow(vSortKey === 'accountManager', vSortDir)}</Th>
                    </> : <>
                      <Th onClick={() => toggleVSort('channelName')}>Channel{sortArrow(vSortKey === 'channelName', vSortDir)}</Th>
                      <Th onClick={() => toggleVSort('medium')}>Medium{sortArrow(vSortKey === 'medium', vSortDir)}</Th>
                    </>}
                    <Th onClick={() => toggleVSort('forecastMillions')} right>Forecast{sortArrow(vSortKey === 'forecastMillions', vSortDir)}</Th>
                    <Th onClick={() => toggleVSort('actualMillions')} right>Actual{sortArrow(vSortKey === 'actualMillions', vSortDir)}</Th>
                    <Th onClick={() => toggleVSort('varianceMillions')} right>Variance{sortArrow(vSortKey === 'varianceMillions', vSortDir)}</Th>
                    <Th onClick={() => toggleVSort('variancePct')} right>Variance %{sortArrow(vSortKey === 'variancePct', vSortDir)}</Th>
                  </tr></thead>
                  <tbody>
                    {varianceRows.map((r, i) => (
                      <tr key={i}>
                        {vGroupBy === 'client' ? <>
                          <td className="strong">{r.clientName}</td>
                          <td>{r.accountManager}</td>
                        </> : <>
                          <td className="strong">{r.channelName}</td>
                          <td>{r.medium ? <span className="medium-tag" data-medium={r.medium}>{r.medium}</span> : '—'}</td>
                        </>}
                        <td className="mono" style={{ textAlign: 'right' }}>{fmtM(r.forecastMillions)}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{fmtM(r.actualMillions)}</td>
                        <td className="mono" style={{ textAlign: 'right', color: varianceColor(r.flag) }}>{r.varianceMillions > 0 ? '+' : ''}{fmtM(r.varianceMillions)}</td>
                        <td className="mono" style={{ textAlign: 'right', color: varianceColor(r.flag) }}>{r.variancePct == null ? '—' : `${r.variancePct > 0 ? '+' : ''}${fmtPct(r.variancePct)}`}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ fontWeight: 700 }}>
                      <td colSpan={2}>Total</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{fmtM(variance.totals.forecastMillions)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{fmtM(variance.totals.actualMillions)}</td>
                      <td className="mono" style={{ textAlign: 'right', color: variance.totals.varianceMillions >= 0 ? 'var(--green-600)' : 'var(--red-600)' }}>{variance.totals.varianceMillions > 0 ? '+' : ''}{fmtM(variance.totals.varianceMillions)}</td>
                      <td className="mono" style={{ textAlign: 'right', color: variance.totals.varianceMillions >= 0 ? 'var(--green-600)' : 'var(--red-600)' }}>{variance.totals.variancePct == null ? '—' : `${variance.totals.variancePct > 0 ? '+' : ''}${fmtPct(variance.totals.variancePct)}`}</td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </Card>
          )}

          {/* ── ACCURACY ── */}
          {sub === 'accuracy' && accuracy && (
            <div style={{ display: 'grid', gap: 16 }}>
              <div className="summary-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                <Stat label="Total Forecast" value={fmtM(accuracy.totals.forecastMillions)} />
                <Stat label="Total Actual" value={fmtM(accuracy.totals.actualMillions)} />
                <Stat label="Total Variance" value={`${accuracy.totals.varianceMillions > 0 ? '+' : ''}${fmtM(accuracy.totals.varianceMillions)}`} color={accuracy.totals.varianceMillions >= 0 ? 'var(--green-600)' : 'var(--red-600)'} />
                <Stat label="Forecast Accuracy" value={accuracy.totals.forecastAccuracyPct == null ? '—' : `${accuracy.totals.forecastAccuracyPct}%`} color="#1e3a5f" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
                <HighlightCard label="Best Forecasting Client" name={accuracy.bestClient?.clientName} sub={accuracy.bestClient ? `${accuracy.bestClient.accuracyPct}% accurate` : null} color="#15814B" />
                <HighlightCard label="Least Accurate Client" name={accuracy.leastAccurateClient?.clientName} sub={accuracy.leastAccurateClient ? `${accuracy.leastAccurateClient.accuracyPct}% accurate` : null} color="#C5391F" />
                <HighlightCard label="Highest Spending Client" name={accuracy.highestSpendingClient?.clientName} sub={accuracy.highestSpendingClient ? `${fmtM(accuracy.highestSpendingClient.actualMillions)} actual` : null} color="#1F5BB5" />
              </div>
            </div>
          )}

          {/* ── TRENDS ── */}
          {sub === 'trends' && trend && (
            <div style={{ display: 'grid', gap: 16 }}>
              <Card title="Forecast vs Actual — monthly">
                <div ref={chartFvA} style={{ width: '100%', height: 300 }}>
                  <ResponsiveContainer>
                    <ComposedChart data={trend.months} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F3" vertical={false} />
                      <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: '#E5E8ED' }} />
                      <YAxis tick={axisTick} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtM(v)} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar name="Forecast" dataKey="forecastMillions" fill="#1e3a5f" radius={[4, 4, 0, 0]} maxBarSize={36} />
                      <Line name="Actual" type="monotone" dataKey="actualMillions" stroke="#E85D24" strokeWidth={2.5} dot={{ r: 3 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
                <Card title="Monthly Variance">
                  <div ref={chartVar} style={{ width: '100%', height: 260 }}>
                    <ResponsiveContainer>
                      <LineChart data={trend.months} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F3" vertical={false} />
                        <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: '#E5E8ED' }} />
                        <YAxis tick={axisTick} tickLine={false} axisLine={false} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtM(v)} />
                        <Line name="Variance" type="monotone" dataKey="varianceMillions" stroke="#6B3FB5" strokeWidth={2.5} dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </Card>

                <Card title="Forecast Medium Split">
                  <div ref={chartPie} style={{ width: '100%', height: 260 }}>
                    {(summary?.channelBreakdown || []).length === 0 ? <Empty /> : (
                      <ResponsiveContainer>
                        <PieChart>
                          <Pie data={summary.channelBreakdown} dataKey="forecastMillions" nameKey="medium" cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={2}>
                            {summary.channelBreakdown.map((m) => <Cell key={m.medium} fill={MEDIUM_COLORS[m.medium] || '#1e3a5f'} />)}
                          </Pie>
                          <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtM(v)} />
                          <Legend wrapperStyle={{ fontSize: 12 }} />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </Card>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
                <Card title="Top 10 Channels by Actual Spend">
                  <div ref={chartTopCh} style={{ width: '100%', height: 300 }}>
                    {(trend.topChannels || []).length === 0 ? <Empty /> : (
                      <ResponsiveContainer>
                        <BarChart data={trend.topChannels} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F3" horizontal={false} />
                          <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} />
                          <YAxis type="category" dataKey="channelName" tick={{ fontSize: 10, fill: '#93A0B5' }} tickLine={false} axisLine={false} width={110} />
                          <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtM(v)} />
                          <Bar dataKey="actualMillions" radius={[0, 4, 4, 0]} maxBarSize={22}>
                            {trend.topChannels.map((c, i) => <Cell key={i} fill={MEDIUM_COLORS[c.medium] || CHART_COLORS[i % CHART_COLORS.length]} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </Card>

                <Card title="Top 10 Clients by Actual Spend">
                  <div ref={chartTopCl} style={{ width: '100%', height: 300 }}>
                    {(trend.topClients || []).length === 0 ? <Empty /> : (
                      <ResponsiveContainer>
                        <BarChart data={trend.topClients} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F3" horizontal={false} />
                          <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} />
                          <YAxis type="category" dataKey="clientName" tick={{ fontSize: 10, fill: '#93A0B5' }} tickLine={false} axisLine={false} width={110} />
                          <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtM(v)} />
                          <Bar dataKey="actualMillions" radius={[0, 4, 4, 0]} maxBarSize={22}>
                            {trend.topClients.map((c, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </Card>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FilterField({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase', color: '#93A0B5' }}>{label}</label>
      {children}
    </div>
  );
}

function Card({ title, right, children }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E5E8ED', borderRadius: 14, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#16243C' }}>{title}</div>
        {right}
      </div>
      {children}
    </div>
  );
}

function Th({ children, onClick, right }) {
  return <th onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default', textAlign: right ? 'right' : 'left', userSelect: 'none' }}>{children}</th>;
}

function Stat({ label, value, color }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E5E8ED', borderRadius: 14, padding: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase', color: '#93A0B5', marginBottom: 8 }}>{label}</div>
      <div className="mono" style={{ fontSize: 24, fontWeight: 750, color: color || '#16243C' }}>{value}</div>
    </div>
  );
}

function HighlightCard({ label, name, sub, color }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E5E8ED', borderRadius: 14, padding: 18, borderLeft: `3px solid ${color}` }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase', color: '#93A0B5', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#16243C' }}>{name || '—'}</div>
      {sub && <div style={{ fontSize: 12.5, color: '#6B7790', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function Empty({ text = 'No data for this selection.' }) {
  return <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>{text}</div>;
}

export default function ForecastingPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'SUPER_ADMIN';

  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState({ year: null, month: null });
  const [clients, setClients] = useState([]);
  const [agencyFilter, setAgencyFilter] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  // SUPER_ADMIN can target any month (e.g. backfill June so it's there to
  // copy into July) instead of being locked to the upcoming month.
  const [anchorMonth, setAnchorMonth] = useState(null); // the true "next month", fetched once
  const [selectedPeriod, setSelectedPeriod] = useState(null); // admin override, or null = use anchor

  useEffect(() => {
    if (!isAdmin) return;
    api.get('/forecasting/next-month').then(r => setAnchorMonth({ year: r.data.year, month: r.data.month })).catch(() => {});
  }, [isAdmin]);

  const monthOptions = useMemo(() => {
    if (!anchorMonth) return [];
    const opts = [];
    let y = anchorMonth.year, m = anchorMonth.month;
    for (let i = 0; i < 13; i++) {
      opts.push({ year: y, month: m });
      m -= 1;
      if (m < 1) { m = 12; y -= 1; }
    }
    return opts;
  }, [anchorMonth]);

  // view toggle (admins only): client entry grid vs the Insights analytics suite
  const [view, setView] = useState('clients'); // 'clients' | 'insights'

  // entry modal
  const [active, setActive] = useState(null); // the client being edited/viewed
  const [categories, setCategories] = useState([]);
  const [amounts, setAmounts] = useState({}); // channelMasterId -> { amount, notes }
  const [entryLoading, setEntryLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [entryError, setEntryError] = useState('');
  const [savedMsg, setSavedMsg] = useState('');
  const [channelSearch, setChannelSearch] = useState('');

  // request modal
  const [reqType, setReqType] = useState(null); // 'client' | 'channel'
  const [reqForm, setReqForm] = useState({ name: '', agencyId: '', category: 'TV', notes: '' });
  const [reqSubmitting, setReqSubmitting] = useState(false);
  const [reqError, setReqError] = useState('');
  const [reqMsg, setReqMsg] = useState('');

  const fetchClients = () => {
    setLoading(true);
    const params = {};
    if (agencyFilter) params.agencyId = agencyFilter;
    if (isAdmin && selectedPeriod) { params.year = selectedPeriod.year; params.month = selectedPeriod.month; }
    api.get('/forecasting/clients', { params })
      .then(r => { setClients(r.data.clients || []); setPeriod({ year: r.data.year, month: r.data.month }); })
      .catch(() => setError('Failed to load clients.'))
      .finally(() => setLoading(false));
  };
  useEffect(fetchClients, [agencyFilter, selectedPeriod]);

  const agencies = useMemo(() => {
    const m = new Map();
    clients.forEach(c => { if (c.agencyId) m.set(c.agencyId, c.agencyName); });
    return [...m.entries()].map(([id, name]) => ({ id, name }));
  }, [clients]);

  const filtered = clients.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.agencyName || '').toLowerCase().includes(search.toLowerCase())
  );

  const openEntry = async (client) => {
    setActive(client);
    setEntryError(''); setSavedMsg(''); setChannelSearch('');
    setEntryLoading(true);
    try {
      const entryParams = { clientId: client.id };
      if (isAdmin && selectedPeriod) { entryParams.year = selectedPeriod.year; entryParams.month = selectedPeriod.month; }
      const [chRes, enRes] = await Promise.all([
        api.get('/forecasting/channels'),
        api.get('/forecasting/entry', { params: entryParams }),
      ]);
      setCategories(chRes.data.categories || []);
      const seed = {};
      // Stored in millions; show group heads the full rupee value.
      (enRes.data.items || []).forEach(it => { seed[it.channelMasterId] = { amount: String(Math.round(it.amountMillions * 1e6)), notes: it.notes || '' }; });
      setAmounts(seed);
    } catch {
      setEntryError('Failed to load the forecast.');
    } finally {
      setEntryLoading(false);
    }
  };
  const closeEntry = () => { setActive(null); setCategories([]); setAmounts({}); };

  const setCell = (chId, field, value) => setAmounts(p => ({ ...p, [chId]: { ...p[chId], [field]: value } }));

  const filteredCategories = useMemo(() => {
    if (!channelSearch.trim()) return categories;
    const q = channelSearch.toLowerCase();
    return categories
      .map(cat => ({ ...cat, channels: cat.channels.filter(ch => ch.name.toLowerCase().includes(q)) }))
      .filter(cat => cat.channels.length > 0);
  }, [categories, channelSearch]);

  // Comma-grouped display while typing; raw digits/decimal kept in state.
  const fmtAmountInput = (v) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)))
    ? (v || '')
    : Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const onAmountChange = (chId, raw) => {
    const cleaned = raw.replace(/,/g, '');
    if (cleaned === '' || /^\d*\.?\d*$/.test(cleaned)) setCell(chId, 'amount', cleaned);
  };

  // Copy the client's most recent prior forecast into the inputs to edit.
  const [copying, setCopying] = useState(false);
  const copyLast = async () => {
    setCopying(true); setEntryError(''); setSavedMsg('');
    try {
      const prevParams = { clientId: active.id };
      if (isAdmin && selectedPeriod) { prevParams.year = selectedPeriod.year; prevParams.month = selectedPeriod.month; }
      const { data } = await api.get('/forecasting/previous', { params: prevParams });
      if (!data.found) { setEntryError('No previous forecast to copy yet.'); return; }
      const seed = {};
      data.items.forEach(it => { seed[it.channelMasterId] = { amount: String(Math.round(it.amountMillions * 1e6)), notes: it.notes || '' }; });
      setAmounts(seed);
      setSavedMsg(`Copied ${MONTHS[data.month - 1]} ${data.year} — edit the amounts and submit.`);
    } catch (err) {
      setEntryError(err.response?.data?.error || 'Failed to copy previous forecast.');
    } finally {
      setCopying(false);
    }
  };

  const total = useMemo(() =>
    Object.values(amounts).reduce((s, v) => s + (parseFloat(v?.amount) || 0), 0)
  , [amounts]);

  const submit = async () => {
    setSaving(true); setEntryError(''); setSavedMsg('');
    try {
      const items = Object.entries(amounts)
        // Group heads type the full rupee amount; store it in millions.
        .map(([channelMasterId, v]) => ({ channelMasterId: Number(channelMasterId), amountMillions: parseFloat(v.amount) / 1e6, notes: v.notes }))
        .filter(it => !Number.isNaN(it.amountMillions) && it.amountMillions > 0);
      await api.post('/forecasting/submit', { clientId: active.id, year: period.year, month: period.month, items });
      setSavedMsg('Forecast saved.');
      fetchClients();
      setTimeout(closeEntry, 700);
    } catch (err) {
      setEntryError(err.response?.data?.error || 'Failed to save forecast.');
    } finally {
      setSaving(false);
    }
  };

  const openReq = (type) => { setReqType(type); setReqForm({ name: '', agencyId: '', category: 'TV', notes: '' }); setReqError(''); setReqMsg(''); };
  const submitReq = async () => {
    setReqSubmitting(true); setReqError(''); setReqMsg('');
    try {
      if (reqType === 'client') {
        if (!reqForm.name.trim()) { setReqError('Client name is required.'); setReqSubmitting(false); return; }
        await api.post('/forecasting/request-client', { clientName: reqForm.name.trim(), agencyId: reqForm.agencyId || null, notes: reqForm.notes });
      } else {
        if (!reqForm.name.trim()) { setReqError('Channel name is required.'); setReqSubmitting(false); return; }
        await api.post('/forecasting/request-channel', { channelName: reqForm.name.trim(), category: reqForm.category, notes: reqForm.notes });
      }
      setReqMsg('Request sent to the admin for review.');
      setTimeout(() => setReqType(null), 900);
    } catch (err) {
      setReqError(err.response?.data?.error || 'Failed to send request.');
    } finally {
      setReqSubmitting(false);
    }
  };

  if (loading) return <div className="content-narrow fade-in"><OrbitLoader fullHeight label="Loading forecasting…" /></div>;

  const periodLabel = period.month ? `${MONTHS[period.month - 1]} ${period.year}` : '';

  return (
    <div className="fade-in" style={{ maxWidth: 1320, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-.6px', margin: 0, color: '#16243C' }}>Forecasting</h1>
          <p style={{ fontSize: 13.5, color: '#6B7790', margin: '6px 0 0' }}>
            {view === 'insights' ? 'Forecast accuracy, variance and spend insights' : `Enter the ${periodLabel} forecast for your clients`}
          </p>
        </div>
        {view === 'clients' && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {isAdmin && monthOptions.length > 0 && (
              <select
                className="select"
                value={selectedPeriod ? `${selectedPeriod.year}-${selectedPeriod.month}` : `${anchorMonth.year}-${anchorMonth.month}`}
                onChange={e => {
                  const [y, m] = e.target.value.split('-').map(Number);
                  setSelectedPeriod((y === anchorMonth.year && m === anchorMonth.month) ? null : { year: y, month: m });
                }}
                style={{ maxWidth: 200 }}
                title="Forecast month to enter/view — pick a past month to backfill it, then copy it forward"
              >
                {monthOptions.map(o => (
                  <option key={`${o.year}-${o.month}`} value={`${o.year}-${o.month}`}>
                    {MONTHS[o.month - 1]} {o.year}{o.year === anchorMonth.year && o.month === anchorMonth.month ? ' (upcoming)' : ''}
                  </option>
                ))}
              </select>
            )}
            {isAdmin && agencies.length > 1 && (
              <select className="select" value={agencyFilter} onChange={e => setAgencyFilter(e.target.value)} style={{ maxWidth: 220 }}>
                <option value="">All agencies</option>
                {agencies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            )}
            <div style={{ position: 'relative' }}>
              <Icon name="search" size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
              <input className="input" placeholder="Search clients…" value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 32, maxWidth: 240 }} />
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => openReq('client')}><Icon name="plus" size={14} /> Request client</button>
            <button className="btn btn-ghost btn-sm" onClick={() => openReq('channel')}><Icon name="plus" size={14} /> Request channel</button>
          </div>
        )}
      </div>

      {isAdmin && (
        <div style={{ display: 'inline-flex', background: '#EEF0F3', border: '1px solid #E5E8ED', borderRadius: 10, padding: 3, marginBottom: 18 }}>
          {[['clients', 'Clients'], ['insights', 'Insights']].map(([k, label]) => (
            <button key={k} onClick={() => setView(k)} style={{ border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, padding: '6px 14px', borderRadius: 7, fontFamily: 'inherit', background: view === k ? '#fff' : 'transparent', color: view === k ? '#16243C' : '#6B7790', boxShadow: view === k ? '0 1px 2px rgba(15,31,61,.08)' : 'none' }}>{label}</button>
          ))}
        </div>
      )}

      {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#b91c1c', marginBottom: 16 }}>{error}</div>}

      {isAdmin && view === 'insights' ? (
        <InsightsTab />
      ) : filtered.length === 0 ? (
        <div style={{ padding: '48px 24px', textAlign: 'center', color: '#6B7790', background: '#fff', border: '1px solid #E5E8ED', borderRadius: 14 }}>No clients available.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(248px, 1fr))', gap: 16 }}>
          {filtered.map((c, i) => {
            const st = STATUS[c.status] || STATUS.none;
            const color = AVATAR[(c.name.charCodeAt(0) + i) % AVATAR.length];
            return (
              <div key={c.id} role="button" tabIndex={0} onClick={() => openEntry(c)}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#C7D0DD'; e.currentTarget.style.boxShadow = '0 10px 26px rgba(15,31,61,.10)'; e.currentTarget.style.transform = 'translateY(-3px)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#E5E8ED'; e.currentTarget.style.boxShadow = '0 1px 2px rgba(15,31,61,.06)'; e.currentTarget.style.transform = 'none'; }}
                style={{ position: 'relative', overflow: 'hidden', background: '#fff', border: '1px solid #E5E8ED', borderRadius: 14, boxShadow: '0 1px 2px rgba(15,31,61,.06)', padding: 20, cursor: 'pointer', transition: 'transform .16s ease, box-shadow .16s ease, border-color .16s ease' }}>
                <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${color}, ${color}1A 70%, transparent)` }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
                  <div style={{ width: 42, height: 42, borderRadius: 12, background: `linear-gradient(135deg, ${color}, ${color}CC)`, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 750, fontSize: 17, flex: 'none', boxShadow: `0 2px 8px ${color}55` }}>{c.name[0]?.toUpperCase()}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: '#16243C', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.name}>{c.name}</div>
                    <div style={{ fontSize: 11.5, color: '#93A0B5', marginTop: 2 }}>{c.agencyName || '-'}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#6B7790' }}>
                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: st.dot }} />{st.label}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: '#D9521C' }}>Enter <Icon name="chevR" size={14} /></span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Entry / history modal */}
      {active && (
        <div className="modal-scrim show" onClick={e => { if (e.target === e.currentTarget) closeEntry(); }}>
          <div className="modal" style={{ maxWidth: 760, width: '92vw' }} onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h2 style={{ margin: 0 }}>{active.name}</h2>
                <p style={{ margin: '3px 0 0', fontSize: 12.5, color: 'var(--muted)' }}>{periodLabel} forecast · enter amounts in LKR</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {!entryLoading && (
                  <button className="btn btn-ghost btn-sm" onClick={copyLast} disabled={copying}>
                    <Icon name="history" size={14} /> {copying ? 'Copying…' : 'Copy last month'}
                  </button>
                )}
                <button className="act-btn" onClick={closeEntry}><Icon name="x" size={18} /></button>
              </div>
            </div>
            <div className="modal-body" style={{ maxHeight: '64vh', overflow: 'auto' }}>
              {entryError && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#b91c1c', marginBottom: 14 }}>{entryError}</div>}
              {savedMsg && <div style={{ background: '#ECF8F1', border: '1px solid #cdebd9', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#15814B', marginBottom: 14 }}>{savedMsg}</div>}
              {entryLoading ? <OrbitLoader label="Loading…" /> : (
                <>
                  {categories.length > 0 && (
                    <div style={{ position: 'relative', marginBottom: 16 }}>
                      <Icon name="search" size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
                      <input className="input" placeholder="Search channels…" value={channelSearch} onChange={e => setChannelSearch(e.target.value)} style={{ paddingLeft: 32 }} />
                    </div>
                  )}
                  {filteredCategories.map(cat => (
                    <div key={cat.category} style={{ marginBottom: 18 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: '#93A0B5', margin: '0 0 6px 2px' }}>{cat.category}</div>
                      <table className="tbl" style={{ fontSize: 12.5 }}>
                        <thead><tr><th style={{ width: '42%', position: 'static' }}>Channel</th><th style={{ width: '26%', position: 'static' }}>Amount (LKR)</th><th style={{ position: 'static' }}>Notes</th></tr></thead>
                        <tbody>
                          {cat.channels.map(ch => (
                            <tr key={ch.id}>
                              <td>{ch.name}</td>
                              <td>
                                <input className="input" type="text" inputMode="decimal" value={fmtAmountInput(amounts[ch.id]?.amount)} onChange={e => onAmountChange(ch.id, e.target.value)} placeholder="e.g. 100,000,000" style={{ height: 32, fontSize: 12.5 }} />
                              </td>
                              <td>
                                <input className="input" type="text" value={amounts[ch.id]?.notes || ''} onChange={e => setCell(ch.id, 'notes', e.target.value)} placeholder="optional" style={{ height: 32, fontSize: 12.5 }} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                  {categories.length === 0 && <div style={{ padding: '30px 0', textAlign: 'center', color: 'var(--muted)' }}>No active channels configured.</div>}
                  {categories.length > 0 && filteredCategories.length === 0 && <div style={{ padding: '30px 0', textAlign: 'center', color: 'var(--muted)' }}>No channels match "{channelSearch}".</div>}
                </>
              )}
            </div>
            <div className="modal-foot" style={{ justifyContent: 'space-between' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#16243C' }}>Total: <span className="mono">LKR {Math.round(total).toLocaleString('en-US')}</span></div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-ghost" onClick={closeEntry}>Cancel</button>
                <button className="btn btn-primary" onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Submit forecast'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Request new client / channel */}
      {reqType && (
        <div className="modal-scrim show" onClick={e => { if (e.target === e.currentTarget) setReqType(null); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2 style={{ margin: 0 }}>{reqType === 'client' ? 'Request new client' : 'Request new channel'}</h2>
              <button className="act-btn" onClick={() => setReqType(null)}><Icon name="x" size={18} /></button>
            </div>
            <div className="modal-body">
              {reqError && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#b91c1c', marginBottom: 14 }}>{reqError}</div>}
              {reqMsg && <div style={{ background: '#ECF8F1', border: '1px solid #cdebd9', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#15814B', marginBottom: 14 }}>{reqMsg}</div>}
              <div className="field">
                <label className="field-label">{reqType === 'client' ? 'Client name' : 'Channel name'} <span className="req">*</span></label>
                <input className="input" value={reqForm.name} onChange={e => setReqForm(p => ({ ...p, name: e.target.value }))} autoFocus />
              </div>
              {reqType === 'client' ? (
                agencies.length > 0 && (
                  <div className="field">
                    <label className="field-label">Agency (optional)</label>
                    <select className="select" value={reqForm.agencyId} onChange={e => setReqForm(p => ({ ...p, agencyId: e.target.value }))}>
                      <option value="">No preference</option>
                      {agencies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>
                )
              ) : (
                <div className="field">
                  <label className="field-label">Category <span className="req">*</span></label>
                  <select className="select" value={reqForm.category} onChange={e => setReqForm(p => ({ ...p, category: e.target.value }))}>
                    {['TV', 'RADIO', 'PRINT', 'DIGITAL', 'CINEMA', 'OOH'].map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              )}
              <div className="field">
                <label className="field-label">Notes (optional)</label>
                <input className="input" value={reqForm.notes} onChange={e => setReqForm(p => ({ ...p, notes: e.target.value }))} placeholder="Any context for the admin" />
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={() => setReqType(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={submitReq} disabled={reqSubmitting}>{reqSubmitting ? 'Sending…' : 'Send request'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
