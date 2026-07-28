import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import Icon from '../components/Icon';
import OrbitLoader from '../components/OrbitLoader';
import {
  rollUpDirectPlacements, toStackedChannelData, ChannelBarTooltip,
  DirectPlacementLegend, DP_COLORS,
} from '../components/DirectPlacements';
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
const MEDIUM_ORDER = ['TV', 'RADIO', 'PRINT', 'DIGITAL', 'CINEMA', 'OOH'];
const COLORS = ['#1e3a5f', '#E85D24', '#059669', '#7c3aed', '#0ea5e9', '#d97706', '#dc2626', '#6366f1', '#14b8a6', '#f43f5e'];
const YEAR_COLORS = ['#E85D24', '#1F5BB5', '#15814B', '#6B3FB5', '#9A5B00', '#C5391F', '#0891b2', '#D9521C'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TOP_CHANNELS = 20; // rows shown in the Spend by Channel chart

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

// Parent-company dashboard: the group's clients aggregated, with a client filter
// (All clients in the group, or one member). Mirrors the Client Dashboard.
export default function GroupDashboardPage() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [clientFilter, setClientFilter] = useState(''); // '' = all clients in group
  const [year, setYear] = useState(''); // '' until the first load resolves the current year
  const [chMedium, setChMedium] = useState(''); // Spend-by-Channel medium filter ('' = all)
  const [channelSearch, setChannelSearch] = useState('');
  const [dirMedium, setDirMedium] = useState(''); // active medium tab in the Channel Directory
  const [showBrandTrend, setShowBrandTrend] = useState(false);
  const [exporting, setExporting] = useState(false);

  const trendRef = useRef(null);
  const channelRef = useRef(null);
  const mediumRef = useRef(null);
  const companyRef = useRef(null);
  const brandRef = useRef(null);

  const exportJpg = async (el, name) => {
    if (!el) return;
    const html2canvas = (await import('html2canvas')).default;
    const canvas = await html2canvas(el, { backgroundColor: '#ffffff', scale: 2, useCORS: true, logging: false });
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/jpeg', 0.95);
    a.download = `${name}.jpg`.replace(/[^a-z0-9.\-]+/gi, '_');
    document.body.appendChild(a); a.click(); a.remove();
  };
  const exportAllCharts = async () => {
    setExporting(true);
    try {
      const gn = data?.group?.name || 'group';
      await exportJpg(trendRef.current, `${gn}-monthly-trend`);
      await exportJpg(channelRef.current, `${gn}-spend-by-channel`);
      if (!clientFilter) await exportJpg(companyRef.current, `${gn}-company-split`);
      await exportJpg(mediumRef.current, `${gn}-medium-split`);
      if (showBrandTrend) await exportJpg(brandRef.current, `${gn}-brand-trend`);
    } catch { setError('Could not export charts.'); } finally { setExporting(false); }
  };
  const jpgButton = (ref, name) => (
    <button onClick={() => exportJpg(ref.current, name)} className="btn btn-ghost btn-sm" title="Download this chart as JPG" style={{ flex: 'none' }}>
      <Icon name="download" size={13} /> JPG
    </button>
  );

  useEffect(() => {
    setLoading(true);
    const params = {};
    if (clientFilter) params.clientId = clientFilter;
    if (/^\d{4}$/.test(year)) params.year = year;
    api.get(`/analytics/client-group/${groupId}/overview`, { params })
      .then(({ data }) => { setData(data); if (!year && data?.yearBlock?.year) setYear(String(data.yearBlock.year)); })
      .catch(() => setError('Failed to load group dashboard.'))
      .finally(() => setLoading(false));
  }, [groupId, clientFilter, year]);

  // Download a rate card: client-specific if the channel has one, else the
  // channel's general (channel-master) card.
  const openRateCard = async (ch, download) => {
    try {
      const useClient = ch.hasClientRateCard;
      const path = useClient ? `/channels/${ch.id}/rate-card` : `/analytics/channel/${ch.channelMasterId}/rate-card`;
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

  if (loading) return <div className="content-narrow fade-in"><OrbitLoader fullHeight label="Loading group dashboard…" /></div>;
  if (error) return <div className="content-narrow fade-in" style={{ padding: '60px 0', textAlign: 'center', color: 'var(--red-600)' }}>{error}</div>;
  if (!data) return null;

  const g = data.group || {};
  const members = data.clients || [];

  // Pivot monthly spend into one series per year (X axis = Jan–Dec).
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

  const channelMediums = MEDIUM_ORDER.filter(md => (data.byChannel || []).some(ch => ch.medium === md));
  // Direct-placement digital channels collapse into one combined bar in this
  // chart only; the All Channels table below still lists them individually.
  const channelRows = rollUpDirectPlacements(data.byChannel || []);
  const channelsMatching = channelRows.filter(ch => !chMedium || ch.medium === chMedium);
  const topChannels = channelsMatching.slice(0, TOP_CHANNELS);
  const { data: channelChartData, members: dpMembers, memberKeys: dpKeys } = toStackedChannelData(topChannels);
  const mediumData = (data.byMedium || []).filter(m => m.value > 0);
  const companyData = (data.byClient || []).filter(c => c.value > 0);
  const brandTrend = data.brandTrend || [];
  const brandTrendKeys = data.brandTrendKeys || [];
  const filterName = clientFilter ? (members.find(m => String(m.id) === String(clientFilter))?.name || 'Client') : 'All companies';

  // Period-aligned YoY (same window this year vs last year).
  const yoy = data.yoy || null;
  const yoyUp = yoy && yoy.yoyPct != null && yoy.yoyPct >= 0;
  const yoySub = yoy?.throughMonth
    ? (() => {
        const mLabel = MONTHS[parseInt(yoy.throughMonth.slice(5, 7), 10) - 1];
        return `Jan–${mLabel} ${yoy.throughMonth.slice(0, 4)} vs Jan–${mLabel} ${yoy.previousYear}`;
      })()
    : 'vs last year, same period';

  // Channel directory: one card per client channel in the group (or in the
  // filtered company), grouped by medium and searchable.
  const channels = data.channels || [];
  const channelCard = (ch) => {
    const medium = ch.channelMaster?.medium || ch.type;
    const mc = MEDIUM_COLORS[medium] || '#1e3a5f';
    const hasContact = ch.contactName || ch.contactEmail || ch.contactMobile;
    const d = ch.latestDeal;
    const cardKind = ch.hasClientRateCard ? 'Client' : ch.hasGeneralRateCard ? 'General' : null;
    return (
      <div key={ch.id} style={{ position: 'relative', overflow: 'hidden', background: '#fff', border: '1px solid #E5E8ED', borderRadius: 10, boxShadow: '0 1px 2px rgba(15,31,61,.05)', padding: '10px 11px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${mc}, ${mc}22 75%, transparent)` }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: `${mc}18`, color: mc, display: 'grid', placeItems: 'center', flex: 'none' }}>
            <Icon name={(medium || 'tv').toLowerCase()} size={14} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#16243C', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={ch.name}>{ch.name}</div>
            {/* Which company in the group this channel belongs to */}
            {ch.clientName && <div style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={ch.clientName}>{ch.clientName}</div>}
          </div>
          {medium && <span className="medium-tag" data-medium={medium} style={{ flex: 'none' }}>{medium}</span>}
        </div>

        {hasContact ? (
          <div style={{ fontSize: 11.5, lineHeight: 1.5 }}>
            {ch.contactName && <div style={{ fontWeight: 700, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={ch.contactName}>{ch.contactName}</div>}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', color: 'var(--muted)' }}>
              {ch.contactMobile && <span title={ch.contactMobile}><Icon name="phone" size={10} /> {ch.contactMobile}</span>}
              {ch.contactEmail && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200, whiteSpace: 'nowrap' }} title={ch.contactEmail}><Icon name="mail" size={10} /> {ch.contactEmail}</span>}
            </div>
          </div>
        ) : <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>No contact recorded</div>}

        <div style={{ marginTop: 'auto', paddingTop: 8, borderTop: '1px solid #EEF0F3', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          {d ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#93A0B5' }}>{d.year}</span>
              <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 3, padding: '2px 7px', borderRadius: 6, background: '#F2F5FA' }}>
                <b className="mono" style={{ fontSize: 12.5, color: 'var(--ink)' }}>{d.discountPct.toFixed(1)}%</b>
                <span style={{ fontSize: 10, color: 'var(--muted)' }}>off</span>
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 3, padding: '2px 7px', borderRadius: 6, background: '#EAF7EF' }}>
                <b className="mono" style={{ fontSize: 12.5, color: '#15814B' }}>{d.bonusPct.toFixed(1)}%</b>
                <span style={{ fontSize: 10, color: '#15814B' }}>bonus</span>
              </span>
            </div>
          ) : <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>No deal</span>}
          {cardKind ? (
            <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
              <span title={`${cardKind} rate card`} style={{ display: 'inline-flex', alignItems: 'center', color: cardKind === 'Client' ? 'var(--coral-700,#C44A18)' : '#93A0B5' }}><Icon name="file" size={12} /></span>
              <button className="btn btn-ghost btn-sm" onClick={() => openRateCard(ch, false)} title="View rate card"><Icon name="eye" size={13} /></button>
              <button className="btn btn-ghost btn-sm" onClick={() => openRateCard(ch, true)} title="Download rate card"><Icon name="download" size={13} /></button>
            </div>
          ) : (
            <span style={{ fontSize: 11, color: '#93A0B5', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="file" size={11} /> No card</span>
          )}
        </div>
      </div>
    );
  };

  const dirQuery = channelSearch.trim().toLowerCase();
  const dirFiltered = channels.filter(ch =>
    !dirQuery ||
    (ch.name || '').toLowerCase().includes(dirQuery) ||
    (ch.contactName || '').toLowerCase().includes(dirQuery) ||
    (ch.clientName || '').toLowerCase().includes(dirQuery),
  );
  const dirGroups = (() => {
    const map = new Map();
    dirFiltered.forEach(ch => {
      const m = (ch.channelMaster?.medium || ch.type || 'Other').toUpperCase();
      if (!map.has(m)) map.set(m, []);
      map.get(m).push(ch);
    });
    return [...map.entries()].sort((a, b) => {
      const ia = MEDIUM_ORDER.indexOf(a[0]); const ib = MEDIUM_ORDER.indexOf(b[0]);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a[0].localeCompare(b[0]);
    }).map(([medium, list]) => ({ medium, list: list.sort((x, y) => (x.name || '').localeCompare(y.name || '')) }));
  })();

  return (
    <div className="content-narrow fade-in">
      <button onClick={() => navigate(-1)} className="btn btn-ghost" style={{ marginBottom: 12, gap: 6 }}>
        <Icon name="chevL" size={16} /> Back
      </button>

      <div className="page-head">
        <div>
          <h1 className="page-title">{g.name}</h1>
          <p className="page-sub">Group Dashboard{g.agencyName ? ` · ${g.agencyName}` : ''} · {members.length} compan{members.length === 1 ? 'y' : 'ies'}</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="field" style={{ margin: 0 }}>
            <label style={{ fontSize: 11 }}>Year</label>
            <select className="select" value={year} onChange={e => setYear(e.target.value)}>
              <option value="all">All time</option>
              {(data.availableYears || []).map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0, minWidth: 200 }}>
            <label style={{ fontSize: 11 }}>Filter by company</label>
            <select className="select" value={clientFilter} onChange={e => setClientFilter(e.target.value)}>
              <option value="">All companies in group</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <button className="btn btn-ghost" onClick={exportAllCharts} disabled={exporting} title="Download every chart on this page as JPG images" style={{ height: 38 }}>
            <Icon name="download" size={15} /> {exporting ? 'Exporting…' : 'Charts (JPG)'}
          </button>
          {clientFilter && (
            <button className="btn btn-ghost" onClick={() => navigate(`/clients/${clientFilter}/dashboard`)} title="Open this company's own dashboard" style={{ height: 38 }}>
              <Icon name="settings" size={15} /> Open company dashboard
            </button>
          )}
        </div>
      </div>

      {clientFilter && (
        <div style={{ marginBottom: 16, fontSize: 12.5, color: 'var(--muted)' }}>
          Showing <b style={{ color: 'var(--ink)' }}>{filterName}</b> only.{' '}
          <button onClick={() => setClientFilter('')} style={{ background: 'none', border: 'none', color: 'var(--coral-700,#C44A18)', fontWeight: 600, cursor: 'pointer', padding: 0 }}>Show whole group</button>
        </div>
      )}

      {/* Stat cards (year-scoped, or all-time when Year = All) */}
      {(() => {
        const allTime = year === 'all';
        const yb = data.yearBlock || {};
        const spend = allTime ? data.totalValue : (yb.spend || 0);
        const entries = allTime ? data.totalEntries : (yb.entries || 0);
        const avg = allTime ? (data.monthsActive ? data.totalValue / data.monthsActive : 0) : (yb.avgMonth || 0);
        const spendLabel = allTime ? 'Total Spend' : `Spend ${yb.year || ''}`;
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))', gap: 14, marginBottom: 20 }}>
            <Stat label={spendLabel} value={fmtLKR(spend)} sub={`${entries} schedule entries`} tone={['#FDF1EB', '#D9521C']} icon="money" accent="#D9521C" />
            {!allTime && (
              <Stat label={`Group Target ${yb.year || ''}`} value={yb.target != null ? fmtLKR(yb.target) : 'Not set'} sub={yb.target != null && yb.pct != null ? `${yb.pct}% achieved` : 'Set in Admin → Group Targets'} tone={['#EDF3FD', '#1F5BB5']} icon="trending-up" accent="#1F5BB5" />
            )}
            <Stat label={allTime ? 'Avg / Month (all-time)' : 'Avg / Month'} value={fmtLKR(avg)} tone={['#EEF0F3', '#3B4A63']} icon="activity" />
            {yoy && yoy.yoyPct != null && (
              <Stat
                label="YoY Growth"
                value={`${yoyUp ? '+' : ''}${yoy.yoyPct}%`}
                sub={yoySub}
                tone={yoyUp ? ['#ECF8F1', '#15814B'] : ['#FBE0DA', '#C5391F']}
                icon={yoyUp ? 'trending-up' : 'trending-down'}
                accent={yoyUp ? '#15814B' : '#C5391F'}
              />
            )}
          </div>
        );
      })()}

      {/* Group target progress for the selected year (not shown for All time) */}
      {year !== 'all' && data.yearBlock && data.yearBlock.target != null && (
        <div style={{ ...CARD, padding: 20, marginBottom: 28 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
            <div>
              <h3 style={{ margin: 0, fontWeight: 700, color: 'var(--ink)' }}>{data.yearBlock.year} Target Progress</h3>
              <p style={{ margin: '3px 0 0', fontSize: 12.5, color: 'var(--muted)' }}>
                Achieved from actual schedule spend
                {data.yearBlock.scopedToClient ? ` · ${filterName} only, against the whole group's target` : ''}
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="mono" style={{ fontSize: 20, fontWeight: 750, color: (data.yearBlock.pct || 0) >= 100 ? '#15814B' : '#16243C' }}>{data.yearBlock.pct == null ? '-' : `${data.yearBlock.pct}%`}</div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                {fmtLKR(data.yearBlock.achieved)} of {fmtLKR(data.yearBlock.target)}
              </div>
            </div>
          </div>
          <div style={{ background: '#EEF0F3', borderRadius: 6, height: 12, overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(100, data.yearBlock.pct || 0)}%`, height: '100%', background: (data.yearBlock.pct || 0) >= 100 ? '#15814B' : '#1F5BB5', borderRadius: 6 }} />
          </div>
          <div style={{ marginTop: 10, fontSize: 13, fontWeight: 600, color: data.yearBlock.remaining > 0 ? '#C5391F' : '#15814B' }}>
            {data.yearBlock.remaining > 0
              ? <>Still needed: <span className="mono">{fmtLKR(data.yearBlock.remaining)}</span></>
              : <>Target reached - over by <span className="mono">{fmtLKR(Math.abs(data.yearBlock.remaining))}</span></>}
          </div>
        </div>
      )}

      {/* Monthly spend trend - one line per year */}
      <div ref={trendRef} style={{ ...CARD, padding: 24, marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
          <div>
            <h3 style={{ margin: '0 0 4px', fontWeight: 700, color: 'var(--ink)' }}>Monthly Spend Trend</h3>
            <p style={{ margin: '0 0 16px', fontSize: 12.5, color: 'var(--muted)' }}>Spend by calendar month, one line per year</p>
          </div>
          {jpgButton(trendRef, `${g.name}-monthly-trend`)}
        </div>
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
        <div ref={channelRef} style={{ ...CARD, padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontWeight: 700, color: 'var(--ink)' }}>Spend by Channel {chMedium ? `· ${chMedium}` : ''} (Top {TOP_CHANNELS})</h3>
            {jpgButton(channelRef, `${g.name}-spend-by-channel${chMedium ? '-' + chMedium : ''}`)}
          </div>
          {channelMediums.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
              {[['', 'All'], ...channelMediums.map(m => [m, m])].map(([k, label]) => {
                const active = chMedium === k;
                const mc = k ? (MEDIUM_COLORS[k] || '#1e3a5f') : '#16243C';
                return (
                  <button key={k || 'all'} onClick={() => setChMedium(k)}
                    style={{ border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 20, fontFamily: 'inherit', background: active ? mc : '#EEF0F3', color: active ? '#fff' : '#6B7790' }}>
                    {label}
                  </button>
                );
              })}
            </div>
          )}
          {topChannels.length === 0 ? (
            <div style={{ height: 200, display: 'grid', placeItems: 'center', color: '#93A0B5', fontSize: 13 }}>No channel data{chMedium ? ` for ${chMedium}` : ''}</div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(200, topChannels.length * 30 + 20)}>
              <BarChart data={channelChartData} layout="vertical" margin={{ top: 4, right: 20, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F3" horizontal={false} />
                <XAxis type="number" tickFormatter={fmtShort} tick={{ fontSize: 11, fill: '#93A0B5' }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#16243C' }} tickLine={false} axisLine={false} width={120} />
                <Tooltip cursor={{ fill: '#F5F6F8' }} content={<ChannelBarTooltip fmt={fmtLKR} />} />
                {/* Real channels. The combined Direct Placements row holds 0 here
                    and draws its per-channel segments from the dp* series below. */}
                <Bar dataKey="value" stackId="a" radius={[0, 6, 6, 0]}>
                  {channelChartData.map((ch, i) => <Cell key={i} fill={MEDIUM_COLORS[ch.medium] || COLORS[i % COLORS.length]} />)}
                </Bar>
                {dpKeys.map((k, i) => (
                  <Bar key={k} dataKey={k} stackId="a" fill={DP_COLORS[i % DP_COLORS.length]}
                    radius={i === dpKeys.length - 1 ? [0, 6, 6, 0] : 0} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
          <DirectPlacementLegend members={dpMembers} style={{ marginTop: 10 }} />
          {channelsMatching.length > TOP_CHANNELS && (
            <div style={{ fontSize: 11.5, color: '#93A0B5', marginTop: 8 }}>
              Showing the top {TOP_CHANNELS} of {channelsMatching.length} channels{chMedium ? ` in ${chMedium}` : ''} · the full list is in the All Channels table below
            </div>
          )}
        </div>

        {/* Company Split sits ON TOP, Medium Split under it — the two cards are
            ordered with flex `order` rather than by JSX position, so the Company
            Split block below keeps its comment and refs where they were. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div ref={mediumRef} style={{ ...CARD, padding: 24, order: 2 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontWeight: 700, color: 'var(--ink)' }}>Medium Split</h3>
            {jpgButton(mediumRef, `${g.name}-medium-split`)}
          </div>
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

        {/* Company Split - the same donut, but by member company instead of
            medium. Hidden when a single company is selected, where it would be
            one 100% slice. */}
        <div ref={companyRef} style={{ ...CARD, padding: 24, order: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 16 }}>
            <div>
              <h3 style={{ margin: 0, fontWeight: 700, color: 'var(--ink)' }}>Company Split</h3>
              <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--muted)' }}>Share of group spend by company</p>
            </div>
            {!clientFilter && companyData.length > 0 && jpgButton(companyRef, `${g.name}-company-split`)}
          </div>
          {clientFilter ? (
            <div style={{ height: 160, display: 'grid', placeItems: 'center', textAlign: 'center', color: '#93A0B5', fontSize: 12.5, padding: '0 12px' }}>
              <span>Showing {filterName} only.<br />
                <button onClick={() => setClientFilter('')} style={{ background: 'none', border: 'none', color: 'var(--coral-700,#C44A18)', fontWeight: 600, cursor: 'pointer', padding: 0, fontSize: 12.5 }}>Show the whole group</button>{' '}to compare companies.
              </span>
            </div>
          ) : companyData.length === 0 ? (
            <div style={{ height: 200, display: 'grid', placeItems: 'center', color: '#93A0B5', fontSize: 13 }}>No data</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={210}>
                <PieChart>
                  <Pie data={companyData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={84} paddingAngle={2}>
                    {companyData.map((c, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v, n) => [fmtLKR(v), n]} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                {companyData.map((c, i) => (
                  <div
                    key={c.name}
                    onClick={() => c.id && setClientFilter(String(c.id))}
                    title={c.id ? `Filter the dashboard to ${c.name}` : undefined}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: c.id ? 'pointer' : 'default' }}
                  >
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: COLORS[i % COLORS.length] }} />
                    <span style={{ flex: 1, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                    <span className="mono">{fmtLKR(c.value)}</span>
                    <span style={{ color: 'var(--muted)', minWidth: 42, textAlign: 'right' }}>{data.totalValue > 0 ? ((c.value / data.totalValue) * 100).toFixed(1) + '%' : ''}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        </div>
      </div>

      {/* Brand Performance Over Time - hidden by default, expandable. */}
      <div ref={brandRef} style={{ ...CARD, padding: 20, marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={() => setShowBrandTrend(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}>
            <Icon name={showBrandTrend ? 'chevDown' : 'chevR'} size={16} style={{ color: '#93A0B5' }} />
            <span>
              <span style={{ display: 'block', fontWeight: 700, color: 'var(--ink)', fontSize: 15 }}>Brand Performance Over Time</span>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>How the top brands trend month to month{year !== 'all' ? ` in ${year}` : ''}{clientFilter ? ` · ${filterName}` : ''} · click to {showBrandTrend ? 'hide' : 'expand'}</span>
            </span>
          </button>
          {showBrandTrend && brandTrendKeys.length > 0 && jpgButton(brandRef, `${g.name}-brand-trend`)}
        </div>
        {showBrandTrend && (
          brandTrendKeys.length === 0 || brandTrend.length === 0 ? (
            <div style={{ height: 160, display: 'grid', placeItems: 'center', color: '#93A0B5', fontSize: 13 }}>No brand spend to chart{year !== 'all' ? ` for ${year}` : ''}.</div>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={brandTrend} margin={{ top: 18, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="month" tickFormatter={fmtMonth} tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={{ stroke: 'var(--border)' }} />
                <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} width={48} />
                <Tooltip formatter={(v, n) => [fmtLKR(v), n]} labelFormatter={fmtMonth} contentStyle={{ borderRadius: 9, border: '1px solid var(--border)', fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {brandTrendKeys.map((b, i) => (
                  <Line key={b} type="monotone" dataKey={b} name={b} stroke={COLORS[i % COLORS.length]} strokeWidth={2.2} dot={{ r: 2 }} activeDot={{ r: 5 }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )
        )}
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
                  <tr key={ch.name} className={ch.id ? 'clickable' : ''} onClick={() => ch.id && navigate(`/channel-masters/${ch.id}${clientFilter ? `?clientId=${clientFilter}` : ''}`)}>
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

      {/* Channel directory: grouped by medium, searchable by channel / contact / company */}
      {channels.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            <div>
              <h3 style={{ margin: 0, fontWeight: 700, fontSize: 16, color: 'var(--ink)' }}>Channel Directory</h3>
              <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>Rep contact · latest deal · rate card. Pick a medium tab - {channels.length} channels{clientFilter ? ` · ${filterName}` : ' across the group'}</div>
            </div>
            <div style={{ position: 'relative', minWidth: 220 }}>
              <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#93A0B5', pointerEvents: 'none', display: 'flex' }}><Icon name="search" size={15} /></span>
              <input
                className="input"
                value={channelSearch}
                onChange={e => setChannelSearch(e.target.value)}
                placeholder="Search channel, contact or company…"
                style={{ paddingLeft: 32, width: '100%' }}
              />
              {channelSearch && (
                <button onClick={() => setChannelSearch('')} title="Clear" style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#93A0B5', display: 'flex', padding: 4 }}><Icon name="x" size={14} /></button>
              )}
            </div>
          </div>
          {dirGroups.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)', fontSize: 13.5 }}>
              {channelSearch ? `No channels match "${channelSearch}".` : 'No channels.'}
            </div>
          ) : (() => {
            // Medium tabs; the effective tab falls back to the first group when the
            // current one is filtered out by the search.
            const activeGroup = dirGroups.find(g => g.medium === dirMedium) || dirGroups[0];
            return (
              <>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14, borderBottom: '1px solid #EEF0F3', paddingBottom: 2 }}>
                  {dirGroups.map(({ medium, list }) => {
                    const active = medium === activeGroup.medium;
                    const mc = MEDIUM_COLORS[medium] || '#1e3a5f';
                    return (
                      <button key={medium} onClick={() => setDirMedium(medium)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: active ? mc : '#6B7790', borderBottom: `2px solid ${active ? mc : 'transparent'}`, marginBottom: -2 }}>
                        <Icon name={(medium || 'tv').toLowerCase()} size={14} />
                        {medium}
                        <span style={{ fontSize: 11, fontWeight: 700, color: active ? mc : '#93A0B5', background: active ? `${mc}18` : '#EEF1F6', borderRadius: 20, padding: '1px 7px' }}>{list.length}</span>
                      </button>
                    );
                  })}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 12 }}>
                  {activeGroup.list.map(channelCard)}
                </div>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
