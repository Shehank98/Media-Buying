import prisma from '../utils/prisma.js';

// ═══════════════════════════════════════════════════════════════════════════
// Media Groups
// ═══════════════════════════════════════════════════════════════════════════

export async function listMediaGroups(req, res) {
  try {
    const mediaGroups = await prisma.mediaGroup.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { channelMasters: true } },
      },
    });
    return res.json({ mediaGroups });
  } catch (error) {
    console.error('List media groups error:', error);
    return res.status(500).json({ error: 'Failed to list media groups', detail: error.message });
  }
}

export async function createMediaGroup(req, res) {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Media group name is required' });

    const mediaGroup = await prisma.mediaGroup.create({
      data: {
        name,
        createdById: req.user.id,
      },
      include: {
        _count: { select: { channelMasters: true } },
      },
    });
    return res.status(201).json({ mediaGroup });
  } catch (error) {
    if (error.code === 'P2002') return res.status(409).json({ error: 'A media group with this name already exists' });
    console.error('Create media group error:', error);
    return res.status(500).json({ error: 'Failed to create media group', detail: error.message });
  }
}

export async function updateMediaGroup(req, res) {
  try {
    const id = parseInt(req.params.id);
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Media group name is required' });

    const mediaGroup = await prisma.mediaGroup.update({
      where: { id },
      data: { name },
      include: {
        _count: { select: { channelMasters: true } },
      },
    });
    return res.json({ mediaGroup });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Media group not found' });
    if (error.code === 'P2002') return res.status(409).json({ error: 'A media group with this name already exists' });
    console.error('Update media group error:', error);
    return res.status(500).json({ error: 'Failed to update media group', detail: error.message });
  }
}

export async function toggleMediaGroup(req, res) {
  try {
    const id = parseInt(req.params.id);

    const existing = await prisma.mediaGroup.findUnique({ where: { id }, select: { active: true } });
    if (!existing) return res.status(404).json({ error: 'Media group not found' });

    const mediaGroup = await prisma.mediaGroup.update({
      where: { id },
      data: { active: !existing.active },
      include: {
        _count: { select: { channelMasters: true } },
      },
    });
    return res.json({ mediaGroup });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Media group not found' });
    console.error('Toggle media group error:', error);
    return res.status(500).json({ error: 'Failed to toggle media group', detail: error.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Channel Masters
// ═══════════════════════════════════════════════════════════════════════════

export async function listChannelMasters(req, res) {
  try {
    const { search, includeInactive } = req.query;

    const where = {};
    if (includeInactive !== 'true') where.isActive = true;
    if (search) where.name = { contains: search, mode: 'insensitive' };

    const channelMasters = await prisma.channelMaster.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        mediaGroup: { select: { id: true, name: true } },
        _count: { select: { scheduleLogs: true } },
      },
    });
    return res.json({ channelMasters });
  } catch (error) {
    console.error('List channel masters error:', error);
    return res.status(500).json({ error: 'Failed to list channel masters', detail: error.message });
  }
}

export async function createChannelMaster(req, res) {
  try {
    const { name, medium, mediaGroupId, aliases } = req.body;
    if (!name || !medium || !mediaGroupId) {
      return res.status(400).json({ error: 'name, medium, and mediaGroupId are required' });
    }

    const channelMaster = await prisma.channelMaster.create({
      data: {
        name,
        medium,
        mediaGroupId: parseInt(mediaGroupId),
        aliases: Array.isArray(aliases) ? aliases : [],
        createdById: req.user.id,
      },
      include: {
        mediaGroup: { select: { id: true, name: true } },
        _count: { select: { scheduleLogs: true } },
      },
    });
    return res.status(201).json({ channelMaster });
  } catch (error) {
    if (error.code === 'P2002') return res.status(409).json({ error: 'A channel master with this name already exists' });
    if (error.code === 'P2003') return res.status(400).json({ error: 'Referenced media group not found' });
    console.error('Create channel master error:', error);
    return res.status(500).json({ error: 'Failed to create channel master', detail: error.message });
  }
}

export async function updateChannelMaster(req, res) {
  try {
    const id = parseInt(req.params.id);
    const { name, medium, mediaGroupId, aliases } = req.body;

    const data = {};
    if (name !== undefined) data.name = name;
    if (medium !== undefined) data.medium = medium;
    if (mediaGroupId !== undefined) data.mediaGroupId = parseInt(mediaGroupId);
    if (aliases !== undefined) data.aliases = Array.isArray(aliases) ? aliases : [];

    const channelMaster = await prisma.channelMaster.update({
      where: { id },
      data,
      include: {
        mediaGroup: { select: { id: true, name: true } },
        _count: { select: { scheduleLogs: true } },
      },
    });
    return res.json({ channelMaster });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Channel master not found' });
    if (error.code === 'P2002') return res.status(409).json({ error: 'A channel master with this name already exists' });
    if (error.code === 'P2003') return res.status(400).json({ error: 'Referenced media group not found' });
    console.error('Update channel master error:', error);
    return res.status(500).json({ error: 'Failed to update channel master', detail: error.message });
  }
}

export async function toggleChannelMaster(req, res) {
  try {
    const id = parseInt(req.params.id);

    const existing = await prisma.channelMaster.findUnique({ where: { id }, select: { isActive: true } });
    if (!existing) return res.status(404).json({ error: 'Channel master not found' });

    const channelMaster = await prisma.channelMaster.update({
      where: { id },
      data: { isActive: !existing.isActive },
      include: {
        mediaGroup: { select: { id: true, name: true } },
        _count: { select: { scheduleLogs: true } },
      },
    });
    return res.json({ channelMaster });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Channel master not found' });
    console.error('Toggle channel master error:', error);
    return res.status(500).json({ error: 'Failed to toggle channel master', detail: error.message });
  }
}

export async function mergeChannelMasters(req, res) {
  try {
    const { sourceId, targetId } = req.body;
    if (!sourceId || !targetId) {
      return res.status(400).json({ error: 'sourceId and targetId are required' });
    }
    if (parseInt(sourceId) === parseInt(targetId)) {
      return res.status(400).json({ error: 'sourceId and targetId must be different' });
    }

    const sid = parseInt(sourceId);
    const tid = parseInt(targetId);

    const [source, target] = await Promise.all([
      prisma.channelMaster.findUnique({ where: { id: sid } }),
      prisma.channelMaster.findUnique({ where: { id: tid } }),
    ]);
    if (!source) return res.status(404).json({ error: 'Source channel master not found' });
    if (!target) return res.status(404).json({ error: 'Target channel master not found' });

    // Merge: re-point all schedule_logs from source → target, then deactivate source
    await prisma.$transaction(async (tx) => {
      // Update schedule logs
      await tx.scheduleLog.updateMany({
        where: { channelMasterId: sid },
        data: {
          channelMasterId: tid,
          medium: target.medium,
        },
      });

      // Update upload batch rows
      await tx.uploadBatchRow.updateMany({
        where: { channelResolvedId: sid },
        data: { channelResolvedId: tid },
      });

      // Merge aliases into target (de-duplicate)
      const mergedAliases = Array.from(
        new Set([...target.aliases, ...source.aliases, source.name])
      );
      await tx.channelMaster.update({
        where: { id: tid },
        data: { aliases: mergedAliases },
      });

      // Deactivate source
      await tx.channelMaster.update({
        where: { id: sid },
        data: { isActive: false },
      });
    });

    const updatedTarget = await prisma.channelMaster.findUnique({
      where: { id: tid },
      include: {
        mediaGroup: { select: { id: true, name: true } },
        _count: { select: { scheduleLogs: true } },
      },
    });

    return res.json({
      message: `Merged channel master "${source.name}" into "${target.name}"`,
      channelMaster: updatedTarget,
    });
  } catch (error) {
    console.error('Merge channel masters error:', error);
    return res.status(500).json({ error: 'Failed to merge channel masters', detail: error.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Brands (admin cross-client view)
// ═══════════════════════════════════════════════════════════════════════════

export async function listAllBrands(req, res) {
  try {
    const { agencyId, clientId } = req.query;

    const where = {};
    if (clientId) {
      where.clientId = parseInt(clientId);
    } else if (agencyId) {
      where.client = { agencyId: parseInt(agencyId) };
    }

    const brands = await prisma.brand.findMany({
      where,
      orderBy: [{ client: { name: 'asc' } }, { name: 'asc' }],
      include: {
        client: { select: { id: true, name: true, agencyId: true } },
        _count: { select: { campaigns: true, scheduleLogs: true } },
      },
    });
    return res.json({ brands });
  } catch (error) {
    console.error('List all brands error:', error);
    return res.status(500).json({ error: 'Failed to list brands', detail: error.message });
  }
}

export async function createBrand(req, res) {
  try {
    const { clientId, name } = req.body;
    if (!clientId || !name) {
      return res.status(400).json({ error: 'clientId and name are required' });
    }

    const user = req.user;
    const cid = parseInt(clientId);

    // Non-SUPER_ADMIN roles need client access
    if (user.role !== 'SUPER_ADMIN') {
      const client = await prisma.client.findUnique({
        where: { id: cid },
        select: { id: true },
      });
      if (!client) return res.status(404).json({ error: 'Client not found' });

      if (user.role === 'PLANNER') {
        const access = await prisma.userClientAccess.findFirst({
          where: { userId: user.id, clientId: cid },
        });
        if (!access) return res.status(403).json({ error: 'You do not have access to this client' });
      }

      if (user.role === 'GROUP_HEAD') {
        const teams = await prisma.teamMember.findMany({
          where: { userId: user.id },
          select: { teamId: true },
        });
        const teamIds = teams.map(t => t.teamId);
        const teamClient = await prisma.teamClient.findFirst({
          where: { teamId: { in: teamIds }, clientId: cid },
        });
        if (!teamClient) return res.status(403).json({ error: 'You do not have access to this client' });
      }
    }

    const brand = await prisma.brand.create({
      data: {
        clientId: cid,
        name,
        createdById: user.id,
      },
      include: {
        client: { select: { id: true, name: true, agencyId: true } },
        _count: { select: { campaigns: true, scheduleLogs: true } },
      },
    });
    return res.status(201).json({ brand });
  } catch (error) {
    if (error.code === 'P2002') return res.status(409).json({ error: 'A brand with this name already exists for this client' });
    if (error.code === 'P2003') return res.status(400).json({ error: 'Client not found' });
    console.error('Create brand error:', error);
    return res.status(500).json({ error: 'Failed to create brand', detail: error.message });
  }
}

export async function toggleBrand(req, res) {
  try {
    const id = parseInt(req.params.id);

    const existing = await prisma.brand.findUnique({ where: { id }, select: { active: true } });
    if (!existing) return res.status(404).json({ error: 'Brand not found' });

    const newActive = !existing.active;

    // Cascade to campaigns in a transaction
    const [brand] = await prisma.$transaction([
      prisma.brand.update({
        where: { id },
        data: { active: newActive },
        include: {
          client: { select: { id: true, name: true } },
          _count: { select: { campaigns: true, scheduleLogs: true } },
        },
      }),
      prisma.campaign.updateMany({
        where: { brandId: id },
        data: { active: newActive },
      }),
    ]);

    return res.json({ brand });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Brand not found' });
    console.error('Toggle brand error:', error);
    return res.status(500).json({ error: 'Failed to toggle brand', detail: error.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Campaigns (admin cross-brand view)
// ═══════════════════════════════════════════════════════════════════════════

export async function listAllCampaigns(req, res) {
  try {
    const { brandId } = req.query;

    const where = {};
    if (brandId) where.brandId = parseInt(brandId);

    const campaigns = await prisma.campaign.findMany({
      where,
      orderBy: [{ brand: { name: 'asc' } }, { name: 'asc' }],
      include: {
        brand: { select: { id: true, name: true, clientId: true } },
        client: { select: { id: true, name: true } },
        _count: { select: { scheduleLogs: true } },
      },
    });
    return res.json({ campaigns });
  } catch (error) {
    console.error('List all campaigns error:', error);
    return res.status(500).json({ error: 'Failed to list campaigns', detail: error.message });
  }
}

export async function createCampaign(req, res) {
  try {
    const { brandId, name } = req.body;
    if (!brandId || !name) {
      return res.status(400).json({ error: 'brandId and name are required' });
    }

    const user = req.user;
    const bid = parseInt(brandId);

    const brand = await prisma.brand.findUnique({
      where: { id: bid },
      select: { id: true, clientId: true },
    });
    if (!brand) return res.status(404).json({ error: 'Brand not found' });

    // Non-SUPER_ADMIN roles need client access
    if (user.role !== 'SUPER_ADMIN') {
      if (user.role === 'PLANNER') {
        const access = await prisma.userClientAccess.findFirst({
          where: { userId: user.id, clientId: brand.clientId },
        });
        if (!access) return res.status(403).json({ error: 'You do not have access to this brand\'s client' });
      }

      if (user.role === 'GROUP_HEAD') {
        const teams = await prisma.teamMember.findMany({
          where: { userId: user.id },
          select: { teamId: true },
        });
        const teamIds = teams.map(t => t.teamId);
        const teamClient = await prisma.teamClient.findFirst({
          where: { teamId: { in: teamIds }, clientId: brand.clientId },
        });
        if (!teamClient) return res.status(403).json({ error: 'You do not have access to this brand\'s client' });
      }
    }

    const campaign = await prisma.campaign.create({
      data: {
        brandId: bid,
        clientId: brand.clientId,
        name,
        createdById: user.id,
      },
      include: {
        brand: { select: { id: true, name: true, clientId: true } },
        client: { select: { id: true, name: true } },
        _count: { select: { scheduleLogs: true } },
      },
    });
    return res.status(201).json({ campaign });
  } catch (error) {
    if (error.code === 'P2002') return res.status(409).json({ error: 'A campaign with this name already exists for this brand' });
    console.error('Create campaign error:', error);
    return res.status(500).json({ error: 'Failed to create campaign', detail: error.message });
  }
}

export async function toggleCampaign(req, res) {
  try {
    const id = parseInt(req.params.id);

    const existing = await prisma.campaign.findUnique({ where: { id }, select: { active: true } });
    if (!existing) return res.status(404).json({ error: 'Campaign not found' });

    const campaign = await prisma.campaign.update({
      where: { id },
      data: { active: !existing.active },
      include: {
        brand: { select: { id: true, name: true, clientId: true } },
        client: { select: { id: true, name: true } },
        _count: { select: { scheduleLogs: true } },
      },
    });
    return res.json({ campaign });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Campaign not found' });
    console.error('Toggle campaign error:', error);
    return res.status(500).json({ error: 'Failed to toggle campaign', detail: error.message });
  }
}
