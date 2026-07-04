import { useState, useEffect, useCallback } from 'react';
import Icon from '../components/Icon';
import api from '../lib/api';
import OrbitLoader from '../components/OrbitLoader';

const fmtLKR = (v) => {
  if (v == null || v === '') return '-';
  const n = Number(v); const a = Math.abs(n);
  if (a >= 1e9) return 'LKR ' + (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return 'LKR ' + (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return 'LKR ' + (n / 1e3).toFixed(1) + 'K';
  return 'LKR ' + Math.round(n).toLocaleString('en-US');
};
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

function Detail({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: value ? 'var(--ink)' : 'var(--muted-2)' }}>{value || '-'}</div>
    </div>
  );
}

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

  // delete choice (for sent packages): deactivate vs permanently delete
  const [deletePrompt, setDeletePrompt] = useState(null); // the package object

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
  const [respDetail, setRespDetail] = useState(null);
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
    // Already sent → let the user choose deactivate vs permanent delete.
    if ((pkg._count?.recipients || 0) > 0) { setDeletePrompt(pkg); return; }
    if (!window.confirm(`Delete package "${pkg.name}"? This cannot be undone.`)) return;
    try { await api.delete(`/packages/${pkg.id}`); fetchPackages(); }
    catch (err) { setError(err.response?.data?.error || 'Failed to delete package.'); }
  };
  const forceDeletePkg = async (pkg) => {
    try { await api.delete(`/packages/${pkg.id}`, { params: { force: true } }); setDeletePrompt(null); fetchPackages(); }
    catch (err) { setError(err.response?.data?.error || 'Failed to delete package.'); setDeletePrompt(null); }
  };
  const deactivateFromPrompt = async (pkg) => {
    try { if (pkg.isActive) await api.patch(`/packages/${pkg.id}/toggle`); setDeletePrompt(null); fetchPackages(); }
    catch (err) { setError(err.response?.data?.error || 'Failed to deactivate package.'); setDeletePrompt(null); }
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
    setRespPkg(pkg); setResponses([]); setRespDetail(null); setRespLoading(true);
    try {
      const { data } = await api.get(`/packages/${pkg.id}/responses`);
      setResponses(data.recipients || []);
      setRespDetail(data.package || null);
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
        <OrbitLoader fullHeight label="Loading packages…" />
      ) : packages.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)' }}>
          <Icon name="folder" size={36} style={{ opacity: 0.25, marginBottom: 10 }} />
          <p>No packages yet. Create your first one.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 18 }}>
          {packages.map((p) => {
            const active = p.isActive !== false;
            const r = p.responses || {};
            return (
              <div key={p.id} style={{ background: '#fff', border: '1px solid #E5E8ED', borderRadius: 14, boxShadow: '0 1px 2px rgba(15,31,61,.06)', padding: 20, opacity: active ? 1 : 0.72 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15.5, fontWeight: 700, letterSpacing: '-.2px', color: '#16243C' }}>{p.name}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                      <span style={{ fontSize: 11.5, fontWeight: 600, color: '#3B4A63', background: '#EEF0F3', padding: '2px 9px', borderRadius: 6 }}>{p.category}</span>
                      <span style={{ fontSize: 12, color: '#93A0B5' }}>{p._count?.lineItems ?? 0} line items</span>
                    </div>
                  </div>
                  <span style={{ display: 'inline-block', fontSize: 10.5, fontWeight: 700, padding: '3px 9px', borderRadius: 20, background: active ? '#ECF8F1' : '#EEF0F3', color: active ? '#15814B' : '#93A0B5', whiteSpace: 'nowrap' }}>{active ? 'Active' : 'Inactive'}</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderTop: '1px solid #EEF0F3', borderBottom: '1px solid #EEF0F3' }}>
                  <span style={{ fontSize: 12.5, color: '#6B7790' }}>Package value</span>
                  <span style={{ fontSize: 18, fontWeight: 700, fontFamily: "'Spline Sans Mono', monospace", color: '#D9521C' }}>{fmtLKR(p.totalValue)}</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: '#15814B', background: '#ECF8F1', padding: '3px 9px', borderRadius: 7 }}>{r.interested ?? 0} Interested</span>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: '#9A5B00', background: '#FCF4E2', padding: '3px 9px', borderRadius: 7 }}>{r.negotiate ?? 0} Negotiate</span>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: '#93A0B5', background: '#EEF0F3', padding: '3px 9px', borderRadius: 7 }}>{r.declined ?? 0} Declined</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 16, paddingTop: 14, borderTop: '1px solid #EEF0F3' }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => openSend(p)}><Icon name="mail" size={14} /> Send</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => openResponses(p)}><Icon name="users" size={14} /> Responses</button>
                  <div style={{ flex: 1 }} />
                  <button className="act-btn" onClick={() => openEdit(p)} title="Edit"><Icon name="edit" size={15} /></button>
                  <button className="act-btn" onClick={() => togglePkg(p)} title={active ? 'Deactivate' : 'Activate'} style={{ color: active ? 'var(--muted)' : 'var(--green-600)' }}><Icon name="eye" size={15} /></button>
                  <button className="act-btn" onClick={() => deletePkg(p)} title="Delete" style={{ color: 'var(--red-600,#dc2626)' }}><Icon name="trash" size={15} /></button>
                </div>
              </div>
            );
          })}
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
                    <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Package name" />
                  </div>
                  <div className="field">
                    <label className="field-label">Category <span className="req">*</span></label>
                    <input className="input" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="Category" />
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

      {/* Delete choice modal (sent packages): deactivate vs permanent delete */}
      {deletePrompt && (
        <div className="modal-scrim show" onClick={(e) => { if (e.target === e.currentTarget) setDeletePrompt(null); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 470 }}>
            <div className="modal-head">
              <h2>Delete or deactivate?</h2>
              <button className="act-btn" onClick={() => setDeletePrompt(null)}><Icon name="x" size={18} /></button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13.5, color: 'var(--ink-soft,#3B4A63)', margin: 0, lineHeight: 1.5 }}>
                <strong style={{ color: 'var(--ink)' }}>{deletePrompt.name}</strong> has been sent to {deletePrompt._count?.recipients} team head(s). Choose how to remove it:
              </p>
              <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
                {deletePrompt.isActive && (
                  <button type="button" onClick={() => deactivateFromPrompt(deletePrompt)}
                    style={{ textAlign: 'left', padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--card)', cursor: 'pointer', display: 'block', width: '100%' }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--coral-400,#E8834F)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--ink)' }}>Deactivate</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Hide it from new use but keep the package and all response history.</div>
                  </button>
                )}
                <button type="button" onClick={() => forceDeletePkg(deletePrompt)}
                  style={{ textAlign: 'left', padding: '12px 14px', borderRadius: 10, border: '1px solid var(--red-200,#fecaca)', background: 'var(--red-50,#fef2f2)', cursor: 'pointer', display: 'block', width: '100%' }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--red-600,#dc2626)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--red-200,#fecaca)'; }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--red-700,#b91c1c)' }}>Delete permanently</div>
                  <div style={{ fontSize: 12, color: 'var(--red-700,#b91c1c)', opacity: 0.85, marginTop: 2 }}>Remove the package and its {deletePrompt._count?.recipients} response record(s) for good. Cannot be undone.</div>
                </button>
              </div>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn btn-ghost" onClick={() => setDeletePrompt(null)}>Cancel</button>
            </div>
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

      {/* Responses detail */}
      {respPkg && (
        <div className="modal-scrim show" onClick={(e) => { if (e.target === e.currentTarget) setRespPkg(null); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 1040 }}>
            <div className="modal-head">
              <div>
                <h2 style={{ margin: 0 }}>Responses - {respPkg.name}</h2>
                <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>
                  {respPkg.category}
                  {respDetail?.lineItems?.length ? ` · ${respDetail.lineItems.length} line items` : ''}
                  {(() => {
                    const val = respDetail?.lineItems?.reduce((s, li) => s + Number(li.rate || 0), 0);
                    return val ? ` · ${fmtLKR(val)}` : '';
                  })()}
                </div>
              </div>
              <button className="act-btn" onClick={() => setRespPkg(null)}><Icon name="x" size={18} /></button>
            </div>
            <div className="modal-body">
              {respLoading ? (
                <OrbitLoader label="Loading…" />
              ) : responses.length === 0 ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Not sent to anyone yet.</div>
              ) : (() => {
                const counts = { INTERESTED: 0, NEGOTIATE: 0, NOT_INTERESTED: 0, pending: 0 };
                responses.forEach((r) => { if (r.interest) counts[r.interest] += 1; else counts.pending += 1; });
                const responded = responses.filter((r) => r.respondedAt).length;
                const rate = Math.round((responded / responses.length) * 100);
                const SUMMARY = [
                  { label: 'Sent to', value: responses.length, bg: 'var(--bg-sunken)', fg: 'var(--ink)' },
                  { label: 'Interested', value: counts.INTERESTED, bg: 'var(--green-100)', fg: 'var(--green-600)' },
                  { label: 'Negotiate', value: counts.NEGOTIATE, bg: 'var(--coral-100)', fg: 'var(--coral-700)' },
                  { label: 'Not interested', value: counts.NOT_INTERESTED, bg: 'var(--bg-sunken)', fg: 'var(--muted)' },
                  { label: 'Awaiting', value: counts.pending, bg: 'var(--amber-50)', fg: '#9A5B00' },
                  { label: 'Response rate', value: `${rate}%`, bg: 'var(--blue-50)', fg: 'var(--blue-700)' },
                ];
                return (
                  <>
                    {/* Summary band */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 18 }}>
                      {SUMMARY.map((s) => (
                        <div key={s.label} style={{ background: s.bg, borderRadius: 10, padding: '12px 14px' }}>
                          <div style={{ fontSize: 22, fontWeight: 750, color: s.fg, fontFamily: "'Spline Sans Mono', monospace", lineHeight: 1 }}>{s.value}</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5 }}>{s.label}</div>
                        </div>
                      ))}
                    </div>

                    {/* Recipient detail cards */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {responses.map((r) => {
                        const it = r.interest ? INTEREST_LABEL[r.interest] : null;
                        const initials = (r.user?.name || '?').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
                        return (
                          <div key={r.id} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px', background: 'var(--card)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: r.respondedAt ? 12 : 0 }}>
                              <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--navy-900)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 13, flex: 'none' }}>{initials}</div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 14, fontWeight: 650, color: 'var(--ink)' }}>{r.user?.name}</div>
                                <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: "'Spline Sans Mono', monospace" }}>{r.user?.email}</div>
                              </div>
                              {it
                                ? <span style={{ fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 20, background: it.bg, color: it.fg }}>{it.label}</span>
                                : <span style={{ fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 20, background: 'var(--amber-50)', color: '#9A5B00' }}>Awaiting response</span>}
                            </div>

                            {r.respondedAt && (
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                                <Detail label="Client / brand" value={r.clientName} />
                                <Detail label="Budget note" value={r.budgetNote} />
                                <Detail label="Sent" value={fmtDate(r.sentAt || r.createdAt)} />
                                <Detail label="Responded" value={fmtDate(r.respondedAt)} />
                                {r.notes && (
                                  <div style={{ gridColumn: '1 / -1' }}>
                                    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 3 }}>Notes</div>
                                    <div style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.5, background: 'var(--bg)', borderRadius: 8, padding: '8px 11px' }}>{r.notes}</div>
                                  </div>
                                )}
                                <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 10 }}>
                                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>Follow-up:</span>
                                  <select className="select" value={r.followUp} onChange={(e) => setFollowUp(r.id, e.target.value)} style={{ fontSize: 12, width: 'auto' }}>
                                    {FOLLOW_UPS.map((f) => <option key={f} value={f}>{FOLLOW_LABEL[f]}</option>)}
                                  </select>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
