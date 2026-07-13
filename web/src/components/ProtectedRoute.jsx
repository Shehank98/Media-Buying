import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import OrbitLoader from './OrbitLoader';
import { hasPageAccess, isPageGranted, TOGGLEABLE_PAGES } from '../lib/permissions';

export default function ProtectedRoute({ children, requiredRoles }) {
  const { isAuthenticated, loading, user } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div style={{ height: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg)' }}>
        <OrbitLoader size={64} label="Loading…" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (user?.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }

  // A pageAccess grant overrides the role requirement (an admin can give a
  // planner / Admin Level 3 access to a page their role wouldn't normally allow).
  if (requiredRoles && requiredRoles.length > 0) {
    if (!requiredRoles.includes(user?.role) && !isPageGranted(user, location.pathname)) {
      return <Navigate to="/" replace />;
    }
  }

  // Per-user page-access restriction (SUPER_ADMIN/empty access = unrestricted).
  if (!hasPageAccess(user, location.pathname)) {
    const firstAllowed = TOGGLEABLE_PAGES.find((p) => hasPageAccess(user, p.key))?.key || '/profile';
    return <Navigate to={firstAllowed} replace />;
  }

  return children;
}
