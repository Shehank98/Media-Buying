import prisma from '../utils/prisma.js';

// ═══════════════════════════════════════════════════════════════════════════
// Commitment Planner  (Deep Dashboard)
//
// Recommends the "90%-safe" yearly spend commitment for a media group / channel
// / overall scope: the amount you'll clear ~90% of the time, so a missed-discount
// penalty is very unlikely. Phase-1 method — pure statistics over ScheduleLog, no
// external ML service:
//   1. Build the monthly spend series per scope from ScheduleLog (2022→now).
//   2. Take each PAST full year's total; derive year-over-year growth rates.
//   3. Monte-Carlo simulate next year's total by bootstrapping those growth
//      rates (+ smoothing noise) → a distribution of possible annual spend.
//   4. Commitment = P10 of that distribution (10th percentile → beaten ~90%).
//      P50 = expected, P90 = stretch/upside.
//   5. Seasonal profile (share of a year's spend per month) → a monthly "safe
//      path" and a live probability of clearing the commitment given YTD.
//   6. Walk-forward backtest: for each past year, what P10 WOULD have been
//      (using only prior data) vs what actually happened — proves the 90% holds.
//
// Every number the dashboard shows is derived here so the UI can explain it.
// ═══════════════════════════════════════════════════════════════════════════

const N_MAIN = 4000;
const N_CHILD = 1200;
const num = (v) => (v == null ? 0 : Number(v));
const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  return next === undefined ? sorted[base] : sorted[base] + rest * (next - sorted[base]);
}

// Standard normal via Box–Muller (for smoothing the tiny growth-rate sample).
function gaussian() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Forecast the annual total `gap` years after the last full year, from the array
// of past full-year totals. Returns the P10/P50/P90 of a Monte-Carlo distribution.
function forecastAnnual(fullTotals, gap = 1, n = N_MAIN) {
  if (!fullTotals.length) return null;
  const base = fullTotals[fullTotals.length - 1];
  if (fullTotals.length === 1) {
    // No growth history — use a symmetric ±15% band around the single year.
    return { p10: round2(base * 0.85), p50: round2(base), p90: round2(base * 1.15), method: 'single-year', growth: [] };
  }
  const growth = [];
  for (let i = 1; i < fullTotals.length; i++) {
    if (fullTotals[i - 1] > 0) growth.push(fullTotals[i] / fullTotals[i - 1] - 1);
  }
  if (!growth.length) return { p10: round2(base * 0.85), p50: round2(base), p90: round2(base * 1.15), method: 'flat', growth: [] };
  const gMean = growth.reduce((a, b) => a + b, 0) / growth.length;
  const gStd = Math.sqrt(growth.reduce((a, b) => a + (b - gMean) ** 2, 0) / growth.length) || 0.05;
  const noise = Math.max(gStd, 0.03); // floor the noise so a lucky-stable past doesn't over-promise
  const sims = [];
  for (let s = 0; s < n; s++) {
    let v = base;
    for (let k = 0; k < gap; k++) {
      const g = growth[Math.floor(Math.random() * growth.length)] + gaussian() * noise;
      v *= (1 + g);
    }
    sims.push(Math.max(0, v));
  }
  sims.sort((a, b) => a - b);
  return {
    p10: round2(quantile(sims, 0.10)),
    p50: round2(quantile(sims, 0.50)),
    p90: round2(quantile(sims, 0.90)),
    method: 'bootstrap-growth',
    growth: growth.map((g) => round2(g * 100)),
    sims,
  };
}

// Build { year: {1..12: total} } from grouped (scheduleMonth → sum) rows.
function toByYearMonth(rows) {
  const byYm = {};
  for (const r of rows) {
    const sm = String(r.scheduleMonth || '');
    const m = sm.match(/^(\d{4})-(\d{2})$/);
    if (!m) continue;
    const y = parseInt(m[1]), mo = parseInt(m[2]);
    if (y < 2000 || mo < 1 || mo > 12) continue;
    (byYm[y] ||= {})[mo] = (byYm[y][mo] || 0) + num(r._sum?.scheduleValue);
  }
  return byYm;
}
const yearTotal = (byYm, y) => Object.values(byYm[y] || {}).reduce((a, b) => a + b, 0);

// Full analysis for one scope's monthly rows.
function analyzeScope(rows, targetYear, currentYear, currentMonth) {
  const byYm = toByYearMonth(rows);
  const allYears = Object.keys(byYm).map(Number).sort((a, b) => a - b);
  const fullYears = allYears.filter((y) => y < currentYear); // years before this one are complete
  const fullTotals = fullYears.map((y) => yearTotal(byYm, y));

  // Seasonal share (avg share of the year each month carries), from full years.
  const shareSum = Array(13).fill(0); let shareCount = 0;
  for (const y of fullYears) {
    const t = yearTotal(byYm, y);
    if (t > 0) { shareCount++; for (let m = 1; m <= 12; m++) shareSum[m] += (byYm[y]?.[m] || 0) / t; }
  }
  let seasonal = Array(12).fill(1 / 12);
  if (shareCount > 0) {
    seasonal = [];
    for (let m = 1; m <= 12; m++) seasonal.push(shareSum[m] / shareCount);
    const s = seasonal.reduce((a, b) => a + b, 0) || 1;
    seasonal = seasonal.map((x) => x / s);
  }

  const lastFull = fullYears.length ? fullYears[fullYears.length - 1] : null;
  const gap = lastFull ? Math.max(1, targetYear - lastFull) : 1;

  let forecast = null;
  if (fullYears.length) {
    forecast = forecastAnnual(fullTotals, gap, N_MAIN);
  } else if (byYm[currentYear] && currentMonth > 0) {
    // No full years, only this year in progress → annualize YTD.
    const ytd = yearTotal(byYm, currentYear);
    const elapsedShare = seasonal.slice(0, currentMonth).reduce((a, b) => a + b, 0) || (currentMonth / 12);
    const annual = elapsedShare > 0 ? ytd / elapsedShare : ytd;
    forecast = { p10: round2(annual * 0.8), p50: round2(annual), p90: round2(annual * 1.2), method: 'annualized-ytd', growth: [] };
  }

  const hasData = !!forecast;
  const commitment = forecast ? forecast.p10 : 0;

  // Current-year actuals + monthly safe path. "monthsElapsed" = the last month
  // that actually HAS data in the target year (data usually lags the calendar),
  // capped at the current calendar month — so pacing isn't dragged down by a
  // not-yet-uploaded month.
  let lastDataMonth = 0;
  if (byYm[targetYear]) for (let m = 1; m <= 12; m++) if (byYm[targetYear][m] != null) lastDataMonth = m;
  let monthsElapsed = 0;
  if (targetYear < currentYear) monthsElapsed = 12;
  else if (targetYear === currentYear) monthsElapsed = Math.min(lastDataMonth, currentMonth);
  const curMonthly = [];
  let cum = 0, safeCum = 0;
  const monthlyPath = [];
  for (let m = 1; m <= 12; m++) {
    const actual = byYm[targetYear]?.[m];
    const isElapsed = m <= monthsElapsed;
    if (isElapsed) cum += (actual || 0);
    safeCum += commitment * seasonal[m - 1];
    monthlyPath.push({
      month: m,
      safeCumulative: round2(safeCum),
      actualCumulative: isElapsed ? round2(cum) : null,
      seasonalPct: round2(seasonal[m - 1] * 100),
    });
    curMonthly.push(round2(actual || 0));
  }
  const ytd = round2(cum);

  // Probability of clearing the commitment.
  let probabilityHit = null;
  if (forecast) {
    if (monthsElapsed >= 1 && monthsElapsed < 12) {
      const remainingShare = seasonal.slice(monthsElapsed).reduce((a, b) => a + b, 0);
      const sigma = Math.max((forecast.p90 - forecast.p10) / 2.563, forecast.p50 * 0.05); // p10..p90 ≈ ±1.2816σ
      let hit = 0;
      for (let s = 0; s < N_MAIN; s++) {
        const remaining = Math.max(0, forecast.p50 * remainingShare + gaussian() * sigma * remainingShare);
        if (ytd + remaining >= commitment) hit++;
      }
      probabilityHit = round2(hit / N_MAIN);
    } else if (monthsElapsed >= 12) {
      probabilityHit = ytd >= commitment ? 1 : 0;
    } else if (forecast.sims) {
      probabilityHit = round2(forecast.sims.filter((v) => v >= commitment).length / forecast.sims.length);
    } else {
      probabilityHit = 0.9;
    }
  }

  // Walk-forward backtest: for each full year with ≥2 priors, what P10 would have been.
  const backtest = [];
  for (let i = 2; i < fullYears.length; i++) {
    const prior = fullTotals.slice(0, i);
    const f = forecastAnnual(prior, 1, 1500);
    if (!f) continue;
    const actual = fullTotals[i];
    backtest.push({ year: fullYears[i], commitment: f.p10, actual: round2(actual), cleared: actual >= f.p10 });
  }

  // Volatility (band width relative to the mid) as a simple risk read.
  const volatilityPct = forecast && forecast.p50 > 0 ? round2(((forecast.p90 - forecast.p10) / forecast.p50) * 100) : 0;

  return {
    hasData,
    history: fullYears.map((y) => ({ year: y, total: round2(yearTotal(byYm, y)) })),
    seasonal: seasonal.map((x) => round2(x * 100)),
    forecast: forecast ? { p10: forecast.p10, p50: forecast.p50, p90: forecast.p90, method: forecast.method, growth: forecast.growth } : null,
    commitment,
    monthlyPath,
    currentYear: { year: currentYear, ytd, monthsElapsed, monthly: curMonthly },
    probabilityHit,
    backtest,
    volatilityPct,
    historyYears: fullYears.length,
    lastFullYear: lastFull,
  };
}

// GET /api/analytics/commitment-planner?level=overall|media-group|channel&entity=&agencyId=&year=
export async function getCommitmentPlanner(req, res) {
  try {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const level = ['overall', 'media-group', 'channel'].includes(req.query.level) ? req.query.level : 'overall';
    const agencyId = req.query.agencyId ? parseInt(req.query.agencyId) : null;
    const entity = req.query.entity != null ? String(req.query.entity) : '';
    const targetYear = /^\d{4}$/.test(String(req.query.year)) ? parseInt(req.query.year) : currentYear;

    // Scope where-clause.
    const where = { isDeleted: false };
    if (agencyId) where.agencyId = agencyId;
    let entityName = 'All media (company-wide)';
    if (level === 'media-group') {
      if (!entity) return res.status(400).json({ error: 'entity (media group name) is required' });
      where.mediaGroup = entity;
      entityName = entity;
    } else if (level === 'channel') {
      const cmId = parseInt(entity);
      if (!cmId) return res.status(400).json({ error: 'entity (channelMasterId) is required' });
      where.channelMasterId = cmId;
      const cm = await prisma.channelMaster.findUnique({ where: { id: cmId }, select: { name: true } });
      entityName = cm?.name || `Channel #${cmId}`;
    }

    const rows = await prisma.scheduleLog.groupBy({ by: ['scheduleMonth'], where, _sum: { scheduleValue: true } });
    const main = analyzeScope(rows, targetYear, currentYear, currentMonth);

    // Client concentration (top single client's share of this scope, all-time).
    let topClient = null;
    const clientAgg = await prisma.scheduleLog.groupBy({ by: ['clientId'], where, _sum: { scheduleValue: true } });
    if (clientAgg.length) {
      const total = clientAgg.reduce((a, r) => a + num(r._sum.scheduleValue), 0);
      const top = clientAgg.reduce((a, r) => (num(r._sum.scheduleValue) > num(a._sum.scheduleValue) ? r : a));
      const c = await prisma.client.findUnique({ where: { id: top.clientId }, select: { name: true } });
      if (total > 0) topClient = { name: c?.name || 'Unknown', sharePct: round2((num(top._sum.scheduleValue) / total) * 100) };
    }

    // Children (sub-entities) — each with its own P10/P50 so commitments roll up.
    let children = [];
    let childLevelLabel = '';
    if (level === 'overall') {
      childLevelLabel = 'Media group';
      const crows = await prisma.scheduleLog.groupBy({ by: ['mediaGroup', 'scheduleMonth'], where, _sum: { scheduleValue: true } });
      children = childForecasts(crows, 'mediaGroup', targetYear, currentYear, (k) => k || 'Ungrouped');
    } else if (level === 'media-group') {
      childLevelLabel = 'Channel';
      const crows = await prisma.scheduleLog.groupBy({ by: ['channelMasterId', 'scheduleMonth'], where, _sum: { scheduleValue: true } });
      const ids = [...new Set(crows.map((r) => r.channelMasterId))];
      const cms = await prisma.channelMaster.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
      const nameById = new Map(cms.map((c) => [c.id, c.name]));
      children = childForecasts(crows, 'channelMasterId', targetYear, currentYear, (k) => nameById.get(k) || `#${k}`);
    } else {
      childLevelLabel = 'Client';
      const crows = await prisma.scheduleLog.groupBy({ by: ['clientId', 'scheduleMonth'], where, _sum: { scheduleValue: true } });
      const ids = [...new Set(crows.map((r) => r.clientId))];
      const cls = await prisma.client.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
      const nameById = new Map(cls.map((c) => [c.id, c.name]));
      children = childForecasts(crows, 'clientId', targetYear, currentYear, (k) => nameById.get(k) || `#${k}`);
    }

    const availableYears = [];
    for (let y = currentYear + 1; y >= Math.min(2022, currentYear - 1); y--) availableYears.push(y);

    return res.json({
      scope: { level, entity, entityName, agencyId, year: targetYear },
      currentYear, currentMonth,
      availableYears,
      childLevelLabel,
      ...main,
      risk: {
        thinHistory: main.historyYears < 3,
        historyYears: main.historyYears,
        volatilityPct: main.volatilityPct,
        topClient,
      },
      children,
    });
  } catch (error) {
    console.error('getCommitmentPlanner error:', error);
    return res.status(500).json({ error: 'Failed to build commitment planner', detail: error.message });
  }
}

// Per-child P10/P50 (top 15 by lifetime spend, so the table stays bounded).
function childForecasts(crows, keyField, targetYear, currentYear, nameFn) {
  const byKey = new Map();
  for (const r of crows) {
    const k = r[keyField];
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push({ scheduleMonth: r.scheduleMonth, _sum: { scheduleValue: r._sum.scheduleValue } });
  }
  const out = [];
  for (const [k, rows] of byKey) {
    const lifetime = rows.reduce((a, r) => a + num(r._sum.scheduleValue), 0);
    const byYm = toByYearMonth(rows);
    const fullYears = Object.keys(byYm).map(Number).filter((y) => y < currentYear).sort((a, b) => a - b);
    const fullTotals = fullYears.map((y) => yearTotal(byYm, y));
    const gap = fullYears.length ? Math.max(1, targetYear - fullYears[fullYears.length - 1]) : 1;
    const f = fullTotals.length ? forecastAnnual(fullTotals, gap, N_CHILD) : null;
    out.push({
      key: String(k),
      name: nameFn(k),
      lifetimeSpend: round2(lifetime),
      p10: f ? f.p10 : null,
      p50: f ? f.p50 : null,
      historyYears: fullYears.length,
    });
  }
  return out.sort((a, b) => b.lifetimeSpend - a.lifetimeSpend).slice(0, 15);
}
