import jwt from 'jsonwebtoken';

// Auth for the external financial payment tracker (Lovable frontend).
//
// Deliberately does NOT reuse generateTokens()/JWT_SECRET from auth.service.js:
// a token signed with the app's own secret would also be accepted by the
// existing `authenticate` middleware, so a long-lived financial token would
// silently unlock the whole Orbit API. Signing with a separate secret + a fixed
// audience keeps the two token families non-interchangeable in both directions.
//
// Passwords, the user table and bcrypt verification are all reused as-is —
// only the token envelope is new.

const AUDIENCE = 'orbit-financial';
const ISSUER = 'orbit';

// Falls back to JWT_SECRET so a staging deploy works before the new env var is
// set, but that fallback makes financial tokens valid on the main API too, so
// it warns loudly.
function secret() {
  if (process.env.FINANCIAL_JWT_SECRET) return process.env.FINANCIAL_JWT_SECRET;
  if (process.env.JWT_SECRET) {
    if (!secret._warned) {
      secret._warned = true;
      console.warn('[financial] FINANCIAL_JWT_SECRET is not set — falling back to JWT_SECRET. Set a separate secret so financial tokens cannot be replayed against the main API.');
    }
    return process.env.JWT_SECRET;
  }
  throw new Error('FINANCIAL_JWT_SECRET (or JWT_SECRET) must be set');
}

// How long a financial token is valid. The Lovable app holds a single bearer
// token with no refresh loop, so this is longer than the app's own 15m access
// token. Revocation still works: the token carries `tv` (User.tokenVersion),
// which is bumped on logout / password change / reset.
const TTL = process.env.FINANCIAL_TOKEN_TTL || '12h';

// ── Role mapping ─────────────────────────────────────────────────────────────
// The DB `Role` enum is unchanged (see CLAUDE.md — never add enum values). This
// maps it onto the three role strings the financial frontend expects, using the
// app's existing display names:
//   SUPER_ADMIN (Control Room) -> control_room
//   MANAGER     (Boardroom)    -> boardroom
//   GROUP_HEAD  (Hub)          -> hub
//   PLANNER     (Desk)         -> no mapping; rejected at login (403)
const ROLE_MAP = {
  SUPER_ADMIN: 'control_room',
  MANAGER: 'boardroom',
  GROUP_HEAD: 'hub',
};

export const FINANCIAL_ROLES = ['hub', 'boardroom', 'control_room'];

export function financialRole(orbitRole) {
  return ROLE_MAP[orbitRole] || null;
}

export function signFinancialToken(user, role) {
  return jwt.sign(
    {
      sub: String(user.id),
      username: user.email,
      name: user.name,
      role,
      orbitRole: user.role,
      tv: user.tokenVersion ?? 0,
    },
    secret(),
    { expiresIn: TTL, audience: AUDIENCE, issuer: ISSUER },
  );
}

export function verifyFinancialToken(token) {
  return jwt.verify(token, secret(), { audience: AUDIENCE, issuer: ISSUER });
}

export function tokenTtl() {
  return TTL;
}
