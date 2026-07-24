import { useState, useEffect, useMemo } from 'react';
import api from '../lib/api';
import Icon from './Icon';
import OrbitLoader from './OrbitLoader';

const nowYear = new Date().getFullYear();
const fmtLKR = (v) => (v == null ? '-' : 'LKR ' + Math.round(Number(v)).toLocaleString('en-US'));
// Comma-formatted money input helpers.
const cleanMoney = (s) => { const c = String(s).replace(/[^0-9.]/g, ''); return c === '' ? '' : c; };
const fmtMoneyInput = (s) => {
  if (s === '' || s == null) return '';
  const [i, d] = String(s).split('.');
  const gi = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return d != null ? `${gi}.${d}` : gi;
};

// Admin management of parent-company client groups + their annual targets.
export default function ClientGroupsTab({ agencies = [], allClients = [] }) {
  const [year, setYear] = useState(nowYear);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [targetDrafts, setTargetDrafts] = useState({}); // groupId -> string
  const [savingTarget, setSavingTarget] = useState(null);

  // create modal
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ agencyId: '', name: '' });
  const [creating, setCreating] = useState(false);

  // rename + assign-clients modal
  const [editing, setEditing] = useState(null); // the group being edited
  const [editName, setEditName] = useState('');
  const [pickedClients, setPickedClients] = useState([]); // ids
  const [savingEdit, setSavingEdit] = useState(false);
  const [clientSearch, setClientSearch] = useState('');

  const yearOptions = useMemo(() => {
    const out = [];
    for (let y = nowYear + 1; y >= nowYear - 5; y--) out.push(y);
    return out;
  }, []);

  const fetchGroups = () => {
    setLoading(true);
    api.get('/admin/client-groups', { params: { year } })
      .then(r => {
        const g = r.data.groups || [];
        setGroups(g);
        const d = {};
        g.forEach(x => { d[x.id] = x.target != null ? fmtMoneyInput(String(x.target)) : ''; });
        setTargetDrafts(d);
      })
      .catch(() => setError('Failed to load client groups.'))
      .finally(() => setLoading(false));
  };
  useEffect(fetchGroups, [year]); // eslint-disable-line react-hooks/exhaustive-deps

  const createGroup = async () => {
    if (!createForm.agencyId || !createForm.name.trim()) { setError('Pick an agency and enter a name.'); return; }
    setCreating(true);
    try {
      await api.post('/admin/client-groups', { agencyId: Number(createForm.agencyId), name: createForm.name.trim() });
      setShowCreate(false); setCreateForm({ agencyId: '', name: '' }); setError('');
      fetchGroups();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create group.');
    } finally { setCreating(false); }
  };

  const openEdit = (g) => {
    setEditing(g);
    setEditName(g.name);
    setPickedClients(g.clients.map(c => c.id));
    setClientSearch('');
  };
  const saveEdit = async () => {
    if (!editName.trim()) { setError('Group name is required.'); return; }
    setSavingEdit(true);
    try {
      if (editName.trim() !== editing.name) await api.put(`/admin/client-groups/${editing.id}`, { name: editName.trim() });
      await api.post(`/admin/client-groups/${editing.id}/clients`, { clientIds: pickedClients });
      setEditing(null); setError('');
      fetchGroups();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save group.');
    } finally { setSavingEdit(false); }
  };

  const deleteGroup = async (g) => {
    if (!window.confirm(`Delete "${g.name}"? Its clients stay, just ungrouped.`)) return;
    try {
      await api.delete(`/admin/client-groups/${g.id}`);
      fetchGroups();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete group.');
    }
  };

  const saveTarget = async (g) => {
    const raw = (targetDrafts[g.id] || '').replace(/,/g, '');
    if (raw === (g.target != null ? String(g.target) : '')) return; // unchanged
    setSavingTarget(g.id);
    try {
      await api.post(`/admin/client-groups/${g.id}/target`, { year, amount: raw === '' ? null : Number(raw) });
      setGroups(prev => prev.map(x => x.id === g.id ? { ...x, target: raw === '' ? null : Number(raw) } : x));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save target.');
    } finally { setSavingTarget(null); }
  };

  // Clients selectable in the edit modal: the group's own agency, minus clients
  // already in a *different* group (so one client belongs to one group).
  const editableClients = useMemo(() => {
    if (!editing) return [];
    const otherGroupClientIds = new Set(groups.filter(g => g.id !== editing.id).flatMap(g => g.clients.map(c => c.id)));
    return allClients
      .filter(c => c.agencyId === editing.agencyId && !otherGroupClientIds.has(c.id))
      .filter(c => c.name.toLowerCase().includes(clientSearch.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [editing, groups, allClients, clientSearch]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', maxWidth: 560, lineHeight: 1.5 }}>
          Group clients under a parent company (e.g. Maliban Group). Set an annual target on the group; the agency view rolls up each group&rsquo;s sub-client spend against it. Clients keep working individually.
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select className="select" value={year} onChange={e => setYear(Number(e.target.value))} style={{ maxWidth: 120 }} title="Target year">
            {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}><Icon name="plus" size={14} /> New group</button>
        </div>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#b91c1c', marginBottom: 14 }}>
          {error}<button onClick={() => setError('')} style={{ marginLeft: 8, fontWeight: 600, textDecoration: 'underline', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>Dismiss</button>
        </div>
      )}

      {loading ? <OrbitLoader label="Loading groups…" /> : groups.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '44px 0', color: 'var(--muted)' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>No client groups yet</div>
          <div style={{ fontSize: 12.5 }}>Create one to group sub-clients under a parent company.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {groups.map(g => (
            <div key={g.id} className="card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 220 }}>
                  <div style={{ fontSize: 15, fontWeight: 720, color: 'var(--ink)' }}>{g.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{g.agencyName} · {g.clientCount} client{g.clientCount !== 1 ? 's' : ''}</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                    {g.clients.length === 0 ? <span style={{ fontSize: 12, color: '#C7D0DD' }}>No clients assigned</span> : g.clients.map(c => (
                      <span key={c.id} style={{ fontSize: 11.5, fontWeight: 600, background: '#EEF0F3', color: '#4A5A72', padding: '3px 9px', borderRadius: 20 }}>{c.name}</span>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase', color: '#93A0B5', marginBottom: 3 }}>{year} Target (LKR)</div>
                    <input
                      className="input mono"
                      inputMode="decimal"
                      value={targetDrafts[g.id] ?? ''}
                      placeholder="0"
                      onChange={e => { const c = cleanMoney(e.target.value); setTargetDrafts(p => ({ ...p, [g.id]: fmtMoneyInput(c) })); }}
                      onBlur={() => saveTarget(g)}
                      style={{ width: 170, height: 34, textAlign: 'right' }}
                    />
                    {savingTarget === g.id && <span style={{ fontSize: 10.5, color: '#93A0B5', marginLeft: 6 }}>Saving…</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => openEdit(g)}><Icon name="edit" size={13} /> Clients</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => deleteGroup(g)} style={{ color: 'var(--red-600,#dc2626)' }}><Icon name="trash" size={13} /></button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="modal-scrim show" onClick={e => { if (e.target === e.currentTarget) setShowCreate(false); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2 style={{ margin: 0 }}>New client group</h2>
              <button className="act-btn" onClick={() => setShowCreate(false)}><Icon name="x" size={18} /></button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label className="field-label">Agency <span className="req">*</span></label>
                <select className="select" value={createForm.agencyId} onChange={e => setCreateForm(p => ({ ...p, agencyId: e.target.value }))} autoFocus>
                  <option value="">Select agency</option>
                  {agencies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="field-label">Group name <span className="req">*</span></label>
                <input className="input" value={createForm.name} onChange={e => setCreateForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Maliban Group" />
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={createGroup} disabled={creating}>{creating ? 'Creating…' : 'Create group'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit (rename + assign clients) modal */}
      {editing && (
        <div className="modal-scrim show" onClick={e => { if (e.target === e.currentTarget) setEditing(null); }}>
          <div className="modal" style={{ maxWidth: 560, width: '92vw' }} onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h2 style={{ margin: 0 }}>{editing.name}</h2>
                <p style={{ margin: '3px 0 0', fontSize: 12.5, color: 'var(--muted)' }}>{editing.agencyName} · pick the sub-clients in this group</p>
              </div>
              <button className="act-btn" onClick={() => setEditing(null)}><Icon name="x" size={18} /></button>
            </div>
            <div className="modal-body" style={{ maxHeight: '62vh', overflow: 'auto' }}>
              <div className="field">
                <label className="field-label">Group name</label>
                <input className="input" value={editName} onChange={e => setEditName(e.target.value)} />
              </div>
              <div className="field">
                <label className="field-label">Clients ({pickedClients.length} selected)</label>
                <div style={{ position: 'relative', marginBottom: 8 }}>
                  <Icon name="search" size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
                  <input className="input" placeholder="Search clients…" value={clientSearch} onChange={e => setClientSearch(e.target.value)} style={{ paddingLeft: 30 }} />
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {editableClients.length === 0 ? (
                    <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>No available clients in this agency.</span>
                  ) : editableClients.map(c => {
                    const on = pickedClients.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setPickedClients(p => on ? p.filter(x => x !== c.id) : [...p, c.id])}
                        style={{
                          border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, padding: '6px 11px', borderRadius: 20, fontFamily: 'inherit',
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          background: on ? '#0F1F3D' : '#EEF0F3', color: on ? '#fff' : '#6B7790',
                        }}
                      >
                        {c.name}<Icon name={on ? 'check' : 'plus'} size={11} />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveEdit} disabled={savingEdit}>{savingEdit ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
