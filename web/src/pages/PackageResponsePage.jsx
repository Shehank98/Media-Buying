import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon';
import api from '../lib/api';

const fmtLKR = (v) => (v == null || v === '' ? '' : 'LKR ' + Math.round(Number(v)).toLocaleString('en-US'));

const INTEREST_OPTIONS = [
  { value: 'INTERESTED', label: 'Interested', color: 'var(--green-600)' },
  { value: 'NEGOTIATE', label: 'Open to negotiate', color: 'var(--coral-600)' },
  { value: 'NOT_INTERESTED', label: 'Not interested', color: 'var(--muted)' },
];

export default function PackageResponsePage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [data, setData] = useState(null);

  const [interest, setInterest] = useState('');
  const [clientName, setClientName] = useState('');
  const [budgetNote, setBudgetNote] = useState('');
  const [notes, setNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) { setLoadError('This link is invalid or missing its token.'); setLoading(false); return; }
    api.get('/packages/public/by-token', { params: { token } })
      .then((r) => {
        setData(r.data);
        const resp = r.data.response || {};
        if (resp.interest) setInterest(resp.interest);
        setClientName(resp.clientName || '');
        setBudgetNote(resp.budgetNote || '');
        setNotes(resp.notes || '');
      })
      .catch((err) => setLoadError(err.response?.data?.error || 'This link is invalid or has expired.'))
      .finally(() => setLoading(false));
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!interest) { setError('Please select your interest level.'); return; }
    setSubmitting(true);
    try {
      await api.post('/packages/public/submit', { token, interest, clientName, budgetNote, notes });
      setDone(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to submit your response. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const Shell = ({ children }) => (
    <div style={{ minHeight: '100vh', background: 'var(--bg, #f0f4f8)', padding: '40px 16px' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 20 }}>
          <div className="brand-mark" style={{ width: 40, height: 40, fontSize: 19 }}>O</div>
          <div>
            <div className="brand-name" style={{ fontSize: 17, color: 'var(--ink)' }}>Ogilvy</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '.3px', marginTop: 2 }}>Media Buying Records</div>
          </div>
        </div>
        {children}
      </div>
    </div>
  );

  if (loading) {
    return <Shell><div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading package…</div></Shell>;
  }

  if (loadError) {
    return (
      <Shell>
        <div className="card" style={{ padding: 40, textAlign: 'center' }}>
          <Icon name="alert" size={36} style={{ color: 'var(--red-600)', marginBottom: 12 }} />
          <h2 style={{ margin: '0 0 6px', color: 'var(--ink)' }}>Link unavailable</h2>
          <p style={{ color: 'var(--muted)', margin: 0 }}>{loadError}</p>
        </div>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell>
        <div className="card" style={{ padding: 48, textAlign: 'center' }}>
          <Icon name="check" size={40} style={{ color: 'var(--green-600)', marginBottom: 14 }} />
          <h2 style={{ margin: '0 0 6px', color: 'var(--ink)' }}>Response submitted</h2>
          <p style={{ color: 'var(--muted)', margin: 0 }}>Thank you — our team will follow up with you. You can revisit this link to update your response.</p>
        </div>
      </Shell>
    );
  }

  const pkg = data.package;

  return (
    <Shell>
      <div className="card fade-in" style={{ padding: 0, overflow: 'hidden' }}>
        {/* Package header */}
        <div style={{ background: 'var(--navy-950, #0A1729)', color: '#fff', padding: '28px 32px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--coral-300, #f6a586)' }}>{pkg.category}</div>
          <h1 style={{ margin: '6px 0 0', fontSize: 22, lineHeight: 1.25 }}>{pkg.name}</h1>
          {data.recipientName && <p style={{ margin: '8px 0 0', color: '#8ba4c2', fontSize: 14 }}>Prepared for {data.recipientName}</p>}
        </div>

        <div style={{ padding: 32 }}>
          {pkg.emailIntro && <p style={{ color: 'var(--ink-soft, #3B4A63)', fontSize: 14.5, lineHeight: 1.6, marginTop: 0 }}>{pkg.emailIntro}</p>}

          {/* Line items (read-only context) */}
          {pkg.lineItems?.length > 0 && (
            <div className="tbl-wrap" style={{ margin: '0 0 24px' }}>
              <table className="tbl" style={{ fontSize: 13 }}>
                <thead><tr><th>Item</th><th style={{ textAlign: 'right' }}>Rate</th></tr></thead>
                <tbody>
                  {pkg.lineItems.map((li) => (
                    <tr key={li.id}>
                      <td>{li.label}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{li.rate === 0 ? 'Added value' : fmtLKR(li.rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.respondedAt && (
            <div style={{ marginBottom: 16, padding: '8px 12px', borderRadius: 8, background: 'var(--blue-50,#eff6ff)', color: 'var(--blue-700,#1d4ed8)', fontSize: 13 }}>
              You've already responded — submitting again will update your answer.
            </div>
          )}

          {error && (
            <div style={{ marginBottom: 16, padding: '10px 13px', borderRadius: 9, background: 'var(--red-100)', color: 'var(--red-600)', fontSize: 13, fontWeight: 600 }}>{error}</div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="field">
              <label className="field-label">Your interest <span className="req">*</span></label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {INTEREST_OPTIONS.map((opt) => {
                  const active = interest === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setInterest(opt.value)}
                      style={{
                        flex: '1 1 160px', padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
                        border: active ? `2px solid ${opt.color}` : '1px solid var(--border)',
                        background: active ? 'var(--bg-sunken)' : '#fff',
                        fontSize: 13.5, fontWeight: 700, color: active ? opt.color : 'var(--ink)',
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="field">
              <label className="field-label">Client (optional)</label>
              <input className="input" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Which client is this for?" />
            </div>

            <div className="field">
              <label className="field-label">Budget indication (optional)</label>
              <input className="input" value={budgetNote} onChange={(e) => setBudgetNote(e.target.value)} placeholder="e.g. up to LKR 2.5M, depends on slots" />
            </div>

            <div className="field">
              <label className="field-label">Notes (optional)</label>
              <textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything else we should know?" />
            </div>

            <button className="btn btn-primary btn-lg" type="submit" style={{ width: '100%', marginTop: 8 }} disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit response'}
            </button>
          </form>
        </div>
      </div>
    </Shell>
  );
}
