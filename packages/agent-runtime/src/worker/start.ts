/**
 * Agent Worker Entrypoint
 * Starts the BullMQ worker to process incoming messages
 */
import { PrismaClient } from '@prisma/client';
import { createAgentWorker } from './agent-worker.js';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting Agent Worker...');

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
  const worker = await createAgentWorker(prisma, workerConfig);

  console.log('Agent Worker started successfully');
  console.log(`Redis: ${redisHost}:${redisPort}`);
  console.log(`Concurrency: ${process.env.WORKER_CONCURRENCY || '5'}`);

  // Graceful shutdown
  const signals = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    process.on(signal, async () => {
      console.log(`Received ${signal}, shutting down...`);
      await worker.stop();
      await prisma.$disconnect();
      process.exit(0);
    });
  }
}

main().catch((error) => {
  console.error('Failed to start worker:', error);
  process.exit(1);
});
