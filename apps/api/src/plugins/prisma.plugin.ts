/**
 * Prisma Plugin for Fastify
 */
import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { PrismaClient } from '@prisma/client';
import { applyTenantPrismaMiddleware } from '@nexova/core';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

interface PrismaPluginOptions {
  prisma: PrismaClient;
}

const prismaPluginCallback: FastifyPluginAsync<PrismaPluginOptions> = async (
  fastify,
  options
) => {
  const { prisma } = options;

  // Decorate fastify instance with prisma
  fastify.decorate('prisma', prisma);
  applyTenantPrismaMiddleware(prisma);

  // Connect on startup
  await prisma.$connect();
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
