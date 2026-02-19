/**
 * Health Check Routes
 */
import { type FastifyPluginAsync } from 'fastify';

export const healthRoutes: FastifyPluginAsync = (fastify) => {
  // Basic health check (liveness)
  fastify.get('/', async (request, reply) => {
    return reply.send({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // Readiness check (includes DB)
  fastify.get('/ready', async (request, reply) => {
    try {
      // Check database connection
      await fastify.prisma.$queryRaw`SELECT 1`;

      return reply.send({
        status: 'ready',
        timestamp: new Date().toISOString(),
        checks: {
          database: 'ok',
        },
      });
    } catch (error) {
      return reply.code(503).send({
        status: 'not_ready',
        timestamp: new Date().toISOString(),
        checks: {
          database: 'failed',
        },
      });
    }
  });

  // Detailed health (for monitoring)
  fastify.get('/detailed', async (request, reply) => {
    const dbStart = Date.now();
    let dbStatus = 'ok';
    let dbLatency = 0;

    try {
      await fastify.prisma.$queryRaw`SELECT 1`;
      dbLatency = Date.now() - dbStart;
    } catch {
      dbStatus = 'failed';
    }

    return reply.send({
      status: dbStatus === 'ok' ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '0.0.1',
      environment: process.env.NODE_ENV || 'development',
      uptime: process.uptime(),
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        unit: 'MB',
      },
      checks: {
        database: {
          status: dbStatus,
          latencyMs: dbLatency,
        },
      },
    });
  });
};
