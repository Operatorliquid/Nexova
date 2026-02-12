/**
 * Realtime WebSocket gateway
 * - Authenticates via JWT
 * - Enforces workspace membership
 * - Subscribes to Redis pub/sub for event fan-out
 */
import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import websocket from '@fastify/websocket';
import { Redis } from 'ioredis';
import type { WebSocketMessage } from '@nexova/shared';
import { PermissionService, verifyAccessToken } from '@nexova/core';

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
  on: (event: string, listener: (...args: any[]) => void) => void;
}

interface SocketContext {
  socket: SocketLike;
  workspaceId: string;
  userId: string;
  subscriptions: Set<string>;
}

const DEFAULT_CHANNEL = process.env.REALTIME_CHANNEL || 'nexova:realtime';

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
    let event: any;
    try {
      event = JSON.parse(payload);
    } catch {
      fastify.log.warn('Ignoring malformed realtime payload');
      return;
    }

    const workspaceId = event?.workspaceId;
    if (!workspaceId) return;

    const targetSockets = workspaceSockets.get(workspaceId);
    if (!targetSockets || targetSockets.size === 0) return;

    const resolvedChannel = resolveChannel(event.eventType, event.aggregateType);
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
      const socket = connection.socket as SocketLike;
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
          message = JSON.parse(rawText);
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
