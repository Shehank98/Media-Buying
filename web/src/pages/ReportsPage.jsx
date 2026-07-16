import { useState, useEffect, useMemo, useCallback } from 'react';
import Icon from '../components/Icon';
import api from '../lib/api';
import OrbitLoader from '../components/OrbitLoader';

const GROUP_OPTIONS = [
  { key: 'channel', label: 'By Channel', icon: 'tv' },
  { key: 'client', label: 'By Client', icon: 'folder' },
  { key: 'agency', label: 'By Agency', icon: 'building' },
  { key: 'all', label: 'All Data', icon: 'database' },
];
// Two-level nesting, properties only (e.g. Agency → its Channels).
const PROP_GROUP_EXTRA = [
  { key: 'agency-channel', label: 'By Agency → Channel', icon: 'building' },
  { key: 'client-channel', label: 'By Client → Channel', icon: 'folder' },
];

const MEDIUM_OPTIONS = [
  { value: 'TV', label: 'TV' },
  { value: 'RADIO', label: 'Radio' },
  { value: 'PRINT', label: 'Print' },
  { value: 'DIGITAL', label: 'Digital' },
  { value: 'CINEMA', label: 'Cinema' },
  { value: 'OOH', label: 'OOH' },
];

const PROPERTY_TYPE_OPTIONS = [
  { value: 'BOUGHT_AIRTIME', label: 'Bought Airtime' },
  { value: 'SPONSORSHIP', label: 'Sponsorship' },
  { value: 'BONUS_COMMERCIAL', label: 'Bonus Commercial' },
  { value: 'OTHER', label: 'Other' },
];

const CHANNEL_TYPE_OPTIONS = [
  { value: 'TV', label: 'TV' },
  { value: 'RADIO', label: 'Radio' },
  { value: 'PRINT', label: 'Print' },
  { value: 'DIGITAL', label: 'Digital' },
  { value: 'CINEMA', label: 'Cinema' },
  { value: 'OOH', label: 'OOH' },
];

function fmtLKR(v) {
  if (v == null || v === '') return '-';
  const n = Number(v) || 0; const a = Math.abs(n);
  if (a >= 1e9) return 'LKR ' + (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return 'LKR ' + (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return 'LKR ' + (n / 1e3).toFixed(1) + 'K';
  return 'LKR ' + Math.round(n).toLocaleString('en-US');
}

export default function ReportsPage() {
  const [agencies, setAgencies] = useState([]);
  const [clients, setClients] = useState([]);
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});

  const [loading, setLoading] = useState(false);
  const [agenciesLoading, setAgenciesLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [exporting, setExporting] = useState(false);

  // Report source: 'properties' or 'scheduleLogs'
  const [source, setSource] = useState('properties');

  // Shared filters
  const [groupBy, setGroupBy] = useState('agency');
  const [agencyId, setAgencyId] = useState('');
  const [clientId, setClientId] = useState('');

  // Schedule log filters
  const [medium, setMedium] = useState('');
  const [monthFrom, setMonthFrom] = useState('');
  const [monthTo, setMonthTo] = useState('');

  // Property filters
  const [channelType, setChannelType] = useState('');
  const [propertyType, setPropertyType] = useState('');
  const [channelName, setChannelName] = useState('');   // canonical channel (across agencies)
  const [channels, setChannels] = useState([]);          // distinct channel names from results
  const [includeHistory, setIncludeHistory] = useState(true);

  // Sort
  const [sortField, setSortField] = useState('agencyName');
  const [sortDir, setSortDir] = useState('asc');

  // Collapsed group names (only relevant when grouped)
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/agencies');
        const raw = data.agencies || data;
        setAgencies(Array.isArray(raw) ? raw : []);
      } catch {
        setError('Failed to load agencies.');
      } finally {
        setAgenciesLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!agencyId) {
      setClients([]);
      setClientId('');
      return;
    }
    (async () => {
      try {
        const { data } = await api.get(`/agencies/${agencyId}/clients`);
        const raw = data.clients || data;
        setClients(Array.isArray(raw) ? raw : []);
      } catch {
        setClients([]);
      }
    })();
  }, [agencyId]);

  const buildParams = useCallback((format, groupByArg) => {
    const params = new URLSearchParams();
    params.set('groupBy', groupByArg || groupBy);
    if (agencyId) params.set('agencyId', agencyId);
    if (clientId) params.set('clientId', clientId);
    if (format) params.set('format', format);

    if (source === 'scheduleLogs') {
      if (medium) params.set('medium', medium);
      if (monthFrom) params.set('monthFrom', monthFrom);
      if (monthTo) params.set('monthTo', monthTo);
    } else {
      if (channelType) params.set('channelType', channelType);
      if (propertyType) params.set('propertyType', propertyType);
      if (channelName) params.set('channelName', channelName);
      if (!includeHistory) params.set('includeHistory', 'false');
    }
    return params.toString();
  }, [groupBy, agencyId, clientId, medium, monthFrom, monthTo, channelType, propertyType, channelName, includeHistory, source]);

  const endpoint = source === 'properties' ? '/reports/properties' : '/reports/schedule-logs';
  const groupOptions = source === 'properties' ? [...GROUP_OPTIONS, ...PROP_GROUP_EXTRA] : GROUP_OPTIONS;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const qs = buildParams('json');
        const { data } = await api.get(`${endpoint}?${qs}`);
        if (cancelled) return;
        setRows(Array.isArray(data.rows) ? data.rows : []);
        setSummary(data.summary || {});
        if (Array.isArray(data.channels)) setChannels(data.channels);
      } catch {
        if (!cancelled) {
          setError('Failed to load report data.');
          setRows([]);
          setSummary({});
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [buildParams, endpoint]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const sortIcon = (field) => {
    if (sortField !== field) return '';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  const sorted = useMemo(() => {
    const numericFields = ['cost', 'scheduleValue', 'scheduleValueWithVat', 'bonusValue'];
    return [...rows].sort((a, b) => {
      let aVal = a[sortField];
      let bVal = b[sortField];
      if (numericFields.includes(sortField)) {
        aVal = Number(aVal) || 0;
        bVal = Number(bVal) || 0;
      } else {
        aVal = String(aVal || '').toLowerCase();
        bVal = String(bVal || '').toLowerCase();
      }
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [rows, sortField, sortDir]);

  // Group rows on screen to mirror the grouped Excel export (one block per
  // agency / client / channel, each with its own subtotal). 'all' = flat list.
  const grouped = useMemo(() => {
    if (groupBy === 'all') return null;
    const primary = groupBy.includes('-') ? groupBy.split('-')[0] : groupBy;
    const keyField = primary === 'agency' ? 'agencyName' : primary === 'client' ? 'clientName' : 'channelName';
    const map = new Map();
    for (const r of sorted) {
      const k = r[keyField] || '-';
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    }
    const groups = Array.from(map.entries()).map(([name, gRows]) => ({
      name,
      rows: gRows,
      entries: gRows.length,
      cost: gRows.reduce((s, r) => s + (Number(r.cost) || 0), 0),
      value: gRows.reduce((s, r) => s + (Number(r.scheduleValue) || 0), 0),
      vat: gRows.reduce((s, r) => s + (Number(r.scheduleValueWithVat) || 0), 0),
    }));
    groups.sort((a, b) => (source === 'properties' ? b.cost - a.cost : b.value - a.value) || a.name.localeCompare(b.name));
    return groups;
  }, [sorted, groupBy, source]);

  const toggleGroup = (name) => setCollapsedGroups((prev) => {
    const next = new Set(prev);
    next.has(name) ? next.delete(name) : next.add(name);
    return next;
  });

  const changeGroupBy = (g) => { setGroupBy(g); setCollapsedGroups(new Set()); };

  const groupSubtotal = (g) => (
    source === 'properties'
      ? `${g.entries} ${g.entries === 1 ? 'property' : 'properties'} · ${fmtLKR(g.cost)}`
      : `${g.entries} ${g.entries === 1 ? 'entry' : 'entries'} · ${fmtLKR(g.value)}`
  );

  const filtersActive = agencyId || clientId || medium || monthFrom || monthTo || channelType || propertyType;

  const clearFilters = () => {
    setAgencyId('');
    setClientId('');
    setMedium('');
    setMonthFrom('');
    setMonthTo('');
    setChannelType('');
    setPropertyType('');
    setChannelName('');
  };

  const handleExportExcel = async (groupKeyOverride) => {
    const gk = typeof groupKeyOverride === 'string' ? groupKeyOverride : undefined;
    if (gk) changeGroupBy(gk);
    setExporting(true);
    try {
      const qs = buildParams('excel', gk);
      const response = await api.get(`${endpoint}?${qs}`, { responseType: 'blob' });
      const blob = new Blob([response.data]);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const prefix = source === 'properties' ? 'properties' : 'schedule-logs';
      link.download = `${prefix}-${gk || groupBy}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      showToast('Excel exported successfully');
    } catch {
      setError('Failed to export Excel. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const handleExportPdf = async (groupKeyOverride) => {
    const gk = typeof groupKeyOverride === 'string' ? groupKeyOverride : undefined;
    if (gk) changeGroupBy(gk);
    setExporting(true);
    try {
      const qs = buildParams('pdf', gk);
      const response = await api.get(`${endpoint}?${qs}`, { responseType: 'blob' });
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const prefix = source === 'properties' ? 'properties' : 'schedule-logs';
      link.download = `${prefix}-${gk || groupBy}-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      showToast('PDF exported successfully');
    } catch {
      setError('Failed to export PDF. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const handleSourceChange = (s) => {
    setSource(s);
    setRows([]);
    setSummary({});
    setSortField('agencyName');
    setSortDir('asc');
    setCollapsedGroups(new Set());
    // Schedule logs don't support nested grouping - fall back to a valid option.
    if (s !== 'properties' && groupBy.includes('-')) setGroupBy('agency');
    clearFilters();
  };

  // Property columns
  const PROP_COLUMNS = [
    { key: 'agencyName', label: 'Agency' },
    { key: 'clientName', label: 'Client' },
    { key: 'channelName', label: 'Channel' },
    { key: 'category', label: 'Category' },
    { key: 'propertyName', label: 'Property' },
    { key: 'propertyType', label: 'Prop Type' },
    { key: 'cost', label: 'Value', align: 'right' },
    { key: 'bonusValue', label: 'Bonus', align: 'right' },
    { key: 'duration', label: 'Duration' },
    { key: 'createdBy', label: 'Created By' },
    { key: 'createdAt', label: 'Date' },
  ];

  // Schedule log columns
  const LOG_COLUMNS = [
    { key: 'agencyName', label: 'Agency' },
    { key: 'clientName', label: 'Client' },
    { key: 'channelName', label: 'Channel' },
    { key: 'medium', label: 'Medium' },
    { key: 'roNumber', label: 'RO #' },
    { key: 'scheduleMonth', label: 'Sch Month' },
    { key: 'scheduleValue', label: 'Schedule Value', align: 'right' },
    { key: 'scheduleValueWithVat', label: 'With VAT', align: 'right' },
    { key: 'uploadedBy', label: 'Uploaded By' },
  ];

  const columns = source === 'properties' ? PROP_COLUMNS : LOG_COLUMNS;

  const propTypeBadge = (type) => {
    if (!type) return <span style={{ color: 'var(--muted-2)' }}>-</span>;
    return (
      <span style={{
        display: 'inline-block', padding: '2px 8px', borderRadius: 4,
        fontSize: 11, fontWeight: 600, background: 'var(--bg-sunken)', color: 'var(--ink-soft)',
      }}>
        {type}
      </span>
    );
  };

  const mediumBadge = (m) => {
    const map = {
      TV: { bg: 'var(--blue-100)', color: 'var(--blue-700)' },
      RADIO: { bg: 'var(--purple-100)', color: 'var(--purple-700)' },
      PRINT: { bg: 'var(--amber-100)', color: 'var(--amber-700)' },
      DIGITAL: { bg: '#efe9fb', color: '#6B3FB5' },
      CINEMA: { bg: '#fce7f0', color: '#C2185B' },
      OOH: { bg: '#e0f4f8', color: '#0E7490' },
    };
    const s = map[m] || { bg: 'var(--navy-100)', color: 'var(--navy-700)' };
    return (
      <span style={{
        display: 'inline-block', padding: '2px 8px', borderRadius: 4,
        fontSize: 11, fontWeight: 600, background: s.bg, color: s.color,
      }}>
        {m}
      </span>
    );
  };

  const renderCell = (row, col) => {
    const val = row[col.key];
    if (col.key === 'cost') return <span className="mono">{val === 0 ? 'Added value' : fmtLKR(val)}</span>;
    if (col.key === 'scheduleValue' || col.key === 'scheduleValueWithVat') return <span className="mono">{fmtLKR(val)}</span>;
    if (col.key === 'bonusValue') return <span className="mono">{Number(val) > 0 ? fmtLKR(val) : '-'}</span>;
    if (col.key === 'duration') {
      if (!row.startDate) return <span style={{ color: 'var(--muted-2)' }}>-</span>;
      const fmt = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      return <span style={{ fontSize: 12 }}>{fmt(row.startDate)} &rarr; {row.endDate ? fmt(row.endDate) : <span style={{ color: 'var(--green-600)', fontWeight: 600 }}>Ongoing</span>}</span>;
    }
    if (col.key === 'propertyType') return propTypeBadge(val);
    if (col.key === 'medium') return val ? mediumBadge(val) : '-';
    if (col.key === 'roNumber') return <span className="mono" style={{ fontSize: 12 }}>{val || '-'}</span>;
    if (col.key === 'agencyName') return <span className="strong">{val || '-'}</span>;
    return val || '-';
  };

  const computedTotals = useMemo(() => {
    if (source === 'properties') {
      return { cost: rows.reduce((s, r) => s + (Number(r.cost) || 0), 0) };
    }
    return {
      value: rows.reduce((s, r) => s + (Number(r.scheduleValue) || 0), 0),
      vat: rows.reduce((s, r) => s + (Number(r.scheduleValueWithVat) || 0), 0),
    };
  }, [rows, source]);

  // ---- Design tokens ----
  const CARD = {
    background: '#fff',
    border: '1px solid #E5E8ED',
    borderRadius: 14,
    boxShadow: '0 1px 2px rgba(15,31,61,.06)',
  };
  const TINTS = [
    { bg: '#FDF1EB', fg: '#D9521C' },
    { bg: '#EDF3FD', fg: '#1F5BB5' },
    { bg: '#ECF8F1', fg: '#15814B' },
    { bg: '#E8DEF8', fg: '#6B3FB5' },
    { bg: '#FCF4E2', fg: '#9A5B00' },
    { bg: '#FBE0DA', fg: '#C5391F' },
  ];

  // Real report types this page offers = each group-by mode for the active
  // source. Selecting a card sets the grouping and exports an Excel file via
  // the page's existing handleExportExcel handler.
  const sourceLabel = source === 'properties' ? 'Property' : 'Schedule Log';
  const reportCards = GROUP_OPTIONS.map((opt) => ({
    key: opt.key,
    icon: opt.icon,
    name:
      opt.key === 'all'
        ? `${sourceLabel} Report - All Data`
        : `${sourceLabel} Report ${opt.label}`,
    desc:
      opt.key === 'channel'
        ? `${sourceLabel.toLowerCase()} data grouped by channel, each channel with its own subtotal.`
        : opt.key === 'client'
        ? `${sourceLabel.toLowerCase()} data grouped by client, each client with its own subtotal.`
        : opt.key === 'agency'
        ? `${sourceLabel.toLowerCase()} data grouped by agency, each agency with its own subtotal.`
        : `Flat ${sourceLabel.toLowerCase()} listing across every agency, client and channel.`,
  }));

  // Recently generated history derived from the active source/grouping -
  // wired to re-run the existing export handler.
  const recent = !loading && rows.length > 0
    ? grouped
      ? grouped.slice(0, 5).map((g) => ({
          name: `${g.name} - ${sourceLabel}`,
          sub: `${groupSubtotal(g)}`,
        }))
      : [{
          name: `${sourceLabel} Report - All Data`,
          sub: `${rows.length} ${rows.length === 1 ? 'row' : 'rows'} · ${fmtLKR(source === 'properties' ? computedTotals.cost : computedTotals.value)}`,
        }]
    : [];

  return (
    <div className="fade-in" style={{ maxWidth: 1320, margin: '0 auto' }}>
      {/* Header */}
      <div className="page-head">
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-.6px', color: '#16243C', margin: 0 }}>Reports</h1>
          <p style={{ fontSize: 13.5, color: '#6B7790', margin: '6px 0 0' }}>Generate and export media buying reports</p>
        </div>
        {source !== 'mediaGroup' && (
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              className="btn btn-ghost"
              onClick={() => handleExportPdf()}
              disabled={loading || exporting || rows.length === 0}
            >
              <Icon name="file" size={16} />
              PDF
            </button>
            <button
              className="btn btn-primary"
              onClick={() => handleExportExcel()}
              disabled={loading || exporting || rows.length === 0}
            >
              <Icon name="download" size={16} />
              {exporting ? 'Exporting...' : 'Export Excel'}
            </button>
          </div>
        )}
      </div>

      {/* Report Cards */}
      {source !== 'mediaGroup' && (
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 18,
        marginBottom: 24,
      }}>
        {reportCards.map((rc, i) => {
          const tint = TINTS[i % TINTS.length];
          return (
            <div
              key={rc.key}
              style={{
                ...CARD,
                padding: 20,
                display: 'flex',
                flexDirection: 'column',
                transition: 'border-color .15s ease, box-shadow .15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#C7D0DD';
                e.currentTarget.style.boxShadow = '0 6px 20px rgba(15,31,61,.09)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#E5E8ED';
                e.currentTarget.style.boxShadow = '0 1px 2px rgba(15,31,61,.06)';
              }}
            >
              <div style={{
                width: 40, height: 40, borderRadius: 11,
                background: tint.bg, color: tint.fg,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginBottom: 14,
              }}>
                <Icon name={rc.icon} size={20} />
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-.2px', color: '#16243C' }}>{rc.name}</div>
              <div style={{ fontSize: 12.5, color: '#6B7790', marginTop: 6, lineHeight: 1.5, flex: 1 }}>{rc.desc}</div>
              <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => handleExportPdf(rc.key)} disabled={exporting}>
                  <Icon name="file" size={14} /> PDF
                </button>
                <button className="btn btn-primary btn-sm" onClick={() => handleExportExcel(rc.key)} disabled={exporting}>
                  <Icon name="download" size={14} /> Excel
                </button>
              </div>
            </div>
          );
        })}
      </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          background: 'var(--red-100)', border: '1px solid var(--red-600)',
          borderRadius: 8, padding: '10px 14px', fontSize: 13,
          color: 'var(--red-600)', marginBottom: 16,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span>{error}</span>
          <button onClick={() => setError('')} style={{
            background: 'none', border: 'none', color: 'inherit',
            cursor: 'pointer', fontWeight: 600, fontSize: 13, textDecoration: 'underline',
          }}>Dismiss</button>
        </div>
      )}

      {/* Source Toggle */}
      <div style={{
        display: 'flex', gap: 6, marginBottom: 12,
        background: 'var(--bg-sunken)', borderRadius: 10, padding: 4, width: 'fit-content',
      }}>
        {[
          { key: 'properties', label: 'Properties', icon: 'file' },
          { key: 'scheduleLogs', label: 'Schedule Logs', icon: 'calendar' },
          { key: 'mediaGroup', label: 'Media Groups', icon: 'grid' },
        ].map((opt) => {
          const active = source === opt.key;
          return (
            <button
              key={opt.key}
              onClick={() => handleSourceChange(opt.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 16px', borderRadius: 7, border: 'none', fontSize: 13,
                fontWeight: active ? 600 : 500,
                background: active ? 'var(--card)' : 'transparent',
                color: active ? 'var(--navy-900)' : 'var(--muted)',
                boxShadow: active ? 'var(--sh-sm)' : 'none',
                cursor: 'pointer', transition: 'all .15s ease',
              }}
            >
              <Icon name={opt.icon} size={15} />
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Media Group Report (self-contained) */}
      {source === 'mediaGroup' && (
        <MediaGroupReport agencies={agencies} agenciesLoading={agenciesLoading} showToast={showToast} onError={setError} />
      )}

      {/* Group By Selector */}
      {source !== 'mediaGroup' && (<>
      <div style={{
        display: 'flex', gap: 6, marginBottom: 16,
        background: 'var(--bg-sunken)', borderRadius: 10, padding: 4, width: 'fit-content',
      }}>
        {groupOptions.map((opt) => {
          const active = groupBy === opt.key;
          return (
            <button
              key={opt.key}
              onClick={() => changeGroupBy(opt.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 14px', borderRadius: 7, border: 'none', fontSize: 13,
                fontWeight: active ? 600 : 500,
                background: active ? 'var(--card)' : 'transparent',
                color: active ? 'var(--coral-600)' : 'var(--muted)',
                boxShadow: active ? 'var(--sh-sm)' : 'none',
                cursor: 'pointer', transition: 'all .15s ease',
              }}
            >
              <Icon name={opt.icon} size={15} />
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Filter Bar */}
      <div className="filterbar">
        <div className="filter-field">
          <label>Agency</label>
          <select className="select" value={agencyId} onChange={(e) => { setAgencyId(e.target.value); setClientId(''); }} disabled={agenciesLoading}>
            <option value="">All agencies</option>
            {agencies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>

        <div className="filter-field">
          <label>Client</label>
          <select className="select" value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={!agencyId}>
            <option value="">All clients</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {source === 'scheduleLogs' && (
          <>
            <div className="filter-field">
              <label>Medium</label>
              <select className="select" value={medium} onChange={(e) => setMedium(e.target.value)}>
                <option value="">All mediums</option>
                {MEDIUM_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div className="filter-field">
              <label>Month From</label>
              <input type="month" className="input" value={monthFrom} onChange={(e) => setMonthFrom(e.target.value)} />
            </div>
            <div className="filter-field">
              <label>Month To</label>
              <input type="month" className="input" value={monthTo} onChange={(e) => setMonthTo(e.target.value)} />
            </div>
          </>
        )}

        {source === 'properties' && (
          <>
            <div className="filter-field">
              <label>Channel</label>
              <select className="select" value={channelName} onChange={(e) => setChannelName(e.target.value)}>
                <option value="">All channels</option>
                {channels.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="filter-field">
              <label>Channel Type</label>
              <select className="select" value={channelType} onChange={(e) => setChannelType(e.target.value)}>
                <option value="">All types</option>
                {CHANNEL_TYPE_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div className="filter-field" style={{ justifyContent: 'flex-end' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 13, color: '#3B4A63', fontWeight: 600 }}>
                <input type="checkbox" checked={includeHistory} onChange={(e) => setIncludeHistory(e.target.checked)} />
                Include rate history
              </label>
            </div>
          </>
        )}

        {filtersActive && (
          <button className="btn btn-ghost btn-sm" onClick={clearFilters} style={{ alignSelf: 'flex-end', marginBottom: 2 }}>
            <Icon name="x" size={14} /> Clear filters
          </button>
        )}
      </div>

      {/* Summary Stats */}
      {!loading && rows.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: source === 'properties' ? 'repeat(3, 1fr)' : 'repeat(3, 1fr)',
          gap: 14, marginBottom: 20, marginTop: 8,
        }}>
          <div className="section-card" style={{ padding: '16px 20px' }}>
            <div className="stat">
              <div className="stat-top">
                <span className="stat-label">Total Entries</span>
                <span className="stat-ico" style={{ color: 'var(--blue-700)' }}><Icon name="database" size={18} /></span>
              </div>
              <div className="stat-val">{(summary.totalEntries || rows.length).toLocaleString('en-US')}</div>
            </div>
          </div>

          {source === 'properties' ? (
            <>
              <div className="section-card" style={{ padding: '16px 20px' }}>
                <div className="stat">
                  <div className="stat-top">
                    <span className="stat-label">Total Cost</span>
                    <span className="stat-ico" style={{ color: 'var(--green-600)' }}><Icon name="bar-chart" size={18} /></span>
                  </div>
                  <div className="stat-val mono">{fmtLKR(summary.totalCost || computedTotals.cost)}</div>
                </div>
              </div>
              <div className="section-card" style={{ padding: '16px 20px' }}>
                <div className="stat">
                  <div className="stat-top">
                    <span className="stat-label">Added Value Items</span>
                    <span className="stat-ico" style={{ color: 'var(--coral-600)' }}><Icon name="dollar" size={18} /></span>
                  </div>
                  <div className="stat-val">{summary.addedValue || rows.filter((r) => r.cost === 0).length}</div>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="section-card" style={{ padding: '16px 20px' }}>
                <div className="stat">
                  <div className="stat-top">
                    <span className="stat-label">Schedule Value</span>
                    <span className="stat-ico" style={{ color: 'var(--green-600)' }}><Icon name="bar-chart" size={18} /></span>
                  </div>
                  <div className="stat-val mono">{fmtLKR(summary.totalScheduleValue || computedTotals.value)}</div>
                </div>
              </div>
              <div className="section-card" style={{ padding: '16px 20px' }}>
                <div className="stat">
                  <div className="stat-top">
                    <span className="stat-label">With VAT</span>
                    <span className="stat-ico" style={{ color: 'var(--coral-600)' }}><Icon name="trending-up" size={18} /></span>
                  </div>
                  <div className="stat-val mono">{fmtLKR(summary.totalWithVat || computedTotals.vat)}</div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <OrbitLoader fullHeight label="Loading report data…" />
      )}

      {/* Empty State */}
      {!loading && rows.length === 0 && (
        <div style={{ textAlign: 'center', padding: '64px 0', color: 'var(--muted)' }}>
          <Icon name="file" size={36} style={{ opacity: 0.25, marginBottom: 12, display: 'inline-block' }} />
          <p style={{ margin: 0, fontSize: 14 }}>
            {source === 'properties'
              ? 'No properties found. Add properties to your channels first.'
              : 'No schedule log data found. Upload schedule logs via the Database page.'}
          </p>
        </div>
      )}

      {/* Grouping toolbar */}
      {!loading && grouped && grouped.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, fontSize: 13 }}>
          <span style={{ color: 'var(--muted)' }}>
            {grouped.length} {grouped.length === 1 ? 'group' : 'groups'} by {groupOptions.find((o) => o.key === groupBy)?.label.replace('By ', '').toLowerCase()}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => setCollapsedGroups(new Set())}>Expand all</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setCollapsedGroups(new Set(grouped.map((g) => g.name)))}>Collapse all</button>
        </div>
      )}

      {/* Results Table */}
      {!loading && sorted.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    style={{ cursor: 'pointer', textAlign: col.align || 'left' }}
                  >
                    {col.label}{sortIcon(col.key)}
                  </th>
                ))}
              </tr>
            </thead>
            {grouped ? (
              grouped.map((g) => {
                const collapsed = collapsedGroups.has(g.name);
                return (
                  <tbody key={g.name}>
                    <tr
                      className="report-group-row"
                      onClick={() => toggleGroup(g.name)}
                      style={{ cursor: 'pointer', background: 'var(--bg-sunken)' }}
                    >
                      <td colSpan={columns.length} style={{ fontWeight: 700 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Icon name={collapsed ? 'chevR' : 'chevD'} size={15} />
                          <span style={{ color: 'var(--ink)' }}>{g.name}</span>
                          <span style={{ marginLeft: 'auto', fontWeight: 600, color: 'var(--muted)', fontSize: 12.5 }}>
                            {groupSubtotal(g)}
                            {source !== 'properties' && (
                              <span style={{ marginLeft: 8 }}>(VAT {fmtLKR(g.vat)})</span>
                            )}
                          </span>
                        </div>
                      </td>
                    </tr>
                    {!collapsed && g.rows.map((row, idx) => (
                      <tr key={idx}>
                        {columns.map((col) => (
                          <td key={col.key} style={{ textAlign: col.align || 'left' }}>
                            {renderCell(row, col)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                );
              })
            ) : (
              <tbody>
                {sorted.map((row, idx) => (
                  <tr key={idx}>
                    {columns.map((col) => (
                      <td key={col.key} style={{ textAlign: col.align || 'left' }}>
                        {renderCell(row, col)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            )}
            <tfoot>
              <tr>
                {source === 'properties' ? (
                  <>
                    <td className="strong" colSpan={6}>Total - {rows.length} {rows.length === 1 ? 'property' : 'properties'}</td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{fmtLKR(computedTotals.cost)}</td>
                    <td colSpan={3} />
                  </>
                ) : (
                  <>
                    <td className="strong" colSpan={6}>Total - {rows.length} {rows.length === 1 ? 'entry' : 'entries'}</td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{fmtLKR(computedTotals.value)}</td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{fmtLKR(computedTotals.vat)}</td>
                    <td />
                  </>
                )}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Recently Generated */}
      {recent.length > 0 && (
        <div style={{ ...CARD, padding: 20, marginTop: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-.2px', color: '#16243C', marginBottom: 14 }}>Recently Generated</div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {recent.map((r, i) => (
              <div
                key={i}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 0',
                  borderTop: i === 0 ? 'none' : '1px solid #EEF0F3',
                }}
              >
                <div style={{
                  width: 34, height: 34, borderRadius: 9,
                  background: '#FDF1EB', color: '#D9521C',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <Icon name="file" size={16} />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#16243C', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                  <div style={{ fontSize: 11.5, color: '#93A0B5', marginTop: 2 }}>{r.sub}</div>
                </div>
                <span style={{
                  fontSize: 11, fontWeight: 700, color: '#3B4A63',
                  background: '#EEF0F3', padding: '3px 9px', borderRadius: 6, flexShrink: 0,
                }}>EXCEL</span>
                <button
                  onClick={handleExportExcel}
                  disabled={exporting}
                  title="Download"
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: '#93A0B5', display: 'flex', alignItems: 'center', padding: 4,
                    transition: 'color .15s ease', flexShrink: 0,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#D9521C'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = '#93A0B5'; }}
                >
                  <Icon name="download" size={16} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      </>)}

      {/* Toast */}
      {toast && (
        <div className="toast">
          <span className="toast-icon"><Icon name="check" size={14} /></span>
          {toast}
        </div>
      )}
    </div>
  );
}

// ── Media Group Report ──────────────────────────────────────────────────────
// Full spend breakdown for a media group: year-wise totals, per-channel (year-
// wise), per-agency (year-wise), and the Agency × Channel matrix - all in one
// place, with Excel (multi-sheet) + PDF export mirroring the on-screen preview.
function MediaGroupReport({ agencies, agenciesLoading, showToast, onError }) {
  const [mediaGroup, setMediaGroup] = useState('');   // '' = all media groups
  const [agencyId, setAgencyId] = useState('');
  const [monthFrom, setMonthFrom] = useState('');
  const [monthTo, setMonthTo] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [expandedAgency, setExpandedAgency] = useState(() => new Set());

  const buildQs = useCallback((format) => {
    const p = new URLSearchParams();
    if (mediaGroup) p.set('mediaGroup', mediaGroup);
    if (agencyId) p.set('agencyId', agencyId);
    if (monthFrom) p.set('monthFrom', monthFrom);
    if (monthTo) p.set('monthTo', monthTo);
    if (format) p.set('format', format);
    return p.toString();
  }, [mediaGroup, agencyId, monthFrom, monthTo]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data: d } = await api.get(`/reports/media-group?${buildQs('json')}`);
        if (!cancelled) setData(d);
      } catch {
        if (!cancelled) { onError?.('Failed to load media group report.'); setData(null); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [buildQs, onError]);

  const doExport = async (format) => {
    setExporting(true);
    try {
      const resp = await api.get(`/reports/media-group?${buildQs(format)}`, { responseType: 'blob' });
      const blob = new Blob([resp.data], format === 'pdf' ? { type: 'application/pdf' } : {});
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const g = (mediaGroup || 'all').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      a.download = `media-group-${g}-${new Date().toISOString().slice(0, 10)}.${format === 'pdf' ? 'pdf' : 'xlsx'}`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
      showToast?.(`${format.toUpperCase()} exported successfully`);
    } catch {
      onError?.('Failed to export. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const years = data?.years || [];
  const availGroups = data?.availableMediaGroups || [];
  const hasData = !!data && (data.summary?.entries || 0) > 0;
  const label = mediaGroup || 'All media groups';

  const toggleAgency = (name) => setExpandedAgency((prev) => {
    const next = new Set(prev);
    next.has(name) ? next.delete(name) : next.add(name);
    return next;
  });

  // A year-wise pivot table for a list of {label, byYear, value, vat}.
  const PivotTable = ({ title, rows, labelHeader }) => (
    <div className="section-card" style={{ padding: 0, marginBottom: 18, overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', fontSize: 14, fontWeight: 700, color: '#16243C', borderBottom: '1px solid #EEF0F3' }}>{title}</div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>{labelHeader}</th>
              {years.map((y) => <th key={y} style={{ textAlign: 'right' }}>{y}</th>)}
              <th style={{ textAlign: 'right' }}>Total</th>
              <th style={{ textAlign: 'right' }}>With VAT</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="strong">{r.label}</td>
                {years.map((y) => <td key={y} className="mono" style={{ textAlign: 'right' }}>{r.byYear[y] ? fmtLKR(r.byYear[y]) : '-'}</td>)}
                <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{fmtLKR(r.value)}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{fmtLKR(r.vat)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const statCard = (label2, value, color, icon) => (
    <div className="section-card" style={{ padding: '16px 20px' }}>
      <div className="stat">
        <div className="stat-top">
          <span className="stat-label">{label2}</span>
          <span className="stat-ico" style={{ color }}><Icon name={icon} size={18} /></span>
        </div>
        <div className="stat-val mono">{value}</div>
      </div>
    </div>
  );

  return (
    <div style={{ marginTop: 4 }}>
      {/* Filter Bar */}
      <div className="filterbar">
        <div className="filter-field">
          <label>Media Group</label>
          <select className="select" value={mediaGroup} onChange={(e) => setMediaGroup(e.target.value)}>
            <option value="">All media groups</option>
            {availGroups.map((g) => <option key={g.name} value={g.name}>{g.name}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label>Agency</label>
          <select className="select" value={agencyId} onChange={(e) => setAgencyId(e.target.value)} disabled={agenciesLoading}>
            <option value="">All agencies</option>
            {agencies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label>Month From</label>
          <input type="month" className="input" value={monthFrom} onChange={(e) => setMonthFrom(e.target.value)} />
        </div>
        <div className="filter-field">
          <label>Month To</label>
          <input type="month" className="input" value={monthTo} onChange={(e) => setMonthTo(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 2, marginLeft: 'auto' }}>
          <button className="btn btn-ghost" onClick={() => doExport('pdf')} disabled={loading || exporting || !hasData}>
            <Icon name="file" size={16} /> PDF
          </button>
          <button className="btn btn-primary" onClick={() => doExport('excel')} disabled={loading || exporting || !hasData}>
            <Icon name="download" size={16} /> {exporting ? 'Exporting…' : 'Export Excel'}
          </button>
        </div>
      </div>

      {loading && <OrbitLoader fullHeight label="Loading media group report…" />}

      {!loading && !hasData && (
        <div style={{ textAlign: 'center', padding: '64px 0', color: 'var(--muted)' }}>
          <Icon name="grid" size={36} style={{ opacity: 0.25, marginBottom: 12, display: 'inline-block' }} />
          <p style={{ margin: 0, fontSize: 14 }}>No schedule log spend found for {label}. Upload schedule logs via the Database page.</p>
        </div>
      )}

      {!loading && hasData && (
        <>
          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14, marginBottom: 18, marginTop: 8 }}>
            {statCard('Total Spend', fmtLKR(data.summary.totalValue), 'var(--green-600)', 'bar-chart')}
            {statCard('With VAT', fmtLKR(data.summary.totalVat), 'var(--coral-600)', 'trending-up')}
            {statCard('Channels', data.summary.channelCount.toLocaleString('en-US'), 'var(--blue-700)', 'tv')}
            {statCard('Agencies', data.summary.agencyCount.toLocaleString('en-US'), 'var(--purple-700)', 'building')}
          </div>

          {/* Spend by Year */}
          {data.summary.byYear.length > 0 && (
            <PivotTable
              title={`Spend by Year - ${label}`}
              labelHeader="Year"
              rows={data.summary.byYear.map((y) => ({ label: y.year, byYear: { [y.year]: y.value }, value: y.value, vat: y.vat }))}
            />
          )}

          {/* By Media Group (only when covering all groups) */}
          {(!mediaGroup && (data.byMediaGroup || []).length > 0) && (
            <PivotTable
              title="Spend by Media Group"
              labelHeader="Media Group"
              rows={data.byMediaGroup.map((r) => ({ label: r.mediaGroup, byYear: r.byYear, value: r.value, vat: r.vat }))}
            />
          )}

          {/* By Channel */}
          <PivotTable
            title="Spend by Channel (year-wise)"
            labelHeader="Channel"
            rows={data.byChannel.map((r) => ({ label: r.channel, byYear: r.byYear, value: r.value, vat: r.vat }))}
          />

          {/* By Agency */}
          <PivotTable
            title="Spend by Agency (year-wise)"
            labelHeader="Agency"
            rows={data.byAgency.map((r) => ({ label: r.agency, byYear: r.byYear, value: r.value, vat: r.vat }))}
          />

          {/* Agency × Channel (grouped, expandable) */}
          <div className="section-card" style={{ padding: 0, marginBottom: 18, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', fontSize: 14, fontWeight: 700, color: '#16243C', borderBottom: '1px solid #EEF0F3' }}>
              Agency × Channel (year-wise)
            </div>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Agency / Channel</th>
                    {years.map((y) => <th key={y} style={{ textAlign: 'right' }}>{y}</th>)}
                    <th style={{ textAlign: 'right' }}>Total</th>
                    <th style={{ textAlign: 'right' }}>With VAT</th>
                  </tr>
                </thead>
                {(() => {
                  const byAg = {};
                  for (const r of data.byAgencyChannel) (byAg[r.agency] = byAg[r.agency] || []).push(r);
                  const agencyNames = Object.keys(byAg).sort((a, b) => {
                    const sa = byAg[a].reduce((s, r) => s + r.value, 0);
                    const sb = byAg[b].reduce((s, r) => s + r.value, 0);
                    return sb - sa || a.localeCompare(b);
                  });
                  return agencyNames.map((ag) => {
                    const items = byAg[ag].slice().sort((a, b) => b.value - a.value);
                    const subVal = items.reduce((s, r) => s + r.value, 0);
                    const subVat = items.reduce((s, r) => s + r.vat, 0);
                    const subYear = (y) => items.reduce((s, r) => s + (r.byYear[y] || 0), 0);
                    const collapsed = !expandedAgency.has(ag);
                    return (
                      <tbody key={ag}>
                        <tr onClick={() => toggleAgency(ag)} style={{ cursor: 'pointer', background: 'var(--bg-sunken)' }}>
                          <td style={{ fontWeight: 700 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <Icon name={collapsed ? 'chevR' : 'chevD'} size={15} />
                              <span style={{ color: 'var(--ink)' }}>{ag}</span>
                              <span style={{ color: 'var(--muted)', fontWeight: 600, fontSize: 12 }}>· {items.length} channel(s)</span>
                            </div>
                          </td>
                          {years.map((y) => <td key={y} className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{subYear(y) ? fmtLKR(subYear(y)) : '-'}</td>)}
                          <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{fmtLKR(subVal)}</td>
                          <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{fmtLKR(subVat)}</td>
                        </tr>
                        {!collapsed && items.map((r, i) => (
                          <tr key={i}>
                            <td style={{ paddingLeft: 34 }}>{r.channel}</td>
                            {years.map((y) => <td key={y} className="mono" style={{ textAlign: 'right' }}>{r.byYear[y] ? fmtLKR(r.byYear[y]) : '-'}</td>)}
                            <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{fmtLKR(r.value)}</td>
                            <td className="mono" style={{ textAlign: 'right' }}>{fmtLKR(r.vat)}</td>
                          </tr>
                        ))}
                      </tbody>
                    );
                  });
                })()}
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
