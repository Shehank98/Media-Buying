import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import api from '../lib/api';
import Icon, { fmtLKR } from '../components/Icon';
import MoneyInput from '../components/MoneyInput';
import OrbitLoader from '../components/OrbitLoader';

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = [CURRENT_YEAR + 1, CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2, CURRENT_YEAR - 3];

function fmtPct(v) {
  if (v == null) return '';
  return `${Number(v).toFixed(1)}%`;
}

// Indian/Sri Lankan lakh-style grouping for Excel export cells - e.g. 500000 -> "5,00,000.00"
// (last 3 digits, then groups of 2), distinct from the abbreviated on-screen fmtLKR().
function fmtLKRFull(v) {
  const n = Number(v) || 0;
  const negative = n < 0;
  const [intPart, decPart = '00'] = Math.abs(n).toFixed(2).split('.');
  let grouped = intPart;
  if (intPart.length > 3) {
    const last3 = intPart.slice(-3);
    const rest = intPart.slice(0, -3);
    grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
  }
  return `${negative ? '-' : ''}LKR ${grouped}.${decPart}`;
}

function NotSet() {
  return <span style={{ color: 'var(--muted-2)', fontSize: 12.5, fontStyle: 'italic' }}>Not set</span>;
}

// Full LKR with standard thousands separators (exact, no M/K abbreviation).
const fmtLKRPlain = (v) => (v == null ? '-' : 'LKR ' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }));

// The "Rate" cell in the client breakdown: a CPRP/Flat badge + the LKR amount,
// or "Not set" for a plain discount deal (its % shows in the Discount column).
function rateCell(d) {
  const t = d?.rateType || 'DISCOUNT';
  if (t !== 'CPRP' && t !== 'FLAT') return <NotSet />;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
      <span className="badge" style={{ fontSize: 9.5, background: t === 'CPRP' ? '#EAF0FA' : '#FBF1DC', color: t === 'CPRP' ? '#1F5BB5' : '#9A5B00' }}>{t === 'CPRP' ? 'CPRP' : 'Flat'}</span>
      <span className="mono">{fmtLKRPlain(d.rateValue)}</span>
    </span>
  );
}

function SectionTitle({ children, sub }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 16, fontWeight: 720, color: 'var(--ink)', letterSpacing: '-.2px' }}>{children}</div>
      {sub && <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function TrendChip({ trend }) {
  const map = {
    up: { label: 'Improved', dot: 'var(--green-600)', bg: 'var(--green-50)', fg: 'var(--green-600)' },
    down: { label: 'Declined', dot: 'var(--red-600)', bg: 'var(--red-100)', fg: 'var(--red-600)' },
  };
  const t = map[trend] || { label: 'Unchanged', dot: 'var(--muted-2)', bg: 'var(--bg-sunken)', fg: 'var(--muted)' };
  return (
    <span className="badge" style={{ background: t.bg, color: t.fg }}>
      <span className="bdot" style={{ background: t.dot }} />
      {t.label}
    </span>
  );
}

function YearChips({ years, onToggle, options }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {options.map((y) => {
        const active = years.includes(y);
        return (
          <button
            key={y}
            type="button"
            onClick={() => onToggle(y)}
            style={{
              padding: '7px 14px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              border: active ? '1px solid var(--coral-600)' : '1px solid var(--border-strong)',
              background: active ? 'var(--coral-500)' : '#fff',
              color: active ? '#fff' : 'var(--ink-soft)',
              boxShadow: active ? '0 1px 2px rgba(232,93,36,.35)' : 'none',
              transition: '.13s',
            }}
          >
            {y}
          </button>
        );
      })}
    </div>
  );
}

// Searchable combobox for picking a channel - text input filters a grouped
// (by medium) dropdown list instead of relying on native <select> filtering.
function ChannelCombobox({ channels, value, onChange, placeholder = 'Select a channel…' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef(null);

  const selected = channels.find((c) => String(c.id) === String(value));

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const filteredByMedium = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? channels.filter((c) => c.name.toLowerCase().includes(q)) : channels;
    const groups = {};
    list.forEach((c) => {
      if (!groups[c.medium]) groups[c.medium] = [];
      groups[c.medium].push(c);
    });
    return groups;
  }, [channels, query]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input
        className="input"
        type="text"
        value={open ? query : (selected?.name || '')}
        placeholder={placeholder}
        onFocus={() => { setOpen(true); setQuery(''); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
      />
      {open && (
        <div
          className="card"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 30,
            maxHeight: 320, overflowY: 'auto', padding: 6, boxShadow: '0 8px 24px rgba(20,30,50,.18)',
          }}
        >
          {Object.keys(filteredByMedium).length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--muted)' }}>No channels match.</div>
          )}
          {Object.entries(filteredByMedium).map(([medium, list]) => (
            <div key={medium} style={{ marginBottom: 4 }}>
              <div style={{ fontSize: 10.5, fontWeight: 720, textTransform: 'uppercase', letterSpacing: '.4px', color: 'var(--muted)', padding: '6px 10px 2px' }}>{medium}</div>
              {list.map((c) => (
                <div
                  key={c.id}
                  onClick={() => { onChange(String(c.id)); setOpen(false); setQuery(''); }}
                  style={{
                    padding: '8px 10px', borderRadius: 7, fontSize: 13.5, cursor: 'pointer',
                    background: String(c.id) === String(value) ? 'var(--coral-50)' : 'transparent',
                    color: String(c.id) === String(value) ? 'var(--coral-700)' : 'var(--ink)',
                    fontWeight: String(c.id) === String(value) ? 650 : 500,
                  }}
                  onMouseEnter={(e) => { if (String(c.id) !== String(value)) e.currentTarget.style.background = 'var(--bg-sunken)'; }}
                  onMouseLeave={(e) => { if (String(c.id) !== String(value)) e.currentTarget.style.background = 'transparent'; }}
                >
                  {c.name}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DealModal({ title, channelName, clientName, years, onToggleYear, discountPct, setDiscountPct, bonusPct, setBonusPct, notes, setNotes, onSubmit, onClose, submitting, error, channelSelect, clientSelect, rateType, setRateType, rateValue, setRateValue }) {
  const hasRateType = typeof setRateType === 'function'; // client deals only
  return (
    <div className="modal-scrim show" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div style={{ fontSize: 17, fontWeight: 720, color: 'var(--ink)', letterSpacing: '-.3px' }}>{title}</div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={18} /></button>
        </div>
        <form onSubmit={onSubmit}>
          <div className="modal-body">
            {error && (
              <div style={{ background: 'var(--red-100)', border: '1px solid var(--red-100)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--red-600)', marginBottom: 16, fontWeight: 600 }}>{error}</div>
            )}
            {channelSelect ? (
              <div className="field">
                <label className="field-label">Channel <span className="req">*</span></label>
                {channelSelect}
              </div>
            ) : (
              <div className="field">
                <label className="field-label">Channel</label>
                <input className="input" type="text" value={channelName || ''} disabled />
              </div>
            )}
            {clientName !== undefined && (
              clientSelect ? (
                <div className="field">
                  <label className="field-label">Client <span className="req">*</span></label>
                  {clientSelect}
                </div>
              ) : (
                <div className="field">
                  <label className="field-label">Client</label>
                  <input className="input" type="text" value={clientName || ''} disabled />
                </div>
              )
            )}
            <div className="field">
              <label className="field-label">Year(s) <span className="req">*</span></label>
              <YearChips years={years} onToggle={onToggleYear} options={YEAR_OPTIONS} />
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: '8px 0 0' }}>
                Select every year these terms apply to. Saving applies the same discount/bonus to each selected year in one go.
              </p>
            </div>
            {hasRateType && (
              <div className="field">
                <label className="field-label">Rate type <span className="req">*</span></label>
                <select className="input" value={rateType} onChange={(e) => setRateType(e.target.value)}>
                  <option value="DISCOUNT">Discount %</option>
                  <option value="CPRP">CPRP rate (LKR)</option>
                  <option value="FLAT">Flat rate (LKR)</option>
                </select>
              </div>
            )}
            <div className="field-grid2">
              <div className="field">
                {(!hasRateType || rateType === 'DISCOUNT') ? (
                  <>
                    <label className="field-label">Discount % <span className="req">*</span></label>
                    <input className="input" type="number" step="0.1" value={discountPct} onChange={(e) => setDiscountPct(e.target.value)} placeholder="40" />
                  </>
                ) : (
                  <>
                    <label className="field-label">{rateType === 'CPRP' ? 'CPRP rate (LKR)' : 'Flat rate (LKR)'} <span className="req">*</span></label>
                    <input className="input" type="number" step="1" value={rateValue} onChange={(e) => setRateValue(e.target.value)} placeholder="0" />
                  </>
                )}
              </div>
              <div className="field">
                <label className="field-label">Bonus % <span className="req">*</span></label>
                <input className="input" type="number" step="0.1" value={bonusPct} onChange={(e) => setBonusPct(e.target.value)} placeholder="25" />
              </div>
            </div>
            <div className="field">
              <label className="field-label">Notes</label>
              <textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Conditions, validity, context..." />
            </div>
          </div>
          <div className="modal-foot">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Saving…' : years.length > 1 ? `Save ${years.length} Years` : 'Save Deal'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function StatTile({ icon, color, bg, label, value, meta }) {
  return (
    <div className="stat" style={{ padding: '16px 18px' }}>
      <div className="stat-top">
        <div className="stat-ico" style={{ background: bg, color }}>
          <Icon name={icon} size={17} />
        </div>
        <span className="stat-label">{label}</span>
      </div>
      <div className="stat-val" style={{ fontSize: 21, fontFamily: 'var(--mono)' }}>{value}</div>
      {meta && <div className="stat-meta">{meta}</div>}
    </div>
  );
}

export default function MediaBuyingPage() {
  const [channels, setChannels] = useState([]);
  const [channelMasterId, setChannelMasterId] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [sortKey, setSortKey] = useState('totalSpend');
  const [sortDir, setSortDir] = useState('desc');
  const [onlyMissingDeals, setOnlyMissingDeals] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [rollMsg, setRollMsg] = useState('');
  const [expandedClientId, setExpandedClientId] = useState(null);
  const [yearlyByClient, setYearlyByClient] = useState({});
  const [yearlyLoading, setYearlyLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Agency deal modal
  const [showAgencyModal, setShowAgencyModal] = useState(false);
  const [agencyYears, setAgencyYears] = useState([CURRENT_YEAR]);
  const [agencyDiscount, setAgencyDiscount] = useState('');
  const [agencyBonus, setAgencyBonus] = useState('');
  const [agencyNotes, setAgencyNotes] = useState('');
  const [agencySubmitting, setAgencySubmitting] = useState(false);
  const [agencyError, setAgencyError] = useState('');

  // Client deal modal
  const [showClientModal, setShowClientModal] = useState(false);
  const [clientModalClientId, setClientModalClientId] = useState('');
  const [clientModalClientName, setClientModalClientName] = useState('');
  const [clientYears, setClientYears] = useState([CURRENT_YEAR]);
  const [clientRateType, setClientRateType] = useState('DISCOUNT');
  const [clientRateValue, setClientRateValue] = useState('');
  const [clientDiscount, setClientDiscount] = useState('');
  const [clientBonus, setClientBonus] = useState('');
  const [clientNotes, setClientNotes] = useState('');
  const [clientSubmitting, setClientSubmitting] = useState(false);
  const [clientError, setClientError] = useState('');

  // Standalone "+Add Deal" entry point (channel + client both selectable)
  const [showQuickAddModal, setShowQuickAddModal] = useState(false);
  const [quickAddChannelId, setQuickAddChannelId] = useState('');
  const [quickAddClientId, setQuickAddClientId] = useState('');
  const [quickAddYears, setQuickAddYears] = useState([CURRENT_YEAR]);
  const [quickAddDiscount, setQuickAddDiscount] = useState('');
  const [quickAddBonus, setQuickAddBonus] = useState('');
  const [quickAddNotes, setQuickAddNotes] = useState('');
  const [quickAddSubmitting, setQuickAddSubmitting] = useState(false);
  const [quickAddError, setQuickAddError] = useState('');
  const [allClients, setAllClients] = useState([]);

  // Negotiation planner panel
  const [showPlanner, setShowPlanner] = useState(false);
  const [plannerBudget, setPlannerBudget] = useState('');
  const [plannerResult, setPlannerResult] = useState(null);
  const [plannerLoading, setPlannerLoading] = useState(false);

  useEffect(() => {
    api.get('/masterdata/channel-masters').then((res) => {
      setChannels((res.data.channelMasters || []).filter((c) => c.isActive !== false));
    }).catch(() => {});
    api.get('/agencies').then(async (res) => {
      const agencies = res.data || [];
      const all = [];
      for (const a of agencies) {
        try {
          const r = await api.get(`/agencies/${a.id}/clients`);
          (r.data || []).forEach((c) => all.push(c));
        } catch { /* ignore */ }
      }
      setAllClients(all);
    }).catch(() => {});
  }, []);

  const fetchData = useCallback(() => {
    if (!channelMasterId) { setData(null); return; }
    setLoading(true);
    api.get(`/media-buying/channels/${channelMasterId}`)
      .then((res) => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [channelMasterId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => { setExpandedClientId(null); setYearlyByClient({}); setRollMsg(''); setOnlyMissingDeals(false); }, [channelMasterId]);

  // Roll this channel's deals (agency + all clients) forward from a source year
  // to the next year - only fills years not already negotiated (never overwrites).
  const rollForward = useCallback(async (fromYear) => {
    if (!channelMasterId || !fromYear) return;
    const toYear = fromYear + 1;
    if (!window.confirm(`Copy ${fromYear} deals to ${toYear} for this channel? Existing ${toYear} deals are kept as-is.`)) return;
    setRolling(true); setRollMsg('');
    try {
      const { data: r } = await api.post(`/media-buying/channels/${channelMasterId}/roll-forward`, { fromYear, toYear });
      const parts = [];
      if (r.agencyCopied) parts.push('agency deal');
      parts.push(`${r.clientsCopied} client deal${r.clientsCopied === 1 ? '' : 's'}`);
      const skipped = (r.agencySkipped || 0) + (r.clientsSkipped || 0);
      setRollMsg(`Copied ${parts.join(' + ')} to ${toYear}${skipped ? ` (${skipped} already existed, kept)` : ''}.`);
      fetchData();
    } catch (err) {
      setRollMsg(err.response?.data?.error || 'Failed to roll deals forward.');
    } finally { setRolling(false); }
  }, [channelMasterId, fetchData]);

  const channelsByMedium = useMemo(() => {
    const groups = {};
    channels.forEach((c) => {
      if (!groups[c.medium]) groups[c.medium] = [];
      groups[c.medium].push(c);
    });
    return groups;
  }, [channels]);

  const noDeal = (c) => !(c.hasDeal ?? (c.discountPct != null || c.bonusPct != null));
  const missingDealClients = useMemo(() => (data?.clients || []).filter(noDeal), [data]);
  const sortedClients = useMemo(() => {
    if (!data?.clients) return [];
    let arr = [...data.clients];
    if (onlyMissingDeals) arr = arr.filter(noDeal);
    arr.sort((a, b) => {
      const av = a[sortKey] ?? -Infinity;
      const bv = b[sortKey] ?? -Infinity;
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return arr;
  }, [data, sortKey, sortDir, onlyMissingDeals]);

  const latestAgencyDeal = data?.agencyDeals?.[0] || null;
  const latestDealYear = useMemo(() => {
    const ys = [];
    (data?.agencyDeals || []).forEach((d) => ys.push(d.year));
    (data?.clients || []).forEach((c) => { if (c.dealYear) ys.push(c.dealYear); });
    return ys.length ? Math.max(...ys) : null;
  }, [data]);
  const totalClientSpend = useMemo(() => sortedClients.reduce((s, c) => s + (c.totalSpend || 0), 0), [sortedClients]);

  function toggleSort(key) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
  }

  function toggleExpand(client) {
    if (expandedClientId === client.clientId) { setExpandedClientId(null); return; }
    setExpandedClientId(client.clientId);
    if (!yearlyByClient[client.clientId]) {
      setYearlyLoading(true);
      api.get(`/media-buying/channels/${channelMasterId}/clients/${client.clientId}/yearly`)
        .then((res) => setYearlyByClient((p) => ({ ...p, [client.clientId]: res.data })))
        .finally(() => setYearlyLoading(false));
    }
  }

  function toggleYearIn(setFn) {
    return (y) => setFn((prev) => (prev.includes(y) ? prev.filter((v) => v !== y) : [...prev, y].sort((a, b) => a - b)));
  }

  function openAgencyModal() {
    setAgencyYears([CURRENT_YEAR]);
    const existing = data?.agencyDeals?.find((d) => d.year === CURRENT_YEAR);
    setAgencyDiscount(existing ? String(existing.discountPct) : '');
    setAgencyBonus(existing ? String(existing.bonusPct) : '');
    setAgencyNotes(existing ? existing.notes : '');
    setAgencyError('');
    setShowAgencyModal(true);
  }

  async function handleAgencySubmit(e) {
    e.preventDefault();
    if (agencyYears.length === 0 || agencyDiscount === '' || agencyBonus === '') { setAgencyError('At least one year, discount %, and bonus % are required.'); return; }
    setAgencySubmitting(true);
    setAgencyError('');
    try {
      await Promise.all(agencyYears.map((y) => api.post('/media-buying/agency-deals', {
        channelMasterId: parseInt(channelMasterId),
        year: y,
        discountPct: parseFloat(agencyDiscount),
        bonusPct: parseFloat(agencyBonus),
        notes: agencyNotes,
      })));
      setShowAgencyModal(false);
      fetchData();
    } catch (err) {
      setAgencyError(err.response?.data?.error || 'Failed to save agency deal.');
    } finally {
      setAgencySubmitting(false);
    }
  }

  function openClientModal(client) {
    setClientModalClientId(client.clientId);
    setClientModalClientName(client.clientName);
    setClientYears([client.dealYear || CURRENT_YEAR]);
    setClientRateType(client.rateType || 'DISCOUNT');
    setClientRateValue(client.rateValue != null ? String(client.rateValue) : '');
    setClientDiscount(client.discountPct != null ? String(client.discountPct) : '');
    setClientBonus(client.bonusPct != null ? String(client.bonusPct) : '');
    setClientNotes(client.notes || '');
    setClientError('');
    setShowClientModal(true);
  }

  async function handleClientSubmit(e) {
    e.preventDefault();
    const rt = clientRateType || 'DISCOUNT';
    const rateOk = rt === 'DISCOUNT' ? clientDiscount !== '' : clientRateValue !== '';
    if (clientYears.length === 0 || !rateOk || clientBonus === '') { setClientError(`At least one year, ${rt === 'DISCOUNT' ? 'discount %' : (rt === 'CPRP' ? 'CPRP rate' : 'flat rate')}, and bonus % are required.`); return; }
    setClientSubmitting(true);
    setClientError('');
    try {
      await Promise.all(clientYears.map((y) => api.post('/media-buying/client-deals', {
        channelMasterId: parseInt(channelMasterId),
        clientId: parseInt(clientModalClientId),
        year: y,
        rateType: rt,
        discountPct: rt === 'DISCOUNT' ? parseFloat(clientDiscount) : 0,
        rateValue: rt === 'DISCOUNT' ? null : parseFloat(clientRateValue),
        bonusPct: parseFloat(clientBonus),
        notes: clientNotes,
      })));
      setShowClientModal(false);
      fetchData();
      setYearlyByClient((p) => { const n = { ...p }; delete n[clientModalClientId]; return n; });
    } catch (err) {
      setClientError(err.response?.data?.error || 'Failed to save client deal.');
    } finally {
      setClientSubmitting(false);
    }
  }

  function openQuickAddModal() {
    setQuickAddChannelId(channelMasterId || '');
    setQuickAddClientId('');
    setQuickAddYears([CURRENT_YEAR]);
    setQuickAddDiscount('');
    setQuickAddBonus('');
    setQuickAddNotes('');
    setQuickAddError('');
    setShowQuickAddModal(true);
  }

  async function handleQuickAddSubmit(e) {
    e.preventDefault();
    if (!quickAddChannelId || !quickAddClientId || quickAddYears.length === 0 || quickAddDiscount === '' || quickAddBonus === '') {
      setQuickAddError('Channel, client, at least one year, discount %, and bonus % are required.');
      return;
    }
    setQuickAddSubmitting(true);
    setQuickAddError('');
    try {
      await Promise.all(quickAddYears.map((y) => api.post('/media-buying/client-deals', {
        channelMasterId: parseInt(quickAddChannelId),
        clientId: parseInt(quickAddClientId),
        year: y,
        discountPct: parseFloat(quickAddDiscount),
        bonusPct: parseFloat(quickAddBonus),
        notes: quickAddNotes,
      })));
      setShowQuickAddModal(false);
      if (String(quickAddChannelId) === String(channelMasterId)) fetchData();
    } catch (err) {
      setQuickAddError(err.response?.data?.error || 'Failed to save deal.');
    } finally {
      setQuickAddSubmitting(false);
    }
  }

  function openPlanner() {
    setPlannerBudget('');
    setPlannerResult(null);
    setShowPlanner(true);
  }

  useEffect(() => {
    if (!showPlanner || !channelMasterId || !plannerBudget) { setPlannerResult(null); return; }
    const t = setTimeout(() => {
      setPlannerLoading(true);
      api.get(`/media-buying/channels/${channelMasterId}/planner`, { params: { monthlyBudget: plannerBudget } })
        .then((res) => setPlannerResult(res.data))
        .catch(() => setPlannerResult(null))
        .finally(() => setPlannerLoading(false));
    }, 400);
    return () => clearTimeout(t);
  }, [showPlanner, channelMasterId, plannerBudget]);

  async function handleExport() {
    if (!data) return;
    setExporting(true);
    try {
      const wb = XLSX.utils.book_new();

      const summaryRows = [
        ['Media Buying: Channel Negotiation Intelligence'],
        ['Channel', data.channel.name],
        ['Medium', data.channel.medium],
        ['Clients on Channel', sortedClients.length],
        ['Total Lifetime Spend (all clients)', fmtLKRFull(totalClientSpend)],
        ['Latest Agency Deal', latestAgencyDeal ? `${latestAgencyDeal.year}: ${fmtPct(latestAgencyDeal.discountPct)} discount / ${fmtPct(latestAgencyDeal.bonusPct)} bonus` : 'Not set'],
        ['Exported', new Date().toLocaleString()],
      ];
      const summaryWs = XLSX.utils.aoa_to_sheet(summaryRows);
      XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');

      const dealHeaders = ['Year', 'Agency Discount %', 'Agency Bonus %', 'Trend', 'Notes', 'Created By'];
      const dealRows = (data.agencyDeals || []).map((d) => [d.year, fmtPct(d.discountPct), fmtPct(d.bonusPct), d.trend, d.notes, d.createdBy]);
      const dealWs = XLSX.utils.aoa_to_sheet([dealHeaders, ...dealRows]);
      XLSX.utils.book_append_sheet(wb, dealWs, 'Agency Deal History');

      const yearlyResults = await Promise.all(sortedClients.map((c) =>
        api.get(`/media-buying/channels/${channelMasterId}/clients/${c.clientId}/yearly`).then((res) => ({ client: c, years: res.data }))
      ));

      const clientHeaders = ['Client', 'Agency', 'Year', 'Yearly Spend (LKR)', 'Avg Monthly Spend (LKR)', 'Discount %', 'Bonus %', 'Notes'];
      const clientRows = [];
      yearlyResults.forEach(({ client, years }) => {
        if (years.length === 0) {
          clientRows.push([client.clientName, client.agencyName, '', fmtLKRFull(client.totalSpend), fmtLKRFull(client.totalSpend / 12), 'Not set', 'Not set', '']);
        } else {
          years.forEach((y) => {
            clientRows.push([
              client.clientName, client.agencyName, y.year, fmtLKRFull(y.spend), fmtLKRFull(y.spend / 12),
              y.discountPct != null ? fmtPct(y.discountPct) : 'Not set',
              y.bonusPct != null ? fmtPct(y.bonusPct) : 'Not set',
              y.notes,
            ]);
          });
        }
      });
      const clientWs = XLSX.utils.aoa_to_sheet([clientHeaders, ...clientRows]);
      XLSX.utils.book_append_sheet(wb, clientWs, 'Client Breakdown');

      XLSX.writeFile(wb, `media-buying-${data.channel.name.replace(/\W+/g, '_')}.xlsx`);
    } finally {
      setExporting(false);
    }
  }

  function handlePlannerExport() {
    if (!plannerResult || !selectedChannel) return;
    const wb = XLSX.utils.book_new();
    const discountMid = plannerResult.suggestedDiscountRange ? (plannerResult.suggestedDiscountRange.min + plannerResult.suggestedDiscountRange.max) / 2 : null;
    const bonusMid = plannerResult.suggestedBonusRange ? (plannerResult.suggestedBonusRange.min + plannerResult.suggestedBonusRange.max) / 2 : null;
    const rows = [
      ['Negotiation Plan'],
      ['Channel', selectedChannel.name],
      ['Medium', selectedChannel.medium],
      ['Generated', new Date().toLocaleString()],
      [],
      ['Proposed Monthly Budget (LKR)', fmtLKRFull(plannerResult.monthlyBudget)],
      ['Projected Yearly Spend (LKR)', fmtLKRFull(plannerResult.projectedYearlySpend)],
      ['Spend Tier', plannerResult.spendTier],
      ['Percentile vs Existing Clients', plannerResult.budgetPercentileRank != null ? `Higher than ${plannerResult.budgetPercentileRank}% of clients` : 'N/A'],
      ['Tier threshold (Low/Mid cutoff, LKR avg yearly spend)', fmtLKRFull(plannerResult.tierThresholds.lowMax)],
      ['Tier threshold (Mid/High cutoff, LKR avg yearly spend)', fmtLKRFull(plannerResult.tierThresholds.midMax)],
      [],
      ['Channel Context'],
      ['Total Clients on Channel', plannerResult.totalClientsOnChannel ?? 0],
      ['Low Tier Clients', plannerResult.tierCounts?.Low ?? 0],
      ['Mid Tier Clients', plannerResult.tierCounts?.Mid ?? 0],
      ['High Tier Clients', plannerResult.tierCounts?.High ?? 0],
      ['Overall Avg Discount % (all clients)', plannerResult.overallAvgDiscountPct != null ? `${plannerResult.overallAvgDiscountPct.toFixed(1)}%` : 'N/A'],
      ['Overall Avg Bonus % (all clients)', plannerResult.overallAvgBonusPct != null ? `${plannerResult.overallAvgBonusPct.toFixed(1)}%` : 'N/A'],
      ['Largest Client (avg yearly spend, LKR)', plannerResult.highestYearlySpend != null ? fmtLKRFull(plannerResult.highestYearlySpend) : 'N/A'],
      [],
      ['Suggested Discount Range (avg over all years, same tier)', plannerResult.suggestedDiscountRange ? `${plannerResult.suggestedDiscountRange.min.toFixed(1)}% – ${plannerResult.suggestedDiscountRange.max.toFixed(1)}%` : 'No comparable data'],
      ['Suggested Bonus Range (avg over all years, same tier)', plannerResult.suggestedBonusRange ? `${plannerResult.suggestedBonusRange.min.toFixed(1)}% – ${plannerResult.suggestedBonusRange.max.toFixed(1)}%` : 'No comparable data'],
      ['Estimated Effective Monthly Cost @ Midpoint Discount (LKR)', discountMid != null ? fmtLKRFull(plannerResult.monthlyBudget * (1 - discountMid / 100)) : 'N/A'],
      ['Estimated Monthly Bonus Value @ Midpoint Bonus (LKR)', bonusMid != null ? fmtLKRFull(plannerResult.monthlyBudget * (bonusMid / 100)) : 'N/A'],
      [],
      ['Agency Deal Reference Year', plannerResult.agencyDealReference?.year ?? 'No agency deal recorded'],
      ['Agency Discount %', plannerResult.agencyDealReference?.discountPct != null ? `${plannerResult.agencyDealReference.discountPct.toFixed(1)}%` : ''],
      ['Agency Bonus %', plannerResult.agencyDealReference?.bonusPct != null ? `${plannerResult.agencyDealReference.bonusPct.toFixed(1)}%` : ''],
      ['Agency Deal Notes', plannerResult.agencyDealReference?.notes ?? ''],
      [],
      ['Comparable Clients (' + plannerResult.spendTier + ' tier, averaged across all years)'],
      ['Client', 'Avg Yearly Spend (LKR)', 'Avg Monthly Spend (LKR)', 'Avg Discount %', 'Avg Bonus %', 'Years of Data'],
      ...plannerResult.comparableClients.map((c) => [c.clientName, fmtLKRFull(c.avgYearlySpend), fmtLKRFull(c.avgYearlySpend / 12), `${c.avgDiscountPct.toFixed(1)}%`, `${c.avgBonusPct.toFixed(1)}%`, c.yearsOfData]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Negotiation Plan');
    XLSX.writeFile(wb, `negotiation-plan-${selectedChannel.name.replace(/\W+/g, '_')}.xlsx`);
  }

  const selectedChannel = channels.find((c) => String(c.id) === String(channelMasterId));

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h1 className="page-title">Media Buying</h1>
          <p className="page-sub">Channel negotiation intelligence: discount &amp; bonus deal history, planning.</p>
        </div>
        <button className="btn btn-primary" onClick={openQuickAddModal}><Icon name="plus" size={16} /> Add Deal</button>
      </div>

      <div className="card" style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap', justifyContent: 'space-between', padding: 18, marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ minWidth: 320, marginBottom: 0 }}>
            <label className="field-label">Channel</label>
            <ChannelCombobox channels={channels} value={channelMasterId} onChange={setChannelMasterId} />
          </div>
        </div>
        {channelMasterId && (
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-ghost" onClick={handleExport} disabled={!data || exporting}>
              <Icon name="download" size={15} /> {exporting ? 'Exporting…' : 'Export to Excel'}
            </button>
            <button className="btn btn-primary" onClick={openPlanner}><Icon name="sparkle" size={15} /> Plan New Client</button>
          </div>
        )}
      </div>

      {!channelMasterId && (
        <div className="card" style={{ textAlign: 'center', padding: '64px 20px' }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--coral-50)', color: 'var(--coral-600)', display: 'grid', placeItems: 'center', margin: '0 auto 14px' }}>
            <Icon name="sparkle" size={24} />
          </div>
          <p style={{ color: 'var(--muted)', fontSize: 13.5, margin: 0 }}>Select a channel above to view its negotiation history.</p>
        </div>
      )}

      {channelMasterId && loading && <OrbitLoader label="Loading channel intelligence…" />}

      {channelMasterId && !loading && data && (
        <>
          {/* KPI strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 20 }}>
            <StatTile
              icon="dollar" color="#fff" bg="var(--navy-900)"
              label="Agency Deal" meta={latestAgencyDeal ? `latest, ${latestAgencyDeal.year}` : 'no history'}
              value={latestAgencyDeal ? `${fmtPct(latestAgencyDeal.discountPct)} / ${fmtPct(latestAgencyDeal.bonusPct)}` : 'Not set'}
            />
            <StatTile
              icon="users" color="#fff" bg="var(--blue-700)"
              label="Clients on Channel" meta="all-time"
              value={sortedClients.length}
            />
            <StatTile
              icon="money" color="#fff" bg="var(--coral-500)"
              label="Total Spend (All Years)" meta="across all clients"
              value={fmtLKR(totalClientSpend)}
            />
            <StatTile
              icon="chart" color="#fff" bg="var(--green-600)"
              label="Deal Years Recorded" meta="agency-level history"
              value={data.agencyDeals.length}
            />
          </div>

          {/* Agency-Level Deal Block */}
          <div className="card" style={{ padding: 20, marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
              <SectionTitle sub="Year-over-year negotiated terms with the agency for this channel.">
                Agency-Level Deal: {data.channel.name}
              </SectionTitle>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {latestDealYear && (
                  <button className="btn btn-ghost btn-sm" disabled={rolling} onClick={() => rollForward(latestDealYear)} title={`Copy ${latestDealYear} deals (agency + all clients) into ${latestDealYear + 1}`}>
                    <Icon name="history" size={14} /> {rolling ? 'Rolling…' : `Roll ${latestDealYear} → ${latestDealYear + 1}`}
                  </button>
                )}
                <button className="btn btn-primary btn-sm" onClick={openAgencyModal}>Add / Edit Deal</button>
              </div>
            </div>
            {rollMsg && (
              <div style={{ marginTop: 10, fontSize: 12.5, fontWeight: 600, color: /fail|error/i.test(rollMsg) ? 'var(--red-600)' : 'var(--green-600)' }}>{rollMsg}</div>
            )}
            {data.agencyDeals.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '28px 0' }}>
                <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>No agency-level deal recorded yet for this channel.</p>
              </div>
            ) : (
              <div className="tbl-wrap" style={{ boxShadow: 'none', border: '1px solid var(--border)' }}>
                <table className="tbl">
                  <thead>
                    <tr><th>Year</th><th className="num">Discount %</th><th className="num">Bonus %</th><th>Trend</th><th>Notes</th></tr>
                  </thead>
                  <tbody>
                    {data.agencyDeals.map((d) => (
                      <tr key={d.id}>
                        <td className="strong">{d.year}</td>
                        <td className="num strong">{fmtPct(d.discountPct)}</td>
                        <td className="num strong">{fmtPct(d.bonusPct)}</td>
                        <td><TrendChip trend={d.trend} /></td>
                        <td>{d.notes ? d.notes : <NotSet />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Client Breakdown Table */}
          <div className="card" style={{ padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
              <SectionTitle sub="Lifetime spend per client on this channel, with their most recently recorded deal terms. Expand a row for the year-by-year breakdown.">
                Client Breakdown (All Years)
              </SectionTitle>
              {missingDealClients.length > 0 && (
                <button
                  onClick={() => setOnlyMissingDeals(v => !v)}
                  className={`btn btn-sm ${onlyMissingDeals ? 'btn-primary' : 'btn-ghost'}`}
                  title="Clients with spend on this channel but no recorded discount/bonus deal"
                >
                  <Icon name="alert" size={14} /> {missingDealClients.length} missing deal{missingDealClients.length === 1 ? '' : 's'}{onlyMissingDeals ? ' · showing' : ''}
                </button>
              )}
            </div>
            {sortedClients.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '28px 0' }}>
                <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>No clients have bought on this channel yet.</p>
              </div>
            ) : (
              <div className="tbl-wrap" style={{ boxShadow: 'none', border: '1px solid var(--border)' }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th style={{ width: 36 }}></th>
                      <th onClick={() => toggleSort('clientName')} style={{ cursor: 'pointer' }}>Client</th>
                      <th onClick={() => toggleSort('totalSpend')} className="num" style={{ cursor: 'pointer' }}>Total Spend</th>
                      <th onClick={() => toggleSort('discountPct')} className="num" style={{ cursor: 'pointer' }}>Discount %</th>
                      <th onClick={() => toggleSort('bonusPct')} className="num" style={{ cursor: 'pointer' }}>Bonus %</th>
                      <th className="num">Rate</th>
                      <th onClick={() => toggleSort('dealYear')} className="num" style={{ cursor: 'pointer' }}>Deal Year</th>
                      <th className="num">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedClients.map((c) => (
                      <>
                        <tr key={c.clientId}>
                          <td>
                            <button className="act-btn" onClick={() => toggleExpand(c)} title="Show year-by-year breakdown">
                              <Icon name={expandedClientId === c.clientId ? 'chevDown' : 'chevR'} size={14} />
                            </button>
                          </td>
                          <td>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              {c.clientName}
                              {noDeal(c) && <span className="badge" style={{ fontSize: 9.5, background: 'var(--coral-50,#FDEDE7)', color: 'var(--coral-700,#C44A18)' }}>No deal</span>}
                            </span>
                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{c.agencyName}</div>
                          </td>
                          <td className="num strong">{fmtLKR(c.totalSpend)}</td>
                          <td className="num">{(c.rateType || 'DISCOUNT') === 'DISCOUNT' && c.discountPct != null ? fmtPct(c.discountPct) : <NotSet />}</td>
                          <td className="num">{c.bonusPct != null ? fmtPct(c.bonusPct) : <NotSet />}</td>
                          <td className="num">{rateCell(c)}</td>
                          <td className="num">{c.dealYear ?? <NotSet />}</td>
                          <td>
                            <div className="row-actions">
                              <button className="act-btn" title="Edit deal" onClick={() => openClientModal(c)}><Icon name="edit" size={14} /></button>
                            </div>
                          </td>
                        </tr>
                        {expandedClientId === c.clientId && (
                          <tr key={`${c.clientId}-expanded`}>
                            <td colSpan={8} style={{ background: 'var(--bg)', padding: 14 }}>
                              {yearlyLoading && !yearlyByClient[c.clientId] ? (
                                <OrbitLoader size={24} label="Loading yearly breakdown…" />
                              ) : (
                                (yearlyByClient[c.clientId] || []).length === 0 ? (
                                  <span style={{ fontSize: 13, color: 'var(--muted)' }}>No yearly data.</span>
                                ) : (
                                  <div className="tbl-wrap" style={{ boxShadow: 'none', border: '1px solid var(--border)' }}>
                                    <table className="tbl">
                                      <thead>
                                        <tr><th>Year</th><th className="num">Spend</th><th className="num">Avg Monthly Spend</th><th className="num">Discount %</th><th className="num">Bonus %</th><th className="num">Rate</th><th>Notes</th></tr>
                                      </thead>
                                      <tbody>
                                        {(yearlyByClient[c.clientId] || []).map((y) => (
                                          <tr key={y.year}>
                                            <td className="strong">{y.year}</td>
                                            <td className="num">{fmtLKR(y.spend)}</td>
                                            <td className="num">{fmtLKR(y.spend / 12)}</td>
                                            <td className="num">{(y.rateType || 'DISCOUNT') === 'DISCOUNT' && y.discountPct != null ? fmtPct(y.discountPct) : <NotSet />}</td>
                                            <td className="num">{y.bonusPct != null ? fmtPct(y.bonusPct) : <NotSet />}</td>
                                            <td className="num">{rateCell(y)}</td>
                                            <td>{y.notes ? y.notes : <NotSet />}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )
                              )}
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Agency Deal Modal */}
      {showAgencyModal && (
        <DealModal
          title={data?.agencyDeals?.some((d) => agencyYears.includes(d.year)) ? 'Edit Agency Deal' : 'Add Agency Deal'}
          channelName={selectedChannel?.name}
          years={agencyYears} onToggleYear={toggleYearIn(setAgencyYears)}
          discountPct={agencyDiscount} setDiscountPct={setAgencyDiscount}
          bonusPct={agencyBonus} setBonusPct={setAgencyBonus}
          notes={agencyNotes} setNotes={setAgencyNotes}
          onSubmit={handleAgencySubmit}
          onClose={() => setShowAgencyModal(false)}
          submitting={agencySubmitting}
          error={agencyError}
        />
      )}

      {/* Client Deal Modal */}
      {showClientModal && (
        <DealModal
          title="Edit Client Deal"
          channelName={selectedChannel?.name}
          clientName={clientModalClientName}
          years={clientYears} onToggleYear={toggleYearIn(setClientYears)}
          rateType={clientRateType} setRateType={setClientRateType}
          rateValue={clientRateValue} setRateValue={setClientRateValue}
          discountPct={clientDiscount} setDiscountPct={setClientDiscount}
          bonusPct={clientBonus} setBonusPct={setClientBonus}
          notes={clientNotes} setNotes={setClientNotes}
          onSubmit={handleClientSubmit}
          onClose={() => setShowClientModal(false)}
          submitting={clientSubmitting}
          error={clientError}
        />
      )}

      {/* Standalone +Add Deal Modal (channel + client both selectable) */}
      {showQuickAddModal && (
        <DealModal
          title="Add Client Deal"
          channelName={channels.find((c) => String(c.id) === String(quickAddChannelId))?.name}
          clientName={allClients.find((c) => String(c.id) === String(quickAddClientId))?.name}
          years={quickAddYears} onToggleYear={toggleYearIn(setQuickAddYears)}
          discountPct={quickAddDiscount} setDiscountPct={setQuickAddDiscount}
          bonusPct={quickAddBonus} setBonusPct={setQuickAddBonus}
          notes={quickAddNotes} setNotes={setQuickAddNotes}
          onSubmit={handleQuickAddSubmit}
          onClose={() => setShowQuickAddModal(false)}
          submitting={quickAddSubmitting}
          error={quickAddError}
          channelSelect={
            <select className="select" value={quickAddChannelId} onChange={(e) => setQuickAddChannelId(e.target.value)}>
              <option value="">Select channel…</option>
              {Object.entries(channelsByMedium).map(([medium, list]) => (
                <optgroup key={medium} label={medium}>
                  {list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </optgroup>
              ))}
            </select>
          }
          clientSelect={
            <select className="select" value={quickAddClientId} onChange={(e) => setQuickAddClientId(e.target.value)}>
              <option value="">Select client…</option>
              {allClients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          }
        />
      )}

      {/* Negotiation Planner Panel */}
      <div className={`scrim${showPlanner ? ' show' : ''}`} onClick={() => setShowPlanner(false)} />
      <div className={`panel panel-wide${showPlanner ? ' show' : ''}`}>
        <div className="panel-head">
          <div style={{ flex: 1 }}>
            <div className="panel-title">Negotiation Planner</div>
            <div className="panel-sub">{selectedChannel?.name}</div>
          </div>
          {plannerResult && (
            <button className="btn btn-subtle btn-sm" onClick={handlePlannerExport} style={{ marginRight: 8 }}>
              <Icon name="download" size={14} /> Export
            </button>
          )}
          <button className="icon-btn" style={{ border: 'none', background: 'var(--bg-sunken)' }} onClick={() => setShowPlanner(false)}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="panel-body">
          <div className="field">
            <label className="field-label">Proposed Monthly Budget (LKR)</label>
            <MoneyInput className="input" value={plannerBudget} onValueChange={(v) => setPlannerBudget(v)} placeholder="500,000" />
          </div>
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '6px 0 0' }}>
            Suggestions are averaged across every year this channel has recorded data; no single deal year is used.
          </p>

          {plannerLoading && <OrbitLoader size={24} label="Calculating…" />}

          {!plannerLoading && plannerResult && (
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="card" style={{ background: 'var(--navy-900)', padding: 18, border: 'none' }}>
                <div style={{ fontSize: 11.5, color: 'var(--navy-300)', textTransform: 'uppercase', letterSpacing: '.5px', fontWeight: 700 }}>Projected Yearly Spend</div>
                <div style={{ fontSize: 24, fontWeight: 760, fontFamily: 'var(--mono)', color: '#fff', margin: '4px 0 8px' }}>{fmtLKR(plannerResult.projectedYearlySpend)}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <span className="badge" style={{ background: 'var(--coral-500)', color: '#fff' }}>{plannerResult.spendTier} tier</span>
                  {plannerResult.budgetPercentileRank != null && (
                    <span className="badge" style={{ background: 'rgba(255,255,255,.14)', color: '#fff' }}>
                      Higher than {plannerResult.budgetPercentileRank}% of existing clients
                    </span>
                  )}
                </div>
              </div>

              <div className="card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, marginBottom: 10, color: 'var(--ink)' }}>
                  <Icon name="users" size={15} style={{ color: 'var(--blue-700)' }} /> Channel Context
                </div>
                <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>Clients on Channel</div>
                    <div style={{ fontWeight: 700, fontFamily: 'var(--mono)' }}>{plannerResult.totalClientsOnChannel ?? 0}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>Overall Avg Discount</div>
                    <div style={{ fontWeight: 700, fontFamily: 'var(--mono)' }}>{plannerResult.overallAvgDiscountPct != null ? fmtPct(plannerResult.overallAvgDiscountPct) : <NotSet />}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>Overall Avg Bonus</div>
                    <div style={{ fontWeight: 700, fontFamily: 'var(--mono)' }}>{plannerResult.overallAvgBonusPct != null ? fmtPct(plannerResult.overallAvgBonusPct) : <NotSet />}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>Largest Client (avg/yr)</div>
                    <div style={{ fontWeight: 700, fontFamily: 'var(--mono)' }}>{plannerResult.highestYearlySpend != null ? fmtLKR(plannerResult.highestYearlySpend) : <NotSet />}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {['Low', 'Mid', 'High'].map((t) => (
                    <span key={t} className="badge" style={{ background: t === plannerResult.spendTier ? 'var(--coral-50)' : 'var(--bg-sunken)', color: t === plannerResult.spendTier ? 'var(--coral-700)' : 'var(--muted)', fontWeight: t === plannerResult.spendTier ? 700 : 500 }}>
                      {t}: {plannerResult.tierCounts?.[t] ?? 0} clients
                    </span>
                  ))}
                </div>
              </div>

              <div className="card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, marginBottom: 10, color: 'var(--ink)' }}>
                  <Icon name="sparkle" size={15} style={{ color: 'var(--coral-600)' }} /> Suggested Terms <span style={{ fontWeight: 500, fontSize: 11.5, color: 'var(--muted)' }}>(avg over all years, {plannerResult.spendTier}-tier clients)</span>
                </div>
                <div style={{ display: 'flex', gap: 28, marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>Discount %</div>
                    <div style={{ fontWeight: 700, fontFamily: 'var(--mono)' }}>
                      {plannerResult.suggestedDiscountRange ? `${fmtPct(plannerResult.suggestedDiscountRange.min)} – ${fmtPct(plannerResult.suggestedDiscountRange.max)}` : <NotSet />}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>Bonus %</div>
                    <div style={{ fontWeight: 700, fontFamily: 'var(--mono)' }}>
                      {plannerResult.suggestedBonusRange ? `${fmtPct(plannerResult.suggestedBonusRange.min)} – ${fmtPct(plannerResult.suggestedBonusRange.max)}` : <NotSet />}
                    </div>
                  </div>
                </div>
                {plannerResult.suggestedDiscountRange && (
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, fontSize: 12.5, color: 'var(--ink-soft)' }}>
                    At the midpoint of the suggested discount ({fmtPct((plannerResult.suggestedDiscountRange.min + plannerResult.suggestedDiscountRange.max) / 2)}), the effective monthly cost would be{' '}
                    <strong>{fmtLKR(plannerBudget * (1 - (plannerResult.suggestedDiscountRange.min + plannerResult.suggestedDiscountRange.max) / 200))}</strong>
                    {plannerResult.suggestedBonusRange && (
                      <>, plus an estimated <strong>{fmtLKR(plannerBudget * ((plannerResult.suggestedBonusRange.min + plannerResult.suggestedBonusRange.max) / 200))}</strong> in bonus/added-value airtime per month.</>
                    )}
                  </div>
                )}
              </div>

              {plannerResult.agencyDealReference && (
                <div className="card" style={{ padding: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, marginBottom: 6, color: 'var(--ink)' }}>
                    <Icon name="building" size={15} style={{ color: 'var(--blue-700)' }} /> Agency Deal Reference ({plannerResult.agencyDealReference.year})
                  </div>
                  <div style={{ fontSize: 13, fontFamily: 'var(--mono)' }}>Discount {fmtPct(plannerResult.agencyDealReference.discountPct)} &middot; Bonus {fmtPct(plannerResult.agencyDealReference.bonusPct)}</div>
                  {plannerResult.agencyDealReference.notes && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{plannerResult.agencyDealReference.notes}</div>}
                </div>
              )}

              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, marginBottom: 8, color: 'var(--ink)' }}>
                  <Icon name="users" size={15} style={{ color: 'var(--green-600)' }} /> Comparable Clients ({plannerResult.comparableClients.length})
                </div>
                {plannerResult.comparableClients.length === 0 ? (
                  <p style={{ fontSize: 13, color: 'var(--muted)' }}>No comparable clients on this channel yet.</p>
                ) : (
                  <div className="tbl-wrap" style={{ boxShadow: 'none', border: '1px solid var(--border)' }}>
                    <table className="tbl">
                      <thead><tr><th>Client</th><th className="num">Avg Yearly Spend</th><th className="num">Avg Discount</th><th className="num">Avg Bonus</th><th className="num">Years</th></tr></thead>
                      <tbody>
                        {plannerResult.comparableClients.map((c) => (
                          <tr key={c.clientId}>
                            <td>{c.clientName}</td>
                            <td className="num">{fmtLKR(c.avgYearlySpend)}</td>
                            <td className="num">{fmtPct(c.avgDiscountPct)}</td>
                            <td className="num">{fmtPct(c.avgBonusPct)}</td>
                            <td className="num">{c.yearsOfData}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {!plannerLoading && !plannerResult && plannerBudget && (
            <p style={{ marginTop: 16, fontSize: 13, color: 'var(--muted)' }}>No data available for this channel.</p>
          )}
        </div>
      </div>
    </div>
  );
}
