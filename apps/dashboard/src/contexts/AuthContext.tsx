/**
 * Auth Context
 * Manages authentication state and user session
 */
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';

import { clearTokens, API_URL } from '../lib/api';
import { authEvents } from '../lib/auth-events';

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
  login: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
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

type JsonRecord = Record<string, unknown>;

interface ParsedAuthPayload {
  user: User | null;
  workspace: Workspace | null;
  workspaces: Workspace[];
}

const EMPTY_AUTH_STATE: AuthState = {
  user: null,
  workspace: null,
  workspaces: [],
  isAuthenticated: false,
  isLoading: false,
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(record: JsonRecord | null, key: string): string | undefined {
  if (!record) {
    return undefined;
  }
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function readBoolean(record: JsonRecord | null, key: string): boolean | undefined {
  if (!record) {
    return undefined;
  }
  const value = record[key];
  return typeof value === 'boolean' ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

async function safeJsonRecord(response: Response): Promise<JsonRecord | null> {
  try {
    const payload: unknown = await response.json();
    return isRecord(payload) ? payload : null;
  } catch {
    return null;
  }
}

function parseUser(value: unknown): User | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value, 'id');
  const email = readString(value, 'email');
  if (!id || !email) {
    return null;
  }

  return {
    id,
    email,
    firstName: readString(value, 'firstName'),
    lastName: readString(value, 'lastName'),
    avatarUrl: readString(value, 'avatarUrl'),
    isSuperAdmin: readBoolean(value, 'isSuperAdmin') ?? false,
  };
}

function parseWorkspaceRole(value: unknown): Workspace['role'] {
  if (!isRecord(value)) {
    return {
      id: '',
      name: '',
      permissions: [],
    };
  }

  return {
    id: readString(value, 'id') ?? '',
    name: readString(value, 'name') ?? '',
    permissions: readStringArray(value.permissions),
  };
}

function parseWorkspace(value: unknown): Workspace | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value, 'id');
  if (!id) {
    return null;
  }

  return {
    id,
    name: readString(value, 'name') ?? 'Workspace',
    slug: readString(value, 'slug') ?? id,
    plan: readString(value, 'plan'),
    status: readString(value, 'status'),
    role: parseWorkspaceRole(value.role),
    onboardingCompleted: readBoolean(value, 'onboardingCompleted'),
    businessType: readString(value, 'businessType'),
  };
}

function parseWorkspaces(value: unknown): Workspace[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(item => parseWorkspace(item))
    .filter((workspace): workspace is Workspace => workspace !== null);
}

function parseAuthPayload(payload: JsonRecord | null): ParsedAuthPayload {
  if (!payload) {
    return {
      user: null,
      workspace: null,
      workspaces: [],
    };
  }

  const workspace = parseWorkspace(payload.workspace);
  return {
    user: parseUser(payload.user),
    workspace,
    workspaces: parseWorkspaces(payload.workspaces),
  };
}

function readErrorMessage(payload: JsonRecord | null, fallback: string): string {
  return readString(payload, 'message') ?? readString(payload, 'error') ?? fallback;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const [state, setState] = useState<AuthState>({
    ...EMPTY_AUTH_STATE,
    isLoading: true,
  });

  const clearAuthState = useCallback((isLoading: boolean): void => {
    setState({
      ...EMPTY_AUTH_STATE,
      isLoading,
    });
  }, []);

  const applyAuthenticatedState = useCallback(
    (payload: ParsedAuthPayload): void => {
      if (!payload.user) {
        clearAuthState(false);
        return;
      }

      setState({
        user: payload.user,
        workspace: payload.workspace,
        workspaces: payload.workspaces,
        isAuthenticated: true,
        isLoading: false,
      });

      if (payload.workspace?.id) {
        localStorage.setItem('currentWorkspace', payload.workspace.id);
      }
    },
    [clearAuthState]
  );

  const checkAuth = useCallback(async (): Promise<void> => {
    try {
      const currentWorkspaceId = localStorage.getItem('currentWorkspace') ?? undefined;
      const headers: Record<string, string> = {};
      if (currentWorkspaceId) {
        headers['X-Workspace-Id'] = currentWorkspaceId;
      }

      const fetchMe = async (): Promise<{ response: Response; payload: JsonRecord | null }> => {
        const response = await fetch(`${API_URL}/api/v1/auth/me`, {
          credentials: 'include',
          headers,
        });

        return {
          response,
          payload: await safeJsonRecord(response),
        };
      };

      let { response, payload } = await fetchMe();

      if (response.status === 401) {
        const refreshResponse = await fetch(`${API_URL}/api/v1/auth/refresh`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
          credentials: 'include',
        });

        await safeJsonRecord(refreshResponse);
        if (refreshResponse.ok) {
          ({ response, payload } = await fetchMe());
        }
      }

      if (response.ok) {
        applyAuthenticatedState(parseAuthPayload(payload));
        return;
      }

      if (response.status === 401) {
        clearAuthState(false);
        return;
      }

      setState(prev => ({ ...prev, isLoading: false }));
    } catch (error) {
      console.error('Auth check failed:', error);
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, [applyAuthenticatedState, clearAuthState]);

  // Check for existing session on mount
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void checkAuth();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [checkAuth]);

  // Subscribe to auth events from api.ts
  useEffect(() => {
    const handleSessionExpired = (): void => {
      clearTokens();
      clearAuthState(false);
      // Redirect to login if not already there
      if (window.location.pathname !== '/login' && window.location.pathname !== '/register') {
        window.location.href = '/login';
      }
    };

    const handleTokensUpdated = (): void => {
      // Re-verify user when tokens are refreshed
      void checkAuth();
    };

    const handleWorkspaceSuspended = (): void => {
      // Fetch latest workspace status so the UI can show the paywall.
      void checkAuth();
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
  }, [checkAuth, clearAuthState]);

  async function login(email: string, password: string, rememberMe: boolean = true): Promise<void> {
    const response = await fetch(`${API_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password, rememberMe }),
      credentials: 'include',
    });

    if (!response.ok) {
      const errorPayload = await safeJsonRecord(response);
      throw new Error(readErrorMessage(errorPayload, 'Error al iniciar sesion'));
    }

    const payload = parseAuthPayload(await safeJsonRecord(response));
    if (!payload.user) {
      // Some proxies can return 200 with an empty body; fall back to `/me`.
      await checkAuth();
      return;
    }

    applyAuthenticatedState(payload);
  }

  async function register(registerData: RegisterData): Promise<void> {
    const response = await fetch(`${API_URL}/api/v1/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(registerData),
      credentials: 'include',
    });

    if (!response.ok) {
      const errorPayload = await safeJsonRecord(response);
      throw new Error(readErrorMessage(errorPayload, 'Error al registrarse'));
    }

    const payload = parseAuthPayload(await safeJsonRecord(response));
    if (!payload.user) {
      await checkAuth();
      return;
    }

    applyAuthenticatedState(payload);
  }

  async function logout(): Promise<void> {
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
    clearAuthState(false);
  }

  function switchWorkspace(workspaceId: string): void {
    const workspace = state.workspaces.find(w => w.id === workspaceId);
    if (workspace) {
      setState(prev => ({ ...prev, workspace }));
      localStorage.setItem('currentWorkspace', workspaceId);
    }
  }

  async function refreshUser(): Promise<void> {
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

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export function useUser(): User | null {
  const { user } = useAuth();
  return user;
}

export function useWorkspace(): Workspace | null {
  const { workspace } = useAuth();
  return workspace;
}

export function usePermissions(): string[] {
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
