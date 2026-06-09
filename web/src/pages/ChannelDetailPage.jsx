import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Icon, { Avatar, TypeBadge, fmtLKR } from '../components/Icon';
import api from '../lib/api';

const CHANNEL_ICON = {
  TV:    { icon: 'tv',    bg: 'var(--blue-50)',  fg: 'var(--blue-700)' },
  RADIO: { icon: 'radio', bg: 'var(--coral-50)', fg: 'var(--coral-700)' },
  PRINT: { icon: 'print', bg: 'var(--green-50)', fg: 'var(--green-600)' },
};

const canModify = (role) =>
  ['PLANNER', 'GROUP_HEAD', 'SUPER_ADMIN'].includes(role);

const fmtDate = (iso) => {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

const fmtTime = (iso) => {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

export default function ChannelDetailPage() {
  const { channelId } = useParams();
  const { user } = useAuth();

  const [channel, setChannel] = useState(null);
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Add/Edit property modal
  const [showModal, setShowModal] = useState(false);
  const [editingProperty, setEditingProperty] = useState(null);
  const [propertyForm, setPropertyForm] = useState({
    name: '',
    type: 'BOUGHT_AIRTIME',
    cost: '',
    notes: '',
    changeNote: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // History panel
  const [panel, setPanel] = useState(null);
  const [historyData, setHistoryData] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Delete confirmation
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletingProperty, setDeletingProperty] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const fetchData = async () => {
    try {
      const [channelRes, propertiesRes] = await Promise.all([
        api.get(`/channels/${channelId}`),
        api.get(`/channels/${channelId}/properties`),
      ]);
      setChannel(channelRes.data.channel || channelRes.data);
      const rawProps = propertiesRes.data.properties || propertiesRes.data;
      setProperties(Array.isArray(rawProps) ? rawProps : []);
    } catch (err) {
      setError('Failed to load channel details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [channelId]);

  const openAddModal = () => {
    setEditingProperty(null);
    setPropertyForm({ name: '', type: 'BOUGHT_AIRTIME', cost: '', notes: '', changeNote: '' });
    setFormError('');
    setShowModal(true);
  };

  const openEditModal = (property) => {
    setEditingProperty(property);
    setPropertyForm({
      name: property.name,
      type: property.type,
      cost: property.cost?.toString() || '',
      notes: property.notes || '',
      changeNote: '',
    });
    setFormError('');
    setShowModal(true);
  };

  const handlePropertySubmit = async (e) => {
    e.preventDefault();
    setFormError('');

    if (!propertyForm.name.trim()) {
      setFormError('Property name is required.');
      return;
    }

    if (!propertyForm.cost || isNaN(Number(propertyForm.cost)) || Number(propertyForm.cost) < 0) {
      setFormError('Please enter a valid cost.');
      return;
    }

    if (editingProperty && !propertyForm.changeNote.trim()) {
      setFormError('Change note is required when editing a property.');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        name: propertyForm.name,
        type: propertyForm.type,
        cost: Number(propertyForm.cost),
        notes: propertyForm.notes,
      };

      if (editingProperty) {
        payload.changeNote = propertyForm.changeNote;
        await api.put(`/properties/${editingProperty.id}`, payload);
      } else {
        await api.post(`/channels/${channelId}/properties`, payload);
      }

      setShowModal(false);
      await fetchData();
    } catch (err) {
      setFormError(err.response?.data?.error || err.response?.data?.message || 'Failed to save property.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingProperty) return;
    setDeleting(true);
    try {
      await api.delete(`/properties/${deletingProperty.id}`);
      setShowDeleteModal(false);
      setDeletingProperty(null);
      await fetchData();
    } catch (err) {
      setFormError(err.response?.data?.error || err.response?.data?.message || 'Failed to delete property.');
    } finally {
      setDeleting(false);
    }
  };

  const openHistory = async (property) => {
    setPanel(property);
    setHistoryLoading(true);
    setHistoryData([]);
    try {
      const { data } = await api.get(`/properties/${property.id}/history`);
      const rawH = data.history || data;
      setHistoryData(Array.isArray(rawH) ? rawH : []);
    } catch {
      setHistoryData([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="content-narrow fade-in" style={{ padding: '80px 0', textAlign: 'center', color: 'var(--muted)' }}>
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div className="content-narrow fade-in" style={{ padding: '40px 0' }}>
        <div style={{ background: 'var(--red-100, #fee)', border: '1px solid var(--red-200, #fcc)', borderRadius: 10, padding: 16, color: 'var(--red-600, #c00)' }}>
          {error}
        </div>
      </div>
    );
  }

  const ci = CHANNEL_ICON[channel?.type] || CHANNEL_ICON.TV;
  const clientName = channel?.client?.name || channel?.clientName || 'Client';
  const totalCost = properties.reduce((sum, p) => sum + (Number(p.cost) || 0), 0);

  return (
    <div className="content-narrow fade-in">
      {/* Header */}
      <div className="page-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: ci.bg, color: ci.fg, flexShrink: 0,
          }}>
            <Icon name={ci.icon} size={20} />
          </div>
          <div>
            <h1 className="page-title">{channel?.name}</h1>
            <div className="page-sub">
              <Link to={`/clients/${channel?.clientId}`} style={{ color: 'var(--coral-600)', textDecoration: 'none', fontWeight: 600 }}>
                {clientName}
              </Link>
              {' '}&middot; {properties.length} {properties.length === 1 ? 'property' : 'properties'} &middot; {fmtLKR(totalCost)}
            </div>
          </div>
        </div>
        {canModify(user?.role) && (
          <button className="btn btn-primary" onClick={openAddModal}>
            <Icon name="plus" size={16} />
            Add property
          </button>
        )}
      </div>

      {/* Properties table */}
      <div className="tbl-wrap">
        {properties.length === 0 ? (
          <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--muted)', fontSize: 13.5 }}>
            No properties yet. Add one to get started.
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Property name</th>
                <th>Type</th>
                <th className="num">Cost (LKR)</th>
                <th>Added by</th>
                <th>Date</th>
                <th className="num">Actions</th>
              </tr>
            </thead>
            <tbody>
              {properties.map((property) => (
                <tr key={property.id}>
                  <td className="strong">{property.name}</td>
                  <td><TypeBadge type={property.type} /></td>
                  <td className="num mono">
                    {Number(property.cost) === 0
                      ? <span style={{ color: 'var(--green-600)', fontWeight: 600 }}>Added value</span>
                      : fmtLKR(property.cost)}
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Avatar name={property.createdBy?.name || property.createdByName || '-'} size={24} />
                      <span>{property.createdBy?.name || property.createdByName || '-'}</span>
                    </div>
                  </td>
                  <td>{fmtDate(property.createdAt)}</td>
                  <td>
                    <div className="row-actions">
                      {canModify(user?.role) && (
                        <>
                          <button className="act-btn" title="Edit" onClick={() => openEditModal(property)}>
                            <Icon name="edit" size={16} />
                          </button>
                          <button className="act-btn" title="Delete" onClick={() => { setDeletingProperty(property); setShowDeleteModal(true); }}>
                            <Icon name="trash" size={16} />
                          </button>
                        </>
                      )}
                      <button className="act-btn" title="History" onClick={() => openHistory(property)}>
                        <Icon name="history" size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>Total committed</td>
                <td className="num mono">{fmtLKR(totalCost)}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* History slide-out panel */}
      <div className={`scrim${panel ? ' show' : ''}`} onClick={() => setPanel(null)} />
      <div className={`panel${panel ? ' show' : ''}`}>
        <div className="panel-head">
          <div style={{ flex: 1 }}>
            <div className="panel-title">Change history</div>
            <div className="panel-sub">{panel?.name} &middot; {channel?.name}</div>
          </div>
          <button className="icon-btn" style={{ border: 'none', background: 'var(--bg-sunken)' }} onClick={() => setPanel(null)}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="panel-body">
          {historyLoading ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
              Loading history...
            </div>
          ) : historyData.length === 0 ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
              No history available.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18, fontSize: 12.5, color: 'var(--muted)' }}>
                <Icon name="history" size={15} />
                {historyData.length} changes &middot; newest first
              </div>
              <div className="timeline">
                {historyData.map((h, i) => {
                  const prev = h.previousValues || {};
                  const next = h.newValues || {};
                  const changedFields = Object.keys(next).filter(
                    (k) => String(next[k]) !== String(prev[k] ?? '')
                  );
                  return (
                    <div className={`tl-item${i === historyData.length - 1 ? ' old' : ''}`} key={h.id || i}>
                      <div className="tl-node" />
                      <div className="tl-meta">
                        <span className="tl-date">{fmtDate(h.changedAt)}</span>
                        <span className="tl-who">{fmtTime(h.changedAt)} &middot; by {h.changer?.name || h.changedBy || 'Unknown'}</span>
                      </div>
                      <div className="tl-change">
                        {changedFields.length > 0 ? changedFields.map((field) => (
                          <div key={field} style={{ marginBottom: 6 }}>
                            <div className="tl-field">{field}</div>
                            <div className="tl-vals">
                              {prev[field] !== undefined && prev[field] !== null ? (
                                <>
                                  <span className="tl-old">{String(prev[field])}</span>
                                  <span className="tl-arrow"><Icon name="chevR" size={15} /></span>
                                </>
                              ) : null}
                              <span className="tl-new">{String(next[field])}</span>
                            </div>
                          </div>
                        )) : (
                          <div className="tl-field">Updated</div>
                        )}
                        {h.changeNote && <div className="tl-note">{h.changeNote}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Add/Edit Property Modal */}
      {showModal && (
        <div className="modal-scrim show" onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}>
          <div className="modal" style={{ width: 500 }}>
            <div className="modal-head">
              <div>
                <div style={{ fontSize: 17, fontWeight: 720, color: 'var(--ink)', letterSpacing: '-.3px' }}>
                  {editingProperty ? 'Edit property' : 'Add property'}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>
                  {clientName} &middot; {channel?.name}
                </div>
              </div>
              <button className="icon-btn" style={{ border: 'none', background: 'var(--bg-sunken)' }} onClick={() => setShowModal(false)}>
                <Icon name="x" size={18} />
              </button>
            </div>
            <form onSubmit={handlePropertySubmit}>
              <div className="modal-body">
                {formError && (
                  <div className="field-err" style={{ marginBottom: 14, fontSize: 12.5, padding: '8px 10px', background: 'var(--red-100, #fee)', borderRadius: 6 }}>
                    <Icon name="alert" size={14} />
                    {formError}
                  </div>
                )}

                <div className="field">
                  <label className="field-label">
                    Property name<span className="req">*</span>
                  </label>
                  <input
                    className="input"
                    type="text"
                    placeholder="Property name"
                    value={propertyForm.name}
                    onChange={(e) => setPropertyForm((prev) => ({ ...prev, name: e.target.value }))}
                  />
                </div>

                <div className="field-grid2">
                  <div className="field">
                    <label className="field-label">Type</label>
                    <select
                      className="select"
                      value={propertyForm.type}
                      onChange={(e) => setPropertyForm((prev) => ({ ...prev, type: e.target.value }))}
                    >
                      <option value="BOUGHT_AIRTIME">Bought Airtime</option>
                      <option value="SPONSORSHIP">Sponsorship</option>
                      <option value="BONUS_COMMERCIAL">Bonus Commercial</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </div>

                  <div className="field">
                    <label className="field-label">Cost (LKR)</label>
                    <input
                      className="input"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0"
                      value={propertyForm.cost}
                      onChange={(e) => setPropertyForm((prev) => ({ ...prev, cost: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="field">
                  <label className="field-label">Notes</label>
                  <textarea
                    className="textarea"
                    rows={3}
                    placeholder="Optional notes..."
                    value={propertyForm.notes}
                    onChange={(e) => setPropertyForm((prev) => ({ ...prev, notes: e.target.value }))}
                  />
                </div>

                {editingProperty && (
                  <div className="field">
                    <label className="field-label">
                      Change note<span className="req">*</span>
                    </label>
                    <textarea
                      className="textarea"
                      rows={2}
                      placeholder="Describe what changed and why..."
                      value={propertyForm.changeNote}
                      onChange={(e) => setPropertyForm((prev) => ({ ...prev, changeNote: e.target.value }))}
                    />
                  </div>
                )}
              </div>
              <div className="modal-foot">
                <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  <Icon name="check" size={16} />
                  {submitting ? 'Saving...' : editingProperty ? 'Save changes' : 'Add property'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="modal-scrim show" onClick={(e) => { if (e.target === e.currentTarget) { setShowDeleteModal(false); setDeletingProperty(null); } }}>
          <div className="modal" style={{ width: 420 }}>
            <div className="modal-head">
              <div>
                <div style={{ fontSize: 17, fontWeight: 720, color: 'var(--ink)', letterSpacing: '-.3px' }}>Delete property</div>
                <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>{deletingProperty?.name}</div>
              </div>
              <button className="icon-btn" style={{ border: 'none', background: 'var(--bg-sunken)' }} onClick={() => { setShowDeleteModal(false); setDeletingProperty(null); }}>
                <Icon name="x" size={18} />
              </button>
            </div>
            <div className="modal-body">
              <p style={{ color: 'var(--ink-soft)', fontSize: 13.5, margin: 0, lineHeight: 1.6 }}>
                Are you sure you want to delete <strong style={{ color: 'var(--ink)' }}>{deletingProperty?.name}</strong>? This action cannot be undone.
              </p>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn btn-ghost" onClick={() => { setShowDeleteModal(false); setDeletingProperty(null); }}>Cancel</button>
              <button className="btn" style={{ background: 'var(--red-600, #dc2626)', color: '#fff' }} disabled={deleting} onClick={handleDelete}>
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
