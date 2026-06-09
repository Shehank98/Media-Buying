import prisma from '../utils/prisma.js';
import { getAccessibleClientIds } from '../middleware/access.js';

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

async function resolveClientAccess(user, clientId) {
  const cid = parseInt(clientId);

  switch (user.role) {
    case 'SUPER_ADMIN':
      return cid;

    case 'MANAGER': {
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

function computeInvoiceMonth(scheduleMonth) {
  const monthMatch = typeof scheduleMonth === 'string' && scheduleMonth.match(/^(\d{4})-(\d{2})$/);
  if (!monthMatch) return scheduleMonth;
  const y = parseInt(monthMatch[1]);
  const m = parseInt(monthMatch[2]);
  const nextDate = new Date(Date.UTC(y, m, 1));
  const ny = nextDate.getUTCFullYear();
  const nm = String(nextDate.getUTCMonth() + 1).padStart(2, '0');
  return `${ny}-${nm}`;
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

    const accessedClientId = await resolveClientAccess(user, clientId);
    if (accessedClientId === null) {
      return res.status(403).json({ error: 'You do not have access to this client' });
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(500, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const where = { clientId: accessedClientId };

    if (showDeleted === 'true' && user.role === 'SUPER_ADMIN') {
      // show all including deleted
    } else {
      where.isDeleted = false;
    }

    if (monthFrom) where.scheduleMonth = { ...where.scheduleMonth, gte: monthFrom };
    if (monthTo) where.scheduleMonth = { ...where.scheduleMonth, lte: monthTo };
    if (channelMasterId) where.channelMasterId = parseInt(channelMasterId);
    if (medium) where.medium = medium;

    if (search) {
      where.OR = [
        { roNumber: { contains: search, mode: 'insensitive' } },
        { brandName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const allowedSorts = [
      'createdAt', 'updatedAt', 'scheduleMonth', 'invoiceMonth',
      'roNumber', 'scheduleValue', 'scheduleValueWithVat', 'medium', 'brandName',
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

// ── getMetadata (group heads, brand suggestions, channels) ──

export async function getMetadata(req, res) {
  try {
    const { clientId } = req.query;
    const user = req.user;

    if (!clientId) {
      return res.status(400).json({ error: 'clientId is required' });
    }

    const cid = parseInt(clientId);
    const accessedClientId = await resolveClientAccess(user, cid);
    if (accessedClientId === null) {
      return res.status(403).json({ error: 'You do not have access to this client' });
    }

    // Get group head(s) for this client
    const teamClients = await prisma.teamClient.findMany({
      where: { clientId: cid },
      select: { teamId: true },
    });
    const teamIds = teamClients.map(tc => tc.teamId);

    let groupHeadName = '';
    if (teamIds.length > 0) {
      const groupHead = await prisma.teamMember.findFirst({
        where: { teamId: { in: teamIds }, role: 'GROUP_HEAD' },
        include: { user: { select: { name: true } } },
      });
      if (groupHead) groupHeadName = groupHead.user.name;
    }

    // Get distinct brand names used for this client
    const brandLogs = await prisma.scheduleLog.findMany({
      where: { clientId: cid, isDeleted: false, brandName: { not: null } },
      select: { brandName: true },
      distinct: ['brandName'],
      orderBy: { brandName: 'asc' },
    });
    const brandSuggestions = brandLogs.map(l => l.brandName).filter(Boolean);

    // Get client info
    const client = await prisma.client.findUnique({
      where: { id: cid },
      select: { id: true, name: true, agencyId: true },
    });

    return res.json({
      groupHeadName,
      brandSuggestions,
      client,
    });
  } catch (error) {
    console.error('Get metadata error:', error);
    return res.status(500).json({ error: 'Failed to get metadata', detail: error.message });
  }
}

// ── getAnalytics ──

export async function getAnalytics(req, res) {
  try {
    const { monthFrom, monthTo, agencyId, clientId } = req.query;
    const user = req.user;

    const where = { isDeleted: false };
    if (monthFrom) where.scheduleMonth = { ...where.scheduleMonth, gte: monthFrom };
    if (monthTo) where.scheduleMonth = { ...where.scheduleMonth, lte: monthTo };

    // MANAGER: restrict to their assigned agencies
    if (user.role === 'MANAGER') {
      const access = await prisma.userAgencyAccess.findMany({
        where: { userId: user.id },
        select: { agencyId: true },
      });
      const allowedAgencyIds = access.map(a => a.agencyId);
      if (agencyId) {
        const requested = parseInt(agencyId);
        if (!allowedAgencyIds.includes(requested)) {
          return res.status(403).json({ error: 'Access denied to this agency' });
        }
        where.agencyId = requested;
      } else {
        where.agencyId = { in: allowedAgencyIds };
      }
    } else {
      if (agencyId) where.agencyId = parseInt(agencyId);
    }

    if (clientId) where.clientId = parseInt(clientId);

    const logs = await prisma.scheduleLog.findMany({
      where,
      select: {
        scheduleMonth: true,
        medium: true,
        mediaGroup: true,
        scheduleValue: true,
        scheduleValueWithVat: true,
        channelMasterId: true,
        channelMaster: { select: { name: true } },
        client: { select: { name: true } },
        agency: { select: { name: true } },
        brandName: true,
      },
    });

    // Aggregations
    const byMediaGroup = {};
    const byMedium = {};
    const byChannel = {};
    const byMonth = {};
    const byClient = {};
    const byBrand = {};
    let totalValue = 0;
    let totalWithVat = 0;

    for (const log of logs) {
      const val = Number(log.scheduleValue) || 0;
      const vat = Number(log.scheduleValueWithVat) || 0;
      totalValue += val;
      totalWithVat += vat;

      const mg = log.mediaGroup || 'Unknown';
      if (!byMediaGroup[mg]) byMediaGroup[mg] = { name: mg, value: 0, count: 0 };
      byMediaGroup[mg].value += val;
      byMediaGroup[mg].count++;

      const med = log.medium || 'Unknown';
      if (!byMedium[med]) byMedium[med] = { name: med, value: 0, count: 0 };
      byMedium[med].value += val;
      byMedium[med].count++;

      const ch = log.channelMaster?.name || 'Unknown';
      if (!byChannel[ch]) byChannel[ch] = { name: ch, medium: med, mediaGroup: mg, value: 0, count: 0 };
      byChannel[ch].value += val;
      byChannel[ch].count++;

      const month = log.scheduleMonth || 'Unknown';
      if (!byMonth[month]) byMonth[month] = { month, value: 0, valueWithVat: 0, count: 0 };
      byMonth[month].value += val;
      byMonth[month].valueWithVat += vat;
      byMonth[month].count++;

      const client = log.client?.name || 'Unknown';
      if (!byClient[client]) byClient[client] = { name: client, value: 0, count: 0 };
      byClient[client].value += val;
      byClient[client].count++;

      const brand = log.brandName || 'Unbranded';
      if (!byBrand[brand]) byBrand[brand] = { name: brand, value: 0, count: 0 };
      byBrand[brand].value += val;
      byBrand[brand].count++;
    }

    return res.json({
      totalEntries: logs.length,
      totalValue: Math.round(totalValue * 100) / 100,
      totalWithVat: Math.round(totalWithVat * 100) / 100,
      byMediaGroup: Object.values(byMediaGroup).sort((a, b) => b.value - a.value),
      byMedium: Object.values(byMedium).sort((a, b) => b.value - a.value),
      byChannel: Object.values(byChannel).sort((a, b) => b.value - a.value),
      byMonth: Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month)),
      byClient: Object.values(byClient).sort((a, b) => b.value - a.value),
      byBrand: Object.values(byBrand).sort((a, b) => b.value - a.value),
    });
  } catch (error) {
    console.error('Get analytics error:', error);
    return res.status(500).json({ error: 'Failed to get analytics', detail: error.message });
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
      brandName,
    } = req.body;

    if (!clientId || !channelMasterId || !roNumber || !scheduleMonth || scheduleValue === undefined) {
      return res.status(400).json({
        error: 'clientId, channelMasterId, roNumber, scheduleMonth, and scheduleValue are required',
      });
    }

    const user = req.user;
    const cid = parseInt(clientId);

    const accessedClientId = await resolveClientAccess(user, cid);
    if (accessedClientId === null) {
      return res.status(403).json({ error: 'You do not have access to this client' });
    }

    const client = await prisma.client.findUnique({
      where: { id: cid },
      select: { agencyId: true },
    });
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const channelMasterRec = await prisma.channelMaster.findUnique({
      where: { id: parseInt(channelMasterId) },
      include: { mediaGroup: { select: { name: true } } },
    });
    if (!channelMasterRec) return res.status(404).json({ error: 'Channel master not found' });

    const invoiceMonth = computeInvoiceMonth(scheduleMonth);
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
        brandName: brandName || null,
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

// ── bulkCreateScheduleLogs ──

export async function bulkCreateScheduleLogs(req, res) {
  try {
    const { rows, fileName } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'rows array is required' });
    }
    if (rows.length > 100) {
      return res.status(400).json({ error: 'Maximum 100 rows per batch' });
    }

    const user = req.user;
    const results = [];
    const errors = [];

    // Determine client/agency from first row for batch record
    const firstRow = rows[0];
    const batchClientId = parseInt(firstRow.clientId);
    const batchClient = await prisma.client.findUnique({
      where: { id: batchClientId },
      select: { agencyId: true },
    });

    // Create upload batch to track this upload
    let uploadBatch = null;
    if (batchClient && fileName) {
      uploadBatch = await prisma.uploadBatch.create({
        data: {
          agencyId: batchClient.agencyId,
          clientIds: [batchClientId],
          scheduleMonth: firstRow.scheduleMonth || '',
          uploadedById: user.id,
          fileName: fileName || 'manual-entry',
          totalRows: rows.length,
          status: 'PROCESSING',
        },
      });
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const { clientId, channelMasterId, roNumber, scheduleMonth, scheduleValue, brandName } = row;

        if (!clientId || !channelMasterId || !roNumber || !scheduleMonth || scheduleValue === undefined) {
          errors.push({ row: i, error: 'Missing required fields' });
          continue;
        }

        const cid = parseInt(clientId);
        const accessedClientId = await resolveClientAccess(user, cid);
        if (accessedClientId === null) {
          errors.push({ row: i, error: 'No access to this client' });
          continue;
        }

        const client = await prisma.client.findUnique({
          where: { id: cid },
          select: { agencyId: true },
        });
        if (!client) { errors.push({ row: i, error: 'Client not found' }); continue; }

        const channelMasterRec = await prisma.channelMaster.findUnique({
          where: { id: parseInt(channelMasterId) },
          include: { mediaGroup: { select: { name: true } } },
        });
        if (!channelMasterRec) { errors.push({ row: i, error: 'Channel not found' }); continue; }

        const invoiceMonth = computeInvoiceMonth(scheduleMonth);
        const value = parseFloat(scheduleValue);
        const scheduleValueWithVat = parseFloat((value * 1.18).toFixed(2));

        const log = await prisma.scheduleLog.create({
          data: {
            agencyId: client.agencyId,
            clientId: cid,
            channelMasterId: parseInt(channelMasterId),
            uploadedById: user.id,
            uploadBatchId: uploadBatch?.id || null,
            roNumber,
            scheduleMonth,
            invoiceMonth,
            medium: channelMasterRec.medium,
            mediaGroup: channelMasterRec.mediaGroup.name,
            brandName: brandName || null,
            scheduleValue: value,
            scheduleValueWithVat,
          },
          include: logIncludes,
        });
        results.push(serializeLog(log));
      } catch (err) {
        errors.push({ row: i, error: err.message });
      }
    }

    // Update batch with results
    if (uploadBatch) {
      await prisma.uploadBatch.update({
        where: { id: uploadBatch.id },
        data: {
          successfulRows: results.length,
          failedRows: errors.length,
          status: errors.length === rows.length ? 'FAILED' : 'COMPLETE',
        },
      });
    }

    return res.status(201).json({ created: results, errors, batchId: uploadBatch?.id || null });
  } catch (error) {
    console.error('Bulk create error:', error);
    return res.status(500).json({ error: 'Failed to bulk create', detail: error.message });
  }
}

// ── getUploadBatches ──

export async function getUploadBatches(req, res) {
  try {
    const { clientId } = req.query;
    if (!clientId) return res.status(400).json({ error: 'clientId is required' });

    const user = req.user;
    const cid = parseInt(clientId);
    const accessedClientId = await resolveClientAccess(user, cid);
    if (accessedClientId === null) {
      return res.status(403).json({ error: 'You do not have access to this client' });
    }

    const batches = await prisma.uploadBatch.findMany({
      where: {
        clientIds: { has: cid },
        status: { not: 'FAILED' },
      },
      include: {
        uploader: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    // For each batch, count how many active (non-deleted) logs remain
    const batchesWithCounts = await Promise.all(
      batches.map(async (batch) => {
        const activeCount = await prisma.scheduleLog.count({
          where: { uploadBatchId: batch.id, isDeleted: false },
        });
        return { ...batch, activeRows: activeCount };
      })
    );

    return res.json({ batches: batchesWithCounts.filter(b => b.activeRows > 0) });
  } catch (error) {
    console.error('Get upload batches error:', error);
    return res.status(500).json({ error: 'Failed to get upload batches', detail: error.message });
  }
}

// ── deleteUploadBatch ──

export async function deleteUploadBatch(req, res) {
  try {
    const batchId = parseInt(req.params.batchId);
    const user = req.user;

    const batch = await prisma.uploadBatch.findUnique({ where: { id: batchId } });
    if (!batch) return res.status(404).json({ error: 'Upload batch not found' });

    // Only the uploader or SUPER_ADMIN can delete a batch
    if (user.role !== 'SUPER_ADMIN' && batch.uploadedById !== user.id) {
      return res.status(403).json({ error: 'You can only delete your own uploads' });
    }

    // Soft-delete all schedule logs in this batch
    const result = await prisma.scheduleLog.updateMany({
      where: { uploadBatchId: batchId, isDeleted: false },
      data: {
        isDeleted: true,
        deletedById: user.id,
        deletedAt: new Date(),
      },
    });

    return res.json({ message: `Deleted ${result.count} rows from batch`, deletedCount: result.count });
  } catch (error) {
    console.error('Delete upload batch error:', error);
    return res.status(500).json({ error: 'Failed to delete upload batch', detail: error.message });
  }
}

// ── getRecentBatches ──
// Recent upload sheets across all clients the user can access (no clientId
// filter required). Used by the Database page and the Admin panel.

export async function getRecentBatches(req, res) {
  try {
    const user = req.user;
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));

    const where = { status: { not: 'FAILED' } };
    if (user.role !== 'SUPER_ADMIN') {
      const clientIds = await getAccessibleClientIds(user.id, user.role);
      if (!clientIds.length) return res.json({ batches: [] });
      where.clientIds = { hasSome: clientIds };
    }

    const batches = await prisma.uploadBatch.findMany({
      where,
      include: {
        uploader: { select: { id: true, name: true } },
        agency: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    // Resolve client names referenced across the batches in one query.
    const allClientIds = [...new Set(batches.flatMap(b => b.clientIds || []))];
    const clients = allClientIds.length
      ? await prisma.client.findMany({ where: { id: { in: allClientIds } }, select: { id: true, name: true } })
      : [];
    const clientNameMap = new Map(clients.map(c => [c.id, c.name]));

    const withCounts = await Promise.all(batches.map(async (b) => {
      const activeRows = await prisma.scheduleLog.count({
        where: { uploadBatchId: b.id, isDeleted: false },
      });
      return {
        id: b.id,
        fileName: b.fileName,
        scheduleMonth: b.scheduleMonth,
        totalRows: b.totalRows,
        activeRows,
        status: b.status,
        createdAt: b.createdAt,
        uploader: b.uploader,
        agencyName: b.agency?.name || '',
        clientNames: (b.clientIds || []).map(id => clientNameMap.get(id)).filter(Boolean),
        canDelete: user.role === 'SUPER_ADMIN' || b.uploadedById === user.id,
      };
    }));

    return res.json({ batches: withCounts.filter(b => b.activeRows > 0) });
  } catch (error) {
    console.error('Get recent batches error:', error);
    return res.status(500).json({ error: 'Failed to get recent batches', detail: error.message });
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

    if (user.role === 'MANAGER') {
      return res.status(403).json({ error: 'Managers cannot edit schedule logs' });
    }

    if (user.role === 'PLANNER') {
      if (existing.uploadedById !== user.id) {
        return res.status(403).json({ error: 'You can only edit your own schedule log entries' });
      }
    }

    if (user.role === 'GROUP_HEAD') {
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

    const updateData = {};
    const editableFields = [
      'roNumber', 'scheduleMonth', 'invoiceMonth', 'scheduleValue',
      'channelMasterId', 'brandName',
    ];

    for (const field of editableFields) {
      if (updates[field] !== undefined) {
        if (field === 'scheduleValue') {
          updateData.scheduleValue = parseFloat(updates.scheduleValue);
          updateData.scheduleValueWithVat = parseFloat((parseFloat(updates.scheduleValue) * 1.18).toFixed(2));
        } else if (field === 'channelMasterId') {
          updateData[field] = parseInt(updates[field]);
        } else {
          updateData[field] = updates[field];
        }
      }
    }

    // If scheduleMonth changed, recompute invoiceMonth
    if (updateData.scheduleMonth && !updateData.invoiceMonth) {
      updateData.invoiceMonth = computeInvoiceMonth(updateData.scheduleMonth);
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

    const previousValues = {};
    for (const key of Object.keys(updateData)) {
      previousValues[key] = existing[key] != null ? String(existing[key]) : null;
    }

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
