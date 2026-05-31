import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../lib/api';
import Icon from '../components/Icon';

export default function AgencyDetailPage() {
  const { agencyId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [agency, setAgency] = useState(null);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '' });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const canAddClient = ['SUPER_ADMIN', 'GROUP_HEAD'].includes(user?.role);

  const fetchData = async () => {
    try {
      const [agencyRes, clientsRes] = await Promise.all([
        api.get(`/agencies/${agencyId}`),
        api.get(`/agencies/${agencyId}/clients`),
      ]);
      setAgency(agencyRes.data.agency || agencyRes.data);
      const raw = clientsRes.data.clients || clientsRes.data;
      setClients(Array.isArray(raw) ? raw : []);
    } catch {
      setError('Failed to load agency details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [agencyId]);

  const openAdd = () => {
    setForm({ name: '' });
    setFormError('');
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.name.trim()) { setFormError('Client name is required.'); return; }
    setSubmitting(true);
    try {
      await api.post(`/agencies/${agencyId}/clients`, form);
      setShowModal(false);
      await fetchData();
    } catch (err) {
      setFormError(err.response?.data?.error || err.response?.data?.message || 'Failed to create client.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="content-narrow fade-in" style={{ padding: '60px 0', textAlign: 'center', color: 'var(--muted)' }}>Loading…</div>;

  if (error) return (
    <div className="content-narrow fade-in">
      <p style={{ color: 'var(--coral-600)', padding: 16 }}>{error}</p>
    </div>
  );

  return (
    <div className="content-narrow fade-in">
      <div className="page-head">
        <div>
          <h1 className="page-title">{agency?.name}</h1>
          <p className="page-sub">{clients.length} clients</p>
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
            No clients yet. Add one to get started.
          </div>
        ) : (
          <table className="tbl">
            <thead><tr>
              <th>Client</th><th>Channels</th><th style={{ width: 40 }}></th>
            </tr></thead>
            <tbody>
              {clients.map(c => {
                const count = c._count?.channels || c.channelCount || 0;
                return (
                  <tr key={c.id} className="clickable" onClick={() => navigate(`/clients/${c.id}`)}>
                    <td><div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                      <div style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--bg-sunken)', color: 'var(--navy-800)', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 13, flex: 'none' }}>{c.name[0]}</div>
                      <span className="strong">{c.name}</span>
                    </div></td>
                    <td><span className="count-badge">{count} channels</span></td>
                    <td><Icon name="chevR" size={16} style={{ color: 'var(--muted-2)' }} /></td>
                  </tr>
                );
              })}
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
                <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 14 }}>
                  Adding to: <strong style={{ color: 'var(--ink)' }}>{agency?.name}</strong>
                </div>
                <div className="field">
                  <label className="field-label">Client name <span className="req">*</span></label>
                  <input
                    className="input"
                    type="text"
                    value={form.name}
                    onChange={e => setForm({ name: e.target.value })}
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
