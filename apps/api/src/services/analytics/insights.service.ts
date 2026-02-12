import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { buildMetrics, normalizeRange } from './metrics.service.js';
import type { PrismaClient } from '@prisma/client';

const INSIGHTS_SCHEMA = z.object({
  headline: z.string().min(3).max(160),
  summary: z.string().min(10).max(600),
  strengths: z.array(z.string().min(3).max(160)).max(4),
  risks: z.array(z.string().min(3).max(160)).max(4),
  opportunities: z.array(z.string().min(3).max(160)).max(4),
  actions: z.array(
    z.object({
      title: z.string().min(3).max(120),
      detail: z.string().min(10).max(280),
      priority: z.enum(['alta', 'media', 'baja']),
    })
  ).min(3).max(6),
});

const sumSeries = (series: Array<{ total: number; orders?: number }>) =>
  series.reduce((sum, entry) => sum + entry.total, 0);

const extractJson = (text: string): unknown => {
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) {
    throw new Error('Respuesta sin JSON');
  }
  const slice = text.slice(first, last + 1);
  return JSON.parse(slice);
};

export async function generateBusinessInsights(
  prisma: PrismaClient,
  workspaceId: string,
  rangeInput?: string
): Promise<{
  insights: z.infer<typeof INSIGHTS_SCHEMA>;
  generatedAt: string;
  model: string;
}> {
  const range = normalizeRange(rangeInput);
  const metrics = await buildMetrics(prisma, workspaceId, range);

  const lastSeven = metrics.salesByDay.slice(-7);
  const prevSeven = metrics.salesByDay.slice(-14, -7);
  const lastSevenRevenue = sumSeries(lastSeven);
  const prevSevenRevenue = sumSeries(prevSeven);
  const revenueChangePct = prevSevenRevenue > 0
    ? (lastSevenRevenue - prevSevenRevenue) / prevSevenRevenue
    : null;

  const lastSevenOrders = lastSeven.reduce((sum, entry) => sum + (entry.orders || 0), 0);
  const prevSevenOrders = prevSeven.reduce((sum, entry) => sum + (entry.orders || 0), 0);
  const ordersChangePct = prevSevenOrders > 0
    ? (lastSevenOrders - prevSevenOrders) / prevSevenOrders
    : null;

  const bestWeekday = metrics.salesByWeekday.reduce((best, current) =>
    current.total > best.total ? current : best
  , metrics.salesByWeekday[0] || { label: 'N/A', total: 0 });

  const worstWeekday = metrics.salesByWeekday.reduce((worst, current) =>
    current.total < worst.total ? current : worst
  , metrics.salesByWeekday[0] || { label: 'N/A', total: 0 });

  const topCustomer = metrics.topCustomers[0];
  const topProduct = metrics.topProducts[0];
  const topCustomerShare = topCustomer && metrics.summary.totalRevenue > 0
    ? topCustomer.totalSpent / metrics.summary.totalRevenue
    : null;
  const topProductShare = topProduct && metrics.summary.totalRevenue > 0
    ? topProduct.revenue / metrics.summary.totalRevenue
    : null;

  const insightsInput = {
    range: metrics.range,
    summary: metrics.summary,
    topCustomers: metrics.topCustomers,
    topProducts: metrics.topProducts,
    trend: {
      lastSevenRevenue,
      prevSevenRevenue,
      revenueChangePct,
      lastSevenOrders,
      prevSevenOrders,
      ordersChangePct,
    },
    weekdays: {
      bestDay: bestWeekday,
      worstDay: worstWeekday,
    },
    concentration: {
      topCustomerShare,
      topProductShare,
    },
    notes: {
      amountsInCents: true,
      currency: 'ARS',
    },
  };

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('LLM_NOT_CONFIGURED');
  }

  const model = process.env.LLM_MODEL || 'claude-sonnet-4-20250514';

  const prompt = `Sos un asesor de negocio para un comercio minorista.
Usá SOLO los datos del JSON. Todos los montos están en centavos (ARS).
No inventes números ni porcentajes fuera del JSON.
Si faltan datos, decilo y proponé ideas generales.

Devolvé SOLO JSON válido con este formato:
{
  "headline": "string",
  "summary": "string",
  "strengths": ["string", ...],
  "risks": ["string", ...],
  "opportunities": ["string", ...],
  "actions": [
    { "title": "string", "detail": "string", "priority": "alta|media|baja" }
  ]
}

JSON DE ENTRADA:
${JSON.stringify(insightsInput, null, 2)}
`;

  const response = await anthropic.messages.create({
    model,
    max_tokens: 1400,
    temperature: 0.4,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content.find((part) => part.type === 'text')?.text || '';
  const parsed = INSIGHTS_SCHEMA.safeParse(extractJson(text));
  if (!parsed.success) {
    throw new Error('LLM_RESPONSE_INVALID');
  }

  return {
    insights: parsed.data,
    generatedAt: new Date().toISOString(),
    model,
  };
}
