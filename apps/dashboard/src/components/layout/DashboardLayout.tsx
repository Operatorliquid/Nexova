import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { QuickActionsFloat } from '../QuickActionsFloat';
import { modules } from '../../config/modules';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { getWorkspaceCommerceCapabilities } from '../../lib/commerce-plan';
import { AnimatePresence, motion } from '../ui/motion';

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
            <div className="absolute top-0 -left-40 w-96 h-96 bg-[#4f46e5]/20 rounded-full blur-[150px]" />
            <div className="absolute bottom-0 -right-40 w-96 h-96 bg-[#7c3aed]/12 rounded-full blur-[150px]" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-[#3b82f6]/8 rounded-full blur-[200px]" />
            <div className="absolute top-1/4 right-1/4 w-72 h-72 bg-[#06b6d4]/8 rounded-full blur-[180px]" />
            <div className="absolute bottom-1/3 left-1/3 w-64 h-64 bg-[#8b5cf6]/6 rounded-full blur-[180px]" />
          </>
        ) : (
          <>
            <div className="absolute top-0 -left-40 w-96 h-96 bg-[#4f46e5]/10 rounded-full blur-[150px]" />
            <div className="absolute bottom-0 -right-40 w-96 h-96 bg-[#7c3aed]/8 rounded-full blur-[150px]" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-[#3b82f6]/5 rounded-full blur-[200px]" />
            <div className="absolute top-1/4 right-1/4 w-72 h-72 bg-[#06b6d4]/5 rounded-full blur-[180px]" />
            <div className="absolute bottom-1/3 left-1/3 w-64 h-64 bg-[#8b5cf6]/4 rounded-full blur-[180px]" />
          </>
        )}
      </div>

      <Sidebar />

      <div className="flex-1 flex flex-col overflow-hidden">
        <Header title={title} />
        <main className="flex-1 overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="h-full"
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Floating Quick Actions */}
      {capabilities.showQuickActions && <QuickActionsFloat />}
    </div>
  );
}
