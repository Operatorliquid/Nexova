/**
 * Prisma Plugin for Fastify
 */
import { type PrismaClient } from '@prisma/client';
import { type FastifyInstance, type FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

import { applyTenantPrismaMiddleware } from '@nexova/core';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

interface PrismaPluginOptions {
  prisma: PrismaClient;
}

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

async function connectPrismaWithRetry(
  prisma: PrismaClient,
  fastify: FastifyInstance
): Promise<void> {
  const attempts = Math.max(
    1,
    Number.parseInt(process.env.PRISMA_CONNECT_RETRIES || '6', 10) || 6
  );
  const baseDelayMs = Math.max(
    200,
    Number.parseInt(process.env.PRISMA_CONNECT_RETRY_DELAY_MS || '1000', 10) || 1000
  );
  const maxDelayMs = Math.max(
    baseDelayMs,
    Number.parseInt(process.env.PRISMA_CONNECT_RETRY_MAX_DELAY_MS || '5000', 10) || 5000
  );

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await prisma.$connect();
      return;
    } catch (error) {
      if (attempt >= attempts) {
        throw error;
      }
      const delayMs = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      fastify.log.warn(
        { err: error, attempt, attempts, delayMs },
        'Prisma connection failed, retrying'
      );
      await sleep(delayMs);
    }
  }
}

const prismaPluginCallback: FastifyPluginAsync<PrismaPluginOptions> = async (
  fastify,
  options
) => {
  const { prisma } = options;

  // Decorate fastify instance with prisma
  fastify.decorate('prisma', prisma);
  applyTenantPrismaMiddleware(prisma);

  // Connect on startup (with retry for transient DB saturation/boot races)
  await connectPrismaWithRetry(prisma, fastify);
  fastify.log.info('Prisma connected to database');

  // Disconnect on close
  fastify.addHook('onClose', async () => {
    await prisma.$disconnect();
    fastify.log.info('Prisma disconnected from database');
  });
};

export const prismaPlugin = fp(prismaPluginCallback, {
  name: 'prisma',
});
