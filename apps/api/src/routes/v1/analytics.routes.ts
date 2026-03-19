/**
 * Analytics Routes
 * Metrics endpoints for dashboards and quick actions
 */
import { type FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { COMMERCE_USAGE_METRICS } from '@nexova/shared';

import { generateBusinessInsights } from '../../services/analytics/insights.service.js';
import { type MetricsRangeInput, buildMetrics } from '../../services/analytics/metrics.service.js';
import { getEffectiveCommercePlanLimits } from '../../utils/commerce-plan-limits.js';
import { getWorkspacePlanContext } from '../../utils/commerce-plan.js';
import { getMonthlyUsage, recordMonthlyUsage } from '../../utils/monthly-usage.js';


const metricsQuerySchema = z.object({
  range: z.enum(['today', 'week', 'month', '30d', '90d', '12m', 'all']).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

type MetricsQuery = z.infer<typeof metricsQuerySchema>;

function resolveMonthLabel(month: number): string {
  const monthLabel = new Intl.DateTimeFormat('es-AR', { month: 'long' }).format(new Date(2000, month - 1, 1));
  return monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);
}

function resolveMetricsQueryInput(query: MetricsQuery): { rangeInput?: MetricsRangeInput; selectedYear?: number } {
  if (typeof query.month === 'number') {
    const year = query.year ?? new Date().getFullYear();
    const from = new Date(year, query.month - 1, 1, 0, 0, 0, 0);
    const to = new Date(year, query.month, 0, 23, 59, 59, 999);
    return {
      rangeInput: {
        from,
        to,
        label: `${resolveMonthLabel(query.month)} ${year}`,
      },
      selectedYear: undefined,
    };
  }

  return {
    rangeInput: query.range,
    selectedYear: query.year,
  };
}

function buildEmergencyFallbackInsights(reason?: string): {
  insights: {
    headline: string;
    summary: string;
    strengths: string[];
    risks: string[];
    opportunities: string[];
    actions: Array<{ title: string; detail: string; priority: 'alta' | 'media' | 'baja' }>;
  };
  generatedAt: string;
  model: string;
  fallback: true;
  warning?: string;
} {
  return {
    insights: {
      headline: 'No pudimos completar el análisis IA en este momento',
      summary: 'Te mostramos un resumen de contingencia mientras se recupera el servicio.',
      strengths: ['El módulo de métricas sigue disponible para análisis manual.'],
      risks: ['El resumen IA puede volver incompleto hasta que se estabilice el proveedor.'],
      opportunities: ['Podés revisar ventas, ticket y cobranzas en métricas para decidir hoy.'],
      actions: [
        {
          title: 'Reintentar en unos minutos',
          detail: 'El sistema aplicó fallback automático para evitar corte del flujo.',
          priority: 'media',
        },
        {
          title: 'Tomar decisiones con KPIs base',
          detail: 'Usá ventas totales, pedidos, ticket promedio y deudas para priorizar acciones inmediatas.',
          priority: 'baja',
        },
        {
          title: 'Monitorear estabilidad',
          detail: 'Si persiste, revisar cuota/rate-limit y latencia del proveedor de IA.',
          priority: 'alta',
        },
      ],
    },
    generatedAt: new Date().toISOString(),
    model: 'emergency-fallback-v1',
    fallback: true,
    ...(reason ? { warning: reason } : {}),
  };
}

export const analyticsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/metrics',
    { preHandler: [fastify.requirePermission('analytics:read')] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const query = metricsQuerySchema.parse(request.query);
      const { rangeInput, selectedYear } = resolveMetricsQueryInput(query);
      const metrics = await buildMetrics(fastify.prisma, workspaceId, rangeInput, selectedYear);
      return reply.send(metrics);
    }
  );

  fastify.get(
    '/insights',
    { preHandler: [fastify.requirePermission('analytics:read')] },
    async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] as string;
      if (!workspaceId) {
        return reply.code(400).send({ error: 'MISSING_WORKSPACE', message: 'X-Workspace-Id header required' });
      }

      const query = metricsQuerySchema.parse(request.query);
      const { rangeInput, selectedYear } = resolveMetricsQueryInput(query);
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

        const result = await generateBusinessInsights(fastify.prisma, workspaceId, rangeInput, selectedYear);
        if (!result.fallback) {
          await recordMonthlyUsage(fastify.prisma, {
            workspaceId,
            metric: COMMERCE_USAGE_METRICS.aiMetricsInsights,
            quantity: 1,
            metadata: { source: 'analytics.insights' },
          });
        }
        return reply.send(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'INSIGHTS_FAILED';
        request.log.warn({ workspaceId, error }, 'analytics insights failed, returning emergency fallback');
        return reply.send(buildEmergencyFallbackInsights(message));
      }
    }
  );
};
