import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { modules } from '../../config/modules';
import { useAuth } from '../../contexts/AuthContext';
import { getWorkspaceCommerceCapabilities } from '../../lib/commerce-plan';
import { QuickActionsFloat } from '../QuickActionsFloat';
import { AnimatePresence, motion } from '../ui/motion';

export function DashboardLayout(): JSX.Element {
  const location = useLocation();
  const { workspace } = useAuth();
  const capabilities = getWorkspaceCommerceCapabilities(workspace);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Close sidebar on route change
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setSidebarOpen(false);
    }, 0);
    return () => {
      clearTimeout(timeoutId);
    };
  }, [location.pathname]);

  // Get title from module config
  const currentModule = Object.values(modules).find(m => m.path === location.pathname);
  const title = currentModule?.name || '';

  return (
    <div className="h-dvh bg-background overflow-hidden flex">
      {/* Background gradient - tones defined via CSS variables in globals.css */}
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute top-0 -left-40 w-96 h-96 rounded-full blur-[150px]" style={{ background: 'var(--orb-primary)' }} />
        <div className="absolute bottom-0 -right-40 w-96 h-96 rounded-full blur-[150px]" style={{ background: 'var(--orb-warm)' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] rounded-full blur-[200px]" style={{ background: 'var(--orb-core)' }} />
        <div className="absolute top-1/4 right-1/4 w-72 h-72 rounded-full blur-[180px]" style={{ background: 'var(--orb-amber)' }} />
        <div className="absolute bottom-1/3 left-1/3 w-64 h-64 rounded-full blur-[180px]" style={{ background: 'var(--orb-deep)' }} />
      </div>

      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <Header title={title} onMenuClick={() => setSidebarOpen(true)} />
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
