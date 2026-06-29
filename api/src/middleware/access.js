import prisma from '../utils/prisma.js';

export async function checkChannelAccess(req, res, next) {
  try {
    const channelId = parseInt(req.params.channelId || req.params.id);
    const user = req.user;

    if (user.role === 'SUPER_ADMIN') return next();

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { clientId: true, client: { select: { agencyId: true } } },
    });
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    if (user.role === 'MANAGER') {
      const access = await prisma.userAgencyAccess.findUnique({
        where: { userId_agencyId: { userId: user.id, agencyId: channel.client.agencyId } },
      });
      if (access) return next();
    }

    if (user.role === 'GROUP_HEAD') {
      const teams = await prisma.teamMember.findMany({ where: { userId: user.id }, select: { teamId: true } });
      if (teams.length > 0) {
        const tc = await prisma.teamClient.findFirst({ where: { teamId: { in: teams.map(t => t.teamId) }, clientId: channel.clientId } });
        if (tc) return next();
      }
    }

    const clientAccess = await prisma.userClientAccess.findUnique({
      where: { userId_clientId: { userId: user.id, clientId: channel.clientId } },
    });
    if (clientAccess) return next();

    return res.status(403).json({ error: 'You do not have access to this channel' });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to check channel access' });
  }
}

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

    const cid = parseInt(clientId);
    const client = await prisma.client.findUnique({
      where: { id: cid },
      select: { id: true, agencyId: true },
    });

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // MANAGER: check agency-level access
    if (user.role === 'MANAGER') {
      const agencyAccess = await prisma.userAgencyAccess.findUnique({
        where: { userId_agencyId: { userId: user.id, agencyId: client.agencyId } },
      });
      if (agencyAccess) return next();
    }

    // GROUP_HEAD: check team-level access (must have team assigned to this client)
    if (user.role === 'GROUP_HEAD') {
      const teams = await prisma.teamMember.findMany({
        where: { userId: user.id },
        select: { teamId: true },
      });
      const teamIds = teams.map(t => t.teamId);
      if (teamIds.length > 0) {
        const teamClient = await prisma.teamClient.findFirst({
          where: { teamId: { in: teamIds }, clientId: cid },
        });
        if (teamClient) return next();
      }
    }

    // PLANNER: check direct client access
    const clientAccess = await prisma.userClientAccess.findUnique({
      where: { userId_clientId: { userId: user.id, clientId: cid } },
    });

    if (!clientAccess) {
      return res.status(403).json({ error: 'You do not have access to this client' });
    }

    next();
  } catch (error) {
    return res.status(500).json({ error: 'Failed to check client access' });
  }
}

// Used by the per-channel Add Deal feature (ChannelClientDeal id-scoped routes
// have no clientId in the URL) — resolve the deal's clientId, then delegate to
// the normal client-access check.
export async function checkChannelClientDealAccess(req, res, next) {
  try {
    const deal = await prisma.channelClientDeal.findUnique({
      where: { id: parseInt(req.params.id) },
      select: { clientId: true },
    });
    if (!deal) return res.status(404).json({ error: 'Deal not found' });

    req.params.clientId = String(deal.clientId);
    return checkClientAccess(req, res, next);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to check deal access' });
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

  const allClientIds = new Set();

  // MANAGER: gets all clients from assigned agencies
  if (role === 'MANAGER') {
    const agencyAccess = await prisma.userAgencyAccess.findMany({
      where: { userId },
      select: { agencyId: true },
    });
    if (agencyAccess.length > 0) {
      const clientsFromAgencies = await prisma.client.findMany({
        where: { agencyId: { in: agencyAccess.map(a => a.agencyId) } },
        select: { id: true },
      });
      clientsFromAgencies.forEach(c => allClientIds.add(c.id));
    }
  }

  // GROUP_HEAD: gets clients from their team assignments
  if (role === 'GROUP_HEAD') {
    const teams = await prisma.teamMember.findMany({
      where: { userId },
      select: { teamId: true },
    });
    if (teams.length > 0) {
      const teamClients = await prisma.teamClient.findMany({
        where: { teamId: { in: teams.map(t => t.teamId) } },
        select: { clientId: true },
      });
      teamClients.forEach(tc => allClientIds.add(tc.clientId));
    }
  }

  // PLANNER (direct only) and GROUP_HEAD (direct, on top of team clients):
  // honour client assignments made directly in Admin → Users.
  if (role === 'PLANNER' || role === 'GROUP_HEAD') {
    const directAccess = await prisma.userClientAccess.findMany({
      where: { userId },
      select: { clientId: true },
    });
    directAccess.forEach(a => allClientIds.add(a.clientId));
  }

  return Array.from(allClientIds);
}
