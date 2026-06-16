import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../lib/api';
import Icon, { fmtLKR } from '../components/Icon';

const CARD_STYLE = { background: '#fff', border: '1px solid #E5E8ED', borderRadius: 14, boxShadow: '0 1px 2px rgba(15,31,61,.06)' };
const BRAND_COLORS = ['#E85D24', '#1F5BB5', '#15814B', '#6B3FB5', '#9A5B00'];
const MONO = "'Spline Sans Mono', monospace";

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

  if (loading) return <div style={{ maxWidth: 1320, margin: '0 auto', padding: '60px 0', textAlign: 'center', color: '#6B7790' }}>Loading…</div>;

  return (
    <div style={{ maxWidth: 1320, margin: '0 auto' }} className="fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-.6px', margin: 0, color: '#16243C' }}>Agencies</h1>
          <p style={{ fontSize: 13.5, color: '#6B7790', margin: '6px 0 0' }}>Agencies you have access to</p>
        </div>
        {isSuperAdmin && (
          <button
            onClick={openAdd}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#E85D24', color: '#fff', border: 'none', borderRadius: 10, padding: '9px 15px', fontSize: 13, fontWeight: 600, boxShadow: '0 1px 2px rgba(232,93,36,.4)', cursor: 'pointer' }}
          >
            <Icon name="plus" size={16} />Add agency
          </button>
        )}
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#b91c1c', marginBottom: 18 }}>
          {error}
          <button onClick={() => setError('')} style={{ marginLeft: 8, fontWeight: 600, background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', textDecoration: 'underline' }}>Dismiss</button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 18 }}>
        {agencies.map((ag, i) => {
          const clientCount = ag._count?.clients ?? ag.clientCount ?? 0;
          const channelCount = ag._count?.channels ?? ag.channelCount ?? null;
          const spend = ag.totalSpend ?? ag.spend ?? null;
          const sub = ag.lead || ag.owner || ag.ownerName || null;
          const brand = BRAND_COLORS[i % BRAND_COLORS.length];
          return (
            <div
              key={ag.id}
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/agencies/${ag.id}`)}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#C7D0DD'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(15,31,61,.09)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#E5E8ED'; e.currentTarget.style.boxShadow = '0 1px 2px rgba(15,31,61,.06)'; }}
              style={{ ...CARD_STYLE, padding: 22, cursor: 'pointer', position: 'relative', transition: 'border-color .15s, box-shadow .15s' }}
            >
              {isSuperAdmin && (
                <div style={{ position: 'absolute', top: 14, right: 14, display: 'flex', gap: 4 }}>
                  <button
                    onClick={e => openEdit(ag, e)}
                    style={{ background: '#F5F6F8', border: '1px solid #E5E8ED', borderRadius: 8, padding: '4px 6px', cursor: 'pointer', color: '#6B7790' }}
                    title="Edit agency"
                  >
                    <Icon name="edit" size={13} />
                  </button>
                  <button
                    onClick={e => openDelete(ag, e)}
                    style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '4px 6px', cursor: 'pointer', color: '#dc2626' }}
                    title="Delete agency"
                  >
                    <Icon name="x" size={13} />
                  </button>
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
                <div style={{ width: 46, height: 46, borderRadius: 12, background: brand, color: '#fff', fontWeight: 700, fontSize: 19, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {ag.name?.[0]?.toUpperCase()}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-.2px', color: '#16243C', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ag.name}</div>
                  {sub && <div style={{ fontSize: 12, color: '#93A0B5', marginTop: 2 }}>{sub}</div>}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 10px' }}>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 700, fontFamily: MONO, color: '#16243C' }}>{clientCount}</div>
                  <div style={{ fontSize: 11.5, color: '#93A0B5' }}>Clients</div>
                </div>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 700, fontFamily: MONO, color: '#16243C' }}>{channelCount ?? '-'}</div>
                  <div style={{ fontSize: 11.5, color: '#93A0B5' }}>Channels</div>
                </div>
                <div style={{ gridColumn: '1/-1', borderTop: '1px solid #EEF0F3', paddingTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: '#6B7790' }}>Total spend</span>
                  <span style={{ fontSize: 15, fontWeight: 700, fontFamily: MONO, color: '#D9521C' }}>{spend != null ? fmtLKR(spend) : '-'}</span>
                </div>
              </div>
            </div>
          );
        })}
        {agencies.length === 0 && (
          <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '48px 0', color: '#6B7790' }}>
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
