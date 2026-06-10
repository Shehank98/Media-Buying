import { verifyAccessToken } from '../services/auth.service.js';
import prisma from '../utils/prisma.js';

// Endpoints a user may still call while a password change is pending.
const PASSWORD_CHANGE_ALLOWED = [
  '/api/auth/change-password',
  '/api/auth/logout',
  '/api/auth/profile',
];

export async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyAccessToken(token);

    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Forced password change is enforced server-side, not just by the
    // frontend redirect, so direct API calls are blocked too.
    if (user.mustChangePassword) {
      const path = (req.originalUrl || '').split('?')[0];
      if (!PASSWORD_CHANGE_ALLOWED.includes(path)) {
        return res.status(403).json({
          error: 'Password change required',
          mustChangePassword: true,
        });
      }
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
}

export function checkPasswordChange(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (req.user.mustChangePassword && !req.path.endsWith('/change-password')) {
    return res.status(403).json({
      error: 'Password change required',
      message: 'You must change your password before accessing other resources',
      mustChangePassword: true,
    });
  }

  next();
}
