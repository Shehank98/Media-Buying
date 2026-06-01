import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Icon from '../components/Icon';
import api from '../lib/api';

const fmtLKR = (v) => {
  if (v == null) return '-';
  return 'LKR ' + Math.round(Number(v)).toLocaleString('en-US');
};

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function monthLabel(ym) {
  if (!ym) return '-';
  const [y, m] = ym.split('-');
  return `${MONTHS[parseInt(m) - 1]} ${y}`;
}

function nextMonth(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  const d = new Date(parseInt(y), parseInt(m), 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function MediumBadge({ medium }) {
  const colors = { TV: ['#1e3a5f','#dbeafe'], RADIO: ['#E85D24','#fff5f0'], PRINT: ['#059669','#ecfdf5'] };
  const [fg, bg] = colors[medium] || ['#6b7280','#f3f4f6'];
  return <span style={{ background: bg, color: fg, borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>{medium}</span>;
}

export default function DatabasePage() {
  const { user } = useAuth();
  const role = user?.role;
  const isSuperAdmin = role === 'SUPER_ADMIN';
  const canWrite = ['SUPER_ADMIN', 'GROUP_HEAD', 'PLANNER'].includes(role);

  // Filters
  const [agencies, setAgencies] = useState([]);
  const [clients, setClients] = useState([]);
  const [selectedAgencyId, setSelectedAgencyId] = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [brands, setBrands] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [channelMasters, setChannelMasters] = useState([]);

  // Table state
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');
  const [filterMonth, setFilterMonth] = useState('');
  const [filterBrand, setFilterBrand] = useState('');
  const [filterCampaign, setFilterCampaign] = useState('');
  const [filterChannel, setFilterChannel] = useState('');
  const [filterMedium, setFilterMedium] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);

  // Modal state
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [editNote, setEditNote] = useState('');
  const [dupWarning, setDupWarning] = useState('');

  // Delete
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  // Edit history
  const [showHistory, setShowHistory] = useState(false);
  const [historyItems, setHistoryItems] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

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

  // Load brands when client changes
  useEffect(() => {
    if (!selectedClientId) { setBrands([]); setCampaigns([]); return; }
    api.get(`/brands/client/${selectedClientId}`).then(r => {
      const list = r.data.brands || r.data || [];
      setBrands(Array.isArray(list) ? list : []);
    }).catch(() => setBrands([]));
  }, [selectedClientId]);

  // Load campaigns when brand filter changes
  useEffect(() => {
    if (!filterBrand) { setCampaigns([]); return; }
    api.get(`/brands/${filterBrand}/campaigns`).then(r => {
      const list = r.data.campaigns || r.data || [];
      setCampaigns(Array.isArray(list) ? list : []);
    }).catch(() => setCampaigns([]));
  }, [filterBrand]);

  // Fetch schedule logs
  const fetchLogs = useCallback(async () => {
    if (!selectedClientId) return;
    setLoading(true);
    try {
      const params = { clientId: selectedClientId, page, limit, sort: sortField, order: sortOrder };
      if (search) params.search = search;
      if (filterMonth) params.monthFrom = filterMonth;
      if (filterBrand) params.brandId = filterBrand;
      if (filterCampaign) params.campaignId = filterCampaign;
      if (filterChannel) params.channelMasterId = filterChannel;
      if (filterMedium) params.medium = filterMedium;
      if (showDeleted && isSuperAdmin) params.showDeleted = 'true';
      const { data } = await api.get('/database', { params });
      setLogs(data.items || []);
      setTotal(data.total || 0);
    } catch { setLogs([]); setTotal(0); }
    setLoading(false);
  }, [selectedClientId, page, limit, sortField, sortOrder, search, filterMonth, filterBrand, filterCampaign, filterChannel, filterMedium, showDeleted, isSuperAdmin]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const totalPages = Math.ceil(total / limit);

  // Sort handler
  const handleSort = (field) => {
    if (sortField === field) {
      setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
    setPage(1);
  };

  const SortIcon = ({ field }) => {
    if (sortField !== field) return null;
    return <Icon name={sortOrder === 'asc' ? 'arrowUp' : 'chevDown'} size={12} />;
  };

  // Open add form
  const openAdd = () => {
    setEditing(null);
    setForm({
      roNumber: '',
      scheduleMonth: '',
      brandId: '',
      campaignId: '',
      channelMasterId: '',
      scheduleValue: '',
    });
    setEditNote('');
    setFormError('');
    setDupWarning('');
    setShowForm(true);
  };

  // Open edit form
  const openEdit = (log) => {
    setEditing(log);
    setForm({
      roNumber: log.roNumber,
      scheduleMonth: log.scheduleMonth,
      brandId: String(log.brandId),
      campaignId: String(log.campaignId),
      channelMasterId: String(log.channelMasterId),
      scheduleValue: String(log.scheduleValue),
    });
    setEditNote('');
    setFormError('');
    setDupWarning('');
    setShowForm(true);
  };

  // Form brand campaigns
  const [formCampaigns, setFormCampaigns] = useState([]);
  useEffect(() => {
    if (!form.brandId) { setFormCampaigns([]); return; }
    api.get(`/brands/${form.brandId}/campaigns`).then(r => {
      const list = r.data.campaigns || r.data || [];
      setFormCampaigns(Array.isArray(list) ? list : []);
    }).catch(() => setFormCampaigns([]));
  }, [form.brandId]);

  // Check duplicate RO
  useEffect(() => {
    if (!form.roNumber || !form.scheduleMonth || !selectedClientId) { setDupWarning(''); return; }
    const exists = logs.some(l => l.roNumber === form.roNumber && l.scheduleMonth === form.scheduleMonth && l.id !== editing?.id);
    setDupWarning(exists ? 'An entry with this RO number already exists for this client and month. Check before saving.' : '');
  }, [form.roNumber, form.scheduleMonth, selectedClientId, logs, editing]);

  // Submit form
  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.roNumber || !form.scheduleMonth || !form.brandId || !form.campaignId || !form.channelMasterId || !form.scheduleValue) {
      setFormError('All fields are required');
      return;
    }
    if (Number(form.scheduleValue) <= 0) {
      setFormError('Schedule Value must be a positive number');
      return;
    }
    if (editing && !editNote.trim()) {
      setFormError('Edit note is required when updating');
      return;
    }
    setSubmitting(true);
    try {
      if (editing) {
        await api.put(`/database/${editing.id}`, {
          ...form,
          brandId: parseInt(form.brandId),
          campaignId: parseInt(form.campaignId),
          channelMasterId: parseInt(form.channelMasterId),
          scheduleValue: parseFloat(form.scheduleValue),
          editNote: editNote.trim(),
        });
      } else {
        await api.post('/database', {
          clientId: parseInt(selectedClientId),
          ...form,
          brandId: parseInt(form.brandId),
          campaignId: parseInt(form.campaignId),
          channelMasterId: parseInt(form.channelMasterId),
          scheduleValue: parseFloat(form.scheduleValue),
        });
      }
      setShowForm(false);
      fetchLogs();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to save');
    }
    setSubmitting(false);
  };

  // Delete handler
  const confirmDelete = (id) => { setDeletingId(id); setShowDeleteConfirm(true); };
  const handleDelete = async () => {
    try {
      await api.delete(`/database/${deletingId}`);
      setShowDeleteConfirm(false);
      fetchLogs();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete');
    }
  };

  // View edit history
  const viewHistory = async (logId) => {
    setHistoryLoading(true);
    setShowHistory(true);
    try {
      const { data } = await api.get(`/database/${logId}/edits`);
      setHistoryItems(data.edits || data || []);
    } catch { setHistoryItems([]); }
    setHistoryLoading(false);
  };

  // Resolved channel info
  const selectedChannel = channelMasters.find(c => String(c.id) === String(form.channelMasterId));
  const vatPreview = form.scheduleValue ? (parseFloat(form.scheduleValue) * 1.18) : 0;
  const invoiceMonthPreview = form.scheduleMonth ? nextMonth(form.scheduleMonth) : '';

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Database - Schedule Logs</h1>
      </div>

      {/* Filter Bar */}
      <div className="card" style={{ marginBottom: 16, padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <select className="input" style={{ width: 180 }} value={selectedAgencyId} onChange={e => { setSelectedAgencyId(e.target.value); setPage(1); }}>
            <option value="">Select Agency</option>
            {agencies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select className="input" style={{ width: 200 }} value={selectedClientId} onChange={e => { setSelectedClientId(e.target.value); setPage(1); }} disabled={!selectedAgencyId}>
            <option value="">Select Client</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {selectedClientId && (
            <>
              <div style={{ width: 1, height: 28, background: 'var(--border)' }} />
              <input className="input" style={{ width: 140 }} type="month" placeholder="Month" value={filterMonth} onChange={e => { setFilterMonth(e.target.value); setPage(1); }} />
              <select className="input" style={{ width: 140 }} value={filterBrand} onChange={e => { setFilterBrand(e.target.value); setPage(1); }}>
                <option value="">All Brands</option>
                {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <select className="input" style={{ width: 140 }} value={filterMedium} onChange={e => { setFilterMedium(e.target.value); setPage(1); }}>
                <option value="">All Media</option>
                <option value="TV">TV</option>
                <option value="RADIO">Radio</option>
                <option value="PRINT">Print</option>
              </select>
              <input className="input" style={{ flex: 1, minWidth: 120 }} placeholder="Search RO, channel..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
            </>
          )}
        </div>
      </div>

      {!selectedClientId ? (
        <div className="card" style={{ padding: 60, textAlign: 'center', color: 'var(--muted)' }}>
          <Icon name="database" size={48} style={{ opacity: 0.3, marginBottom: 12 }} />
          <div style={{ fontSize: 16, fontWeight: 600 }}>Select an agency and client to view schedule logs</div>
        </div>
      ) : (
        <>
          {/* Action bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              {total} entries {showDeleted && isSuperAdmin ? '(including deleted)' : ''}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {isSuperAdmin && (
                <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, color: 'var(--muted)' }}>
                  <input type="checkbox" checked={showDeleted} onChange={e => setShowDeleted(e.target.checked)} /> Show deleted
                </label>
              )}
              <select className="input" style={{ width: 80, fontSize: 12 }} value={limit} onChange={e => { setLimit(Number(e.target.value)); setPage(1); }}>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
              </select>
              {canWrite && (
                <button className="btn btn-primary" onClick={openAdd}>
                  <Icon name="plus" size={14} /> Add Entry
                </button>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="card" style={{ overflow: 'auto' }}>
            <table className="table" style={{ minWidth: 1100 }}>
              <thead>
                <tr>
                  <th onClick={() => handleSort('roNumber')} style={{ cursor: 'pointer' }}>RO # <SortIcon field="roNumber" /></th>
                  <th onClick={() => handleSort('scheduleMonth')} style={{ cursor: 'pointer' }}>Sch Month <SortIcon field="scheduleMonth" /></th>
                  <th>Inv Month</th>
                  <th onClick={() => handleSort('brandId')} style={{ cursor: 'pointer' }}>Brand <SortIcon field="brandId" /></th>
                  <th>Campaign</th>
                  <th onClick={() => handleSort('channelMasterId')} style={{ cursor: 'pointer' }}>Channel <SortIcon field="channelMasterId" /></th>
                  <th>Medium</th>
                  <th>Media Group</th>
                  <th onClick={() => handleSort('scheduleValue')} style={{ cursor: 'pointer', textAlign: 'right' }}>Value <SortIcon field="scheduleValue" /></th>
                  <th style={{ textAlign: 'right' }}>+VAT</th>
                  <th>By</th>
                  <th>Type</th>
                  <th style={{ width: 80 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={13} style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>Loading...</td></tr>
                ) : logs.length === 0 ? (
                  <tr><td colSpan={13} style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>No entries found</td></tr>
                ) : logs.map(log => (
                  <tr key={log.id} style={log.isDeleted ? { opacity: 0.5, textDecoration: 'line-through' } : {}}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{log.roNumber}</td>
                    <td>{monthLabel(log.scheduleMonth)}</td>
                    <td>{monthLabel(log.invoiceMonth)}</td>
                    <td>{log.brand?.name || '-'}</td>
                    <td>{log.campaign?.name || '-'}</td>
                    <td>{log.channelMaster?.name || '-'}</td>
                    <td><MediumBadge medium={log.medium} /></td>
                    <td style={{ fontSize: 12 }}>{log.mediaGroup}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{fmtLKR(log.scheduleValue)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)' }}>{fmtLKR(log.scheduleValueWithVat)}</td>
                    <td style={{ fontSize: 12 }}>{log.uploader?.name?.split(' ')[0] || '-'}</td>
                    <td><span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: log.uploadBatchId ? '#f0f4ff' : '#f0fdf4', color: log.uploadBatchId ? '#3b82f6' : '#059669' }}>{log.uploadBatchId ? 'Upload' : 'Manual'}</span></td>
                    <td>
                      {!log.isDeleted && (
                        <div style={{ display: 'flex', gap: 4 }}>
                          {canWrite && <button className="icon-btn" title="Edit" onClick={() => openEdit(log)}><Icon name="edit" size={14} /></button>}
                          {canWrite && <button className="icon-btn" title="Delete" onClick={() => confirmDelete(log.id)}><Icon name="trash" size={14} style={{ color: '#ef4444' }} /></button>}
                          <button className="icon-btn" title="History" onClick={() => viewHistory(log.id)}><Icon name="clock" size={14} /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 16 }}>
              <button className="btn" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</button>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>Page {page} of {totalPages}</span>
              <button className="btn" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
            </div>
          )}
        </>
      )}

      {/* Add/Edit Modal */}
      {showForm && (
        <div className="modal-scrim show" onClick={() => setShowForm(false)}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editing ? 'Edit Entry' : 'Add Schedule Entry'}</h3>
              <button className="icon-btn" onClick={() => setShowForm(false)}><Icon name="x" size={18} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* Read-only context */}
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label className="label">Client</label>
                    <div className="input" style={{ background: 'var(--bg-sunken)' }}>{clients.find(c => String(c.id) === selectedClientId)?.name || '-'}</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label className="label">Year</label>
                    <div className="input" style={{ background: 'var(--bg-sunken)' }}>{new Date().getFullYear()}</div>
                  </div>
                </div>

                {/* RO Number */}
                <div>
                  <label className="label">RO Number *</label>
                  <input className="input" value={form.roNumber} onChange={e => setForm(f => ({ ...f, roNumber: e.target.value }))} placeholder="Enter RO number" />
                  {dupWarning && <div style={{ fontSize: 12, color: '#d97706', marginTop: 4 }}>{dupWarning}</div>}
                </div>

                {/* Schedule Month */}
                <div>
                  <label className="label">Schedule Month *</label>
                  <input className="input" type="month" value={form.scheduleMonth} onChange={e => setForm(f => ({ ...f, scheduleMonth: e.target.value }))} />
                  {invoiceMonthPreview && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Invoice Month: {monthLabel(invoiceMonthPreview)}</div>}
                </div>

                {/* Brand */}
                <div>
                  <label className="label">Brand *</label>
                  <select className="input" value={form.brandId} onChange={e => setForm(f => ({ ...f, brandId: e.target.value, campaignId: '' }))}>
                    <option value="">Select brand</option>
                    {brands.filter(b => b.active !== false).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>

                {/* Campaign */}
                <div>
                  <label className="label">Campaign *</label>
                  <select className="input" value={form.campaignId} onChange={e => setForm(f => ({ ...f, campaignId: e.target.value }))} disabled={!form.brandId}>
                    <option value="">Select campaign</option>
                    {formCampaigns.filter(c => c.active !== false).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>

                {/* Channel */}
                <div>
                  <label className="label">Channel *</label>
                  <select className="input" value={form.channelMasterId} onChange={e => setForm(f => ({ ...f, channelMasterId: e.target.value }))}>
                    <option value="">Select channel</option>
                    {channelMasters.filter(c => c.isActive !== false).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  {selectedChannel && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                      <MediumBadge medium={selectedChannel.medium} />
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{selectedChannel.mediaGroup?.name || ''}</span>
                    </div>
                  )}
                </div>

                {/* Schedule Value */}
                <div>
                  <label className="label">Schedule Value (LKR) *</label>
                  <input className="input" type="number" step="0.01" min="0" value={form.scheduleValue} onChange={e => setForm(f => ({ ...f, scheduleValue: e.target.value }))} placeholder="0.00" />
                  {vatPreview > 0 && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>+18% VAT: {fmtLKR(vatPreview)}</div>}
                </div>

                {/* Edit Note (only for edits) */}
                {editing && (
                  <div>
                    <label className="label">Edit Note (required) *</label>
                    <input className="input" value={editNote} onChange={e => setEditNote(e.target.value)} placeholder="Reason for this edit" />
                  </div>
                )}

                {formError && <div style={{ color: '#ef4444', fontSize: 13 }}>{formError}</div>}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Saving...' : editing ? 'Update Entry' : 'Save Entry'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {showDeleteConfirm && (
        <div className="modal-scrim show" onClick={() => setShowDeleteConfirm(false)}>
          <div className="modal" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>Delete Entry</h3></div>
            <div className="modal-body">
              <p>This will remove this entry from all reports. This action can only be undone by an admin.</p>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
              <button className="btn" style={{ background: '#ef4444', color: '#fff' }} onClick={handleDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit History Modal */}
      {showHistory && (
        <div className="modal-scrim show" onClick={() => setShowHistory(false)}>
          <div className="modal" style={{ maxWidth: 550 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Edit History</h3>
              <button className="icon-btn" onClick={() => setShowHistory(false)}><Icon name="x" size={18} /></button>
            </div>
            <div className="modal-body">
              {historyLoading ? <div style={{ textAlign: 'center', padding: 20 }}>Loading...</div> :
               historyItems.length === 0 ? <div style={{ textAlign: 'center', padding: 20, color: 'var(--muted)' }}>No edit history</div> :
               historyItems.map((h, i) => (
                <div key={i} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <strong>{h.editor?.name || 'Unknown'}</strong>
                    <span style={{ color: 'var(--muted)' }}>{new Date(h.editedAt).toLocaleString()}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{h.editNote}</div>
                  <div style={{ fontSize: 11, marginTop: 4, display: 'flex', gap: 12 }}>
                    {Object.keys(h.newValues || {}).map(key => (
                      <span key={key}><b>{key}:</b> {String(h.previousValues?.[key])} → {String(h.newValues[key])}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
