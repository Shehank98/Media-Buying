import prisma from '../utils/prisma.js';
import { getAccessibleAgencyIds, getAccessibleClientIds } from '../middleware/access.js';

export async function list(req, res) {
  try {
    const agencyIds = await getAccessibleAgencyIds(req.user.id, req.user.role);

    const agencies = await prisma.agency.findMany({
      where: { id: { in: agencyIds } },
      include: { _count: { select: { clients: true } } },
      orderBy: { name: 'asc' },
    });

    return res.json(agencies);
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

    return res.json(clients);
  } catch (error) {
    console.error('Get clients error:', error);
    return res.status(500).json({ error: 'Failed to get clients' });
  }
}
