export const API_URL = import.meta.env.VITE_API_URL || '';
export const DASHBOARD_URL = import.meta.env.VITE_DASHBOARD_URL || 'http://localhost:5173';

export async function apiFetch(
  path: string,
  init?: RequestInit
): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.headers || {}),
    },
  });
}

export async function readErrorMessage(
  response: Response,
  fallback: string
): Promise<string> {
  try {
    const payload = (await response.json()) as {
      message?: string;
      error?: string;
    };
    if (payload?.message) return payload.message;
    if (payload?.error) return payload.error;
  } catch {
    // noop
  }
  return fallback;
}
