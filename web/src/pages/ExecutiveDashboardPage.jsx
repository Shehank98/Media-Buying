import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, PieChart, Pie, Cell, ComposedChart,
} from 'recharts';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import Icon from '../components/Icon';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

const fmtLKR = (v) => {
  if (v == null) return '-';
  return 'LKR ' + Math.round(Number(v)).toLocaleString('en-US');
};

const fmtShort = (v) => {
  if (v == null || v === 0) return '0';
  if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
  if (v >= 1000) return (v / 1000).toFixed(0) + 'K';
  return String(v);
};

const fmtMonth = (ym) => {
  if (!ym) return '-';
  const [y, m] = ym.split('-');
  return new Date(+y, +m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
};

const MediumBadge = ({ medium }) => {
  const colors = {
    TV: ['#1e3a5f', '#dbeafe'],
    RADIO: ['#E85D24', '#fff5f0'],
    PRINT: ['#059669', '#ecfdf5'],
  };
  const [fg, bg] = colors[medium] || ['#6b7280', '#f3f4f6'];
  return (
    <span style={{ background: bg, color: fg, borderRadius: 5, padding: '2px 8px', fontSize: 12, fontWeight: 700 }}>
      {medium}
    </span>
  );
};

const Skeleton = ({ w = '100%', h = 20 }) => (
  <div style={{ width: w, height: h, background: 'var(--bg-sunken)', borderRadius: 6, animation: 'pulse 1.5s ease-in-out infinite' }} />
);

const AGENCY_COLORS = ['#0A1729', '#E85D24', '#0891b2', '#7c3aed', '#065f46'];
const MEDIUM_COLORS = { TV: '#1e3a5f', RADIO: '#E85D24', PRINT: '#059669' };

const ChartEmpty = () => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--muted)' }}>
    <Icon name="bar-chart" size={36} style={{ opacity: 0.3, marginBottom: 8 }} />
    <div style={{ fontSize: 14 }}>No data for selected period</div>
  </div>
);

const CustomTooltipLKR = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, color: 'var(--muted)' }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ fontSize: 13, color: p.color || 'var(--ink)', marginBottom: 2 }}>
          <span style={{ marginRight: 6, fontWeight: 600 }}>{p.name}:</span>
          {fmtLKR(p.value)}
        </div>
      ))}
    </div>
  );
};

export default function ExecutiveDashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [agencyId, setAgencyId] = useState('');
  const [agencies, setAgencies] = useState([]);

  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  const [trendData, setTrendData] = useState(null);
  const [trendLoading, setTrendLoading] = useState(true);
  const [trendView, setTrendView] = useState('combined'); // 'combined' | 'byAgency'

  const [topClients, setTopClients] = useState([]);
  const [topClientsLoading, setTopClientsLoading] = useState(true);

  const [topChannels, setTopChannels] = useState([]);
  const [topChannelsLoading, setTopChannelsLoading] = useState(true);

  const [agencyComparison, setAgencyComparison] = useState([]);
  const [agencyCompLoading, setAgencyCompLoading] = useState(true);
  const [agencyCompValueType, setAgencyCompValueType] = useState('scheduleValue');

  const [mediumSplit, setMediumSplit] = useState(null);
  const [mediumLoading, setMediumLoading] = useState(true);

  const [activityLog, setActivityLog] = useState([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityPage, setActivityPage] = useState(1);
  const [activityTotal, setActivityTotal] = useState(0);

  const [recentUploads, setRecentUploads] = useState([]);
  const [uploadsLoading, setUploadsLoading] = useState(true);

  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  // Fetch agencies list for filter
  useEffect(() => {
    if (!isSuperAdmin) return;
    api.get('/admin/agencies').then(r => {
      setAgencies(r.data.agencies || r.data || []);
    }).catch(() => {});
  }, [isSuperAdmin]);

  const buildAgencyParam = useCallback(() => {
    const params = {};
    if (agencyId) params.agencyId = agencyId;
    return params;
  }, [agencyId]);

  // Summary
  useEffect(() => {
    setSummaryLoading(true);
    api.get('/analytics/dashboard/summary', { params: buildAgencyParam() })
      .then(r => setSummary(r.data))
      .catch(() => setSummary(null))
      .finally(() => setSummaryLoading(false));
  }, [agencyId, buildAgencyParam]);

  // Trend
  useEffect(() => {
    setTrendLoading(true);
    api.get('/analytics/dashboard/monthly-trend')
      .then(r => setTrendData(r.data))
      .catch(() => setTrendData(null))
      .finally(() => setTrendLoading(false));
  }, []);

  // Top clients
  useEffect(() => {
    setTopClientsLoading(true);
    api.get('/analytics/dashboard/top-clients')
      .then(r => setTopClients(r.data || []))
      .catch(() => setTopClients([]))
      .finally(() => setTopClientsLoading(false));
  }, []);

  // Top channels
  useEffect(() => {
    setTopChannelsLoading(true);
    api.get('/analytics/dashboard/top-channels')
      .then(r => setTopChannels(r.data || []))
      .catch(() => setTopChannels([]))
      .finally(() => setTopChannelsLoading(false));
  }, []);

  // Agency comparison
  useEffect(() => {
    setAgencyCompLoading(true);
    api.get('/analytics/dashboard/agency-comparison')
      .then(r => setAgencyComparison(r.data || []))
      .catch(() => setAgencyComparison([]))
      .finally(() => setAgencyCompLoading(false));
  }, []);

  // Medium split
  useEffect(() => {
    setMediumLoading(true);
    api.get('/analytics/dashboard/medium-split', { params: buildAgencyParam() })
      .then(r => setMediumSplit(r.data))
      .catch(() => setMediumSplit(null))
      .finally(() => setMediumLoading(false));
  }, [agencyId, buildAgencyParam]);

  // Activity log
  useEffect(() => {
    if (!isSuperAdmin) return;
    setActivityLoading(true);
    api.get('/analytics/dashboard/activity-log', {
      params: { page: activityPage, limit: 50, ...(agencyId ? { agencyId } : {}) }
    })
      .then(r => {
        setActivityLog(r.data.items || []);
        setActivityTotal(r.data.total || 0);
      })
      .catch(() => setActivityLog([]))
      .finally(() => setActivityLoading(false));
  }, [isSuperAdmin, agencyId, activityPage]);

  // Recent uploads
  useEffect(() => {
    setUploadsLoading(true);
    api.get('/analytics/dashboard/recent-uploads')
      .then(r => setRecentUploads(r.data || []))
      .catch(() => setRecentUploads([]))
      .finally(() => setUploadsLoading(false));
  }, []);

  // Build agency comparison chart data
  const agencyCompChartData = (() => {
    if (!agencyComparison.length) return [];
    const monthSet = new Set();
    agencyComparison.forEach(a => (a.monthly || []).forEach(m => monthSet.add(m.month)));
    const months = Array.from(monthSet).sort().slice(-12);
    return months.map(month => {
      const row = { month: fmtMonth(month) };
      agencyComparison.forEach((ag, i) => {
        const m = (ag.monthly || []).find(x => x.month === month);
        row[ag.agencyName] = m ? m[agencyCompValueType] : 0;
      });
      return row;
    });
  })();

  const yoyColor = (pct) => {
    if (pct == null) return 'var(--muted)';
    return pct >= 0 ? 'var(--green-600)' : 'var(--red-600)';
  };

  const trendIcon = (dir) => {
    if (dir === 'up') return <Icon name="trending-up" size={14} style={{ color: 'var(--green-600)' }} />;
    if (dir === 'down') return <Icon name="trending-down" size={14} style={{ color: 'var(--red-600)' }} />;
    return null;
  };

  // Delta/trend chip per design tokens
  const Chip = ({ dir = 'flat', children }) => {
    const palette = {
      up: { color: '#15814B', bg: '#ECF8F1' },
      down: { color: '#C5391F', bg: '#FBE0DA' },
      flat: { color: '#6B7790', bg: '#EEF0F3' },
    };
    const p = palette[dir] || palette.flat;
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', fontSize: 11.5, fontWeight: 700,
        padding: '3px 8px', borderRadius: 7, color: p.color, background: p.bg,
        fontFamily: "'Spline Sans Mono', monospace",
      }}>
        {children}
      </span>
    );
  };

  // Build KPI list from real summary data (only metrics with data)
  const kpis = summary ? [
    {
      key: 'billingsThisMonth', icon: 'dollar', label: 'Billings this month',
      value: fmtLKR(summary.billingsThisMonth),
      chip: summary.yoyGrowthPct != null
        ? { dir: summary.yoyGrowthPct >= 0 ? 'up' : 'down', text: (summary.yoyGrowthPct >= 0 ? '+' : '') + summary.yoyGrowthPct.toFixed(1) + '%' }
        : { dir: 'flat', text: 'YoY' },
    },
    { key: 'billingsYTD', icon: 'trending-up', label: 'YTD Billings', value: fmtLKR(summary.billingsYTD) },
    summary.yoyGrowthPct != null && {
      key: 'yoy', icon: 'bar-chart', label: 'YoY Growth',
      value: (summary.yoyGrowthPct >= 0 ? '+' : '') + summary.yoyGrowthPct.toFixed(1) + '%',
      valueColor: summary.yoyGrowthPct >= 0 ? '#15814B' : '#C5391F',
      chip: { dir: summary.yoyGrowthPct >= 0 ? 'up' : 'down', text: summary.yoyGrowthPct >= 0 ? 'up' : 'down' },
    },
    summary.activeClients != null && { key: 'activeClients', icon: 'users', label: 'Active Clients', value: String(summary.activeClients) },
    summary.logsThisMonth != null && { key: 'logsThisMonth', icon: 'calendar', label: 'Logs this month', value: String(summary.logsThisMonth) },
    summary.activeChannelsThisMonth != null && { key: 'activeChannels', icon: 'tv', label: 'Active Channels', value: String(summary.activeChannelsThisMonth) },
    summary.uploadsThisMonth != null && { key: 'uploads', icon: 'upload', label: 'Uploads this month', value: String(summary.uploadsThisMonth) },
    summary.manualEntriesThisMonth != null && { key: 'manual', icon: 'edit', label: 'Manual entries', value: String(summary.manualEntriesThisMonth) },
  ].filter(Boolean) : [];

  const [exporting, setExporting] = useState(false);

  const exportSummaryPdf = () => {
    setExporting(true);
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      const margin = 40;
      const agencyName = agencyId ? (agencies.find((a) => String(a.id) === String(agencyId))?.name || 'Selected agency') : 'All agencies';

      // Branded header band
      doc.setFillColor(10, 23, 41);
      doc.rect(0, 0, pageW, 70, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(17);
      doc.text('Ogilvy Orbit - Executive Summary', margin, 32);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
      doc.setTextColor(200, 210, 224);
      doc.text(`${agencyName}  ·  Generated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`, margin, 50);

      let y = 96;

      // KPI section
      if (kpis.length) {
        doc.setTextColor(22, 36, 60); doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
        doc.text('Key Metrics', margin, y); y += 8;
        autoTable(doc, {
          startY: y,
          head: [['Metric', 'Value']],
          body: kpis.map((k) => [k.label, String(k.value)]),
          styles: { fontSize: 9, cellPadding: 5 },
          headStyles: { fillColor: [22, 36, 60] },
          columnStyles: { 1: { halign: 'right', font: 'courier' } },
          margin: { left: margin, right: margin },
        });
        y = doc.lastAutoTable.finalY + 22;
      }

      // Top clients
      if (topClients.length) {
        doc.setTextColor(22, 36, 60); doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
        doc.text('Top Clients (YTD Billing)', margin, y); y += 8;
        autoTable(doc, {
          startY: y,
          head: [['#', 'Client', 'Agency', 'YTD Billing', 'MoM']],
          body: topClients.slice(0, 10).map((c) => [
            c.rank, c.clientName, c.agencyName || '-', fmtLKR(c.ytdBilling),
            c.momTrend != null ? (c.momTrend >= 0 ? '+' : '') + c.momTrend.toFixed(1) + '%' : '-',
          ]),
          styles: { fontSize: 9, cellPadding: 5 },
          headStyles: { fillColor: [22, 36, 60] },
          columnStyles: { 0: { cellWidth: 26 }, 3: { halign: 'right' }, 4: { halign: 'right' } },
          margin: { left: margin, right: margin },
        });
        y = doc.lastAutoTable.finalY + 22;
      }

      // Top channels
      if (topChannels.length) {
        if (y > doc.internal.pageSize.getHeight() - 140) { doc.addPage(); y = 50; }
        doc.setTextColor(22, 36, 60); doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
        doc.text('Top Channels (YTD Spend)', margin, y); y += 8;
        autoTable(doc, {
          startY: y,
          head: [['#', 'Channel', 'Medium', 'Clients', 'YTD Spend', 'YoY']],
          body: topChannels.slice(0, 10).map((c) => [
            c.rank, c.channelName, c.medium || '-', c.clientCount ?? '-', fmtLKR(c.ytdSpend),
            c.yoyChange != null ? (c.yoyChange >= 0 ? '+' : '') + c.yoyChange.toFixed(1) + '%' : '-',
          ]),
          styles: { fontSize: 9, cellPadding: 5 },
          headStyles: { fillColor: [22, 36, 60] },
          columnStyles: { 0: { cellWidth: 26 }, 4: { halign: 'right' }, 5: { halign: 'right' } },
          margin: { left: margin, right: margin },
        });
        y = doc.lastAutoTable.finalY + 22;
      }

      // Agency comparison
      if (agencyComparison.length) {
        if (y > doc.internal.pageSize.getHeight() - 140) { doc.addPage(); y = 50; }
        doc.setTextColor(22, 36, 60); doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
        doc.text('Agency Comparison', margin, y); y += 8;
        autoTable(doc, {
          startY: y,
          head: [['Agency', 'YTD Billings', 'Active Clients', 'Active Channels', 'YTD Growth']],
          body: agencyComparison.map((ag) => [
            ag.agencyName, fmtLKR(ag.ytdBillings), ag.activeClients ?? '-', ag.activeChannels ?? '-',
            ag.ytdGrowthPct != null ? (ag.ytdGrowthPct >= 0 ? '+' : '') + ag.ytdGrowthPct.toFixed(1) + '%' : '-',
          ]),
          styles: { fontSize: 9, cellPadding: 5 },
          headStyles: { fillColor: [22, 36, 60] },
          columnStyles: { 1: { halign: 'right' }, 4: { halign: 'right' } },
          margin: { left: margin, right: margin },
        });
        y = doc.lastAutoTable.finalY + 22;
      }

      // Medium split (YTD)
      const ytdMedium = mediumSplit?.ytd || [];
      if (ytdMedium.length) {
        if (y > doc.internal.pageSize.getHeight() - 120) { doc.addPage(); y = 50; }
        doc.setTextColor(22, 36, 60); doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
        doc.text('Medium Split (Year to Date)', margin, y); y += 8;
        autoTable(doc, {
          startY: y,
          head: [['Medium', 'Value', 'Share']],
          body: ytdMedium.map((m) => [m.medium, fmtLKR(m.value), m.pct != null ? m.pct.toFixed(1) + '%' : '-']),
          styles: { fontSize: 9, cellPadding: 5 },
          headStyles: { fillColor: [22, 36, 60] },
          columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
          margin: { left: margin, right: margin },
        });
      }

      // Footer page numbers
      const pages = doc.internal.getNumberOfPages();
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(150, 160, 176);
        doc.text(`Page ${i} of ${pages}`, pageW - margin, doc.internal.pageSize.getHeight() - 20, { align: 'right' });
      }

      doc.save(`executive-summary-${new Date().toISOString().slice(0, 10)}.pdf`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fade-in" style={{ maxWidth: 1320, margin: '0 auto' }}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        .dash-section { margin-bottom: 36px; }
        .dash-section-title { font-size: 15px; font-weight: 720; color: var(--ink); margin-bottom: 14px; letter-spacing: -0.3px; }
        .ed-card { background: #fff; border: 1px solid #E5E8ED; border-radius: 14px; box-shadow: 0 1px 2px rgba(15,31,61,.06); }
        .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 20px; }
        .kpi-card { background: #fff; border: 1px solid #E5E8ED; border-radius: 13px; box-shadow: 0 1px 2px rgba(15,31,61,.06); padding: 16px 18px; }
        .kpi-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
        .kpi-val { font-size: 23px; font-weight: 700; letter-spacing: -.6px; font-family: 'Spline Sans Mono', monospace; color: #16243C; }
        .kpi-label { font-size: 12px; color: #6B7790; margin-top: 5px; }
        .two-col-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 18px; }
        .chart-card { background: #fff; border: 1px solid #E5E8ED; border-radius: 14px; box-shadow: 0 1px 2px rgba(15,31,61,.06); padding: 20px; }
        .chart-card-title { font-size: 14px; font-weight: 700; color: #16243C; margin-bottom: 4px; }
        .chart-card-sub { font-size: 12px; color: #6B7790; margin-bottom: 16px; }
        .ed-secondary-btn { border: 1px solid #D5DAE2; background: #fff; color: #3B4A63; border-radius: 10px; padding: 9px 14px; font-size: 13px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 7px; }
        .toggle-group { display: flex; gap: 6px; }
        .toggle-btn { padding: 5px 12px; border-radius: 6px; border: 1px solid var(--border); background: transparent; font-size: 12.5px; font-weight: 600; color: var(--muted); cursor: pointer; }
        .toggle-btn.active { background: var(--navy-900); color: #fff; border-color: var(--navy-900); }
        .agency-comp-summary { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin-top: 16px; }
        .agency-sum-card { background: var(--bg-sunken); border-radius: 10px; padding: 14px; }
        .agency-sum-name { font-size: 13px; font-weight: 700; color: var(--ink); margin-bottom: 8px; }
        .agency-sum-row { display: flex; justify-content: space-between; font-size: 12px; color: var(--muted); margin-bottom: 3px; }
        .activity-table-wrap { max-height: 400px; overflow-y: auto; }
        .pagination { display: flex; align-items: center; gap: 10px; margin-top: 12px; justify-content: flex-end; }
        .placeholder-card { background: var(--bg-sunken); border: 2px dashed var(--border-strong); border-radius: 12px; padding: 40px; text-align: center; }
        .league-row td { padding: 12px 22px; border-bottom: 1px solid #EEF0F3; }
        .league-row:hover { background: #F7F8FA; }

        /* Navy hero */
        .ed-hero { position: relative; overflow: hidden; border-radius: 18px; margin-bottom: 22px; background: linear-gradient(135deg, #0A1729 0%, #122842 55%, #0F1F3D 100%); padding: 26px 28px; color: #fff; }
        .ed-hero::before { content: ''; position: absolute; top: -60px; right: -60px; width: 240px; height: 240px; background: radial-gradient(circle, rgba(232,93,36,.30), transparent 70%); border-radius: 50%; }
        .ed-hero::after { content: ''; position: absolute; bottom: -90px; left: 22%; width: 220px; height: 220px; background: radial-gradient(circle, rgba(31,91,181,.22), transparent 70%); border-radius: 50%; }
        .ed-hero-inner { position: relative; z-index: 1; }
        .ed-hero-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
        .ed-hero-title { font-size: 25px; font-weight: 750; letter-spacing: -.6px; margin: 0; }
        .ed-hero-sub { font-size: 13.5px; color: rgba(255,255,255,.55); margin: 6px 0 0; }
        .ed-hero-actions { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; }
        .ed-hero-field { display: flex; flex-direction: column; gap: 5px; min-width: 170px; }
        .ed-hero-field label { font-size: 10.5px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; color: rgba(255,255,255,.45); }
        .ed-hero-select { background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.16); color: #fff; border-radius: 9px; padding: 9px 12px; font-size: 13px; font-weight: 500; outline: none; cursor: pointer; }
        .ed-hero-select option { color: #16243C; }
        .ed-hero-btn { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 650; border-radius: 9px; padding: 9px 14px; cursor: pointer; border: 1px solid rgba(255,255,255,.18); background: rgba(255,255,255,.08); color: #fff; transition: background .15s; }
        .ed-hero-btn:hover:not(:disabled) { background: rgba(255,255,255,.18); }
        .ed-hero-btn:disabled { opacity: .5; cursor: not-allowed; }
        .ed-hero-btn.accent { background: #E85D24; border-color: #E85D24; }
        .ed-hero-btn.accent:hover { background: #D9521C; }
        .ed-hero-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-top: 22px; }
        .ed-hero-stat { background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.10); border-radius: 12px; padding: 13px 15px; }
        .ed-hero-stat-label { font-size: 11px; color: rgba(255,255,255,.55); font-weight: 600; }
        .ed-hero-stat-val { font-size: 20px; font-weight: 750; letter-spacing: -.4px; font-family: 'Spline Sans Mono', monospace; margin-top: 6px; }

        /* Ranked visual bars */
        .rank-row { display: flex; align-items: center; gap: 12px; padding: 9px 8px; border-radius: 9px; cursor: pointer; transition: background .12s; }
        .rank-row:hover { background: #F5F6F8; }
        .rank-num { width: 22px; height: 22px; flex-shrink: 0; border-radius: 6px; display: grid; place-items: center; font-size: 11px; font-weight: 700; font-family: 'Spline Sans Mono', monospace; }
        .rank-main { flex: 1; min-width: 0; }
        .rank-name-row { display: flex; align-items: center; gap: 6px; margin-bottom: 5px; }
        .rank-name { font-size: 12.5px; font-weight: 650; color: #16243C; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .rank-meta { font-size: 11px; color: #93A0B5; flex-shrink: 0; }
        .rank-bar-track { height: 8px; border-radius: 5px; background: #EEF0F3; overflow: hidden; }
        .rank-bar-fill { height: 100%; border-radius: 5px; transition: width .4s ease; }
        .rank-side { flex-shrink: 0; text-align: right; min-width: 124px; }
        .rank-val { font-size: 12.5px; font-weight: 700; font-family: 'Spline Sans Mono', monospace; color: #16243C; display: flex; align-items: center; gap: 6px; justify-content: flex-end; }
        .rank-sub { font-size: 11.5px; font-weight: 600; font-family: 'Spline Sans Mono', monospace; color: #6B7790; display: flex; align-items: center; gap: 6px; justify-content: flex-end; margin-top: 2px; }
        .rank-tag { font-size: 8.5px; font-weight: 700; letter-spacing: .5px; color: #93A0B5; background: #EEF0F3; border-radius: 4px; padding: 1px 4px; }
        .rank-delta { font-size: 11px; font-weight: 700; display: flex; align-items: center; gap: 3px; justify-content: flex-end; margin-top: 3px; }

        /* Upload detail rows */
        .ed-upload-row { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; padding: 12px 0; border-bottom: 1px solid #EEF0F3; }
        .ed-upload-row:last-child { border-bottom: none; }
        .ed-status-pill { font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 6px; text-transform: capitalize; }
        @media (max-width: 1100px) { .kpi-grid { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); } .ed-hero-stats { grid-template-columns: repeat(2, 1fr); } }
      `}</style>

      {/* Navy hero header */}
      <div className="ed-hero">
        <div className="ed-hero-inner">
          <div className="ed-hero-top">
            <div>
              <h1 className="ed-hero-title">Executive Dashboard</h1>
              <p className="ed-hero-sub">
                Billings overview across {agencyId ? (agencies.find(a => String(a.id) === String(agencyId))?.name || 'selected agency') : 'all agencies'} · {new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
              </p>
            </div>
            <div className="ed-hero-actions">
              {isSuperAdmin && (
                <div className="ed-hero-field">
                  <label>Agency</label>
                  <select className="ed-hero-select" value={agencyId} onChange={e => setAgencyId(e.target.value)}>
                    <option value="">All agencies</option>
                    {agencies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              )}
              <button className="ed-hero-btn" onClick={exportSummaryPdf} disabled={exporting || summaryLoading}>
                <Icon name="download" size={15} />
                {exporting ? 'Exporting…' : 'Export summary'}
              </button>
              <button className="ed-hero-btn accent" onClick={() => navigate('/deep-dashboard')}>
                <Icon name="bar-chart" size={15} />
                Deep Dashboard
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Section 1: KPI Cards */}
      <div className="kpi-grid">
        {summaryLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="kpi-card">
              <Skeleton h={12} w="60%" />
              <div style={{ marginTop: 12 }}><Skeleton h={28} w="80%" /></div>
            </div>
          ))
        ) : summary ? (
          kpis.map(k => (
            <div key={k.key} className="kpi-card">
              <div className="kpi-top">
                <span style={{ color: '#93A0B5', display: 'inline-flex' }}><Icon name={k.icon} size={18} /></span>
                {k.chip && <Chip dir={k.chip.dir}>{k.chip.text}</Chip>}
              </div>
              <div className="kpi-val" style={k.valueColor ? { color: k.valueColor } : undefined}>{k.value}</div>
              <div className="kpi-label">{k.label}</div>
            </div>
          ))
        ) : (
          <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '30px 0', color: 'var(--muted)' }}>
            Failed to load summary
          </div>
        )}
      </div>

      {/* Section 2: Monthly Billing Trend */}
      <div className="dash-section">
        <div className="chart-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div>
              <div className="chart-card-title">Monthly Billing Trend</div>
              <div className="chart-card-sub">Last 24 months - invoice value</div>
            </div>
            <div className="toggle-group">
              <button className={`toggle-btn${trendView === 'combined' ? ' active' : ''}`} onClick={() => setTrendView('combined')}>Combined</button>
              <button className={`toggle-btn${trendView === 'byAgency' ? ' active' : ''}`} onClick={() => setTrendView('byAgency')}>By Agency</button>
            </div>
          </div>
          {trendLoading ? <Skeleton h={280} /> : !trendData ? <ChartEmpty /> : (
            trendView === 'combined' ? (
              (() => {
                const data = (trendData.combined || []).slice(-24).map(d => ({
                  month: fmtMonth(d.month),
                  scheduleValue: d.scheduleValue || 0,
                }));
                if (!data.length) return <ChartEmpty />;
                return (
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={data}>
                      <defs>
                        <linearGradient id="gradNav" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#0A1729" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#0A1729" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                      <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
                      <Tooltip content={<CustomTooltipLKR />} />
                      <Area type="monotone" dataKey="scheduleValue" name="Schedule Value" stroke="#0A1729" strokeWidth={2} fill="url(#gradNav)" />
                    </AreaChart>
                  </ResponsiveContainer>
                );
              })()
            ) : (
              (() => {
                const agencyLines = trendData.byAgency || [];
                const monthSet = new Set();
                agencyLines.forEach(ag => (ag.data || []).forEach(d => monthSet.add(d.month)));
                const months = Array.from(monthSet).sort().slice(-24);
                const chartData = months.map(m => {
                  const row = { month: fmtMonth(m) };
                  agencyLines.forEach(ag => {
                    const d = (ag.data || []).find(x => x.month === m);
                    row[ag.agencyName] = d ? d.scheduleValue : 0;
                  });
                  return row;
                });
                if (!chartData.length) return <ChartEmpty />;
                return (
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={chartData}>
                      <CartesianGrid stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                      <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
                      <Tooltip content={<CustomTooltipLKR />} />
                      <Legend />
                      {agencyLines.map((ag, i) => (
                        <Line key={ag.agencyId} type="monotone" dataKey={ag.agencyName} stroke={AGENCY_COLORS[i % AGENCY_COLORS.length]} strokeWidth={2} dot={false} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                );
              })()
            )
          )}
        </div>
      </div>

      {/* Section 3: Top Clients + Top Channels (visual ranked bars) */}
      <div className="dash-section two-col-grid">
        {/* Top Clients */}
        <div className="chart-card">
          <div className="chart-card-title">Top 10 Clients</div>
          <div className="chart-card-sub">By YTD billing - bar length is share of the top client</div>
          {topClientsLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} h={40} />)}
            </div>
          ) : !topClients.length ? (
            <ChartEmpty />
          ) : (() => {
            const max = Math.max(...topClients.map(c => c.ytdBilling || 0), 1);
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
                {topClients.slice(0, 10).map((c, i) => {
                  const color = AGENCY_COLORS[i % AGENCY_COLORS.length];
                  const pct = Math.max(2, Math.round((c.ytdBilling / max) * 100));
                  return (
                    <div key={c.clientId} className="rank-row" onClick={() => navigate(`/clients/${c.clientId}/dashboard`)}>
                      <span className="rank-num" style={{ background: i < 3 ? color : '#EEF0F3', color: i < 3 ? '#fff' : '#6B7790' }}>{c.rank}</span>
                      <div className="rank-main">
                        <div className="rank-name-row">
                          <span className="rank-name">{c.clientName}</span>
                          <span className="rank-meta">· {c.agencyName}</span>
                        </div>
                        <div className="rank-bar-track"><div className="rank-bar-fill" style={{ width: `${pct}%`, background: color }} /></div>
                      </div>
                      <div className="rank-side">
                        <div className="rank-val"><span className="rank-tag">YTD</span>{fmtLKR(c.ytdBilling)}</div>
                        <div className="rank-sub"><span className="rank-tag">MO</span>{fmtLKR(c.currentMonthBilling || 0)}</div>
                        <div className="rank-delta" style={{ color: c.momDirection === 'up' ? 'var(--green-600)' : c.momDirection === 'down' ? 'var(--red-600)' : 'var(--muted)' }}>
                          {trendIcon(c.momDirection)}
                          {c.momTrend != null ? (c.momTrend >= 0 ? '+' : '') + c.momTrend.toFixed(1) + '% MoM' : 'no MoM'}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>

        {/* Top Channels */}
        <div className="chart-card">
          <div className="chart-card-title">Top 10 Channels</div>
          <div className="chart-card-sub">By YTD spend - bar length is share of the top channel</div>
          {topChannelsLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} h={40} />)}
            </div>
          ) : !topChannels.length ? (
            <ChartEmpty />
          ) : (() => {
            const max = Math.max(...topChannels.map(c => c.ytdSpend || 0), 1);
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
                {topChannels.slice(0, 10).map((c, i) => {
                  const color = MEDIUM_COLORS[c.medium] || AGENCY_COLORS[i % AGENCY_COLORS.length];
                  const pct = Math.max(2, Math.round((c.ytdSpend / max) * 100));
                  return (
                    <div key={c.channelMasterId} className="rank-row" onClick={() => navigate(`/channel-masters/${c.channelMasterId}`)}>
                      <span className="rank-num" style={{ background: i < 3 ? color : '#EEF0F3', color: i < 3 ? '#fff' : '#6B7790' }}>{c.rank}</span>
                      <div className="rank-main">
                        <div className="rank-name-row">
                          <span className="rank-name">{c.channelName}</span>
                          <MediumBadge medium={c.medium} />
                          <span className="rank-meta">· {c.clientCount} clients</span>
                        </div>
                        <div className="rank-bar-track"><div className="rank-bar-fill" style={{ width: `${pct}%`, background: color }} /></div>
                      </div>
                      <div className="rank-side">
                        <div className="rank-val"><span className="rank-tag">YTD</span>{fmtLKR(c.ytdSpend)}</div>
                        <div className="rank-sub"><span className="rank-tag">MO</span>{fmtLKR(c.currentMonthSpend || 0)}</div>
                        <div className="rank-delta" style={{ color: c.yoyChange == null ? 'var(--muted)' : c.yoyChange >= 0 ? 'var(--green-600)' : 'var(--red-600)' }}>
                          {c.yoyChange != null ? (c.yoyChange >= 0 ? '+' : '') + c.yoyChange.toFixed(1) + '% YoY' : 'no YoY'}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      </div>

      {/* Section 4: Agency Comparison */}
      <div className="dash-section">
        <div className="chart-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div>
              <div className="chart-card-title">Agency Comparison</div>
              <div className="chart-card-sub">Monthly billings per agency - last 12 months</div>
            </div>
            <div className="toggle-group">
              <button className="toggle-btn active">Schedule Value</button>
            </div>
          </div>
          {agencyCompLoading ? <Skeleton h={260} /> : !agencyCompChartData.length ? <ChartEmpty /> : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={agencyCompChartData} barCategoryGap="25%">
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
                <Tooltip content={<CustomTooltipLKR />} />
                <Legend />
                {agencyComparison.map((ag, i) => (
                  <Bar key={ag.agencyId} dataKey={ag.agencyName} fill={AGENCY_COLORS[i % AGENCY_COLORS.length]} radius={[3, 3, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
          {!agencyCompLoading && agencyComparison.length > 0 && (
            <div className="agency-comp-summary">
              {agencyComparison.map((ag, i) => (
                <div key={ag.agencyId} className="agency-sum-card" style={{ borderLeft: `3px solid ${AGENCY_COLORS[i % AGENCY_COLORS.length]}` }}>
                  <div className="agency-sum-name">{ag.agencyName}</div>
                  <div className="agency-sum-row"><span>YTD Billings</span><span className="mono" style={{ fontWeight: 700 }}>{fmtLKR(ag.ytdBillings)}</span></div>
                  <div className="agency-sum-row"><span>Active clients</span><span>{ag.activeClients}</span></div>
                  <div className="agency-sum-row"><span>Active channels</span><span>{ag.activeChannels}</span></div>
                  <div className="agency-sum-row"><span>YTD Growth</span>
                    <span style={{ color: (ag.ytdGrowthPct || 0) >= 0 ? 'var(--green-600)' : 'var(--red-600)', fontWeight: 700 }}>
                      {ag.ytdGrowthPct != null ? (ag.ytdGrowthPct >= 0 ? '+' : '') + ag.ytdGrowthPct.toFixed(1) + '%' : '-'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Section 5: Medium Split */}
      <div className="dash-section">
        <div className="chart-card">
          <div className="chart-card-title" style={{ marginBottom: 16 }}>Medium Split</div>
          {mediumLoading ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              <Skeleton h={240} />
              <Skeleton h={240} />
            </div>
          ) : !mediumSplit ? <ChartEmpty /> : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              {[
                { label: 'This Month', data: mediumSplit.currentMonth || [] },
                { label: 'Year to Date', data: mediumSplit.ytd || [] },
              ].map(({ label, data }) => (
                <div key={label}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--muted)', marginBottom: 12, textAlign: 'center' }}>{label}</div>
                  {!data.length ? <ChartEmpty /> : (
                    <>
                      <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                          <Pie data={data} dataKey="value" nameKey="medium" cx="50%" cy="50%" outerRadius={80} innerRadius={45} paddingAngle={3}>
                            {data.map((entry, i) => (
                              <Cell key={i} fill={MEDIUM_COLORS[entry.medium] || AGENCY_COLORS[i]} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v, name) => [fmtLKR(v), name]} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                        {data.map((entry, i) => {
                          const isYtd = label === 'Year to Date';
                          const lyVal = isYtd ? ((mediumSplit.lastYearYtd || []).find(m => m.medium === entry.medium)?.value || 0) : null;
                          const yoy = isYtd && lyVal > 0 ? ((entry.value - lyVal) / lyVal) * 100 : null;
                          return (
                            <div key={entry.medium} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                              <span style={{ width: 10, height: 10, borderRadius: 3, background: MEDIUM_COLORS[entry.medium] || AGENCY_COLORS[i], flexShrink: 0 }} />
                              <span style={{ flex: 1, fontWeight: 600 }}>{entry.medium}</span>
                              {yoy != null && (
                                <span style={{ fontSize: 11, fontWeight: 700, color: yoy >= 0 ? 'var(--green-600)' : 'var(--red-600)', minWidth: 48, textAlign: 'right' }}>
                                  {(yoy >= 0 ? '+' : '') + yoy.toFixed(0) + '% YoY'}
                                </span>
                              )}
                              <span className="mono">{fmtLKR(entry.value)}</span>
                              <span style={{ color: 'var(--muted)', minWidth: 36, textAlign: 'right' }}>{entry.pct != null ? entry.pct.toFixed(1) + '%' : ''}</span>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Section 6: Activity Log (SUPER_ADMIN only) */}
      {isSuperAdmin && (
        <div className="dash-section">
          <div className="chart-card">
            <div className="chart-card-title" style={{ marginBottom: 4 }}>Activity Log</div>
            <div className="chart-card-sub">Recent system activity</div>
            {activityLoading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} h={34} />)}
              </div>
            ) : !activityLog.length ? (
              <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--muted)', fontSize: 13 }}>No activity recorded</div>
            ) : (
              <>
                <div className="activity-table-wrap">
                  <table className="tbl" style={{ fontSize: 12.5 }}>
                    <thead>
                      <tr>
                        <th>User</th>
                        <th>Agency</th>
                        <th>Client</th>
                        <th>Action</th>
                        <th>Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activityLog.map((item, i) => (
                        <tr key={i}>
                          <td className="strong">{item.userName}</td>
                          <td style={{ color: 'var(--muted)' }}>{item.agencyName || '-'}</td>
                          <td style={{ color: 'var(--muted)' }}>{item.clientName || '-'}</td>
                          <td>
                            <span style={{
                              fontSize: 11, fontWeight: 700,
                              background: item.type === 'CREATE' ? 'var(--green-100)' : item.type === 'DELETE' ? 'var(--red-50)' : 'var(--blue-50)',
                              color: item.type === 'CREATE' ? 'var(--green-600)' : item.type === 'DELETE' ? 'var(--red-600)' : 'var(--blue-700)',
                              padding: '2px 7px', borderRadius: 4, marginRight: 6,
                            }}>{item.type || item.action}</span>
                            {item.detail && <span style={{ color: 'var(--muted)', fontSize: 12 }}>{item.detail}</span>}
                          </td>
                          <td style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                            {item.timestamp ? new Date(item.timestamp).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {activityTotal > 50 && (
                  <div className="pagination">
                    <button className="btn btn-ghost" disabled={activityPage <= 1} onClick={() => setActivityPage(p => p - 1)}>
                      <Icon name="chevL" size={15} />
                    </button>
                    <span style={{ fontSize: 13, color: 'var(--muted)' }}>Page {activityPage} of {Math.ceil(activityTotal / 50)}</span>
                    <button className="btn btn-ghost" disabled={activityPage >= Math.ceil(activityTotal / 50)} onClick={() => setActivityPage(p => p + 1)}>
                      <Icon name="chevR" size={15} />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Section 7: Recent Uploads */}
      <div className="dash-section">
        <div className="chart-card">
          <div className="chart-card-title" style={{ marginBottom: 4 }}>Recent Uploads</div>
          <div className="chart-card-sub">Latest schedule batch uploads across agencies</div>
          {uploadsLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} h={42} />)}
            </div>
          ) : !recentUploads.length ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--muted)', fontSize: 13 }}>No uploads recorded</div>
          ) : (
            <div>
              {recentUploads.map((u) => {
                const pct = u.totalRows ? Math.round((u.successfulRows / u.totalRows) * 100) : 0;
                const st = String(u.status || '').toLowerCase();
                const stColor = st === 'complete' ? ['#15814B', '#ECF8F1'] : st === 'failed' ? ['#C5391F', '#FBE0DA'] : ['#9A5B00', '#FBF1DD'];
                return (
                  <div key={u.id} className="ed-upload-row">
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <Icon name="file" size={15} style={{ color: '#93A0B5', flexShrink: 0 }} />
                        <span style={{ fontWeight: 650, fontSize: 13, color: '#16243C', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }}>{u.fileName || 'Untitled'}</span>
                        <span className="ed-status-pill" style={{ color: stColor[0], background: stColor[1] }}>{u.status || '-'}</span>
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>
                        {u.agencyName || '-'} · {u.scheduleMonth ? fmtMonth(u.scheduleMonth) : '-'} · by {u.uploadedBy}
                        {u.createdAt && ` · ${new Date(u.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="mono" style={{ fontSize: 13, fontWeight: 700, color: '#16243C' }}>{u.successfulRows}/{u.totalRows} rows</div>
                      <div style={{ fontSize: 11.5, color: u.failedRows > 0 ? 'var(--red-600)' : 'var(--green-600)', marginTop: 3 }}>
                        {u.failedRows > 0 ? `${u.failedRows} failed` : `${pct}% success`}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
