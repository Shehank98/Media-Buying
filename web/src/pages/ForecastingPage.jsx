import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Icon from '../components/Icon';
import OrbitLoader from '../components/OrbitLoader';
import api from '../lib/api';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const AVATAR = ['#E85D24', '#1F5BB5', '#15814B', '#6B3FB5', '#9A5B00', '#C5391F', '#0891b2', '#38527E'];
const STATUS = {
  submitted: { dot: '#15814B', label: 'Submitted' },
  pending: { dot: '#9A5B00', label: 'Pending' },
  none: { dot: '#C7D0DD', label: 'Not started' },
};

export default function ForecastingPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'SUPER_ADMIN';
  const isManager = user?.role === 'MANAGER';
  const readOnly = isManager; // managers view history only

  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState({ year: null, month: null });
  const [clients, setClients] = useState([]);
  const [agencyFilter, setAgencyFilter] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  // entry modal
  const [active, setActive] = useState(null); // the client being edited/viewed
  const [categories, setCategories] = useState([]);
  const [amounts, setAmounts] = useState({}); // channelMasterId -> { amount, notes }
  const [entryLoading, setEntryLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [entryError, setEntryError] = useState('');
  const [savedMsg, setSavedMsg] = useState('');
  const [history, setHistory] = useState(null);

  const fetchClients = () => {
    setLoading(true);
    api.get('/forecasting/clients', { params: agencyFilter ? { agencyId: agencyFilter } : {} })
      .then(r => { setClients(r.data.clients || []); setPeriod({ year: r.data.year, month: r.data.month }); })
      .catch(() => setError('Failed to load clients.'))
      .finally(() => setLoading(false));
  };
  useEffect(fetchClients, [agencyFilter]);

  const agencies = useMemo(() => {
    const m = new Map();
    clients.forEach(c => { if (c.agencyId) m.set(c.agencyId, c.agencyName); });
    return [...m.entries()].map(([id, name]) => ({ id, name }));
  }, [clients]);

  const filtered = clients.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.agencyName || '').toLowerCase().includes(search.toLowerCase())
  );

  const openEntry = async (client) => {
    setActive(client);
    setEntryError(''); setSavedMsg(''); setHistory(null);
    setEntryLoading(true);
    try {
      if (readOnly) {
        const { data } = await api.get('/forecasting/history', { params: { clientId: client.id } });
        setHistory(data.items || []);
      } else {
        const [chRes, enRes] = await Promise.all([
          api.get('/forecasting/channels'),
          api.get('/forecasting/entry', { params: { clientId: client.id } }),
        ]);
        setCategories(chRes.data.categories || []);
        const seed = {};
        (enRes.data.items || []).forEach(it => { seed[it.channelMasterId] = { amount: String(it.amountMillions), notes: it.notes || '' }; });
        setAmounts(seed);
      }
    } catch {
      setEntryError('Failed to load the forecast.');
    } finally {
      setEntryLoading(false);
    }
  };
  const closeEntry = () => { setActive(null); setCategories([]); setAmounts({}); setHistory(null); };

  const setCell = (chId, field, value) => setAmounts(p => ({ ...p, [chId]: { ...p[chId], [field]: value } }));

  const total = useMemo(() =>
    Object.values(amounts).reduce((s, v) => s + (parseFloat(v?.amount) || 0), 0)
  , [amounts]);

  const submit = async () => {
    setSaving(true); setEntryError(''); setSavedMsg('');
    try {
      const items = Object.entries(amounts)
        .map(([channelMasterId, v]) => ({ channelMasterId: Number(channelMasterId), amountMillions: parseFloat(v.amount), notes: v.notes }))
        .filter(it => !Number.isNaN(it.amountMillions) && it.amountMillions > 0);
      await api.post('/forecasting/submit', { clientId: active.id, year: period.year, month: period.month, items });
      setSavedMsg('Forecast saved.');
      fetchClients();
      setTimeout(closeEntry, 700);
    } catch (err) {
      setEntryError(err.response?.data?.error || 'Failed to save forecast.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="content-narrow fade-in"><OrbitLoader fullHeight label="Loading forecasting…" /></div>;

  const periodLabel = period.month ? `${MONTHS[period.month - 1]} ${period.year}` : '';

  return (
    <div className="fade-in" style={{ maxWidth: 1320, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-.6px', margin: 0, color: '#16243C' }}>Forecasting</h1>
          <p style={{ fontSize: 13.5, color: '#6B7790', margin: '6px 0 0' }}>
            {readOnly ? 'View submitted forecasts by client' : `Enter the ${periodLabel} forecast for your clients`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {(isAdmin || isManager) && agencies.length > 1 && (
            <select className="select" value={agencyFilter} onChange={e => setAgencyFilter(e.target.value)} style={{ maxWidth: 220 }}>
              <option value="">All agencies</option>
              {agencies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
          <div style={{ position: 'relative' }}>
            <Icon name="search" size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
            <input className="input" placeholder="Search clients…" value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 32, maxWidth: 240 }} />
          </div>
        </div>
      </div>

      {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#b91c1c', marginBottom: 16 }}>{error}</div>}

      {filtered.length === 0 ? (
        <div style={{ padding: '48px 24px', textAlign: 'center', color: '#6B7790', background: '#fff', border: '1px solid #E5E8ED', borderRadius: 14 }}>No clients available.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(248px, 1fr))', gap: 16 }}>
          {filtered.map((c, i) => {
            const st = STATUS[c.status] || STATUS.none;
            const color = AVATAR[(c.name.charCodeAt(0) + i) % AVATAR.length];
            return (
              <div key={c.id} role="button" tabIndex={0} onClick={() => openEntry(c)}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#C7D0DD'; e.currentTarget.style.boxShadow = '0 10px 26px rgba(15,31,61,.10)'; e.currentTarget.style.transform = 'translateY(-3px)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#E5E8ED'; e.currentTarget.style.boxShadow = '0 1px 2px rgba(15,31,61,.06)'; e.currentTarget.style.transform = 'none'; }}
                style={{ position: 'relative', overflow: 'hidden', background: '#fff', border: '1px solid #E5E8ED', borderRadius: 14, boxShadow: '0 1px 2px rgba(15,31,61,.06)', padding: 20, cursor: 'pointer', transition: 'transform .16s ease, box-shadow .16s ease, border-color .16s ease' }}>
                <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${color}, ${color}1A 70%, transparent)` }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
                  <div style={{ width: 42, height: 42, borderRadius: 12, background: `linear-gradient(135deg, ${color}, ${color}CC)`, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 750, fontSize: 17, flex: 'none', boxShadow: `0 2px 8px ${color}55` }}>{c.name[0]?.toUpperCase()}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: '#16243C', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.name}>{c.name}</div>
                    <div style={{ fontSize: 11.5, color: '#93A0B5', marginTop: 2 }}>{c.agencyName || '-'}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#6B7790' }}>
                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: st.dot }} />{readOnly ? 'View history' : st.label}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: '#D9521C' }}>{readOnly ? 'Open' : 'Enter'} <Icon name="chevR" size={14} /></span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Entry / history modal */}
      {active && (
        <div className="modal-scrim show" onClick={e => { if (e.target === e.currentTarget) closeEntry(); }}>
          <div className="modal" style={{ maxWidth: 760, width: '92vw' }} onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h2 style={{ margin: 0 }}>{active.name}</h2>
                <p style={{ margin: '3px 0 0', fontSize: 12.5, color: 'var(--muted)' }}>{readOnly ? 'Forecast history' : `${periodLabel} forecast · LKR millions`}</p>
              </div>
              <button className="act-btn" onClick={closeEntry}><Icon name="x" size={18} /></button>
            </div>
            <div className="modal-body" style={{ maxHeight: '64vh', overflow: 'auto' }}>
              {entryError && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#b91c1c', marginBottom: 14 }}>{entryError}</div>}
              {savedMsg && <div style={{ background: '#ECF8F1', border: '1px solid #cdebd9', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#15814B', marginBottom: 14 }}>{savedMsg}</div>}
              {entryLoading ? <OrbitLoader label="Loading…" /> : readOnly ? (
                history && history.length > 0 ? (
                  <table className="tbl" style={{ fontSize: 12.5 }}>
                    <thead><tr><th>Period</th><th>Channel</th><th>Medium</th><th style={{ textAlign: 'right' }}>Amount (M)</th><th>Notes</th></tr></thead>
                    <tbody>
                      {history.map((h, i) => (
                        <tr key={i}>
                          <td>{MONTHS[h.month - 1]?.slice(0, 3)} {h.year}</td>
                          <td className="strong">{h.channel}</td>
                          <td><span className="medium-tag" data-medium={h.medium}>{h.medium}</span></td>
                          <td className="mono" style={{ textAlign: 'right' }}>{h.amountMillions}</td>
                          <td style={{ color: 'var(--muted)' }}>{h.notes}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : <div style={{ padding: '30px 0', textAlign: 'center', color: 'var(--muted)' }}>No forecasts submitted yet.</div>
              ) : (
                <>
                  {categories.map(cat => (
                    <div key={cat.category} style={{ marginBottom: 18 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: '#93A0B5', margin: '0 0 6px 2px' }}>{cat.category}</div>
                      <table className="tbl" style={{ fontSize: 12.5 }}>
                        <thead><tr><th style={{ width: '42%' }}>Channel</th><th style={{ width: '22%' }}>Amount (M)</th><th>Notes</th></tr></thead>
                        <tbody>
                          {cat.channels.map(ch => (
                            <tr key={ch.id}>
                              <td>{ch.name}</td>
                              <td>
                                <input className="input" type="number" step="0.01" min="0" value={amounts[ch.id]?.amount || ''} onChange={e => setCell(ch.id, 'amount', e.target.value)} placeholder="0" style={{ height: 32, fontSize: 12.5 }} />
                              </td>
                              <td>
                                <input className="input" type="text" value={amounts[ch.id]?.notes || ''} onChange={e => setCell(ch.id, 'notes', e.target.value)} placeholder="optional" style={{ height: 32, fontSize: 12.5 }} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                  {categories.length === 0 && <div style={{ padding: '30px 0', textAlign: 'center', color: 'var(--muted)' }}>No active channels configured.</div>}
                </>
              )}
            </div>
            <div className="modal-foot" style={{ justifyContent: 'space-between' }}>
              {!readOnly ? (
                <>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#16243C' }}>Total: <span className="mono">{total.toLocaleString('en-US', { maximumFractionDigits: 2 })}M</span></div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-ghost" onClick={closeEntry}>Cancel</button>
                    <button className="btn btn-primary" onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Submit forecast'}</button>
                  </div>
                </>
              ) : (
                <button className="btn btn-primary" onClick={closeEntry} style={{ marginLeft: 'auto' }}>Close</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
