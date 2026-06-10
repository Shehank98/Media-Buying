import { useState, useEffect, useCallback } from 'react';
import Icon from '../components/Icon';
import api from '../lib/api';

const fmtLKR = (v) => (v == null || v === '' ? '-' : 'LKR ' + Math.round(Number(v)).toLocaleString('en-US'));
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-');

const INTEREST_LABEL = {
  INTERESTED: { label: 'Interested', bg: 'var(--green-100)', fg: 'var(--green-600)' },
  NEGOTIATE: { label: 'Negotiate', bg: 'var(--coral-100)', fg: 'var(--coral-700)' },
  NOT_INTERESTED: { label: 'Not interested', bg: 'var(--bg-sunken)', fg: 'var(--muted)' },
};
const FOLLOW_UPS = ['PENDING', 'FOLLOWED_UP', 'BOOKED', 'CLOSED'];
const FOLLOW_LABEL = { PENDING: 'Pending', FOLLOWED_UP: 'Followed up', BOOKED: 'Booked', CLOSED: 'Closed' };
const MAX_PDF_MB = 10;

const emptyForm = () => ({ name: '', category: '', emailIntro: '', lineItems: [{ label: '', rate: '' }] });

export default function PackagesPage() {
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // create/edit
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [formErr, setFormErr] = useState('');
  const [saving, setSaving] = useState(false);

  // send
  const [sendPkg, setSendPkg] = useState(null);
  const [groupHeads, setGroupHeads] = useState([]);
  const [recipientIds, setRecipientIds] = useState([]);
  const [pdf, setPdf] = useState(null); // { base64, name }
  const [sendErr, setSendErr] = useState('');
  const [sending, setSending] = useState(false);
  const [sendOk, setSendOk] = useState('');

  // responses
  const [respPkg, setRespPkg] = useState(null);
  const [responses, setResponses] = useState([]);
  const [respLoading, setRespLoading] = useState(false);

  const fetchPackages = useCallback(() => {
    setLoading(true);
    api.get('/packages')
      .then((r) => setPackages(r.data.packages || []))
      .catch(() => setError('Failed to load packages.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchPackages(); }, [fetchPackages]);

  // ── create / edit ──
  const openCreate = () => { setEditingId(null); setForm(emptyForm()); setFormErr(''); setShowForm(true); };
  const openEdit = async (pkg) => {
    setFormErr('');
    try {
      const { data } = await api.get(`/packages/${pkg.id}`);
      const p = data.package;
      setEditingId(p.id);
      setForm({
        name: p.name, category: p.category, emailIntro: p.emailIntro || '',
        lineItems: p.lineItems.length ? p.lineItems.map((li) => ({ label: li.label, rate: String(li.rate) })) : [{ label: '', rate: '' }],
      });
      setShowForm(true);
    } catch { setError('Failed to load package.'); }
  };

  const setLineItem = (idx, field, value) =>
    setForm((f) => ({ ...f, lineItems: f.lineItems.map((li, i) => (i === idx ? { ...li, [field]: value } : li)) }));
  const addLineItem = () => setForm((f) => ({ ...f, lineItems: [...f.lineItems, { label: '', rate: '' }] }));
  const removeLineItem = (idx) => setForm((f) => ({ ...f, lineItems: f.lineItems.filter((_, i) => i !== idx) }));

  const saveForm = async (e) => {
    e.preventDefault();
    setFormErr('');
    if (!form.name.trim() || !form.category.trim()) { setFormErr('Name and category are required.'); return; }
    setSaving(true);
    const payload = {
      name: form.name, category: form.category, emailIntro: form.emailIntro,
      lineItems: form.lineItems.filter((li) => li.label.trim()).map((li) => ({ label: li.label, rate: li.rate })),
    };
    try {
      if (editingId) await api.put(`/packages/${editingId}`, payload);
      else await api.post('/packages', payload);
      setShowForm(false);
      fetchPackages();
    } catch (err) {
      setFormErr(err.response?.data?.error || 'Failed to save package.');
    } finally { setSaving(false); }
  };

  const togglePkg = async (pkg) => {
    try { await api.patch(`/packages/${pkg.id}/toggle`); fetchPackages(); }
    catch (err) { setError(err.response?.data?.error || 'Failed to toggle package.'); }
  };
  const deletePkg = async (pkg) => {
    if (!window.confirm(`Delete package "${pkg.name}"? This cannot be undone.`)) return;
    try { await api.delete(`/packages/${pkg.id}`); fetchPackages(); }
    catch (err) { setError(err.response?.data?.error || 'Failed to delete package.'); }
  };

  // ── send ──
  const openSend = async (pkg) => {
    setSendPkg(pkg); setRecipientIds([]); setPdf(null); setSendErr(''); setSendOk('');
    try {
      const { data } = await api.get('/packages/recipients/group-heads');
      setGroupHeads(data.users || []);
    } catch { setGroupHeads([]); }
  };
  const onPdfChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) { setPdf(null); return; }
    if (file.size > MAX_PDF_MB * 1024 * 1024) { setSendErr(`PDF must be under ${MAX_PDF_MB}MB.`); e.target.value = ''; return; }
    setSendErr('');
    const reader = new FileReader();
    reader.onload = () => setPdf({ base64: String(reader.result).split(',')[1], name: file.name });
    reader.readAsDataURL(file);
  };
  const doSend = async () => {
    setSendErr(''); setSendOk('');
    if (recipientIds.length === 0) { setSendErr('Select at least one team head.'); return; }
    setSending(true);
    try {
      const { data } = await api.post(`/packages/${sendPkg.id}/send`, {
        recipientUserIds: recipientIds,
        pdfBase64: pdf?.base64 || null,
        pdfFileName: pdf?.name || null,
      });
      setSendOk(data.message || 'Package sent.');
      fetchPackages();
    } catch (err) {
      setSendErr(err.response?.data?.error || 'Failed to send package.');
    } finally { setSending(false); }
  };

  // ── responses ──
  const openResponses = async (pkg) => {
    setRespPkg(pkg); setResponses([]); setRespLoading(true);
    try {
      const { data } = await api.get(`/packages/${pkg.id}/responses`);
      setResponses(data.recipients || []);
    } catch { setError('Failed to load responses.'); }
    finally { setRespLoading(false); }
  };
  const setFollowUp = async (recipientId, followUp) => {
    setResponses((prev) => prev.map((r) => (r.id === recipientId ? { ...r, followUp } : r)));
    try { await api.patch(`/packages/recipients/${recipientId}/follow-up`, { followUp }); }
    catch { setError('Failed to update follow-up.'); }
  };

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h1 className="page-title">Media Packages</h1>
          <p className="page-sub">Create packages, send them to team heads, and track responses</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}><Icon name="plus" size={16} /> New package</button>
      </div>

      {error && (
        <div style={{ background: 'var(--red-50,#fef2f2)', border: '1px solid var(--red-200,#fecaca)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--red-700,#b91c1c)', marginBottom: 16 }}>
          {error}
          <button onClick={() => setError('')} style={{ marginLeft: 8, fontWeight: 600, textDecoration: 'underline', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>Dismiss</button>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)' }}>Loading…</div>
      ) : packages.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)' }}>
          <Icon name="folder" size={36} style={{ opacity: 0.25, marginBottom: 10 }} />
          <p>No packages yet. Create your first one.</p>
        </div>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Package</th><th>Category</th><th>Items</th><th>Sent</th><th>Status</th><th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {packages.map((p) => (
                <tr key={p.id} style={{ opacity: p.isActive === false ? 0.55 : 1 }}>
                  <td className="strong">{p.name}</td>
                  <td style={{ color: 'var(--muted)' }}>{p.category}</td>
                  <td style={{ color: 'var(--muted)' }}>{p._count?.lineItems ?? 0}</td>
                  <td style={{ color: 'var(--muted)' }}>{p._count?.recipients ?? 0}</td>
                  <td>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: p.isActive === false ? 'var(--bg-sunken)' : 'var(--green-100)', color: p.isActive === false ? 'var(--muted)' : 'var(--green-600)' }}>
                      {p.isActive === false ? 'Inactive' : 'Active'}
                    </span>
                  </td>
                  <td>
                    <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => openSend(p)} title="Send"><Icon name="mail" size={14} /> Send</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => openResponses(p)} title="Responses"><Icon name="users" size={14} /> Responses</button>
                      <button className="act-btn" onClick={() => openEdit(p)} title="Edit"><Icon name="edit" size={15} /></button>
                      <button className="act-btn" onClick={() => togglePkg(p)} title={p.isActive === false ? 'Activate' : 'Deactivate'} style={{ color: p.isActive === false ? 'var(--green-600)' : 'var(--muted)' }}><Icon name="eye" size={15} /></button>
                      <button className="act-btn" onClick={() => deletePkg(p)} title="Delete" style={{ color: 'var(--red-600,#dc2626)' }}><Icon name="trash" size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / Edit modal */}
      {showForm && (
        <div className="modal-scrim show" onClick={(e) => { if (e.target === e.currentTarget) setShowForm(false); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <div className="modal-head">
              <h2>{editingId ? 'Edit Package' : 'New Package'}</h2>
              <button className="act-btn" onClick={() => setShowForm(false)}><Icon name="x" size={18} /></button>
            </div>
            <form onSubmit={saveForm}>
              <div className="modal-body">
                {formErr && <div style={{ background: 'var(--red-50,#fef2f2)', border: '1px solid var(--red-200,#fecaca)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--red-700,#b91c1c)', marginBottom: 16 }}>{formErr}</div>}
                <div className="field-grid2">
                  <div className="field">
                    <label className="field-label">Name <span className="req">*</span></label>
                    <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="FIFA World Cup 2026 — Terrestrial" />
                  </div>
                  <div className="field">
                    <label className="field-label">Category <span className="req">*</span></label>
                    <input className="input" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="FIFA partners / spot buying" />
                  </div>
                </div>
                <div className="field">
                  <label className="field-label">Email intro</label>
                  <textarea className="input" rows={3} value={form.emailIntro} onChange={(e) => setForm((f) => ({ ...f, emailIntro: e.target.value }))} placeholder="Short intro shown in the email body…" />
                </div>
                <div className="field">
                  <label className="field-label">Line items</label>
                  {form.lineItems.map((li, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                      <input className="input" style={{ flex: 2 }} value={li.label} onChange={(e) => setLineItem(idx, 'label', e.target.value)} placeholder="Item / slot" />
                      <input className="input" style={{ flex: 1 }} type="number" step="0.01" value={li.rate} onChange={(e) => setLineItem(idx, 'rate', e.target.value)} placeholder="Rate (LKR)" />
                      <button type="button" className="act-btn" onClick={() => removeLineItem(idx)} title="Remove" style={{ color: 'var(--red-600,#dc2626)' }}><Icon name="x" size={15} /></button>
                    </div>
                  ))}
                  <button type="button" className="btn btn-ghost btn-sm" onClick={addLineItem}><Icon name="plus" size={14} /> Add line item</button>
                </div>
              </div>
              <div className="modal-foot">
                <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Save Changes' : 'Create Package'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Send modal */}
      {sendPkg && (
        <div className="modal-scrim show" onClick={(e) => { if (e.target === e.currentTarget) setSendPkg(null); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <div className="modal-head">
              <h2>Send "{sendPkg.name}"</h2>
              <button className="act-btn" onClick={() => setSendPkg(null)}><Icon name="x" size={18} /></button>
            </div>
            <div className="modal-body">
              {sendErr && <div style={{ background: 'var(--red-50,#fef2f2)', border: '1px solid var(--red-200,#fecaca)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--red-700,#b91c1c)', marginBottom: 14 }}>{sendErr}</div>}
              {sendOk && <div style={{ background: 'var(--green-100)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--green-600)', marginBottom: 14, fontWeight: 600 }}>{sendOk}</div>}
              <div className="field">
                <label className="field-label">Team heads <span className="req">*</span></label>
                {groupHeads.length === 0 ? (
                  <p style={{ color: 'var(--muted)', fontSize: 13 }}>No GROUP_HEAD users found.</p>
                ) : (
                  <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                    {groupHeads.map((u) => (
                      <label key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
                        <input type="checkbox" checked={recipientIds.includes(u.id)} onChange={(e) => setRecipientIds((prev) => e.target.checked ? [...prev, u.id] : prev.filter((id) => id !== u.id))} />
                        <span style={{ flex: 1 }}><span className="strong" style={{ fontSize: 13 }}>{u.name}</span> <span style={{ color: 'var(--muted)', fontSize: 12 }}>{u.email}</span></span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div className="field">
                <label className="field-label">Attach PDF</label>
                <input type="file" accept="application/pdf" onChange={onPdfChange} />
                {pdf && <span style={{ fontSize: 12, color: 'var(--green-600)', display: 'block', marginTop: 4 }}>Attached: {pdf.name}</span>}
                <span style={{ fontSize: 11.5, color: 'var(--muted)', display: 'block', marginTop: 4 }}>The PDF is attached to the email live and never stored. Max {MAX_PDF_MB}MB.</span>
              </div>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn btn-ghost" onClick={() => setSendPkg(null)}>Close</button>
              <button type="button" className="btn btn-primary" onClick={doSend} disabled={sending}>{sending ? 'Sending…' : `Send to ${recipientIds.length || ''} team head(s)`}</button>
            </div>
          </div>
        </div>
      )}

      {/* Responses modal */}
      {respPkg && (
        <div className="modal-scrim show" onClick={(e) => { if (e.target === e.currentTarget) setRespPkg(null); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 980 }}>
            <div className="modal-head">
              <h2>Responses — {respPkg.name}</h2>
              <button className="act-btn" onClick={() => setRespPkg(null)}><Icon name="x" size={18} /></button>
            </div>
            <div className="modal-body" style={{ padding: 0 }}>
              {respLoading ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading…</div>
              ) : responses.length === 0 ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Not sent to anyone yet.</div>
              ) : (
                <div className="tbl-wrap" style={{ margin: 0 }}>
                  <table className="tbl" style={{ fontSize: 13 }}>
                    <thead>
                      <tr><th>Team head</th><th>Interest</th><th>Client</th><th>Budget</th><th>Notes</th><th>Responded</th><th>Follow-up</th></tr>
                    </thead>
                    <tbody>
                      {responses.map((r) => {
                        const it = r.interest ? INTEREST_LABEL[r.interest] : null;
                        return (
                          <tr key={r.id}>
                            <td><div className="strong" style={{ fontSize: 12.5 }}>{r.user?.name}</div><div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.user?.email}</div></td>
                            <td>{it ? <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: it.bg, color: it.fg }}>{it.label}</span> : <span style={{ color: 'var(--muted-2)' }}>No response</span>}</td>
                            <td style={{ color: 'var(--muted)' }}>{r.clientName || '-'}</td>
                            <td style={{ color: 'var(--muted)' }}>{r.budgetNote || '-'}</td>
                            <td style={{ color: 'var(--muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.notes || ''}>{r.notes || '-'}</td>
                            <td style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{fmtDate(r.respondedAt)}</td>
                            <td>
                              <select className="select" value={r.followUp} onChange={(e) => setFollowUp(r.id, e.target.value)} disabled={!r.respondedAt} style={{ fontSize: 12 }}>
                                {FOLLOW_UPS.map((f) => <option key={f} value={f}>{FOLLOW_LABEL[f]}</option>)}
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
