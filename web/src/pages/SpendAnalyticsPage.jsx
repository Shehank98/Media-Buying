import { useState, useEffect, useMemo, useRef, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { canExport } from '../lib/permissions';
import Icon from '../components/Icon';
import OrbitLoader from '../components/OrbitLoader';
import api from '../lib/api';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';
import {
  BarChart, Bar, PieChart, Pie, Cell, LineChart, Line, Area, AreaChart, ComposedChart,
  ScatterChart, Scatter, ZAxis, ReferenceLine,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Brush,
} from 'recharts';

const COLORS = ['#1e3a5f', '#E85D24', '#059669', '#7c3aed', '#0ea5e9', '#d97706', '#dc2626', '#6366f1', '#14b8a6', '#f43f5e'];
const MEDIUM_COLORS = { TV: '#1e3a5f', RADIO: '#E85D24', PRINT: '#059669', DIGITAL: '#6B3FB5', CINEMA: '#C2185B', OOH: '#0E7490' };

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtMonth(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  return `${MONTHS[parseInt(m) - 1]} ${y}`;
}
function fmtLKR(v) {
  if (v == null || v === '') return '-';
  const n = Number(v) || 0; const a = Math.abs(n);
  if (a >= 1e9) return 'LKR ' + (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return 'LKR ' + (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return 'LKR ' + (n / 1e3).toFixed(1) + 'K';
  return 'LKR ' + Math.round(n).toLocaleString('en-US');
}
function fmtShort(v) {
  const n = Number(v);
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return n.toFixed(0);
}
function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return `${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
}

export default function SpendAnalyticsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const [agencies, setAgencies] = useState([]);
  const [clients, setClients] = useState([]);
  const [agencyId, setAgencyId] = useState('');
  const [clientId, setClientId] = useState('');
  const [monthFrom, setMonthFrom] = useState('');
  const [monthTo, setMonthTo] = useState('');
  const [mediumFilter, setMediumFilter] = useState(''); // cross-filter: click a medium to filter channels
  const [expandedGroups, setExpandedGroups] = useState(() => new Set()); // media groups expanded to show channel rows
  const [paretoMode, setParetoMode] = useState('channel'); // 'channel' | 'client'
  const [compare, setCompare] = useState(false);
  const [cmpFrom, setCmpFrom] = useState('');
  const [cmpTo, setCmpTo] = useState('');
  const [cmpData, setCmpData] = useState(null);

  const chartMonthlyRef = useRef(null);
  const chartMediumRef = useRef(null);
  const chartMediaGroupRef = useRef(null);
  const chartChannelRef = useRef(null);

  useEffect(() => {
    api.get('/agencies').then(r => {
      const list = r.data.agencies || r.data || [];
      setAgencies(Array.isArray(list) ? list : []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!agencyId) { setClients([]); setClientId(''); return; }
    api.get(`/agencies/${agencyId}/clients`).then(r => {
      const list = r.data.clients || r.data || [];
      setClients(Array.isArray(list) ? list : []);
      setClientId('');
    }).catch(() => setClients([]));
  }, [agencyId]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const params = {};
        if (monthFrom) params.monthFrom = monthFrom;
        if (monthTo) params.monthTo = monthTo;
        if (agencyId) params.agencyId = agencyId;
        if (clientId) params.clientId = clientId;
        const { data } = await api.get('/database/analytics', { params });
        setData(data);
      } catch {
        setError('Failed to load analytics data.');
        setData(null);
      }
      setLoading(false);
    };
    load();
  }, [monthFrom, monthTo, agencyId, clientId]);

  // Deals & properties for the accessible clients (not month-dependent).
  useEffect(() => {
    const params = {};
    if (agencyId) params.agencyId = agencyId;
    if (clientId) params.clientId = clientId;
    api.get('/database/properties', { params })
      .then(({ data }) => setProperties(data.properties || []))
      .catch(() => setProperties([]));
  }, [agencyId, clientId]);

  // Comparison period (Period B)
  useEffect(() => {
    if (!compare) { setCmpData(null); return; }
    const params = {};
    if (cmpFrom) params.monthFrom = cmpFrom;
    if (cmpTo) params.monthTo = cmpTo;
    if (agencyId) params.agencyId = agencyId;
    if (clientId) params.clientId = clientId;
    api.get('/database/analytics', { params }).then(({ data }) => setCmpData(data)).catch(() => setCmpData(null));
  }, [compare, cmpFrom, cmpTo, agencyId, clientId]);

  const chartMonthly = useMemo(() => {
    if (!data?.byMonth) return [];
    let run = 0;
    return data.byMonth.map(m => {
      run += m.value || 0;
      return {
        ...m,
        label: fmtMonth(m.month),
        valueMil: Math.round(m.value / 1000),
        cumulative: run,
      };
    });
  }, [data]);

  // Monthly Spend Trend pivoted: X axis = Jan–Dec, one series (line) per year.
  const monthlyByYear = useMemo(() => {
    if (!data?.byMonth?.length) return { years: [], rows: [] };
    const years = [...new Set(data.byMonth.map(m => String(m.month).slice(0, 4)))].sort();
    const rows = MONTHS.map((label, i) => ({ monthNum: i + 1, label }));
    for (const m of data.byMonth) {
      const [y, mm] = String(m.month).split('-');
      const idx = parseInt(mm, 10) - 1;
      if (idx >= 0 && idx < 12) rows[idx][y] = (rows[idx][y] || 0) + (m.value || 0);
    }
    return { years, rows };
  }, [data]);

  // Derived insights
  const insights = useMemo(() => {
    if (!data) return null;
    const months = data.byMonth?.length || 0;
    const avgMonth = months ? data.totalValue / months : 0;
    const peak = (data.byMonth || []).reduce((a, b) => (b.value > (a?.value || 0) ? b : a), null);
    const topChannel = data.byChannel?.[0] || null;
    const topClient = data.byClient?.[0] || null;
    return { months, avgMonth, peak, topChannel, topClient };
  }, [data]);

  // Pareto: top 20 of channels/clients with running cumulative % of total
  const paretoData = useMemo(() => {
    if (!data) return [];
    const src = paretoMode === 'client' ? (data.byClient || []) : (data.byChannel || []);
    const total = data.totalValue || src.reduce((s, x) => s + (x.value || 0), 0) || 1;
    let run = 0;
    return src.slice(0, 20).map((x) => {
      run += x.value || 0;
      return { name: x.name, value: x.value, medium: x.medium, cumPct: Number(((run / total) * 100).toFixed(1)) };
    });
  }, [data, paretoMode]);

  // How many entries make up 80% of spend (the "vital few")
  const paretoVitalFew = useMemo(() => paretoData.findIndex((d) => d.cumPct >= 80) + 1 || paretoData.length, [paretoData]);

  // Seasonality: year (rows) × month (cols) grid + per-year totals + max for shading
  const seasonality = useMemo(() => {
    if (!data?.byMonth?.length) return null;
    const grid = {}; let max = 0;
    for (const m of data.byMonth) {
      const mm = String(m.month).match(/^(\d{4})-(\d{2})$/);
      if (!mm) continue;
      const y = mm[1], mi = parseInt(mm[2]);
      (grid[y] ||= { total: 0 })[mi] = (grid[y][mi] || 0) + (m.value || 0);
      grid[y].total += m.value || 0;
      if (grid[y][mi] > max) max = grid[y][mi];
    }
    const years = Object.keys(grid).sort().reverse();
    return { grid, years, max: max || 1 };
  }, [data]);

  const handleExport = () => {
    if (!data) return;
    const wb = XLSX.utils.book_new();

    // Summary sheet
    const summaryData = [
      ['Spend Analytics Report'],
      ['Date Range', monthFrom ? `${fmtMonth(monthFrom)} - ${fmtMonth(monthTo || 'Present')}` : 'All Time'],
      ['Total Entries', data.totalEntries],
      ['Total Schedule Value', data.totalValue],
      [],
    ];
    const summaryWs = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');

    // By Media Group
    const mgHeaders = ['Media Group', 'Schedule Value (LKR)', 'Entries', '% Share'];
    const mgRows = data.byMediaGroup.map(mg => [
      mg.name, Math.round(mg.value), mg.count,
      data.totalValue > 0 ? ((mg.value / data.totalValue) * 100).toFixed(1) + '%' : '0%',
    ]);
    const mgWs = XLSX.utils.aoa_to_sheet([mgHeaders, ...mgRows]);
    XLSX.utils.book_append_sheet(wb, mgWs, 'By Media Group');

    // By Medium
    const medHeaders = ['Medium', 'Schedule Value (LKR)', 'Entries', '% Share'];
    const medRows = data.byMedium.map(m => [
      m.name, Math.round(m.value), m.count,
      data.totalValue > 0 ? ((m.value / data.totalValue) * 100).toFixed(1) + '%' : '0%',
    ]);
    const medWs = XLSX.utils.aoa_to_sheet([medHeaders, ...medRows]);
    XLSX.utils.book_append_sheet(wb, medWs, 'By Medium');

    // By Channel
    const chHeaders = ['Channel', 'Medium', 'Media Group', 'Schedule Value (LKR)', 'Entries', '% Share'];
    const chRows = data.byChannel.map(ch => [
      ch.name, ch.medium, ch.mediaGroup, Math.round(ch.value), ch.count,
      data.totalValue > 0 ? ((ch.value / data.totalValue) * 100).toFixed(1) + '%' : '0%',
    ]);
    const chWs = XLSX.utils.aoa_to_sheet([chHeaders, ...chRows]);
    XLSX.utils.book_append_sheet(wb, chWs, 'By Channel');

    // Monthly Trend
    const moHeaders = ['Month', 'Schedule Value (LKR)', 'Entries'];
    const moRows = data.byMonth.map(m => [fmtMonth(m.month), Math.round(m.value), m.count]);
    const moWs = XLSX.utils.aoa_to_sheet([moHeaders, ...moRows]);
    XLSX.utils.book_append_sheet(wb, moWs, 'Monthly Trend');

    // By Client
    const clHeaders = ['Client', 'Schedule Value (LKR)', 'Entries', '% Share'];
    const clRows = data.byClient.map(c => [
      c.name, Math.round(c.value), c.count,
      data.totalValue > 0 ? ((c.value / data.totalValue) * 100).toFixed(1) + '%' : '0%',
    ]);
    const clWs = XLSX.utils.aoa_to_sheet([clHeaders, ...clRows]);
    XLSX.utils.book_append_sheet(wb, clWs, 'By Client');

    // By Brand
    const brHeaders = ['Brand', 'Schedule Value (LKR)', 'Entries', '% Share'];
    const brRows = data.byBrand.map(b => [
      b.name, Math.round(b.value), b.count,
      data.totalValue > 0 ? ((b.value / data.totalValue) * 100).toFixed(1) + '%' : '0%',
    ]);
    const brWs = XLSX.utils.aoa_to_sheet([brHeaders, ...brRows]);
    XLSX.utils.book_append_sheet(wb, brWs, 'By Brand');

    const fileName = `spend-analytics-${monthFrom || 'all'}-to-${monthTo || 'now'}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  const handlePdfExport = async () => {
    if (!data || exporting) return;
    setExporting(true);
    try {
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 15;
      const contentW = pageW - margin * 2;
      const dateLabel = monthFrom ? `${fmtMonth(monthFrom)} - ${fmtMonth(monthTo || 'Present')}` : 'All Time';

      const addHeader = (title) => {
        pdf.setFontSize(18);
        pdf.setTextColor(30, 58, 95);
        pdf.text(title, margin, 22);
        pdf.setFontSize(10);
        pdf.setTextColor(100);
        pdf.text(`Period: ${dateLabel}  |  Total: ${fmtLKR(data.totalValue)}`, margin, 30);
        pdf.setDrawColor(232, 93, 36);
        pdf.setLineWidth(0.5);
        pdf.line(margin, 33, pageW - margin, 33);
      };

      const captureChart = async (ref) => {
        if (!ref?.current) return null;
        const canvas = await html2canvas(ref.current, { scale: 2, backgroundColor: '#ffffff', logging: false });
        return { src: canvas.toDataURL('image/png'), w: canvas.width, h: canvas.height };
      };

      const addChart = (chart, y, maxW, maxH) => {
        if (!chart) return y;
        const ratio = chart.w / chart.h;
        let imgW = maxW;
        let imgH = imgW / ratio;
        if (imgH > maxH) { imgH = maxH; imgW = imgH * ratio; }
        const x = margin + (maxW - imgW) / 2;
        pdf.addImage(chart.src, 'PNG', x, y, imgW, imgH);
        return y + imgH;
      };

      // Page 1: Monthly Spend Trend
      addHeader('Monthly Spend Trend');
      const monthlyImg = await captureChart(chartMonthlyRef);
      {
        const bottom = addChart(monthlyImg, 38, contentW, 100);
        autoTable(pdf, {
          startY: bottom + 5,
          head: [['Month', 'Schedule Value (LKR)', 'Entries']],
          body: data.byMonth.map(m => [fmtMonth(m.month), fmtLKR(m.value), m.count]),
          styles: { fontSize: 8, cellPadding: 2 },
          headStyles: { fillColor: [30, 58, 95], textColor: 255, fontStyle: 'bold' },
          margin: { left: margin, right: margin },
        });
      }

      // Page 2: Spend by Medium
      pdf.addPage();
      addHeader('Spend by Medium');
      const mediumImg = await captureChart(chartMediumRef);
      {
        const bottom = addChart(mediumImg, 38, contentW * 0.65, 100);
        autoTable(pdf, {
          startY: bottom + 5,
          head: [['Medium', 'Schedule Value (LKR)', 'Entries', '% Share']],
          body: data.byMedium.map(m => [
            m.name, fmtLKR(m.value), m.count,
            data.totalValue > 0 ? ((m.value / data.totalValue) * 100).toFixed(1) + '%' : '0%',
          ]),
          styles: { fontSize: 8, cellPadding: 2 },
          headStyles: { fillColor: [30, 58, 95], textColor: 255, fontStyle: 'bold' },
          margin: { left: margin, right: margin },
        });
      }

      // Page 3: Spend by Media Group
      pdf.addPage();
      addHeader('Spend by Media Group');
      const mgImg = await captureChart(chartMediaGroupRef);
      {
        const bottom = addChart(mgImg, 38, contentW * 0.65, 100);
        autoTable(pdf, {
          startY: bottom + 5,
          head: [['Media Group', 'Schedule Value (LKR)', 'Entries', '% Share']],
          body: data.byMediaGroup.map(mg => [
            mg.name, fmtLKR(mg.value), mg.count,
            data.totalValue > 0 ? ((mg.value / data.totalValue) * 100).toFixed(1) + '%' : '0%',
          ]),
          styles: { fontSize: 8, cellPadding: 2 },
          headStyles: { fillColor: [30, 58, 95], textColor: 255, fontStyle: 'bold' },
          margin: { left: margin, right: margin },
        });
      }

      // Page 4: Spend by Channel
      pdf.addPage();
      addHeader('Spend by Channel');
      const chImg = await captureChart(chartChannelRef);
      {
        const bottom = addChart(chImg, 38, contentW, 100);
        const groupedRows = [];
        data.byMediaGroup.forEach(mg => {
          const mgPct = data.totalValue > 0 ? ((mg.value / data.totalValue) * 100).toFixed(1) + '%' : '-';
          groupedRows.push({ content: [mg.name, '', String(mg.count), fmtLKR(mg.value), mgPct], isGroup: true });
          data.byChannel.filter(ch => ch.mediaGroup === mg.name).forEach(ch => {
            groupedRows.push({ content: ['   ' + ch.name, ch.medium, String(ch.count), fmtLKR(ch.value),
              data.totalValue > 0 ? ((ch.value / data.totalValue) * 100).toFixed(1) + '%' : '-'], isGroup: false });
          });
        });
        autoTable(pdf, {
          startY: bottom + 5,
          head: [['Media Group / Channel', 'Medium', 'Entries', 'Value (LKR)', '%']],
          body: groupedRows.map(r => r.content),
          styles: { fontSize: 7, cellPadding: 1.5 },
          headStyles: { fillColor: [30, 58, 95], textColor: 255, fontStyle: 'bold' },
          margin: { left: margin, right: margin },
          didParseCell: (hookData) => {
            if (hookData.section === 'body') {
              const row = groupedRows[hookData.row.index];
              if (row && row.isGroup) {
                hookData.cell.styles.fontStyle = 'bold';
                hookData.cell.styles.fillColor = [230, 237, 244];
              }
            }
          },
        });
      }

      // Page 5: By Client
      if (data.byClient.length > 0) {
        pdf.addPage();
        addHeader('Spend by Client');
        autoTable(pdf, {
          startY: 40,
          head: [['Client', 'Schedule Value (LKR)', 'Entries', '% Share']],
          body: data.byClient.map(c => [
            c.name, fmtLKR(c.value), c.count,
            data.totalValue > 0 ? ((c.value / data.totalValue) * 100).toFixed(1) + '%' : '-',
          ]),
          styles: { fontSize: 9, cellPadding: 2.5 },
          headStyles: { fillColor: [30, 58, 95], textColor: 255, fontStyle: 'bold' },
          margin: { left: margin, right: margin },
        });
      }

      // Page 6: By Brand
      if (data.byBrand.length > 0) {
        pdf.addPage();
        addHeader('Spend by Brand');
        autoTable(pdf, {
          startY: 40,
          head: [['Brand', 'Schedule Value (LKR)', 'Entries', '% Share']],
          body: data.byBrand.map(b => [
            b.name, fmtLKR(b.value), b.count,
            data.totalValue > 0 ? ((b.value / data.totalValue) * 100).toFixed(1) + '%' : '-',
          ]),
          styles: { fontSize: 9, cellPadding: 2.5 },
          headStyles: { fillColor: [30, 58, 95], textColor: 255, fontStyle: 'bold' },
          margin: { left: margin, right: margin },
        });
      }

      const pdfName = `spend-analytics-${monthFrom || 'all'}-to-${monthTo || 'now'}.pdf`;
      pdf.save(pdfName);
    } catch (err) {
      console.error('PDF export failed:', err);
    }
    setExporting(false);
  };

  // % of total, rendered with a faint progress bar behind the number.
  const ShareCell = ({ value, color = '#1F5BB5', strong = false }) => {
    const pct = data?.totalValue > 0 ? (value / data.totalValue) * 100 : 0;
    return (
      <td style={{ textAlign: 'right', position: 'relative', padding: '8px 12px' }}>
        <div style={{ position: 'absolute', right: 0, top: 6, bottom: 6, width: `${Math.min(100, pct)}%`, background: color, opacity: strong ? 0.18 : 0.1, borderRadius: 4 }} />
        <span className="mono" style={{ position: 'relative', fontWeight: strong ? 700 : 500, color: strong ? color : 'var(--muted)' }}>{pct.toFixed(1)}%</span>
      </td>
    );
  };

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
        <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4 }}>{label}</div>
        {payload.map((p, i) => (
          <div key={i} style={{ fontSize: 12, color: p.color }}>{p.name}: {fmtLKR(p.value)}</div>
        ))}
      </div>
    );
  };

  return (
    <div className="fade-in">
      <style>{`
        .spa-hero { position:relative; overflow:hidden; border-radius:18px; margin-bottom:20px; background:linear-gradient(135deg,#0A1729 0%,#122842 55%,#0F1F3D 100%); padding:24px 26px; color:#fff; }
        .spa-hero::before { content:''; position:absolute; top:-60px; right:-50px; width:230px; height:230px; background:radial-gradient(circle,rgba(232,93,36,.30),transparent 70%); border-radius:50%; }
        .spa-hero-in { position:relative; z-index:1; }
        .spa-htop { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap; }
        .spa-title { font-size:24px; font-weight:750; letter-spacing:-.6px; margin:0; }
        .spa-sub { font-size:13px; color:rgba(255,255,255,.55); margin:6px 0 0; }
        .spa-btn { display:inline-flex; align-items:center; gap:7px; font-size:13px; font-weight:650; border-radius:9px; padding:9px 14px; cursor:pointer; border:1px solid rgba(255,255,255,.18); background:rgba(255,255,255,.08); color:#fff; transition:background .15s; }
        .spa-btn:hover:not(:disabled){ background:rgba(255,255,255,.18); } .spa-btn:disabled{ opacity:.5; cursor:not-allowed; }
        .spa-btn.accent{ background:#E85D24; border-color:#E85D24; } .spa-btn.accent:hover{ background:#D9521C; }
        .spa-filters { display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end; margin-top:18px; }
        .spa-field { display:flex; flex-direction:column; gap:5px; min-width:160px; }
        .spa-field label { font-size:10.5px; font-weight:700; letter-spacing:.5px; text-transform:uppercase; color:rgba(255,255,255,.45); }
        .spa-input { background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.16); color:#fff; border-radius:9px; padding:9px 12px; font-size:13px; outline:none; cursor:pointer; }
        .spa-input option { color:#16243C; } .spa-input:disabled { opacity:.45; }
        .spa-card { background:#fff; border:1px solid #E5E8ED; border-radius:14px; box-shadow:0 1px 2px rgba(15,31,61,.06); }
        .spa-stat { position:relative; overflow:hidden; background:#fff; border:1px solid #E5E8ED; border-radius:13px; box-shadow:0 1px 2px rgba(15,31,61,.06); padding:16px 18px; transition:transform .16s ease, box-shadow .16s ease; }
        .spa-stat::before { content:''; position:absolute; top:0; left:0; right:0; height:3px; background:linear-gradient(90deg,#E85D24,rgba(232,93,36,.1) 70%,transparent); }
        .spa-stat:hover { transform:translateY(-3px); box-shadow:0 10px 26px rgba(15,31,61,.10); }
        .spa-stat-label { text-transform:uppercase; letter-spacing:.5px; }
        .spa-stat-label { font-size:12px; color:#6B7790; font-weight:600; }
        .spa-stat-val { font-size:22px; font-weight:750; letter-spacing:-.5px; font-family:'Spline Sans Mono',monospace; color:#16243C; margin-top:8px; }
        .spa-stat-sub { font-size:11.5px; color:#93A0B5; margin-top:4px; }
        .spa-ctitle { font-size:14.5px; font-weight:720; color:#16243C; margin:0; }
        .spa-csub { font-size:12.5px; color:#6B7790; margin:3px 0 0; }
      `}</style>

      {/* Navy hero with filters */}
      <div className="spa-hero">
        <div className="spa-hero-in">
          <div className="spa-htop">
            <div>
              <h1 className="spa-title">Spend Analytics</h1>
              <p className="spa-sub">Budget allocation by media group, medium, channel, client &amp; agency</p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {canExport(user) && (
                <>
                  <button className="spa-btn accent" onClick={handlePdfExport} disabled={!data || loading || exporting}>
                    <Icon name="download" size={15} /> {exporting ? 'Exporting…' : 'Export PDF'}
                  </button>
                  <button className="spa-btn" onClick={handleExport} disabled={!data || loading}>
                    <Icon name="file" size={15} /> Excel
                  </button>
                </>
              )}
              <button className="spa-btn" onClick={() => setCompare(c => !c)} style={compare ? { background: '#E85D24', borderColor: '#E85D24' } : undefined}>
                <Icon name="activity" size={15} /> Compare
              </button>
            </div>
          </div>
          {compare && (
            <div className="spa-filters" style={{ marginTop: 10, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,.12)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.55)', alignSelf: 'center', textTransform: 'uppercase', letterSpacing: '.5px' }}>Period B</div>
              <div className="spa-field">
                <label>From</label>
                <input type="month" className="spa-input" value={cmpFrom} onChange={e => setCmpFrom(e.target.value)} />
              </div>
              <div className="spa-field">
                <label>To</label>
                <input type="month" className="spa-input" value={cmpTo} onChange={e => setCmpTo(e.target.value)} />
              </div>
            </div>
          )}
          <div className="spa-filters">
            <div className="spa-field">
              <label>Agency</label>
              <select className="spa-input" value={agencyId} onChange={e => setAgencyId(e.target.value)}>
                <option value="">All Agencies</option>
                {agencies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div className="spa-field">
              <label>Client</label>
              <select className="spa-input" value={clientId} onChange={e => setClientId(e.target.value)} disabled={!agencyId}>
                <option value="">All Clients</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="spa-field">
              <label>From</label>
              <input type="month" className="spa-input" value={monthFrom} onChange={e => setMonthFrom(e.target.value)} />
            </div>
            <div className="spa-field">
              <label>To</label>
              <input type="month" className="spa-input" value={monthTo} onChange={e => setMonthTo(e.target.value)} />
            </div>
            {(agencyId || monthFrom || monthTo) && (
              <button className="spa-btn" onClick={() => { setAgencyId(''); setClientId(''); setMonthFrom(''); setMonthTo(''); }}>
                <Icon name="x" size={14} /> Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#b91c1c', marginBottom: 16 }}>
          {error}
        </div>
      )}

      {loading && (
        <OrbitLoader fullHeight label="Loading analytics…" />
      )}

      {!loading && data && (
        <>
          {/* Summary Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 22 }}>
            <div className="spa-stat">
              <div className="spa-stat-label">Total Schedule Value</div>
              <div className="spa-stat-val">{fmtLKR(data.totalValue)}</div>
              <div className="spa-stat-sub">{data.totalEntries.toLocaleString()} entries</div>
            </div>
            <div className="spa-stat">
              <div className="spa-stat-label">Avg / Month</div>
              <div className="spa-stat-val">{fmtLKR(insights?.avgMonth || 0)}</div>
              <div className="spa-stat-sub">{insights?.months || 0} months</div>
            </div>
            <div className="spa-stat">
              <div className="spa-stat-label">Channels</div>
              <div className="spa-stat-val">{data.byChannel.length}</div>
              <div className="spa-stat-sub">{data.byMediaGroup.length} media groups</div>
            </div>
            <div className="spa-stat">
              <div className="spa-stat-label">Top Channel</div>
              <div className="spa-stat-val" style={{ fontSize: 16, lineHeight: 1.2 }}>{insights?.topChannel?.name || '-'}</div>
              <div className="spa-stat-sub">{insights?.topChannel ? fmtLKR(insights.topChannel.value) : ''}</div>
            </div>
          </div>

          {/* Comparison panel (Period A vs Period B) */}
          {compare && cmpData && (() => {
            const aLabel = monthFrom ? `${fmtMonth(monthFrom)}–${fmtMonth(monthTo || monthFrom)}` : 'All time (A)';
            const bLabel = cmpFrom ? `${fmtMonth(cmpFrom)}–${fmtMonth(cmpTo || cmpFrom)}` : 'All time (B)';
            const a = data.totalValue || 0, b = cmpData.totalValue || 0;
            const delta = b > 0 ? ((a - b) / b) * 100 : null;
            const mediums = [...new Set([...(data.byMedium || []), ...(cmpData.byMedium || [])].map(m => m.name))];
            const cmpBars = mediums.map(name => ({
              name,
              A: Math.round(data.byMedium.find(m => m.name === name)?.value || 0),
              B: Math.round(cmpData.byMedium.find(m => m.name === name)?.value || 0),
            }));
            // Waterfall B -> A by medium (base = invisible offset, value = visible bar)
            const wf = [{ name: 'Period B', base: 0, value: Math.round(b), fill: '#0F1F3D' }];
            let run = b;
            for (const name of mediums) {
              const av = data.byMedium.find(m => m.name === name)?.value || 0;
              const bv = cmpData.byMedium.find(m => m.name === name)?.value || 0;
              const d = av - bv;
              if (d >= 0) wf.push({ name, base: Math.round(run), value: Math.round(d), delta: d, fill: '#15814B' });
              else wf.push({ name, base: Math.round(run + d), value: Math.round(-d), delta: d, fill: '#C5391F' });
              run += d;
            }
            wf.push({ name: 'Period A', base: 0, value: Math.round(a), fill: '#0F1F3D' });
            return (
              <div className="spa-card" style={{ padding: '20px', marginBottom: 20 }}>
                <h3 className="spa-ctitle">Period Comparison</h3>
                <p className="spa-csub" style={{ marginBottom: 14 }}>Period A ({aLabel}) vs Period B ({bLabel})</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <div style={{ flex: 1, background: '#FDF1EB', border: '1px solid #f6d9c9', borderRadius: 11, padding: '14px 16px' }}>
                      <div style={{ fontSize: 11.5, color: '#6B7790', fontWeight: 600 }}>Period A</div>
                      <div style={{ fontSize: 20, fontWeight: 750, fontFamily: "'Spline Sans Mono', monospace", color: '#16243C' }}>{fmtLKR(a)}</div>
                      <div style={{ fontSize: 11, color: '#93A0B5' }}>{data.totalEntries} entries</div>
                    </div>
                    <div style={{ flex: 1, background: '#EDF3FD', border: '1px solid #d4e2f7', borderRadius: 11, padding: '14px 16px' }}>
                      <div style={{ fontSize: 11.5, color: '#6B7790', fontWeight: 600 }}>Period B</div>
                      <div style={{ fontSize: 20, fontWeight: 750, fontFamily: "'Spline Sans Mono', monospace", color: '#16243C' }}>{fmtLKR(b)}</div>
                      <div style={{ fontSize: 11, color: '#93A0B5' }}>{cmpData.totalEntries} entries</div>
                    </div>
                    <div style={{ flex: '0 0 92px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', background: delta == null ? '#F5F6F8' : delta >= 0 ? '#ECF8F1' : '#FBE0DA', borderRadius: 11, padding: '14px 8px' }}>
                      <div style={{ fontSize: 11.5, color: '#6B7790', fontWeight: 600 }}>A vs B</div>
                      <div style={{ fontSize: 18, fontWeight: 750, fontFamily: "'Spline Sans Mono', monospace", color: delta == null ? '#6B7790' : delta >= 0 ? '#15814B' : '#C5391F' }}>{delta == null ? '-' : (delta >= 0 ? '+' : '') + delta.toFixed(0) + '%'}</div>
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={cmpBars} margin={{ top: 6, right: 12, bottom: 4, left: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F3" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#93A0B5' }} tickLine={false} axisLine={{ stroke: '#E5E8ED' }} />
                      <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11, fill: '#93A0B5' }} tickLine={false} axisLine={false} width={42} />
                      <Tooltip formatter={(v, n) => [fmtLKR(v), n === 'A' ? `A · ${aLabel}` : `B · ${bLabel}`]} contentStyle={{ borderRadius: 9, border: '1px solid #E5E8ED', fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => (v === 'A' ? 'Period A' : 'Period B')} />
                      <Bar dataKey="A" fill="#E85D24" radius={[4, 4, 0, 0]} maxBarSize={40} />
                      <Bar dataKey="B" fill="#1F5BB5" radius={[4, 4, 0, 0]} maxBarSize={40} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Waterfall: what drove the change from B to A (by medium) */}
                <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid #EEF0F3' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#16243C', marginBottom: 2 }}>What changed (B → A)</div>
                  <p className="spa-csub" style={{ marginBottom: 12 }}>Green = medium grew, red = medium shrank; bars bridge Period B to Period A</p>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={wf} margin={{ top: 6, right: 12, bottom: 4, left: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F3" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#93A0B5' }} tickLine={false} axisLine={{ stroke: '#E5E8ED' }} />
                      <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11, fill: '#93A0B5' }} tickLine={false} axisLine={false} width={46} />
                      <Tooltip cursor={{ fill: 'rgba(15,31,61,.04)' }} content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const p = payload.find(x => x.dataKey === 'value')?.payload;
                        if (!p) return null;
                        const isTotal = p.name === 'Period A' || p.name === 'Period B';
                        return (
                          <div style={{ background: '#fff', border: '1px solid #E5E8ED', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
                            <div style={{ fontWeight: 700, marginBottom: 2 }}>{p.name}</div>
                            {isTotal ? <div>{fmtLKR(p.value)}</div> : <div style={{ color: p.delta >= 0 ? '#15814B' : '#C5391F' }}>{p.delta >= 0 ? '+' : ''}{fmtLKR(p.delta)}</div>}
                          </div>
                        );
                      }} />
                      <Bar dataKey="base" stackId="w" fill="transparent" />
                      <Bar dataKey="value" stackId="w" radius={[4, 4, 0, 0]} maxBarSize={56}>
                        {wf.map((r, i) => <Cell key={i} fill={r.fill} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            );
          })()}

          {/* Monthly Trend Chart — X axis = Jan–Dec, one line per year */}
          {monthlyByYear.years.length > 0 && (
            <div className="spa-card" style={{ padding: '20px', marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                <div>
                  <h3 className="spa-ctitle">Monthly Spend Trend</h3>
                  <p className="spa-csub">Committed schedule value by month · one line per year{insights?.peak ? ` · peak ${fmtMonth(insights.peak.month)}` : ''}</p>
                </div>
              </div>
              <div ref={chartMonthlyRef}>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={monthlyByYear.rows} margin={{ top: 8, right: 16, bottom: 5, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F3" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#93A0B5' }} tickLine={false} axisLine={{ stroke: '#E5E8ED' }} />
                    <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11, fill: '#93A0B5' }} tickLine={false} axisLine={false} width={48} />
                    <Tooltip formatter={(v, n) => [fmtLKR(v), n]} contentStyle={{ borderRadius: 9, border: '1px solid #E5E8ED', fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {monthlyByYear.years.map((y, i) => (
                      <Line key={y} type="monotone" dataKey={y} name={y} stroke={COLORS[i % COLORS.length]} strokeWidth={2.4} dot={{ r: 2.5 }} activeDot={{ r: 5 }} connectNulls={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Cumulative spend + Spend by Agency */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            {chartMonthly.length > 1 && (
              <div className="spa-card" style={{ padding: '20px' }}>
                <h3 className="spa-ctitle">Cumulative Spend</h3>
                <p className="spa-csub" style={{ marginBottom: 12 }}>Running total of committed media value</p>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={chartMonthly} margin={{ top: 8, right: 16, bottom: 5, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F3" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10.5, fill: '#93A0B5' }} tickLine={false} axisLine={{ stroke: '#E5E8ED' }} interval="preserveStartEnd" />
                    <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11, fill: '#93A0B5' }} tickLine={false} axisLine={false} width={48} />
                    <Tooltip formatter={(v) => [fmtLKR(v), 'Cumulative']} labelFormatter={l => l} contentStyle={{ borderRadius: 9, border: '1px solid #E5E8ED', fontSize: 12 }} />
                    <Line type="monotone" dataKey="cumulative" name="Cumulative" stroke="#1F5BB5" strokeWidth={2.6} dot={{ r: 2 }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            {(data.byAgency?.length > 0) && (
              <div className="spa-card" style={{ padding: '20px' }}>
                <h3 className="spa-ctitle">Spend by Agency</h3>
                <p className="spa-csub" style={{ marginBottom: 12 }}>Committed value across agencies</p>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={data.byAgency.slice(0, 8)} layout="vertical" margin={{ top: 4, right: 20, bottom: 4, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F3" horizontal={false} />
                    <XAxis type="number" tickFormatter={fmtShort} tick={{ fontSize: 11, fill: '#93A0B5' }} tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11.5, fill: '#16243C' }} tickLine={false} axisLine={false} width={120} />
                    <Tooltip formatter={(v) => [fmtLKR(v), 'Spend']} contentStyle={{ borderRadius: 9, border: '1px solid #E5E8ED', fontSize: 12 }} />
                    <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                      {data.byAgency.slice(0, 8).map((_, idx) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Pareto (80/20) — vital few partners driving spend */}
          {paretoData.length > 0 && (
            <div className="spa-card" style={{ padding: '20px', marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                <div>
                  <h3 className="spa-ctitle">Spend Concentration (Pareto 80/20)</h3>
                  <p className="spa-csub">Top {paretoMode === 'client' ? 'clients' : 'channels'} by spend with running cumulative share · <b>{paretoVitalFew}</b> drive 80% of spend</p>
                </div>
                <div style={{ display: 'inline-flex', background: '#EEF0F3', border: '1px solid #E5E8ED', borderRadius: 9, padding: 3 }}>
                  {['channel', 'client'].map((m) => (
                    <button key={m} onClick={() => setParetoMode(m)} style={{ border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, padding: '5px 12px', borderRadius: 6, background: paretoMode === m ? '#fff' : 'transparent', color: paretoMode === m ? '#16243C' : '#6B7790', boxShadow: paretoMode === m ? '0 1px 2px rgba(15,31,61,.08)' : 'none' }}>{m === 'channel' ? 'Channels' : 'Clients'}</button>
                  ))}
                </div>
              </div>
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={paretoData} margin={{ top: 6, right: 16, bottom: 60, left: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#93A0B5' }} tickLine={false} axisLine={{ stroke: '#E5E8ED' }} angle={-40} textAnchor="end" interval={0} height={70} />
                  <YAxis yAxisId="left" tickFormatter={fmtShort} tick={{ fontSize: 11, fill: '#93A0B5' }} tickLine={false} axisLine={false} width={44} />
                  <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11, fill: '#93A0B5' }} tickLine={false} axisLine={false} width={40} />
                  <Tooltip formatter={(v, n) => (n === 'cumPct' ? [`${v}%`, 'Cumulative'] : [fmtLKR(v), 'Spend'])} contentStyle={{ borderRadius: 9, border: '1px solid #E5E8ED', fontSize: 12 }} />
                  <ReferenceLine yAxisId="right" y={80} stroke="#C5391F" strokeDasharray="5 4" label={{ value: '80%', position: 'right', fill: '#C5391F', fontSize: 11 }} />
                  <Bar yAxisId="left" dataKey="value" name="Spend" radius={[4, 4, 0, 0]} maxBarSize={42}>
                    {paretoData.map((d, i) => <Cell key={i} fill={paretoMode === 'channel' ? (MEDIUM_COLORS[d.medium] || COLORS[i % COLORS.length]) : COLORS[i % COLORS.length]} />)}
                  </Bar>
                  <Line yAxisId="right" type="monotone" dataKey="cumPct" name="cumPct" stroke="#16243C" strokeWidth={2.4} dot={{ r: 2.5 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Seasonality heatmap — year × month spend intensity */}
          {seasonality && (
            <div className="spa-card" style={{ padding: '20px', marginBottom: 20, overflow: 'hidden' }}>
              <h3 className="spa-ctitle">Seasonality Heatmap</h3>
              <p className="spa-csub" style={{ marginBottom: 14 }}>Spend intensity by month and year · darker = higher spend</p>
              <div style={{ overflowX: 'auto' }}>
                <div style={{ display: 'grid', gridTemplateColumns: `52px repeat(12, minmax(34px, 1fr)) 78px`, gap: 4, minWidth: 640 }}>
                  <div />
                  {MONTHS.map((m) => <div key={m} style={{ fontSize: 10.5, color: '#93A0B5', textAlign: 'center', fontWeight: 600 }}>{m}</div>)}
                  <div style={{ fontSize: 10.5, color: '#6B7790', textAlign: 'right', fontWeight: 700 }}>Total</div>
                  {seasonality.years.map((y) => (
                    <Fragment key={y}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#16243C', display: 'flex', alignItems: 'center' }}>{y}</div>
                      {MONTHS.map((_, mi) => {
                        const v = seasonality.grid[y][mi + 1] || 0;
                        const op = v > 0 ? 0.12 + 0.88 * (v / seasonality.max) : 0;
                        return (
                          <div key={mi} title={`${MONTHS[mi]} ${y}: ${fmtLKR(v)}`} style={{ height: 30, borderRadius: 5, background: v > 0 ? `rgba(232,93,36,${op.toFixed(2)})` : '#F1F2F5', display: 'grid', placeItems: 'center' }}>
                            {v > 0 && <span style={{ fontSize: 9, fontWeight: 600, color: op > 0.55 ? '#fff' : '#6B7790' }}>{fmtShort(v)}</span>}
                          </div>
                        );
                      })}
                      <div className="mono" style={{ fontSize: 11.5, fontWeight: 700, color: '#16243C', textAlign: 'right', alignSelf: 'center' }}>{fmtShort(seasonality.grid[y].total)}</div>
                    </Fragment>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Medium Mix Shift + Brand Trend */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            {/* 100% stacked area — medium share month by month */}
            <div className="spa-card" style={{ padding: '20px' }}>
              <h3 className="spa-ctitle">Medium Mix Shift</h3>
              <p className="spa-csub" style={{ marginBottom: 12 }}>TV / Radio / Print share of spend, month by month</p>
              {(data.byMonthMedium?.length > 0) ? (
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={data.byMonthMedium.map(r => ({ ...r, label: fmtMonth(r.month) }))} stackOffset="expand" margin={{ top: 6, right: 12, bottom: 4, left: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F3" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10.5, fill: '#93A0B5' }} tickLine={false} axisLine={{ stroke: '#E5E8ED' }} interval="preserveStartEnd" />
                    <YAxis tickFormatter={(v) => `${Math.round(v * 100)}%`} tick={{ fontSize: 11, fill: '#93A0B5' }} tickLine={false} axisLine={false} width={40} />
                    <Tooltip formatter={(v, n) => [fmtLKR(v), n]} contentStyle={{ borderRadius: 9, border: '1px solid #E5E8ED', fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Area type="monotone" dataKey="TV" stackId="1" stroke={MEDIUM_COLORS.TV} fill={MEDIUM_COLORS.TV} fillOpacity={0.85} />
                    <Area type="monotone" dataKey="RADIO" stackId="1" stroke={MEDIUM_COLORS.RADIO} fill={MEDIUM_COLORS.RADIO} fillOpacity={0.85} />
                    <Area type="monotone" dataKey="PRINT" stackId="1" stroke={MEDIUM_COLORS.PRINT} fill={MEDIUM_COLORS.PRINT} fillOpacity={0.85} />
                    <Area type="monotone" dataKey="DIGITAL" stackId="1" stroke={MEDIUM_COLORS.DIGITAL} fill={MEDIUM_COLORS.DIGITAL} fillOpacity={0.85} />
                    <Area type="monotone" dataKey="CINEMA" stackId="1" stroke={MEDIUM_COLORS.CINEMA} fill={MEDIUM_COLORS.CINEMA} fillOpacity={0.85} />
                    <Area type="monotone" dataKey="OOH" stackId="1" stroke={MEDIUM_COLORS.OOH} fill={MEDIUM_COLORS.OOH} fillOpacity={0.85} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : <div style={{ height: 260, display: 'grid', placeItems: 'center', color: '#93A0B5', fontSize: 13 }}>No monthly data</div>}
            </div>

            {/* Brand-level spend trend (top 6 brands) */}
            <div className="spa-card" style={{ padding: '20px' }}>
              <h3 className="spa-ctitle">Brand Spend Trend</h3>
              <p className="spa-csub" style={{ marginBottom: 12 }}>Monthly spend for the top {data.brandTrendKeys?.length || 0} brands</p>
              {(data.brandTrend?.length > 0 && data.brandTrendKeys?.length > 0) ? (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={data.brandTrend.map(r => ({ ...r, label: fmtMonth(r.month) }))} margin={{ top: 6, right: 12, bottom: 4, left: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F3" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10.5, fill: '#93A0B5' }} tickLine={false} axisLine={{ stroke: '#E5E8ED' }} interval="preserveStartEnd" />
                    <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11, fill: '#93A0B5' }} tickLine={false} axisLine={false} width={44} />
                    <Tooltip formatter={(v, n) => [fmtLKR(v), n]} contentStyle={{ borderRadius: 9, border: '1px solid #E5E8ED', fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {data.brandTrendKeys.map((b, i) => (
                      <Line key={b} type="monotone" dataKey={b} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              ) : <div style={{ height: 260, display: 'grid', placeItems: 'center', color: '#93A0B5', fontSize: 13 }}>No brand data</div>}
            </div>
          </div>

          {/* Client Tenure bubble + Agency Efficiency */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 16, marginBottom: 20 }}>
            <div className="spa-card" style={{ padding: '20px' }}>
              <h3 className="spa-ctitle">Client Tenure &amp; Value</h3>
              <p className="spa-csub" style={{ marginBottom: 12 }}>Months active vs. total spend · bubble size = avg monthly spend</p>
              {(data.clientTenure?.length > 0) ? (
                <ResponsiveContainer width="100%" height={300}>
                  <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F3" />
                    <XAxis type="number" dataKey="months" name="Months active" tick={{ fontSize: 11, fill: '#93A0B5' }} tickLine={false} axisLine={{ stroke: '#E5E8ED' }} label={{ value: 'Months active', position: 'insideBottom', offset: -10, fontSize: 11, fill: '#6B7790' }} />
                    <YAxis type="number" dataKey="value" name="Total spend" tickFormatter={fmtShort} tick={{ fontSize: 11, fill: '#93A0B5' }} tickLine={false} axisLine={false} width={46} />
                    <ZAxis type="number" dataKey="avgMonth" range={[60, 520]} name="Avg / month" />
                    <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const p = payload[0].payload;
                      return (
                        <div style={{ background: '#fff', border: '1px solid #E5E8ED', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
                          <div style={{ fontWeight: 700, marginBottom: 3 }}>{p.name}</div>
                          <div>Months active: {p.months}</div>
                          <div>Total: {fmtLKR(p.value)}</div>
                          <div>Avg/month: {fmtLKR(p.avgMonth)}</div>
                        </div>
                      );
                    }} />
                    <Scatter data={data.clientTenure.slice(0, 60)} fill="#1F5BB5" fillOpacity={0.55}>
                      {data.clientTenure.slice(0, 60).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} fillOpacity={0.55} />)}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              ) : <div style={{ height: 300, display: 'grid', placeItems: 'center', color: '#93A0B5', fontSize: 13 }}>No client data</div>}
            </div>

            <div className="spa-card" style={{ padding: '20px' }}>
              <h3 className="spa-ctitle">Agency Efficiency</h3>
              <p className="spa-csub" style={{ marginBottom: 12 }}>Average spend per schedule entry</p>
              {(data.byAgency?.length > 0) ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={data.byAgency.map(a => ({ name: a.name, perEntry: a.count ? Math.round(a.value / a.count) : 0 })).sort((a, b) => b.perEntry - a.perEntry)} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F3" horizontal={false} />
                    <XAxis type="number" tickFormatter={fmtShort} tick={{ fontSize: 11, fill: '#93A0B5' }} tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11.5, fill: '#16243C' }} tickLine={false} axisLine={false} width={120} />
                    <Tooltip formatter={(v) => [fmtLKR(v), 'Per entry']} contentStyle={{ borderRadius: 9, border: '1px solid #E5E8ED', fontSize: 12 }} />
                    <Bar dataKey="perEntry" radius={[0, 6, 6, 0]}>
                      {data.byAgency.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : <div style={{ height: 300, display: 'grid', placeItems: 'center', color: '#93A0B5', fontSize: 13 }}>No agency data</div>}
            </div>
          </div>

          {/* Flighting calendar — which clients were active each month */}
          {(data.clientFlighting?.length > 0 && data.flightingMonths?.length > 0) && (
            <div className="spa-card" style={{ padding: '20px', marginBottom: 20, overflow: 'hidden' }}>
              <h3 className="spa-ctitle">Flighting Calendar</h3>
              <p className="spa-csub" style={{ marginBottom: 14 }}>Active months per client (top 15 by spend) · filled = had spend that month</p>
              <div style={{ overflowX: 'auto' }}>
                <div style={{ display: 'grid', gridTemplateColumns: `minmax(150px, 1.4fr) repeat(${data.flightingMonths.length}, minmax(26px, 1fr))`, gap: 3, minWidth: 600 }}>
                  <div />
                  {data.flightingMonths.map(m => (
                    <div key={m} style={{ fontSize: 9, color: '#93A0B5', textAlign: 'center', writingMode: 'vertical-rl', transform: 'rotate(180deg)', height: 46, margin: '0 auto', fontWeight: 600 }}>{fmtMonth(m)}</div>
                  ))}
                  {data.clientFlighting.map((c) => {
                    const active = new Set(c.months);
                    return (
                      <Fragment key={c.name}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#16243C', display: 'flex', alignItems: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 6 }} title={c.name}>{c.name}</div>
                        {data.flightingMonths.map(m => (
                          <div key={m} title={`${c.name} · ${fmtMonth(m)}`} style={{ height: 20, borderRadius: 4, background: active.has(m) ? '#E85D24' : '#EEF0F3' }} />
                        ))}
                      </Fragment>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Medium & Media Group charts side by side */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            {/* By Medium - Pie */}
            <div className="section-card" style={{ padding: '20px' }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Spend by Medium</h3>
              <p className="spa-csub" style={{ marginBottom: 12 }}>Click a slice to filter the channel views below{mediumFilter ? ` · filtering: ${mediumFilter}` : ''}</p>
              <div ref={chartMediumRef}>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={data.byMedium}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={90}
                      paddingAngle={2}
                      onClick={(d) => setMediumFilter((f) => (f === d.name ? '' : d.name))}
                    >
                      {data.byMedium.map((entry, idx) => (
                        <Cell key={idx} cursor="pointer" opacity={mediumFilter && mediumFilter !== entry.name ? 0.3 : 1} stroke={mediumFilter === entry.name ? '#16243C' : 'none'} strokeWidth={2} fill={MEDIUM_COLORS[entry.name] || COLORS[idx % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(val) => fmtLKR(val)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ marginTop: 10 }}>
                {data.byMedium.map((m, idx) => (
                  <div key={m.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: MEDIUM_COLORS[m.name] || COLORS[idx] }} />
                      <span style={{ fontWeight: 600 }}>{m.name}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 16 }}>
                      <span className="mono">{fmtLKR(m.value)}</span>
                      <span style={{ color: 'var(--muted)', width: 50, textAlign: 'right' }}>{data.totalValue > 0 ? ((m.value / data.totalValue) * 100).toFixed(1) : 0}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* By Media Group - Pie */}
            <div className="section-card" style={{ padding: '20px' }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Spend by Media Group</h3>
              <div ref={chartMediaGroupRef}>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={data.byMediaGroup.slice(0, 8)}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={90}
                      paddingAngle={2}
                    >
                      {data.byMediaGroup.slice(0, 8).map((_, idx) => (
                        <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(val) => fmtLKR(val)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ maxHeight: 200, overflow: 'auto', marginTop: 10 }}>
                {data.byMediaGroup.map((mg, idx) => (
                  <div key={mg.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: COLORS[idx % COLORS.length] }} />
                      <span style={{ fontWeight: 600 }}>{mg.name}</span>
                      <span style={{ color: 'var(--muted)', fontSize: 11 }}>({mg.count})</span>
                    </div>
                    <div style={{ display: 'flex', gap: 16 }}>
                      <span className="mono">{fmtLKR(mg.value)}</span>
                      <span style={{ color: 'var(--muted)', width: 50, textAlign: 'right' }}>{data.totalValue > 0 ? ((mg.value / data.totalValue) * 100).toFixed(1) : 0}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* By Channel + By Client - ranked clickable lists → intelligence pages */}
          {(() => {
            const channelsView = (mediumFilter ? data.byChannel.filter(c => c.medium === mediumFilter) : data.byChannel).slice(0, 15);
            const clientsView = (data.byClient || []).slice(0, 15);
            const maxCh = channelsView[0]?.value || 1;
            const maxCl = clientsView[0]?.value || 1;
            const RankRow = ({ rank, name, sub, value, max, color, onClick, clickable }) => (
              <div
                onClick={clickable ? onClick : undefined}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px', borderRadius: 8, cursor: clickable ? 'pointer' : 'default', transition: 'background .12s' }}
                onMouseEnter={e => { if (clickable) e.currentTarget.style.background = '#F5F6F8'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{ width: 20, fontSize: 12, fontWeight: 700, color: '#93A0B5', textAlign: 'right', flex: 'none' }}>{rank}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: clickable ? '#16243C' : '#6B7790', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {name}{clickable && <Icon name="chevR" size={12} style={{ marginLeft: 4, color: '#93A0B5', verticalAlign: 'middle' }} />}
                    </span>
                    <span className="mono" style={{ fontSize: 12.5, fontWeight: 700, color: '#16243C', flex: 'none' }}>{fmtLKR(value)}</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: '#EEF0F3', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.max(2, (value / max) * 100)}%`, height: '100%', background: color }} />
                  </div>
                  {sub && <div style={{ fontSize: 11, color: '#93A0B5', marginTop: 2 }}>{sub}</div>}
                </div>
              </div>
            );
            return (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 20, marginBottom: 20 }}>
                <div className="section-card" style={{ padding: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                    <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Spend by Channel (Top 15)</h3>
                    {mediumFilter && (
                      <button onClick={() => setMediumFilter('')} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: MEDIUM_COLORS[mediumFilter] || '#16243C', background: '#F5F6F8', border: '1px solid #E5E8ED', borderRadius: 20, padding: '3px 10px', cursor: 'pointer' }}>
                        {mediumFilter} <Icon name="x" size={12} />
                      </button>
                    )}
                    <span style={{ marginLeft: 'auto', fontSize: 11.5, color: '#93A0B5' }}>Click to open Channel Intelligence</span>
                  </div>
                  <div ref={chartChannelRef}>
                    {channelsView.length === 0 ? <div style={{ color: '#93A0B5', fontSize: 13, padding: 16 }}>No channels for the current filters.</div> : (
                      channelsView.map((ch, i) => (
                        <RankRow key={ch.name} rank={i + 1} name={ch.name} sub={ch.medium} value={ch.value} max={maxCh}
                          color={MEDIUM_COLORS[ch.medium] || COLORS[i % COLORS.length]}
                          clickable={!!ch.channelMasterId}
                          onClick={() => navigate(`/channel-masters/${ch.channelMasterId}${clientId ? `?clientId=${clientId}` : ''}`)} />
                      ))
                    )}
                  </div>
                </div>
                <div className="section-card" style={{ padding: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                    <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Spend by Client (Top 15)</h3>
                    <span style={{ marginLeft: 'auto', fontSize: 11.5, color: '#93A0B5' }}>Click to open Client Dashboard</span>
                  </div>
                  <div>
                    {clientsView.length === 0 ? <div style={{ color: '#93A0B5', fontSize: 13, padding: 16 }}>No clients for the current filters.</div> : (
                      clientsView.map((cl, i) => (
                        <RankRow key={cl.name} rank={i + 1} name={cl.name} value={cl.value} max={maxCl}
                          color={COLORS[i % COLORS.length]}
                          clickable={!!cl.clientId}
                          onClick={() => navigate(`/clients/${cl.clientId}/dashboard`)} />
                      ))
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Deals & Properties - scoped to accessible clients, row → channel page */}
          <div className="section-card" style={{ padding: 0, overflow: 'hidden', marginBottom: 20 }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>Deals &amp; Properties ({properties.length})</span>
              {properties.length > 0 && <span style={{ marginLeft: 'auto', fontSize: 11.5, color: '#93A0B5' }}>Click a row to open the channel</span>}
            </div>
            {properties.length === 0 ? (
              <div style={{ padding: 24, color: '#93A0B5', fontSize: 13 }}>No properties recorded for your accounts.</div>
            ) : (
              <div style={{ overflow: 'auto', maxHeight: 460 }}>
                <table className="tbl" style={{ margin: 0 }}>
                  <thead>
                    <tr>
                      <th>Client</th>
                      <th>Channel</th>
                      <th>Medium</th>
                      <th>Property</th>
                      <th>Type</th>
                      <th style={{ textAlign: 'right' }}>Cost</th>
                      <th style={{ textAlign: 'right' }}>Bonus</th>
                      <th>Period</th>
                    </tr>
                  </thead>
                  <tbody>
                    {properties.map(p => (
                      <tr key={p.id} style={{ cursor: 'pointer' }}
                        onClick={() => navigate(`/channels/${p.channelId}`)}
                        onMouseEnter={e => { e.currentTarget.style.background = '#F5F6F8'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                        <td className="strong">{p.clientName}</td>
                        <td>{p.channelName}</td>
                        <td>{p.medium ? <span className="medium-tag" data-medium={p.medium}>{p.medium}</span> : '-'}</td>
                        <td>{p.name}</td>
                        <td>{p.propertyType || '-'}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{p.cost === 0 ? 'Added value' : fmtLKR(p.cost)}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{p.bonusPct != null ? `${p.bonusPct}%` : (p.bonusValue ? fmtLKR(p.bonusValue) : '-')}</td>
                        <td style={{ fontSize: 12, color: '#6B7790', whiteSpace: 'nowrap' }}>
                          {p.startDate ? fmtDate(p.startDate) : ''}{(p.startDate || p.endDate) ? ' - ' : ''}{p.endDate ? fmtDate(p.endDate) : (p.startDate ? 'ongoing' : '')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Grouped Breakdown: Media Group → Channels */}
          <div className="section-card" style={{ padding: 0, overflow: 'hidden', marginBottom: 20 }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 14 }}>
              Spend Breakdown - Media Group &amp; Channels
            </div>
            <div style={{ overflow: 'auto' }}>
              <table className="tbl" style={{ margin: 0 }}>
                <thead>
                  <tr>
                    <th style={{ width: 30 }}></th>
                    <th style={{ width: 260 }}>Media Group / Channel</th>
                    <th>Medium</th>
                    <th style={{ textAlign: 'right' }}>Entries</th>
                    <th style={{ textAlign: 'right' }}>Schedule Value</th>
                    <th style={{ textAlign: 'right' }}>% Share</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byMediaGroup.map((mg, mgIdx) => {
                    const channels = data.byChannel.filter(ch => ch.mediaGroup === mg.name && (!mediumFilter || ch.medium === mediumFilter));
                    if (mediumFilter && channels.length === 0) return null;
                    const mgPct = data.totalValue > 0 ? ((mg.value / data.totalValue) * 100).toFixed(1) + '%' : '-';
                    const isExpanded = expandedGroups.has(mg.name);
                    const toggleExpanded = () => setExpandedGroups(prev => {
                      const next = new Set(prev);
                      next.has(mg.name) ? next.delete(mg.name) : next.add(mg.name);
                      return next;
                    });
                    return (
                      <Fragment key={mg.name}>
                        <tr style={{ background: 'var(--navy-50, #f0f4f8)', cursor: channels.length ? 'pointer' : 'default' }} onClick={() => channels.length && toggleExpanded()}>
                          <td style={{ textAlign: 'center' }}>
                            {channels.length > 0 && (
                              <Icon name={isExpanded ? 'chevD' : 'chevR'} size={14} style={{ color: '#6B7790' }} />
                            )}
                          </td>
                          <td style={{ fontWeight: 700, fontSize: 13 }}>
                            <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: COLORS[mgIdx % COLORS.length], marginRight: 8, verticalAlign: 'middle' }} />
                            {mg.name}
                            {channels.length > 0 && (
                              <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: '#93A0B5' }}>({channels.length} channel{channels.length === 1 ? '' : 's'})</span>
                            )}
                          </td>
                          <td></td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>{mg.count}</td>
                          <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{fmtLKR(mg.value)}</td>
                          <ShareCell value={mg.value} color={COLORS[mgIdx % COLORS.length]} strong />
                        </tr>
                        {isExpanded && channels.map(ch => (
                          <tr key={ch.name}>
                            <td></td>
                            <td style={{ paddingLeft: 34, fontSize: 13 }}>{ch.name}</td>
                            <td><span className="medium-tag" data-medium={ch.medium}>{ch.medium}</span></td>
                            <td style={{ textAlign: 'right' }}>{ch.count}</td>
                            <td className="mono" style={{ textAlign: 'right' }}>{fmtLKR(ch.value)}</td>
                            <ShareCell value={ch.value} color={MEDIUM_COLORS[ch.medium] || '#93A0B5'} />
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td></td>
                    <td className="strong" colSpan={2}>Total</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{data.totalEntries}</td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{fmtLKR(data.totalValue)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>100%</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Top Clients bar chart */}
          {data.byClient.length > 1 && (
            <div className="spa-card" style={{ padding: '20px', marginBottom: 20 }}>
              <h3 className="spa-ctitle">Top Clients by Spend</h3>
              <p className="spa-csub" style={{ marginBottom: 12 }}>Highest committed media value (top 12)</p>
              <ResponsiveContainer width="100%" height={Math.min(420, data.byClient.slice(0, 12).length * 30 + 30)}>
                <BarChart data={data.byClient.slice(0, 12)} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F3" horizontal={false} />
                  <XAxis type="number" tickFormatter={fmtShort} tick={{ fontSize: 11, fill: '#93A0B5' }} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11.5, fill: '#16243C' }} tickLine={false} axisLine={false} width={140} />
                  <Tooltip formatter={(v) => [fmtLKR(v), 'Spend']} contentStyle={{ borderRadius: 9, border: '1px solid #E5E8ED', fontSize: 12 }} />
                  <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                    {data.byClient.slice(0, 12).map((_, idx) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* By Client Table */}
          {data.byClient.length > 1 && (
            <div className="section-card" style={{ padding: 0, overflow: 'hidden', marginBottom: 20 }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 14 }}>
                Spend by Client ({data.byClient.length})
              </div>
              <div style={{ maxHeight: 300, overflow: 'auto' }}>
                <table className="tbl" style={{ margin: 0 }}>
                  <thead>
                    <tr>
                      <th>Client</th>
                      <th style={{ textAlign: 'right' }}>Entries</th>
                      <th style={{ textAlign: 'right' }}>Schedule Value</th>
                      <th style={{ textAlign: 'right' }}>% Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byClient.map(c => (
                      <tr key={c.name}>
                        <td className="strong">{c.name}</td>
                        <td style={{ textAlign: 'right' }}>{c.count}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{fmtLKR(c.value)}</td>
                        <td className="mono" style={{ textAlign: 'right', color: 'var(--muted)' }}>
                          {data.totalValue > 0 ? ((c.value / data.totalValue) * 100).toFixed(1) + '%' : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* By Brand Table */}
          {data.byBrand.length > 0 && (
            <div className="section-card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 14 }}>
                Spend by Brand ({data.byBrand.length})
              </div>
              <div style={{ maxHeight: 300, overflow: 'auto' }}>
                <table className="tbl" style={{ margin: 0 }}>
                  <thead>
                    <tr>
                      <th>Brand</th>
                      <th style={{ textAlign: 'right' }}>Entries</th>
                      <th style={{ textAlign: 'right' }}>Schedule Value</th>
                      <th style={{ textAlign: 'right' }}>% Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byBrand.map(b => (
                      <tr key={b.name}>
                        <td className="strong">{b.name}</td>
                        <td style={{ textAlign: 'right' }}>{b.count}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{fmtLKR(b.value)}</td>
                        <td className="mono" style={{ textAlign: 'right', color: 'var(--muted)' }}>
                          {data.totalValue > 0 ? ((b.value / data.totalValue) * 100).toFixed(1) + '%' : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {!loading && data && data.totalEntries === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)' }}>
          <Icon name="bar-chart" size={40} style={{ opacity: 0.2, marginBottom: 10, display: 'inline-block' }} />
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>No data for the selected filters</p>
          <p style={{ margin: '6px 0 0', fontSize: 13 }}>Try adjusting the date range or filters</p>
        </div>
      )}
    </div>
  );
}
