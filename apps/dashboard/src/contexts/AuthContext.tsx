/**
 * Auth Context
 * Manages authentication state and user session
 */
import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { authEvents } from '../lib/auth-events';
import { clearTokens, API_URL } from '../lib/api';

export interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
  isSuperAdmin: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  plan?: string;
  status?: string;
  role: {
    id: string;
    name: string;
    permissions: string[];
  };
  onboardingCompleted?: boolean;
  businessType?: string;
}

export interface AuthState {
  user: User | null;
  workspace: Workspace | null;
  workspaces: Workspace[];
  isAuthenticated: boolean;
  isLoading: boolean;
}

export interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
  switchWorkspace: (workspaceId: string) => void;
  refreshUser: () => Promise<void>;
}

export interface RegisterData {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    workspace: null,
    workspaces: [],
    isAuthenticated: false,
    isLoading: true,
  });

  async function safeJson<T = any>(response: Response): Promise<T | null> {
    try {
      return (await response.json()) as T;
    } catch {
      return null;
    }
  }

  const checkAuth = useCallback(async () => {
    try {
      const currentWorkspaceId = localStorage.getItem('currentWorkspace') || undefined;
      const headers: Record<string, string> = {};
      if (currentWorkspaceId) {
        headers['X-Workspace-Id'] = currentWorkspaceId;
      }

      const response = await fetch(`${API_URL}/api/v1/auth/me`, {
        credentials: 'include',
        headers,
      });

      if (response.ok) {
        const data = await safeJson<any>(response);
        if (!data?.user) {
          // Avoid crashing the app if the server/proxy returns an empty body.
          setState(prev => ({ ...prev, isLoading: false, isAuthenticated: false }));
          return;
        }
        setState({
          user: data.user,
          workspace: data.workspace,
          workspaces: data.workspaces || [],
          isAuthenticated: true,
          isLoading: false,
        });

        if (data.workspace?.id) {
          localStorage.setItem('currentWorkspace', data.workspace.id);
        }
      } else if (response.status === 401) {
        const refreshResponse = await fetch(`${API_URL}/api/v1/auth/refresh`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
          credentials: 'include',
        });

        if (refreshResponse.ok) {
          await refreshResponse.json().catch(() => ({}));
          await checkAuth();
        } else {
          setState(prev => ({ ...prev, isLoading: false, isAuthenticated: false }));
        }
      } else {
        setState(prev => ({ ...prev, isLoading: false }));
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, []);

  // Check for existing session on mount
  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // Subscribe to auth events from api.ts
  useEffect(() => {
    const handleSessionExpired = () => {
      clearTokens();
      setState({
        user: null,
        workspace: null,
        workspaces: [],
        isAuthenticated: false,
        isLoading: false,
      });
      // Redirect to login if not already there
      if (window.location.pathname !== '/login' && window.location.pathname !== '/register') {
        window.location.href = '/login';
      }
    };

    const handleTokensUpdated = () => {
      // Re-verify user when tokens are refreshed
      checkAuth();
    };

    const handleWorkspaceSuspended = () => {
      // Fetch latest workspace status so the UI can show the paywall.
      checkAuth();
    };

    const unsubscribeSessionExpired = authEvents.on('session-expired', handleSessionExpired);
    const unsubscribeTokensUpdated = authEvents.on('tokens-updated', handleTokensUpdated);
    const unsubscribeWorkspaceSuspended = authEvents.on(
      'workspace-suspended',
      handleWorkspaceSuspended
    );

    return () => {
      unsubscribeSessionExpired();
      unsubscribeTokensUpdated();
      unsubscribeWorkspaceSuspended();
    };
  }, [checkAuth]);

  async function login(email: string, password: string) {
    const response = await fetch(`${API_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await safeJson<any>(response);
      throw new Error(error?.message || 'Error al iniciar sesión');
    }

    const data = await safeJson<any>(response);
    if (!data?.user) {
      // Some proxies can return 200 with an empty body; fall back to `/me`.
      await checkAuth();
      return;
    }
    if (data.workspace?.id) {
      localStorage.setItem('currentWorkspace', data.workspace.id);
    }
    setState({
      user: data.user,
      workspace: data.workspace,
      workspaces: data.workspaces || [],
      isAuthenticated: true,
      isLoading: false,
    });
  }

  async function register(registerData: RegisterData) {
    const response = await fetch(`${API_URL}/api/v1/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(registerData),
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await safeJson<any>(response);
      throw new Error(error?.message || 'Error al registrarse');
    }

    const data = await safeJson<any>(response);
    if (!data?.user) {
      await checkAuth();
      return;
    }
    if (data.workspace?.id) {
      localStorage.setItem('currentWorkspace', data.workspace.id);
    }
    setState({
      user: data.user,
      workspace: data.workspace,
      workspaces: data.workspaces || [],
      isAuthenticated: true,
      isLoading: false,
    });
  }

  async function logout() {
    try {
      await fetch(`${API_URL}/api/v1/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
        credentials: 'include',
      });
    } catch (error) {
      console.error('Logout error:', error);
    }

    clearTokens();

    setState({
      user: null,
      workspace: null,
      workspaces: [],
      isAuthenticated: false,
      isLoading: false,
    });
  }

  function switchWorkspace(workspaceId: string) {
    const workspace = state.workspaces.find(w => w.id === workspaceId);
    if (workspace) {
      setState(prev => ({ ...prev, workspace }));
      localStorage.setItem('currentWorkspace', workspaceId);
    }
  }

  async function refreshUser() {
    await checkAuth();
  }

  return (
    <AuthContext.Provider
      value={{
        ...state,
        login,
        register,
        logout,
        switchWorkspace,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export function useUser() {
  const { user } = useAuth();
  return user;
}

export function useWorkspace() {
  const { workspace } = useAuth();
  return workspace;
}

export function usePermissions() {
  const { workspace } = useAuth();
  return workspace?.role.permissions || [];
}

export function hasPermission(permission: string, permissions: string[]): boolean {
  if (permissions.includes('*')) return true;

  const [resource] = permission.split(':');

  return permissions.some(p => {
    if (p === permission) return true;
    if (p === `${resource}:*`) return true;
    return false;
  });
}
