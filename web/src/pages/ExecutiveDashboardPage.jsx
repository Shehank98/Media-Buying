import { useState, useEffect, useCallback, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, BarChart, Bar,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, PieChart, Pie, Cell, ComposedChart, LabelList,
} from 'recharts';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import Icon from '../components/Icon';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { canExport } from '../lib/permissions';

const fmtLKR = (v) => {
  if (v == null || v === '') return '-';
  const n = Number(v); const a = Math.abs(n);
  if (a >= 1e9) return 'LKR ' + (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return 'LKR ' + (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return 'LKR ' + (n / 1e3).toFixed(1) + 'K';
  return 'LKR ' + Math.round(n).toLocaleString('en-US');
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

const MediumBadge = ({ medium }) => {
  const colors = {
    TV: ['#1e3a5f', '#dbeafe'],
    RADIO: ['#E85D24', '#fff5f0'],
    PRINT: ['#059669', '#ecfdf5'],
    DIGITAL: ['#6B3FB5', '#efe9fb'],
    CINEMA: ['#C2185B', '#fce7f0'],
    OOH: ['#0E7490', '#e0f4f8'],
  };
  const [fg, bg] = colors[medium] || ['#6b7280', '#f3f4f6'];
  return (
    <span style={{ background: bg, color: fg, borderRadius: 5, padding: '2px 8px', fontSize: 12, fontWeight: 700 }}>
      {medium}
    </span>
  );
};

const Skeleton = ({ w = '100%', h = 20 }) => (
  <div style={{ width: w, height: h, background: 'var(--bg-sunken)', borderRadius: 6, animation: 'pulse 1.5s ease-in-out infinite' }} />
);

const AGENCY_COLORS = ['#0A1729', '#E85D24', '#0891b2', '#7c3aed', '#065f46'];
const MEDIUM_COLORS = { TV: '#1e3a5f', RADIO: '#E85D24', PRINT: '#059669', DIGITAL: '#6B3FB5', CINEMA: '#C2185B', OOH: '#0E7490' };
// Shared per-team palette for the Group Contribution donuts + variance bars (cycles if more teams than colors).
const TEAM_COLORS = ['#1F5BB5', '#E85D24', '#15814B', '#7c3aed', '#C2185B', '#0891b2', '#9A5B00', '#6B3FB5', '#065f46', '#C5391F'];
// One colour per year for the Monthly Billing Trend (bar per year, Jan-Dec). Cycles if more years than colours.
const YEAR_COLORS = ['#B4C1D6', '#7E97BE', '#1F5BB5', '#15814B', '#E85D24', '#0A1729', '#7c3aed', '#C2185B'];
// Group Contribution head colours (blue #1F5BB5 is reserved for the Unassigned slice).
const GC_HEAD_COLORS = ['#E85D24', '#15814B', '#7c3aed', '#C2185B', '#0891b2', '#9A5B00', '#6B3FB5', '#065f46', '#C5391F', '#1e3a5f', '#EAB308', '#0E7490'];

const ChartEmpty = ({ msg }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--muted)', textAlign: 'center', padding: '0 20px' }}>
    <Icon name="bar-chart" size={36} style={{ opacity: 0.3, marginBottom: 8 }} />
    <div style={{ fontSize: 14 }}>{msg || 'No data for selected period'}</div>
  </div>
);

const CustomTooltipLKR = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, color: 'var(--muted)' }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ fontSize: 13, color: p.color || 'var(--ink)', marginBottom: 2 }}>
          <span style={{ marginRight: 6, fontWeight: 600 }}>{p.name}:</span>
          {fmtLKR(p.value)}
        </div>
      ))}
    </div>
  );
};

// Format a value already expressed in LKR millions for chart labels.
const fmtM = (v) => (v == null ? '-' : `${Math.round(Number(v)).toLocaleString('en-US')}M`);

// Total value at the right end of each Annual Achievement bar. A custom content
// renderer (not position="right") so it renders even when the outer stacked
// segment is zero-width (Budget/Target bars, or Actual with no forecast-fill),
// and an explicit hex fill so html2canvas captures it in the PPT export (CSS
// vars like var(--ink) don't always resolve during capture).
const AchievementTotalLabel = ({ x, y, width, height, value }) => {
  if (value == null || x == null) return null;
  return (
    <text x={x + width + 8} y={y + height / 2} dominantBaseline="central" textAnchor="start" fontSize={12} fontWeight={700} fill="#16243C">
      {fmtM(value)}
    </text>
  );
};

// Distinct color for the forecast-fill segment of the "Actual upto X" bar -
// deliberately not the green "actual" color or any other bar's color, so the
// blend is visually obvious.
const FORECAST_FILL_COLOR = '#F2A93B';

// Path for a rect with only its RIGHT corners rounded (horizontal bar).
const roundedRightRectPath = (x, y, w, h, r) => {
  const rr = Math.max(0, Math.min(r, h / 2, w));
  return `M${x},${y} h${w - rr} a${rr},${rr} 0 0 1 ${rr},${rr} v${h - 2 * rr} a${rr},${rr} 0 0 1 ${-rr},${rr} h${-(w - rr)} z`;
};

// Custom shapes for the Annual Achievement stacked bars so the OUTER (rightmost
// drawn) segment keeps rounded right corners: the actual segment rounds only
// when there's no forecast-fill on top of it; the forecast-fill segment always
// rounds (it's only ever the outermost). Fill comes from the datum (payload).
const ActualBarShape = (props) => {
  const { x, y, width, height, payload } = props;
  if (!(width > 0) || !(height > 0)) return null;
  const round = !(payload?.forecastPart > 0);
  const d = round
    ? roundedRightRectPath(x, y, width, height, 5)
    : `M${x},${y} h${width} v${height} h${-width} z`;
  return <path d={d} fill={payload?.fill} />;
};

const ForecastBarShape = (props) => {
  const { x, y, width, height } = props;
  if (!(width > 0) || !(height > 0)) return null;
  return <path d={roundedRightRectPath(x, y, width, height, 5)} fill={FORECAST_FILL_COLOR} />;
};

// Custom tooltip for the Annual Achievement bars: the blended "Actual upto X"
// row breaks down into its real-actual and forecast-fill components; the
// other rows (Budget Forecast, Upto Target) show a single value.
const AchievementTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, color: 'var(--muted)' }}>{label}</div>
      {row.isBlended ? (
        <>
          {row.actualRangeLabel && (
            <div style={{ fontSize: 13, marginBottom: 2 }}>
              <span style={{ marginRight: 6, fontWeight: 600, color: row.fill }}>Actual ({row.actualRangeLabel}):</span>
              {fmtM(row.actualPart)}
            </div>
          )}
          {row.forecastFillLabel && (
            <div style={{ fontSize: 13, marginBottom: 2 }}>
              <span style={{ marginRight: 6, fontWeight: 600, color: FORECAST_FILL_COLOR }}>Forecast-fill ({row.forecastFillLabel}):</span>
              {fmtM(row.forecastPart)}
              {!row.forecastFillComplete && <span style={{ color: '#C5391F', marginLeft: 6 }}>⚠ incomplete</span>}
            </div>
          )}
          <div style={{ fontSize: 13, fontWeight: 700, marginTop: 4, borderTop: '1px solid var(--border)', paddingTop: 4 }}>
            Total: {fmtM(row.total)}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 13 }}>{fmtM(row.actualPart)}</div>
      )}
    </div>
  );
};

// Annual Achievement (horizontal bars) + Monthly Spend with forecast (line).
function AchievementSection({
  year, setYear, achievement, forecastMonthly, groupContribution, groupContributionLoading, loading,
  monthlyAvgByYear, monthlyAvgByYearLoading, groupVariance, groupVarianceLoading,
  revenueAch, revenueAchLoading, channelCommit, channelCommitLoading,
  trendData, trendLoading, trendView, setTrendView,
}) {
  // Revenue Achievement: yellow Target vs green Achievement (admin billing), YTD.
  const raBars = revenueAch && revenueAch.hasBilling ? [
    { name: 'Target', value: revenueAch.uptoTargetMillions || 0, fill: '#F5B914' },
    { name: 'Achievement', value: revenueAch.achievementMillions || 0, fill: '#6FA84B' },
  ] : [];
  // Channel commitments: cumulative committed vs achieved (→ millions for display).
  const ccRows = (channelCommit?.channels || []).map(c => ({
    ...c,
    committedM: (c.committedToDate || 0) / 1e6,
    achievedM: (c.achieved || 0) / 1e6,
  }));
  const years = achievement?.availableYears || [];
  const selYears = (achievement?.year && !years.includes(achievement.year)) ? [achievement.year, ...years] : years;
  const bars = achievement ? [
    { name: 'Budget Forecast', actualPart: achievement.targetMillions || 0, forecastPart: 0, total: achievement.targetMillions || 0, fill: '#1F5BB5' },
    { name: `Upto ${achievement.uptoMonthLabel || '-'} Target`, actualPart: achievement.uptoTargetMillions || 0, forecastPart: 0, total: achievement.uptoTargetMillions || 0, fill: '#9A5B00' },
    {
      name: achievement.uptoMonthLabel ? `Actual upto ${achievement.uptoMonthLabel}` : 'Actual',
      actualPart: achievement.actualOnlyMillions ?? achievement.actualMillions ?? 0,
      forecastPart: achievement.forecastFillMillions || 0,
      fill: '#15814B',
      isBlended: true,
      actualRangeLabel: achievement.actualRangeLabel,
      forecastFillLabel: achievement.forecastFillLabel,
      forecastFillComplete: achievement.forecastFillComplete,
      total: achievement.actualMillions || 0,
    },
  ] : [];
  const hasForecastFill = !!(achievement?.forecastFillMillions > 0 && achievement?.forecastFillLabel);
  const fc = forecastMonthly?.data || [];
  // Group Contribution: left = Budget (schedule logs, month before latest data),
  // right = Revenue (admin-entered, latest month). Both by group head. Unassigned
  // is always blue; every other head keeps a stable colour across both donuts.
  const gcBudget = groupContribution?.budget || null;
  const gcRevenue = groupContribution?.revenue || null;
  const gcHeadNames = [...new Set([...(gcBudget?.groups || []), ...(gcRevenue?.groups || [])]
    .map(g => g.headName).filter(n => n && n !== 'Unassigned'))].sort();
  const gcColor = (name) => name === 'Unassigned'
    ? '#1F5BB5'
    : GC_HEAD_COLORS[gcHeadNames.indexOf(name) % GC_HEAD_COLORS.length];
  const gcDonut = (groups) => {
    const total = (groups || []).reduce((s, g) => s + (g.value || 0), 0);
    return (groups || [])
      .filter(g => (g.value || 0) > 0)
      .map(g => ({ name: g.headName, value: g.value, pct: total > 0 ? (g.value / total) * 100 : 0, fill: gcColor(g.headName) }));
  };
  const donutBudget = gcDonut(gcBudget?.groups);
  const donutRevenue = gcDonut(gcRevenue?.groups);

  // Business Units (agency-wise) donuts - the primary view. Budget = auto by
  // agency; Revenue = admin-entered per agency. Group-head donuts (above) move
  // into an expandable detail.
  const buBudget = groupContribution?.budgetByAgency || null;
  const buRevenue = groupContribution?.revenueByAgency || null;
  const buNames = [...new Set([...(buBudget?.groups || []), ...(buRevenue?.groups || [])].map(g => g.name).filter(Boolean))].sort();
  const buColor = (name) => GC_HEAD_COLORS[Math.max(0, buNames.indexOf(name)) % GC_HEAD_COLORS.length];
  const buDonut = (groups) => {
    const total = (groups || []).reduce((s, g) => s + (g.value || 0), 0);
    return (groups || [])
      .filter(g => (g.value || 0) > 0)
      .map(g => ({ name: g.name, value: g.value, pct: total > 0 ? (g.value / total) * 100 : 0, fill: buColor(g.name) }));
  };
  const donutBuBudget = buDonut(buBudget?.groups);
  const donutBuRevenue = buDonut(buRevenue?.groups);
  const [showGroupHeads, setShowGroupHeads] = useState(false);
  const [expandedCommit, setExpandedCommit] = useState(null); // channelMasterId whose yearly detail is open

  const mabyYears = monthlyAvgByYear?.years || [];
  // X-axis tick for Monthly Avg: year on top, and for a partial year (e.g. the
  // in-progress current year) the month range the average is taken over below it.
  const mabyTick = ({ x, y, payload }) => {
    const row = mabyYears.find(r => String(r.year) === String(payload.value));
    return (
      <g transform={`translate(${x},${y})`}>
        <text x={0} dy={13} textAnchor="middle" fontSize={12} fontWeight={700} fill="#16243C">{payload.value}</text>
        {row?.partial && row?.rangeLabel && (
          <text x={0} dy={27} textAnchor="middle" fontSize={10} fill="#6B7790">{row.rangeLabel} avg</text>
        )}
      </g>
    );
  };

  // Group Contribution vs Forecast: average of every actual month so far this year
  // per group head (blue) vs that head's next-month forecast (orange), with the
  // change % labelled above the shorter of the two bars. Named heads only.
  const gvGroups = (groupVariance?.groups || []).filter(g => g.headName);
  const gvActualLabel = groupVariance?.actualMonthsLabel ? `${groupVariance.actualMonthsLabel} Avg` : 'Actual Avg';
  const gvForecastLabel = groupVariance?.forecastMonthLabel ? `${groupVariance.forecastMonthLabel} Est` : 'Forecast';
  const gvData = gvGroups.map(g => ({ head: g.headName, avgActual: g.avgActual, forecast: g.forecast, diffPct: g.diffPct }));
  const diffLabel = (barKey) => (props) => {
    const { x, y, width, index } = props;
    const row = gvData[index];
    if (!row) return null;
    const shorter = row.avgActual <= row.forecast ? 'avgActual' : 'forecast';
    if (barKey !== shorter) return null;
    const up = row.diffPct >= 0;
    return (
      <text x={x + width / 2} y={y - 7} textAnchor="middle" fontSize={12} fontWeight={700} fill={up ? '#15814B' : '#C5391F'}>
        {row.diffPct}%
      </text>
    );
  };

  return (
    <div className="dash-section">
      <div className="chart-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div className="chart-card-title">Annual Achievement</div>
            <div className="chart-card-sub">
              {achievement?.hasTarget
                ? (hasForecastFill
                  ? `Budget vs pacing vs actual (incl. ${achievement.forecastFillLabel} forecast-fill) · LKR millions`
                  : `Budget vs pacing vs actual · LKR millions`)
                : 'No annual target set for this year. Add one in Admin → Annual Targets'}
            </div>
          </div>
          <select className="select" value={String(year || achievement?.year || '')} onChange={e => setYear(e.target.value)} style={{ maxWidth: 130 }}>
            {selYears.length === 0 && <option value="">-</option>}
            {selYears.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        {loading ? <Skeleton h={210} /> : bars.length === 0 ? <ChartEmpty /> : (
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={bars} layout="vertical" margin={{ top: 6, right: 96, bottom: 6, left: 8 }}>
              <CartesianGrid horizontal={false} stroke="var(--border)" />
              <XAxis type="number" tickFormatter={fmtM} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
              <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 12, fill: 'var(--ink)' }} />
              <Tooltip content={<AchievementTooltip />} />
              <Bar dataKey="actualPart" stackId="a" barSize={34} shape={<ActualBarShape />} />
              <Bar dataKey="forecastPart" stackId="a" barSize={34} shape={<ForecastBarShape />}>
                <LabelList dataKey="total" content={AchievementTotalLabel} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
        {hasForecastFill && (
          <div className="no-export" style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: FORECAST_FILL_COLOR }} />
            Forecast (est.): {achievement.forecastFillLabel}
            {!achievement.forecastFillComplete && (
              <span style={{ color: '#C5391F', fontWeight: 600 }}>
                ⚠ {achievement.forecastFillSubmittedClients}/{achievement.forecastFillExpectedClients} clients submitted
              </span>
            )}
          </div>
        )}
        {achievement?.achievementPct != null && (
          <div style={{ marginTop: 8, textAlign: 'right', fontSize: 13, fontWeight: 700, color: achievement.achievementPct >= 100 ? '#15814B' : '#C5391F' }}>
            {achievement.achievementPct >= 100 ? '▲' : '▼'} {achievement.achievementPct}% of {achievement.uptoMonthLabel} target achieved
          </div>
        )}
      </div>

      <div className="chart-card" style={{ marginTop: 16 }}>
        <div className="chart-card-title">Monthly Spend</div>
        <div className="chart-card-sub">
          Monthly spend (actuals + submitted forecasts) · LKR millions
        </div>
        {loading ? <div style={{ marginTop: 12 }}><Skeleton h={260} /></div> : fc.length === 0 ? <ChartEmpty /> : (
          <ResponsiveContainer width="100%" height={270}>
            <LineChart data={fc} margin={{ top: 26, right: 20, bottom: 6, left: 6 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
              <YAxis tickFormatter={fmtM} tick={{ fontSize: 11, fill: 'var(--muted)' }} width={48} />
              <Tooltip formatter={(v) => [fmtM(v), 'Spend']} contentStyle={{ borderRadius: 8, border: '1px solid var(--border)', fontSize: 12 }} />
              <Line
                type="monotone" dataKey="value" stroke="#1F5BB5" strokeWidth={2.5} connectNulls={false}
                dot={{ r: 3.5, fill: '#1F5BB5', stroke: '#fff', strokeWidth: 1.5 }} activeDot={{ r: 5 }}
              >
                <LabelList dataKey="value" position="top" formatter={(v) => (v == null ? '' : Math.round(v))} style={{ fontSize: 10.5, fill: 'var(--muted)' }} />
              </Line>
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="chart-card" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div className="chart-card-title">Monthly Billing Trend</div>
            <div className="chart-card-sub">{trendView === 'combined' ? 'One line per year · Jan to Dec invoice value' : 'Last 24 months · invoice value'}</div>
          </div>
          <div className="toggle-group">
            <button className={`toggle-btn${trendView === 'combined' ? ' active' : ''}`} onClick={() => setTrendView('combined')}>Combined</button>
            <button className={`toggle-btn${trendView === 'byAgency' ? ' active' : ''}`} onClick={() => setTrendView('byAgency')}>By Agency</button>
          </div>
        </div>
        {trendLoading ? <Skeleton h={280} /> : !trendData ? <ChartEmpty /> : (
          trendView === 'combined' ? (
            (() => {
              // Pivot every month of billing into one line series per year, plotted
              // against a fixed Jan-Dec X axis so years compare side by side.
              const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
              const rows = MONTH_LABELS.map((label, i) => ({ monthNum: i + 1, label }));
              const years = [];
              (trendData.combined || []).forEach(d => {
                const [y, m] = String(d.month).split('-').map(Number);
                if (!y || !m || m < 1 || m > 12) return;
                if (!years.includes(y)) years.push(y);
                rows[m - 1][y] = (rows[m - 1][y] || 0) + (d.scheduleValue || 0);
              });
              years.sort((a, b) => a - b);
              if (!years.length) return <ChartEmpty />;
              // "This year" = the current calendar year if present, else the latest
              // year in the data. Its dots get value labels (also shown in the PPT).
              const thisYear = years.includes(new Date().getFullYear()) ? new Date().getFullYear() : years[years.length - 1];
              return (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={rows} margin={{ top: 22, right: 20, bottom: 6, left: 6 }}>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
                    <Tooltip content={<CustomTooltipLKR />} />
                    <Legend />
                    {years.map((y, i) => (
                      <Line key={y} type="monotone" dataKey={String(y)} name={String(y)} stroke={YEAR_COLORS[i % YEAR_COLORS.length]} strokeWidth={2.5} connectNulls dot={{ r: 3, strokeWidth: 1 }} activeDot={{ r: 5 }}>
                        {y === thisYear && (
                          <LabelList dataKey={String(y)} position="top" offset={10}
                            formatter={(v) => (v == null || v === 0 ? '' : fmtShort(v))}
                            style={{ fontSize: 10, fontWeight: 700, fill: '#16243C' }} />
                        )}
                      </Line>
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              );
            })()
          ) : (
            (() => {
              const agencyLines = trendData.byAgency || [];
              const monthSet = new Set();
              agencyLines.forEach(ag => (ag.data || []).forEach(d => monthSet.add(d.month)));
              const months = Array.from(monthSet).sort().slice(-24);
              const chartData = months.map(m => {
                const row = { month: fmtMonth(m) };
                agencyLines.forEach(ag => {
                  const d = (ag.data || []).find(x => x.month === m);
                  row[ag.agencyName] = d ? d.scheduleValue : 0;
                });
                return row;
              });
              if (!chartData.length) return <ChartEmpty />;
              return (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={chartData}>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
                    <Tooltip content={<CustomTooltipLKR />} />
                    <Legend />
                    {agencyLines.map((ag, i) => (
                      <Line key={ag.agencyId} type="monotone" dataKey={ag.agencyName} stroke={AGENCY_COLORS[i % AGENCY_COLORS.length]} strokeWidth={2} dot={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              );
            })()
          )
        )}
      </div>

      <div className="chart-card" style={{ marginTop: 16 }}>
        <div className="chart-card-title">Business Units Contribution</div>
        <div className="chart-card-sub">
          {buBudget && buRevenue
            ? `${buBudget.label} budget vs ${buRevenue.label} revenue share by agency`
            : 'Budget vs revenue share by agency'}
        </div>
        {groupContributionLoading ? <div style={{ marginTop: 12 }}><Skeleton h={260} /></div> : (!buBudget && !buRevenue) ? <ChartEmpty /> : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            {[
              { title: `${buBudget?.label || ''} Budget Contribution`.trim(), donut: donutBuBudget, empty: 'No schedule data for the budget month' },
              { title: `${buRevenue?.label || ''} Revenue Contribution`.trim(), donut: donutBuRevenue, empty: `No revenue entered${buRevenue ? ` for ${buRevenue.label}` : ''}. Add it in Admin, Group Revenue.` },
            ].map((d, idx) => (
              <div key={idx} style={{ flex: '1 1 260px', minWidth: 240 }}>
                <div style={{ textAlign: 'center', fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>
                  {d.title}
                </div>
                {d.donut.length === 0 ? (
                  <div style={{ padding: '54px 14px', textAlign: 'center', color: 'var(--muted)', fontSize: 12.5, lineHeight: 1.4 }}>{d.empty}</div>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie
                        data={d.donut} dataKey="value" nameKey="name" cx="50%" cy="50%"
                        innerRadius={55} outerRadius={90} paddingAngle={1.5}
                        label={({ pct }) => `${pct.toFixed(0)}%`}
                        labelLine={false}
                      >
                        {d.donut.map((g, i) => <Cell key={i} fill={g.fill} />)}
                      </Pie>
                      <Tooltip formatter={(v, n, p) => [`${fmtM(v)} (${p.payload.pct.toFixed(1)}%)`, n]} contentStyle={{ borderRadius: 8, border: '1px solid var(--border)', fontSize: 12 }} />
                      <Legend
                        wrapperStyle={{ fontSize: 11 }} layout="vertical" align="right" verticalAlign="middle"
                        formatter={(value, entry) => `${value}${entry?.payload?.pct != null ? '  ' + entry.payload.pct.toFixed(0) + '%' : ''}`}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Expandable detail: the same budget vs revenue split by group head. */}
        {(gcBudget || gcRevenue) && (
          <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
            <button
              type="button"
              onClick={() => setShowGroupHeads(v => !v)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, color: 'var(--coral-700, #C44A18)', padding: 2 }}
            >
              <Icon name={showGroupHeads ? 'chevDown' : 'chevR'} size={14} />
              {showGroupHeads ? 'Hide group-head breakdown' : 'Group Contribution (by group head)'}
            </button>
            {showGroupHeads && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 12 }}>
                {[
                  { title: `${gcBudget?.label || ''} Budget Contribution`.trim(), donut: donutBudget, empty: 'No schedule data for the budget month' },
                  { title: `${gcRevenue?.label || ''} Revenue Contribution`.trim(), donut: donutRevenue, empty: `No revenue entered${gcRevenue ? ` for ${gcRevenue.label}` : ''}. Add it in Admin, Group Revenue.` },
                ].map((d, idx) => (
                  <div key={idx} style={{ flex: '1 1 260px', minWidth: 240 }}>
                    <div style={{ textAlign: 'center', fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>{d.title}</div>
                    {d.donut.length === 0 ? (
                      <div style={{ padding: '54px 14px', textAlign: 'center', color: 'var(--muted)', fontSize: 12.5, lineHeight: 1.4 }}>{d.empty}</div>
                    ) : (
                      <ResponsiveContainer width="100%" height={260}>
                        <PieChart>
                          <Pie
                            data={d.donut} dataKey="value" nameKey="name" cx="50%" cy="50%"
                            innerRadius={55} outerRadius={90} paddingAngle={1.5}
                            label={({ pct }) => `${pct.toFixed(0)}%`} labelLine={false}
                          >
                            {d.donut.map((g, i) => <Cell key={i} fill={g.fill} />)}
                          </Pie>
                          <Tooltip formatter={(v, n, p) => [`${fmtM(v)} (${p.payload.pct.toFixed(1)}%)`, n]} contentStyle={{ borderRadius: 8, border: '1px solid var(--border)', fontSize: 12 }} />
                          <Legend wrapperStyle={{ fontSize: 11 }} layout="vertical" align="right" verticalAlign="middle"
                            formatter={(value, entry) => `${value}${entry?.payload?.pct != null ? '  ' + entry.payload.pct.toFixed(0) + '%' : ''}`} />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="chart-card" style={{ marginTop: 16 }}>
        <div className="chart-card-title">Monthly Avg</div>
        <div className="chart-card-sub">Average monthly spend per calendar year, all clients · LKR millions. A partial year is averaged over its months with data (shown under the bar), not 12</div>
        {monthlyAvgByYearLoading ? <div style={{ marginTop: 12 }}><Skeleton h={240} /></div> : mabyYears.length === 0 ? <ChartEmpty /> : (
          <ResponsiveContainer width="100%" height={256}>
            <BarChart data={mabyYears} margin={{ top: 26, right: 20, bottom: 6, left: 6 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="year" tick={mabyTick} interval={0} height={40} />
              <YAxis tickFormatter={fmtM} tick={{ fontSize: 11, fill: 'var(--muted)' }} width={48} />
              <Tooltip formatter={(v, n, p) => [fmtM(v), p?.payload?.rangeLabel ? `${p.payload.rangeLabel} avg` : 'Avg']} contentStyle={{ borderRadius: 8, border: '1px solid var(--border)', fontSize: 12 }} />
              <Bar dataKey="avgMillions" radius={[5, 5, 0, 0]} barSize={42}>
                {mabyYears.map((_, i) => <Cell key={i} fill={TEAM_COLORS[i % TEAM_COLORS.length]} />)}
                <LabelList dataKey="avgMillions" position="top" formatter={fmtM} style={{ fontSize: 12, fontWeight: 700, fill: 'var(--ink)' }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="chart-card" style={{ marginTop: 16 }}>
        <div className="chart-card-title">Group Contribution vs Forecast</div>
        <div className="chart-card-sub">
          {groupVariance?.actualMonthsLabel && groupVariance?.forecastMonthLabel
            ? `Average of ${groupVariance.actualMonthsLabel} actual vs ${groupVariance.forecastMonthLabel} forecast, by group head · LKR millions`
            : 'Average actual vs next month forecast, by group head · LKR millions'}
        </div>
        {groupVarianceLoading ? <div style={{ marginTop: 12 }}><Skeleton h={280} /></div> : gvData.length === 0 ? <ChartEmpty /> : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={gvData} margin={{ top: 30, right: 20, bottom: 6, left: 6 }} barGap={4}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="head" tick={{ fontSize: 12, fill: 'var(--ink)' }} interval={0} />
              <YAxis tickFormatter={fmtM} tick={{ fontSize: 11, fill: 'var(--muted)' }} width={48} />
              <Tooltip formatter={(v, n) => [fmtM(v), n]} contentStyle={{ borderRadius: 8, border: '1px solid var(--border)', fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="avgActual" name={gvActualLabel} fill="#1F5BB5" radius={[4, 4, 0, 0]} maxBarSize={46}>
                <LabelList dataKey="diffPct" content={diffLabel('avgActual')} />
              </Bar>
              <Bar dataKey="forecast" name={gvForecastLabel} fill="#E8843A" radius={[4, 4, 0, 0]} maxBarSize={46}>
                <LabelList dataKey="diffPct" content={diffLabel('forecast')} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Revenue Achievement - admin billing YTD vs prorated annual target */}
      <div className="chart-card" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div className="chart-card-title">
              {revenueAch?.hasBilling && revenueAch.achievementPct != null
                ? `${revenueAch.achievementPct}% Revenue Achievement · ${revenueAch.year} ${revenueAch.monthLabel} YTD`
                : 'Revenue Achievement'}
            </div>
            <div className="chart-card-sub">Revenue based on actual billing · LKR millions</div>
          </div>
        </div>
        {revenueAchLoading ? <Skeleton h={240} /> : !revenueAch?.hasTarget ? (
          <ChartEmpty msg="No annual target set for this year. Add one in Admin → Annual Targets." />
        ) : !revenueAch?.hasBilling ? (
          <ChartEmpty msg="No actual billing entered yet. Add it in Admin → Group Revenue (Actual billing)." />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={raBars} margin={{ top: 28, right: 20, bottom: 6, left: 6 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E8ED" />
              <XAxis dataKey="name" tick={{ fontSize: 13, fill: '#3B4A63' }} />
              <YAxis tick={{ fontSize: 11, fill: '#6B7790' }} tickFormatter={v => `${v}`} />
              <Tooltip formatter={(v) => [`LKR ${Number(v).toFixed(1)}M`, '']} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={120}>
                {raBars.map((b, i) => <Cell key={i} fill={b.fill} />)}
                <LabelList dataKey="value" position="top" formatter={(v) => `${Number(v).toFixed(1)}M`} style={{ fontSize: 12, fontWeight: 700, fill: '#16243C' }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Channel Commitments - cumulative committed vs achieved per channel */}
      <div className="chart-card" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div className="chart-card-title">Channel Commitments</div>
            <div className="chart-card-sub">
              {channelCommit?.monthLabel
                ? `Committed vs achieved, Jan–${channelCommit.monthLabel} ${channelCommit.year} · yearly commitment ÷ 12 × months`
                : 'Yearly commitment per channel vs cumulative schedule spend'}
            </div>
          </div>
        </div>
        {channelCommitLoading ? <Skeleton h={200} /> : ccRows.length === 0 ? (
          <ChartEmpty msg="No channel commitments set for this year. Add them in Admin → Channel Commitments." />
        ) : (
          <div className="tbl-wrap" style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Channel</th>
                  <th style={{ textAlign: 'right' }}>Committed ({channelCommit.monthLabel})</th>
                  <th style={{ textAlign: 'right' }}>Achieved</th>
                  <th style={{ textAlign: 'right' }}>Behind / Ahead</th>
                  <th style={{ minWidth: 200 }}>Progress</th>
                </tr>
              </thead>
              <tbody>
                {ccRows.map(c => {
                  const pct = c.achievementPct;
                  const col = pct == null ? '#6B7790' : pct >= 100 ? '#15814B' : pct >= 85 ? '#9A5B00' : '#C5391F';
                  const gap = (c.committedToDate || 0) - (c.achieved || 0);
                  const behind = gap > 0.5;
                  const ahead = gap < -0.5;
                  const isOpen = expandedCommit === c.channelMasterId;
                  // Yearly picture
                  const yearly = c.yearlyCommitment || 0;
                  const remainYear = yearly - (c.achieved || 0);
                  const yearPct = yearly > 0 ? Number((((c.achieved || 0) / yearly) * 100).toFixed(1)) : null;
                  return (
                    <Fragment key={c.channelMasterId}>
                    <tr>
                      <td className="strong">
                        <button onClick={() => setExpandedCommit(isOpen ? null : c.channelMasterId)} title={isOpen ? 'Hide yearly detail' : 'Show yearly detail'}
                          style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, marginRight: 8, color: 'var(--ink-soft,#3B4A63)', verticalAlign: 'middle' }}>
                          <Icon name={isOpen ? 'chevDown' : 'chevR'} size={14} />
                        </button>
                        {c.name} <span className="medium-tag" style={{ marginLeft: 4 }}>{c.medium}</span>
                      </td>
                      <td style={{ textAlign: 'right' }} className="mono">{fmtLKR(c.committedToDate)}</td>
                      <td style={{ textAlign: 'right' }} className="mono">{fmtLKR(c.achieved)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 700, fontSize: 12.5, color: behind ? '#C5391F' : ahead ? '#15814B' : '#6B7790' }}>
                          {behind ? '▼' : ahead ? '▲' : '●'}
                          <span className="mono">{behind || ahead ? fmtLKR(Math.abs(gap)) : 'On target'}</span>
                          {(behind || ahead) && <span style={{ fontWeight: 600, color: 'var(--muted)' }}>{behind ? 'behind' : 'ahead'}</span>}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ flex: 1, background: '#EEF0F3', borderRadius: 5, height: 8, overflow: 'hidden' }}>
                            <div style={{ width: `${Math.min(100, pct || 0)}%`, height: '100%', background: col, borderRadius: 5 }} />
                          </div>
                          <span className="mono" style={{ width: 46, textAlign: 'right', fontWeight: 700, color: col }}>{pct == null ? '-' : `${pct}%`}</span>
                        </div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={5} style={{ background: '#F7F8FA', padding: '12px 16px 14px 38px' }}>
                          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#93A0B5', marginBottom: 10 }}>Full-year commitment</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 22, alignItems: 'flex-end' }}>
                            <div>
                              <div style={{ fontSize: 11, color: 'var(--muted)' }}>Yearly target</div>
                              <div className="mono" style={{ fontSize: 17, fontWeight: 750, color: '#16243C' }}>{fmtLKR(yearly)}</div>
                            </div>
                            <div>
                              <div style={{ fontSize: 11, color: 'var(--muted)' }}>Monthly commitment</div>
                              <div className="mono" style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink-soft,#3B4A63)' }}>{fmtLKR(c.monthlyCommitment)}</div>
                            </div>
                            <div>
                              <div style={{ fontSize: 11, color: 'var(--muted)' }}>Achieved (YTD)</div>
                              <div className="mono" style={{ fontSize: 15, fontWeight: 700, color: '#16243C' }}>{fmtLKR(c.achieved)}{yearPct != null && <span style={{ fontSize: 11.5, color: 'var(--muted)', marginLeft: 5 }}>({yearPct}% of year)</span>}</div>
                            </div>
                            <div>
                              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{remainYear > 0 ? 'Behind yearly target' : 'Yearly target met, over by'}</div>
                              <div className="mono" style={{ fontSize: 17, fontWeight: 750, color: remainYear > 0 ? '#C5391F' : '#15814B' }}>{fmtLKR(Math.abs(remainYear))}</div>
                            </div>
                          </div>
                          {/* Yearly progress bar */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, maxWidth: 520 }}>
                            <div style={{ flex: 1, background: '#EEF0F3', borderRadius: 5, height: 9, overflow: 'hidden' }}>
                              <div style={{ width: `${Math.min(100, yearPct || 0)}%`, height: '100%', background: (yearPct || 0) >= 100 ? '#15814B' : '#1F5BB5', borderRadius: 5 }} />
                            </div>
                            <span className="mono" style={{ width: 46, textAlign: 'right', fontWeight: 700, color: (yearPct || 0) >= 100 ? '#15814B' : '#1F5BB5' }}>{yearPct == null ? '-' : `${yearPct}%`}</span>
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
                {channelCommit?.totals && (() => {
                  const tGap = (channelCommit.totals.committedToDate || 0) - (channelCommit.totals.achieved || 0);
                  const tBehind = tGap > 0.5, tAhead = tGap < -0.5;
                  const tPct = channelCommit.totals.achievementPct;
                  const tCol = tPct == null ? '#6B7790' : tPct >= 100 ? '#15814B' : tPct >= 85 ? '#9A5B00' : '#C5391F';
                  return (
                  <tr style={{ borderTop: '2px solid var(--border)' }}>
                    <td className="strong">Total</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }} className="mono">{fmtLKR(channelCommit.totals.committedToDate)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }} className="mono">{fmtLKR(channelCommit.totals.achieved)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 700, fontSize: 12.5, color: tBehind ? '#C5391F' : tAhead ? '#15814B' : '#6B7790' }}>
                        {tBehind ? '▼' : tAhead ? '▲' : '●'}
                        <span className="mono">{tBehind || tAhead ? fmtLKR(Math.abs(tGap)) : 'On target'}</span>
                        {(tBehind || tAhead) && <span style={{ fontWeight: 600, color: 'var(--muted)' }}>{tBehind ? 'behind' : 'ahead'}</span>}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ flex: 1, background: '#EEF0F3', borderRadius: 5, height: 8, overflow: 'hidden' }}>
                          <div style={{ width: `${Math.min(100, tPct || 0)}%`, height: '100%', background: tCol, borderRadius: 5 }} />
                        </div>
                        <span className="mono" style={{ width: 46, textAlign: 'right', fontWeight: 700, color: tCol }}>{tPct == null ? '-' : `${tPct}%`}</span>
                      </div>
                    </td>
                  </tr>
                  );
                })()}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ExecutiveDashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [agencyId, setAgencyId] = useState('');
  const [agencies, setAgencies] = useState([]);

  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  const [trendData, setTrendData] = useState(null);
  const [trendLoading, setTrendLoading] = useState(true);
  const [trendView, setTrendView] = useState('combined'); // 'combined' | 'byAgency'

  const [topClients, setTopClients] = useState([]);
  const [topClientsLoading, setTopClientsLoading] = useState(true);

  const [topChannels, setTopChannels] = useState([]);
  const [topChannelsLoading, setTopChannelsLoading] = useState(true);

  const [agencyComparison, setAgencyComparison] = useState([]);
  const [agencyCompLoading, setAgencyCompLoading] = useState(true);
  const [agencyCompValueType, setAgencyCompValueType] = useState('scheduleValue');

  const [mediumSplit, setMediumSplit] = useState(null);
  const [mediumLoading, setMediumLoading] = useState(true);

  // Forecasting: annual achievement + monthly spend-with-forecast
  const [year, setYear] = useState('');
  const [achievement, setAchievement] = useState(null);
  const [achLoading, setAchLoading] = useState(true);
  const [forecastMonthly, setForecastMonthly] = useState(null);
  const [groupContribution, setGroupContribution] = useState(null);
  const [groupContributionLoading, setGroupContributionLoading] = useState(true);
  const [monthlyAvgByYear, setMonthlyAvgByYear] = useState(null);
  const [monthlyAvgByYearLoading, setMonthlyAvgByYearLoading] = useState(true);
  const [groupVariance, setGroupVariance] = useState(null);
  const [groupVarianceLoading, setGroupVarianceLoading] = useState(true);
  const [revenueAch, setRevenueAch] = useState(null);
  const [revenueAchLoading, setRevenueAchLoading] = useState(true);
  const [channelCommit, setChannelCommit] = useState(null);
  const [channelCommitLoading, setChannelCommitLoading] = useState(true);

  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  // Fetch agencies list for filter
  useEffect(() => {
    if (!isSuperAdmin) return;
    api.get('/admin/agencies').then(r => {
      setAgencies(r.data.agencies || r.data || []);
    }).catch(() => {});
  }, [isSuperAdmin]);

  const buildAgencyParam = useCallback(() => {
    const params = {};
    if (agencyId) params.agencyId = agencyId;
    return params;
  }, [agencyId]);

  // Summary
  useEffect(() => {
    setSummaryLoading(true);
    api.get('/analytics/dashboard/summary', { params: buildAgencyParam() })
      .then(r => setSummary(r.data))
      .catch(() => setSummary(null))
      .finally(() => setSummaryLoading(false));
  }, [agencyId, buildAgencyParam]);

  // Trend
  useEffect(() => {
    setTrendLoading(true);
    api.get('/analytics/dashboard/monthly-trend')
      .then(r => setTrendData(r.data))
      .catch(() => setTrendData(null))
      .finally(() => setTrendLoading(false));
  }, []);

  // Top clients
  useEffect(() => {
    setTopClientsLoading(true);
    api.get('/analytics/dashboard/top-clients')
      .then(r => setTopClients(r.data || []))
      .catch(() => setTopClients([]))
      .finally(() => setTopClientsLoading(false));
  }, []);

  // Top channels
  useEffect(() => {
    setTopChannelsLoading(true);
    api.get('/analytics/dashboard/top-channels')
      .then(r => setTopChannels(r.data || []))
      .catch(() => setTopChannels([]))
      .finally(() => setTopChannelsLoading(false));
  }, []);

  // Agency comparison (follows the year selector; default = current year Jan to latest month)
  useEffect(() => {
    setAgencyCompLoading(true);
    api.get('/analytics/dashboard/agency-comparison', { params: year ? { year } : {} })
      .then(r => setAgencyComparison(r.data || []))
      .catch(() => setAgencyComparison([]))
      .finally(() => setAgencyCompLoading(false));
  }, [year]);

  // Annual achievement + monthly spend (with forecast for the remote month)
  useEffect(() => {
    setAchLoading(true);
    const params = year ? { year } : {};
    Promise.allSettled([
      api.get('/analytics/dashboard/achievement', { params }),
      api.get('/analytics/dashboard/forecast-monthly', { params }),
    ]).then(([a, f]) => {
      if (a.status === 'fulfilled') setAchievement(a.value.data); else setAchievement(null);
      if (f.status === 'fulfilled') setForecastMonthly(f.value.data); else setForecastMonthly(null);
    }).finally(() => setAchLoading(false));
  }, [year]);

  // Revenue Achievement (admin-entered actual billing YTD vs prorated annual target)
  useEffect(() => {
    setRevenueAchLoading(true);
    api.get('/analytics/dashboard/revenue-achievement', { params: year ? { year } : {} })
      .then(r => setRevenueAch(r.data))
      .catch(() => setRevenueAch(null))
      .finally(() => setRevenueAchLoading(false));
  }, [year]);

  // Channel commitments (yearly commitment per channel vs cumulative schedule spend)
  useEffect(() => {
    setChannelCommitLoading(true);
    api.get('/analytics/dashboard/channel-commitments', { params: year ? { year } : {} })
      .then(r => setChannelCommit(r.data))
      .catch(() => setChannelCommit(null))
      .finally(() => setChannelCommitLoading(false));
  }, [year]);

  // Group contribution (last two months with data, by team head's client portfolio)
  useEffect(() => {
    setGroupContributionLoading(true);
    api.get('/analytics/dashboard/group-contribution')
      .then(r => setGroupContribution(r.data))
      .catch(() => setGroupContribution(null))
      .finally(() => setGroupContributionLoading(false));
  }, []);

  // Monthly average spend per calendar year (company-wide)
  useEffect(() => {
    setMonthlyAvgByYearLoading(true);
    api.get('/analytics/dashboard/monthly-avg-by-year')
      .then(r => setMonthlyAvgByYear(r.data))
      .catch(() => setMonthlyAvgByYear(null))
      .finally(() => setMonthlyAvgByYearLoading(false));
  }, []);

  // Group Contribution vs Forecast (avg actual months so far vs next-month forecast, per group head).
  // Scoped server-side to the user's agencies, like the Group Contribution donut.
  useEffect(() => {
    setGroupVarianceLoading(true);
    api.get('/analytics/dashboard/group-contribution-variance')
      .then(r => setGroupVariance(r.data))
      .catch(() => setGroupVariance(null))
      .finally(() => setGroupVarianceLoading(false));
  }, []);

  // Medium split (agency + year scoped; current-year-to-date vs same period last year)
  useEffect(() => {
    setMediumLoading(true);
    api.get('/analytics/dashboard/medium-split', { params: { ...buildAgencyParam(), ...(year ? { year } : {}) } })
      .then(r => setMediumSplit(r.data))
      .catch(() => setMediumSplit(null))
      .finally(() => setMediumLoading(false));
  }, [agencyId, buildAgencyParam, year]);


  // Build agency comparison chart data
  const agencyCompChartData = (() => {
    if (!agencyComparison.length) return [];
    const monthSet = new Set();
    agencyComparison.forEach(a => (a.monthly || []).forEach(m => monthSet.add(m.month)));
    const months = Array.from(monthSet).sort().slice(-12);
    return months.map(month => {
      const row = { month: fmtMonth(month) };
      agencyComparison.forEach((ag, i) => {
        const m = (ag.monthly || []).find(x => x.month === month);
        row[ag.agencyName] = m ? m[agencyCompValueType] : 0;
      });
      return row;
    });
  })();

  const yoyColor = (pct) => {
    if (pct == null) return 'var(--muted)';
    return pct >= 0 ? 'var(--green-600)' : 'var(--red-600)';
  };

  const trendIcon = (dir) => {
    if (dir === 'up') return <Icon name="trending-up" size={14} style={{ color: 'var(--green-600)' }} />;
    if (dir === 'down') return <Icon name="trending-down" size={14} style={{ color: 'var(--red-600)' }} />;
    return null;
  };

  // Delta/trend chip per design tokens
  const Chip = ({ dir = 'flat', children }) => {
    const palette = {
      up: { color: '#15814B', bg: '#ECF8F1' },
      down: { color: '#C5391F', bg: '#FBE0DA' },
      flat: { color: '#6B7790', bg: '#EEF0F3' },
    };
    const p = palette[dir] || palette.flat;
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', fontSize: 11.5, fontWeight: 700,
        padding: '3px 8px', borderRadius: 7, color: p.color, background: p.bg,
        fontFamily: "'Spline Sans Mono', monospace",
      }}>
        {children}
      </span>
    );
  };

  // Latest month that actually has data (cards reflect this, not the calendar month).
  const refLabel = summary?.referenceMonth ? fmtMonth(summary.referenceMonth) : 'latest month';

  // Build KPI list from real summary data (only metrics with data)
  const kpis = summary ? [
    {
      key: 'billingsThisMonth', icon: 'dollar', label: `Billings · ${refLabel}`,
      value: fmtLKR(summary.billingsThisMonth),
      chip: summary.yoyGrowthPct != null
        ? { dir: summary.yoyGrowthPct >= 0 ? 'up' : 'down', text: (summary.yoyGrowthPct >= 0 ? '+' : '') + summary.yoyGrowthPct.toFixed(1) + '%' }
        : { dir: 'flat', text: 'YoY' },
    },
    { key: 'billingsYTD', icon: 'trending-up', label: 'Total Billings (all years)', value: fmtLKR(summary.billingsYTD) },
    summary.yoyGrowthPct != null && {
      key: 'yoy', icon: 'bar-chart', label: `YoY Growth (${summary.referenceMonth ? summary.referenceMonth.slice(0, 4) : ''})`,
      value: (summary.yoyGrowthPct >= 0 ? '+' : '') + summary.yoyGrowthPct.toFixed(1) + '%',
      valueColor: summary.yoyGrowthPct >= 0 ? '#15814B' : '#C5391F',
      chip: { dir: summary.yoyGrowthPct >= 0 ? 'up' : 'down', text: summary.yoyGrowthPct >= 0 ? 'up' : 'down' },
    },
    summary.activeClients != null && { key: 'activeClients', icon: 'users', label: 'Active Clients', value: String(summary.activeClients) },
    summary.logsThisMonth != null && { key: 'logsThisMonth', icon: 'calendar', label: `Logs · ${refLabel}`, value: String(summary.logsThisMonth) },
    summary.activeChannelsThisMonth != null && { key: 'activeChannels', icon: 'tv', label: `Active Channels · ${refLabel}`, value: String(summary.activeChannelsThisMonth) },
    summary.uploadsThisMonth != null && { key: 'uploads', icon: 'upload', label: 'Uploads this month', value: String(summary.uploadsThisMonth) },
    summary.manualEntriesThisMonth != null && { key: 'manual', icon: 'edit', label: `Manual entries · ${refLabel}`, value: String(summary.manualEntriesThisMonth) },
  ].filter(Boolean) : [];

  const [exporting, setExporting] = useState(false);
  const [exportingSlides, setExportingSlides] = useState(false);

  // Export every chart on the dashboard to a PowerPoint: a cover slide, one
  // chart image per slide, and a closing thank-you slide.
  const exportChartSlides = async () => {
    setExportingSlides(true);
    try {
      const [{ default: PptxGenJS }, { default: html2canvas }] = await Promise.all([
        import('pptxgenjs'),
        import('html2canvas'),
      ]);
      const cards = Array.from(document.querySelectorAll('.dash-section .chart-card'))
        .filter(el => el.querySelector('svg, canvas'));
      const pptx = new PptxGenJS();
      pptx.defineLayout({ name: 'ORBIT', width: 13.333, height: 7.5 });
      pptx.layout = 'ORBIT';
      const NAVY = '0A1729', CORAL = 'D9521C', MUTED = '9FB0CE', BG = 'F5F6F8';
      const dateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
      const agencyName = agencyId ? (agencies.find(a => String(a.id) === String(agencyId))?.name || 'Selected agency') : 'All agencies';

      // Cover slide
      const cover = pptx.addSlide();
      cover.background = { color: NAVY };
      cover.addText('OGILVY ORBIT', { x: 0.7, y: 2.2, w: 12, h: 0.4, fontSize: 13, color: MUTED, bold: true, charSpacing: 6 });
      cover.addText('Media Buying Dashboard', { x: 0.66, y: 2.7, w: 12, h: 1.1, fontSize: 44, color: 'FFFFFF', bold: true });
      cover.addShape(pptx.ShapeType.rect, { x: 0.72, y: 3.95, w: 0.6, h: 0.05, fill: { color: CORAL } });
      cover.addText(`${agencyName}   ·   ${dateStr}`, { x: 0.7, y: 4.15, w: 12, h: 0.4, fontSize: 14, color: MUTED });

      // Hide export-only-noise (forecast-fill legend/warning, Medium Split LKR
      // amounts) while capturing chart images; restored in `finally`.
      document.body.classList.add('exporting-pptx');
      // One slide per chart
      for (const card of cards) {
        const canvas = await html2canvas(card, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
        const data = canvas.toDataURL('image/png');
        const slide = pptx.addSlide();
        slide.background = { color: BG };
        const titleEl = card.querySelector('.chart-card-title');
        const title = titleEl ? titleEl.textContent.trim() : '';
        if (title) {
          slide.addShape(pptx.ShapeType.rect, { x: 0.5, y: 0.5, w: 0.42, h: 0.05, fill: { color: CORAL } });
          slide.addText(title, { x: 0.5, y: 0.62, w: 12.3, h: 0.55, fontSize: 22, color: '16243C', bold: true });
        }
        // Fit the chart image within the slide, preserving aspect ratio.
        const topY = title ? 1.35 : 0.5;
        const maxW = 12.33, maxH = 7.5 - topY - 0.4;
        const aspect = canvas.width / canvas.height;
        let w = maxW, h = maxW / aspect;
        if (h > maxH) { h = maxH; w = maxH * aspect; }
        slide.addImage({ data, x: (13.333 - w) / 2, y: topY + (maxH - h) / 2, w, h });
      }

      // Thank-you slide
      const ty = pptx.addSlide();
      ty.background = { color: NAVY };
      ty.addText('Thank you', { x: 0.5, y: 3.0, w: 12.33, h: 1.2, fontSize: 46, color: 'FFFFFF', bold: true, align: 'center' });
      ty.addShape(pptx.ShapeType.rect, { x: 6.16, y: 4.25, w: 1.0, h: 0.05, fill: { color: CORAL } });
      ty.addText('Ogilvy Orbit', { x: 0.5, y: 4.5, w: 12.33, h: 0.4, fontSize: 14, color: MUTED, align: 'center' });

      await pptx.writeFile({ fileName: `Executive_Dashboard_${new Date().toISOString().slice(0, 10)}.pptx` });
    } catch (err) {
      console.error('Slide export failed:', err);
      alert('Could not export the slides. Please try again.');
    } finally {
      document.body.classList.remove('exporting-pptx');
      setExportingSlides(false);
    }
  };

  const exportSummaryPdf = () => {
    setExporting(true);
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      const margin = 40;
      const agencyName = agencyId ? (agencies.find((a) => String(a.id) === String(agencyId))?.name || 'Selected agency') : 'All agencies';

      // Branded header band
      doc.setFillColor(10, 23, 41);
      doc.rect(0, 0, pageW, 70, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(17);
      doc.text('Ogilvy Orbit - Executive Summary', margin, 32);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
      doc.setTextColor(200, 210, 224);
      doc.text(`${agencyName}  ·  Generated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`, margin, 50);

      let y = 96;

      // KPI section
      if (kpis.length) {
        doc.setTextColor(22, 36, 60); doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
        doc.text('Key Metrics', margin, y); y += 8;
        autoTable(doc, {
          startY: y,
          head: [['Metric', 'Value']],
          body: kpis.map((k) => [k.label, String(k.value)]),
          styles: { fontSize: 9, cellPadding: 5 },
          headStyles: { fillColor: [22, 36, 60] },
          columnStyles: { 1: { halign: 'right', font: 'courier' } },
          margin: { left: margin, right: margin },
        });
        y = doc.lastAutoTable.finalY + 22;
      }

      // Top clients
      if (topClients.length) {
        doc.setTextColor(22, 36, 60); doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
        doc.text('Top Clients (YTD Billing)', margin, y); y += 8;
        autoTable(doc, {
          startY: y,
          head: [['#', 'Client', 'Agency', 'YTD Billing', 'MoM']],
          body: topClients.slice(0, 10).map((c) => [
            c.rank, c.clientName, c.agencyName || '-', fmtLKR(c.ytdBilling),
            c.momTrend != null ? (c.momTrend >= 0 ? '+' : '') + c.momTrend.toFixed(1) + '%' : '-',
          ]),
          styles: { fontSize: 9, cellPadding: 5 },
          headStyles: { fillColor: [22, 36, 60] },
          columnStyles: { 0: { cellWidth: 26 }, 3: { halign: 'right' }, 4: { halign: 'right' } },
          margin: { left: margin, right: margin },
        });
        y = doc.lastAutoTable.finalY + 22;
      }

      // Top channels
      if (topChannels.length) {
        if (y > doc.internal.pageSize.getHeight() - 140) { doc.addPage(); y = 50; }
        doc.setTextColor(22, 36, 60); doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
        doc.text('Top Channels (YTD Spend)', margin, y); y += 8;
        autoTable(doc, {
          startY: y,
          head: [['#', 'Channel', 'Medium', 'Clients', 'YTD Spend', 'YoY']],
          body: topChannels.slice(0, 10).map((c) => [
            c.rank, c.channelName, c.medium || '-', c.clientCount ?? '-', fmtLKR(c.ytdSpend),
            c.yoyChange != null ? (c.yoyChange >= 0 ? '+' : '') + c.yoyChange.toFixed(1) + '%' : '-',
          ]),
          styles: { fontSize: 9, cellPadding: 5 },
          headStyles: { fillColor: [22, 36, 60] },
          columnStyles: { 0: { cellWidth: 26 }, 4: { halign: 'right' }, 5: { halign: 'right' } },
          margin: { left: margin, right: margin },
        });
        y = doc.lastAutoTable.finalY + 22;
      }

      // Agency comparison
      if (agencyComparison.length) {
        if (y > doc.internal.pageSize.getHeight() - 140) { doc.addPage(); y = 50; }
        doc.setTextColor(22, 36, 60); doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
        doc.text('Agency Comparison', margin, y); y += 8;
        autoTable(doc, {
          startY: y,
          head: [['Agency', 'YTD Billings', 'Active Clients', 'Active Channels']],
          body: agencyComparison.map((ag) => [
            ag.agencyName, fmtLKR(ag.ytdBillings), ag.activeClients ?? '-', ag.activeChannels ?? '-',
          ]),
          styles: { fontSize: 9, cellPadding: 5 },
          headStyles: { fillColor: [22, 36, 60] },
          columnStyles: { 1: { halign: 'right' } },
          margin: { left: margin, right: margin },
        });
        y = doc.lastAutoTable.finalY + 22;
      }

      // Medium split (YTD)
      const ytdMedium = mediumSplit?.ytd || [];
      if (ytdMedium.length) {
        if (y > doc.internal.pageSize.getHeight() - 120) { doc.addPage(); y = 50; }
        doc.setTextColor(22, 36, 60); doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
        doc.text('Medium Split (Year to Date)', margin, y); y += 8;
        autoTable(doc, {
          startY: y,
          head: [['Medium', 'Value', 'Share']],
          body: ytdMedium.map((m) => [m.medium, fmtLKR(m.value), m.pct != null ? m.pct.toFixed(1) + '%' : '-']),
          styles: { fontSize: 9, cellPadding: 5 },
          headStyles: { fillColor: [22, 36, 60] },
          columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
          margin: { left: margin, right: margin },
        });
      }

      // Footer page numbers
      const pages = doc.internal.getNumberOfPages();
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(150, 160, 176);
        doc.text(`Page ${i} of ${pages}`, pageW - margin, doc.internal.pageSize.getHeight() - 20, { align: 'right' });
      }

      doc.save(`executive-summary-${new Date().toISOString().slice(0, 10)}.pdf`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fade-in" style={{ maxWidth: 1320, margin: '0 auto' }}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        /* Hidden only while capturing chart images for the PPT export. */
        .exporting-pptx .no-export, .exporting-pptx .export-hide { display: none !important; }
        .dash-section { margin-bottom: 36px; }
        .dash-section-title { font-size: 15px; font-weight: 720; color: var(--ink); margin-bottom: 14px; letter-spacing: -0.3px; }
        .ed-card { background: #fff; border: 1px solid #E5E8ED; border-radius: 14px; box-shadow: 0 1px 2px rgba(15,31,61,.06); }
        .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 20px; }
        .kpi-card { position: relative; overflow: hidden; background: #fff; border: 1px solid #E5E8ED; border-radius: 13px; box-shadow: 0 1px 2px rgba(15,31,61,.06); padding: 16px 18px; transition: transform .16s ease, box-shadow .16s ease; }
        .kpi-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg,#E85D24,rgba(232,93,36,.1) 70%,transparent); }
        .kpi-card:hover { transform: translateY(-3px); box-shadow: 0 10px 26px rgba(15,31,61,.10); }
        .kpi-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
        .kpi-val { font-size: 23px; font-weight: 700; letter-spacing: -.6px; font-family: 'Spline Sans Mono', monospace; color: #16243C; }
        .kpi-label { font-size: 12px; color: #6B7790; margin-top: 5px; }
        .two-col-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 18px; }
        .chart-card { background: #fff; border: 1px solid #E5E8ED; border-radius: 14px; box-shadow: 0 1px 2px rgba(15,31,61,.06); padding: 20px; }
        .chart-card-title { font-size: 14px; font-weight: 700; color: #16243C; margin-bottom: 4px; }
        .chart-card-sub { font-size: 12px; color: #6B7790; margin-bottom: 16px; }
        .ed-secondary-btn { border: 1px solid #D5DAE2; background: #fff; color: #3B4A63; border-radius: 10px; padding: 9px 14px; font-size: 13px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 7px; }
        .toggle-group { display: flex; gap: 6px; }
        .toggle-btn { padding: 5px 12px; border-radius: 6px; border: 1px solid var(--border); background: transparent; font-size: 12.5px; font-weight: 600; color: var(--muted); cursor: pointer; }
        .toggle-btn.active { background: var(--navy-900); color: #fff; border-color: var(--navy-900); }
        .agency-comp-summary { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin-top: 16px; }
        .agency-sum-card { background: var(--bg-sunken); border-radius: 10px; padding: 14px; }
        .agency-sum-name { font-size: 13px; font-weight: 700; color: var(--ink); margin-bottom: 8px; }
        .agency-sum-row { display: flex; justify-content: space-between; font-size: 12px; color: var(--muted); margin-bottom: 3px; }
        .activity-table-wrap { max-height: 400px; overflow-y: auto; }
        .pagination { display: flex; align-items: center; gap: 10px; margin-top: 12px; justify-content: flex-end; }
        .placeholder-card { background: var(--bg-sunken); border: 2px dashed var(--border-strong); border-radius: 12px; padding: 40px; text-align: center; }
        .league-row td { padding: 12px 22px; border-bottom: 1px solid #EEF0F3; }
        .league-row:hover { background: #F7F8FA; }

        /* Navy hero */
        .ed-hero { position: relative; overflow: hidden; border-radius: 18px; margin-bottom: 22px; background: linear-gradient(135deg, #0A1729 0%, #122842 55%, #0F1F3D 100%); padding: 26px 28px; color: #fff; }
        .ed-hero::before { content: ''; position: absolute; top: -60px; right: -60px; width: 240px; height: 240px; background: radial-gradient(circle, rgba(232,93,36,.30), transparent 70%); border-radius: 50%; }
        .ed-hero::after { content: ''; position: absolute; bottom: -90px; left: 22%; width: 220px; height: 220px; background: radial-gradient(circle, rgba(31,91,181,.22), transparent 70%); border-radius: 50%; }
        .ed-hero-inner { position: relative; z-index: 1; }
        .ed-hero-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
        .ed-hero-title { font-size: 25px; font-weight: 750; letter-spacing: -.6px; margin: 0; }
        .ed-hero-sub { font-size: 13.5px; color: rgba(255,255,255,.55); margin: 6px 0 0; }
        .ed-hero-actions { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; }
        .ed-hero-field { display: flex; flex-direction: column; gap: 5px; min-width: 170px; }
        .ed-hero-field label { font-size: 10.5px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; color: rgba(255,255,255,.45); }
        .ed-hero-select { background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.16); color: #fff; border-radius: 9px; padding: 9px 12px; font-size: 13px; font-weight: 500; outline: none; cursor: pointer; }
        .ed-hero-select option { color: #16243C; }
        .ed-hero-btn { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 650; border-radius: 9px; padding: 9px 14px; cursor: pointer; border: 1px solid rgba(255,255,255,.18); background: rgba(255,255,255,.08); color: #fff; transition: background .15s; }
        .ed-hero-btn:hover:not(:disabled) { background: rgba(255,255,255,.18); }
        .ed-hero-btn:disabled { opacity: .5; cursor: not-allowed; }
        .ed-hero-btn.accent { background: #E85D24; border-color: #E85D24; }
        .ed-hero-btn.accent:hover { background: #D9521C; }
        .ed-hero-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-top: 22px; }
        .ed-hero-stat { background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.10); border-radius: 12px; padding: 13px 15px; }
        .ed-hero-stat-label { font-size: 11px; color: rgba(255,255,255,.55); font-weight: 600; }
        .ed-hero-stat-val { font-size: 20px; font-weight: 750; letter-spacing: -.4px; font-family: 'Spline Sans Mono', monospace; margin-top: 6px; }

        /* Ranked visual bars */
        .rank-row { display: flex; align-items: center; gap: 12px; padding: 9px 8px; border-radius: 9px; cursor: pointer; transition: background .12s; }
        .rank-row:hover { background: #F5F6F8; }
        .rank-num { width: 22px; height: 22px; flex-shrink: 0; border-radius: 6px; display: grid; place-items: center; font-size: 11px; font-weight: 700; font-family: 'Spline Sans Mono', monospace; }
        .rank-main { flex: 1; min-width: 0; }
        .rank-name-row { display: flex; align-items: center; gap: 6px; margin-bottom: 5px; }
        .rank-name { font-size: 12.5px; font-weight: 650; color: #16243C; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .rank-meta { font-size: 11px; color: #93A0B5; flex-shrink: 0; }
        .rank-bar-track { height: 8px; border-radius: 5px; background: #EEF0F3; overflow: hidden; }
        .rank-bar-fill { height: 100%; border-radius: 5px; transition: width .4s ease; }
        .rank-side { flex-shrink: 0; text-align: right; min-width: 124px; }
        .rank-val { font-size: 12.5px; font-weight: 700; font-family: 'Spline Sans Mono', monospace; color: #16243C; display: flex; align-items: center; gap: 6px; justify-content: flex-end; }
        .rank-sub { font-size: 11.5px; font-weight: 600; font-family: 'Spline Sans Mono', monospace; color: #6B7790; display: flex; align-items: center; gap: 6px; justify-content: flex-end; margin-top: 2px; }
        .rank-tag { font-size: 8.5px; font-weight: 700; letter-spacing: .5px; color: #93A0B5; background: #EEF0F3; border-radius: 4px; padding: 1px 4px; }
        .rank-delta { font-size: 11px; font-weight: 700; display: flex; align-items: center; gap: 3px; justify-content: flex-end; margin-top: 3px; }

        /* Upload detail rows */
        .ed-upload-row { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; padding: 12px 0; border-bottom: 1px solid #EEF0F3; }
        .ed-upload-row:last-child { border-bottom: none; }
        .ed-status-pill { font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 6px; text-transform: capitalize; }
        @media (max-width: 1100px) { .kpi-grid { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); } .ed-hero-stats { grid-template-columns: repeat(2, 1fr); } }
      `}</style>

      {/* Navy hero header */}
      <div className="ed-hero">
        <div className="ed-hero-inner">
          <div className="ed-hero-top">
            <div>
              <h1 className="ed-hero-title">Executive Dashboard</h1>
              <p className="ed-hero-sub">
                Billings overview across {agencyId ? (agencies.find(a => String(a.id) === String(agencyId))?.name || 'selected agency') : 'all agencies'}{summary?.referenceMonth ? ` · latest data: ${fmtMonth(summary.referenceMonth)}` : ''}
              </p>
            </div>
            <div className="ed-hero-actions">
              {isSuperAdmin && (
                <div className="ed-hero-field">
                  <label>Agency</label>
                  <select className="ed-hero-select" value={agencyId} onChange={e => setAgencyId(e.target.value)}>
                    <option value="">All agencies</option>
                    {agencies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              )}
              {canExport(user) && (
                <button className="ed-hero-btn" onClick={exportSummaryPdf} disabled={exporting || summaryLoading}>
                  <Icon name="download" size={15} />
                  {exporting ? 'Exporting…' : 'Export summary'}
                </button>
              )}
              {canExport(user) && (
                <button className="ed-hero-btn" onClick={exportChartSlides} disabled={exportingSlides || summaryLoading} title="Export every chart to a PowerPoint, one chart per slide">
                  <Icon name="bar-chart" size={15} />
                  {exportingSlides ? 'Building slides…' : 'Export to PPT'}
                </button>
              )}
              <button className="ed-hero-btn accent" onClick={() => navigate('/deep-dashboard')}>
                <Icon name="bar-chart" size={15} />
                Deep Dashboard
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Section 1: Annual Achievement + Monthly Spend (forecast) */}
      <AchievementSection
        year={year} setYear={setYear} achievement={achievement} forecastMonthly={forecastMonthly} loading={achLoading}
        groupContribution={groupContribution} groupContributionLoading={groupContributionLoading}
        monthlyAvgByYear={monthlyAvgByYear} monthlyAvgByYearLoading={monthlyAvgByYearLoading}
        groupVariance={groupVariance} groupVarianceLoading={groupVarianceLoading}
        revenueAch={revenueAch} revenueAchLoading={revenueAchLoading}
        channelCommit={channelCommit} channelCommitLoading={channelCommitLoading}
        trendData={trendData} trendLoading={trendLoading} trendView={trendView} setTrendView={setTrendView}
      />

      {/* Section 4: Agency Comparison */}
      <div className="dash-section">
        <div className="chart-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div>
              <div className="chart-card-title">Agency Comparison</div>
              <div className="chart-card-sub">Monthly billings per agency · {year ? year : `${new Date().getFullYear()} (Jan to latest month)`}</div>
            </div>
            <div className="toggle-group">
              <button className="toggle-btn active">Schedule Value</button>
            </div>
          </div>
          {agencyCompLoading ? <Skeleton h={260} /> : !agencyCompChartData.length ? <ChartEmpty /> : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={agencyCompChartData} barCategoryGap="25%">
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
                <Tooltip content={<CustomTooltipLKR />} />
                <Legend />
                {agencyComparison.map((ag, i) => (
                  <Bar key={ag.agencyId} dataKey={ag.agencyName} fill={AGENCY_COLORS[i % AGENCY_COLORS.length]} radius={[3, 3, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
          {!agencyCompLoading && agencyComparison.length > 0 && (
            <div className="agency-comp-summary">
              {agencyComparison.map((ag, i) => (
                <div key={ag.agencyId} className="agency-sum-card" style={{ borderLeft: `3px solid ${AGENCY_COLORS[i % AGENCY_COLORS.length]}` }}>
                  <div className="agency-sum-name">{ag.agencyName}</div>
                  <div className="agency-sum-row"><span>YTD Billings</span><span className="mono" style={{ fontWeight: 700 }}>{fmtLKR(ag.ytdBillings)}</span></div>
                  <div className="agency-sum-row"><span>Active clients</span><span>{ag.activeClients}</span></div>
                  <div className="agency-sum-row"><span>Active channels</span><span>{ag.activeChannels}</span></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Section 5: Medium Split */}
      <div className="dash-section">
        <div className="chart-card">
          <div className="chart-card-title" style={{ marginBottom: 16 }}>Medium Split</div>
          {mediumLoading ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              <Skeleton h={240} />
              <Skeleton h={240} />
            </div>
          ) : !mediumSplit ? <ChartEmpty /> : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              {[
                {
                  key: 'cm',
                  // This Month: title carries the month name; per-medium change is vs last month (MoM).
                  title: mediumSplit.currentMonthLabel || 'This Month',
                  sub: mediumSplit.prevMonthLabel ? `vs ${mediumSplit.prevMonthLabel} (MoM)` : 'This month',
                  data: mediumSplit.currentMonth || [],
                  compare: mediumSplit.previousMonth || [],
                  changeTag: 'MoM',
                },
                {
                  key: 'ytd',
                  // Year to Date: YoY compares current-year Jan-to-latest vs last year same period.
                  title: 'Year to Date',
                  sub: (mediumSplit.ytdLabel && mediumSplit.lastYearLabel)
                    ? `${mediumSplit.ytdLabel} vs ${mediumSplit.lastYearLabel} (YoY)`
                    : 'Year to date',
                  data: mediumSplit.ytd || [],
                  compare: mediumSplit.lastYearYtd || [],
                  changeTag: 'YoY',
                },
              ].map(({ key, title, sub, data, compare, changeTag }) => (
                <div key={key}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginBottom: 2, textAlign: 'center' }}>{title}</div>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--muted)', marginBottom: 12, textAlign: 'center' }}>{sub}</div>
                  {!data.length ? <ChartEmpty /> : (
                    <>
                      <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                          <Pie data={data} dataKey="value" nameKey="medium" cx="50%" cy="50%" outerRadius={80} innerRadius={45} paddingAngle={3}>
                            {data.map((entry, i) => (
                              <Cell key={i} fill={MEDIUM_COLORS[entry.medium] || AGENCY_COLORS[i]} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v, name) => [fmtLKR(v), name]} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                        {data.map((entry, i) => {
                          const prevVal = (compare || []).find(m => m.medium === entry.medium)?.value || 0;
                          const chg = prevVal > 0 ? ((entry.value - prevVal) / prevVal) * 100 : null;
                          return (
                            <div key={entry.medium} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                              <span style={{ width: 10, height: 10, borderRadius: 3, background: MEDIUM_COLORS[entry.medium] || AGENCY_COLORS[i], flexShrink: 0 }} />
                              <span style={{ flex: 1, fontWeight: 600 }}>{entry.medium}</span>
                              {chg != null && (
                                <span style={{ fontSize: 11, fontWeight: 700, color: chg >= 0 ? 'var(--green-600)' : 'var(--red-600)', minWidth: 56, textAlign: 'right' }}>
                                  {(chg >= 0 ? '+' : '') + chg.toFixed(0) + '% ' + changeTag}
                                </span>
                              )}
                              {/* LKR amount hidden on the PPT export image (percentages only). */}
                              <span className="mono export-hide">{fmtLKR(entry.value)}</span>
                              <span style={{ color: 'var(--muted)', minWidth: 42, textAlign: 'right', fontWeight: 700 }}>{entry.pct != null ? entry.pct.toFixed(1) + '%' : ''}</span>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
