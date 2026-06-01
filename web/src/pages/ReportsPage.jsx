import { useState, useEffect, useMemo } from 'react';
import Icon, { TypeBadge, fmtLKR } from '../components/Icon';
import api from '../lib/api';

export default function ReportsPage() {
  const [agencies, setAgencies] = useState([]);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [agenciesLoading, setAgenciesLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const [selectedAgency, setSelectedAgency] = useState('');
  const [selectedChannel, setSelectedChannel] = useState('');
  const [selectedClient, setSelectedClient] = useState('');

  const [sortField, setSortField] = useState('clientName');
  const [sortDir, setSortDir] = useState('asc');

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/agencies');
        const rawAg = data.agencies || data;
        setAgencies(Array.isArray(rawAg) ? rawAg : []);
      } catch {
        setError('Failed to load agencies.');
      } finally {
        setAgenciesLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedAgency) { setResults([]); return; }
    (async () => {
      setLoading(true);
      setError('');
      try {
        // Use the report endpoint which returns fully nested data
        const { data } = await api.get(`/reports/agency/${selectedAgency}`);
        const flat = [];
        for (const client of (data.clients || [])) {
          for (const channel of (client.channels || [])) {
            for (const p of (channel.properties || [])) {
              flat.push({
                ...p,
                clientName: client.name,
                channelName: channel.name,
                channelType: channel.type,
                createdByName: p.creator?.name || p.createdByName || '-',
              });
            }
          }
        }
        setResults(flat);
      } catch (err) {
        // Fallback: fetch clients → channels → properties individually
        try {
          const { data: agData } = await api.get(`/agencies/${selectedAgency}/clients`);
          const rawCl = agData.clients || agData;
          const allClients = Array.isArray(rawCl) ? rawCl : [];

          const flat = [];
          await Promise.all(allClients.map(async (c) => {
            try {
              const { data: chData } = await api.get(`/clients/${c.id}/channels`);
              const rawChs = chData.channels || chData;
              const chs = Array.isArray(rawChs) ? rawChs : [];
              await Promise.all(chs.map(async (ch) => {
                try {
                  const { data: prData } = await api.get(`/channels/${ch.id}/properties`);
                  const rawPr = prData.properties || prData;
                  const props = Array.isArray(rawPr) ? rawPr : [];
                  props.forEach(p => flat.push({
                    ...p,
                    clientName: c.name,
                    channelName: ch.name,
                    channelType: ch.type,
                    createdByName: p.creator?.name || '-',
                  }));
                } catch { /* skip channel */ }
              }));
            } catch { /* skip client */ }
          }));
          setResults(flat);
        } catch {
          setError('Failed to load report data.');
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [selectedAgency]);

  const uniqueChannels = useMemo(() => {
    const map = new Map();
    results.forEach(r => { if (r.channelName) map.set(r.channelName, true); });
    return [...map.keys()];
  }, [results]);

  const uniqueClients = useMemo(() => {
    const map = new Map();
    results.forEach(r => { if (r.clientName) map.set(r.clientName, true); });
    return [...map.keys()];
  }, [results]);

  const filtered = useMemo(() => {
    let rows = results;
    if (selectedChannel) rows = rows.filter(r => r.channelName === selectedChannel);
    if (selectedClient) rows = rows.filter(r => r.clientName === selectedClient);
    return rows;
  }, [results, selectedChannel, selectedClient]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let aVal = a[sortField];
      let bVal = b[sortField];
      if (sortField === 'cost') {
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
  }, [filtered, sortField, sortDir]);

  const totalCost = useMemo(
    () => filtered.reduce((s, r) => s + (Number(r.cost) || 0), 0),
    [filtered]
  );

  const filtersActive = selectedChannel || selectedClient;
  const resetFilters = () => { setSelectedChannel(''); setSelectedClient(''); };

  const handleSort = field => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };
  const sortIcon = field => sortField !== field ? '' : sortDir === 'asc' ? ' ↑' : ' ↓';

  const handleExport = async (format) => {
    if (!selectedAgency) { setError('Select an agency first.'); return; }
    try {
      const response = await api.get(`/reports/agency/${selectedAgency}?format=${format}`, { responseType: 'blob' });
      const blob = new Blob([response.data]);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `report.${format === 'excel' ? 'xlsx' : 'pdf'}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      showToast(`${format === 'excel' ? 'Excel' : 'PDF'} exported successfully`);
    } catch {
      setError(`Failed to export ${format}. Make sure an agency is selected.`);
    }
  };

  const showToast = msg => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h1 className="page-title">Buying Manager Report</h1>
          <p className="page-sub">Cross-client buying summary - read-only view for managers</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => handleExport('excel')} disabled={!selectedAgency || loading}>
            <Icon name="download" size={16} /> Export Excel
          </button>
          <button className="btn btn-primary" onClick={() => handleExport('pdf')} disabled={!selectedAgency || loading}>
            <Icon name="download" size={16} /> Export PDF
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: 'var(--red-50,#fef2f2)', border: '1px solid var(--red-200,#fecaca)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--red-700,#b91c1c)', marginBottom: 16 }}>
          {error}
          <button onClick={() => setError('')} style={{ marginLeft: 8, fontWeight: 600, textDecoration: 'underline', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>Dismiss</button>
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <div className="filter-field" style={{ maxWidth: 300 }}>
          <label>Agency</label>
          <select
            className="select"
            value={selectedAgency}
            onChange={e => {
              setSelectedAgency(e.target.value);
              setSelectedChannel('');
              setSelectedClient('');
              setResults([]);
            }}
            disabled={agenciesLoading}
          >
            <option value="">Select agency...</option>
            {agencies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      </div>

      {results.length > 0 && (
        <div className="filterbar">
          <div className="filter-field">
            <label>Channel</label>
            <select className="select" value={selectedChannel} onChange={e => setSelectedChannel(e.target.value)}>
              <option value="">All channels</option>
              {uniqueChannels.map(ch => <option key={ch} value={ch}>{ch}</option>)}
            </select>
          </div>
          <div className="filter-field">
            <label>Client</label>
            <select className="select" value={selectedClient} onChange={e => setSelectedClient(e.target.value)}>
              <option value="">All clients</option>
              {uniqueClients.map(cl => <option key={cl} value={cl}>{cl}</option>)}
            </select>
          </div>
          {filtersActive && (
            <button className="btn btn-subtle btn-sm" onClick={resetFilters}>
              <Icon name="x" size={15} />Clear filters
            </button>
          )}
          <div style={{ marginLeft: 'auto', marginBottom: 4, fontSize: 12.5, color: 'var(--muted)' }}>
            <b style={{ color: 'var(--ink)', fontWeight: 700 }}>{filtered.length}</b> results
          </div>
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--muted)' }}>
          Loading report data...
        </div>
      )}

      {!loading && selectedAgency && !loading && results.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--muted)' }}>
          <Icon name="file" size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
          <p>No properties found for this agency yet.</p>
        </div>
      )}

      {!loading && sorted.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th onClick={() => handleSort('clientName')} style={{ cursor: 'pointer' }}>Client{sortIcon('clientName')}</th>
                <th onClick={() => handleSort('channelName')} style={{ cursor: 'pointer' }}>Channel{sortIcon('channelName')}</th>
                <th onClick={() => handleSort('name')} style={{ cursor: 'pointer' }}>Property{sortIcon('name')}</th>
                <th onClick={() => handleSort('type')} style={{ cursor: 'pointer' }}>Type{sortIcon('type')}</th>
                <th onClick={() => handleSort('cost')} style={{ cursor: 'pointer', textAlign: 'right' }}>Cost (LKR){sortIcon('cost')}</th>
                <th onClick={() => handleSort('createdByName')} style={{ cursor: 'pointer' }}>Planner{sortIcon('createdByName')}</th>
                <th onClick={() => handleSort('createdAt')} style={{ cursor: 'pointer' }}>Date{sortIcon('createdAt')}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(item => {
                const cost = Number(item.cost) || 0;
                const isAddedValue = cost === 0;
                return (
                  <tr key={item.id}>
                    <td className="strong">{item.clientName || '-'}</td>
                    <td>{item.channelName || '-'}</td>
                    <td>{item.name}</td>
                    <td><TypeBadge type={item.type} /></td>
                    <td className="num mono" style={isAddedValue ? { color: 'var(--green-600)' } : undefined}>
                      {isAddedValue ? 'Added value' : fmtLKR(cost)}
                    </td>
                    <td>{item.creator?.name || item.createdByName || '-'}</td>
                    <td>
                      {item.createdAt
                        ? new Date(item.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                        : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="strong" colSpan={4}>
                  Total - {filtered.length} propert{filtered.length !== 1 ? 'ies' : 'y'}
                </td>
                <td className="num mono">{fmtLKR(totalCost)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {!loading && selectedAgency && results.length > 0 && sorted.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--muted)' }}>
          <Icon name="search" size={32} style={{ opacity: 0.4, marginBottom: 8 }} />
          <p>No buys match these filters</p>
        </div>
      )}

      {toast && (
        <div className="toast">
          <span className="toast-icon"><Icon name="check" size={14} /></span>
          {toast}
        </div>
      )}
    </div>
  );
}
