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

    const where = { isDeleted: false };
    if (includeInactive !== 'true') where.isActive = true;
    if (search) where.name = { contains: search, mode: 'insensitive' };

    const channelMasters = await prisma.channelMaster.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        mediaGroup: { select: { id: true, name: true } },
        // Count only LIVE usage (non-deleted) so the Usage column matches the
        // per-channel export, which excludes soft-deleted rows.
        _count: { select: { scheduleLogs: { where: { isDeleted: false } } } },
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

    const channelMaster = await prisma.$transaction(async (tx) => {
      const updated = await tx.channelMaster.update({
        where: { id },
        data,
        include: {
          mediaGroup: { select: { id: true, name: true } },
          _count: { select: { scheduleLogs: true } },
        },
      });

      // Schedule logs store medium/mediaGroup as denormalized strings (for fast
      // spend-breakdown aggregation) - refresh existing rows so reassigning a
      // channel's medium or media group is reflected in historical spend too.
      if (medium !== undefined || mediaGroupId !== undefined) {
        await tx.scheduleLog.updateMany({
          where: { channelMasterId: id },
          data: { medium: updated.medium, mediaGroup: updated.mediaGroup.name },
        });
      }

      return updated;
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
      prisma.channelMaster.findUnique({ where: { id: tid }, include: { mediaGroup: { select: { name: true } } } }),
    ]);
    if (!source) return res.status(404).json({ error: 'Source channel master not found' });
    if (!target) return res.status(404).json({ error: 'Target channel master not found' });

    // Merge: re-point EVERY reference from source → target, then DELETE the
    // source channel master outright. Deactivating it was not enough - the seed
    // re-upserts the master list by name on every deploy and would reactivate a
    // merely-deactivated source, so the old channel kept reappearing in the
    // Admin Channels list. Deleting it (with the source name preserved as an
    // alias on the target so imports still resolve) means the only way it could
    // return is the seed re-creating it, and the zero-usage reconcile in seed.js
    // deletes it again the same boot because it now has NO references at all.
    await prisma.$transaction(async (tx) => {
      // Schedule logs - also refresh the denormalized medium/mediaGroup strings
      // so spend breakdowns reflect the target channel immediately.
      await tx.scheduleLog.updateMany({
        where: { channelMasterId: sid },
        data: {
          channelMasterId: tid,
          medium: target.medium,
          mediaGroup: target.mediaGroup.name,
        },
      });

      // Upload batch rows.
      await tx.uploadBatchRow.updateMany({
        where: { channelResolvedId: sid },
        data: { channelResolvedId: tid },
      });

      // Client-specific channel records (Channel.channelMasterId). The unique
      // constraint is [clientId, name], not on channelMasterId, so re-pointing
      // never clashes. Without this the delete would SetNull them (orphaning the
      // client channels) and the reconcile's `channels: { none: {} }` guard would
      // block deletion of a re-created source.
      await tx.channel.updateMany({
        where: { channelMasterId: sid },
        data: { channelMasterId: tid },
      });

      // Monthly forecasts. Unique is [year, month, clientId, channelMasterId], so
      // re-pointing can collide with an existing target forecast for the same
      // client/month - fold those by summing the amount, else just re-point.
      const srcForecasts = await tx.monthlyForecast.findMany({ where: { channelMasterId: sid } });
      if (srcForecasts.length) {
        const tgtForecasts = await tx.monthlyForecast.findMany({
          where: { channelMasterId: tid },
          select: { id: true, year: true, month: true, clientId: true, amountMillions: true },
        });
        const tgtByKey = new Map(tgtForecasts.map((f) => [`${f.year}-${f.month}-${f.clientId}`, f]));
        for (const f of srcForecasts) {
          const key = `${f.year}-${f.month}-${f.clientId}`;
          const clash = tgtByKey.get(key);
          if (clash) {
            await tx.monthlyForecast.update({
              where: { id: clash.id },
              data: { amountMillions: { increment: f.amountMillions } },
            });
            await tx.monthlyForecast.delete({ where: { id: f.id } });
          } else {
            await tx.monthlyForecast.update({ where: { id: f.id }, data: { channelMasterId: tid } });
          }
        }
      }

      // Commitment groups reference channels by a plain Int[] (not a FK), so swap
      // the source id for the target id in every group's member list (de-duped).
      const groups = await tx.channelCommitmentGroup.findMany({
        where: { channelMasterIds: { has: sid } },
        select: { id: true, channelMasterIds: true },
      });
      for (const g of groups) {
        const next = Array.from(new Set(g.channelMasterIds.map((x) => (x === sid ? tid : x))));
        await tx.channelCommitmentGroup.update({ where: { id: g.id }, data: { channelMasterIds: next } });
      }

      // Merge aliases into target (de-duplicate), keeping the source NAME so future
      // imports by the old name still resolve to the target.
      const mergedAliases = Array.from(
        new Set([...target.aliases, ...source.aliases, source.name])
      );
      await tx.channelMaster.update({
        where: { id: tid },
        data: { aliases: mergedAliases },
      });

      // Delete the source. Its own agency/client deals and channel commitments
      // cascade away (onDelete: Cascade); everything else was re-pointed above.
      await tx.channelMaster.delete({ where: { id: sid } });
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

// Permanently delete a channel master, but only if nothing references it.
// Otherwise refuse and suggest deactivating instead (keeps history intact).
export async function deleteChannelMaster(req, res) {
  try {
    const id = parseInt(req.params.id);

    const existing = await prisma.channelMaster.findUnique({ where: { id }, select: { id: true, isDeleted: true } });
    if (!existing || existing.isDeleted) return res.status(404).json({ error: 'Channel master not found' });

    // Block only on LIVE usage - active (non-deleted) schedule logs and client
    // channels - matching the "logs" count shown in the admin list (which is
    // also non-deleted only). Soft-deleted logs (left behind by a deleted upload
    // batch) still physically reference the channel but shouldn't stop a delete.
    const [activeLogCount, channelCount] = await Promise.all([
      prisma.scheduleLog.count({ where: { channelMasterId: id, isDeleted: false } }),
      prisma.channel.count({ where: { channelMasterId: id } }),
    ]);

    if (activeLogCount + channelCount > 0) {
      return res.status(409).json({
        error: `This channel is used by ${activeLogCount} active schedule log(s) and ${channelCount} client channel(s). Deactivate it instead of deleting to keep historical data.`,
      });
    }

    // Soft delete (recoverable) - the channel drops out of every picker/list but
    // its record and any references stay put, so it can be restored from Admin →
    // Channels → Recently deleted. Nothing is physically removed.
    await prisma.channelMaster.update({
      where: { id },
      data: { isDeleted: true, deletedAt: new Date(), deletedById: req.user.id },
    });
    return res.json({ message: 'Channel moved to Recently deleted. You can restore it from Admin → Channels.' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Channel master not found' });
    console.error('Delete channel master error:', error);
    return res.status(500).json({ error: 'Failed to delete channel master', detail: error.message });
  }
}

// Recently-deleted (soft-deleted) channels, for the restore view.
export async function listDeletedChannelMasters(req, res) {
  try {
    const channelMasters = await prisma.channelMaster.findMany({
      where: { isDeleted: true },
      orderBy: { deletedAt: 'desc' },
      include: { mediaGroup: { select: { id: true, name: true } } },
    });
    const deleterIds = [...new Set(channelMasters.map((c) => c.deletedById).filter(Boolean))];
    const deleters = deleterIds.length
      ? await prisma.user.findMany({ where: { id: { in: deleterIds } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map(deleters.map((u) => [u.id, u.name]));
    return res.json({ channelMasters: channelMasters.map((c) => ({ ...c, deletedByName: c.deletedById ? nameById.get(c.deletedById) || null : null })) });
  } catch (error) {
    console.error('List deleted channel masters error:', error);
    return res.status(500).json({ error: 'Failed to list deleted channels', detail: error.message });
  }
}

// Restore a soft-deleted channel back into active use.
export async function restoreChannelMaster(req, res) {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.channelMaster.findUnique({ where: { id }, select: { id: true, isDeleted: true } });
    if (!existing) return res.status(404).json({ error: 'Channel master not found' });
    if (!existing.isDeleted) return res.status(409).json({ error: 'This channel is not deleted.' });

    const channelMaster = await prisma.channelMaster.update({
      where: { id },
      data: { isDeleted: false, deletedAt: null, deletedById: null },
      include: { mediaGroup: { select: { id: true, name: true } }, _count: { select: { scheduleLogs: { where: { isDeleted: false } } } } },
    });
    return res.json({ channelMaster, message: 'Channel restored' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Channel master not found' });
    console.error('Restore channel master error:', error);
    return res.status(500).json({ error: 'Failed to restore channel', detail: error.message });
  }
}

// Permanently delete a media group, but only if it has no channels.
export async function deleteMediaGroup(req, res) {
  try {
    const id = parseInt(req.params.id);

    const existing = await prisma.mediaGroup.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return res.status(404).json({ error: 'Media group not found' });

    const channelCount = await prisma.channelMaster.count({ where: { mediaGroupId: id } });
    if (channelCount > 0) {
      return res.status(409).json({
        error: `This media group has ${channelCount} channel(s). Reassign or delete those channels first, or deactivate this group instead.`,
      });
    }

    await prisma.mediaGroup.delete({ where: { id } });
    return res.json({ message: 'Media group deleted' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Media group not found' });
    console.error('Delete media group error:', error);
    return res.status(500).json({ error: 'Failed to delete media group', detail: error.message });
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

// ═══════════════════════════════════════════════════════════════════════════
// Property Categories (Add Property dropdown; managed in Admin)
// ═══════════════════════════════════════════════════════════════════════════

export async function listPropertyCategories(req, res) {
  try {
    const includeInactive = req.query.includeInactive === 'true';
    const categories = await prisma.propertyCategory.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return res.json({ categories });
  } catch (error) {
    console.error('List property categories error:', error);
    return res.status(500).json({ error: 'Failed to list property categories', detail: error.message });
  }
}

export async function createPropertyCategory(req, res) {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Category name is required' });
    const count = await prisma.propertyCategory.count();
    const category = await prisma.propertyCategory.create({
      data: { name, sortOrder: count, isActive: true },
    });
    return res.status(201).json({ category });
  } catch (error) {
    if (error.code === 'P2002') return res.status(409).json({ error: 'A category with that name already exists' });
    console.error('Create property category error:', error);
    return res.status(500).json({ error: 'Failed to create property category', detail: error.message });
  }
}

export async function updatePropertyCategory(req, res) {
  try {
    const id = parseInt(req.params.id);
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Category name is required' });
    const category = await prisma.propertyCategory.update({ where: { id }, data: { name } });
    return res.json({ category });
  } catch (error) {
    if (error.code === 'P2002') return res.status(409).json({ error: 'A category with that name already exists' });
    if (error.code === 'P2025') return res.status(404).json({ error: 'Category not found' });
    console.error('Update property category error:', error);
    return res.status(500).json({ error: 'Failed to update property category', detail: error.message });
  }
}

export async function togglePropertyCategory(req, res) {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.propertyCategory.findUnique({ where: { id }, select: { isActive: true } });
    if (!existing) return res.status(404).json({ error: 'Category not found' });
    const category = await prisma.propertyCategory.update({ where: { id }, data: { isActive: !existing.isActive } });
    return res.json({ category });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Category not found' });
    console.error('Toggle property category error:', error);
    return res.status(500).json({ error: 'Failed to toggle property category', detail: error.message });
  }
}

// ─── Direct Placements ────────────────────────────────────────────────────────
// One fixed bucket of DIGITAL channels (Sirasa Digital, Swarnawahini Digital, …)
// that the Spend by Channel charts render as a single combined bar. The flag
// lives on ChannelMaster.isDirectPlacement; nothing else about the channel
// changes, so tables, exports and Channel Intelligence keep it individual.

// Every digital channel + which of them are currently in the bucket. The picker
// lists deactivated channels too (a paused channel keeps its historical spend,
// which still needs to roll up), each marked with its own isActive.
export async function listDirectPlacements(req, res) {
  try {
    const channels = await prisma.channelMaster.findMany({
      where: { medium: 'DIGITAL', isDeleted: false },
      orderBy: { name: 'asc' },
      select: {
        id: true, name: true, isActive: true, isDirectPlacement: true,
        mediaGroup: { select: { id: true, name: true } },
        _count: { select: { scheduleLogs: { where: { isDeleted: false } } } },
      },
    });
    return res.json({
      channels,
      selectedIds: channels.filter((c) => c.isDirectPlacement).map((c) => c.id),
    });
  } catch (error) {
    console.error('List direct placements error:', error);
    return res.status(500).json({ error: 'Failed to list direct placements', detail: error.message });
  }
}

// Set-based: the posted ids become the bucket exactly, so an id left out is
// removed. Only DIGITAL channels can be flagged - the roll-up lives in the
// Digital tab, so a TV/Radio channel in the bucket would silently never show.
export async function setDirectPlacements(req, res) {
  try {
    const raw = Array.isArray(req.body?.channelMasterIds) ? req.body.channelMasterIds : null;
    if (!raw) return res.status(400).json({ error: 'channelMasterIds must be an array' });
    const ids = [...new Set(raw.map((v) => parseInt(v)).filter((v) => Number.isInteger(v)))];

    if (ids.length > 0) {
      const valid = await prisma.channelMaster.findMany({
        where: { id: { in: ids }, medium: 'DIGITAL', isDeleted: false },
        select: { id: true },
      });
      if (valid.length !== ids.length) {
        return res.status(400).json({ error: 'Direct placements can only contain digital channels' });
      }
    }

    await prisma.$transaction([
      prisma.channelMaster.updateMany({
        where: { isDirectPlacement: true, id: { notIn: ids.length ? ids : [-1] } },
        data: { isDirectPlacement: false },
      }),
      ...(ids.length
        ? [prisma.channelMaster.updateMany({ where: { id: { in: ids } }, data: { isDirectPlacement: true } })]
        : []),
    ]);

    return res.json({ ok: true, count: ids.length, selectedIds: ids });
  } catch (error) {
    console.error('Set direct placements error:', error);
    return res.status(500).json({ error: 'Failed to save direct placements', detail: error.message });
  }
}
