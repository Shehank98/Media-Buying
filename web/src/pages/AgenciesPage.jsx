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

  if (loading) return <div className="content-narrow fade-in" style={{ padding: '60px 0', textAlign: 'center', color: 'var(--muted)' }}>Loading…</div>;

  return (
    <div className="content-narrow fade-in">
      <div className="page-head">
        <div>
          <h1 className="page-title">Agencies</h1>
          <p className="page-sub">Agencies you have access to</p>
        </div>
        {user?.role === 'SUPER_ADMIN' && (
          <button className="btn btn-primary" onClick={openAdd}>
            <Icon name="plus" size={16} />Add agency
          </button>
        )}
      </div>

      {error && (
        <div style={{ background: 'var(--red-50,#fef2f2)', border: '1px solid var(--red-200)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--red-700)', marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 18 }}>
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
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>{count} clients · active</div>
              </button>
              {user?.role === 'SUPER_ADMIN' && (
                <button
                  onClick={e => openEdit(ag, e)}
                  style={{ position: 'absolute', top: 8, right: 8, background: 'var(--bg-sunken)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 6px', cursor: 'pointer', color: 'var(--muted)' }}
                  title="Edit agency"
                >
                  <Icon name="edit" size={13} />
                </button>
              )}
            </div>
          );
        })}

        {agencies.length === 0 && (
          <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '48px 0', color: 'var(--muted)' }}>
            No agencies yet. Create one to get started.
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal-scrim show" onClick={e => { if (e.target === e.currentTarget) setShowModal(false); }}>
          <div className="modal">
            <div className="modal-head">
              <div style={{ fontSize: 17, fontWeight: 720, color: 'var(--ink)' }}>
                {editingAgency ? 'Edit Agency' : 'Add Agency'}
              </div>
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
                  <label className="field-label">Agency name <span className="req">*</span></label>
                  <input
                    className="input"
                    type="text"
                    value={form.name}
                    onChange={e => setForm({ name: e.target.value })}
                    placeholder="e.g. RedWorks Media"
                    autoFocus
                  />
                </div>
              </div>
              <div className="modal-foot">
                <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  <Icon name="check" size={15} />
                  {submitting ? 'Saving…' : editingAgency ? 'Save changes' : 'Add agency'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
