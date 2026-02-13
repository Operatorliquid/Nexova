/**
 * Admin Panel Layout
 * Same aesthetic as main dashboard but with admin navigation
 */
import { Outlet, NavLink, Navigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, Users, MessageCircle, Building2, Settings, LogOut, Shield, CreditCard } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuth } from '../../contexts/AuthContext';
import { AnimatePresence, motion } from '../../components/ui/motion';

const adminNav = [
  { name: 'Dashboard', href: '/admin', icon: LayoutDashboard },
  { name: 'Usuarios', href: '/admin/users', icon: Users },
  { name: 'WhatsApp', href: '/admin/whatsapp', icon: MessageCircle },
  { name: 'Negocios', href: '/admin/negocios', icon: Building2 },
  { name: 'Cobros', href: '/admin/billing', icon: CreditCard },
  { name: 'Configuración', href: '/admin/settings', icon: Settings },
];

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();

  // Redirect non-admins
  if (!user?.isSuperAdmin) {
    return <Navigate to="/" replace />;
  }

  const userInitials = user?.firstName && user?.lastName
    ? `${user.firstName[0]}${user.lastName[0]}`
    : user?.email?.substring(0, 2).toUpperCase() || 'SA';

  const userName = user?.firstName && user?.lastName
    ? `${user.firstName} ${user.lastName}`
    : 'Super Admin';

  return (
    <div className="min-h-screen bg-background">
      {/* Background gradient */}
      <div className="fixed inset-0 -z-10">
        <div className="absolute top-0 -left-40 w-80 h-80 bg-primary/20 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 -right-40 w-80 h-80 bg-primary/10 rounded-full blur-[120px]" />
      </div>

      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-50 w-64 glass-card border-r border-border">
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="flex items-center h-16 px-6 border-b border-border">
            <div className="flex items-center gap-3">
              <img
                src="/brand/logo-light.svg"
                alt="Nexova"
                className="h-7 w-auto block dark:hidden"
              />
              <img
                src="/brand/logo-dark.svg"
                alt="Nexova"
                className="h-7 w-auto hidden dark:block"
              />
              <span className="text-xs px-1.5 py-0.5 rounded-lg bg-primary/15 text-primary font-medium">
                Admin
              </span>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto scrollbar-hide">
            {adminNav.map((item) => (
              <NavLink
                key={item.name}
                to={item.href}
                end={item.href === '/admin'}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200',
                    isActive
                      ? 'bg-primary/15 text-primary border border-primary/20'
                      : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                  )
                }
              >
                <item.icon className="w-5 h-5" />
                <span>{item.name}</span>
              </NavLink>
            ))}
          </nav>

          {/* User section */}
          <div className="p-4 border-t border-border">
            <div className="flex items-center gap-3 p-2 rounded-xl bg-secondary">
              <div className="w-9 h-9 rounded-xl bg-primary/20 flex items-center justify-center">
                <span className="text-sm font-semibold text-primary">{userInitials}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{userName}</p>
                <p className="text-[11px] text-muted-foreground truncate">{user?.email}</p>
              </div>
            </div>
            <button
              onClick={logout}
              className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-all duration-200"
            >
              <LogOut className="w-4 h-4" />
              Cerrar sesión
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="pl-64 h-screen flex flex-col overflow-hidden">
        <header className="flex-shrink-0 h-16 border-b border-border bg-background/80 backdrop-blur-sm">
          <div className="flex items-center justify-between h-full px-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
                <Shield className="w-4 h-4 text-primary" />
              </div>
              <h1 className="text-xl font-semibold text-foreground">Panel de Administración</h1>
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto scrollbar-hide p-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
