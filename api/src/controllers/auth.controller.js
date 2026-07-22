import crypto from 'crypto';
import prisma from '../utils/prisma.js';
import {
  generateTokens,
  verifyRefreshToken,
  hashPassword,
  comparePassword,
  generateResetToken,
} from '../services/auth.service.js';
import { sendEmail } from '../services/email.service.js';
import { getAccessibleClientIds } from '../middleware/access.js';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

export async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Account lockout: too many recent failures temporarily blocks sign-in.
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      return res.status(429).json({ error: `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` });
    }

    const valid = await comparePassword(password, user.passwordHash);
    if (!valid) {
      // Count the failure; lock the account once the threshold is reached.
      const failed = (user.failedLogins || 0) + 1;
      const lock = failed >= MAX_FAILED_LOGINS;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLogins: lock ? 0 : failed,
          lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000) : user.lockedUntil,
        },
      });
      if (lock) {
        return res.status(429).json({ error: `Too many failed attempts. Try again in ${LOCK_MINUTES} minutes.` });
      }
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Successful login: record the timestamp and clear any failure/lock state.
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null },
    });

    const { accessToken, refreshToken } = generateTokens(user);

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    return res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
        pageAccess: user.pageAccess || [],
        canExport: user.canExport !== false,
        readOnly: !!user.readOnly,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function refresh(req, res) {
  try {
    const token = req.cookies?.refreshToken || req.body?.refreshToken;
    if (!token) {
      return res.status(401).json({ error: 'Refresh token not found' });
    }

    const decoded = verifyRefreshToken(token);
    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Reject refresh tokens that were revoked (logout / password change).
    if (decoded.tv !== undefined && decoded.tv !== (user.tokenVersion ?? 0)) {
      return res.status(401).json({ error: 'Session expired, please sign in again' });
    }

    const { accessToken, refreshToken } = generateTokens(user);

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.json({ accessToken });
  } catch (error) {
    console.error('Refresh error:', error);
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
}

export async function logout(req, res) {
  try {
    // Bump tokenVersion so the just-issued access/refresh tokens are revoked
    // server-side (logout is otherwise client-side only). Best-effort.
    const token = req.cookies?.refreshToken || req.body?.refreshToken;
    if (token) {
      try {
        const decoded = verifyRefreshToken(token);
        if (decoded?.id) {
          await prisma.user.update({ where: { id: decoded.id }, data: { tokenVersion: { increment: 1 } } });
        }
      } catch { /* invalid token - nothing to revoke */ }
    }

    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
    });

    return res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function forgotPassword(req, res) {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Return success even if user not found to prevent email enumeration
      return res.json({ message: 'If the email exists, a reset link has been sent' });
    }

    const { token, tokenHash } = generateResetToken();

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
      },
    });

    const frontendUrl = (process.env.FRONTEND_URL || 'https://media-buying-production.up.railway.app').split(',')[0].trim().replace(/\/+$/, '');
    const resetLink = `${frontendUrl}/reset-password?token=${token}&email=${encodeURIComponent(email)}`;

    sendEmail({
      type: 'reset',
      to: email,
      name: user.name,
      resetLink,
    }).catch(err => console.error('Reset email failed:', err));

    return res.json({ message: 'If the email exists, a reset link has been sent' });
  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function resetPassword(req, res) {
  try {
    const { token, email, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }
    if (String(newPassword).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Resolve the user from the token itself - the token hash is globally
    // unique, so the email in the reset link is optional (kept only as an
    // extra check when present).
    const resetToken = await prisma.passwordResetToken.findFirst({
      where: {
        tokenHash,
        used: false,
        expiresAt: { gt: new Date() },
      },
    });

    if (!resetToken) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const user = await prisma.user.findUnique({ where: { id: resetToken.userId } });
    if (!user || (email && user.email.toLowerCase() !== String(email).toLowerCase())) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const passwordHash = await hashPassword(newPassword);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { passwordHash, mustChangePassword: false, tokenVersion: { increment: 1 }, failedLogins: 0, lockedUntil: null },
      }),
      prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { used: true },
      }),
    ]);

    return res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getProfile(req, res) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, email: true, name: true, role: true, mustChangePassword: true, pageAccess: true, canExport: true, readOnly: true },
    });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // What this user can reach - assigned agencies, accessible clients, and teams.
    const [agencyAccess, memberTeams, headedTeams] = await Promise.all([
      prisma.userAgencyAccess.findMany({ where: { userId: user.id }, include: { agency: { select: { id: true, name: true } } } }),
      prisma.teamMember.findMany({ where: { userId: user.id }, include: { team: { select: { id: true, name: true, headUserId: true, agency: { select: { name: true } } } } } }),
      prisma.team.findMany({ where: { headUserId: user.id }, select: { id: true, name: true, agency: { select: { name: true } } } }),
    ]);

    const agencies = agencyAccess
      .filter((a) => a.agency)
      .map((a) => ({ id: a.agency.id, name: a.agency.name }))
      .sort((x, y) => x.name.localeCompare(y.name));

    const teamMap = new Map();
    for (const t of headedTeams) teamMap.set(t.id, { id: t.id, name: t.name, agencyName: t.agency?.name || '', isHead: true });
    for (const m of memberTeams) {
      const t = m.team;
      if (!t || teamMap.has(t.id)) continue;
      teamMap.set(t.id, { id: t.id, name: t.name, agencyName: t.agency?.name || '', isHead: t.headUserId === user.id });
    }
    const teams = [...teamMap.values()].sort((x, y) => x.name.localeCompare(y.name));

    // SUPER_ADMIN sees everything, so don't enumerate all clients (just flag it).
    const allClients = user.role === 'SUPER_ADMIN';
    let clients = [];
    if (!allClients) {
      const ids = await getAccessibleClientIds(user.id, user.role);
      if (ids && ids.length) {
        const cl = await prisma.client.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, agency: { select: { name: true } } },
          orderBy: { name: 'asc' },
        });
        clients = cl.map((c) => ({ id: c.id, name: c.name, agencyName: c.agency?.name || '' }));
      }
    }

    return res.json({ user, access: { agencies, clients, teams, allClients } });
  } catch (error) {
    console.error('Get profile error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function changePassword(req, res) {
  try {
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: 'Old password and new password are required' });
    }
    if (String(newPassword).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });

    const valid = await comparePassword(oldPassword, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const passwordHash = await hashPassword(newPassword);

    // Bump tokenVersion to revoke any OTHER active sessions, then re-issue
    // fresh tokens so this device stays signed in.
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false, tokenVersion: { increment: 1 } },
    });

    const { accessToken, refreshToken } = generateTokens(updated);
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.json({
      message: 'Password changed successfully',
      accessToken,
      refreshToken,
      user: {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        role: updated.role,
        mustChangePassword: false,
        pageAccess: updated.pageAccess || [],
        canExport: updated.canExport !== false,
        readOnly: !!updated.readOnly,
      },
    });
  } catch (error) {
    console.error('Change password error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
