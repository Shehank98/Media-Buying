import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../lib/api';
import Icon from '../components/Icon';

export default function AgenciesPage() {
  const [agencies, setAgencies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { user } = useAuth();

  const [showModal, setShowModal] = useState(false);
  const [editingAgency, setEditingAgency] = useState(null);
  const [form, setForm] = useState({ name: '' });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletingAgency, setDeletingAgency] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  const fetchAgencies = async () => {
    try {
      const { data } = await api.get('/agencies');
      const raw = data.agencies || data;
      setAgencies(Array.isArray(raw) ? raw : []);
    } catch {
      setError('Failed to load agencies.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAgencies(); }, []);

  const openAdd = () => {
    setEditingAgency(null);
    setForm({ name: '' });
    setFormError('');
    setShowModal(true);
  };

  const openEdit = (ag, e) => {
    e.stopPropagation();
    setEditingAgency(ag);
    setForm({ name: ag.name });
    setFormError('');
    setShowModal(true);
  };

  const openDelete = (ag, e) => {
    e.stopPropagation();
    setDeletingAgency(ag);
    setShowDeleteModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.name.trim()) { setFormError('Agency name is required.'); return; }
    setSubmitting(true);
    try {
      if (editingAgency) {
        await api.put(`/admin/agencies/${editingAgency.id}`, form);
      } else {
        await api.post('/admin/agencies', form);
      }
      setShowModal(false);
      await fetchAgencies();
    } catch (err) {
      setFormError(err.response?.data?.error || err.response?.data?.message || 'Failed to save agency.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingAgency) return;
    setDeleting(true);
    try {
      await api.delete(`/admin/agencies/${deletingAgency.id}`);
      setShowDeleteModal(false);
      setDeletingAgency(null);
      await fetchAgencies();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete agency.');
      setShowDeleteModal(false);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <div className="content-narrow fade-in" style={{ padding: '60px 0', textAlign: 'center', color: 'var(--muted)' }}>Loading…</div>;

  return (
    <div className="content-narrow fade-in">
      <div className="page-head">
        <div>
          <h1 className="page-title">Agencies</h1>
          <p className="page-sub">Agencies you have access to</p>
        </div>
        {isSuperAdmin && (
          <button className="btn btn-primary" onClick={openAdd}>
            <Icon name="plus" size={16} />Add agency
          </button>
        )}
      </div>

      {error && (
        <div style={{ background: 'var(--red-50,#fef2f2)', border: '1px solid var(--red-200,#fecaca)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--red-700,#b91c1c)', marginBottom: 16 }}>
          {error}
          <button onClick={() => setError('')} style={{ marginLeft: 8, fontWeight: 600, background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', textDecoration: 'underline' }}>Dismiss</button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 18 }}>
        {agencies.map(ag => {
          const count = ag._count?.clients || ag.clientCount || 0;
          return (
            <div key={ag.id} style={{ position: 'relative' }}>
              <button
                className="stat"
                style={{ textAlign: 'left', cursor: 'pointer', border: '1px solid var(--border)', width: '100%' }}
                onClick={() => navigate(`/agencies/${ag.id}`)}
                onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--navy-400)'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
              >
                <div className="stat-top">
                  <div className="stat-ico" style={{ background: 'var(--navy-900)', color: '#fff' }}>{ag.name[0]}</div>
                  <div className="stat-label">{ag.name}</div>
                </div>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>{count} client{count !== 1 ? 's' : ''}</div>
              </button>
              {isSuperAdmin && (
                <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 4 }}>
                  <button
                    onClick={e => openEdit(ag, e)}
                    style={{ background: 'var(--bg-sunken)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 6px', cursor: 'pointer', color: 'var(--muted)' }}
                    title="Edit agency"
                  >
                    <Icon name="edit" size={13} />
                  </button>
                  <button
                    onClick={e => openDelete(ag, e)}
                    style={{ background: 'var(--red-50,#fef2f2)', border: '1px solid var(--red-200,#fecaca)', borderRadius: 6, padding: '4px 6px', cursor: 'pointer', color: 'var(--red-600,#dc2626)' }}
                    title="Delete agency"
                  >
                    <Icon name="x" size={13} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {agencies.length === 0 && (
          <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '48px 0', color: 'var(--muted)' }}>
            No agencies yet.
          </div>
        )}
      </div>

      {/* Add / Edit modal */}
      {showModal && (
        <div className="modal-scrim show" onClick={e => { if (e.target === e.currentTarget) setShowModal(false); }}>
          <div className="modal">
            <div className="modal-head">
              <div style={{ fontSize: 17, fontWeight: 720, color: 'var(--ink)' }}>
                {editingAgency ? 'Edit agency' : 'Add agency'}
              </div>
              <button className="icon-btn" onClick={() => setShowModal(false)}><Icon name="x" size={18} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                {formError && <div style={{ fontSize: 13, color: 'var(--red-600)', fontWeight: 600, marginBottom: 14 }}>{formError}</div>}
                <div className="field">
                  <label className="field-label">Agency name <span className="req">*</span></label>
                  <input className="input" type="text" value={form.name} onChange={e => setForm({ name: e.target.value })} placeholder="e.g. RedWorks Media" autoFocus />
                </div>
              </div>
              <div className="modal-foot">
                <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Saving…' : editingAgency ? 'Save changes' : 'Add agency'}
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
              <div style={{ fontSize: 17, fontWeight: 720, color: 'var(--ink)' }}>Delete agency</div>
              <button className="icon-btn" onClick={() => setShowDeleteModal(false)}><Icon name="x" size={18} /></button>
            </div>
            <div className="modal-body">
              <p style={{ color: 'var(--muted)', margin: 0 }}>
                Delete <strong style={{ color: 'var(--ink)' }}>{deletingAgency?.name}</strong>? This will permanently remove the agency and all its clients, channels and properties.
              </p>
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={() => setShowDeleteModal(false)}>Cancel</button>
              <button className="btn" style={{ background: 'var(--red-600,#dc2626)', color: '#fff' }} onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete agency'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
