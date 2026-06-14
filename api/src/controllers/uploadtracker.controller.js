import prisma from '../utils/prisma.js';
import ExcelJS from 'exceljs';
import { sendEmail } from '../services/email.service.js';

// FRONTEND_URL may be a comma-separated CORS whitelist; use the first entry.
function loginUrl() {
  const raw = process.env.FRONTEND_URL || 'https://media-buying-production.up.railway.app';
  return raw.split(',')[0].trim();
}

function safeNum(v) {
  if (v == null) return 0;
  return Number(v);
}

export async function getUploadTracker(req, res) {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const months = Array.from({ length: 12 }, (_, i) =>
      `${year}-${String(i + 1).padStart(2, '0')}`
    );

    const agencies = await prisma.agency.findMany({
      orderBy: { name: 'asc' },
      include: {
        users: {
          include: {
            user: { select: { id: true, name: true, email: true, role: true } },
          },
        },
        clients: { select: { id: true, name: true } },
      },
    });

    const logsByAgencyMonth = await prisma.scheduleLog.groupBy({
      by: ['agencyId', 'scheduleMonth', 'uploadedById'],
      where: {
        isDeleted: false,
        scheduleMonth: { gte: months[0], lte: months[11] },
      },
      _count: true,
      _sum: { scheduleValue: true },
    });

    const batchesByAgencyMonth = await prisma.uploadBatch.groupBy({
      by: ['agencyId', 'scheduleMonth', 'uploadedById'],
      where: {
        scheduleMonth: { gte: months[0], lte: months[11] },
      },
      _count: true,
    });

    const remindersSent = await prisma.notification.findMany({
      where: {
        type: 'UPLOAD_REMINDER',
        month: { in: months },
      },
      select: { userId: true, month: true, createdAt: true },
    });

    const reminderMap = {};
    for (const r of remindersSent) {
      const key = `${r.userId}-${r.month}`;
      reminderMap[key] = r.createdAt;
    }

    const result = months.map(month => {
      const agencyData = agencies.map(agency => {
        const assignedUsers = agency.users
          .map(ua => ua.user)
          .filter(u => ['PLANNER', 'GROUP_HEAD', 'SUPER_ADMIN'].includes(u.role));

        const logsForMonth = logsByAgencyMonth.filter(
          l => l.agencyId === agency.id && l.scheduleMonth === month
        );

        const batchesForMonth = batchesByAgencyMonth.filter(
          b => b.agencyId === agency.id && b.scheduleMonth === month
        );

        const uploaderIds = new Set([
          ...logsForMonth.map(l => l.uploadedById),
          ...batchesForMonth.map(b => b.uploadedById),
        ]);

        const totalLogs = logsForMonth.reduce((s, l) => s + l._count, 0);
        const totalValue = logsForMonth.reduce(
          (s, l) => s + safeNum(l._sum.scheduleValue), 0
        );

        const uploadedUsers = assignedUsers
          .filter(u => uploaderIds.has(u.id))
          .map(u => ({
            ...u,
            logCount: logsForMonth
              .filter(l => l.uploadedById === u.id)
              .reduce((s, l) => s + l._count, 0),
          }));

        const pendingUsers = assignedUsers
          .filter(u => !uploaderIds.has(u.id))
          .map(u => ({
            ...u,
            reminderSentAt: reminderMap[`${u.id}-${month}`] || null,
          }));

        return {
          agencyId: agency.id,
          agencyName: agency.name,
          clientCount: agency.clients.length,
          hasUploaded: totalLogs > 0,
          totalLogs,
          totalValue,
          uploadedUsers,
          pendingUsers,
          assignedUserCount: assignedUsers.length,
        };
      });

      const uploaded = agencyData.filter(a => a.hasUploaded).length;
      return {
        month,
        totalAgencies: agencyData.length,
        uploadedAgencies: uploaded,
        pendingAgencies: agencyData.length - uploaded,
        agencies: agencyData,
      };
    });

    return res.json({ year, months: result });
  } catch (error) {
    console.error('getUploadTracker error:', error);
    return res.status(500).json({ error: 'Failed to get upload tracker', detail: error.message });
  }
}

export async function sendReminder(req, res) {
  try {
    const { userIds, month, message } = req.body;
    if (!userIds?.length || !month) {
      return res.status(400).json({ error: 'userIds and month are required' });
    }

    const users = await prisma.user.findMany({
      where: { id: { in: userIds.map(id => parseInt(id)) } },
      select: { id: true, name: true, email: true },
    });

    if (!users.length) return res.status(404).json({ error: 'No users found' });

    const [y, m] = month.split('-');
    const monthLabel = new Date(+y, +m - 1, 1).toLocaleDateString('en-US', {
      month: 'long', year: 'numeric',
    });

    const reminderText = message || `Please upload your schedule data for ${monthLabel}.`;

    const notifications = await prisma.notification.createMany({
      data: users.map(u => ({
        userId: u.id,
        type: 'UPLOAD_REMINDER',
        title: 'Upload Reminder',
        message: reminderText,
        month,
      })),
    });

    // Also deliver the reminder by email (fire-and-forget per recipient).
    const link = loginUrl();
    for (const u of users) {
      if (!u.email) continue;
      sendEmail({
        type: 'reminder',
        to: u.email,
        name: u.name,
        monthLabel,
        message: reminderText,
        loginUrl: link,
      }).catch(err => console.error(`Reminder email to ${u.email} failed:`, err));
    }

    return res.json({
      message: `Reminder sent to ${users.length} user(s)`,
      count: notifications.count,
      users: users.map(u => ({ id: u.id, name: u.name, email: u.email })),
    });
  } catch (error) {
    console.error('sendReminder error:', error);
    return res.status(500).json({ error: 'Failed to send reminder', detail: error.message });
  }
}

export async function getNotifications(req, res) {
  try {
    const userId = req.user.id;
    const { unreadOnly } = req.query;

    const where = { userId };
    if (unreadOnly === 'true') where.isRead = false;

    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.notification.count({ where: { userId, isRead: false } }),
    ]);

    return res.json({ notifications, unreadCount });
  } catch (error) {
    console.error('getNotifications error:', error);
    return res.status(500).json({ error: 'Failed to get notifications' });
  }
}

export async function markNotificationRead(req, res) {
  try {
    const id = parseInt(req.params.id);
    const notification = await prisma.notification.update({
      where: { id, userId: req.user.id },
      data: { isRead: true },
    });
    return res.json({ notification });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Notification not found' });
    return res.status(500).json({ error: 'Failed to mark notification read' });
  }
}

export async function markAllNotificationsRead(req, res) {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user.id, isRead: false },
      data: { isRead: true },
    });
    return res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to mark notifications read' });
  }
}

export async function exportMasterSheet(req, res) {
  try {
    const { month } = req.query;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'month query parameter is required (YYYY-MM)' });
    }

    const logs = await prisma.scheduleLog.findMany({
      where: { scheduleMonth: month, isDeleted: false },
      include: {
        agency: { select: { name: true } },
        client: { select: { name: true } },
        brand: { select: { name: true } },
        campaign: { select: { name: true } },
        channelMaster: { select: { name: true, medium: true } },
        uploader: { select: { name: true } },
      },
      orderBy: [{ agency: { name: 'asc' } }, { client: { name: 'asc' } }, { channelMaster: { name: 'asc' } }],
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Ogilvy Orbit';

    const headerStyle = {
      font: { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A1729' } },
      alignment: { horizontal: 'center', vertical: 'middle' },
      border: {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' },
      },
    };

    const columns = [
      { header: 'Agency', key: 'agency', width: 20 },
      { header: 'Client', key: 'client', width: 22 },
      { header: 'Brand', key: 'brand', width: 18 },
      { header: 'Campaign', key: 'campaign', width: 22 },
      { header: 'Channel', key: 'channel', width: 20 },
      { header: 'Medium', key: 'medium', width: 10 },
      { header: 'Media Group', key: 'mediaGroup', width: 18 },
      { header: 'RO Number', key: 'roNumber', width: 15 },
      { header: 'Schedule Month', key: 'scheduleMonth', width: 16 },
      { header: 'Invoice Month', key: 'invoiceMonth', width: 16 },
      { header: 'Schedule Value', key: 'scheduleValue', width: 18 },
      { header: 'With VAT (18%)', key: 'scheduleValueWithVat', width: 18 },
      { header: 'Uploaded By', key: 'uploadedBy', width: 18 },
    ];

    function addSheet(name, data) {
      const ws = wb.addWorksheet(name);
      ws.columns = columns;
      ws.getRow(1).eachCell(cell => { Object.assign(cell, headerStyle); });
      ws.getRow(1).height = 28;

      for (const log of data) {
        const row = ws.addRow({
          agency: log.agency?.name || '',
          client: log.client?.name || '',
          brand: log.brand?.name || '',
          campaign: log.campaign?.name || '',
          channel: log.channelMaster?.name || '',
          medium: log.channelMaster?.medium || log.medium || '',
          mediaGroup: log.mediaGroup || '',
          roNumber: log.roNumber || '',
          scheduleMonth: log.scheduleMonth,
          invoiceMonth: log.invoiceMonth,
          scheduleValue: safeNum(log.scheduleValue),
          scheduleValueWithVat: safeNum(log.scheduleValueWithVat),
          uploadedBy: log.uploader?.name || '',
        });

        row.getCell('scheduleValue').numFmt = '#,##0.00';
        row.getCell('scheduleValueWithVat').numFmt = '#,##0.00';
      }

      if (data.length > 0) {
        const totalRow = ws.addRow({});
        totalRow.getCell(1).value = 'TOTAL';
        totalRow.getCell(1).font = { bold: true };
        const svCol = columns.findIndex(c => c.key === 'scheduleValue') + 1;
        const vatCol = columns.findIndex(c => c.key === 'scheduleValueWithVat') + 1;
        totalRow.getCell(svCol).value = data.reduce((s, l) => s + safeNum(l.scheduleValue), 0);
        totalRow.getCell(svCol).numFmt = '#,##0.00';
        totalRow.getCell(svCol).font = { bold: true };
        totalRow.getCell(vatCol).value = data.reduce((s, l) => s + safeNum(l.scheduleValueWithVat), 0);
        totalRow.getCell(vatCol).numFmt = '#,##0.00';
        totalRow.getCell(vatCol).font = { bold: true };
      }

      ws.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + columns.length)}1` };
    }

    addSheet('Master - All Agencies', logs);

    const byAgency = {};
    for (const log of logs) {
      const name = log.agency?.name || 'Unknown';
      if (!byAgency[name]) byAgency[name] = [];
      byAgency[name].push(log);
    }
    for (const [agencyName, agencyLogs] of Object.entries(byAgency)) {
      const sheetName = agencyName.substring(0, 31).replace(/[\\/*?[\]:]/g, '_');
      addSheet(sheetName, agencyLogs);
    }

    const [y, m] = month.split('-');
    const monthLabel = new Date(+y, +m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    const fileName = `Master_Sheet_${monthLabel.replace(/\s/g, '_')}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('exportMasterSheet error:', error);
    return res.status(500).json({ error: 'Failed to export master sheet', detail: error.message });
  }
}
