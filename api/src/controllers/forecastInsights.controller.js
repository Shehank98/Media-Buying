import prisma from '../utils/prisma.js';
import { getAccessibleClientIds } from '../middleware/access.js';

const MEDIUM_ORDER = ['TV', 'RADIO', 'PRINT', 'CINEMA', 'OOH', 'DIGITAL'];

// The month group heads forecast: current calendar month through the 14th,
// then rolls to next month from the 15th onward. Mirrors forecasting.controller.js.
function nextMonth() {
  const d = new Date();
  const rollOver = d.getDate() >= 15;
  d.setDate(1);
  if (rollOver) d.setMonth(d.getMonth() + 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function monthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function prevMonth(year, month) {
  let y = year, m = month - 1;
  if (m < 1) { m = 12; y -= 1; }
  return { year: y, month: m };
}

// Resolve every client a group head (account manager) manages, via any path:
// team membership + direct UserClientAccess (getAccessibleClientIds) plus any
// team they head (Team.headUserId). Mirrors GROUP_HEAD_CLIENT_OR's branches.
async function clientsForHead(headUserId) {
  const [accessIds, headedTeams] = await Promise.all([
    getAccessibleClientIds(headUserId, 'GROUP_HEAD'),
    prisma.team.findMany({ where: { headUserId }, select: { id: true } }),
  ]);
  const ids = new Set(accessIds);
  if (headedTeams.length) {
    const tcs = await prisma.teamClient.findMany({ where: { teamId: { in: headedTeams.map((t) => t.id) } }, select: { clientId: true } });
    tcs.forEach((tc) => ids.add(tc.clientId));
  }
  return [...ids];
}

// Shared filter resolver: ?year&month&agencyId&clientId&medium&channelMasterId&headUserId.
// headUserId (an "Account Manager" = GROUP_HEAD user) resolves to the clients that
// group head manages, intersected with an explicit clientId.
async function resolveInsightFilters(req) {
  let year = parseInt(req.query.year);
  let month = parseInt(req.query.month);
  if (!(year >= 2000 && month >= 1 && month <= 12)) {
    const nm = nextMonth();
    year = nm.year;
    month = nm.month;
  }

  const agencyId = req.query.agencyId ? parseInt(req.query.agencyId) : null;
  const medium = req.query.medium && MEDIUM_ORDER.includes(req.query.medium) ? req.query.medium : null;
  const channelMasterId = req.query.channelMasterId ? parseInt(req.query.channelMasterId) : null;
  const headUserId = req.query.headUserId ? parseInt(req.query.headUserId) : null;
  const explicitClientId = req.query.clientId ? parseInt(req.query.clientId) : null;

  let clientIds = null; // null = unrestricted
  if (headUserId) {
    clientIds = await clientsForHead(headUserId);
  }
  if (explicitClientId) {
    clientIds = clientIds ? clientIds.filter((id) => id === explicitClientId) : [explicitClientId];
  }

  return { year, month, agencyId, medium, channelMasterId, headUserId, clientIds };
}

function buildForecastWhere(filters) {
  const where = { year: filters.year, month: filters.month };
  if (filters.clientIds) where.clientId = { in: filters.clientIds };
  if (filters.agencyId) where.agencyId = filters.agencyId;
  if (filters.channelMasterId) where.channelMasterId = filters.channelMasterId;
  if (filters.medium) where.channelMaster = { medium: filters.medium };
  return where;
}

function buildScheduleWhere(filters) {
  const where = { isDeleted: false, scheduleMonth: monthKey(filters.year, filters.month) };
  if (filters.clientIds) where.clientId = { in: filters.clientIds };
  if (filters.agencyId) where.agencyId = filters.agencyId;
  if (filters.channelMasterId) where.channelMasterId = filters.channelMasterId;
  if (filters.medium) where.medium = filters.medium;
  return where;
}

// "Account Manager" = the group head who manages the client, resolved through the
// same paths as GROUP_HEAD_CLIENT_OR (so a client never shows "Unassigned" while a
// group head actually manages it): the team's head (Team.headUserId), else a
// GROUP_HEAD member of the client's team, else a directly-assigned GROUP_HEAD user
// (UserClientAccess). Returns a Map of clientId -> group head name.
export async function accountManagerByClient(clientIds) {
  if (!clientIds.length) return new Map();
  const [teamClients, directAccess] = await Promise.all([
    prisma.teamClient.findMany({
      where: { clientId: { in: clientIds } },
      include: {
        team: {
          include: {
            head: { select: { name: true, role: true } },
            members: { where: { user: { role: 'GROUP_HEAD' } }, include: { user: { select: { name: true } } }, orderBy: { userId: 'asc' } },
          },
        },
      },
    }),
    prisma.userClientAccess.findMany({
      where: { clientId: { in: clientIds }, user: { role: 'GROUP_HEAD' } },
      include: { user: { select: { name: true } } },
      orderBy: { userId: 'asc' },
    }),
  ]);

  const map = new Map();
  for (const tc of teamClients) {
    if (map.has(tc.clientId)) continue;
    const t = tc.team;
    if (t?.head?.name && t.head.role === 'GROUP_HEAD') { map.set(tc.clientId, t.head.name); continue; }
    const ghMember = t?.members?.[0]?.user;
    if (ghMember?.name) map.set(tc.clientId, ghMember.name);
  }
  for (const ua of directAccess) {
    if (!map.has(ua.clientId) && ua.user?.name) map.set(ua.clientId, ua.user.name);
  }
  return map;
}

// Spec §1: client-wise next-month forecast + status, and a medium-level breakdown.
export async function getInsightsSummary(req, res) {
  try {
    const filters = await resolveInsightFilters(req);
    const fWhere = buildForecastWhere(filters);

    const byClient = await prisma.monthlyForecast.groupBy({
      by: ['clientId'],
      where: fWhere,
      _sum: { amountMillions: true },
    });
    const forecastByClient = new Map(byClient.map((g) => [g.clientId, Number(g._sum.amountMillions) || 0]));

    // Insights is SUPER_ADMIN-only, and admins enter/track forecasts for every
    // active client (not just the group-head roster), so list ALL active clients
    // here - matching what the forecast entry grid now shows for SUPER_ADMIN.
    const clientWhere = { isActive: true };
    if (filters.clientIds) clientWhere.id = { in: filters.clientIds };
    if (filters.agencyId) clientWhere.agencyId = filters.agencyId;
    const clients = await prisma.client.findMany({
      where: clientWhere,
      select: { id: true, name: true, agency: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });

    const amMap = await accountManagerByClient(clients.map((c) => c.id));

    const clientRows = clients.map((c) => {
      const totalForecastMillions = Number((forecastByClient.get(c.id) || 0).toFixed(2));
      return {
        clientId: c.id,
        clientName: c.name,
        agencyId: c.agency?.id || null,
        agencyName: c.agency?.name || '',
        accountManager: amMap.get(c.id) || 'Unassigned',
        year: filters.year,
        month: filters.month,
        totalForecastMillions,
        status: totalForecastMillions > 0 ? 'submitted' : 'pending',
      };
    });
    const grandTotal = clientRows.reduce((s, r) => s + r.totalForecastMillions, 0);

    // Medium-level breakdown (TV/Radio/Print/Digital/Cinema/OOH totals + % of
    // total) - scoped to the SAME client set as the client table above (all
    // active clients under the applied filters), so its total matches the
    // client-wise total.
    const rosterIds = clients.map((c) => c.id);
    const byChannel = await prisma.monthlyForecast.groupBy({
      by: ['channelMasterId'],
      where: { ...fWhere, clientId: { in: rosterIds } },
      _sum: { amountMillions: true },
    });
    const channelMasters = await prisma.channelMaster.findMany({
      where: { id: { in: byChannel.map((g) => g.channelMasterId) } },
      select: { id: true, name: true, medium: true },
    });
    const cmById = new Map(channelMasters.map((c) => [c.id, c]));
    const mediumTotals = {};
    for (const g of byChannel) {
      const medium = cmById.get(g.channelMasterId)?.medium || 'OTHER';
      mediumTotals[medium] = (mediumTotals[medium] || 0) + (Number(g._sum.amountMillions) || 0);
    }
    const mediumTotalSum = Object.values(mediumTotals).reduce((s, v) => s + v, 0);
    const channelBreakdown = MEDIUM_ORDER.filter((m) => mediumTotals[m] != null).map((m) => ({
      medium: m,
      forecastMillions: Number(mediumTotals[m].toFixed(2)),
      pctOfTotal: mediumTotalSum > 0 ? Number(((mediumTotals[m] / mediumTotalSum) * 100).toFixed(1)) : 0,
    }));

    // Monthly commitment target per channel (ChannelCommitment yearly ÷ 12, in
    // millions) so the channel-wise view can flag whether the forecast for the
    // month meets that channel's monthly target and by how much.
    const commitments = await prisma.channelCommitment.findMany({
      where: { year: filters.year, channelMasterId: { in: byChannel.map((g) => g.channelMasterId) } },
      select: { channelMasterId: true, yearlyAmount: true },
    });
    const monthlyTargetById = new Map(
      commitments.map((c) => [c.channelMasterId, (Number(c.yearlyAmount) || 0) / 12 / 1e6]),
    );

    // Per-channel breakdown (each individual ChannelMaster that has a forecast,
    // including the per-medium "Total"/Unspecified buckets for amounts a head
    // couldn't split), so the Summary can show a true channel-wise view - not
    // just the medium roll-up. Sorted by medium order then largest forecast.
    const channelBreakdownByChannel = byChannel
      .map((g) => {
        const cm = cmById.get(g.channelMasterId);
        const amt = Number(g._sum.amountMillions) || 0;
        const target = monthlyTargetById.get(g.channelMasterId);
        const hasTarget = target != null && target > 0;
        return {
          channelMasterId: g.channelMasterId,
          channelName: cm?.name || 'Unlinked',
          medium: cm?.medium || 'OTHER',
          forecastMillions: Number(amt.toFixed(2)),
          pctOfTotal: mediumTotalSum > 0 ? Number(((amt / mediumTotalSum) * 100).toFixed(1)) : 0,
          monthlyTargetMillions: hasTarget ? Number(target.toFixed(2)) : null,
          targetMet: hasTarget ? (amt + 0.005 >= target) : null,
          targetDiffMillions: hasTarget ? Number((amt - target).toFixed(2)) : null,
          targetPct: hasTarget ? Number(((amt / target) * 100).toFixed(1)) : null,
        };
      })
      .sort((a, b) => (MEDIUM_ORDER.indexOf(a.medium) - MEDIUM_ORDER.indexOf(b.medium)) || (b.forecastMillions - a.forecastMillions) || a.channelName.localeCompare(b.channelName));

    return res.json({
      year: filters.year,
      month: filters.month,
      clients: clientRows,
      totalForecastMillions: Number(grandTotal.toFixed(2)),
      channelBreakdown,
      channelBreakdownByChannel,
      channelBreakdownTotalMillions: Number(mediumTotalSum.toFixed(2)),
    });
  } catch (error) {
    console.error('getInsightsSummary error:', error);
    return res.status(500).json({ error: 'Failed to build insights summary', detail: error.message });
  }
}

// Overall Budget insights (SUPER_ADMIN): the entry-side Overall Budget worksheet
// aggregated for admins. Two sections, both for the resolved month and scoped to
// the same group-head roster as the Summary, so they refresh live as group heads
// update forecasts/budgets:
//   1) by account manager (group head): Actual (their clients' total forecast,
//      full LKR) + Best + Billing-last-month (from MonthlyBudget, full LKR).
//   2) by channel: total forecast amount per ChannelMaster (full LKR).
export async function getInsightsBudget(req, res) {
  try {
    const filters = await resolveInsightFilters(req);
    const { year, month } = filters;

    const clientWhere = { isActive: true };
    if (filters.clientIds) clientWhere.id = { in: filters.clientIds };
    if (filters.agencyId) clientWhere.agencyId = filters.agencyId;
    const clients = await prisma.client.findMany({ where: clientWhere, select: { id: true, name: true } });
    const clientIds = clients.map((c) => c.id);

    const amMap = await accountManagerByClient(clientIds); // clientId -> group head name

    const [byClientF, byChannelF, budgets] = await Promise.all([
      prisma.monthlyForecast.groupBy({ by: ['clientId'], where: { year, month, clientId: { in: clientIds } }, _sum: { amountMillions: true } }),
      prisma.monthlyForecast.groupBy({ by: ['channelMasterId'], where: { year, month, clientId: { in: clientIds } }, _sum: { amountMillions: true } }),
      prisma.monthlyBudget.findMany({ where: { year, month, clientId: { in: clientIds } } }),
    ]);
    // Forecast is stored in millions; the budget worksheet works in full LKR.
    const forecastByClient = new Map(byClientF.map((g) => [g.clientId, (Number(g._sum.amountMillions) || 0) * 1e6]));
    const budgetByClient = new Map(budgets.map((b) => [b.clientId, b]));

    // ── 1) By account manager (group head). Every roster client rolls up under
    // its manager even with nothing entered yet (so pending managers still show).
    const managers = new Map();
    for (const c of clients) {
      const mgr = amMap.get(c.id) || 'Unassigned';
      const e = managers.get(mgr) || { accountManager: mgr, actualAmount: 0, bestAmount: 0, billingLastMonth: 0, clientCount: 0 };
      e.actualAmount += forecastByClient.get(c.id) || 0;
      const b = budgetByClient.get(c.id);
      if (b) {
        e.bestAmount += b.bestAmount != null ? Number(b.bestAmount) : 0;
        e.billingLastMonth += b.billingLastMonth != null ? Number(b.billingLastMonth) : 0;
      }
      e.clientCount += 1;
      managers.set(mgr, e);
    }
    const byManager = [...managers.values()]
      .map((m) => ({
        accountManager: m.accountManager,
        clientCount: m.clientCount,
        actualAmount: Number(m.actualAmount.toFixed(2)),
        bestAmount: Number(m.bestAmount.toFixed(2)),
        billingLastMonth: Number(m.billingLastMonth.toFixed(2)),
      }))
      .sort((a, b) => b.actualAmount - a.actualAmount || a.accountManager.localeCompare(b.accountManager));
    const managerTotals = byManager.reduce(
      (t, m) => ({ actual: t.actual + m.actualAmount, best: t.best + m.bestAmount, billing: t.billing + m.billingLastMonth }),
      { actual: 0, best: 0, billing: 0 },
    );

    // ── 2) By channel: total forecast per ChannelMaster (respects medium/channel filters).
    const channelIds = byChannelF.map((g) => g.channelMasterId).filter((v) => v != null);
    const channels = await prisma.channelMaster.findMany({ where: { id: { in: channelIds } }, select: { id: true, name: true, medium: true } });
    const chMap = new Map(channels.map((c) => [c.id, c]));
    let byChannel = byChannelF.map((g) => {
      const ch = g.channelMasterId != null ? chMap.get(g.channelMasterId) : null;
      return {
        channelMasterId: g.channelMasterId,
        channelName: ch?.name || 'Unlinked',
        medium: ch?.medium || '',
        forecastAmount: Number(((Number(g._sum.amountMillions) || 0) * 1e6).toFixed(2)),
      };
    });
    if (filters.medium) byChannel = byChannel.filter((r) => r.medium === filters.medium);
    if (filters.channelMasterId) byChannel = byChannel.filter((r) => r.channelMasterId === filters.channelMasterId);
    byChannel.sort((a, b) => (MEDIUM_ORDER.indexOf(a.medium) - MEDIUM_ORDER.indexOf(b.medium)) || a.channelName.localeCompare(b.channelName));
    const channelTotalAmount = byChannel.reduce((s, r) => s + r.forecastAmount, 0);

    return res.json({
      year,
      month,
      byManager,
      managerTotals: {
        actualAmount: Number(managerTotals.actual.toFixed(2)),
        bestAmount: Number(managerTotals.best.toFixed(2)),
        billingLastMonth: Number(managerTotals.billing.toFixed(2)),
      },
      byChannel,
      channelTotalAmount: Number(channelTotalAmount.toFixed(2)),
    });
  } catch (error) {
    console.error('getInsightsBudget error:', error);
    return res.status(500).json({ error: 'Failed to build budget insights', detail: error.message });
  }
}

// Spec §2 + §3: forecast vs actual, grouped by client or by individual channel.
export async function getInsightsVariance(req, res) {
  try {
    const filters = await resolveInsightFilters(req);
    const groupBy = req.query.groupBy === 'channel' ? 'channel' : 'client';
    const fWhere = buildForecastWhere(filters);
    const aWhere = buildScheduleWhere(filters);
    const by = groupBy === 'channel' ? 'channelMasterId' : 'clientId';

    const [fRows, aRows] = await Promise.all([
      prisma.monthlyForecast.groupBy({ by: [by], where: fWhere, _sum: { amountMillions: true } }),
      prisma.scheduleLog.groupBy({ by: [by], where: aWhere, _sum: { scheduleValue: true } }),
    ]);

    const map = new Map();
    for (const r of fRows) map.set(r[by], { key: r[by], forecast: Number(r._sum.amountMillions) || 0, actual: 0 });
    for (const r of aRows) {
      const e = map.get(r[by]) || { key: r[by], forecast: 0, actual: 0 };
      e.actual = (Number(r._sum.scheduleValue) || 0) / 1e6;
      map.set(r[by], e);
    }
    const entries = [...map.values()];

    let nameMap = new Map();
    let amMap = new Map();
    if (groupBy === 'client') {
      const clientIds = entries.map((e) => e.key);
      const clients = await prisma.client.findMany({
        where: { id: { in: clientIds } },
        select: { id: true, name: true, agency: { select: { name: true } } },
      });
      nameMap = new Map(clients.map((c) => [c.id, c]));
      amMap = await accountManagerByClient(clientIds);
    } else {
      const channelIds = entries.map((e) => e.key).filter((v) => v != null);
      const channels = await prisma.channelMaster.findMany({
        where: { id: { in: channelIds } },
        select: { id: true, name: true, medium: true },
      });
      nameMap = new Map(channels.map((c) => [c.id, c]));
    }

    const rows = entries.map((e) => {
      const forecastMillions = Number(e.forecast.toFixed(2));
      const actualMillions = Number(e.actual.toFixed(2));
      const varianceMillions = Number((actualMillions - forecastMillions).toFixed(2));
      const variancePct = forecastMillions > 0 ? Number(((varianceMillions / forecastMillions) * 100).toFixed(1)) : null;
      const flag = variancePct == null ? 'zero' : varianceMillions > 0 ? 'positive' : varianceMillions < 0 ? 'negative' : 'zero';

      if (groupBy === 'client') {
        const c = nameMap.get(e.key);
        return {
          clientId: e.key,
          clientName: c?.name || `#${e.key}`,
          agencyName: c?.agency?.name || '',
          accountManager: amMap.get(e.key) || 'Unassigned',
          forecastMillions, actualMillions, varianceMillions, variancePct, flag,
        };
      }
      const ch = e.key != null ? nameMap.get(e.key) : null;
      return {
        channelMasterId: e.key,
        channelName: ch?.name || 'Unlinked',
        medium: ch?.medium || '',
        forecastMillions, actualMillions, varianceMillions, variancePct, flag,
      };
    });

    rows.sort((a, b) => groupBy === 'client'
      ? a.clientName.localeCompare(b.clientName)
      : (MEDIUM_ORDER.indexOf(a.medium) - MEDIUM_ORDER.indexOf(b.medium)) || a.channelName.localeCompare(b.channelName));

    const totals = rows.reduce((t, r) => ({ f: t.f + r.forecastMillions, a: t.a + r.actualMillions }), { f: 0, a: 0 });
    const totalVariance = Number((totals.a - totals.f).toFixed(2));

    return res.json({
      year: filters.year,
      month: filters.month,
      groupBy,
      rows,
      totals: {
        forecastMillions: Number(totals.f.toFixed(2)),
        actualMillions: Number(totals.a.toFixed(2)),
        varianceMillions: totalVariance,
        variancePct: totals.f > 0 ? Number(((totalVariance / totals.f) * 100).toFixed(1)) : null,
      },
    });
  } catch (error) {
    console.error('getInsightsVariance error:', error);
    return res.status(500).json({ error: 'Failed to build forecast vs actual insights', detail: error.message });
  }
}

// Spec §4: accuracy dashboard cards for a single resolved month.
export async function getInsightsAccuracy(req, res) {
  try {
    const filters = await resolveInsightFilters(req);
    const fWhere = buildForecastWhere(filters);
    const aWhere = buildScheduleWhere(filters);

    const [fRows, aRows] = await Promise.all([
      prisma.monthlyForecast.groupBy({ by: ['clientId'], where: fWhere, _sum: { amountMillions: true } }),
      prisma.scheduleLog.groupBy({ by: ['clientId'], where: aWhere, _sum: { scheduleValue: true } }),
    ]);
    const map = new Map();
    for (const r of fRows) map.set(r.clientId, { clientId: r.clientId, forecast: Number(r._sum.amountMillions) || 0, actual: 0 });
    for (const r of aRows) {
      const e = map.get(r.clientId) || { clientId: r.clientId, forecast: 0, actual: 0 };
      e.actual = (Number(r._sum.scheduleValue) || 0) / 1e6;
      map.set(r.clientId, e);
    }
    const entries = [...map.values()];
    const clients = await prisma.client.findMany({
      where: { id: { in: entries.map((e) => e.clientId) } },
      select: { id: true, name: true },
    });
    const cMap = new Map(clients.map((c) => [c.id, c]));

    const rows = entries.map((e) => {
      const forecastMillions = Number(e.forecast.toFixed(2));
      const actualMillions = Number(e.actual.toFixed(2));
      const accuracyPct = forecastMillions > 0
        ? Number(Math.max(0, Math.min(100, (1 - Math.abs(forecastMillions - actualMillions) / forecastMillions) * 100)).toFixed(1))
        : null;
      return {
        clientId: e.clientId,
        clientName: cMap.get(e.clientId)?.name || `#${e.clientId}`,
        forecastMillions,
        actualMillions,
        accuracyPct,
      };
    });

    const totals = rows.reduce((t, r) => ({ f: t.f + r.forecastMillions, a: t.a + r.actualMillions }), { f: 0, a: 0 });
    const totalForecastMillions = Number(totals.f.toFixed(2));
    const totalActualMillions = Number(totals.a.toFixed(2));
    const totalVarianceMillions = Number((totalActualMillions - totalForecastMillions).toFixed(2));
    const forecastAccuracyPct = totalForecastMillions > 0
      ? Number(Math.max(0, Math.min(100, (1 - Math.abs(totalVarianceMillions) / totalForecastMillions) * 100)).toFixed(1))
      : null;

    const withForecast = rows.filter((r) => r.forecastMillions > 0 && r.accuracyPct != null);
    const bestClient = withForecast.length ? withForecast.reduce((a, b) => (b.accuracyPct > a.accuracyPct ? b : a)) : null;
    const leastAccurateClient = withForecast.length ? withForecast.reduce((a, b) => (b.accuracyPct < a.accuracyPct ? b : a)) : null;
    const highestSpendingClient = rows.length ? rows.reduce((a, b) => (b.actualMillions > a.actualMillions ? b : a)) : null;

    return res.json({
      year: filters.year,
      month: filters.month,
      totals: {
        forecastMillions: totalForecastMillions,
        actualMillions: totalActualMillions,
        varianceMillions: totalVarianceMillions,
        forecastAccuracyPct,
      },
      bestClient: bestClient && { clientId: bestClient.clientId, clientName: bestClient.clientName, accuracyPct: bestClient.accuracyPct },
      leastAccurateClient: leastAccurateClient && { clientId: leastAccurateClient.clientId, clientName: leastAccurateClient.clientName, accuracyPct: leastAccurateClient.accuracyPct },
      highestSpendingClient: highestSpendingClient && { clientId: highestSpendingClient.clientId, clientName: highestSpendingClient.clientName, actualMillions: highestSpendingClient.actualMillions },
    });
  } catch (error) {
    console.error('getInsightsAccuracy error:', error);
    return res.status(500).json({ error: 'Failed to build accuracy dashboard', detail: error.message });
  }
}

// Spec §5 + §6: month-by-month trend (walking back from the resolved month) plus
// top-10 channels/clients by actual spend over that same range.
export async function getInsightsTrend(req, res) {
  try {
    const filters = await resolveInsightFilters(req);
    const months = Math.min(36, Math.max(1, parseInt(req.query.months) || 12));

    const monthList = [];
    let cursor = { year: filters.year, month: filters.month };
    for (let i = 0; i < months; i++) {
      monthList.push(cursor);
      cursor = prevMonth(cursor.year, cursor.month);
    }
    monthList.reverse(); // oldest first

    const points = [];
    let prevActual = null;
    for (const ym of monthList) {
      const f = { ...filters, year: ym.year, month: ym.month };
      const [fAgg, aAgg] = await Promise.all([
        prisma.monthlyForecast.aggregate({ where: buildForecastWhere(f), _sum: { amountMillions: true } }),
        prisma.scheduleLog.aggregate({ where: buildScheduleWhere(f), _sum: { scheduleValue: true } }),
      ]);
      const forecastMillions = Number((Number(fAgg._sum.amountMillions) || 0).toFixed(2));
      const actualMillions = Number(((Number(aAgg._sum.scheduleValue) || 0) / 1e6).toFixed(2));
      const varianceMillions = Number((actualMillions - forecastMillions).toFixed(2));
      const growthPct = prevActual != null && prevActual > 0
        ? Number((((actualMillions - prevActual) / prevActual) * 100).toFixed(1))
        : null;
      points.push({
        year: ym.year,
        month: ym.month,
        label: new Date(ym.year, ym.month - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }),
        forecastMillions,
        actualMillions,
        varianceMillions,
        growthPct,
      });
      prevActual = actualMillions;
    }

    const scheduleMonths = monthList.map((ym) => monthKey(ym.year, ym.month));
    const rangeWhere = { isDeleted: false, scheduleMonth: { in: scheduleMonths } };
    if (filters.clientIds) rangeWhere.clientId = { in: filters.clientIds };
    if (filters.agencyId) rangeWhere.agencyId = filters.agencyId;
    if (filters.channelMasterId) rangeWhere.channelMasterId = filters.channelMasterId;
    if (filters.medium) rangeWhere.medium = filters.medium;

    const [byChannel, byClient] = await Promise.all([
      prisma.scheduleLog.groupBy({
        by: ['channelMasterId'], where: rangeWhere, _sum: { scheduleValue: true },
        orderBy: { _sum: { scheduleValue: 'desc' } }, take: 10,
      }),
      prisma.scheduleLog.groupBy({
        by: ['clientId'], where: rangeWhere, _sum: { scheduleValue: true },
        orderBy: { _sum: { scheduleValue: 'desc' } }, take: 10,
      }),
    ]);

    const [channels, clients] = await Promise.all([
      prisma.channelMaster.findMany({ where: { id: { in: byChannel.map((r) => r.channelMasterId).filter((v) => v != null) } }, select: { id: true, name: true, medium: true } }),
      prisma.client.findMany({ where: { id: { in: byClient.map((r) => r.clientId) } }, select: { id: true, name: true } }),
    ]);
    const chMap = new Map(channels.map((c) => [c.id, c]));
    const clMap = new Map(clients.map((c) => [c.id, c]));

    const topChannels = byChannel.map((r) => ({
      channelMasterId: r.channelMasterId,
      channelName: chMap.get(r.channelMasterId)?.name || 'Unlinked',
      medium: chMap.get(r.channelMasterId)?.medium || '',
      actualMillions: Number(((Number(r._sum.scheduleValue) || 0) / 1e6).toFixed(2)),
    }));
    const topClients = byClient.map((r) => ({
      clientId: r.clientId,
      clientName: clMap.get(r.clientId)?.name || `#${r.clientId}`,
      actualMillions: Number(((Number(r._sum.scheduleValue) || 0) / 1e6).toFixed(2)),
    }));

    return res.json({ months: points, topChannels, topClients });
  } catch (error) {
    console.error('getInsightsTrend error:', error);
    return res.status(500).json({ error: 'Failed to build trend analysis', detail: error.message });
  }
}
