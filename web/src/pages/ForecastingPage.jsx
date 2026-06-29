import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Icon, { fmtLKR } from '../components/Icon';
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

  // SUPER_ADMIN can target any month (e.g. backfill June so it's there to
  // copy into July) instead of being locked to the upcoming month.
  const [anchorMonth, setAnchorMonth] = useState(null); // the true "next month", fetched once
  const [selectedPeriod, setSelectedPeriod] = useState(null); // admin override, or null = use anchor

  useEffect(() => {
    if (!isAdmin) return;
    api.get('/forecasting/next-month').then(r => setAnchorMonth({ year: r.data.year, month: r.data.month })).catch(() => {});
  }, [isAdmin]);

  const monthOptions = useMemo(() => {
    if (!anchorMonth) return [];
    const opts = [];
    let y = anchorMonth.year, m = anchorMonth.month;
    for (let i = 0; i < 13; i++) {
      opts.push({ year: y, month: m });
      m -= 1;
      if (m < 1) { m = 12; y -= 1; }
    }
    return opts;
  }, [anchorMonth]);

  // forecast-vs-actual report (admins/managers)
  const [view, setView] = useState('clients'); // 'clients' | 'variance'
  const [variance, setVariance] = useState(null);
  const [varLoading, setVarLoading] = useState(false);
  const [varSel, setVarSel] = useState(''); // 'YYYY-MM' or '' (auto/latest)

  // entry modal
  const [active, setActive] = useState(null); // the client being edited/viewed
  const [categories, setCategories] = useState([]);
  const [amounts, setAmounts] = useState({}); // channelMasterId -> { amount, notes }
  const [entryLoading, setEntryLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [entryError, setEntryError] = useState('');
  const [savedMsg, setSavedMsg] = useState('');
  const [history, setHistory] = useState(null);
  const [channelSearch, setChannelSearch] = useState('');

  // request modal
  const [reqType, setReqType] = useState(null); // 'client' | 'channel'
  const [reqForm, setReqForm] = useState({ name: '', agencyId: '', category: 'TV', notes: '' });
  const [reqSubmitting, setReqSubmitting] = useState(false);
  const [reqError, setReqError] = useState('');
  const [reqMsg, setReqMsg] = useState('');

  const fetchClients = () => {
    setLoading(true);
    const params = {};
    if (agencyFilter) params.agencyId = agencyFilter;
    if (isAdmin && selectedPeriod) { params.year = selectedPeriod.year; params.month = selectedPeriod.month; }
    api.get('/forecasting/clients', { params })
      .then(r => { setClients(r.data.clients || []); setPeriod({ year: r.data.year, month: r.data.month }); })
      .catch(() => setError('Failed to load clients.'))
      .finally(() => setLoading(false));
  };
  useEffect(fetchClients, [agencyFilter, selectedPeriod]);

  useEffect(() => {
    if (view !== 'variance') return;
    setVarLoading(true);
    const params = {};
    if (varSel) { const [y, m] = varSel.split('-'); params.year = y; params.month = m; }
    api.get('/forecasting/variance', { params })
      .then(r => setVariance(r.data))
      .catch(() => setVariance(null))
      .finally(() => setVarLoading(false));
  }, [view, varSel]);

  const monthName = (m) => MONTHS[m - 1] || m;
  const fmtM = (v) => (v == null ? '-' : `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 1 })}M`);

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
    setEntryError(''); setSavedMsg(''); setHistory(null); setChannelSearch('');
    setEntryLoading(true);
    try {
      if (readOnly) {
        const { data } = await api.get('/forecasting/history', { params: { clientId: client.id } });
        setHistory(data.items || []);
      } else {
        const entryParams = { clientId: client.id };
        if (isAdmin && selectedPeriod) { entryParams.year = selectedPeriod.year; entryParams.month = selectedPeriod.month; }
        const [chRes, enRes] = await Promise.all([
          api.get('/forecasting/channels'),
          api.get('/forecasting/entry', { params: entryParams }),
        ]);
        setCategories(chRes.data.categories || []);
        const seed = {};
        // Stored in millions; show group heads the full rupee value.
        (enRes.data.items || []).forEach(it => { seed[it.channelMasterId] = { amount: String(Math.round(it.amountMillions * 1e6)), notes: it.notes || '' }; });
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

  const filteredCategories = useMemo(() => {
    if (!channelSearch.trim()) return categories;
    const q = channelSearch.toLowerCase();
    return categories
      .map(cat => ({ ...cat, channels: cat.channels.filter(ch => ch.name.toLowerCase().includes(q)) }))
      .filter(cat => cat.channels.length > 0);
  }, [categories, channelSearch]);

  // Comma-grouped display while typing; raw digits/decimal kept in state.
  const fmtAmountInput = (v) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)))
    ? (v || '')
    : Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const onAmountChange = (chId, raw) => {
    const cleaned = raw.replace(/,/g, '');
    if (cleaned === '' || /^\d*\.?\d*$/.test(cleaned)) setCell(chId, 'amount', cleaned);
  };

  // Copy the client's most recent prior forecast into the inputs to edit.
  const [copying, setCopying] = useState(false);
  const copyLast = async () => {
    setCopying(true); setEntryError(''); setSavedMsg('');
    try {
      const prevParams = { clientId: active.id };
      if (isAdmin && selectedPeriod) { prevParams.year = selectedPeriod.year; prevParams.month = selectedPeriod.month; }
      const { data } = await api.get('/forecasting/previous', { params: prevParams });
      if (!data.found) { setEntryError('No previous forecast to copy yet.'); return; }
      const seed = {};
      data.items.forEach(it => { seed[it.channelMasterId] = { amount: String(Math.round(it.amountMillions * 1e6)), notes: it.notes || '' }; });
      setAmounts(seed);
      setSavedMsg(`Copied ${MONTHS[data.month - 1]} ${data.year} — edit the amounts and submit.`);
    } catch (err) {
      setEntryError(err.response?.data?.error || 'Failed to copy previous forecast.');
    } finally {
      setCopying(false);
    }
  };

  const total = useMemo(() =>
    Object.values(amounts).reduce((s, v) => s + (parseFloat(v?.amount) || 0), 0)
  , [amounts]);

  const submit = async () => {
    setSaving(true); setEntryError(''); setSavedMsg('');
    try {
      const items = Object.entries(amounts)
        // Group heads type the full rupee amount; store it in millions.
        .map(([channelMasterId, v]) => ({ channelMasterId: Number(channelMasterId), amountMillions: parseFloat(v.amount) / 1e6, notes: v.notes }))
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

  const openReq = (type) => { setReqType(type); setReqForm({ name: '', agencyId: '', category: 'TV', notes: '' }); setReqError(''); setReqMsg(''); };
  const submitReq = async () => {
    setReqSubmitting(true); setReqError(''); setReqMsg('');
    try {
      if (reqType === 'client') {
        if (!reqForm.name.trim()) { setReqError('Client name is required.'); setReqSubmitting(false); return; }
        await api.post('/forecasting/request-client', { clientName: reqForm.name.trim(), agencyId: reqForm.agencyId || null, notes: reqForm.notes });
      } else {
        if (!reqForm.name.trim()) { setReqError('Channel name is required.'); setReqSubmitting(false); return; }
        await api.post('/forecasting/request-channel', { channelName: reqForm.name.trim(), category: reqForm.category, notes: reqForm.notes });
      }
      setReqMsg('Request sent to the admin for review.');
      setTimeout(() => setReqType(null), 900);
    } catch (err) {
      setReqError(err.response?.data?.error || 'Failed to send request.');
    } finally {
      setReqSubmitting(false);
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
          {isAdmin && monthOptions.length > 0 && (
            <select
              className="select"
              value={selectedPeriod ? `${selectedPeriod.year}-${selectedPeriod.month}` : `${anchorMonth.year}-${anchorMonth.month}`}
              onChange={e => {
                const [y, m] = e.target.value.split('-').map(Number);
                setSelectedPeriod((y === anchorMonth.year && m === anchorMonth.month) ? null : { year: y, month: m });
              }}
              style={{ maxWidth: 200 }}
              title="Forecast month to enter/view — pick a past month to backfill it, then copy it forward"
            >
              {monthOptions.map(o => (
                <option key={`${o.year}-${o.month}`} value={`${o.year}-${o.month}`}>
                  {MONTHS[o.month - 1]} {o.year}{o.year === anchorMonth.year && o.month === anchorMonth.month ? ' (upcoming)' : ''}
                </option>
              ))}
            </select>
          )}
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
          {!readOnly && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => openReq('client')}><Icon name="plus" size={14} /> Request client</button>
              <button className="btn btn-ghost btn-sm" onClick={() => openReq('channel')}><Icon name="plus" size={14} /> Request channel</button>
            </>
          )}
        </div>
      </div>

      {(isAdmin || isManager) && (
        <div style={{ display: 'inline-flex', background: '#EEF0F3', border: '1px solid #E5E8ED', borderRadius: 10, padding: 3, marginBottom: 18 }}>
          {[['clients', 'Clients'], ['variance', 'Forecast vs Actual']].map(([k, label]) => (
            <button key={k} onClick={() => setView(k)} style={{ border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, padding: '6px 14px', borderRadius: 7, fontFamily: 'inherit', background: view === k ? '#fff' : 'transparent', color: view === k ? '#16243C' : '#6B7790', boxShadow: view === k ? '0 1px 2px rgba(15,31,61,.08)' : 'none' }}>{label}</button>
          ))}
        </div>
      )}

      {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#b91c1c', marginBottom: 16 }}>{error}</div>}

      {view === 'variance' ? (
        <div className="tbl-wrap" style={{ background: '#fff', border: '1px solid #E5E8ED', borderRadius: 14, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#16243C' }}>
              Forecast vs Actual{variance ? ` · ${monthName(variance.month)} ${variance.year}` : ''}
            </div>
            <select className="select" value={varSel || (variance ? `${variance.year}-${variance.month}` : '')} onChange={e => setVarSel(e.target.value)} style={{ maxWidth: 200 }}>
              {variance?.months?.length ? variance.months.map(m => (
                <option key={`${m.year}-${m.month}`} value={`${m.year}-${m.month}`}>{monthName(m.month)} {m.year}</option>
              )) : <option value="">No forecasts yet</option>}
            </select>
          </div>
          {varLoading ? <OrbitLoader label="Loading…" /> : !variance || variance.rows.length === 0 ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--muted)' }}>No forecast or actual data for this month.</div>
          ) : (
            <table className="tbl" style={{ fontSize: 12.5 }}>
              <thead><tr><th>Client</th><th>Channel</th><th>Medium</th><th style={{ textAlign: 'right' }}>Forecast</th><th style={{ textAlign: 'right' }}>Actual</th><th style={{ textAlign: 'right' }}>Variance</th></tr></thead>
              <tbody>
                {variance.rows.map((r, i) => (
                  <tr key={i}>
                    <td className="strong">{r.client}</td>
                    <td>{r.channel}</td>
                    <td>{r.medium ? <span className="medium-tag" data-medium={r.medium}>{r.medium}</span> : '-'}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{fmtM(r.forecastMillions)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{fmtM(r.actualMillions)}</td>
                    <td className="mono" style={{ textAlign: 'right', color: r.varianceMillions >= 0 ? 'var(--green-600)' : 'var(--red-600)' }}>{r.varianceMillions >= 0 ? '+' : ''}{fmtM(r.varianceMillions)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 700 }}>
                  <td colSpan={3}>Total</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{fmtM(variance.totals.forecastMillions)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{fmtM(variance.totals.actualMillions)}</td>
                  <td className="mono" style={{ textAlign: 'right', color: variance.totals.varianceMillions >= 0 ? 'var(--green-600)' : 'var(--red-600)' }}>{variance.totals.varianceMillions >= 0 ? '+' : ''}{fmtM(variance.totals.varianceMillions)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      ) : filtered.length === 0 ? (
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
                <p style={{ margin: '3px 0 0', fontSize: 12.5, color: 'var(--muted)' }}>{readOnly ? 'Forecast history' : `${periodLabel} forecast · enter amounts in LKR`}</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {!readOnly && !entryLoading && (
                  <button className="btn btn-ghost btn-sm" onClick={copyLast} disabled={copying}>
                    <Icon name="history" size={14} /> {copying ? 'Copying…' : 'Copy last month'}
                  </button>
                )}
                <button className="act-btn" onClick={closeEntry}><Icon name="x" size={18} /></button>
              </div>
            </div>
            <div className="modal-body" style={{ maxHeight: '64vh', overflow: 'auto' }}>
              {entryError && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#b91c1c', marginBottom: 14 }}>{entryError}</div>}
              {savedMsg && <div style={{ background: '#ECF8F1', border: '1px solid #cdebd9', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#15814B', marginBottom: 14 }}>{savedMsg}</div>}
              {entryLoading ? <OrbitLoader label="Loading…" /> : readOnly ? (
                history && history.length > 0 ? (
                  <table className="tbl" style={{ fontSize: 12.5 }}>
                    <thead><tr><th>Period</th><th>Channel</th><th>Medium</th><th style={{ textAlign: 'right' }}>Amount</th><th>Notes</th></tr></thead>
                    <tbody>
                      {history.map((h, i) => (
                        <tr key={i}>
                          <td>{MONTHS[h.month - 1]?.slice(0, 3)} {h.year}</td>
                          <td className="strong">{h.channel}</td>
                          <td><span className="medium-tag" data-medium={h.medium}>{h.medium}</span></td>
                          <td className="mono" style={{ textAlign: 'right' }}>{fmtLKR(h.amountMillions * 1e6)}</td>
                          <td style={{ color: 'var(--muted)' }}>{h.notes}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : <div style={{ padding: '30px 0', textAlign: 'center', color: 'var(--muted)' }}>No forecasts submitted yet.</div>
              ) : (
                <>
                  {categories.length > 0 && (
                    <div style={{ position: 'relative', marginBottom: 16 }}>
                      <Icon name="search" size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
                      <input className="input" placeholder="Search channels…" value={channelSearch} onChange={e => setChannelSearch(e.target.value)} style={{ paddingLeft: 32 }} />
                    </div>
                  )}
                  {filteredCategories.map(cat => (
                    <div key={cat.category} style={{ marginBottom: 18 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: '#93A0B5', margin: '0 0 6px 2px' }}>{cat.category}</div>
                      <table className="tbl" style={{ fontSize: 12.5 }}>
                        <thead><tr><th style={{ width: '42%', position: 'static' }}>Channel</th><th style={{ width: '26%', position: 'static' }}>Amount (LKR)</th><th style={{ position: 'static' }}>Notes</th></tr></thead>
                        <tbody>
                          {cat.channels.map(ch => (
                            <tr key={ch.id}>
                              <td>{ch.name}</td>
                              <td>
                                <input className="input" type="text" inputMode="decimal" value={fmtAmountInput(amounts[ch.id]?.amount)} onChange={e => onAmountChange(ch.id, e.target.value)} placeholder="e.g. 100,000,000" style={{ height: 32, fontSize: 12.5 }} />
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
                  {categories.length > 0 && filteredCategories.length === 0 && <div style={{ padding: '30px 0', textAlign: 'center', color: 'var(--muted)' }}>No channels match "{channelSearch}".</div>}
                </>
              )}
            </div>
            <div className="modal-foot" style={{ justifyContent: 'space-between' }}>
              {!readOnly ? (
                <>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#16243C' }}>Total: <span className="mono">LKR {Math.round(total).toLocaleString('en-US')}</span></div>
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

      {/* Request new client / channel */}
      {reqType && (
        <div className="modal-scrim show" onClick={e => { if (e.target === e.currentTarget) setReqType(null); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2 style={{ margin: 0 }}>{reqType === 'client' ? 'Request new client' : 'Request new channel'}</h2>
              <button className="act-btn" onClick={() => setReqType(null)}><Icon name="x" size={18} /></button>
            </div>
            <div className="modal-body">
              {reqError && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#b91c1c', marginBottom: 14 }}>{reqError}</div>}
              {reqMsg && <div style={{ background: '#ECF8F1', border: '1px solid #cdebd9', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#15814B', marginBottom: 14 }}>{reqMsg}</div>}
              <div className="field">
                <label className="field-label">{reqType === 'client' ? 'Client name' : 'Channel name'} <span className="req">*</span></label>
                <input className="input" value={reqForm.name} onChange={e => setReqForm(p => ({ ...p, name: e.target.value }))} autoFocus />
              </div>
              {reqType === 'client' ? (
                agencies.length > 0 && (
                  <div className="field">
                    <label className="field-label">Agency (optional)</label>
                    <select className="select" value={reqForm.agencyId} onChange={e => setReqForm(p => ({ ...p, agencyId: e.target.value }))}>
                      <option value="">No preference</option>
                      {agencies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>
                )
              ) : (
                <div className="field">
                  <label className="field-label">Category <span className="req">*</span></label>
                  <select className="select" value={reqForm.category} onChange={e => setReqForm(p => ({ ...p, category: e.target.value }))}>
                    {['TV', 'RADIO', 'PRINT', 'DIGITAL', 'CINEMA', 'OOH'].map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              )}
              <div className="field">
                <label className="field-label">Notes (optional)</label>
                <input className="input" value={reqForm.notes} onChange={e => setReqForm(p => ({ ...p, notes: e.target.value }))} placeholder="Any context for the admin" />
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={() => setReqType(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={submitReq} disabled={reqSubmitting}>{reqSubmitting ? 'Sending…' : 'Send request'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
