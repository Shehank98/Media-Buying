import { useState, useEffect, useCallback, useMemo } from 'react';
import * as XLSX from 'xlsx';
import api from '../lib/api';
import Icon, { fmtLKR } from '../components/Icon';
import OrbitLoader from '../components/OrbitLoader';

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = [CURRENT_YEAR + 1, CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2, CURRENT_YEAR - 3];

function fmtPct(v) {
  if (v == null) return '-';
  return `${Number(v).toFixed(1)}%`;
}

function fmtMonthLabel(ym) {
  if (!ym) return '-';
  const [y, m] = ym.split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[parseInt(m) - 1]} ${y}`;
}

function TrendArrow({ trend }) {
  if (trend === 'up') return <span style={{ color: 'var(--green-600,#16a34a)', fontWeight: 700 }}>▲</span>;
  if (trend === 'down') return <span style={{ color: 'var(--red-600,#dc2626)', fontWeight: 700 }}>▼</span>;
  return <span style={{ color: 'var(--muted)', fontWeight: 700 }}>→</span>;
}

function DealModal({ title, channelName, clientName, year, setYear, discountPct, setDiscountPct, bonusPct, setBonusPct, notes, setNotes, yearLocked, onSubmit, onClose, submitting, error, channelSelect, clientSelect }) {
  return (
    <div className="modal-scrim show" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="act-btn" onClick={onClose}><Icon name="x" size={18} /></button>
        </div>
        <form onSubmit={onSubmit}>
          <div className="modal-body">
            {error && (
              <div style={{ background: 'var(--red-50,#fef2f2)', border: '1px solid var(--red-200,#fecaca)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--red-700,#b91c1c)', marginBottom: 16 }}>{error}</div>
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
            <div className="field-grid2">
              <div className="field">
                <label className="field-label">Year <span className="req">*</span></label>
                <input className="input" type="number" value={year} disabled={yearLocked} onChange={(e) => setYear(e.target.value)} placeholder={String(CURRENT_YEAR)} />
              </div>
              <div className="field" />
            </div>
            <div className="field-grid2">
              <div className="field">
                <label className="field-label">Discount % <span className="req">*</span></label>
                <input className="input" type="number" step="0.1" value={discountPct} onChange={(e) => setDiscountPct(e.target.value)} placeholder="40" />
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
            <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Saving…' : 'Save Deal'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function MediaBuyingPage() {
  const [channels, setChannels] = useState([]);
  const [channelMasterId, setChannelMasterId] = useState('');
  const [year, setYear] = useState(CURRENT_YEAR);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [sortKey, setSortKey] = useState('yearlySpend');
  const [sortDir, setSortDir] = useState('desc');
  const [expandedClientId, setExpandedClientId] = useState(null);
  const [monthlyByClient, setMonthlyByClient] = useState({});
  const [monthlyLoading, setMonthlyLoading] = useState(false);

  // Agency deal modal
  const [showAgencyModal, setShowAgencyModal] = useState(false);
  const [agencyYear, setAgencyYear] = useState(String(CURRENT_YEAR));
  const [agencyYearLocked, setAgencyYearLocked] = useState(false);
  const [agencyDiscount, setAgencyDiscount] = useState('');
  const [agencyBonus, setAgencyBonus] = useState('');
  const [agencyNotes, setAgencyNotes] = useState('');
  const [agencySubmitting, setAgencySubmitting] = useState(false);
  const [agencyError, setAgencyError] = useState('');

  // Client deal modal
  const [showClientModal, setShowClientModal] = useState(false);
  const [clientModalClientId, setClientModalClientId] = useState('');
  const [clientModalClientName, setClientModalClientName] = useState('');
  const [clientYear, setClientYear] = useState(String(CURRENT_YEAR));
  const [clientYearLocked, setClientYearLocked] = useState(false);
  const [clientDiscount, setClientDiscount] = useState('');
  const [clientBonus, setClientBonus] = useState('');
  const [clientNotes, setClientNotes] = useState('');
  const [clientSubmitting, setClientSubmitting] = useState(false);
  const [clientError, setClientError] = useState('');

  // Standalone "+Add Deal" entry point (channel + client both selectable)
  const [showQuickAddModal, setShowQuickAddModal] = useState(false);
  const [quickAddChannelId, setQuickAddChannelId] = useState('');
  const [quickAddClientId, setQuickAddClientId] = useState('');
  const [quickAddYear, setQuickAddYear] = useState(String(CURRENT_YEAR));
  const [quickAddDiscount, setQuickAddDiscount] = useState('');
  const [quickAddBonus, setQuickAddBonus] = useState('');
  const [quickAddNotes, setQuickAddNotes] = useState('');
  const [quickAddSubmitting, setQuickAddSubmitting] = useState(false);
  const [quickAddError, setQuickAddError] = useState('');
  const [allClients, setAllClients] = useState([]);

  // Negotiation planner panel
  const [showPlanner, setShowPlanner] = useState(false);
  const [plannerBudget, setPlannerBudget] = useState('');
  const [plannerYear, setPlannerYear] = useState(String(CURRENT_YEAR));
  const [plannerResult, setPlannerResult] = useState(null);
  const [plannerLoading, setPlannerLoading] = useState(false);

  useEffect(() => {
    api.get('/masterdata/channel-masters').then((res) => {
      setChannels(res.data.channelMasters || []);
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
    api.get(`/media-buying/channels/${channelMasterId}`, { params: { year } })
      .then((res) => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [channelMasterId, year]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => { setExpandedClientId(null); setMonthlyByClient({}); }, [channelMasterId, year]);

  const channelsByMedium = useMemo(() => {
    const groups = {};
    channels.forEach((c) => {
      if (!groups[c.medium]) groups[c.medium] = [];
      groups[c.medium].push(c);
    });
    return groups;
  }, [channels]);

  const sortedClients = useMemo(() => {
    if (!data?.clients) return [];
    const arr = [...data.clients];
    arr.sort((a, b) => {
      const av = a[sortKey] ?? -Infinity;
      const bv = b[sortKey] ?? -Infinity;
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return arr;
  }, [data, sortKey, sortDir]);

  function toggleSort(key) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
  }

  function toggleExpand(client) {
    if (expandedClientId === client.clientId) { setExpandedClientId(null); return; }
    setExpandedClientId(client.clientId);
    if (!monthlyByClient[client.clientId]) {
      setMonthlyLoading(true);
      api.get(`/media-buying/channels/${channelMasterId}/clients/${client.clientId}/monthly`, { params: { year } })
        .then((res) => setMonthlyByClient((p) => ({ ...p, [client.clientId]: res.data })))
        .finally(() => setMonthlyLoading(false));
    }
  }

  function openAgencyModal() {
    setAgencyYear(String(year));
    setAgencyYearLocked(false);
    const existing = data?.agencyDeals?.find((d) => d.year === year);
    setAgencyDiscount(existing ? String(existing.discountPct) : '');
    setAgencyBonus(existing ? String(existing.bonusPct) : '');
    setAgencyNotes(existing ? existing.notes : '');
    setAgencyError('');
    setShowAgencyModal(true);
  }

  async function handleAgencySubmit(e) {
    e.preventDefault();
    if (!agencyYear || agencyDiscount === '' || agencyBonus === '') { setAgencyError('Year, discount %, and bonus % are required.'); return; }
    setAgencySubmitting(true);
    setAgencyError('');
    try {
      await api.post('/media-buying/agency-deals', {
        channelMasterId: parseInt(channelMasterId),
        year: parseInt(agencyYear),
        discountPct: parseFloat(agencyDiscount),
        bonusPct: parseFloat(agencyBonus),
        notes: agencyNotes,
      });
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
    setClientYear(String(year));
    setClientYearLocked(false);
    setClientDiscount(client.discountPct != null ? String(client.discountPct) : '');
    setClientBonus(client.bonusPct != null ? String(client.bonusPct) : '');
    setClientNotes(client.notes || '');
    setClientError('');
    setShowClientModal(true);
  }

  async function handleClientSubmit(e) {
    e.preventDefault();
    if (!clientYear || clientDiscount === '' || clientBonus === '') { setClientError('Year, discount %, and bonus % are required.'); return; }
    setClientSubmitting(true);
    setClientError('');
    try {
      await api.post('/media-buying/client-deals', {
        channelMasterId: parseInt(channelMasterId),
        clientId: parseInt(clientModalClientId),
        year: parseInt(clientYear),
        discountPct: parseFloat(clientDiscount),
        bonusPct: parseFloat(clientBonus),
        notes: clientNotes,
      });
      setShowClientModal(false);
      fetchData();
    } catch (err) {
      setClientError(err.response?.data?.error || 'Failed to save client deal.');
    } finally {
      setClientSubmitting(false);
    }
  }

  function openQuickAddModal() {
    setQuickAddChannelId(channelMasterId || '');
    setQuickAddClientId('');
    setQuickAddYear(String(year));
    setQuickAddDiscount('');
    setQuickAddBonus('');
    setQuickAddNotes('');
    setQuickAddError('');
    setShowQuickAddModal(true);
  }

  async function handleQuickAddSubmit(e) {
    e.preventDefault();
    if (!quickAddChannelId || !quickAddClientId || !quickAddYear || quickAddDiscount === '' || quickAddBonus === '') {
      setQuickAddError('Channel, client, year, discount %, and bonus % are required.');
      return;
    }
    setQuickAddSubmitting(true);
    setQuickAddError('');
    try {
      await api.post('/media-buying/client-deals', {
        channelMasterId: parseInt(quickAddChannelId),
        clientId: parseInt(quickAddClientId),
        year: parseInt(quickAddYear),
        discountPct: parseFloat(quickAddDiscount),
        bonusPct: parseFloat(quickAddBonus),
        notes: quickAddNotes,
      });
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
    setPlannerYear(String(year));
    setPlannerResult(null);
    setShowPlanner(true);
  }

  useEffect(() => {
    if (!showPlanner || !channelMasterId || !plannerBudget) { setPlannerResult(null); return; }
    const t = setTimeout(() => {
      setPlannerLoading(true);
      api.get(`/media-buying/channels/${channelMasterId}/planner`, { params: { year: plannerYear, monthlyBudget: plannerBudget } })
        .then((res) => setPlannerResult(res.data))
        .catch(() => setPlannerResult(null))
        .finally(() => setPlannerLoading(false));
    }, 400);
    return () => clearTimeout(t);
  }, [showPlanner, channelMasterId, plannerBudget, plannerYear]);

  function handleExport() {
    if (!data) return;
    const wb = XLSX.utils.book_new();
    const dealHeaders = ['Year', 'Agency Discount %', 'Agency Bonus %', 'Notes', 'Created By'];
    const dealRows = (data.agencyDeals || []).map((d) => [d.year, d.discountPct, d.bonusPct, d.notes, d.createdBy]);
    const dealWs = XLSX.utils.aoa_to_sheet([dealHeaders, ...dealRows]);
    XLSX.utils.book_append_sheet(wb, dealWs, 'Agency Deal History');

    const clientHeaders = ['Client', 'Agency', 'Year', 'Yearly Spend (LKR)', 'Monthly Avg (LKR)', 'Discount %', 'Bonus %', 'Notes'];
    const clientRows = sortedClients.map((c) => [c.clientName, c.agencyName, c.year, c.yearlySpend, c.monthlyAvg, c.discountPct, c.bonusPct, c.notes]);
    const clientWs = XLSX.utils.aoa_to_sheet([clientHeaders, ...clientRows]);
    XLSX.utils.book_append_sheet(wb, clientWs, 'Client Breakdown');

    XLSX.writeFile(wb, `media-buying-${data.channel.name.replace(/\W+/g, '_')}-${year}.xlsx`);
  }

  const selectedChannel = channels.find((c) => String(c.id) === String(channelMasterId));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Media Buying</h1>
          <p className="page-sub">Channel negotiation intelligence — discount &amp; bonus deal history, planning.</p>
        </div>
        <button className="btn btn-ghost" onClick={openQuickAddModal}>
          <Icon name="plus" size={16} /> Add Deal
        </button>
      </div>

      <div className="card" style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 20 }}>
        <div className="field" style={{ minWidth: 280, marginBottom: 0 }}>
          <label className="field-label">Channel</label>
          <select className="select" value={channelMasterId} onChange={(e) => setChannelMasterId(e.target.value)}>
            <option value="">Select a channel…</option>
            {Object.entries(channelsByMedium).map(([medium, list]) => (
              <optgroup key={medium} label={medium}>
                {list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="field" style={{ minWidth: 140, marginBottom: 0 }}>
          <label className="field-label">Year</label>
          <select className="select" value={year} onChange={(e) => setYear(parseInt(e.target.value))}>
            {YEAR_OPTIONS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        {channelMasterId && (
          <div style={{ display: 'flex', gap: 10, marginLeft: 'auto' }}>
            <button className="btn btn-ghost" onClick={openPlanner}><Icon name="sparkle" size={16} /> Plan New Client</button>
            <button className="btn btn-subtle" onClick={handleExport} disabled={!data}><Icon name="download" size={16} /> Export to Excel</button>
          </div>
        )}
      </div>

      {!channelMasterId && (
        <div className="card" style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)' }}>
          <Icon name="sparkle" size={32} />
          <p style={{ marginTop: 12 }}>Select a channel above to view its negotiation history.</p>
        </div>
      )}

      {channelMasterId && loading && <OrbitLoader label="Loading channel intelligence…" />}

      {channelMasterId && !loading && data && (
        <>
          {/* Agency-Level Deal Block */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0 }}>Agency-Level Deal — {data.channel.name}</h3>
              <button className="btn btn-primary btn-sm" onClick={openAgencyModal}>Add / Edit Deal</button>
            </div>
            {data.agencyDeals.length === 0 ? (
              <p style={{ color: 'var(--muted)', fontSize: 13 }}>No agency-level deal recorded yet for this channel.</p>
            ) : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr><th>Year</th><th>Discount %</th><th>Bonus %</th><th>Trend</th><th>Notes</th></tr>
                  </thead>
                  <tbody>
                    {data.agencyDeals.map((d) => (
                      <tr key={d.id}>
                        <td>{d.year}</td>
                        <td>{fmtPct(d.discountPct)}</td>
                        <td>{fmtPct(d.bonusPct)}</td>
                        <td><TrendArrow trend={d.trend} /></td>
                        <td>{d.notes || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Client Breakdown Table */}
          <div className="card">
            <h3 style={{ marginTop: 0, marginBottom: 14 }}>Client Breakdown — {year}</h3>
            {sortedClients.length === 0 ? (
              <p style={{ color: 'var(--muted)', fontSize: 13 }}>No clients bought on this channel in {year}.</p>
            ) : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th></th>
                      <th onClick={() => toggleSort('clientName')} style={{ cursor: 'pointer' }}>Client</th>
                      <th onClick={() => toggleSort('yearlySpend')} style={{ cursor: 'pointer' }}>Yearly Spend</th>
                      <th onClick={() => toggleSort('monthlyAvg')} style={{ cursor: 'pointer' }}>Monthly Avg</th>
                      <th onClick={() => toggleSort('discountPct')} style={{ cursor: 'pointer' }}>Discount %</th>
                      <th onClick={() => toggleSort('bonusPct')} style={{ cursor: 'pointer' }}>Bonus %</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedClients.map((c) => (
                      <>
                        <tr key={c.clientId}>
                          <td>
                            <button className="act-btn" onClick={() => toggleExpand(c)}>
                              <Icon name={expandedClientId === c.clientId ? 'trending-down' : 'trending-up'} size={14} />
                            </button>
                          </td>
                          <td>{c.clientName}<div style={{ fontSize: 11, color: 'var(--muted)' }}>{c.agencyName}</div></td>
                          <td>{fmtLKR(c.yearlySpend)}</td>
                          <td>{fmtLKR(c.monthlyAvg)}</td>
                          <td>{fmtPct(c.discountPct)}</td>
                          <td>{fmtPct(c.bonusPct)}</td>
                          <td><button className="btn btn-ghost btn-sm" onClick={() => openClientModal(c)}>Edit</button></td>
                        </tr>
                        {expandedClientId === c.clientId && (
                          <tr key={`${c.clientId}-expanded`}>
                            <td colSpan={7} style={{ background: 'var(--bg)', padding: 14 }}>
                              {monthlyLoading && !monthlyByClient[c.clientId] ? (
                                <OrbitLoader size={24} label="Loading monthly breakdown…" />
                              ) : (
                                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                                  {(monthlyByClient[c.clientId] || []).map((m) => (
                                    <div key={m.month} style={{ minWidth: 110 }}>
                                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtMonthLabel(m.month)}</div>
                                      <div style={{ fontWeight: 700 }}>{fmtLKR(m.scheduleValue)}</div>
                                    </div>
                                  ))}
                                  {(monthlyByClient[c.clientId] || []).length === 0 && (
                                    <span style={{ fontSize: 13, color: 'var(--muted)' }}>No monthly data.</span>
                                  )}
                                </div>
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
          title={data?.agencyDeals?.some((d) => d.year === parseInt(agencyYear)) ? `Edit ${agencyYear} Agency Deal` : 'Add Agency Deal'}
          channelName={selectedChannel?.name}
          year={agencyYear} setYear={setAgencyYear}
          discountPct={agencyDiscount} setDiscountPct={setAgencyDiscount}
          bonusPct={agencyBonus} setBonusPct={setAgencyBonus}
          notes={agencyNotes} setNotes={setAgencyNotes}
          yearLocked={false}
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
          year={clientYear} setYear={setClientYear}
          discountPct={clientDiscount} setDiscountPct={setClientDiscount}
          bonusPct={clientBonus} setBonusPct={setClientBonus}
          notes={clientNotes} setNotes={setClientNotes}
          yearLocked={false}
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
          year={quickAddYear} setYear={setQuickAddYear}
          discountPct={quickAddDiscount} setDiscountPct={setQuickAddDiscount}
          bonusPct={quickAddBonus} setBonusPct={setQuickAddBonus}
          notes={quickAddNotes} setNotes={setQuickAddNotes}
          yearLocked={false}
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
      <div className={`panel${showPlanner ? ' show' : ''}`}>
        <div className="panel-head">
          <div style={{ flex: 1 }}>
            <div className="panel-title">Negotiation Planner</div>
            <div className="panel-sub">{selectedChannel?.name}</div>
          </div>
          <button className="icon-btn" style={{ border: 'none', background: 'var(--bg-sunken)' }} onClick={() => setShowPlanner(false)}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="panel-body">
          <div className="field-grid2">
            <div className="field">
              <label className="field-label">Proposed Monthly Budget (LKR)</label>
              <input className="input" type="number" value={plannerBudget} onChange={(e) => setPlannerBudget(e.target.value)} placeholder="500000" />
            </div>
            <div className="field">
              <label className="field-label">Deal Year</label>
              <select className="select" value={plannerYear} onChange={(e) => setPlannerYear(e.target.value)}>
                {YEAR_OPTIONS.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>

          {plannerLoading && <OrbitLoader size={24} label="Calculating…" />}

          {!plannerLoading && plannerResult && (
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="card" style={{ background: 'var(--bg)', padding: 16 }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.4px' }}>Projected Yearly Spend</div>
                <div style={{ fontSize: 22, fontWeight: 750, fontFamily: "'Spline Sans Mono', monospace" }}>{fmtLKR(plannerResult.projectedYearlySpend)}</div>
                <span className="badge">{plannerResult.spendTier} tier</span>
              </div>

              <div className="card" style={{ padding: 16 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Suggested Terms</div>
                <div style={{ display: 'flex', gap: 24 }}>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>Discount %</div>
                    <div style={{ fontWeight: 700 }}>
                      {plannerResult.suggestedDiscountRange ? `${fmtPct(plannerResult.suggestedDiscountRange.min)} – ${fmtPct(plannerResult.suggestedDiscountRange.max)}` : 'No comparable data'}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>Bonus %</div>
                    <div style={{ fontWeight: 700 }}>
                      {plannerResult.suggestedBonusRange ? `${fmtPct(plannerResult.suggestedBonusRange.min)} – ${fmtPct(plannerResult.suggestedBonusRange.max)}` : 'No comparable data'}
                    </div>
                  </div>
                </div>
              </div>

              {plannerResult.agencyDealReference && (
                <div className="card" style={{ padding: 16 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>Agency Deal Reference ({plannerResult.agencyDealReference.year})</div>
                  <div style={{ fontSize: 13 }}>Discount {fmtPct(plannerResult.agencyDealReference.discountPct)} &middot; Bonus {fmtPct(plannerResult.agencyDealReference.bonusPct)}</div>
                  {plannerResult.agencyDealReference.notes && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{plannerResult.agencyDealReference.notes}</div>}
                </div>
              )}

              <div>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Comparable Clients ({plannerResult.comparableClients.length})</div>
                {plannerResult.comparableClients.length === 0 ? (
                  <p style={{ fontSize: 13, color: 'var(--muted)' }}>No comparable clients on this channel yet.</p>
                ) : (
                  <div className="tbl-wrap">
                    <table className="tbl">
                      <thead><tr><th>Client</th><th>Yearly Spend</th><th>Discount</th><th>Bonus</th></tr></thead>
                      <tbody>
                        {plannerResult.comparableClients.map((c) => (
                          <tr key={c.clientId}>
                            <td>{c.clientName}</td>
                            <td>{fmtLKR(c.yearlySpend)}</td>
                            <td>{fmtPct(c.discountPct)}</td>
                            <td>{fmtPct(c.bonusPct)}</td>
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
            <p style={{ marginTop: 16, fontSize: 13, color: 'var(--muted)' }}>No data available for this channel/year.</p>
          )}
        </div>
      </div>
    </div>
  );
}
