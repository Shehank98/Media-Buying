import prisma from '../utils/prisma.js';
import { comparePassword } from '../services/auth.service.js';
import { signFinancialToken, financialRole, tokenTtl } from '../services/financialAuth.service.js';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

// POST /api/financial/auth/login
// Same credentials, same users table, same bcrypt check and same account-lockout
// behaviour as the app's own /api/auth/login — only the response envelope
// differs ({ token, role, name } for the financial frontend, versus the
// { accessToken, refreshToken, user } the Orbit SPA expects).
//
// `username` is the user's Orbit email address; `email` is accepted as an alias.
export async function financialLogin(req, res) {
  try {
    const username = (req.body?.username ?? req.body?.email ?? '').trim();
    const password = req.body?.password;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = await prisma.user.findUnique({ where: { email: username } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      return res.status(429).json({ error: `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` });
    }

    const valid = await comparePassword(password, user.passwordHash);
    if (!valid) {
      // Shares User.failedLogins/lockedUntil with the main login, so attempts
      // against either surface count toward the same lockout.
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
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // PLANNER (Desk) has no financial role — credentials are valid, access isn't.
    const role = financialRole(user.role);
    if (!role) {
      return res.status(403).json({ error: 'Your account does not have access to the financial app' });
    }

    // Same forced-password-change gate the rest of the API enforces. A brand-new
    // account must set its password in Orbit before using this API.
    if (user.mustChangePassword) {
      return res.status(403).json({
        error: 'Password change required. Sign in to Orbit and set a new password first.',
        mustChangePassword: true,
      });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null },
    });

    return res.json({
      token: signFinancialToken(user, role),
      role,
      name: user.name,
      username: user.email,
      expiresIn: tokenTtl(),
    });
  } catch (error) {
    console.error('[financial] login error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// GET /api/financial/auth/me — lets the frontend validate a stored token on boot.
export async function financialMe(req, res) {
  return res.json({
    username: req.user.username,
    name: req.user.name,
    role: req.user.role,
  });
}
