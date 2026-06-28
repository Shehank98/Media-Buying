import prisma from '../utils/prisma.js';
import { hashPassword } from '../services/auth.service.js';
import { sendEmail } from '../services/email.service.js';

const VALID_ROLES = ['SUPER_ADMIN', 'MANAGER', 'GROUP_HEAD', 'PLANNER'];

// ── shared include/map helpers ──

const teamIncludes = {
  agency: { select: { id: true, name: true } },
  head: { select: { id: true, name: true, email: true, role: true } },
  members: { include: { user: { select: { id: true, name: true, email: true, role: true } } } },
  clients: { include: { client: { select: { id: true, name: true } } } },
};

function mapTeam(t) {
  return {
    ...t,
    members: t.members.map(m => ({ id: m.user.id, name: m.user.name, email: m.user.email, role: m.user.role })),
    clients: t.clients.map(c => c.client),
  };
}

// Each client has exactly one team head, so a client can belong to at most one
// team at a time: clear any other team's claim on these clients before assigning.
async function setTeamClients(teamId, clientIds) {
  const ids = clientIds.map(Number);
  await prisma.teamClient.deleteMany({ where: { teamId } });
  if (ids.length > 0) {
    await prisma.teamClient.deleteMany({ where: { clientId: { in: ids }, teamId: { not: teamId } } });
    await prisma.teamClient.createMany({ data: ids.map(clientId => ({ teamId, clientId })) });
  }
}

// ── Agencies ──

export async function listAgencies(req, res) {
  try {
    const agencies = await prisma.agency.findMany({
      orderBy: { name: 'asc' },
      include: {
        clients: { select: { id: true, name: true, isActive: true, _count: { select: { channels: true } } } },
        _count: { select: { clients: true, users: true } },
      },
    });
    return res.json(agencies);
  } catch (error) {
    console.error('List agencies error:', error);
    return res.status(500).json({ error: 'Failed to list agencies' });
  }
}

export async function createAgency(req, res) {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Agency name is required' });
    const agency = await prisma.agency.create({ data: { name } });
    return res.status(201).json(agency);
  } catch (error) {
    if (error.code === 'P2002') return res.status(409).json({ error: 'Agency with this name already exists' });
    console.error('Create agency error:', error);
    return res.status(500).json({ error: 'Failed to create agency' });
  }
}

export async function updateAgency(req, res) {
  try {
    const { id } = req.params;
    const { name } = req.body;
    const agency = await prisma.agency.update({ where: { id: parseInt(id) }, data: { name } });
    return res.json(agency);
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Agency not found' });
    if (error.code === 'P2002') return res.status(409).json({ error: 'Agency with this name already exists' });
    console.error('Update agency error:', error);
    return res.status(500).json({ error: 'Failed to update agency' });
  }
}

export async function deleteAgency(req, res) {
  try {
    const { id } = req.params;
    await prisma.agency.delete({ where: { id: parseInt(id) } });
    return res.json({ message: 'Agency deleted successfully' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Agency not found' });
    console.error('Delete agency error:', error);
    return res.status(500).json({ error: 'Failed to delete agency' });
  }
}

// ── Users ──

export async function listUsers(req, res) {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        mustChangePassword: true,
        pageAccess: true,
        canExport: true,
        readOnly: true,
        createdAt: true,
        agencyAccess: { include: { agency: { select: { id: true, name: true } } } },
        clientAccess: { include: { client: { select: { id: true, name: true } } } },
      },
      orderBy: { name: 'asc' },
    });
    return res.json(users.map(u => ({
      ...u,
      agencies: u.agencyAccess.map(a => a.agency),
      clients: u.clientAccess.map(c => c.client),
    })));
  } catch (error) {
    console.error('List users error:', error);
    return res.status(500).json({ error: 'Failed to list users' });
  }
}

export async function createUser(req, res) {
  try {
    const { email, name, role, password, agencyIds, clientIds, pageAccess, canExport, readOnly } = req.body;
    if (!email || !name || !role) return res.status(400).json({ error: 'Email, name, and role are required' });
    if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });

    const tempPassword = password || 'TempPass@123';
    const passwordHash = await hashPassword(tempPassword);

    const user = await prisma.user.create({
      data: {
        email, name, role, passwordHash, mustChangePassword: true,
        pageAccess: Array.isArray(pageAccess) ? pageAccess : [],
        canExport: canExport !== false,
        readOnly: !!readOnly,
      },
      select: { id: true, email: true, name: true, role: true, mustChangePassword: true, pageAccess: true, canExport: true, readOnly: true, createdAt: true },
    });

    if (Array.isArray(agencyIds) && agencyIds.length > 0) {
      await prisma.userAgencyAccess.createMany({
        data: agencyIds.map(agencyId => ({ userId: user.id, agencyId: parseInt(agencyId) })),
      });
    }
    if (Array.isArray(clientIds) && clientIds.length > 0) {
      await prisma.userClientAccess.createMany({
        data: clientIds.map(clientId => ({ userId: user.id, clientId: parseInt(clientId) })),
      });
    }

    // Send welcome email (fire-and-forget). FRONTEND_URL may be a
    // comma-separated CORS whitelist, so use the first entry.
    const loginUrl = (process.env.FRONTEND_URL || 'https://media-buying-production.up.railway.app').split(',')[0].trim().replace(/\/+$/, '');
    sendEmail({
      type: 'welcome',
      to: email,
      name,
      password: tempPassword,
      loginUrl,
    }).catch(err => console.error('Welcome email failed:', err));

    return res.status(201).json({ ...user, temporaryPassword: tempPassword, agencies: [], clients: [] });
  } catch (error) {
    if (error.code === 'P2002') return res.status(409).json({ error: 'User with this email already exists' });
    console.error('Create user error:', error);
    return res.status(500).json({ error: 'Failed to create user' });
  }
}

export async function updateUser(req, res) {
  try {
    const { id } = req.params;
    const { name, role, password, agencyIds, clientIds, pageAccess, canExport, readOnly } = req.body;
    const userId = parseInt(id);

    const data = {};
    if (name !== undefined) data.name = name;
    if (role !== undefined) {
      if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
      data.role = role;
    }
    if (password) data.passwordHash = await hashPassword(password);
    if (Array.isArray(pageAccess)) data.pageAccess = pageAccess;
    if (canExport !== undefined) data.canExport = !!canExport;
    if (readOnly !== undefined) data.readOnly = !!readOnly;

    const user = await prisma.user.update({
      where: { id: userId },
      data,
      select: { id: true, email: true, name: true, role: true, mustChangePassword: true, pageAccess: true, canExport: true, readOnly: true, createdAt: true },
    });

    if (Array.isArray(agencyIds)) {
      await prisma.userAgencyAccess.deleteMany({ where: { userId } });
      if (agencyIds.length > 0) {
        await prisma.userAgencyAccess.createMany({
          data: agencyIds.map(agencyId => ({ userId, agencyId: parseInt(agencyId) })),
        });
      }
    }
    if (Array.isArray(clientIds)) {
      await prisma.userClientAccess.deleteMany({ where: { userId } });
      if (clientIds.length > 0) {
        await prisma.userClientAccess.createMany({
          data: clientIds.map(clientId => ({ userId, clientId: parseInt(clientId) })),
        });
      }
    }

    const access = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        agencyAccess: { include: { agency: { select: { id: true, name: true } } } },
        clientAccess: { include: { client: { select: { id: true, name: true } } } },
      },
    });

    return res.json({
      ...user,
      agencies: access.agencyAccess.map(a => a.agency),
      clients: access.clientAccess.map(c => c.client),
    });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'User not found' });
    console.error('Update user error:', error);
    return res.status(500).json({ error: 'Failed to update user' });
  }
}

export async function deleteUser(req, res) {
  try {
    const { id } = req.params;
    await prisma.user.delete({ where: { id: parseInt(id) } });
    return res.json({ message: 'User deleted successfully' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'User not found' });
    console.error('Delete user error:', error);
    return res.status(500).json({ error: 'Failed to delete user' });
  }
}

export async function assignAgencies(req, res) {
  try {
    const userId = parseInt(req.params.id);
    const { agencyIds } = req.body;
    if (!Array.isArray(agencyIds)) return res.status(400).json({ error: 'agencyIds must be an array' });

    await prisma.userAgencyAccess.deleteMany({ where: { userId } });
    if (agencyIds.length > 0) {
      await prisma.userAgencyAccess.createMany({
        data: agencyIds.map(agencyId => ({ userId, agencyId: parseInt(agencyId) })),
      });
    }
    return res.json({ message: 'Agencies assigned' });
  } catch (error) {
    console.error('Assign agencies error:', error);
    return res.status(500).json({ error: 'Failed to assign agencies' });
  }
}

export async function assignClients(req, res) {
  try {
    const userId = parseInt(req.params.id);
    const { clientIds } = req.body;
    if (!Array.isArray(clientIds)) return res.status(400).json({ error: 'clientIds must be an array' });

    await prisma.userClientAccess.deleteMany({ where: { userId } });
    if (clientIds.length > 0) {
      await prisma.userClientAccess.createMany({
        data: clientIds.map(clientId => ({ userId, clientId: parseInt(clientId) })),
      });
    }
    return res.json({ message: 'Clients assigned' });
  } catch (error) {
    console.error('Assign clients error:', error);
    return res.status(500).json({ error: 'Failed to assign clients' });
  }
}

// ── Teams ──

export async function listTeams(req, res) {
  try {
    const { agencyId } = req.query;
    const where = agencyId ? { agencyId: parseInt(agencyId) } : {};
    const teams = await prisma.team.findMany({ where, include: teamIncludes, orderBy: { name: 'asc' } });
    return res.json(teams.map(mapTeam));
  } catch (error) {
    console.error('List teams error:', error);
    return res.status(500).json({ error: 'Failed to list teams' });
  }
}

export async function createTeam(req, res) {
  try {
    const { name, agencyId, headUserId, memberIds, clientIds } = req.body;
    if (!name || !agencyId) return res.status(400).json({ error: 'Name and agencyId are required' });

    const team = await prisma.team.create({
      data: { name, agencyId: parseInt(agencyId), headUserId: headUserId ? parseInt(headUserId) : null },
    });

    if (Array.isArray(memberIds) && memberIds.length > 0) {
      const userRoles = await prisma.user.findMany({
        where: { id: { in: memberIds.map(Number) } },
        select: { id: true, role: true },
      });
      const roleMap = Object.fromEntries(userRoles.map(u => [u.id, u.role]));
      await prisma.teamMember.createMany({
        data: memberIds.map(userId => ({ teamId: team.id, userId: parseInt(userId), role: roleMap[parseInt(userId)] || 'PLANNER' })),
      });
    }
    if (Array.isArray(clientIds) && clientIds.length > 0) {
      await setTeamClients(team.id, clientIds);
    }

    const full = await prisma.team.findUnique({ where: { id: team.id }, include: teamIncludes });
    return res.status(201).json(mapTeam(full));
  } catch (error) {
    if (error.code === 'P2002') return res.status(409).json({ error: 'Team with this name already exists in this agency' });
    console.error('Create team error:', error);
    return res.status(500).json({ error: 'Failed to create team' });
  }
}

export async function updateTeam(req, res) {
  try {
    const teamId = parseInt(req.params.id);
    const { name, agencyId, headUserId, memberIds, clientIds } = req.body;

    const data = {};
    if (name !== undefined) data.name = name;
    if (agencyId !== undefined) data.agencyId = parseInt(agencyId);
    if (headUserId !== undefined) data.headUserId = headUserId ? parseInt(headUserId) : null;

    await prisma.team.update({ where: { id: teamId }, data });

    if (Array.isArray(memberIds)) {
      await prisma.teamMember.deleteMany({ where: { teamId } });
      if (memberIds.length > 0) {
        const userRoles = await prisma.user.findMany({
          where: { id: { in: memberIds.map(Number) } },
          select: { id: true, role: true },
        });
        const roleMap = Object.fromEntries(userRoles.map(u => [u.id, u.role]));
        await prisma.teamMember.createMany({
          data: memberIds.map(userId => ({ teamId, userId: parseInt(userId), role: roleMap[parseInt(userId)] || 'PLANNER' })),
        });
      }
    }
    if (Array.isArray(clientIds)) {
      await setTeamClients(teamId, clientIds);
    }

    const full = await prisma.team.findUnique({ where: { id: teamId }, include: teamIncludes });
    return res.json(mapTeam(full));
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Team not found' });
    console.error('Update team error:', error);
    return res.status(500).json({ error: 'Failed to update team' });
  }
}

export async function deleteTeam(req, res) {
  try {
    const { id } = req.params;
    await prisma.team.delete({ where: { id: parseInt(id) } });
    return res.json({ message: 'Team deleted successfully' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Team not found' });
    console.error('Delete team error:', error);
    return res.status(500).json({ error: 'Failed to delete team' });
  }
}

export async function assignTeamMembers(req, res) {
  try {
    const teamId = parseInt(req.params.id);
    const { memberIds } = req.body;
    if (!Array.isArray(memberIds)) return res.status(400).json({ error: 'memberIds must be an array' });

    await prisma.teamMember.deleteMany({ where: { teamId } });
    if (memberIds.length > 0) {
      const userRoles = await prisma.user.findMany({
        where: { id: { in: memberIds.map(Number) } },
        select: { id: true, role: true },
      });
      const roleMap = Object.fromEntries(userRoles.map(u => [u.id, u.role]));
      await prisma.teamMember.createMany({
        data: memberIds.map(userId => ({ teamId, userId: parseInt(userId), role: roleMap[parseInt(userId)] || 'PLANNER' })),
      });
    }
    return res.json({ message: 'Members assigned' });
  } catch (error) {
    console.error('Assign team members error:', error);
    return res.status(500).json({ error: 'Failed to assign team members' });
  }
}

export async function assignTeamClients(req, res) {
  try {
    const teamId = parseInt(req.params.id);
    const { clientIds } = req.body;
    if (!Array.isArray(clientIds)) return res.status(400).json({ error: 'clientIds must be an array' });

    await setTeamClients(teamId, clientIds);
    return res.json({ message: 'Clients assigned' });
  } catch (error) {
    console.error('Assign team clients error:', error);
    return res.status(500).json({ error: 'Failed to assign team clients' });
  }
}

// ── Channel Masters ──

export async function listChannelMasters(req, res) {
  try {
    const includeInactive = req.query.includeInactive === 'true';
    const where = includeInactive ? {} : { isActive: true };
    const channelMasters = await prisma.channelMaster.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { _count: { select: { scheduleLogs: true } } },
    });
    return res.json({ channelMasters });
  } catch (error) {
    console.error('List channel masters error:', error);
    return res.status(500).json({ error: 'Failed to list channel masters' });
  }
}

export async function createChannelMaster(req, res) {
  try {
    const { name, medium, aliases } = req.body;
    if (!name || !medium) return res.status(400).json({ error: 'Name and medium are required' });
    const cm = await prisma.channelMaster.create({
      data: { name, medium, aliases: Array.isArray(aliases) ? aliases : [] },
    });
    return res.status(201).json({ channelMaster: cm });
  } catch (error) {
    if (error.code === 'P2002') return res.status(409).json({ error: 'Channel master with this name already exists' });
    console.error('Create channel master error:', error);
    return res.status(500).json({ error: 'Failed to create channel master' });
  }
}

export async function updateChannelMaster(req, res) {
  try {
    const { id } = req.params;
    const { name, medium, aliases, isActive } = req.body;
    const data = {};
    if (name !== undefined) data.name = name;
    if (medium !== undefined) data.medium = medium;
    if (aliases !== undefined) data.aliases = Array.isArray(aliases) ? aliases : [];
    if (isActive !== undefined) data.isActive = isActive;
    const cm = await prisma.channelMaster.update({ where: { id: parseInt(id) }, data });
    return res.json({ channelMaster: cm });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Channel master not found' });
    if (error.code === 'P2002') return res.status(409).json({ error: 'Channel master with this name already exists' });
    console.error('Update channel master error:', error);
    return res.status(500).json({ error: 'Failed to update channel master' });
  }
}

export async function deleteChannelMaster(req, res) {
  try {
    const { id } = req.params;
    await prisma.channelMaster.update({ where: { id: parseInt(id) }, data: { isActive: false } });
    return res.json({ message: 'Channel master deactivated' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Channel master not found' });
    console.error('Delete channel master error:', error);
    return res.status(500).json({ error: 'Failed to deactivate channel master' });
  }
}

// ── Annual Targets (forecasting) ─────────────────────────────────────────────

export async function listAnnualTargets(req, res) {
  try {
    const targets = await prisma.annualTarget.findMany({ orderBy: { year: 'desc' } });
    return res.json(targets.map(t => ({ ...t, totalTargetMillions: Number(t.totalTargetMillions) })));
  } catch (error) {
    console.error('List annual targets error:', error);
    return res.status(500).json({ error: 'Failed to list annual targets' });
  }
}

export async function upsertAnnualTarget(req, res) {
  try {
    const { year, totalTargetMillions, remoteMonth } = req.body;
    const y = parseInt(year);
    const total = parseFloat(totalTargetMillions);
    if (!Number.isInteger(y) || y < 2000 || y > 2100) return res.status(400).json({ error: 'A valid year is required' });
    if (Number.isNaN(total) || total < 0) return res.status(400).json({ error: 'A valid target (in millions) is required' });
    // Remote month is optional: blank/0 = auto (dashboard tracks the latest month
    // that has actual data). When given it must be 1–12.
    let rm = null;
    if (remoteMonth !== undefined && remoteMonth !== null && remoteMonth !== '') {
      rm = parseInt(remoteMonth);
      if (!Number.isInteger(rm) || rm < 1 || rm > 12) return res.status(400).json({ error: 'Remote month must be 1–12 (or left blank for auto)' });
    }
    const target = await prisma.annualTarget.upsert({
      where: { year: y },
      update: { totalTargetMillions: total, remoteMonth: rm, createdById: req.user.id },
      create: { year: y, totalTargetMillions: total, remoteMonth: rm, createdById: req.user.id },
    });
    return res.json({ target: { ...target, totalTargetMillions: Number(target.totalTargetMillions) } });
  } catch (error) {
    console.error('Upsert annual target error:', error);
    return res.status(500).json({ error: 'Failed to save annual target' });
  }
}

export async function deleteAnnualTarget(req, res) {
  try {
    await prisma.annualTarget.delete({ where: { id: parseInt(req.params.id) } });
    return res.json({ message: 'Annual target deleted' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Annual target not found' });
    console.error('Delete annual target error:', error);
    return res.status(500).json({ error: 'Failed to delete annual target' });
  }
}

// ── Client active/hide (forecasting visibility) ──────────────────────────────

export async function listAdminClients(req, res) {
  try {
    const clients = await prisma.client.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, isActive: true, agency: { select: { id: true, name: true } }, _count: { select: { channels: true } } },
    });
    return res.json(clients.map(c => ({ id: c.id, name: c.name, isActive: c.isActive, agencyId: c.agency?.id, agencyName: c.agency?.name, channelCount: c._count.channels })));
  } catch (error) {
    console.error('List admin clients error:', error);
    return res.status(500).json({ error: 'Failed to list clients' });
  }
}

export async function toggleClientActive(req, res) {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.client.findUnique({ where: { id }, select: { isActive: true } });
    if (!existing) return res.status(404).json({ error: 'Client not found' });
    const client = await prisma.client.update({ where: { id }, data: { isActive: !existing.isActive }, select: { id: true, name: true, isActive: true } });
    return res.json({ client });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Client not found' });
    console.error('Toggle client error:', error);
    return res.status(500).json({ error: 'Failed to update client status' });
  }
}

// ── Client & Channel requests (forecasting) ──────────────────────────────────

export async function listClientRequests(req, res) {
  try {
    const rows = await prisma.clientRequest.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
    const userIds = [...new Set(rows.map(r => r.requestedById))];
    const agencyIds = [...new Set(rows.map(r => r.agencyId).filter(Boolean))];
    const [users, agencies] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
      prisma.agency.findMany({ where: { id: { in: agencyIds } }, select: { id: true, name: true } }),
    ]);
    const uMap = new Map(users.map(u => [u.id, u.name]));
    const aMap = new Map(agencies.map(a => [a.id, a.name]));
    return res.json(rows.map(r => ({ ...r, requestedByName: uMap.get(r.requestedById) || '', agencyName: r.agencyId ? aMap.get(r.agencyId) : null })));
  } catch (error) {
    console.error('List client requests error:', error);
    return res.status(500).json({ error: 'Failed to list client requests' });
  }
}

export async function reviewClientRequest(req, res) {
  try {
    const id = parseInt(req.params.id);
    const { status, agencyId } = req.body;
    if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'status must be approved or rejected' });
    const reqRow = await prisma.clientRequest.findUnique({ where: { id } });
    if (!reqRow) return res.status(404).json({ error: 'Request not found' });
    if (reqRow.status !== 'pending') return res.status(409).json({ error: 'Request already reviewed' });

    if (status === 'approved') {
      const aId = agencyId ? parseInt(agencyId) : reqRow.agencyId;
      if (!aId) return res.status(400).json({ error: 'An agency is required to approve' });
      let client = await prisma.client.findFirst({ where: { name: { equals: reqRow.clientName, mode: 'insensitive' } }, select: { id: true } });
      if (!client) client = await prisma.client.create({ data: { agencyId: aId, name: reqRow.clientName, isActive: true } });
    }
    await prisma.clientRequest.update({ where: { id }, data: { status, reviewedById: req.user.id, reviewedAt: new Date() } });
    await prisma.notification.create({
      data: { userId: reqRow.requestedById, type: 'CLIENT_REQUEST_RESULT', title: `Client request ${status}`, message: `Your request for "${reqRow.clientName}" was ${status}.`, link: '/forecasting' },
    }).catch(() => {});
    return res.json({ message: `Request ${status}` });
  } catch (error) {
    console.error('Review client request error:', error);
    return res.status(500).json({ error: 'Failed to review request', detail: error.message });
  }
}

export async function listChannelRequests(req, res) {
  try {
    const rows = await prisma.channelRequest.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
    const userIds = [...new Set(rows.map(r => r.requestedById))];
    const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
    const uMap = new Map(users.map(u => [u.id, u.name]));
    return res.json(rows.map(r => ({ ...r, requestedByName: uMap.get(r.requestedById) || '' })));
  } catch (error) {
    console.error('List channel requests error:', error);
    return res.status(500).json({ error: 'Failed to list channel requests' });
  }
}

export async function reviewChannelRequest(req, res) {
  try {
    const id = parseInt(req.params.id);
    const { status } = req.body;
    if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'status must be approved or rejected' });
    const reqRow = await prisma.channelRequest.findUnique({ where: { id } });
    if (!reqRow) return res.status(404).json({ error: 'Request not found' });
    if (reqRow.status !== 'pending') return res.status(409).json({ error: 'Request already reviewed' });

    if (status === 'approved') {
      const existing = await prisma.channelMaster.findFirst({ where: { name: { equals: reqRow.channelName, mode: 'insensitive' } }, select: { id: true } });
      if (!existing) {
        const group = await prisma.mediaGroup.findFirst({ select: { id: true } });
        if (!group) return res.status(400).json({ error: 'No media group exists to attach the channel to' });
        await prisma.channelMaster.create({ data: { name: reqRow.channelName, medium: reqRow.category, aliases: [], isActive: true, mediaGroupId: group.id, createdById: req.user.id } });
      }
    }
    await prisma.channelRequest.update({ where: { id }, data: { status, reviewedById: req.user.id, reviewedAt: new Date() } });
    await prisma.notification.create({
      data: { userId: reqRow.requestedById, type: 'CHANNEL_REQUEST_RESULT', title: `Channel request ${status}`, message: `Your request for "${reqRow.channelName}" was ${status}.`, link: '/forecasting' },
    }).catch(() => {});
    return res.json({ message: `Request ${status}` });
  } catch (error) {
    console.error('Review channel request error:', error);
    return res.status(500).json({ error: 'Failed to review request', detail: error.message });
  }
}
