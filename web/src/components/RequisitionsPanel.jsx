import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Icon from './Icon';
import OrbitLoader from './OrbitLoader';
import MoneyInput from './MoneyInput';
import api from '../lib/api';
import { exportRequisitionPdf } from '../lib/requisitionPdf';

const fmtLKR = (v) => (v == null || v === '' ? '' : 'LKR ' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }));
const budgetLabel = (r) => [r.budgetPct ? `${r.budgetPct}%` : '', fmtLKR(r.budgetAmount)].filter(Boolean).join(' - ');

const MEDIUMS = ['TV', 'RADIO', 'PRINT', 'DIGITAL', 'CINEMA', 'OOH'];
const DEADLINES = [
  { key: 'annual', label: 'Annual buy', lead: 'Buying unit needs ~two weeks' },
  { key: 'campaign-special', label: 'Campaign special buy', lead: 'Buying unit needs ~one week' },
  { key: 'new-client', label: 'New client', lead: 'Buying unit needs ~one to two weeks' },
];
const STATION_HINT = { TV: 'e.g., Hiru, Sirasa TV', RADIO: 'e.g., FM Derana', PRINT: 'e.g., Daily Lankadeepa', DIGITAL: 'e.g., YouTube, Meta', CINEMA: 'e.g., Scope Cinemas', OOH: 'e.g., Digital billboards - Colombo' };
const DELIV_HINT = {
  TV: 'e.g., discounts % Target: CPRP and buying basket / Spot durations: 30s & 15s',
  RADIO: 'e.g., Durations / 30s', PRINT: 'e.g., Size, Publication wise',
  DIGITAL: 'e.g., Impressions / CPM / formats', CINEMA: 'e.g., Screens / spot length', OOH: 'e.g., Sites / sizes / duration',
};
const DAYPART_HINT = {
  TV: 'e.g., 60% Prime Time, 40% Off-Prime', RADIO: 'e.g., Peak Drive times only (6am-10am / 3pm-7pm)',
  PRINT: '', DIGITAL: '', CINEMA: '', OOH: '',
};
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-');

const EMPTY = {
  clientId: '', brandCampaign: '', targetGroup: '', campaignStart: '', campaignEnd: '',
  budgetPct: '', budgetAmount: '', mediums: [], stations: {}, buyingProperty: '', deliverables: {}, daypartMandates: {},
  otherNotes: '', discussionPoints: '', deadlineType: '',
};

function Label({ children, req }) {
  return <label className="field-label" style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#3B4A63', marginBottom: 5 }}>{children}{req && <span style={{ color: '#C5391F' }}> *</span>}</label>;
}

export default function RequisitionsPanel({ mode = 'mine' }) {
  const { user } = useAuth();
  const canCreate = ['PLANNER', 'GROUP_HEAD', 'SUPER_ADMIN'].includes(user?.role);
  const [tab, setTab] = useState(mode === 'all' ? 'list' : 'new');
  const [clients, setClients] = useState([]);
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [exportingId, setExportingId] = useState(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/requisitions').then((r) => setList(r.data.requisitions || [])).catch(() => setList([])),
      mode !== 'all' ? api.get('/requisitions/clients').then((r) => setClients(r.data.clients || [])).catch(() => setClients([])) : Promise.resolve(),
    ]).finally(() => setLoading(false));
  };
  useEffect(load, [mode]);

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const setMap = (mapKey, m, v) => setForm((p) => ({ ...p, [mapKey]: { ...p[mapKey], [m]: v } }));
  const toggleMedium = (m) => setForm((p) => ({ ...p, mediums: p.mediums.includes(m) ? p.mediums.filter((x) => x !== m) : [...p.mediums, m] }));

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setOkMsg('');
    if (!form.clientId) { setError('Please select a client.'); return; }
    if (!form.brandCampaign.trim()) { setError('Please enter the Brand / Campaign.'); return; }
    setSubmitting(true);
    try {
      await api.post('/requisitions', {
        ...form,
        budgetPct: form.budgetPct ? Number(form.budgetPct) : null,
      });
      setOkMsg('Requisition submitted - the buying unit has been emailed and notified.');
      setForm(EMPTY);
      load();
      setTab('list');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to submit the requisition.');
    } finally {
      setSubmitting(false);
    }
  };

  const doExport = async (r) => {
    setExportingId(r.id);
    try { await exportRequisitionPdf(r); } catch { /* ignore */ } finally { setExportingId(null); }
  };

  const isAdmin = user?.role === 'SUPER_ADMIN';
  const [deletingId, setDeletingId] = useState(null);
  const del = async (r) => {
    if (!window.confirm(`Delete this requisition for ${r.clientName} (${r.brandCampaign})? This cannot be undone.`)) return;
    setDeletingId(r.id);
    try {
      await api.delete(`/requisitions/${r.id}`);
      setList((prev) => prev.filter((x) => x.id !== r.id));
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete requisition.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      {/* sub-tabs */}
      <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 18 }}>
        {(canCreate && mode !== 'all' ? [['new', 'New Requisition'], ['list', `Submitted${list.length ? ` (${list.length})` : ''}`]] : [['list', mode === 'all' ? `All Requisitions${list.length ? ` (${list.length})` : ''}` : 'My Requisitions']]).map(([k, lbl]) => (
          <button key={k} onClick={() => setTab(k)} style={{ border: 'none', padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', background: tab === k ? '#0A1729' : '#fff', color: tab === k ? '#fff' : 'var(--ink-soft)' }}>{lbl}</button>
        ))}
      </div>

      {tab === 'new' && canCreate && mode !== 'all' && (
        <form onSubmit={submit} className="card" style={{ padding: 22, maxWidth: 900 }}>
          <div style={{ fontSize: 16, fontWeight: 720, color: 'var(--ink)', marginBottom: 4 }}>Media Buying Requisition (MBR)</div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 18 }}>Date: {fmtDate(new Date())} · request a media plan from the buying unit.</div>

          {error && <div style={{ marginBottom: 14, padding: '10px 13px', borderRadius: 9, background: 'var(--red-100)', color: 'var(--red-600)', fontSize: 13, fontWeight: 600 }}>{error}</div>}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <div><Label req>Client</Label>
              <select className="select" value={form.clientId} onChange={(e) => set('clientId', e.target.value)} style={{ width: '100%' }}>
                <option value="">Select your client…</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.agencyName ? ` · ${c.agencyName}` : ''}</option>)}
              </select>
            </div>
            <div><Label req>Brand / Campaign</Label>
              <input className="input" value={form.brandCampaign} onChange={(e) => set('brandCampaign', e.target.value)} placeholder="Brand and/or campaign name" style={{ width: '100%' }} />
            </div>
            <div><Label>Target Group (TG)</Label>
              <input className="input" value={form.targetGroup} onChange={(e) => set('targetGroup', e.target.value)} placeholder="e.g., Adults 18-45, SEC A/B" style={{ width: '100%' }} />
            </div>
            <div><Label>Budget</Label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', flexWrap: 'wrap' }}>
                <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 9, overflow: 'hidden', flexShrink: 0 }}>
                  {['100', '85'].map((p) => (
                    <button type="button" key={p} onClick={() => set('budgetPct', form.budgetPct === p ? '' : p)} style={{ border: 'none', padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', background: form.budgetPct === p ? 'var(--coral-600)' : '#fff', color: form.budgetPct === p ? '#fff' : 'var(--ink-soft)' }}>{p}%</button>
                  ))}
                </div>
                <MoneyInput value={form.budgetAmount} onValueChange={(v) => set('budgetAmount', v)} placeholder="Budget amount, e.g. 1,000,000" style={{ flex: 1, minWidth: 160 }} />
              </div>
            </div>
            <div><Label>Campaign Period - start</Label>
              <input className="input" type="date" value={form.campaignStart} onChange={(e) => set('campaignStart', e.target.value)} style={{ width: '100%' }} />
            </div>
            <div><Label>Campaign Period - end</Label>
              <input className="input" type="date" value={form.campaignEnd} onChange={(e) => set('campaignEnd', e.target.value)} style={{ width: '100%' }} />
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <Label>Medium (select all that apply)</Label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {MEDIUMS.map((m) => (
                <button type="button" key={m} className={'chip' + (form.mediums.includes(m) ? ' active' : '')} onClick={() => toggleMedium(m)}>
                  {m}{form.mediums.includes(m) ? <Icon name="check" size={12} /> : <Icon name="plus" size={12} />}
                </button>
              ))}
            </div>
          </div>

          {/* Per-medium detail - stations, deliverables, dayparts */}
          {form.mediums.map((m) => (
            <div key={m} style={{ border: '1px solid var(--border)', borderRadius: 11, padding: 14, marginBottom: 12, background: 'var(--bg-sunken)' }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)', marginBottom: 10 }}>{m}</div>
              <div style={{ marginBottom: 10 }}><Label>Channel / Stations / Publications</Label>
                <input className="input" value={form.stations[m] || ''} onChange={(e) => setMap('stations', m, e.target.value)} placeholder={STATION_HINT[m]} style={{ width: '100%' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: DAYPART_HINT[m] ? '1fr 1fr' : '1fr', gap: 12 }}>
                <div><Label>Deliverables &amp; Specifications</Label>
                  <textarea className="input" rows={2} value={form.deliverables[m] || ''} onChange={(e) => setMap('deliverables', m, e.target.value)} placeholder={DELIV_HINT[m]} style={{ width: '100%', resize: 'vertical' }} />
                </div>
                {DAYPART_HINT[m] && (
                  <div><Label>Daypart Mandates</Label>
                    <textarea className="input" rows={2} value={form.daypartMandates[m] || ''} onChange={(e) => setMap('daypartMandates', m, e.target.value)} placeholder={DAYPART_HINT[m]} style={{ width: '100%', resize: 'vertical' }} />
                  </div>
                )}
              </div>
            </div>
          ))}

          <div style={{ marginBottom: 14 }}>
            <Label>Buying Property - Sponsorships / Key Integrations Required</Label>
            <textarea className="input" rows={3} value={form.buyingProperty} onChange={(e) => set('buyingProperty', e.target.value)}
              placeholder={'List all requirements, e.g.:\n• Morning Show weather segment sponsorship\n• Specific Prime Time drama program\n• Right-hand page facing editorial in Print'} style={{ width: '100%', resize: 'vertical' }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <div><Label>Other</Label>
              <textarea className="input" rows={2} value={form.otherNotes} onChange={(e) => set('otherNotes', e.target.value)} placeholder="Any other buying requirement" style={{ width: '100%', resize: 'vertical' }} />
            </div>
            <div><Label>Discussion Points &amp; Special Instructions</Label>
              <textarea className="input" rows={2} value={form.discussionPoints} onChange={(e) => set('discussionPoints', e.target.value)} placeholder="Notes for the buying unit" style={{ width: '100%', resize: 'vertical' }} />
            </div>
          </div>

          <div style={{ marginBottom: 18 }}>
            <Label>Deadline</Label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {DEADLINES.map((d) => {
                const on = form.deadlineType === d.key;
                return (
                  <button type="button" key={d.key} onClick={() => set('deadlineType', on ? '' : d.key)}
                    style={{ textAlign: 'left', border: `1px solid ${on ? 'var(--coral-600)' : 'var(--border-strong)'}`, background: on ? 'var(--coral-50)' : '#fff', borderRadius: 10, padding: '10px 14px', cursor: 'pointer', minWidth: 190 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: on ? 'var(--coral-700)' : 'var(--ink)' }}>{d.label}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>{d.lead}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <button type="submit" className="btn btn-primary" disabled={submitting}><Icon name="check" size={16} /> {submitting ? 'Submitting…' : 'Submit requisition'}</button>
        </form>
      )}

      {tab === 'list' && (
        <>
          {okMsg && <div style={{ marginBottom: 14, padding: '10px 13px', borderRadius: 9, background: 'var(--green-100)', color: 'var(--green-600)', fontSize: 13, fontWeight: 600 }}>{okMsg}</div>}
          {loading ? <OrbitLoader label="Loading requisitions…" /> : list.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--muted)' }}>
              <Icon name="file" size={30} style={{ opacity: 0.35, marginBottom: 8 }} />
              <p style={{ margin: 0 }}>No requisitions {mode === 'all' ? 'have been raised yet.' : 'yet - raise one from the New Requisition tab.'}</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {list.map((r) => (
                <div key={r.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', cursor: 'pointer' }} onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                    <Icon name={expanded === r.id ? 'chevD' : 'chevR'} size={15} style={{ color: 'var(--muted)' }} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{r.clientName} <span style={{ color: 'var(--muted)', fontWeight: 500 }}>· {r.brandCampaign}</span></div>
                      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
                        MBR #{r.id} · {fmtDate(r.createdAt)} · {(r.mediums || []).join(', ') || 'no medium'}{mode === 'all' ? ` · by ${r.requesterName}` : ''}
                      </div>
                    </div>
                    {r.deadlineLabel && <span className="badge" style={{ background: 'var(--amber-50)', color: 'var(--amber-700)', flexShrink: 0 }}>{r.deadlineLabel}</span>}
                    <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); doExport(r); }} disabled={exportingId === r.id} style={{ flexShrink: 0, gap: 5 }}>
                      <Icon name={exportingId === r.id ? 'history' : 'download'} size={13} /> PDF
                    </button>
                    {isAdmin && (
                      <button className="act-btn" title="Delete requisition" onClick={(e) => { e.stopPropagation(); del(r); }} disabled={deletingId === r.id} style={{ flexShrink: 0, color: 'var(--red-600,#dc2626)' }}>
                        <Icon name="trash" size={15} />
                      </button>
                    )}
                  </div>
                  {expanded === r.id && (
                    <div style={{ borderTop: '1px solid var(--border)', padding: '14px 16px', background: 'var(--bg-sunken)' }}>
                      <Detail r={r} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Row({ label, value }) {
  if (!value) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '190px 1fr', gap: 12, padding: '5px 0', borderBottom: '1px solid #EBEEF2', alignItems: 'start' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#6B7790' }}>{label}</div>
      <div style={{ fontSize: 13, color: '#16243C', whiteSpace: 'pre-wrap' }}>{value}</div>
    </div>
  );
}

function Detail({ r }) {
  const period = (r.campaignStart || r.campaignEnd) ? `${fmtDate(r.campaignStart)} to ${fmtDate(r.campaignEnd)}` : '';
  return (
    <div>
      <Row label="Target Group (TG)" value={r.targetGroup} />
      <Row label="Campaign Period" value={period} />
      <Row label="Budget" value={budgetLabel(r)} />
      <Row label="Medium" value={(r.mediums || []).join(', ')} />
      {(r.mediums || []).map((m) => (r.stations || {})[m] && <Row key={'s' + m} label={`${m} - Stations`} value={r.stations[m]} />)}
      <Row label="Buying Property / Sponsorships" value={r.buyingProperty} />
      {(r.mediums || []).map((m) => (r.deliverables || {})[m] && <Row key={'d' + m} label={`${m} - Deliverables`} value={r.deliverables[m]} />)}
      {(r.mediums || []).map((m) => (r.daypartMandates || {})[m] && <Row key={'p' + m} label={`${m} - Daypart Mandates`} value={r.daypartMandates[m]} />)}
      <Row label="Other" value={r.otherNotes} />
      <Row label="Discussion Points" value={r.discussionPoints} />
      <Row label="Deadline" value={r.deadlineLabel ? `${r.deadlineLabel} - buying unit needs ${r.deadlineLead}` : ''} />
      <Row label="Requested by" value={`${r.requesterName}${r.requesterRole ? ` (${r.requesterRole})` : ''}`} />
    </div>
  );
}
