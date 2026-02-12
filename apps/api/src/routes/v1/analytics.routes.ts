/**
 * Analytics Routes
 * Metrics endpoints for dashboards and quick actions
 */
import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { buildMetrics } from '../../services/analytics/metrics.service.js';
import { generateBusinessInsights } from '../../services/analytics/insights.service.js';
import { getWorkspacePlanContext } from '../../utils/commerce-plan.js';
import { getEffectiveCommercePlanLimits } from '../../utils/commerce-plan-limits.js';
import { getMonthlyUsage, recordMonthlyUsage } from '../../utils/monthly-usage.js';
import { COMMERCE_USAGE_METRICS } from '@nexova/shared';

const metricsQuerySchema = z.object({
  range: z.enum(['today', 'week', 'month', '30d', '90d', '12m', 'all']).optional(),
});

export const analyticsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/metrics',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const query = metricsQuerySchema.parse(request.query);
      const metrics = await buildMetrics(fastify.prisma, workspaceId, query.range);
      return reply.send(metrics);
    }
  );

  fastify.get(
    '/insights',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const query = metricsQuerySchema.parse(request.query);
      const membership = await fastify.prisma.membership.findFirst({
        where: {
          workspaceId,
          userId: request.user!.sub,
          status: { in: ['ACTIVE', 'active'] },
        },
        include: { role: { select: { name: true } } },
      });
      const planContext = await getWorkspacePlanContext(
        fastify.prisma,
        workspaceId,
        membership?.role?.name
      );
      if (!planContext.capabilities.showMetricsAiInsights) {
        return reply.code(403).send({
          error: 'FORBIDDEN_BY_PLAN',
          message: 'Tu plan actual no incluye resumen IA de métricas',
        });
      }

      try {
        const limits = await getEffectiveCommercePlanLimits(fastify.prisma, planContext.plan);
        const monthlyLimit = limits.aiMetricsInsightsPerMonth;
        if (monthlyLimit !== null) {
          const used = await getMonthlyUsage(fastify.prisma, {
            workspaceId,
            metric: COMMERCE_USAGE_METRICS.aiMetricsInsights,
          });
          if (used >= BigInt(monthlyLimit)) {
            return reply.code(429).send({
              error: 'PLAN_QUOTA_EXCEEDED',
              message: `Alcanzaste el límite mensual de resúmenes IA de métricas (${monthlyLimit}).`,
            });
          }
        }

        const result = await generateBusinessInsights(fastify.prisma, workspaceId, query.range);
        await recordMonthlyUsage(fastify.prisma, {
          workspaceId,
          metric: COMMERCE_USAGE_METRICS.aiMetricsInsights,
          quantity: 1,
          metadata: { source: 'analytics.insights' },
        });
        return reply.send(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'INSIGHTS_FAILED';
        if (message === 'LLM_NOT_CONFIGURED') {
          return reply.code(503).send({ error: 'LLM_NOT_CONFIGURED', message: 'LLM no configurado' });
        }
        return reply.code(500).send({ error: 'INSIGHTS_FAILED', message });
      }
    }
  );
};
