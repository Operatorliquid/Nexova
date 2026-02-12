import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MessageSquare, Trash2, Send, Loader2, AlertTriangle, MessagesSquare } from 'lucide-react';
import { Button, Input } from '../../components/ui';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { useAuth } from '../../contexts/AuthContext';
import { cn } from '../../lib/utils';

interface Conversation {
  id: string;
  customerId: string;
  customerPhone: string;
  customerName: string;
  channelType: string;
  agentActive: boolean;
  currentState: string;
  lastMessage: string | null;
  lastMessageRole: string | null;
  lastActivityAt: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface SessionInfo {
  id: string;
  customer: {
    id: string;
    phone: string;
    firstName: string | null;
    lastName: string | null;
  };
  agentActive: boolean;
  currentState: string;
}

const API_URL = import.meta.env.VITE_API_URL || '';

const fetchWithCredentials = (input: RequestInfo | URL, init?: RequestInit) => fetch(input, {
  ...init,
  credentials: 'include',
});

export default function InboxPage() {
  const { workspace } = useAuth();
  const [searchParams] = useSearchParams();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<Conversation | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const sessionParam = searchParams.get('sessionId') || searchParams.get('conversationId');

  // Fetch conversations
  useEffect(() => {
    if (!workspace?.id) return;

    const fetchConversations = async () => {
      try {
        const res = await fetchWithCredentials(`${API_URL}/api/v1/conversations`, {
          headers: {
            'x-workspace-id': workspace.id,
          },
        });

        if (res.ok) {
          const data = await res.json();
          setConversations(data.conversations || []);
        }
      } catch (error) {
        console.error('Failed to fetch conversations:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchConversations();
    const interval = setInterval(fetchConversations, 5000);
    return () => clearInterval(interval);
  }, [workspace?.id]);

  // Auto-select conversation from URL param
  useEffect(() => {
    if (!sessionParam) return;
    if (selectedConversation === sessionParam) return;
    const exists = conversations.some((conversation) => conversation.id === sessionParam);
    if (exists || conversations.length === 0) {
      setSelectedConversation(sessionParam);
    }
  }, [sessionParam, conversations, selectedConversation]);

  // Fetch messages when conversation selected
  useEffect(() => {
    if (!selectedConversation) {
      setMessages([]);
      setSessionInfo(null);
      return;
    }

    const fetchMessages = async () => {
      try {
        const res = await fetchWithCredentials(
          `${API_URL}/api/v1/conversations/${selectedConversation}/messages`,
          {
            headers: {
              'x-workspace-id': workspace?.id || '',
            },
          }
        );

        if (res.ok) {
          const data = await res.json();
          setMessages(data.messages || []);
          setSessionInfo(data.session || null);
        }
      } catch (error) {
        console.error('Failed to fetch messages:', error);
      }
    };

    fetchMessages();
    const interval = setInterval(fetchMessages, 3000);
    return () => clearInterval(interval);
  }, [selectedConversation, workspace?.id]);

  useEffect(() => {
    autoScrollRef.current = true;
  }, [selectedConversation]);

  const handleMessagesScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    autoScrollRef.current = distanceFromBottom <= 64;
  };

  // Scroll to bottom when new messages arrive, only if user is already near bottom
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    if (!autoScrollRef.current) return;
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedConversation) return;

    setIsSending(true);
    try {
      const res = await fetchWithCredentials(
        `${API_URL}/api/v1/conversations/${selectedConversation}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-workspace-id': workspace?.id || '',
          },
          body: JSON.stringify({ content: newMessage }),
        }
      );

      if (res.ok) {
        const data = await res.json();
        autoScrollRef.current = true;
        setMessages((prev) => [...prev, data.message]);
        setNewMessage('');
      }
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setIsSending(false);
    }
  };

  const toggleAgentActive = async () => {
    if (!selectedConversation || !sessionInfo) return;

    try {
      const res = await fetchWithCredentials(
        `${API_URL}/api/v1/conversations/${selectedConversation}/agent`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-workspace-id': workspace?.id || '',
          },
          body: JSON.stringify({ agentActive: !sessionInfo.agentActive }),
        }
      );

      if (res.ok) {
        setSessionInfo((prev) =>
          prev ? { ...prev, agentActive: !prev.agentActive } : null
        );
      }
    } catch (error) {
      console.error('Failed to toggle agent:', error);
    }
  };

  const handleDeleteConversation = async () => {
    if (!deleteCandidate) return;

    const convId = deleteCandidate.id;
    setDeletingId(convId);
    try {
      const res = await fetchWithCredentials(
        `${API_URL}/api/v1/conversations/${convId}`,
        {
          method: 'DELETE',
          headers: {
            'x-workspace-id': workspace?.id || '',
          },
        }
      );

      if (res.ok) {
        setConversations((prev) => prev.filter((c) => c.id !== convId));
        if (selectedConversation === convId) {
          setSelectedConversation(null);
          setMessages([]);
          setSessionInfo(null);
        }
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    } finally {
      setDeletingId(null);
      setDeleteCandidate(null);
    }
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Ahora';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h`;
    return date.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full gap-4 p-4 fade-in overflow-hidden">
      {/* Conversations list */}
      <div className="w-80 flex-shrink-0 glass-card rounded-2xl flex flex-col overflow-hidden">
        <div className="p-4 border-b border-border">
          <Input placeholder="Buscar conversaciones..." />
        </div>

        {conversations.length > 0 ? (
          <div className="flex-1 overflow-y-auto scrollbar-hide">
            {conversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => setSelectedConversation(conv.id)}
                className={cn(
                  'w-full p-4 text-left border-b border-border transition-all duration-200 group',
                  selectedConversation === conv.id
                    ? 'bg-secondary'
                    : 'hover:bg-secondary/50'
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-semibold text-primary">
                      {conv.customerName?.[0]?.toUpperCase() || '?'}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-sm truncate text-foreground">{conv.customerName}</p>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-[11px] text-muted-foreground">
                          {formatTime(conv.lastActivityAt)}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteCandidate(conv);
                          }}
                          disabled={deletingId === conv.id}
                          className="opacity-0 group-hover:opacity-100 p-1.5 -mr-1 hover:bg-red-500/20 rounded-lg text-red-400 hover:text-red-300 transition-all"
                          title="Eliminar"
                        >
                          {deletingId === conv.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {conv.lastMessage || 'Sin mensajes'}
                    </p>
                    <div className="mt-2">
                      {conv.agentActive ? (
                        <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-primary/20 text-primary">
                          <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                          IA
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-primary/20 text-primary">
                          <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                          Humano
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
            <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mb-4">
              <MessageSquare className="w-7 h-7 text-muted-foreground/50" />
            </div>
            <p className="text-muted-foreground text-sm">Sin conversaciones</p>
            <p className="text-muted-foreground/50 text-xs mt-1">
              Las conversaciones apareceran aqui
            </p>
          </div>
        )}
      </div>

      {/* Chat area */}
      <div className="flex-1 glass-card rounded-2xl flex flex-col overflow-hidden min-w-0">
        {selectedConversation && sessionInfo ? (
          <>
            {/* Chat header */}
            <div className="p-4 border-b border-border flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-semibold text-primary">
                    {(sessionInfo.customer.firstName?.[0] || sessionInfo.customer.phone[0]).toUpperCase()}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="font-medium truncate text-foreground">
                    {sessionInfo.customer.firstName
                      ? `${sessionInfo.customer.firstName} ${sessionInfo.customer.lastName || ''}`
                      : sessionInfo.customer.phone}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{sessionInfo.customer.phone}</p>
                </div>
              </div>
              <Button
                variant={sessionInfo.agentActive ? 'secondary' : 'default'}
                onClick={toggleAgentActive}
              >
                {sessionInfo.agentActive ? 'Tomar control' : 'Activar IA'}
              </Button>
            </div>

            {/* Messages */}
            <div
              ref={messagesContainerRef}
              onScroll={handleMessagesScroll}
              className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-hide"
            >
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    'flex',
                    msg.role === 'user' ? 'justify-start' : 'justify-end'
                  )}
                >
                  <div
                    className={cn(
                      'max-w-[75%] rounded-2xl px-4 py-2.5',
                      msg.role === 'user'
                        ? 'bg-secondary text-foreground'
                        : 'bg-primary text-white'
                    )}
                  >
                    <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                    <p
                      className={cn(
                        'text-[10px] mt-1.5',
                        msg.role === 'user' ? 'text-muted-foreground' : 'text-white/70'
                      )}
                    >
                      {new Date(msg.createdAt).toLocaleTimeString('es-AR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {msg.role === 'assistant' && (msg.metadata as any)?.sentByHuman && ' (Humano)'}
                    </p>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Message input */}
            <div className="p-4 border-t border-border flex-shrink-0">
              <div className="flex gap-3">
                <Input
                  placeholder="Escribe un mensaje..."
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                  disabled={isSending}
                  className="flex-1"
                />
                <Button
                  onClick={handleSendMessage}
                  disabled={isSending || !newMessage.trim()}
                >
                  {isSending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <Send className="w-4 h-4 mr-2" />
                      Enviar
                    </>
                  )}
                </Button>
              </div>
              {!sessionInfo.agentActive && (
                <p className="text-xs text-primary/80 mt-2.5 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  El agente IA esta desactivado. Vos estas respondiendo.
                </p>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
            <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mb-4">
              <MessagesSquare className="w-7 h-7 text-muted-foreground/50" />
            </div>
            <p className="text-muted-foreground">Selecciona una conversacion</p>
            <p className="text-sm text-muted-foreground/50 mt-1">
              Elegi una conversacion de la lista para ver los mensajes
            </p>
          </div>
        )}
      </div>

      {/* Customer details */}
      <div className="w-72 flex-shrink-0 glass-card rounded-2xl flex flex-col overflow-hidden">
        <div className="p-4 border-b border-border">
          <h3 className="font-semibold text-foreground">Detalles del cliente</h3>
        </div>
        {sessionInfo ? (
          <div className="p-4 space-y-5 overflow-y-auto scrollbar-hide">
            <div>
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">Nombre</p>
              <p className="font-medium text-foreground">
                {sessionInfo.customer.firstName
                  ? `${sessionInfo.customer.firstName} ${sessionInfo.customer.lastName || ''}`
                  : 'Sin nombre'}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">Telefono</p>
              <p className="font-medium font-mono text-sm text-foreground">{sessionInfo.customer.phone}</p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">Estado</p>
              {sessionInfo.agentActive ? (
                <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg bg-primary/20 text-primary">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                  Atendido por IA
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg bg-primary/20 text-primary">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                  Atendido por humano
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center p-6">
            <p className="text-sm text-muted-foreground text-center">
              Selecciona una conversacion para ver los detalles
            </p>
          </div>
        )}
      </div>

      {/* Delete confirmation modal */}
      <Dialog open={!!deleteCandidate} onOpenChange={(open) => !open && setDeleteCandidate(null)}>
        <DialogContent className="max-w-md">
          <div className="flex flex-col items-center text-center pt-2">
            <div className="w-14 h-14 rounded-2xl bg-red-500/10 flex items-center justify-center mb-4">
              <Trash2 className="w-7 h-7 text-red-400" />
            </div>
            <DialogHeader>
              <DialogTitle>Eliminar conversacion</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground mt-2 mb-4">
              Se eliminara la conversacion con <span className="font-medium text-foreground">{deleteCandidate?.customerName}</span> y todo su historial de mensajes.
            </p>
            {deleteCandidate && (
              <div className="w-full p-4 rounded-xl bg-secondary/50 border border-border mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                    <span className="text-sm font-medium text-primary">
                      {deleteCandidate.customerName?.[0]?.toUpperCase() || '?'}
                    </span>
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-medium text-foreground">{deleteCandidate.customerName}</p>
                    <p className="text-xs text-muted-foreground">{deleteCandidate.customerPhone}</p>
                  </div>
                </div>
              </div>
            )}
            <div className="flex gap-3 w-full">
              <Button variant="secondary" className="flex-1" onClick={() => setDeleteCandidate(null)}>
                Cancelar
              </Button>
              <Button
                className="flex-1 bg-red-600 text-white hover:bg-red-500"
                onClick={handleDeleteConversation}
                disabled={deletingId === deleteCandidate?.id}
              >
                {deletingId === deleteCandidate?.id ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Trash2 className="w-4 h-4 mr-2" />
                )}
                Eliminar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
