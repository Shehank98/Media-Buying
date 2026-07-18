import { useState, useEffect } from 'react';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, LineChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  BarChart, Cell, ReferenceLine,
} from 'recharts';
import Icon from '../components/Icon';
import OrbitLoader from '../components/OrbitLoader';
import api from '../lib/api';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtM = (v) => (v == null ? '—' : 'LKR ' + (Number(v) / 1e6).toFixed(1) + 'M');
const fmtFull = (v) => (v == null ? '—' : 'LKR ' + Math.round(Number(v)).toLocaleString('en-US'));
const C = { safe: '#15814B', mid: '#1F5BB5', stretch: '#9A5B00', band: '#F2A93B', actual: '#1F5BB5', warn: '#C5391F' };

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
  const [mediaGroups, setMediaGroups] = useState([]);
  const [channels, setChannels] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [showDetail, setShowDetail] = useState(false);

  useEffect(() => {
    api.get('/masterdata/media-groups').then((r) => setMediaGroups((r.data.mediaGroups || r.data || []).filter((g) => g.active !== false))).catch(() => {});
    api.get('/masterdata/channel-masters').then((r) => setChannels(r.data.channelMasters || r.data || [])).catch(() => {});
  }, []);

  useEffect(() => { const t = setTimeout(() => setTargetLkr(targetM === '' || isNaN(Number(targetM)) ? null : Number(targetM) * 1e6), 400); return () => clearTimeout(t); }, [targetM]);

  useEffect(() => {
    if (level !== 'overall' && !entity) { setData(null); return; }
    let cancelled = false;
    setLoading(true); setErr('');
    api.get('/analytics/commitment-planner', { params: { level, entity: level === 'overall' ? undefined : entity, year, target: targetLkr ?? undefined } })
      .then((r) => { if (!cancelled) setData(r.data); })
      .catch((e) => { if (!cancelled) { setErr(e.response?.data?.error || 'Failed to load'); setData(null); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [level, entity, year, targetLkr]);

  const changeLevel = (lv) => { setLevel(lv); setEntity(''); setTargetM(''); };

  const a = data?.assessment;
  const v = VERDICT[a?.verdict || 'unknown'];
  const prob = a?.probability != null ? Math.round(a.probability * 100) : null;
  const bookedPct = a ? Math.min(100, a.pctBooked) : 0;
  const neededPct = a ? Math.min(100 - bookedPct, Math.max(0, (a.stillNeeded / (a.target || 1)) * 100)) : 0;
  const projPct = a && a.target ? Math.min(115, (a.projectedTotal / a.target) * 100) : 0;

  // Detail-chart data
  const forecastRows = data?.hasData ? [
    ...(data.history || []).map((h) => ({ label: String(h.year), actual: h.total })),
    { label: String(data.scope.year) + ' (forecast)', base: data.forecast.p10, band: data.forecast.p90 - data.forecast.p10, p50: data.forecast.p50 },
  ] : [];
  const pacingRows = (data?.monthlyPath || []).map((m, i) => ({ label: MONTHS[i], safe: m.safeCumulative, actual: m.actualCumulative }));
  const seasonalRows = (data?.seasonal || []).map((s, i) => ({ label: MONTHS[i], share: s }));
  const backtestRows = (data?.backtest || []).map((b) => ({ label: String(b.year), commitment: b.commitment, actual: b.actual, cleared: b.cleared }));

  return (
    <div style={{ marginTop: 26 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 6 }}>
        <div style={{ width: 38, height: 38, borderRadius: 11, background: 'linear-gradient(135deg,#15814B,#0E6B3D)', color: '#fff', display: 'grid', placeItems: 'center' }}><Icon name="trending-up" size={19} /></div>
        <div>
          <h2 style={{ fontSize: 19, fontWeight: 760, color: '#16243C', margin: 0, letterSpacing: '-.4px' }}>Commitment Planner</h2>
          <div style={{ fontSize: 12.5, color: '#6B7790' }}>Will we pass the commitment, how likely, and how much do we still need?</div>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7790', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 5 }}>Level</div>
          <div style={{ display: 'inline-flex', border: '1px solid #E5E8ED', borderRadius: 9, overflow: 'hidden' }}>
            {[['overall', 'Overall'], ['media-group', 'Media Group'], ['channel', 'Channel']].map(([k, lbl]) => (
              <button key={k} onClick={() => changeLevel(k)} style={{ border: 'none', padding: '8px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', background: level === k ? '#0A1729' : '#fff', color: level === k ? '#fff' : '#3B4A63' }}>{lbl}</button>
            ))}
          </div>
        </div>
        {level === 'media-group' && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7790', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 5 }}>Media group</div>
            <select className="select" value={entity} onChange={(e) => setEntity(e.target.value)} style={{ minWidth: 210 }}>
              <option value="">Select a media group…</option>
              {mediaGroups.map((g) => <option key={g.id || g.name} value={g.name}>{g.name}</option>)}
            </select>
          </div>
        )}
        {level === 'channel' && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7790', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 5 }}>Channel</div>
            <select className="select" value={entity} onChange={(e) => setEntity(e.target.value)} style={{ minWidth: 210 }}>
              <option value="">Select a channel…</option>
              {channels.map((c) => <option key={c.id} value={c.id}>{c.name}{c.medium ? ` · ${c.medium}` : ''}</option>)}
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
          <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7790', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 5 }}>Target (LKR millions)</div>
          <input className="input" type="number" min="0" step="1" value={targetM} onChange={(e) => setTargetM(e.target.value)}
            placeholder={data?.hasData ? `${(data.commitment / 1e6).toFixed(0)} (90%-safe)` : 'e.g. 300'} style={{ minWidth: 160 }} />
        </div>
      </div>

      {level !== 'overall' && !entity ? (
        <div style={{ padding: '30px 20px', textAlign: 'center', color: '#6B7790', background: '#fff', border: '1px solid #E5E8ED', borderRadius: 14 }}>Pick a {level === 'media-group' ? 'media group' : 'channel'} above.</div>
      ) : loading ? (
        <div style={{ padding: 30 }}><OrbitLoader label="Working it out…" /></div>
      ) : err ? (
        <div style={{ padding: 20, color: C.warn, background: '#FBE0DA', borderRadius: 10 }}>{err}</div>
      ) : !data?.hasData || !a ? (
        <div style={{ padding: '30px 20px', textAlign: 'center', color: '#6B7790', background: '#fff', border: '1px solid #E5E8ED', borderRadius: 14 }}>Not enough history to answer this yet — needs at least one completed year of schedule data.</div>
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
                    {a.isCustom ? 'Your target' : '90%-safe commitment'}: <b style={{ color: '#16243C' }}>{fmtM(a.target)}</b> for {data.scope.entityName} · {data.scope.year}
                  </div>
                </div>
              </div>
              <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                <div className="mono" style={{ fontSize: 40, fontWeight: 800, color: v.color, lineHeight: 1 }}>{prob == null ? '—' : `${prob}%`}</div>
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
                <span>▏ Projected {fmtM(a.projectedTotal)}</span>
              </div>
            </div>

            {/* plain-language rows */}
            <div style={{ padding: '6px 20px 16px' }}>
              <Row label="Target to hit" value={fmtFull(a.target)} strong />
              <Row label={`Booked so far (${a.monthsElapsed} month${a.monthsElapsed === 1 ? '' : 's'})`} value={fmtFull(a.ytd)} hint={`${a.pctBooked}% of the target`} />
              <Row label="Still needed" value={fmtFull(a.stillNeeded)} valueColor={a.stillNeeded > 0 ? C.stretch : C.safe} strong />
              <Row label="Months left" value={String(a.monthsRemaining)} />
              <Row label="Need per month from now" value={a.monthsRemaining > 0 ? fmtFull(a.neededPerMonth) : '—'} hint="to reach the target on time" />
              <Row label="Your recent run-rate" value={a.recentRunRate > 0 ? `${fmtFull(a.recentRunRate)} / mo` : '—'} hint="average of the last 3 booked months"
                valueColor={a.recentRunRate >= a.neededPerMonth ? C.safe : C.warn} />
              <Row label="Projected finish (this pace)" value={fmtFull(a.projectedTotal)} valueColor={a.projectedTotal >= a.target ? C.safe : C.warn} />
            </div>

            {/* one-line recommendation */}
            <div style={{ padding: '13px 20px', borderTop: '1px solid #EEF0F3', background: '#FAFBFC', fontSize: 13, color: '#3B4A63', lineHeight: 1.5 }}>
              <b style={{ color: '#16243C' }}>Recommendation: </b>
              {a.verdict === 'very-likely' && <>You'll comfortably pass this. {a.isCustom && data.commitment > a.target ? <>You could even commit up to <b style={{ color: C.safe }}>{fmtM(data.commitment)}</b> and still be 90%-safe.</> : <>Safe to commit.</>}</>}
              {a.verdict === 'on-track' && <>You're on track — keep the run-rate at <b>{fmtM(a.neededPerMonth)}/mo</b> or above and you'll clear it.</>}
              {a.verdict === 'at-risk' && <>This is a stretch. You need <b>{fmtM(a.neededPerMonth)}/mo</b> vs your recent <b>{fmtM(a.recentRunRate)}/mo</b>. The 90%-safe number is <b style={{ color: C.safe }}>{fmtM(data.commitment)}</b> — consider committing there instead.</>}
              {a.verdict === 'unlikely' && <>This target is too high to promise. The most you can safely commit (90%) is <b style={{ color: C.safe }}>{fmtM(data.commitment)}</b>.</>}
            </div>
          </div>

          {/* risk chips (kept visible, short) */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 8 }}>
            <Flag ok={!data.risk.thinHistory} okText={`${data.risk.historyYears} yrs of history`} warnText={`Only ${data.risk.historyYears} yr(s) history — rough estimate`} />
            <Flag ok={data.risk.volatilityPct <= 40} okText="Steady spend" warnText="Volatile spend — set the commitment lower" />
            {data.risk.topClient && <Flag ok={data.risk.topClient.sharePct < 50} okText={`Well spread (top ${data.risk.topClient.sharePct}%)`} warnText={`${data.risk.topClient.name} = ${data.risk.topClient.sharePct}% of this scope`} />}
          </div>

          {/* Details toggle */}
          <button onClick={() => setShowDetail((s) => !s)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: '#fff', border: '1px solid #E5E8ED', borderRadius: 9, padding: '9px 14px', fontSize: 13, fontWeight: 700, color: '#3B4A63', cursor: 'pointer', marginBottom: 16 }}>
            <Icon name={showDetail ? 'chevD' : 'chevR'} size={14} /> {showDetail ? 'Hide' : 'Show'} the history &amp; how the number was reached
          </button>

          {showDetail && (
            <>
              <Card title="How we got the safe number" sub={`${data.scope.entityName} — spend each completed year, then the modelled range for ${data.scope.year}`}>
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={forecastRows} margin={{ top: 16, right: 12, left: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F3" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7790' }} tickLine={false} axisLine={{ stroke: '#E5E8ED' }} />
                    <YAxis tickFormatter={(x) => (x / 1e6).toFixed(0) + 'M'} tick={{ fontSize: 11, fill: '#6B7790' }} tickLine={false} axisLine={false} width={48} />
                    <Tooltip formatter={(x, n) => [fmtFull(x), n === 'actual' ? 'Actual' : n === 'band' ? 'Likely range' : n === 'base' ? 'Safe (P10)' : 'Expected']} />
                    <Bar dataKey="actual" name="Actual" fill={C.actual} maxBarSize={44} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="base" stackId="f" fill="transparent" maxBarSize={44} />
                    <Bar dataKey="band" stackId="f" name="Likely range" fill={C.band} fillOpacity={0.55} maxBarSize={44} radius={[4, 4, 0, 0]} />
                    <Line dataKey="p50" name="Expected" stroke={C.mid} strokeWidth={0} dot={{ r: 4, fill: C.mid }} />
                    <ReferenceLine y={data.commitment} stroke={C.safe} strokeDasharray="5 4" />
                    <Legend wrapperStyle={{ fontSize: 11.5 }} />
                  </ComposedChart>
                </ResponsiveContainer>
                <How>Total each completed year (blue), work out how your spend has grown year to year, then simulate next year thousands of times from those growth swings. The amber band is the likely range; the safe commitment is the bottom of it (beaten ~90% of the time).</How>
              </Card>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
                <Card title="Monthly pace vs the safe line" sub="Are we keeping up?">
                  <ResponsiveContainer width="100%" height={230}>
                    <LineChart data={pacingRows} margin={{ top: 10, right: 12, left: 4, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F3" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 10.5, fill: '#6B7790' }} tickLine={false} axisLine={{ stroke: '#E5E8ED' }} interval={0} />
                      <YAxis tickFormatter={(x) => (x / 1e6).toFixed(0) + 'M'} tick={{ fontSize: 11, fill: '#6B7790' }} tickLine={false} axisLine={false} width={44} />
                      <Tooltip formatter={(x, n) => [fmtFull(x), n === 'safe' ? 'Where we should be' : 'Where we are']} />
                      <Line type="monotone" dataKey="safe" name="Where we should be" stroke={C.safe} strokeWidth={2.2} strokeDasharray="5 4" dot={false} />
                      <Line type="monotone" dataKey="actual" name="Where we are" stroke={C.actual} strokeWidth={2.6} dot={{ r: 2.5 }} connectNulls={false} />
                      <Legend wrapperStyle={{ fontSize: 11.5 }} />
                    </LineChart>
                  </ResponsiveContainer>
                  <How>The commitment split across months by your usual seasonal pattern (green) vs your actual cumulative spend so far (blue). Above the green line = ahead of pace.</How>
                </Card>

                <Card title="Track record" sub="Would the safe number have held before?">
                  {backtestRows.length === 0 ? (
                    <div style={{ padding: '24px 0', textAlign: 'center', color: '#6B7790', fontSize: 12.5 }}>Needs 3+ completed years to backtest.</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={230}>
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
                  <How>For each past year we recompute the safe number using only the data known before it, then check whether actual spend cleared it (green) or missed (red). All green = the method is trustworthy here.</How>
                </Card>
              </div>

              {data.children?.length > 0 && (
                <Card title={`Safe commitment by ${data.childLevelLabel.toLowerCase()}`} sub="Each one's own 90%-safe figure — set per-line commitments from here">
                  <div className="tbl-wrap">
                    <table className="tbl">
                      <thead><tr><th>{data.childLevelLabel}</th><th style={{ textAlign: 'right' }}>Lifetime spend</th><th style={{ textAlign: 'right' }}>90%-Safe</th><th style={{ textAlign: 'right' }}>Expected</th></tr></thead>
                      <tbody>
                        {data.children.map((c) => (
                          <tr key={c.key}>
                            <td className="strong">{c.name}</td>
                            <td className="mono" style={{ textAlign: 'right', color: '#6B7790' }}>{fmtM(c.lifetimeSpend)}</td>
                            <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: C.safe }}>{c.p10 == null ? '—' : fmtM(c.p10)}</td>
                            <td className="mono" style={{ textAlign: 'right' }}>{c.p50 == null ? '—' : fmtM(c.p50)}</td>
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
