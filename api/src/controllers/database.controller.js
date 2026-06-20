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
    const byAgency = {};
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

      const agency = log.agency?.name || 'Unknown';
      if (!byAgency[agency]) byAgency[agency] = { name: agency, value: 0, count: 0 };
      byAgency[agency].value += val;
      byAgency[agency].count++;
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
      byAgency: Object.values(byAgency).sort((a, b) => b.value - a.value),
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
    if (rows.length > 5000) {
      return res.status(400).json({ error: 'Maximum 5000 rows per upload' });
    }

    const user = req.user;
    const errors = [];

    // Pre-fetch everything referenced so we don't run per-row queries (which
    // would be thousands of round-trips for a large sheet). Rows are normally
    // all for the same client, but we handle multiple just in case.
    const clientIds = [...new Set(rows.map(r => parseInt(r.clientId)).filter(Number.isInteger))];
    const channelIds = [...new Set(rows.map(r => parseInt(r.channelMasterId)).filter(Number.isInteger))];

    // Resolve access + agency once per distinct client.
    const clientInfo = new Map();
    for (const cid of clientIds) {
      const accessed = await resolveClientAccess(user, cid);
      const client = accessed === null ? null
        : await prisma.client.findUnique({ where: { id: cid }, select: { agencyId: true } });
      clientInfo.set(cid, { allowed: accessed !== null && !!client, agencyId: client?.agencyId });
    }

    // Fetch all referenced channel masters in one query.
    const channelRecs = await prisma.channelMaster.findMany({
      where: { id: { in: channelIds } },
      include: { mediaGroup: { select: { name: true } } },
    });
    const channelMap = new Map(channelRecs.map(c => [c.id, c]));

    // Create the batch record (client/agency taken from the first row).
    const firstRow = rows[0];
    const batchAgencyId = clientInfo.get(parseInt(firstRow.clientId))?.agencyId;
    let uploadBatch = null;
    if (batchAgencyId && fileName) {
      uploadBatch = await prisma.uploadBatch.create({
        data: {
          agencyId: batchAgencyId,
          clientIds,
          scheduleMonth: firstRow.scheduleMonth || '',
          uploadedById: user.id,
          fileName: fileName || 'manual-entry',
          totalRows: rows.length,
          status: 'PROCESSING',
        },
      });
    }

    // Validate every row and build the insert payload.
    const toInsert = [];
    for (let i = 0; i < rows.length; i++) {
      const { clientId, channelMasterId, roNumber, scheduleMonth, scheduleValue, brandName } = rows[i];

      if (!clientId || !channelMasterId || !roNumber || !scheduleMonth || scheduleValue === undefined) {
        errors.push({ row: i, error: 'Missing required fields' });
        continue;
      }
      const ci = clientInfo.get(parseInt(clientId));
      if (!ci || !ci.allowed) { errors.push({ row: i, error: 'No access to this client' }); continue; }
      const ch = channelMap.get(parseInt(channelMasterId));
      if (!ch) { errors.push({ row: i, error: 'Channel not found' }); continue; }
      const value = parseFloat(scheduleValue);
      if (Number.isNaN(value)) { errors.push({ row: i, error: 'Invalid schedule value' }); continue; }

      toInsert.push({
        agencyId: ci.agencyId,
        clientId: parseInt(clientId),
        channelMasterId: ch.id,
        uploadedById: user.id,
        uploadBatchId: uploadBatch?.id || null,
        roNumber: String(roNumber),
        scheduleMonth,
        invoiceMonth: computeInvoiceMonth(scheduleMonth),
        medium: ch.medium,
        mediaGroup: ch.mediaGroup.name,
        brandName: brandName || null,
        scheduleValue: value,
        scheduleValueWithVat: parseFloat((value * 1.18).toFixed(2)),
      });
    }

    // Single bulk insert for everything that validated.
    let createdCount = 0;
    if (toInsert.length > 0) {
      const result = await prisma.scheduleLog.createMany({ data: toInsert });
      createdCount = result.count;
    }

    // Update batch with results.
    if (uploadBatch) {
      await prisma.uploadBatch.update({
        where: { id: uploadBatch.id },
        data: {
          successfulRows: createdCount,
          failedRows: errors.length,
          status: createdCount === 0 ? 'FAILED' : 'COMPLETE',
        },
      });
    }

    return res.status(201).json({ created: createdCount, createdCount, errors, batchId: uploadBatch?.id || null });
  } catch (error) {
    console.error('Bulk create error:', error);
    return res.status(500).json({ error: 'Failed to bulk create', detail: error.message });
  }
}

// ── importAllScheduleLogs (multi-client bulk import, resolve by name) ──

function normalizeMonthServer(raw) {
  if (raw == null || raw === '') return '';
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  // YYYY/MM or YYYY-M
  let m = s.match(/^(\d{4})[/\-.](\d{1,2})$/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}`;
  // MM/YYYY or M-YYYY
  m = s.match(/^(\d{1,2})[/\-.](\d{4})$/);
  if (m) return `${m[2]}-${String(m[1]).padStart(2, '0')}`;
  // Month name + year, e.g. "Jan 2023", "January-2023"
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  m = s.match(/^([A-Za-z]{3,})[\s\-/]+(\d{4})$/);
  if (m) {
    const idx = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (idx >= 0) return `${m[2]}-${String(idx + 1).padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  return s;
}

const norm = (v) => String(v ?? '').trim().toLowerCase();

// Combine a separate Year column with a "Sch: Month" value that may be a month
// name ("Jan"), a number ("1"), or already a full YYYY-MM / "Jan 2023".
function combineYearMonth(year, month) {
  const m = String(month ?? '').trim();
  if (!m) return '';
  // Already a full month value
  if (/^\d{4}-\d{2}$/.test(m) || /[A-Za-z]{3,}[\s\-/]+\d{4}/.test(m) || /\d{1,2}[/\-.]\d{4}/.test(m) || /\d{4}[/\-.]\d{1,2}/.test(m)) {
    return normalizeMonthServer(m);
  }
  const y = String(year ?? '').trim().match(/\d{4}/)?.[0];
  if (!y) return normalizeMonthServer(m);
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const nameIdx = MONTHS.indexOf(m.slice(0, 3).toLowerCase());
  if (nameIdx >= 0) return `${y}-${String(nameIdx + 1).padStart(2, '0')}`;
  const numMatch = m.match(/^(\d{1,2})$/);
  if (numMatch) {
    const mm = parseInt(numMatch[1]);
    if (mm >= 1 && mm <= 12) return `${y}-${String(mm).padStart(2, '0')}`;
  }
  return normalizeMonthServer(m);
}

export async function importAllScheduleLogs(req, res) {
  try {
    const { rows, fileName, createMissingClients = true } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'rows array is required' });
    }
    if (rows.length > 60000) {
      return res.status(400).json({ error: 'Maximum 60000 rows per import' });
    }
    const user = req.user;

    // Pre-load lookups
    const [agencies, clients, channels] = await Promise.all([
      prisma.agency.findMany({ select: { id: true, name: true } }),
      prisma.client.findMany({ select: { id: true, name: true, agencyId: true } }),
      prisma.channelMaster.findMany({ include: { mediaGroup: { select: { name: true } } } }),
    ]);

    const agencyByName = new Map(agencies.map((a) => [norm(a.name), a]));
    const agencyById = new Map(agencies.map((a) => [a.id, a]));
    const clientByKey = new Map(clients.map((c) => [`${c.agencyId}::${norm(c.name)}`, c]));
    // Client name -> list of clients (for resolving when no agency column is given)
    const clientsByName = new Map();
    for (const c of clients) {
      const k = norm(c.name);
      if (!clientsByName.has(k)) clientsByName.set(k, []);
      clientsByName.get(k).push(c);
    }
    const channelByName = new Map();
    for (const ch of channels) {
      channelByName.set(norm(ch.name), ch);
      for (const al of ch.aliases || []) channelByName.set(norm(al), ch);
    }

    const errors = [];
    const createdClients = [];
    const toInsert = [];
    const usedClientIds = new Set();
    const usedAgencyIds = new Set();

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const agencyName = r.agency ?? r.agencyName;
      const clientName = r.client ?? r.clientName;
      const channelName = r.channel ?? r.channelName;
      // Month may arrive pre-normalized (YYYY-MM) or as a month name with a
      // separate year column (e.g. "Jan" + 2023).
      const scheduleMonth = combineYearMonth(r.year, r.scheduleMonth ?? r.month);
      const roNumber = r.roNumber ?? r.ro ?? '';
      const brandName = r.brand ?? r.brandName ?? null;
      const rawValue = r.scheduleValue ?? r.value;

      if (!clientName || !channelName) {
        errors.push({ row: i + 1, error: 'Missing client or channel' }); continue;
      }
      if (!/^\d{4}-\d{2}$/.test(scheduleMonth)) {
        errors.push({ row: i + 1, error: `Invalid month "${r.scheduleMonth ?? r.month}"${r.year ? ` (year ${r.year})` : ''}` }); continue;
      }
      const value = parseFloat(String(rawValue).replace(/,/g, ''));
      if (Number.isNaN(value)) { errors.push({ row: i + 1, error: 'Invalid schedule value' }); continue; }

      // Resolve agency (optional) + client.
      let agency = agencyName ? agencyByName.get(norm(agencyName)) : null;
      if (agencyName && !agency) { errors.push({ row: i + 1, error: `Agency not found: "${agencyName}"` }); continue; }

      let client;
      if (agency) {
        const clientKey = `${agency.id}::${norm(clientName)}`;
        client = clientByKey.get(clientKey);
        if (!client) {
          if (!createMissingClients) { errors.push({ row: i + 1, error: `Client not found: "${clientName}"` }); continue; }
          try {
            client = await prisma.client.create({ data: { agencyId: agency.id, name: String(clientName).trim() } });
            clientByKey.set(clientKey, client);
            (clientsByName.get(norm(clientName)) || clientsByName.set(norm(clientName), []).get(norm(clientName))).push(client);
            createdClients.push({ agency: agency.name, client: client.name });
          } catch {
            client = await prisma.client.findFirst({ where: { agencyId: agency.id, name: String(clientName).trim() } });
            if (!client) { errors.push({ row: i + 1, error: `Could not create client "${clientName}"` }); continue; }
            clientByKey.set(clientKey, client);
          }
        }
      } else {
        // No agency column — resolve client by name across all agencies.
        const matches = clientsByName.get(norm(clientName)) || [];
        if (matches.length === 1) {
          client = matches[0];
          agency = agencyById.get(client.agencyId);
        } else if (matches.length === 0) {
          errors.push({ row: i + 1, error: `Client not found: "${clientName}" (add it first, or include an Agency column)` }); continue;
        } else {
          const agencyNames = matches.map((m) => agencyById.get(m.agencyId)?.name).filter(Boolean).join(', ');
          errors.push({ row: i + 1, error: `Client "${clientName}" exists under multiple agencies (${agencyNames}); add an Agency column` }); continue;
        }
      }

      const channel = channelByName.get(norm(channelName));
      if (!channel) { errors.push({ row: i + 1, error: `Channel not found: "${channelName}"` }); continue; }

      usedAgencyIds.add(agency.id);
      usedClientIds.add(client.id);
      toInsert.push({
        agencyId: agency.id,
        clientId: client.id,
        channelMasterId: channel.id,
        uploadedById: user.id,
        roNumber: String(roNumber || '-'),
        scheduleMonth,
        invoiceMonth: computeInvoiceMonth(scheduleMonth),
        medium: channel.medium,
        mediaGroup: channel.mediaGroup.name,
        brandName: brandName ? String(brandName).trim() : null,
        scheduleValue: value,
        scheduleValueWithVat: parseFloat((value * 1.18).toFixed(2)),
      });
    }

    // One batch record for the whole import.
    let uploadBatch = null;
    if (toInsert.length > 0) {
      uploadBatch = await prisma.uploadBatch.create({
        data: {
          agencyId: [...usedAgencyIds][0],
          clientIds: [...usedClientIds],
          scheduleMonth: '',
          uploadedById: user.id,
          fileName: fileName || 'bulk-import',
          totalRows: rows.length,
          status: 'PROCESSING',
        },
      });
      for (const t of toInsert) t.uploadBatchId = uploadBatch.id;
    }

    // Insert in chunks to stay well within payload limits.
    let createdCount = 0;
    const CHUNK = 1000;
    for (let i = 0; i < toInsert.length; i += CHUNK) {
      const slice = toInsert.slice(i, i + CHUNK);
      const result = await prisma.scheduleLog.createMany({ data: slice });
      createdCount += result.count;
    }

    if (uploadBatch) {
      await prisma.uploadBatch.update({
        where: { id: uploadBatch.id },
        data: {
          successfulRows: createdCount,
          failedRows: errors.length,
          status: createdCount === 0 ? 'FAILED' : 'COMPLETE',
        },
      });
    }

    return res.status(201).json({
      created: createdCount,
      failed: errors.length,
      createdClients,
      errors: errors.slice(0, 200),
      batchId: uploadBatch?.id || null,
    });
  } catch (error) {
    console.error('Import all error:', error);
    return res.status(500).json({ error: 'Failed to import', detail: error.message });
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

    // Non-admins must have access to at least one client in the batch.
    if (user.role !== 'SUPER_ADMIN') {
      const accessibleIds = await getAccessibleClientIds(user.id, user.role);
      const hasAccess = (batch.clientIds || []).some(cid => accessibleIds.includes(cid));
      if (!hasAccess) {
        return res.status(403).json({ error: 'You do not have access to this batch' });
      }
      // Only the original uploader can delete it.
      if (batch.uploadedById !== user.id) {
        return res.status(403).json({ error: 'You can only delete your own uploads' });
      }
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
