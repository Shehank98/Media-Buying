import prisma from '../utils/prisma.js';

export async function getChannel(req, res) {
  try {
    const channel = await prisma.channel.findUnique({
      where: { id: parseInt(req.params.channelId) },
      include: {
        client: { include: { agency: true } },
        _count: { select: { properties: true } },
      },
    });

    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    return res.json({
      channel: {
        ...channel,
        clientName: channel.client?.name,
        agencyName: channel.client?.agency?.name,
      },
    });
  } catch (error) {
    console.error('Get channel error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getProperties(req, res) {
  try {
    const properties = await prisma.property.findMany({
      where: { channelId: parseInt(req.params.channelId) },
      include: { creator: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return res.json({
      properties: properties.map((p) => ({
        ...p,
        createdByName: p.creator?.name,
      })),
    });
  } catch (error) {
    console.error('Get properties error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function createProperty(req, res) {
  try {
    const { category, name, type, cost, notes, bonusCount, startDate, endDate } = req.body;

    if (!category || !String(category).trim()) {
      return res.status(400).json({ error: 'Property category is required' });
    }
    if (!name || cost == null) {
      return res.status(400).json({ error: 'Name and property value are required' });
    }
    if (!startDate) {
      return res.status(400).json({ error: 'Start date is required' });
    }

    // bonusCount = bonus percentage; bonus value is derived = value x bonus% / 100
    const bonusPctNum = bonusCount === '' || bonusCount == null ? 0 : Math.max(0, Math.round(Number(bonusCount)));
    const bonusValueNum = Math.round((Number(cost) * bonusPctNum / 100) * 100) / 100;

    const property = await prisma.property.create({
      data: {
        channelId: parseInt(req.params.channelId),
        category: String(category).trim(),
        name,
        type: type ? String(type).trim() : null,
        cost,
        bonusCount: bonusPctNum,
        bonusValue: bonusValueNum,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        notes: notes || null,
        createdBy: req.user.id,
      },
      include: { creator: { select: { id: true, name: true } } },
    });

    return res.status(201).json({ property });
  } catch (error) {
    console.error('Create property error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── Channel-client deals (discount %/bonus % negotiation terms) ────────────
// Channel.id is client-specific; ChannelClientDeal keys on channelMasterId +
// clientId, so every handler below resolves those two from the Channel row
// first. A channel not yet linked to a ChannelMaster (channelMasterId null)
// can't have deals recorded against it.

export async function listChannelDeals(req, res) {
  try {
    const channel = await prisma.channel.findUnique({
      where: { id: parseInt(req.params.channelId) },
      select: { clientId: true, channelMasterId: true },
    });
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    if (!channel.channelMasterId) {
      return res.json({ deals: [], channelMasterId: null });
    }

    const deals = await prisma.channelClientDeal.findMany({
      where: { channelMasterId: channel.channelMasterId, clientId: channel.clientId },
      orderBy: { year: 'desc' },
      include: { createdBy: { select: { id: true, name: true } } },
    });

    return res.json({
      deals: deals.map((d) => ({ ...d, createdByName: d.createdBy?.name })),
      channelMasterId: channel.channelMasterId,
    });
  } catch (error) {
    console.error('List channel deals error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function upsertChannelDeal(req, res) {
  try {
    const { year, discountPct, bonusPct, notes } = req.body;
    if (!year || discountPct == null || bonusPct == null) {
      return res.status(400).json({ error: 'Year, discountPct and bonusPct are required' });
    }

    const channel = await prisma.channel.findUnique({
      where: { id: parseInt(req.params.channelId) },
      select: { clientId: true, channelMasterId: true },
    });
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    if (!channel.channelMasterId) {
      return res.status(400).json({ error: 'This channel is not linked to a master channel, so deal terms cannot be recorded against it' });
    }

    const deal = await prisma.channelClientDeal.upsert({
      where: {
        channelMasterId_clientId_year: {
          channelMasterId: channel.channelMasterId,
          clientId: channel.clientId,
          year: parseInt(year),
        },
      },
      update: { discountPct, bonusPct, notes: notes || null },
      create: {
        channelMasterId: channel.channelMasterId,
        clientId: channel.clientId,
        year: parseInt(year),
        discountPct,
        bonusPct,
        notes: notes || null,
        createdById: req.user.id,
      },
      include: { createdBy: { select: { id: true, name: true } } },
    });

    return res.status(201).json({ deal: { ...deal, createdByName: deal.createdBy?.name } });
  } catch (error) {
    console.error('Upsert channel deal error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function updateChannelDeal(req, res) {
  try {
    const { discountPct, bonusPct, notes } = req.body;
    if (discountPct == null || bonusPct == null) {
      return res.status(400).json({ error: 'discountPct and bonusPct are required' });
    }

    const deal = await prisma.channelClientDeal.update({
      where: { id: parseInt(req.params.id) },
      data: { discountPct, bonusPct, notes: notes || null },
      include: { createdBy: { select: { id: true, name: true } } },
    });

    return res.json({ deal: { ...deal, createdByName: deal.createdBy?.name } });
  } catch (error) {
    console.error('Update channel deal error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function deleteChannelDeal(req, res) {
  try {
    await prisma.channelClientDeal.delete({ where: { id: parseInt(req.params.id) } });
    return res.json({ success: true });
  } catch (error) {
    console.error('Delete channel deal error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
