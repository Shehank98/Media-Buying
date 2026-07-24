import prisma from '../utils/prisma.js';
import { getAccessibleClientIds } from '../middleware/access.js';

const currentYear = () => new Date().getFullYear();

// ─── Admin (SUPER_ADMIN) ──────────────────────────────────────────────────────

// List client groups (optionally for one agency), each with its clients and the
// target for the requested year. Used by the Admin management tab.
export async function listClientGroups(req, res) {
  try {
    const year = parseInt(req.query.year) || currentYear();
    const where = {};
    if (req.query.agencyId) where.agencyId = parseInt(req.query.agencyId);

    const groups = await prisma.clientGroup.findMany({
      where,
      include: {
        agency: { select: { id: true, name: true } },
        clients: { select: { id: true, name: true }, orderBy: { name: 'asc' } },
        targets: { where: { year }, select: { amount: true, year: true } },
      },
      orderBy: [{ agency: { name: 'asc' } }, { name: 'asc' }],
    });

    return res.json({
      year,
      groups: groups.map((g) => ({
        id: g.id,
        name: g.name,
        agencyId: g.agencyId,
        agencyName: g.agency?.name || '',
        clients: g.clients,
        clientCount: g.clients.length,
        target: g.targets[0] ? Number(g.targets[0].amount) : null,
      })),
    });
  } catch (error) {
    console.error('listClientGroups error:', error);
    return res.status(500).json({ error: 'Failed to load client groups' });
  }
}

export async function createClientGroup(req, res) {
  try {
    const { agencyId, name } = req.body || {};
    if (!agencyId || !name || !String(name).trim()) {
      return res.status(400).json({ error: 'agencyId and name are required' });
    }
    const group = await prisma.clientGroup.create({
      data: { agencyId: parseInt(agencyId), name: String(name).trim() },
    });
    return res.status(201).json(group);
  } catch (error) {
    if (error.code === 'P2002') return res.status(409).json({ error: 'A group with this name already exists in this agency' });
    console.error('createClientGroup error:', error);
    return res.status(500).json({ error: 'Failed to create client group' });
  }
}

export async function updateClientGroup(req, res) {
  try {
    const id = parseInt(req.params.id);
    const { name } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
    const group = await prisma.clientGroup.update({ where: { id }, data: { name: String(name).trim() } });
    return res.json(group);
  } catch (error) {
    if (error.code === 'P2002') return res.status(409).json({ error: 'A group with this name already exists in this agency' });
    console.error('updateClientGroup error:', error);
    return res.status(500).json({ error: 'Failed to update client group' });
  }
}

// Delete a group. Its clients are detached (clientGroupId -> null) automatically
// by the ON DELETE SET NULL FK, so no client data is lost.
export async function deleteClientGroup(req, res) {
  try {
    await prisma.clientGroup.delete({ where: { id: parseInt(req.params.id) } });
    return res.json({ ok: true });
  } catch (error) {
    console.error('deleteClientGroup error:', error);
    return res.status(500).json({ error: 'Failed to delete client group' });
  }
}

// Set the exact client membership of a group (full replace). A client belongs to
// at most one group, so assigning here detaches it from any other group. Only
// clients in the group's own agency may join.
export async function setGroupClients(req, res) {
  try {
    const id = parseInt(req.params.id);
    const clientIds = Array.isArray(req.body?.clientIds) ? req.body.clientIds.map(Number).filter(Number.isInteger) : [];

    const group = await prisma.clientGroup.findUnique({ where: { id } });
    if (!group) return res.status(404).json({ error: 'Group not found' });

    // Guard: every requested client must be in this group's agency.
    if (clientIds.length) {
      const valid = await prisma.client.count({ where: { id: { in: clientIds }, agencyId: group.agencyId } });
      if (valid !== clientIds.length) return res.status(400).json({ error: 'All clients must belong to this group\'s agency' });
    }

    await prisma.$transaction([
      // Detach clients currently in this group that are no longer selected.
      prisma.client.updateMany({ where: { clientGroupId: id, id: { notIn: clientIds.length ? clientIds : [-1] } }, data: { clientGroupId: null } }),
      // Attach the selected clients (moves them off any other group).
      prisma.client.updateMany({ where: { id: { in: clientIds.length ? clientIds : [-1] } }, data: { clientGroupId: id } }),
    ]);

    return res.json({ ok: true, count: clientIds.length });
  } catch (error) {
    console.error('setGroupClients error:', error);
    return res.status(500).json({ error: 'Failed to update group clients' });
  }
}

// Upsert (or clear) a group's annual target. amount null/blank deletes the row.
export async function setGroupTarget(req, res) {
  try {
    const id = parseInt(req.params.id);
    const year = parseInt(req.body?.year) || currentYear();
    const raw = req.body?.amount;
    const amount = raw === '' || raw == null ? null : Number(raw);

    if (amount === null) {
      await prisma.clientGroupTarget.deleteMany({ where: { groupId: id, year } });
      return res.json({ ok: true, cleared: true });
    }
    if (!(amount >= 0)) return res.status(400).json({ error: 'amount must be a non-negative number' });

    const row = await prisma.clientGroupTarget.upsert({
      where: { groupId_year: { groupId: id, year } },
      create: { groupId: id, year, amount, createdById: req.user?.id || null },
      update: { amount },
    });
    return res.json({ ok: true, target: Number(row.amount), year });
  } catch (error) {
    console.error('setGroupTarget error:', error);
    return res.status(500).json({ error: 'Failed to set group target' });
  }
}

// ─── Agency view (any role with agency access) ────────────────────────────────

// Parent-company rollup for an agency: each group with its annual target and the
// summed actual spend (schedule value) of its sub-clients for the year, plus the
// per-client breakdown. Scoped to the caller's accessible clients so a MANAGER
// only ever sees their own agency's clients. Not forecast-related, spend only.
export async function getAgencyGroups(req, res) {
  try {
    const agencyId = parseInt(req.params.agencyId);
    const year = parseInt(req.query.year) || currentYear();
    const accessibleIds = await getAccessibleClientIds(req.user.id, req.user.role);
    const accessSet = new Set(accessibleIds);

    const groups = await prisma.clientGroup.findMany({
      where: { agencyId },
      include: {
        clients: { select: { id: true, name: true }, orderBy: { name: 'asc' } },
        targets: { where: { year }, select: { amount: true } },
      },
      orderBy: { name: 'asc' },
    });

    // Year-scoped spend per client (Jan to Dec of `year`), so it lines up with the
    // annual target. scheduleMonth is a 'YYYY-MM' string.
    const clientIdsInGroups = [];
    for (const g of groups) for (const c of g.clients) if (accessSet.has(c.id)) clientIdsInGroups.push(c.id);

    const spendMap = {};
    if (clientIdsInGroups.length) {
      const rows = await prisma.scheduleLog.groupBy({
        by: ['clientId'],
        where: { clientId: { in: clientIdsInGroups }, isDeleted: false, scheduleMonth: { gte: `${year}-01`, lte: `${year}-12` } },
        _sum: { scheduleValue: true },
      });
      rows.forEach((r) => { spendMap[r.clientId] = Number(r._sum.scheduleValue) || 0; });
    }

    const result = groups.map((g) => {
      const clients = g.clients
        .filter((c) => accessSet.has(c.id))
        .map((c) => ({ id: c.id, name: c.name, spend: spendMap[c.id] || 0 }));
      const spend = clients.reduce((s, c) => s + c.spend, 0);
      const target = g.targets[0] ? Number(g.targets[0].amount) : null;
      return {
        id: g.id,
        name: g.name,
        target,
        spend,
        achievementPct: target && target > 0 ? Number(((spend / target) * 100).toFixed(1)) : null,
        clients,
        clientCount: clients.length,
      };
    })
    // Hide groups the caller has no visible clients in (and no target to show).
    .filter((g) => g.clientCount > 0 || g.target != null);

    return res.json({ year, groups: result });
  } catch (error) {
    console.error('getAgencyGroups error:', error);
    return res.status(500).json({ error: 'Failed to load agency client groups' });
  }
}

// Aggregated dashboard overview for a parent company: same shape as the client
// overview (getClientOverview) but summed across the group's accessible clients,
// with an optional ?clientId= to narrow to a single member. Returns the member
// list for the dashboard's client filter. Access-scoped so a MANAGER only sees
// their agency's clients.
export async function getClientGroupOverview(req, res) {
  try {
    const groupId = parseInt(req.params.groupId);
    const group = await prisma.clientGroup.findUnique({
      where: { id: groupId },
      include: {
        agency: { select: { id: true, name: true } },
        clients: { select: { id: true, name: true }, orderBy: { name: 'asc' } },
      },
    });
    if (!group) return res.status(404).json({ error: 'Client group not found' });

    const accessibleIds = await getAccessibleClientIds(req.user.id, req.user.role);
    const accessSet = new Set(accessibleIds);
    const visibleClients = group.clients.filter((c) => accessSet.has(c.id));
    if (visibleClients.length === 0) return res.status(403).json({ error: 'No access to this group' });

    // Optional single-client filter (must be a member the caller can see).
    const filterClientId = req.query.clientId ? parseInt(req.query.clientId) : null;
    if (filterClientId && !visibleClients.some((c) => c.id === filterClientId)) {
      return res.status(403).json({ error: 'No access to this client' });
    }
    const scopeIds = filterClientId ? [filterClientId] : visibleClients.map((c) => c.id);

    const logs = await prisma.scheduleLog.findMany({
      where: { clientId: { in: scopeIds }, isDeleted: false },
      select: {
        scheduleMonth: true, scheduleValue: true, scheduleValueWithVat: true,
        medium: true, brandName: true,
        channelMaster: { select: { id: true, name: true, medium: true } },
      },
    });

    let total = 0, totalVat = 0;
    const byMonth = {}, byChannel = {}, byMedium = {}, byBrand = {};
    const months = new Set();
    for (const l of logs) {
      const v = Number(l.scheduleValue) || 0;
      total += v; totalVat += Number(l.scheduleValueWithVat) || 0;
      const m = l.scheduleMonth;
      if (/^\d{4}-\d{2}$/.test(m)) { months.add(m); (byMonth[m] ||= { month: m, value: 0, count: 0 }).value += v; byMonth[m].count++; }
      const ch = l.channelMaster?.name || 'Unknown';
      (byChannel[ch] ||= { id: l.channelMaster?.id || null, name: ch, medium: l.channelMaster?.medium || l.medium, value: 0, count: 0 }).value += v; byChannel[ch].count++;
      const med = l.medium || 'Unknown';
      (byMedium[med] ||= { name: med, value: 0 }).value += v;
      const br = l.brandName || 'Unbranded';
      (byBrand[br] ||= { name: br, value: 0, count: 0 }).value += v; byBrand[br].count++;
    }
    const sortedMonths = [...months].sort();

    return res.json({
      group: { id: group.id, name: group.name, agencyId: group.agency?.id, agencyName: group.agency?.name },
      clients: visibleClients,
      filterClientId,
      totalValue: Math.round(total),
      totalWithVat: Math.round(totalVat),
      totalEntries: logs.length,
      firstMonth: sortedMonths[0] || null,
      lastMonth: sortedMonths[sortedMonths.length - 1] || null,
      monthsActive: sortedMonths.length,
      channelCount: Object.keys(byChannel).length,
      brandCount: Object.keys(byBrand).filter((b) => b !== 'Unbranded').length,
      byMonth: Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month)),
      byChannel: Object.values(byChannel).sort((a, b) => b.value - a.value),
      byMedium: Object.values(byMedium).sort((a, b) => b.value - a.value),
      byBrand: Object.values(byBrand).sort((a, b) => b.value - a.value),
    });
  } catch (error) {
    console.error('getClientGroupOverview error:', error);
    return res.status(500).json({ error: 'Failed to load group overview' });
  }
}
