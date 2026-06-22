import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Icon from '../components/Icon';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import OrbitLoader from '../components/OrbitLoader';

const CHANNEL_TABS = [
  { key: 'TV', label: 'TV Channels', icon: 'tv' },
  { key: 'RADIO', label: 'Radio Channels', icon: 'radio' },
  { key: 'PRINT', label: 'Print', icon: 'print' },
  { key: 'DIGITAL', label: 'Digital', icon: 'digital' },
];
const TAB_COLORS = {
  TV:    { bg: 'var(--blue-50,#EFF6FF)',  fg: 'var(--blue-700,#1D4ED8)' },
  RADIO: { bg: 'var(--coral-50,#FFF5F0)', fg: 'var(--coral-600,#D4541E)' },
  PRINT: { bg: 'var(--green-50,#ECFDF5)', fg: 'var(--green-600,#059669)' },
  DIGITAL: { bg: '#efe9fb', fg: '#6B3FB5' },
};

const fmtLKR = (v) => {
  if (v == null || v === '') return '-';
  const n = Number(v); const a = Math.abs(n);
  if (a >= 1e9) return 'LKR ' + (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return 'LKR ' + (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return 'LKR ' + (n / 1e3).toFixed(1) + 'K';
  return 'LKR ' + Math.round(n).toLocaleString('en-US');
};
const fmtMonth = ym => {
  if (!ym) return '-';
  const s = typeof ym === 'string' ? ym.slice(0, 7) : '';
  if (!s) return '-';
  const [y, m] = s.split('-');
  return new Date(+y, +m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
};
const canWrite = r => ['PLANNER', 'GROUP_HEAD', 'SUPER_ADMIN'].includes(r);

export default function ClientDetailPage() {
  const { clientId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [client, setClient] = useState(null);
  const [channels, setChannels] = useState([]);
  const [activeTab, setActiveTab] = useState('TV');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  // Add channel modal
  const [showChModal, setShowChModal] = useState(false);
  const [chForm, setChForm] = useState({ channelMasterId: '' });
  const [chSubmitting, setChSubmitting] = useState(false);
  const [chError, setChError] = useState('');

  // Schedule log state
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [channelMasters, setChannelMasters] = useState([]);
  const [logYear, setLogYear] = useState(String(new Date().getFullYear()));
  const [logMonth, setLogMonth] = useState('');
  const [logChannelFilter, setLogChannelFilter] = useState('');

  // Add/Edit log modal
  const [showLogModal, setShowLogModal] = useState(false);
  const [editingLog, setEditingLog] = useState(null);
  const [logForm, setLogForm] = useState({
    channelMasterId: '', scheduleMonth: '',
    scheduleValue: '', roNumber: '',
  });
  const [logSubmitting, setLogSubmitting] = useState(false);
  const [logError, setLogError] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [clientRes, channelsRes] = await Promise.all([
          api.get(`/clients/${clientId}`),
          api.get(`/clients/${clientId}/channels`),
        ]);
        setClient(clientRes.data.client || clientRes.data);
        const rawCh = channelsRes.data.channels || channelsRes.data;
        setChannels(Array.isArray(rawCh) ? rawCh : []);
      } catch { setError('Failed to load client details.'); }
      finally { setLoading(false); }
    };
    fetchData();
  }, [clientId, refreshKey]);

  // Load channel masters (needed by the Add Channel form on TV/Radio/Print tabs
  // AND the schedule-log form) — load regardless of which tab is active.
  useEffect(() => {
    const load = async () => {
      try {
        const cmRes = await api.get('/masterdata/channel-masters');
        setChannelMasters(Array.isArray(cmRes.data.channelMasters) ? cmRes.data.channelMasters : Array.isArray(cmRes.data) ? cmRes.data : []);
      } catch { /* ignore */ }
    };
    load();
  }, [clientId]);

  // Load schedule logs when filters change
  useEffect(() => {
    if (activeTab !== 'SCHEDULE') return;
    const load = async () => {
      setLogsLoading(true);
      try {
        const params = new URLSearchParams();
        if (logYear) params.set('year', logYear);
        if (logMonth) params.set('month', logMonth);
        if (logChannelFilter) params.set('channelMasterId', logChannelFilter);
        const { data } = await api.get(`/schedule-logs/client/${clientId}?${params}`);
        setLogs(Array.isArray(data.logs) ? data.logs : Array.isArray(data) ? data : []);
      } catch { setLogs([]); }
      finally { setLogsLoading(false); }
    };
    load();
  }, [activeTab, clientId, logYear, logMonth, logChannelFilter, refreshKey]);

  const filteredChannels = channels.filter(c => c.type === activeTab);

  const handleAddChannel = async () => {
    setChError('');
    if (!chForm.channelMasterId) { setChError('Please select a channel.'); return; }
    setChSubmitting(true);
    try {
      await api.post(`/clients/${clientId}/channels`, { channelMasterId: parseInt(chForm.channelMasterId) });
      setShowChModal(false);
      setChForm({ channelMasterId: '' });
      setRefreshKey(k => k + 1);
    } catch (err) { setChError(err.response?.data?.error || 'Failed to add channel.'); }
    finally { setChSubmitting(false); }
  };

  const canManageChannels = ['SUPER_ADMIN', 'GROUP_HEAD'].includes(user?.role);
  const handleDeleteChannel = async (ch, e) => {
    e.stopPropagation();
    if (!confirm(`Delete "${ch.name}" from this client? This also removes its properties and history.`)) return;
    try {
      await api.delete(`/clients/channels/${ch.id}`);
      setRefreshKey(k => k + 1);
    } catch (err) { alert(err.response?.data?.error || 'Failed to delete channel.'); }
  };

  const openAddLog = () => {
    setEditingLog(null);
    const now = new Date();
    setLogForm({
      channelMasterId: '',
      scheduleMonth: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
      scheduleValue: '', roNumber: '',
    });
    setLogError('');
    setShowLogModal(true);
  };

  const openEditLog = (log, e) => {
    e.stopPropagation();
    setEditingLog(log);
    setLogForm({
      channelMasterId: String(log.channelMasterId || log.channelMaster?.id || ''),
      scheduleMonth: log.scheduleMonth ? log.scheduleMonth.slice(0, 7) : '',
      scheduleValue: log.scheduleValue != null ? String(Number(log.scheduleValue)) : '',
      roNumber: log.roNumber || '',
    });
    setLogError('');
    setShowLogModal(true);
  };

  const handleLogSubmit = async (e) => {
    e.preventDefault();
    setLogError('');
    if (!logForm.channelMasterId) { setLogError('Channel is required.'); return; }
    if (!logForm.scheduleMonth) { setLogError('Schedule month is required.'); return; }
    if (!logForm.scheduleValue) { setLogError('Schedule value is required.'); return; }

    setLogSubmitting(true);
    try {
      const payload = {
        channelMasterId: parseInt(logForm.channelMasterId),
        scheduleMonth: logForm.scheduleMonth,
        scheduleValue: parseFloat(logForm.scheduleValue),
        roNumber: logForm.roNumber || undefined,
      };

      if (editingLog) {
        await api.put(`/schedule-logs/${editingLog.id}`, payload);
      } else {
        await api.post(`/schedule-logs/client/${clientId}`, payload);
      }
      setShowLogModal(false);
      setRefreshKey(k => k + 1);
    } catch (err) { setLogError(err.response?.data?.error || 'Failed to save log entry.'); }
    finally { setLogSubmitting(false); }
  };

  const handleDeleteLog = async (log, e) => {
    e.stopPropagation();
    if (!confirm('Delete this schedule log entry?')) return;
    try {
      await api.delete(`/schedule-logs/${log.id}`);
      setRefreshKey(k => k + 1);
    } catch { /* ignore */ }
  };

  const logTotals = useMemo(() => {
    return logs.reduce((acc, l) => ({
      scheduleValue: acc.scheduleValue + Number(l.scheduleValue || 0),
      scheduleValueWithVat: acc.scheduleValueWithVat + Number(l.scheduleValueWithVat || 0),
    }), { scheduleValue: 0, scheduleValueWithVat: 0 });
  }, [logs]);

  const years = useMemo(() => {
    const y = new Date().getFullYear();
    return Array.from({ length: 10 }, (_, i) => String(y - i));
  }, []);

  if (loading) return <div className="content-narrow fade-in"><OrbitLoader fullHeight label="Loading client…" /></div>;
  if (error) return <div className="content-narrow fade-in" style={{ padding: '60px 0', textAlign: 'center', color: 'var(--red-600)' }}>{error}</div>;

  const allTabs = [...CHANNEL_TABS, { key: 'SCHEDULE', label: 'Schedule Logs', icon: 'calendar' }];

  return (
    <div className="content-narrow fade-in">
      <div className="page-head">
        <div>
          <h1 className="page-title">{client?.name}</h1>
          <p className="page-sub">{client?.agencyName || 'Agency'}</p>
        </div>
        {activeTab !== 'SCHEDULE' && canWrite(user?.role) && (
          <button className="btn btn-primary" onClick={() => setShowChModal(true)}>
            <Icon name="plus" size={16} />Add channel
          </button>
        )}
        {activeTab === 'SCHEDULE' && canWrite(user?.role) && (
          <button className="btn btn-primary" onClick={openAddLog}>
            <Icon name="plus" size={16} />Add log entry
          </button>
        )}
      </div>

      <div className="tabs">
        {allTabs.map(t => (
          <button key={t.key} className={`tab${activeTab === t.key ? ' active' : ''}`} onClick={() => setActiveTab(t.key)}>
            <Icon name={t.icon} size={16} />{t.label}
            {t.key === 'SCHEDULE'
              ? <span className="tcount">{logs.length}</span>
              : <span className="tcount">{channels.filter(c => c.type === t.key).length}</span>}
          </button>
        ))}
      </div>

      {/* Channel tabs (TV/RADIO/PRINT) */}
      {activeTab !== 'SCHEDULE' && (
        <>
          {filteredChannels.length === 0 ? (
            <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--muted)' }}>
              <Icon name={CHANNEL_TABS.find(t => t.key === activeTab)?.icon || 'tv'} size={40} style={{ color: 'var(--muted-2)', marginBottom: 10 }} />
              <div style={{ fontWeight: 650, color: 'var(--ink)', marginBottom: 4 }}>No {activeTab.toLowerCase()} channels</div>
              <div style={{ fontSize: 13 }}>Add a {activeTab.toLowerCase()} channel to get started.</div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 14 }}>
              {filteredChannels.map(ch => {
                const tc = TAB_COLORS[activeTab] || TAB_COLORS.TV;
                const props = ch.propertyCount || ch._count?.properties || 0;
                return (
                  <div
                    key={ch.id}
                    onClick={() => navigate(`/channels/${ch.id}`)}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = '#C7D0DD'; e.currentTarget.style.boxShadow = '0 10px 26px rgba(15,31,61,.10)'; e.currentTarget.style.transform = 'translateY(-3px)'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = '#E5E8ED'; e.currentTarget.style.boxShadow = '0 1px 2px rgba(15,31,61,.06)'; e.currentTarget.style.transform = 'none'; }}
                    style={{ position: 'relative', overflow: 'hidden', background: '#fff', border: '1px solid #E5E8ED', borderRadius: 13, boxShadow: '0 1px 2px rgba(15,31,61,.06)', padding: 16, cursor: 'pointer', transition: 'transform .16s ease, box-shadow .16s ease, border-color .16s ease' }}
                  >
                    <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${tc.fg}, ${tc.fg}1A 70%, transparent)` }} />
                    {canManageChannels && (
                      <button className="act-btn" title="Remove channel" style={{ position: 'absolute', top: 10, right: 10, color: 'var(--red-600,#dc2626)' }} onClick={e => handleDeleteChannel(ch, e)}>
                        <Icon name="trash" size={14} />
                      </button>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 14, paddingRight: canManageChannels ? 28 : 0 }}>
                      <div style={{ width: 38, height: 38, borderRadius: 11, background: tc.bg, color: tc.fg, display: 'grid', placeItems: 'center', flex: 'none' }}>
                        <Icon name={CHANNEL_TABS.find(t => t.key === activeTab)?.icon || 'tv'} size={18} />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: '#16243C', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={ch.name}>{ch.name}</div>
                        <div style={{ fontSize: 11.5, color: '#93A0B5', marginTop: 1 }}>{ch.type}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#3B4A63' }}>{props} propert{props === 1 ? 'y' : 'ies'}</span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: tc.fg }}>Open <Icon name="chevR" size={13} /></span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Schedule Logs tab */}
      {activeTab === 'SCHEDULE' && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <select className="select" value={logYear} onChange={e => setLogYear(e.target.value)} style={{ flex: '0 0 110px' }}>
              <option value="">All years</option>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <select className="select" value={logMonth} onChange={e => setLogMonth(e.target.value)} style={{ flex: '0 0 130px' }}>
              <option value="">All months</option>
              {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{new Date(2000, i).toLocaleDateString('en-US', { month: 'long' })}</option>)}
            </select>
            <select className="select" value={logChannelFilter} onChange={e => setLogChannelFilter(e.target.value)} style={{ flex: '0 0 160px' }}>
              <option value="">All channels</option>
              {channelMasters.filter(cm => cm.isActive !== false).map(cm => <option key={cm.id} value={cm.id}>{cm.name}</option>)}
            </select>
          </div>

          {logsLoading ? (
            <OrbitLoader label="Loading logs…" />
          ) : logs.length === 0 ? (
            <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--muted)' }}>
              <Icon name="calendar" size={40} style={{ color: 'var(--muted-2)', marginBottom: 10 }} />
              <div style={{ fontWeight: 650, color: 'var(--ink)', marginBottom: 4 }}>No schedule logs</div>
              <div style={{ fontSize: 13 }}>Add a schedule log entry to get started.</div>
            </div>
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr>
                  <th>Month</th><th>Channel</th>
                  <th style={{ textAlign: 'right' }}>Schedule Val</th>
                  <th style={{ textAlign: 'right' }}>With VAT</th>
                  <th>RO#</th><th>Medium</th>
                  {canWrite(user?.role) && <th style={{ width: 80, textAlign: 'right' }}>Actions</th>}
                </tr></thead>
                <tbody>
                  {logs.map(l => (
                    <tr key={l.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtMonth(l.scheduleMonth)}</td>
                      <td className="strong">{l.channelMaster?.name || '-'}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{fmtLKR(l.scheduleValue)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{fmtLKR(l.scheduleValueWithVat)}</td>
                      <td style={{ color: 'var(--muted)', fontSize: 12 }}>{l.roNumber || '-'}</td>
                      <td style={{ fontSize: 12 }}>{l.medium || l.channelMaster?.medium || '-'}</td>
                      {canWrite(user?.role) && (
                        <td>
                          <div className="row-actions">
                            <button className="act-btn" title="Edit" onClick={e => openEditLog(l, e)}><Icon name="edit" size={14} /></button>
                            {(user?.role === 'SUPER_ADMIN' || user?.role === 'GROUP_HEAD') && (
                              <button className="act-btn" title="Delete" style={{ color: 'var(--red-600)' }} onClick={e => handleDeleteLog(l, e)}><Icon name="x" size={14} /></button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border-strong)' }}>
                    <td colSpan={2}>Total ({logs.length} entries)</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{fmtLKR(logTotals.scheduleValue)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{fmtLKR(logTotals.scheduleValueWithVat)}</td>
                    <td colSpan={canWrite(user?.role) ? 3 : 2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}

      {/* Add Channel modal */}
      {showChModal && (
        <div className="modal-scrim show" onClick={e => { if (e.target === e.currentTarget) setShowChModal(false); }}>
          <div className="modal" style={{ width: 500 }}>
            <div className="modal-head">
              <div>
                <div style={{ fontSize: 17, fontWeight: 720, color: 'var(--ink)' }}>Add channel</div>
                <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>{client?.name}</div>
              </div>
              <button className="icon-btn" onClick={() => setShowChModal(false)}><Icon name="x" size={18} /></button>
            </div>
            <div className="modal-body">
              {chError && <div style={{ fontSize: 12.5, color: 'var(--red-600)', fontWeight: 600, marginBottom: 14 }}><Icon name="alert" size={14} /> {chError}</div>}
              <div className="field">
                <label className="field-label">Channel<span className="req">*</span></label>
                <select className="select" value={chForm.channelMasterId} onChange={e => setChForm(p => ({ ...p, channelMasterId: e.target.value }))}>
                  <option value="">Select a channel…</option>
                  {channelMasters
                    .filter(cm => cm.isActive !== false && (activeTab === 'SCHEDULE' || cm.medium === activeTab))
                    .map(cm => (
                      <option key={cm.id} value={cm.id}>{cm.name} ({cm.medium})</option>
                    ))}
                </select>
                <span style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4, display: 'block' }}>
                  Channels are managed in User Management → Channels.
                </span>
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={() => setShowChModal(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={chSubmitting} onClick={handleAddChannel}>
                {chSubmitting ? 'Adding…' : 'Add channel'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Schedule Log modal */}
      {showLogModal && (
        <div className="modal-scrim show" onClick={e => { if (e.target === e.currentTarget) setShowLogModal(false); }}>
          <div className="modal" style={{ maxWidth: 680 }} onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <div style={{ fontSize: 17, fontWeight: 720, color: 'var(--ink)' }}>
                {editingLog ? 'Edit Log Entry' : 'Add Log Entry'}
              </div>
              <button className="icon-btn" onClick={() => setShowLogModal(false)}><Icon name="x" size={18} /></button>
            </div>
            <form onSubmit={handleLogSubmit}>
              <div className="modal-body">
                {logError && <div style={{ fontSize: 13, color: 'var(--red-600)', fontWeight: 600, marginBottom: 14 }}>{logError}</div>}

                <div className="field-grid2">
                  <div className="field">
                    <label className="field-label">Channel <span className="req">*</span></label>
                    <select className="select" value={logForm.channelMasterId} onChange={e => setLogForm(p => ({ ...p, channelMasterId: e.target.value }))}>
                      <option value="">Select channel…</option>
                      {channelMasters.filter(cm => cm.isActive !== false).map(cm => <option key={cm.id} value={cm.id}>{cm.name} ({cm.medium})</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label className="field-label">RO Number</label>
                    <input className="input" value={logForm.roNumber} onChange={e => setLogForm(p => ({ ...p, roNumber: e.target.value }))} placeholder="RO-2024-001" />
                  </div>
                </div>

                <div className="field-grid2">
                  <div className="field">
                    <label className="field-label">Schedule Month <span className="req">*</span></label>
                    <input className="input" type="month" value={logForm.scheduleMonth} onChange={e => setLogForm(p => ({ ...p, scheduleMonth: e.target.value }))} />
                    {logForm.scheduleMonth && (() => {
                      const [y, m] = logForm.scheduleMonth.split('-').map(Number);
                      const d = new Date(y, m, 1);
                      const inv = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                      return <span className="field-hint">Invoice month: {inv}</span>;
                    })()}
                  </div>
                  <div className="field">
                    <label className="field-label">Schedule Value <span className="req">*</span></label>
                    <input className="input" type="number" step="0.01" value={logForm.scheduleValue} onChange={e => setLogForm(p => ({ ...p, scheduleValue: e.target.value }))} placeholder="0.00" />
                    {logForm.scheduleValue && (
                      <span className="field-hint">With VAT (18%): LKR {(parseFloat(logForm.scheduleValue) * 1.18).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="modal-foot">
                <button type="button" className="btn btn-ghost" onClick={() => setShowLogModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={logSubmitting}>
                  {logSubmitting ? 'Saving…' : editingLog ? 'Save Changes' : 'Add Entry'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
