import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Icon from '../components/Icon';
import api from '../lib/api';

export default function ClientsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [clients, setClients] = useState([]);
  const [agencies, setAgencies] = useState([]);
  const [loading, setLoading] = useState(true);

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', agencyId: '' });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const canAddClient = ['SUPER_ADMIN', 'GROUP_HEAD'].includes(user?.role);

  const fetchClients = async () => {
    try {
      const { data: agenciesData } = await api.get('/agencies');
      const rawAg = agenciesData.agencies || agenciesData;
      const agList = Array.isArray(rawAg) ? rawAg : [];
      setAgencies(agList);
      const allClients = [];
      for (const ag of agList) {
        try {
          const { data: clientsData } = await api.get(`/agencies/${ag.id}/clients`);
          const rawCl = clientsData.clients || clientsData;
          const cls = Array.isArray(rawCl) ? rawCl : [];
          cls.forEach(c => allClients.push({ ...c, agencyName: ag.name, agencyId: ag.id }));
        } catch { /* skip agency */ }
      }
      setClients(allClients);
    } catch { /* ignore */ } finally { setLoading(false); }
  };

  useEffect(() => { fetchClients(); }, []);

  const openAdd = () => {
    setForm({ name: '', agencyId: agencies[0]?.id || '' });
    setFormError('');
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.name.trim()) { setFormError('Client name is required.'); return; }
    if (!form.agencyId) { setFormError('Please select an agency.'); return; }
    setSubmitting(true);
    try {
      await api.post(`/agencies/${form.agencyId}/clients`, { name: form.name });
      setShowModal(false);
      setLoading(true);
      await fetchClients();
    } catch (err) {
      setFormError(err.response?.data?.error || err.response?.data?.message || 'Failed to create client.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="content-narrow fade-in" style={{ padding: '60px 0', textAlign: 'center', color: 'var(--muted)' }}>Loading…</div>;

  return (
    <div className="content-narrow fade-in">
      <div className="page-head">
        <div>
          <h1 className="page-title">Clients</h1>
          <p className="page-sub">{clients.length} clients you can access</p>
        </div>
        {canAddClient && (
          <button className="btn btn-primary" onClick={openAdd}>
            <Icon name="plus" size={16} />Add client
          </button>
        )}
      </div>

      <div className="tbl-wrap">
        {clients.length === 0 ? (
          <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--muted)' }}>
            No clients yet.
          </div>
        ) : (
          <table className="tbl">
            <thead><tr>
              <th>Client</th>
              <th>Agency</th>
              <th style={{ textAlign: 'center' }}>Channels</th>
              <th style={{ width: 40 }}></th>
            </tr></thead>
            <tbody>
              {clients.map(c => (
                <tr key={c.id} className="clickable" onClick={() => navigate(`/clients/${c.id}`)}>
                  <td><div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                    <div style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--bg-sunken)', color: 'var(--navy-800)', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 13, flex: 'none' }}>{c.name?.[0]}</div>
                    <span className="strong">{c.name}</span>
                  </div></td>
                  <td style={{ color: 'var(--muted)' }}>{c.agencyName || '—'}</td>
                  <td style={{ textAlign: 'center' }}><span className="count-badge">{c._count?.channels || c.channelCount || 0}</span></td>
                  <td><Icon name="chevR" size={16} style={{ color: 'var(--muted-2)' }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div className="modal-scrim show" onClick={e => { if (e.target === e.currentTarget) setShowModal(false); }}>
          <div className="modal">
            <div className="modal-head">
              <div style={{ fontSize: 17, fontWeight: 720, color: 'var(--ink)' }}>Add client</div>
              <button className="icon-btn" onClick={() => setShowModal(false)}><Icon name="x" size={18} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                {formError && (
                  <div style={{ fontSize: 13, color: 'var(--red-600)', fontWeight: 600, marginBottom: 14 }}>
                    {formError}
                  </div>
                )}
                <div className="field">
                  <label className="field-label">Agency <span className="req">*</span></label>
                  <select
                    className="select"
                    value={form.agencyId}
                    onChange={e => setForm(p => ({ ...p, agencyId: e.target.value }))}
                  >
                    <option value="">Select agency…</option>
                    {agencies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label className="field-label">Client name <span className="req">*</span></label>
                  <input
                    className="input"
                    type="text"
                    value={form.name}
                    onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. Dialog Axiata"
                    autoFocus
                  />
                </div>
              </div>
              <div className="modal-foot">
                <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  <Icon name="plus" size={15} />
                  {submitting ? 'Adding…' : 'Add client'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
