import { useState, useEffect, useMemo, useCallback } from 'react';
import Icon from '../components/Icon';
import api from '../lib/api';

const GROUP_OPTIONS = [
  { key: 'channel', label: 'By Channel', icon: 'tv' },
  { key: 'client', label: 'By Client', icon: 'folder' },
  { key: 'agency', label: 'By Agency', icon: 'building' },
  { key: 'all', label: 'All Data', icon: 'database' },
];

const MEDIUM_OPTIONS = [
  { value: 'TV', label: 'TV' },
  { value: 'RADIO', label: 'Radio' },
  { value: 'PRINT', label: 'Print' },
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
];

function fmtLKR(v) {
  return 'LKR ' + Math.round(Number(v) || 0).toLocaleString('en-US');
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

  const buildParams = useCallback((format) => {
    const params = new URLSearchParams();
    params.set('groupBy', groupBy);
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
    }
    return params.toString();
  }, [groupBy, agencyId, clientId, medium, monthFrom, monthTo, channelType, propertyType, source]);

  const endpoint = source === 'properties' ? '/reports/properties' : '/reports/schedule-logs';

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
    const numericFields = ['cost', 'scheduleValue', 'scheduleValueWithVat', 'bonusPct'];
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
    const keyField = groupBy === 'agency' ? 'agencyName' : groupBy === 'client' ? 'clientName' : 'channelName';
    const map = new Map();
    for (const r of sorted) {
      const k = r[keyField] || '—';
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
  };

  const handleExportExcel = async () => {
    setExporting(true);
    try {
      const qs = buildParams('excel');
      const response = await api.get(`${endpoint}?${qs}`, { responseType: 'blob' });
      const blob = new Blob([response.data]);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const prefix = source === 'properties' ? 'properties' : 'schedule-logs';
      link.download = `${prefix}-${groupBy}-${new Date().toISOString().slice(0, 10)}.xlsx`;
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
    clearFilters();
  };

  // Property columns
  const PROP_COLUMNS = [
    { key: 'agencyName', label: 'Agency' },
    { key: 'clientName', label: 'Client' },
    { key: 'channelName', label: 'Channel' },
    { key: 'channelType', label: 'Type' },
    { key: 'propertyName', label: 'Property' },
    { key: 'propertyType', label: 'Prop Type' },
    { key: 'cost', label: 'Cost', align: 'right' },
    { key: 'bonusPct', label: 'Bonus %', align: 'right' },
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
    const map = {
      BOUGHT_AIRTIME: { bg: 'var(--blue-100)', color: 'var(--blue-700)', label: 'Bought Airtime' },
      SPONSORSHIP: { bg: 'var(--purple-100)', color: 'var(--purple-700)', label: 'Sponsorship' },
      BONUS_COMMERCIAL: { bg: 'var(--green-100)', color: 'var(--green-700)', label: 'Bonus' },
      OTHER: { bg: 'var(--amber-100)', color: 'var(--amber-700)', label: 'Other' },
    };
    const s = map[type] || map.OTHER;
    return (
      <span style={{
        display: 'inline-block', padding: '2px 8px', borderRadius: 4,
        fontSize: 11, fontWeight: 600, background: s.bg, color: s.color,
      }}>
        {s.label}
      </span>
    );
  };

  const mediumBadge = (m) => {
    const map = {
      TV: { bg: 'var(--blue-100)', color: 'var(--blue-700)' },
      RADIO: { bg: 'var(--purple-100)', color: 'var(--purple-700)' },
      PRINT: { bg: 'var(--amber-100)', color: 'var(--amber-700)' },
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
    if (col.key === 'bonusPct') return val ? `${val}%` : '-';
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

  return (
    <div className="fade-in">
      {/* Header */}
      <div className="page-head">
        <div>
          <h1 className="page-title">Buying Reports</h1>
          <p className="page-sub">Export property and schedule log data grouped by channel, client, or agency</p>
        </div>
        <button
          className="btn btn-primary"
          onClick={handleExportExcel}
          disabled={loading || exporting || rows.length === 0}
        >
          <Icon name="download" size={16} />
          {exporting ? 'Exporting...' : 'Export Excel'}
        </button>
      </div>

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

      {/* Group By Selector */}
      <div style={{
        display: 'flex', gap: 6, marginBottom: 16,
        background: 'var(--bg-sunken)', borderRadius: 10, padding: 4, width: 'fit-content',
      }}>
        {GROUP_OPTIONS.map((opt) => {
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
              <label>Channel Type</label>
              <select className="select" value={channelType} onChange={(e) => setChannelType(e.target.value)}>
                <option value="">All types</option>
                {CHANNEL_TYPE_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div className="filter-field">
              <label>Property Type</label>
              <select className="select" value={propertyType} onChange={(e) => setPropertyType(e.target.value)}>
                <option value="">All types</option>
                {PROPERTY_TYPE_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
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
        <div style={{ textAlign: 'center', padding: '64px 0', color: 'var(--muted)' }}>
          <Icon name="clock" size={32} style={{ opacity: 0.3, marginBottom: 12, display: 'inline-block' }} />
          <p style={{ margin: 0, fontSize: 14 }}>Loading report data...</p>
        </div>
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
            {grouped.length} {grouped.length === 1 ? 'group' : 'groups'} by {GROUP_OPTIONS.find((o) => o.key === groupBy)?.label.replace('By ', '').toLowerCase()}
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
