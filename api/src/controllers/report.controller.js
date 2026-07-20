import ExcelJS from 'exceljs';
import prisma from '../utils/prisma.js';
import { getAccessibleClientIds } from '../middleware/access.js';
import { generateExcel, generatePdf, generatePropertyHistoryPdf, generateGroupedTablePdf } from '../services/export.service.js';

// Concrete client-id scope for report access. null = unrestricted (SUPER_ADMIN);
// otherwise the exact set of clients the user may see (agency clients for a
// MANAGER, assigned clients for GROUP_HEAD/PLANNER). Empty scope becomes [-1]
// so a scoped user with no clients matches nothing instead of everything.
async function accessibleClientScope(user) {
  if (user.role === 'SUPER_ADMIN') return null;
  const ids = await getAccessibleClientIds(user.id, user.role);
  return ids.length ? ids : [-1];
}

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

    // Enforce agency + client level access: the channel's client must be in the
    // user's accessible client scope (SUPER_ADMIN unrestricted).
    const scope = await accessibleClientScope(user);
    if (scope && !scope.includes(channel.client.id)) {
      return res.status(403).json({ error: 'Access denied' });
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

    // Enforce agency + client level access: this client must be in the user's
    // accessible client scope (SUPER_ADMIN unrestricted).
    const scope = await accessibleClientScope(user);
    if (scope && !scope.includes(client.id)) {
      return res.status(403).json({ error: 'Access denied' });
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

    // Client-level restriction: a scoped user only exports the clients they can
    // access within this agency (SUPER_ADMIN unrestricted). For a MANAGER this
    // is every client in their agency; for GROUP_HEAD/PLANNER only theirs.
    const scope = await accessibleClientScope(user);
    if (scope) {
      const allow = new Set(scope);
      agency.clients = agency.clients.filter((c) => allow.has(c.id));
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

    if (!groupBy || !['channel', 'client', 'agency', 'all', 'agency-channel', 'client-channel'].includes(groupBy)) {
      return res.status(400).json({ error: "groupBy is required and must be one of: 'channel', 'client', 'agency', 'all', 'agency-channel', 'client-channel'" });
    }
    const withHistory = includeHistory !== 'false';

    const channelWhere = {};
    const clientWhere = {};

    // Agency + client level access: scoped users are limited to their accessible
    // clients (SUPER_ADMIN unrestricted). Requested agency/client filters are
    // intersected with that scope, never widening it.
    const scope = await accessibleClientScope(req.user);
    if (scope) channelWhere.clientId = { in: scope };

    if (agencyId) clientWhere.agencyId = parseInt(agencyId);
    if (clientId) {
      const cid = parseInt(clientId);
      if (scope && !scope.includes(cid)) {
        return res.status(403).json({ error: 'Access denied to this client' });
      }
      channelWhere.clientId = cid;
    }
    if (channelType) channelWhere.type = channelType;
    // Filter by canonical channel (master) - spans clients & agencies.
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
      category: p.category || '',
      propertyName: p.name,
      propertyType: p.type || '',
      cost: Number(p.cost),
      bonusValue: Number(p.bonusValue || 0),
      startDate: p.startDate || null,
      endDate: p.endDate || null,
      notes: p.notes || '',
      createdBy: p.creator?.name || '',
      createdAt: p.createdAt,
      history: p.history || [],
      timeline: buildPropertyTimeline(p),
    }));

    const channels = [...new Set(norm.map((n) => n.channelMasterName))].sort((a, b) => a.localeCompare(b));
    const dimVal = (n, dim) =>
      dim === 'agency' ? n.agencyName
        : dim === 'client' ? n.clientName
          : dim === 'channel' ? n.channelMasterName
            : 'All Properties';

    // ── JSON (preview) ──
    if (format !== 'excel' && format !== 'pdf') {
      const rows = norm.map((n) => ({
        agencyName: n.agencyName,
        clientName: n.clientName,
        channelName: n.channelMasterName,
        channelType: n.channelType,
        category: n.category,
        propertyName: n.propertyName,
        propertyType: n.propertyType,
        cost: n.cost,
        bonusValue: n.bonusValue,
        startDate: n.startDate ? n.startDate.toISOString().split('T')[0] : null,
        endDate: n.endDate ? n.endDate.toISOString().split('T')[0] : null,
        ongoing: !!n.startDate && !n.endDate,
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

    // ── Build groups (single-level, or nested e.g. agency-channel / client-channel) ──
    const isNested = groupBy.includes('-');
    const sortKeys = (obj) => Object.keys(obj).sort((a, b) => a.localeCompare(b));
    let groups;
    if (isNested) {
      const [pk, sk] = groupBy.split('-');
      const primMap = {};
      for (const n of norm) { const p = dimVal(n, pk); (primMap[p] = primMap[p] || []).push(n); }
      groups = sortKeys(primMap).map((pname) => {
        const subMap = {};
        for (const n of primMap[pname]) { const s = dimVal(n, sk); (subMap[s] = subMap[s] || []).push(n); }
        return { name: pname, subgroups: sortKeys(subMap).map((sname) => ({ name: sname, properties: subMap[sname] })) };
      });
    } else {
      const groupsMap = {};
      for (const n of norm) { const k = dimVal(n, groupBy); (groupsMap[k] = groupsMap[k] || []).push(n); }
      groups = sortKeys(groupsMap).map((name) => ({ name, properties: groupsMap[name] }));
    }
    // Flatten a group's properties whether single-level or nested.
    const groupProps = (g) => g.properties || (g.subgroups ? g.subgroups.flatMap((s) => s.properties) : []);
    const totals = { properties: norm.length, cost: norm.reduce((s, n) => s + n.cost, 0) };

    const ftParts = [`Grouped by ${groupBy.replace('-', ' → ')}`];
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
      { header: 'Category', width: 22 },
      { header: 'Property Name', width: 24 },
      { header: 'Property Type', width: 18 },
      { header: 'Property Value (LKR)', width: 20 },
      { header: 'Bonus Value (LKR)', width: 18 },
      { header: 'Start Date', width: 14 },
      { header: 'End Date', width: 14 },
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
          n.category, n.propertyName, n.propertyType, n.cost, n.bonusValue,
          n.startDate ? n.startDate.toISOString().split('T')[0] : '',
          n.endDate ? n.endDate.toISOString().split('T')[0] : 'Ongoing',
          Math.max(0, n.timeline.length - 1), n.notes, n.createdBy, n.createdAt.toISOString().split('T')[0],
        ]);
      }
      sheet.getColumn(8).numFmt = '#,##0.00';
      sheet.getColumn(9).numFmt = '#,##0.00';
      navyHeader(sheet, PROP_COLUMNS.length);
      if (items.length > 0) {
        const totalsRowNum = items.length + 2;
        const totalsRow = sheet.getRow(totalsRowNum);
        totalsRow.getCell(1).value = 'TOTAL';
        totalsRow.getCell(8).value = { formula: `SUM(H2:H${totalsRowNum - 1})` };
        totalsRow.getCell(8).numFmt = '#,##0.00';
        totalsRow.eachCell((cell) => { cell.font = { bold: true }; });
      }
      autoWidth(sheet);
    };

    if (groupBy === 'all') {
      addPropSheet('All Properties', norm);
    } else {
      for (const g of groups) addPropSheet(g.name, groupProps(g));
      const summSheet = workbook.addWorksheet('Summary');
      summSheet.columns = [
        { header: 'Group Name', width: 30 },
        { header: 'Properties', width: 14 },
        { header: 'Total Cost (LKR)', width: 24 },
      ];
      for (const g of groups) { const gp = groupProps(g); summSheet.addRow([g.name, gp.length, gp.reduce((s, n) => s + n.cost, 0)]); }
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

    // Agency + client level access: scoped users are limited to their accessible
    // clients (SUPER_ADMIN unrestricted). Requested agency/client filters are
    // intersected with that scope, never widening it.
    const scope = await accessibleClientScope(req.user);
    if (scope) where.clientId = { in: scope };

    if (agencyId) where.agencyId = parseInt(agencyId);
    if (clientId) {
      const cid = parseInt(clientId);
      if (scope && !scope.includes(cid)) {
        return res.status(403).json({ error: 'Access denied to this client' });
      }
      where.clientId = cid;
    }
    if (channelMasterId) where.channelMasterId = parseInt(channelMasterId);
    if (medium) where.medium = medium;

    if (monthFrom || monthTo) {
      where.scheduleMonth = {};
      if (monthFrom) where.scheduleMonth.gte = monthFrom;
      if (monthTo) where.scheduleMonth.lte = monthTo;
    }

    // Grand totals via a SQL aggregate — fast and correct even for tens of
    // thousands of rows (no need to pull every row into memory to sum them).
    const agg = await prisma.scheduleLog.aggregate({
      where, _count: true, _sum: { scheduleValue: true, scheduleValueWithVat: true },
    });
    const summary = {
      totalScheduleValue: Number(agg._sum.scheduleValue || 0),
      totalWithVat: Number(agg._sum.scheduleValueWithVat || 0),
      totalEntries: agg._count,
    };

    const mapRow = (log) => ({
      agencyName: log.agency?.name || '-',
      clientName: log.client?.name || '-',
      channelName: log.channelMaster?.name || '-',
      medium: log.medium,
      mediaGroup: log.mediaGroup,
      roNumber: log.roNumber,
      scheduleMonth: log.scheduleMonth,
      invoiceMonth: log.invoiceMonth,
      scheduleValue: Number(log.scheduleValue),
      scheduleValueWithVat: Number(log.scheduleValueWithVat),
      uploadedBy: log.uploader?.name || '-',
    });

    // ── On-screen view (JSON): never ship every row to the browser. ──
    if (format !== 'excel' && format !== 'pdf') {
      const detailInclude = {
        agency: { select: { name: true } },
        client: { select: { name: true } },
        channelMaster: { select: { name: true } },
        uploader: { select: { name: true } },
      };
      const detailOrder = [{ scheduleMonth: 'desc' }, { createdAt: 'desc' }];
      const detail = req.query.detail === '1' || req.query.detail === 'true';

      // 'all' has no grouping dimension, and any explicit detail request → a
      // single paginated page of rows (default 200) instead of all 30k+.
      if (detail || groupBy === 'all') {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const pageSize = Math.min(1000, Math.max(1, parseInt(req.query.pageSize) || 200));
        const pageLogs = await prisma.scheduleLog.findMany({
          where, include: detailInclude, orderBy: detailOrder,
          skip: (page - 1) * pageSize, take: pageSize,
        });
        return res.json({
          mode: 'detail',
          rows: pageLogs.map(mapRow),
          summary,
          pagination: { page, pageSize, total: summary.totalEntries, totalPages: Math.max(1, Math.ceil(summary.totalEntries / pageSize)) },
        });
      }

      // Grouped subtotals via SQL groupBy — one small row per agency/client/
      // channel. The heavy row detail loads lazily when a group is expanded.
      const dimField = groupBy === 'agency' ? 'agencyId' : groupBy === 'client' ? 'clientId' : 'channelMasterId';
      const gr = await prisma.scheduleLog.groupBy({
        by: [dimField], where, _count: true, _sum: { scheduleValue: true, scheduleValueWithVat: true },
      });
      const ids = [...new Set(gr.map((g) => g[dimField]).filter((v) => v != null))];
      let nameMap = new Map();
      if (ids.length) {
        if (groupBy === 'agency') { const a = await prisma.agency.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }); nameMap = new Map(a.map((x) => [x.id, x.name])); }
        else if (groupBy === 'client') { const c = await prisma.client.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }); nameMap = new Map(c.map((x) => [x.id, x.name])); }
        else { const c = await prisma.channelMaster.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }); nameMap = new Map(c.map((x) => [x.id, x.name])); }
      }
      const groups = gr.map((g) => ({
        key: g[dimField],
        name: g[dimField] == null ? 'Unassigned' : (nameMap.get(g[dimField]) || 'Unknown'),
        count: g._count,
        value: Number(g._sum.scheduleValue || 0),
        vat: Number(g._sum.scheduleValueWithVat || 0),
      })).sort((a, b) => b.value - a.value);
      return res.json({ mode: 'groups', groupBy, groups, summary });
    }

    // ── Excel / PDF need every row. ──
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

    // ── PDF export (branded, grouped, with subtotals + grand total) ──
    if (format === 'pdf') {
      const fmtNum = (v) => Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const groupNameOf = (log) =>
        groupBy === 'agency' ? log.agency.name
          : groupBy === 'client' ? log.client.name
            : groupBy === 'channel' ? log.channelMaster.name
              : 'All Schedule Logs';

      const groupsMap = {};
      for (const log of logs) { const k = groupNameOf(log); (groupsMap[k] = groupsMap[k] || []).push(log); }

      const columns = [
        { key: 'Client', label: 'Client', align: 'left', w: 1.9 },
        { key: 'Channel', label: 'Channel', align: 'left', w: 1.6 },
        { key: 'Medium', label: 'Medium', align: 'left', w: 0.9 },
        { key: 'Month', label: 'Sch Month', align: 'left', w: 1.0 },
        { key: 'Schedule Value', label: 'Schedule Value', align: 'right', w: 1.5 },
        { key: 'With VAT', label: 'With VAT', align: 'right', w: 1.4 },
      ];

      const groups = Object.keys(groupsMap).sort((a, b) => a.localeCompare(b)).map((name) => {
        const items = groupsMap[name];
        const subSV = items.reduce((s, l) => s + Number(l.scheduleValue), 0);
        const subVAT = items.reduce((s, l) => s + Number(l.scheduleValueWithVat), 0);
        return {
          name,
          rows: items.map((log) => ({
            Client: log.client.name,
            Channel: log.channelMaster.name,
            Medium: log.medium,
            Month: log.scheduleMonth || '',
            'Schedule Value': fmtNum(log.scheduleValue),
            'With VAT': fmtNum(log.scheduleValueWithVat),
          })),
          subtotal: { Client: `Subtotal · ${items.length}`, 'Schedule Value': fmtNum(subSV), 'With VAT': fmtNum(subVAT) },
        };
      });

      const grandSV = logs.reduce((s, l) => s + Number(l.scheduleValue), 0);
      const grandVAT = logs.reduce((s, l) => s + Number(l.scheduleValueWithVat), 0);
      const totals = { _label: `${logs.length} entries · ${fmtNum(grandSV)} total`, Client: 'GRAND TOTAL', 'Schedule Value': fmtNum(grandSV), 'With VAT': fmtNum(grandVAT) };

      const ftParts = [`Grouped by ${groupBy}`];
      if (medium) ftParts.push(`Medium: ${medium}`);
      if (monthFrom || monthTo) ftParts.push(`Months: ${monthFrom || '…'} – ${monthTo || '…'}`);
      const filtersText = ftParts.join('   ·   ');

      const buffer = await generateGroupedTablePdf({ title: 'Schedule Logs Report', filtersText, columns, groups, totals });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="schedule-logs-${groupBy}-${new Date().toISOString().split('T')[0]}.pdf"`);
      return res.send(buffer);
    }

    // Extra spreadsheet columns retained verbatim on bulk import (importExtra) -
    // appended after the standard columns so nothing uploaded is lost on export.
    // A header that collides with a standard column is suffixed " (import)".
    const STD_KEYS = new Set(['Agency', 'Client', 'Channel', 'Medium', 'Media Group', 'RO Number', 'Schedule Month', 'Invoice Month', 'Schedule Value', 'With VAT', 'Uploaded By']);
    const renameExtra = (k) => (STD_KEYS.has(k) ? `${k} (import)` : k);
    const extraKeys = [];
    for (const log of logs) {
      if (log.importExtra && typeof log.importExtra === 'object') {
        for (const k of Object.keys(log.importExtra)) { const rk = renameExtra(k); if (!extraKeys.includes(rk)) extraKeys.push(rk); }
      }
    }

    // Excel: display-name keys for column headers
    const rows = logs.map((log) => {
      const extra = {};
      if (log.importExtra && typeof log.importExtra === 'object') {
        for (const [k, v] of Object.entries(log.importExtra)) extra[renameExtra(k)] = v;
      }
      return {
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
        ...extra,
      };
    });

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
      ...extraKeys.map((k) => ({ header: k, key: k, width: 18 })),
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

// ═══════════════════════════════════════════════════════════════════════════
// Media Group Report
//
// A full spend breakdown for a media group (e.g. "MTV Channel (Pvt) LTD"):
//   • Year-wise total spend on the media group
//   • Every CHANNEL in the media group, spend broken down by year
//   • Every AGENCY that spent on the media group, spend broken down by year
//   • The Agency × Channel matrix (each agency's spend on each of the group's
//     channels), also year-wise
// All in one report (JSON for the on-screen preview, one multi-sheet Excel
// workbook, or a branded PDF). When `mediaGroup` is omitted the report covers
// ALL media groups and adds a per-media-group summary section.
//
// Spend is confirmed actual spend only (ScheduleLog, isDeleted:false). The
// year is taken from scheduleMonth (YYYY-MM). MANAGER is scoped to their
// assigned agencies, matching every other report endpoint.
// ═══════════════════════════════════════════════════════════════════════════
export async function mediaGroupReport(req, res) {
  try {
    const { mediaGroup, agencyId, clientId, channelMasterId, monthFrom, monthTo, format = 'json' } = req.query;

    // Base scope (role + optional agency + month range), WITHOUT the media-group
    // filter — used both for the main fetch and for the available-groups picker.
    const scopeWhere = { isDeleted: false };

    if (req.user.role === 'MANAGER') {
      const access = await prisma.userAgencyAccess.findMany({
        where: { userId: req.user.id },
        select: { agencyId: true },
      });
      scopeWhere.agencyId = { in: access.map((a) => a.agencyId) };
    }

    if (agencyId) {
      const requestedId = parseInt(agencyId);
      if (scopeWhere.agencyId?.in) {
        if (!scopeWhere.agencyId.in.includes(requestedId)) {
          return res.status(403).json({ error: 'Access denied to this agency' });
        }
      }
      scopeWhere.agencyId = requestedId;
    }

    if (monthFrom || monthTo) {
      scopeWhere.scheduleMonth = {};
      if (monthFrom) scopeWhere.scheduleMonth.gte = monthFrom;
      if (monthTo) scopeWhere.scheduleMonth.lte = monthTo;
    }

    // Distinct media groups available under the current scope (for the picker),
    // with lifetime spend so the UI can show the biggest first.
    const groupAgg = await prisma.scheduleLog.groupBy({
      by: ['mediaGroup'],
      where: scopeWhere,
      _sum: { scheduleValue: true },
    });
    const availableMediaGroups = groupAgg
      .map((g) => ({ name: g.mediaGroup || 'Unknown', value: Number(g._sum.scheduleValue) || 0 }))
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));

    // Media-group-scoped fetch (BEFORE channel/client filters) — used to build the
    // channel + client filter pickers and then filtered in JS for the report body.
    const mgWhere = { ...scopeWhere };
    if (mediaGroup) mgWhere.mediaGroup = mediaGroup;

    const allLogs = await prisma.scheduleLog.findMany({
      where: mgWhere,
      include: {
        agency: { select: { name: true } },
        channelMaster: { select: { id: true, name: true } },
        client: { select: { id: true, name: true } },
      },
    });

    // Filter pickers (channels + clients present in this media group), biggest first.
    const chMap = new Map(); const clMap = new Map();
    for (const l of allLogs) {
      const sv = Number(l.scheduleValue) || 0;
      if (l.channelMasterId != null) {
        const e = chMap.get(l.channelMasterId) || { channelMasterId: l.channelMasterId, name: l.channelMaster?.name || 'Unknown', value: 0 };
        e.value += sv; chMap.set(l.channelMasterId, e);
      }
      if (l.clientId != null) {
        const e = clMap.get(l.clientId) || { clientId: l.clientId, name: l.client?.name || 'Unknown', value: 0 };
        e.value += sv; clMap.set(l.clientId, e);
      }
    }
    const availableChannels = [...chMap.values()].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
    const availableClients = [...clMap.values()].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));

    // Apply the channel + client filters (both accept comma-separated multi-select).
    const channelIds = channelMasterId ? String(channelMasterId).split(',').map((s) => parseInt(s)).filter(Number.isInteger) : [];
    const clientIds = clientId ? String(clientId).split(',').map((s) => parseInt(s)).filter(Number.isInteger) : [];
    const logs = allLogs.filter((l) =>
      (!channelIds.length || channelIds.includes(l.channelMasterId)) &&
      (!clientIds.length || clientIds.includes(l.clientId)),
    );

    // ── Aggregate ──────────────────────────────────────────────────────────
    const yearOf = (m) => (m && m.length >= 4 ? m.slice(0, 4) : 'Unknown');
    const yearsSet = new Set();
    const byYear = {};            // year -> {value, vat, entries}
    const byChannel = {};         // channel -> {value, vat, entries, byYear}
    const byAgency = {};          // agency -> {value, vat, entries, byYear}
    const byClient = {};          // client -> {value, vat, entries, byYear}
    const byAgencyChannel = {};   // agency||channel -> {agency, channel, value, vat, byYear}
    const byMediaGroup = {};      // mg -> {value, vat, entries, byYear}  (only when not filtered)

    const bump = (bucket, key, year, sv, vat, extra) => {
      if (!bucket[key]) bucket[key] = { value: 0, vat: 0, entries: 0, byYear: {}, ...extra };
      bucket[key].value += sv;
      bucket[key].vat += vat;
      bucket[key].entries += 1;
      bucket[key].byYear[year] = (bucket[key].byYear[year] || 0) + sv;
    };

    for (const log of logs) {
      const year = yearOf(log.scheduleMonth);
      const sv = Number(log.scheduleValue) || 0;
      const vat = Number(log.scheduleValueWithVat) || 0;
      const channel = log.channelMaster?.name || 'Unknown';
      const agency = log.agency?.name || 'Unknown';
      const clientName = log.client?.name || 'Unknown';
      const mg = log.mediaGroup || 'Unknown';
      yearsSet.add(year);

      if (!byYear[year]) byYear[year] = { value: 0, vat: 0, entries: 0 };
      byYear[year].value += sv; byYear[year].vat += vat; byYear[year].entries += 1;

      bump(byChannel, channel, year, sv, vat, { channel });
      bump(byAgency, agency, year, sv, vat, { agency });
      bump(byClient, clientName, year, sv, vat, { client: clientName });
      bump(byAgencyChannel, `${agency}||${channel}`, year, sv, vat, { agency, channel });
      if (!mediaGroup) bump(byMediaGroup, mg, year, sv, vat, { mediaGroup: mg });
    }

    const years = Array.from(yearsSet).sort();
    const totalValue = logs.reduce((s, l) => s + (Number(l.scheduleValue) || 0), 0);
    const totalVat = logs.reduce((s, l) => s + (Number(l.scheduleValueWithVat) || 0), 0);

    const toSortedRows = (bucket, labelKey) =>
      Object.values(bucket)
        .map((r) => ({ ...r, [labelKey]: r[labelKey] }))
        .sort((a, b) => b.value - a.value || String(a[labelKey]).localeCompare(String(b[labelKey])));

    const report = {
      mediaGroup: mediaGroup || null,
      availableMediaGroups,
      availableChannels,
      availableClients,
      selectedChannelIds: channelIds,
      selectedClientIds: clientIds,
      years,
      summary: {
        totalValue,
        totalVat,
        entries: logs.length,
        channelCount: Object.keys(byChannel).length,
        agencyCount: Object.keys(byAgency).length,
        clientCount: Object.keys(byClient).length,
        byYear: years.map((y) => ({ year: y, value: byYear[y]?.value || 0, vat: byYear[y]?.vat || 0, entries: byYear[y]?.entries || 0 })),
      },
      byAgency: toSortedRows(byAgency, 'agency'),
      byChannel: toSortedRows(byChannel, 'channel'),
      byClient: toSortedRows(byClient, 'client'),
      byAgencyChannel: Object.values(byAgencyChannel)
        .sort((a, b) => a.agency.localeCompare(b.agency) || b.value - a.value || a.channel.localeCompare(b.channel)),
      byMediaGroup: mediaGroup ? [] : toSortedRows(byMediaGroup, 'mediaGroup'),
    };

    if (format !== 'excel' && format !== 'pdf') {
      return res.json(report);
    }

    const label = mediaGroup || 'All Media Groups';
    const fmtNum = (v) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const dateStr = new Date().toISOString().split('T')[0];

    // ── Excel export (multi-sheet, dynamic year columns) ─────────────────────
    if (format === 'excel') {
      const NAVY_BG = '0A1729';
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Ogilvy Orbit';
      workbook.created = new Date();

      const styleHeader = (sheet, colCount) => {
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
            const len = cell.value != null ? String(cell.value.formula ? '0.00' : cell.value).length : 0;
            if (len > maxLength) maxLength = len;
          });
          column.width = Math.min(maxLength + 4, 42);
        });
      };

      // A pivot sheet: <labelCols...> | <year cols> | Total | With VAT | Entries
      const addPivotSheet = (sheetName, labelCols, rowsData, labelValsOf) => {
        const safeName = sheetName.replace(/[\\/*?:\[\]]/g, '').substring(0, 31);
        const sheet = workbook.addWorksheet(safeName);
        const cols = [
          ...labelCols.map((c) => ({ header: c.header, key: c.key, width: 22 })),
          ...years.map((y) => ({ header: y, key: `y_${y}`, width: 16 })),
          { header: 'Total (LKR)', key: 'total', width: 18 },
          { header: 'With VAT (LKR)', key: 'vat', width: 18 },
          { header: 'Entries', key: 'entries', width: 10 },
        ];
        sheet.columns = cols;
        for (const r of rowsData) {
          const row = {};
          const labelVals = labelValsOf(r);
          labelCols.forEach((c, i) => { row[c.key] = labelVals[i]; });
          years.forEach((y) => { row[`y_${y}`] = r.byYear[y] || 0; });
          row.total = r.value;
          row.vat = r.vat;
          row.entries = r.entries;
          sheet.addRow(row);
        }
        // Number formats for numeric columns (years + total + vat)
        const firstNumCol = labelCols.length + 1;
        const lastNumCol = labelCols.length + years.length + 2; // through VAT
        for (let c = firstNumCol; c <= lastNumCol; c++) sheet.getColumn(c).numFmt = '#,##0.00';
        styleHeader(sheet, cols.length);
        // Totals row
        if (rowsData.length > 0) {
          const totalsRowNum = rowsData.length + 2;
          const tr = sheet.getRow(totalsRowNum);
          tr.getCell(1).value = 'TOTAL';
          for (let c = firstNumCol; c <= lastNumCol; c++) {
            const colLetter = sheet.getColumn(c).letter;
            tr.getCell(c).value = { formula: `SUM(${colLetter}2:${colLetter}${totalsRowNum - 1})` };
            tr.getCell(c).numFmt = '#,##0.00';
          }
          const entriesCol = lastNumCol + 1;
          const entriesLetter = sheet.getColumn(entriesCol).letter;
          tr.getCell(entriesCol).value = { formula: `SUM(${entriesLetter}2:${entriesLetter}${totalsRowNum - 1})` };
          tr.eachCell((cell) => { cell.font = { bold: true }; });
        }
        autoWidth(sheet);
        return sheet;
      };

      // 1) Summary sheet
      const summary = workbook.addWorksheet('Summary');
      summary.mergeCells('A1:D1');
      summary.getCell('A1').value = `Media Group Report — ${label}`;
      summary.getCell('A1').font = { bold: true, size: 15, color: { argb: `FF${NAVY_BG}` } };
      const metaLines = [
        `Generated: ${dateStr}`,
        agencyId ? `Agency filter applied` : `All agencies`,
        (monthFrom || monthTo) ? `Months: ${monthFrom || '…'} – ${monthTo || '…'}` : `All months`,
      ];
      summary.getCell('A2').value = metaLines.join('    ·    ');
      summary.getCell('A2').font = { italic: true, size: 10, color: { argb: 'FF6B7790' } };
      summary.addRow([]);
      const totalsHeaderRow = summary.addRow(['Total Schedule Value', 'With VAT', 'Entries', 'Channels', 'Agencies']);
      totalsHeaderRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${NAVY_BG}` } };
      });
      const totalsValRow = summary.addRow([totalValue, totalVat, logs.length, report.summary.channelCount, report.summary.agencyCount]);
      totalsValRow.getCell(1).numFmt = '#,##0.00';
      totalsValRow.getCell(2).numFmt = '#,##0.00';
      summary.addRow([]);
      const ywHeader = summary.addRow(['Year', 'Schedule Value (LKR)', 'With VAT (LKR)', 'Entries']);
      ywHeader.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${NAVY_BG}` } };
      });
      for (const yr of report.summary.byYear) {
        const r = summary.addRow([yr.year, yr.value, yr.vat, yr.entries]);
        r.getCell(2).numFmt = '#,##0.00';
        r.getCell(3).numFmt = '#,##0.00';
      }
      summary.getColumn(1).width = 26;
      summary.getColumn(2).width = 22;
      summary.getColumn(3).width = 22;
      summary.getColumn(4).width = 12;
      summary.getColumn(5).width = 12;

      // Order (as requested): year-wise total (Summary above) → By Agency →
      // By Channel → By Client → Agency x Channel → By Media Group (all-groups).

      // 2) By Agency (year-wise)
      addPivotSheet('By Agency', [{ header: 'Agency', key: 'agency' }], report.byAgency, (r) => [r.agency]);

      // 3) By Channel (year-wise)
      addPivotSheet('By Channel', [{ header: 'Channel', key: 'channel' }], report.byChannel, (r) => [r.channel]);

      // 4) By Client (year-wise)
      addPivotSheet('By Client', [{ header: 'Client', key: 'client' }], report.byClient, (r) => [r.client]);

      // 5) Agency x Channel (year-wise)
      addPivotSheet(
        'Agency x Channel',
        [{ header: 'Agency', key: 'agency' }, { header: 'Channel', key: 'channel' }],
        report.byAgencyChannel,
        (r) => [r.agency, r.channel],
      );

      // 6) By Media Group (only when covering all groups)
      if (!mediaGroup && report.byMediaGroup.length) {
        addPivotSheet('By Media Group', [{ header: 'Media Group', key: 'mediaGroup' }], report.byMediaGroup, (r) => [r.mediaGroup]);
      }

      const buffer = await workbook.xlsx.writeBuffer();
      const fnameGroup = (mediaGroup || 'all').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="media-group-${fnameGroup}-${dateStr}.xlsx"`);
      return res.send(Buffer.from(buffer));
    }

    // ── PDF export (branded, one section per breakdown, same order as Excel) ──
    if (format === 'pdf') {
      // Keep year columns only when few, so the table stays legible.
      const showYears = years.length > 0 && years.length <= 5;
      const yearCols = showYears ? years.map((y) => ({ key: y, label: y, align: 'right', w: 0.9 })) : [];
      const columns = [
        { key: 'Name', label: 'Name', align: 'left', w: 2.4 },
        ...yearCols,
        { key: 'Total', label: 'Total', align: 'right', w: 1.3 },
        { key: 'With VAT', label: 'With VAT', align: 'right', w: 1.3 },
      ];

      // Turn a set of pivot rows ({label key, byYear, value, vat}) into PDF rows.
      const pivotRows = (rows, labelKey) => rows.map((r) => {
        const row = { Name: r[labelKey], Total: fmtNum(r.value), 'With VAT': fmtNum(r.vat) };
        if (showYears) years.forEach((y) => { row[y] = r.byYear[y] ? fmtNum(r.byYear[y]) : ''; });
        return row;
      });

      // Order (as requested): year-wise total -> by agency -> by channel ->
      // by client -> agency x channel (+ by media group when unfiltered).
      const yearRows = report.summary.byYear.map((y) => ({ Name: y.year, Total: fmtNum(y.value), 'With VAT': fmtNum(y.vat) }));
      const acRows = report.byAgencyChannel.map((r) => {
        const row = { Name: `${r.agency} / ${r.channel}`, Total: fmtNum(r.value), 'With VAT': fmtNum(r.vat) };
        if (showYears) years.forEach((y) => { row[y] = r.byYear[y] ? fmtNum(r.byYear[y]) : ''; });
        return row;
      });

      const groups = [
        { name: 'Spend by Year', rows: yearRows },
        { name: 'Spend by Agency', rows: pivotRows(report.byAgency, 'agency') },
        { name: 'Spend by Channel', rows: pivotRows(report.byChannel, 'channel') },
        report.byClient.length ? { name: 'Spend by Client', rows: pivotRows(report.byClient, 'client') } : null,
        acRows.length ? { name: 'Agency x Channel', rows: acRows } : null,
        (!mediaGroup && report.byMediaGroup.length) ? { name: 'Spend by Media Group', rows: pivotRows(report.byMediaGroup, 'mediaGroup') } : null,
      ].filter(Boolean);

      const totals = {
        _label: `${label} · ${years.length ? years.join(', ') : 'no data'} · ${fmtNum(totalValue)} total`,
        Name: 'GRAND TOTAL',
        Total: fmtNum(totalValue),
        'With VAT': fmtNum(totalVat),
      };

      const ftParts = [`Media Group: ${label}`];
      if (channelIds.length) ftParts.push(`${channelIds.length} channel filter(s)`);
      if (agencyId) ftParts.push('Agency filter applied');
      if (clientIds.length) ftParts.push(`${clientIds.length} client filter(s)`);
      if (monthFrom || monthTo) ftParts.push(`Months: ${monthFrom || 'start'} to ${monthTo || 'latest'}`);
      ftParts.push(`${report.summary.agencyCount} agency(ies), ${report.summary.channelCount} channel(s), ${report.summary.clientCount} client(s)`);
      const filtersText = ftParts.join('   ·   ');

      const buffer = await generateGroupedTablePdf({ title: 'Media Group Report', filtersText, columns, groups, totals });
      const fnameGroup = (mediaGroup || 'all').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="media-group-${fnameGroup}-${dateStr}.pdf"`);
      return res.send(buffer);
    }
  } catch (error) {
    console.error('Media group report error:', error);
    return res.status(500).json({ error: 'Failed to generate media group report' });
  }
}
