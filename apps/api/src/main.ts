/**
 * Nexova API - Entry Point
 */
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import dotenv from 'dotenv';
import Fastify from 'fastify';

import { logger } from '@nexova/core';
import { QUEUES } from '@nexova/shared';

// Import plugins
import { authPlugin } from './plugins/auth.plugin.js';
import { errorPlugin } from './plugins/error.plugin.js';
import { prismaPlugin } from './plugins/prisma.plugin.js';
import { realtimePlugin } from './plugins/realtime.plugin.js';
// Import routes
import { adminRoutes } from './routes/v1/admin.routes.js';
import { analyticsRoutes } from './routes/v1/analytics.routes.js';
import { audioTranscriptionsRoutes } from './routes/v1/audio-transcriptions.routes.js';
import { authRoutes } from './routes/v1/auth.routes.js';
import { billingRoutes } from './routes/v1/billing.routes.js';
import { categoriesRoutes } from './routes/v1/categories.routes.js';
import { communicationsRoutes } from './routes/v1/communications.routes.js';
import { conversationsRoutes } from './routes/v1/conversations.routes.js';
import { customersRoutes } from './routes/v1/customers.routes.js';
import { healthRoutes } from './routes/v1/health.routes.js';
import { integrationsRoutes } from './routes/v1/integrations.routes.js';
import { notificationsRoutes } from './routes/v1/notifications.routes.js';
import { ordersRoutes } from './routes/v1/orders.routes.js';
import { productsRoutes } from './routes/v1/products.routes.js';
import { quickActionsRoutes } from './routes/v1/quick-actions.routes.js';
import { stockReceiptsRoutes } from './routes/v1/stock-receipts.routes.js';
import { uploadsRoutes } from './routes/v1/uploads.routes.js';
import { webhookRoutes } from './routes/v1/webhook.routes.js';
import { workspaceRoutes } from './routes/v1/workspace.routes.js';
import { resolveUploadDir, resolveUploadDirCandidates } from './utils/upload-dir.js';

const loadEnvFile = (): void => {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../.env'),
    path.resolve(process.cwd(), '../../.env'),
  ];
  for (const file of candidates) {
    if (existsSync(file)) {
      dotenv.config({ path: file });
      return;
    }
  }
};

loadEnvFile();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOAD_DIR = resolveUploadDir(__dirname);
const UPLOAD_DIR_CANDIDATES = resolveUploadDirCandidates(__dirname);
const PRODUCTS_UPLOAD_DIRS = Array.from(
  new Set((UPLOAD_DIR_CANDIDATES.length > 0 ? UPLOAD_DIR_CANDIDATES : [UPLOAD_DIR]).map((dir) => path.join(dir, 'products')))
);
const PRODUCTS_UPLOAD_DIR = PRODUCTS_UPLOAD_DIRS[0] || path.join(UPLOAD_DIR, 'products');

function buildPrismaDatasourceUrl(baseUrl?: string): string | null {
  if (!baseUrl || !baseUrl.trim()) return null;

  try {
    const url = new URL(baseUrl);
    const connectionLimit = (process.env.PRISMA_CONNECTION_LIMIT || '2').trim();
    const poolTimeout = (process.env.PRISMA_POOL_TIMEOUT || '20').trim();

    if (!url.searchParams.has('connection_limit')) {
      url.searchParams.set('connection_limit', connectionLimit);
    }
    if (!url.searchParams.has('pool_timeout')) {
      url.searchParams.set('pool_timeout', poolTimeout);
    }
    return url.toString();
  } catch {
    return baseUrl;
  }
}

const prismaDatasourceUrl = buildPrismaDatasourceUrl(process.env.DATABASE_URL);
const prisma = new PrismaClient(
  prismaDatasourceUrl
    ? {
        datasources: {
          db: {
            url: prismaDatasourceUrl,
          },
        },
      }
    : undefined
);
const DEPLOY_STAMP = '2026-02-23.api.9';

// Redis connection for BullMQ
const redisConnection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
};

// Initialize queues
let agentQueue: Queue | undefined;
let audioTranscriptionQueue: Queue | undefined;

async function bootstrap(): Promise<void> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      transport:
        process.env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
  });

  // Security plugins
  await app.register(helmet, {
    contentSecurityPolicy: process.env.NODE_ENV === 'production',
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  await app.register(cors, {
    origin: process.env.CORS_ORIGIN?.split(',') || [
      'http://localhost:5173',
      'http://localhost:5174',
    ],
    credentials: true,
  });

  await app.register(cookie, {
    secret: process.env.COOKIE_SECRET || 'dev-cookie-secret-change-in-prod',
  });

  // Multipart for file uploads
  await app.register(multipart, {
    limits: {
      fileSize: 5 * 1024 * 1024, // 5MB
    },
  });

  // Serve only product images as static public assets.
  // Sensitive categories are served through signed/authenticated routes.
  if (!existsSync(PRODUCTS_UPLOAD_DIR)) {
    mkdirSync(PRODUCTS_UPLOAD_DIR, { recursive: true });
  }
  await app.register(fastifyStatic, {
    root: PRODUCTS_UPLOAD_DIRS.length > 1 ? PRODUCTS_UPLOAD_DIRS : PRODUCTS_UPLOAD_DIR,
    prefix: '/uploads/products/',
    decorateReply: false,
  });
  logger.info(
    {
      primaryUploadDir: UPLOAD_DIR,
      productUploadDirs: PRODUCTS_UPLOAD_DIRS,
    },
    'Product static upload directories configured'
  );

  // Custom plugins
  await app.register(prismaPlugin, { prisma });
  await app.register(errorPlugin);
  await app.register(authPlugin);
  await app.register(realtimePlugin, {
    redisHost: redisConnection.host,
    redisPort: redisConnection.port,
    redisPassword: redisConnection.password,
    channel: process.env.REALTIME_CHANNEL || 'nexova:realtime',
  });

  // Initialize BullMQ queue for agent processing
  try {
    agentQueue = new Queue(QUEUES.AGENT_PROCESS.name, {
      connection: redisConnection,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 1000,
      },
    });
    audioTranscriptionQueue = new Queue(QUEUES.AUDIO_TRANSCRIPTION.name, {
      connection: redisConnection,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 1000,
      },
    });
    logger.info('BullMQ agent queue initialized');
  } catch (error) {
    logger.warn({ error }, 'Failed to initialize BullMQ queue - webhooks will store but not process');
  }

  // Health routes (no auth)
  await app.register(healthRoutes, { prefix: '/health' });

  // Webhook routes (no auth - verified by signature)
  await app.register(webhookRoutes, { prefix: '/api/v1/webhooks', queue: agentQueue, audioQueue: audioTranscriptionQueue });
  // Also register at /api/whatsapp for simpler Infobip config
  await app.register(webhookRoutes, { prefix: '/api/whatsapp', queue: agentQueue, audioQueue: audioTranscriptionQueue });

  // API v1 routes
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(workspaceRoutes, { prefix: '/api/v1/workspaces' });
  await app.register(adminRoutes, { prefix: '/api/v1/admin' });
  await app.register(conversationsRoutes, { prefix: '/api/v1/conversations' });
  await app.register(integrationsRoutes, { prefix: '/api/v1/integrations' });
  await app.register(quickActionsRoutes, { prefix: '/api/v1/quick-actions' });
  await app.register(customersRoutes, { prefix: '/api/v1/customers' });
  await app.register(productsRoutes, { prefix: '/api/v1/products' });
  await app.register(categoriesRoutes, { prefix: '/api/v1/categories' });
  await app.register(communicationsRoutes, { prefix: '/api/v1/communications' });
  await app.register(ordersRoutes, { prefix: '/api/v1/orders' });
  await app.register(notificationsRoutes, { prefix: '/api/v1/notifications' });
  await app.register(billingRoutes, { prefix: '/api/v1/billing' });
  await app.register(audioTranscriptionsRoutes, {
    prefix: '/api/v1/workspaces',
    queue: audioTranscriptionQueue,
  });
  await app.register(uploadsRoutes, { prefix: '/api/v1/uploads' });
  await app.register(stockReceiptsRoutes, { prefix: '/api/v1/stock-receipts' });
  await app.register(analyticsRoutes, { prefix: '/api/v1/analytics' });

  // Graceful shutdown
  const signals = ['SIGINT', 'SIGTERM'];
  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}, shutting down...`);
    await app.close();
    if (agentQueue) {
      await agentQueue.close();
    }
    if (audioTranscriptionQueue) {
      await audioTranscriptionQueue.close();
    }
    await prisma.$disconnect();
    process.exit(0);
  };

  for (const signal of signals) {
    process.on(signal, () => {
      void shutdown(signal);
    });
  }

  // Start server
  const port = parseInt(process.env.PORT || process.env.API_PORT || '3000', 10);
  const host = process.env.API_HOST || '0.0.0.0';

  try {
    await app.listen({ port, host });
    logger.info({ deployStamp: DEPLOY_STAMP }, 'API deploy stamp');
    logger.info(`Server listening on http://${host}:${port}`);
  } catch (err) {
    logger.error(err, 'Failed to start server');
    process.exit(1);
  }
}

void bootstrap();
