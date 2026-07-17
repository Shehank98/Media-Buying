import prisma from '../utils/prisma.js';

function safeNum(v) {
  if (v == null) return null;
  return Number(v);
}

function trend(curr, prev) {
  if (!prev) return 'flat';
  const a = safeNum(curr.discountPct) + safeNum(curr.bonusPct);
  const b = safeNum(prev.discountPct) + safeNum(prev.bonusPct);
  if (a > b) return 'up';
  if (a < b) return 'down';
  return 'flat';
}

// Channel view is all-time now (no year filter) - each client shows lifetime
// spend on this channel plus the terms from their most recently recorded deal
// year (which may differ from the year they last actually bought).
export async function getChannelIntelligence(req, res) {
  try {
    const channelMasterId = parseInt(req.params.channelMasterId);

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

    const grouped = await prisma.scheduleLog.groupBy({
      by: ['clientId'],
      where: { channelMasterId, isDeleted: false },
      _sum: { scheduleValue: true },
    });

    // Most recent recorded deal per client (deals ordered desc, first seen wins).
    const allClientDeals = await prisma.channelClientDeal.findMany({
      where: { channelMasterId },
      orderBy: { year: 'desc' },
    });
    const latestDealByClient = new Map();
    for (const d of allClientDeals) {
      if (!latestDealByClient.has(d.clientId)) latestDealByClient.set(d.clientId, d);
    }

    // Prefetch all clients in one query (avoids an N+1 lookup per client).
    const clientRecords = grouped.length
      ? await prisma.client.findMany({
          where: { id: { in: grouped.map((g) => g.clientId) } },
          include: { agency: { select: { id: true, name: true } } },
        })
      : [];
    const clientById = new Map(clientRecords.map((c) => [c.id, c]));

    const clients = grouped.map((g) => {
      const client = clientById.get(g.clientId);
      const totalSpend = safeNum(g._sum.scheduleValue) || 0;
      const deal = latestDealByClient.get(g.clientId);
      return {
        clientId: g.clientId,
        clientName: client?.name || 'Unknown',
        agencyName: client?.agency?.name || 'Unknown',
        totalSpend,
        discountPct: deal ? safeNum(deal.discountPct) : null,
        bonusPct: deal ? safeNum(deal.bonusPct) : null,
        rateType: deal?.rateType || 'DISCOUNT',
        rateValue: deal && deal.rateValue != null ? safeNum(deal.rateValue) : null,
        dealYear: deal?.year ?? null,
        dealId: deal?.id || null,
        notes: deal?.notes || '',
        hasDeal: !!deal,
      };
    });

    clients.sort((a, b) => b.totalSpend - a.totalSpend);

    return res.json({ channel, agencyDeals, clients });
  } catch (error) {
    console.error('getChannelIntelligence error:', error);
    return res.status(500).json({ error: 'Failed to get channel intelligence', detail: error.message });
  }
}

// Per-client, per-year spend + that year's recorded discount/bonus - used by
// the expandable row in the Client Breakdown table (replaces the old
// month-by-month view now that the page has no year filter).
export async function getClientChannelYearly(req, res) {
  try {
    const channelMasterId = parseInt(req.params.channelMasterId);
    const clientId = parseInt(req.params.clientId);

    const rows = await prisma.scheduleLog.findMany({
      where: { channelMasterId, clientId, isDeleted: false },
      select: { scheduleMonth: true, scheduleValue: true },
    });
    const spendByYear = new Map();
    for (const r of rows) {
      const y = parseInt(r.scheduleMonth.slice(0, 4), 10);
      spendByYear.set(y, (spendByYear.get(y) || 0) + (safeNum(r.scheduleValue) || 0));
    }

    const deals = await prisma.channelClientDeal.findMany({ where: { channelMasterId, clientId } });
    const dealByYear = new Map(deals.map((d) => [d.year, d]));

    const years = new Set([...spendByYear.keys(), ...dealByYear.keys()]);
    const result = [...years].sort((a, b) => b - a).map((y) => {
      const deal = dealByYear.get(y);
      return {
        year: y,
        spend: spendByYear.get(y) || 0,
        discountPct: deal ? safeNum(deal.discountPct) : null,
        bonusPct: deal ? safeNum(deal.bonusPct) : null,
        rateType: deal?.rateType || 'DISCOUNT',
        rateValue: deal && deal.rateValue != null ? safeNum(deal.rateValue) : null,
        notes: deal?.notes || '',
      };
    });

    return res.json(result);
  } catch (error) {
    console.error('getClientChannelYearly error:', error);
    return res.status(500).json({ error: 'Failed to get yearly breakdown', detail: error.message });
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
    const rateType = ['DISCOUNT', 'CPRP', 'FLAT'].includes(req.body.rateType) ? req.body.rateType : 'DISCOUNT';
    const rateValue = rateType === 'DISCOUNT' ? null : (req.body.rateValue == null || req.body.rateValue === '' ? null : Number(req.body.rateValue));
    const deal = await prisma.channelClientDeal.upsert({
      where: {
        channelMasterId_clientId_year: {
          channelMasterId: parseInt(channelMasterId),
          clientId: parseInt(clientId),
          year: parseInt(year),
        },
      },
      update: { discountPct, bonusPct, rateType, rateValue, notes: notes || null },
      create: {
        channelMasterId: parseInt(channelMasterId),
        clientId: parseInt(clientId),
        year: parseInt(year),
        discountPct,
        bonusPct,
        rateType,
        rateValue,
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

// No year input - looks at every year a client has spend on this channel and
// averages discount/bonus across those years (missing-deal years count as 0%),
// so the suggested range reflects the full negotiating history, not one year.
export async function getNegotiationPlanner(req, res) {
  try {
    const channelMasterId = parseInt(req.params.channelMasterId);
    const monthlyBudget = parseFloat(req.query.monthlyBudget) || 0;
    const projectedYearlySpend = monthlyBudget * 12;

    const rows = await prisma.scheduleLog.findMany({
      where: { channelMasterId, isDeleted: false },
      select: { clientId: true, scheduleMonth: true, scheduleValue: true },
    });
    const spendByClientYear = new Map();
    for (const r of rows) {
      const y = parseInt(r.scheduleMonth.slice(0, 4), 10);
      if (!spendByClientYear.has(r.clientId)) spendByClientYear.set(r.clientId, new Map());
      const yearMap = spendByClientYear.get(r.clientId);
      yearMap.set(y, (yearMap.get(y) || 0) + (safeNum(r.scheduleValue) || 0));
    }

    const allClientDeals = await prisma.channelClientDeal.findMany({ where: { channelMasterId } });
    const dealByClientYear = new Map();
    for (const d of allClientDeals) {
      if (!dealByClientYear.has(d.clientId)) dealByClientYear.set(d.clientId, new Map());
      dealByClientYear.get(d.clientId).set(d.year, d);
    }

    // Prefetch client names in one query (avoids an N+1 lookup per client).
    const clientIds = [...spendByClientYear.keys()];
    const clientRecords = clientIds.length
      ? await prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true } })
      : [];
    const clientNameById = new Map(clientRecords.map((c) => [c.id, c.name]));

    const clientsWithSpend = [...spendByClientYear.entries()].map(([clientId, yearMap]) => {
      const years = [...yearMap.keys()];
      const totalSpend = years.reduce((sum, y) => sum + yearMap.get(y), 0);
      const dealsForClient = dealByClientYear.get(clientId) || new Map();
      // Average discount/bonus over the years that actually HAVE a recorded deal
      // (not over all spend-years) - so a client whose only deal is 2026 shows
      // its true 2026 terms instead of being diluted toward 0 by earlier
      // deal-less spend years.
      const dealYears = [...dealsForClient.keys()];
      const avgDiscountPct = dealYears.length
        ? dealYears.reduce((s, y) => s + (safeNum(dealsForClient.get(y).discountPct) || 0), 0) / dealYears.length
        : 0;
      const avgBonusPct = dealYears.length
        ? dealYears.reduce((s, y) => s + (safeNum(dealsForClient.get(y).bonusPct) || 0), 0) / dealYears.length
        : 0;
      return {
        clientId,
        clientName: clientNameById.get(clientId) || 'Unknown',
        avgYearlySpend: totalSpend / years.length,
        avgDiscountPct,
        avgBonusPct,
        yearsOfData: years.length,
        dealYears: dealYears.length,
      };
    });

    const spends = clientsWithSpend.map((c) => c.avgYearlySpend).sort((a, b) => a - b);
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
    const comparableClients = clientsWithSpend.filter((c) => tierOf(c.avgYearlySpend) === spendTier);

    const suggestedDiscountRange = comparableClients.length
      ? { min: Math.min(...comparableClients.map((c) => c.avgDiscountPct)), max: Math.max(...comparableClients.map((c) => c.avgDiscountPct)) }
      : null;
    const suggestedBonusRange = comparableClients.length
      ? { min: Math.min(...comparableClients.map((c) => c.avgBonusPct)), max: Math.max(...comparableClients.map((c) => c.avgBonusPct)) }
      : null;

    // Extra decision-support context: where this channel's clients sit overall,
    // beyond just the same-tier comparison set.
    const tierCounts = { Low: 0, Mid: 0, High: 0 };
    clientsWithSpend.forEach((c) => { tierCounts[tierOf(c.avgYearlySpend)]++; });
    const totalClientsOnChannel = clientsWithSpend.length;
    const overallAvgDiscountPct = totalClientsOnChannel
      ? clientsWithSpend.reduce((sum, c) => sum + c.avgDiscountPct, 0) / totalClientsOnChannel
      : null;
    const overallAvgBonusPct = totalClientsOnChannel
      ? clientsWithSpend.reduce((sum, c) => sum + c.avgBonusPct, 0) / totalClientsOnChannel
      : null;
    const highestYearlySpend = totalClientsOnChannel ? Math.max(...clientsWithSpend.map((c) => c.avgYearlySpend)) : null;
    const budgetPercentileRank = totalClientsOnChannel
      ? Math.round((spends.filter((s) => s <= projectedYearlySpend).length / totalClientsOnChannel) * 100)
      : null;

    const agencyDealReference = await prisma.channelAgencyDeal.findFirst({
      where: { channelMasterId },
      orderBy: { year: 'desc' },
    });

    return res.json({
      channelMasterId,
      monthlyBudget,
      projectedYearlySpend,
      spendTier,
      tierThresholds: { lowMax, midMax },
      suggestedDiscountRange,
      suggestedBonusRange,
      totalClientsOnChannel,
      tierCounts,
      overallAvgDiscountPct,
      overallAvgBonusPct,
      highestYearlySpend,
      budgetPercentileRank,
      comparableClients: comparableClients.sort((a, b) => b.avgYearlySpend - a.avgYearlySpend),
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

// Roll a channel's deals forward: copy the agency deal + every client deal from
// fromYear to toYear. Only creates rows that don't already exist for toYear (so
// it never overwrites terms already negotiated for the new year). SUPER_ADMIN.
export async function rollForwardDeals(req, res) {
  try {
    const channelMasterId = parseInt(req.params.channelMasterId);
    const fromYear = parseInt(req.body?.fromYear);
    const toYear = parseInt(req.body?.toYear);
    if (!Number.isInteger(channelMasterId) || !(fromYear >= 2000 && fromYear <= 2100) || !(toYear >= 2000 && toYear <= 2100) || toYear === fromYear) {
      return res.status(400).json({ error: 'channelMasterId and distinct fromYear/toYear (2000-2100) are required' });
    }

    // Agency-level deal
    let agencyCopied = 0, agencySkipped = 0;
    const srcAgency = await prisma.channelAgencyDeal.findUnique({ where: { channelMasterId_year: { channelMasterId, year: fromYear } } });
    if (srcAgency) {
      const existing = await prisma.channelAgencyDeal.findUnique({ where: { channelMasterId_year: { channelMasterId, year: toYear } } });
      if (existing) agencySkipped = 1;
      else {
        await prisma.channelAgencyDeal.create({ data: { channelMasterId, year: toYear, discountPct: srcAgency.discountPct, bonusPct: srcAgency.bonusPct, notes: srcAgency.notes, createdById: req.user.id } });
        agencyCopied = 1;
      }
    }

    // Per-client deals
    const [srcClientDeals, existingToYear] = await Promise.all([
      prisma.channelClientDeal.findMany({ where: { channelMasterId, year: fromYear } }),
      prisma.channelClientDeal.findMany({ where: { channelMasterId, year: toYear }, select: { clientId: true } }),
    ]);
    const existingSet = new Set(existingToYear.map((d) => d.clientId));
    let clientsCopied = 0, clientsSkipped = 0;
    const ops = [];
    for (const d of srcClientDeals) {
      if (existingSet.has(d.clientId)) { clientsSkipped++; continue; }
      ops.push(prisma.channelClientDeal.create({ data: { channelMasterId, clientId: d.clientId, year: toYear, discountPct: d.discountPct, bonusPct: d.bonusPct, notes: d.notes, createdById: req.user.id } }));
      clientsCopied++;
    }
    if (ops.length) await prisma.$transaction(ops);

    return res.json({ ok: true, fromYear, toYear, agencyCopied, agencySkipped, clientsCopied, clientsSkipped });
  } catch (error) {
    console.error('rollForwardDeals error:', error);
    return res.status(500).json({ error: 'Failed to roll deals forward', detail: error.message });
  }
}
