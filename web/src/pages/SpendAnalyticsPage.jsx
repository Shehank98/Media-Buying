import { useState, useEffect, useMemo, useRef, Fragment } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Icon from '../components/Icon';
import OrbitLoader from '../components/OrbitLoader';
import api from '../lib/api';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';
import {
  BarChart, Bar, PieChart, Pie, Cell, LineChart, Line, Area, AreaChart, ComposedChart,
  ScatterChart, Scatter, ZAxis,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Brush,
} from 'recharts';

const COLORS = ['#1e3a5f', '#E85D24', '#059669', '#7c3aed', '#0ea5e9', '#d97706', '#dc2626', '#6366f1', '#14b8a6', '#f43f5e'];
const MEDIUM_COLORS = { TV: '#1e3a5f', RADIO: '#E85D24', PRINT: '#059669' };

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtMonth(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  return `${MONTHS[parseInt(m) - 1]} ${y}`;
}
function fmtLKR(v) {
  if (v == null) return '-';
  return 'LKR ' + Math.round(Number(v)).toLocaleString('en-US');
}
function fmtShort(v) {
  const n = Number(v);
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return n.toFixed(0);
}

export default function SpendAnalyticsPage() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const [agencies, setAgencies] = useState([]);
  const [clients, setClients] = useState([]);
  const [agencyId, setAgencyId] = useState('');
  const [clientId, setClientId] = useState('');
  const [monthFrom, setMonthFrom] = useState('');
  const [monthTo, setMonthTo] = useState('');

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
        pdf.text(`Period: ${dateLabel}  |  Total: LKR ${fmtShort(data.totalValue)}`, margin, 30);
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
        .spa-stat { background:#fff; border:1px solid #E5E8ED; border-radius:13px; box-shadow:0 1px 2px rgba(15,31,61,.06); padding:16px 18px; }
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
              <button className="spa-btn accent" onClick={handlePdfExport} disabled={!data || loading || exporting}>
                <Icon name="download" size={15} /> {exporting ? 'Exporting…' : 'Export PDF'}
              </button>
              <button className="spa-btn" onClick={handleExport} disabled={!data || loading}>
                <Icon name="file" size={15} /> Excel
              </button>
            </div>
          </div>
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14, marginBottom: 22 }}>
            <div className="spa-stat">
              <div className="spa-stat-label">Total Schedule Value</div>
              <div className="spa-stat-val">LKR {fmtShort(data.totalValue)}</div>
              <div className="spa-stat-sub">{data.totalEntries.toLocaleString()} entries</div>
            </div>
            <div className="spa-stat">
              <div className="spa-stat-label">Total With VAT (18%)</div>
              <div className="spa-stat-val" style={{ color: '#15814B' }}>LKR {fmtShort(data.totalWithVat ?? data.totalValue * 1.18)}</div>
              <div className="spa-stat-sub">incl. tax</div>
            </div>
            <div className="spa-stat">
              <div className="spa-stat-label">Avg / Month</div>
              <div className="spa-stat-val">LKR {fmtShort(insights?.avgMonth || 0)}</div>
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

          {/* Monthly Trend Chart (value vs VAT, with bars + line) */}
          {chartMonthly.length > 0 && (
            <div className="spa-card" style={{ padding: '20px', marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                <div>
                  <h3 className="spa-ctitle">Monthly Spend Trend</h3>
                  <p className="spa-csub">Schedule value (bars) vs. value with VAT (line){insights?.peak ? ` · peak ${fmtMonth(insights.peak.month)}` : ''}</p>
                </div>
              </div>
              <div ref={chartMonthlyRef}>
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={chartMonthly} margin={{ top: 8, right: 16, bottom: 5, left: 8 }}>
                    <defs>
                      <linearGradient id="spaVat" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#E85D24" stopOpacity={0.18} />
                        <stop offset="100%" stopColor="#E85D24" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F3" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10.5, fill: '#93A0B5' }} tickLine={false} axisLine={{ stroke: '#E5E8ED' }} interval="preserveStartEnd" />
                    <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11, fill: '#93A0B5' }} tickLine={false} axisLine={false} width={48} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="value" name="Schedule Value" fill="#0A1729" radius={[4, 4, 0, 0]} maxBarSize={46} />
                    <Area type="monotone" dataKey="valueWithVat" name="With VAT (18%)" stroke="#E85D24" strokeWidth={2.2} fill="url(#spaVat)" dot={false} />
                    {chartMonthly.length > 6 && <Brush dataKey="label" height={18} stroke="#E85D24" travellerWidth={8} />}
                  </ComposedChart>
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
              <p className="spa-csub" style={{ marginBottom: 12 }}>Months active vs. total spend — bubble size = avg monthly spend</p>
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

          {/* Medium & Media Group charts side by side */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            {/* By Medium - Pie */}
            <div className="section-card" style={{ padding: '20px' }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Spend by Medium</h3>
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
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      labelLine={{ strokeWidth: 1 }}
                    >
                      {data.byMedium.map((entry, idx) => (
                        <Cell key={idx} fill={MEDIUM_COLORS[entry.name] || COLORS[idx % COLORS.length]} />
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
                      label={({ name, percent }) => percent > 0.05 ? `${name.length > 12 ? name.slice(0, 12) + '...' : name} ${(percent * 100).toFixed(0)}%` : ''}
                      labelLine={{ strokeWidth: 1 }}
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

          {/* By Channel - Full width bar chart + table */}
          <div className="section-card" style={{ padding: '20px', marginBottom: 20 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Spend by Channel (Top 15)</h3>
            <div ref={chartChannelRef}>
              <ResponsiveContainer width="100%" height={Math.min(400, data.byChannel.slice(0, 15).length * 32 + 40)}>
                <BarChart data={data.byChannel.slice(0, 15)} layout="vertical" margin={{ top: 5, right: 30, bottom: 5, left: 120 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e8ed" />
                  <XAxis type="number" tickFormatter={fmtShort} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={110} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="value" name="Schedule Value" radius={[0, 4, 4, 0]}>
                    {data.byChannel.slice(0, 15).map((ch, idx) => (
                      <Cell key={idx} fill={MEDIUM_COLORS[ch.medium] || COLORS[idx % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
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
                    <th style={{ width: 260 }}>Media Group / Channel</th>
                    <th>Medium</th>
                    <th style={{ textAlign: 'right' }}>Entries</th>
                    <th style={{ textAlign: 'right' }}>Schedule Value</th>
                    <th style={{ textAlign: 'right' }}>% Share</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byMediaGroup.map((mg, mgIdx) => {
                    const channels = data.byChannel.filter(ch => ch.mediaGroup === mg.name);
                    const mgPct = data.totalValue > 0 ? ((mg.value / data.totalValue) * 100).toFixed(1) + '%' : '-';
                    return (
                      <Fragment key={mg.name}>
                        <tr style={{ background: 'var(--navy-50, #f0f4f8)' }}>
                          <td style={{ fontWeight: 700, fontSize: 13 }}>
                            <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: COLORS[mgIdx % COLORS.length], marginRight: 8, verticalAlign: 'middle' }} />
                            {mg.name}
                          </td>
                          <td></td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>{mg.count}</td>
                          <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{fmtLKR(mg.value)}</td>
                          <ShareCell value={mg.value} color={COLORS[mgIdx % COLORS.length]} strong />
                        </tr>
                        {channels.map(ch => (
                          <tr key={ch.name}>
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
