// Admin → Group Revenue: annual revenue target per Hub head, per agency.
// Feeds the per-head bars in the Executive Dashboard's Business Unit Revenue
// drill-down (target to date = annual ÷ 12 × months elapsed). Auto-saves each
// row on blur. Backed by GET/POST /admin/hub-revenue-targets.
import { useEffect, useState } from 'react';
import Icon, { fmtLKR } from './Icon';
import MoneyInput from './MoneyInput';
import OrbitLoader from './OrbitLoader';
import api from '../lib/api';

const keyOf = (agencyId, headUserId) => `${agencyId}:${headUserId}`;

export default function HubRevenueTargetsCard({ year }) {
  const [agencies, setAgencies] = useState([]);
  const [values, setValues] = useState({}); // key -> string (full LKR)
  const [saved, setSaved] = useState({});   // key -> last saved string
  const [status, setStatus] = useState({}); // key -> 'saving' | 'saved' | 'error'
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true); setError('');
    api.get('/admin/hub-revenue-targets', { params: { year } })
      .then(({ data }) => {
        if (!alive) return;
        const ags = data.agencies || [];
        const v = {};
        ags.forEach((a) => a.heads.forEach((h) => { v[keyOf(a.agencyId, h.headUserId)] = h.amount == null ? '' : String(h.amount); }));
        setAgencies(ags); setValues(v); setSaved(v); setStatus({});
      })
      .catch((e) => { if (alive) setError(e.response?.data?.error || 'Failed to load Hub head targets.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [year]);

  const save = async (agencyId, headUserId) => {
    const k = keyOf(agencyId, headUserId);
    const v = values[k] ?? '';
    if (v === (saved[k] ?? '')) return;
    setStatus((s) => ({ ...s, [k]: 'saving' }));
    try {
      await api.post('/admin/hub-revenue-targets', { year, agencyId, headUserId, amount: v === '' ? null : Number(v) });
      setSaved((s) => ({ ...s, [k]: v }));
      setStatus((s) => ({ ...s, [k]: 'saved' }));
    } catch {
      setStatus((s) => ({ ...s, [k]: 'error' }));
    }
  };

  const withHeads = agencies.filter((a) => a.heads.length);

  return (
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
      <div style={{ fontSize: 12.5, fontWeight: 720, color: 'var(--ink)', marginBottom: 2 }}>Hub head targets (annual)</div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 10 }}>
        Each Hub head's {year} revenue target within an agency · drives the per-head bars when you click an agency card under Executive Dashboard → <b style={{ color: 'var(--ink)' }}>Business Unit Revenue</b>. Saves when you leave the field.
      </div>
      {loading ? <OrbitLoader size={32} /> : error ? (
        <div style={{ fontSize: 12.5, color: 'var(--red-600)' }}>{error}</div>
      ) : withHeads.length === 0 ? (
        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>No Hub heads have clients yet (assign clients in Admin → Teams / Users).</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {withHeads.map((a) => {
            const total = a.heads.reduce((s, h) => s + (Number(values[keyOf(a.agencyId, h.headUserId)]) || 0), 0);
            return (
              <div key={a.agencyId}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>
                  <span>{a.agencyName}</span>
                  {total > 0 && <span className="mono" style={{ textTransform: 'none' }}>Σ {fmtLKR(total)}</span>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {a.heads.map((h) => {
                    const k = keyOf(a.agencyId, h.headUserId);
                    const st = status[k];
                    return (
                      <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', flex: 1 }}>{h.headName}</label>
                        <MoneyInput
                          className="input"
                          value={values[k] ?? ''}
                          onValueChange={(v) => { setValues((m) => ({ ...m, [k]: v })); setStatus((s) => ({ ...s, [k]: undefined })); }}
                          onBlur={() => save(a.agencyId, h.headUserId)}
                          placeholder="Annual (full LKR)"
                          style={{ textAlign: 'right', maxWidth: 190 }}
                        />
                        <span style={{ width: 16, display: 'inline-flex', justifyContent: 'center' }} title={st === 'error' ? 'Save failed - try again' : ''}>
                          {st === 'saving' && <span style={{ fontSize: 11, color: 'var(--muted)' }}>…</span>}
                          {st === 'saved' && <Icon name="check" size={14} style={{ color: 'var(--green-600, #15814B)' }} />}
                          {st === 'error' && <Icon name="alert" size={14} style={{ color: 'var(--red-600, #C5391F)' }} />}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
