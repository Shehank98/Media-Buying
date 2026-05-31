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
    const { name, type, cost, notes } = req.body;

    if (!name || !type || cost == null) {
      return res.status(400).json({ error: 'Name, type, and cost are required' });
    }

    const property = await prisma.property.create({
      data: {
        channelId: parseInt(req.params.channelId),
        name,
        type,
        cost,
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
