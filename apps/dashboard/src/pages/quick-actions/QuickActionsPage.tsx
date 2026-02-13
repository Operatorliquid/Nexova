/**
 * Quick Actions Page
 * Allows staff to execute commands via natural language
 */
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, AnimatedPage } from '../../components/ui';
import { useAuth } from '../../contexts/AuthContext';
import { cn } from '../../lib/utils';
import { QuickActionToolResult } from '../../components/quick-actions/QuickActionToolResult';

const API_URL = import.meta.env.VITE_API_URL || '';

const fetchWithCredentials = (input: RequestInfo | URL, init?: RequestInit) => fetch(input, {
  ...init,
  credentials: 'include',
});

interface CommandSuggestion {
  command: string;
  example: string;
  description: string;
}

interface ToolExecutionResult {
  toolName: string;
  success: boolean;
  data?: unknown;
  error?: string;
  durationMs: number;
}

interface ConfirmationRequest {
  token: string;
  expiresAt: string;
  tools: Array<{
    name: string;
    input: Record<string, unknown>;
    riskLevel: string;
    description: string;
  }>;
  warningMessage: string;
}

interface QuickActionUIAction {
  type: 'navigate' | 'open_url' | 'execute_command';
  label: string;
  path?: string;
  query?: Record<string, string>;
  url?: string;
  command?: string;
  requiresConfirmation?: boolean;
  confirmationMessage?: string;
  auto?: boolean;
}

interface QuickActionResult {
  id: string;
  status: 'success' | 'pending_confirmation' | 'error' | 'denied';
  command: string;
  parsedTools: Array<{ toolName: string; input: Record<string, unknown> }>;
  results?: ToolExecutionResult[];
  confirmationRequired?: ConfirmationRequest;
  error?: string;
  summary?: string;
  explanation?: string;
  uiActions?: QuickActionUIAction[];
  executedAt?: string;
}

interface HistoryItem {
  id: string;
  command: string;
  status: string;
  toolsCalled: string[];
  resultSummary: string;
  executedAt: string;
  executedBy: string;
  canRerun: boolean;
}

export default function QuickActionsPage() {
  const { workspace } = useAuth();
  const navigate = useNavigate();
  const [command, setCommand] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [result, setResult] = useState<QuickActionResult | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [suggestions, setSuggestions] = useState<CommandSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<ConfirmationRequest | null>(null);
  const [pendingAction, setPendingAction] = useState<QuickActionUIAction | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoActionRef = useRef<string | null>(null);

  // Fetch suggestions on mount
  useEffect(() => {
    const fetchSuggestions = async () => {
      try {
        const res = await fetchWithCredentials(`${API_URL}/api/v1/quick-actions/suggestions`, {
          headers: {
            'X-Workspace-Id': workspace?.id || '',
          },
        });
        if (res.ok) {
          const data = await res.json();
          setSuggestions(data.suggestions || []);
        }
      } catch (err) {
        console.error('Failed to fetch suggestions:', err);
      }
    };

    if (workspace?.id) {
      fetchSuggestions();
      fetchHistory();
    }
  }, [workspace?.id]);

  const fetchHistory = async () => {
    try {
      const res = await fetchWithCredentials(`${API_URL}/api/v1/quick-actions/history?limit=20`, {
        headers: {
          'X-Workspace-Id': workspace?.id || '',
        },
      });
      if (res.ok) {
        const data = await res.json();
        setHistory(data.history || []);
      }
    } catch (err) {
      console.error('Failed to fetch history:', err);
    }
  };

  const executeCommand = async (
    cmd: string,
    confirmationToken?: string,
    skipConfirmation?: boolean
  ) => {
    if (!cmd.trim() && !confirmationToken) return;

    setIsExecuting(true);
    setResult(null);
    setPendingAction(null);

    try {
      const res = await fetchWithCredentials(`${API_URL}/api/v1/quick-actions/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Workspace-Id': workspace?.id || '',
        },
        body: JSON.stringify({
          command: cmd,
          confirmationToken,
          skipConfirmation,
        }),
      });

      const data = await res.json();

      if (data.status === 'pending_confirmation') {
        setPendingConfirmation(data.confirmationRequired);
      } else {
        setResult(data);
        setPendingConfirmation(null);
        fetchHistory();
      }

      if (data.status === 'success') {
        setCommand('');
      }
    } catch (err) {
      setResult({
        id: '',
        status: 'error',
        command: cmd,
        parsedTools: [],
        error: err instanceof Error ? err.message : 'Error de conexion',
      });
    } finally {
      setIsExecuting(false);
    }
  };

  const handleAction = (action: QuickActionUIAction) => {
    if (action.type === 'navigate' && action.path) {
      const query = action.query ? `?${new URLSearchParams(action.query).toString()}` : '';
      navigate(`${action.path}${query}`);
      return;
    }
    if (action.type === 'open_url' && action.url) {
      window.open(action.url, '_blank');
      return;
    }
    if (action.type === 'execute_command' && action.command) {
      setCommand(action.command);
      if (action.requiresConfirmation) {
        setPendingAction(action);
        return;
      }
      executeCommand(action.command);
    }
  };

  useEffect(() => {
    if (!result?.uiActions?.length || result.status !== 'success') return;
    const autoAction = result.uiActions.find((action) => action.auto);
    if (!autoAction) return;
    if (autoActionRef.current === result.id) return;
    autoActionRef.current = result.id;
    handleAction(autoAction);
  }, [result]);

  const handleConfirm = () => {
    if (pendingConfirmation) {
      executeCommand(command, pendingConfirmation.token);
    }
  };

  const handleInlineConfirm = () => {
    if (!pendingAction?.command) return;
    const nextCommand = pendingAction.command;
    setPendingAction(null);
    executeCommand(nextCommand, undefined, true);
  };

  const handleCancel = () => {
    setPendingConfirmation(null);
    setResult({
      id: '',
      status: 'error',
      command,
      parsedTools: [],
      error: 'Accion cancelada',
    });
  };

  const handleRerun = async (actionId: string) => {
    setIsExecuting(true);
    try {
      const res = await fetchWithCredentials(`${API_URL}/api/v1/quick-actions/${actionId}/rerun`, {
        method: 'POST',
        headers: {
          'X-Workspace-Id': workspace?.id || '',
        },
      });
      const data = await res.json();
      setResult(data);
      fetchHistory();
    } catch (err) {
      console.error('Rerun failed:', err);
    } finally {
      setIsExecuting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      executeCommand(command);
    }
    if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  const handleSuggestionClick = (suggestion: CommandSuggestion) => {
    setCommand(suggestion.example);
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const filteredSuggestions = suggestions.filter(
    (s) =>
      command.length > 0 &&
      (s.command.toLowerCase().includes(command.toLowerCase()) ||
        s.example.toLowerCase().includes(command.toLowerCase()))
  );

  return (
    <div className="h-full overflow-y-auto scrollbar-hide p-6">
      <AnimatedPage className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground">Quick Actions</h1>
          <p className="text-muted-foreground">
            Ejecuta acciones rapidas usando comandos en espanol
          </p>
        </div>

        {/* Command Input */}
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="p-5">
            <div className="relative">
              <div className="flex gap-3">
                <div className="flex-1 relative">
                  <Input
                    ref={inputRef}
                    value={command}
                    onChange={(e) => {
                      setCommand(e.target.value);
                      setShowSuggestions(true);
                    }}
                    onKeyDown={handleKeyDown}
                    onFocus={() => setShowSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                    placeholder="Escribe un comando... (ej: buscar cliente Juan, pedidos de hoy)"
                    className="pr-10"
                    disabled={isExecuting}
                  />
                  {isExecuting && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
                    </div>
                  )}
                </div>
                <Button
                  onClick={() => executeCommand(command)}
                  disabled={!command.trim() || isExecuting}
                >
                  Ejecutar
                </Button>
              </div>

              {/* Suggestions Dropdown */}
              {showSuggestions && filteredSuggestions.length > 0 && (
                <div className="absolute z-10 w-full mt-2 glass-card rounded-xl shadow-lg max-h-64 overflow-auto scrollbar-hide">
                  {filteredSuggestions.map((suggestion, idx) => (
                    <button
                      key={idx}
                      className="w-full px-4 py-3 text-left hover:bg-secondary transition-colors border-b border-border last:border-0"
                      onClick={() => handleSuggestionClick(suggestion)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-foreground">{suggestion.command}</span>
                        {suggestion.description.includes('⚠️') && (
                          <span className="text-primary text-xs">Requiere confirmacion</span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">{suggestion.description}</p>
                    </button>
                  ))}
                </div>
              )}

              {/* Empty state suggestions */}
              {showSuggestions && command.length === 0 && suggestions.length > 0 && (
                <div className="absolute z-10 w-full mt-2 glass-card rounded-xl shadow-lg max-h-64 overflow-auto scrollbar-hide">
                  <div className="px-4 py-2 text-xs text-muted-foreground border-b border-border">
                    Comandos disponibles:
                  </div>
                  {suggestions.slice(0, 6).map((suggestion, idx) => (
                    <button
                      key={idx}
                      className="w-full px-4 py-3 text-left hover:bg-secondary transition-colors border-b border-border last:border-0"
                      onClick={() => handleSuggestionClick(suggestion)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-foreground">{suggestion.command}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{suggestion.example}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Confirmation Modal */}
        {pendingConfirmation && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="glass-card rounded-2xl w-full max-w-md mx-4 overflow-hidden">
              <div className="p-5 border-b border-border">
                <h3 className="font-semibold flex items-center gap-2 text-primary">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                  Confirmacion requerida
                </h3>
              </div>
              <div className="p-5 space-y-4">
                <p className="text-muted-foreground">{pendingConfirmation.warningMessage}</p>

                <div className="space-y-2">
                  {pendingConfirmation.tools.map((tool, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-xl bg-primary/10 border border-primary/20"
                    >
                      <div className="font-medium text-primary">{tool.description}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {JSON.stringify(tool.input)}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-border">
                  <Button variant="ghost" onClick={handleCancel}>
                    Cancelar
                  </Button>
                  <Button onClick={handleConfirm} className="bg-primary/90 hover:bg-primary/80">
                    Confirmar
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Result Display */}
        {result && (
          <div className="glass-card rounded-2xl overflow-hidden">
            <div className="p-5 border-b border-border">
              <h3 className="font-semibold flex items-center gap-2">
                {result.status === 'success' && (
                  <span className="text-emerald-400">Exito</span>
                )}
                {result.status === 'error' && <span className="text-red-400">Error</span>}
                {result.status === 'denied' && (
                  <span className="text-primary">Denegado</span>
                )}
              </h3>
            </div>
            <div className="p-5 space-y-4">
              {result.error && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400">
                  {result.error}
                </div>
              )}

              {result.summary && (
                <p className="text-sm text-foreground/90 whitespace-pre-line">
                  {result.summary}
                </p>
              )}
              {result.explanation && result.explanation !== result.summary && (
                <p className="text-xs text-muted-foreground whitespace-pre-line">
                  {result.explanation}
                </p>
              )}

              {result.results && result.results.length > 0 && (
                <div className="space-y-3">
                  {result.results.map((r, idx) => (
                    <div key={idx}>
                      <QuickActionToolResult tool={r} />
                    </div>
                  ))}
                </div>
              )}

              {result.uiActions && result.uiActions.length > 0 && (
                <div className="pt-2 space-y-3">
                  {(() => {
                    const selectionActions = result.uiActions?.filter((action) => action.type === 'execute_command') || [];
                    const otherActions = result.uiActions?.filter((action) => action.type !== 'execute_command') || [];

                    return (
                      <>
                        {selectionActions.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              Elegí un producto
                            </p>
                            <div className="space-y-2">
                              {selectionActions.map((action, idx) => (
                                <button
                                  key={`${action.label}-select-${idx}`}
                                  onClick={() => handleAction(action)}
                                  className="w-full text-left px-4 py-3 rounded-xl border border-border bg-secondary/40 hover:bg-secondary transition-colors"
                                >
                                  <div className="flex items-center justify-between gap-3">
                                    <span className="text-sm font-medium text-foreground">{action.label}</span>
                                    <span className="text-xs text-muted-foreground">Seleccionar</span>
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {pendingAction && (
                          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
                            <p className="text-sm font-medium text-amber-400 mb-1">Confirmar acción</p>
                            <p className="text-xs text-muted-foreground">
                              {pendingAction.confirmationMessage || 'Esta acción requiere confirmación. ¿Continuar?'}
                            </p>
                            <div className="flex gap-2 pt-3">
                              <Button
                                variant="secondary"
                                size="sm"
                                className="flex-1"
                                onClick={() => setPendingAction(null)}
                              >
                                Cancelar
                              </Button>
                              <Button
                                size="sm"
                                className="flex-1"
                                onClick={handleInlineConfirm}
                              >
                                Confirmar
                              </Button>
                            </div>
                          </div>
                        )}

                        {otherActions.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {otherActions.map((action, idx) => (
                              <Button
                                key={`${action.label}-${idx}`}
                                variant="outline"
                                size="sm"
                                onClick={() => handleAction(action)}
                              >
                                {action.label}
                              </Button>
                            ))}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>
        )}

        {/* History */}
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="p-5 border-b border-border">
            <h3 className="font-semibold text-foreground">Historial</h3>
          </div>
          <div className="p-5">
            {history.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                No hay acciones recientes
              </p>
            ) : (
              <div className="space-y-2">
                {history.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-3 rounded-xl bg-secondary hover:bg-secondary-strong transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'w-2 h-2 rounded-full shrink-0',
                            item.status === 'success'
                              ? 'bg-emerald-500'
                              : item.status === 'error'
                                ? 'bg-red-500'
                                : 'bg-primary'
                          )}
                        />
                        <span className="font-mono text-sm truncate text-foreground">{item.command}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                        <span>{new Date(item.executedAt).toLocaleString('es-AR')}</span>
                        <span>•</span>
                        <span className="truncate">{item.resultSummary || item.toolsCalled.join(', ')}</span>
                      </div>
                    </div>
                    {item.canRerun && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRerun(item.id)}
                        disabled={isExecuting}
                      >
                        Re-run
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </AnimatedPage>
    </div>
  );
}
