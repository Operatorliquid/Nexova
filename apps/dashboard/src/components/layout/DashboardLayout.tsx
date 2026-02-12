import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { QuickActionsFloat } from '../QuickActionsFloat';
import { modules } from '../../config/modules';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { getWorkspaceCommerceCapabilities } from '../../lib/commerce-plan';

export function DashboardLayout() {
  const location = useLocation();
  const { theme } = useTheme();
  const { workspace } = useAuth();
  const capabilities = getWorkspaceCommerceCapabilities(workspace);

  // Get title from module config
  const currentModule = Object.values(modules).find(m => m.path === location.pathname);
  const title = currentModule?.name || '';

  return (
    <div className="h-screen bg-background overflow-hidden flex">
      {/* Background gradient - adapts to theme */}
      <div className="fixed inset-0 -z-10 overflow-hidden">
        {theme === 'dark' ? (
          <>
            <div className="absolute top-0 -left-40 w-96 h-96 bg-[#4236c4]/15 rounded-full blur-[150px]" />
            <div className="absolute bottom-0 -right-40 w-96 h-96 bg-[#4236c4]/10 rounded-full blur-[150px]" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-[#4236c4]/5 rounded-full blur-[200px]" />
          </>
        ) : (
          <>
            <div className="absolute top-0 -left-40 w-96 h-96 bg-[#4236c4]/8 rounded-full blur-[150px]" />
            <div className="absolute bottom-0 -right-40 w-96 h-96 bg-[#4236c4]/6 rounded-full blur-[150px]" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-[#4236c4]/3 rounded-full blur-[200px]" />
          </>
        )}
      </div>

      <Sidebar />

      <div className="flex-1 flex flex-col overflow-hidden">
        <Header title={title} />
        <main className="flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>

      {/* Floating Quick Actions */}
      {capabilities.showQuickActions && <QuickActionsFloat />}
    </div>
  );
}
