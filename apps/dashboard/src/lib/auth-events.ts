/**
 * Auth Event Emitter
 * Synchronizes authentication events between api.ts and AuthContext
 */

type AuthEventType = 'tokens-updated' | 'session-expired' | 'workspace-suspended';
type AuthEventCallback = () => void;

class AuthEventEmitter {
  private listeners: Map<AuthEventType, Set<AuthEventCallback>> = new Map();

  on(event: AuthEventType, callback: AuthEventCallback): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    return () => this.off(event, callback);
  }

  off(event: AuthEventType, callback: AuthEventCallback): void {
    this.listeners.get(event)?.delete(callback);
  }

  emit(event: AuthEventType): void {
    this.listeners.get(event)?.forEach(cb => cb());
  }
}

export const authEvents = new AuthEventEmitter();
