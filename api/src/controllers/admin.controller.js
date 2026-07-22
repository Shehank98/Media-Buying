import prisma from '../utils/prisma.js';
import { hashPassword } from '../services/auth.service.js';
import { sendEmail } from '../services/email.service.js';
import { releaseHeldImportRows } from './database.controller.js';
import { uploadRateCard, deleteRateCard, isRateCardConfigured, mimeForFile, isAllowedRateCard, extOf, rateCardName } from '../services/ratecard.service.js';
import { isDriveArchiveConfigured, uploadScheduleArchive } from '../services/scheduleArchive.service.js';
import { GROUP_HEAD_CLIENT_OR } from './forecasting.controller.js';
import { accountManagerByClient } from './forecastInsights.controller.js';
import ExcelJS from 'exceljs';

const VALID_ROLES = ['SUPER_ADMIN', 'MANAGER', 'GROUP_HEAD', 'PLANNER'];

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

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
        clients: { select: { id: true, name: true, isActive: true, commissionType: true, commissionValue: true, _count: { select: { channels: true } } } },
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
        lastLoginAt: true,
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

// ── Per-agency annual targets (Spend Analytics agency-wise achievement) ──

export async function listAgencyTargets(req, res) {
  try {
    const yearsRows = await prisma.scheduleLog.findMany({
      where: { isDeleted: false }, distinct: ['scheduleMonth'], select: { scheduleMonth: true },
    });
    const yearSet = new Set(yearsRows.map(r => parseInt(String(r.scheduleMonth).slice(0, 4))).filter(Boolean));
    yearSet.add(new Date().getFullYear());
    const availableYears = [...yearSet].sort((a, b) => b - a);
    const year = parseInt(req.query.year) || availableYears[0] || new Date().getFullYear();

    const agencies = await prisma.agency.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } });
    const targets = await prisma.agencyAnnualTarget.findMany({ where: { year } });
    const byAgency = new Map(targets.map(t => [t.agencyId, Number(t.totalTargetMillions)]));
    return res.json({
      year,
      availableYears,
      agencies: agencies.map(a => ({ agencyId: a.id, agencyName: a.name, totalTargetMillions: byAgency.has(a.id) ? byAgency.get(a.id) : null })),
    });
  } catch (error) {
    console.error('listAgencyTargets error:', error);
    return res.status(500).json({ error: 'Failed to load agency targets', detail: error.message });
  }
}

export async function setAgencyTarget(req, res) {
  try {
    const { agencyId, year, totalTargetMillions } = req.body || {};
    const aId = parseInt(agencyId), y = parseInt(year);
    if (!aId || !Number.isInteger(y)) return res.status(400).json({ error: 'agencyId and year are required' });
    const num = totalTargetMillions === '' || totalTargetMillions == null ? null : Number(totalTargetMillions);
    if (num == null || isNaN(num) || num <= 0) {
      await prisma.agencyAnnualTarget.deleteMany({ where: { agencyId: aId, year: y } });
      return res.json({ agencyId: aId, year: y, totalTargetMillions: null });
    }
    const saved = await prisma.agencyAnnualTarget.upsert({
      where: { agencyId_year: { agencyId: aId, year: y } },
      update: { totalTargetMillions: num, createdById: req.user?.id ?? null },
      create: { agencyId: aId, year: y, totalTargetMillions: num, createdById: req.user?.id ?? null },
    });
    return res.json({ agencyId: aId, year: y, totalTargetMillions: Number(saved.totalTargetMillions) });
  } catch (error) {
    console.error('setAgencyTarget error:', error);
    return res.status(500).json({ error: 'Failed to save agency target', detail: error.message });
  }
}

// ── Client active/hide (forecasting visibility) ──────────────────────────────

export async function listAdminClients(req, res) {
  try {
    const clients = await prisma.client.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, isActive: true, commissionType: true, commissionValue: true, agency: { select: { id: true, name: true } }, _count: { select: { channels: true } } },
    });
    return res.json(clients.map(c => ({
      id: c.id,
      name: c.name,
      isActive: c.isActive,
      commissionType: c.commissionType,
      commissionValue: c.commissionValue == null ? null : Number(c.commissionValue),
      agencyId: c.agency?.id,
      agencyName: c.agency?.name,
      channelCount: c._count.channels,
    })));
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

// Set a client's agency remuneration (used by the Overall Budget tab): either a
// COMMISSION (value = %) or an AOR fixed fee (value = LKR). Sending an empty/blank
// type clears both.
export async function setClientCommission(req, res) {
  try {
    const id = parseInt(req.params.id);
    let { commissionType, commissionValue } = req.body;
    if (commissionType == null || commissionType === '') {
      commissionType = null;
      commissionValue = null;
    } else {
      if (commissionType !== 'COMMISSION' && commissionType !== 'AOR') {
        return res.status(400).json({ error: 'commissionType must be COMMISSION or AOR' });
      }
      const v = parseFloat(commissionValue);
      if (Number.isNaN(v) || v < 0) return res.status(400).json({ error: 'A valid commission value is required' });
      // A percentage above 100 is almost certainly a typo.
      if (commissionType === 'COMMISSION' && v > 100) return res.status(400).json({ error: 'Commission % cannot exceed 100' });
      commissionValue = v;
    }
    const client = await prisma.client.update({
      where: { id },
      data: { commissionType, commissionValue },
      select: { id: true, name: true, commissionType: true, commissionValue: true },
    });

    // How the new commission applies to this client's EXISTING ScheduleLog rows,
    // which drive the Profit tab:
    //   scope 'all'     -> rewrite every row for the client (snapshotted ones too)
    //                      - use when correcting a mistyped rate on past records.
    //   scope 'forward' -> touch nothing; only rows uploaded from now on snapshot
    //                      the new rate (past profit stays exactly as it was).
    //   (default)       -> fill only un-snapshotted / previously-backfilled rows,
    //                      leaving genuine at-entry snapshots frozen.
    const scope = req.body.scope;
    let updatedRows = 0;
    if (commissionType && scope === 'all') {
      // Rewrite every row for the client (snapshotted ones too).
      updatedRows = await prisma.$executeRaw`
        UPDATE schedule_logs
        SET commission_type_at_entry = ${commissionType},
            commission_rate_at_entry = ${commissionValue},
            commission_backfilled = true
        WHERE client_id = ${id} AND is_deleted = false`;
    } else if (commissionType && scope !== 'forward') {
      // Default: fill only un-snapshotted / previously-backfilled rows; leave
      // genuine at-entry snapshots frozen.
      updatedRows = await prisma.$executeRaw`
        UPDATE schedule_logs
        SET commission_type_at_entry = ${commissionType},
            commission_rate_at_entry = ${commissionValue},
            commission_backfilled = true
        WHERE client_id = ${id}
          AND (commission_type_at_entry IS NULL OR commission_backfilled = true)`;
    }

    return res.json({
      client: { ...client, commissionValue: client.commissionValue == null ? null : Number(client.commissionValue) },
      updatedRows,
    });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Client not found' });
    console.error('Set client commission error:', error);
    return res.status(500).json({ error: 'Failed to update client commission' });
  }
}

// Move a client to another agency, point-in-time. `effectiveMonth` ("YYYY-MM",
// optional) is the SCHEDULE (flight) month from which the client belongs to the
// new agency: rows for months >= effectiveMonth are re-stamped to the new agency
// and earlier rows stay with the old one. A blank effectiveMonth moves ALL
// history (for fixing a mis-filed client). Repeatable - each call only re-stamps
// from its own month forward, so a client can switch agencies multiple times.
// Spend, dashboards and Profit all attribute by the per-row ScheduleLog snapshot,
// so this splits Revenue, Schedule Value and Profit at the cut-off consistently.
export async function moveClientAgency(req, res) {
  try {
    const id = parseInt(req.params.id);
    const newAgencyId = parseInt(req.body.agencyId);
    const effRaw = req.body.effectiveMonth;
    const eff = effRaw && /^\d{4}-\d{2}$/.test(String(effRaw)) ? String(effRaw) : null;
    // Optional: the agency the client belonged to BEFORE the effective month.
    // Set it to correct history that was mis-attributed (e.g. past months wrongly
    // flipped to the current agency). Only meaningful together with an eff month.
    const beforeAgencyId = req.body.beforeAgencyId ? parseInt(req.body.beforeAgencyId) : null;

    if (!Number.isInteger(id) || !Number.isInteger(newAgencyId)) {
      return res.status(400).json({ error: 'client id and agencyId are required' });
    }
    const [client, agency, beforeAgency] = await Promise.all([
      prisma.client.findUnique({ where: { id }, select: { id: true, name: true, agencyId: true } }),
      prisma.agency.findUnique({ where: { id: newAgencyId }, select: { id: true, name: true } }),
      beforeAgencyId ? prisma.agency.findUnique({ where: { id: beforeAgencyId }, select: { id: true, name: true } }) : Promise.resolve(null),
    ]);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    if (!agency) return res.status(400).json({ error: 'Selected agency was not found' });
    if (beforeAgencyId && !beforeAgency) return res.status(400).json({ error: 'The "before" agency was not found' });

    // Month filters. ScheduleLog uses a "YYYY-MM" string; MonthlyForecast /
    // MonthlyBudget use integer year+month.
    const logWhere = { clientId: id };
    let fyMonthWhere = {};
    let fyBeforeWhere = null;
    let logBeforeWhere = null;
    if (eff) {
      logWhere.scheduleMonth = { gte: eff };
      const [ey, em] = eff.split('-').map(Number);
      fyMonthWhere = { OR: [{ year: { gt: ey } }, { year: ey, month: { gte: em } }] };
      // The "before the effective month" side (only re-stamped if beforeAgency given).
      logBeforeWhere = { clientId: id, scheduleMonth: { lt: eff } };
      fyBeforeWhere = { OR: [{ year: { lt: ey } }, { year: ey, month: { lt: em } }] };
    }

    const ops = [
      prisma.client.update({ where: { id }, data: { agencyId: newAgencyId } }),
      prisma.scheduleLog.updateMany({ where: logWhere, data: { agencyId: newAgencyId } }),
      prisma.monthlyForecast.updateMany({ where: { clientId: id, ...fyMonthWhere }, data: { agencyId: newAgencyId } }),
      prisma.monthlyBudget.updateMany({ where: { clientId: id, ...fyMonthWhere }, data: { agencyId: newAgencyId } }),
    ];
    // When a "before" agency is given with an eff month, re-stamp the earlier
    // months onto it (fixes months previously flipped to the wrong agency).
    if (eff && beforeAgency) {
      ops.push(prisma.scheduleLog.updateMany({ where: logBeforeWhere, data: { agencyId: beforeAgencyId } }));
      ops.push(prisma.monthlyForecast.updateMany({ where: { clientId: id, ...fyBeforeWhere }, data: { agencyId: beforeAgencyId } }));
      ops.push(prisma.monthlyBudget.updateMany({ where: { clientId: id, ...fyBeforeWhere }, data: { agencyId: beforeAgencyId } }));
    }
    const [, logs, forecasts, budgets, beforeLogs] = await prisma.$transaction(ops);

    // Upload batches denormalize agency too, but a single batch can span months
    // on both sides of a cut-off, so only re-point sole-client batches when
    // moving ALL history (spend attribution itself lives on ScheduleLog).
    if (!eff) {
      const batches = await prisma.uploadBatch.findMany({ where: { clientIds: { has: id } }, select: { id: true, clientIds: true } });
      const soleIds = batches.filter(b => b.clientIds.length === 1 && b.clientIds[0] === id).map(b => b.id);
      if (soleIds.length) await prisma.uploadBatch.updateMany({ where: { id: { in: soleIds } }, data: { agencyId: newAgencyId } });
    }

    return res.json({
      message: eff
        ? `Moved "${client.name}" to ${agency.name} from ${eff} onward${beforeAgency ? `; before ${eff} set to ${beforeAgency.name}` : ''}`
        : `Moved "${client.name}" to ${agency.name} (all history)`,
      agencyId: newAgencyId,
      effectiveMonth: eff,
      restamped: { scheduleLogs: logs.count, forecasts: forecasts.count, budgets: budgets.count, beforeScheduleLogs: beforeLogs?.count || 0 },
    });
  } catch (error) {
    console.error('Move client agency error:', error);
    return res.status(500).json({ error: 'Failed to move client', detail: error.message });
  }
}

// Merge one client (source) into another (target): move every related record -
// schedule logs, channels/properties, brands/campaigns, forecasts, deals, and
// user/team assignments - onto the target, resolving unique-constraint clashes,
// then delete the now-empty source. Used to consolidate same-name duplicates.
export async function mergeClients(req, res) {
  try {
    const sid = parseInt(req.body.sourceId);
    const tid = parseInt(req.body.targetId);
    if (!Number.isInteger(sid) || !Number.isInteger(tid)) return res.status(400).json({ error: 'sourceId and targetId are required' });
    if (sid === tid) return res.status(400).json({ error: 'sourceId and targetId must be different' });

    const [source, target] = await Promise.all([
      prisma.client.findUnique({ where: { id: sid }, select: { id: true, name: true, aliases: true } }),
      prisma.client.findUnique({ where: { id: tid }, select: { id: true, name: true, agencyId: true, aliases: true } }),
    ]);
    if (!source) return res.status(404).json({ error: 'Source client not found' });
    if (!target) return res.status(404).json({ error: 'Target client not found' });

    await prisma.$transaction(async (tx) => {
      // 1) Schedule logs - bulk re-point (also align agency to the target's).
      await tx.scheduleLog.updateMany({ where: { clientId: sid }, data: { clientId: tid, agencyId: target.agencyId } });

      // 2) Client channels - unique [clientId, name]. Same-name → move its
      //    properties onto the target's channel and drop the duplicate.
      const [srcChannels, tgtChannels] = await Promise.all([
        tx.channel.findMany({ where: { clientId: sid }, select: { id: true, name: true } }),
        tx.channel.findMany({ where: { clientId: tid }, select: { id: true, name: true } }),
      ]);
      const tgtChannelByName = new Map(tgtChannels.map(c => [c.name, c.id]));
      for (const ch of srcChannels) {
        const dup = tgtChannelByName.get(ch.name);
        if (dup) {
          await tx.property.updateMany({ where: { channelId: ch.id }, data: { channelId: dup } });
          await tx.channel.delete({ where: { id: ch.id } });
        } else {
          await tx.channel.update({ where: { id: ch.id }, data: { clientId: tid } });
        }
      }

      // 3) Brands - unique [clientId, name]. Same-name → fold campaigns +
      //    schedule logs into the target's brand, then drop the duplicate.
      const [srcBrands, tgtBrands] = await Promise.all([
        tx.brand.findMany({ where: { clientId: sid }, select: { id: true, name: true } }),
        tx.brand.findMany({ where: { clientId: tid }, select: { id: true, name: true } }),
      ]);
      const tgtBrandByName = new Map(tgtBrands.map(b => [b.name, b.id]));
      for (const br of srcBrands) {
        const dupBrand = tgtBrandByName.get(br.name);
        if (dupBrand) {
          const [srcCamps, tgtCamps] = await Promise.all([
            tx.campaign.findMany({ where: { brandId: br.id }, select: { id: true, name: true } }),
            tx.campaign.findMany({ where: { brandId: dupBrand }, select: { id: true, name: true } }),
          ]);
          const tgtCampByName = new Map(tgtCamps.map(c => [c.name, c.id]));
          for (const cmp of srcCamps) {
            const dupCamp = tgtCampByName.get(cmp.name);
            if (dupCamp) {
              await tx.scheduleLog.updateMany({ where: { campaignId: cmp.id }, data: { campaignId: dupCamp } });
              await tx.campaign.delete({ where: { id: cmp.id } });
            } else {
              await tx.campaign.update({ where: { id: cmp.id }, data: { brandId: dupBrand, clientId: tid } });
            }
          }
          await tx.scheduleLog.updateMany({ where: { brandId: br.id }, data: { brandId: dupBrand } });
          await tx.brand.delete({ where: { id: br.id } });
        } else {
          await tx.brand.update({ where: { id: br.id }, data: { clientId: tid } });
          await tx.campaign.updateMany({ where: { brandId: br.id }, data: { clientId: tid } });
        }
      }

      // 4) Monthly forecasts - unique [year,month,clientId,channelMasterId].
      //    Clash → add the source amount into the target row, then drop source.
      //    Target rows are prefetched into a map so this is O(1) per source row
      //    (no findUnique per row - keeps the transaction well under its timeout).
      const [srcForecasts, tgtForecasts] = await Promise.all([
        tx.monthlyForecast.findMany({ where: { clientId: sid } }),
        tx.monthlyForecast.findMany({ where: { clientId: tid }, select: { id: true, year: true, month: true, channelMasterId: true, amountMillions: true } }),
      ]);
      const fKey = (y, m, cm) => `${y}-${m}-${cm ?? 'null'}`;
      const tgtForecastByKey = new Map(tgtForecasts.map(f => [fKey(f.year, f.month, f.channelMasterId), f]));
      for (const f of srcForecasts) {
        const existing = tgtForecastByKey.get(fKey(f.year, f.month, f.channelMasterId));
        if (existing) {
          await tx.monthlyForecast.update({ where: { id: existing.id }, data: { amountMillions: Number(existing.amountMillions) + Number(f.amountMillions) } });
          await tx.monthlyForecast.delete({ where: { id: f.id } });
        } else {
          await tx.monthlyForecast.update({ where: { id: f.id }, data: { clientId: tid, agencyId: target.agencyId } });
        }
      }

      // 5) Channel-client deals - unique [channelMasterId, clientId, year]. Keep target's on clash.
      const [srcDeals, tgtDeals] = await Promise.all([
        tx.channelClientDeal.findMany({ where: { clientId: sid }, select: { id: true, channelMasterId: true, year: true } }),
        tx.channelClientDeal.findMany({ where: { clientId: tid }, select: { channelMasterId: true, year: true } }),
      ]);
      const tgtDealKeys = new Set(tgtDeals.map(d => `${d.channelMasterId}-${d.year}`));
      for (const d of srcDeals) {
        if (tgtDealKeys.has(`${d.channelMasterId}-${d.year}`)) await tx.channelClientDeal.delete({ where: { id: d.id } });
        else await tx.channelClientDeal.update({ where: { id: d.id }, data: { clientId: tid } });
      }

      // 5b) Monthly budgets - unique [year, month, clientId]. Keep the target's on
      //     clash, otherwise re-point (and realign agency). Must run BEFORE the
      //     source delete, else the source's budget rows are cascade-lost.
      const [srcBudgets, tgtBudgets] = await Promise.all([
        tx.monthlyBudget.findMany({ where: { clientId: sid }, select: { id: true, year: true, month: true } }),
        tx.monthlyBudget.findMany({ where: { clientId: tid }, select: { year: true, month: true } }),
      ]);
      const tgtBudgetKeys = new Set(tgtBudgets.map(b => `${b.year}-${b.month}`));
      for (const b of srcBudgets) {
        if (tgtBudgetKeys.has(`${b.year}-${b.month}`)) await tx.monthlyBudget.delete({ where: { id: b.id } });
        else await tx.monthlyBudget.update({ where: { id: b.id }, data: { clientId: tid, agencyId: target.agencyId } });
      }

      // 6) User access - unique [userId, clientId]. Dedupe.
      const [srcUA, tgtUA] = await Promise.all([
        tx.userClientAccess.findMany({ where: { clientId: sid }, select: { id: true, userId: true } }),
        tx.userClientAccess.findMany({ where: { clientId: tid }, select: { userId: true } }),
      ]);
      const tgtUAUsers = new Set(tgtUA.map(u => u.userId));
      for (const u of srcUA) {
        if (tgtUAUsers.has(u.userId)) await tx.userClientAccess.delete({ where: { id: u.id } });
        else await tx.userClientAccess.update({ where: { id: u.id }, data: { clientId: tid } });
      }

      // 7) Team assignments - one team per client: if the target already sits on a
      //    team, drop the source's; otherwise move the source's single assignment.
      const tgtTC = await tx.teamClient.findFirst({ where: { clientId: tid }, select: { id: true } });
      if (tgtTC) {
        await tx.teamClient.deleteMany({ where: { clientId: sid } });
      } else {
        const srcTC = await tx.teamClient.findMany({ where: { clientId: sid }, select: { id: true } });
        // Keep only the first (a client belongs to one team); move it, drop the rest.
        for (let i = 0; i < srcTC.length; i++) {
          if (i === 0) await tx.teamClient.update({ where: { id: srcTC[i].id }, data: { clientId: tid } });
          else await tx.teamClient.delete({ where: { id: srcTC[i].id } });
        }
      }

      // 8) Remember the source's name (and its own aliases) on the target, so
      //    the seed and bulk-import recognise the merged-away name as this client
      //    and never re-create it on a future deploy (which is what made merges
      //    appear to "un-merge" after redeployment). Merge names case-insensitively
      //    and never duplicate the target's own name.
      const targetNorm = target.name.trim().toLowerCase();
      const knownAliases = new Set((target.aliases || []).map((a) => a.trim().toLowerCase()));
      const aliasesToAdd = [];
      for (const cand of [source.name, ...(source.aliases || [])]) {
        const n = (cand || '').trim();
        if (!n) continue;
        const key = n.toLowerCase();
        if (key === targetNorm || knownAliases.has(key)) continue;
        knownAliases.add(key);
        aliasesToAdd.push(n);
      }
      if (aliasesToAdd.length) {
        await tx.client.update({ where: { id: tid }, data: { aliases: { push: aliasesToAdd } } });
      }

      // 9) Source is now empty - delete it.
      await tx.client.delete({ where: { id: sid } });
    }, {
      // A merge of a data-heavy client touches many rows; the default 5s
      // interactive-transaction timeout can be exceeded, which rolls the whole
      // merge back and leaves BOTH clients in the list. Give it ample room.
      maxWait: 20000,
      timeout: 120000,
    });

    return res.json({ message: `Merged client "${source.name}" into "${target.name}"`, clientId: tid });
  } catch (error) {
    console.error('Merge clients error:', error);
    return res.status(500).json({ error: 'Failed to merge clients', detail: error.message });
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
    // Release any bulk-import rows that were held waiting on this client.
    let released = 0;
    if (status === 'approved') { released = (await releaseHeldImportRows({ clientReqId: id }, req.user.id).catch(() => ({ released: 0 }))).released; }
    await prisma.notification.create({
      data: { userId: reqRow.requestedById, type: 'CLIENT_REQUEST_RESULT', title: `Client request ${status}`, message: `Your request for "${reqRow.clientName}" was ${status}.`, link: '/forecasting' },
    }).catch(() => {});
    return res.json({ message: `Request ${status}`, releasedRows: released });
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
    const { status, mediaGroupId } = req.body;
    if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'status must be approved or rejected' });
    const reqRow = await prisma.channelRequest.findUnique({ where: { id } });
    if (!reqRow) return res.status(404).json({ error: 'Request not found' });
    if (reqRow.status !== 'pending') return res.status(409).json({ error: 'Request already reviewed' });

    if (status === 'approved') {
      const existing = await prisma.channelMaster.findFirst({ where: { name: { equals: reqRow.channelName, mode: 'insensitive' } }, select: { id: true } });
      if (!existing) {
        // Admin must pick the media group the new channel belongs to.
        const gid = parseInt(mediaGroupId);
        if (!Number.isFinite(gid)) {
          return res.status(400).json({ error: 'Select a media group for this channel.', needMediaGroup: true });
        }
        const group = await prisma.mediaGroup.findUnique({ where: { id: gid }, select: { id: true } });
        if (!group) return res.status(400).json({ error: 'The selected media group does not exist.', needMediaGroup: true });
        await prisma.channelMaster.create({ data: { name: reqRow.channelName, medium: reqRow.category, aliases: [], isActive: true, mediaGroupId: group.id, createdById: req.user.id } });
      }
    }
    await prisma.channelRequest.update({ where: { id }, data: { status, reviewedById: req.user.id, reviewedAt: new Date() } });
    let released = 0;
    if (status === 'approved') { released = (await releaseHeldImportRows({ channelReqId: id }, req.user.id).catch(() => ({ released: 0 }))).released; }
    await prisma.notification.create({
      data: { userId: reqRow.requestedById, type: 'CHANNEL_REQUEST_RESULT', title: `Channel request ${status}`, message: `Your request for "${reqRow.channelName}" was ${status}.`, link: '/forecasting' },
    }).catch(() => {});
    return res.json({ message: `Request ${status}`, releasedRows: released });
  } catch (error) {
    console.error('Review channel request error:', error);
    return res.status(500).json({ error: 'Failed to review request', detail: error.message });
  }
}

// ── Group Revenue Contribution (admin-entered, per group head, per month) ──
// Drives the right donut of the Executive Dashboard's Group Contribution card.

export async function listGroupRevenue(req, res) {
  try {
    // The month the Executive Dashboard's Revenue donut reads = the latest month
    // that has schedule data (revenue is entered for that same month). Return it so
    // the admin form can default to the month that actually drives the chart.
    const latest = await prisma.scheduleLog.findFirst({
      where: { isDeleted: false },
      orderBy: { scheduleMonth: 'desc' },
      select: { scheduleMonth: true },
    });
    let currentRevenueMonth = null;
    if (latest) {
      const [ly, lm] = String(latest.scheduleMonth).split('-').map(Number);
      currentRevenueMonth = { year: ly, month: lm };
    }

    let year = parseInt(req.query.year);
    let month = parseInt(req.query.month);
    if (!year || !month || month < 1 || month > 12) {
      const d = new Date();
      year = currentRevenueMonth?.year ?? d.getFullYear();
      month = currentRevenueMonth?.month ?? (d.getMonth() + 1);
    }
    const [heads, agencies, rows, agencyRows, yearTargetRow, rosterClients, clientRevRows] = await Promise.all([
      prisma.user.findMany({ where: { role: 'GROUP_HEAD' }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.agency.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.groupRevenue.findMany({ where: { year, month } }),
      prisma.agencyRevenue.findMany({ where: { year, month } }),
      prisma.yearRevenueTarget.findUnique({ where: { year } }),
      // EVERY client for the admin by-client revenue grid - including inactive
      // ones (e.g. a paused account like Mobitel) and ones with no Hub head - so
      // the admin can always enter revenue. Inactive/Unassigned are flagged in the
      // response; Forecasting + Rev Verification stay active+assigned only.
      prisma.client.findMany({
        select: { id: true, name: true, isActive: true, agency: { select: { id: true, name: true } } },
        orderBy: [{ name: 'asc' }],
      }),
      prisma.clientRevenue.findMany({ where: { year, month }, include: { verifier: { select: { name: true } } } }),
    ]);
    const byHead = new Map(rows.map((r) => [r.headUserId, Number(r.amount)]));
    const byAgency = new Map(agencyRows.map((r) => [r.agencyId, Number(r.amount)]));
    // Per-client revenue row (Revenue + Rev. from finance + head verification).
    const clientRevBy = new Map(clientRevRows.map((r) => [r.clientId, r]));
    const headByClient = await accountManagerByClient(rosterClients.map((c) => c.id));
    const clients = rosterClients
      .map((c) => {
        const r = clientRevBy.get(c.id);
        return {
          clientId: c.id,
          name: c.name,
          agencyId: c.agency?.id ?? null,
          agencyName: c.agency?.name || '',
          isActive: c.isActive !== false,
          hasHead: headByClient.has(c.id),
          headName: headByClient.get(c.id) || 'Unassigned',
          amount: r && r.amount != null ? Number(r.amount) : null,
          revenueFromFinance: r && r.revenueFromFinance != null ? Number(r.revenueFromFinance) : null,
          verifyStatus: r ? r.verifyStatus : 'PENDING',
          verifiedAmount: r && r.verifiedAmount != null ? Number(r.verifiedAmount) : null,
          verifyReason: r ? (r.verifyReason || null) : null,
          verifiedByName: r ? (r.verifier?.name || null) : null,
          verifiedAt: r ? (r.verifiedAt || null) : null,
        };
      })
      .sort((a, b) => a.headName.localeCompare(b.headName) || a.name.localeCompare(b.name));
    return res.json({
      year,
      month,
      currentRevenueMonth,
      heads: heads.map((h) => ({ headUserId: h.id, headName: h.name, amount: byHead.has(h.id) ? byHead.get(h.id) : null })),
      // Hub-assigned clients + each one's admin-entered revenue for the month.
      clients,
      // Agency-wise actual billing/revenue for the month - the total is mirrored
      // into MonthlyBilling on save, and the split drives the agency Revenue donut.
      agencies: agencies.map((a) => ({ agencyId: a.id, agencyName: a.name, amount: byAgency.has(a.id) ? byAgency.get(a.id) : null })),
      // Single ANNUAL revenue target for the whole year (admin enters the yearly
      // figure). The Revenue Achievement Target bar = this ÷ 12 × months elapsed.
      // Stored in the `monthlyAmount` column, which now holds the annual amount.
      annualRevenueTarget: yearTargetRow ? Number(yearTargetRow.monthlyAmount) : null,
    });
  } catch (error) {
    console.error('listGroupRevenue error:', error);
    return res.status(500).json({ error: 'Failed to load group revenue', detail: error.message });
  }
}

export async function setGroupRevenue(req, res) {
  try {
    const { year, month, amounts, agencyAmounts, clientAmounts, clientFinanceAmounts, annualRevenueTarget } = req.body || {};
    const y = parseInt(year), m = parseInt(month);
    const hasHeads = amounts && typeof amounts === 'object';
    const hasAgencies = agencyAmounts && typeof agencyAmounts === 'object';
    const hasClients = (clientAmounts && typeof clientAmounts === 'object') || (clientFinanceAmounts && typeof clientFinanceAmounts === 'object');
    const hasTarget = annualRevenueTarget !== undefined;
    if (!y || !m || m < 1 || m > 12 || (!hasHeads && !hasAgencies && !hasClients && !hasTarget)) {
      return res.status(400).json({ error: 'year, month (1-12) and amounts { headUserId } and/or agencyAmounts { agencyId } and/or clientAmounts { clientId } and/or clientFinanceAmounts { clientId } and/or annualRevenueTarget are required' });
    }
    // Only accept ids that are actually GROUP_HEAD users.
    const heads = await prisma.user.findMany({ where: { role: 'GROUP_HEAD' }, select: { id: true } });
    const headIds = new Set(heads.map((h) => h.id));

    // Revenue figures may be NEGATIVE (e.g. a credit/adjustment) or 0 - those are
    // real, stored values. Only a BLANK field clears the row. NaN → clear.
    const keepNum = (v) => {
      if (v === '' || v == null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const ops = [];
    if (hasHeads) for (const [k, v] of Object.entries(amounts)) {
      const headUserId = parseInt(k);
      if (!headIds.has(headUserId)) continue;
      const num = keepNum(v);
      if (num == null) {
        // clearing an entry removes the row
        ops.push(prisma.groupRevenue.deleteMany({ where: { year: y, month: m, headUserId } }));
      } else {
        ops.push(prisma.groupRevenue.upsert({
          where: { year_month_headUserId: { year: y, month: m, headUserId } },
          update: { amount: num, createdById: req.user?.id ?? null },
          create: { year: y, month: m, headUserId, amount: num, createdById: req.user?.id ?? null },
        }));
      }
    }

    // Agency-wise actual billing: upsert per agency, and mirror the month TOTAL
    // into MonthlyBilling so the Revenue Achievement chart reads the same figure.
    if (hasAgencies) {
      const agencies = await prisma.agency.findMany({ select: { id: true } });
      const agencyIds = new Set(agencies.map((a) => a.id));
      for (const [k, v] of Object.entries(agencyAmounts)) {
        const agencyId = parseInt(k);
        if (!agencyIds.has(agencyId)) continue;
        const num = keepNum(v);
        if (num == null) {
          ops.push(prisma.agencyRevenue.deleteMany({ where: { year: y, month: m, agencyId } }));
        } else {
          ops.push(prisma.agencyRevenue.upsert({
            where: { year_month_agencyId: { year: y, month: m, agencyId } },
            update: { amount: num, createdById: req.user?.id ?? null },
            create: { year: y, month: m, agencyId, amount: num, createdById: req.user?.id ?? null },
          }));
        }
      }
    }
    // Per-client revenue: one row per client carrying `amount` ("Revenue (LKR)")
    // and `revenueFromFinance` ("Rev. from finance"). A head's roll-up total is
    // derived from `amount` on read (getGroupContribution). Changing the finance
    // figure resets that client's verification (the head must re-check it). A row
    // whose both amounts become blank is deleted (verification goes with it).
    if (hasClients) {
      const ca = (clientAmounts && typeof clientAmounts === 'object') ? clientAmounts : {};
      const cf = (clientFinanceAmounts && typeof clientFinanceAmounts === 'object') ? clientFinanceAmounts : {};
      const ids = [...new Set([...Object.keys(ca), ...Object.keys(cf)].map((k) => parseInt(k)).filter(Boolean))];
      const valid = new Set((await prisma.client.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((c) => c.id));
      const existing = await prisma.clientRevenue.findMany({ where: { year: y, month: m, clientId: { in: ids } } });
      const existByClient = new Map(existing.map((r) => [r.clientId, r]));
      const parse = keepNum; // blank → clear; negative/0 kept as real values
      for (const clientId of ids) {
        if (!valid.has(clientId)) continue;
        // Only override a field that was actually sent in the request.
        const prev = existByClient.get(clientId);
        const amount = Object.prototype.hasOwnProperty.call(ca, clientId) || Object.prototype.hasOwnProperty.call(ca, String(clientId))
          ? parse(ca[clientId] ?? ca[String(clientId)])
          : (prev && prev.amount != null ? Number(prev.amount) : null);
        const finance = Object.prototype.hasOwnProperty.call(cf, clientId) || Object.prototype.hasOwnProperty.call(cf, String(clientId))
          ? parse(cf[clientId] ?? cf[String(clientId)])
          : (prev && prev.revenueFromFinance != null ? Number(prev.revenueFromFinance) : null);
        const cleanAmount = amount;   // may be negative or 0; null only when blank
        const cleanFinance = finance;

        if (cleanAmount == null && cleanFinance == null) {
          if (prev) ops.push(prisma.clientRevenue.deleteMany({ where: { id: prev.id } }));
          continue;
        }
        const financeChanged = prev && Number(prev.revenueFromFinance ?? NaN) !== Number(cleanFinance ?? NaN);
        const resetVerify = financeChanged
          ? { verifyStatus: 'PENDING', verifiedAmount: null, verifyReason: null, verifiedById: null, verifiedAt: null }
          : {};
        ops.push(prisma.clientRevenue.upsert({
          where: { year_month_clientId: { year: y, month: m, clientId } },
          update: { amount: cleanAmount, revenueFromFinance: cleanFinance, ...resetVerify, createdById: req.user?.id ?? null },
          create: { year: y, month: m, clientId, amount: cleanAmount, revenueFromFinance: cleanFinance, createdById: req.user?.id ?? null },
        }));
      }
    }
    // Single ANNUAL revenue target for the WHOLE year (blank/0 clears it).
    // Stored as-is in `monthlyAmount`, which now represents the annual amount.
    if (hasTarget) {
      const num = annualRevenueTarget === '' || annualRevenueTarget == null ? null : Number(annualRevenueTarget);
      if (num == null || isNaN(num) || num <= 0) {
        ops.push(prisma.yearRevenueTarget.deleteMany({ where: { year: y } }));
      } else {
        ops.push(prisma.yearRevenueTarget.upsert({
          where: { year: y },
          update: { monthlyAmount: num, createdById: req.user?.id ?? null },
          create: { year: y, monthlyAmount: num, createdById: req.user?.id ?? null },
        }));
      }
    }
    await prisma.$transaction(ops);

    // Recompute MonthlyBilling for the month from the agency total (post-write),
    // so a cleared/blank set removes the billing row too.
    if (hasAgencies) {
      const agg = await prisma.agencyRevenue.aggregate({ where: { year: y, month: m }, _sum: { amount: true }, _count: true });
      const total = Number(agg._sum.amount) || 0;
      // Keep the MonthlyBilling row whenever ANY agency figure exists for the
      // month (the net total may legitimately be ≤ 0 once negatives/credits are
      // included); only a fully-cleared month removes it.
      if ((agg._count || 0) > 0) {
        await prisma.monthlyBilling.upsert({
          where: { year_month: { year: y, month: m } },
          update: { amount: total, createdById: req.user?.id ?? null },
          create: { year: y, month: m, amount: total, createdById: req.user?.id ?? null },
        });
      } else {
        await prisma.monthlyBilling.deleteMany({ where: { year: y, month: m } });
      }
    }
    return listGroupRevenue({ query: { year: y, month: m } }, res);
  } catch (error) {
    console.error('setGroupRevenue error:', error);
    return res.status(500).json({ error: 'Failed to save group revenue', detail: error.message });
  }
}

// ── Channel commitments (yearly commitment per channel, admin-managed) ──

export async function listChannelCommitments(req, res) {
  try {
    const channels = await prisma.channelMaster.findMany({
      where: { isActive: true },
      select: { id: true, name: true, medium: true, sortOrder: true, mediaGroup: { select: { name: true } } },
      orderBy: [{ medium: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
    // One active commitment per channel (period model). Legacy rows are converted
    // by seed.js; a valid row has either a monthlyAmount (MONTHLY) or totalAmount (ANNUAL).
    const commitments = await prisma.channelCommitment.findMany({
      where: { OR: [{ monthlyAmount: { not: null } }, { totalAmount: { not: null } }] },
    });
    const byChannel = new Map(commitments.map((c) => [c.channelMasterId, c]));

    return res.json({
      channels: channels.map((c) => {
        const cm = byChannel.get(c.id);
        return {
          channelMasterId: c.id,
          name: c.name,
          medium: c.medium,
          mediaGroup: c.mediaGroup?.name || '',
          type: cm?.type || 'MONTHLY',
          monthlyAmount: cm?.monthlyAmount != null ? Number(cm.monthlyAmount) : null,
          totalAmount: cm?.totalAmount != null ? Number(cm.totalAmount) : null,
          startYear: cm?.startYear ?? null,
          startMonth: cm?.startMonth ?? null,
          endYear: cm?.endYear ?? null,
          endMonth: cm?.endMonth ?? null,
        };
      }),
    });
  } catch (error) {
    console.error('listChannelCommitments error:', error);
    return res.status(500).json({ error: 'Failed to load channel commitments', detail: error.message });
  }
}

export async function setChannelCommitment(req, res) {
  try {
    const { channelMasterId, type, amount, startYear, startMonth, endYear, endMonth } = req.body || {};
    const chId = parseInt(channelMasterId);
    if (!chId) return res.status(400).json({ error: 'channelMasterId is required' });

    const num = amount === '' || amount == null ? null : Number(amount);
    // Blank/zero clears the channel's commitment entirely.
    if (num == null || isNaN(num) || num <= 0) {
      await prisma.channelCommitment.deleteMany({ where: { channelMasterId: chId } });
      return res.json({ channelMasterId: chId, amount: null });
    }

    const ctype = type === 'ANNUAL' ? 'ANNUAL' : 'MONTHLY';
    const sy = parseInt(startYear), sm = parseInt(startMonth), ey = parseInt(endYear), em = parseInt(endMonth);
    if (!(sy >= 2000 && sm >= 1 && sm <= 12 && ey >= 2000 && em >= 1 && em <= 12)) {
      return res.status(400).json({ error: 'start/end month (1-12) and year are required' });
    }
    if (ey * 12 + em < sy * 12 + sm) {
      return res.status(400).json({ error: 'end month must be on or after start month' });
    }

    // MONTHLY stores monthlyAmount; ANNUAL stores totalAmount (total for the period).
    const data = {
      channelMasterId: chId, type: ctype,
      monthlyAmount: ctype === 'MONTHLY' ? num : null,
      totalAmount: ctype === 'ANNUAL' ? num : null,
      startYear: sy, startMonth: sm, endYear: ey, endMonth: em,
      createdById: req.user?.id ?? null,
    };
    // One active commitment per channel: replace any existing.
    await prisma.$transaction([
      prisma.channelCommitment.deleteMany({ where: { channelMasterId: chId } }),
      prisma.channelCommitment.create({ data }),
    ]);
    return res.json({ channelMasterId: chId, type: ctype, amount: num, startYear: sy, startMonth: sm, endYear: ey, endMonth: em });
  } catch (error) {
    console.error('setChannelCommitment error:', error);
    return res.status(500).json({ error: 'Failed to save channel commitment', detail: error.message });
  }
}

// ── Channel commitment GROUPS (one deal / one target across several channels) ──

export async function listCommitmentGroups(req, res) {
  try {
    const groups = await prisma.channelCommitmentGroup.findMany({ orderBy: [{ createdAt: 'desc' }] });
    const memberIds = [...new Set(groups.flatMap((g) => g.channelMasterIds || []))];
    const members = memberIds.length
      ? await prisma.channelMaster.findMany({ where: { id: { in: memberIds } }, select: { id: true, name: true, medium: true } })
      : [];
    const byId = new Map(members.map((m) => [m.id, m]));
    return res.json({
      groups: groups.map((g) => ({
        id: g.id,
        name: g.name,
        type: g.type,
        amount: g.type === 'ANNUAL' ? (g.totalAmount != null ? Number(g.totalAmount) : null) : (g.monthlyAmount != null ? Number(g.monthlyAmount) : null),
        startYear: g.startYear, startMonth: g.startMonth, endYear: g.endYear, endMonth: g.endMonth,
        channelMasterIds: g.channelMasterIds || [],
        channels: (g.channelMasterIds || []).map((id) => byId.get(id)).filter(Boolean),
      })),
    });
  } catch (error) {
    console.error('listCommitmentGroups error:', error);
    return res.status(500).json({ error: 'Failed to load commitment groups', detail: error.message });
  }
}

export async function saveCommitmentGroup(req, res) {
  try {
    const { id, name, type, amount, channelMasterIds, startYear, startMonth, endYear, endMonth } = req.body || {};
    const nm = String(name || '').trim();
    if (!nm) return res.status(400).json({ error: 'A group name is required' });

    const chIds = Array.isArray(channelMasterIds) ? [...new Set(channelMasterIds.map((x) => parseInt(x)).filter(Boolean))] : [];
    if (chIds.length < 2) return res.status(400).json({ error: 'Pick at least two channels for a deal group' });

    const num = amount === '' || amount == null ? null : Number(amount);
    if (num == null || isNaN(num) || num <= 0) return res.status(400).json({ error: 'A target amount greater than 0 is required' });

    const ctype = type === 'ANNUAL' ? 'ANNUAL' : 'MONTHLY';
    const sy = parseInt(startYear), sm = parseInt(startMonth), ey = parseInt(endYear), em = parseInt(endMonth);
    if (!(sy >= 2000 && sm >= 1 && sm <= 12 && ey >= 2000 && em >= 1 && em <= 12)) {
      return res.status(400).json({ error: 'start/end month (1-12) and year are required' });
    }
    if (ey * 12 + em < sy * 12 + sm) {
      return res.status(400).json({ error: 'end month must be on or after start month' });
    }

    const data = {
      name: nm, type: ctype,
      monthlyAmount: ctype === 'MONTHLY' ? num : null,
      totalAmount: ctype === 'ANNUAL' ? num : null,
      channelMasterIds: chIds,
      startYear: sy, startMonth: sm, endYear: ey, endMonth: em,
      createdById: req.user?.id ?? null,
    };
    const saved = id
      ? await prisma.channelCommitmentGroup.update({ where: { id: parseInt(id) }, data })
      : await prisma.channelCommitmentGroup.create({ data });
    return res.json({ id: saved.id });
  } catch (error) {
    console.error('saveCommitmentGroup error:', error);
    return res.status(500).json({ error: 'Failed to save commitment group', detail: error.message });
  }
}

export async function deleteCommitmentGroup(req, res) {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'id is required' });
    await prisma.channelCommitmentGroup.delete({ where: { id } });
    return res.json({ ok: true });
  } catch (error) {
    console.error('deleteCommitmentGroup error:', error);
    return res.status(500).json({ error: 'Failed to delete commitment group', detail: error.message });
  }
}

// ── Client yearly targets (full LKR spend target per client per year) ──
export async function listClientTargets(req, res) {
  try {
    const now = new Date().getFullYear();
    // Years with schedule data + client targets + current year, newest first.
    const [dataMonths, targetYears] = await Promise.all([
      prisma.scheduleLog.findMany({ where: { isDeleted: false }, distinct: ['scheduleMonth'], select: { scheduleMonth: true } }),
      prisma.clientTarget.findMany({ distinct: ['year'], select: { year: true } }),
    ]);
    const yset = new Set([now]);
    for (const r of dataMonths) { const y = parseInt(String(r.scheduleMonth).slice(0, 4)); if (y) yset.add(y); }
    for (const t of targetYears) yset.add(t.year);
    const availableYears = [...yset].sort((a, b) => b - a);

    const year = parseInt(req.query.year) || availableYears[0] || now;

    const clients = await prisma.client.findMany({
      where: { isActive: true },
      select: { id: true, name: true, agency: { select: { name: true } } },
      orderBy: [{ agency: { name: 'asc' } }, { name: 'asc' }],
    });
    const targets = await prisma.clientTarget.findMany({ where: { year } });
    const byClient = new Map(targets.map((t) => [t.clientId, Number(t.amount)]));

    return res.json({
      year,
      availableYears,
      clients: clients.map((c) => ({
        clientId: c.id,
        name: c.name,
        agencyName: c.agency?.name || '',
        amount: byClient.has(c.id) ? byClient.get(c.id) : null,
      })),
    });
  } catch (error) {
    console.error('listClientTargets error:', error);
    return res.status(500).json({ error: 'Failed to load client targets', detail: error.message });
  }
}

export async function setClientTarget(req, res) {
  try {
    const { clientId, year, amount } = req.body || {};
    const cid = parseInt(clientId), y = parseInt(year);
    if (!cid || !y) return res.status(400).json({ error: 'clientId and year are required' });
    const num = amount === '' || amount == null ? null : Number(amount);
    if (num == null || isNaN(num) || num <= 0) {
      await prisma.clientTarget.deleteMany({ where: { clientId: cid, year: y } });
      return res.json({ clientId: cid, year: y, amount: null });
    }
    const saved = await prisma.clientTarget.upsert({
      where: { clientId_year: { clientId: cid, year: y } },
      update: { amount: num, createdById: req.user?.id ?? null },
      create: { clientId: cid, year: y, amount: num, createdById: req.user?.id ?? null },
    });
    return res.json({ clientId: cid, year: y, amount: Number(saved.amount) });
  } catch (error) {
    console.error('setClientTarget error:', error);
    return res.status(500).json({ error: 'Failed to save client target', detail: error.message });
  }
}

// ── Monthly actual billing (company-wide, one figure per month) ──

export async function listMonthlyBilling(req, res) {
  try {
    const latest = await prisma.scheduleLog.findFirst({
      where: { isDeleted: false },
      orderBy: { scheduleMonth: 'desc' },
      select: { scheduleMonth: true },
    });
    let currentMonth = null;
    if (latest) {
      const [ly, lm] = String(latest.scheduleMonth).split('-').map(Number);
      currentMonth = { year: ly, month: lm };
    }
    const year = parseInt(req.query.year) || currentMonth?.year || new Date().getFullYear();
    const rows = await prisma.monthlyBilling.findMany({ where: { year }, orderBy: { month: 'asc' } });
    const byMonth = new Map(rows.map((r) => [r.month, Number(r.amount)]));
    return res.json({
      year,
      currentMonth,
      months: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, amount: byMonth.has(i + 1) ? byMonth.get(i + 1) : null })),
    });
  } catch (error) {
    console.error('listMonthlyBilling error:', error);
    return res.status(500).json({ error: 'Failed to load monthly billing', detail: error.message });
  }
}

export async function setMonthlyBilling(req, res) {
  try {
    const { year, month, amount } = req.body || {};
    const y = parseInt(year), m = parseInt(month);
    if (!y || !m || m < 1 || m > 12) return res.status(400).json({ error: 'year and month (1-12) are required' });
    const num = amount === '' || amount == null ? null : Number(amount);
    if (num == null || isNaN(num) || num <= 0) {
      await prisma.monthlyBilling.deleteMany({ where: { year: y, month: m } });
    } else {
      await prisma.monthlyBilling.upsert({
        where: { year_month: { year: y, month: m } },
        update: { amount: num, createdById: req.user?.id ?? null },
        create: { year: y, month: m, amount: num, createdById: req.user?.id ?? null },
      });
    }
    return listMonthlyBilling({ query: { year: y } }, res);
  } catch (error) {
    console.error('setMonthlyBilling error:', error);
    return res.status(500).json({ error: 'Failed to save monthly billing', detail: error.message });
  }
}

// ── AOR revenue (monthly, per-channel lines; company-wide) ──

// GET /api/admin/aor-revenue?year=&month=
// Lists the AOR lines for a year (all months) plus a per-month total map, so the
// admin tab can show the picked month's rows and a year-at-a-glance summary.
export async function listAorRevenue(req, res) {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const rows = await prisma.aorRevenue.findMany({
      where: { year },
      orderBy: [{ month: 'asc' }, { createdAt: 'asc' }],
    });
    const monthTotals = {};
    for (const r of rows) monthTotals[r.month] = round2((monthTotals[r.month] || 0) + Number(r.amount));
    return res.json({
      year,
      entries: rows.map((r) => ({ id: r.id, year: r.year, month: r.month, channel: r.channel, amount: Number(r.amount), reason: r.reason || '' })),
      monthTotals,
      total: round2(rows.reduce((s, r) => s + Number(r.amount), 0)),
    });
  } catch (error) {
    console.error('listAorRevenue error:', error);
    return res.status(500).json({ error: 'Failed to load AOR revenue', detail: error.message });
  }
}

// POST /api/admin/aor-revenue  { year, month, channel, amount, reason }
// Adds one AOR line. Amount may be negative (adjustment/credit); channel required.
export async function createAorRevenue(req, res) {
  try {
    const { year, month, channel, amount, reason } = req.body || {};
    const y = parseInt(year), m = parseInt(month);
    if (!y || !m || m < 1 || m > 12) return res.status(400).json({ error: 'year and month (1-12) are required' });
    const ch = String(channel || '').trim();
    if (!ch) return res.status(400).json({ error: 'channel is required' });
    const num = amount === '' || amount == null ? NaN : Number(amount);
    if (isNaN(num)) return res.status(400).json({ error: 'amount must be a number' });
    await prisma.aorRevenue.create({
      data: { year: y, month: m, channel: ch, amount: num, reason: String(reason || '').trim() || null, createdById: req.user?.id ?? null },
    });
    return listAorRevenue({ query: { year: y } }, res);
  } catch (error) {
    console.error('createAorRevenue error:', error);
    return res.status(500).json({ error: 'Failed to add AOR revenue', detail: error.message });
  }
}

// DELETE /api/admin/aor-revenue/:id
export async function deleteAorRevenue(req, res) {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid id' });
    const row = await prisma.aorRevenue.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ error: 'not found' });
    await prisma.aorRevenue.delete({ where: { id } });
    return listAorRevenue({ query: { year: row.year } }, res);
  } catch (error) {
    console.error('deleteAorRevenue error:', error);
    return res.status(500).json({ error: 'Failed to delete AOR revenue', detail: error.message });
  }
}

// ── Channel rate card (1 PDF per channel, stored in Google Drive) ──

export async function uploadChannelRateCardHandler(req, res) {
  try {
    if (!isRateCardConfigured()) {
      return res.status(503).json({ error: 'Rate card storage is not configured. Set the Google Drive OAuth env vars (GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN), or a service account + GDRIVE_RATECARD_FOLDER_ID.' });
    }
    const id = parseInt(req.params.id);
    const master = await prisma.channelMaster.findUnique({ where: { id }, select: { id: true, name: true, medium: true, rateCardVersions: true } });
    if (!master) return res.status(404).json({ error: 'Channel not found' });

    const { fileName, dataBase64 } = req.body || {};
    if (!dataBase64 || typeof dataBase64 !== 'string') return res.status(400).json({ error: 'dataBase64 (the file) is required' });
    const uploaded = String(fileName || 'rate-card.pdf').trim();
    if (!isAllowedRateCard(uploaded)) return res.status(400).json({ error: 'Unsupported file type. Allowed: PDF, JPG, PNG, Excel (xls/xlsx), CSV, Word' });
    const ext = extOf(uploaded);
    const mimeType = mimeForFile(uploaded);
    // Auto-rename to <Channel>_<Medium>_<UploadDate>.<ext> (ignore original name).
    const name = rateCardName(master.name, master.medium, ext);

    const b64 = dataBase64.includes(',') ? dataBase64.split(',').pop() : dataBase64;
    const buffer = Buffer.from(b64, 'base64');
    if (!buffer.length) return res.status(400).json({ error: 'Empty file' });
    if (buffer.length > 25 * 1024 * 1024) return res.status(413).json({ error: 'Rate card must be 25 MB or smaller' });

    // Keep every upload as a NEW version (don't delete the old Drive file), in
    // General Rate Cards/<channel>/. rateCard* points at the newest version.
    const prior = Array.isArray(master.rateCardVersions) ? master.rateCardVersions : [];
    const version = prior.length + 1;
    const bareName = name.replace(new RegExp(`\\.${ext}$`, 'i'), '');
    const driveName = `${bareName} (v${version}).${ext}`;
    const up = await uploadRateCard(buffer, driveName, { folders: ['General Rate Cards', master.name], mimeType });
    const entry = { version, driveId: up.id, fileName: name, mimeType, size: up.size, uploadedAt: new Date().toISOString() };
    const versions = [...prior, entry];

    const saved = await prisma.channelMaster.update({
      where: { id },
      data: {
        rateCardDriveId: up.id, rateCardFileName: name, rateCardMimeType: mimeType, rateCardSize: up.size, rateCardUploadedAt: new Date(),
        rateCardVersions: versions,
      },
      select: { id: true, rateCardFileName: true, rateCardMimeType: true, rateCardSize: true, rateCardUploadedAt: true, rateCardVersions: true },
    });

    // Notify EVERY user that a (general) rate card was added/updated. The Rate
    // Cards tab is visible to all, so everyone gets the "New Rate Card" alert.
    try {
      const users = await prisma.user.findMany({ select: { id: true } });
      if (users.length) {
        await prisma.notification.createMany({
          data: users.map((u) => ({
            userId: u.id,
            type: 'RATE_CARD',
            title: 'New Rate Card',
            message: `${master.name} rate card has been ${version > 1 ? 'updated' : 'added'}.`,
            link: '/rate-cards',
          })),
        });
      }
    } catch (e) {
      console.warn('Rate card notification skipped:', e.message);
    }

    return res.json({ channelMaster: saved });
  } catch (error) {
    console.error('uploadChannelRateCard error:', error);
    return res.status(500).json({ error: 'Failed to upload rate card', detail: error.message });
  }
}

export async function deleteChannelRateCardHandler(req, res) {
  try {
    const id = parseInt(req.params.id);
    const master = await prisma.channelMaster.findUnique({ where: { id }, select: { rateCardDriveId: true, rateCardVersions: true } });
    if (!master) return res.status(404).json({ error: 'Channel not found' });
    // Remove every version's Drive file (best-effort), then clear all fields.
    const ids = new Set([master.rateCardDriveId, ...(Array.isArray(master.rateCardVersions) ? master.rateCardVersions.map(v => v.driveId) : [])].filter(Boolean));
    for (const did of ids) await deleteRateCard(did).catch(() => {});
    await prisma.channelMaster.update({
      where: { id },
      data: { rateCardDriveId: null, rateCardFileName: null, rateCardMimeType: null, rateCardSize: null, rateCardUploadedAt: null, rateCardVersions: null },
    });
    return res.json({ ok: true });
  } catch (error) {
    console.error('deleteChannelRateCard error:', error);
    return res.status(500).json({ error: 'Failed to remove rate card', detail: error.message });
  }
}

// ─── Schedule-log yearly archive to Google Drive (backup; rows stay in DB) ────

// Info for the Archive UI: whether Drive is configured + the years that have
// schedule data with their row counts.
export async function getScheduleArchiveInfo(req, res) {
  try {
    const grouped = await prisma.$queryRaw`
      SELECT substring(schedule_month from 1 for 4) AS yr, COUNT(*)::int AS n
      FROM schedule_logs
      WHERE is_deleted = false AND schedule_month ~ '^[0-9]{4}-[0-9]{2}$'
      GROUP BY 1 ORDER BY 1 DESC`;
    return res.json({
      configured: isDriveArchiveConfigured(),
      years: grouped.map((g) => ({ year: parseInt(g.yr), rows: Number(g.n) })),
    });
  } catch (error) {
    console.error('getScheduleArchiveInfo error:', error);
    return res.status(500).json({ error: 'Failed to load archive info', detail: error.message });
  }
}

// Export one year's schedule logs (all columns) to an Excel file in Google
// Drive under Orbit Schedule Logs/<year>/. The rows are NOT deleted.
export async function archiveScheduleLogsToDrive(req, res) {
  try {
    if (!isDriveArchiveConfigured()) {
      return res.status(503).json({ error: 'Google Drive is not configured. Set the Google Drive OAuth env vars (GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN), or a service account + a Drive folder id.' });
    }
    const year = parseInt(req.body?.year ?? req.query?.year);
    if (!(year >= 2000 && year <= 2100)) return res.status(400).json({ error: 'A valid year is required' });

    const rows = await prisma.scheduleLog.findMany({
      where: { isDeleted: false, scheduleMonth: { startsWith: `${year}-` } },
      include: {
        agency: { select: { name: true } },
        client: { select: { name: true } },
        brand: { select: { name: true } },
        campaign: { select: { name: true } },
        channelMaster: { select: { name: true } },
        uploader: { select: { name: true, email: true } },
      },
      orderBy: [{ scheduleMonth: 'asc' }, { id: 'asc' }],
    });
    if (rows.length === 0) return res.status(404).json({ error: `No schedule logs found for ${year}` });

    // Union of all importExtra keys (the extra spreadsheet columns kept verbatim
    // at import) so the export truly carries ALL columns.
    const extraKeys = [];
    const seen = new Set();
    for (const r of rows) {
      if (r.importExtra && typeof r.importExtra === 'object') {
        for (const k of Object.keys(r.importExtra)) if (!seen.has(k)) { seen.add(k); extraKeys.push(k); }
      }
    }

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(`Schedule Logs ${year}`);
    const baseCols = [
      ['Year', 'year'], ['Schedule Month', 'scheduleMonth'], ['Invoice Month', 'invoiceMonth'],
      ['RO Number', 'roNumber'], ['Agency', 'agency'], ['Client', 'client'], ['Brand', 'brand'],
      ['Campaign', 'campaign'], ['Channel', 'channel'], ['Medium', 'medium'], ['Media Group', 'mediaGroup'],
      ['Schedule Value', 'scheduleValue'], ['Schedule Value (incl VAT)', 'scheduleValueWithVat'],
      ['Commission Type', 'commissionType'], ['Commission Rate', 'commissionRate'],
      ['Property Id', 'propertyId'], ['Uploaded By', 'uploadedBy'], ['Created At', 'createdAt'],
    ];
    ws.columns = [
      ...baseCols.map(([header, key]) => ({ header, key, width: Math.min(28, Math.max(12, header.length + 2)) })),
      ...extraKeys.map((k) => ({ header: k, key: `x_${k}`, width: 16 })),
    ];
    ws.getRow(1).font = { bold: true };

    for (const r of rows) {
      const row = {
        year, scheduleMonth: r.scheduleMonth, invoiceMonth: r.invoiceMonth, roNumber: r.roNumber,
        agency: r.agency?.name || '', client: r.client?.name || '', brand: r.brand?.name || r.brandName || '',
        campaign: r.campaign?.name || '', channel: r.channelMaster?.name || '', medium: r.medium, mediaGroup: r.mediaGroup,
        scheduleValue: Number(r.scheduleValue) || 0, scheduleValueWithVat: Number(r.scheduleValueWithVat) || 0,
        commissionType: r.commissionTypeAtEntry || '', commissionRate: r.commissionRateAtEntry != null ? Number(r.commissionRateAtEntry) : '',
        propertyId: r.propertyId ?? '', uploadedBy: r.uploader?.name || r.uploader?.email || '',
        createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : '',
      };
      if (r.importExtra && typeof r.importExtra === 'object') {
        for (const k of extraKeys) { const v = r.importExtra[k]; if (v != null) row[`x_${k}`] = typeof v === 'object' ? JSON.stringify(v) : v; }
      }
      ws.addRow(row);
    }

    const arrayBuffer = await wb.xlsx.writeBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const stamp = new Date().toISOString().slice(0, 10);
    const fileName = `Schedule_Logs_${year}_${stamp}.xlsx`;
    const up = await uploadScheduleArchive(buffer, fileName, year);

    return res.json({
      ok: true, year, rows: rows.length, fileName: up.name, size: up.size, driveId: up.id,
      folder: `Orbit Schedule Logs / ${year}`, columns: baseCols.length + extraKeys.length,
    });
  } catch (error) {
    console.error('archiveScheduleLogsToDrive error:', error);
    return res.status(500).json({ error: 'Failed to archive schedule logs', detail: error.message });
  }
}
