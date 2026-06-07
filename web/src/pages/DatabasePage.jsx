import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Icon from '../components/Icon';
import api from '../lib/api';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function computeInvoiceMonth(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function fmtMonth(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  return `${MONTHS[parseInt(m) - 1]} ${y}`;
}

function fmtLKR(v) {
  if (v == null || v === '') return '';
  return Math.round(Number(v)).toLocaleString('en-US');
}

const COLUMNS = [
  { key: 'groupHead', label: 'Group', width: 120, readOnly: true },
  { key: 'year', label: 'Year', width: 60, readOnly: true },
  { key: 'roNumber', label: 'Channel Estimate / RO Number', width: 200 },
  { key: 'scheduleMonth', label: 'Sch: Month', width: 120, type: 'month' },
  { key: 'invoiceMonth', label: 'Invoice Month', width: 120, readOnly: true },
  { key: 'clientName', label: 'Client', width: 130, readOnly: true },
  { key: 'brandName', label: 'Brand', width: 140, type: 'brand' },
  { key: 'medium', label: 'Medium', width: 80, readOnly: true },
  { key: 'mediaGroup', label: 'Media Group', width: 140, readOnly: true },
  { key: 'channelMasterId', label: 'Channel', width: 160, type: 'channel' },
  { key: 'scheduleValue', label: 'Schedule Value', width: 130, type: 'number', align: 'right' },
];

export default function DatabasePage() {
  const { user } = useAuth();
  const role = user?.role;
  const canWrite = ['SUPER_ADMIN', 'GROUP_HEAD', 'PLANNER'].includes(role);

  // Data
  const [agencies, setAgencies] = useState([]);
  const [clients, setClients] = useState([]);
  const [selectedAgencyId, setSelectedAgencyId] = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [channelMasters, setChannelMasters] = useState([]);
  const [metadata, setMetadata] = useState({ groupHeadName: '', brandSuggestions: [], client: null });

  // Table data
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState('scheduleMonth');
  const [sortOrder, setSortOrder] = useState('desc');

  // New rows being entered (Excel-like input rows)
  const [newRows, setNewRows] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState(null);

  // Editing existing rows inline
  const [editingCell, setEditingCell] = useState(null); // { rowId, colKey }
  const [editValue, setEditValue] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  // Refs
  const tableRef = useRef(null);
  const inputRefs = useRef({});

  // Load agencies
  useEffect(() => {
    api.get('/agencies').then(r => {
      const list = r.data.agencies || r.data || [];
      setAgencies(Array.isArray(list) ? list : []);
    }).catch(() => {});
  }, []);

  // Load clients when agency changes
  useEffect(() => {
    if (!selectedAgencyId) { setClients([]); setSelectedClientId(''); return; }
    api.get(`/agencies/${selectedAgencyId}/clients`).then(r => {
      const list = r.data.clients || r.data || [];
      setClients(Array.isArray(list) ? list : []);
      setSelectedClientId('');
    }).catch(() => setClients([]));
  }, [selectedAgencyId]);

  // Load channel masters
  useEffect(() => {
    api.get('/masterdata/channel-masters').then(r => {
      const list = r.data.channelMasters || r.data || [];
      setChannelMasters(Array.isArray(list) ? list : []);
    }).catch(() => {});
  }, []);

  // Load metadata (group head, brand suggestions) when client changes
  useEffect(() => {
    if (!selectedClientId) { setMetadata({ groupHeadName: '', brandSuggestions: [], client: null }); return; }
    api.get('/database/metadata', { params: { clientId: selectedClientId } }).then(r => {
      setMetadata(r.data);
    }).catch(() => {});
  }, [selectedClientId]);

  // Fetch existing schedule logs
  const fetchLogs = useCallback(async () => {
    if (!selectedClientId) return;
    setLoading(true);
    try {
      const params = { clientId: selectedClientId, page, limit: 100, sort: sortField, order: sortOrder };
      if (search) params.search = search;
      const { data } = await api.get('/database', { params });
      setRows(data.items || []);
      setTotal(data.total || 0);
    } catch { setRows([]); setTotal(0); }
    setLoading(false);
  }, [selectedClientId, page, sortField, sortOrder, search]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const totalPages = Math.ceil(total / 100);

  // Get channel name by ID
  const getChannelName = (id) => {
    const cm = channelMasters.find(c => c.id === parseInt(id));
    return cm?.name || '';
  };
  const getChannelMedium = (id) => {
    const cm = channelMasters.find(c => c.id === parseInt(id));
    return cm?.medium || '';
  };
  const getChannelMediaGroup = (id) => {
    const cm = channelMasters.find(c => c.id === parseInt(id));
    return cm?.mediaGroup?.name || '';
  };

  // Current month as YYYY-MM
  const currentMonth = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }, []);

  const currentYear = new Date().getFullYear();
  const clientName = metadata.client?.name || clients.find(c => String(c.id) === selectedClientId)?.name || '';

  // ── New row management ──

  const createEmptyRow = () => ({
    _id: Date.now() + Math.random(),
    roNumber: '',
    scheduleMonth: currentMonth,
    brandName: '',
    channelMasterId: '',
    scheduleValue: '',
  });

  const addNewRow = () => {
    setNewRows(prev => [...prev, createEmptyRow()]);
  };

  const updateNewRow = (idx, field, value) => {
    setNewRows(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: value };
      return updated;
    });
  };

  const removeNewRow = (idx) => {
    setNewRows(prev => prev.filter((_, i) => i !== idx));
  };

  // Save all new rows
  const saveNewRows = async () => {
    const validRows = newRows.filter(r => r.roNumber && r.scheduleMonth && r.channelMasterId && r.scheduleValue);
    if (validRows.length === 0) return;

    setSaving(true);
    setSaveResult(null);
    try {
      const payload = validRows.map(r => ({
        clientId: parseInt(selectedClientId),
        channelMasterId: parseInt(r.channelMasterId),
        roNumber: r.roNumber,
        scheduleMonth: r.scheduleMonth,
        scheduleValue: parseFloat(r.scheduleValue),
        brandName: r.brandName || null,
      }));

      const { data } = await api.post('/database/bulk', { rows: payload });
      const createdCount = data.created?.length || 0;
      const errorCount = data.errors?.length || 0;
      setSaveResult({ created: createdCount, errors: errorCount });

      if (createdCount > 0) {
        // Remove successfully saved rows, keep errored ones
        if (errorCount > 0) {
          const errorIndices = new Set(data.errors.map(e => e.row));
          setNewRows(prev => prev.filter((_, i) => errorIndices.has(i)));
        } else {
          setNewRows([]);
        }
        fetchLogs();
        // Refresh brand suggestions
        api.get('/database/metadata', { params: { clientId: selectedClientId } }).then(r => {
          setMetadata(r.data);
        }).catch(() => {});
      }
    } catch (err) {
      setSaveResult({ created: 0, errors: -1, message: err.response?.data?.error || 'Failed to save' });
    }
    setSaving(false);
  };

  // ── Inline edit existing rows ──

  const startEdit = (rowId, colKey, currentValue) => {
    if (!canWrite) return;
    setEditingCell({ rowId, colKey });
    setEditValue(currentValue ?? '');
  };

  const cancelEdit = () => {
    setEditingCell(null);
    setEditValue('');
  };

  const commitEdit = async () => {
    if (!editingCell) return;
    const { rowId, colKey } = editingCell;
    const row = rows.find(r => r.id === rowId);
    if (!row) { cancelEdit(); return; }

    const oldValue = colKey === 'channelMasterId' ? String(row.channelMasterId) : (row[colKey] ?? '');
    if (String(editValue) === String(oldValue)) { cancelEdit(); return; }

    setEditSaving(true);
    try {
      const payload = { editNote: `Inline edit: ${colKey}` };
      if (colKey === 'scheduleValue') {
        payload.scheduleValue = parseFloat(editValue);
      } else if (colKey === 'channelMasterId') {
        payload.channelMasterId = parseInt(editValue);
      } else {
        payload[colKey] = editValue;
      }
      await api.put(`/database/${rowId}`, payload);
      fetchLogs();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update');
    }
    setEditSaving(false);
    cancelEdit();
  };

  const handleEditKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
    if (e.key === 'Escape') cancelEdit();
    if (e.key === 'Tab') { e.preventDefault(); commitEdit(); }
  };

  // ── Paste handler for new rows ──

  const handlePaste = (e) => {
    const clipboardData = e.clipboardData?.getData('text');
    if (!clipboardData) return;

    const lines = clipboardData.split('\n').filter(l => l.trim());
    if (lines.length <= 1) return; // single cell paste, let default handle

    e.preventDefault();

    const pastedRows = lines.map(line => {
      const cols = line.split('\t');
      // Expected paste order: RO Number, Schedule Month (YYYY-MM), Brand, Channel Name, Schedule Value
      const row = createEmptyRow();
      if (cols[0]) row.roNumber = cols[0].trim();
      if (cols[1]) row.scheduleMonth = cols[1].trim();
      if (cols[2]) row.brandName = cols[2].trim();
      if (cols[3]) {
        // Try to match channel by name
        const chName = cols[3].trim().toLowerCase();
        const match = channelMasters.find(cm => cm.name.toLowerCase() === chName);
        if (match) row.channelMasterId = String(match.id);
      }
      if (cols[4]) row.scheduleValue = cols[4].trim().replace(/[^0-9.]/g, '');
      return row;
    });

    setNewRows(prev => [...prev, ...pastedRows]);
  };

  // ── Sort ──
  const handleSort = (field) => {
    if (sortField === field) {
      setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
    setPage(1);
  };

  // ── Delete ──
  const handleDelete = async (id) => {
    if (!confirm('Delete this row?')) return;
    try {
      await api.delete(`/database/${id}`);
      fetchLogs();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete');
    }
  };

  // ── Brand suggestions filtered ──
  const brandSuggestions = metadata.brandSuggestions || [];

  // Grand total from visible data
  const grandTotal = useMemo(() => rows.reduce((s, r) => s + (Number(r.scheduleValue) || 0), 0), [rows]);

  return (
    <div className="fade-in" onPaste={handlePaste}>
      <div className="page-head">
        <div>
          <h1 className="page-title">Schedule Database</h1>
          <p className="page-sub">Enter data like a spreadsheet - paste rows from Excel</p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="filterbar" style={{ marginBottom: 12 }}>
        <div className="filter-field">
          <label>Agency</label>
          <select className="select" value={selectedAgencyId} onChange={e => { setSelectedAgencyId(e.target.value); setPage(1); }}>
            <option value="">Select Agency</option>
            {agencies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label>Client</label>
          <select className="select" value={selectedClientId} onChange={e => { setSelectedClientId(e.target.value); setPage(1); setNewRows([]); }} disabled={!selectedAgencyId}>
            <option value="">Select Client</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        {selectedClientId && (
          <div className="filter-field">
            <label>Search</label>
            <input className="input" placeholder="RO number, brand..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
          </div>
        )}
      </div>

      {!selectedClientId ? (
        <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--muted)' }}>
          <Icon name="database" size={48} style={{ opacity: 0.2, marginBottom: 12, display: 'inline-block' }} />
          <p style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Select an agency and client to view data</p>
        </div>
      ) : (
        <>
          {/* Toolbar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>{total} records</span>
              {metadata.groupHeadName && (
                <span style={{ fontSize: 12, background: 'var(--blue-50, #eff6ff)', color: 'var(--blue-700, #1d4ed8)', padding: '3px 8px', borderRadius: 4, fontWeight: 600 }}>
                  Group: {metadata.groupHeadName}
                </span>
              )}
            </div>
            {canWrite && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-ghost btn-sm" onClick={addNewRow}>
                  <Icon name="plus" size={14} /> Add Row
                </button>
                {newRows.length > 0 && (
                  <button className="btn btn-primary btn-sm" onClick={saveNewRows} disabled={saving}>
                    {saving ? 'Saving...' : `Save ${newRows.filter(r => r.roNumber && r.channelMasterId && r.scheduleValue).length} rows`}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Save result message */}
          {saveResult && (
            <div style={{
              padding: '8px 12px', marginBottom: 10, borderRadius: 6, fontSize: 13,
              background: saveResult.errors > 0 ? 'var(--amber-50, #fffbeb)' : 'var(--green-50, #ecfdf5)',
              color: saveResult.errors > 0 ? 'var(--amber-700, #b45309)' : 'var(--green-700, #15803d)',
              border: `1px solid ${saveResult.errors > 0 ? 'var(--amber-200)' : 'var(--green-200)'}`,
            }}>
              {saveResult.created > 0 && <span>{saveResult.created} rows saved. </span>}
              {saveResult.errors > 0 && <span>{saveResult.errors} rows had errors. </span>}
              {saveResult.message && <span>{saveResult.message}</span>}
              <button onClick={() => setSaveResult(null)} style={{ marginLeft: 8, background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer', color: 'inherit' }}>Dismiss</button>
            </div>
          )}

          {/* Paste hint */}
          {canWrite && newRows.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="file" size={13} />
              Paste from Excel: RO Number | Month (YYYY-MM) | Brand | Channel Name | Value (tab-separated)
            </div>
          )}

          {/* Spreadsheet Table */}
          <div ref={tableRef} className="tbl-wrap" style={{ overflowX: 'auto' }}>
            <table className="tbl spreadsheet-tbl" style={{ minWidth: 1200, fontSize: 13 }}>
              <thead>
                <tr>
                  {COLUMNS.map(col => (
                    <th
                      key={col.key}
                      style={{ width: col.width, minWidth: col.width, textAlign: col.align || 'left', cursor: col.readOnly ? 'default' : 'pointer', whiteSpace: 'nowrap', userSelect: 'none' }}
                      onClick={() => !col.readOnly && handleSort(col.key)}
                    >
                      {col.label}
                      {sortField === col.key && <span style={{ marginLeft: 4 }}>{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                    </th>
                  ))}
                  {canWrite && <th style={{ width: 40 }}></th>}
                </tr>
              </thead>
              <tbody>
                {/* New entry rows */}
                {newRows.map((nRow, idx) => (
                  <tr key={nRow._id} className="new-row">
                    {/* Group - auto */}
                    <td className="cell cell-readonly">{metadata.groupHeadName || '-'}</td>
                    {/* Year - auto */}
                    <td className="cell cell-readonly">{currentYear}</td>
                    {/* RO Number - editable */}
                    <td className="cell cell-editable">
                      <input
                        className="cell-input"
                        value={nRow.roNumber}
                        onChange={e => updateNewRow(idx, 'roNumber', e.target.value)}
                        placeholder="RO-001"
                        tabIndex={0}
                      />
                    </td>
                    {/* Sch Month - editable */}
                    <td className="cell cell-editable">
                      <input
                        className="cell-input"
                        type="month"
                        value={nRow.scheduleMonth}
                        onChange={e => updateNewRow(idx, 'scheduleMonth', e.target.value)}
                        tabIndex={0}
                      />
                    </td>
                    {/* Invoice Month - auto */}
                    <td className="cell cell-readonly">{nRow.scheduleMonth ? fmtMonth(computeInvoiceMonth(nRow.scheduleMonth)) : ''}</td>
                    {/* Client - auto */}
                    <td className="cell cell-readonly">{clientName}</td>
                    {/* Brand - editable with suggestions */}
                    <td className="cell cell-editable">
                      <input
                        className="cell-input"
                        list={`brand-list-${idx}`}
                        value={nRow.brandName}
                        onChange={e => updateNewRow(idx, 'brandName', e.target.value)}
                        placeholder="Brand"
                        tabIndex={0}
                      />
                      <datalist id={`brand-list-${idx}`}>
                        {brandSuggestions.map(b => <option key={b} value={b} />)}
                      </datalist>
                    </td>
                    {/* Medium - auto from channel */}
                    <td className="cell cell-readonly">{nRow.channelMasterId ? getChannelMedium(nRow.channelMasterId) : ''}</td>
                    {/* Media Group - auto from channel */}
                    <td className="cell cell-readonly">{nRow.channelMasterId ? getChannelMediaGroup(nRow.channelMasterId) : ''}</td>
                    {/* Channel - select */}
                    <td className="cell cell-editable">
                      <select
                        className="cell-input cell-select"
                        value={nRow.channelMasterId}
                        onChange={e => updateNewRow(idx, 'channelMasterId', e.target.value)}
                        tabIndex={0}
                      >
                        <option value="">Select...</option>
                        {channelMasters.filter(c => c.isActive !== false).map(cm => (
                          <option key={cm.id} value={cm.id}>{cm.name}</option>
                        ))}
                      </select>
                    </td>
                    {/* Schedule Value - editable */}
                    <td className="cell cell-editable" style={{ textAlign: 'right' }}>
                      <input
                        className="cell-input"
                        type="number"
                        step="0.01"
                        min="0"
                        value={nRow.scheduleValue}
                        onChange={e => updateNewRow(idx, 'scheduleValue', e.target.value)}
                        placeholder="0.00"
                        style={{ textAlign: 'right' }}
                        tabIndex={0}
                      />
                    </td>
                    {/* Remove button */}
                    <td className="cell" style={{ textAlign: 'center' }}>
                      <button className="icon-btn" onClick={() => removeNewRow(idx)} title="Remove row">
                        <Icon name="x" size={14} style={{ color: '#ef4444' }} />
                      </button>
                    </td>
                  </tr>
                ))}

                {/* Existing data rows */}
                {loading ? (
                  <tr><td colSpan={COLUMNS.length + 1} style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>Loading...</td></tr>
                ) : rows.length === 0 && newRows.length === 0 ? (
                  <tr><td colSpan={COLUMNS.length + 1} style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>No entries. Click "Add Row" or paste from Excel.</td></tr>
                ) : rows.map(row => {
                  const isEditing = (colKey) => editingCell?.rowId === row.id && editingCell?.colKey === colKey;
                  const [yr] = (row.scheduleMonth || '').split('-');

                  return (
                    <tr key={row.id} className={row.isDeleted ? 'deleted-row' : ''}>
                      {/* Group */}
                      <td className="cell cell-readonly">{metadata.groupHeadName || '-'}</td>
                      {/* Year */}
                      <td className="cell cell-readonly">{yr || '-'}</td>
                      {/* RO Number */}
                      <td className="cell cell-click" onDoubleClick={() => startEdit(row.id, 'roNumber', row.roNumber)}>
                        {isEditing('roNumber') ? (
                          <input className="cell-input" autoFocus value={editValue} onChange={e => setEditValue(e.target.value)} onKeyDown={handleEditKeyDown} onBlur={commitEdit} />
                        ) : (
                          <span>{row.roNumber || '-'}</span>
                        )}
                      </td>
                      {/* Schedule Month */}
                      <td className="cell cell-click" onDoubleClick={() => startEdit(row.id, 'scheduleMonth', row.scheduleMonth)}>
                        {isEditing('scheduleMonth') ? (
                          <input className="cell-input" type="month" autoFocus value={editValue} onChange={e => setEditValue(e.target.value)} onKeyDown={handleEditKeyDown} onBlur={commitEdit} />
                        ) : (
                          <span>{fmtMonth(row.scheduleMonth)}</span>
                        )}
                      </td>
                      {/* Invoice Month */}
                      <td className="cell cell-readonly">{fmtMonth(row.invoiceMonth)}</td>
                      {/* Client */}
                      <td className="cell cell-readonly">{clientName}</td>
                      {/* Brand */}
                      <td className="cell cell-click" onDoubleClick={() => startEdit(row.id, 'brandName', row.brandName || '')}>
                        {isEditing('brandName') ? (
                          <>
                            <input className="cell-input" list="brand-edit-list" autoFocus value={editValue} onChange={e => setEditValue(e.target.value)} onKeyDown={handleEditKeyDown} onBlur={commitEdit} />
                            <datalist id="brand-edit-list">
                              {brandSuggestions.map(b => <option key={b} value={b} />)}
                            </datalist>
                          </>
                        ) : (
                          <span>{row.brandName || '-'}</span>
                        )}
                      </td>
                      {/* Medium */}
                      <td className="cell cell-readonly">
                        <span className="medium-tag" data-medium={row.medium}>{row.medium || '-'}</span>
                      </td>
                      {/* Media Group */}
                      <td className="cell cell-readonly">{row.mediaGroup || '-'}</td>
                      {/* Channel */}
                      <td className="cell cell-click" onDoubleClick={() => startEdit(row.id, 'channelMasterId', String(row.channelMasterId))}>
                        {isEditing('channelMasterId') ? (
                          <select className="cell-input cell-select" autoFocus value={editValue} onChange={e => { setEditValue(e.target.value); }} onKeyDown={handleEditKeyDown} onBlur={commitEdit}>
                            <option value="">Select...</option>
                            {channelMasters.filter(c => c.isActive !== false).map(cm => (
                              <option key={cm.id} value={cm.id}>{cm.name}</option>
                            ))}
                          </select>
                        ) : (
                          <span>{row.channelMaster?.name || '-'}</span>
                        )}
                      </td>
                      {/* Schedule Value */}
                      <td className="cell cell-click" style={{ textAlign: 'right' }} onDoubleClick={() => startEdit(row.id, 'scheduleValue', row.scheduleValue)}>
                        {isEditing('scheduleValue') ? (
                          <input className="cell-input" type="number" step="0.01" autoFocus value={editValue} onChange={e => setEditValue(e.target.value)} onKeyDown={handleEditKeyDown} onBlur={commitEdit} style={{ textAlign: 'right' }} />
                        ) : (
                          <span className="mono">{fmtLKR(row.scheduleValue)}</span>
                        )}
                      </td>
                      {/* Actions */}
                      {canWrite && (
                        <td className="cell" style={{ textAlign: 'center' }}>
                          {!row.isDeleted && (
                            <button className="icon-btn" onClick={() => handleDelete(row.id)} title="Delete">
                              <Icon name="trash" size={13} style={{ color: '#ef4444' }} />
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              {rows.length > 0 && (
                <tfoot>
                  <tr>
                    <td colSpan={10} style={{ fontWeight: 700 }}>Total ({total} entries)</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }} className="mono">{fmtLKR(grandTotal)}</td>
                    {canWrite && <td></td>}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 14 }}>
              <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</button>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>Page {page} of {totalPages}</span>
              <button className="btn btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
