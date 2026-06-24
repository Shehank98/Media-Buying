// Per-user page-access + export + read-only helpers.
// SUPER_ADMIN always has full access. An empty pageAccess means "no restriction"
// (backward compatible — existing users keep full role-based access).

// Top-level pages an admin can toggle for a user.
export const TOGGLEABLE_PAGES = [
  { key: '/database', label: 'Database' },
  { key: '/agencies', label: 'Agencies & Clients' },
  { key: '/spend-analytics', label: 'Spend Analytics' },
  { key: '/executive-dashboard', label: 'Executive Dashboard' },
  { key: '/reports', label: 'Reports' },
  { key: '/my-packages', label: 'Media Packages' },
];

// Paths every signed-in user can always reach.
const ALWAYS = ['/profile', '/change-password', '/login'];

// Map any path to its top-level page key.
export function pageKeyForPath(pathname) {
  const p = pathname || '/';
  if (p === '/') return '/';
  if (p.startsWith('/database')) return '/database';
  if (p.startsWith('/agencies') || p.startsWith('/clients') || p.startsWith('/channels') || p.startsWith('/channel-masters')) return '/agencies';
  if (p.startsWith('/spend-analytics')) return '/spend-analytics';
  if (p.startsWith('/executive-dashboard') || p.startsWith('/deep-dashboard')) return '/executive-dashboard';
  if (p.startsWith('/reports')) return '/reports';
  if (p.startsWith('/packages') || p.startsWith('/my-packages')) return '/my-packages';
  if (p.startsWith('/upload-tracker') || p.startsWith('/admin')) return '/admin';
  return p;
}

// Can this user open the given path?
export function hasPageAccess(user, pathname) {
  if (!user) return false;
  if (user.role === 'SUPER_ADMIN') return true;
  if ((pathname || '/') === '/') return true; // home just redirects; target enforces access
  if (ALWAYS.some((a) => (pathname || '').startsWith(a))) return true;
  const access = user.pageAccess;
  if (!Array.isArray(access) || access.length === 0) return true; // no restriction set
  return access.includes(pageKeyForPath(pathname));
}

export const canExport = (user) => !user || user.canExport !== false;
export const isReadOnly = (user) => !!(user && user.readOnly);
