import prisma from '../utils/prisma.js';
import { getAccessibleAgencyIds, getAccessibleClientIds } from '../middleware/access.js';

export async function getOne(req, res) {
  try {
    const agency = await prisma.agency.findUnique({
      where: { id: parseInt(req.params.agencyId) },
      include: { _count: { select: { clients: true } } },
    });
    if (!agency) return res.status(404).json({ error: 'Agency not found' });
    return res.json({ agency });
  } catch (error) {
    console.error('Get agency error:', error);
    return res.status(500).json({ error: 'Failed to get agency' });
  }
}

export async function createClient(req, res) {
  try {
    const { agencyId } = req.params;
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Client name is required' });
    const client = await prisma.client.create({
      data: { agencyId: parseInt(agencyId), name },
      include: { _count: { select: { channels: true } } },
    });
    return res.status(201).json({ client });
  } catch (error) {
    if (error.code === 'P2002') return res.status(409).json({ error: 'A client with this name already exists in this agency' });
    console.error('Create client error:', error);
    return res.status(500).json({ error: 'Failed to create client' });
  }
}

export async function list(req, res) {
  try {
    const agencyIds = await getAccessibleAgencyIds(req.user.id, req.user.role);
    // Scope the client count + spend to the clients THIS user can access, so a
    // group head/planner with 2 clients in an agency sees only those 2 clients'
    // spend (not the whole agency's). SUPER_ADMIN/MANAGER get all their clients.
    const clientIds = await getAccessibleClientIds(req.user.id, req.user.role);

    const agencies = await prisma.agency.findMany({
      where: { id: { in: agencyIds } },
      orderBy: { name: 'asc' },
    });

    const [accessibleClients, spendRows] = await Promise.all([
      clientIds.length
        ? prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, agencyId: true } })
        : [],
      clientIds.length
        ? prisma.scheduleLog.groupBy({
            by: ['agencyId'],
            where: { clientId: { in: clientIds }, isDeleted: false },
            _sum: { scheduleValue: true },
          })
        : [],
    ]);

    const clientCountMap = {};
    accessibleClients.forEach((c) => { clientCountMap[c.agencyId] = (clientCountMap[c.agencyId] || 0) + 1; });
    const spendMap = {};
    spendRows.forEach((r) => { spendMap[r.agencyId] = Number(r._sum.scheduleValue) || 0; });

    const result = agencies.map((a) => ({
      ...a,
      _count: { clients: clientCountMap[a.id] || 0 },
      totalSpend: spendMap[a.id] || 0,
    }));

    return res.json(result);
  } catch (error) {
    console.error('List agencies error:', error);
    return res.status(500).json({ error: 'Failed to list agencies' });
  }
}

export async function getClients(req, res) {
  try {
    const { agencyId } = req.params;
    const accessibleClientIds = await getAccessibleClientIds(req.user.id, req.user.role);

    const clients = await prisma.client.findMany({
      where: {
        agencyId: parseInt(agencyId),
        id: { in: accessibleClientIds },
      },
      include: { _count: { select: { channels: true } } },
      orderBy: { name: 'asc' },
    });

    // Total spend (all-time schedule value) per client.
    const ids = clients.map((c) => c.id);
    const spendRows = ids.length
      ? await prisma.scheduleLog.groupBy({ by: ['clientId'], where: { clientId: { in: ids }, isDeleted: false }, _sum: { scheduleValue: true } })
      : [];
    const spendMap = {};
    spendRows.forEach((r) => { spendMap[r.clientId] = Number(r._sum.scheduleValue) || 0; });

    return res.json(clients.map((c) => ({ ...c, totalSpend: spendMap[c.id] || 0 })));
  } catch (error) {
    console.error('Get clients error:', error);
    return res.status(500).json({ error: 'Failed to get clients' });
  }
}
