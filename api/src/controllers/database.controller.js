import prisma from '../utils/prisma.js';
import { getAccessibleClientIds } from '../middleware/access.js';
import { commissionSnapshot } from '../utils/commission.js';
import { bestMatch, rankMatches, clusterNames } from '../utils/fuzzy.js';
import { matchKey, planMatchedUpdates } from '../utils/importMatch.js';

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

// Whether `user` may see a specific client's schedule-log data. Uses the SAME
// canonical resolver as the rest of the app (getAccessibleClientIds), so a Hub
// (GROUP_HEAD) or Desk (PLANNER) sees exactly the clients assigned to them in
// Admin → Users - team AND direct UserClientAccess assignments - and nothing
// else. Changing a user's clients in the Users part applies here immediately.
// Returns the client id when allowed, else null.
async function resolveClientAccess(user, clientId) {
  const cid = parseInt(clientId);
  if (Number.isNaN(cid)) return null;
  if (user.role === 'SUPER_ADMIN') return cid;
  const ids = await getAccessibleClientIds(user.id, user.role);
  return ids.includes(cid) ? cid : null;
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
    const { monthFrom, monthTo, agencyId, clientId, brand } = req.query;
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
      if (clientId) where.clientId = parseInt(clientId);
    } else if (user.role === 'GROUP_HEAD' || user.role === 'PLANNER') {
      // Client-scoped roles: restrict to the clients they can access.
      const ids = await getAccessibleClientIds(user.id, user.role);
      if (clientId) {
        const cid = parseInt(clientId);
        if (!ids.includes(cid)) return res.status(403).json({ error: 'Access denied to this client' });
        where.clientId = cid;
      } else {
        where.clientId = { in: ids };
      }
    } else {
      // SUPER_ADMIN
      if (agencyId) where.agencyId = parseInt(agencyId);
      if (clientId) where.clientId = parseInt(clientId);
    }

    // Brand drill-down (only surfaced in the UI when a single client is selected).
    // The full brand list for the current scope is computed BEFORE applying the
    // brand filter, so the picker stays populated once a brand is chosen.
    let brandOptions = [];
    if (clientId) {
      const brandRows = await prisma.scheduleLog.findMany({
        where: { ...where, brandName: { not: null } },
        select: { brandName: true },
        distinct: ['brandName'],
        orderBy: { brandName: 'asc' },
      });
      brandOptions = brandRows.map(b => b.brandName).filter(Boolean);
    }
    // `brand` may be a single value or a comma-separated list (multi-select).
    if (brand) {
      const brands = String(brand).split(',').map(b => b.trim()).filter(Boolean);
      if (brands.length === 1) where.brandName = brands[0];
      else if (brands.length > 1) where.brandName = { in: brands };
    }

    const logs = await prisma.scheduleLog.findMany({
      where,
      select: {
        scheduleMonth: true,
        medium: true,
        mediaGroup: true,
        scheduleValue: true,
        scheduleValueWithVat: true,
        channelMasterId: true,
        channelMaster: { select: { name: true, isDirectPlacement: true } },
        clientId: true,
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
    const monthMedium = {};       // month -> { medium -> value }
    const brandMonth = {};        // brand -> { month -> value }
    const clientMonths = {};      // client -> Set(months)
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
      if (!byChannel[ch]) byChannel[ch] = { name: ch, medium: med, mediaGroup: mg, channelMasterId: log.channelMasterId ?? null, isDirectPlacement: log.channelMaster?.isDirectPlacement === true, value: 0, count: 0 };
      byChannel[ch].value += val;
      byChannel[ch].count++;

      const month = log.scheduleMonth || 'Unknown';
      if (!byMonth[month]) byMonth[month] = { month, value: 0, valueWithVat: 0, count: 0 };
      byMonth[month].value += val;
      byMonth[month].valueWithVat += vat;
      byMonth[month].count++;

      const client = log.client?.name || 'Unknown';
      if (!byClient[client]) byClient[client] = { name: client, clientId: log.clientId ?? null, value: 0, count: 0 };
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

      // medium share per month (for the 100% stacked mix-shift area)
      if (/^\d{4}-\d{2}$/.test(month)) {
        if (!monthMedium[month]) monthMedium[month] = {};
        monthMedium[month][med] = (monthMedium[month][med] || 0) + val;
        // brand value per month (for the brand trend lines)
        if (!brandMonth[brand]) brandMonth[brand] = {};
        brandMonth[brand][month] = (brandMonth[brand][month] || 0) + val;
        // distinct active months per client (for tenure bubble)
        if (!clientMonths[client]) clientMonths[client] = new Set();
        clientMonths[client].add(month);
      }
    }

    // ── Derived series for the richer charts ──
    const sortedMonths = Object.keys(monthMedium).sort();
    const byMonthMedium = sortedMonths.map((m) => {
      const row = { month: m, TV: 0, RADIO: 0, PRINT: 0, DIGITAL: 0, CINEMA: 0, OOH: 0 };
      for (const [med, v] of Object.entries(monthMedium[m])) row[med] = Math.round(v);
      return row;
    });

    // Top 6 brands (by total), pivoted to one row per month.
    const topBrands = Object.values(byBrand).sort((a, b) => b.value - a.value).slice(0, 6).map((b) => b.name);
    const brandTrend = sortedMonths.map((m) => {
      const row = { month: m };
      for (const b of topBrands) row[b] = Math.round(brandMonth[b]?.[m] || 0);
      return row;
    });

    // Client tenure: months active, total value, avg monthly spend.
    const clientTenure = Object.values(byClient).map((c) => {
      const months = clientMonths[c.name]?.size || 0;
      return { name: c.name, months, value: Math.round(c.value), avgMonth: months ? Math.round(c.value / months) : Math.round(c.value), entries: c.count };
    }).sort((a, b) => b.value - a.value);

    // Flighting: which months each top client was active (Gantt-style grid).
    const clientFlighting = Object.values(byClient).sort((a, b) => b.value - a.value).slice(0, 15).map((c) => ({
      name: c.name,
      value: Math.round(c.value),
      months: [...(clientMonths[c.name] || [])].sort(),
    }));

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
      byMonthMedium,
      brandTrend,
      brandTrendKeys: topBrands,
      clientTenure,
      clientFlighting,
      flightingMonths: sortedMonths,
      brandOptions,
    });
  } catch (error) {
    console.error('Get analytics error:', error);
    return res.status(500).json({ error: 'Failed to get analytics', detail: error.message });
  }
}

// Negotiated deals (Property rows) for the clients the viewer can access - the
// Spend Analytics "Deals & Properties" section. Same access model as getAnalytics
// (SUPER_ADMIN all, MANAGER their agencies, GROUP_HEAD/PLANNER their clients).
// Each row links to its client channel page (/channels/:channelId).
// Client yearly targets vs achieved (actual schedule spend) for the Spend
// Analytics client-target section. Role-scoped like getAnalytics: MANAGER →
// their agencies' clients, GROUP_HEAD/PLANNER → their accessible clients,
// SUPER_ADMIN → all. Lists only clients that have a target set for the year.
export async function getClientTargets(req, res) {
  try {
    const user = req.user;
    const now = new Date().getFullYear();

    const clientWhere = { isActive: true };
    if (user.role === 'MANAGER') {
      const access = await prisma.userAgencyAccess.findMany({ where: { userId: user.id }, select: { agencyId: true } });
      clientWhere.agencyId = { in: access.map((a) => a.agencyId) };
    } else if (user.role === 'GROUP_HEAD' || user.role === 'PLANNER') {
      const ids = await getAccessibleClientIds(user.id, user.role);
      clientWhere.id = { in: ids.length ? ids : [-1] };
    }

    // Optional agency/client narrowing from the filter bar - intersected with
    // the role scope above (AND semantics) so it can only ever restrict, never
    // widen, what the user is allowed to see.
    const reqAgencyId = parseInt(req.query.agencyId) || null;
    const reqClientId = parseInt(req.query.clientId) || null;
    if (reqAgencyId) {
      if (clientWhere.agencyId && clientWhere.agencyId.in) {
        clientWhere.agencyId = { in: clientWhere.agencyId.in.includes(reqAgencyId) ? [reqAgencyId] : [] };
      } else {
        clientWhere.agencyId = reqAgencyId;
      }
    }
    if (reqClientId) {
      if (clientWhere.id && clientWhere.id.in) {
        clientWhere.id = { in: clientWhere.id.in.includes(reqClientId) ? [reqClientId] : [] };
      } else {
        clientWhere.id = reqClientId;
      }
    }

    const clients = await prisma.client.findMany({
      where: clientWhere,
      select: { id: true, name: true, agency: { select: { name: true } } },
      orderBy: [{ name: 'asc' }],
    });
    const clientIds = clients.map((c) => c.id);

    // Years offered: those with a client target + current year, newest first.
    const targetYears = await prisma.clientTarget.findMany({
      where: clientIds.length ? { clientId: { in: clientIds } } : {},
      distinct: ['year'], select: { year: true },
    });
    const yset = new Set([now]);
    for (const t of targetYears) yset.add(t.year);
    const availableYears = [...yset].sort((a, b) => b - a);
    const year = parseInt(req.query.year) || now;

    const [targets, spendRows] = await Promise.all([
      prisma.clientTarget.findMany({ where: { year, clientId: { in: clientIds.length ? clientIds : [-1] } } }),
      prisma.scheduleLog.groupBy({
        by: ['clientId'],
        where: { isDeleted: false, clientId: { in: clientIds.length ? clientIds : [-1] }, scheduleMonth: { gte: `${year}-01`, lte: `${year}-12` } },
        _sum: { scheduleValue: true },
      }),
    ]);
    const targetBy = new Map(targets.map((t) => [t.clientId, Number(t.amount)]));
    const spendBy = new Map(spendRows.map((r) => [r.clientId, Number(r._sum.scheduleValue) || 0]));

    const rows = clients
      .filter((c) => targetBy.has(c.id))
      .map((c) => {
        const target = targetBy.get(c.id);
        const achieved = spendBy.get(c.id) || 0;
        const remaining = target - achieved;
        return {
          clientId: c.id,
          name: c.name,
          agencyName: c.agency?.name || '',
          target: Number(target.toFixed(2)),
          achieved: Number(achieved.toFixed(2)),
          remaining: Number(remaining.toFixed(2)),
          pct: target > 0 ? Number(((achieved / target) * 100).toFixed(1)) : null,
        };
      })
      .sort((a, b) => b.target - a.target);

    const totals = {
      target: Number(rows.reduce((s, r) => s + r.target, 0).toFixed(2)),
      achieved: Number(rows.reduce((s, r) => s + r.achieved, 0).toFixed(2)),
    };
    totals.remaining = Number((totals.target - totals.achieved).toFixed(2));
    totals.pct = totals.target > 0 ? Number(((totals.achieved / totals.target) * 100).toFixed(1)) : null;

    return res.json({ year, availableYears, rows, totals });
  } catch (error) {
    console.error('getClientTargets error:', error);
    return res.status(500).json({ error: 'Failed to load client targets', detail: error.message });
  }
}

export async function getScopedProperties(req, res) {
  try {
    const { agencyId, clientId } = req.query;
    const user = req.user;

    const channelWhere = {};
    // Resolve the client scope.
    let allowedClientIds = null; // null = unrestricted (SUPER_ADMIN)
    if (user.role === 'MANAGER') {
      const access = await prisma.userAgencyAccess.findMany({ where: { userId: user.id }, select: { agencyId: true } });
      const agencyIds = access.map(a => a.agencyId);
      const clients = await prisma.client.findMany({ where: { agencyId: { in: agencyIds } }, select: { id: true } });
      allowedClientIds = clients.map(c => c.id);
    } else if (user.role === 'GROUP_HEAD' || user.role === 'PLANNER') {
      allowedClientIds = await getAccessibleClientIds(user.id, user.role);
    }

    if (clientId) {
      const cid = parseInt(clientId);
      if (allowedClientIds && !allowedClientIds.includes(cid)) return res.status(403).json({ error: 'Access denied to this client' });
      channelWhere.clientId = cid;
    } else if (allowedClientIds) {
      channelWhere.clientId = { in: allowedClientIds };
    } else if (agencyId) {
      // SUPER_ADMIN agency filter.
      channelWhere.client = { agencyId: parseInt(agencyId) };
    }

    const props = await prisma.property.findMany({
      where: { channel: channelWhere },
      select: {
        id: true, name: true, type: true, category: true, cost: true,
        bonusValue: true, bonusPct: true, startDate: true, endDate: true,
        channel: { select: { id: true, name: true, type: true, client: { select: { id: true, name: true, agency: { select: { name: true } } } } } },
      },
      orderBy: [{ channel: { client: { name: 'asc' } } }, { name: 'asc' }],
    });

    return res.json({
      properties: props.map(p => ({
        id: p.id,
        name: p.name,
        propertyType: p.type || '',
        category: p.category || '',
        cost: Number(p.cost),
        bonusValue: Number(p.bonusValue),
        bonusPct: p.bonusPct == null ? null : Number(p.bonusPct),
        startDate: p.startDate,
        endDate: p.endDate,
        channelId: p.channel.id,
        channelName: p.channel.name,
        medium: p.channel.type,
        clientId: p.channel.client.id,
        clientName: p.channel.client.name,
        agencyName: p.channel.client.agency?.name || '',
      })),
    });
  } catch (error) {
    console.error('Get scoped properties error:', error);
    return res.status(500).json({ error: 'Failed to load properties', detail: error.message });
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
      select: { agencyId: true, commissionType: true, commissionValue: true },
    });
    if (!client) return res.status(404).json({ error: 'Client not found' });
    const commission = commissionSnapshot(client);

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
        scheduleValue: Math.round(value * 100) / 100,
        scheduleValueWithVat,
        commissionTypeAtEntry: commission.commissionTypeAtEntry,
        commissionRateAtEntry: commission.commissionRateAtEntry,
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

// A schedule log is a duplicate of an existing (non-deleted) DB row when the
// Year+Month (scheduleMonth), Client, Channel and Schedule Value all match.
// Brand and RO are intentionally NOT part of the key - which is also what lets a
// brand-corrected re-upload still match its original row (see updateMatched).
// The key itself lives in utils/importMatch.js so both paths share one definition.
const dedupeKey = matchKey;

// Split validated candidate rows into the ones to insert vs. a count of
// duplicates. A row is a duplicate only if it matches a row ALREADY IN THE
// DATABASE (month+client+channel+value) - repeats within the same file are NOT
// treated as duplicates and are all kept.
// Also returns the fetched `existing` rows (id + label columns) so a caller can
// plan matched-row corrections without a second query.
async function splitDuplicates(candidates) {
  if (candidates.length === 0) return { unique: [], duplicates: 0, duplicateRows: [], existing: [] };
  const clientIds = [...new Set(candidates.map(c => c.clientId))];
  const months = [...new Set(candidates.map(c => c.scheduleMonth))];
  const existing = await prisma.scheduleLog.findMany({
    where: { clientId: { in: clientIds }, scheduleMonth: { in: months }, isDeleted: false },
    select: {
      id: true, clientId: true, channelMasterId: true, scheduleMonth: true,
      scheduleValue: true, brandName: true, roNumber: true,
    },
  });
  const seen = new Set(existing.map(dedupeKey));
  const unique = [];
  const duplicateRows = []; // original 1-based row numbers flagged as duplicates
  let duplicates = 0;
  for (const c of candidates) {
    if (seen.has(dedupeKey(c))) { duplicates++; if (c._row != null) duplicateRows.push(c._row); continue; }
    unique.push(c);
  }
  return { unique, duplicates, duplicateRows, existing };
}

// ── "Update matched rows" re-upload mode ──
//
// The safe way to fix a label column (brand, RO) on already-imported rows: match
// each file row to its existing row on Client+Channel+Month+Value and overwrite
// ONLY that label. Nothing is inserted, nothing is deleted, and because the value
// is part of the match key every touched row keeps the exact amount it already
// had - so no total, in any aggregation, can move. Contrast with the two older
// modes: the default SKIPS matches (brands stay wrong) and `replaceExisting`
// soft-deletes whole client-months (destructive if the file is a partial subset).
//
// Every change writes a ScheduleLogEdit audit row, exactly like a grid edit.

// Match on the RAW label values so a column missing from the sheet reads as "no
// instruction" rather than as a blank that would clear real data. Shared by the
// dry-run preview and the apply pass so the two can never disagree about what
// would change (`_rawRo` is absent on the per-client path, where RO is required).
function matchingShape(candidates) {
  return candidates.map(c => ({ ...c, roNumber: c._rawRo === undefined ? c.roNumber : c._rawRo }));
}

// Apply the plan: overwrite the label columns on matched rows + audit each change.
async function applyMatchedUpdates(existing, candidates, userId, fileName) {
  const plan = planMatchedUpdates(existing, matchingShape(candidates));
  if (plan.updates.length === 0) {
    return { updated: 0, unchanged: plan.unchanged, ambiguous: plan.ambiguous, matchedRows: plan.matchedRows };
  }

  const note = `Corrected via re-upload${fileName ? `: ${fileName}` : ''}`;
  let updated = 0;
  // Chunked so a large correction doesn't build one enormous transaction.
  const CHUNK = 200;
  for (let i = 0; i < plan.updates.length; i += CHUNK) {
    const slice = plan.updates.slice(i, i + CHUNK);
    const ops = [];
    for (const u of slice) {
      ops.push(prisma.scheduleLog.update({ where: { id: u.id }, data: u.changes }));
      ops.push(prisma.scheduleLogEdit.create({
        data: {
          scheduleLogId: u.id,
          editedById: userId,
          previousValues: u.before,
          newValues: u.changes,
          editNote: note,
        },
      }));
    }
    await prisma.$transaction(ops);
    updated += slice.length;
  }
  return { updated, unchanged: plan.unchanged, ambiguous: plan.ambiguous, matchedRows: plan.matchedRows };
}

// "Replace" import: for every (client, scheduleMonth) pair present in the upload,
// soft-delete the existing non-deleted rows so the fresh rows take their place
// (re-uploading a month/year replaces it instead of doubling the totals).
function clientMonthPairs(candidates) {
  const byClient = new Map();
  for (const c of candidates) {
    if (!byClient.has(c.clientId)) byClient.set(c.clientId, new Set());
    byClient.get(c.clientId).add(c.scheduleMonth);
  }
  return byClient;
}

async function countExistingForReplace(candidates) {
  const byClient = clientMonthPairs(candidates);
  let n = 0;
  for (const [clientId, months] of byClient) {
    n += await prisma.scheduleLog.count({ where: { clientId, scheduleMonth: { in: [...months] }, isDeleted: false } });
  }
  return n;
}

async function softDeleteForReplace(candidates, userId) {
  const byClient = clientMonthPairs(candidates);
  let removed = 0;
  for (const [clientId, months] of byClient) {
    const r = await prisma.scheduleLog.updateMany({
      where: { clientId, scheduleMonth: { in: [...months] }, isDeleted: false },
      data: { isDeleted: true, deletedById: userId, deletedAt: new Date() },
    });
    removed += r.count;
  }
  return removed;
}

export async function bulkCreateScheduleLogs(req, res) {
  try {
    const { rows, fileName, updateMatched = false } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'rows array is required' });
    }
    if (rows.length > 5000) {
      return res.status(400).json({ error: 'Maximum 5000 rows per upload' });
    }

    const user = req.user;
    const errors = [];

    // Correcting rows that are already in the database is an admin / group-head
    // action: a PLANNER can still fix their own rows one cell at a time in the
    // grid, but not overwrite a whole upload's worth in one request.
    if (updateMatched && !['SUPER_ADMIN', 'GROUP_HEAD'].includes(user.role)) {
      return res.status(403).json({ error: 'Only admins and group heads can update rows already in the database' });
    }

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
        : await prisma.client.findUnique({ where: { id: cid }, select: { agencyId: true, commissionType: true, commissionValue: true } });
      clientInfo.set(cid, { allowed: accessed !== null && !!client, agencyId: client?.agencyId, commission: commissionSnapshot(client) });
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
    const candidates = [];
    for (let i = 0; i < rows.length; i++) {
      const { clientId, channelMasterId, roNumber, scheduleMonth, scheduleValue, brandName, extra } = rows[i];

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

      candidates.push({
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
        scheduleValue: Math.round(value * 100) / 100,
        scheduleValueWithVat: parseFloat((value * 1.18).toFixed(2)),
        importExtra: (extra && typeof extra === 'object' && Object.keys(extra).length) ? extra : null,
        commissionTypeAtEntry: ci.commission.commissionTypeAtEntry,
        commissionRateAtEntry: ci.commission.commissionRateAtEntry,
      });
    }

    // Skip rows already present (re-import) instead of duplicating them.
    const { unique: toInsert, duplicates, existing } = await splitDuplicates(candidates);

    // Optionally correct the label columns (brand/RO) on the rows this upload
    // already matches, instead of skipping them. Amounts are never touched.
    let matched = null;
    if (updateMatched) {
      matched = await applyMatchedUpdates(existing, candidates, user.id, fileName);
    }

    // Single bulk insert for everything that validated and isn't a duplicate.
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
          status: createdCount === 0 && duplicates === 0 && !matched?.updated ? 'FAILED' : 'COMPLETE',
        },
      });
    }

    return res.status(201).json({
      created: createdCount, createdCount,
      duplicates: updateMatched ? 0 : duplicates,
      updated: matched?.updated || 0,
      updatedUnchanged: matched?.unchanged || 0,
      updatedAmbiguous: matched?.ambiguous?.length || 0,
      errors, batchId: uploadBatch?.id || null,
    });
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

// ── Bulk-import reconciliation ────────────────────────────────────────────────
// Given the distinct client & channel names in an uploaded file, tell the client
// which resolve exactly (name or alias), which are ambiguous, and which don't
// match - with a fuzzy suggestion for each. Unmatched CHANNEL names are clustered
// (likely variants of the same channel grouped together) for one-tap review.
export async function reconcileImport(req, res) {
  try {
    const clientNames = Array.isArray(req.body.clientNames) ? req.body.clientNames : [];
    const channelNames = Array.isArray(req.body.channelNames) ? req.body.channelNames : [];

    const [clients, agencies, channels] = await Promise.all([
      prisma.client.findMany({ select: { id: true, name: true, agencyId: true, aliases: true, isActive: true } }),
      prisma.agency.findMany({ select: { id: true, name: true } }),
      prisma.channelMaster.findMany({ select: { id: true, name: true, medium: true, aliases: true, isActive: true } }),
    ]);
    const agencyName = new Map(agencies.map((a) => [a.id, a.name]));
    const shapeClient = (c, extra = {}) => ({ id: c.id, name: c.name, agencyId: c.agencyId, agencyName: agencyName.get(c.agencyId) || '', ...extra });
    const shapeChannel = (ch, extra = {}) => ({ id: ch.id, name: ch.name, medium: ch.medium, isActive: ch.isActive, ...extra });

    // Exact index (norm = trim+lower, matching how the importer resolves).
    const clientExact = new Map();
    for (const c of clients) {
      for (const key of [c.name, ...(c.aliases || [])]) {
        const k = norm(key);
        if (!clientExact.has(k)) clientExact.set(k, []);
        clientExact.get(k).push(c);
      }
    }
    const clientCand = clients.map((c) => ({ id: c.id, name: c.name, aliases: c.aliases, agencyId: c.agencyId }));

    const clientResults = clientNames.map(({ raw, count }) => {
      const uniq = [...new Map((clientExact.get(norm(raw)) || []).map((h) => [h.id, h])).values()];
      if (uniq.length === 1) return { raw, count, status: 'matched', match: shapeClient(uniq[0]) };
      if (uniq.length > 1) return { raw, count, status: 'ambiguous', options: uniq.map((c) => shapeClient(c)) };
      const bm = bestMatch(raw, clientCand);
      return {
        raw, count, status: 'unmatched',
        suggestion: bm ? shapeClient(bm.candidate, { score: bm.score }) : null,
        options: rankMatches(raw, clientCand, 8).map((m) => shapeClient(m, { score: m.score })),
      };
    });

    const channelExact = new Map();
    for (const ch of channels) {
      for (const key of [ch.name, ...(ch.aliases || [])]) {
        const k = norm(key);
        if (!channelExact.has(k)) channelExact.set(k, ch);
      }
    }
    const chCand = channels.map((ch) => ({ id: ch.id, name: ch.name, aliases: ch.aliases, medium: ch.medium, isActive: ch.isActive }));

    const matchedChannels = [];
    const unmatched = [];
    for (const { raw, count } of channelNames) {
      const hit = channelExact.get(norm(raw));
      if (hit) matchedChannels.push({ raw, count, match: shapeChannel(hit) });
      else unmatched.push({ raw, count });
    }
    const channelClusters = clusterNames(unmatched, 0.8).map((cl) => {
      const rep = cl.slice().sort((a, b) => b.count - a.count)[0];
      const bm = bestMatch(rep.raw, chCand);
      return {
        variants: cl,
        suggestion: bm ? shapeChannel(bm.candidate, { score: bm.score }) : null,
        options: rankMatches(rep.raw, chCand, 8).map((m) => shapeChannel(m, { score: m.score })),
      };
    });

    const hasIssues = clientResults.some((r) => r.status !== 'matched') || channelClusters.length > 0;
    return res.json({ clients: clientResults, matchedChannels, channelClusters, hasIssues });
  } catch (error) {
    console.error('reconcileImport error:', error);
    return res.status(500).json({ error: 'Failed to reconcile import', detail: error.message });
  }
}

// Apply the user's reconciliation choices BEFORE the actual insert:
//  - learn each raw→system mapping as an alias (client.aliases / channelMaster.aliases)
//    so this and future imports resolve it automatically;
//  - file a ClientRequest / ChannelRequest for each "request new" and HOLD the
//    file's rows that depend on it (PendingImportRow) until an admin approves.
// Returns the raw names now held (so the caller drops those rows) + request ids.
export async function applyImportReconciliation(req, res) {
  try {
    const user = req.user;
    const fileName = String(req.body.fileName || 'import');
    const clientMappings = Array.isArray(req.body.clientMappings) ? req.body.clientMappings : []; // [{ raw, clientId }]
    const channelMappings = Array.isArray(req.body.channelMappings) ? req.body.channelMappings : []; // [{ raw, channelId }]
    const newClients = Array.isArray(req.body.newClients) ? req.body.newClients : []; // [{ raw, name, agencyId, notes }]
    const newChannels = Array.isArray(req.body.newChannels) ? req.body.newChannels : []; // [{ raw, name, medium, notes }]
    const rows = Array.isArray(req.body.rows) ? req.body.rows : []; // full parsed rows (reconciled names optional)

    // 1) Learn aliases. Skip a raw that already equals the target's name/alias.
    for (const m of channelMappings) {
      const chId = parseInt(m.channelId); const raw = String(m.raw || '').trim();
      if (!Number.isInteger(chId) || !raw) continue;
      const ch = await prisma.channelMaster.findUnique({ where: { id: chId }, select: { name: true, aliases: true } });
      if (!ch) continue;
      const known = new Set([norm(ch.name), ...(ch.aliases || []).map(norm)]);
      if (!known.has(norm(raw))) await prisma.channelMaster.update({ where: { id: chId }, data: { aliases: { push: raw } } });
    }
    for (const m of clientMappings) {
      const cId = parseInt(m.clientId); const raw = String(m.raw || '').trim();
      if (!Number.isInteger(cId) || !raw) continue;
      const c = await prisma.client.findUnique({ where: { id: cId }, select: { name: true, aliases: true } });
      if (!c) continue;
      const known = new Set([norm(c.name), ...(c.aliases || []).map(norm)]);
      if (!known.has(norm(raw))) await prisma.client.update({ where: { id: cId }, data: { aliases: { push: raw } } });
    }

    // 2) File "request new" records; map each raw → request id.
    const clientReqByRaw = new Map();
    for (const nc of newClients) {
      const name = String(nc.name || nc.raw || '').trim();
      if (!name) continue;
      const r = await prisma.clientRequest.create({
        data: { requestedById: user.id, clientName: name, agencyId: nc.agencyId ? parseInt(nc.agencyId) : null, notes: nc.notes ? String(nc.notes).slice(0, 500) : `Bulk import: ${fileName}` },
      });
      clientReqByRaw.set(norm(nc.raw), r.id);
    }
    const channelReqByRaw = new Map();
    for (const nch of newChannels) {
      const name = String(nch.name || nch.raw || '').trim();
      const category = ['TV', 'RADIO', 'PRINT', 'CINEMA', 'OOH', 'DIGITAL'].includes(nch.medium) ? nch.medium : 'TV';
      if (!name) continue;
      const r = await prisma.channelRequest.create({
        data: { requestedById: user.id, channelName: name, category, notes: nch.notes ? String(nch.notes).slice(0, 500) : `Bulk import: ${fileName}` },
      });
      channelReqByRaw.set(norm(nch.raw), r.id);
    }
    await notifyAdminsOfRequests(clientReqByRaw.size + channelReqByRaw.size, fileName).catch(() => {});

    // 3) Hold rows that reference a pending new client and/or channel.
    let held = 0;
    if (clientReqByRaw.size || channelReqByRaw.size) {
      const heldData = [];
      for (const r of rows) {
        const cReq = clientReqByRaw.get(norm(r.client ?? r.clientName)) || null;
        const chReq = channelReqByRaw.get(norm(r.channel ?? r.channelName)) || null;
        if (cReq || chReq) heldData.push({ fileName, rowData: r, clientReqId: cReq, channelReqId: chReq, createdById: user.id });
      }
      if (heldData.length) { await prisma.pendingImportRow.createMany({ data: heldData }); held = heldData.length; }
    }

    return res.json({
      message: 'Reconciliation applied',
      aliasesAdded: { clients: clientMappings.length, channels: channelMappings.length },
      requests: { clients: clientReqByRaw.size, channels: channelReqByRaw.size },
      held,
      // Raw names now pending (caller excludes their rows from the immediate import).
      pendingClientNames: [...clientReqByRaw.keys()],
      pendingChannelNames: [...channelReqByRaw.keys()],
    });
  } catch (error) {
    console.error('applyImportReconciliation error:', error);
    return res.status(500).json({ error: 'Failed to apply reconciliation', detail: error.message });
  }
}

// Best-effort notify SUPER_ADMINs that bulk import filed new client/channel requests.
async function notifyAdminsOfRequests(n, fileName) {
  if (!n) return;
  const admins = await prisma.user.findMany({ where: { role: 'SUPER_ADMIN' }, select: { id: true } });
  await prisma.notification.createMany({
    data: admins.map((a) => ({ userId: a.id, type: 'IMPORT_REQUEST', title: `${n} new name request(s) from import`, message: `Bulk import "${fileName}" needs ${n} new client/channel(s) approved before its held rows import.`, link: '/admin' })),
  });
}

// Resolve a batch of reconciled parsed rows (client/channel names, already mapped
// or newly created) and insert them as ScheduleLogs under a fresh UploadBatch.
// Returns the number inserted. Used to release held import rows after approval.
async function insertResolvedRows(rows, userId, fileName) {
  if (!rows.length) return 0;
  const [agencies, clients, channels] = await Promise.all([
    prisma.agency.findMany({ select: { id: true, name: true } }),
    prisma.client.findMany({ select: { id: true, name: true, agencyId: true, aliases: true, commissionType: true, commissionValue: true } }),
    prisma.channelMaster.findMany({ include: { mediaGroup: { select: { name: true } } } }),
  ]);
  const agencyByName = new Map(agencies.map((a) => [norm(a.name), a]));
  const clientByKey = new Map();
  const clientsByName = new Map();
  for (const c of clients) {
    for (const key of [c.name, ...(c.aliases || [])]) {
      const nk = norm(key);
      clientByKey.set(`${c.agencyId}::${nk}`, c);
      if (!clientsByName.has(nk)) clientsByName.set(nk, []);
      if (!clientsByName.get(nk).some((x) => x.id === c.id)) clientsByName.get(nk).push(c);
    }
  }
  const channelByName = new Map();
  for (const ch of channels) {
    channelByName.set(norm(ch.name), ch);
    for (const al of ch.aliases || []) channelByName.set(norm(al), ch);
  }

  const data = [];
  for (const r of rows) {
    const clientName = r.client ?? r.clientName;
    const channelName = r.channel ?? r.channelName;
    const scheduleMonth = combineYearMonth(r.year, r.scheduleMonth ?? r.month);
    if (!/^\d{4}-\d{2}$/.test(scheduleMonth)) continue;
    const value = parseFloat(String(r.scheduleValue ?? r.value).replace(/,/g, ''));
    if (Number.isNaN(value)) continue;
    const agency = (r.agency ?? r.agencyName) ? agencyByName.get(norm(r.agency ?? r.agencyName)) : null;
    let client = agency ? clientByKey.get(`${agency.id}::${norm(clientName)}`) : (clientsByName.get(norm(clientName)) || [])[0];
    if (!client) continue;
    const channel = channelByName.get(norm(channelName));
    if (!channel) continue;
    data.push({
      agencyId: client.agencyId, clientId: client.id, channelMasterId: channel.id, uploadedById: userId,
      roNumber: String(r.roNumber ?? r.ro ?? '-'), scheduleMonth, invoiceMonth: computeInvoiceMonth(scheduleMonth),
      medium: channel.medium, mediaGroup: channel.mediaGroup.name, brandName: (r.brand ?? r.brandName) ? String(r.brand ?? r.brandName).trim() : null,
      scheduleValue: Math.round(value * 100) / 100, scheduleValueWithVat: parseFloat((value * 1.18).toFixed(2)),
      importExtra: (r.extra && typeof r.extra === 'object' && Object.keys(r.extra).length) ? r.extra : null,
      ...commissionSnapshot(client),
    });
  }
  if (!data.length) return 0;
  const months = data.map((d) => d.scheduleMonth).sort();
  const batch = await prisma.uploadBatch.create({
    data: {
      fileName, uploadedById: userId, totalRows: data.length, status: 'COMPLETE',
      agencyId: data[0].agencyId, clientIds: [...new Set(data.map((d) => d.clientId))],
      scheduleMonth: months[0] === months[months.length - 1] ? months[0] : `${months[0]}..${months[months.length - 1]}`,
    },
  });
  await prisma.scheduleLog.createMany({ data: data.map((d) => ({ ...d, uploadBatchId: batch.id })) });
  return data.length;
}

// Called after a ClientRequest/ChannelRequest is APPROVED (entity now exists).
// Clears that dependency on held rows; any row whose deps are all clear is
// inserted and removed from the hold queue.
export async function releaseHeldImportRows({ clientReqId = null, channelReqId = null }, userId) {
  const where = clientReqId ? { clientReqId } : channelReqId ? { channelReqId } : null;
  if (!where) return { released: 0 };
  const held = await prisma.pendingImportRow.findMany({ where });
  if (!held.length) return { released: 0 };
  const field = clientReqId ? 'clientReqId' : 'channelReqId';
  await prisma.pendingImportRow.updateMany({ where, data: { [field]: null } });
  const ids = held.map((h) => h.id);
  const refreshed = await prisma.pendingImportRow.findMany({ where: { id: { in: ids } } });
  const ready = refreshed.filter((r) => r.clientReqId == null && r.channelReqId == null);
  if (!ready.length) return { released: 0 };
  const released = await insertResolvedRows(ready.map((r) => r.rowData), userId, `${ready[0].fileName} (held rows)`);
  await prisma.pendingImportRow.deleteMany({ where: { id: { in: ready.map((r) => r.id) } } });
  return { released };
}

export async function importAllScheduleLogs(req, res) {
  try {
    const { rows, fileName, createMissingClients = true, dryRun = false, allowDuplicates = false, replaceExisting = false, updateMatched = false } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'rows array is required' });
    }
    if (rows.length > 60000) {
      return res.status(400).json({ error: 'Maximum 60000 rows per import' });
    }
    // The three re-upload modes are mutually exclusive: correcting matched rows in
    // place is the opposite of re-inserting them or deleting the month around them.
    if (updateMatched && (allowDuplicates || replaceExisting)) {
      return res.status(400).json({ error: 'updateMatched cannot be combined with allowDuplicates or replaceExisting' });
    }
    const user = req.user;

    // Pre-load lookups
    const [agencies, clients, channels] = await Promise.all([
      prisma.agency.findMany({ select: { id: true, name: true } }),
      prisma.client.findMany({ select: { id: true, name: true, agencyId: true, aliases: true, commissionType: true, commissionValue: true } }),
      prisma.channelMaster.findMany({ include: { mediaGroup: { select: { name: true } } } }),
    ]);

    const agencyByName = new Map(agencies.map((a) => [norm(a.name), a]));
    const agencyById = new Map(agencies.map((a) => [a.id, a]));
    // Client resolution matches on name OR any learned alias (from reconciliation).
    const clientByKey = new Map();
    const clientsByName = new Map();
    for (const c of clients) {
      for (const key of [c.name, ...(c.aliases || [])]) {
        const nk = norm(key);
        clientByKey.set(`${c.agencyId}::${nk}`, c);
        if (!clientsByName.has(nk)) clientsByName.set(nk, []);
        // Avoid listing the same client twice under one key (name === alias edge).
        if (!clientsByName.get(nk).some((x) => x.id === c.id)) clientsByName.get(nk).push(c);
      }
    }
    const channelByName = new Map();
    for (const ch of channels) {
      channelByName.set(norm(ch.name), ch);
      for (const al of ch.aliases || []) channelByName.set(norm(al), ch);
    }

    const errors = [];
    const createdClients = [];
    const candidates = [];
    const usedClientIds = new Set();
    const usedAgencyIds = new Set();
    let pendingNewClientRows = 0; // dry-run: rows for a not-yet-created client (always "new")

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
          // Dry-run must not mutate the DB. A row for a not-yet-created client
          // is always brand new (no existing logs), so just count it.
          if (dryRun) { pendingNewClientRows++; continue; }
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
        // No agency column - resolve client by name across all agencies.
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

      candidates.push({
        _row: i + 1, // original spreadsheet row (stripped before insert)
        // Raw RO as it appeared in the sheet (null when the column is absent), so
        // a matched-row correction never overwrites a real RO with the '-' default.
        _rawRo: roNumber === '' || roNumber == null ? null : String(roNumber),
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
        scheduleValue: Math.round(value * 100) / 100,
        scheduleValueWithVat: parseFloat((value * 1.18).toFixed(2)),
        importExtra: (r.extra && typeof r.extra === 'object' && Object.keys(r.extra).length) ? r.extra : null,
        ...commissionSnapshot(client),
      });
    }

    // Skip rows already in the DB (re-import) instead of duplicating them, then
    // derive the batch's agency/client lists from what actually gets inserted.
    const { unique, duplicates, duplicateRows, existing } = await splitDuplicates(candidates);

    // Dry-run: report what WOULD happen (new vs duplicate vs failed) and stop -
    // nothing is written, so the UI can ask how to proceed.
    if (dryRun) {
      // A readable sample of the rows it considers new, for transparency.
      const clientById = new Map(clients.map(c => [c.id, c.name]));
      const channelById = new Map(channels.map(ch => [ch.id, ch.name]));
      const newSample = unique.slice(0, 20).map(u => ({
        client: clientById.get(u.clientId) || `#${u.clientId}`,
        channel: channelById.get(u.channelMasterId) || `#${u.channelMasterId}`,
        month: u.scheduleMonth,
        brand: u.brandName || '',
        ro: u.roNumber,
        value: u.scheduleValue,
      }));
      // How many existing rows a "Replace" would soft-delete (the months/clients
      // in this file), so the UI can offer replace and warn about the count.
      const existingToReplace = await countExistingForReplace(candidates);
      // What an "Update matched rows" pass would correct: the label changes only,
      // with a before/after sample so the user can see it before committing.
      const plan = planMatchedUpdates(existing, matchingShape(candidates));
      const updateSample = plan.updates.slice(0, 20).map((u) => {
        const row = existing.find(e => e.id === u.id) || {};
        return {
          client: clientById.get(row.clientId) || `#${row.clientId}`,
          channel: channelById.get(row.channelMasterId) || `#${row.channelMasterId}`,
          month: row.scheduleMonth,
          value: Number(row.scheduleValue),
          changes: Object.keys(u.changes).map(f => ({
            field: f === 'brandName' ? 'Brand' : 'RO',
            from: u.before[f] || '(blank)',
            to: u.changes[f],
          })),
        };
      });
      return res.json({
        dryRun: true,
        total: candidates.length + pendingNewClientRows,
        newRows: unique.length + pendingNewClientRows,
        newClientRows: pendingNewClientRows,
        duplicates,
        existingToReplace,
        // Matched-row correction preview.
        matchedRows: plan.matchedRows,
        matchedUpdates: plan.updates.length,
        matchedUnchanged: plan.unchanged,
        matchedAmbiguous: plan.ambiguous.length,
        updateSample,
        failed: errors.length,
        errors, // full list so the user can download every failed row
        duplicateRows,
        newSample,
      });
    }

    // "Replace" mode: soft-delete the existing rows for every (client, month) in
    // this file, then insert ALL valid rows (so a re-upload replaces the old data
    // instead of doubling it). Otherwise: "Re-upload everything" inserts all valid
    // rows (duplicates included); the default inserts only rows not already present.
    let replacedCount = 0;
    if (replaceExisting) {
      replacedCount = await softDeleteForReplace(candidates, user.id);
    }

    // "Update matched rows" mode: correct the label columns (brand/RO) on the rows
    // this file already matches, then fall through to insert only the genuinely
    // new rows. Nothing is deleted and no amount is touched, so totals hold.
    let matched = null;
    if (updateMatched) {
      matched = await applyMatchedUpdates(existing, candidates, user.id, fileName);
    }

    const insertSource = (replaceExisting || allowDuplicates) ? candidates : unique;
    const toInsert = insertSource.map(({ _row, _rawRo, ...rest }) => rest);
    const reportedDuplicates = (replaceExisting || allowDuplicates) ? 0 : duplicates;
    for (const t of toInsert) { usedAgencyIds.add(t.agencyId); usedClientIds.add(t.clientId); }

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
      // In updateMatched mode the matched rows were corrected, not skipped, so
      // reporting them as "duplicates" would misdescribe what happened.
      duplicates: updateMatched ? 0 : reportedDuplicates,
      replaced: replacedCount,
      updated: matched?.updated || 0,
      updatedUnchanged: matched?.unchanged || 0,
      updatedAmbiguous: matched?.ambiguous?.length || 0,
      createdClients,
      errors, // full list so the user can download every failed row
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
      const access = await resolveClientAccess(user, existing.clientId);
      if (access === null) {
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
      const access = await resolveClientAccess(user, existing.clientId);
      if (access === null) {
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
