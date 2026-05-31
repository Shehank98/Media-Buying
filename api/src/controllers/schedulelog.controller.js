import prisma from '../utils/prisma.js';

function serializeLog(log) {
  return {
    ...log,
    scheduleValue: Number(log.scheduleValue),
    invoiceValue: log.invoiceValue != null ? Number(log.invoiceValue) : null,
    cagPct: log.cagPct != null ? Number(log.cagPct) : null,
    cagAmount: log.cagAmount != null ? Number(log.cagAmount) : null,
    aorPct: log.aorPct != null ? Number(log.aorPct) : null,
    aorRevenue: log.aorRevenue != null ? Number(log.aorRevenue) : null,
    scheduleMonth: log.scheduleMonth instanceof Date ? log.scheduleMonth.toISOString() : log.scheduleMonth,
    invoiceMonth: log.invoiceMonth instanceof Date ? log.invoiceMonth.toISOString() : log.invoiceMonth,
    invoiceSentToClientDate: log.invoiceSentToClientDate instanceof Date ? log.invoiceSentToClientDate.toISOString() : log.invoiceSentToClientDate,
    paymentReceivedDate: log.paymentReceivedDate instanceof Date ? log.paymentReceivedDate.toISOString() : log.paymentReceivedDate,
  };
}

const logIncludes = {
  channelMaster: { select: { id: true, name: true, medium: true } },
  brand: { select: { id: true, name: true } },
  campaign: { select: { id: true, name: true } },
  creator: { select: { id: true, name: true } },
};

export async function listScheduleLogs(req, res) {
  try {
    const clientId = parseInt(req.params.clientId);
    const { year, month, brandId, channelMasterId } = req.query;

    const where = { clientId };

    if (year || month) {
      const y = year ? parseInt(year) : new Date().getFullYear();
      if (month) {
        const m = parseInt(month);
        const start = new Date(Date.UTC(y, m - 1, 1));
        const end = new Date(Date.UTC(y, m, 1));
        where.scheduleMonth = { gte: start, lt: end };
      } else {
        const start = new Date(Date.UTC(y, 0, 1));
        const end = new Date(Date.UTC(y + 1, 0, 1));
        where.scheduleMonth = { gte: start, lt: end };
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

export async function createScheduleLog(req, res) {
  try {
    const clientId = parseInt(req.params.clientId);
    const {
      channelMasterId,
      brandId,
      campaignId,
      scheduleMonth,
      invoiceMonth,
      scheduleValue,
      invoiceValue,
      roNumber,
      cagPct,
      cagAmount,
      aorPct,
      aorRevenue,
      mediaGroup,
      notes,
      invoiceSentToClientDate,
      paymentReceivedDate,
      propertyId,
    } = req.body;

    if (!channelMasterId || !scheduleMonth || scheduleValue === undefined) {
      return res.status(400).json({ error: 'channelMasterId, scheduleMonth, and scheduleValue are required' });
    }

    // Parse scheduleMonth: accept "YYYY-MM" or ISO string
    let parsedScheduleMonth;
    if (typeof scheduleMonth === 'string' && /^\d{4}-\d{2}$/.test(scheduleMonth)) {
      const [y, m] = scheduleMonth.split('-').map(Number);
      parsedScheduleMonth = new Date(Date.UTC(y, m - 1, 1));
    } else {
      parsedScheduleMonth = new Date(scheduleMonth);
    }

    let parsedInvoiceMonth = null;
    if (invoiceMonth) {
      if (typeof invoiceMonth === 'string' && /^\d{4}-\d{2}$/.test(invoiceMonth)) {
        const [y, m] = invoiceMonth.split('-').map(Number);
        parsedInvoiceMonth = new Date(Date.UTC(y, m - 1, 1));
      } else {
        parsedInvoiceMonth = new Date(invoiceMonth);
      }
    }

    // Auto-compute invoiceValue if not provided but cagAmount is
    let computedInvoiceValue = invoiceValue !== undefined ? invoiceValue : null;
    if (computedInvoiceValue === null && scheduleValue !== undefined && cagAmount !== undefined && cagAmount !== null) {
      computedInvoiceValue = parseFloat(scheduleValue) - parseFloat(cagAmount);
    }

    const data = {
      clientId,
      channelMasterId: parseInt(channelMasterId),
      createdBy: req.user.id,
      scheduleMonth: parsedScheduleMonth,
      scheduleValue: parseFloat(scheduleValue),
    };

    if (brandId !== undefined && brandId !== null) data.brandId = parseInt(brandId);
    if (campaignId !== undefined && campaignId !== null) data.campaignId = parseInt(campaignId);
    if (parsedInvoiceMonth) data.invoiceMonth = parsedInvoiceMonth;
    if (computedInvoiceValue !== null) data.invoiceValue = parseFloat(computedInvoiceValue);
    if (roNumber !== undefined) data.roNumber = roNumber;
    if (cagPct !== undefined && cagPct !== null) data.cagPct = parseFloat(cagPct);
    if (cagAmount !== undefined && cagAmount !== null) data.cagAmount = parseFloat(cagAmount);
    if (aorPct !== undefined && aorPct !== null) data.aorPct = parseFloat(aorPct);
    if (aorRevenue !== undefined && aorRevenue !== null) data.aorRevenue = parseFloat(aorRevenue);
    if (mediaGroup !== undefined) data.mediaGroup = mediaGroup;
    if (notes !== undefined) data.notes = notes;
    if (invoiceSentToClientDate) data.invoiceSentToClientDate = new Date(invoiceSentToClientDate);
    if (paymentReceivedDate) data.paymentReceivedDate = new Date(paymentReceivedDate);
    if (propertyId !== undefined && propertyId !== null) data.propertyId = parseInt(propertyId);

    const log = await prisma.scheduleLog.create({
      data,
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

    // Access control: only creator, SUPER_ADMIN, or GROUP_HEAD can update
    if (
      user.role !== 'SUPER_ADMIN' &&
      user.role !== 'GROUP_HEAD' &&
      existing.createdBy !== user.id
    ) {
      return res.status(403).json({ error: 'You do not have permission to update this schedule log' });
    }

    const {
      channelMasterId,
      brandId,
      campaignId,
      scheduleMonth,
      invoiceMonth,
      scheduleValue,
      invoiceValue,
      roNumber,
      cagPct,
      cagAmount,
      aorPct,
      aorRevenue,
      mediaGroup,
      notes,
      invoiceSentToClientDate,
      paymentReceivedDate,
      propertyId,
    } = req.body;

    const data = {};

    if (channelMasterId !== undefined) data.channelMasterId = parseInt(channelMasterId);
    if (brandId !== undefined) data.brandId = brandId !== null ? parseInt(brandId) : null;
    if (campaignId !== undefined) data.campaignId = campaignId !== null ? parseInt(campaignId) : null;
    if (scheduleValue !== undefined) data.scheduleValue = parseFloat(scheduleValue);
    if (invoiceValue !== undefined) data.invoiceValue = invoiceValue !== null ? parseFloat(invoiceValue) : null;
    if (roNumber !== undefined) data.roNumber = roNumber;
    if (cagPct !== undefined) data.cagPct = cagPct !== null ? parseFloat(cagPct) : null;
    if (cagAmount !== undefined) data.cagAmount = cagAmount !== null ? parseFloat(cagAmount) : null;
    if (aorPct !== undefined) data.aorPct = aorPct !== null ? parseFloat(aorPct) : null;
    if (aorRevenue !== undefined) data.aorRevenue = aorRevenue !== null ? parseFloat(aorRevenue) : null;
    if (mediaGroup !== undefined) data.mediaGroup = mediaGroup;
    if (notes !== undefined) data.notes = notes;
    if (propertyId !== undefined) data.propertyId = propertyId !== null ? parseInt(propertyId) : null;

    if (scheduleMonth !== undefined) {
      if (typeof scheduleMonth === 'string' && /^\d{4}-\d{2}$/.test(scheduleMonth)) {
        const [y, m] = scheduleMonth.split('-').map(Number);
        data.scheduleMonth = new Date(Date.UTC(y, m - 1, 1));
      } else {
        data.scheduleMonth = new Date(scheduleMonth);
      }
    }

    if (invoiceMonth !== undefined) {
      if (invoiceMonth === null) {
        data.invoiceMonth = null;
      } else if (typeof invoiceMonth === 'string' && /^\d{4}-\d{2}$/.test(invoiceMonth)) {
        const [y, m] = invoiceMonth.split('-').map(Number);
        data.invoiceMonth = new Date(Date.UTC(y, m - 1, 1));
      } else {
        data.invoiceMonth = new Date(invoiceMonth);
      }
    }

    if (invoiceSentToClientDate !== undefined) {
      data.invoiceSentToClientDate = invoiceSentToClientDate ? new Date(invoiceSentToClientDate) : null;
    }
    if (paymentReceivedDate !== undefined) {
      data.paymentReceivedDate = paymentReceivedDate ? new Date(paymentReceivedDate) : null;
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

    // Only creator or SUPER_ADMIN can delete
    if (user.role !== 'SUPER_ADMIN' && existing.createdBy !== user.id) {
      return res.status(403).json({ error: 'You do not have permission to delete this schedule log' });
    }

    await prisma.scheduleLog.delete({ where: { id } });
    return res.json({ message: 'Schedule log deleted successfully' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Schedule log not found' });
    console.error('Delete schedule log error:', error);
    return res.status(500).json({ error: 'Failed to delete schedule log' });
  }
}
