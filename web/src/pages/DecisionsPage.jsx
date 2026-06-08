import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, ComposedChart, Area, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import Icon from '../components/Icon';
import api from '../lib/api';

const fmtLKR = (v) => {
  if (v == null) return '-';
  return 'LKR ' + Math.round(Number(v)).toLocaleString('en-US');
};

const fmtShort = (v) => {
  if (v == null || v === 0) return '0';
  if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
  if (v >= 1000) return (v / 1000).toFixed(0) + 'K';
  return String(v);
};

const fmtMonth = (ym) => {
  if (!ym) return '-';
  const [y, m] = ym.split('-');
  return new Date(+y, +m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
};

const Skeleton = ({ w = '100%', h = 20 }) => (
  <div style={{ width: w, height: h, background: 'var(--bg-sunken)', borderRadius: 6, animation: 'pulse 1.5s ease-in-out infinite' }} />
);

const MEDIUM_COLORS = { TV: '#1e3a5f', RADIO: '#E85D24', PRINT: '#059669' };

const SEVERITY = {
  high: { fg: 'var(--red-600)', bg: 'var(--red-50)', label: 'High', icon: 'alert' },
  medium: { fg: 'var(--amber-700, #b45309)', bg: 'var(--amber-50, #fffbeb)', label: 'Medium', icon: 'alert' },
  low: { fg: 'var(--blue-700)', bg: 'var(--blue-50)', label: 'Low', icon: 'eye' },
  positive: { fg: 'var(--green-600)', bg: 'var(--green-100)', label: 'Good', icon: 'check' },
};

const GRADE_COLORS = {
  A: '#059669', B: '#0891b2', C: '#b45309', D: '#dc2626',
};

const ChartEmpty = ({ label = 'No data available' }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 180, color: 'var(--muted)' }}>
    <Icon name="bar-chart" size={36} style={{ opacity: 0.3, marginBottom: 8 }} />
    <div style={{ fontSize: 14 }}>{label}</div>
  </div>
);

const CustomTooltipLKR = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, color: 'var(--muted)' }}>{label}</div>
      {payload.filter(p => p.value != null).map((p, i) => (
        <div key={i} style={{ fontSize: 13, color: p.color || 'var(--ink)', marginBottom: 2 }}>
          <span style={{ marginRight: 6, fontWeight: 600 }}>{p.name}:</span>
          {fmtLKR(p.value)}
        </div>
      ))}
    </div>
  );
};

const MediumBadge = ({ medium }) => {
  if (!medium) return null;
  const fg = MEDIUM_COLORS[medium] || '#6b7280';
  const bg = { TV: '#dbeafe', RADIO: '#fff5f0', PRINT: '#ecfdf5' }[medium] || '#f3f4f6';
  return (
    <span style={{ background: bg, color: fg, borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>{medium}</span>
  );
};

export default function DecisionsPage() {
  const navigate = useNavigate();

  const [insights, setInsights] = useState(null);
  const [insightsLoading, setInsightsLoading] = useState(true);

  const [alerts, setAlerts] = useState(null);
  const [alertsLoading, setAlertsLoading] = useState(true);

  const [forecast, setForecast] = useState(null);
  const [forecastLoading, setForecastLoading] = useState(true);

  const [scores, setScores] = useState(null);
  const [scoresLoading, setScoresLoading] = useState(true);

  useEffect(() => {
    setInsightsLoading(true);
    api.get('/decisions/insights').then(r => setInsights(r.data)).catch(() => setInsights(null)).finally(() => setInsightsLoading(false));
    setAlertsLoading(true);
    api.get('/decisions/alerts').then(r => setAlerts(r.data)).catch(() => setAlerts(null)).finally(() => setAlertsLoading(false));
    setForecastLoading(true);
    api.get('/decisions/forecast').then(r => setForecast(r.data)).catch(() => setForecast(null)).finally(() => setForecastLoading(false));
    setScoresLoading(true);
    api.get('/decisions/channel-scores').then(r => setScores(r.data)).catch(() => setScores(null)).finally(() => setScoresLoading(false));
  }, []);

  // Build forecast chart data: history actuals + a connected dashed forecast point.
  const forecastChart = (() => {
    if (!forecast?.combined?.history?.length) return [];
    const hist = forecast.combined.history.map(h => ({ month: fmtMonth(h.month), actual: h.scheduleValue, forecast: null }));
    const last = hist[hist.length - 1];
    if (last && forecast.combined.forecast != null) {
      last.forecast = last.actual; // anchor the dashed line to the last actual
      hist.push({ month: fmtMonth(forecast.forecastMonth), actual: null, forecast: forecast.combined.forecast });
    }
    return hist;
  })();

  return (
    <div className="fade-in" style={{ maxWidth: 1400 }}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        .dash-section { margin-bottom: 36px; }
        .dash-section-title { font-size: 15px; font-weight: 720; color: var(--ink); margin-bottom: 4px; letter-spacing: -0.3px; display:flex; align-items:center; gap:8px; }
        .dash-section-sub { font-size: 12.5px; color: var(--muted); margin-bottom: 16px; }
        .chart-card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px; }
        .chart-card-title { font-size: 14px; font-weight: 700; color: var(--ink); margin-bottom: 4px; }
        .chart-card-sub { font-size: 12px; color: var(--muted); margin-bottom: 16px; }
        .rec-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 14px; }
        .rec-card { background: var(--card); border: 1px solid var(--border); border-left-width: 4px; border-radius: 10px; padding: 16px; cursor: pointer; transition: box-shadow .15s, transform .15s; }
        .rec-card:hover { box-shadow: 0 6px 18px rgba(0,0,0,0.08); transform: translateY(-1px); }
        .rec-head { display:flex; align-items:center; justify-content:space-between; margin-bottom: 8px; gap: 10px; }
        .rec-cat { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; }
        .rec-sev { font-size: 10.5px; font-weight: 800; padding: 2px 8px; border-radius: 20px; text-transform: uppercase; letter-spacing: 0.3px; }
        .rec-title { font-size: 13.5px; font-weight: 700; color: var(--ink); margin-bottom: 5px; line-height: 1.3; }
        .rec-msg { font-size: 12.5px; color: var(--muted); line-height: 1.45; }
        .empty-good { display:flex; flex-direction:column; align-items:center; justify-content:center; padding: 36px; color: var(--green-600); background: var(--green-100); border-radius: 12px; }
        .fc-grid { display:grid; grid-template-columns: 1.6fr 1fr; gap: 20px; }
        .fc-stat { background: var(--bg-sunken); border-radius: 10px; padding: 16px; margin-bottom: 12px; }
        .fc-stat-label { font-size: 12px; color: var(--muted); margin-bottom: 4px; }
        .fc-stat-val { font-size: 22px; font-weight: 760; color: var(--ink); }
        .score-bar-track { height: 8px; border-radius: 4px; background: var(--bg-sunken); overflow: hidden; }
        .score-bar-fill { height: 100%; border-radius: 4px; }
        .grade-pill { width: 26px; height: 26px; border-radius: 7px; display:inline-flex; align-items:center; justify-content:center; color:#fff; font-weight:800; font-size:13px; }
        @media (max-width: 900px) { .fc-grid { grid-template-columns: 1fr; } }
      `}</style>

      <div className="page-head" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="page-title">Decision Center</h1>
          <p className="page-sub">Recommendations, anomaly alerts, spend forecasts and channel value scoring</p>
        </div>
      </div>

      {/* Section 1: Alerts */}
      <div className="dash-section">
        <div className="dash-section-title"><Icon name="alert" size={17} style={{ color: 'var(--red-600)' }} />Anomaly Alerts</div>
        <div className="dash-section-sub">Statistically unusual month-over-month movements and missing monthly data</div>
        {alertsLoading ? (
          <div className="rec-grid">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} h={110} />)}</div>
        ) : !alerts || !alerts.alerts.length ? (
          <div className="empty-good"><Icon name="check" size={30} style={{ marginBottom: 8 }} /><div style={{ fontWeight: 700 }}>No anomalies detected this month</div></div>
        ) : (
          <div className="rec-grid">
            {alerts.alerts.map(a => {
              const s = SEVERITY[a.severity] || SEVERITY.low;
              return (
                <div key={a.id} className="rec-card" style={{ borderLeftColor: s.fg }} onClick={() => a.link && navigate(a.link)}>
                  <div className="rec-head">
                    <span className="rec-cat" style={{ color: s.fg, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Icon name={a.type === 'drop' || a.type === 'missing' ? 'trending-down' : 'trending-up'} size={14} />
                      {a.type}
                    </span>
                    <span className="rec-sev" style={{ background: s.bg, color: s.fg }}>{s.label}</span>
                  </div>
                  <div className="rec-title">{a.title} {a.medium && <MediumBadge medium={a.medium} />}</div>
                  <div className="rec-msg">{a.message}</div>
                  <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 12 }}>
                    <span style={{ color: 'var(--muted)' }}>This month <b className="mono" style={{ color: 'var(--ink)' }}>{fmtLKR(a.current)}</b></span>
                    <span style={{ color: 'var(--muted)' }}>Baseline <b className="mono" style={{ color: 'var(--ink)' }}>{fmtLKR(a.baseline)}</b></span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Section 2: Insights & Recommendations */}
      <div className="dash-section">
        <div className="dash-section-title"><Icon name="sparkle" size={17} style={{ color: 'var(--coral-600)' }} />Insights & Recommendations</div>
        <div className="dash-section-sub">Strategic suggestions derived from your billing and property data</div>
        {insightsLoading ? (
          <div className="rec-grid">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} h={110} />)}</div>
        ) : !insights || !insights.insights.length ? (
          <div className="empty-good"><Icon name="check" size={30} style={{ marginBottom: 8 }} /><div style={{ fontWeight: 700 }}>No recommendations right now — your book looks healthy</div></div>
        ) : (
          <div className="rec-grid">
            {insights.insights.map(it => {
              const s = SEVERITY[it.severity] || SEVERITY.low;
              return (
                <div key={it.id} className="rec-card" style={{ borderLeftColor: s.fg }} onClick={() => it.link && navigate(it.link)}>
                  <div className="rec-head">
                    <span className="rec-cat" style={{ color: s.fg }}>{it.category}</span>
                    <span className="rec-sev" style={{ background: s.bg, color: s.fg }}>{s.label}</span>
                  </div>
                  <div className="rec-title">{it.title}</div>
                  <div className="rec-msg">{it.message}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Section 3: Forecast */}
      <div className="dash-section">
        <div className="dash-section-title"><Icon name="trending-up" size={17} style={{ color: 'var(--navy-700, #1e3a5f)' }} />Spend Forecast</div>
        <div className="dash-section-sub">Linear-trend projection for {forecast ? fmtMonth(forecast.forecastMonth) : 'next month'} based on the trailing 12 months</div>
        {forecastLoading ? (
          <Skeleton h={300} />
        ) : !forecast || !forecastChart.length ? (
          <div className="chart-card"><ChartEmpty label="Not enough history to forecast" /></div>
        ) : (
          <div className="chart-card">
            <div className="fc-grid">
              <div>
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={forecastChart}>
                    <defs>
                      <linearGradient id="gradFc" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#0A1729" stopOpacity={0.22} />
                        <stop offset="95%" stopColor="#0A1729" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
                    <Tooltip content={<CustomTooltipLKR />} />
                    <Area type="monotone" dataKey="actual" name="Actual" stroke="#0A1729" strokeWidth={2} fill="url(#gradFc)" connectNulls />
                    <Line type="monotone" dataKey="forecast" name="Forecast" stroke="#E85D24" strokeWidth={2.5} strokeDasharray="6 4" dot={{ r: 4, fill: '#E85D24' }} connectNulls />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div>
                <div className="fc-stat" style={{ borderLeft: '3px solid #E85D24' }}>
                  <div className="fc-stat-label">Projected spend — {fmtMonth(forecast.forecastMonth)}</div>
                  <div className="fc-stat-val mono">{fmtLKR(forecast.combined.forecast)}</div>
                  {forecast.combined.band > 0 && (
                    <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>± {fmtLKR(forecast.combined.band)} confidence band</div>
                  )}
                </div>
                <div className="fc-stat">
                  <div className="fc-stat-label">3-month moving average</div>
                  <div className="fc-stat-val mono" style={{ fontSize: 18 }}>{fmtLKR(forecast.combined.movingAvg)}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
                    Trend
                    {forecast.combined.trend === 'up' && <Icon name="trending-up" size={13} style={{ color: 'var(--green-600)' }} />}
                    {forecast.combined.trend === 'down' && <Icon name="trending-down" size={13} style={{ color: 'var(--red-600)' }} />}
                    <b style={{ color: 'var(--ink)', textTransform: 'capitalize' }}>{forecast.combined.trend || '—'}</b>
                  </div>
                </div>
              </div>
            </div>

            {forecast.byAgency?.length > 0 && (
              <div style={{ marginTop: 18 }}>
                <div className="chart-card-sub" style={{ marginBottom: 8 }}>Per-agency forecast</div>
                <div className="tbl-wrap" style={{ margin: 0 }}>
                  <table className="tbl" style={{ fontSize: 13 }}>
                    <thead><tr><th>Agency</th><th>Projected next month</th><th>3-mo avg</th><th>Trend</th></tr></thead>
                    <tbody>
                      {forecast.byAgency.map(a => (
                        <tr key={a.agencyId}>
                          <td className="strong">{a.agencyName}</td>
                          <td className="mono">{fmtLKR(a.forecast)}{a.band > 0 && <span style={{ color: 'var(--muted)', fontSize: 11 }}> ± {fmtShort(a.band)}</span>}</td>
                          <td className="mono" style={{ color: 'var(--muted)' }}>{fmtLKR(a.movingAvg)}</td>
                          <td>
                            {a.trend === 'up' && <Icon name="trending-up" size={14} style={{ color: 'var(--green-600)' }} />}
                            {a.trend === 'down' && <Icon name="trending-down" size={14} style={{ color: 'var(--red-600)' }} />}
                            {a.trend === 'flat' && <span style={{ color: 'var(--muted)' }}>—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Section 4: Channel Value Scoring */}
      <div className="dash-section">
        <div className="dash-section-title"><Icon name="bar-chart" size={17} style={{ color: 'var(--purple-700)' }} />Channel Value Scores</div>
        <div className="dash-section-sub">Composite buying-value score (bonus 35%, reach 25%, consistency 20%, volume 20%)</div>
        {scoresLoading ? (
          <div className="chart-card"><div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} h={36} />)}</div></div>
        ) : !scores || !scores.channels.length ? (
          <div className="chart-card"><ChartEmpty label="No channels with activity this year" /></div>
        ) : (
          <div className="chart-card">
            <div className="tbl-wrap" style={{ margin: 0 }}>
              <table className="tbl" style={{ fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>#</th>
                    <th>Channel</th>
                    <th style={{ width: 56 }}>Grade</th>
                    <th style={{ width: 200 }}>Score</th>
                    <th>Avg Bonus</th>
                    <th>Clients</th>
                    <th>YTD Spend</th>
                    <th>Recommendation</th>
                  </tr>
                </thead>
                <tbody>
                  {scores.channels.map((c, i) => (
                    <tr key={c.channelMasterId} className="clickable" onClick={() => navigate(`/channel-masters/${c.channelMasterId}`)}>
                      <td style={{ color: 'var(--muted)', fontWeight: 700, fontSize: 12 }}>{i + 1}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span className="strong" style={{ fontSize: 12.5 }}>{c.channelName}</span>
                          <MediumBadge medium={c.medium} />
                        </div>
                        {c.mediaGroup && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{c.mediaGroup}</div>}
                      </td>
                      <td><span className="grade-pill" style={{ background: GRADE_COLORS[c.grade] }}>{c.grade}</span></td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div className="score-bar-track" style={{ flex: 1 }}>
                            <div className="score-bar-fill" style={{ width: `${c.score}%`, background: GRADE_COLORS[c.grade] }} />
                          </div>
                          <span className="mono" style={{ fontWeight: 700, fontSize: 12, minWidth: 24, textAlign: 'right' }}>{c.score}</span>
                        </div>
                      </td>
                      <td className="mono" style={{ fontSize: 12 }}>{c.avgBonusPct ? c.avgBonusPct.toFixed(1) + '%' : '-'}</td>
                      <td style={{ fontSize: 12 }}>{c.clientCount}</td>
                      <td className="mono" style={{ fontSize: 12 }}>{fmtLKR(c.ytdSpend)}</td>
                      <td style={{ fontSize: 11.5, color: 'var(--muted)', maxWidth: 240 }}>{c.recommendation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
