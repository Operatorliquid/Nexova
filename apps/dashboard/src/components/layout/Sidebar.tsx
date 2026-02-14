import { NavLink } from 'react-router-dom';
import { cn } from '../../lib/utils';
import { ModuleIcon } from '../ui';
import { useAuth } from '../../contexts/AuthContext';
import { getModulesForBusinessType, modules as moduleConfig } from '../../config/modules';
import { getWorkspaceCommerceCapabilities } from '../../lib/commerce-plan';

export function Sidebar() {
  const { user, workspace, logout } = useAuth();
  const capabilities = getWorkspaceCommerceCapabilities(workspace);

  // Get business type from workspace settings, default to 'commerce'
  const businessType = (workspace as any)?.businessType || 'commerce';

  // Get modules for this business type
  const availableModules = getModulesForBusinessType(businessType).filter((module) => {
    if (module.id === 'invoices' && !capabilities.showInvoicesModule) return false;
    if (module.id === 'debts' && !capabilities.showDebtsModule) return false;
    return true;
  });

  // Separate main modules from settings
  const mainModules = availableModules.filter(m => m.id !== 'settings');
  const settingsModule = moduleConfig.settings;

  // Get user initials
  const userInitials = user?.firstName && user?.lastName
    ? `${user.firstName[0]}${user.lastName[0]}`
    : user?.email?.substring(0, 2).toUpperCase() || 'U';

  const userName = user?.firstName && user?.lastName
    ? `${user.firstName} ${user.lastName}`
    : user?.email || 'Usuario';

  return (
    <aside className="w-64 flex-shrink-0 h-full glass-card border-r border-border">
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
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto scrollbar-hide">
          {mainModules.map((module) => (
            <NavLink
              key={module.id}
              to={module.path}
              end={module.path === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200',
                  isActive
                    ? 'sidebar-active text-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                )
              }
            >
              <ModuleIcon name={module.icon} />
              <span>{module.name}</span>
            </NavLink>
          ))}
        </nav>

        {/* Secondary navigation (Settings) */}
        <div className="px-3 py-4 border-t border-border space-y-1">
          <NavLink
            to={settingsModule.path}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200',
                isActive
                  ? 'bg-primary/15 text-primary border border-primary/20'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              )
            }
          >
            <ModuleIcon name={settingsModule.icon} />
            <span>{settingsModule.name}</span>
          </NavLink>
        </div>

        {/* User section */}
        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-3 p-2 rounded-xl bg-secondary">
            <div className="w-9 h-9 rounded-xl bg-primary/20 flex items-center justify-center overflow-hidden">
              {user?.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt="Foto de perfil"
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-sm font-semibold text-primary">{userInitials}</span>
              )}
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
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Cerrar sesion
          </button>
        </div>
      </div>
    </aside>
  );
}
