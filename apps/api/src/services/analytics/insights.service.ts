import Anthropic from '@anthropic-ai/sdk';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';

import { type MetricsRangeInput, buildMetrics, normalizeRange } from './metrics.service.js';

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

const sumSeries = (series: Array<{ total: number; orders?: number }>): number =>
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

function formatMoney(cents: number): string {
  return `$${new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format((cents || 0) / 100)}`;
}

function formatPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '0%';
  return `${Math.round(value * 100)}%`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryAnthropicError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error || '').toLowerCase();
  return (
    message.includes('rate limit') ||
    message.includes('429') ||
    message.includes('overloaded') ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('network') ||
    message.includes('socket') ||
    message.includes('econnreset') ||
    message.includes('service unavailable') ||
    message.includes('503') ||
    message.includes('529')
  );
}

function buildFallbackInsights(params: {
  rangeLabel: string;
  totalRevenue: number;
  totalOrders: number;
  avgOrderValue: number;
  pendingRevenue: number;
  paidRate: number;
  revenueChangePct: number | null;
  ordersChangePct: number | null;
  bestWeekdayLabel: string;
  worstWeekdayLabel: string;
  topCustomerName?: string | null;
  topProductName?: string | null;
}): z.infer<typeof INSIGHTS_SCHEMA> {
  const {
    rangeLabel,
    totalRevenue,
    totalOrders,
    avgOrderValue,
    pendingRevenue,
    paidRate,
    revenueChangePct,
    ordersChangePct,
    bestWeekdayLabel,
    worstWeekdayLabel,
    topCustomerName,
    topProductName,
  } = params;

  const cobrabilidadPct = Math.round((paidRate || 0) * 100);
  const headline =
    totalOrders > 0
      ? `En ${rangeLabel} registraste ${totalOrders} pedidos por ${formatMoney(totalRevenue)}`
      : `Todavía no hay pedidos en ${rangeLabel}`;

  const summary = totalOrders > 0
    ? `Ticket promedio ${formatMoney(avgOrderValue)}. Cobrado ${cobrabilidadPct}% y pendiente ${formatMoney(pendingRevenue)}.`
    : 'No hay volumen suficiente para detectar tendencias con precisión.';

  const strengths = [
    `Mejor día de venta: ${bestWeekdayLabel}.`,
    topProductName ? `Producto más relevante: ${topProductName}.` : 'El mix de productos todavía no muestra un líder claro.',
    topCustomerName ? `Cliente destacado: ${topCustomerName}.` : 'La base de clientes está distribuida sin alta concentración.',
  ].slice(0, 3);

  const risks = [
    `Día más flojo: ${worstWeekdayLabel}.`,
    pendingRevenue > 0 ? `Tenés ${formatMoney(pendingRevenue)} pendiente de cobro.` : 'No hay deuda relevante en el período.',
    `Variación semanal de ventas: ${formatPct(revenueChangePct)}.`,
  ].slice(0, 3);

  const opportunities = [
    `Variación semanal de pedidos: ${formatPct(ordersChangePct)}.`,
    'Podés reforzar campañas en el día más flojo para nivelar demanda.',
    'Conviene replicar oferta/comunicación de los días con mejor rendimiento.',
  ];

  const actions: Array<{ title: string; detail: string; priority: 'alta' | 'media' | 'baja' }> = [
    {
      title: 'Plan de cobranza semanal',
      detail: pendingRevenue > 0
        ? `Ejecutá recordatorios y seguimiento de pagos para bajar los ${formatMoney(pendingRevenue)} pendientes.`
        : 'Mantené la política actual de cobranza para sostener el flujo de caja.',
      priority: pendingRevenue > 0 ? 'alta' : 'media',
    },
    {
      title: 'Optimizar día de menor venta',
      detail: `Lanzá promo o difusión específica para ${worstWeekdayLabel} y medí el impacto por 2 semanas.`,
      priority: 'media',
    },
    {
      title: 'Escalar lo que ya funciona',
      detail: `Duplicá acciones comerciales del día más fuerte (${bestWeekdayLabel}) en productos de mayor rotación.`,
      priority: 'baja',
    },
  ];

  return {
    headline,
    summary,
    strengths,
    risks,
    opportunities,
    actions,
  };
}

export async function generateBusinessInsights(
  prisma: PrismaClient,
  workspaceId: string,
  rangeInput?: string | MetricsRangeInput,
  selectedYear?: number
): Promise<{
  insights: z.infer<typeof INSIGHTS_SCHEMA>;
  generatedAt: string;
  model: string;
  fallback?: boolean;
}> {
  const normalizedRangeInput =
    typeof rangeInput === 'string'
      ? normalizeRange(rangeInput)
      : rangeInput;
  const metrics = await buildMetrics(prisma, workspaceId, normalizedRangeInput, selectedYear);

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

  const model = process.env.LLM_MODEL || 'claude-sonnet-4-20250514';
  const fallbackInsights = buildFallbackInsights({
    rangeLabel: metrics.range.label,
    totalRevenue: metrics.summary.totalRevenue,
    totalOrders: metrics.summary.totalOrders,
    avgOrderValue: metrics.summary.avgOrderValue,
    pendingRevenue: metrics.summary.pendingRevenue,
    paidRate: metrics.summary.paidRate,
    revenueChangePct,
    ordersChangePct,
    bestWeekdayLabel: bestWeekday.label || 'N/A',
    worstWeekdayLabel: worstWeekday.label || 'N/A',
    topCustomerName: topCustomer?.name || null,
    topProductName: topProduct?.name || null,
  });

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) {
    return {
      insights: fallbackInsights,
      generatedAt: new Date().toISOString(),
      model: 'heuristic-fallback-v1',
      fallback: true,
    };
  }

  const anthropic = new Anthropic({ apiKey: anthropicApiKey });

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

  const maxAttempts = 3;
  const backoffMs = [0, 1200, 2600];

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (backoffMs[attempt] > 0) {
      await sleep(backoffMs[attempt]);
    }
    try {
      const response = await anthropic.messages.create({
        model,
        max_tokens: 1400,
        temperature: 0.15,
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
        fallback: false,
      };
    } catch (error) {
      const isLastAttempt = attempt >= maxAttempts - 1;
      if (isLastAttempt || !shouldRetryAnthropicError(error)) {
        break;
      }
    }
  }

  return {
    insights: fallbackInsights,
    generatedAt: new Date().toISOString(),
    model: `${model}:fallback`,
    fallback: true,
  };
}
