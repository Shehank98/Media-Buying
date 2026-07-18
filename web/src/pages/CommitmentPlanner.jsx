import { useState, useEffect } from 'react';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, LineChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  BarChart, Cell, ReferenceLine, RadialBarChart, RadialBar, PolarAngleAxis,
} from 'recharts';
import Icon from '../components/Icon';
import OrbitLoader from '../components/OrbitLoader';
import api from '../lib/api';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtM = (v) => (v == null ? '—' : 'LKR ' + (Number(v) / 1e6).toFixed(1) + 'M');
const fmtFull = (v) => (v == null ? '—' : 'LKR ' + Math.round(Number(v)).toLocaleString('en-US'));
const C = { safe: '#15814B', mid: '#1F5BB5', stretch: '#9A5B00', band: '#F2A93B', actual: '#1F5BB5', warn: '#C5391F' };

// A small "how this is calculated" note shown under every chart.
function How({ children }) {
  return (
    <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start', marginTop: 10, padding: '9px 12px', background: '#F5F8FC', border: '1px solid #E3EAF3', borderRadius: 9, fontSize: 11.8, color: '#3B4A63', lineHeight: 1.5 }}>
      <Icon name="activity" size={13} style={{ color: '#1F5BB5', flexShrink: 0, marginTop: 1 }} />
      <div><b style={{ color: '#16243C' }}>How this is calculated: </b>{children}</div>
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

export default function CommitmentPlanner() {
  const [level, setLevel] = useState('overall');
  const [entity, setEntity] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [mediaGroups, setMediaGroups] = useState([]);
  const [channels, setChannels] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get('/masterdata/media-groups').then((r) => setMediaGroups((r.data.mediaGroups || r.data || []).filter((g) => g.active !== false))).catch(() => {});
    api.get('/masterdata/channel-masters').then((r) => setChannels(r.data.channelMasters || r.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    // Reset entity when the level changes; skip fetch until an entity is picked for non-overall.
    if (level !== 'overall' && !entity) { setData(null); return; }
    let cancelled = false;
    setLoading(true); setErr('');
    api.get('/analytics/commitment-planner', { params: { level, entity: level === 'overall' ? undefined : entity, year } })
      .then((r) => { if (!cancelled) setData(r.data); })
      .catch((e) => { if (!cancelled) { setErr(e.response?.data?.error || 'Failed to load'); setData(null); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [level, entity, year]);

  const changeLevel = (lv) => { setLevel(lv); setEntity(''); };

  // Forecast chart rows: past years actual + target year band (P10→P90) with P50 marker.
  const forecastRows = data?.hasData ? [
    ...(data.history || []).map((h) => ({ label: String(h.year), actual: h.total })),
    { label: String(data.scope.year) + ' (forecast)', base: data.forecast.p10, band: data.forecast.p90 - data.forecast.p10, p50: data.forecast.p50, isForecast: true },
  ] : [];

  const pacingRows = (data?.monthlyPath || []).map((m, i) => ({ label: MONTHS[i], safe: m.safeCumulative, actual: m.actualCumulative }));
  const seasonalRows = (data?.seasonal || []).map((s, i) => ({ label: MONTHS[i], share: s }));
  const backtestRows = (data?.backtest || []).map((b) => ({ label: String(b.year), commitment: b.commitment, actual: b.actual, cleared: b.cleared }));
  const prob = data?.probabilityHit != null ? Math.round(data.probabilityHit * 100) : null;
  const probColor = prob == null ? '#93A0B5' : prob >= 90 ? C.safe : prob >= 75 ? C.stretch : C.warn;

  return (
    <div style={{ marginTop: 26 }}>
      {/* Section header + top-level explanation */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 6 }}>
        <div style={{ width: 38, height: 38, borderRadius: 11, background: 'linear-gradient(135deg,#15814B,#0E6B3D)', color: '#fff', display: 'grid', placeItems: 'center' }}><Icon name="trending-up" size={19} /></div>
        <div>
          <h2 style={{ fontSize: 19, fontWeight: 760, color: '#16243C', margin: 0, letterSpacing: '-.4px' }}>Commitment Planner</h2>
          <div style={{ fontSize: 12.5, color: '#6B7790' }}>The yearly spend you can safely commit to a media group / channel without missing the discount.</div>
        </div>
      </div>
      <div style={{ fontSize: 12.5, color: '#3B4A63', lineHeight: 1.6, background: '#EEF4FF', border: '1px solid #DBE6FA', borderRadius: 11, padding: '11px 14px', marginBottom: 16 }}>
        <b>The idea:</b> because a missed commitment only costs you the discount, you want to commit to a number you'll almost certainly beat.
        We model the range of possible spend for the year from your history and recommend the <b style={{ color: C.safe }}>90%-safe</b> figure —
        the level you'd clear in roughly 9 out of 10 years. Commit at or below it and you keep the discount.
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
            <select className="select" value={entity} onChange={(e) => setEntity(e.target.value)} style={{ minWidth: 220 }}>
              <option value="">Select a media group…</option>
              {mediaGroups.map((g) => <option key={g.id || g.name} value={g.name}>{g.name}</option>)}
            </select>
          </div>
        )}
        {level === 'channel' && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7790', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 5 }}>Channel</div>
            <select className="select" value={entity} onChange={(e) => setEntity(e.target.value)} style={{ minWidth: 220 }}>
              <option value="">Select a channel…</option>
              {channels.map((c) => <option key={c.id} value={c.id}>{c.name}{c.medium ? ` · ${c.medium}` : ''}</option>)}
            </select>
          </div>
        )}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7790', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 5 }}>Commitment year</div>
          <select className="select" value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ minWidth: 120 }}>
            {(data?.availableYears || [year]).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {level !== 'overall' && !entity ? (
        <div style={{ padding: '30px 20px', textAlign: 'center', color: '#6B7790', background: '#fff', border: '1px solid #E5E8ED', borderRadius: 14 }}>Pick a {level === 'media-group' ? 'media group' : 'channel'} above to see its safe commitment.</div>
      ) : loading ? (
        <div style={{ padding: 30 }}><OrbitLoader label="Modelling spend…" /></div>
      ) : err ? (
        <div style={{ padding: 20, color: C.warn, background: '#FBE0DA', borderRadius: 10 }}>{err}</div>
      ) : !data?.hasData ? (
        <div style={{ padding: '30px 20px', textAlign: 'center', color: '#6B7790', background: '#fff', border: '1px solid #E5E8ED', borderRadius: 14 }}>Not enough history to model this scope yet — needs at least one completed year of schedule data.</div>
      ) : (
        <>
          {/* Headline cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14, marginBottom: 16 }}>
            <div style={{ background: 'linear-gradient(135deg,#15814B,#0E6B3D)', color: '#fff', borderRadius: 14, padding: 18 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px', opacity: 0.9 }}>90%-Safe Commitment</div>
              <div className="mono" style={{ fontSize: 25, fontWeight: 780, marginTop: 5 }} title={fmtFull(data.commitment)}>{fmtM(data.commitment)}</div>
              <div style={{ fontSize: 11.5, opacity: 0.9, marginTop: 3 }}>{data.scope.entityName} · {data.scope.year}</div>
            </div>
            <div style={{ background: '#fff', border: '1px solid #E5E8ED', borderTop: `3px solid ${C.mid}`, borderRadius: 14, padding: 18 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px', color: '#6B7790' }}>Expected (P50)</div>
              <div className="mono" style={{ fontSize: 22, fontWeight: 760, marginTop: 5, color: '#16243C' }} title={fmtFull(data.forecast.p50)}>{fmtM(data.forecast.p50)}</div>
              <div style={{ fontSize: 11.5, color: '#6B7790', marginTop: 3 }}>The most-likely spend</div>
            </div>
            <div style={{ background: '#fff', border: '1px solid #E5E8ED', borderTop: `3px solid ${C.stretch}`, borderRadius: 14, padding: 18 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px', color: '#6B7790' }}>Stretch (P90)</div>
              <div className="mono" style={{ fontSize: 22, fontWeight: 760, marginTop: 5, color: '#16243C' }} title={fmtFull(data.forecast.p90)}>{fmtM(data.forecast.p90)}</div>
              <div style={{ fontSize: 11.5, color: '#6B7790', marginTop: 3 }}>Only ~10% chance to exceed</div>
            </div>
          </div>

          {/* Forecast fan */}
          <Card title="Annual spend & next-year forecast" sub={`${data.scope.entityName} — actual per year, then the modelled range for ${data.scope.year}`}>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={forecastRows} margin={{ top: 16, right: 12, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7790' }} tickLine={false} axisLine={{ stroke: '#E5E8ED' }} />
                <YAxis tickFormatter={(v) => (v / 1e6).toFixed(0) + 'M'} tick={{ fontSize: 11, fill: '#6B7790' }} tickLine={false} axisLine={false} width={50} />
                <Tooltip formatter={(v, n) => [fmtFull(v), n === 'actual' ? 'Actual' : n === 'band' ? 'P10→P90 range' : n === 'base' ? 'P10 (safe)' : n]} />
                <Bar dataKey="actual" name="Actual" fill={C.actual} maxBarSize={46} radius={[4, 4, 0, 0]} />
                <Bar dataKey="base" stackId="f" fill="transparent" maxBarSize={46} />
                <Bar dataKey="band" stackId="f" name="Forecast range" fill={C.band} fillOpacity={0.55} maxBarSize={46} radius={[4, 4, 0, 0]} />
                <Line dataKey="p50" name="Expected (P50)" stroke={C.mid} strokeWidth={0} dot={{ r: 4, fill: C.mid }} />
                <ReferenceLine y={data.commitment} stroke={C.safe} strokeDasharray="5 4" label={{ value: '90%-safe', position: 'right', fill: C.safe, fontSize: 10.5, fontWeight: 700 }} />
                <Legend wrapperStyle={{ fontSize: 11.5 }} />
              </ComposedChart>
            </ResponsiveContainer>
            <How>
              We total each <b>completed</b> year's spend (blue), then compute your year-over-year growth rates and run a Monte-Carlo simulation
              ({'4,000'} draws) that resamples those growth swings to build a range of possible spend for {data.scope.year}. The amber band is the
              P10→P90 range; the green dashed line is the <b>P10 — the amount you clear ~90% of the time</b>, which becomes the recommended commitment.
              {data.forecast.growth?.length ? ` Historical growth used: ${data.forecast.growth.map((g) => (g > 0 ? '+' : '') + g + '%').join(', ')}.` : ''}
            </How>
          </Card>

          {/* Pacing + probability */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, marginBottom: 0 }}>
            <Card title="Monthly pace vs the safe line" sub="Are you on track to clear the commitment this year?">
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={pacingRows} margin={{ top: 10, right: 12, left: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10.5, fill: '#6B7790' }} tickLine={false} axisLine={{ stroke: '#E5E8ED' }} interval={0} />
                  <YAxis tickFormatter={(v) => (v / 1e6).toFixed(0) + 'M'} tick={{ fontSize: 11, fill: '#6B7790' }} tickLine={false} axisLine={false} width={46} />
                  <Tooltip formatter={(v, n) => [fmtFull(v), n === 'safe' ? 'Safe path (cumulative)' : 'Actual (cumulative)']} />
                  <Line type="monotone" dataKey="safe" name="Safe path" stroke={C.safe} strokeWidth={2.2} strokeDasharray="5 4" dot={false} />
                  <Line type="monotone" dataKey="actual" name="Actual YTD" stroke={C.actual} strokeWidth={2.6} dot={{ r: 2.5 }} connectNulls={false} />
                  <Legend wrapperStyle={{ fontSize: 11.5 }} />
                </LineChart>
              </ResponsiveContainer>
              <How>
                We spread the commitment across months using your <b>seasonal profile</b> (the share of a year's spend each month usually carries) →
                the green "safe path". The blue line is your <b>actual cumulative spend</b> so far ({data.currentYear.monthsElapsed} month(s) of data,
                {' '}{fmtM(data.currentYear.ytd)} to date). Staying on or above the green line means you're pacing to clear the commitment.
              </How>
            </Card>

            <Card title="Probability of clearing the commitment" sub="Updated from spend booked so far">
              <div style={{ position: 'relative', height: 250 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <RadialBarChart innerRadius="72%" outerRadius="100%" data={[{ name: 'p', value: prob ?? 90, fill: probColor }]} startAngle={220} endAngle={-40}>
                    <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                    <RadialBar background={{ fill: '#EEF0F3' }} dataKey="value" cornerRadius={12} />
                  </RadialBarChart>
                </ResponsiveContainer>
                <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
                  <div style={{ textAlign: 'center' }}>
                    <div className="mono" style={{ fontSize: 40, fontWeight: 780, color: probColor, lineHeight: 1 }}>{prob == null ? '—' : `${prob}%`}</div>
                    <div style={{ fontSize: 12, color: '#6B7790', marginTop: 4 }}>chance to clear {fmtM(data.commitment)}</div>
                  </div>
                </div>
              </div>
              <How>
                We take your spend booked so far, then simulate the remaining months (drawing from the modelled range) thousands of times, and count
                how often the year finishes at or above the commitment. A well-set commitment should sit around <b>90%</b> at the start of the year and
                climb as you book spend.
              </How>
            </Card>
          </div>

          {/* Backtest + seasonality */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, marginTop: 16 }}>
            <Card title="Track record (backtest)" sub="Would the recommendation have held in past years?">
              {backtestRows.length === 0 ? (
                <div style={{ padding: '24px 0', textAlign: 'center', color: '#6B7790', fontSize: 12.5 }}>Needs more history to backtest (at least 3 completed years).</div>
              ) : (
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={backtestRows} margin={{ top: 16, right: 12, left: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F3" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7790' }} tickLine={false} axisLine={{ stroke: '#E5E8ED' }} />
                    <YAxis tickFormatter={(v) => (v / 1e6).toFixed(0) + 'M'} tick={{ fontSize: 11, fill: '#6B7790' }} tickLine={false} axisLine={false} width={46} />
                    <Tooltip formatter={(v, n) => [fmtFull(v), n === 'commitment' ? 'Would-be commitment (P10)' : 'Actual spend']} />
                    <Bar dataKey="commitment" name="Commitment (P10)" fill="#B7C3D6" maxBarSize={26} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="actual" name="Actual" maxBarSize={26} radius={[3, 3, 0, 0]}>
                      {backtestRows.map((b, i) => <Cell key={i} fill={b.cleared ? C.safe : C.warn} />)}
                    </Bar>
                    <Legend wrapperStyle={{ fontSize: 11.5 }} />
                  </BarChart>
                </ResponsiveContainer>
              )}
              <How>
                For each past year we recompute the P10 commitment using <b>only the data available before that year</b>, then check whether actual spend
                cleared it (green) or fell short (red). If the recommendation was cleared every year, the 90%-safe number is trustworthy for this scope.
              </How>
            </Card>

            <Card title="Seasonality profile" sub="Share of a year's spend by month">
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={seasonalRows} margin={{ top: 12, right: 12, left: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10.5, fill: '#6B7790' }} tickLine={false} axisLine={{ stroke: '#E5E8ED' }} interval={0} />
                  <YAxis tickFormatter={(v) => v + '%'} tick={{ fontSize: 11, fill: '#6B7790' }} tickLine={false} axisLine={false} width={38} />
                  <Tooltip formatter={(v) => [`${v}% of the year`, 'Share']} />
                  <Bar dataKey="share" fill={C.mid} maxBarSize={26} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <How>
                The average share of the full-year spend that each calendar month carries, across your completed years. This shape is what spreads the
                commitment into the monthly "safe path" above, so heavy months are expected to contribute more.
              </How>
            </Card>
          </div>

          {/* Risk flags */}
          <Card title="Risk checks" sub="Things that can make the forecast less reliable">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <Flag ok={!data.risk.thinHistory} okText={`${data.risk.historyYears} completed years of history`} warnText={`Only ${data.risk.historyYears} completed year(s) — forecast is rough`} />
              <Flag ok={data.risk.volatilityPct <= 40} okText={`Spend is fairly steady (±${(data.risk.volatilityPct / 2).toFixed(0)}% band)`} warnText={`Volatile spend (±${(data.risk.volatilityPct / 2).toFixed(0)}% band) — safe number set lower`} />
              {data.risk.topClient && (
                <Flag ok={data.risk.topClient.sharePct < 50} okText={`Well spread (top client ${data.risk.topClient.sharePct}%)`} warnText={`${data.risk.topClient.name} is ${data.risk.topClient.sharePct}% of this scope — losing them breaks the forecast`} />
              )}
            </div>
            <How>
              These don't change the math — they tell you how much to trust it. Thin history, volatile spend, or one client dominating the scope all mean
              you may want to commit a notch below the recommendation.
            </How>
          </Card>

          {/* Children breakdown */}
          {data.children?.length > 0 && (
            <Card title={`Safe commitment by ${data.childLevelLabel.toLowerCase()}`} sub="Each sub-entity's own 90%-safe figure — they roll up into the total above">
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>{data.childLevelLabel}</th>
                      <th style={{ textAlign: 'right' }}>Lifetime spend</th>
                      <th style={{ textAlign: 'right' }}>90%-Safe (P10)</th>
                      <th style={{ textAlign: 'right' }}>Expected (P50)</th>
                      <th style={{ textAlign: 'right' }}>History</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.children.map((c) => (
                      <tr key={c.key}>
                        <td className="strong">{c.name}</td>
                        <td className="mono" style={{ textAlign: 'right', color: '#6B7790' }}>{fmtM(c.lifetimeSpend)}</td>
                        <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: C.safe }}>{c.p10 == null ? '—' : fmtM(c.p10)}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{c.p50 == null ? '—' : fmtM(c.p50)}</td>
                        <td style={{ textAlign: 'right', color: '#6B7790', fontSize: 12 }}>{c.historyYears} yr</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <How>
                Each {data.childLevelLabel.toLowerCase()} is modelled the same way on its own history (top 15 by lifetime spend shown). Use these to set
                per-{data.childLevelLabel.toLowerCase()} commitments; because they're each 90%-safe, their sum is a conservative floor for the level above.
              </How>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Flag({ ok, okText, warnText }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 12px', borderRadius: 9, fontSize: 12.3, fontWeight: 600, background: ok ? '#ECF8F1' : '#FDF3E7', color: ok ? '#15814B' : '#9A5B00', border: `1px solid ${ok ? '#BFE6CF' : '#F0DBB5'}` }}>
      <Icon name={ok ? 'check' : 'alert'} size={13} />{ok ? okText : warnText}
    </div>
  );
}
