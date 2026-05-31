import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Icon from '../components/Icon';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

const CHANNEL_TABS = [
  { key: 'TV', label: 'TV Channels', icon: 'tv' },
  { key: 'RADIO', label: 'Radio Channels', icon: 'radio' },
  { key: 'PRINT', label: 'Print', icon: 'print' },
];
const TAB_COLORS = {
  TV:    { bg: 'var(--blue-50,#EFF6FF)',  fg: 'var(--blue-700,#1D4ED8)' },
  RADIO: { bg: 'var(--coral-50,#FFF5F0)', fg: 'var(--coral-600,#D4541E)' },
  PRINT: { bg: 'var(--green-50,#ECFDF5)', fg: 'var(--green-600,#059669)' },
};

const fmtLKR = v => v == null ? '—' : 'LKR ' + Math.round(Number(v)).toLocaleString('en-US');
const fmtMonth = ym => {
  if (!ym) return '—';
  const s = typeof ym === 'string' ? ym.slice(0, 7) : '';
  if (!s) return '—';
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
  const [chForm, setChForm] = useState({ name: '', type: 'TV' });
  const [chSubmitting, setChSubmitting] = useState(false);
  const [chError, setChError] = useState('');

  // Schedule log state
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [brands, setBrands] = useState([]);
  const [channelMasters, setChannelMasters] = useState([]);
  const [logYear, setLogYear] = useState(String(new Date().getFullYear()));
  const [logMonth, setLogMonth] = useState('');
  const [logBrandFilter, setLogBrandFilter] = useState('');
  const [logChannelFilter, setLogChannelFilter] = useState('');

  // Add/Edit log modal
  const [showLogModal, setShowLogModal] = useState(false);
  const [editingLog, setEditingLog] = useState(null);
  const [logForm, setLogForm] = useState({
    channelMasterId: '', brandId: '', campaignId: '', scheduleMonth: '',
    invoiceMonth: '', scheduleValue: '', invoiceValue: '', roNumber: '',
    cagPct: '', cagAmount: '', aorPct: '', aorRevenue: '', mediaGroup: '', notes: '',
  });
  const [logSubmitting, setLogSubmitting] = useState(false);
  const [logError, setLogError] = useState('');
  const [campaigns, setCampaigns] = useState([]);

  // New brand/campaign inline creation
  const [newBrandName, setNewBrandName] = useState('');
  const [newCampName, setNewCampName] = useState('');

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

  // Load brands + channel masters when schedule tab active
  useEffect(() => {
    if (activeTab !== 'SCHEDULE') return;
    const load = async () => {
      try {
        const [bRes, cmRes] = await Promise.all([
          api.get(`/brands/client/${clientId}`),
          api.get('/admin/channel-masters'),
        ]);
        setBrands(Array.isArray(bRes.data.brands) ? bRes.data.brands : Array.isArray(bRes.data) ? bRes.data : []);
        setChannelMasters(Array.isArray(cmRes.data.channelMasters) ? cmRes.data.channelMasters : Array.isArray(cmRes.data) ? cmRes.data : []);
      } catch { /* ignore */ }
    };
    load();
  }, [activeTab, clientId]);

  // Load schedule logs when filters change
  useEffect(() => {
    if (activeTab !== 'SCHEDULE') return;
    const load = async () => {
      setLogsLoading(true);
      try {
        const params = new URLSearchParams();
        if (logYear) params.set('year', logYear);
        if (logMonth) params.set('month', logMonth);
        if (logBrandFilter) params.set('brandId', logBrandFilter);
        if (logChannelFilter) params.set('channelMasterId', logChannelFilter);
        const { data } = await api.get(`/schedule-logs/client/${clientId}?${params}`);
        setLogs(Array.isArray(data.logs) ? data.logs : Array.isArray(data) ? data : []);
      } catch { setLogs([]); }
      finally { setLogsLoading(false); }
    };
    load();
  }, [activeTab, clientId, logYear, logMonth, logBrandFilter, logChannelFilter, refreshKey]);

  // Load campaigns when brand changes in form
  useEffect(() => {
    if (!logForm.brandId) { setCampaigns([]); return; }
    const b = brands.find(b => b.id === parseInt(logForm.brandId));
    if (b && b.campaigns) { setCampaigns(b.campaigns); return; }
    api.get(`/brands/${logForm.brandId}/campaigns`).then(r => {
      setCampaigns(Array.isArray(r.data.campaigns) ? r.data.campaigns : Array.isArray(r.data) ? r.data : []);
    }).catch(() => setCampaigns([]));
  }, [logForm.brandId, brands]);

  // Auto compute cagAmount and aorRevenue
  useEffect(() => {
    const sv = parseFloat(logForm.scheduleValue);
    const cp = parseFloat(logForm.cagPct);
    if (!isNaN(sv) && !isNaN(cp)) {
      setLogForm(p => ({ ...p, cagAmount: (sv * cp / 100).toFixed(2) }));
    }
  }, [logForm.scheduleValue, logForm.cagPct]);

  useEffect(() => {
    const iv = parseFloat(logForm.invoiceValue || logForm.scheduleValue);
    const ap = parseFloat(logForm.aorPct);
    if (!isNaN(iv) && !isNaN(ap)) {
      setLogForm(p => ({ ...p, aorRevenue: (iv * ap / 100).toFixed(2) }));
    }
  }, [logForm.invoiceValue, logForm.scheduleValue, logForm.aorPct]);

  const filteredChannels = channels.filter(c => c.type === activeTab);

  const handleAddChannel = async () => {
    setChError('');
    if (!chForm.name.trim()) { setChError('Channel name is required.'); return; }
    setChSubmitting(true);
    try {
      await api.post(`/clients/${clientId}/channels`, chForm);
      setShowChModal(false);
      setChForm({ name: '', type: 'TV' });
      setRefreshKey(k => k + 1);
    } catch (err) { setChError(err.response?.data?.error || 'Failed to add channel.'); }
    finally { setChSubmitting(false); }
  };

  const openAddLog = () => {
    setEditingLog(null);
    const now = new Date();
    setLogForm({
      channelMasterId: '', brandId: '', campaignId: '',
      scheduleMonth: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
      invoiceMonth: '', scheduleValue: '', invoiceValue: '', roNumber: '',
      cagPct: '', cagAmount: '', aorPct: '', aorRevenue: '', mediaGroup: '', notes: '',
    });
    setLogError('');
    setNewBrandName('');
    setNewCampName('');
    setShowLogModal(true);
  };

  const openEditLog = (log, e) => {
    e.stopPropagation();
    setEditingLog(log);
    setLogForm({
      channelMasterId: String(log.channelMasterId || log.channelMaster?.id || ''),
      brandId: String(log.brandId || log.brand?.id || ''),
      campaignId: String(log.campaignId || log.campaign?.id || ''),
      scheduleMonth: log.scheduleMonth ? log.scheduleMonth.slice(0, 7) : '',
      invoiceMonth: log.invoiceMonth ? log.invoiceMonth.slice(0, 7) : '',
      scheduleValue: log.scheduleValue != null ? String(Number(log.scheduleValue)) : '',
      invoiceValue: log.invoiceValue != null ? String(Number(log.invoiceValue)) : '',
      roNumber: log.roNumber || '',
      cagPct: log.cagPct != null ? String(Number(log.cagPct)) : '',
      cagAmount: log.cagAmount != null ? String(Number(log.cagAmount)) : '',
      aorPct: log.aorPct != null ? String(Number(log.aorPct)) : '',
      aorRevenue: log.aorRevenue != null ? String(Number(log.aorRevenue)) : '',
      mediaGroup: log.mediaGroup || '',
      notes: log.notes || '',
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
      let brandId = logForm.brandId ? parseInt(logForm.brandId) : undefined;
      let campaignId = logForm.campaignId ? parseInt(logForm.campaignId) : undefined;

      // Create new brand if needed
      if (newBrandName && !brandId) {
        const { data } = await api.post(`/brands/client/${clientId}`, { name: newBrandName });
        brandId = data.brand?.id || data.id;
        setNewBrandName('');
      }
      // Create new campaign if needed
      if (newCampName && brandId && !campaignId) {
        const { data } = await api.post(`/brands/${brandId}/campaigns`, { name: newCampName });
        campaignId = data.campaign?.id || data.id;
        setNewCampName('');
      }

      const payload = {
        channelMasterId: parseInt(logForm.channelMasterId),
        brandId: brandId || undefined,
        campaignId: campaignId || undefined,
        scheduleMonth: new Date(logForm.scheduleMonth + '-01').toISOString(),
        invoiceMonth: logForm.invoiceMonth ? new Date(logForm.invoiceMonth + '-01').toISOString() : undefined,
        scheduleValue: parseFloat(logForm.scheduleValue),
        invoiceValue: logForm.invoiceValue ? parseFloat(logForm.invoiceValue) : undefined,
        roNumber: logForm.roNumber || undefined,
        cagPct: logForm.cagPct ? parseFloat(logForm.cagPct) : undefined,
        cagAmount: logForm.cagAmount ? parseFloat(logForm.cagAmount) : undefined,
        aorPct: logForm.aorPct ? parseFloat(logForm.aorPct) : undefined,
        aorRevenue: logForm.aorRevenue ? parseFloat(logForm.aorRevenue) : undefined,
        mediaGroup: logForm.mediaGroup || undefined,
        notes: logForm.notes || undefined,
      };

      if (editingLog) {
        await api.put(`/schedule-logs/${editingLog.id}`, payload);
      } else {
        await api.post(`/schedule-logs/client/${clientId}`, payload);
      }
      setShowLogModal(false);
      setRefreshKey(k => k + 1);
      // Reload brands so new ones show up
      const bRes = await api.get(`/brands/client/${clientId}`);
      setBrands(Array.isArray(bRes.data.brands) ? bRes.data.brands : []);
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
      invoiceValue: acc.invoiceValue + Number(l.invoiceValue || 0),
    }), { scheduleValue: 0, invoiceValue: 0 });
  }, [logs]);

  const years = useMemo(() => {
    const y = new Date().getFullYear();
    return Array.from({ length: 10 }, (_, i) => String(y - i));
  }, []);

  if (loading) return <div className="content-narrow fade-in" style={{ padding: '60px 0', textAlign: 'center', color: 'var(--muted)' }}>Loading…</div>;
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
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Channel</th><th style={{ textAlign: 'center' }}>Properties</th><th>Type</th><th style={{ width: 40 }}></th></tr></thead>
                <tbody>
                  {filteredChannels.map(ch => {
                    const tc = TAB_COLORS[activeTab] || TAB_COLORS.TV;
                    return (
                      <tr key={ch.id} className="clickable" onClick={() => navigate(`/channels/${ch.id}`)}>
                        <td><div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                          <div style={{ width: 34, height: 34, borderRadius: 9, background: tc.bg, color: tc.fg, display: 'grid', placeItems: 'center', flex: 'none' }}>
                            <Icon name={CHANNEL_TABS.find(t => t.key === activeTab)?.icon || 'tv'} size={17} />
                          </div>
                          <span className="strong">{ch.name}</span>
                        </div></td>
                        <td style={{ textAlign: 'center' }}><span className="count-badge">{ch.propertyCount || ch._count?.properties || 0} properties</span></td>
                        <td style={{ color: 'var(--muted)' }}>{ch.type}</td>
                        <td><Icon name="chevR" size={16} style={{ color: 'var(--muted-2)' }} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
            <select className="select" value={logBrandFilter} onChange={e => setLogBrandFilter(e.target.value)} style={{ flex: '0 0 140px' }}>
              <option value="">All brands</option>
              {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>

          {logsLoading ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--muted)' }}>Loading logs…</div>
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
                  <th>Month</th><th>Channel</th><th>Brand</th><th>Campaign</th>
                  <th style={{ textAlign: 'right' }}>Schedule Val</th>
                  <th style={{ textAlign: 'right' }}>Invoice Val</th>
                  <th>RO#</th><th>CAG%</th><th>AOR%</th>
                  {canWrite(user?.role) && <th style={{ width: 80, textAlign: 'right' }}>Actions</th>}
                </tr></thead>
                <tbody>
                  {logs.map(l => (
                    <tr key={l.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtMonth(l.scheduleMonth)}</td>
                      <td className="strong">{l.channelMaster?.name || '—'}</td>
                      <td>{l.brand?.name || '—'}</td>
                      <td>{l.campaign?.name || '—'}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{fmtLKR(l.scheduleValue)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{fmtLKR(l.invoiceValue)}</td>
                      <td style={{ color: 'var(--muted)', fontSize: 12 }}>{l.roNumber || '—'}</td>
                      <td style={{ fontSize: 12 }}>{l.cagPct != null ? `${Number(l.cagPct)}%` : '—'}</td>
                      <td style={{ fontSize: 12 }}>{l.aorPct != null ? `${Number(l.aorPct)}%` : '—'}</td>
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
                    <td colSpan={4}>Total ({logs.length} entries)</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{fmtLKR(logTotals.scheduleValue)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{fmtLKR(logTotals.invoiceValue)}</td>
                    <td colSpan={canWrite(user?.role) ? 4 : 3}></td>
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
                <label className="field-label">Channel name<span className="req">*</span></label>
                <input className="input" value={chForm.name} onChange={e => setChForm(p => ({ ...p, name: e.target.value }))} placeholder="Enter channel name" />
              </div>
              <div className="field">
                <label className="field-label">Type<span className="req">*</span></label>
                <select className="select" value={chForm.type} onChange={e => setChForm(p => ({ ...p, type: e.target.value }))}>
                  <option value="TV">TV</option><option value="RADIO">Radio</option><option value="PRINT">Print</option>
                </select>
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
                    <label className="field-label">Brand</label>
                    <select className="select" value={logForm.brandId} onChange={e => { setLogForm(p => ({ ...p, brandId: e.target.value, campaignId: '' })); setNewBrandName(''); }}>
                      <option value="">Select brand…</option>
                      {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                    {!logForm.brandId && (
                      <input className="input" style={{ marginTop: 6, fontSize: 12 }} placeholder="Or type new brand name…" value={newBrandName} onChange={e => setNewBrandName(e.target.value)} />
                    )}
                  </div>
                  <div className="field">
                    <label className="field-label">Campaign</label>
                    <select className="select" value={logForm.campaignId} onChange={e => { setLogForm(p => ({ ...p, campaignId: e.target.value })); setNewCampName(''); }} disabled={!logForm.brandId && !newBrandName}>
                      <option value="">Select campaign…</option>
                      {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    {(logForm.brandId || newBrandName) && !logForm.campaignId && (
                      <input className="input" style={{ marginTop: 6, fontSize: 12 }} placeholder="Or type new campaign…" value={newCampName} onChange={e => setNewCampName(e.target.value)} />
                    )}
                  </div>
                </div>

                <div className="field-grid2">
                  <div className="field">
                    <label className="field-label">Schedule Month <span className="req">*</span></label>
                    <input className="input" type="month" value={logForm.scheduleMonth} onChange={e => setLogForm(p => ({ ...p, scheduleMonth: e.target.value }))} />
                  </div>
                  <div className="field">
                    <label className="field-label">Invoice Month</label>
                    <input className="input" type="month" value={logForm.invoiceMonth} onChange={e => setLogForm(p => ({ ...p, invoiceMonth: e.target.value }))} />
                  </div>
                </div>

                <div className="field-grid2">
                  <div className="field">
                    <label className="field-label">Schedule Value <span className="req">*</span></label>
                    <input className="input" type="number" step="0.01" value={logForm.scheduleValue} onChange={e => setLogForm(p => ({ ...p, scheduleValue: e.target.value }))} placeholder="0.00" />
                  </div>
                  <div className="field">
                    <label className="field-label">Invoice Value</label>
                    <input className="input" type="number" step="0.01" value={logForm.invoiceValue} onChange={e => setLogForm(p => ({ ...p, invoiceValue: e.target.value }))} placeholder="0.00" />
                  </div>
                </div>

                <div className="field-grid2">
                  <div className="field">
                    <label className="field-label">CAG %</label>
                    <input className="input" type="number" step="0.001" value={logForm.cagPct} onChange={e => setLogForm(p => ({ ...p, cagPct: e.target.value }))} placeholder="0" />
                  </div>
                  <div className="field">
                    <label className="field-label">CAG Amount</label>
                    <input className="input" type="number" step="0.01" value={logForm.cagAmount} onChange={e => setLogForm(p => ({ ...p, cagAmount: e.target.value }))} placeholder="Auto-computed" />
                    <span className="field-hint">Auto-computed from Schedule Value × CAG%</span>
                  </div>
                </div>

                <div className="field-grid2">
                  <div className="field">
                    <label className="field-label">AOR %</label>
                    <input className="input" type="number" step="0.001" value={logForm.aorPct} onChange={e => setLogForm(p => ({ ...p, aorPct: e.target.value }))} placeholder="0" />
                  </div>
                  <div className="field">
                    <label className="field-label">AOR Revenue</label>
                    <input className="input" type="number" step="0.01" value={logForm.aorRevenue} onChange={e => setLogForm(p => ({ ...p, aorRevenue: e.target.value }))} placeholder="Auto-computed" />
                  </div>
                </div>

                <div className="field">
                  <label className="field-label">Media Group</label>
                  <input className="input" value={logForm.mediaGroup} onChange={e => setLogForm(p => ({ ...p, mediaGroup: e.target.value }))} placeholder="e.g. MTV / MBC" />
                </div>

                <div className="field">
                  <label className="field-label">Notes</label>
                  <textarea className="input" rows={2} value={logForm.notes} onChange={e => setLogForm(p => ({ ...p, notes: e.target.value }))} placeholder="Optional notes…" style={{ resize: 'vertical' }} />
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
