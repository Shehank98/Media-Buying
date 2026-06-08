import prisma from '../utils/prisma.js';

BigInt.prototype.toJSON = function () { return Number(this); };

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeNum(v) {
  if (v == null) return null;
  return Number(v);
}

function currentYM() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function yearStart() {
  return `${new Date().getFullYear()}-01`;
}

function prevMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Build a continuous list of YYYY-MM from `from` to `to` inclusive.
function monthRange(from, to) {
  const out = [];
  let cur = from;
  let guard = 0;
  while (cur <= to && guard < 240) {
    out.push(cur);
    cur = addMonths(cur, 1);
    guard++;
  }
  return out;
}

// Returns a where-fragment restricting MANAGER users to their assigned agencies.
async function agencyFilter(user) {
  if (user.role !== 'MANAGER') return {};
  const access = await prisma.userAgencyAccess.findMany({
    where: { userId: user.id },
    select: { agencyId: true },
  });
  return { agencyId: { in: access.map((a) => a.agencyId) } };
}

// Least-squares linear regression over [{x, y}]. Returns null if undeterminable.
function linReg(points) {
  const n = points.length;
  if (n < 2) return null;
  const sx = points.reduce((s, p) => s + p.x, 0);
  const sy = points.reduce((s, p) => s + p.y, 0);
  const sxx = points.reduce((s, p) => s + p.x * p.x, 0);
  const sxy = points.reduce((s, p) => s + p.x * p.y, 0);
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return { slope, intercept };
}

function pct(curr, prev) {
  if (prev == null || prev === 0) return null;
  return Number((((curr - prev) / prev) * 100).toFixed(1));
}

// ── 1. Insights & Recommendations ──────────────────────────────────────────────
// Heuristic, explainable recommendations derived from schedule logs + properties.

export async function getInsights(req, res) {
  try {
    const user = req.user;
    const af = await agencyFilter(user);
    const ym = currentYM();
    const pm = prevMonth(ym);
    const ys = yearStart();
    const base = { isDeleted: false, ...af };
    const insights = [];

    const [ytdByClient, currByClient, prevByClient, manualCount, totalCount, mediumYtd] =
      await Promise.all([
        prisma.scheduleLog.groupBy({ by: ['clientId'], where: { ...base, scheduleMonth: { gte: ys } }, _sum: { scheduleValue: true }, orderBy: { _sum: { scheduleValue: 'desc' } } }),
        prisma.scheduleLog.groupBy({ by: ['clientId'], where: { ...base, scheduleMonth: ym }, _sum: { scheduleValue: true } }),
        prisma.scheduleLog.groupBy({ by: ['clientId'], where: { ...base, scheduleMonth: pm }, _sum: { scheduleValue: true } }),
        prisma.scheduleLog.count({ where: { ...base, scheduleMonth: ym, uploadBatchId: null } }),
        prisma.scheduleLog.count({ where: { ...base, scheduleMonth: ym } }),
        prisma.scheduleLog.groupBy({ by: ['medium'], where: { ...base, scheduleMonth: { gte: ys } }, _sum: { scheduleValue: true } }),
      ]);

    const ytdTotal = ytdByClient.reduce((s, r) => s + (safeNum(r._sum.scheduleValue) || 0), 0);
    const currMap = new Map(currByClient.map((r) => [r.clientId, safeNum(r._sum.scheduleValue) || 0]));
    const prevMap = new Map(prevByClient.map((r) => [r.clientId, safeNum(r._sum.scheduleValue) || 0]));

    // Resolve client names for the clients we will reference.
    const referencedIds = new Set([
      ...ytdByClient.slice(0, 1).map((r) => r.clientId),
      ...currByClient.map((r) => r.clientId),
      ...prevByClient.map((r) => r.clientId),
    ]);
    const clients = await prisma.client.findMany({
      where: { id: { in: Array.from(referencedIds) } },
      select: { id: true, name: true, agency: { select: { name: true } } },
    });
    const clientMap = new Map(clients.map((c) => [c.id, c]));

    // (a) Concentration risk — single client is an outsized share of YTD billings.
    if (ytdByClient.length && ytdTotal > 0) {
      const top = ytdByClient[0];
      const share = ((safeNum(top._sum.scheduleValue) || 0) / ytdTotal) * 100;
      if (share >= 35) {
        const c = clientMap.get(top.clientId);
        insights.push({
          id: `concentration-${top.clientId}`,
          severity: share >= 50 ? 'high' : 'medium',
          category: 'Concentration risk',
          title: `${c?.name || 'Top client'} drives ${share.toFixed(0)}% of YTD billings`,
          message: `Revenue is heavily concentrated in a single client. Consider diversifying the book to reduce exposure if this account churns.`,
          value: safeNum(top._sum.scheduleValue) || 0,
          link: `/clients/${top.clientId}`,
        });
      }
    }

    // (b) Spend surges — clients whose current month jumped sharply vs last month.
    for (const [cid, curr] of currMap) {
      const prev = prevMap.get(cid) || 0;
      const change = pct(curr, prev);
      if (change != null && change >= 50 && curr >= 100000) {
        const c = clientMap.get(cid);
        insights.push({
          id: `surge-${cid}`,
          severity: change >= 100 ? 'high' : 'medium',
          category: 'Spend surge',
          title: `${c?.name || 'Client'} spend up ${change.toFixed(0)}% MoM`,
          message: `Spend rose from prior month — verify the schedule is intentional and budgets are aligned.`,
          value: curr,
          link: `/clients/${cid}`,
        });
      }
    }

    // (c) Paused clients — had spend last month, nothing this month.
    for (const [cid, prev] of prevMap) {
      const curr = currMap.get(cid) || 0;
      if (prev >= 100000 && curr === 0) {
        const c = clientMap.get(cid);
        insights.push({
          id: `paused-${cid}`,
          severity: 'medium',
          category: 'Paused client',
          title: `${c?.name || 'Client'} has no schedule this month`,
          message: `This client spent last month but has no entries yet this month. Confirm whether the campaign ended or data is pending upload.`,
          value: prev,
          link: `/clients/${cid}`,
        });
      }
    }

    // (d) Manual entry burden — too much of this month was keyed in by hand.
    if (totalCount >= 20) {
      const manualPct = (manualCount / totalCount) * 100;
      if (manualPct >= 50) {
        insights.push({
          id: 'manual-burden',
          severity: 'low',
          category: 'Process',
          title: `${manualPct.toFixed(0)}% of this month's entries are manual`,
          message: `A large share of entries were added manually rather than via bulk upload. Using the Database bulk upload would save time and reduce keying errors.`,
          value: manualCount,
          link: '/database',
        });
      }
    }

    // (e) Medium mix — flag if a single medium dominates the YTD mix.
    const medTotal = mediumYtd.reduce((s, r) => s + (safeNum(r._sum.scheduleValue) || 0), 0);
    if (medTotal > 0) {
      const sorted = [...mediumYtd].sort((a, b) => (safeNum(b._sum.scheduleValue) || 0) - (safeNum(a._sum.scheduleValue) || 0));
      const lead = sorted[0];
      const leadShare = ((safeNum(lead._sum.scheduleValue) || 0) / medTotal) * 100;
      if (leadShare >= 70) {
        insights.push({
          id: 'medium-mix',
          severity: 'low',
          category: 'Channel mix',
          title: `${leadShare.toFixed(0)}% of spend is on ${lead.medium}`,
          message: `The media mix is skewed toward ${lead.medium}. A more balanced TV / Radio / Print split can broaden reach and negotiating leverage.`,
          value: safeNum(lead._sum.scheduleValue) || 0,
          link: '/spend-analytics',
        });
      }
    }

    // Order by severity then value.
    const rank = { high: 0, medium: 1, low: 2, positive: 3 };
    insights.sort((a, b) => (rank[a.severity] - rank[b.severity]) || ((b.value || 0) - (a.value || 0)));

    return res.json({ generatedFor: ym, count: insights.length, insights });
  } catch (error) {
    console.error('getInsights error:', error);
    return res.status(500).json({ error: 'Failed to generate insights', detail: error.message });
  }
}

// ── 2. Alerts & Anomaly Detection ──────────────────────────────────────────────
// Month-over-month statistical anomalies + missing-data alerts.

export async function getAlerts(req, res) {
  try {
    const user = req.user;
    const af = await agencyFilter(user);
    const ym = currentYM();
    const pm = prevMonth(ym);
    const base = { isDeleted: false, ...af };
    const alerts = [];

    // Trailing 6 months of total spend per channel for a baseline (mean + std).
    const sixAgo = monthsAgo(6);
    const [channelHist, channelCurr, agencyPrev, agencyCurr] = await Promise.all([
      prisma.scheduleLog.groupBy({ by: ['channelMasterId', 'scheduleMonth'], where: { ...base, scheduleMonth: { gte: sixAgo, lt: ym } }, _sum: { scheduleValue: true } }),
      prisma.scheduleLog.groupBy({ by: ['channelMasterId'], where: { ...base, scheduleMonth: ym }, _sum: { scheduleValue: true } }),
      prisma.scheduleLog.groupBy({ by: ['agencyId'], where: { ...base, scheduleMonth: pm }, _sum: { scheduleValue: true } }),
      prisma.scheduleLog.groupBy({ by: ['agencyId'], where: { ...base, scheduleMonth: ym }, _sum: { scheduleValue: true } }),
    ]);

    // Channel baseline: collect monthly values per channel.
    const histByChannel = new Map();
    for (const r of channelHist) {
      const arr = histByChannel.get(r.channelMasterId) || [];
      arr.push(safeNum(r._sum.scheduleValue) || 0);
      histByChannel.set(r.channelMasterId, arr);
    }
    const currByChannel = new Map(channelCurr.map((r) => [r.channelMasterId, safeNum(r._sum.scheduleValue) || 0]));

    const channelIds = new Set([...histByChannel.keys(), ...currByChannel.keys()]);
    const channelMasters = await prisma.channelMaster.findMany({
      where: { id: { in: Array.from(channelIds) } },
      select: { id: true, name: true, medium: true },
    });
    const cmMap = new Map(channelMasters.map((c) => [c.id, c]));

    for (const cid of channelIds) {
      const hist = histByChannel.get(cid) || [];
      const curr = currByChannel.get(cid) || 0;
      if (hist.length < 3) continue; // need a stable baseline
      const mean = hist.reduce((s, v) => s + v, 0) / hist.length;
      const variance = hist.reduce((s, v) => s + (v - mean) ** 2, 0) / hist.length;
      const std = Math.sqrt(variance);
      if (std === 0 || mean < 50000) continue;
      const z = (curr - mean) / std;
      const cm = cmMap.get(cid);
      if (z >= 2) {
        alerts.push({
          id: `spike-ch-${cid}`,
          severity: z >= 3 ? 'high' : 'medium',
          type: 'spike',
          title: `${cm?.name || 'Channel'} spend spike`,
          message: `This month is ${z.toFixed(1)}σ above its 6-month average (${Math.round(mean).toLocaleString()}). Confirm the buy is correct.`,
          medium: cm?.medium,
          current: curr,
          baseline: Math.round(mean),
          link: `/channel-masters/${cid}`,
        });
      } else if (z <= -2 && curr === 0) {
        alerts.push({
          id: `drop-ch-${cid}`,
          severity: 'medium',
          type: 'drop',
          title: `${cm?.name || 'Channel'} dropped off`,
          message: `A normally active channel (avg ${Math.round(mean).toLocaleString()}/mo) has no spend this month. Verify whether data is missing.`,
          medium: cm?.medium,
          current: curr,
          baseline: Math.round(mean),
          link: `/channel-masters/${cid}`,
        });
      }
    }

    // Agency-level missing data — had spend last month, none this month.
    const agencyCurrMap = new Map(agencyCurr.map((r) => [r.agencyId, safeNum(r._sum.scheduleValue) || 0]));
    const agencyIdsToName = await prisma.agency.findMany({
      where: { id: { in: agencyPrev.map((r) => r.agencyId) } },
      select: { id: true, name: true },
    });
    const agencyNameMap = new Map(agencyIdsToName.map((a) => [a.id, a.name]));
    for (const r of agencyPrev) {
      const prev = safeNum(r._sum.scheduleValue) || 0;
      const curr = agencyCurrMap.get(r.agencyId) || 0;
      if (prev > 0 && curr === 0) {
        alerts.push({
          id: `missing-ag-${r.agencyId}`,
          severity: 'high',
          type: 'missing',
          title: `${agencyNameMap.get(r.agencyId) || 'Agency'} has no data this month`,
          message: `This agency reported spend last month but nothing has been uploaded for ${ym}. Monthly schedule may be overdue.`,
          current: 0,
          baseline: Math.round(prev),
          link: '/upload-tracker',
        });
      }
    }

    const rank = { high: 0, medium: 1, low: 2 };
    alerts.sort((a, b) => (rank[a.severity] - rank[b.severity]) || ((b.current || b.baseline || 0) - (a.current || a.baseline || 0)));

    return res.json({ generatedFor: ym, count: alerts.length, alerts });
  } catch (error) {
    console.error('getAlerts error:', error);
    return res.status(500).json({ error: 'Failed to detect anomalies', detail: error.message });
  }
}

// ── 3. Budget Planning / Forecasting ────────────────────────────────────────────
// Linear-trend projection of next month's spend, overall and per agency.

export async function getForecast(req, res) {
  try {
    const user = req.user;
    const af = await agencyFilter(user);
    const ym = currentYM();
    const nextYm = addMonths(ym, 1);
    const base = { isDeleted: false, ...af };

    // Use the trailing 12 completed months (exclude current, partial month) for the model.
    const from = monthsAgo(12);
    const lastComplete = prevMonth(ym);
    const months = monthRange(from, lastComplete);

    const [combinedRows, agencyRows, agencies] = await Promise.all([
      prisma.scheduleLog.groupBy({ by: ['scheduleMonth'], where: { ...base, scheduleMonth: { gte: from, lte: lastComplete } }, _sum: { scheduleValue: true } }),
      prisma.scheduleLog.groupBy({ by: ['agencyId', 'scheduleMonth'], where: { ...base, scheduleMonth: { gte: from, lte: lastComplete } }, _sum: { scheduleValue: true } }),
      prisma.agency.findMany({ where: af.agencyId ? { id: af.agencyId } : {}, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ]);

    const combinedMap = new Map(combinedRows.map((r) => [r.scheduleMonth, safeNum(r._sum.scheduleValue) || 0]));

    function buildForecast(valueMap) {
      const series = months.map((m, i) => ({ month: m, x: i, y: valueMap.get(m) || 0 }));
      const reg = linReg(series);
      let forecast = null;
      let band = 0;
      let movingAvg = null;
      const recent = series.slice(-3);
      if (recent.length) movingAvg = Math.round(recent.reduce((s, p) => s + p.y, 0) / recent.length);
      if (reg) {
        const proj = reg.slope * series.length + reg.intercept;
        forecast = Math.max(0, Math.round(proj));
        // residual std for a ± confidence band
        const resid = series.map((p) => p.y - (reg.slope * p.x + reg.intercept));
        const rmean = resid.reduce((s, v) => s + v, 0) / resid.length;
        const rstd = Math.sqrt(resid.reduce((s, v) => s + (v - rmean) ** 2, 0) / resid.length);
        band = Math.round(rstd);
      }
      return { series, forecast, band, movingAvg, trend: reg ? (reg.slope > 0 ? 'up' : reg.slope < 0 ? 'down' : 'flat') : null };
    }

    const combined = buildForecast(combinedMap);

    // Per-agency forecasts
    const agencyValueMaps = new Map();
    for (const r of agencyRows) {
      let m = agencyValueMaps.get(r.agencyId);
      if (!m) { m = new Map(); agencyValueMaps.set(r.agencyId, m); }
      m.set(r.scheduleMonth, safeNum(r._sum.scheduleValue) || 0);
    }
    const byAgency = agencies.map((a) => {
      const f = buildForecast(agencyValueMaps.get(a.id) || new Map());
      return { agencyId: a.id, agencyName: a.name, forecast: f.forecast, band: f.band, movingAvg: f.movingAvg, trend: f.trend };
    }).filter((a) => a.forecast != null && a.forecast > 0)
      .sort((a, b) => (b.forecast || 0) - (a.forecast || 0));

    return res.json({
      forecastMonth: nextYm,
      historyMonths: months,
      combined: {
        history: combined.series.map((p) => ({ month: p.month, scheduleValue: p.y })),
        forecast: combined.forecast,
        band: combined.band,
        movingAvg: combined.movingAvg,
        trend: combined.trend,
      },
      byAgency,
    });
  } catch (error) {
    console.error('getForecast error:', error);
    return res.status(500).json({ error: 'Failed to build forecast', detail: error.message });
  }
}

// ── 4. Channel Value Scoring ────────────────────────────────────────────────────
// Composite 0-100 score ranking channels by buying value (bonus, reach, consistency, volume).

export async function getChannelScores(req, res) {
  try {
    const user = req.user;
    const af = await agencyFilter(user);
    const ys = yearStart();
    const base = { isDeleted: false, ...af };

    // Spend + reach per channel master (YTD).
    const [grouped, clientRows, monthRows] = await Promise.all([
      prisma.scheduleLog.groupBy({ by: ['channelMasterId'], where: { ...base, scheduleMonth: { gte: ys } }, _sum: { scheduleValue: true }, _count: true }),
      prisma.scheduleLog.findMany({ where: { ...base, scheduleMonth: { gte: ys } }, select: { channelMasterId: true, clientId: true }, distinct: ['channelMasterId', 'clientId'] }),
      prisma.scheduleLog.findMany({ where: { ...base, scheduleMonth: { gte: ys } }, select: { channelMasterId: true, scheduleMonth: true }, distinct: ['channelMasterId', 'scheduleMonth'] }),
    ]);

    if (!grouped.length) return res.json({ channels: [], weights: WEIGHTS });

    const channelIds = grouped.map((g) => g.channelMasterId);

    // Distinct client & active-month counts per channel.
    const clientCount = new Map();
    for (const r of clientRows) clientCount.set(r.channelMasterId, (clientCount.get(r.channelMasterId) || 0) + 1);
    const monthCount = new Map();
    for (const r of monthRows) monthCount.set(r.channelMasterId, (monthCount.get(r.channelMasterId) || 0) + 1);

    // Average bonus % from properties tied to each channel master (respecting agency scope).
    const propWhere = { channel: { channelMasterId: { in: channelIds } } };
    if (af.agencyId) propWhere.channel = { ...propWhere.channel, client: { agencyId: af.agencyId } };
    const props = await prisma.property.findMany({
      where: propWhere,
      select: { bonusPct: true, channel: { select: { channelMasterId: true } } },
    });
    const bonusAgg = new Map();
    for (const p of props) {
      const cmId = p.channel?.channelMasterId;
      if (cmId == null) continue;
      const b = safeNum(p.bonusPct);
      if (b == null) continue;
      const a = bonusAgg.get(cmId) || { sum: 0, n: 0 };
      a.sum += b; a.n += 1;
      bonusAgg.set(cmId, a);
    }

    const channelMasters = await prisma.channelMaster.findMany({
      where: { id: { in: channelIds } },
      select: { id: true, name: true, medium: true, mediaGroup: { select: { name: true } } },
    });
    const cmMap = new Map(channelMasters.map((c) => [c.id, c]));

    // Assemble raw metrics.
    const raw = grouped.map((g) => {
      const bonus = bonusAgg.get(g.channelMasterId);
      return {
        channelMasterId: g.channelMasterId,
        ytdSpend: safeNum(g._sum.scheduleValue) || 0,
        entryCount: g._count,
        clientCount: clientCount.get(g.channelMasterId) || 0,
        monthsActive: monthCount.get(g.channelMasterId) || 0,
        avgBonusPct: bonus && bonus.n ? Number((bonus.sum / bonus.n).toFixed(2)) : 0,
      };
    });

    // Min-max normalization helpers (log scale for spend to dampen outliers).
    const maxOf = (key, transform = (v) => v) => Math.max(...raw.map((r) => transform(r[key])), 0);
    const maxBonus = maxOf('avgBonusPct');
    const maxClients = maxOf('clientCount');
    const maxMonths = maxOf('monthsActive');
    const maxSpend = maxOf('ytdSpend', (v) => Math.log10(v + 1));

    const norm = (v, max) => (max > 0 ? v / max : 0);

    const channels = raw.map((r) => {
      const bonusScore = norm(r.avgBonusPct, maxBonus);
      const reachScore = norm(r.clientCount, maxClients);
      const consistencyScore = norm(r.monthsActive, maxMonths);
      const volumeScore = norm(Math.log10(r.ytdSpend + 1), maxSpend);
      const composite =
        bonusScore * WEIGHTS.bonus +
        reachScore * WEIGHTS.reach +
        consistencyScore * WEIGHTS.consistency +
        volumeScore * WEIGHTS.volume;
      const score = Math.round(composite * 100);
      const cm = cmMap.get(r.channelMasterId);
      const grade = score >= 75 ? 'A' : score >= 55 ? 'B' : score >= 35 ? 'C' : 'D';
      let recommendation;
      if (grade === 'A') recommendation = 'Strong value — prioritise and protect this allocation.';
      else if (grade === 'B') recommendation = 'Solid value — maintain and negotiate for better bonus.';
      else if (grade === 'C') recommendation = 'Average — review bonus terms and reach before renewing.';
      else recommendation = 'Low value — reassess whether to continue buying here.';
      return {
        channelMasterId: r.channelMasterId,
        channelName: cm?.name || 'Unknown',
        medium: cm?.medium || '',
        mediaGroup: cm?.mediaGroup?.name || '',
        score,
        grade,
        recommendation,
        ytdSpend: r.ytdSpend,
        clientCount: r.clientCount,
        monthsActive: r.monthsActive,
        avgBonusPct: r.avgBonusPct,
        breakdown: {
          bonus: Math.round(bonusScore * 100),
          reach: Math.round(reachScore * 100),
          consistency: Math.round(consistencyScore * 100),
          volume: Math.round(volumeScore * 100),
        },
      };
    });

    channels.sort((a, b) => b.score - a.score);
    return res.json({ weights: WEIGHTS, count: channels.length, channels });
  } catch (error) {
    console.error('getChannelScores error:', error);
    return res.status(500).json({ error: 'Failed to score channels', detail: error.message });
  }
}

const WEIGHTS = { bonus: 0.35, reach: 0.25, consistency: 0.20, volume: 0.20 };
