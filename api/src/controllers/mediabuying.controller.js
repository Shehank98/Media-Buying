import prisma from '../utils/prisma.js';

function safeNum(v) {
  if (v == null) return null;
  return Number(v);
}

function currentYear() {
  return new Date().getFullYear();
}

function trend(curr, prev) {
  if (!prev) return 'flat';
  const a = safeNum(curr.discountPct) + safeNum(curr.bonusPct);
  const b = safeNum(prev.discountPct) + safeNum(prev.bonusPct);
  if (a > b) return 'up';
  if (a < b) return 'down';
  return 'flat';
}

export async function getChannelIntelligence(req, res) {
  try {
    const channelMasterId = parseInt(req.params.channelMasterId);
    const year = req.query.year ? parseInt(req.query.year) : currentYear();

    const channel = await prisma.channelMaster.findUnique({
      where: { id: channelMasterId },
      select: { id: true, name: true, medium: true },
    });
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const agencyDealRows = await prisma.channelAgencyDeal.findMany({
      where: { channelMasterId },
      orderBy: { year: 'desc' },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    const agencyDeals = agencyDealRows.map((d, idx) => ({
      id: d.id,
      year: d.year,
      discountPct: safeNum(d.discountPct),
      bonusPct: safeNum(d.bonusPct),
      notes: d.notes || '',
      createdBy: d.createdBy?.name || 'Unknown',
      updatedAt: d.updatedAt,
      trend: idx < agencyDealRows.length - 1 ? trend(d, agencyDealRows[idx + 1]) : 'flat',
    }));

    const monthFrom = `${year}-01`;
    const monthTo = `${year}-12`;
    const grouped = await prisma.scheduleLog.groupBy({
      by: ['clientId'],
      where: { channelMasterId, isDeleted: false, scheduleMonth: { gte: monthFrom, lte: monthTo } },
      _sum: { scheduleValue: true },
    });

    const clientDealRows = await prisma.channelClientDeal.findMany({
      where: { channelMasterId, year },
    });
    const dealByClient = new Map(clientDealRows.map((d) => [d.clientId, d]));

    const clients = await Promise.all(grouped.map(async (g) => {
      const client = await prisma.client.findUnique({
        where: { id: g.clientId },
        include: { agency: { select: { id: true, name: true } } },
      });
      const yearlySpend = safeNum(g._sum.scheduleValue) || 0;
      const deal = dealByClient.get(g.clientId);
      return {
        clientId: g.clientId,
        clientName: client?.name || 'Unknown',
        agencyName: client?.agency?.name || 'Unknown',
        yearlySpend,
        monthlyAvg: yearlySpend / 12,
        discountPct: deal ? safeNum(deal.discountPct) : null,
        bonusPct: deal ? safeNum(deal.bonusPct) : null,
        dealId: deal?.id || null,
        notes: deal?.notes || '',
        year,
      };
    }));

    clients.sort((a, b) => b.yearlySpend - a.yearlySpend);

    return res.json({ channel, year, agencyDeals, clients });
  } catch (error) {
    console.error('getChannelIntelligence error:', error);
    return res.status(500).json({ error: 'Failed to get channel intelligence', detail: error.message });
  }
}

export async function getClientChannelMonthly(req, res) {
  try {
    const channelMasterId = parseInt(req.params.channelMasterId);
    const clientId = parseInt(req.params.clientId);
    const year = req.query.year ? parseInt(req.query.year) : currentYear();
    const monthFrom = `${year}-01`;
    const monthTo = `${year}-12`;

    const rows = await prisma.scheduleLog.groupBy({
      by: ['scheduleMonth'],
      where: { channelMasterId, clientId, isDeleted: false, scheduleMonth: { gte: monthFrom, lte: monthTo } },
      _sum: { scheduleValue: true },
      orderBy: { scheduleMonth: 'asc' },
    });

    return res.json(rows.map((r) => ({
      month: r.scheduleMonth,
      scheduleValue: safeNum(r._sum.scheduleValue) || 0,
    })));
  } catch (error) {
    console.error('getClientChannelMonthly error:', error);
    return res.status(500).json({ error: 'Failed to get monthly breakdown', detail: error.message });
  }
}

export async function upsertAgencyDeal(req, res) {
  try {
    const { channelMasterId, year, discountPct, bonusPct, notes } = req.body;
    if (!channelMasterId || !year || discountPct == null || bonusPct == null) {
      return res.status(400).json({ error: 'channelMasterId, year, discountPct, bonusPct are required' });
    }
    const deal = await prisma.channelAgencyDeal.upsert({
      where: { channelMasterId_year: { channelMasterId: parseInt(channelMasterId), year: parseInt(year) } },
      update: { discountPct, bonusPct, notes: notes || null },
      create: {
        channelMasterId: parseInt(channelMasterId),
        year: parseInt(year),
        discountPct,
        bonusPct,
        notes: notes || null,
        createdById: req.user.id,
      },
    });
    return res.json(deal);
  } catch (error) {
    console.error('upsertAgencyDeal error:', error);
    return res.status(500).json({ error: 'Failed to save agency deal', detail: error.message });
  }
}

export async function deleteAgencyDeal(req, res) {
  try {
    const id = parseInt(req.params.id);
    await prisma.channelAgencyDeal.delete({ where: { id } });
    return res.json({ success: true });
  } catch (error) {
    console.error('deleteAgencyDeal error:', error);
    return res.status(500).json({ error: 'Failed to delete agency deal', detail: error.message });
  }
}

export async function upsertClientDeal(req, res) {
  try {
    const { channelMasterId, clientId, year, discountPct, bonusPct, notes } = req.body;
    if (!channelMasterId || !clientId || !year || discountPct == null || bonusPct == null) {
      return res.status(400).json({ error: 'channelMasterId, clientId, year, discountPct, bonusPct are required' });
    }
    const deal = await prisma.channelClientDeal.upsert({
      where: {
        channelMasterId_clientId_year: {
          channelMasterId: parseInt(channelMasterId),
          clientId: parseInt(clientId),
          year: parseInt(year),
        },
      },
      update: { discountPct, bonusPct, notes: notes || null },
      create: {
        channelMasterId: parseInt(channelMasterId),
        clientId: parseInt(clientId),
        year: parseInt(year),
        discountPct,
        bonusPct,
        notes: notes || null,
        createdById: req.user.id,
      },
    });
    return res.json(deal);
  } catch (error) {
    console.error('upsertClientDeal error:', error);
    return res.status(500).json({ error: 'Failed to save client deal', detail: error.message });
  }
}

export async function deleteClientDeal(req, res) {
  try {
    const id = parseInt(req.params.id);
    await prisma.channelClientDeal.delete({ where: { id } });
    return res.json({ success: true });
  } catch (error) {
    console.error('deleteClientDeal error:', error);
    return res.status(500).json({ error: 'Failed to delete client deal', detail: error.message });
  }
}

export async function getNegotiationPlanner(req, res) {
  try {
    const channelMasterId = parseInt(req.params.channelMasterId);
    const year = req.query.year ? parseInt(req.query.year) : currentYear();
    const monthlyBudget = parseFloat(req.query.monthlyBudget) || 0;
    const projectedYearlySpend = monthlyBudget * 12;

    const monthFrom = `${year}-01`;
    const monthTo = `${year}-12`;
    const grouped = await prisma.scheduleLog.groupBy({
      by: ['clientId'],
      where: { channelMasterId, isDeleted: false, scheduleMonth: { gte: monthFrom, lte: monthTo } },
      _sum: { scheduleValue: true },
    });

    const clientDealRows = await prisma.channelClientDeal.findMany({ where: { channelMasterId, year } });
    const dealByClient = new Map(clientDealRows.map((d) => [d.clientId, d]));

    const clientsWithSpend = await Promise.all(grouped.map(async (g) => {
      const client = await prisma.client.findUnique({ where: { id: g.clientId }, select: { id: true, name: true } });
      const yearlySpend = safeNum(g._sum.scheduleValue) || 0;
      const deal = dealByClient.get(g.clientId);
      return {
        clientId: g.clientId,
        clientName: client?.name || 'Unknown',
        yearlySpend,
        discountPct: deal ? safeNum(deal.discountPct) : null,
        bonusPct: deal ? safeNum(deal.bonusPct) : null,
      };
    }));

    const spends = clientsWithSpend.map((c) => c.yearlySpend).sort((a, b) => a - b);
    let lowMax = 0;
    let midMax = 0;
    if (spends.length) {
      const p33 = spends[Math.floor(spends.length * 0.33)];
      const p66 = spends[Math.floor(spends.length * 0.66)];
      lowMax = p33;
      midMax = p66;
    }

    function tierOf(spend) {
      if (!spends.length) return 'Mid';
      if (spend <= lowMax) return 'Low';
      if (spend <= midMax) return 'Mid';
      return 'High';
    }

    const spendTier = tierOf(projectedYearlySpend);
    const comparableClients = clientsWithSpend.filter((c) => tierOf(c.yearlySpend) === spendTier);
    const dealsInTier = comparableClients.filter((c) => c.discountPct != null);

    const suggestedDiscountRange = dealsInTier.length
      ? { min: Math.min(...dealsInTier.map((c) => c.discountPct)), max: Math.max(...dealsInTier.map((c) => c.discountPct)) }
      : null;
    const suggestedBonusRange = dealsInTier.length
      ? { min: Math.min(...dealsInTier.map((c) => c.bonusPct)), max: Math.max(...dealsInTier.map((c) => c.bonusPct)) }
      : null;

    let agencyDealReference = await prisma.channelAgencyDeal.findUnique({
      where: { channelMasterId_year: { channelMasterId, year } },
    });
    if (!agencyDealReference) {
      agencyDealReference = await prisma.channelAgencyDeal.findFirst({
        where: { channelMasterId },
        orderBy: { year: 'desc' },
      });
    }

    return res.json({
      channelMasterId,
      year,
      monthlyBudget,
      projectedYearlySpend,
      spendTier,
      tierThresholds: { lowMax, midMax },
      suggestedDiscountRange,
      suggestedBonusRange,
      comparableClients: comparableClients.sort((a, b) => b.yearlySpend - a.yearlySpend),
      agencyDealReference: agencyDealReference
        ? {
            year: agencyDealReference.year,
            discountPct: safeNum(agencyDealReference.discountPct),
            bonusPct: safeNum(agencyDealReference.bonusPct),
            notes: agencyDealReference.notes || '',
          }
        : null,
    });
  } catch (error) {
    console.error('getNegotiationPlanner error:', error);
    return res.status(500).json({ error: 'Failed to compute negotiation plan', detail: error.message });
  }
}
