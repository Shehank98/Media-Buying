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

  // Add / Edit client
  const [showModal, setShowModal] = useState(false);
  const [editingClient, setEditingClient] = useState(null);
  const [form, setForm] = useState({ name: '' });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // Delete client
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletingClient, setDeletingClient] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const canManage = ['SUPER_ADMIN', 'GROUP_HEAD'].includes(user?.role);
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

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
    setEditingClient(null);
    setForm({ name: '' });
    setFormError('');
    setShowModal(true);
  };

  const openEdit = (c, e) => {
    e.stopPropagation();
    setEditingClient(c);
    setForm({ name: c.name });
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
    setSubmitting(true);
    try {
      if (editingClient) {
        await api.put(`/clients/${editingClient.id}`, form);
      } else {
        await api.post(`/agencies/${agencyId}/clients`, form);
      }
      setShowModal(false);
      await fetchData();
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
      await fetchData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete client.');
      setShowDeleteModal(false);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <div className="content-narrow fade-in" style={{ padding: '60px 0', textAlign: 'center', color: 'var(--muted)' }}>Loading…</div>;

  if (error) return (
    <div className="content-narrow fade-in">
      <div style={{ background: 'var(--red-50,#fef2f2)', border: '1px solid var(--red-200,#fecaca)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--red-700,#b91c1c)', marginTop: 16 }}>
        {error}
        <button onClick={() => setError('')} style={{ marginLeft: 8, fontWeight: 600, background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', textDecoration: 'underline' }}>Dismiss</button>
      </div>
    </div>
  );

  return (
    <div className="content-narrow fade-in">
      <div className="page-head">
        <div>
          <h1 className="page-title">{agency?.name}</h1>
          <p className="page-sub">{clients.length} client{clients.length !== 1 ? 's' : ''}</p>
        </div>
        {canManage && (
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
              <th>Client</th>
              <th>Channels</th>
              {canManage && <th style={{ width: 80, textAlign: 'right' }}>Actions</th>}
              <th style={{ width: 40 }}></th>
            </tr></thead>
            <tbody>
              {clients.map(c => {
                const count = c._count?.channels || c.channelCount || 0;
                return (
                  <tr key={c.id} className="clickable" onClick={() => navigate(`/clients/${c.id}`)}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                        <div style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--bg-sunken)', color: 'var(--navy-800)', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 13, flex: 'none' }}>{c.name[0]}</div>
                        <span className="strong">{c.name}</span>
                      </div>
                    </td>
                    <td><span className="count-badge">{count} channel{count !== 1 ? 's' : ''}</span></td>
                    {canManage && (
                      <td style={{ textAlign: 'right' }}>
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
                    <td><Icon name="chevR" size={16} style={{ color: 'var(--muted-2)' }} /></td>
                  </tr>
                );
              })}
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
                  <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 14 }}>
                    Adding to: <strong style={{ color: 'var(--ink)' }}>{agency?.name}</strong>
                  </div>
                )}
                <div className="field">
                  <label className="field-label">Client name <span className="req">*</span></label>
                  <input className="input" type="text" value={form.name} onChange={e => setForm({ name: e.target.value })} placeholder="e.g. Dialog Axiata" autoFocus />
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
