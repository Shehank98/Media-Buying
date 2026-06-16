import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Icon, { fmtLKR } from '../components/Icon';
import api from '../lib/api';

export default function ClientsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [clients, setClients] = useState([]);
  const [agencies, setAgencies] = useState([]);
  const [loading, setLoading] = useState(true);

  // Add / Edit
  const [showModal, setShowModal] = useState(false);
  const [editingClient, setEditingClient] = useState(null);
  const [form, setForm] = useState({ name: '', agencyId: '' });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // Delete
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletingClient, setDeletingClient] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const canManage = ['SUPER_ADMIN', 'GROUP_HEAD'].includes(user?.role);
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

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
        } catch { /* skip */ }
      }
      setClients(allClients);
    } catch { /* ignore */ } finally { setLoading(false); }
  };

  useEffect(() => { fetchClients(); }, []);

  const openAdd = () => {
    setEditingClient(null);
    setForm({ name: '', agencyId: agencies[0]?.id || '' });
    setFormError('');
    setShowModal(true);
  };

  const openEdit = (c, e) => {
    e.stopPropagation();
    setEditingClient(c);
    setForm({ name: c.name, agencyId: c.agencyId });
    setFormError('');
    setShowModal(true);
  };

  const openDelete = (c, e) => {
    e.stopPropagation();
    setDeletingClient(c);
    setShowDeleteModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.name.trim()) { setFormError('Client name is required.'); return; }
    if (!editingClient && !form.agencyId) { setFormError('Please select an agency.'); return; }
    setSubmitting(true);
    try {
      if (editingClient) {
        await api.put(`/clients/${editingClient.id}`, { name: form.name });
      } else {
        await api.post(`/agencies/${form.agencyId}/clients`, { name: form.name });
      }
      setShowModal(false);
      setLoading(true);
      await fetchClients();
    } catch (err) {
      setFormError(err.response?.data?.error || err.response?.data?.message || 'Failed to save client.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingClient) return;
    setDeleting(true);
    try {
      await api.delete(`/clients/${deletingClient.id}`);
      setShowDeleteModal(false);
      setDeletingClient(null);
      setLoading(true);
      await fetchClients();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete client.');
      setShowDeleteModal(false);
    } finally {
      setDeleting(false);
    }
  };

  const MONO = "'Spline Sans Mono', monospace";

  if (loading) return <div className="fade-in" style={{ maxWidth: 1320, margin: '0 auto', padding: '60px 0', textAlign: 'center', color: '#6B7790' }}>Loading…</div>;

  return (
    <div className="fade-in" style={{ maxWidth: 1320, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-.6px', margin: 0, color: '#16243C' }}>Clients</h1>
          <p style={{ fontSize: 13.5, color: '#6B7790', margin: '6px 0 0' }}>{clients.length} client{clients.length !== 1 ? 's' : ''} you can access</p>
        </div>
        {canManage && (
          <button
            onClick={openAdd}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#E85D24', color: '#fff', border: 'none', borderRadius: 10, padding: '9px 15px', fontSize: 13, fontWeight: 600, cursor: 'pointer', boxShadow: '0 1px 2px rgba(232,93,36,.4)' }}
          >
            <Icon name="plus" size={16} />Add client
          </button>
        )}
      </div>

      {error && (
        <div style={{ background: 'var(--red-50,#fef2f2)', border: '1px solid var(--red-200,#fecaca)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--red-700,#b91c1c)', marginBottom: 16 }}>
          {error}
          <button onClick={() => setError('')} style={{ marginLeft: 8, fontWeight: 600, background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', textDecoration: 'underline' }}>Dismiss</button>
        </div>
      )}

      <div style={{ background: '#fff', border: '1px solid #E5E8ED', borderRadius: 14, boxShadow: '0 1px 2px rgba(15,31,61,.06)', overflow: 'hidden' }}>
        {clients.length === 0 ? (
          <div style={{ padding: '48px 24px', textAlign: 'center', color: '#6B7790' }}>No clients yet.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr>
              {['Client', 'Agency'].map(h => (
                <th key={h} style={{ textAlign: 'left', fontSize: 10.5, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: '#6B7790', padding: '12px 22px', background: '#F5F6F8', borderBottom: '1px solid #E5E8ED' }}>{h}</th>
              ))}
              <th style={{ textAlign: 'center', fontSize: 10.5, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: '#6B7790', padding: '12px 22px', background: '#F5F6F8', borderBottom: '1px solid #E5E8ED' }}>Channels</th>
              <th style={{ textAlign: 'right', fontSize: 10.5, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: '#6B7790', padding: '12px 22px', background: '#F5F6F8', borderBottom: '1px solid #E5E8ED' }}>YTD Spend</th>
              {canManage && <th style={{ width: 80, textAlign: 'right', fontSize: 10.5, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: '#6B7790', padding: '12px 22px', background: '#F5F6F8', borderBottom: '1px solid #E5E8ED' }}>Actions</th>}
              <th style={{ width: 40, background: '#F5F6F8', borderBottom: '1px solid #E5E8ED' }}></th>
            </tr></thead>
            <tbody>
              {clients.map(c => {
                const channelCount = c._count?.channels ?? c.channelCount ?? null;
                const ytd = c.ytdSpend ?? c.ytd ?? null;
                return (
                <tr
                  key={c.id}
                  onClick={() => navigate(`/clients/${c.id}`)}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#F7F8FA'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = ''; }}
                >
                  <td style={{ padding: '12px 22px', borderBottom: '1px solid #EEF0F3' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                      <div style={{ width: 34, height: 34, borderRadius: 9, background: '#EEF0F3', color: '#0F1F3D', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 13, flex: 'none' }}>{c.name?.[0]}</div>
                      <span style={{ fontWeight: 600, color: '#16243C' }}>{c.name}</span>
                    </div>
                  </td>
                  <td style={{ padding: '12px 22px', borderBottom: '1px solid #EEF0F3', color: '#6B7790' }}>{c.agencyName || '-'}</td>
                  <td style={{ padding: '12px 22px', borderBottom: '1px solid #EEF0F3', textAlign: 'center' }}>
                    <span style={{ display: 'inline-block', minWidth: 26, fontSize: 12, fontWeight: 700, fontFamily: MONO, background: '#EEF0F3', color: '#3B4A63', padding: '2px 9px', borderRadius: 20 }}>{channelCount ?? '-'}</span>
                  </td>
                  <td style={{ padding: '12px 22px', borderBottom: '1px solid #EEF0F3', textAlign: 'right', fontWeight: 600, fontFamily: MONO, color: '#16243C' }}>{ytd != null ? fmtLKR(ytd) : '-'}</td>
                  {canManage && (
                    <td style={{ padding: '12px 22px', borderBottom: '1px solid #EEF0F3', textAlign: 'right' }}>
                      <div className="row-actions">
                        <button className="act-btn" title="Edit client" onClick={e => openEdit(c, e)}>
                          <Icon name="edit" size={15} />
                        </button>
                        {isSuperAdmin && (
                          <button className="act-btn" title="Delete client" style={{ color: 'var(--red-600,#dc2626)' }} onClick={e => openDelete(c, e)}>
                            <Icon name="x" size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                  <td style={{ padding: '12px 22px', borderBottom: '1px solid #EEF0F3' }}><Icon name="chevR" size={16} style={{ color: '#C7D0DD' }} /></td>
                </tr>
              ); })}
            </tbody>
          </table>
        )}
      </div>

      {/* Add / Edit modal */}
      {showModal && (
        <div className="modal-scrim show" onClick={e => { if (e.target === e.currentTarget) setShowModal(false); }}>
          <div className="modal">
            <div className="modal-head">
              <div style={{ fontSize: 17, fontWeight: 720, color: 'var(--ink)' }}>
                {editingClient ? 'Edit client' : 'Add client'}
              </div>
              <button className="icon-btn" onClick={() => setShowModal(false)}><Icon name="x" size={18} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                {formError && <div style={{ fontSize: 13, color: 'var(--red-600)', fontWeight: 600, marginBottom: 14 }}>{formError}</div>}
                {!editingClient && (
                  <div className="field">
                    <label className="field-label">Agency <span className="req">*</span></label>
                    <select className="select" value={form.agencyId} onChange={e => setForm(p => ({ ...p, agencyId: e.target.value }))}>
                      <option value="">Select agency…</option>
                      {agencies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>
                )}
                <div className="field">
                  <label className="field-label">Client name <span className="req">*</span></label>
                  <input className="input" type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Dialog Axiata" autoFocus />
                </div>
              </div>
              <div className="modal-foot">
                <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Saving…' : editingClient ? 'Save changes' : 'Add client'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {showDeleteModal && (
        <div className="modal-scrim show" onClick={e => { if (e.target === e.currentTarget) setShowDeleteModal(false); }}>
          <div className="modal">
            <div className="modal-head">
              <div style={{ fontSize: 17, fontWeight: 720, color: 'var(--ink)' }}>Delete client</div>
              <button className="icon-btn" onClick={() => setShowDeleteModal(false)}><Icon name="x" size={18} /></button>
            </div>
            <div className="modal-body">
              <p style={{ color: 'var(--muted)', margin: 0 }}>
                Delete <strong style={{ color: 'var(--ink)' }}>{deletingClient?.name}</strong>? This will permanently remove the client and all its channels and properties.
              </p>
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={() => setShowDeleteModal(false)}>Cancel</button>
              <button className="btn" style={{ background: 'var(--red-600,#dc2626)', color: '#fff' }} onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete client'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
