import prisma from '../utils/prisma.js';

export async function getClient(req, res) {
  try {
    const client = await prisma.client.findUnique({
      where: { id: parseInt(req.params.clientId) },
      include: {
        agency: { select: { id: true, name: true } },
        _count: { select: { channels: true } },
      },
    });

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    return res.json({
      client: {
        ...client,
        agencyName: client.agency?.name,
      },
    });
  } catch (error) {
    console.error('Get client error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function updateClient(req, res) {
  try {
    const { clientId } = req.params;
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Client name is required' });
    const client = await prisma.client.update({
      where: { id: parseInt(clientId) },
      data: { name },
      include: { agency: { select: { id: true, name: true } }, _count: { select: { channels: true } } },
    });
    return res.json({ client: { ...client, agencyName: client.agency?.name } });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Client not found' });
    if (error.code === 'P2002') return res.status(409).json({ error: 'A client with this name already exists in this agency' });
    console.error('Update client error:', error);
    return res.status(500).json({ error: 'Failed to update client' });
  }
}

export async function deleteClient(req, res) {
  try {
    const { clientId } = req.params;
    await prisma.client.delete({ where: { id: parseInt(clientId) } });
    return res.json({ message: 'Client deleted successfully' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Client not found' });
    console.error('Delete client error:', error);
    return res.status(500).json({ error: 'Failed to delete client' });
  }
}

export async function getChannels(req, res) {
  try {
    const { clientId } = req.params;

    const channels = await prisma.channel.findMany({
      where: { clientId: parseInt(clientId) },
      include: { _count: { select: { properties: true } } },
      orderBy: { name: 'asc' },
    });

    return res.json(channels);
  } catch (error) {
    console.error('Get channels error:', error);
    return res.status(500).json({ error: 'Failed to get channels' });
  }
}

export async function createChannel(req, res) {
  try {
    const { clientId } = req.params;
    const { name, type } = req.body;

    if (!name || !type) {
      return res.status(400).json({ error: 'Name and type are required' });
    }

    const channel = await prisma.channel.create({
      data: {
        clientId: parseInt(clientId),
        name,
        type,
      },
    });

    return res.status(201).json(channel);
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Channel with this name already exists for this client' });
    }
    console.error('Create channel error:', error);
    return res.status(500).json({ error: 'Failed to create channel' });
  }
}

export async function updateChannel(req, res) {
  try {
    const { id } = req.params;
    const { name, type } = req.body;

    const data = {};
    if (name !== undefined) data.name = name;
    if (type !== undefined) data.type = type;

    const channel = await prisma.channel.update({
      where: { id: parseInt(id) },
      data,
    });

    return res.json(channel);
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Channel not found' });
    }
    console.error('Update channel error:', error);
    return res.status(500).json({ error: 'Failed to update channel' });
  }
}

export async function deleteChannel(req, res) {
  try {
    const { id } = req.params;
    await prisma.channel.delete({ where: { id: parseInt(id) } });
    return res.json({ message: 'Channel deleted successfully' });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Channel not found' });
    }
    console.error('Delete channel error:', error);
    return res.status(500).json({ error: 'Failed to delete channel' });
  }
}
