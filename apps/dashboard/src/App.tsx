import { Routes, Route, Navigate } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { DashboardLayout } from './components/layout/DashboardLayout';
import { LoadingSpinner } from './components/ui/LoadingSpinner';
import { ToastContainer } from './components/ui/Toast';
import { getWorkspaceCommerceCapabilities } from './lib/commerce-plan';
import WorkspaceSuspendedPage from './pages/paywall/WorkspaceSuspendedPage';

// Lazy load pages
const LoginPage = lazy(() => import('./pages/auth/LoginPage'));
const RegisterPage = lazy(() => import('./pages/auth/RegisterPage'));
const OnboardingPage = lazy(() => import('./pages/onboarding/OnboardingPage'));
const DashboardHome = lazy(() => import('./pages/dashboard/DashboardHome'));
const InboxPage = lazy(() => import('./pages/inbox/InboxPage'));
const OrdersPage = lazy(() => import('./pages/orders/OrdersPage'));
const InvoicesPage = lazy(() => import('./pages/invoices/InvoicesPage'));
const StockPage = lazy(() => import('./pages/stock/StockPage'));
const CustomersPage = lazy(() => import('./pages/customers/CustomersPage'));
const MetricsPage = lazy(() => import('./pages/metrics/MetricsPage'));
const DebtsPage = lazy(() => import('./pages/debts/DebtsPage'));
const SettingsPage = lazy(() => import('./pages/settings/SettingsPage'));

// Admin pages
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const UsersPage = lazy(() => import('./pages/admin/UsersPage'));
const WhatsAppNumbersPage = lazy(() => import('./pages/admin/WhatsAppNumbersPage'));
const WorkspacesPage = lazy(() => import('./pages/admin/WorkspacesPage'));
const AdminSettingsPage = lazy(() => import('./pages/admin/AdminSettingsPage'));
const BillingPage = lazy(() => import('./pages/admin/BillingPage'));

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <LoadingSpinner size="lg" />
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, workspace, user } = useAuth();

  if (isLoading) {
    return <PageLoader />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Super admin goes directly to admin panel
  if (user?.isSuperAdmin) {
    return <Navigate to="/admin" replace />;
  }

  const status = (workspace?.status || '').toLowerCase();
  if (status && status !== 'active') {
    return <WorkspaceSuspendedPage />;
  }

  // If onboarding not completed, redirect to onboarding
  if (!workspace?.onboardingCompleted) {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) {
    return <PageLoader />;
  }

  if (!isAuthenticated || !user?.isSuperAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}


function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, workspace, user } = useAuth();

  if (isLoading) {
    return <PageLoader />;
  }

  if (isAuthenticated) {
    // Super admin goes to admin panel
    if (user?.isSuperAdmin) {
      return <Navigate to="/admin" replace />;
    }
    // If onboarding not completed, go to onboarding
    if (!workspace?.onboardingCompleted) {
      return <Navigate to="/onboarding" replace />;
    }
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

function OnboardingRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, workspace } = useAuth();

  if (isLoading) {
    return <PageLoader />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // If onboarding already completed, go to dashboard
  if (workspace?.onboardingCompleted) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  const { workspace } = useAuth();
  const capabilities = getWorkspaceCommerceCapabilities(workspace);

  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* Public routes */}
        <Route
          path="/login"
          element={
            <PublicRoute>
              <LoginPage />
            </PublicRoute>
          }
        />
        <Route
          path="/register"
          element={
            <PublicRoute>
              <RegisterPage />
            </PublicRoute>
          }
        />

        {/* Onboarding route */}
        <Route
          path="/onboarding"
          element={
            <OnboardingRoute>
              <OnboardingPage />
            </OnboardingRoute>
          }
        />

        {/* Admin routes (Super Admin only) */}
        <Route
          path="/admin"
          element={
            <AdminRoute>
              <AdminLayout />
            </AdminRoute>
          }
        >
          <Route index element={<AdminDashboard />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="whatsapp" element={<WhatsAppNumbersPage />} />
          <Route path="negocios" element={<WorkspacesPage />} />
          <Route path="billing" element={<BillingPage />} />
          <Route path="workspaces" element={<Navigate to="/admin/negocios" replace />} />
          <Route path="settings" element={<AdminSettingsPage />} />
        </Route>

        {/* Protected routes */}
        <Route
          element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<DashboardHome />} />
          <Route path="/inbox" element={<InboxPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route
            path="/facturacion"
            element={
              capabilities.showInvoicesModule
                ? <InvoicesPage />
                : <Navigate to="/" replace />
            }
          />
          <Route path="/stock" element={<StockPage />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/metrics" element={<MetricsPage />} />
          <Route
            path="/debts"
            element={
              capabilities.showDebtsModule
                ? <DebtsPage />
                : <Navigate to="/" replace />
            }
          />
          <Route path="/settings/*" element={<SettingsPage />} />
        </Route>

        {/* Catch all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppRoutes />
        <ToastContainer />
      </AuthProvider>
    </ThemeProvider>
  );
}
