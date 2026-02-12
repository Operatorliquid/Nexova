/**
 * Nexova API - Entry Point
 */
import dotenv from 'dotenv';
import { existsSync } from 'fs';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { logger } from '@nexova/core';
import { QUEUES } from '@nexova/shared';

// Import plugins
import { prismaPlugin } from './plugins/prisma.plugin.js';
import { authPlugin } from './plugins/auth.plugin.js';
import { errorPlugin } from './plugins/error.plugin.js';
import { realtimePlugin } from './plugins/realtime.plugin.js';

// Import routes
import { authRoutes } from './routes/v1/auth.routes.js';
import { workspaceRoutes } from './routes/v1/workspace.routes.js';
import { adminRoutes } from './routes/v1/admin.routes.js';
import { healthRoutes } from './routes/v1/health.routes.js';
import { webhookRoutes } from './routes/v1/webhook.routes.js';
import { conversationsRoutes } from './routes/v1/conversations.routes.js';
import { integrationsRoutes } from './routes/v1/integrations.routes.js';
import { quickActionsRoutes } from './routes/v1/quick-actions.routes.js';
import { customersRoutes } from './routes/v1/customers.routes.js';
import { productsRoutes } from './routes/v1/products.routes.js';
import { categoriesRoutes } from './routes/v1/categories.routes.js';
import { ordersRoutes } from './routes/v1/orders.routes.js';
import { uploadsRoutes } from './routes/v1/uploads.routes.js';
import { stockReceiptsRoutes } from './routes/v1/stock-receipts.routes.js';
import { analyticsRoutes } from './routes/v1/analytics.routes.js';
import { notificationsRoutes } from './routes/v1/notifications.routes.js';
import { billingRoutes } from './routes/v1/billing.routes.js';

const loadEnvFile = () => {
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
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');

const prisma = new PrismaClient();

// Redis connection for BullMQ
const redisConnection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
};

// Initialize queues
let agentQueue: Queue | undefined;

async function bootstrap() {
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

  // Serve uploaded files
  await app.register(fastifyStatic, {
    root: UPLOAD_DIR,
    prefix: '/uploads/',
    decorateReply: false,
  });

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
    logger.info('BullMQ agent queue initialized');
  } catch (error) {
    logger.warn({ error }, 'Failed to initialize BullMQ queue - webhooks will store but not process');
  }

  // Health routes (no auth)
  await app.register(healthRoutes, { prefix: '/health' });

  // Webhook routes (no auth - verified by signature)
  await app.register(webhookRoutes, { prefix: '/api/v1/webhooks', queue: agentQueue });
  // Also register at /api/whatsapp for simpler Infobip config
  await app.register(webhookRoutes, { prefix: '/api/whatsapp', queue: agentQueue });

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
  await app.register(ordersRoutes, { prefix: '/api/v1/orders' });
  await app.register(notificationsRoutes, { prefix: '/api/v1/notifications' });
  await app.register(billingRoutes, { prefix: '/api/v1/billing' });
  await app.register(uploadsRoutes, { prefix: '/api/v1/uploads' });
  await app.register(stockReceiptsRoutes, { prefix: '/api/v1/stock-receipts' });
  await app.register(analyticsRoutes, { prefix: '/api/v1/analytics' });

  // Graceful shutdown
  const signals = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    process.on(signal, async () => {
      logger.info(`Received ${signal}, shutting down...`);
      await app.close();
      if (agentQueue) {
        await agentQueue.close();
      }
      await prisma.$disconnect();
      process.exit(0);
    });
  }

  // Start server
  const port = parseInt(process.env.PORT || process.env.API_PORT || '3000', 10);
  const host = process.env.API_HOST || '0.0.0.0';

  try {
    await app.listen({ port, host });
    logger.info(`Server listening on http://${host}:${port}`);
  } catch (err) {
    logger.error(err, 'Failed to start server');
    process.exit(1);
  }
}

bootstrap();
