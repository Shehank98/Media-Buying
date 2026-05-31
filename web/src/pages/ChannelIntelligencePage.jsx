import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Icon from '../components/Icon';
import api from '../lib/api';
import {
  ResponsiveContainer, ComposedChart, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';

const fmtLKR = v => v == null ? '—' : 'LKR ' + Math.round(Number(v)).toLocaleString('en-US');
const fmtShort = v => {
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K';
  return v;
};
const fmtMonth = ym => {
  if (!ym) return '—';
  const [y, m] = ym.split('-');
  return new Date(+y, +m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
};
const MediumBadge = ({ medium }) => {
  const c = { TV: ['#1e3a5f', '#dbeafe'], RADIO: ['#E85D24', '#fff5f0'], PRINT: ['#059669', '#ecfdf5'] };
  const [fg, bg] = c[medium] || ['#6b7280', '#f3f4f6'];
  return <span style={{ background: bg, color: fg, borderRadius: 5, padding: '2px 8px', fontSize: 12, fontWeight: 700 }}>{medium}</span>;
};
const Skeleton = ({ w = '100%', h = 20 }) => (
  <div style={{ width: w, height: h, background: 'var(--bg-sunken)', borderRadius: 6, animation: 'pulse 1.5s ease-in-out infinite' }} />
);

const TYPE_LABELS = { BOUGHT_AIRTIME: 'Bought Airtime', SPONSORSHIP: 'Sponsorship', BONUS_COMMERCIAL: 'Bonus Commercial', OTHER: 'Other' };

export default function ChannelIntelligencePage() {
  const { channelMasterId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const id = parseInt(channelMasterId);

  const [summary, setSummary] = useState(null);
  const [monthly, setMonthly] = useState([]);
  const [clients, setClients] = useState([]);
  const [propGroups, setPropGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');
  const [propSearch, setPropSearch] = useState('');
  const [propClientFilter, setPropClientFilter] = useState('');
  const [expandedProps, setExpandedProps] = useState({});

  const [clientSort, setClientSort] = useState({ field: 'totalInvoiceValue', dir: 'desc' });

  useEffect(() => {
    const load = async () => {
      try {
        const [sumRes, monthRes, clientRes, propRes] = await Promise.all([
          api.get(`/analytics/channel/${id}/summary`),
          api.get(`/analytics/channel/${id}/monthly-spend`),
          api.get(`/analytics/channel/${id}/clients`),
          api.get(`/analytics/channel/${id}/property-history`),
        ]);
        setSummary(sumRes.data);
        setMonthly(Array.isArray(monthRes.data) ? monthRes.data : []);
        setClients(Array.isArray(clientRes.data) ? clientRes.data : []);
        const raw = Array.isArray(propRes.data) ? propRes.data : [];
        setPropGroups(raw);
        const exp = {};
        raw.forEach(g => { exp[g.propertyName] = true; });
        setExpandedProps(exp);
      } catch {
        setError('Failed to load channel intelligence data.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  const sortedClients = useMemo(() => {
    return [...clients].sort((a, b) => {
      const v = clientSort.dir === 'asc' ? 1 : -1;
      return (a[clientSort.field] > b[clientSort.field] ? v : -v);
    });
  }, [clients, clientSort]);

  const filteredProps = useMemo(() => {
    return propGroups
      .filter(g => !propSearch || g.propertyName.toLowerCase().includes(propSearch.toLowerCase()))
      .map(g => ({
        ...g,
        entries: g.entries.filter(e => {
          if (propClientFilter && e.clientName !== propClientFilter) return false;
          if (yearFrom && e.year < parseInt(yearFrom)) return false;
          if (yearTo && e.year > parseInt(yearTo)) return false;
          return true;
        }),
      }))
      .filter(g => g.entries.length > 0);
  }, [propGroups, propSearch, propClientFilter, yearFrom, yearTo]);

  const allPropClients = useMemo(() => {
    const s = new Set();
    propGroups.forEach(g => g.entries.forEach(e => s.add(e.clientName)));
    return [...s].sort();
  }, [propGroups]);

  const toggleProp = name => setExpandedProps(p => ({ ...p, [name]: !p[name] }));
  const toggleClientSort = field => setClientSort(s => ({
    field,
    dir: s.field === field && s.dir === 'desc' ? 'asc' : 'desc',
  }));

  if (loading) return <div className="content-narrow fade-in" style={{ padding: '60px 0', textAlign: 'center', color: 'var(--muted)' }}>Loading…</div>;
  if (error) return <div className="content-narrow fade-in" style={{ padding: '60px 0', textAlign: 'center', color: 'var(--red-600)' }}>{error}</div>;

  const ch = summary?.channel || {};
  const chartData = monthly.map(m => ({
    ...m,
    label: fmtMonth(m.month),
    invoiceValue: Number(m.invoiceValue || 0),
    scheduleValue: Number(m.scheduleValue || 0),
  }));

  const statCards = [
    { label: 'YTD Spend', value: fmtLKR(summary?.ytdSpend), icon: 'dollar' },
    { label: 'Last Year', value: fmtLKR(summary?.lastYearSpend), icon: 'calendar' },
    { label: 'YoY Growth', value: summary?.yoyGrowthPct != null ? `${summary.yoyGrowthPct >= 0 ? '+' : ''}${summary.yoyGrowthPct.toFixed(1)}%` : '—', icon: summary?.yoyGrowthPct >= 0 ? 'trending-up' : 'trending-down', color: summary?.yoyGrowthPct >= 0 ? 'var(--green-600)' : 'var(--red-600)' },
    { label: 'Active Clients', value: summary?.activeClientsCount ?? 0, icon: 'users' },
  ];

  return (
    <div className="content-narrow fade-in">
      <button onClick={() => navigate(-1)} className="btn btn-ghost" style={{ marginBottom: 12, gap: 6 }}>
        <Icon name="chevL" size={16} /> Back
      </button>

      <div className="page-head">
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {ch.name} <MediumBadge medium={ch.medium} />
          </h1>
          <p className="page-sub">Channel Intelligence Report</p>
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 32 }}>
        {statCards.map(c => (
          <div key={c.label} className="stat">
            <div className="stat-top">
              <div className="stat-ico" style={{ background: c.color || 'var(--navy-900)', color: '#fff' }}>
                <Icon name={c.icon} size={16} />
              </div>
              <span className="stat-label">{c.label}</span>
            </div>
            <div className="stat-val" style={{ color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Monthly Spend Trend */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, marginBottom: 32 }}>
        <h3 style={{ margin: '0 0 16px', fontWeight: 700, color: 'var(--ink)' }}>Monthly Spend Trend</h3>
        {chartData.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--muted)' }}>
            <Icon name="bar-chart" size={36} style={{ opacity: 0.3, marginBottom: 8 }} />
            <div style={{ fontSize: 14 }}>No data for selected period</div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => fmtLKR(v)} labelFormatter={l => l} />
              <Bar dataKey="invoiceValue" name="Invoice Value" fill="#0A1729" radius={[4, 4, 0, 0]} />
              <Line dataKey="scheduleValue" name="Schedule Value" stroke="#E85D24" strokeWidth={2} dot={false} strokeDasharray="5 3" />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Client Breakdown */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, marginBottom: 32 }}>
        <h3 style={{ margin: '0 0 16px', fontWeight: 700, color: 'var(--ink)' }}>Clients on this Channel</h3>
        {sortedClients.length === 0 ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--muted)' }}>No client data available.</div>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr>
                {[
                  { key: 'clientName', label: 'Client' },
                  { key: 'agencyName', label: 'Agency' },
                  { key: 'totalScheduleValue', label: 'Schedule Value' },
                  { key: 'totalInvoiceValue', label: 'Invoice Value' },
                  { key: 'monthsActive', label: 'Months Active' },
                  { key: 'lastActive', label: 'Last Active' },
                ].map(col => (
                  <th key={col.key} style={{ cursor: 'pointer' }} onClick={() => toggleClientSort(col.key)}>
                    {col.label} {clientSort.field === col.key ? (clientSort.dir === 'asc' ? '↑' : '↓') : ''}
                  </th>
                ))}
              </tr></thead>
              <tbody>
                {sortedClients.map(c => (
                  <tr key={c.clientId} className="clickable" onClick={() => navigate(`/clients/${c.clientId}`)}>
                    <td className="strong">{c.clientName}</td>
                    <td style={{ color: 'var(--muted)' }}>{c.agencyName}</td>
                    <td className="mono">{fmtLKR(c.totalScheduleValue)}</td>
                    <td className="mono">{fmtLKR(c.totalInvoiceValue)}</td>
                    <td style={{ textAlign: 'center' }}>{c.monthsActive}</td>
                    <td style={{ color: 'var(--muted)' }}>{fmtMonth(c.lastActive)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Property History Timeline */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 24 }}>
        <h3 style={{ margin: '0 0 16px', fontWeight: 700, color: 'var(--ink)' }}>Property History Timeline</h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
          <div style={{ position: 'relative', flex: '1 1 180px', maxWidth: 260 }}>
            <Icon name="search" size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }} />
            <input className="input" placeholder="Search property…" value={propSearch} onChange={e => setPropSearch(e.target.value)} style={{ paddingLeft: 30, fontSize: 13 }} />
          </div>
          <select className="select" value={propClientFilter} onChange={e => setPropClientFilter(e.target.value)} style={{ flex: '0 0 180px', fontSize: 13 }}>
            <option value="">All clients</option>
            {allPropClients.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <input type="number" className="input" placeholder="From year" value={yearFrom} onChange={e => setYearFrom(e.target.value)} style={{ flex: '0 0 100px', fontSize: 13 }} />
          <input type="number" className="input" placeholder="To year" value={yearTo} onChange={e => setYearTo(e.target.value)} style={{ flex: '0 0 100px', fontSize: 13 }} />
        </div>

        {filteredProps.length === 0 ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--muted)' }}>No property history found.</div>
        ) : (
          filteredProps.map(group => (
            <div key={group.propertyName} style={{ marginBottom: 16, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
              <button
                onClick={() => toggleProp(group.propertyName)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', background: 'var(--bg-sunken)', border: 'none', cursor: 'pointer', fontWeight: 700, color: 'var(--ink)', fontSize: 14 }}
              >
                <span>{group.propertyName} — {ch.name}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--muted)', fontSize: 12 }}>
                  {group.entries.length} entries
                  <Icon name={expandedProps[group.propertyName] ? 'chevDown' : 'chevR'} size={14} />
                </span>
              </button>
              {expandedProps[group.propertyName] && (
                <div style={{ padding: '4px 0' }}>
                  {group.entries.map((e, i) => (
                    <div key={e.id || i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 18px', borderTop: i > 0 ? '1px solid var(--border)' : 'none', fontSize: 13 }}>
                      <span style={{ background: 'var(--navy-900)', color: '#fff', borderRadius: 6, padding: '3px 10px', fontWeight: 700, fontSize: 12, flex: 'none' }}>{e.year}</span>
                      <span style={{ color: 'var(--ink)', fontWeight: 600, minWidth: 100 }}>{e.clientName}</span>
                      <span style={{ background: 'var(--bg-sunken)', borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>{TYPE_LABELS[e.type] || e.type}</span>
                      <span className="mono" style={{ fontWeight: 700, color: 'var(--ink)' }}>{fmtLKR(e.cost)}</span>
                      {e.bonusPct != null && <span style={{ color: 'var(--coral-600)', fontSize: 12, fontWeight: 600 }}>{Number(e.bonusPct).toFixed(1)}% bonus</span>}
                      {e.changeFromPrev != null && (
                        <span style={{ color: e.changeDirection === 'up' ? 'var(--green-600)' : e.changeDirection === 'down' ? 'var(--red-600)' : 'var(--muted)', fontSize: 12, fontWeight: 700 }}>
                          {e.changeDirection === 'up' ? '↑' : e.changeDirection === 'down' ? '↓' : '='} {Math.abs(e.changeFromPrev).toFixed(1)}%
                        </span>
                      )}
                      {e.notes && <span style={{ color: 'var(--muted)', fontSize: 12, flex: 1, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }} title={e.notes}>{e.notes}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
