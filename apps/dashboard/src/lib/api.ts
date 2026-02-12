/**
 * API Fetch Wrapper
 * Handles automatic token refresh on 401 errors
 */

import { authEvents } from './auth-events';

// Default to same-origin so Vite's dev proxy (and Cloudflare tunnel -> Vite) can forward `/api/*` to the API.
// Set `VITE_API_URL` to override (e.g. production).
const API_URL = import.meta.env.VITE_API_URL || '';

let refreshPromise: Promise<boolean> | null = null;

/**
 * Attempt to refresh the access token
 * Returns true if successful, false otherwise
 */
async function refreshToken(): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
      credentials: 'include',
    });

    if (response.ok) {
      await response.json().catch(() => ({}));
      authEvents.emit('tokens-updated');
      return true;
    } else {
      // Refresh failed, emit session expired event
      authEvents.emit('session-expired');
      return false;
    }
  } catch (error) {
    console.error('Token refresh failed:', error);
    authEvents.emit('session-expired');
    return false;
  }
}

/**
 * Clear all auth tokens (called by AuthContext on session-expired)
 */
export function clearTokens() {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('currentWorkspace');
}

/**
 * Get current auth headers
 */
export function getAuthHeaders(workspaceId?: string): Record<string, string> {
  const headers: Record<string, string> = {};

  if (workspaceId) {
    headers['X-Workspace-Id'] = workspaceId;
  }

  return headers;
}

/**
 * API Fetch wrapper with automatic token refresh
 */
export async function apiFetch(
  endpoint: string,
  options: RequestInit = {},
  workspaceId?: string
): Promise<Response> {
  const url = endpoint.startsWith('http') ? endpoint : `${API_URL}${endpoint}`;

  // Build headers
  const headers = new Headers(options.headers);

  // Add workspace ID if provided
  if (workspaceId && !headers.has('X-Workspace-Id')) {
    headers.set('X-Workspace-Id', workspaceId);
  }

  // Add content-type for JSON if body is present and not FormData
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  // Make the request
  let response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  // If 401, try to refresh token and retry
  if (response.status === 401) {
    // Prevent multiple simultaneous refresh attempts
    // Use existing promise if refresh is already in progress
    if (!refreshPromise) {
      refreshPromise = refreshToken().finally(() => {
        // Clear the promise only after all awaiting calls have resolved
        // Use setTimeout to ensure this happens after the current microtask
        setTimeout(() => {
          refreshPromise = null;
        }, 0);
      });
    }

    const refreshed = await refreshPromise;

    if (refreshed) {
      response = await fetch(url, {
        ...options,
        headers,
        credentials: 'include',
      });
    }
  }

  if (response.status === 402) {
    authEvents.emit('workspace-suspended');
  }

  return response;
}

/**
 * Convenience methods for common HTTP verbs
 */
export const api = {
  get: (endpoint: string, workspaceId?: string) =>
    apiFetch(endpoint, { method: 'GET' }, workspaceId),

  post: (endpoint: string, body?: unknown, workspaceId?: string) =>
    apiFetch(endpoint, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    }, workspaceId),

  patch: (endpoint: string, body?: unknown, workspaceId?: string) =>
    apiFetch(endpoint, {
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    }, workspaceId),

  put: (endpoint: string, body?: unknown, workspaceId?: string) =>
    apiFetch(endpoint, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    }, workspaceId),

  delete: (endpoint: string, workspaceId?: string) =>
    apiFetch(endpoint, { method: 'DELETE' }, workspaceId),
};

export { API_URL };
