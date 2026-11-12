// Admin → Forecasting → "Forecast windows": open or close any month for Hub
// heads (all, or selected), with an optional deadline after which the month
// locks by itself. Without a window the calendar rule still applies (current
// month through the 19th, next month from the 20th). Opening can notify the
// Hub heads in-app + by email. Backed by GET/POST/DELETE /forecasting/windows.
import { useEffect, useMemo, useState } from 'react';
import Icon from './Icon';
import OrbitLoader from './OrbitLoader';
import api from '../lib/api';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// <input type="datetime-local"> works in local time; the API takes an ISO string.
const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fmtWhen = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function ForecastWindowsModal({ onClose, onChanged }) {
  const now = new Date();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    year: now.getFullYear(), month: now.getMonth() + 1, status: 'OPEN',
    allHeads: true, headUserIds: [], deadline: '', note: '', notify: true,
  });

  const load = () => api.get('/forecasting/windows')
    .then((r) => setData(r.data))
    .catch((e) => setError(e.response?.data?.error || 'Failed to load windows.'))
    .finally(() => setLoading(false));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const years = useMemo(() => [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1], []); // eslint-disable-line

  const edit = (w) => setForm({
    year: w.year, month: w.month, status: w.status, allHeads: w.allHeads, headUserIds: w.headUserIds,
    deadline: toLocalInput(w.deadline), note: w.note || '', notify: false,
  });

  const save = async (override = {}) => {
    const f = { ...form, ...override };
    setSaving(true); setError(''); setMsg('');
    try {
      const { data: r } = await api.post('/forecasting/windows', {
        year: f.year, month: f.month, status: f.status,
        headUserIds: f.allHeads ? [] : f.headUserIds,
        deadline: f.deadline ? new Date(f.deadline).toISOString() : null,
        note: f.note, notify: f.status === 'OPEN' && f.notify,
      });
      setMsg(`${MONTHS[f.month - 1]} ${f.year} ${f.status === 'OPEN' ? 'opened' : 'closed'}${r.notified ? ` · ${r.notified.notified} notified, ${r.notified.emailed} emailed` : ''}.`);
      await load();
      onChanged?.();
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to save the window.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (w) => {
    if (!window.confirm(`Remove the ${w.label} window? The normal calendar rule applies again.`)) return;
    try { await api.delete(`/forecasting/windows/${w.id}`); await load(); onChanged?.(); } catch (e) { setError(e.response?.data?.error || 'Failed to remove.'); }
  };

  const toggleHead = (id) => setForm((f) => ({ ...f, headUserIds: f.headUserIds.includes(id) ? f.headUserIds.filter((x) => x !== id) : [...f.headUserIds, id] }));

  return (
    <div className="modal-scrim show" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ width: 760, maxWidth: '94vw', maxHeight: '92vh' }} role="dialog" aria-modal="true" aria-label="Forecast windows">
        <div className="modal-head">
          <div>
            <div style={{ fontSize: 18, fontWeight: 760, color: 'var(--ink)' }}>Forecast windows</div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>
              Open or close any month for Hub heads. With no window, the calendar rule applies (next month opens on the 20th).
            </div>
          </div>
          <button className="btn btn-subtle btn-sm" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>
        <div className="modal-body" style={{ overflow: 'auto' }}>
          {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#b91c1c', marginBottom: 12 }}>{error}</div>}
          {msg && <div style={{ background: '#ECF8F1', border: '1px solid #cdebd9', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#15814B', marginBottom: 12 }}>{msg}</div>}

          {/* Open / close a month */}
          <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 14, marginBottom: 16, background: '#FBFCFD' }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div className="field" style={{ margin: 0 }}>
                <label>Month</label>
                <select className="select" value={form.month} onChange={(e) => setForm((f) => ({ ...f, month: Number(e.target.value) }))}>
                  {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>Year</label>
                <select className="select" value={form.year} onChange={(e) => setForm((f) => ({ ...f, year: Number(e.target.value) }))}>
                  {years.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>Deadline (optional)</label>
                <input className="input" type="datetime-local" value={form.deadline} onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))} />
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Who</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6, alignItems: 'center' }}>
                <label style={{ display: 'inline-flex', gap: 6, fontSize: 13, fontWeight: 600 }}>
                  <input type="checkbox" checked={form.allHeads} onChange={(e) => setForm((f) => ({ ...f, allHeads: e.target.checked }))} /> All Hub heads
                </label>
                {!form.allHeads && (data?.heads || []).map((h) => (
                  <label key={h.id} style={{ display: 'inline-flex', gap: 5, fontSize: 12.5, border: '1px solid var(--border)', borderRadius: 20, padding: '3px 10px', background: form.headUserIds.includes(h.id) ? '#EDF3FD' : '#fff' }}>
                    <input type="checkbox" checked={form.headUserIds.includes(h.id)} onChange={() => toggleHead(h.id)} /> {h.name}
                  </label>
                ))}
              </div>
            </div>

            <div className="field" style={{ margin: '12px 0 0' }}>
              <label>Note to Hub heads (optional)</label>
              <input className="input" value={form.note} maxLength={300} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="e.g. Please include the revised Avurudu plans" />
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" disabled={saving || (!form.allHeads && !form.headUserIds.length)} onClick={() => save({ status: 'OPEN' })}>
                {saving ? 'Saving…' : 'Open this month'}
              </button>
              <button className="btn btn-ghost" disabled={saving || (!form.allHeads && !form.headUserIds.length)} onClick={() => save({ status: 'CLOSED' })}>Close this month</button>
              <label style={{ display: 'inline-flex', gap: 6, fontSize: 12.5, marginLeft: 'auto' }}>
                <input type="checkbox" checked={form.notify} onChange={(e) => setForm((f) => ({ ...f, notify: e.target.checked }))} /> Notify Hub heads (in-app + email)
              </label>
            </div>
          </div>

          {/* Existing windows */}
          {loading ? <OrbitLoader size={32} /> : !(data?.windows || []).length ? (
            <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', padding: 16 }}>No windows yet - only the calendar rule is in effect.</div>
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Month</th><th>Status</th><th>Who</th><th>Deadline</th><th style={{ width: 130 }} /></tr></thead>
                <tbody>
                  {data.windows.map((w) => (
                    <tr key={w.id}>
                      <td className="strong">{w.label}</td>
                      <td>
                        {w.open ? <span style={{ color: '#15814B', fontWeight: 700 }}>Open</span>
                          : w.expired ? <span style={{ color: '#C5391F', fontWeight: 700 }}>Locked · deadline passed</span>
                            : <span style={{ color: '#C5391F', fontWeight: 700 }}>Closed</span>}
                      </td>
                      <td style={{ fontSize: 12.5 }}>{w.allHeads ? 'All Hub heads' : w.heads.map((h) => h.name).join(', ')}</td>
                      <td style={{ fontSize: 12.5, color: 'var(--muted)' }}>{w.deadline ? fmtWhen(w.deadline) : '-'}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => edit(w)}>Edit</button>{' '}
                        <button className="act-btn" onClick={() => remove(w)} title="Remove window" style={{ color: 'var(--red-600,#dc2626)' }}><Icon name="x" size={15} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
