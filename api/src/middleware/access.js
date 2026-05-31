import prisma from '../utils/prisma.js';

export async function checkAgencyAccess(req, res, next) {
  try {
    const { agencyId } = req.params;
    const user = req.user;

    if (user.role === 'SUPER_ADMIN') {
      return next();
    }

    const access = await prisma.userAgencyAccess.findUnique({
      where: {
        userId_agencyId: {
          userId: user.id,
          agencyId: parseInt(agencyId),
        },
      },
    });

    if (!access) {
      return res.status(403).json({ error: 'You do not have access to this agency' });
    }

    next();
  } catch (error) {
    return res.status(500).json({ error: 'Failed to check agency access' });
  }
}

export async function checkClientAccess(req, res, next) {
  try {
    const { clientId } = req.params;
    const user = req.user;

    if (user.role === 'SUPER_ADMIN') {
      return next();
    }

    const client = await prisma.client.findUnique({
      where: { id: parseInt(clientId) },
      include: { agency: true },
    });

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    if (user.role === 'MANAGER' || user.role === 'GROUP_HEAD') {
      const agencyAccess = await prisma.userAgencyAccess.findUnique({
        where: {
          userId_agencyId: {
            userId: user.id,
            agencyId: client.agencyId,
          },
        },
      });

      if (agencyAccess) {
        return next();
      }
    }

    const clientAccess = await prisma.userClientAccess.findUnique({
      where: {
        userId_clientId: {
          userId: user.id,
          clientId: parseInt(clientId),
        },
      },
    });

    if (!clientAccess) {
      return res.status(403).json({ error: 'You do not have access to this client' });
    }

    next();
  } catch (error) {
    return res.status(500).json({ error: 'Failed to check client access' });
  }
}

export async function getAccessibleAgencyIds(userId, role) {
  if (role === 'SUPER_ADMIN') {
    const agencies = await prisma.agency.findMany({ select: { id: true } });
    return agencies.map((a) => a.id);
  }

  const access = await prisma.userAgencyAccess.findMany({
    where: { userId },
    select: { agencyId: true },
  });

  return access.map((a) => a.agencyId);
}

export async function getAccessibleClientIds(userId, role) {
  if (role === 'SUPER_ADMIN') {
    const clients = await prisma.client.findMany({ select: { id: true } });
    return clients.map((c) => c.id);
  }

  // Get clients from agency access
  const agencyAccess = await prisma.userAgencyAccess.findMany({
    where: { userId },
    select: { agencyId: true },
  });

  const agencyIds = agencyAccess.map((a) => a.agencyId);

  const clientsFromAgencies = await prisma.client.findMany({
    where: { agencyId: { in: agencyIds } },
    select: { id: true },
  });

  // Get clients from direct client access
  const directAccess = await prisma.userClientAccess.findMany({
    where: { userId },
    select: { clientId: true },
  });

  const allClientIds = new Set([
    ...clientsFromAgencies.map((c) => c.id),
    ...directAccess.map((a) => a.clientId),
  ]);

  return Array.from(allClientIds);
}
