import prisma from '../utils/prisma.js';
import { getAccessibleClientIds } from '../middleware/access.js';

// True if the caller can reach the client this log belongs to.
async function logClientReachable(user, clientId) {
  if (user.role === 'SUPER_ADMIN') return true;
  const ids = await getAccessibleClientIds(user.id, user.role);
  return ids.includes(clientId);
}

function serializeLog(log) {
  return {
    ...log,
    scheduleValue: Number(log.scheduleValue),
    scheduleValueWithVat: Number(log.scheduleValueWithVat),
  };
}

const logIncludes = {
  channelMaster: { select: { id: true, name: true, medium: true } },
  brand: { select: { id: true, name: true } },
  campaign: { select: { id: true, name: true } },
  uploader: { select: { id: true, name: true } },
};

export async function listScheduleLogs(req, res) {
  try {
    const clientId = parseInt(req.params.clientId);
    const { year, month, brandId, channelMasterId } = req.query;

    const where = { clientId, isDeleted: false };

    if (year || month) {
      const y = year ? parseInt(year) : new Date().getFullYear();
      if (month) {
        const ym = `${y}-${String(parseInt(month)).padStart(2, '0')}`;
        where.scheduleMonth = ym;
      } else {
        where.scheduleMonth = { gte: `${y}-01`, lte: `${y}-12` };
      }
    }

    if (brandId) where.brandId = parseInt(brandId);
    if (channelMasterId) where.channelMasterId = parseInt(channelMasterId);

    const logs = await prisma.scheduleLog.findMany({
      where,
      include: logIncludes,
      orderBy: { scheduleMonth: 'desc' },
    });

    return res.json({ scheduleLogs: logs.map(serializeLog) });
  } catch (error) {
    console.error('List schedule logs error:', error);
    return res.status(500).json({ error: 'Failed to list schedule logs' });
  }
}

function computeInvoiceMonth(scheduleMonth) {
  const [y, m] = scheduleMonth.split('-').map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export async function createScheduleLog(req, res) {
  try {
    const clientId = parseInt(req.params.clientId);
    const {
      channelMasterId,
      brandId,
      campaignId,
      scheduleMonth,
      scheduleValue,
      roNumber,
    } = req.body;

    if (!channelMasterId || !scheduleMonth || scheduleValue === undefined || !brandId || !campaignId || !roNumber) {
      return res.status(400).json({ error: 'channelMasterId, brandId, campaignId, scheduleMonth, scheduleValue, and roNumber are required' });
    }

    const cm = await prisma.channelMaster.findUnique({
      where: { id: parseInt(channelMasterId) },
      include: { mediaGroup: { select: { name: true } } },
    });
    if (!cm) return res.status(400).json({ error: 'Channel master not found' });

    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { agencyId: true } });
    if (!client) return res.status(400).json({ error: 'Client not found' });

    const sv = parseFloat(scheduleValue);
    const invoiceMonth = computeInvoiceMonth(scheduleMonth);

    const log = await prisma.scheduleLog.create({
      data: {
        agencyId: client.agencyId,
        clientId,
        brandId: parseInt(brandId),
        campaignId: parseInt(campaignId),
        channelMasterId: parseInt(channelMasterId),
        uploadedById: req.user.id,
        roNumber,
        scheduleMonth,
        invoiceMonth,
        medium: cm.medium,
        mediaGroup: cm.mediaGroup?.name || '',
        scheduleValue: sv,
        scheduleValueWithVat: parseFloat((sv * 1.18).toFixed(2)),
      },
      include: logIncludes,
    });

    return res.status(201).json({ scheduleLog: serializeLog(log) });
  } catch (error) {
    if (error.code === 'P2003') return res.status(400).json({ error: 'Referenced record not found (channelMaster, brand, or campaign)' });
    console.error('Create schedule log error:', error);
    return res.status(500).json({ error: 'Failed to create schedule log' });
  }
}

export async function updateScheduleLog(req, res) {
  try {
    const id = parseInt(req.params.id);
    const user = req.user;

    const existing = await prisma.scheduleLog.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Schedule log not found' });

    // Must be able to reach the log's client regardless of role.
    if (!(await logClientReachable(user, existing.clientId))) {
      return res.status(403).json({ error: 'You do not have access to this schedule log' });
    }

    if (
      user.role !== 'SUPER_ADMIN' &&
      user.role !== 'GROUP_HEAD' &&
      existing.uploadedById !== user.id
    ) {
      return res.status(403).json({ error: 'You do not have permission to update this schedule log' });
    }

    const {
      channelMasterId,
      brandId,
      campaignId,
      scheduleMonth,
      scheduleValue,
      roNumber,
    } = req.body;

    const data = {};

    if (channelMasterId !== undefined) {
      const cm = await prisma.channelMaster.findUnique({
        where: { id: parseInt(channelMasterId) },
        include: { mediaGroup: { select: { name: true } } },
      });
      if (!cm) return res.status(400).json({ error: 'Channel master not found' });
      data.channelMasterId = parseInt(channelMasterId);
      data.medium = cm.medium;
      data.mediaGroup = cm.mediaGroup?.name || '';
    }

    if (brandId !== undefined) data.brandId = brandId !== null ? parseInt(brandId) : null;
    if (campaignId !== undefined) data.campaignId = campaignId !== null ? parseInt(campaignId) : null;
    if (roNumber !== undefined) data.roNumber = roNumber;

    if (scheduleMonth !== undefined) {
      data.scheduleMonth = scheduleMonth;
      data.invoiceMonth = computeInvoiceMonth(scheduleMonth);
    }

    if (scheduleValue !== undefined) {
      const sv = parseFloat(scheduleValue);
      data.scheduleValue = sv;
      data.scheduleValueWithVat = parseFloat((sv * 1.18).toFixed(2));
    }

    const log = await prisma.scheduleLog.update({
      where: { id },
      data,
      include: logIncludes,
    });

    return res.json({ scheduleLog: serializeLog(log) });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Schedule log not found' });
    if (error.code === 'P2003') return res.status(400).json({ error: 'Referenced record not found' });
    console.error('Update schedule log error:', error);
    return res.status(500).json({ error: 'Failed to update schedule log' });
  }
}

export async function deleteScheduleLog(req, res) {
  try {
    const id = parseInt(req.params.id);
    const user = req.user;

    const existing = await prisma.scheduleLog.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Schedule log not found' });

    if (!(await logClientReachable(user, existing.clientId))) {
      return res.status(403).json({ error: 'You do not have access to this schedule log' });
    }

    if (user.role !== 'SUPER_ADMIN' && existing.uploadedById !== user.id) {
      return res.status(403).json({ error: 'You do not have permission to delete this schedule log' });
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
    return res.status(500).json({ error: 'Failed to delete schedule log' });
  }
}
