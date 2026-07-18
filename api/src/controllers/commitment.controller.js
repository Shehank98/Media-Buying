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
    return { p10: round2(base * 0.85), p50: round2(base), p90: round2(base * 1.15), method: 'single-year', growth: [], sims: null };
  }
  const growth = [];
  for (let i = 1; i < fullTotals.length; i++) {
    if (fullTotals[i - 1] > 0) growth.push(fullTotals[i] / fullTotals[i - 1] - 1);
  }
  if (!growth.length) return { p10: round2(base * 0.85), p50: round2(base), p90: round2(base * 1.15), method: 'flat', growth: [], sims: null };
  const gMean = growth.reduce((a, b) => a + b, 0) / growth.length;
  const gStd = Math.sqrt(growth.reduce((a, b) => a + (b - gMean) ** 2, 0) / growth.length) || 0.05;
  const noise = Math.max(gStd, 0.03); // floor the noise so a lucky-stable past doesn't over-promise
  // 30% of simulations RESAMPLE an actual past-year total (with a little noise)
  // instead of compounding a growth draw off the last year. This anchors the
  // forecast to what really happened, so a steady 80M/yr track record can't
  // produce a "safe" number far below every year we actually delivered.
  const EMP_WEIGHT = 0.30;
  const sims = [];
  for (let s = 0; s < n; s++) {
    let v;
    if (Math.random() < EMP_WEIGHT) {
      v = fullTotals[Math.floor(Math.random() * fullTotals.length)] * (1 + gaussian() * 0.06);
    } else {
      v = base;
      for (let k = 0; k < gap; k++) {
        const g = growth[Math.floor(Math.random() * growth.length)] + gaussian() * noise;
        v *= (1 + g);
      }
    }
    sims.push(Math.max(0, v));
  }
  sims.sort((a, b) => a - b);
  return {
    p10: round2(quantile(sims, 0.10)),
    p50: round2(quantile(sims, 0.50)),
    p90: round2(quantile(sims, 0.90)),
    method: 'bootstrap+empirical',
    growth: growth.map((g) => round2(g * 100)),
    sims,
  };
}

// Safe commitment at a chosen confidence: the amount cleared `conf` of the time
// = the (1 − conf) quantile of the forecast distribution. Higher confidence →
// a lower, safer number; lower confidence → a higher number closer to the
// expected outcome. Clamped so it never rises above the median (P50).
function commitAtConf(forecast, conf) {
  if (!forecast) return 0;
  const q = Math.min(0.5, Math.max(0.02, 1 - conf));
  if (forecast.sims && forecast.sims.length) return round2(quantile(forecast.sims, q));
  // No simulation set (single-year / flat history): interpolate off the P10/P50
  // anchors (P10 sits at q=0.10, P50 at q=0.50).
  const slope = (forecast.p50 - forecast.p10) / 0.40;
  return round2(Math.max(0, forecast.p50 - slope * (0.50 - q)));
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
function analyzeScope(rows, targetYear, currentYear, currentMonth, targetAmount = null, confidence = 0.90) {
  const byYm = toByYearMonth(rows);
  const allYears = Object.keys(byYm).map(Number).sort((a, b) => a - b);
  const pastYears = allYears.filter((y) => y < currentYear); // years before this one
  const coverage = {};
  pastYears.forEach((y) => { coverage[y] = Object.keys(byYm[y] || {}).length; });
  const completeYears = pastYears.filter((y) => coverage[y] >= 11); // 11-12 months = a complete year

  // Seasonal share (avg share of the year each month carries), from COMPLETE
  // years only (fall back to any past year if none is complete yet).
  const seasonalSource = completeYears.length ? completeYears : pastYears;
  const shareSum = Array(13).fill(0); let shareCount = 0;
  for (const y of seasonalSource) {
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

  // Annualize an incomplete past year (data usually lags the calendar) so a
  // half-uploaded recent year can't become the forecast base and halve a steady
  // track record. covered = seasonal weight of the months present; scale the raw
  // total up by 1/covered (capped 3x). Too little of the year present = skip it.
  const annualizeYear = (y) => {
    const raw = yearTotal(byYm, y);
    if (coverage[y] >= 11) return raw;
    let covered = 0;
    for (let m = 1; m <= 12; m++) if (byYm[y]?.[m] != null) covered += seasonal[m - 1];
    if (covered <= 0.15) return null;
    return raw * Math.min(1 / covered, 3);
  };

  // Forecast series = each past year's (annualized) total, recent-most last.
  const seriesYears = [];
  const fullTotals = [];
  for (const y of pastYears) {
    const av = annualizeYear(y);
    if (av != null && av > 0) { seriesYears.push(y); fullTotals.push(round2(av)); }
  }
  const fullYears = seriesYears; // alias: forecasting + backtest run on the annualized series

  const historicalMin = fullTotals.length ? round2(Math.min(...fullTotals)) : 0;
  const historicalMax = fullTotals.length ? round2(Math.max(...fullTotals)) : 0;
  const historicalAvg = fullTotals.length ? round2(fullTotals.reduce((a, b) => a + b, 0) / fullTotals.length) : 0;

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
  const commitment = forecast ? commitAtConf(forecast, confidence) : 0;

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

  // Build the distribution of the FULL-YEAR total (given whatever is booked so
  // far), then answer "will we clear amount X and how likely" for any target.
  const remainingShare = seasonal.slice(monthsElapsed).reduce((a, b) => a + b, 0);
  let finalSims = [];
  if (forecast) {
    if (monthsElapsed >= 12) {
      finalSims = [ytd];
    } else if (monthsElapsed >= 1) {
      const sigma = Math.max((forecast.p90 - forecast.p10) / 2.563, forecast.p50 * 0.05); // p10..p90 ≈ ±1.2816σ
      for (let s = 0; s < N_MAIN; s++) {
        const remaining = Math.max(0, forecast.p50 * remainingShare + gaussian() * sigma * remainingShare);
        finalSims.push(ytd + remaining);
      }
    } else if (forecast.sims) {
      finalSims = forecast.sims.slice();
    }
    finalSims.sort((a, b) => a - b);
  }
  const probOf = (t) => {
    if (!forecast) return null;
    if (finalSims.length) return round2(finalSims.filter((v) => v >= t).length / finalSims.length);
    return t <= commitment ? 0.9 : 0.5;
  };
  const projectedTotal = finalSims.length ? round2(quantile(finalSims, 0.5)) : (forecast ? forecast.p50 : 0);
  const probabilityHit = forecast ? probOf(commitment) : null;

  // Plain-language assessment for a chosen target (defaults to the safe P10).
  const target = targetAmount != null && targetAmount > 0 ? round2(targetAmount) : commitment;
  const monthsRemaining = Math.max(0, 12 - monthsElapsed);
  const recentSlice = curMonthly.slice(Math.max(0, monthsElapsed - 3), monthsElapsed).filter((v) => v > 0);
  const recentRunRate = recentSlice.length ? round2(recentSlice.reduce((a, b) => a + b, 0) / recentSlice.length) : 0;
  const stillNeeded = round2(Math.max(0, target - ytd));
  const neededPerMonth = monthsRemaining > 0 ? round2(stillNeeded / monthsRemaining) : 0;
  const probability = forecast ? probOf(target) : null;
  const pctBooked = target > 0 ? round2((ytd / target) * 100) : 0;
  let verdict = 'unknown';
  if (probability != null) {
    if (probability >= 0.9) verdict = 'very-likely';
    else if (probability >= 0.75) verdict = 'on-track';
    else if (probability >= 0.5) verdict = 'at-risk';
    else verdict = 'unlikely';
  }
  const assessment = {
    target, isCustom: targetAmount != null && targetAmount > 0,
    ytd, pctBooked, monthsElapsed, monthsRemaining,
    stillNeeded, neededPerMonth, recentRunRate, projectedTotal,
    runRateClears: recentRunRate * monthsRemaining + ytd >= target,
    probability, verdict,
  };

  // Probability of clearing any candidate target — powers the "how likely" curve.
  const curveDist = finalSims.length ? finalSims : (forecast?.sims ? forecast.sims.slice().sort((a, b) => a - b) : []);
  let probCurve = [];
  if (curveDist.length > 1) {
    const lo = Math.max(0, quantile(curveDist, 0.02));
    const hi = quantile(curveDist, 0.98);
    const span = hi - lo || 1; const steps = 28;
    for (let i = 0; i <= steps; i++) {
      const amt = lo + (span * i) / steps;
      probCurve.push({ amount: round2(amt), probability: round2((curveDist.filter((v) => v >= amt).length / curveDist.length) * 100) });
    }
  }
  const projection = { booked: ytd, remaining: round2(Math.max(0, projectedTotal - ytd)), projectedTotal };

  // Target produced at each safety level (same forecast distribution) — the
  // confidence-vs-target trade-off ("how safe vs how big").
  const CONF_LEVELS = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95];
  const confidenceCurve = forecast ? CONF_LEVELS.map((c) => ({ confidence: c, amount: commitAtConf(forecast, c) })) : [];

  // Histogram of simulated next-year outcomes — the spread of where we could land.
  let outcomeHistogram = [];
  if (curveDist.length > 1) {
    const lo = quantile(curveDist, 0.01), hi = quantile(curveDist, 0.99);
    const bins = 20; const w = (hi - lo) / bins || 1;
    const counts = Array(bins).fill(0);
    for (const val of curveDist) { if (val < lo || val > hi) continue; let b = Math.floor((val - lo) / w); if (b >= bins) b = bins - 1; if (b < 0) b = 0; counts[b]++; }
    const tot = curveDist.length;
    outcomeHistogram = counts.map((c, i) => ({ mid: round2(lo + w * (i + 0.5)), from: round2(lo + w * i), to: round2(lo + w * (i + 1)), count: c, pct: round2((c / tot) * 100) }));
  }

  // Walk-forward backtest: for each full year with ≥2 priors, what P10 would have been.
  const backtest = [];
  for (let i = 2; i < fullYears.length; i++) {
    const prior = fullTotals.slice(0, i);
    const f = forecastAnnual(prior, 1, 1500);
    if (!f) continue;
    const actual = fullTotals[i];
    const cAmt = commitAtConf(f, confidence);
    backtest.push({ year: fullYears[i], commitment: cAmt, actual: round2(actual), cleared: actual >= cAmt });
  }

  // Volatility (band width relative to the mid) as a simple risk read.
  const volatilityPct = forecast && forecast.p50 > 0 ? round2(((forecast.p90 - forecast.p10) / forecast.p50) * 100) : 0;

  return {
    hasData,
    history: pastYears.map((y) => ({
      year: y,
      total: round2(yearTotal(byYm, y)),
      annualized: round2(annualizeYear(y) ?? yearTotal(byYm, y)),
      partial: coverage[y] < 11,
      months: coverage[y],
    })),
    historicalMin,
    historicalMax,
    historicalAvg,
    lastYear: lastFull ? { year: lastFull, total: fullTotals[fullTotals.length - 1] } : null,
    seasonal: seasonal.map((x) => round2(x * 100)),
    forecast: forecast ? { p10: forecast.p10, p50: forecast.p50, p90: forecast.p90, method: forecast.method, growth: forecast.growth } : null,
    commitment,
    projectedTotal,
    projection,
    probCurve,
    confidenceCurve,
    outcomeHistogram,
    assessment,
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
    const level = ['overall', 'media-group', 'channel', 'client'].includes(req.query.level) ? req.query.level : 'overall';
    const agencyId = req.query.agencyId ? parseInt(req.query.agencyId) : null;
    const entity = req.query.entity != null ? String(req.query.entity) : '';
    const targetYear = /^\d{4}$/.test(String(req.query.year)) ? parseInt(req.query.year) : currentYear;
    const targetAmount = req.query.target != null && req.query.target !== '' && !isNaN(Number(req.query.target)) ? Number(req.query.target) : null;
    const confidence = req.query.confidence != null && !isNaN(Number(req.query.confidence)) ? Math.min(0.99, Math.max(0.5, Number(req.query.confidence))) : 0.90;

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
    } else if (level === 'client') {
      const clId = parseInt(entity);
      if (!clId) return res.status(400).json({ error: 'entity (clientId) is required' });
      where.clientId = clId;
      const cl = await prisma.client.findUnique({ where: { id: clId }, select: { name: true } });
      entityName = cl?.name || `Client #${clId}`;
    }

    const rows = await prisma.scheduleLog.groupBy({ by: ['scheduleMonth'], where, _sum: { scheduleValue: true } });
    const main = analyzeScope(rows, targetYear, currentYear, currentMonth, targetAmount, confidence);

    // Concentration risk: the single biggest sub-entity's share of this scope,
    // all-time. For a client scope "top client" is meaningless (it is one
    // client), so measure the top media group instead.
    let topClient = null;
    if (level === 'client') {
      const mgAgg = await prisma.scheduleLog.groupBy({ by: ['mediaGroup'], where, _sum: { scheduleValue: true } });
      if (mgAgg.length) {
        const total = mgAgg.reduce((a, r) => a + num(r._sum.scheduleValue), 0);
        const top = mgAgg.reduce((a, r) => (num(r._sum.scheduleValue) > num(a._sum.scheduleValue) ? r : a));
        if (total > 0) topClient = { name: top.mediaGroup || 'Ungrouped', sharePct: round2((num(top._sum.scheduleValue) / total) * 100) };
      }
    } else {
      const clientAgg = await prisma.scheduleLog.groupBy({ by: ['clientId'], where, _sum: { scheduleValue: true } });
      if (clientAgg.length) {
        const total = clientAgg.reduce((a, r) => a + num(r._sum.scheduleValue), 0);
        const top = clientAgg.reduce((a, r) => (num(r._sum.scheduleValue) > num(a._sum.scheduleValue) ? r : a));
        const c = await prisma.client.findUnique({ where: { id: top.clientId }, select: { name: true } });
        if (total > 0) topClient = { name: c?.name || 'Unknown', sharePct: round2((num(top._sum.scheduleValue) / total) * 100) };
      }
    }

    // Children (sub-entities) — each with its own P10/P50 so commitments roll up.
    let children = [];
    let childLevelLabel = '';
    if (level === 'overall') {
      childLevelLabel = 'Media group';
      const crows = await prisma.scheduleLog.groupBy({ by: ['mediaGroup', 'scheduleMonth'], where, _sum: { scheduleValue: true } });
      children = childForecasts(crows, 'mediaGroup', targetYear, currentYear, (k) => k || 'Ungrouped', confidence);
    } else if (level === 'media-group') {
      childLevelLabel = 'Channel';
      const crows = await prisma.scheduleLog.groupBy({ by: ['channelMasterId', 'scheduleMonth'], where, _sum: { scheduleValue: true } });
      const ids = [...new Set(crows.map((r) => r.channelMasterId))];
      const cms = await prisma.channelMaster.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
      const nameById = new Map(cms.map((c) => [c.id, c.name]));
      children = childForecasts(crows, 'channelMasterId', targetYear, currentYear, (k) => nameById.get(k) || `#${k}`, confidence);
    } else if (level === 'channel') {
      childLevelLabel = 'Client';
      const crows = await prisma.scheduleLog.groupBy({ by: ['clientId', 'scheduleMonth'], where, _sum: { scheduleValue: true } });
      const ids = [...new Set(crows.map((r) => r.clientId))];
      const cls = await prisma.client.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
      const nameById = new Map(cls.map((c) => [c.id, c.name]));
      children = childForecasts(crows, 'clientId', targetYear, currentYear, (k) => nameById.get(k) || `#${k}`, confidence);
    } else {
      // client scope → break the client's target down by media group
      childLevelLabel = 'Media group';
      const crows = await prisma.scheduleLog.groupBy({ by: ['mediaGroup', 'scheduleMonth'], where, _sum: { scheduleValue: true } });
      children = childForecasts(crows, 'mediaGroup', targetYear, currentYear, (k) => k || 'Ungrouped', confidence);
    }

    const availableYears = [];
    for (let y = currentYear + 1; y >= Math.min(2022, currentYear - 1); y--) availableYears.push(y);

    return res.json({
      scope: { level, entity, entityName, agencyId, year: targetYear },
      currentYear, currentMonth,
      confidence,
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
function childForecasts(crows, keyField, targetYear, currentYear, nameFn, confidence = 0.90) {
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
    const fullTotals = fullYears.map((y) => {
      const cov = Object.keys(byYm[y] || {}).length;
      const raw = yearTotal(byYm, y);
      return cov >= 11 || cov === 0 ? round2(raw) : round2(raw * Math.min(12 / cov, 3));
    });
    const gap = fullYears.length ? Math.max(1, targetYear - fullYears[fullYears.length - 1]) : 1;
    const f = fullTotals.length ? forecastAnnual(fullTotals, gap, N_CHILD) : null;
    out.push({
      key: String(k),
      name: nameFn(k),
      lifetimeSpend: round2(lifetime),
      p10: f ? commitAtConf(f, confidence) : null,
      p50: f ? f.p50 : null,
      historyYears: fullYears.length,
    });
  }
  return out.sort((a, b) => b.lifetimeSpend - a.lifetimeSpend).slice(0, 15);
}
