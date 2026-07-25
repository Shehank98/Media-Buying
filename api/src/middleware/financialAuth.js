import prisma from '../utils/prisma.js';
import { verifyFinancialToken, financialRole, FINANCIAL_ROLES } from '../services/financialAuth.service.js';

// Bearer-token guard for /api/financial/*. Mirrors the checks the app's own
// `authenticate` middleware makes (user still exists, token not revoked via
// User.tokenVersion, forced password change, read-only accounts) but is a
// separate function so nothing in the existing auth path changes.
export async function financialAuthenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    let decoded;
    try {
      decoded = verifyFinancialToken(header.slice(7).trim());
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const user = await prisma.user.findUnique({ where: { id: parseInt(decoded.sub) } });
    if (!user) return res.status(401).json({ error: 'User not found' });

    // Revocation — same rule as middleware/auth.js: a token whose version is
    // behind the user's current tokenVersion was invalidated by a logout /
    // password change / reset.
    if (decoded.tv !== undefined && decoded.tv !== (user.tokenVersion ?? 0)) {
      return res.status(401).json({ error: 'Session expired, please sign in again' });
    }

    if (user.mustChangePassword) {
      return res.status(403).json({
        error: 'Password change required. Sign in to Orbit and set a new password first.',
        mustChangePassword: true,
      });
    }

    // The role may have changed since the token was issued — always trust the
    // DB, never the claim.
    const role = financialRole(user.role);
    if (!role) {
      return res.status(403).json({ error: 'Your account does not have access to the financial app' });
    }

    req.user = { id: user.id, username: user.email, name: user.name, role };
    req.orbitUser = user;
    next();
  } catch (error) {
    console.error('[financial] auth error:', error);
    return res.status(500).json({ error: 'Authentication failed' });
  }
}

// Route guard. Every financial route is limited to the three mapped roles;
// pass a narrower list to restrict further.
export function requireFinancialRole(...roles) {
  const allowed = roles.length ? roles : FINANCIAL_ROLES;
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// Read-only accounts (User.readOnly) cannot write anywhere else in the app;
// keep that true here too.
export function blockReadOnly(req, res, next) {
  if (req.orbitUser?.readOnly) {
    return res.status(403).json({ error: 'Your account is read-only. Changes are not permitted.' });
  }
  next();
}
