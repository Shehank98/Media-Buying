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
    const { name, agencyId } = req.body;
    const cid = parseInt(clientId);

    const existing = await prisma.client.findUnique({ where: { id: cid }, select: { id: true, agencyId: true } });
    if (!existing) return res.status(404).json({ error: 'Client not found' });

    const data = {};
    if (name !== undefined) {
      if (!name || !String(name).trim()) return res.status(400).json({ error: 'Client name is required' });
      data.name = String(name).trim();
    }
    let newAgencyId = null;
    if (agencyId !== undefined && agencyId !== null && agencyId !== '') {
      const agency = await prisma.agency.findUnique({ where: { id: parseInt(agencyId) }, select: { id: true } });
      if (!agency) return res.status(400).json({ error: 'Selected agency was not found' });
      data.agencyId = agency.id;
      newAgencyId = agency.id;
    }
    if (Object.keys(data).length === 0) return res.status(400).json({ error: 'Nothing to update' });

    const moving = newAgencyId !== null && newAgencyId !== existing.agencyId;

    // ScheduleLog/UploadBatch denormalize agencyId at insert time, so when a
    // client moves agencies its spend must be re-pointed too — otherwise
    // agency-level totals stay attributed to the old agency.
    const ops = [
      prisma.client.update({
        where: { id: cid },
        data,
        include: { agency: { select: { id: true, name: true } }, _count: { select: { channels: true } } },
      }),
    ];
    if (moving) {
      ops.push(prisma.scheduleLog.updateMany({ where: { clientId: cid }, data: { agencyId: newAgencyId } }));
    }
    const [client] = await prisma.$transaction(ops);

    if (moving) {
      // Re-point upload batches that belong solely to this client (multi-client
      // batches keep their original agency since they span agencies).
      const batches = await prisma.uploadBatch.findMany({
        where: { clientIds: { has: cid } },
        select: { id: true, clientIds: true },
      });
      const soleIds = batches.filter(b => b.clientIds.length === 1 && b.clientIds[0] === cid).map(b => b.id);
      if (soleIds.length) {
        await prisma.uploadBatch.updateMany({ where: { id: { in: soleIds } }, data: { agencyId: newAgencyId } });
      }
    }

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
    const { name, type, channelMasterId } = req.body;

    // Prefer selecting from the channel master (User Management); derive name/medium from it.
    let chName = name;
    let chType = type;
    let cmId = null;
    if (channelMasterId) {
      const cm = await prisma.channelMaster.findUnique({
        where: { id: parseInt(channelMasterId) },
        select: { id: true, name: true, medium: true },
      });
      if (!cm) return res.status(400).json({ error: 'Selected channel was not found' });
      chName = cm.name; chType = cm.medium; cmId = cm.id;
    }

    if (!chName || !chType) {
      return res.status(400).json({ error: 'Channel is required' });
    }

    const channel = await prisma.channel.create({
      data: {
        clientId: parseInt(clientId),
        name: chName,
        type: chType,
        channelMasterId: cmId,
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
