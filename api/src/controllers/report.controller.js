import ExcelJS from 'exceljs';
import prisma from '../utils/prisma.js';
import { generateExcel, generatePdf } from '../services/export.service.js';

export async function byChannel(req, res) {
  try {
    const { channelId } = req.params;
    const { format } = req.query;

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

// ─── Schedule Log Export ──────────────────────────────────────────────────────

export async function exportScheduleLogs(req, res) {
  try {
    const {
      groupBy,
      agencyId,
      clientId,
      channelMasterId,
      brandId,
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
    if (brandId) where.brandId = parseInt(brandId);
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
        brand: { select: { id: true, name: true } },
        campaign: { select: { id: true, name: true } },
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
        brandName: log.brand.name,
        campaignName: log.campaign.name,
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

    // Excel: display-name keys for column headers
    const rows = logs.map((log) => ({
      Agency: log.agency.name,
      Client: log.client.name,
      Brand: log.brand.name,
      Campaign: log.campaign.name,
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
    workbook.creator = 'Media Buying System';
    workbook.created = new Date();

    const HEADER_COLUMNS = [
      { header: 'Agency', key: 'Agency', width: 20 },
      { header: 'Client', key: 'Client', width: 20 },
      { header: 'Brand', key: 'Brand', width: 20 },
      { header: 'Campaign', key: 'Campaign', width: 22 },
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
      const scheduleValCol = 11; // Schedule Value
      const withVatCol = 12; // With VAT
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
          formula: `SUM(K2:K${totalsRowNum - 1})`,
        };
        totalsRow.getCell(withVatCol).value = {
          formula: `SUM(L2:L${totalsRowNum - 1})`,
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
