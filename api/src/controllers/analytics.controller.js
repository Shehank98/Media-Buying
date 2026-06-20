import prisma from '../utils/prisma.js';

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
async function refPeriod(where) {
  const latest = await prisma.scheduleLog.findFirst({
    where,
    orderBy: { scheduleMonth: 'desc' },
    select: { scheduleMonth: true },
  });
  const ym = latest?.scheduleMonth && /^\d{4}-\d{2}$/.test(latest.scheduleMonth) ? latest.scheduleMonth : currentYM();
  const year = parseInt(ym.slice(0, 4));
  const mm = ym.slice(5);
  return {
    ym,
    ys: `${year}-01`,
    lys: `${year - 1}-01`,
    lycm: `${year - 1}-${mm}`,
    prevYm: prevMonth(ym),
  };
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
    const { agencyId } = req.query;

    const where = { isDeleted: false };
    const ids = await agencyIdsForUser(user); // null = unrestricted (non-MANAGER)
    if (agencyId) {
      const aid = parseInt(agencyId);
      if (ids && !ids.includes(aid)) return res.status(403).json({ error: 'Access denied to this agency' });
      where.agencyId = aid;
    } else if (ids) {
      where.agencyId = { in: ids };
    }

    // Anchor to the latest month that has data within this scope.
    const { ym, ys, lys, lycm } = await refPeriod(where);

    const [billingsThisMonth, billingsYTD, lastYearYTD, activeClients, logsThisMonth, activeChannels, uploadsThisMonth, manualThisMonth] =
      await Promise.all([
        prisma.scheduleLog.aggregate({ where: { ...where, scheduleMonth: ym }, _sum: { scheduleValue: true } }),
        prisma.scheduleLog.aggregate({ where: { ...where, scheduleMonth: { gte: ys } }, _sum: { scheduleValue: true } }),
        prisma.scheduleLog.aggregate({ where: { ...where, scheduleMonth: { gte: lys, lte: lycm } }, _sum: { scheduleValue: true } }),
        prisma.scheduleLog.findMany({ where: { ...where, scheduleMonth: { gte: ys } }, select: { clientId: true }, distinct: ['clientId'] }),
        prisma.scheduleLog.count({ where: { ...where, scheduleMonth: ym } }),
        prisma.scheduleLog.findMany({ where: { ...where, scheduleMonth: ym }, select: { channelMasterId: true }, distinct: ['channelMasterId'] }),
        prisma.uploadBatch.count({ where: { createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } } }),
        prisma.scheduleLog.count({ where: { ...where, scheduleMonth: ym, uploadBatchId: null } }),
      ]);

    const ytd = safeNum(billingsYTD._sum.scheduleValue) || 0;
    const ly = safeNum(lastYearYTD._sum.scheduleValue) || 0;
    const yoy = ly > 0 ? Number(((ytd - ly) / ly * 100).toFixed(2)) : null;

    return res.json({
      billingsThisMonth: safeNum(billingsThisMonth._sum.scheduleValue) || 0,
      billingsYTD: ytd,
      yoyGrowthPct: yoy,
      activeClients: activeClients.length,
      logsThisMonth,
      activeChannelsThisMonth: activeChannels.length,
      uploadsThisMonth,
      manualEntriesThisMonth: manualThisMonth,
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
    // Anchor to the latest month that has data across the accessible agencies.
    const { ym, ys, lys, lycm } = await refPeriod({ isDeleted: false, ...(ids ? { agencyId: { in: ids } } : {}) });
    const monthlyStart = monthsBefore(ym, 11);

    const result = await Promise.all(agencies.map(async (agency) => {
      const base = { isDeleted: false, agencyId: agency.id };
      const [ytdAgg, activeClients, activeChannels, lastYearAgg, uploads, monthlyData] = await Promise.all([
        prisma.scheduleLog.aggregate({ where: { ...base, scheduleMonth: { gte: ys } }, _sum: { scheduleValue: true } }),
        prisma.scheduleLog.findMany({ where: { ...base, scheduleMonth: { gte: ys } }, select: { clientId: true }, distinct: ['clientId'] }),
        prisma.scheduleLog.findMany({ where: { ...base, scheduleMonth: { gte: ys } }, select: { channelMasterId: true }, distinct: ['channelMasterId'] }),
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
      const ly = safeNum(lastYearAgg._sum.scheduleValue) || 0;
      return {
        agencyId: agency.id,
        agencyName: agency.name,
        ytdBillings: ytd,
        activeClients: activeClients.length,
        activeChannels: activeChannels.length,
        ytdGrowthPct: ly > 0 ? Number(((ytd - ly) / ly * 100).toFixed(2)) : null,
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
    const { ym, ys, prevYm: pm } = await refPeriod(scope);
    const base = { ...scope, scheduleMonth: { gte: ys } };

    const grouped = await prisma.scheduleLog.groupBy({
      by: ['clientId'],
      where: base,
      _sum: { scheduleValue: true },
      orderBy: { _sum: { scheduleValue: 'desc' } },
      take: 10,
    });

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
    const { ym, ys, lys, lycm } = await refPeriod(scope);
    const base = { ...scope, scheduleMonth: { gte: ys } };

    const grouped = await prisma.scheduleLog.groupBy({
      by: ['channelMasterId'],
      where: base,
      _sum: { scheduleValue: true },
      orderBy: { _sum: { scheduleValue: 'desc' } },
      take: 10,
    });

    const result = await Promise.all(grouped.map(async (g, idx) => {
      const cm = await prisma.channelMaster.findUnique({ where: { id: g.channelMasterId }, include: { mediaGroup: { select: { name: true } } } });
      const [clients, currAgg, lastYearAgg] = await Promise.all([
        prisma.scheduleLog.findMany({ where: { channelMasterId: g.channelMasterId, isDeleted: false, scheduleMonth: { gte: ys } }, select: { clientId: true }, distinct: ['clientId'] }),
        prisma.scheduleLog.aggregate({ where: { channelMasterId: g.channelMasterId, isDeleted: false, scheduleMonth: ym, ...(ids ? { agencyId: { in: ids } } : {}) }, _sum: { scheduleValue: true } }),
        prisma.scheduleLog.aggregate({ where: { channelMasterId: g.channelMasterId, isDeleted: false, scheduleMonth: { gte: lys, lte: lycm }, ...(ids ? { agencyId: { in: ids } } : {}) }, _sum: { scheduleValue: true } }),
      ]);
      const ytd = safeNum(g._sum.scheduleValue) || 0;
      const ly = safeNum(lastYearAgg._sum.scheduleValue) || 0;
      return {
        rank: idx + 1,
        channelMasterId: g.channelMasterId,
        channelName: cm?.name || 'Unknown',
        medium: cm?.medium || '',
        mediaGroup: cm?.mediaGroup?.name || '',
        ytdSpend: ytd,
        currentMonthSpend: safeNum(currAgg._sum.scheduleValue) || 0,
        yoyChange: ly > 0 ? Number(((ytd - ly) / ly * 100).toFixed(2)) : null,
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

    const { ym, ys, lys, lycm } = await refPeriod(base);

    const [cm, ytd, ly] = await Promise.all([
      prisma.scheduleLog.groupBy({ by: ['medium'], where: { ...base, scheduleMonth: ym }, _sum: { scheduleValue: true } }),
      prisma.scheduleLog.groupBy({ by: ['medium'], where: { ...base, scheduleMonth: { gte: ys } }, _sum: { scheduleValue: true } }),
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
    const scope = { isDeleted: false };
    if (ids) scope.agencyId = { in: ids };
    // Show the latest 24 months that have data (falls back to calendar window).
    const { ym: refYm } = await refPeriod(scope);
    const base = { ...scope, scheduleMonth: { gte: monthsBefore(refYm, 23), lte: refYm } };

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
    const batches = await prisma.uploadBatch.findMany({
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

    const ys = yearStart();
    const lys = lastYearStart();
    const lycm = lastYearCurrentMonth();
    const base = { channelMasterId, isDeleted: false };

    const [ytdAgg, lyAgg, activeClients, totalEntries] = await Promise.all([
      prisma.scheduleLog.aggregate({ where: { ...base, scheduleMonth: { gte: ys } }, _sum: { scheduleValue: true } }),
      prisma.scheduleLog.aggregate({ where: { ...base, scheduleMonth: { gte: lys, lte: lycm } }, _sum: { scheduleValue: true } }),
      prisma.scheduleLog.findMany({ where: { ...base, scheduleMonth: { gte: ys } }, select: { clientId: true }, distinct: ['clientId'] }),
      prisma.scheduleLog.count({ where: base }),
    ]);

    const ytd = safeNum(ytdAgg._sum.scheduleValue) || 0;
    const ly = safeNum(lyAgg._sum.scheduleValue) || 0;

    return res.json({
      channel: { id: channel.id, name: channel.name, medium: channel.medium, mediaGroup: channel.mediaGroup?.name },
      ytdSpend: ytd,
      lastYearSpend: ly,
      yoyGrowthPct: ly > 0 ? Number(((ytd - ly) / ly * 100).toFixed(2)) : null,
      activeClientsCount: activeClients.length,
      totalEntries,
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

export async function getChannelClients(req, res) {
  try {
    const channelMasterId = parseInt(req.params.channelMasterId);

    const grouped = await prisma.scheduleLog.groupBy({
      by: ['clientId'],
      where: { channelMasterId, isDeleted: false },
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

    const properties = await prisma.property.findMany({
      where: { channel: channelWhere },
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
