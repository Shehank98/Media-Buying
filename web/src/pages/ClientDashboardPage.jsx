import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import Icon from '../components/Icon';
import OrbitLoader from '../components/OrbitLoader';
import api from '../lib/api';

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
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(Math.round(n));
};
const fmtMonth = (ym) => {
  if (!ym) return '-';
  const [y, m] = String(ym).split('-');
  return new Date(+y, +m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
};

const CARD = { background: '#fff', border: '1px solid #E5E8ED', borderRadius: 14, boxShadow: '0 1px 2px rgba(15,31,61,.06)' };
const MEDIUM_COLORS = { TV: '#1F5BB5', RADIO: '#E85D24', PRINT: '#15814B', DIGITAL: '#6B3FB5', CINEMA: '#C2185B', OOH: '#0E7490' };
const COLORS = ['#1e3a5f', '#E85D24', '#059669', '#7c3aed', '#0ea5e9', '#d97706', '#dc2626', '#6366f1', '#14b8a6', '#f43f5e'];
const YEAR_COLORS = ['#E85D24', '#1F5BB5', '#15814B', '#6B3FB5', '#9A5B00', '#C5391F', '#0891b2', '#D9521C'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function Stat({ label, value, sub, tone, icon, accent }) {
  return (
    <div
      style={{ ...CARD, padding: '16px 18px', position: 'relative', overflow: 'hidden', transition: 'transform .16s ease, box-shadow .16s ease' }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 10px 26px rgba(15,31,61,.10)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = CARD.boxShadow; }}
    >
      <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${tone[1]}, ${tone[1]}1A 70%, transparent)` }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, display: 'grid', placeItems: 'center', background: `linear-gradient(135deg, ${tone[0]}, #ffffff)`, color: tone[1], boxShadow: `inset 0 0 0 1px ${tone[1]}22` }}><Icon name={icon} size={15} /></div>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: '#93A0B5' }}>{label}</span>
      </div>
      <div style={{ fontSize: 19, fontWeight: 750, letterSpacing: '-.3px', fontFamily: "'Spline Sans Mono', monospace", color: accent || '#16243C', lineHeight: 1.15, wordBreak: 'break-word' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#93A0B5', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

export default function ClientDashboardPage() {
  const { clientId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    api.get(`/analytics/client/${clientId}/overview`)
      .then(({ data }) => setData(data))
      .catch(() => setError('Failed to load client dashboard.'))
      .finally(() => setLoading(false));
    // Channels for the contacts / deals / rate-cards directory (independent load).
    api.get(`/clients/${clientId}/channels`)
      .then((r) => setChannels(Array.isArray(r.data) ? r.data : []))
      .catch(() => setChannels([]));
  }, [clientId]);

  // Download a rate card: client-specific if the channel has one, else the
  // channel's general rate card (channel master). Opens in a new tab / downloads.
  const openRateCard = async (ch, download) => {
    try {
      const useClient = ch.hasClientRateCard;
      const path = useClient
        ? `/channels/${ch.id}/rate-card`
        : `/analytics/channel/${ch.channelMasterId}/rate-card`;
      const res = await api.get(path, { params: download ? { download: 1 } : {}, responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      if (download) {
        const a = document.createElement('a');
        a.href = url;
        a.download = (useClient ? ch.rateCardFileName : ch.generalRateCardName) || 'rate-card';
        document.body.appendChild(a); a.click(); a.remove();
      } else {
        window.open(url, '_blank');
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      setError('Could not open the rate card.');
    }
  };

  if (loading) return <div className="content-narrow fade-in"><OrbitLoader fullHeight label="Loading client dashboard…" /></div>;
  if (error) return <div className="content-narrow fade-in" style={{ padding: '60px 0', textAlign: 'center', color: 'var(--red-600)' }}>{error}</div>;
  if (!data) return null;

  const c = data.client || {};

  // Pivot monthly spend into one series per year (X axis = Jan–Dec) so peak
  // months are comparable across years.
  const yearMap = {}; const yearsSet = new Set();
  (data.byMonth || []).forEach(m => {
    const mm = String(m.month).match(/^(\d{4})-(\d{2})$/);
    if (!mm) return;
    const y = mm[1], mi = parseInt(mm[2]) - 1;
    yearsSet.add(y);
    (yearMap[mi] ||= {})[y] = (yearMap[mi][y] || 0) + (m.value || 0);
  });
  const trendYears = [...yearsSet].sort();
  const yearTrend = MONTHS.map((name, i) => {
    const row = { month: name };
    trendYears.forEach(y => { row[y] = yearMap[i]?.[y] || 0; });
    return row;
  });

  const topChannels = (data.byChannel || []).slice(0, 12);
  const mediumData = (data.byMedium || []).filter(m => m.value > 0);
  const avgMonth = data.monthsActive ? data.totalValue / data.monthsActive : 0;

  return (
    <div className="content-narrow fade-in">
      <button onClick={() => navigate(-1)} className="btn btn-ghost" style={{ marginBottom: 12, gap: 6 }}>
        <Icon name="chevL" size={16} /> Back
      </button>

      <div className="page-head">
        <div>
          <h1 className="page-title">{c.name}</h1>
          <p className="page-sub">Client Dashboard{c.agencyName ? ` · ${c.agencyName}` : ''}</p>
        </div>
        <button className="btn btn-ghost" onClick={() => navigate(`/clients/${clientId}`)}>
          <Icon name="settings" size={15} /> Manage channels &amp; properties
        </button>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))', gap: 14, marginBottom: 28 }}>
        <Stat label="Total Spend" value={fmtLKR(data.totalValue)} sub={`${data.totalEntries} schedule entries`} tone={['#FDF1EB', '#D9521C']} icon="money" accent="#D9521C" />
        <Stat label="First Active" value={fmtMonth(data.firstMonth)} tone={['#EDF3FD', '#1F5BB5']} icon="calendar" />
        <Stat label="Last Active" value={fmtMonth(data.lastMonth)} sub={`${data.monthsActive} months active`} tone={['#EDF3FD', '#1F5BB5']} icon="clock" />
        <Stat label="Channels Used" value={data.channelCount ?? 0} tone={['#E8DEF8', '#6B3FB5']} icon="tv" />
        <Stat label="Brands" value={data.brandCount ?? 0} tone={['#FCF4E2', '#9A5B00']} icon="folder" />
        <Stat label="Avg / Month" value={fmtLKR(avgMonth)} tone={['#EEF0F3', '#3B4A63']} icon="activity" />
      </div>

      {/* Monthly spend trend — one line per year so peak months are comparable */}
      <div style={{ ...CARD, padding: 24, marginBottom: 24 }}>
        <h3 style={{ margin: '0 0 4px', fontWeight: 700, color: 'var(--ink)' }}>Monthly Spend Trend</h3>
        <p style={{ margin: '0 0 16px', fontSize: 12.5, color: 'var(--muted)' }}>Spend by calendar month, one line per year · compare peak months across years</p>
        {trendYears.length === 0 ? (
          <div style={{ height: 200, display: 'grid', placeItems: 'center', color: '#93A0B5', fontSize: 13 }}>No spend recorded</div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={yearTrend} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={{ stroke: 'var(--border)' }} />
              <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} width={48} />
              <Tooltip formatter={(v, n) => [fmtLKR(v), n]} contentStyle={{ borderRadius: 9, border: '1px solid var(--border)', fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {trendYears.map((y, i) => (
                <Line key={y} type="monotone" dataKey={y} name={y} stroke={YEAR_COLORS[i % YEAR_COLORS.length]} strokeWidth={2.4} dot={{ r: 2.5 }} activeDot={{ r: 5 }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Spend by channel + medium split */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 24, marginBottom: 24 }}>
        <div style={{ ...CARD, padding: 24 }}>
          <h3 style={{ margin: '0 0 16px', fontWeight: 700, color: 'var(--ink)' }}>Spend by Channel (Top 12)</h3>
          {topChannels.length === 0 ? (
            <div style={{ height: 200, display: 'grid', placeItems: 'center', color: '#93A0B5', fontSize: 13 }}>No channel data</div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(200, topChannels.length * 30 + 20)}>
              <BarChart data={topChannels} layout="vertical" margin={{ top: 4, right: 20, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F3" horizontal={false} />
                <XAxis type="number" tickFormatter={fmtShort} tick={{ fontSize: 11, fill: '#93A0B5' }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#16243C' }} tickLine={false} axisLine={false} width={120} />
                <Tooltip formatter={(v) => [fmtLKR(v), 'Spend']} contentStyle={{ borderRadius: 9, border: '1px solid #E5E8ED', fontSize: 12 }} />
                <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                  {topChannels.map((ch, i) => <Cell key={i} fill={MEDIUM_COLORS[ch.medium] || COLORS[i % COLORS.length]} cursor="pointer" />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div style={{ ...CARD, padding: 24 }}>
          <h3 style={{ margin: '0 0 16px', fontWeight: 700, color: 'var(--ink)' }}>Medium Split</h3>
          {mediumData.length === 0 ? (
            <div style={{ height: 200, display: 'grid', placeItems: 'center', color: '#93A0B5', fontSize: 13 }}>No data</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={210}>
                <PieChart>
                  <Pie data={mediumData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={84} paddingAngle={2}>
                    {mediumData.map((m, i) => <Cell key={i} fill={MEDIUM_COLORS[m.name] || COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v, n) => [fmtLKR(v), n]} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                {mediumData.map((m, i) => (
                  <div key={m.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: MEDIUM_COLORS[m.name] || COLORS[i] }} />
                    <span style={{ flex: 1, fontWeight: 600 }}>{m.name}</span>
                    <span className="mono">{fmtLKR(m.value)}</span>
                    <span style={{ color: 'var(--muted)', minWidth: 42, textAlign: 'right' }}>{data.totalValue > 0 ? ((m.value / data.totalValue) * 100).toFixed(1) + '%' : ''}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Channel + brand tables */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 24 }}>
        <div style={{ ...CARD, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 14 }}>All Channels ({data.byChannel?.length || 0})</div>
          <div style={{ maxHeight: 320, overflow: 'auto' }}>
            <table className="tbl" style={{ margin: 0 }}>
              <thead><tr><th>Channel</th><th>Medium</th><th style={{ textAlign: 'right' }}>Entries</th><th style={{ textAlign: 'right' }}>Spend</th></tr></thead>
              <tbody>
                {(data.byChannel || []).map(ch => (
                  <tr key={ch.name} className={ch.id ? 'clickable' : ''} onClick={() => ch.id && navigate(`/channel-masters/${ch.id}?clientId=${clientId}`)}>
                    <td className="strong">{ch.name}</td>
                    <td>{ch.medium ? <span className="medium-tag" data-medium={ch.medium}>{ch.medium}</span> : '-'}</td>
                    <td style={{ textAlign: 'right' }}>{ch.count}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{fmtLKR(ch.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ ...CARD, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 14 }}>Brands ({data.byBrand?.length || 0})</div>
          <div style={{ maxHeight: 320, overflow: 'auto' }}>
            <table className="tbl" style={{ margin: 0 }}>
              <thead><tr><th>Brand</th><th style={{ textAlign: 'right' }}>Entries</th><th style={{ textAlign: 'right' }}>Spend</th></tr></thead>
              <tbody>
                {(data.byBrand || []).map(b => (
                  <tr key={b.name}>
                    <td className="strong">{b.name}</td>
                    <td style={{ textAlign: 'right' }}>{b.count}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{fmtLKR(b.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Channel directory: rep contact (ME), latest deal, and rate card download */}
      {channels.length > 0 && (
        <div style={{ ...CARD, overflow: 'hidden', marginTop: 24 }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <span>Channel Directory ({channels.length})</span>
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)' }}>Rep contact · latest deal · rate card</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th>Channel</th>
                  <th>Medium</th>
                  <th>Contact (ME)</th>
                  <th>Latest deal</th>
                  <th style={{ textAlign: 'right' }}>Rate card</th>
                </tr>
              </thead>
              <tbody>
                {channels.map(ch => {
                  const medium = ch.channelMaster?.medium || ch.type;
                  const hasContact = ch.contactName || ch.contactEmail || ch.contactMobile;
                  const d = ch.latestDeal;
                  const cardKind = ch.hasClientRateCard ? 'Client' : ch.hasGeneralRateCard ? 'General' : null;
                  return (
                    <tr key={ch.id}>
                      <td className="strong">{ch.name}</td>
                      <td>{medium ? <span className="medium-tag" data-medium={medium}>{medium}</span> : '-'}</td>
                      <td style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                        {hasContact ? (
                          <div>
                            {ch.contactName && <div style={{ fontWeight: 700, color: 'var(--ink)' }}>{ch.contactName}</div>}
                            {ch.contactMobile && <div style={{ color: 'var(--muted)' }}><Icon name="phone" size={11} /> {ch.contactMobile}</div>}
                            {ch.contactEmail && <div style={{ color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220 }} title={ch.contactEmail}><Icon name="mail" size={11} /> {ch.contactEmail}</div>}
                          </div>
                        ) : <span style={{ color: 'var(--muted)' }}>-</span>}
                      </td>
                      <td style={{ fontSize: 12.5 }}>
                        {d ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span className="badge" style={{ fontSize: 10.5 }}>{d.year}</span>
                            <span className="mono" style={{ fontWeight: 700, color: 'var(--ink)' }}>{d.discountPct.toFixed(1)}% off</span>
                            <span className="mono" style={{ fontWeight: 700, color: '#15814B' }}>{d.bonusPct.toFixed(1)}% bonus</span>
                          </div>
                        ) : <span style={{ color: 'var(--muted)' }}>-</span>}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {cardKind ? (
                          <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end' }}>
                            <span className="badge" style={{ fontSize: 10, background: cardKind === 'Client' ? 'var(--coral-50,#FDEDE7)' : '#EEF0F3', color: cardKind === 'Client' ? 'var(--coral-700,#C44A18)' : '#6B7790' }}>{cardKind}</span>
                            <button className="btn btn-ghost btn-sm" onClick={() => openRateCard(ch, false)} title="View"><Icon name="file" size={13} /></button>
                            <button className="btn btn-ghost btn-sm" onClick={() => openRateCard(ch, true)} title="Download"><Icon name="download" size={13} /></button>
                          </div>
                        ) : <span style={{ color: 'var(--muted)' }}>-</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
