import prisma from '../utils/prisma.js';
import { getAccessibleClientIds } from '../middleware/access.js';
import { accountManagerByClient, buildForecastBudgetDetail } from './forecastInsights.controller.js';

const MEDIUM_ORDER = ['TV', 'RADIO', 'PRINT', 'CINEMA', 'OOH', 'DIGITAL'];

// The month group heads forecast: the current calendar month through the
// 14th, then it rolls to next month from the 15th onward (e.g. through May
// 14th shows May; from May 15th it shows June).
function nextMonth() {
  const d = new Date();
  const rollOver = d.getDate() >= 15;
  d.setDate(1);
  if (rollOver) d.setMonth(d.getMonth() + 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

// A client counts as "assigned to a group head" - and so is shown in the
// forecasting roster - when it is linked to a group head through ANY of the
// admin assignment paths: on a team that has a head set (Team.headUserId) or a
// GROUP_HEAD member (Teams tab / "Assign Accounts to Heads"), OR directly
// assigned to a GROUP_HEAD user (Users tab → UserClientAccess). Clients linked
// to no group head are old/unassigned and are hidden. Spread into a Client
// `where` as an `OR`; exported so the Insights roster stays in sync.
export const GROUP_HEAD_CLIENT_OR = [
  { teams: { some: { team: { headUserId: { not: null } } } } },
  { teams: { some: { team: { members: { some: { user: { role: 'GROUP_HEAD' } } } } } } },
  { users: { some: { user: { role: 'GROUP_HEAD' } } } },
];

// Client ids the caller may access (null = unrestricted, for SUPER_ADMIN).
async function accessibleClientIds(user) {
  if (user.role === 'SUPER_ADMIN') return null;
  return getAccessibleClientIds(user.id, user.role);
}

// SUPER_ADMIN may target any month (e.g. backfilling June so it can be
// copied into July) via ?year=&month=; everyone else is locked to next month.
function resolveTargetMonth(req) {
  if (req.user.role === 'SUPER_ADMIN') {
    const y = parseInt(req.query.year);
    const m = parseInt(req.query.month);
    if (y >= 2000 && m >= 1 && m <= 12) return { year: y, month: m };
  }
  return nextMonth();
}

export async function getNextMonth(req, res) {
  return res.json(nextMonth());
}

// Months that have any forecast data (for the variance month picker), newest first.
async function forecastMonths() {
  const rows = await prisma.monthlyForecast.findMany({
    select: { year: true, month: true },
    distinct: ['year', 'month'],
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
  });
  return rows.map(r => ({ year: r.year, month: r.month }));
}

// Forecast vs actual per client × channel for a month (admins/managers).
// Forecast comes from MonthlyForecast (millions); actual from ScheduleLog (LKR → millions).
export async function getVariance(req, res) {
  try {
    const user = req.user;
    const ids = await accessibleClientIds(user); // null = all (super admin)

    let year = parseInt(req.query.year);
    let month = parseInt(req.query.month);
    if (!(year >= 2000 && month >= 1 && month <= 12)) {
      const latest = await prisma.monthlyForecast.findFirst({ orderBy: [{ year: 'desc' }, { month: 'desc' }], select: { year: true, month: true } });
      if (latest) { year = latest.year; month = latest.month; }
      else { const nm = nextMonth(); year = nm.year; month = nm.month; }
    }
    const ym = `${year}-${String(month).padStart(2, '0')}`;

    const fWhere = { year, month };
    const aWhere = { isDeleted: false, scheduleMonth: ym };
    if (ids) { fWhere.clientId = { in: ids }; aWhere.clientId = { in: ids }; }

    const [fRows, aRows] = await Promise.all([
      prisma.monthlyForecast.groupBy({ by: ['clientId', 'channelMasterId'], where: fWhere, _sum: { amountMillions: true } }),
      prisma.scheduleLog.groupBy({ by: ['clientId', 'channelMasterId'], where: aWhere, _sum: { scheduleValue: true } }),
    ]);

    const map = new Map();
    const keyOf = (c, ch) => `${c}:${ch ?? 'null'}`;
    for (const r of fRows) {
      map.set(keyOf(r.clientId, r.channelMasterId), { clientId: r.clientId, channelMasterId: r.channelMasterId, forecast: Number(r._sum.amountMillions) || 0, actual: 0 });
    }
    for (const r of aRows) {
      const k = keyOf(r.clientId, r.channelMasterId);
      const e = map.get(k) || { clientId: r.clientId, channelMasterId: r.channelMasterId, forecast: 0, actual: 0 };
      e.actual = (Number(r._sum.scheduleValue) || 0) / 1e6;
      map.set(k, e);
    }

    const entries = [...map.values()];
    const clientIds = [...new Set(entries.map(e => e.clientId))];
    const channelIds = [...new Set(entries.map(e => e.channelMasterId).filter(v => v != null))];
    const [clients, channels] = await Promise.all([
      prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true, agency: { select: { name: true } } } }),
      prisma.channelMaster.findMany({ where: { id: { in: channelIds } }, select: { id: true, name: true, medium: true } }),
    ]);
    const cMap = new Map(clients.map(c => [c.id, c]));
    const chMap = new Map(channels.map(c => [c.id, c]));

    const rows = entries.map(e => {
      const c = cMap.get(e.clientId);
      const ch = e.channelMasterId != null ? chMap.get(e.channelMasterId) : null;
      const forecastMillions = Number(e.forecast.toFixed(2));
      const actualMillions = Number(e.actual.toFixed(2));
      return {
        client: c?.name || `#${e.clientId}`,
        agency: c?.agency?.name || '',
        channel: ch?.name || 'Unlinked',
        medium: ch?.medium || '',
        forecastMillions,
        actualMillions,
        varianceMillions: Number((actualMillions - forecastMillions).toFixed(2)),
      };
    }).sort((a, b) => a.client.localeCompare(b.client) || a.channel.localeCompare(b.channel));

    const totals = rows.reduce((t, r) => ({ f: t.f + r.forecastMillions, a: t.a + r.actualMillions }), { f: 0, a: 0 });

    return res.json({
      year,
      month,
      rows,
      totals: {
        forecastMillions: Number(totals.f.toFixed(2)),
        actualMillions: Number(totals.a.toFixed(2)),
        varianceMillions: Number((totals.a - totals.f).toFixed(2)),
      },
      months: await forecastMonths(),
    });
  } catch (error) {
    console.error('getVariance error:', error);
    return res.status(500).json({ error: 'Failed to build forecast vs actual', detail: error.message });
  }
}

// Every forecast row the caller can see for a month (client × channel), for the
// client-wise export. Read-only, so any month is allowed (entered or previous),
// scoped to the caller's accessible clients (SUPER_ADMIN: all).
export async function exportForecastEntries(req, res) {
  try {
    const user = req.user;
    const ids = await accessibleClientIds(user);
    let year = parseInt(req.query.year);
    let month = parseInt(req.query.month);
    if (!(year >= 2000 && month >= 1 && month <= 12)) {
      const nm = nextMonth();
      year = nm.year;
      month = nm.month;
    }
    const where = { year, month };
    if (ids) where.clientId = { in: ids };

    const rows = await prisma.monthlyForecast.findMany({
      where,
      include: {
        client: { select: { name: true, agency: { select: { name: true } } } },
        channelMaster: { select: { name: true, medium: true, mediaGroup: { select: { name: true } } } },
      },
    });

    // Account manager (managing group head) per client, for the by-manager sheets.
    const amMap = await accountManagerByClient([...new Set(rows.map(r => r.clientId))]);

    return res.json({
      year,
      month,
      rows: rows.map(r => ({
        clientId: r.clientId,
        clientName: r.client?.name || `#${r.clientId}`,
        agencyName: r.client?.agency?.name || '',
        accountManager: amMap.get(r.clientId) || 'Unassigned',
        channelMasterId: r.channelMasterId,
        channelName: r.channelMaster?.name || '',
        medium: r.channelMaster?.medium || '',
        mediaGroup: r.channelMaster?.mediaGroup?.name || '',
        amountMillions: Number(r.amountMillions),
        notes: r.notes || '',
      })),
    });
  } catch (error) {
    console.error('exportForecastEntries error:', error);
    return res.status(500).json({ error: 'Failed to export forecast data', detail: error.message });
  }
}

// Active clients the caller can forecast for, each with next-month status.
export async function listForecastClients(req, res) {
  try {
    const user = req.user;
    const ids = await accessibleClientIds(user);
    // GROUP_HEAD/PLANNER only forecast clients assigned to a group head (see
    // GROUP_HEAD_CLIENT_OR); clients linked to no group head are old/inactive and
    // hidden. SUPER_ADMIN sees every active client; MANAGER (read-only) sees every
    // active client in their agencies (already scoped by `ids`), not just the roster.
    const where = { isActive: true };
    if (user.role === 'GROUP_HEAD' || user.role === 'PLANNER') where.OR = GROUP_HEAD_CLIENT_OR;
    if (ids) where.id = { in: ids };
    if (req.query.agencyId) where.agencyId = parseInt(req.query.agencyId);

    const clients = await prisma.client.findMany({
      where,
      select: { id: true, name: true, agency: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });

    const { year, month } = resolveTargetMonth(req);
    // Latest submission time per client for this month, so the roster can show
    // the most-recently-submitted clients first.
    const submittedAgg = await prisma.monthlyForecast.groupBy({
      by: ['clientId'],
      where: { year, month, clientId: { in: clients.map(c => c.id) } },
      _max: { submittedAt: true },
      _sum: { amountMillions: true },
    });
    const submittedAtByClient = new Map(submittedAgg.map(s => [s.clientId, s._max.submittedAt]));
    const totalByClient = new Map(submittedAgg.map(s => [s.clientId, Number(s._sum.amountMillions) || 0]));

    const rows = clients.map(c => ({
      id: c.id,
      name: c.name,
      agencyId: c.agency?.id,
      agencyName: c.agency?.name || '',
      status: submittedAtByClient.has(c.id) ? 'submitted' : 'pending',
      submittedAt: submittedAtByClient.get(c.id) || null,
      // Total forecast entered for this client this month (full LKR).
      totalAmount: Number(((totalByClient.get(c.id) || 0) * 1e6).toFixed(2)),
      totalMillions: Number((totalByClient.get(c.id) || 0).toFixed(2)),
    }));
    // Latest-submitted client first; then not-yet-submitted clients A→Z.
    rows.sort((a, b) => {
      const at = a.submittedAt ? new Date(a.submittedAt).getTime() : null;
      const bt = b.submittedAt ? new Date(b.submittedAt).getTime() : null;
      if (at && bt) return bt - at;
      if (at) return -1;
      if (bt) return 1;
      return a.name.localeCompare(b.name);
    });

    return res.json({ year, month, clients: rows });
  } catch (error) {
    console.error('listForecastClients error:', error);
    return res.status(500).json({ error: 'Failed to load forecasting clients', detail: error.message });
  }
}

// Per-medium "total" bucket channel name (the seeded TOTAL_BUCKETS), and the
// label shown for the total-only input. Print is total-only (no per-channel
// split); every other medium offers a per-medium toggle between entering each
// channel individually and entering one lump-sum total.
const TOTAL_BUCKET_NAME = { TV: 'TV Total', RADIO: 'Radio Total', PRINT: 'Print', CINEMA: 'Cinema', OOH: 'OOH', DIGITAL: 'Digital' };
const TOTAL_ONLY_MEDIA = ['PRINT'];
const totalInputLabel = (m) => `${m === 'TV' ? 'TV' : m === 'OOH' ? 'OOH' : m[0] + m.slice(1).toLowerCase()} total`;

// Channels for the forecast entry table. Each category returns its real
// channels plus a `totalChannel` (the medium's total bucket) so the UI can let
// a head switch to entering one medium-level total when they lack the split.
// Print stays total-only.
export async function listForecastChannels(req, res) {
  try {
    const channels = await prisma.channelMaster.findMany({
      where: { isActive: true, isDeleted: false },
      select: { id: true, name: true, medium: true, sortOrder: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const groups = {};
    for (const ch of channels) (groups[ch.medium] ||= []).push(ch);
    const categories = [];
    for (const m of MEDIUM_ORDER) {
      const list = groups[m];
      if (!list || !list.length) continue;
      const bucketName = TOTAL_BUCKET_NAME[m];
      const bucket = bucketName ? list.find(c => c.name.toLowerCase() === bucketName.toLowerCase()) : null;
      const real = list.filter(c => c.id !== bucket?.id);
      if (TOTAL_ONLY_MEDIA.includes(m)) {
        // Total-only (Print): one lump-sum input, no per-channel rows.
        const b = bucket || list[0];
        categories.push({ category: m, total: true, channels: [{ id: b.id, name: `${totalInputLabel(m)}` }] });
      } else {
        const cat = { category: m, channels: real.map(c => ({ id: c.id, name: c.name })) };
        if (bucket) cat.totalChannel = { id: bucket.id, name: totalInputLabel(m) };
        categories.push(cat);
      }
    }
    return res.json({ categories });
  } catch (error) {
    console.error('listForecastChannels error:', error);
    return res.status(500).json({ error: 'Failed to load channels', detail: error.message });
  }
}

// Existing next-month forecast for a client (prefills the entry table).
export async function getForecastEntry(req, res) {
  try {
    const user = req.user;
    const clientId = parseInt(req.query.clientId);
    if (!Number.isInteger(clientId)) return res.status(400).json({ error: 'clientId is required' });
    const ids = await accessibleClientIds(user);
    if (ids && !ids.includes(clientId)) return res.status(403).json({ error: 'No access to this client' });

    const { year, month } = resolveTargetMonth(req);
    const rows = await prisma.monthlyForecast.findMany({
      where: { clientId, year, month },
      select: { channelMasterId: true, amountMillions: true, notes: true },
    });
    return res.json({
      year,
      month,
      items: rows.map(r => ({ channelMasterId: r.channelMasterId, amountMillions: Number(r.amountMillions), notes: r.notes || '' })),
    });
  } catch (error) {
    console.error('getForecastEntry error:', error);
    return res.status(500).json({ error: 'Failed to load forecast', detail: error.message });
  }
}

// The most recent forecast a client has BEFORE the upcoming month - used to
// pre-fill ("copy last month") so heads don't re-enter everything.
export async function getPreviousForecast(req, res) {
  try {
    const user = req.user;
    const clientId = parseInt(req.query.clientId);
    if (!Number.isInteger(clientId)) return res.status(400).json({ error: 'clientId is required' });
    const ids = await accessibleClientIds(user);
    if (ids && !ids.includes(clientId)) return res.status(403).json({ error: 'No access to this client' });

    const { year, month } = resolveTargetMonth(req);
    const latest = await prisma.monthlyForecast.findFirst({
      where: { clientId, OR: [{ year: { lt: year } }, { year, month: { lt: month } }] },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      select: { year: true, month: true },
    });
    if (!latest) return res.json({ found: false, items: [] });

    const rows = await prisma.monthlyForecast.findMany({
      where: { clientId, year: latest.year, month: latest.month },
      select: { channelMasterId: true, amountMillions: true, notes: true },
    });
    return res.json({
      found: true,
      year: latest.year,
      month: latest.month,
      items: rows.map(r => ({ channelMasterId: r.channelMasterId, amountMillions: Number(r.amountMillions), notes: r.notes || '' })),
    });
  } catch (error) {
    console.error('getPreviousForecast error:', error);
    return res.status(500).json({ error: 'Failed to load previous forecast', detail: error.message });
  }
}

// Save a client's forecast for a month. Group heads: upcoming month only, own clients.
export async function submitForecast(req, res) {
  try {
    const user = req.user;
    const { clientId, year, month, items } = req.body;
    const cid = parseInt(clientId);
    const y = parseInt(year);
    const m = parseInt(month);
    if (!Number.isInteger(cid) || !Number.isInteger(y) || !Number.isInteger(m)) {
      return res.status(400).json({ error: 'clientId, year and month are required' });
    }
    if (!Array.isArray(items)) return res.status(400).json({ error: 'items must be an array' });

    const ids = await accessibleClientIds(user);
    if (ids && !ids.includes(cid)) return res.status(403).json({ error: 'You do not have access to this client' });

    const client = await prisma.client.findUnique({ where: { id: cid }, select: { id: true, agencyId: true, isActive: true } });
    if (!client || !client.isActive) return res.status(404).json({ error: 'Client not found or inactive' });

    // Group heads may only submit the upcoming month.
    const nm = nextMonth();
    if (user.role !== 'SUPER_ADMIN' && (y !== nm.year || m !== nm.month)) {
      return res.status(403).json({ error: "You can only submit the upcoming month's forecast" });
    }

    const ops = [];
    for (const it of items) {
      const chId = parseInt(it.channelMasterId);
      if (!Number.isInteger(chId)) continue;
      const amt = parseFloat(it.amountMillions);
      if (Number.isNaN(amt) || amt <= 0) {
        // Cleared row → remove any existing entry.
        ops.push(prisma.monthlyForecast.deleteMany({ where: { year: y, month: m, clientId: cid, channelMasterId: chId } }));
        continue;
      }
      const notes = it.notes ? String(it.notes).slice(0, 500) : null;
      ops.push(prisma.monthlyForecast.upsert({
        where: { year_month_clientId_channelMasterId: { year: y, month: m, clientId: cid, channelMasterId: chId } },
        update: { amountMillions: amt, notes, submittedById: user.id, agencyId: client.agencyId },
        create: { year: y, month: m, clientId: cid, channelMasterId: chId, agencyId: client.agencyId, amountMillions: amt, notes, submittedById: user.id },
      }));
    }
    await prisma.$transaction(ops);
    return res.json({ message: 'Forecast saved', rows: ops.length });
  } catch (error) {
    console.error('submitForecast error:', error);
    return res.status(500).json({ error: 'Failed to save forecast', detail: error.message });
  }
}

// Notify all super admins (best-effort) with a deep link.
async function notifyAdmins(type, title, message, link) {
  try {
    const admins = await prisma.user.findMany({ where: { role: 'SUPER_ADMIN' }, select: { id: true } });
    if (!admins.length) return;
    await prisma.notification.createMany({ data: admins.map(a => ({ userId: a.id, type, title, message, link })) });
  } catch (e) { console.error('notifyAdmins failed:', e.message); }
}

export async function requestClient(req, res) {
  try {
    const { clientName, agencyId, notes } = req.body;
    if (!clientName || !String(clientName).trim()) return res.status(400).json({ error: 'Client name is required' });
    const reqRow = await prisma.clientRequest.create({
      data: {
        requestedById: req.user.id,
        clientName: String(clientName).trim(),
        agencyId: agencyId ? parseInt(agencyId) : null,
        notes: notes ? String(notes).slice(0, 500) : null,
      },
    });
    await notifyAdmins('CLIENT_REQUEST', 'New client requested', `${req.user.name} requested client "${reqRow.clientName}".`, '/admin');
    return res.status(201).json({ request: reqRow });
  } catch (error) {
    console.error('requestClient error:', error);
    return res.status(500).json({ error: 'Failed to submit request', detail: error.message });
  }
}

export async function requestChannel(req, res) {
  try {
    const { channelName, category, notes } = req.body;
    const VALID = ['TV', 'RADIO', 'PRINT', 'DIGITAL', 'CINEMA', 'OOH'];
    if (!channelName || !String(channelName).trim()) return res.status(400).json({ error: 'Channel name is required' });
    if (!VALID.includes(category)) return res.status(400).json({ error: 'A valid category is required' });
    const reqRow = await prisma.channelRequest.create({
      data: {
        requestedById: req.user.id,
        channelName: String(channelName).trim(),
        category,
        notes: notes ? String(notes).slice(0, 500) : null,
      },
    });
    await notifyAdmins('CHANNEL_REQUEST', 'New channel requested', `${req.user.name} requested channel "${reqRow.channelName}" (${category}).`, '/admin');
    return res.status(201).json({ request: reqRow });
  } catch (error) {
    console.error('requestChannel error:', error);
    return res.status(500).json({ error: 'Failed to submit request', detail: error.message });
  }
}

// Read-only history for admins/managers.
export async function forecastHistory(req, res) {
  try {
    const user = req.user;
    const clientId = parseInt(req.query.clientId);
    if (!Number.isInteger(clientId)) return res.status(400).json({ error: 'clientId is required' });
    if (user.role === 'MANAGER') {
      const ids = await getAccessibleClientIds(user.id, 'MANAGER');
      if (!ids.includes(clientId)) return res.status(403).json({ error: 'No access to this client' });
    }
    const where = { clientId };
    if (req.query.year) where.year = parseInt(req.query.year);
    const rows = await prisma.monthlyForecast.findMany({
      where,
      include: { channelMaster: { select: { name: true, medium: true } } },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
    return res.json({
      items: rows.map(r => ({
        year: r.year,
        month: r.month,
        channel: r.channelMaster?.name || '',
        medium: r.channelMaster?.medium || '',
        amountMillions: Number(r.amountMillions),
        notes: r.notes || '',
        submittedAt: r.submittedAt,
      })),
    });
  } catch (error) {
    console.error('forecastHistory error:', error);
    return res.status(500).json({ error: 'Failed to load forecast history', detail: error.message });
  }
}

// ── Overall Budget worksheet ─────────────────────────────────────────────────
// Same roster + month-rollover rules as forecasting. One row per roster client
// for the resolved month: "Actual" is derived live from that client's
// MonthlyForecast total (→ full LKR), plus the group-head-entered Best and
// Billing-last-month figures and the client's commission setting (from Admin).

export async function listBudget(req, res) {
  try {
    const user = req.user;
    const ids = await accessibleClientIds(user);
    // SUPER_ADMIN sees every active client; MANAGER (read-only) sees every active
    // client in their agencies (scoped by `ids`); GROUP_HEAD/PLANNER only their roster.
    const where = { isActive: true };
    if (user.role === 'GROUP_HEAD' || user.role === 'PLANNER') where.OR = GROUP_HEAD_CLIENT_OR;
    if (ids) where.id = { in: ids };
    if (req.query.agencyId) where.agencyId = parseInt(req.query.agencyId);

    const clients = await prisma.client.findMany({
      where,
      select: { id: true, name: true, commissionType: true, commissionValue: true, agency: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });
    const clientIds = clients.map(c => c.id);
    const { year, month } = resolveTargetMonth(req);

    const [forecastRows, budgetRows] = await Promise.all([
      prisma.monthlyForecast.groupBy({ by: ['clientId'], where: { year, month, clientId: { in: clientIds } }, _sum: { amountMillions: true } }),
      prisma.monthlyBudget.findMany({ where: { year, month, clientId: { in: clientIds } } }),
    ]);
    // Forecast amounts are stored in millions; Actual is shown in full LKR.
    const actualByClient = new Map(forecastRows.map(r => [r.clientId, (Number(r._sum.amountMillions) || 0) * 1e6]));
    const budgetByClient = new Map(budgetRows.map(b => [b.clientId, b]));

    const rows = clients.map(c => {
      const b = budgetByClient.get(c.id);
      return {
        clientId: c.id,
        clientName: c.name,
        agencyId: c.agency?.id || null,
        agencyName: c.agency?.name || '',
        actualAmount: Number((actualByClient.get(c.id) || 0).toFixed(2)),
        bestAmount: b?.bestAmount != null ? Number(b.bestAmount) : null,
        billingLastMonth: b?.billingLastMonth != null ? Number(b.billingLastMonth) : null,
        commissionType: c.commissionType || null,
        commissionValue: c.commissionValue == null ? null : Number(c.commissionValue),
      };
    });

    const totals = rows.reduce((t, r) => ({
      actual: t.actual + (r.actualAmount || 0),
      best: t.best + (r.bestAmount || 0),
      billing: t.billing + (r.billingLastMonth || 0),
    }), { actual: 0, best: 0, billing: 0 });

    // Channel roll-up (with media group) + per-(manager, client, channel) detail
    // matrix, so the Overall Budget export can add "By Channel" + "Account Manager
    // Detail" sheets. Same client scope as the worksheet above.
    const amMap = await accountManagerByClient(clientIds);
    const clientNameById = new Map(clients.map(c => [c.id, c.name]));
    const { detail, byChannel } = await buildForecastBudgetDetail({ year, month, clientId: { in: clientIds } }, amMap, clientNameById);
    const channelTotalAmount = byChannel.reduce((s, r) => s + r.forecastAmount, 0);

    return res.json({
      year,
      month,
      rows,
      totals: {
        actualAmount: Number(totals.actual.toFixed(2)),
        bestAmount: Number(totals.best.toFixed(2)),
        billingLastMonth: Number(totals.billing.toFixed(2)),
      },
      byChannel,
      channelTotalAmount: Number(channelTotalAmount.toFixed(2)),
      detail,
    });
  } catch (error) {
    console.error('listBudget error:', error);
    return res.status(500).json({ error: 'Failed to load budget', detail: error.message });
  }
}

// Save a client's Best / Billing-last-month for a month. Group heads: upcoming
// month + own clients only (admins any). Clearing both removes the row.
export async function submitBudget(req, res) {
  try {
    const user = req.user;
    const { clientId, year, month, bestAmount, billingLastMonth } = req.body;
    const cid = parseInt(clientId);
    const y = parseInt(year);
    const m = parseInt(month);
    if (!Number.isInteger(cid) || !Number.isInteger(y) || !(m >= 1 && m <= 12)) {
      return res.status(400).json({ error: 'clientId, year and month are required' });
    }
    const ids = await accessibleClientIds(user);
    if (ids && !ids.includes(cid)) return res.status(403).json({ error: 'You do not have access to this client' });

    const client = await prisma.client.findUnique({ where: { id: cid }, select: { id: true, agencyId: true, isActive: true } });
    if (!client || !client.isActive) return res.status(404).json({ error: 'Client not found or inactive' });

    // Group heads may only submit the upcoming month.
    const nm = nextMonth();
    if (user.role !== 'SUPER_ADMIN' && (y !== nm.year || m !== nm.month)) {
      return res.status(403).json({ error: "You can only submit the upcoming month's budget" });
    }

    const parseAmt = (v) => {
      if (v == null || v === '') return null;
      const n = parseFloat(v);
      return Number.isNaN(n) || n < 0 ? null : n;
    };
    const best = parseAmt(bestAmount);
    const billing = parseAmt(billingLastMonth);

    if (best == null && billing == null) {
      await prisma.monthlyBudget.deleteMany({ where: { year: y, month: m, clientId: cid } });
      return res.json({ message: 'Budget cleared' });
    }

    const row = await prisma.monthlyBudget.upsert({
      where: { year_month_clientId: { year: y, month: m, clientId: cid } },
      update: { bestAmount: best, billingLastMonth: billing, submittedById: user.id, agencyId: client.agencyId },
      create: { year: y, month: m, clientId: cid, agencyId: client.agencyId, bestAmount: best, billingLastMonth: billing, submittedById: user.id },
    });
    return res.json({
      message: 'Budget saved',
      budget: {
        clientId: cid,
        bestAmount: row.bestAmount == null ? null : Number(row.bestAmount),
        billingLastMonth: row.billingLastMonth == null ? null : Number(row.billingLastMonth),
      },
    });
  } catch (error) {
    console.error('submitBudget error:', error);
    return res.status(500).json({ error: 'Failed to save budget', detail: error.message });
  }
}
