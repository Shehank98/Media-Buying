import prisma from '../utils/prisma.js';

// ── helpers ──

function serializeLog(log) {
  return {
    ...log,
    scheduleValue: log.scheduleValue != null ? Number(log.scheduleValue) : null,
    scheduleValueWithVat: log.scheduleValueWithVat != null ? Number(log.scheduleValueWithVat) : null,
  };
}

const logIncludes = {
  channelMaster: { select: { id: true, name: true, medium: true } },
  uploader: { select: { id: true, name: true } },
  deletedBy: { select: { id: true, name: true } },
};

/**
 * Build the clientId filter based on the user's role.
 * Returns null if the user has no access to ANY client (empty set).
 * Returns { clientId } if clientId is confirmed accessible.
 * Throws with a 403-style message if access is denied.
 */
async function resolveClientAccess(user, clientId) {
  const cid = parseInt(clientId);

  switch (user.role) {
    case 'SUPER_ADMIN':
      return cid;

    case 'MANAGER': {
      // Manager can see clients in their assigned agencies
      const access = await prisma.userAgencyAccess.findMany({
        where: { userId: user.id },
        select: { agencyId: true },
      });
      const agencyIds = access.map(a => a.agencyId);
      const client = await prisma.client.findFirst({
        where: { id: cid, agencyId: { in: agencyIds } },
        select: { id: true },
      });
      if (!client) return null;
      return cid;
    }

    case 'GROUP_HEAD': {
      // GROUP_HEAD can see clients assigned to their team(s)
      const teams = await prisma.teamMember.findMany({
        where: { userId: user.id },
        select: { teamId: true },
      });
      const teamIds = teams.map(t => t.teamId);
      const teamClient = await prisma.teamClient.findFirst({
        where: { teamId: { in: teamIds }, clientId: cid },
        select: { clientId: true },
      });
      if (!teamClient) return null;
      return cid;
    }

    case 'PLANNER': {
      // PLANNER can only see their directly assigned clients
      const access = await prisma.userClientAccess.findFirst({
        where: { userId: user.id, clientId: cid },
        select: { clientId: true },
      });
      if (!access) return null;
      return cid;
    }

    default:
      return null;
  }
}

// ── getScheduleLogs ──

export async function getScheduleLogs(req, res) {
  try {
    const {
      clientId,
      page = '1',
      limit = '50',
      sort = 'createdAt',
      order = 'desc',
      search,
      monthFrom,
      monthTo,
      channelMasterId,
      medium,
      showDeleted,
    } = req.query;

    if (!clientId) {
      return res.status(400).json({ error: 'clientId is required' });
    }

    const user = req.user;

    // Verify role-based access to this client
    const accessedClientId = await resolveClientAccess(user, clientId);
    if (accessedClientId === null) {
      return res.status(403).json({ error: 'You do not have access to this client' });
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    // Build where clause
    const where = { clientId: accessedClientId };

    // Soft-deleted filter — only SUPER_ADMIN can see deleted rows
    if (showDeleted === 'true' && user.role === 'SUPER_ADMIN') {
      // no filter — show all including deleted
    } else {
      where.isDeleted = false;
    }

    if (monthFrom) where.scheduleMonth = { ...where.scheduleMonth, gte: monthFrom };
    if (monthTo) where.scheduleMonth = { ...where.scheduleMonth, lte: monthTo };
    if (channelMasterId) where.channelMasterId = parseInt(channelMasterId);
    if (medium) where.medium = medium;

    // Text search on roNumber
    if (search) {
      where.roNumber = { contains: search, mode: 'insensitive' };
    }

    // Validate sort field
    const allowedSorts = [
      'createdAt', 'updatedAt', 'scheduleMonth', 'invoiceMonth',
      'roNumber', 'scheduleValue', 'scheduleValueWithVat', 'medium',
    ];
    const sortField = allowedSorts.includes(sort) ? sort : 'createdAt';
    const sortOrder = order === 'asc' ? 'asc' : 'desc';

    const [items, total] = await Promise.all([
      prisma.scheduleLog.findMany({
        where,
        include: logIncludes,
        orderBy: { [sortField]: sortOrder },
        skip,
        take: limitNum,
      }),
      prisma.scheduleLog.count({ where }),
    ]);

    return res.json({
      items: items.map(serializeLog),
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (error) {
    console.error('Get schedule logs error:', error);
    return res.status(500).json({ error: 'Failed to get schedule logs', detail: error.message });
  }
}

// ── createScheduleLog ──

export async function createScheduleLog(req, res) {
  try {
    const {
      clientId,
      channelMasterId,
      roNumber,
      scheduleMonth,
      scheduleValue,
    } = req.body;

    if (!clientId || !channelMasterId || !roNumber || !scheduleMonth || scheduleValue === undefined) {
      return res.status(400).json({
        error: 'clientId, channelMasterId, roNumber, scheduleMonth, and scheduleValue are required',
      });
    }

    const user = req.user;
    const cid = parseInt(clientId);

    // Role check
    const accessedClientId = await resolveClientAccess(user, cid);
    if (accessedClientId === null) {
      return res.status(403).json({ error: 'You do not have access to this client' });
    }

    // Resolve client → agencyId
    const client = await prisma.client.findUnique({
      where: { id: cid },
      select: { agencyId: true },
    });
    if (!client) return res.status(404).json({ error: 'Client not found' });

    // Resolve channelMaster → medium + mediaGroup name
    const channelMasterRec = await prisma.channelMaster.findUnique({
      where: { id: parseInt(channelMasterId) },
      include: { mediaGroup: { select: { name: true } } },
    });
    if (!channelMasterRec) return res.status(404).json({ error: 'Channel master not found' });

    // Auto-compute invoiceMonth (scheduleMonth + 1 month)
    // scheduleMonth is expected as "YYYY-MM" string
    let invoiceMonth = scheduleMonth;
    const monthMatch = typeof scheduleMonth === 'string' && scheduleMonth.match(/^(\d{4})-(\d{2})$/);
    if (monthMatch) {
      const y = parseInt(monthMatch[1]);
      const m = parseInt(monthMatch[2]);
      const nextDate = new Date(Date.UTC(y, m, 1)); // m is already 0-indexed + 1
      const ny = nextDate.getUTCFullYear();
      const nm = String(nextDate.getUTCMonth() + 1).padStart(2, '0');
      invoiceMonth = `${ny}-${nm}`;
    }

    const value = parseFloat(scheduleValue);
    const scheduleValueWithVat = parseFloat((value * 1.18).toFixed(2));

    const log = await prisma.scheduleLog.create({
      data: {
        agencyId: client.agencyId,
        clientId: cid,
        channelMasterId: parseInt(channelMasterId),
        uploadedById: user.id,
        uploadBatchId: null,
        roNumber,
        scheduleMonth,
        invoiceMonth,
        medium: channelMasterRec.medium,
        mediaGroup: channelMasterRec.mediaGroup.name,
        scheduleValue: value,
        scheduleValueWithVat,
      },
      include: logIncludes,
    });

    return res.status(201).json({ scheduleLog: serializeLog(log) });
  } catch (error) {
    if (error.code === 'P2003') return res.status(400).json({ error: 'Referenced record not found', detail: error.message });
    if (error.code === 'P2002') return res.status(409).json({ error: 'Duplicate schedule log entry', detail: error.message });
    console.error('Create schedule log error:', error);
    return res.status(500).json({ error: 'Failed to create schedule log', detail: error.message });
  }
}

// ── updateScheduleLog ──

export async function updateScheduleLog(req, res) {
  try {
    const id = parseInt(req.params.id);
    const user = req.user;

    const existing = await prisma.scheduleLog.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Schedule log not found' });
    if (existing.isDeleted) return res.status(404).json({ error: 'Schedule log has been deleted' });

    // Role-based edit permission
    if (user.role === 'MANAGER') {
      return res.status(403).json({ error: 'Managers cannot edit schedule logs' });
    }

    if (user.role === 'PLANNER') {
      // PLANNER can only edit their own entries
      if (existing.uploadedById !== user.id) {
        return res.status(403).json({ error: 'You can only edit your own schedule log entries' });
      }
    }

    if (user.role === 'GROUP_HEAD') {
      // GROUP_HEAD can only edit entries belonging to their team's clients
      const teams = await prisma.teamMember.findMany({
        where: { userId: user.id },
        select: { teamId: true },
      });
      const teamIds = teams.map(t => t.teamId);
      const teamClient = await prisma.teamClient.findFirst({
        where: { teamId: { in: teamIds }, clientId: existing.clientId },
      });
      if (!teamClient) {
        return res.status(403).json({ error: 'You do not have access to this schedule log' });
      }
    }

    const { editNote, ...updates } = req.body;
    if (!editNote) {
      return res.status(400).json({ error: 'editNote is required for updates' });
    }

    // Build update data from provided fields
    const updateData = {};
    const editableFields = [
      'roNumber', 'scheduleMonth', 'invoiceMonth', 'scheduleValue',
      'channelMasterId',
    ];

    for (const field of editableFields) {
      if (updates[field] !== undefined) {
        if (field === 'scheduleValue') {
          updateData.scheduleValue = parseFloat(updates.scheduleValue);
          updateData.scheduleValueWithVat = parseFloat((parseFloat(updates.scheduleValue) * 1.18).toFixed(2));
        } else if (field === 'brandId' || field === 'campaignId' || field === 'channelMasterId') {
          updateData[field] = parseInt(updates[field]);
        } else {
          updateData[field] = updates[field];
        }
      }
    }

    // If channelMasterId changed, re-resolve medium and mediaGroup
    if (updateData.channelMasterId) {
      const cm = await prisma.channelMaster.findUnique({
        where: { id: updateData.channelMasterId },
        include: { mediaGroup: { select: { name: true } } },
      });
      if (!cm) return res.status(404).json({ error: 'Channel master not found' });
      updateData.medium = cm.medium;
      updateData.mediaGroup = cm.mediaGroup.name;
    }

    // Capture previous values before update
    const previousValues = {};
    for (const key of Object.keys(updateData)) {
      previousValues[key] = existing[key] != null ? String(existing[key]) : null;
    }

    // Save edit history and update in a transaction
    const [, updated] = await prisma.$transaction([
      prisma.scheduleLogEdit.create({
        data: {
          scheduleLogId: id,
          editedById: user.id,
          previousValues,
          newValues: Object.fromEntries(
            Object.entries(updateData).map(([k, v]) => [k, v != null ? String(v) : null])
          ),
          editNote,
        },
      }),
      prisma.scheduleLog.update({
        where: { id },
        data: updateData,
        include: logIncludes,
      }),
    ]);

    return res.json({ scheduleLog: serializeLog(updated) });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Schedule log not found' });
    if (error.code === 'P2003') return res.status(400).json({ error: 'Referenced record not found', detail: error.message });
    console.error('Update schedule log error:', error);
    return res.status(500).json({ error: 'Failed to update schedule log', detail: error.message });
  }
}

// ── deleteScheduleLog ──

export async function deleteScheduleLog(req, res) {
  try {
    const id = parseInt(req.params.id);
    const user = req.user;

    const existing = await prisma.scheduleLog.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Schedule log not found' });
    if (existing.isDeleted) return res.status(404).json({ error: 'Schedule log is already deleted' });

    if (user.role === 'MANAGER') {
      return res.status(403).json({ error: 'Managers cannot delete schedule logs' });
    }

    if (user.role === 'PLANNER') {
      // PLANNER: only their own entries, same day only
      if (existing.uploadedById !== user.id) {
        return res.status(403).json({ error: 'You can only delete your own schedule log entries' });
      }
      const createdAt = new Date(existing.createdAt);
      const now = new Date();
      const sameDay =
        createdAt.getUTCFullYear() === now.getUTCFullYear() &&
        createdAt.getUTCMonth() === now.getUTCMonth() &&
        createdAt.getUTCDate() === now.getUTCDate();
      if (!sameDay) {
        return res.status(403).json({ error: 'Planners can only delete entries created today' });
      }
    }

    if (user.role === 'GROUP_HEAD') {
      // GROUP_HEAD: any in their team's clients
      const teams = await prisma.teamMember.findMany({
        where: { userId: user.id },
        select: { teamId: true },
      });
      const teamIds = teams.map(t => t.teamId);
      const teamClient = await prisma.teamClient.findFirst({
        where: { teamId: { in: teamIds }, clientId: existing.clientId },
      });
      if (!teamClient) {
        return res.status(403).json({ error: 'You do not have access to this schedule log' });
      }
    }

    // Soft delete
    await prisma.scheduleLog.update({
      where: { id },
      data: {
        isDeleted: true,
        deletedById: user.id,
        deletedAt: new Date(),
      },
    });

    return res.json({ message: 'Schedule log deleted successfully' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Schedule log not found' });
    console.error('Delete schedule log error:', error);
    return res.status(500).json({ error: 'Failed to delete schedule log', detail: error.message });
  }
}

// ── getScheduleLogEdits ──

export async function getScheduleLogEdits(req, res) {
  try {
    const id = parseInt(req.params.id);

    const log = await prisma.scheduleLog.findUnique({
      where: { id },
      select: { id: true, clientId: true },
    });
    if (!log) return res.status(404).json({ error: 'Schedule log not found' });

    // Basic access check: verify user can see this client
    const accessedClientId = await resolveClientAccess(req.user, log.clientId);
    if (accessedClientId === null) {
      return res.status(403).json({ error: 'You do not have access to this schedule log' });
    }

    const edits = await prisma.scheduleLogEdit.findMany({
      where: { scheduleLogId: id },
      include: {
        editor: { select: { id: true, name: true } },
      },
      orderBy: { editedAt: 'desc' },
    });

    return res.json({ edits });
  } catch (error) {
    console.error('Get schedule log edits error:', error);
    return res.status(500).json({ error: 'Failed to get schedule log edits', detail: error.message });
  }
}
