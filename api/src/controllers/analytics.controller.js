import prisma from '../utils/prisma.js';
import { getAccessibleClientIds } from '../middleware/access.js';

// Client ids the user may see (null = unrestricted, for SUPER_ADMIN).
// Covers MANAGER (agency clients), GROUP_HEAD (team + direct), PLANNER (direct).
async function clientScope(user) {
  if (!user || user.role === 'SUPER_ADMIN') return null;
  return getAccessibleClientIds(user.id, user.role);
}

BigInt.prototype.toJSON = function () { return Number(this); };

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

function lastYearStart() {
  return `${new Date().getFullYear() - 1}-01`;
}

function lastYearCurrentMonth() {
  const d = new Date();
  return `${d.getFullYear() - 1}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function prevMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthsBefore(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 - n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Anchor dashboard windows to the latest schedule month that actually has data
// (within the given scope), so historical-only datasets still populate the
// "this month" / YTD / YoY views instead of showing zeros for the calendar year.
// When `year` is given, the window is locked to that calendar year instead.
async function refPeriod(where, year) {
  if (year && /^\d{4}$/.test(String(year))) {
    const y = parseInt(year);
    // Locked to one calendar year. ys..ym = that whole year; cys..cye for YoY.
    return { ym: `${y}-12`, ys: `${y}-01`, lys: `${y - 1}-01`, lycm: `${y - 1}-12`, prevYm: `${y}-11`, year: y, cys: `${y}-01`, cye: `${y}-12`, all: false };
  }
  // "All": ys reaches the earliest data so ys..ym spans every year combined.
  const latest = await prisma.scheduleLog.findFirst({
    where,
    orderBy: { scheduleMonth: 'desc' },
    select: { scheduleMonth: true },
  });
  const ym = latest?.scheduleMonth && /^\d{4}-\d{2}$/.test(latest.scheduleMonth) ? latest.scheduleMonth : currentYM();
  const yr = parseInt(ym.slice(0, 4));
  return {
    ym,
    ys: '0001-01',                 // all-time start
    lys: `${yr - 1}-01`,           // YoY: previous full year
    lycm: `${yr - 1}-12`,
    prevYm: prevMonth(ym),
    year: yr,
    cys: `${yr}-01`,               // YoY: current (latest) full year
    cye: `${yr}-12`,
    all: true,
  };
}

// Distinct years that have data within a scope, newest first.
async function availableYears(where) {
  const rows = await prisma.scheduleLog.groupBy({ by: ['scheduleMonth'], where });
  const years = new Set();
  for (const r of rows) {
    const y = String(r.scheduleMonth || '').slice(0, 4);
    if (/^\d{4}$/.test(y)) years.add(y);
  }
  return [...years].sort().reverse();
}

function baseWhere(user) {
  const w = { isDeleted: false };
  if (user.role === 'MANAGER') {
    return { ...w, agency: { users: { some: { userId: user.id } } } };
  }
  return w;
}

async function agencyIdsForUser(user) {
  if (user.role !== 'MANAGER') return null;
  const access = await prisma.userAgencyAccess.findMany({
    where: { userId: user.id },
    select: { agencyId: true },
  });
  return access.map(a => a.agencyId);
}

// ── Executive Dashboard ───────────────────────────────────────────────────────

export async function getDashboardSummary(req, res) {
  try {
    const user = req.user;
    const { agencyId, year } = req.query;

    const where = { isDeleted: false };
    const ids = await agencyIdsForUser(user); // null = unrestricted (non-MANAGER)
    if (agencyId) {
      const aid = parseInt(agencyId);
      if (ids && !ids.includes(aid)) return res.status(403).json({ error: 'Access denied to this agency' });
      where.agencyId = aid;
    } else if (ids) {
      where.agencyId = { in: ids };
    }

    // Selected year → that year; "All" → all-time combined (ys reaches earliest).
    const { ym, ys, lys, lycm, cys, cye } = await refPeriod(where, year);
    const years = await availableYears(where);

    const sameMonthLastYear = `${parseInt(ym.slice(0, 4)) - 1}-${ym.slice(5)}`;

    // Spend Velocity is anchored to the CURRENT calendar month (e.g. June),
    // not the latest data month. We pick the most recent year that actually has
    // data for that calendar month (within scope) so the card reads as
    // "this June vs last June". When a year filter is set, lock to that year.
    const calMM = String(new Date().getMonth() + 1).padStart(2, '0');
    let velMonth;
    if (year && /^\d{4}$/.test(String(year))) {
      velMonth = `${parseInt(year)}-${calMM}`;
    } else {
      const vRow = await prisma.scheduleLog.findFirst({
        where: { ...where, scheduleMonth: { endsWith: `-${calMM}` } },
        orderBy: { scheduleMonth: 'desc' },
        select: { scheduleMonth: true },
      });
      velMonth = vRow?.scheduleMonth || ym;
    }
    const velPrevMonth = `${parseInt(velMonth.slice(0, 4)) - 1}-${velMonth.slice(5)}`;

    const [billingsThisMonth, billingsTotal, curYearAgg, lastYearYTD, activeClients, logsThisMonth, activeChannels, uploadsThisMonth, manualThisMonth, sameMonthLY, velThisMonthAgg, velPrevMonthAgg] =
      await Promise.all([
        prisma.scheduleLog.aggregate({ where: { ...where, scheduleMonth: ym }, _sum: { scheduleValue: true } }),
        // Headline total: all-time (All) or the selected year.
        prisma.scheduleLog.aggregate({ where: { ...where, scheduleMonth: { gte: ys, lte: ym } }, _sum: { scheduleValue: true } }),
        // YoY uses the current (or selected) full year vs the previous full year.
        prisma.scheduleLog.aggregate({ where: { ...where, scheduleMonth: { gte: cys, lte: cye } }, _sum: { scheduleValue: true } }),
        prisma.scheduleLog.aggregate({ where: { ...where, scheduleMonth: { gte: lys, lte: lycm } }, _sum: { scheduleValue: true } }),
        prisma.scheduleLog.findMany({ where: { ...where, scheduleMonth: { gte: ys, lte: ym } }, select: { clientId: true }, distinct: ['clientId'] }),
        prisma.scheduleLog.count({ where: { ...where, scheduleMonth: ym } }),
        prisma.scheduleLog.findMany({ where: { ...where, scheduleMonth: ym }, select: { channelMasterId: true }, distinct: ['channelMasterId'] }),
        prisma.uploadBatch.count({ where: { createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } } }),
        prisma.scheduleLog.count({ where: { ...where, scheduleMonth: ym, uploadBatchId: null } }),
        prisma.scheduleLog.aggregate({ where: { ...where, scheduleMonth: sameMonthLastYear }, _sum: { scheduleValue: true } }),
        prisma.scheduleLog.aggregate({ where: { ...where, scheduleMonth: velMonth }, _sum: { scheduleValue: true } }),
        prisma.scheduleLog.aggregate({ where: { ...where, scheduleMonth: velPrevMonth }, _sum: { scheduleValue: true } }),
      ]);

    const total = safeNum(billingsTotal._sum.scheduleValue) || 0;
    const curYear = safeNum(curYearAgg._sum.scheduleValue) || 0;
    const ly = safeNum(lastYearYTD._sum.scheduleValue) || 0;
    const yoy = ly > 0 ? Number(((curYear - ly) / ly * 100).toFixed(2)) : null;
    const sameMonthLYVal = safeNum(sameMonthLY._sum.scheduleValue) || 0;
    const velThisMonthVal = safeNum(velThisMonthAgg._sum.scheduleValue) || 0;
    const velPrevMonthVal = safeNum(velPrevMonthAgg._sum.scheduleValue) || 0;
    const velocityPct = velPrevMonthVal > 0 ? Number(((velThisMonthVal / velPrevMonthVal) * 100).toFixed(0)) : null;

    return res.json({
      billingsThisMonth: safeNum(billingsThisMonth._sum.scheduleValue) || 0,
      billingsYTD: total,
      yoyGrowthPct: yoy,
      activeClients: activeClients.length,
      logsThisMonth,
      activeChannelsThisMonth: activeChannels.length,
      uploadsThisMonth,
      manualEntriesThisMonth: manualThisMonth,
      availableYears: years,
      selectedYear: year && /^\d{4}$/.test(String(year)) ? parseInt(year) : null,
      referenceMonth: ym,
      sameMonthLastYear: sameMonthLYVal,
      velocityPct,
      velocityMonth: velMonth,
      velocityThisMonth: velThisMonthVal,
      velocitySameMonthLastYear: velPrevMonthVal,
    });
  } catch (error) {
    console.error('getDashboardSummary error:', error);
    return res.status(500).json({ error: 'Failed to get dashboard summary', detail: error.message });
  }
}

export async function getAgencyComparison(req, res) {
  try {
    const user = req.user;
    const ids = await agencyIdsForUser(user);
    const agencyWhere = ids ? { id: { in: ids } } : {};

    const agencies = await prisma.agency.findMany({ where: agencyWhere, orderBy: { name: 'asc' } });
    // Anchor to the selected year, or latest month with data across accessible agencies.
    const { ym, ys, lys, lycm, cys, cye } = await refPeriod({ isDeleted: false, ...(ids ? { agencyId: { in: ids } } : {}) }, req.query.year);
    const monthlyStart = monthsBefore(ym, 11);

    const result = await Promise.all(agencies.map(async (agency) => {
      const base = { isDeleted: false, agencyId: agency.id };
      const [ytdAgg, activeClients, activeChannels, curYearAgg, lastYearAgg, uploads, monthlyData] = await Promise.all([
        prisma.scheduleLog.aggregate({ where: { ...base, scheduleMonth: { gte: ys, lte: ym } }, _sum: { scheduleValue: true } }),
        prisma.scheduleLog.findMany({ where: { ...base, scheduleMonth: { gte: ys, lte: ym } }, select: { clientId: true }, distinct: ['clientId'] }),
        prisma.scheduleLog.findMany({ where: { ...base, scheduleMonth: { gte: ys, lte: ym } }, select: { channelMasterId: true }, distinct: ['channelMasterId'] }),
        prisma.scheduleLog.aggregate({ where: { ...base, scheduleMonth: { gte: cys, lte: cye } }, _sum: { scheduleValue: true } }),
        prisma.scheduleLog.aggregate({ where: { ...base, scheduleMonth: { gte: lys, lte: lycm } }, _sum: { scheduleValue: true } }),
        prisma.uploadBatch.count({ where: { agencyId: agency.id, createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } } }),
        prisma.scheduleLog.groupBy({
          by: ['scheduleMonth'],
          where: { ...base, scheduleMonth: { gte: monthlyStart, lte: ym } },
          _sum: { scheduleValue: true },
          orderBy: { scheduleMonth: 'asc' },
        }),
      ]);
      const ytd = safeNum(ytdAgg._sum.scheduleValue) || 0;
      const curYear = safeNum(curYearAgg._sum.scheduleValue) || 0;
      const ly = safeNum(lastYearAgg._sum.scheduleValue) || 0;
      return {
        agencyId: agency.id,
        agencyName: agency.name,
        ytdBillings: ytd,
        activeClients: activeClients.length,
        activeChannels: activeChannels.length,
        ytdGrowthPct: ly > 0 ? Number(((curYear - ly) / ly * 100).toFixed(2)) : null,
        uploadsThisMonth: uploads,
        monthly: monthlyData.map(m => ({ month: m.scheduleMonth, scheduleValue: safeNum(m._sum.scheduleValue) || 0 })),
      };
    }));

    return res.json(result);
  } catch (error) {
    console.error('getAgencyComparison error:', error);
    return res.status(500).json({ error: 'Failed to get agency comparison', detail: error.message });
  }
}

export async function getTopClients(req, res) {
  try {
    const user = req.user;
    const ids = await agencyIdsForUser(user);
    const scope = { isDeleted: false };
    if (ids) scope.agencyId = { in: ids };
    const { ym, ys, prevYm: pm } = await refPeriod(scope, req.query.year);
    const base = { ...scope, scheduleMonth: { gte: ys, lte: ym } };

    const grouped = await prisma.scheduleLog.groupBy({
      by: ['clientId'],
      where: base,
      _sum: { scheduleValue: true },
      orderBy: { _sum: { scheduleValue: 'desc' } },
      take: 10,
    });

    // 6-month spark series for the top clients (one query, pivoted in memory).
    const clientIds = grouped.map((g) => g.clientId);
    const sparkStart = monthsBefore(ym, 5);
    const sparkMonths = Array.from({ length: 6 }, (_, i) => monthsBefore(ym, 5 - i));
    const sparkRows = clientIds.length
      ? await prisma.scheduleLog.groupBy({
          by: ['clientId', 'scheduleMonth'],
          where: { ...scope, clientId: { in: clientIds }, scheduleMonth: { gte: sparkStart, lte: ym } },
          _sum: { scheduleValue: true },
        })
      : [];
    const sparkMap = {};
    for (const r of sparkRows) {
      (sparkMap[r.clientId] ||= {})[r.scheduleMonth] = safeNum(r._sum.scheduleValue) || 0;
    }

    const result = await Promise.all(grouped.map(async (g, idx) => {
      const client = await prisma.client.findUnique({ where: { id: g.clientId }, include: { agency: { select: { id: true, name: true } } } });
      const [currAgg, prevAgg] = await Promise.all([
        prisma.scheduleLog.aggregate({ where: { clientId: g.clientId, isDeleted: false, scheduleMonth: ym }, _sum: { scheduleValue: true } }),
        prisma.scheduleLog.aggregate({ where: { clientId: g.clientId, isDeleted: false, scheduleMonth: pm }, _sum: { scheduleValue: true } }),
      ]);
      const curr = safeNum(currAgg._sum.scheduleValue) || 0;
      const prev = safeNum(prevAgg._sum.scheduleValue) || 0;
      let momTrend = null, momDirection = 'same';
      if (prev > 0) { momTrend = Number(((curr - prev) / prev * 100).toFixed(2)); momDirection = momTrend > 0 ? 'up' : momTrend < 0 ? 'down' : 'same'; }
      return {
        rank: idx + 1,
        clientId: g.clientId,
        clientName: client?.name || 'Unknown',
        agencyId: client?.agency?.id,
        agencyName: client?.agency?.name || 'Unknown',
        ytdBilling: safeNum(g._sum.scheduleValue) || 0,
        currentMonthBilling: curr,
        momTrend,
        momDirection,
        spark: sparkMonths.map((m) => ({ m, v: sparkMap[g.clientId]?.[m] || 0 })),
      };
    }));

    return res.json(result);
  } catch (error) {
    console.error('getTopClients error:', error);
    return res.status(500).json({ error: 'Failed to get top clients', detail: error.message });
  }
}

export async function getTopChannels(req, res) {
  try {
    const user = req.user;
    const ids = await agencyIdsForUser(user);
    const scope = { isDeleted: false };
    if (ids) scope.agencyId = { in: ids };
    const { ym, ys, lys, lycm, cys, cye } = await refPeriod(scope, req.query.year);
    const base = { ...scope, scheduleMonth: { gte: ys, lte: ym } };

    const grouped = await prisma.scheduleLog.groupBy({
      by: ['channelMasterId'],
      where: base,
      _sum: { scheduleValue: true },
      orderBy: { _sum: { scheduleValue: 'desc' } },
      take: 10,
    });

    const result = await Promise.all(grouped.map(async (g, idx) => {
      const cm = await prisma.channelMaster.findUnique({ where: { id: g.channelMasterId }, include: { mediaGroup: { select: { name: true } } } });
      const agencyScope = ids ? { agencyId: { in: ids } } : {};
      const [clients, currAgg, curYearAgg, lastYearAgg] = await Promise.all([
        prisma.scheduleLog.findMany({ where: { channelMasterId: g.channelMasterId, isDeleted: false, scheduleMonth: { gte: ys, lte: ym } }, select: { clientId: true }, distinct: ['clientId'] }),
        prisma.scheduleLog.aggregate({ where: { channelMasterId: g.channelMasterId, isDeleted: false, scheduleMonth: ym, ...agencyScope }, _sum: { scheduleValue: true } }),
        prisma.scheduleLog.aggregate({ where: { channelMasterId: g.channelMasterId, isDeleted: false, scheduleMonth: { gte: cys, lte: cye }, ...agencyScope }, _sum: { scheduleValue: true } }),
        prisma.scheduleLog.aggregate({ where: { channelMasterId: g.channelMasterId, isDeleted: false, scheduleMonth: { gte: lys, lte: lycm }, ...agencyScope }, _sum: { scheduleValue: true } }),
      ]);
      const ytd = safeNum(g._sum.scheduleValue) || 0;
      const curYear = safeNum(curYearAgg._sum.scheduleValue) || 0;
      const ly = safeNum(lastYearAgg._sum.scheduleValue) || 0;
      return {
        rank: idx + 1,
        channelMasterId: g.channelMasterId,
        channelName: cm?.name || 'Unknown',
        medium: cm?.medium || '',
        mediaGroup: cm?.mediaGroup?.name || '',
        ytdSpend: ytd,
        currentMonthSpend: safeNum(currAgg._sum.scheduleValue) || 0,
        yoyChange: ly > 0 ? Number(((curYear - ly) / ly * 100).toFixed(2)) : null,
        clientCount: clients.length,
      };
    }));

    return res.json(result);
  } catch (error) {
    console.error('getTopChannels error:', error);
    return res.status(500).json({ error: 'Failed to get top channels', detail: error.message });
  }
}

export async function getMediumSplit(req, res) {
  try {
    const user = req.user;
    const { agencyId } = req.query;
    const base = { isDeleted: false };
    const aIds = await agencyIdsForUser(user);
    if (agencyId) {
      const aid = parseInt(agencyId);
      if (aIds && !aIds.includes(aid)) return res.status(403).json({ error: 'Access denied to this agency' });
      base.agencyId = aid;
    } else if (aIds) {
      base.agencyId = { in: aIds };
    }

    const { ym, ys, lys, lycm } = await refPeriod(base, req.query.year);

    const [cm, ytd, ly] = await Promise.all([
      prisma.scheduleLog.groupBy({ by: ['medium'], where: { ...base, scheduleMonth: ym }, _sum: { scheduleValue: true } }),
      prisma.scheduleLog.groupBy({ by: ['medium'], where: { ...base, scheduleMonth: { gte: ys, lte: ym } }, _sum: { scheduleValue: true } }),
      prisma.scheduleLog.groupBy({ by: ['medium'], where: { ...base, scheduleMonth: { gte: lys, lte: lycm } }, _sum: { scheduleValue: true } }),
    ]);

    function toSplit(rows) {
      const total = rows.reduce((s, r) => s + (safeNum(r._sum.scheduleValue) || 0), 0);
      return rows.map(r => ({ medium: r.medium, value: safeNum(r._sum.scheduleValue) || 0, pct: total > 0 ? Number(((safeNum(r._sum.scheduleValue) || 0) / total * 100).toFixed(2)) : 0 }));
    }

    return res.json({ currentMonth: toSplit(cm), ytd: toSplit(ytd), lastYearYtd: toSplit(ly) });
  } catch (error) {
    console.error('getMediumSplit error:', error);
    return res.status(500).json({ error: 'Failed to get medium split', detail: error.message });
  }
}

export async function getMonthlyTrend(req, res) {
  try {
    const user = req.user;
    const ids = await agencyIdsForUser(user);
    const { year } = req.query;
    const scope = { isDeleted: false };
    if (ids) scope.agencyId = { in: ids };
    // Selected year → that year's 12 months; "All" → every month across all years.
    let base;
    if (year && /^\d{4}$/.test(String(year))) {
      base = { ...scope, scheduleMonth: { gte: `${year}-01`, lte: `${year}-12` } };
    } else {
      base = { ...scope };
    }

    const combined = await prisma.scheduleLog.groupBy({
      by: ['scheduleMonth'],
      where: base,
      _sum: { scheduleValue: true },
      orderBy: { scheduleMonth: 'asc' },
    });

    const agencyBreakdown = await prisma.scheduleLog.groupBy({
      by: ['agencyId', 'scheduleMonth'],
      where: base,
      _sum: { scheduleValue: true },
      orderBy: { scheduleMonth: 'asc' },
    });

    const agencyList = await prisma.agency.findMany({
      where: ids ? { id: { in: ids } } : {},
      orderBy: { name: 'asc' },
    });

    const agencyMap = {};
    for (const r of agencyBreakdown) {
      if (!agencyMap[r.agencyId]) agencyMap[r.agencyId] = [];
      agencyMap[r.agencyId].push({ month: r.scheduleMonth, scheduleValue: safeNum(r._sum.scheduleValue) || 0 });
    }

    return res.json({
      combined: combined.map(r => ({ month: r.scheduleMonth, scheduleValue: safeNum(r._sum.scheduleValue) || 0 })),
      byAgency: agencyList.map(a => ({ agencyId: a.id, agencyName: a.name, data: agencyMap[a.id] || [] })),
    });
  } catch (error) {
    console.error('getMonthlyTrend error:', error);
    return res.status(500).json({ error: 'Failed to get monthly trend', detail: error.message });
  }
}

export async function getActivityLog(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page ?? '1'));
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit ?? '50')));

    const logs = await prisma.scheduleLog.findMany({
      where: { isDeleted: false },
      include: {
        uploader: { select: { name: true } },
        client: { select: { name: true } },
        agency: { select: { name: true } },
        channelMaster: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: (page - 1) * limit,
    });

    const total = await prisma.scheduleLog.count({ where: { isDeleted: false } });

    const items = logs.map(r => ({
      type: 'schedule_log',
      userName: r.uploader?.name || 'Unknown',
      agencyName: r.agency?.name || '',
      clientName: r.client?.name || '',
      action: r.uploadBatchId ? 'uploaded' : 'created',
      timestamp: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
      detail: `Schedule log for ${r.channelMaster?.name || '-'} - ${r.scheduleMonth} - LKR ${safeNum(r.scheduleValue)?.toLocaleString() || 0}`,
    }));

    return res.json({ items, total, page });
  } catch (error) {
    console.error('getActivityLog error:', error);
    return res.status(500).json({ error: 'Failed to get activity log', detail: error.message });
  }
}

export async function getRecentUploads(req, res) {
  try {
    const ids = await agencyIdsForUser(req.user);
    const batches = await prisma.uploadBatch.findMany({
      where: ids ? { agencyId: { in: ids } } : {},
      include: {
        uploader: { select: { name: true } },
        agency: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return res.json(batches.map(b => ({
      id: b.id,
      uploadedBy: b.uploader?.name || 'Unknown',
      agencyName: b.agency?.name || '',
      scheduleMonth: b.scheduleMonth,
      fileName: b.fileName,
      totalRows: b.totalRows,
      successfulRows: b.successfulRows,
      failedRows: b.failedRows,
      status: b.status,
      createdAt: b.createdAt instanceof Date ? b.createdAt.toISOString() : b.createdAt,
    })));
  } catch (error) {
    console.error('getRecentUploads error:', error);
    return res.status(500).json({ error: 'Failed to get recent uploads', detail: error.message });
  }
}

// ── Channel Intelligence ──────────────────────────────────────────────────────

export async function getChannelSummary(req, res) {
  try {
    const channelMasterId = parseInt(req.params.channelMasterId);
    const channel = await prisma.channelMaster.findUnique({ where: { id: channelMasterId }, include: { mediaGroup: { select: { name: true } } } });
    if (!channel) return res.status(404).json({ error: 'Channel master not found' });

    const base = { channelMasterId, isDeleted: false };
    // Scope to the user's accessible clients (MANAGER/GROUP_HEAD/PLANNER see only theirs).
    const cids = await clientScope(req.user);
    if (cids) base.clientId = { in: cids };
    // Anchor to the latest year that has data on this channel (not the calendar year).
    const { lys, lycm, cys, cye, year } = await refPeriod(base);

    const [curYearAgg, lyAgg, activeClients, totalEntries, monthAgg] = await Promise.all([
      prisma.scheduleLog.aggregate({ where: { ...base, scheduleMonth: { gte: cys, lte: cye } }, _sum: { scheduleValue: true } }),
      prisma.scheduleLog.aggregate({ where: { ...base, scheduleMonth: { gte: lys, lte: lycm } }, _sum: { scheduleValue: true } }),
      prisma.scheduleLog.findMany({ where: base, select: { clientId: true }, distinct: ['clientId'] }),
      prisma.scheduleLog.count({ where: base }),
      prisma.scheduleLog.groupBy({ by: ['scheduleMonth'], where: base, _sum: { scheduleValue: true } }),
    ]);

    const ytd = safeNum(curYearAgg._sum.scheduleValue) || 0;
    const ly = safeNum(lyAgg._sum.scheduleValue) || 0;

    // Per-year spend, one entry per year that has data (auto-expands as new
    // years are uploaded). Newest year first.
    const yearTotals = {};
    for (const r of monthAgg) {
      const y = String(r.scheduleMonth || '').slice(0, 4);
      if (!/^\d{4}$/.test(y)) continue;
      yearTotals[y] = (yearTotals[y] || 0) + (safeNum(r._sum.scheduleValue) || 0);
    }
    const byYear = Object.keys(yearTotals)
      .sort((a, b) => Number(b) - Number(a))
      .map(y => ({ year: Number(y), spend: yearTotals[y] }));

    return res.json({
      channel: { id: channel.id, name: channel.name, medium: channel.medium, mediaGroup: channel.mediaGroup?.name },
      latestYear: year,
      previousYear: year - 1,
      ytdSpend: ytd,
      lastYearSpend: ly,
      yoyGrowthPct: ly > 0 ? Number(((ytd - ly) / ly * 100).toFixed(2)) : null,
      activeClientsCount: activeClients.length,
      totalEntries,
      byYear,
    });
  } catch (error) {
    console.error('getChannelSummary error:', error);
    return res.status(500).json({ error: 'Failed to get channel summary', detail: error.message });
  }
}

export async function getChannelMonthlySpend(req, res) {
  try {
    const channelMasterId = parseInt(req.params.channelMasterId);
    const base = { channelMasterId, isDeleted: false };
    const cids = await clientScope(req.user);
    if (cids) base.clientId = { in: cids };

    const rows = await prisma.scheduleLog.groupBy({
      by: ['scheduleMonth'],
      where: base,
      _sum: { scheduleValue: true, scheduleValueWithVat: true },
      orderBy: { scheduleMonth: 'asc' },
    });

    return res.json(rows.map(r => ({
      month: r.scheduleMonth,
      scheduleValue: safeNum(r._sum.scheduleValue) || 0,
      scheduleValueWithVat: safeNum(r._sum.scheduleValueWithVat) || 0,
    })));
  } catch (error) {
    console.error('getChannelMonthlySpend error:', error);
    return res.status(500).json({ error: 'Failed to get monthly spend', detail: error.message });
  }
}

// Per-agency monthly spend on this channel (pivoted for a multi-line chart).
export async function getChannelAgencyMonthly(req, res) {
  try {
    const channelMasterId = parseInt(req.params.channelMasterId);
    const base = { channelMasterId, isDeleted: false };
    const cids = await clientScope(req.user);
    if (cids) base.clientId = { in: cids };

    const grouped = await prisma.scheduleLog.groupBy({
      by: ['agencyId', 'scheduleMonth'],
      where: base,
      _sum: { scheduleValue: true },
      orderBy: { scheduleMonth: 'asc' },
    });
    if (!grouped.length) return res.json({ agencies: [], data: [] });

    const agencyIds = [...new Set(grouped.map(g => g.agencyId))];
    const agencyRecs = await prisma.agency.findMany({ where: { id: { in: agencyIds } }, select: { id: true, name: true } });
    const nameById = new Map(agencyRecs.map(a => [a.id, a.name]));

    // Pivot: one row per month with a column per agency name.
    const months = [...new Set(grouped.map(g => g.scheduleMonth))].sort();
    const byMonth = {};
    for (const m of months) byMonth[m] = { month: m };
    for (const g of grouped) {
      const name = nameById.get(g.agencyId) || 'Unknown';
      byMonth[g.scheduleMonth][name] = safeNum(g._sum.scheduleValue) || 0;
    }
    // Agencies ordered by total spend (so the legend leads with the biggest).
    const totals = {};
    for (const g of grouped) { const n = nameById.get(g.agencyId) || 'Unknown'; totals[n] = (totals[n] || 0) + (safeNum(g._sum.scheduleValue) || 0); }
    const agencies = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);
    // Fill gaps with 0 so lines are continuous.
    const data = months.map(m => { const row = byMonth[m]; for (const a of agencies) if (row[a] == null) row[a] = 0; return row; });

    return res.json({ agencies, data });
  } catch (error) {
    console.error('getChannelAgencyMonthly error:', error);
    return res.status(500).json({ error: 'Failed to get agency monthly', detail: error.message });
  }
}

export async function getChannelClients(req, res) {
  try {
    const channelMasterId = parseInt(req.params.channelMasterId);
    const cids = await clientScope(req.user);
    const scope = { channelMasterId, isDeleted: false, ...(cids ? { clientId: { in: cids } } : {}) };

    const grouped = await prisma.scheduleLog.groupBy({
      by: ['clientId'],
      where: scope,
      _sum: { scheduleValue: true, scheduleValueWithVat: true },
      _count: true,
    });

    const result = await Promise.all(grouped.map(async (g) => {
      const client = await prisma.client.findUnique({ where: { id: g.clientId }, include: { agency: { select: { id: true, name: true } } } });
      const months = await prisma.scheduleLog.groupBy({
        by: ['scheduleMonth'],
        where: { channelMasterId, clientId: g.clientId, isDeleted: false },
      });
      const lastLog = await prisma.scheduleLog.findFirst({
        where: { channelMasterId, clientId: g.clientId, isDeleted: false },
        orderBy: { scheduleMonth: 'desc' },
        select: { scheduleMonth: true },
      });
      return {
        clientId: g.clientId,
        clientName: client?.name || 'Unknown',
        agencyId: client?.agency?.id,
        agencyName: client?.agency?.name || 'Unknown',
        totalScheduleValue: safeNum(g._sum.scheduleValue) || 0,
        totalScheduleValueWithVat: safeNum(g._sum.scheduleValueWithVat) || 0,
        entryCount: g._count,
        monthsActive: months.length,
        lastActive: lastLog?.scheduleMonth || null,
      };
    }));

    result.sort((a, b) => b.totalScheduleValue - a.totalScheduleValue);
    return res.json(result);
  } catch (error) {
    console.error('getChannelClients error:', error);
    return res.status(500).json({ error: 'Failed to get channel clients', detail: error.message });
  }
}

export async function getChannelPropertyHistory(req, res) {
  try {
    const channelMasterId = parseInt(req.params.channelMasterId);

    // Some client channels are free-text and not formally linked to a master
    // (channelMasterId is null). Match those by name/alias so their properties
    // still appear on the right channel-intelligence page.
    const master = await prisma.channelMaster.findUnique({
      where: { id: channelMasterId },
      select: { name: true, aliases: true },
    });
    const nameVariants = master ? [master.name, ...(master.aliases || [])].filter(Boolean) : [];
    const nameMatch = nameVariants.map((n) => ({ name: { equals: n, mode: 'insensitive' } }));

    const channelWhere = nameMatch.length
      ? { OR: [{ channelMasterId }, { channelMasterId: null, OR: nameMatch }] }
      : { channelMasterId };

    // Scope to the user's accessible clients (MANAGER/GROUP_HEAD/PLANNER see only theirs).
    const cids = await clientScope(req.user);
    const propertyWhere = cids
      ? { channel: { AND: [channelWhere, { clientId: { in: cids } }] } }
      : { channel: channelWhere };

    const properties = await prisma.property.findMany({
      where: propertyWhere,
      include: {
        channel: { select: { name: true, client: { select: { name: true, agency: { select: { name: true } } } } } },
        creator: { select: { name: true } },
        history: {
          include: { changer: { select: { name: true } } },
          orderBy: { changedAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const toDate = (d) => (d == null ? null : d instanceof Date ? d.toISOString() : d);

    const grouped = {};
    for (const p of properties) {
      const key = p.name;
      if (!grouped[key]) grouped[key] = [];
      // Audit-trail rate/term changes from PropertyHistory
      const changes = (p.history || []).map((h) => ({
        changedAt: toDate(h.changedAt),
        changedBy: h.changer?.name || 'Unknown',
        note: h.changeNote || '',
        previous: h.previousValues || {},
        next: h.newValues || {},
      }));
      grouped[key].push({
        id: p.id,
        type: p.type,
        category: p.category || null,
        cost: safeNum(p.cost) || 0,
        bonusValue: safeNum(p.bonusValue) || 0,
        bonusCount: Number(p.bonusCount || 0),
        bonusPct: safeNum(p.bonusPct),
        sponsorshipDetails: p.sponsorshipDetails || null,
        startDate: toDate(p.startDate),
        endDate: toDate(p.endDate),
        ongoing: !!p.startDate && !p.endDate,
        notes: p.notes || null,
        year: p.createdAt instanceof Date ? p.createdAt.getFullYear() : new Date(p.createdAt).getFullYear(),
        clientName: p.channel?.client?.name || '',
        agencyName: p.channel?.client?.agency?.name || '',
        creatorName: p.creator?.name || '',
        createdAt: toDate(p.createdAt),
        updatedAt: toDate(p.updatedAt),
        changes,
      });
    }

    const result = Object.entries(grouped).map(([name, entries]) => {
      entries.sort((a, b) => a.year - b.year || new Date(a.createdAt) - new Date(b.createdAt));
      for (let i = 1; i < entries.length; i++) {
        const prev = entries[i - 1].cost;
        const curr = entries[i].cost;
        if (prev > 0) {
          const pct = ((curr - prev) / prev) * 100;
          entries[i].changeFromPrev = Number(pct.toFixed(2));
          entries[i].changeDirection = pct > 0 ? 'up' : pct < 0 ? 'down' : 'same';
        }
      }
      const costs = entries.map((e) => e.cost).filter((c) => c > 0);
      const clientsSet = new Set(entries.map((e) => e.clientName).filter(Boolean));
      const totalChanges = entries.reduce((s, e) => s + (e.changes?.length || 0), 0);
      return {
        propertyName: name,
        entries,
        summary: {
          entryCount: entries.length,
          clientCount: clientsSet.size,
          clients: [...clientsSet],
          firstYear: entries[0]?.year ?? null,
          latestYear: entries[entries.length - 1]?.year ?? null,
          latestCost: entries[entries.length - 1]?.cost ?? 0,
          minCost: costs.length ? Math.min(...costs) : 0,
          maxCost: costs.length ? Math.max(...costs) : 0,
          totalChanges,
        },
      };
    });

    return res.json(result);
  } catch (error) {
    console.error('getChannelPropertyHistory error:', error);
    return res.status(500).json({ error: 'Failed to get property history', detail: error.message });
  }
}

// Client overview/dashboard: lifetime spend, tenure, and breakdowns by channel/medium/brand.
export async function getClientOverview(req, res) {
  try {
    const clientId = parseInt(req.params.clientId);
    const client = await prisma.client.findUnique({ where: { id: clientId }, include: { agency: { select: { id: true, name: true } } } });
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const logs = await prisma.scheduleLog.findMany({
      where: { clientId, isDeleted: false },
      select: {
        scheduleMonth: true, scheduleValue: true, scheduleValueWithVat: true,
        medium: true, brandName: true,
        channelMaster: { select: { id: true, name: true, medium: true } },
      },
    });

    let total = 0, totalVat = 0;
    const byMonth = {}, byChannel = {}, byMedium = {}, byBrand = {};
    const months = new Set();
    for (const l of logs) {
      const v = safeNum(l.scheduleValue) || 0;
      total += v; totalVat += safeNum(l.scheduleValueWithVat) || 0;
      const m = l.scheduleMonth;
      if (/^\d{4}-\d{2}$/.test(m)) {
        months.add(m);
        (byMonth[m] ||= { month: m, value: 0, count: 0 }).value += v; byMonth[m].count++;
      }
      const ch = l.channelMaster?.name || 'Unknown';
      (byChannel[ch] ||= { id: l.channelMaster?.id || null, name: ch, medium: l.channelMaster?.medium || l.medium, value: 0, count: 0 }).value += v; byChannel[ch].count++;
      const med = l.medium || 'Unknown';
      (byMedium[med] ||= { name: med, value: 0 }).value += v;
      const br = l.brandName || 'Unbranded';
      (byBrand[br] ||= { name: br, value: 0, count: 0 }).value += v; byBrand[br].count++;
    }
    const sortedMonths = [...months].sort();

    return res.json({
      client: { id: client.id, name: client.name, agencyId: client.agency?.id, agencyName: client.agency?.name },
      totalValue: Math.round(total),
      totalWithVat: Math.round(totalVat),
      totalEntries: logs.length,
      firstMonth: sortedMonths[0] || null,
      lastMonth: sortedMonths[sortedMonths.length - 1] || null,
      monthsActive: sortedMonths.length,
      channelCount: Object.keys(byChannel).length,
      brandCount: Object.keys(byBrand).filter(b => b !== 'Unbranded').length,
      byMonth: Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month)),
      byChannel: Object.values(byChannel).sort((a, b) => b.value - a.value),
      byMedium: Object.values(byMedium).sort((a, b) => b.value - a.value),
      byBrand: Object.values(byBrand).sort((a, b) => b.value - a.value),
    });
  } catch (error) {
    console.error('getClientOverview error:', error);
    return res.status(500).json({ error: 'Failed to get client overview', detail: error.message });
  }
}

// ── Executive Deep Dashboard (sponsorship / property investment analysis) ─────

export async function getDeepDashboard(req, res) {
  try {
    const user = req.user;
    const { agencyId, clientId, channelMasterId } = req.query;
    const allowed = await agencyIdsForUser(user); // null (unrestricted) or array
    if (agencyId && allowed && !allowed.includes(parseInt(agencyId))) {
      return res.status(403).json({ error: 'Access denied to this agency' });
    }

    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const round1 = (n) => Number(n.toFixed(1));

    // ── Spend comes ONLY from schedule logs (actual media investment) ──
    const logWhere = { isDeleted: false };
    if (agencyId) logWhere.agencyId = parseInt(agencyId);
    else if (allowed) logWhere.agencyId = { in: allowed };
    if (clientId) logWhere.clientId = parseInt(clientId);
    if (channelMasterId) logWhere.channelMasterId = parseInt(channelMasterId);

    const logs = await prisma.scheduleLog.findMany({
      where: logWhere,
      select: { scheduleMonth: true, scheduleValue: true, client: { select: { name: true } } },
    });

    const yearTotals = {};      // year -> total spend
    const trend = {};           // year -> [12] monthly spend
    const clientDist = {};      // client name -> total spend
    const logMonths = [];       // for first/last activity
    for (const l of logs) {
      if (!l.scheduleMonth) continue;
      const [yStr, mStr] = String(l.scheduleMonth).split('-');
      const y = Number(yStr), m = Number(mStr);
      if (!Number.isFinite(y) || !Number.isFinite(m)) continue;
      const v = safeNum(l.scheduleValue) || 0;
      yearTotals[y] = (yearTotals[y] || 0) + v;
      if (!trend[y]) trend[y] = Array(12).fill(0);
      trend[y][m - 1] += v;
      const cn = l.client?.name || 'Unknown';
      clientDist[cn] = (clientDist[cn] || 0) + v;
      logMonths.push(l.scheduleMonth);
    }

    const logYears = Object.keys(yearTotals).map(Number).sort((a, b) => a - b);
    const latestYear = logYears.length ? logYears[logYears.length - 1] : new Date().getFullYear();
    const previousYear = latestYear - 1;
    const currentYearSpend = yearTotals[latestYear] || 0;
    const previousYearSpend = yearTotals[previousYear] || 0;
    const yoyValue = currentYearSpend - previousYearSpend;
    const yoyPct = previousYearSpend > 0 ? round1((yoyValue / previousYearSpend) * 100) : null;
    const totalSpend = Object.values(yearTotals).reduce((s, v) => s + v, 0);

    const trendYears = logYears;
    const monthlyTrend = MONTHS.map((mn, i) => {
      const row = { month: mn };
      for (const y of trendYears) row[y] = trend[y][i];
      return row;
    });

    const clientDistribution = Object.entries(clientDist)
      .map(([client, value]) => ({ client, value }))
      .sort((a, b) => b.value - a.value);

    // ── Properties (sponsorship analysis only — NOT spend) ──
    const clientWhere = {};
    if (clientId) clientWhere.id = parseInt(clientId);
    if (agencyId) clientWhere.agencyId = parseInt(agencyId);
    else if (allowed) clientWhere.agencyId = { in: allowed };
    const channelWhere = {};
    if (channelMasterId) channelWhere.channelMasterId = parseInt(channelMasterId);
    if (Object.keys(clientWhere).length) channelWhere.client = clientWhere;

    const properties = await prisma.property.findMany({
      where: { channel: channelWhere },
      include: { channel: { include: { channelMaster: { select: { name: true } }, client: { select: { name: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
    const props = properties.map((p) => ({
      year: new Date(p.createdAt).getFullYear(),
      category: p.category || 'Uncategorized',
      type: p.type || '',
      name: p.name,
      value: safeNum(p.cost) || 0,
      bonusValue: safeNum(p.bonusValue) || 0,
      bonusCount: Number(p.bonusCount || 0),
      channel: p.channel.channelMaster?.name || p.channel.name,
      client: p.channel.client?.name || '',
      startDate: p.startDate,
      endDate: p.endDate,
      createdAt: p.createdAt,
    }));

    const catCount = {};
    for (const p of props) catCount[p.category] = (catCount[p.category] || 0) + 1;
    const mostPurchasedCategory = Object.keys(catCount).sort((a, b) => catCount[b] - catCount[a])[0] || null;
    const highest = props.reduce((m, p) => (!m || p.value > m.value ? p : m), null);
    const propTimes = props.map((p) => new Date(p.createdAt).getTime());

    return res.json({
      kpis: { totalSpend, currentYearSpend, previousYearSpend, yoyValue, yoyPct, latestYear, previousYear },
      monthlyTrend,
      trendYears,
      clientDistribution,
      properties: props.map((p) => ({
        year: p.year, category: p.category, type: p.type, name: p.name,
        value: p.value, bonusValue: p.bonusValue, bonusCount: p.bonusCount, channel: p.channel, client: p.client,
        startDate: p.startDate, endDate: p.endDate,
      })),
      channelInsights: {
        spendByYear: logYears.map((y) => ({ year: y, spend: yearTotals[y] })),
        totalProperties: props.length,
        totalBonusValue: props.reduce((s, p) => s + p.bonusValue, 0),
        avgPropertyValue: props.length ? props.reduce((s, p) => s + p.value, 0) / props.length : 0,
        mostPurchasedCategory,
        highestProperty: highest ? { name: highest.name, value: highest.value, category: highest.category } : null,
      },
      clientHistory: {
        firstDate: propTimes.length ? new Date(Math.min(...propTimes)).toISOString() : null,
        latestDate: propTimes.length ? new Date(Math.max(...propTimes)).toISOString() : null,
        yearsActive: logYears.length,
        lifetimeSpend: totalSpend,
        lifetimeBonusValue: props.reduce((s, p) => s + p.bonusValue, 0),
        totalProperties: props.length,
      },
      availableYears: [...new Set([...logYears, ...props.map((p) => p.year)])].sort((a, b) => a - b),
    });
  } catch (error) {
    console.error('getDeepDashboard error:', error);
    return res.status(500).json({ error: 'Failed to build deep dashboard', detail: error.message });
  }
}

// ── Forecasting dashboard (Annual Achievement + Monthly spend w/ forecast) ────

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Pick the year to report on: explicit ?year, else latest year with data, else
// the years that have a target, else the current calendar year.
async function resolveYear(reqYear, dataYears) {
  if (reqYear && /^\d{4}$/.test(String(reqYear))) return parseInt(reqYear);
  if (dataYears.length) return parseInt(dataYears[0]);
  const targetYears = await prisma.annualTarget.findMany({ select: { year: true }, orderBy: { year: 'desc' }, take: 1 });
  if (targetYears.length) return targetYears[0].year;
  return new Date().getFullYear();
}

// Years to offer in the selector = union of years with spend data and years with a target.
async function selectableYears(dataYears) {
  const targets = await prisma.annualTarget.findMany({ select: { year: true } });
  const set = new Set(dataYears.map(Number));
  for (const t of targets) set.add(t.year);
  return [...set].sort((a, b) => b - a);
}

export async function getAchievement(req, res) {
  try {
    const user = req.user;
    const ids = await agencyIdsForUser(user); // null = unrestricted (non-MANAGER)
    const scope = { isDeleted: false };
    if (ids) scope.agencyId = { in: ids };

    const dataYears = await availableYears(scope);
    const year = await resolveYear(req.query.year, dataYears);
    const years = await selectableYears(dataYears);

    const target = await prisma.annualTarget.findUnique({ where: { year } });
    const targetMillions = target ? Number(target.totalTargetMillions) : 0;
    const remoteMonth = target ? target.remoteMonth : null; // null = no target set

    // Actuals for the completed months (1 .. remoteMonth-1); when no target, the whole year.
    const lastActualMonth = remoteMonth ? remoteMonth - 1 : 12;
    let actualSum = 0;
    if (lastActualMonth >= 1) {
      const agg = await prisma.scheduleLog.aggregate({
        where: { ...scope, scheduleMonth: { gte: `${year}-01`, lte: `${year}-${String(lastActualMonth).padStart(2, '0')}` } },
        _sum: { scheduleValue: true },
      });
      actualSum = (safeNum(agg._sum.scheduleValue) || 0) / 1e6;
    }
    // Forecast for the remote month (sum of group-head submissions in scope).
    let forecastSum = 0;
    if (remoteMonth) {
      const fWhere = { year, month: remoteMonth };
      if (ids) fWhere.agencyId = { in: ids };
      const fAgg = await prisma.monthlyForecast.aggregate({ where: fWhere, _sum: { amountMillions: true } });
      forecastSum = safeNum(fAgg._sum.amountMillions) || 0;
    }

    const uptoTargetMillions = remoteMonth ? Number(((targetMillions / 12) * remoteMonth).toFixed(2)) : 0;
    const actualMillions = Number((actualSum + forecastSum).toFixed(2));
    const achievementPct = uptoTargetMillions > 0 ? Number(((actualMillions / uptoTargetMillions) * 100).toFixed(1)) : null;

    return res.json({
      year,
      hasTarget: !!target,
      targetMillions,
      remoteMonth,
      uptoMonthLabel: remoteMonth ? MONTH_NAMES[remoteMonth - 1] : null,
      uptoTargetMillions,
      actualMillions,
      forecastMillions: Number(forecastSum.toFixed(2)),
      achievementPct,
      availableYears: years,
    });
  } catch (error) {
    console.error('getAchievement error:', error);
    return res.status(500).json({ error: 'Failed to build achievement', detail: error.message });
  }
}

export async function getForecastMonthly(req, res) {
  try {
    const user = req.user;
    const ids = await agencyIdsForUser(user);
    const scope = { isDeleted: false };
    if (ids) scope.agencyId = { in: ids };

    const dataYears = await availableYears(scope);
    const year = await resolveYear(req.query.year, dataYears);
    const years = await selectableYears(dataYears);

    const target = await prisma.annualTarget.findUnique({ where: { year } });
    const remoteMonth = target ? target.remoteMonth : null;

    // Actual monthly sums (→ millions).
    const rows = await prisma.scheduleLog.groupBy({
      by: ['scheduleMonth'],
      where: { ...scope, scheduleMonth: { gte: `${year}-01`, lte: `${year}-12` } },
      _sum: { scheduleValue: true },
    });
    const actualByMonth = {};
    for (const r of rows) {
      const m = parseInt(String(r.scheduleMonth).slice(5));
      if (m >= 1 && m <= 12) actualByMonth[m] = (safeNum(r._sum.scheduleValue) || 0) / 1e6;
    }

    // Forecast total for the remote month.
    let remoteForecast = 0;
    if (remoteMonth) {
      const fWhere = { year, month: remoteMonth };
      if (ids) fWhere.agencyId = { in: ids };
      const fAgg = await prisma.monthlyForecast.aggregate({ where: fWhere, _sum: { amountMillions: true } });
      remoteForecast = safeNum(fAgg._sum.amountMillions) || 0;
    }

    const data = [];
    for (let m = 1; m <= 12; m++) {
      const month = `${year}-${String(m).padStart(2, '0')}`;
      if (remoteMonth && m === remoteMonth) {
        data.push({ month, label: MONTH_NAMES[m - 1], value: Number(remoteForecast.toFixed(2)), isForecast: true });
      } else if (remoteMonth && m > remoteMonth) {
        data.push({ month, label: MONTH_NAMES[m - 1], value: null, isForecast: false });
      } else {
        const v = actualByMonth[m];
        data.push({ month, label: MONTH_NAMES[m - 1], value: v != null ? Number(v.toFixed(2)) : null, isForecast: false });
      }
    }

    return res.json({ year, remoteMonth, availableYears: years, data });
  } catch (error) {
    console.error('getForecastMonthly error:', error);
    return res.status(500).json({ error: 'Failed to build monthly forecast', detail: error.message });
  }
}
