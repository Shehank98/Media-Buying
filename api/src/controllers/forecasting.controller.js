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

// Active channels grouped by medium (category), ordered by sortOrder then name.
export async function listForecastChannels(req, res) {
  try {
    const channels = await prisma.channelMaster.findMany({
      where: { isActive: true },
      select: { id: true, name: true, medium: true, sortOrder: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const groups = {};
    for (const ch of channels) (groups[ch.medium] ||= []).push({ id: ch.id, name: ch.name });
    const categories = MEDIUM_ORDER
      .filter(m => groups[m]?.length)
      .map(m => ({ category: m, channels: groups[m] }));
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
