/**
 * Quick Actions Floating Button
 * A floating command panel accessible throughout the dashboard
 */
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CheckCircle, Command, Search, X, XCircle, Zap } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { cn } from '../lib/utils';
import { Button } from './ui';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { QuickActionToolResult } from './quick-actions/QuickActionToolResult';

const API_URL = import.meta.env.VITE_API_URL || '';

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

const sanitizeQuickActionText = (value?: string) => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      JSON.parse(trimmed);
      return undefined;
    } catch {
      // fallthrough
    }
  }
  return value;
};

export function QuickActionsFloat() {
  const { workspace } = useAuth();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [command, setCommand] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [result, setResult] = useState<QuickActionResult | null>(null);
  const [suggestions, setSuggestions] = useState<CommandSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<ConfirmationRequest | null>(null);
  const [pendingAction, setPendingAction] = useState<QuickActionUIAction | null>(null);
  const [showResultModal, setShowResultModal] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const shouldShowResultsInModal = (data: QuickActionResult | null) => Boolean(data);

  // Fetch suggestions on mount
  useEffect(() => {
    const fetchSuggestions = async () => {
      try {
        const res = await fetch(`${API_URL}/api/v1/quick-actions/suggestions`, {
          headers: {
            'X-Workspace-Id': workspace?.id || '',
          },
          credentials: 'include',
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
    }
  }, [workspace?.id]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  useEffect(() => {
    if (!showResultModal) {
      setPendingAction(null);
    }
  }, [showResultModal]);

  // Keyboard shortcut (Cmd/Ctrl + K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const executeCommand = async (
    cmd: string,
    confirmationToken?: string,
    skipConfirmation?: boolean
  ) => {
    if (!cmd.trim() && !confirmationToken) return;

    setIsExecuting(true);
    setResult(null);
    setShowResultModal(false);
    setPendingConfirmation(null);
    setPendingAction(null);

    try {
      const res = await fetch(`${API_URL}/api/v1/quick-actions/execute`, {
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
        credentials: 'include',
      });

      const data: QuickActionResult = await res.json();

      if (data.status === 'pending_confirmation' && data.confirmationRequired) {
        setPendingConfirmation(data.confirmationRequired);
      } else {
        setResult(data);
        if (shouldShowResultsInModal(data)) {
          setShowResultModal(true);
          setIsOpen(false);
        }
        if (data.status === 'success') {
          setCommand('');
        }
      }
    } catch (err) {
      const errorResult: QuickActionResult = {
        id: '',
        status: 'error',
        command: cmd,
        parsedTools: [],
        error: 'Error de conexión',
      };
      setResult(errorResult);
      if (shouldShowResultsInModal(errorResult)) {
        setShowResultModal(true);
        setIsOpen(false);
      }
    } finally {
      setIsExecuting(false);
    }
  };

  const handleAction = (action: QuickActionUIAction) => {
    if (action.type === 'navigate' && action.path) {
      const query = action.query ? `?${new URLSearchParams(action.query).toString()}` : '';
      navigate(`${action.path}${query}`);
      setIsOpen(false);
      setShowResultModal(false);
      return;
    }
    if (action.type === 'open_url' && action.url) {
      window.open(action.url, '_blank');
      setShowResultModal(false);
      return;
    }
    if (action.type === 'execute_command' && action.command) {
      setCommand(action.command);
      if (action.requiresConfirmation) {
        setPendingAction(action);
        return;
      }
      executeCommand(action.command);
      return;
    }
  };

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
    <>
      {/* Floating Button */}
      <button
        onClick={() => setIsOpen(true)}
        className={cn(
          'fixed bottom-6 right-6 z-50 w-14 h-14 rounded-2xl',
          'bg-primary text-white',
          'shadow-xl shadow-primary/30',
          'flex items-center justify-center',
          'transition-all duration-300 ease-out',
          'hover:scale-105 hover:shadow-2xl hover:shadow-primary/40',
          'active:scale-95',
          isOpen && 'scale-0 opacity-0 pointer-events-none'
        )}
        title="Quick Actions (Cmd+K)"
      >
        <Zap className="w-6 h-6" />
      </button>

      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-50 bg-black/60 backdrop-blur-sm',
          'transition-opacity duration-300',
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
      />

      {/* Command Panel */}
      <div
        ref={panelRef}
        className={cn(
          'fixed z-50 bottom-6 right-6 w-[480px] max-w-[calc(100vw-3rem)]',
          'rounded-2xl shadow-2xl overflow-hidden',
          'bg-popover border border-border',
          'transition-all duration-300 ease-out origin-bottom-right',
          isOpen
            ? 'scale-100 opacity-100 translate-y-0'
            : 'scale-90 opacity-0 translate-y-4 pointer-events-none'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Zap className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-sm text-foreground">Quick Actions</h3>
              <p className="text-xs text-muted-foreground">Ejecuta comandos en español</p>
            </div>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="p-2 rounded-xl hover:bg-secondary transition-colors"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-4 space-y-4">
          {/* Input */}
          <div className="relative">
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <input
                  ref={inputRef}
                  value={command}
                  onChange={(e) => {
                    setCommand(e.target.value);
                    setShowSuggestions(true);
                  }}
                  onKeyDown={handleKeyDown}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                  placeholder="Ej: buscar cliente Juan, pedidos de hoy..."
                  className="w-full h-10 pl-9 pr-10 rounded-xl bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/20 transition-all"
                  disabled={isExecuting}
                />
                {isExecuting && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                  </div>
                )}
              </div>
              <Button
                onClick={() => executeCommand(command)}
                disabled={!command.trim() || isExecuting}
                className="h-10 px-4"
              >
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>

            {/* Suggestions Dropdown */}
            {showSuggestions && filteredSuggestions.length > 0 && (
              <div className="absolute z-10 w-full mt-2 bg-popover border border-border rounded-xl shadow-xl max-h-48 overflow-auto">
                {filteredSuggestions.slice(0, 5).map((suggestion, idx) => (
                  <button
                    key={idx}
                    className="w-full px-3 py-2.5 text-left hover:bg-secondary transition-colors text-sm first:rounded-t-xl last:rounded-b-xl"
                    onClick={() => handleSuggestionClick(suggestion)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-foreground">{suggestion.command}</span>
                      {suggestion.description.includes('peligroso') && (
                        <span className="text-amber-400 text-[10px]">Requiere confirmacion</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{suggestion.description}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Confirmation */}
          {pendingConfirmation && (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <div className="flex items-start gap-3 mb-3">
                <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-amber-400">Confirmar accion</p>
                  <p className="text-xs text-muted-foreground mt-1">{pendingConfirmation.warningMessage}</p>
                </div>
              </div>
              <div className="flex gap-2 pt-3 border-t border-amber-500/20">
                <Button
                  variant="secondary"
                  onClick={() => setPendingConfirmation(null)}
                  className="flex-1 h-9"
                >
                  Cancelar
                </Button>
                <Button
                  onClick={handleConfirm}
                  className="flex-1 h-9"
                >
                  Confirmar
                </Button>
              </div>
            </div>
          )}

          {/* Result */}
          {result && (
            <div
              className={cn(
                'p-4 rounded-xl',
                result.status === 'success' && 'bg-emerald-500/10 border border-emerald-500/20',
                result.status === 'error' && 'bg-red-500/10 border border-red-500/20',
                result.status === 'denied' && 'bg-red-500/10 border border-red-500/20'
              )}
            >
              <div className="flex items-center gap-2 mb-2">
                {result.status === 'success' ? (
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-400" />
                )}
                <span className={cn(
                  'text-sm font-medium',
                  result.status === 'success' ? 'text-emerald-400' : 'text-red-400'
                )}>
                  {result.status === 'success' ? 'Completado' : result.status === 'denied' ? 'Denegado' : 'Error'}
                </span>
              </div>

              <p className="text-xs text-foreground/90 whitespace-pre-line mb-3">
                {result.status === 'success'
                  ? 'Resultado listo. Miralo en la ventana.'
                  : 'Hay un detalle. Revisalo en la ventana.'}
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowResultModal(true)}
              >
                Ver resultado
              </Button>
            </div>
          )}

          {/* Quick suggestions when empty */}
          {!command && !result && !pendingConfirmation && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground font-medium">Comandos populares</p>
              <div className="flex flex-wrap gap-2">
                {['pedidos de hoy', 'buscar cliente', 'productos con stock bajo', 'deudas pendientes'].map((cmd) => (
                  <button
                    key={cmd}
                    onClick={() => {
                      setCommand(cmd);
                      inputRef.current?.focus();
                    }}
                    className="px-3 py-2 text-xs rounded-xl bg-secondary/50 hover:bg-secondary border border-border transition-all text-foreground"
                  >
                    {cmd}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
          <span>Presiona Enter para ejecutar</span>
          <div className="flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 rounded-md bg-secondary border border-border text-[10px] font-medium">
              <Command className="w-2.5 h-2.5 inline" />
            </kbd>
            <span>+</span>
            <kbd className="px-1.5 py-0.5 rounded-md bg-secondary border border-border text-[10px] font-medium">K</kbd>
          </div>
        </div>
      </div>

      {/* Result Modal */}
      <Dialog open={showResultModal && !!result} onOpenChange={setShowResultModal}>
        <DialogContent className="sm:max-w-[560px]" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader className="pb-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className={cn(
                'w-10 h-10 rounded-xl flex items-center justify-center',
                result?.status === 'success' ? 'bg-emerald-500/10' : 'bg-red-500/10'
              )}>
                {result?.status === 'success' ? (
                  <CheckCircle className="w-5 h-5 text-emerald-400" />
                ) : (
                  <XCircle className="w-5 h-5 text-red-400" />
                )}
              </div>
              <div>
                <DialogTitle>Resultado</DialogTitle>
                <DialogDescription>Detalle de la respuesta</DialogDescription>
              </div>
            </div>
          </DialogHeader>
          {result && (
            <div className="space-y-4 max-h-[70vh] overflow-y-auto">
              {result.error && (
                <p className="text-sm text-red-400 whitespace-pre-line">{result.error}</p>
              )}
              {sanitizeQuickActionText(result.summary) && (
                <p className="text-sm text-foreground whitespace-pre-line">
                  {sanitizeQuickActionText(result.summary)}
                </p>
              )}
              {sanitizeQuickActionText(result.explanation) && result.explanation !== result.summary && (
                <p className="text-sm text-muted-foreground whitespace-pre-line">
                  {sanitizeQuickActionText(result.explanation)}
                </p>
              )}
              {result.results?.map((r, idx) => (
                <QuickActionToolResult key={`${r.toolName}-${idx}`} tool={r} />
              ))}
              {result.uiActions && result.uiActions.length > 0 && (
                <div className="pt-4 border-t border-border space-y-3">
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
                                key={`${action.label}-modal-${idx}`}
                                variant="secondary"
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
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
