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
    const ym = currentYM();
    const ys = yearStart();
    const lys = lastYearStart();
    const lycm = lastYearCurrentMonth();

    const where = { isDeleted: false };
    if (agencyId) where.agencyId = parseInt(agencyId);
    else {
      const ids = await agencyIdsForUser(user);
      if (ids) where.agencyId = { in: ids };
    }

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
    const ym = currentYM();
    const ys = yearStart();
    const lys = lastYearStart();
    const lycm = lastYearCurrentMonth();

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
          where: { ...base, scheduleMonth: { gte: monthsAgo(12) } },
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
    const base = { isDeleted: false, scheduleMonth: { gte: yearStart() } };
    if (ids) base.agencyId = { in: ids };
    const ym = currentYM();
    const pm = prevMonth(ym);

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
    const base = { isDeleted: false, scheduleMonth: { gte: yearStart() } };
    if (ids) base.agencyId = { in: ids };

    const grouped = await prisma.scheduleLog.groupBy({
      by: ['channelMasterId'],
      where: base,
      _sum: { scheduleValue: true },
      orderBy: { _sum: { scheduleValue: 'desc' } },
      take: 10,
    });

    const result = await Promise.all(grouped.map(async (g, idx) => {
      const cm = await prisma.channelMaster.findUnique({ where: { id: g.channelMasterId }, include: { mediaGroup: { select: { name: true } } } });
      const clients = await prisma.scheduleLog.findMany({ where: { channelMasterId: g.channelMasterId, isDeleted: false, scheduleMonth: { gte: yearStart() } }, select: { clientId: true }, distinct: ['clientId'] });
      return {
        rank: idx + 1,
        channelMasterId: g.channelMasterId,
        channelName: cm?.name || 'Unknown',
        medium: cm?.medium || '',
        mediaGroup: cm?.mediaGroup?.name || '',
        ytdSpend: safeNum(g._sum.scheduleValue) || 0,
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
    if (agencyId) base.agencyId = parseInt(agencyId);
    else { const ids = await agencyIdsForUser(user); if (ids) base.agencyId = { in: ids }; }

    const ym = currentYM();
    const ys = yearStart();
    const lys = lastYearStart();
    const lycm = lastYearCurrentMonth();

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
    const base = { isDeleted: false, scheduleMonth: { gte: monthsAgo(24) } };
    if (ids) base.agencyId = { in: ids };

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
      detail: `Schedule log for ${r.channelMaster?.name || '—'} — ${r.scheduleMonth} — LKR ${safeNum(r.scheduleValue)?.toLocaleString() || 0}`,
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
    const properties = await prisma.property.findMany({
      where: { channel: { channelMasterId } },
      include: {
        channel: { select: { name: true, client: { select: { name: true, agency: { select: { name: true } } } } } },
        creator: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const grouped = {};
    for (const p of properties) {
      const key = p.name;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push({
        id: p.id,
        type: p.type,
        cost: safeNum(p.cost) || 0,
        bonusPct: safeNum(p.bonusPct),
        notes: p.notes || null,
        year: p.createdAt instanceof Date ? p.createdAt.getFullYear() : new Date(p.createdAt).getFullYear(),
        clientName: p.channel?.client?.name || '',
        agencyName: p.channel?.client?.agency?.name || '',
        creatorName: p.creator?.name || '',
        createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt,
      });
    }

    const result = Object.entries(grouped).map(([name, entries]) => {
      entries.sort((a, b) => a.year - b.year);
      for (let i = 1; i < entries.length; i++) {
        const prev = entries[i - 1].cost;
        const curr = entries[i].cost;
        if (prev > 0) {
          const pct = ((curr - prev) / prev) * 100;
          entries[i].changeFromPrev = Number(pct.toFixed(2));
          entries[i].changeDirection = pct > 0 ? 'up' : pct < 0 ? 'down' : 'same';
        }
      }
      return { propertyName: name, entries };
    });

    return res.json(result);
  } catch (error) {
    console.error('getChannelPropertyHistory error:', error);
    return res.status(500).json({ error: 'Failed to get property history', detail: error.message });
  }
}
