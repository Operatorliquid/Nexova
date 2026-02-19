/**
 * Realtime WebSocket gateway
 * - Authenticates via JWT
 * - Enforces workspace membership
 * - Subscribes to Redis pub/sub for event fan-out
 */
import websocket from '@fastify/websocket';
import { type FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { Redis } from 'ioredis';

import { PermissionService, verifyAccessToken } from '@nexova/core';
import type { WebSocketMessage } from '@nexova/shared';

interface RealtimePluginOptions {
  redisHost?: string;
  redisPort?: number;
  redisPassword?: string;
  channel?: string;
}

interface SocketLike {
  readyState: number;
  OPEN: number;
  send: (data: string) => void;
  close: () => void;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
}

interface SocketContext {
  socket: SocketLike;
  workspaceId: string;
  userId: string;
  subscriptions: Set<string>;
}

const DEFAULT_CHANNEL = process.env.REALTIME_CHANNEL || 'nexova:realtime';
const WS_MESSAGE_TYPES: WebSocketMessage['type'][] = [
  'subscribe',
  'unsubscribe',
  'event',
  'ping',
  'pong',
  'error',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWebSocketMessageType(value: unknown): value is WebSocketMessage['type'] {
  return typeof value === 'string' && WS_MESSAGE_TYPES.includes(value as WebSocketMessage['type']);
}

function parseRealtimeEventPayload(payload: string): Record<string, unknown> | null {
  const parsed: unknown = JSON.parse(payload);
  return isRecord(parsed) ? parsed : null;
}

function parseClientMessage(rawText: string): WebSocketMessage | null {
  const parsed: unknown = JSON.parse(rawText);
  if (!isRecord(parsed)) return null;
  const type = parsed.type;
  if (!isWebSocketMessageType(type)) return null;
  return {
    type,
    ...(typeof parsed.channel === 'string' ? { channel: parsed.channel } : {}),
    ...('data' in parsed ? { data: parsed.data } : {}),
    ...(typeof parsed.error === 'string' ? { error: parsed.error } : {}),
    ...(typeof parsed.timestamp === 'string' ? { timestamp: parsed.timestamp } : {}),
  };
}

function extractBearerToken(authorization?: string): string | undefined {
  if (!authorization?.startsWith('Bearer ')) return undefined;
  return authorization.substring(7);
}

function resolveChannel(eventType: string, aggregateType?: string): string {
  if (!eventType) return '';
  if (eventType.includes(':')) return eventType;

  const [domain, action] = eventType.split('.');
  if (!action) return eventType;

  if (domain === 'message') {
    return 'sessions:messages';
  }

  const pluralMap: Record<string, string> = {
    order: 'orders',
    session: 'sessions',
    payment: 'payments',
    handoff: 'handoffs',
    stock: 'stock',
  };

  const base = pluralMap[domain] || aggregateType?.toLowerCase() || domain;
  return `${base}:${action}`;
}

function matchesSubscription(subscription: string, channel: string): boolean {
  if (subscription === '*') return true;
  if (subscription.endsWith('*')) {
    const prefix = subscription.slice(0, -1);
    return channel.startsWith(prefix);
  }
  return subscription === channel;
}

function isSubscribed(subscriptions: Set<string>, channel: string): boolean {
  for (const sub of subscriptions) {
    if (matchesSubscription(sub, channel)) return true;
  }
  return false;
}

function sendMessage(socket: SocketLike, message: WebSocketMessage): void {
  if (socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify(message));
}

const realtimePluginImpl: FastifyPluginAsync<RealtimePluginOptions> = async (
  fastify,
  opts
) => {
  await fastify.register(websocket);

  const redis = new Redis({
    host: opts.redisHost || process.env.REDIS_HOST || 'localhost',
    port: opts.redisPort || parseInt(process.env.REDIS_PORT || '6379', 10),
    password: opts.redisPassword || process.env.REDIS_PASSWORD || undefined,
  });
  const channel = opts.channel || DEFAULT_CHANNEL;
  const permissionService = new PermissionService(fastify.prisma);

  redis.on('error', (err: unknown) => {
    fastify.log.error({ err }, 'Realtime Redis error');
  });

  const socketContexts = new Map<SocketLike, SocketContext>();
  const workspaceSockets = new Map<string, Set<SocketLike>>();

  await redis.subscribe(channel);
  redis.on('message', (chan: string, payload: string) => {
    if (chan !== channel) return;
    let event: Record<string, unknown> | null;
    try {
      event = parseRealtimeEventPayload(payload);
    } catch {
      fastify.log.warn('Ignoring malformed realtime payload');
      return;
    }
    if (!event) return;

    const workspaceId = typeof event.workspaceId === 'string' ? event.workspaceId : undefined;
    if (!workspaceId) return;

    const targetSockets = workspaceSockets.get(workspaceId);
    if (!targetSockets || targetSockets.size === 0) return;

    const eventType = typeof event.eventType === 'string' ? event.eventType : '';
    const aggregateType = typeof event.aggregateType === 'string' ? event.aggregateType : undefined;
    const resolvedChannel = resolveChannel(eventType, aggregateType);
    if (!resolvedChannel) return;

    const message: WebSocketMessage = {
      type: 'event',
      channel: resolvedChannel,
      data: event,
      timestamp: new Date().toISOString(),
    };

    for (const socket of targetSockets) {
      const ctx = socketContexts.get(socket);
      if (!ctx) continue;
      if (!isSubscribed(ctx.subscriptions, resolvedChannel)) continue;
      sendMessage(socket, message);
    }
  });

  fastify.get('/ws', { websocket: true }, (connection, request) => {
    void (async () => {
      const socket = (connection as { socket: SocketLike }).socket;
      const url = new URL(request.url || '', 'http://localhost');
      const token =
        url.searchParams.get('token') || extractBearerToken(request.headers.authorization);
      const workspaceId =
        url.searchParams.get('workspaceId') ||
        (request.headers['x-workspace-id'] as string | undefined);

      if (!token || !workspaceId) {
        sendMessage(socket, {
          type: 'error',
          error: 'Missing token or workspaceId',
          timestamp: new Date().toISOString(),
        });
        socket.close();
        return;
      }

      let payload: { sub: string; isSuperAdmin?: boolean };
      try {
        payload = verifyAccessToken(token);
      } catch {
        sendMessage(socket, {
          type: 'error',
          error: 'Invalid or expired token',
          timestamp: new Date().toISOString(),
        });
        socket.close();
        return;
      }

      if (!payload.isSuperAdmin) {
        const isMember = await permissionService.isMember(payload.sub, workspaceId);
        if (!isMember) {
          sendMessage(socket, {
            type: 'error',
            error: 'Not a member of this workspace',
            timestamp: new Date().toISOString(),
          });
          socket.close();
          return;
        }
      }

      const context: SocketContext = {
        socket,
        workspaceId,
        userId: payload.sub,
        subscriptions: new Set(),
      };
      socketContexts.set(socket, context);
      if (!workspaceSockets.has(workspaceId)) {
        workspaceSockets.set(workspaceId, new Set());
      }
      workspaceSockets.get(workspaceId)!.add(socket);

      sendMessage(socket, { type: 'pong', timestamp: new Date().toISOString() });

      socket.on('message', (raw: unknown) => {
        const rawText =
          typeof raw === 'string'
            ? raw
            : Buffer.isBuffer(raw)
              ? raw.toString()
              : String(raw);
        let message: WebSocketMessage;
        try {
          const parsed = parseClientMessage(rawText);
          if (!parsed) {
            throw new Error('Invalid message format');
          }
          message = parsed;
        } catch {
          sendMessage(socket, {
            type: 'error',
            error: 'Invalid message format',
            timestamp: new Date().toISOString(),
          });
          return;
        }

        if (!message.type) {
          sendMessage(socket, {
            type: 'error',
            error: 'Missing message type',
            timestamp: new Date().toISOString(),
          });
          return;
        }

        if (message.type === 'subscribe' && message.channel) {
          context.subscriptions.add(message.channel);
          sendMessage(socket, {
            type: 'event',
            channel: message.channel,
            data: { status: 'subscribed' },
            timestamp: new Date().toISOString(),
          });
          return;
        }

        if (message.type === 'unsubscribe' && message.channel) {
          context.subscriptions.delete(message.channel);
          sendMessage(socket, {
            type: 'event',
            channel: message.channel,
            data: { status: 'unsubscribed' },
            timestamp: new Date().toISOString(),
          });
          return;
        }

        if (message.type === 'ping') {
          sendMessage(socket, { type: 'pong', timestamp: new Date().toISOString() });
          return;
        }

        sendMessage(socket, {
          type: 'error',
          error: 'Unsupported message type',
          timestamp: new Date().toISOString(),
        });
      });

      socket.on('close', () => {
        socketContexts.delete(socket);
        const sockets = workspaceSockets.get(workspaceId);
        if (sockets) {
          sockets.delete(socket);
          if (sockets.size === 0) {
            workspaceSockets.delete(workspaceId);
          }
        }
      });
    })();
  });

  fastify.addHook('onClose', async () => {
    for (const socket of socketContexts.keys()) {
      try {
        socket.close();
      } catch {
        // ignore
      }
    }
    socketContexts.clear();
    workspaceSockets.clear();
    await redis.unsubscribe(channel);
    await redis.quit();
  });
};

export const realtimePlugin = fp(realtimePluginImpl, {
  name: 'realtime-plugin',
});
