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

function fmtLKR(v) {
  return 'LKR ' + Math.round(Number(v) || 0).toLocaleString('en-US');
}

export default function ReportsPage() {
  // Data state
  const [agencies, setAgencies] = useState([]);
  const [clients, setClients] = useState([]);
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({ totalScheduleValue: 0, totalWithVat: 0, totalEntries: 0 });

  // UI state
  const [loading, setLoading] = useState(false);
  const [agenciesLoading, setAgenciesLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [exporting, setExporting] = useState(false);

  // Filters
  const [groupBy, setGroupBy] = useState('agency');
  const [agencyId, setAgencyId] = useState('');
  const [clientId, setClientId] = useState('');
  const [medium, setMedium] = useState('');
  const [monthFrom, setMonthFrom] = useState('');
  const [monthTo, setMonthTo] = useState('');

  // Sort
  const [sortField, setSortField] = useState('agencyName');
  const [sortDir, setSortDir] = useState('asc');

  // Load agencies on mount
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

  // Load clients when agency changes
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

  // Build query params
  const buildParams = useCallback((format) => {
    const params = new URLSearchParams();
    params.set('groupBy', groupBy);
    if (agencyId) params.set('agencyId', agencyId);
    if (clientId) params.set('clientId', clientId);
    if (medium) params.set('medium', medium);
    if (monthFrom) params.set('monthFrom', monthFrom);
    if (monthTo) params.set('monthTo', monthTo);
    if (format) params.set('format', format);
    return params.toString();
  }, [groupBy, agencyId, clientId, medium, monthFrom, monthTo]);

  // Fetch report data
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const qs = buildParams('json');
        const { data } = await api.get(`/reports/schedule-logs?${qs}`);
        if (cancelled) return;
        const rawRows = data.rows;
        setRows(Array.isArray(rawRows) ? rawRows : []);
        setSummary({
          totalScheduleValue: Number(data.summary?.totalScheduleValue) || 0,
          totalWithVat: Number(data.summary?.totalWithVat) || 0,
          totalEntries: Number(data.summary?.totalEntries) || 0,
        });
      } catch {
        if (!cancelled) {
          setError('Failed to load report data.');
          setRows([]);
          setSummary({ totalScheduleValue: 0, totalWithVat: 0, totalEntries: 0 });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [buildParams]);

  // Sort logic
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
    return [...rows].sort((a, b) => {
      let aVal = a[sortField];
      let bVal = b[sortField];
      if (sortField === 'scheduleValue' || sortField === 'scheduleValueWithVat') {
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

  // Computed totals from rows (fallback if summary not available)
  const computedTotals = useMemo(() => ({
    value: rows.reduce((s, r) => s + (Number(r.scheduleValue) || 0), 0),
    vat: rows.reduce((s, r) => s + (Number(r.scheduleValueWithVat) || 0), 0),
  }), [rows]);

  // Filters active check
  const filtersActive = agencyId || clientId || medium || monthFrom || monthTo;

  const clearFilters = () => {
    setAgencyId('');
    setClientId('');
    setMedium('');
    setMonthFrom('');
    setMonthTo('');
  };

  // Export Excel
  const handleExportExcel = async () => {
    setExporting(true);
    try {
      const qs = buildParams('excel');
      const response = await api.get(`/reports/schedule-logs?${qs}`, { responseType: 'blob' });
      const blob = new Blob([response.data]);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `schedule-logs-${groupBy}-${new Date().toISOString().slice(0, 10)}.xlsx`;
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

  return (
    <div className="fade-in">
      {/* Header */}
      <div className="page-head">
        <div>
          <h1 className="page-title">Buying Reports</h1>
          <p className="page-sub">Export schedule log data grouped by channel, client, or agency</p>
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
          background: 'var(--red-100)',
          border: '1px solid var(--red-600)',
          borderRadius: 8,
          padding: '10px 14px',
          fontSize: 13,
          color: 'var(--red-600)',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span>{error}</span>
          <button
            onClick={() => setError('')}
            style={{
              background: 'none',
              border: 'none',
              color: 'inherit',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 13,
              textDecoration: 'underline',
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Group By Selector */}
      <div style={{
        display: 'flex',
        gap: 6,
        marginBottom: 16,
        background: 'var(--bg-sunken)',
        borderRadius: 10,
        padding: 4,
        width: 'fit-content',
      }}>
        {GROUP_OPTIONS.map((opt) => {
          const active = groupBy === opt.key;
          return (
            <button
              key={opt.key}
              onClick={() => setGroupBy(opt.key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 14px',
                borderRadius: 7,
                border: 'none',
                fontSize: 13,
                fontWeight: active ? 600 : 500,
                background: active ? 'var(--card)' : 'transparent',
                color: active ? 'var(--coral-600)' : 'var(--muted)',
                boxShadow: active ? 'var(--sh-sm)' : 'none',
                cursor: 'pointer',
                transition: 'all .15s ease',
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
          <select
            className="select"
            value={agencyId}
            onChange={(e) => {
              setAgencyId(e.target.value);
              setClientId('');
            }}
            disabled={agenciesLoading}
          >
            <option value="">All agencies</option>
            {agencies.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>

        <div className="filter-field">
          <label>Client</label>
          <select
            className="select"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            disabled={!agencyId}
          >
            <option value="">All clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div className="filter-field">
          <label>Medium</label>
          <select
            className="select"
            value={medium}
            onChange={(e) => setMedium(e.target.value)}
          >
            <option value="">All mediums</option>
            {MEDIUM_OPTIONS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>

        <div className="filter-field">
          <label>Month From</label>
          <input
            type="month"
            className="input"
            value={monthFrom}
            onChange={(e) => setMonthFrom(e.target.value)}
          />
        </div>

        <div className="filter-field">
          <label>Month To</label>
          <input
            type="month"
            className="input"
            value={monthTo}
            onChange={(e) => setMonthTo(e.target.value)}
          />
        </div>

        {filtersActive && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={clearFilters}
            style={{ alignSelf: 'flex-end', marginBottom: 2 }}
          >
            <Icon name="x" size={14} /> Clear filters
          </button>
        )}
      </div>

      {/* Summary Stats */}
      {!loading && rows.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 14,
          marginBottom: 20,
          marginTop: 8,
        }}>
          <div className="section-card" style={{ padding: '16px 20px' }}>
            <div className="stat">
              <div className="stat-top">
                <span className="stat-label">Total Entries</span>
                <span className="stat-ico" style={{ color: 'var(--blue-700)' }}>
                  <Icon name="database" size={18} />
                </span>
              </div>
              <div className="stat-val">{(summary.totalEntries || rows.length).toLocaleString('en-US')}</div>
            </div>
          </div>

          <div className="section-card" style={{ padding: '16px 20px' }}>
            <div className="stat">
              <div className="stat-top">
                <span className="stat-label">Schedule Value</span>
                <span className="stat-ico" style={{ color: 'var(--green-600)' }}>
                  <Icon name="bar-chart" size={18} />
                </span>
              </div>
              <div className="stat-val mono">{fmtLKR(summary.totalScheduleValue || computedTotals.value)}</div>
            </div>
          </div>

          <div className="section-card" style={{ padding: '16px 20px' }}>
            <div className="stat">
              <div className="stat-top">
                <span className="stat-label">With VAT</span>
                <span className="stat-ico" style={{ color: 'var(--coral-600)' }}>
                  <Icon name="trending-up" size={18} />
                </span>
              </div>
              <div className="stat-val mono">{fmtLKR(summary.totalWithVat || computedTotals.vat)}</div>
            </div>
          </div>
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
          <p style={{ margin: 0, fontSize: 14 }}>No schedule log data found. Adjust your filters and try again.</p>
        </div>
      )}

      {/* Results Table */}
      {!loading && sorted.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th onClick={() => handleSort('agencyName')} style={{ cursor: 'pointer' }}>
                  Agency{sortIcon('agencyName')}
                </th>
                <th onClick={() => handleSort('clientName')} style={{ cursor: 'pointer' }}>
                  Client{sortIcon('clientName')}
                </th>
                <th onClick={() => handleSort('brandName')} style={{ cursor: 'pointer' }}>
                  Brand{sortIcon('brandName')}
                </th>
                <th onClick={() => handleSort('campaignName')} style={{ cursor: 'pointer' }}>
                  Campaign{sortIcon('campaignName')}
                </th>
                <th onClick={() => handleSort('channelName')} style={{ cursor: 'pointer' }}>
                  Channel{sortIcon('channelName')}
                </th>
                <th onClick={() => handleSort('medium')} style={{ cursor: 'pointer' }}>
                  Medium{sortIcon('medium')}
                </th>
                <th onClick={() => handleSort('roNumber')} style={{ cursor: 'pointer' }}>
                  RO #{sortIcon('roNumber')}
                </th>
                <th onClick={() => handleSort('scheduleMonth')} style={{ cursor: 'pointer' }}>
                  Sch Month{sortIcon('scheduleMonth')}
                </th>
                <th onClick={() => handleSort('scheduleValue')} style={{ cursor: 'pointer', textAlign: 'right' }}>
                  Schedule Value{sortIcon('scheduleValue')}
                </th>
                <th onClick={() => handleSort('scheduleValueWithVat')} style={{ cursor: 'pointer', textAlign: 'right' }}>
                  With VAT{sortIcon('scheduleValueWithVat')}
                </th>
                <th onClick={() => handleSort('uploadedBy')} style={{ cursor: 'pointer' }}>
                  Uploaded By{sortIcon('uploadedBy')}
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, idx) => (
                <tr key={idx}>
                  <td className="strong">{row.agencyName || '-'}</td>
                  <td>{row.clientName || '-'}</td>
                  <td>{row.brandName || '-'}</td>
                  <td>{row.campaignName || '-'}</td>
                  <td>{row.channelName || '-'}</td>
                  <td>
                    {row.medium ? (
                      <span style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 600,
                        background: row.medium === 'TV' ? 'var(--blue-100)' :
                                    row.medium === 'RADIO' ? 'var(--purple-100)' :
                                    'var(--amber-100)',
                        color: row.medium === 'TV' ? 'var(--blue-700)' :
                               row.medium === 'RADIO' ? 'var(--purple-700)' :
                               'var(--amber-700)',
                      }}>
                        {row.medium}
                      </span>
                    ) : '-'}
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>{row.roNumber || '-'}</td>
                  <td>{row.scheduleMonth || '-'}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>
                    {fmtLKR(row.scheduleValue)}
                  </td>
                  <td className="mono" style={{ textAlign: 'right' }}>
                    {fmtLKR(row.scheduleValueWithVat)}
                  </td>
                  <td>{row.uploadedBy || '-'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="strong" colSpan={8}>
                  Total - {rows.length} {rows.length === 1 ? 'entry' : 'entries'}
                </td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>
                  {fmtLKR(computedTotals.value)}
                </td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>
                  {fmtLKR(computedTotals.vat)}
                </td>
                <td />
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
