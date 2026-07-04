import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import ChangePasswordPage from './pages/ChangePasswordPage';
import PackagesPage from './pages/PackagesPage';
import MyPackagesPage from './pages/MyPackagesPage';
import AgenciesPage from './pages/AgenciesPage';
import AgencyDetailPage from './pages/AgencyDetailPage';
import ClientsPage from './pages/ClientsPage';
import ClientDetailPage from './pages/ClientDetailPage';
import ClientDashboardPage from './pages/ClientDashboardPage';
import ChannelDetailPage from './pages/ChannelDetailPage';
import ReportsPage from './pages/ReportsPage';
import AdminPage from './pages/AdminPage';
import ProfilePage from './pages/ProfilePage';
import ExecutiveDashboardPage from './pages/ExecutiveDashboardPage';
import DeepDashboardPage from './pages/DeepDashboardPage';
import ChannelIntelligencePage from './pages/ChannelIntelligencePage';
import DatabasePage from './pages/DatabasePage';
import SpendAnalyticsPage from './pages/SpendAnalyticsPage';
import UploadTrackerPage from './pages/UploadTrackerPage';
import ForecastingPage from './pages/ForecastingPage';
import MediaBuyingPage from './pages/MediaBuyingPage';
import ProfitPage from './pages/ProfitPage';

// Home (/) lands on the Executive Dashboard for exec roles, Database otherwise.
function HomeRedirect() {
  const { user } = useAuth();
  const target = ['SUPER_ADMIN', 'MANAGER'].includes(user?.role) ? '/executive-dashboard' : '/database';
  return <Navigate to={target} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route
            path="/change-password"
            element={
              <ProtectedRoute>
                <ChangePasswordPage />
              </ProtectedRoute>
            }
          />
          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/database" element={<DatabasePage />} />
            <Route
              path="/forecasting"
              element={
                <ProtectedRoute requiredRoles={['SUPER_ADMIN', 'GROUP_HEAD']}>
                  <ForecastingPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/spend-analytics"
              element={
                <ProtectedRoute requiredRoles={['SUPER_ADMIN', 'MANAGER', 'GROUP_HEAD', 'PLANNER']}>
                  <SpendAnalyticsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/profit"
              element={
                <ProtectedRoute requiredRoles={['SUPER_ADMIN']}>
                  <ProfitPage />
                </ProtectedRoute>
              }
            />
            <Route path="/agencies" element={<AgenciesPage />} />
            <Route path="/agencies/:agencyId" element={<AgencyDetailPage />} />
            <Route path="/clients" element={<ClientsPage />} />
            <Route path="/clients/:clientId/dashboard" element={<ClientDashboardPage />} />
            <Route path="/clients/:clientId" element={<ClientDetailPage />} />
            <Route path="/channels/:channelId" element={<ChannelDetailPage />} />
            <Route
              path="/executive-dashboard"
              element={
                <ProtectedRoute requiredRoles={['SUPER_ADMIN', 'MANAGER']}>
                  <ExecutiveDashboardPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/deep-dashboard"
              element={
                <ProtectedRoute requiredRoles={['SUPER_ADMIN', 'MANAGER']}>
                  <DeepDashboardPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/channel-masters/:channelMasterId"
              element={
                <ProtectedRoute requiredRoles={['SUPER_ADMIN', 'MANAGER', 'GROUP_HEAD', 'PLANNER']}>
                  <ChannelIntelligencePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/reports"
              element={
                <ProtectedRoute requiredRoles={['SUPER_ADMIN', 'MANAGER']}>
                  <ReportsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin"
              element={
                <ProtectedRoute requiredRoles={['SUPER_ADMIN']}>
                  <AdminPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/media-buying"
              element={
                <ProtectedRoute requiredRoles={['SUPER_ADMIN']}>
                  <MediaBuyingPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/packages"
              element={
                <ProtectedRoute requiredRoles={['SUPER_ADMIN']}>
                  <PackagesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/my-packages"
              element={
                <ProtectedRoute requiredRoles={['GROUP_HEAD']}>
                  <MyPackagesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/upload-tracker"
              element={
                <ProtectedRoute requiredRoles={['SUPER_ADMIN']}>
                  <UploadTrackerPage />
                </ProtectedRoute>
              }
            />
            <Route path="/profile" element={<ProfilePage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
