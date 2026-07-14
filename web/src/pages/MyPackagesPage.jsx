import { useState, useEffect, useCallback } from 'react';
import Icon from '../components/Icon';
import api from '../lib/api';
import OrbitLoader from '../components/OrbitLoader';

const fmtLKR = (v) => {
  if (v == null || v === '') return '-';
  const n = Number(v); const a = Math.abs(n);
  if (n === 0) return 'Added value';
  if (a >= 1e9) return 'LKR ' + (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return 'LKR ' + (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return 'LKR ' + (n / 1e3).toFixed(1) + 'K';
  return 'LKR ' + Math.round(n).toLocaleString('en-US');
};
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-');

const INTEREST_OPTS = [
  { key: 'INTERESTED', label: 'Interested', icon: 'check', bg: 'var(--green-100)', fg: 'var(--green-600)' },
  { key: 'NEGOTIATE', label: 'Open to negotiate', icon: 'history', bg: 'var(--coral-100)', fg: 'var(--coral-700)' },
  { key: 'NOT_INTERESTED', label: 'Not interested', icon: 'x', bg: 'var(--bg-sunken)', fg: 'var(--muted)' },
];
const INTEREST_BY_KEY = Object.fromEntries(INTEREST_OPTS.map((o) => [o.key, o]));

function PackageCard({ item, myClients, onResponded }) {
  const responded = !!item.respondedAt;
  const pkg = item.package;
  const expired = pkg.expired;
  const [editing, setEditing] = useState(!responded && !expired);
  const [interest, setInterest] = useState(item.response.interest || '');
  const [interestedIds, setInterestedIds] = useState(item.response.interestedClientIds || []);
  const [budgetNote, setBudgetNote] = useState(item.response.budgetNote || '');
  const [notes, setNotes] = useState(item.response.notes || '');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const clientNameById = new Map(myClients.map((c) => [c.id, c.name]));
  const respondedClientNames = (item.response.interestedClientIds || []).map((id) => clientNameById.get(id) || `#${id}`);

  const submit = async () => {
    setErr('');
    if (!interest) { setErr('Please choose your interest level.'); return; }
    setSaving(true);
    try {
      const payload = { interest, interestedClientIds: interestedIds, budgetNote, notes };
      await api.post(`/packages/inbox/${item.recipientId}/respond`, payload);
      onResponded(item.recipientId, payload);
      setEditing(false);
    } catch (e) {
      setErr(e.response?.data?.error || 'Failed to submit response.');
    } finally { setSaving(false); }
  };

  const statusPill = responded
    ? (() => { const o = INTEREST_BY_KEY[item.response.interest]; return <span style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: o?.bg, color: o?.fg }}>{o?.label || 'Responded'}</span>; })()
    : <span style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: 'var(--amber-50)', color: '#9A5B00' }}>Awaiting your response</span>;

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 18 }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h3 style={{ fontSize: 15.5, fontWeight: 700, margin: 0, color: 'var(--ink)' }}>{pkg.name}</h3>
            {expired && <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 5, background: '#FCEBEA', color: '#C5391F' }}>Closed</span>}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
            Shared by {pkg.sharedBy || 'the media team'} · {fmtDate(item.sentAt)}
          </div>
        </div>
        {statusPill}
      </div>

      <div style={{ padding: '16px 20px' }}>
        {pkg.emailIntro && <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.5, margin: '0 0 14px' }}>{pkg.emailIntro}</p>}

        {pkg.lineItems.length > 0 && (
          <div className="tbl-wrap" style={{ marginBottom: 16 }}>
            <table className="tbl" style={{ fontSize: 13 }}>
              <thead><tr><th>Sponsorship</th><th style={{ textAlign: 'right' }}>Package Rate</th></tr></thead>
              <tbody>
                {pkg.lineItems.map((li) => (
                  <tr key={li.id}><td className="strong">{li.label}</td><td style={{ textAlign: 'right', fontFamily: "'Spline Sans Mono', monospace" }}>{fmtLKR(li.rate)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Response */}
        {!editing && responded ? (
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>Your response · {fmtDate(item.respondedAt)}</div>
              {!expired && <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}><Icon name="edit" size={14} /> Update</button>}
            </div>
            {respondedClientNames.length > 0 && <div style={{ fontSize: 13 }}><span style={{ color: 'var(--muted)' }}>Interested clients:</span> {respondedClientNames.join(', ')}</div>}
            {item.response.clientName && respondedClientNames.length === 0 && <div style={{ fontSize: 13 }}><span style={{ color: 'var(--muted)' }}>Client:</span> {item.response.clientName}</div>}
            {item.response.budgetNote && <div style={{ fontSize: 13, marginTop: 4 }}><span style={{ color: 'var(--muted)' }}>Budget:</span> {item.response.budgetNote}</div>}
            {item.response.notes && <div style={{ fontSize: 13, marginTop: 4 }}><span style={{ color: 'var(--muted)' }}>Notes:</span> {item.response.notes}</div>}
          </div>
        ) : expired ? (
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', fontSize: 13, color: 'var(--muted)' }}>
            This proposal has closed. Its deadline has passed, so responses are no longer accepted.
          </div>
        ) : (
          <div>
            <label className="field-label" style={{ display: 'block', marginBottom: 8 }}>Are you interested in this package?</label>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
              {INTEREST_OPTS.map((o) => {
                const on = interest === o.key;
                return (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => setInterest(o.key)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 14px', borderRadius: 10, cursor: 'pointer',
                      fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                      border: on ? `1.5px solid ${o.fg}` : '1.5px solid var(--border)',
                      background: on ? o.bg : '#fff', color: on ? o.fg : 'var(--ink-soft)',
                    }}
                  >
                    <Icon name={o.icon} size={15} />{o.label}
                  </button>
                );
              })}
            </div>

            <div className="field">
              <label className="field-label">Interested clients (optional)</label>
              {myClients.length === 0 ? (
                <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>No clients are assigned to you yet.</div>
              ) : (
                <div style={{ border: '1px solid var(--border)', borderRadius: 9, maxHeight: 170, overflow: 'auto', padding: 6 }}>
                  {myClients.map((c) => (
                    <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', fontSize: 13, cursor: 'pointer' }}>
                      <input type="checkbox" checked={interestedIds.includes(c.id)} onChange={() => setInterestedIds((ids) => ids.includes(c.id) ? ids.filter((x) => x !== c.id) : [...ids, c.id])} />
                      {c.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="field">
              <label className="field-label">Budget note (optional)</label>
              <input className="input" value={budgetNote} onChange={(e) => setBudgetNote(e.target.value)} placeholder="e.g. within Q3 budget" />
            </div>
            <div className="field">
              <label className="field-label">Notes (optional)</label>
              <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything else you'd like us to know…" />
            </div>

            {err && <div style={{ background: 'var(--red-50,#fef2f2)', border: '1px solid var(--red-200,#fecaca)', borderRadius: 8, padding: '9px 13px', fontSize: 13, color: 'var(--red-700,#b91c1c)', marginBottom: 12 }}>{err}</div>}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              {responded && <button className="btn btn-ghost" onClick={() => { setEditing(false); setErr(''); }}>Cancel</button>}
              <button className="btn btn-primary" onClick={submit} disabled={saving}>{saving ? 'Submitting…' : responded ? 'Update response' : 'Submit response'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function MyPackagesPage() {
  const [items, setItems] = useState([]);
  const [myClients, setMyClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchInbox = useCallback(() => {
    setLoading(true);
    api.get('/packages/inbox')
      .then((r) => { setItems(r.data.items || []); setMyClients(r.data.myClients || []); })
      .catch(() => setError('Failed to load your packages.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchInbox(); }, [fetchInbox]);

  const onResponded = (recipientId, response) => {
    setItems((prev) => prev.map((it) => (it.recipientId === recipientId
      ? { ...it, respondedAt: it.respondedAt || new Date().toISOString(), response: { ...it.response, ...response } }
      : it)));
  };

  return (
    <div className="content-narrow fade-in">
      <div className="page-head">
        <div>
          <h1 className="page-title">Media Packages</h1>
          <p className="page-sub">Packages shared with you by the media team. Review and let us know your interest.</p>
        </div>
      </div>

      {error && (
        <div style={{ background: 'var(--red-50,#fef2f2)', border: '1px solid var(--red-200,#fecaca)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--red-700,#b91c1c)', marginBottom: 16 }}>{error}</div>
      )}

      {loading ? (
        <OrbitLoader fullHeight label="Loading packages…" />
      ) : items.length === 0 ? (
        <div className="empty-soft">
          <Icon name="mail" />
          <p>No packages have been shared with you yet.</p>
        </div>
      ) : (
        items.map((it) => <PackageCard key={it.recipientId} item={it} myClients={myClients} onResponded={onResponded} />)
      )}
    </div>
  );
}
