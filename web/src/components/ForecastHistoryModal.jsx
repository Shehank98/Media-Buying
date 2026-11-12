// Admin: every save of one client's forecast for a month - who, when, the total
// and which channels changed vs the previous save. Backed by
// GET /forecasting/submissions (ForecastSubmission snapshots).
import { useEffect, useState } from 'react';
import Icon from './Icon';
import OrbitLoader from './OrbitLoader';
import api from '../lib/api';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const fmt = (v) => Math.round(Number(v) || 0).toLocaleString('en-US');
const fmtWhen = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function ForecastHistoryModal({ clientId, clientName, year, month, onClose }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/forecasting/submissions', { params: { clientId, year, month } })
      .then((r) => setRows(r.data.submissions || []))
      .catch((e) => setError(e.response?.data?.error || 'Failed to load history.'));
  }, [clientId, year, month]);

  return (
    <div className="modal-scrim show" style={{ zIndex: 80 }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ width: 680, maxWidth: '94vw', maxHeight: '90vh' }} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div>
            <div style={{ fontSize: 17, fontWeight: 760, color: 'var(--ink)' }}>{clientName} · forecast history</div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>{MONTHS[month - 1]} {year} · every save, newest first</div>
          </div>
          <button className="btn btn-subtle btn-sm" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>
        <div className="modal-body" style={{ overflow: 'auto' }}>
          {error ? <div style={{ color: 'var(--red-600)', fontSize: 13 }}>{error}</div>
            : !rows ? <OrbitLoader size={32} />
              : !rows.length ? <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', padding: 20 }}>No saves recorded yet. History starts from the first save after this feature was added.</div>
                : rows.map((s) => (
                  <div key={s.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                      <div style={{ fontWeight: 700, color: 'var(--ink)', fontSize: 13 }}>{s.submittedBy} <span style={{ color: 'var(--muted)', fontWeight: 500 }}>· {fmtWhen(s.submittedAt)}</span></div>
                      <div className="mono" style={{ fontWeight: 750 }}>LKR {fmt(s.total)} <span style={{ color: 'var(--muted)', fontWeight: 500 }}>· {s.channelCount} channel{s.channelCount === 1 ? '' : 's'}</span></div>
                    </div>
                    {s.changes.length > 0 && (
                      <div style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.6 }}>
                        {s.changes.slice(0, 8).map((c) => (
                          <div key={c.channel} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                            <span>{c.channel}</span>
                            <span className="mono" style={{ color: c.to >= c.from ? '#15814B' : '#C5391F' }}>{fmt(c.from)} → {fmt(c.to)}</span>
                          </div>
                        ))}
                        {s.changes.length > 8 && <div style={{ color: 'var(--muted)' }}>+ {s.changes.length - 8} more changes</div>}
                      </div>
                    )}
                  </div>
                ))}
        </div>
      </div>
    </div>
  );
}
