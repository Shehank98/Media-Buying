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
    const { category, name, type, cost, notes, bonusValue } = req.body;

    if (!category || !String(category).trim()) {
      return res.status(400).json({ error: 'Property category is required' });
    }
    if (!name || cost == null) {
      return res.status(400).json({ error: 'Name and property value are required' });
    }

    const property = await prisma.property.create({
      data: {
        channelId: parseInt(req.params.channelId),
        category: String(category).trim(),
        name,
        type: type ? String(type).trim() : null,
        cost,
        bonusValue: bonusValue === '' || bonusValue == null ? 0 : Number(bonusValue),
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
