import { useState, useEffect } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  Cell, ReferenceLine,
} from 'recharts';
import Icon from '../components/Icon';
import OrbitLoader from '../components/OrbitLoader';
import api from '../lib/api';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const NA = 'N/A';
const fmtM = (v) => (v == null ? NA : 'LKR ' + (Number(v) / 1e6).toFixed(1) + 'M');
const fmtFull = (v) => (v == null ? NA : 'LKR ' + Math.round(Number(v)).toLocaleString('en-US'));
const C = { safe: '#15814B', mid: '#1F5BB5', stretch: '#9A5B00', band: '#F2A93B', actual: '#1F5BB5', warn: '#C5391F', grey: '#8A97AC' };

const VERDICT = {
  'very-likely': { label: 'Very likely to pass', color: '#15814B', bg: '#ECF8F1', icon: 'check' },
  'on-track': { label: 'On track', color: '#1F5BB5', bg: '#EAF0FA', icon: 'trending-up' },
  'at-risk': { label: 'At risk', color: '#9A5B00', bg: '#FDF3E7', icon: 'alert' },
  'unlikely': { label: 'Unlikely to pass', color: '#C5391F', bg: '#FBE0DA', icon: 'alert' },
  unknown: { label: 'Not enough data', color: '#6B7790', bg: '#F1F3F6', icon: 'alert' },
};

function How({ children }) {
  return (
    <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start', marginTop: 10, padding: '9px 12px', background: '#F5F8FC', border: '1px solid #E3EAF3', borderRadius: 9, fontSize: 11.8, color: '#3B4A63', lineHeight: 1.5 }}>
      <Icon name="activity" size={13} style={{ color: '#1F5BB5', flexShrink: 0, marginTop: 1 }} />
      <div><b style={{ color: '#16243C' }}>How this is worked out: </b>{children}</div>
    </div>
  );
}
function Card({ title, sub, children }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E5E8ED', borderRadius: 14, padding: 18, marginBottom: 16 }}>
      <div style={{ fontSize: 14.5, fontWeight: 720, color: '#16243C' }}>{title}</div>
      {sub && <div style={{ fontSize: 12, color: '#6B7790', marginTop: 2, marginBottom: 8 }}>{sub}</div>}
      {children}
    </div>
  );
}
function Row({ label, value, hint, strong, valueColor }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: '1px solid #F0F2F5' }}>
      <div><div style={{ fontSize: 13, color: '#3B4A63', fontWeight: strong ? 700 : 500 }}>{label}</div>{hint && <div style={{ fontSize: 11.5, color: '#93A0B5' }}>{hint}</div>}</div>
      <div className="mono" style={{ fontSize: strong ? 16 : 14, fontWeight: strong ? 750 : 600, color: valueColor || '#16243C', whiteSpace: 'nowrap' }}>{value}</div>
    </div>
  );
}

export default function CommitmentPlanner() {
  const [level, setLevel] = useState('overall');
  const [entity, setEntity] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [targetM, setTargetM] = useState('');   // user-typed target, in LKR millions ('' = evaluate the safe number)
  const [targetLkr, setTargetLkr] = useState(null);
  const [confidence, setConfidence] = useState(0.90);   // how safe: higher = lower, safer target
  const [mediaGroups, setMediaGroups] = useState([]);
  const [channels, setChannels] = useState([]);
  const [clients, setClients] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [showDetail, setShowDetail] = useState(false);

  useEffect(() => {
    api.get('/masterdata/media-groups').then((r) => setMediaGroups((r.data.mediaGroups || r.data || []).filter((g) => g.active !== false))).catch(() => {});
    api.get('/masterdata/channel-masters').then((r) => setChannels(r.data.channelMasters || r.data || [])).catch(() => {});
    api.get('/admin/clients').then((r) => setClients((r.data || []).sort((x, y) => (x.name || '').localeCompare(y.name || '')))).catch(() => {});
  }, []);

  useEffect(() => { const t = setTimeout(() => setTargetLkr(targetM === '' || isNaN(Number(targetM)) ? null : Number(targetM) * 1e6), 400); return () => clearTimeout(t); }, [targetM]);

  useEffect(() => {
    if (level !== 'overall' && !entity) { setData(null); return; }
    let cancelled = false;
    setLoading(true); setErr('');
    api.get('/analytics/commitment-planner', { params: { level, entity: level === 'overall' ? undefined : entity, year, target: targetLkr ?? undefined, confidence } })
      .then((r) => { if (!cancelled) setData(r.data); })
      .catch((e) => { if (!cancelled) { setErr(e.response?.data?.error || 'Failed to load'); setData(null); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [level, entity, year, targetLkr, confidence]);

  const changeLevel = (lv) => { setLevel(lv); setEntity(''); setTargetM(''); };

  const confPct = Math.round(confidence * 100);
  const a = data?.assessment;
  const v = VERDICT[a?.verdict || 'unknown'];
  const prob = a?.probability != null ? Math.round(a.probability * 100) : null;
  const bookedPct = a ? Math.min(100, a.pctBooked) : 0;
  const neededPct = a ? Math.min(100 - bookedPct, Math.max(0, (a.stillNeeded / (a.target || 1)) * 100)) : 0;
  const projPct = a && a.target ? Math.min(115, (a.projectedTotal / a.target) * 100) : 0;

  // ── detail-chart data ─────────────────────────────────────────────────────
  // 1. Yearly track record (annualized so a part-uploaded year isn't understated)
  const histRows = (data?.history || []).map((h) => ({ label: String(h.year) + (h.partial ? '*' : ''), value: h.annualized, raw: h.total, partial: h.partial, months: h.months }));
  // 2. Probability of clearing any candidate amount (x in LKR millions)
  const probRows = (data?.probCurve || []).map((p) => ({ m: +(p.amount / 1e6).toFixed(1), amount: p.amount, probability: p.probability }));
  // 3. Projected finish = booked + forecast remaining, vs target
  const projRows = data?.projection ? [{ label: String(data.scope.year), booked: data.projection.booked, remaining: data.projection.remaining }] : [];
  const backtestRows = (data?.backtest || []).map((b) => ({ label: String(b.year), commitment: b.commitment, actual: b.actual, cleared: b.cleared }));

  return (
    <div style={{ marginTop: 26 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 6 }}>
        <div style={{ width: 38, height: 38, borderRadius: 11, background: 'linear-gradient(135deg,#15814B,#0E6B3D)', color: '#fff', display: 'grid', placeItems: 'center' }}><Icon name="trending-up" size={19} /></div>
        <div>
          <h2 style={{ fontSize: 19, fontWeight: 760, color: '#16243C', margin: 0, letterSpacing: '-.4px' }}>Target Planner</h2>
          <div style={{ fontSize: 12.5, color: '#6B7790' }}>Plan a safe target for an agency, media group, channel or client: will we pass it, how likely, and how much do we still need?</div>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7790', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 5 }}>Level</div>
          <div style={{ display: 'inline-flex', border: '1px solid #E5E8ED', borderRadius: 9, overflow: 'hidden' }}>
            {[['overall', 'Overall'], ['media-group', 'Media Group'], ['channel', 'Channel'], ['client', 'Client']].map(([k, lbl]) => (
              <button key={k} onClick={() => changeLevel(k)} style={{ border: 'none', padding: '8px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', background: level === k ? '#0A1729' : '#fff', color: level === k ? '#fff' : '#3B4A63' }}>{lbl}</button>
            ))}
          </div>
        </div>
        {level === 'media-group' && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7790', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 5 }}>Media group</div>
            <select className="select" value={entity} onChange={(e) => setEntity(e.target.value)} style={{ minWidth: 210 }}>
              <option value="">Select a media group</option>
              {mediaGroups.map((g) => <option key={g.id || g.name} value={g.name}>{g.name}</option>)}
            </select>
          </div>
        )}
        {level === 'channel' && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7790', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 5 }}>Channel</div>
            <select className="select" value={entity} onChange={(e) => setEntity(e.target.value)} style={{ minWidth: 210 }}>
              <option value="">Select a channel</option>
              {channels.map((c) => <option key={c.id} value={c.id}>{c.name}{c.medium ? ` · ${c.medium}` : ''}</option>)}
            </select>
          </div>
        )}
        {level === 'client' && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7790', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 5 }}>Client</div>
            <select className="select" value={entity} onChange={(e) => setEntity(e.target.value)} style={{ minWidth: 230 }}>
              <option value="">Select a client</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.agencyName ? ` · ${c.agencyName}` : ''}</option>)}
            </select>
          </div>
        )}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7790', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 5 }}>Year</div>
          <select className="select" value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ minWidth: 100 }}>
            {(data?.availableYears || [year]).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7790', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 5 }}>Confidence <span style={{ textTransform: 'none', fontWeight: 500, color: '#93A0B5' }}>(higher = safer, lower target)</span></div>
          <div style={{ display: 'inline-flex', border: '1px solid #E5E8ED', borderRadius: 9, overflow: 'hidden' }}>
            {[0.75, 0.80, 0.85, 0.90, 0.95].map((c) => (
              <button key={c} onClick={() => setConfidence(c)} title={c < 0.9 ? 'Higher target, closer to what you usually achieve' : c > 0.9 ? 'Safer, lower target' : 'Balanced'}
                style={{ border: 'none', padding: '8px 11px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', background: confidence === c ? '#15814B' : '#fff', color: confidence === c ? '#fff' : '#3B4A63' }}>{Math.round(c * 100)}%</button>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7790', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 5 }}>Target the media group asks (LKR millions)</div>
          <input className="input" type="number" min="0" step="1" value={targetM} onChange={(e) => setTargetM(e.target.value)}
            placeholder={data?.hasData ? `${(data.commitment / 1e6).toFixed(0)} = the ${confPct}%-safe number` : 'e.g. 300'} style={{ minWidth: 230 }} />
        </div>
      </div>

      {level !== 'overall' && !entity ? (
        <div style={{ padding: '30px 20px', textAlign: 'center', color: '#6B7790', background: '#fff', border: '1px solid #E5E8ED', borderRadius: 14 }}>Pick a {level === 'media-group' ? 'media group' : level === 'client' ? 'client' : 'channel'} above.</div>
      ) : loading ? (
        <div style={{ padding: 30 }}><OrbitLoader label="Working it out" /></div>
      ) : err ? (
        <div style={{ padding: 20, color: C.warn, background: '#FBE0DA', borderRadius: 10 }}>{err}</div>
      ) : !data?.hasData || !a ? (
        <div style={{ padding: '30px 20px', textAlign: 'center', color: '#6B7790', background: '#fff', border: '1px solid #E5E8ED', borderRadius: 14 }}>Not enough history to answer this yet. Needs at least one completed year of schedule data.</div>
      ) : (
        <>
          {/* ── THE ANSWER ── */}
          <div style={{ background: '#fff', border: '1px solid #E5E8ED', borderRadius: 16, overflow: 'hidden', marginBottom: 16 }}>
            <div style={{ background: v.bg, padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 46, height: 46, borderRadius: 12, background: v.color, color: '#fff', display: 'grid', placeItems: 'center' }}><Icon name={v.icon} size={22} /></div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px', color: v.color }}>{v.label}</div>
                  <div style={{ fontSize: 13.5, color: '#3B4A63', marginTop: 2 }}>
                    {a.isCustom ? 'Your target' : `${confPct}%-safe commitment`}: <b style={{ color: '#16243C' }}>{fmtM(a.target)}</b> for {data.scope.entityName} · {data.scope.year}
                  </div>
                </div>
              </div>
              <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                <div className="mono" style={{ fontSize: 40, fontWeight: 800, color: v.color, lineHeight: 1 }}>{prob == null ? NA : `${prob}%`}</div>
                <div style={{ fontSize: 12, color: '#3B4A63', fontWeight: 600 }}>likely to pass</div>
              </div>
            </div>

            {/* progress bar: booked vs still-needed toward target */}
            <div style={{ padding: '16px 20px 6px' }}>
              <div style={{ position: 'relative', height: 26, borderRadius: 8, background: '#EEF0F3', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${bookedPct}%`, background: C.safe }} />
                <div style={{ position: 'absolute', left: `${bookedPct}%`, top: 0, bottom: 0, width: `${neededPct}%`, background: 'repeating-linear-gradient(45deg,#F2A93B,#F2A93B 6px,#f6bd5c 6px,#f6bd5c 12px)' }} />
                {projPct > 0 && projPct <= 115 && (
                  <div title="Projected finish" style={{ position: 'absolute', left: `min(100%, ${projPct}%)`, top: -2, bottom: -2, width: 2, background: '#0A1729' }} />
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: '#6B7790', marginTop: 5 }}>
                <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: C.safe, marginRight: 4 }} />Booked {fmtM(a.ytd)} ({a.pctBooked}%)</span>
                <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: C.band, marginRight: 4 }} />Still needed {fmtM(a.stillNeeded)}</span>
                <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#0A1729', marginRight: 4 }} />Projected {fmtM(a.projectedTotal)}</span>
              </div>
            </div>

            {/* plain-language rows */}
            <div style={{ padding: '6px 20px 16px' }}>
              <Row label="Target to hit" value={fmtFull(a.target)} strong />
              {data.lastYear && <Row label={`Last year actual (${data.lastYear.year})`} value={fmtFull(data.lastYear.total)} hint="what we actually delivered" />}
              <Row label="Expected next (most likely)" value={fmtFull(data.forecast.p50)} hint="the middle of the forecast, before any safety margin" valueColor={C.mid} />
              <Row label={`Booked so far (${a.monthsElapsed} month${a.monthsElapsed === 1 ? '' : 's'})`} value={fmtFull(a.ytd)} hint={`${a.pctBooked}% of the target`} />
              <Row label="Still needed" value={fmtFull(a.stillNeeded)} valueColor={a.stillNeeded > 0 ? C.stretch : C.safe} strong />
              <Row label="Months left" value={String(a.monthsRemaining)} />
              <Row label="Need per month from now" value={a.monthsRemaining > 0 ? fmtFull(a.neededPerMonth) : NA} hint="to reach the target on time" />
              <Row label="Your recent run-rate" value={a.recentRunRate > 0 ? `${fmtFull(a.recentRunRate)} / mo` : NA} hint="average of the last 3 booked months"
                valueColor={a.recentRunRate >= a.neededPerMonth ? C.safe : C.warn} />
              <Row label="Projected finish (this pace)" value={fmtFull(a.projectedTotal)} valueColor={a.projectedTotal >= a.target ? C.safe : C.warn} />
            </div>

            {/* one-line recommendation */}
            <div style={{ padding: '13px 20px', borderTop: '1px solid #EEF0F3', background: '#FAFBFC', fontSize: 13, color: '#3B4A63', lineHeight: 1.5 }}>
              <b style={{ color: '#16243C' }}>Recommendation: </b>
              {a.verdict === 'very-likely' && <>You'll comfortably pass this. {a.isCustom && data.commitment > a.target ? <>You could even commit up to <b style={{ color: C.safe }}>{fmtM(data.commitment)}</b> and still be {confPct}%-safe.</> : <>Safe to commit.</>}</>}
              {a.verdict === 'on-track' && <>You're on track. Keep the run-rate at <b>{fmtM(a.neededPerMonth)}/mo</b> or above and you'll clear it.</>}
              {a.verdict === 'at-risk' && <>This is a stretch. You need <b>{fmtM(a.neededPerMonth)}/mo</b> vs your recent <b>{fmtM(a.recentRunRate)}/mo</b>. The {confPct}%-safe number is <b style={{ color: C.safe }}>{fmtM(data.commitment)}</b>, consider committing there instead.</>}
              {a.verdict === 'unlikely' && <>This target is too high to promise. The most you can safely commit ({confPct}%) is <b style={{ color: C.safe }}>{fmtM(data.commitment)}</b>.</>}
            </div>
          </div>

          {/* risk chips (kept visible, short) */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 8 }}>
            <Flag ok={!data.risk.thinHistory} okText={`${data.risk.historyYears} yrs of history`} warnText={`Only ${data.risk.historyYears} yr(s) history, rough estimate`} />
            <Flag ok={data.risk.volatilityPct <= 40} okText="Steady spend" warnText="Volatile spend, set the commitment lower" />
            {data.risk.topClient && <Flag ok={data.risk.topClient.sharePct < 50} okText={`Well spread (top ${data.risk.topClient.sharePct}%)`} warnText={`${data.risk.topClient.name} = ${data.risk.topClient.sharePct}% of this scope`} />}
          </div>

          {/* Details toggle */}
          <button onClick={() => setShowDetail((s) => !s)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: '#fff', border: '1px solid #E5E8ED', borderRadius: 9, padding: '9px 14px', fontSize: 13, fontWeight: 700, color: '#3B4A63', cursor: 'pointer', marginBottom: 16 }}>
            <Icon name={showDetail ? 'chevD' : 'chevR'} size={14} /> {showDetail ? 'Hide' : 'Show'} the proof &amp; how the number was reached
          </button>

          {showDetail && (
            <>
              {/* PROOF 1: the track record the safe number is built on */}
              <Card title="1. Our proven track record" sub={`${data.scope.entityName} · full-year spend. A part-uploaded year (marked *) is scaled up to a full-year pace so it isn't understated.`}>
                <ResponsiveContainer width="100%" height={270}>
                  <BarChart data={histRows} margin={{ top: 22, right: 60, left: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F3" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11.5, fill: '#6B7790' }} tickLine={false} axisLine={{ stroke: '#E5E8ED' }} />
                    <YAxis tickFormatter={(x) => (x / 1e6).toFixed(0) + 'M'} tick={{ fontSize: 11, fill: '#6B7790' }} tickLine={false} axisLine={false} width={48} />
                    <Tooltip formatter={(x, n, p) => [fmtFull(x) + (p?.payload?.partial ? `  (raw ${fmtFull(p.payload.raw)} over ${p.payload.months} mo)` : ''), 'Full-year spend']} />
                    <Bar dataKey="value" name="Full-year spend" maxBarSize={64} radius={[5, 5, 0, 0]}>
                      {histRows.map((r, i) => <Cell key={i} fill={r.partial ? '#9FB4D6' : C.actual} />)}
                    </Bar>
                    <ReferenceLine y={data.commitment} stroke={C.safe} strokeWidth={2} strokeDasharray="6 4" label={{ value: `${confPct}%-safe ${(data.commitment / 1e6).toFixed(0)}M`, position: 'right', fontSize: 10.5, fill: C.safe, fontWeight: 700 }} />
                    <ReferenceLine y={data.forecast.p50} stroke={C.mid} strokeWidth={1.6} strokeDasharray="3 4" label={{ value: `Expected ${(data.forecast.p50 / 1e6).toFixed(0)}M`, position: 'right', fontSize: 10.5, fill: C.mid }} />
                    {a.isCustom && <ReferenceLine y={a.target} stroke={C.warn} strokeWidth={2} label={{ value: `Target ${(a.target / 1e6).toFixed(0)}M`, position: 'right', fontSize: 10.5, fill: C.warn, fontWeight: 700 }} />}
                  </BarChart>
                </ResponsiveContainer>
                <How>Each bar is a full year we actually delivered on this scope (lowest {fmtM(data.historicalMin)}, average {fmtM(data.historicalAvg)}, highest {fmtM(data.historicalMax)}). The green line is the <b>{confPct}%-safe</b> commitment (the amount cleared {confPct} times out of 100). Raise the confidence for a safer, lower number; lower it to push the target up toward the blue expected (most-likely) line.</How>
              </Card>

              {/* PROOF 2: the money chart: how likely is ANY target */}
              <Card title="2. How likely are we to clear each amount" sub="Read up from an amount to see the chance of passing it. Steeper drop = the amount is close to our ceiling.">
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={probRows} margin={{ top: 10, right: 16, left: 4, bottom: 4 }}>
                    <defs>
                      <linearGradient id="probFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={C.mid} stopOpacity={0.28} />
                        <stop offset="100%" stopColor={C.mid} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F3" vertical={false} />
                    <XAxis dataKey="m" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(x) => x.toFixed(0) + 'M'} tick={{ fontSize: 11, fill: '#6B7790' }} tickLine={false} axisLine={{ stroke: '#E5E8ED' }} />
                    <YAxis domain={[0, 100]} tickFormatter={(x) => x + '%'} tick={{ fontSize: 11, fill: '#6B7790' }} tickLine={false} axisLine={false} width={40} />
                    <Tooltip formatter={(x) => [`${x}% chance of passing`, 'Likelihood']} labelFormatter={(l) => `Commit ${Number(l).toFixed(0)}M`} />
                    <Area type="monotone" dataKey="probability" stroke={C.mid} strokeWidth={2.4} fill="url(#probFill)" />
                    <ReferenceLine y={confPct} stroke={C.safe} strokeDasharray="5 4" label={{ value: `${confPct}% safe`, position: 'insideTopLeft', fontSize: 10.5, fill: C.safe, fontWeight: 700 }} />
                    <ReferenceLine x={+(data.commitment / 1e6).toFixed(1)} stroke={C.safe} strokeWidth={1.8} label={{ value: 'Safe', position: 'top', fontSize: 10.5, fill: C.safe, fontWeight: 700 }} />
                    {a.isCustom && <ReferenceLine x={+(a.target / 1e6).toFixed(1)} stroke={C.warn} strokeWidth={2} label={{ value: `Target ${prob}%`, position: 'top', fontSize: 10.5, fill: C.warn, fontWeight: 700 }} />}
                  </AreaChart>
                </ResponsiveContainer>
                <How>We simulate next year thousands of times from our year-over-year growth swings and from resampling the actual years we delivered. For every possible commitment amount, this shows the share of simulations that beat it. The green line marks your chosen {confPct}% confidence level. Where it crosses the curve is the safe commitment. Your target sits at <b style={{ color: prob >= confPct ? C.safe : prob >= 50 ? C.stretch : C.warn }}>{prob}%</b>.</How>
              </Card>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
                {/* PROOF 3: will the projected finish clear the target */}
                <Card title="3. Where we finish vs the target" sub="Booked so far plus the forecast for the rest of the year, against the target line.">
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={projRows} margin={{ top: 22, right: 12, left: 4, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F3" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#6B7790' }} tickLine={false} axisLine={{ stroke: '#E5E8ED' }} />
                      <YAxis tickFormatter={(x) => (x / 1e6).toFixed(0) + 'M'} tick={{ fontSize: 11, fill: '#6B7790' }} tickLine={false} axisLine={false} width={46} />
                      <Tooltip formatter={(x, n) => [fmtFull(x), n === 'booked' ? 'Booked' : 'Forecast for rest of year']} />
                      <Bar dataKey="booked" name="Booked" stackId="p" fill={C.safe} maxBarSize={90} />
                      <Bar dataKey="remaining" name="Forecast remaining" stackId="p" fill={C.band} maxBarSize={90} radius={[5, 5, 0, 0]} />
                      <ReferenceLine y={a.target} stroke={C.warn} strokeWidth={2} strokeDasharray="6 4" label={{ value: `Target ${(a.target / 1e6).toFixed(0)}M`, position: 'top', fontSize: 10.5, fill: C.warn, fontWeight: 700 }} />
                      <Legend wrapperStyle={{ fontSize: 11.5 }} />
                    </BarChart>
                  </ResponsiveContainer>
                  <How>Green is what is already booked ({fmtM(a.ytd)}); amber is the forecast for the remaining {a.monthsRemaining} month(s). If the bar tops the red target line we finish above target. Projected finish: <b style={{ color: a.projectedTotal >= a.target ? C.safe : C.warn }}>{fmtM(a.projectedTotal)}</b>.</How>
                </Card>

                {/* PROOF 4: has the method held before */}
                <Card title="4. Would the safe number have held before" sub="A back-test: recompute the safe number for each past year using only earlier data.">
                  {backtestRows.length === 0 ? (
                    <div style={{ padding: '24px 0', textAlign: 'center', color: '#6B7790', fontSize: 12.5 }}>Needs 3+ completed years to back-test.</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={backtestRows} margin={{ top: 16, right: 12, left: 4, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F3" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7790' }} tickLine={false} axisLine={{ stroke: '#E5E8ED' }} />
                        <YAxis tickFormatter={(x) => (x / 1e6).toFixed(0) + 'M'} tick={{ fontSize: 11, fill: '#6B7790' }} tickLine={false} axisLine={false} width={44} />
                        <Tooltip formatter={(x, n) => [fmtFull(x), n === 'commitment' ? 'Would-be safe number' : 'Actual']} />
                        <Bar dataKey="commitment" name="Safe number" fill="#B7C3D6" maxBarSize={24} radius={[3, 3, 0, 0]} />
                        <Bar dataKey="actual" name="Actual" maxBarSize={24} radius={[3, 3, 0, 0]}>
                          {backtestRows.map((b, i) => <Cell key={i} fill={b.cleared ? C.safe : C.warn} />)}
                        </Bar>
                        <Legend wrapperStyle={{ fontSize: 11.5 }} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                  <How>For each past year we recompute the safe number using only the data known before it, then check whether the actual spend cleared it (green) or missed (red). All green means the method has been trustworthy for this scope.</How>
                </Card>
              </div>

              {data.children?.length > 0 && (
                <Card title={`5. Safe commitment by ${data.childLevelLabel.toLowerCase()}`} sub={`Each one's own ${confPct}%-safe figure. Set per-line commitments from here so they add up to the whole.`}>
                  <div className="tbl-wrap">
                    <table className="tbl">
                      <thead><tr><th>{data.childLevelLabel}</th><th style={{ textAlign: 'right' }}>Lifetime spend</th><th style={{ textAlign: 'right' }}>{confPct}%-Safe</th><th style={{ textAlign: 'right' }}>Expected</th></tr></thead>
                      <tbody>
                        {data.children.map((c) => (
                          <tr key={c.key}>
                            <td className="strong">{c.name}</td>
                            <td className="mono" style={{ textAlign: 'right', color: '#6B7790' }}>{fmtM(c.lifetimeSpend)}</td>
                            <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: C.safe }}>{c.p10 == null ? NA : fmtM(c.p10)}</td>
                            <td className="mono" style={{ textAlign: 'right' }}>{c.p50 == null ? NA : fmtM(c.p50)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function Flag({ ok, okText, warnText }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 11px', borderRadius: 9, fontSize: 12, fontWeight: 600, background: ok ? '#ECF8F1' : '#FDF3E7', color: ok ? '#15814B' : '#9A5B00', border: `1px solid ${ok ? '#BFE6CF' : '#F0DBB5'}` }}>
      <Icon name={ok ? 'check' : 'alert'} size={12} />{ok ? okText : warnText}
    </div>
  );
}
