import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Icon from '../components/Icon';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

const TABS = [
  { key: 'TV', label: 'TV Channels', icon: 'tv' },
  { key: 'RADIO', label: 'Radio Channels', icon: 'radio' },
  { key: 'PRINT', label: 'Print', icon: 'print' },
];

const TAB_COLORS = {
  TV:    { bg: 'var(--blue-50,#EFF6FF)',  fg: 'var(--blue-700,#1D4ED8)' },
  RADIO: { bg: 'var(--coral-50,#FFF5F0)', fg: 'var(--coral-600,#D4541E)' },
  PRINT: { bg: 'var(--green-50,#ECFDF5)', fg: 'var(--green-600,#059669)' },
};

const canAddChannel = (role) =>
  ['PLANNER', 'GROUP_HEAD', 'SUPER_ADMIN'].includes(role);

export default function ClientDetailPage() {
  const { clientId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [client, setClient] = useState(null);
  const [channels, setChannels] = useState([]);
  const [activeTab, setActiveTab] = useState('TV');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({ name: '', type: 'TV' });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const [refreshKey, setRefreshKey] = useState(0);

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
      } catch {
        setError('Failed to load client details.');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [clientId, refreshKey]);

  const filteredChannels = channels.filter((c) => c.type === activeTab);

  const handleAddChannel = async () => {
    setFormError('');
    if (!formData.name.trim()) {
      setFormError('Channel name is required.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/clients/${clientId}/channels`, formData);
      setShowModal(false);
      setFormData({ name: '', type: 'TV' });
      setRefreshKey(k => k + 1);
    } catch (err) {
      setFormError(err.response?.data?.message || 'Failed to add channel.');
    } finally {
      setSubmitting(false);
    }
  };

  const closeModal = () => {
    setShowModal(false);
    setFormError('');
    setFormData({ name: '', type: 'TV' });
  };

  if (loading) return <div className="content-narrow fade-in" style={{padding:'60px 0',textAlign:'center',color:'var(--muted)'}}>Loading…</div>;

  if (error) return <div className="content-narrow fade-in" style={{padding:'60px 0',textAlign:'center',color:'var(--red-600,#DC2626)'}}>{error}</div>;

  const tabColor = TAB_COLORS[activeTab] || TAB_COLORS.TV;
  const tabInfo = TABS.find(t => t.key === activeTab);
  const tabIcon = tabInfo?.icon || 'tv';

  return (
    <div className="content-narrow fade-in">
      <div className="page-head">
        <div>
          <h1 className="page-title">{client?.name}</h1>
          <p className="page-sub">Lead planner</p>
        </div>
        {canAddChannel(user?.role) && (
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            <Icon name="plus" size={16} />Add channel
          </button>
        )}
      </div>

      <div className="tabs">
        {TABS.map(t => (
          <button
            key={t.key}
            className={`tab${activeTab === t.key ? ' active' : ''}`}
            onClick={() => setActiveTab(t.key)}
          >
            <Icon name={t.icon} size={16} />{t.label}
            <span className="tcount">{channels.filter(c => c.type === t.key).length}</span>
          </button>
        ))}
      </div>

      {filteredChannels.length === 0 ? (
        <div style={{padding:'60px 0',textAlign:'center',color:'var(--muted)'}}>
          <Icon name={tabIcon} size={40} style={{color:'var(--muted-2)',marginBottom:10}} />
          <div style={{fontWeight:650,color:'var(--ink)',marginBottom:4}}>No {activeTab.toLowerCase()} channels</div>
          <div style={{fontSize:13}}>Add a {activeTab.toLowerCase()} channel to get started.</div>
        </div>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr>
              <th>Channel</th>
              <th style={{textAlign:'center'}}>Properties</th>
              <th>Type</th>
              <th style={{width:40}}></th>
            </tr></thead>
            <tbody>
              {filteredChannels.map(ch => (
                <tr key={ch.id} className="clickable" onClick={() => navigate(`/channels/${ch.id}`)}>
                  <td><div style={{display:'flex',alignItems:'center',gap:11}}>
                    <div style={{width:34,height:34,borderRadius:9,background:tabColor.bg,color:tabColor.fg,display:'grid',placeItems:'center',flex:'none'}}>
                      <Icon name={tabIcon} size={17} />
                    </div>
                    <span className="strong">{ch.name}</span>
                  </div></td>
                  <td style={{textAlign:'center'}}><span className="count-badge">{ch.propertyCount || ch._count?.properties || 0} properties</span></td>
                  <td><span style={{color:'var(--muted)'}}>{ch.type || '—'}</span></td>
                  <td><Icon name="chevR" size={16} style={{color:'var(--muted-2)'}} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="modal-scrim show" onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className="modal" style={{width: 500}}>
            <div className="modal-head">
              <div>
                <div style={{fontSize:17,fontWeight:720,color:'var(--ink)',letterSpacing:'-.3px'}}>Add channel</div>
                <div style={{fontSize:12.5,color:'var(--muted)',marginTop:3}}>{client?.name}</div>
              </div>
              <button className="icon-btn" style={{border:'none',background:'var(--bg-sunken)'}} onClick={closeModal}><Icon name="x" size={18} /></button>
            </div>
            <div className="modal-body">
              {formError && (
                <div style={{fontSize:12.5,color:'var(--red-600,#DC2626)',fontWeight:600,marginBottom:14,display:'flex',alignItems:'center',gap:5}}>
                  <Icon name="alert" size={14} />{formError}
                </div>
              )}
              <div className="field">
                <label className="field-label">Channel name<span className="req">*</span></label>
                <input
                  className="input"
                  type="text"
                  placeholder="Enter channel name"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div className="field">
                <label className="field-label">Type<span className="req">*</span></label>
                <select
                  className="select"
                  value={formData.type}
                  onChange={(e) => setFormData(prev => ({ ...prev, type: e.target.value }))}
                >
                  <option value="TV">TV</option>
                  <option value="RADIO">Radio</option>
                  <option value="PRINT">Print</option>
                </select>
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={closeModal}>Cancel</button>
              <button className="btn btn-primary" disabled={submitting} onClick={handleAddChannel}>
                <Icon name="plus" size={16} />{submitting ? 'Adding…' : 'Add channel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
