import prisma from '../utils/prisma.js';
import { getAccessibleClientIds } from '../middleware/access.js';

const MEDIUM_ORDER = ['TV', 'RADIO', 'PRINT', 'CINEMA', 'OOH', 'DIGITAL'];

// Next calendar month — group heads forecast the upcoming month only.
function nextMonth() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

// Client ids the caller may access (null = unrestricted, for SUPER_ADMIN).
async function accessibleClientIds(user) {
  if (user.role === 'SUPER_ADMIN') return null;
  return getAccessibleClientIds(user.id, user.role);
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

// Active clients the caller can forecast for, each with next-month status.
export async function listForecastClients(req, res) {
  try {
    const user = req.user;
    const ids = await accessibleClientIds(user);
    const where = { isActive: true };
    if (ids) where.id = { in: ids };
    if (req.query.agencyId) where.agencyId = parseInt(req.query.agencyId);

    const clients = await prisma.client.findMany({
      where,
      select: { id: true, name: true, agency: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });

    const { year, month } = nextMonth();
    const submitted = await prisma.monthlyForecast.findMany({
      where: { year, month, clientId: { in: clients.map(c => c.id) } },
      select: { clientId: true },
      distinct: ['clientId'],
    });
    const submittedSet = new Set(submitted.map(s => s.clientId));

    return res.json({
      year,
      month,
      clients: clients.map(c => ({
        id: c.id,
        name: c.name,
        agencyId: c.agency?.id,
        agencyName: c.agency?.name || '',
        status: submittedSet.has(c.id) ? 'submitted' : 'pending',
      })),
    });
  } catch (error) {
    console.error('listForecastClients error:', error);
    return res.status(500).json({ error: 'Failed to load forecasting clients', detail: error.message });
  }
}

// Categories that list every channel individually; the rest take a single total.
const FULL_LIST_MEDIA = ['TV', 'RADIO'];
const TOTAL_LABEL = { PRINT: 'Print', CINEMA: 'Cinema', OOH: 'OOH', DIGITAL: 'Digital' };

// Channels for the forecast entry table. TV & Radio list every channel; Print,
// Cinema, OOH and Digital collapse to a single "<category> total" bucket row.
export async function listForecastChannels(req, res) {
  try {
    const channels = await prisma.channelMaster.findMany({
      where: { isActive: true },
      select: { id: true, name: true, medium: true, sortOrder: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const groups = {};
    for (const ch of channels) (groups[ch.medium] ||= []).push(ch);
    const categories = [];
    for (const m of MEDIUM_ORDER) {
      const list = groups[m];
      if (!list || !list.length) continue;
      if (FULL_LIST_MEDIA.includes(m)) {
        categories.push({ category: m, channels: list.map(c => ({ id: c.id, name: c.name })) });
      } else {
        // One total bucket for the category (the seeded channel named after it).
        const label = TOTAL_LABEL[m] || m;
        const bucket = list.find(c => c.name.toLowerCase() === label.toLowerCase()) || list[0];
        categories.push({ category: m, total: true, channels: [{ id: bucket.id, name: `${label} total` }] });
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

    const { year, month } = nextMonth();
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

// The most recent forecast a client has BEFORE the upcoming month — used to
// pre-fill ("copy last month") so heads don't re-enter everything.
export async function getPreviousForecast(req, res) {
  try {
    const user = req.user;
    const clientId = parseInt(req.query.clientId);
    if (!Number.isInteger(clientId)) return res.status(400).json({ error: 'clientId is required' });
    const ids = await accessibleClientIds(user);
    if (ids && !ids.includes(clientId)) return res.status(403).json({ error: 'No access to this client' });

    const { year, month } = nextMonth();
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
