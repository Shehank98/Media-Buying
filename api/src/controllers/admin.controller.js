import prisma from '../utils/prisma.js';
import { hashPassword } from '../services/auth.service.js';
import { sendEmail } from '../services/email.service.js';

// ── shared include/map helpers ──

const teamIncludes = {
  agency: { select: { id: true, name: true } },
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

// ── Agencies ──

export async function listAgencies(req, res) {
  try {
    const agencies = await prisma.agency.findMany({
      orderBy: { name: 'asc' },
      include: {
        clients: { select: { id: true, name: true } },
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
    const { email, name, role, password, agencyIds, clientIds } = req.body;
    if (!email || !name || !role) return res.status(400).json({ error: 'Email, name, and role are required' });

    const tempPassword = password || 'TempPass@123';
    const passwordHash = await hashPassword(tempPassword);

    const user = await prisma.user.create({
      data: { email, name, role, passwordHash, mustChangePassword: true },
      select: { id: true, email: true, name: true, role: true, mustChangePassword: true, createdAt: true },
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

    // Send welcome email (fire-and-forget)
    const loginUrl = process.env.FRONTEND_URL || 'https://your-app.railway.app';
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
    const { name, role, password, agencyIds, clientIds } = req.body;
    const userId = parseInt(id);

    const data = {};
    if (name !== undefined) data.name = name;
    if (role !== undefined) data.role = role;
    if (password) data.passwordHash = await hashPassword(password);

    const user = await prisma.user.update({
      where: { id: userId },
      data,
      select: { id: true, email: true, name: true, role: true, mustChangePassword: true, createdAt: true },
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
    const { name, agencyId, memberIds, clientIds } = req.body;
    if (!name || !agencyId) return res.status(400).json({ error: 'Name and agencyId are required' });

    const team = await prisma.team.create({ data: { name, agencyId: parseInt(agencyId) } });

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
      await prisma.teamClient.createMany({
        data: clientIds.map(clientId => ({ teamId: team.id, clientId: parseInt(clientId) })),
      });
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
    const { name, agencyId, memberIds, clientIds } = req.body;

    const data = {};
    if (name !== undefined) data.name = name;
    if (agencyId !== undefined) data.agencyId = parseInt(agencyId);

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
      await prisma.teamClient.deleteMany({ where: { teamId } });
      if (clientIds.length > 0) {
        await prisma.teamClient.createMany({
          data: clientIds.map(clientId => ({ teamId, clientId: parseInt(clientId) })),
        });
      }
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

    await prisma.teamClient.deleteMany({ where: { teamId } });
    if (clientIds.length > 0) {
      await prisma.teamClient.createMany({
        data: clientIds.map(clientId => ({ teamId, clientId: parseInt(clientId) })),
      });
    }
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
