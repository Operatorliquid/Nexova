/**
 * Agent Worker Entrypoint
 * Starts the BullMQ worker to process incoming messages
 */
import { PrismaClient } from '@prisma/client';

import { logger } from '@nexova/core';

import { createAgentWorker } from './agent-worker.js';

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

function main(): void {
  logger.info('Starting Agent Worker...');

  // Validate environment
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required');
  }

  const redisHost = process.env.REDIS_HOST || 'localhost';
  const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
  const redisPassword = process.env.REDIS_PASSWORD;

  // Create and start worker
  const workerConfig: Parameters<typeof createAgentWorker>[1] = {
    redisHost,
    redisPort,
    anthropicApiKey: anthropicKey,
    concurrency: parseInt(process.env.WORKER_CONCURRENCY || '5', 10),
  };
  if (redisPassword) {
    workerConfig.redisPassword = redisPassword;
  }
  const worker = createAgentWorker(prisma, workerConfig);

  logger.info('Agent Worker started successfully');
  logger.info(`Redis: ${redisHost}:${redisPort}`);
  logger.info(`Concurrency: ${process.env.WORKER_CONCURRENCY || '5'}`);

  // Graceful shutdown
  const signals = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    process.on(signal, () => {
      void (async () => {
        logger.info(`Received ${signal}, shutting down...`);
        await worker.stop();
        await prisma.$disconnect();
        process.exit(0);
      })();
    });
  }
}

try {
  main();
} catch (error) {
  logger.error({ error }, 'Failed to start worker');
  process.exit(1);
}
