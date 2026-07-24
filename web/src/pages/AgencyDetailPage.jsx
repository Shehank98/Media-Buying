import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../lib/api';
import Icon, { fmtLKR } from '../components/Icon';
import OrbitLoader from '../components/OrbitLoader';

const AVATAR = ['#E85D24', '#1F5BB5', '#15814B', '#6B3FB5', '#9A5B00', '#C5391F', '#0891b2', '#38527E'];

export default function AgencyDetailPage() {
  const { agencyId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [agency, setAgency] = useState(null);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Parent-company (client group) cards for this agency.
  const [groupYear, setGroupYear] = useState(new Date().getFullYear());
  const [groups, setGroups] = useState([]);

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

  useEffect(() => {
    api.get(`/agencies/${agencyId}/groups`, { params: { year: groupYear } })
      .then(r => setGroups(r.data.groups || []))
      .catch(() => setGroups([]));
  }, [agencyId, groupYear]);

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

  if (loading) return <div className="content-narrow fade-in"><OrbitLoader fullHeight label="Loading agency…" /></div>;

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

      {groups.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 750, letterSpacing: '.3px', textTransform: 'uppercase', color: '#6B7790' }}>Client Groups</div>
            <select className="select" value={groupYear} onChange={e => setGroupYear(Number(e.target.value))} style={{ maxWidth: 110, height: 32 }} title="Target / spend year">
              {(() => { const y = new Date().getFullYear(); const out = []; for (let i = y + 1; i >= y - 5; i--) out.push(i); return out; })().map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {groups.map(g => {
              const pct = g.achievementPct;
              const pctColor = pct == null ? '#93A0B5' : pct >= 100 ? '#3DDC97' : pct >= 60 ? '#F2C14E' : '#FF7A66';
              return (
                <div
                  key={g.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/client-groups/${g.id}/dashboard`)}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 16px 34px rgba(10,23,41,.28)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 6px 18px rgba(10,23,41,.20)'; }}
                  style={{
                    position: 'relative', overflow: 'hidden', cursor: 'pointer', borderRadius: 16, padding: 20,
                    background: 'linear-gradient(135deg, #14294B 0%, #0A1729 100%)',
                    border: '1px solid #24344F', boxShadow: '0 6px 18px rgba(10,23,41,.20)',
                    transition: 'transform .16s ease, box-shadow .16s ease',
                  }}
                >
                  {/* coral corner glow so it reads as clearly different from client cards */}
                  <span style={{ position: 'absolute', top: -40, right: -40, width: 130, height: 130, borderRadius: '50%', background: 'radial-gradient(circle, rgba(232,93,36,.35), transparent 70%)' }} />
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                      <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg, #E85D24, #C44A18)', display: 'grid', placeItems: 'center', flex: 'none', boxShadow: '0 2px 10px rgba(232,93,36,.5)' }}>
                        <Icon name="building" size={20} style={{ color: '#fff' }} />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 16, fontWeight: 750, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={g.name}>{g.name}</div>
                        <div style={{ fontSize: 11.5, color: '#93A9CC', marginTop: 2 }}>{g.clientCount} compan{g.clientCount === 1 ? 'y' : 'ies'}</div>
                      </div>
                    </div>
                    <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.6px', color: '#FFD9C7', background: 'rgba(232,93,36,.22)', border: '1px solid rgba(232,93,36,.4)', borderRadius: 20, padding: '3px 9px', flex: 'none' }}>GROUP</span>
                  </div>

                  <div style={{ display: 'flex', gap: 18, marginBottom: 14, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: '#7E93B4' }}>{groupYear} Spend</div>
                      <div className="mono" style={{ fontSize: 18, fontWeight: 750, color: '#fff', marginTop: 3 }}>{g.spend ? fmtLKR(g.spend) : '-'}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: '#7E93B4' }}>{groupYear} Target</div>
                      <div className="mono" style={{ fontSize: 18, fontWeight: 750, color: g.target ? '#C7D6EC' : '#5A6E8C', marginTop: 3 }}>{g.target ? fmtLKR(g.target) : 'Not set'}</div>
                    </div>
                  </div>

                  {g.target > 0 && (
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ height: 6, background: 'rgba(255,255,255,.10)', borderRadius: 6, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.min(100, pct || 0)}%`, background: pctColor, borderRadius: 6, transition: 'width .3s ease' }} />
                      </div>
                      <div style={{ marginTop: 5, fontSize: 11.5, fontWeight: 700, color: pctColor }}>{pct == null ? '-' : `${pct}% of target`}</div>
                    </div>
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4, fontSize: 12.5, fontWeight: 600, color: '#FF9A73' }}>
                    Open dashboard <Icon name="chevR" size={14} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {clients.length === 0 ? (
        <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--muted)', background: '#fff', border: '1px solid #E5E8ED', borderRadius: 14 }}>
          No clients yet. Add one to get started.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(248px, 1fr))', gap: 16 }}>
          {clients.map((c, i) => {
            const count = c._count?.channels || c.channelCount || 0;
            const color = AVATAR[(c.name.charCodeAt(0) + i) % AVATAR.length];
            return (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/clients/${c.id}/dashboard`)}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#C7D0DD'; e.currentTarget.style.boxShadow = '0 10px 26px rgba(15,31,61,.10)'; e.currentTarget.style.transform = 'translateY(-3px)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#E5E8ED'; e.currentTarget.style.boxShadow = '0 1px 2px rgba(15,31,61,.06)'; e.currentTarget.style.transform = 'none'; }}
                style={{ position: 'relative', overflow: 'hidden', background: '#fff', border: '1px solid #E5E8ED', borderRadius: 14, boxShadow: '0 1px 2px rgba(15,31,61,.06)', padding: 20, cursor: 'pointer', transition: 'transform .16s ease, box-shadow .16s ease, border-color .16s ease' }}
              >
                <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${color}, ${color}1A 70%, transparent)` }} />
                {canManage && (
                  <div className="row-actions" style={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: 4 }}>
                    <button className="act-btn" title="Edit client" onClick={e => openEdit(c, e)}><Icon name="edit" size={14} /></button>
                    {isSuperAdmin && (
                      <button className="act-btn" title="Delete client" style={{ color: 'var(--red-600,#dc2626)' }} onClick={e => openDelete(c, e)}><Icon name="x" size={14} /></button>
                    )}
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, paddingRight: canManage ? 52 : 0 }}>
                  <div style={{ width: 42, height: 42, borderRadius: 12, background: `linear-gradient(135deg, ${color}, ${color}CC)`, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 750, fontSize: 17, flex: 'none', boxShadow: `0 2px 8px ${color}55` }}>{c.name[0]?.toUpperCase()}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: '#16243C', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.name}>{c.name}</div>
                    <div style={{ fontSize: 11.5, color: '#93A0B5', marginTop: 2 }}>{count} channel{count !== 1 ? 's' : ''}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: '#93A0B5' }}>Total spend</div>
                    <div style={{ fontSize: 18, fontWeight: 750, fontFamily: "'Spline Sans Mono', monospace", color: '#16243C', marginTop: 3 }}>{c.totalSpend ? fmtLKR(c.totalSpend) : '-'}</div>
                  </div>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: '#D9521C' }}>Dashboard <Icon name="chevR" size={14} /></span>
                </div>
              </div>
            );
          })}
        </div>
      )}

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
