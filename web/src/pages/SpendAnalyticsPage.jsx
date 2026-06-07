import { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Icon from '../components/Icon';
import api from '../lib/api';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';
import {
  BarChart, Bar, PieChart, Pie, Cell, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
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
    return data.byMonth.map(m => ({
      ...m,
      label: fmtMonth(m.month),
      valueMil: Math.round(m.value / 1000),
    }));
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
        return canvas.toDataURL('image/png');
      };

      // Page 1: Monthly Spend Trend
      addHeader('Monthly Spend Trend');
      const monthlyImg = await captureChart(chartMonthlyRef);
      if (monthlyImg) {
        const imgH = contentW * 0.45;
        pdf.addImage(monthlyImg, 'PNG', margin, 38, contentW, imgH);
        autoTable(pdf, {
          startY: 38 + imgH + 5,
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
      if (mediumImg) {
        const imgH = contentW * 0.5;
        pdf.addImage(mediumImg, 'PNG', margin, 38, contentW, imgH);
        autoTable(pdf, {
          startY: 38 + imgH + 5,
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
      if (mgImg) {
        const imgH = contentW * 0.5;
        pdf.addImage(mgImg, 'PNG', margin, 38, contentW, imgH);
        autoTable(pdf, {
          startY: 38 + imgH + 5,
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
      if (chImg) {
        const imgH = Math.min(contentW * 0.5, 90);
        pdf.addImage(chImg, 'PNG', margin, 38, contentW, imgH);
        autoTable(pdf, {
          startY: 38 + imgH + 5,
          head: [['Channel', 'Medium', 'Media Group', 'Value (LKR)', 'Entries', '%']],
          body: data.byChannel.map(ch => [
            ch.name, ch.medium, ch.mediaGroup, fmtLKR(ch.value), ch.count,
            data.totalValue > 0 ? ((ch.value / data.totalValue) * 100).toFixed(1) + '%' : '-',
          ]),
          styles: { fontSize: 7, cellPadding: 1.5 },
          headStyles: { fillColor: [30, 58, 95], textColor: 255, fontStyle: 'bold' },
          margin: { left: margin, right: margin },
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
      <div className="page-head">
        <div>
          <h1 className="page-title">Spend Analytics</h1>
          <p className="page-sub">Budget allocation by media group, medium, and channel</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={handlePdfExport} disabled={!data || loading || exporting}>
            <Icon name="download" size={16} /> {exporting ? 'Exporting...' : 'Export PDF'}
          </button>
          <button className="btn btn-ghost" onClick={handleExport} disabled={!data || loading}>
            <Icon name="download" size={16} /> Excel
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="filterbar" style={{ marginBottom: 20 }}>
        <div className="filter-field">
          <label>Agency</label>
          <select className="select" value={agencyId} onChange={e => setAgencyId(e.target.value)}>
            <option value="">All Agencies</option>
            {agencies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label>Client</label>
          <select className="select" value={clientId} onChange={e => setClientId(e.target.value)} disabled={!agencyId}>
            <option value="">All Clients</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label>From</label>
          <input type="month" className="input" value={monthFrom} onChange={e => setMonthFrom(e.target.value)} />
        </div>
        <div className="filter-field">
          <label>To</label>
          <input type="month" className="input" value={monthTo} onChange={e => setMonthTo(e.target.value)} />
        </div>
        {(agencyId || monthFrom || monthTo) && (
          <button className="btn btn-ghost btn-sm" onClick={() => { setAgencyId(''); setClientId(''); setMonthFrom(''); setMonthTo(''); }} style={{ alignSelf: 'flex-end', marginBottom: 2 }}>
            <Icon name="x" size={14} /> Clear
          </button>
        )}
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#b91c1c', marginBottom: 16 }}>
          {error}
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--muted)' }}>
          <Icon name="clock" size={32} style={{ opacity: 0.3, marginBottom: 12, display: 'inline-block' }} />
          <p style={{ margin: 0 }}>Loading analytics...</p>
        </div>
      )}

      {!loading && data && (
        <>
          {/* Summary Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 24 }}>
            <div className="section-card" style={{ padding: '16px 20px' }}>
              <div className="stat">
                <div className="stat-top">
                  <span className="stat-label">Total Entries</span>
                  <span className="stat-ico" style={{ color: 'var(--blue-700, #1d4ed8)' }}><Icon name="database" size={18} /></span>
                </div>
                <div className="stat-val">{data.totalEntries.toLocaleString()}</div>
              </div>
            </div>
            <div className="section-card" style={{ padding: '16px 20px' }}>
              <div className="stat">
                <div className="stat-top">
                  <span className="stat-label">Total Schedule Value</span>
                  <span className="stat-ico" style={{ color: 'var(--green-600, #059669)' }}><Icon name="bar-chart" size={18} /></span>
                </div>
                <div className="stat-val mono">LKR {fmtShort(data.totalValue)}</div>
              </div>
            </div>
            <div className="section-card" style={{ padding: '16px 20px' }}>
              <div className="stat">
                <div className="stat-top">
                  <span className="stat-label">Media Groups</span>
                  <span className="stat-ico" style={{ color: 'var(--purple-600, #7c3aed)' }}><Icon name="grid" size={18} /></span>
                </div>
                <div className="stat-val">{data.byMediaGroup.length}</div>
              </div>
            </div>
          </div>

          {/* Monthly Trend Chart */}
          {chartMonthly.length > 0 && (
            <div className="section-card" style={{ padding: '20px', marginBottom: 20 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Monthly Spend Trend</h3>
              <div ref={chartMonthlyRef}>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={chartMonthly} margin={{ top: 5, right: 20, bottom: 5, left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e8ed" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="value" name="Schedule Value" fill="#1e3a5f" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

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
                      outerRadius={90}
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
                      outerRadius={90}
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

          {/* Full Channel Table */}
          <div className="section-card" style={{ padding: 0, overflow: 'hidden', marginBottom: 20 }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 14 }}>
              All Channels ({data.byChannel.length})
            </div>
            <div style={{ maxHeight: 400, overflow: 'auto' }}>
              <table className="tbl" style={{ margin: 0 }}>
                <thead>
                  <tr>
                    <th>Channel</th>
                    <th>Medium</th>
                    <th>Media Group</th>
                    <th style={{ textAlign: 'right' }}>Entries</th>
                    <th style={{ textAlign: 'right' }}>Schedule Value</th>
                    <th style={{ textAlign: 'right' }}>% Share</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byChannel.map(ch => (
                    <tr key={ch.name}>
                      <td className="strong">{ch.name}</td>
                      <td><span className="medium-tag" data-medium={ch.medium}>{ch.medium}</span></td>
                      <td style={{ color: 'var(--muted)', fontSize: 13 }}>{ch.mediaGroup}</td>
                      <td style={{ textAlign: 'right' }}>{ch.count}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{fmtLKR(ch.value)}</td>
                      <td className="mono" style={{ textAlign: 'right', color: 'var(--muted)' }}>
                        {data.totalValue > 0 ? ((ch.value / data.totalValue) * 100).toFixed(1) + '%' : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="strong" colSpan={3}>Total</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{data.totalEntries}</td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{fmtLKR(data.totalValue)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>100%</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

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
