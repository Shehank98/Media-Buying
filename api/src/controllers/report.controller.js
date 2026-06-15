import ExcelJS from 'exceljs';
import prisma from '../utils/prisma.js';
import { generateExcel, generatePdf, generatePropertyHistoryPdf } from '../services/export.service.js';

// Build a chronological rate timeline for a property from its change history.
// First event = the original rate at creation; each subsequent cost change appends.
function buildPropertyTimeline(p) {
  const history = p.history || [];
  const costChanges = history.filter(h => h.newValues && Object.prototype.hasOwnProperty.call(h.newValues, 'cost'));
  const firstPrev = (costChanges.length && costChanges[0].previousValues && 'cost' in costChanges[0].previousValues)
    ? Number(costChanges[0].previousValues.cost)
    : Number(p.cost);
  const tl = [{
    date: p.createdAt,
    cost: isFinite(firstPrev) ? firstPrev : Number(p.cost),
    prevCost: null,
    note: 'Initial rate',
    by: p.creator?.name || '',
  }];
  for (const h of history) {
    if (h.newValues && 'cost' in h.newValues) {
      const prev = (h.previousValues && 'cost' in h.previousValues) ? Number(h.previousValues.cost) : null;
      tl.push({
        date: h.changedAt,
        cost: Number(h.newValues.cost),
        prevCost: prev,
        note: h.changeNote || '',
        by: h.changer?.name || '',
      });
    }
  }
  return tl;
}

export async function byChannel(req, res) {
  try {
    const { channelId } = req.params;
    const { format } = req.query;
    const user = req.user;

    const channel = await prisma.channel.findUnique({
      where: { id: parseInt(channelId) },
      include: {
        client: {
          include: {
            agency: { select: { id: true, name: true } },
          },
        },
        properties: {
          include: {
            creator: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    // MANAGER: verify access to this channel's agency
    if (user.role === 'MANAGER') {
      const access = await prisma.userAgencyAccess.findUnique({
        where: { userId_agencyId: { userId: user.id, agencyId: channel.client.agencyId } },
      });
      if (!access) return res.status(403).json({ error: 'Access denied' });
    }

    const reportData = {
      agency: channel.client.agency,
      client: { id: channel.client.id, name: channel.client.name },
      channel: { id: channel.id, name: channel.name, type: channel.type },
      properties: channel.properties,
    };

    if (format === 'excel' || format === 'pdf') {
      const flatData = channel.properties.map((p) => ({
        Agency: channel.client.agency.name,
        Client: channel.client.name,
        Channel: channel.name,
        'Channel Type': channel.type,
        Property: p.name,
        Type: p.type,
        Cost: String(p.cost),
        Notes: p.notes || '',
        'Created By': p.creator.name,
        'Created At': p.createdAt.toISOString().split('T')[0],
      }));

      const title = `Channel Report - ${channel.name}`;

      if (format === 'excel') {
        const buffer = await generateExcel(flatData, title);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="channel-report-${channelId}.xlsx"`);
        return res.send(buffer);
      }

      if (format === 'pdf') {
        const buffer = await generatePdf(flatData, title);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="channel-report-${channelId}.pdf"`);
        return res.send(buffer);
      }
    }

    return res.json(reportData);
  } catch (error) {
    console.error('Report by channel error:', error);
    return res.status(500).json({ error: 'Failed to generate channel report' });
  }
}

export async function byClient(req, res) {
  try {
    const { clientId } = req.params;
    const { format } = req.query;
    const user = req.user;

    const client = await prisma.client.findUnique({
      where: { id: parseInt(clientId) },
      include: {
        agency: { select: { id: true, name: true } },
        channels: {
          include: {
            properties: {
              include: {
                creator: { select: { id: true, name: true } },
              },
              orderBy: { createdAt: 'desc' },
            },
          },
          orderBy: { name: 'asc' },
        },
      },
    });

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // MANAGER: verify access to this client's agency
    if (user.role === 'MANAGER') {
      const access = await prisma.userAgencyAccess.findUnique({
        where: { userId_agencyId: { userId: user.id, agencyId: client.agencyId } },
      });
      if (!access) return res.status(403).json({ error: 'Access denied' });
    }

    const reportData = {
      agency: client.agency,
      client: { id: client.id, name: client.name },
      channels: client.channels,
    };

    if (format === 'excel' || format === 'pdf') {
      const flatData = [];
      for (const channel of client.channels) {
        for (const p of channel.properties) {
          flatData.push({
            Agency: client.agency.name,
            Client: client.name,
            Channel: channel.name,
            'Channel Type': channel.type,
            Property: p.name,
            Type: p.type,
            Cost: String(p.cost),
            Notes: p.notes || '',
            'Created By': p.creator.name,
            'Created At': p.createdAt.toISOString().split('T')[0],
          });
        }
      }

      const title = `Client Report - ${client.name}`;

      if (format === 'excel') {
        const buffer = await generateExcel(flatData, title);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="client-report-${clientId}.xlsx"`);
        return res.send(buffer);
      }

      if (format === 'pdf') {
        const buffer = await generatePdf(flatData, title);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="client-report-${clientId}.pdf"`);
        return res.send(buffer);
      }
    }

    return res.json(reportData);
  } catch (error) {
    console.error('Report by client error:', error);
    return res.status(500).json({ error: 'Failed to generate client report' });
  }
}

export async function byAgency(req, res) {
  try {
    const { agencyId } = req.params;
    const { format } = req.query;
    const user = req.user;

    // MANAGER: verify access to this agency
    if (user.role === 'MANAGER') {
      const access = await prisma.userAgencyAccess.findUnique({
        where: { userId_agencyId: { userId: user.id, agencyId: parseInt(agencyId) } },
      });
      if (!access) return res.status(403).json({ error: 'Access denied' });
    }

    const agency = await prisma.agency.findUnique({
      where: { id: parseInt(agencyId) },
      include: {
        clients: {
          include: {
            channels: {
              include: {
                properties: {
                  include: {
                    creator: { select: { id: true, name: true } },
                  },
                  orderBy: { createdAt: 'desc' },
                },
              },
              orderBy: { name: 'asc' },
            },
          },
          orderBy: { name: 'asc' },
        },
      },
    });

    if (!agency) {
      return res.status(404).json({ error: 'Agency not found' });
    }

    const reportData = {
      agency: { id: agency.id, name: agency.name },
      clients: agency.clients,
    };

    if (format === 'excel' || format === 'pdf') {
      const flatData = [];
      for (const client of agency.clients) {
        for (const channel of client.channels) {
          for (const p of channel.properties) {
            flatData.push({
              Agency: agency.name,
              Client: client.name,
              Channel: channel.name,
              'Channel Type': channel.type,
              Property: p.name,
              Type: p.type,
              Cost: String(p.cost),
              Notes: p.notes || '',
              'Created By': p.creator.name,
              'Created At': p.createdAt.toISOString().split('T')[0],
            });
          }
        }
      }

      const title = `Agency Report - ${agency.name}`;

      if (format === 'excel') {
        const buffer = await generateExcel(flatData, title);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="agency-report-${agencyId}.xlsx"`);
        return res.send(buffer);
      }

      if (format === 'pdf') {
        const buffer = await generatePdf(flatData, title);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="agency-report-${agencyId}.pdf"`);
        return res.send(buffer);
      }
    }

    return res.json(reportData);
  } catch (error) {
    console.error('Report by agency error:', error);
    return res.status(500).json({ error: 'Failed to generate agency report' });
  }
}

// ─── Property Export ─────────────────────────────────────────────────────────

export async function exportProperties(req, res) {
  try {
    const {
      groupBy,
      agencyId,
      clientId,
      channelMasterId,
      channelName,
      channelType,
      propertyType,
      includeHistory = 'true',
      format = 'json',
    } = req.query;

    if (!groupBy || !['channel', 'client', 'agency', 'all'].includes(groupBy)) {
      return res.status(400).json({ error: "groupBy is required and must be one of: 'channel', 'client', 'agency', 'all'" });
    }
    const withHistory = includeHistory !== 'false';

    const channelWhere = {};
    const clientWhere = {};

    if (req.user.role === 'MANAGER') {
      const access = await prisma.userAgencyAccess.findMany({
        where: { userId: req.user.id },
        select: { agencyId: true },
      });
      clientWhere.agencyId = { in: access.map((a) => a.agencyId) };
    }

    if (agencyId) {
      if (clientWhere.agencyId?.in) {
        const requestedId = parseInt(agencyId);
        if (!clientWhere.agencyId.in.includes(requestedId)) {
          return res.status(403).json({ error: 'Access denied to this agency' });
        }
        clientWhere.agencyId = requestedId;
      } else {
        clientWhere.agencyId = parseInt(agencyId);
      }
    }
    if (clientId) channelWhere.clientId = parseInt(clientId);
    if (channelType) channelWhere.type = channelType;
    // Filter by canonical channel (master) — spans clients & agencies.
    if (channelMasterId) channelWhere.channelMasterId = parseInt(channelMasterId);
    else if (channelName) channelWhere.channelMaster = { name: channelName };

    const propertyWhere = {};
    if (propertyType) propertyWhere.type = propertyType;

    const properties = await prisma.property.findMany({
      where: {
        ...propertyWhere,
        channel: {
          ...channelWhere,
          client: Object.keys(clientWhere).length > 0 ? clientWhere : undefined,
        },
      },
      include: {
        channel: {
          include: {
            channelMaster: { select: { name: true, medium: true } },
            client: { include: { agency: { select: { id: true, name: true } } } },
          },
        },
        creator: { select: { id: true, name: true } },
        history: { orderBy: { changedAt: 'asc' }, include: { changer: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Normalize, attaching the rate timeline. Channel = canonical master name
    // so grouping/filtering by channel spans every agency & client.
    const norm = properties.map((p) => ({
      agencyName: p.channel.client.agency.name,
      clientName: p.channel.client.name,
      channelName: p.channel.name,
      channelMasterName: p.channel.channelMaster?.name || p.channel.name,
      channelType: p.channel.type,
      propertyName: p.name,
      propertyType: p.type,
      cost: Number(p.cost),
      bonusPct: p.bonusPct != null ? Number(p.bonusPct) : null,
      notes: p.notes || '',
      createdBy: p.creator?.name || '',
      createdAt: p.createdAt,
      history: p.history || [],
      timeline: buildPropertyTimeline(p),
    }));

    const channels = [...new Set(norm.map((n) => n.channelMasterName))].sort((a, b) => a.localeCompare(b));
    const groupNameOf = (n) =>
      groupBy === 'agency' ? n.agencyName
        : groupBy === 'client' ? n.clientName
          : groupBy === 'channel' ? n.channelMasterName
            : 'All Properties';

    // ── JSON (preview) ──
    if (format !== 'excel' && format !== 'pdf') {
      const rows = norm.map((n) => ({
        agencyName: n.agencyName,
        clientName: n.clientName,
        channelName: n.channelMasterName,
        channelType: n.channelType,
        propertyName: n.propertyName,
        propertyType: n.propertyType,
        cost: n.cost,
        bonusPct: n.bonusPct,
        notes: n.notes,
        createdBy: n.createdBy,
        createdAt: n.createdAt.toISOString().split('T')[0],
        historyCount: n.history.length,
      }));
      const summary = {
        totalCost: rows.reduce((s, r) => s + r.cost, 0),
        totalEntries: rows.length,
        addedValue: rows.filter((r) => r.cost === 0).length,
      };
      return res.json({ rows, summary, channels });
    }

    // ── Build groups ──
    const groupsMap = {};
    for (const n of norm) { const k = groupNameOf(n); (groupsMap[k] = groupsMap[k] || []).push(n); }
    const groups = Object.keys(groupsMap).sort((a, b) => a.localeCompare(b)).map((name) => ({ name, properties: groupsMap[name] }));
    const totals = { properties: norm.length, cost: norm.reduce((s, n) => s + n.cost, 0) };

    const ftParts = [`Grouped by ${groupBy}`];
    if (channelName) ftParts.push(`Channel: ${channelName}`);
    if (channelType) ftParts.push(`Medium: ${channelType}`);
    if (propertyType) ftParts.push(`Type: ${propertyType}`);
    ftParts.push(withHistory ? 'Rate history included' : 'Current rates only');
    const filtersText = ftParts.join('   ·   ');
    const fileStamp = `properties-${groupBy}-${new Date().toISOString().split('T')[0]}`;

    // ── PDF ──
    if (format === 'pdf') {
      const buffer = await generatePropertyHistoryPdf({ title: 'Property & Rate History', filtersText, groups, totals, includeHistory: withHistory });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${fileStamp}.pdf"`);
      return res.send(buffer);
    }

    // ── Excel ──
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Ogilvy Orbit';
    workbook.created = new Date();
    const NAVY_BG = '0A1729';

    const PROP_COLUMNS = [
      { header: 'Agency', width: 20 },
      { header: 'Client', width: 20 },
      { header: 'Channel', width: 22 },
      { header: 'Medium', width: 12 },
      { header: 'Property Name', width: 24 },
      { header: 'Property Type', width: 18 },
      { header: 'Current Cost (LKR)', width: 20 },
      { header: 'Bonus %', width: 12 },
      { header: 'Rate Changes', width: 14 },
      { header: 'Notes', width: 30 },
      { header: 'Created By', width: 18 },
      { header: 'Created At', width: 14 },
    ];

    const navyHeader = (sheet, colCount) => {
      const headerRow = sheet.getRow(1);
      headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${NAVY_BG}` } };
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
      });
      sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: colCount } };
    };
    const autoWidth = (sheet) => {
      sheet.columns.forEach((column) => {
        let maxLength = column.header ? String(column.header).length : 10;
        column.eachCell({ includeEmpty: false }, (cell) => {
          const len = cell.value != null ? String(cell.value).length : 0;
          if (len > maxLength) maxLength = len;
        });
        column.width = Math.min(maxLength + 4, 52);
      });
    };

    const addPropSheet = (name, items) => {
      const safeName = (name || 'Properties').replace(/[\\/*?:\[\]]/g, '').substring(0, 31) || 'Sheet';
      const sheet = workbook.addWorksheet(safeName);
      sheet.columns = PROP_COLUMNS.map((c) => ({ header: c.header, width: c.width }));
      for (const n of items) {
        sheet.addRow([
          n.agencyName, n.clientName, n.channelMasterName, n.channelType,
          n.propertyName, n.propertyType, n.cost, n.bonusPct != null ? n.bonusPct : '',
          Math.max(0, n.timeline.length - 1), n.notes, n.createdBy, n.createdAt.toISOString().split('T')[0],
        ]);
      }
      sheet.getColumn(7).numFmt = '#,##0.00';
      sheet.getColumn(8).numFmt = '0.000';
      navyHeader(sheet, PROP_COLUMNS.length);
      if (items.length > 0) {
        const totalsRowNum = items.length + 2;
        const totalsRow = sheet.getRow(totalsRowNum);
        totalsRow.getCell(1).value = 'TOTAL';
        totalsRow.getCell(7).value = { formula: `SUM(G2:G${totalsRowNum - 1})` };
        totalsRow.getCell(7).numFmt = '#,##0.00';
        totalsRow.eachCell((cell) => { cell.font = { bold: true }; });
      }
      autoWidth(sheet);
    };

    if (groupBy === 'all') {
      addPropSheet('All Properties', norm);
    } else {
      for (const g of groups) addPropSheet(g.name, g.properties);
      const summSheet = workbook.addWorksheet('Summary');
      summSheet.columns = [
        { header: 'Group Name', width: 30 },
        { header: 'Properties', width: 14 },
        { header: 'Total Cost (LKR)', width: 24 },
      ];
      for (const g of groups) summSheet.addRow([g.name, g.properties.length, g.properties.reduce((s, n) => s + n.cost, 0)]);
      summSheet.getColumn(3).numFmt = '#,##0.00';
      navyHeader(summSheet, 3);
      autoWidth(summSheet);
    }

    // ── Rate History sheet (every rate at every point in time) ──
    if (withHistory) {
      const hSheet = workbook.addWorksheet('Rate History');
      hSheet.columns = [
        { header: 'Agency', width: 18 },
        { header: 'Client', width: 18 },
        { header: 'Channel', width: 20 },
        { header: 'Property', width: 22 },
        { header: 'Date', width: 14 },
        { header: 'Year', width: 8 },
        { header: 'Rate (LKR)', width: 18 },
        { header: 'Change', width: 12 },
        { header: 'Change Note', width: 34 },
        { header: 'Changed By', width: 18 },
      ];
      const sorted = [...norm].sort((a, b) =>
        a.channelMasterName.localeCompare(b.channelMasterName) || a.propertyName.localeCompare(b.propertyName));
      for (const n of sorted) {
        for (const ev of n.timeline) {
          let change = 'Initial';
          if (ev.prevCost != null && Number(ev.prevCost) !== 0) {
            const pct = ((ev.cost - ev.prevCost) / ev.prevCost) * 100;
            change = (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
          } else if (ev.prevCost != null) {
            change = 'Set';
          }
          hSheet.addRow([
            n.agencyName, n.clientName, n.channelMasterName, n.propertyName,
            new Date(ev.date).toISOString().split('T')[0], new Date(ev.date).getFullYear(),
            ev.cost, change, ev.note, ev.by,
          ]);
        }
      }
      hSheet.getColumn(7).numFmt = '#,##0.00';
      navyHeader(hSheet, 10);
      autoWidth(hSheet);
    }

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileStamp}.xlsx"`);
    return res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('Property export error:', error);
    return res.status(500).json({ error: 'Failed to export properties' });
  }
}

// ─── Schedule Log Export ──────────────────────────────────────────────────────

export async function exportScheduleLogs(req, res) {
  try {
    const {
      groupBy,
      agencyId,
      clientId,
      channelMasterId,
      medium,
      monthFrom,
      monthTo,
      format = 'json',
    } = req.query;

    if (!groupBy || !['channel', 'client', 'agency', 'all'].includes(groupBy)) {
      return res.status(400).json({ error: "groupBy is required and must be one of: 'channel', 'client', 'agency', 'all'" });
    }

    // Build where clause
    const where = { isDeleted: false };

    // Role-based access: MANAGER can only see their assigned agencies
    if (req.user.role === 'MANAGER') {
      const access = await prisma.userAgencyAccess.findMany({
        where: { userId: req.user.id },
        select: { agencyId: true },
      });
      const allowedAgencyIds = access.map((a) => a.agencyId);
      where.agencyId = { in: allowedAgencyIds };
    }

    if (agencyId) {
      // If MANAGER, intersect with their allowed agencies
      if (where.agencyId?.in) {
        const requestedId = parseInt(agencyId);
        if (!where.agencyId.in.includes(requestedId)) {
          return res.status(403).json({ error: 'Access denied to this agency' });
        }
        where.agencyId = requestedId;
      } else {
        where.agencyId = parseInt(agencyId);
      }
    }
    if (clientId) where.clientId = parseInt(clientId);
    if (channelMasterId) where.channelMasterId = parseInt(channelMasterId);
    if (medium) where.medium = medium;

    if (monthFrom || monthTo) {
      where.scheduleMonth = {};
      if (monthFrom) where.scheduleMonth.gte = monthFrom;
      if (monthTo) where.scheduleMonth.lte = monthTo;
    }

    // Fetch logs with relations
    const logs = await prisma.scheduleLog.findMany({
      where,
      include: {
        agency: { select: { id: true, name: true } },
        client: { select: { id: true, name: true } },
        channelMaster: { select: { id: true, name: true } },
        uploader: { select: { id: true, name: true } },
      },
      orderBy: [{ scheduleMonth: 'desc' }, { createdAt: 'desc' }],
    });

    // JSON response: camelCase keys for frontend
    if (format !== 'excel') {
      const rows = logs.map((log) => ({
        agencyName: log.agency.name,
        clientName: log.client.name,
        channelName: log.channelMaster.name,
        medium: log.medium,
        mediaGroup: log.mediaGroup,
        roNumber: log.roNumber,
        scheduleMonth: log.scheduleMonth,
        invoiceMonth: log.invoiceMonth,
        scheduleValue: Number(log.scheduleValue),
        scheduleValueWithVat: Number(log.scheduleValueWithVat),
        uploadedBy: log.uploader.name,
      }));

      const summary = {
        totalScheduleValue: rows.reduce((sum, r) => sum + r.scheduleValue, 0),
        totalWithVat: rows.reduce((sum, r) => sum + r.scheduleValueWithVat, 0),
        totalEntries: rows.length,
      };

      return res.json({ rows, summary });
    }

    // ── PDF export (curated columns + totals row) ──
    if (format === 'pdf') {
      const fmtNum = (v) => Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const pdfRows = logs.map((log) => ({
        Agency: log.agency.name,
        Client: log.client.name,
        Channel: log.channelMaster.name,
        Medium: log.medium,
        'RO Number': log.roNumber || '',
        'Sch Month': log.scheduleMonth || '',
        'Schedule Value': fmtNum(log.scheduleValue),
        'With VAT': fmtNum(log.scheduleValueWithVat),
      }));
      if (pdfRows.length) {
        const totSV = logs.reduce((s, l) => s + Number(l.scheduleValue), 0);
        const totVAT = logs.reduce((s, l) => s + Number(l.scheduleValueWithVat), 0);
        pdfRows.push({
          Agency: 'TOTAL', Client: '', Channel: '', Medium: '', 'RO Number': '', 'Sch Month': '',
          'Schedule Value': fmtNum(totSV), 'With VAT': fmtNum(totVAT),
        });
      }
      const buffer = await generatePdf(pdfRows, 'Schedule Logs Report');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="schedule-logs-${groupBy}-${new Date().toISOString().split('T')[0]}.pdf"`);
      return res.send(buffer);
    }

    // Excel: display-name keys for column headers
    const rows = logs.map((log) => ({
      Agency: log.agency.name,
      Client: log.client.name,
      Channel: log.channelMaster.name,
      Medium: log.medium,
      'Media Group': log.mediaGroup,
      'RO Number': log.roNumber,
      'Schedule Month': log.scheduleMonth,
      'Invoice Month': log.invoiceMonth,
      'Schedule Value': Number(log.scheduleValue),
      'With VAT': Number(log.scheduleValueWithVat),
      'Uploaded By': log.uploader.name,
    }));

    // ─── Excel export ──────────────────────────────────────────────────

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Ogilvy Orbit';
    workbook.created = new Date();

    const HEADER_COLUMNS = [
      { header: 'Agency', key: 'Agency', width: 20 },
      { header: 'Client', key: 'Client', width: 20 },
      { header: 'Channel', key: 'Channel', width: 22 },
      { header: 'Medium', key: 'Medium', width: 12 },
      { header: 'Media Group', key: 'Media Group', width: 16 },
      { header: 'RO Number', key: 'RO Number', width: 16 },
      { header: 'Schedule Month', key: 'Schedule Month', width: 16 },
      { header: 'Invoice Month', key: 'Invoice Month', width: 16 },
      { header: 'Schedule Value (LKR)', key: 'Schedule Value', width: 22 },
      { header: 'With VAT (LKR)', key: 'With VAT', width: 22 },
      { header: 'Uploaded By', key: 'Uploaded By', width: 18 },
    ];

    const NAVY_BG = '0A1729';

    function styleHeaderRow(sheet) {
      const headerRow = sheet.getRow(1);
      headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${NAVY_BG}` } };
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
      });
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: HEADER_COLUMNS.length },
      };
    }

    function addDataSheet(name, sheetRows) {
      // Excel sheet names max 31 chars, no special chars
      const safeName = name.replace(/[\\/*?:\[\]]/g, '').substring(0, 31);
      const sheet = workbook.addWorksheet(safeName);
      sheet.columns = HEADER_COLUMNS.map((c) => ({ ...c }));

      for (const row of sheetRows) {
        sheet.addRow(row);
      }

      // Number format for value columns
      const scheduleValCol = 9; // Schedule Value
      const withVatCol = 10; // With VAT
      sheet.getColumn(scheduleValCol).numFmt = '#,##0.00';
      sheet.getColumn(withVatCol).numFmt = '#,##0.00';

      styleHeaderRow(sheet);

      // Totals row
      const dataRowCount = sheetRows.length;
      if (dataRowCount > 0) {
        const totalsRowNum = dataRowCount + 2; // +1 for header, +1 for next row
        const totalsRow = sheet.getRow(totalsRowNum);
        totalsRow.getCell(1).value = 'TOTAL';
        totalsRow.getCell(scheduleValCol).value = {
          formula: `SUM(I2:I${totalsRowNum - 1})`,
        };
        totalsRow.getCell(withVatCol).value = {
          formula: `SUM(J2:J${totalsRowNum - 1})`,
        };
        totalsRow.getCell(scheduleValCol).numFmt = '#,##0.00';
        totalsRow.getCell(withVatCol).numFmt = '#,##0.00';
        totalsRow.eachCell((cell) => {
          cell.font = { bold: true };
        });
      }

      // Auto-width: expand columns if content is wider than default
      sheet.columns.forEach((column) => {
        let maxLength = column.header ? column.header.length : 10;
        column.eachCell({ includeEmpty: false }, (cell) => {
          const cellLength = cell.value ? String(cell.value).length : 0;
          if (cellLength > maxLength) maxLength = cellLength;
        });
        column.width = Math.min(maxLength + 4, 50);
      });

      return sheet;
    }

    function addSummarySheet(groups) {
      const sheet = workbook.addWorksheet('Summary');
      sheet.columns = [
        { header: 'Group Name', key: 'name', width: 30 },
        { header: 'Total Entries', key: 'entries', width: 16 },
        { header: 'Schedule Value (LKR)', key: 'scheduleValue', width: 24 },
        { header: 'With VAT (LKR)', key: 'withVat', width: 24 },
      ];

      for (const g of groups) {
        sheet.addRow({
          name: g.name,
          entries: g.entries,
          scheduleValue: g.scheduleValue,
          withVat: g.withVat,
        });
      }

      sheet.getColumn(3).numFmt = '#,##0.00';
      sheet.getColumn(4).numFmt = '#,##0.00';

      // Style header
      const headerRow = sheet.getRow(1);
      headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${NAVY_BG}` } };
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
      });
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: 4 },
      };

      // Totals row for summary
      const totalsRowNum = groups.length + 2;
      const totalsRow = sheet.getRow(totalsRowNum);
      totalsRow.getCell(1).value = 'TOTAL';
      totalsRow.getCell(2).value = { formula: `SUM(B2:B${totalsRowNum - 1})` };
      totalsRow.getCell(3).value = { formula: `SUM(C2:C${totalsRowNum - 1})` };
      totalsRow.getCell(4).value = { formula: `SUM(D2:D${totalsRowNum - 1})` };
      totalsRow.getCell(3).numFmt = '#,##0.00';
      totalsRow.getCell(4).numFmt = '#,##0.00';
      totalsRow.eachCell((cell) => {
        cell.font = { bold: true };
      });

      // Auto-width
      sheet.columns.forEach((column) => {
        let maxLength = column.header ? column.header.length : 10;
        column.eachCell({ includeEmpty: false }, (cell) => {
          const cellLength = cell.value ? String(cell.value).length : 0;
          if (cellLength > maxLength) maxLength = cellLength;
        });
        column.width = Math.min(maxLength + 4, 50);
      });

      return sheet;
    }

    if (groupBy === 'all') {
      addDataSheet('All Data', rows);
    } else {
      // Group rows by the selected dimension
      const keyMap = { agency: 'Agency', client: 'Client', channel: 'Channel' };
      const groupKey = keyMap[groupBy];
      const grouped = {};
      for (const row of rows) {
        const key = row[groupKey];
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(row);
      }

      // Create one sheet per group
      const summaryGroups = [];
      for (const [name, groupRows] of Object.entries(grouped)) {
        addDataSheet(name, groupRows);
        summaryGroups.push({
          name,
          entries: groupRows.length,
          scheduleValue: groupRows.reduce((s, r) => s + r['Schedule Value'], 0),
          withVat: groupRows.reduce((s, r) => s + r['With VAT'], 0),
        });
      }

      // Sort summary alphabetically
      summaryGroups.sort((a, b) => a.name.localeCompare(b.name));
      addSummarySheet(summaryGroups);
    }

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="schedule-logs-${groupBy}-${new Date().toISOString().split('T')[0]}.xlsx"`);
    return res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('Schedule log export error:', error);
    return res.status(500).json({ error: 'Failed to export schedule logs' });
  }
}
