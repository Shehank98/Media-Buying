import { useState, useEffect, useCallback, useMemo } from 'react';
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
  const [channelMasters, setChannelMasters] = useState([]);

  // Table state
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState('scheduleMonth');
  const [sortOrder, setSortOrder] = useState('desc');
  const [filterMonth, setFilterMonth] = useState('');
  const [filterMedium, setFilterMedium] = useState('');
  const [filterMediaGroup, setFilterMediaGroup] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);

  // View mode: 'table' or 'summary'
  const [viewMode, setViewMode] = useState('table');

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

  // Fetch schedule logs
  const fetchLogs = useCallback(async () => {
    if (!selectedClientId) return;
    setLoading(true);
    try {
      const params = { clientId: selectedClientId, page, limit, sort: sortField, order: sortOrder };
      if (search) params.search = search;
      if (filterMonth) params.monthFrom = filterMonth;
      if (filterMedium) params.medium = filterMedium;
      if (showDeleted && isSuperAdmin) params.showDeleted = 'true';
      const { data } = await api.get('/database', { params });
      setLogs(data.items || []);
      setTotal(data.total || 0);
    } catch { setLogs([]); setTotal(0); }
    setLoading(false);
  }, [selectedClientId, page, limit, sortField, sortOrder, search, filterMonth, filterMedium, showDeleted, isSuperAdmin]);

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

  const sortArrow = (field) => {
    if (sortField !== field) return '';
    return sortOrder === 'asc' ? ' ↑' : ' ↓';
  };

  // Distinct media groups from current data
  const mediaGroupsInData = useMemo(() => {
    const set = new Set(logs.map(l => l.mediaGroup).filter(Boolean));
    return [...set].sort();
  }, [logs]);

  // Filtered logs (apply media group filter client-side since it's not in API params)
  const filteredLogs = useMemo(() => {
    if (!filterMediaGroup) return logs;
    return logs.filter(l => l.mediaGroup === filterMediaGroup);
  }, [logs, filterMediaGroup]);

  // Budget summaries computed from current page data
  const budgetByMediaGroup = useMemo(() => {
    const map = {};
    for (const log of filteredLogs) {
      const mg = log.mediaGroup || 'Unknown';
      if (!map[mg]) map[mg] = { name: mg, total: 0, count: 0 };
      map[mg].total += Number(log.scheduleValue) || 0;
      map[mg].count++;
    }
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [filteredLogs]);

  const budgetByChannel = useMemo(() => {
    const map = {};
    for (const log of filteredLogs) {
      const ch = log.channelMaster?.name || 'Unknown';
      const mg = log.mediaGroup || '';
      if (!map[ch]) map[ch] = { name: ch, mediaGroup: mg, total: 0, count: 0 };
      map[ch].total += Number(log.scheduleValue) || 0;
      map[ch].count++;
    }
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [filteredLogs]);

  const budgetByMonth = useMemo(() => {
    const map = {};
    for (const log of filteredLogs) {
      const ym = log.scheduleMonth || 'Unknown';
      if (!map[ym]) map[ym] = { month: ym, total: 0, count: 0 };
      map[ym].total += Number(log.scheduleValue) || 0;
      map[ym].count++;
    }
    return Object.values(map).sort((a, b) => a.month.localeCompare(b.month));
  }, [filteredLogs]);

  const grandTotal = useMemo(() => {
    return filteredLogs.reduce((s, l) => s + (Number(l.scheduleValue) || 0), 0);
  }, [filteredLogs]);

  // Open add form
  const openAdd = () => {
    setEditing(null);
    setForm({ roNumber: '', scheduleMonth: '', channelMasterId: '', scheduleValue: '' });
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
      channelMasterId: String(log.channelMasterId),
      scheduleValue: String(log.scheduleValue),
    });
    setEditNote('');
    setFormError('');
    setDupWarning('');
    setShowForm(true);
  };

  // Check duplicate RO
  useEffect(() => {
    if (!form.roNumber || !form.scheduleMonth || !selectedClientId) { setDupWarning(''); return; }
    const exists = logs.some(l => l.roNumber === form.roNumber && l.scheduleMonth === form.scheduleMonth && l.id !== editing?.id);
    setDupWarning(exists ? 'An entry with this RO number already exists for this client and month.' : '');
  }, [form.roNumber, form.scheduleMonth, selectedClientId, logs, editing]);

  // Submit form
  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.roNumber || !form.scheduleMonth || !form.channelMasterId || !form.scheduleValue) {
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
          channelMasterId: parseInt(form.channelMasterId),
          scheduleValue: parseFloat(form.scheduleValue),
          editNote: editNote.trim(),
        });
      } else {
        await api.post('/database', {
          clientId: parseInt(selectedClientId),
          ...form,
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
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h1 className="page-title">Schedule Database</h1>
          <p className="page-sub">Year, Month, Channel, Media Group, Schedule Value</p>
        </div>
        {canWrite && selectedClientId && (
          <button className="btn btn-primary" onClick={openAdd}>
            <Icon name="plus" size={14} /> Add Entry
          </button>
        )}
      </div>

      {/* Filter Bar */}
      <div className="filterbar" style={{ marginBottom: 16 }}>
        <div className="filter-field">
          <label>Agency</label>
          <select className="select" value={selectedAgencyId} onChange={e => { setSelectedAgencyId(e.target.value); setPage(1); }}>
            <option value="">Select Agency</option>
            {agencies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label>Client</label>
          <select className="select" value={selectedClientId} onChange={e => { setSelectedClientId(e.target.value); setPage(1); }} disabled={!selectedAgencyId}>
            <option value="">Select Client</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        {selectedClientId && (
          <>
            <div className="filter-field">
              <label>Month</label>
              <input type="month" className="input" value={filterMonth} onChange={e => { setFilterMonth(e.target.value); setPage(1); }} />
            </div>
            <div className="filter-field">
              <label>Medium</label>
              <select className="select" value={filterMedium} onChange={e => { setFilterMedium(e.target.value); setPage(1); }}>
                <option value="">All</option>
                <option value="TV">TV</option>
                <option value="RADIO">Radio</option>
                <option value="PRINT">Print</option>
              </select>
            </div>
            <div className="filter-field">
              <label>Media Group</label>
              <select className="select" value={filterMediaGroup} onChange={e => setFilterMediaGroup(e.target.value)}>
                <option value="">All</option>
                {mediaGroupsInData.map(mg => <option key={mg} value={mg}>{mg}</option>)}
              </select>
            </div>
            <div className="filter-field">
              <label>Search</label>
              <input className="input" placeholder="RO, channel..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
            </div>
          </>
        )}
      </div>

      {!selectedClientId ? (
        <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--muted)' }}>
          <Icon name="database" size={48} style={{ opacity: 0.2, marginBottom: 12, display: 'inline-block' }} />
          <p style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Select an agency and client to view data</p>
        </div>
      ) : (
        <>
          {/* View toggle + controls */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ display: 'flex', gap: 4, background: 'var(--bg-sunken)', borderRadius: 8, padding: 3 }}>
              {[
                { key: 'table', label: 'Table', icon: 'grid' },
                { key: 'summary', label: 'Budget Summary', icon: 'bar-chart' },
              ].map(v => (
                <button
                  key={v.key}
                  onClick={() => setViewMode(v.key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '6px 12px', borderRadius: 6, border: 'none', fontSize: 13,
                    fontWeight: viewMode === v.key ? 600 : 500,
                    background: viewMode === v.key ? 'var(--card)' : 'transparent',
                    color: viewMode === v.key ? 'var(--coral-600)' : 'var(--muted)',
                    boxShadow: viewMode === v.key ? 'var(--sh-sm)' : 'none',
                    cursor: 'pointer',
                  }}
                >
                  <Icon name={v.icon} size={14} />
                  {v.label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>
                {total} entries
              </span>
              {isSuperAdmin && (
                <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, color: 'var(--muted)' }}>
                  <input type="checkbox" checked={showDeleted} onChange={e => setShowDeleted(e.target.checked)} /> Show deleted
                </label>
              )}
              {viewMode === 'table' && (
                <select className="input" style={{ width: 70, fontSize: 12, padding: '4px 6px' }} value={limit} onChange={e => { setLimit(Number(e.target.value)); setPage(1); }}>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                </select>
              )}
            </div>
          </div>

          {/* ─── Budget Summary View ─── */}
          {viewMode === 'summary' && (
            <div>
              {/* Grand total */}
              <div className="section-card" style={{ padding: '16px 20px', marginBottom: 20 }}>
                <div className="stat">
                  <div className="stat-top">
                    <span className="stat-label">Total Budget Allocation</span>
                    <span className="stat-ico" style={{ color: 'var(--green-600)' }}><Icon name="bar-chart" size={18} /></span>
                  </div>
                  <div className="stat-val mono">{fmtLKR(grandTotal)}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{filteredLogs.length} entries</div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                {/* Budget by Media Group */}
                <div className="section-card" style={{ padding: 0, overflow: 'hidden' }}>
                  <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 14 }}>
                    Budget by Media Group
                  </div>
                  <div style={{ maxHeight: 320, overflow: 'auto' }}>
                    <table className="tbl" style={{ margin: 0 }}>
                      <thead>
                        <tr>
                          <th>Media Group</th>
                          <th style={{ textAlign: 'right' }}>Entries</th>
                          <th style={{ textAlign: 'right' }}>Schedule Value</th>
                          <th style={{ textAlign: 'right' }}>% Share</th>
                        </tr>
                      </thead>
                      <tbody>
                        {budgetByMediaGroup.map(mg => (
                          <tr key={mg.name}>
                            <td className="strong">{mg.name}</td>
                            <td style={{ textAlign: 'right' }}>{mg.count}</td>
                            <td className="mono" style={{ textAlign: 'right' }}>{fmtLKR(mg.total)}</td>
                            <td className="mono" style={{ textAlign: 'right', color: 'var(--muted)' }}>
                              {grandTotal > 0 ? ((mg.total / grandTotal) * 100).toFixed(1) + '%' : '-'}
                            </td>
                          </tr>
                        ))}
                        {budgetByMediaGroup.length === 0 && (
                          <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--muted)', padding: 20 }}>No data</td></tr>
                        )}
                      </tbody>
                      {budgetByMediaGroup.length > 0 && (
                        <tfoot>
                          <tr>
                            <td className="strong">Total</td>
                            <td style={{ textAlign: 'right', fontWeight: 700 }}>{filteredLogs.length}</td>
                            <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{fmtLKR(grandTotal)}</td>
                            <td />
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </div>

                {/* Budget by Month */}
                <div className="section-card" style={{ padding: 0, overflow: 'hidden' }}>
                  <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 14 }}>
                    Budget by Month
                  </div>
                  <div style={{ maxHeight: 320, overflow: 'auto' }}>
                    <table className="tbl" style={{ margin: 0 }}>
                      <thead>
                        <tr>
                          <th>Month</th>
                          <th style={{ textAlign: 'right' }}>Entries</th>
                          <th style={{ textAlign: 'right' }}>Schedule Value</th>
                          <th style={{ textAlign: 'right' }}>% Share</th>
                        </tr>
                      </thead>
                      <tbody>
                        {budgetByMonth.map(bm => (
                          <tr key={bm.month}>
                            <td className="strong">{monthLabel(bm.month)}</td>
                            <td style={{ textAlign: 'right' }}>{bm.count}</td>
                            <td className="mono" style={{ textAlign: 'right' }}>{fmtLKR(bm.total)}</td>
                            <td className="mono" style={{ textAlign: 'right', color: 'var(--muted)' }}>
                              {grandTotal > 0 ? ((bm.total / grandTotal) * 100).toFixed(1) + '%' : '-'}
                            </td>
                          </tr>
                        ))}
                        {budgetByMonth.length === 0 && (
                          <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--muted)', padding: 20 }}>No data</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Budget by Channel - full width */}
              <div className="section-card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 14 }}>
                  Budget by Channel
                </div>
                <div style={{ maxHeight: 400, overflow: 'auto' }}>
                  <table className="tbl" style={{ margin: 0 }}>
                    <thead>
                      <tr>
                        <th>Channel</th>
                        <th>Media Group</th>
                        <th style={{ textAlign: 'right' }}>Entries</th>
                        <th style={{ textAlign: 'right' }}>Schedule Value</th>
                        <th style={{ textAlign: 'right' }}>% Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {budgetByChannel.map(ch => (
                        <tr key={ch.name}>
                          <td className="strong">{ch.name}</td>
                          <td style={{ color: 'var(--muted)', fontSize: 13 }}>{ch.mediaGroup}</td>
                          <td style={{ textAlign: 'right' }}>{ch.count}</td>
                          <td className="mono" style={{ textAlign: 'right' }}>{fmtLKR(ch.total)}</td>
                          <td className="mono" style={{ textAlign: 'right', color: 'var(--muted)' }}>
                            {grandTotal > 0 ? ((ch.total / grandTotal) * 100).toFixed(1) + '%' : '-'}
                          </td>
                        </tr>
                      ))}
                      {budgetByChannel.length === 0 && (
                        <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)', padding: 20 }}>No data</td></tr>
                      )}
                    </tbody>
                    {budgetByChannel.length > 0 && (
                      <tfoot>
                        <tr>
                          <td className="strong" colSpan={2}>Total</td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>{filteredLogs.length}</td>
                          <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{fmtLKR(grandTotal)}</td>
                          <td />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ─── Table View ─── */}
          {viewMode === 'table' && (
            <>
              {loading ? (
                <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)' }}>
                  <Icon name="clock" size={28} style={{ opacity: 0.3, marginBottom: 8, display: 'inline-block' }} />
                  <p style={{ margin: 0, fontSize: 14 }}>Loading...</p>
                </div>
              ) : filteredLogs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)' }}>
                  <Icon name="database" size={36} style={{ opacity: 0.2, marginBottom: 8, display: 'inline-block' }} />
                  <p style={{ margin: 0, fontSize: 14 }}>No entries found</p>
                </div>
              ) : (
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th onClick={() => handleSort('scheduleMonth')} style={{ cursor: 'pointer' }}>
                          Year{sortArrow('scheduleMonth')}
                        </th>
                        <th onClick={() => handleSort('scheduleMonth')} style={{ cursor: 'pointer' }}>
                          Month{sortArrow('scheduleMonth')}
                        </th>
                        <th onClick={() => handleSort('channelMasterId')} style={{ cursor: 'pointer' }}>
                          Channel{sortArrow('channelMasterId')}
                        </th>
                        <th>Media Group</th>
                        <th onClick={() => handleSort('scheduleValue')} style={{ cursor: 'pointer', textAlign: 'right' }}>
                          Schedule Value{sortArrow('scheduleValue')}
                        </th>
                        <th>Medium</th>
                        <th onClick={() => handleSort('roNumber')} style={{ cursor: 'pointer' }}>
                          RO #{sortArrow('roNumber')}
                        </th>
                        <th style={{ width: 80 }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLogs.map(log => {
                        const [year, monthNum] = (log.scheduleMonth || '').split('-');
                        return (
                          <tr key={log.id} style={log.isDeleted ? { opacity: 0.5, textDecoration: 'line-through' } : {}}>
                            <td className="mono" style={{ fontWeight: 600 }}>{year || '-'}</td>
                            <td>{monthNum ? MONTHS[parseInt(monthNum) - 1] : '-'}</td>
                            <td className="strong">{log.channelMaster?.name || '-'}</td>
                            <td style={{ fontSize: 13, color: 'var(--muted)' }}>{log.mediaGroup || '-'}</td>
                            <td className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>
                              {fmtLKR(log.scheduleValue)}
                            </td>
                            <td><MediumBadge medium={log.medium} /></td>
                            <td className="mono" style={{ fontSize: 12 }}>{log.roNumber || '-'}</td>
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
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td className="strong" colSpan={4}>
                          Total - {filteredLogs.length} entries
                        </td>
                        <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>
                          {fmtLKR(grandTotal)}
                        </td>
                        <td colSpan={3} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

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
        </>
      )}

      {/* Add/Edit Modal */}
      {showForm && (
        <div className="modal-scrim show" onClick={() => setShowForm(false)}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{editing ? 'Edit Entry' : 'Add Schedule Entry'}</h2>
              <button className="act-btn" onClick={() => setShowForm(false)}><Icon name="x" size={18} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label className="field-label">Client</label>
                    <div className="input" style={{ background: 'var(--bg-sunken)' }}>{clients.find(c => String(c.id) === selectedClientId)?.name || '-'}</div>
                  </div>
                </div>

                <div>
                  <label className="field-label">RO Number <span className="req">*</span></label>
                  <input className="input" value={form.roNumber} onChange={e => setForm(f => ({ ...f, roNumber: e.target.value }))} placeholder="Enter RO number" />
                  {dupWarning && <div style={{ fontSize: 12, color: '#d97706', marginTop: 4 }}>{dupWarning}</div>}
                </div>

                <div>
                  <label className="field-label">Schedule Month <span className="req">*</span></label>
                  <input className="input" type="month" value={form.scheduleMonth} onChange={e => setForm(f => ({ ...f, scheduleMonth: e.target.value }))} />
                  {invoiceMonthPreview && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Invoice Month: {monthLabel(invoiceMonthPreview)}</div>}
                </div>

                <div>
                  <label className="field-label">Channel <span className="req">*</span></label>
                  <select className="select" value={form.channelMasterId} onChange={e => setForm(f => ({ ...f, channelMasterId: e.target.value }))}>
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

                <div>
                  <label className="field-label">Schedule Value (LKR) <span className="req">*</span></label>
                  <input className="input" type="number" step="0.01" min="0" value={form.scheduleValue} onChange={e => setForm(f => ({ ...f, scheduleValue: e.target.value }))} placeholder="0.00" />
                  {vatPreview > 0 && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>+18% VAT: {fmtLKR(vatPreview)}</div>}
                </div>

                {editing && (
                  <div>
                    <label className="field-label">Edit Note (required) <span className="req">*</span></label>
                    <input className="input" value={editNote} onChange={e => setEditNote(e.target.value)} placeholder="Reason for this edit" />
                  </div>
                )}

                {formError && <div style={{ color: '#ef4444', fontSize: 13 }}>{formError}</div>}
              </div>
              <div className="modal-foot">
                <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
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
            <div className="modal-head"><h2>Delete Entry</h2></div>
            <div className="modal-body">
              <p style={{ color: 'var(--muted)' }}>This will remove this entry from all reports. This action can only be undone by an admin.</p>
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
              <button className="btn" style={{ background: '#ef4444', color: '#fff' }} onClick={handleDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit History Modal */}
      {showHistory && (
        <div className="modal-scrim show" onClick={() => setShowHistory(false)}>
          <div className="modal" style={{ maxWidth: 550 }} onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Edit History</h2>
              <button className="act-btn" onClick={() => setShowHistory(false)}><Icon name="x" size={18} /></button>
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
