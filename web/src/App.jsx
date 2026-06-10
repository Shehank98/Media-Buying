import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import ChangePasswordPage from './pages/ChangePasswordPage';
import PackageResponsePage from './pages/PackageResponsePage';
import PackagesPage from './pages/PackagesPage';
import DashboardPage from './pages/DashboardPage';
import AgenciesPage from './pages/AgenciesPage';
import AgencyDetailPage from './pages/AgencyDetailPage';
import ClientsPage from './pages/ClientsPage';
import ClientDetailPage from './pages/ClientDetailPage';
import ChannelDetailPage from './pages/ChannelDetailPage';
import ReportsPage from './pages/ReportsPage';
import AdminPage from './pages/AdminPage';
import ProfilePage from './pages/ProfilePage';
import ExecutiveDashboardPage from './pages/ExecutiveDashboardPage';
import ChannelIntelligencePage from './pages/ChannelIntelligencePage';
import DatabasePage from './pages/DatabasePage';
import SpendAnalyticsPage from './pages/SpendAnalyticsPage';
import DecisionsPage from './pages/DecisionsPage';
import UploadTrackerPage from './pages/UploadTrackerPage';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/package-response" element={<PackageResponsePage />} />
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
            <Route path="/" element={<DashboardPage />} />
            <Route path="/database" element={<DatabasePage />} />
            <Route
              path="/spend-analytics"
              element={
                <ProtectedRoute requiredRoles={['SUPER_ADMIN', 'MANAGER']}>
                  <SpendAnalyticsPage />
                </ProtectedRoute>
              }
            />
            <Route path="/agencies" element={<AgenciesPage />} />
            <Route path="/agencies/:agencyId" element={<AgencyDetailPage />} />
            <Route path="/clients" element={<ClientsPage />} />
            <Route path="/clients/:clientId" element={<ClientDetailPage />} />
            <Route path="/channels/:channelId" element={<ChannelDetailPage />} />
            <Route
              path="/decisions"
              element={
                <ProtectedRoute requiredRoles={['SUPER_ADMIN', 'MANAGER']}>
                  <DecisionsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/executive-dashboard"
              element={
                <ProtectedRoute requiredRoles={['SUPER_ADMIN', 'MANAGER']}>
                  <ExecutiveDashboardPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/channel-masters/:channelMasterId"
              element={
                <ProtectedRoute requiredRoles={['SUPER_ADMIN', 'MANAGER', 'GROUP_HEAD']}>
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
              path="/packages"
              element={
                <ProtectedRoute requiredRoles={['SUPER_ADMIN']}>
                  <PackagesPage />
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
