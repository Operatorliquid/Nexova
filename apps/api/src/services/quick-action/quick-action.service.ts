/**
 * Quick Action Service
 * Translates natural language commands to tool calls with policy enforcement
 */

import Anthropic from '@anthropic-ai/sdk';
import { PrismaClient, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { promises as fs, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  QuickActionRequest,
  QuickActionResult,
  ParsedToolCall,
  ToolExecutionResult,
  ConfirmationRequest,
  QuickActionHistoryItem,
  TOOL_POLICIES,
  QuickActionUIAction,
} from './types.js';
import { buildMetrics, normalizeRange } from '../analytics/metrics.service.js';
import { generateBusinessInsights } from '../analytics/insights.service.js';
import { LedgerService, CatalogPdfService, decrypt } from '@nexova/core';
import { createNotificationIfEnabled } from '../../utils/notifications.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', '..', 'uploads');
const CATALOG_DIR = path.join(UPLOAD_DIR, 'catalogs');

const UNIT_SHORT_LABELS: Record<string, string> = {
  unit: 'uds',
  kg: 'kg',
  g: 'g',
  l: 'lts',
  ml: 'ml',
  m: 'm',
  cm: 'cm',
  pack: 'pack',
  dozen: 'doc',
  box: 'caja',
};

const SECONDARY_UNIT_LABELS: Record<string, string> = {
  pack: 'Pack',
  box: 'Caja',
  bundle: 'Bulto',
  dozen: 'Docena',
};

const DEFAULT_LOW_STOCK_THRESHOLD = 10;

const normalizeLowStockThreshold = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const normalized = Math.trunc(value);
    return normalized >= 0 ? normalized : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return null;
    const normalized = Math.trunc(parsed);
    return normalized >= 0 ? normalized : null;
  }
  return null;
};

const CATEGORY_COLOR_PALETTE = [
  '#22c55e',
  '#16a34a',
  '#0ea5e9',
  '#2563eb',
  '#8b5cf6',
  '#ec4899',
  '#f97316',
  '#f59e0b',
  '#ef4444',
  '#14b8a6',
  '#64748b',
];

const CATEGORY_COLOR_NAME_MAP: Record<string, string> = {
  verde: '#22c55e',
  'verde claro': '#4ade80',
  'verde oscuro': '#15803d',
  rojo: '#ef4444',
  'rojo oscuro': '#b91c1c',
  azul: '#2563eb',
  'azul claro': '#38bdf8',
  'azul oscuro': '#1e40af',
  celeste: '#0ea5e9',
  turquesa: '#14b8a6',
  amarillo: '#f59e0b',
  naranja: '#f97316',
  violeta: '#8b5cf6',
  morado: '#8b5cf6',
  rosa: '#ec4899',
  fucsia: '#ec4899',
  gris: '#64748b',
  negro: '#0f172a',
  blanco: '#ffffff',
  marron: '#92400e',
  cafe: '#92400e',
};

type AmbiguousProductCandidate = {
  id: string;
  name: string;
  sku?: string | null;
  unit?: string | null;
  unitValue?: string | null;
  secondaryUnit?: string | null;
  secondaryUnitValue?: string | null;
};

class AmbiguousProductError extends Error {
  candidates: AmbiguousProductCandidate[];

  constructor(candidates: AmbiguousProductCandidate[]) {
    const list = candidates.map((p) => p.name).join(', ');
    super(`Encontré varios productos: ${list}. Especificá mejor.`);
    this.name = 'AmbiguousProductError';
    this.candidates = candidates;
  }
}

const MONTH_DEFINITIONS: Array<{ index: number; label: string; names: string[] }> = [
  { index: 0, label: 'Enero', names: ['enero', 'ene'] },
  { index: 1, label: 'Febrero', names: ['febrero', 'feb'] },
  { index: 2, label: 'Marzo', names: ['marzo', 'mar'] },
  { index: 3, label: 'Abril', names: ['abril', 'abr'] },
  { index: 4, label: 'Mayo', names: ['mayo', 'may'] },
  { index: 5, label: 'Junio', names: ['junio', 'jun'] },
  { index: 6, label: 'Julio', names: ['julio', 'jul'] },
  { index: 7, label: 'Agosto', names: ['agosto', 'ago'] },
  { index: 8, label: 'Septiembre', names: ['septiembre', 'setiembre', 'sept', 'sep', 'set'] },
  { index: 9, label: 'Octubre', names: ['octubre', 'oct'] },
  { index: 10, label: 'Noviembre', names: ['noviembre', 'nov'] },
  { index: 11, label: 'Diciembre', names: ['diciembre', 'dic'] },
];

const SYSTEM_PROMPT = `Eres un asistente que traduce comandos en español a llamadas de herramientas.

HERRAMIENTAS DISPONIBLES:
- navigate_dashboard(page: 'customers'|'orders'|'products'|'stock'|'metrics'|'debts'|'inbox'|'settings', query?: object): Abrir pantalla del dashboard
- get_customer_info(phone?: string, name?: string, email?: string, limit?: number): Buscar cliente por teléfono, nombre o email
- list_customers(query?: string, status?: string, limit?: number): Listar clientes del workspace
- list_debtors(limit?: number): Listar clientes con deuda
- send_debt_reminder(customerId?: string, phone?: string, name?: string): Enviar recordatorio de deuda a un cliente
- send_debt_reminders_bulk(): Enviar recordatorio de deuda a todos los clientes con deuda
- get_unpaid_orders(customerId?: string, phone?: string, name?: string): Ver pedidos impagos de un cliente
- get_customer_balance(customerId?: string, phone?: string, name?: string): Ver saldo/deuda de cliente
- search_products(query?: string, category?: string, limit?: number): Buscar productos
- list_products(query?: string, category?: string, status?: string, limit?: number): Listar productos
- get_product_details(productId?: string, sku?: string, name?: string): Ver detalle de producto
- list_categories(limit?: number): Listar categorías de productos
- get_order_details(orderId?: string, orderNumber?: string): Ver detalles de pedido
- list_orders(status?: string, customerId?: string, date?: 'today'|'week'|'month', limit?: number): Listar pedidos
- update_customer(customerId?: string, phone?: string, name?: string, data: object): Actualizar datos de cliente
- update_order_status(orderId?: string, orderNumber?: string, status: string, notes?: string): Cambiar estado de pedido
- add_order_note(orderId?: string, orderNumber?: string, note: string): Agregar nota a pedido
- cancel_order(orderId?: string, orderNumber?: string, reason?: string): Cancelar pedido
- apply_payment(customerId?: string, phone?: string, name?: string, orderId?: string, orderNumber?: string, amount: number, description?: string): Aplicar pago (monto en pesos)
- adjust_stock(productId?: string, sku?: string, name?: string, quantity: number, reason?: string): Ajustar stock (quantity puede ser positivo o negativo)
- bulk_set_stock(target: number, mode?: 'set'|'adjust', categoryName?: string): Ajustar stock masivo (todos los productos o por categoría)
- adjust_prices_percent(percent?: number, amount?: number, categoryName?: string, productId?: string, sku?: string, name?: string, productNames?: string[], query?: string): Ajustar precios por porcentaje o monto (en pesos)
- create_product(name: string, price: number, sku?: string, description?: string, category?: string, unit?: string, unitValue?: string, secondaryUnit?: string, secondaryUnitValue?: string, initialStock?: number, lowThreshold?: number, categoryIds?: string[]): Crear producto (precio en pesos)
- update_product(productId?: string, sku?: string, name?: string, data: object): Actualizar producto
- delete_product(productId?: string, sku?: string, name?: string): Eliminar producto
- create_category(name: string, description?: string, color?: string, sortOrder?: number): Crear categoría
- update_category(categoryId?: string, name?: string, data: object): Actualizar categoría
- delete_category(categoryId?: string, name?: string): Eliminar categoría
- assign_category_to_products(categoryName: string, productQuery: string, color?: string): Crear/asignar categoría a productos encontrados
- list_conversations(limit?: number): Listar conversaciones activas
- open_conversation(sessionId?: string, phone?: string, name?: string): Buscar conversación por cliente
- get_conversation_messages(sessionId?: string, phone?: string, name?: string, limit?: number): Ver mensajes de una conversación
- send_conversation_message(sessionId?: string, phone?: string, name?: string, content: string): Enviar mensaje en una conversación
- set_agent_active(sessionId?: string, phone?: string, name?: string, agentActive: boolean): Activar o pausar agente en conversación
- list_notifications(limit?: number, unread?: boolean): Listar notificaciones
- mark_notification_read(notificationId: string): Marcar notificación como leída
- mark_all_notifications_read(): Marcar todas las notificaciones como leídas
- generate_catalog_pdf(category?: string, search?: string): Generar catálogo PDF
- get_business_metrics(range?: 'today'|'week'|'month'|'30d'|'90d'|'12m'|'all'): Resumen de métricas del negocio
- get_sales_summary(range?: 'today'|'week'|'month'|'30d'|'90d'|'12m'|'all', month?: number|string, year?: number, from?: string, to?: string): Resumen de ventas por período
- get_low_stock_products(limit?: number, threshold?: number): Productos con stock bajo o agotado
- get_business_insights(range?: 'today'|'week'|'month'|'30d'|'90d'|'12m'|'all'): Consejos IA del negocio

REGLAS:
1. Analiza el comando del usuario
2. Identifica qué herramienta(s) usar
3. Extrae los parámetros del comando
4. Responde SOLO con JSON válido

FORMATO DE RESPUESTA:
{
  "tools": [
    {
      "name": "nombre_herramienta",
      "input": { "param1": "valor1" }
    }
  ],
  "explanation": "Breve explicación de lo que harás"
}

Si el comando no es claro o no corresponde a ninguna herramienta, responde:
{
  "tools": [],
  "explanation": "No entendí el comando. Probá con: buscar cliente, ver pedido, pedidos de hoy, etc."
}`;

export class QuickActionService {
  private prisma: PrismaClient;
  private anthropic: Anthropic;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  private isDebugEnabled(): boolean {
    const value = (process.env.QUICK_ACTIONS_DEBUG || '').toLowerCase();
    return value === '1' || value === 'true' || value === 'yes';
  }

  private logDebug(message: string, data?: Record<string, unknown>): void {
    if (!this.isDebugEnabled()) return;
    if (data) {
      console.log(`[quick-actions] ${message}`, data);
    } else {
      console.log(`[quick-actions] ${message}`);
    }
  }

  private async getWorkspaceLowStockThreshold(workspaceId: string): Promise<number> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { settings: true },
    });
    const settings = (workspace?.settings as Record<string, unknown>) || {};
    const threshold = normalizeLowStockThreshold(settings.lowStockThreshold);
    return threshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
  }

  /**
   * Execute a quick action command
   */
  async execute(request: QuickActionRequest, userRole: string): Promise<QuickActionResult> {
    const actionId = randomUUID();

    try {
      this.logDebug('execute:start', {
        actionId,
        workspaceId: request.workspaceId,
        command: request.command,
      });
      // If confirmation token provided, execute pending action
      if (request.confirmationToken) {
        this.logDebug('execute:confirmation', { actionId });
        return this.executeConfirmed(
          request.confirmationToken,
          request.userId,
          request.workspaceId
        );
      }

      const directNavigation = this.resolveDirectNavigation(request.command);
      if (directNavigation) {
        this.logDebug('execute:directNavigation', {
          actionId,
          summary: directNavigation.summary,
        });
        await this.logAction(actionId, request, 'success', ['navigate_dashboard']);
        return {
          id: actionId,
          status: 'success',
          command: request.command,
          parsedTools: [],
          summary: directNavigation.summary,
          uiActions: directNavigation.actions,
          executedAt: new Date(),
          executedBy: request.userId,
        };
      }

      // Parse command using LLM
      const parsed = await this.parseCommand(request.command);
      let parsedTools = parsed.tools;
      this.logDebug('execute:parsed', {
        actionId,
        tools: parsedTools.map((tool) => ({ name: tool.toolName, input: tool.input })),
        hasExplanation: Boolean(parsed.explanation),
      });

      const inferredRange = this.inferMetricsRange(request.command);
      const monthRange = this.resolveMonthRange(request.command);
      parsedTools = this.applyCommandHeuristics(parsedTools, request.command, inferredRange, monthRange);
      parsedTools = this.dedupeParsedTools(parsedTools);
      this.logDebug('execute:heuristics', {
        actionId,
        tools: parsedTools.map((tool) => tool.toolName),
        inferredRange,
        monthRangeLabel: monthRange?.label,
      });

      const ambiguityResult = await this.detectAmbiguousProductSelection(
        parsedTools,
        request.command,
        request.workspaceId
      );
      if (ambiguityResult) {
        this.logDebug('execute:ambiguousSelection', {
          actionId,
          candidates: ambiguityResult.actions.length,
        });
        await this.logAction(actionId, request, 'success', ['product_disambiguation']);
        return {
          id: actionId,
          status: 'success',
          command: request.command,
          parsedTools,
          summary: ambiguityResult.summary,
          uiActions: ambiguityResult.actions,
          executedAt: new Date(),
          executedBy: request.userId,
        };
      }

      if (parsedTools.length === 0) {
        this.logDebug('execute:noTools', { actionId });
        return {
          id: actionId,
          status: 'error',
          command: request.command,
          parsedTools: [],
          error: 'No se pudo interpretar el comando. Probá con: buscar cliente, ver pedido, pedidos de hoy, etc.',
          explanation: parsed.explanation,
          executedBy: request.userId,
        };
      }

      // Check policies for each tool
      const policyCheck = this.checkPolicies(parsedTools, userRole);
      this.logDebug('execute:policyCheck', {
        actionId,
        denied: policyCheck.denied,
        requiresConfirmation: policyCheck.requiresConfirmation,
      });

      if (policyCheck.denied.length > 0) {
        await this.logAction(actionId, request, 'denied', [], `Acceso denegado: ${policyCheck.denied.join(', ')}`);
        return {
          id: actionId,
          status: 'denied',
          command: request.command,
          parsedTools,
          error: `No tenés permiso para ejecutar: ${policyCheck.denied.join(', ')}`,
          explanation: parsed.explanation,
          executedBy: request.userId,
        };
      }

      // Check if confirmation is required
      if (policyCheck.requiresConfirmation && !request.skipConfirmation) {
        const confirmation = this.createConfirmationRequest(parsedTools, policyCheck.dangerous);
        await this.storePendingConfirmation(request, parsedTools, confirmation);

        await this.logAction(actionId, request, 'pending_confirmation', parsedTools.map(t => t.toolName));
        this.logDebug('execute:pendingConfirmation', { actionId, tools: parsedTools.map(t => t.toolName) });

        return {
          id: actionId,
          status: 'pending_confirmation',
          command: request.command,
          parsedTools,
          confirmationRequired: confirmation,
          explanation: parsed.explanation,
          executedBy: request.userId,
        };
      }

      // Execute tools
      const results = await this.executeTools(parsedTools, request.workspaceId, request.userId);
      this.logDebug('execute:results', {
        actionId,
        results: results.map((r) => ({
          tool: r.toolName,
          success: r.success,
          error: r.error,
        })),
      });
      const output = this.buildQuickActionOutput(request.command, parsedTools, results);
      const explanation = output.summary ? undefined : parsed.explanation;

      await this.logAction(actionId, request, 'success', parsedTools.map(t => t.toolName), undefined, results);

      return {
        id: actionId,
        status: 'success',
        command: request.command,
        parsedTools,
        results,
        summary: output.summary,
        uiActions: output.uiActions,
        explanation,
        executedAt: new Date(),
        executedBy: request.userId,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Error desconocido';
      this.logDebug('execute:error', { actionId, error: errorMsg });
      await this.logAction(actionId, request, 'error', [], errorMsg);

      return {
        id: actionId,
        status: 'error',
        command: request.command,
        parsedTools: [],
        error: errorMsg,
        executedBy: request.userId,
      };
    }
  }

  /**
   * Execute a confirmed action
   */
  private async executeConfirmed(
    token: string,
    userId: string,
    workspaceId: string
  ): Promise<QuickActionResult> {
    const pending = await this.prisma.quickActionConfirmation.findFirst({
      where: { token, workspaceId },
    });

    if (!pending) {
      return {
        id: randomUUID(),
        status: 'error',
        command: '',
        parsedTools: [],
        error: 'Confirmación expirada o inválida',
        executedBy: userId,
      };
    }

    if (pending.userId !== userId) {
      return {
        id: randomUUID(),
        status: 'error',
        command: pending.command,
        parsedTools: [],
        error: 'Confirmación inválida para este usuario',
        executedBy: userId,
      };
    }

    if (new Date() > pending.expiresAt) {
      await this.prisma.quickActionConfirmation.deleteMany({
        where: { token, workspaceId },
      });
      return {
        id: randomUUID(),
        status: 'error',
        command: pending.command,
        parsedTools: pending.parsedTools as unknown as ParsedToolCall[],
        error: 'Confirmación expirada. Por favor, ejecutá el comando de nuevo.',
        executedBy: userId,
      };
    }

    await this.prisma.quickActionConfirmation.deleteMany({
      where: { token, workspaceId },
    });

    const actionId = randomUUID();
    const storedTools = pending.parsedTools as unknown as ParsedToolCall[];
    const hydratedTools = storedTools.map((tool) => {
      if (tool.toolName !== 'send_debt_reminder') return tool;
      const hasTarget = Boolean(
        tool.input?.customerId ||
          tool.input?.phone ||
          tool.input?.name ||
          tool.input?.email
      );
      if (hasTarget) return tool;

      const extracted =
        this.extractCustomerIdentifierFromReminder(pending.command) ||
        this.extractCustomerIdentifierFromReminder(this.normalizeText(pending.command)) ||
        null;
      if (extracted) {
        return { ...tool, input: { ...tool.input, ...extracted } };
      }

      const looseName = this.extractCustomerNameLoose(pending.command);
      if (looseName) {
        return { ...tool, input: { ...tool.input, name: looseName } };
      }

      return tool;
    });
    if (this.isDebugEnabled()) {
      this.logDebug('execute:confirmation:tools', {
        actionId,
        tools: hydratedTools.map((tool) => ({ name: tool.toolName, input: tool.input })),
      });
    }

    const results = await this.executeTools(
      hydratedTools,
      pending.workspaceId,
      pending.userId
    );
    const output = this.buildQuickActionOutput(
      pending.command,
      hydratedTools,
      results
    );

    await this.logAction(
      actionId,
      {
        command: pending.command,
        workspaceId: pending.workspaceId,
        userId: pending.userId,
      },
      'success',
      hydratedTools.map(t => t.toolName),
      undefined,
      results
    );

    return {
      id: actionId,
      status: 'success',
      command: pending.command,
      parsedTools: hydratedTools,
      results,
      summary: output.summary,
      uiActions: output.uiActions,
      executedAt: new Date(),
      executedBy: userId,
    };
  }

  /**
   * Persist pending confirmation in DB
   */
  private async storePendingConfirmation(
    request: QuickActionRequest,
    parsedTools: ParsedToolCall[],
    confirmation: ConfirmationRequest
  ): Promise<void> {
    await this.prisma.quickActionConfirmation.create({
      data: {
        token: confirmation.token,
        workspaceId: request.workspaceId,
        userId: request.userId,
        command: request.command,
        parsedTools: parsedTools as unknown as Prisma.InputJsonValue,
        expiresAt: confirmation.expiresAt,
      },
    });
  }

  /**
   * Parse command using LLM
   */
  private async parseCommand(command: string): Promise<{ tools: ParsedToolCall[]; explanation?: string }> {
    const response = await this.anthropic.messages.create({
      model: process.env.LLM_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: command },
      ],
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      return { tools: [] };
    }

    try {
      // Extract JSON from response
      const jsonMatch = content.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return { tools: [] };

      const parsed = JSON.parse(jsonMatch[0]);

      if (!parsed.tools || !Array.isArray(parsed.tools)) {
        return { tools: [] };
      }

      const tools = parsed.tools.map((tool: { name: string; input: Record<string, unknown> }) => ({
        toolName: tool.name,
        input: tool.input || {},
        policy: TOOL_POLICIES[tool.name] || {
          name: tool.name,
          riskLevel: 'moderate',
          requiresConfirmation: true,
          allowedRoles: ['owner'],
          description: 'Herramienta desconocida',
        },
      }));
      const explanation = typeof parsed.explanation === 'string' ? parsed.explanation : undefined;

      return { tools, explanation };
    } catch {
      return { tools: [] };
    }
  }

  /**
   * Check tool policies
   */
  private checkPolicies(tools: ParsedToolCall[], userRole: string): {
    allowed: string[];
    denied: string[];
    dangerous: string[];
    requiresConfirmation: boolean;
  } {
    const allowed: string[] = [];
    const denied: string[] = [];
    const dangerous: string[] = [];
    let requiresConfirmation = false;

    for (const tool of tools) {
      const policy = tool.policy;

      if (!policy.allowedRoles.includes(userRole as 'owner' | 'admin' | 'staff')) {
        denied.push(tool.toolName);
        continue;
      }

      allowed.push(tool.toolName);

      if (policy.riskLevel === 'dangerous') {
        dangerous.push(tool.toolName);
      }

      if (policy.requiresConfirmation) {
        requiresConfirmation = true;
      }
    }

    return { allowed, denied, dangerous, requiresConfirmation };
  }

  /**
   * Create confirmation request for dangerous actions
   */
  private createConfirmationRequest(tools: ParsedToolCall[], dangerousTools: string[]): ConfirmationRequest {
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    const dangerousDetails = tools
      .filter(t => dangerousTools.includes(t.toolName))
      .map(t => ({
        name: t.toolName,
        input: t.input,
        riskLevel: t.policy.riskLevel,
        description: t.policy.description,
      }));

    return {
      token,
      expiresAt,
      tools: dangerousDetails,
      warningMessage: `Esta acción ejecutará: ${dangerousDetails.map(t => t.description).join(', ')}. ¿Confirmar?`,
    };
  }

  /**
   * Execute parsed tools
   */
  private async executeTools(
    tools: ParsedToolCall[],
    workspaceId: string,
    userId: string
  ): Promise<ToolExecutionResult[]> {
    const results: ToolExecutionResult[] = [];

    for (const tool of tools) {
      const startTime = Date.now();

      try {
        const result = await this.executeSingleTool(tool.toolName, tool.input, workspaceId, userId);
        results.push({
          toolName: tool.toolName,
          success: true,
          data: result.data,
          durationMs: Date.now() - startTime,
          canRollback: result.canRollback || false,
          rollbackData: result.rollbackData,
        });
      } catch (error) {
        let errorData: { kind: string; candidates: AmbiguousProductCandidate[] } | undefined;
        if (error instanceof AmbiguousProductError) {
          errorData = { kind: 'ambiguous_product', candidates: error.candidates };
        } else if (error instanceof Error && error.message.includes('Encontré varios productos')) {
          const match = error.message.match(/Encontré varios productos:\s*(.+?)\s*\.\s*Especific/i);
          const fallbackQuery = match?.[1]?.trim() || '';
          const fallbackCandidates = await this.findAmbiguousProductCandidates(tool.input, workspaceId, fallbackQuery);
          if (fallbackCandidates.length > 0) {
            errorData = { kind: 'ambiguous_product', candidates: fallbackCandidates };
          }
        }
        results.push({
          toolName: tool.toolName,
          success: false,
          error: error instanceof Error ? error.message : 'Error desconocido',
          data: errorData,
          durationMs: Date.now() - startTime,
          canRollback: false,
        });
      }
    }

    return results;
  }

  /**
   * Execute a single tool
   */
  private async executeSingleTool(
    toolName: string,
    input: Record<string, unknown>,
    workspaceId: string,
    userId: string
  ): Promise<{ data: unknown; canRollback?: boolean; rollbackData?: unknown }> {
    switch (toolName) {
      case 'navigate_dashboard':
        return this.toolNavigateDashboard(input);
      case 'get_customer_info':
        return this.toolGetCustomerInfo(input, workspaceId);
      case 'list_customers':
        return this.toolListCustomers(input, workspaceId);
      case 'list_debtors':
        return this.toolListDebtors(input, workspaceId);
      case 'send_debt_reminder':
        return this.toolSendDebtReminder(input, workspaceId);
      case 'send_debt_reminders_bulk':
        return this.toolSendDebtRemindersBulk(workspaceId);
      case 'get_unpaid_orders':
        return this.toolGetUnpaidOrders(input, workspaceId);
      case 'search_products':
        return this.toolSearchProducts(input, workspaceId);
      case 'list_products':
        return this.toolListProducts(input, workspaceId);
      case 'get_product_details':
        return this.toolGetProductDetails(input, workspaceId);
      case 'list_categories':
        return this.toolListCategories(input, workspaceId);
      case 'get_order_details':
        return this.toolGetOrderDetails(input, workspaceId);
      case 'list_orders':
        return this.toolListOrders(input, workspaceId);
      case 'list_conversations':
        return this.toolListConversations(input, workspaceId);
      case 'open_conversation':
        return this.toolOpenConversation(input, workspaceId);
      case 'get_conversation_messages':
        return this.toolGetConversationMessages(input, workspaceId);
      case 'get_customer_balance':
        return this.toolGetCustomerBalance(input, workspaceId);
      case 'update_customer':
        return this.toolUpdateCustomer(input, workspaceId);
      case 'update_order_status':
        return this.toolUpdateOrderStatus(input, workspaceId);
      case 'add_order_note':
        return this.toolAddOrderNote(input, workspaceId, userId);
      case 'cancel_order':
        return this.toolCancelOrder(input, workspaceId);
      case 'apply_payment':
        return this.toolApplyPayment(input, workspaceId, userId);
      case 'adjust_stock':
        return this.toolAdjustStock(input, workspaceId);
      case 'bulk_set_stock':
        return this.toolBulkSetStock(input, workspaceId);
      case 'adjust_prices_percent':
        return this.toolAdjustPricesPercent(input, workspaceId);
      case 'create_product':
        return this.toolCreateProduct(input, workspaceId);
      case 'update_product':
        return this.toolUpdateProduct(input, workspaceId);
      case 'delete_product':
        return this.toolDeleteProduct(input, workspaceId);
      case 'create_category':
        return this.toolCreateCategory(input, workspaceId);
      case 'update_category':
        return this.toolUpdateCategory(input, workspaceId);
      case 'delete_category':
        return this.toolDeleteCategory(input, workspaceId);
      case 'assign_category_to_products':
        return this.toolAssignCategoryToProducts(input, workspaceId);
      case 'send_conversation_message':
        return this.toolSendConversationMessage(input, workspaceId, userId);
      case 'set_agent_active':
        return this.toolSetAgentActive(input, workspaceId);
      case 'list_notifications':
        return this.toolListNotifications(input, workspaceId);
      case 'mark_notification_read':
        return this.toolMarkNotificationRead(input, workspaceId);
      case 'mark_all_notifications_read':
        return this.toolMarkAllNotificationsRead(input, workspaceId);
      case 'generate_catalog_pdf':
        return this.toolGenerateCatalogPdf(input, workspaceId);
      case 'get_business_metrics':
        return this.toolGetBusinessMetrics(input, workspaceId);
      case 'get_sales_summary':
        return this.toolGetSalesSummary(input, workspaceId);
      case 'get_low_stock_products':
        return this.toolGetLowStockProducts(input, workspaceId);
      case 'get_business_insights':
        return this.toolGetBusinessInsights(input, workspaceId);
      default:
        throw new Error(`Herramienta no implementada: ${toolName}`);
    }
  }

  // Tool implementations
  private async toolGetCustomerInfo(input: Record<string, unknown>, workspaceId: string) {
    const where: Prisma.CustomerWhereInput = { workspaceId };

    if (input.phone) {
      where.phone = { contains: String(input.phone) };
    } else if (input.email) {
      where.email = { contains: String(input.email), mode: 'insensitive' };
    } else if (input.name) {
      where.OR = [
        { firstName: { contains: String(input.name), mode: 'insensitive' } },
        { lastName: { contains: String(input.name), mode: 'insensitive' } },
      ];
    }

    const customers = await this.prisma.customer.findMany({
      where,
      take: Number(input.limit) || 5,
      select: {
        id: true,
        phone: true,
        firstName: true,
        lastName: true,
        email: true,
        currentBalance: true,
        orderCount: true,
        totalSpent: true,
      },
    });

    return { data: customers.map((customer) => this.normalizeCustomerTotals(customer)) };
  }

  private async toolListCustomers(input: Record<string, unknown>, workspaceId: string) {
    const where: Prisma.CustomerWhereInput = { workspaceId, deletedAt: null };
    const query = input.query ? String(input.query).trim() : '';

    if (query) {
      where.OR = [
        { firstName: { contains: query, mode: 'insensitive' } },
        { lastName: { contains: query, mode: 'insensitive' } },
        { phone: { contains: query.replace(/\D/g, '') } },
        { email: { contains: query, mode: 'insensitive' } },
      ];
    }

    if (input.status) {
      where.status = String(input.status);
    }

    const customers = await this.prisma.customer.findMany({
      where,
      take: Number(input.limit) || 10,
      orderBy: { lastSeenAt: 'desc' },
      select: {
        id: true,
        phone: true,
        firstName: true,
        lastName: true,
        email: true,
        status: true,
        currentBalance: true,
        orderCount: true,
        totalSpent: true,
        lastSeenAt: true,
      },
    });

    return { data: customers.map((customer) => this.normalizeCustomerTotals(customer)) };
  }

  private async toolListDebtors(input: Record<string, unknown>, workspaceId: string) {
    const customers = await this.prisma.customer.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        currentBalance: { gt: 0 },
      },
      take: Number(input.limit) || 10,
      orderBy: { currentBalance: 'desc' },
      select: {
        id: true,
        phone: true,
        firstName: true,
        lastName: true,
        currentBalance: true,
        orderCount: true,
        totalSpent: true,
        lastSeenAt: true,
      },
    });

    return { data: customers.map((customer) => this.normalizeCustomerTotals(customer)) };
  }

  private async toolSendDebtReminder(input: Record<string, unknown>, workspaceId: string) {
    const customer = await this.resolveCustomer(input, workspaceId);
    const ledger = new LedgerService(this.prisma);
    const orders = await ledger.getUnpaidOrders(workspaceId, customer.id);

    if (orders.length === 0) {
      throw new Error('El cliente no tiene deuda pendiente');
    }

    const whatsappNumber = await this.prisma.whatsAppNumber.findFirst({
      where: { workspaceId, isActive: true },
      select: { apiKeyEnc: true, apiKeyIv: true, apiUrl: true, phoneNumber: true, provider: true },
    });

    if (!whatsappNumber) {
      throw new Error('WhatsApp no está configurado');
    }

    const apiKey = this.resolveWhatsAppApiKey(whatsappNumber) || process.env.INFOBIP_API_KEY || '';
    if (!apiKey) {
      throw new Error('Falta la API key de WhatsApp');
    }

    const totalDebt = orders.reduce((sum, order) => sum + order.pendingAmount, 0);
    const name = [customer.firstName, customer.lastName].filter(Boolean).join(' ').trim() || null;
    const message = this.buildDebtReminderMessage({
      name,
      totalDebt,
      orders: orders.map((o) => ({ orderNumber: o.orderNumber, pendingAmount: o.pendingAmount })),
    });

    const { InfobipClient } = await import('@nexova/integrations/whatsapp');
    const client = new InfobipClient({
      apiKey,
      baseUrl: this.resolveInfobipBaseUrl(whatsappNumber.apiUrl),
      senderNumber: whatsappNumber.phoneNumber,
    });

    await client.sendText(this.normalizePhone(customer.phone), message);

    await this.prisma.customer.updateMany({
      where: { id: customer.id, workspaceId },
      data: {
        debtReminderCount: { increment: 1 },
        lastDebtReminderAt: new Date(),
      },
    });

    return {
      data: {
        customer: this.normalizeCustomerTotals(customer),
        totalDebt,
        ordersCount: orders.length,
      },
    };
  }

  private async toolSendDebtRemindersBulk(workspaceId: string) {
    const whatsappNumber = await this.prisma.whatsAppNumber.findFirst({
      where: { workspaceId, isActive: true },
      select: { apiKeyEnc: true, apiKeyIv: true, apiUrl: true, phoneNumber: true, provider: true },
    });

    if (!whatsappNumber) {
      throw new Error('WhatsApp no está configurado');
    }

    const apiKey = this.resolveWhatsAppApiKey(whatsappNumber) || process.env.INFOBIP_API_KEY || '';
    if (!apiKey) {
      throw new Error('Falta la API key de WhatsApp');
    }

    const customers = await this.prisma.customer.findMany({
      where: { workspaceId, deletedAt: null, currentBalance: { gt: 0 } },
      select: { id: true, phone: true, firstName: true, lastName: true },
    });

    if (customers.length === 0) {
      return { data: { sent: 0, failed: 0, total: 0 } };
    }

    const customerIds = customers.map((c) => c.id);
    const orders = await this.prisma.order.findMany({
      where: {
        workspaceId,
        customerId: { in: customerIds },
        deletedAt: null,
        status: { notIn: ['cancelled', 'draft'] },
        OR: [
          { paidAt: null },
          {
            AND: [{ paidAmount: { lt: this.prisma.order.fields.total } }],
          },
        ],
      },
      select: {
        customerId: true,
        orderNumber: true,
        total: true,
        paidAmount: true,
      },
    });

    const ordersByCustomer = new Map<string, Array<{ orderNumber: string; pendingAmount: number }>>();
    orders.forEach((order) => {
      const pending = order.total - order.paidAmount;
      if (pending <= 0) return;
      const list = ordersByCustomer.get(order.customerId) || [];
      list.push({ orderNumber: order.orderNumber, pendingAmount: pending });
      ordersByCustomer.set(order.customerId, list);
    });

    const { InfobipClient } = await import('@nexova/integrations/whatsapp');
    const client = new InfobipClient({
      apiKey,
      baseUrl: this.resolveInfobipBaseUrl(whatsappNumber.apiUrl),
      senderNumber: whatsappNumber.phoneNumber,
    });

    let sent = 0;
    let failed = 0;
    const updatedIds: string[] = [];

    for (const customer of customers) {
      const customerOrders = ordersByCustomer.get(customer.id) || [];
      if (customerOrders.length === 0) continue;
      const totalDebt = customerOrders.reduce((sum, order) => sum + order.pendingAmount, 0);
      const name = [customer.firstName, customer.lastName].filter(Boolean).join(' ').trim() || null;
      const message = this.buildDebtReminderMessage({
        name,
        totalDebt,
        orders: customerOrders,
      });

      try {
        await client.sendText(this.normalizePhone(customer.phone), message);
        sent += 1;
        updatedIds.push(customer.id);
      } catch (error) {
        failed += 1;
      }
    }

    if (updatedIds.length > 0) {
      await this.prisma.customer.updateMany({
        where: { workspaceId, id: { in: updatedIds } },
        data: {
          debtReminderCount: { increment: 1 },
          lastDebtReminderAt: new Date(),
        },
      });
    }

    return { data: { sent, failed, total: customers.length } };
  }

  private async toolNavigateDashboard(input: Record<string, unknown>) {
    const page = typeof input.page === 'string' ? input.page : '';
    const path = this.resolveDashboardPath(page);
    if (!path) {
      throw new Error('Pantalla no reconocida');
    }
    const query = typeof input.query === 'object' && input.query ? (input.query as Record<string, string>) : undefined;
    return { data: { path, query } };
  }

  private async toolGetUnpaidOrders(input: Record<string, unknown>, workspaceId: string) {
    const customer = await this.resolveCustomer(input, workspaceId);
    const ledger = new LedgerService(this.prisma);
    const orders = await ledger.getUnpaidOrders(workspaceId, customer.id);
    const totalPending = orders.reduce((sum, order) => sum + order.pendingAmount, 0);
    return {
      data: {
        customer: this.normalizeCustomerTotals(customer),
        orders,
        totalPending,
      },
    };
  }

  private async toolUpdateCustomer(input: Record<string, unknown>, workspaceId: string) {
    const customer = await this.resolveCustomer(input, workspaceId);
    const data = input.data && typeof input.data === 'object' ? (input.data as Record<string, unknown>) : {};

    const updateData: Prisma.CustomerUpdateManyMutationInput = {};
    if (data.firstName) updateData.firstName = String(data.firstName);
    if (data.lastName) updateData.lastName = String(data.lastName);
    if (data.email !== undefined) updateData.email = data.email ? String(data.email) : null;
    if (data.phone) updateData.phone = this.normalizePhone(String(data.phone));
    if (data.status) updateData.status = String(data.status);

    if (data.name && (!data.firstName || !data.lastName)) {
      const parts = String(data.name).trim().split(/\s+/);
      if (parts.length > 0 && !data.firstName) updateData.firstName = parts[0];
      if (parts.length > 1 && !data.lastName) updateData.lastName = parts.slice(1).join(' ');
    }

    if (data.dni !== undefined || data.notes !== undefined) {
      const currentMetadata = (customer.metadata as Record<string, unknown>) || {};
      updateData.metadata = {
        ...currentMetadata,
        ...(data.dni !== undefined ? { dni: data.dni } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
      } as Prisma.InputJsonValue;
    }

    if (Object.keys(updateData).length === 0) {
      throw new Error('No hay campos para actualizar');
    }

    await this.prisma.customer.updateMany({
      where: { id: customer.id, workspaceId },
      data: updateData,
    });

    const updated = await this.prisma.customer.findFirst({
      where: { id: customer.id, workspaceId },
    });

    if (!updated) {
      throw new Error('Cliente no encontrado');
    }

    return { data: updated };
  }

  private async toolSearchProducts(input: Record<string, unknown>, workspaceId: string) {
    const baseWhere: Prisma.ProductWhereInput = {
      workspaceId,
      // Quick actions are an owner/admin operator surface, allow draft products too.
      status: { not: 'archived' },
      deletedAt: null,
    };

    const rawQuery = input.query ? String(input.query) : '';
    const cleanedQuery = rawQuery ? this.cleanProductQuery(rawQuery) : '';
    const andClauses: Prisma.ProductWhereInput[] = [];

    if (cleanedQuery) {
      const measurement = this.parseProductMeasurement(cleanedQuery);
      const baseName = measurement?.baseName?.trim() || '';
      const baseIsGeneric = baseName ? this.isGenericProductWord(baseName) : false;
      const valueVariants = measurement ? this.buildUnitValueVariants(measurement.unitValue) : [];
      const secondaryValueVariants = measurement ? this.buildUnitValueVariants(measurement.secondaryUnitValue) : [];

      if (measurement && (valueVariants.length > 0 || measurement.unit || measurement.secondaryUnit || secondaryValueVariants.length > 0)) {
        if (baseIsGeneric || !baseName) {
          const measurementClause: Prisma.ProductWhereInput = {};
          if (valueVariants.length > 0) {
            measurementClause.unitValue = { in: valueVariants };
          }
          if (measurement.unit) {
            measurementClause.unit = measurement.unit;
          }
          if (measurement.secondaryUnit) {
            measurementClause.secondaryUnit = measurement.secondaryUnit;
          }
          if (secondaryValueVariants.length > 0) {
            measurementClause.secondaryUnitValue = { in: secondaryValueVariants };
          }
          if (Object.keys(measurementClause).length > 0) {
            andClauses.push(measurementClause);
          }
        } else {
          const measurementClause: Prisma.ProductWhereInput = {
            name: { contains: baseName, mode: 'insensitive' },
          };
          if (valueVariants.length > 0) {
            measurementClause.unitValue = { in: valueVariants };
          }
          if (measurement.unit) {
            measurementClause.unit = measurement.unit;
          }
          if (measurement.secondaryUnit) {
            measurementClause.secondaryUnit = measurement.secondaryUnit;
          }
          if (secondaryValueVariants.length > 0) {
            measurementClause.secondaryUnitValue = { in: secondaryValueVariants };
          }
          andClauses.push({
            OR: [
              measurementClause,
              { sku: { contains: baseName, mode: 'insensitive' } },
              { name: { contains: baseName, mode: 'insensitive' } },
            ],
          });
        }
      } else {
        andClauses.push({
          OR: [
            { name: { contains: cleanedQuery, mode: 'insensitive' } },
            { sku: { contains: cleanedQuery, mode: 'insensitive' } },
          ],
        });
      }
    }

    const categoryName = input.category ? String(input.category).trim() : '';
    if (categoryName) {
      andClauses.push({
        OR: [
          { category: { contains: categoryName, mode: 'insensitive' } },
          { categoryMappings: { some: { category: { name: { contains: categoryName, mode: 'insensitive' } } } } },
        ],
      });
    }

    const where: Prisma.ProductWhereInput = {
      ...baseWhere,
      ...(andClauses.length > 0 ? { AND: andClauses } : {}),
    };

    const select = {
      id: true,
      sku: true,
      name: true,
      price: true,
      category: true,
      unit: true,
      unitValue: true,
      secondaryUnit: true,
      secondaryUnitValue: true,
      stockItems: {
        select: { quantity: true, reserved: true },
      },
    };

    let products = await this.prisma.product.findMany({
      where,
      take: Number(input.limit) || 10,
      select,
    });

    if (products.length === 0 && !categoryName && cleanedQuery) {
      const fallbackWhere: Prisma.ProductWhereInput = {
        ...baseWhere,
        AND: [
          {
            OR: [
              { category: { contains: cleanedQuery, mode: 'insensitive' } },
              { categoryMappings: { some: { category: { name: { contains: cleanedQuery, mode: 'insensitive' } } } } },
            ],
          },
        ],
      };
      products = await this.prisma.product.findMany({
        where: fallbackWhere,
        take: Number(input.limit) || 10,
        select,
      });
    }

    return {
      data: products.map(p => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        unit: p.unit,
        unitValue: p.unitValue,
        secondaryUnit: p.secondaryUnit,
        secondaryUnitValue: p.secondaryUnitValue,
        price: p.price,
        category: p.category,
        stock: p.stockItems.reduce((sum, s) => sum + s.quantity - s.reserved, 0),
      })),
    };
  }

  private async toolListProducts(input: Record<string, unknown>, workspaceId: string) {
    const where: Prisma.ProductWhereInput = {
      workspaceId,
      deletedAt: null,
    };
    const andClauses: Prisma.ProductWhereInput[] = [];

    if (input.status) {
      const status = String(input.status);
      if (status === 'archived') {
        return { data: [] };
      }
      where.status = status;
    } else {
      where.status = { not: 'archived' };
    }

    if (input.query) {
      andClauses.push({
        OR: [
          { name: { contains: String(input.query), mode: 'insensitive' } },
          { sku: { contains: String(input.query), mode: 'insensitive' } },
        ],
      });
    }

    if (input.category) {
      const categoryName = String(input.category);
      andClauses.push({
        OR: [
          { category: { contains: categoryName, mode: 'insensitive' } },
          { categoryMappings: { some: { category: { name: { contains: categoryName, mode: 'insensitive' } } } } },
        ],
      });
    }

    if (andClauses.length > 0) {
      where.AND = andClauses;
    }

    const products = await this.prisma.product.findMany({
      where,
      take: Number(input.limit) || 10,
      select: {
        id: true,
        sku: true,
        name: true,
        price: true,
        category: true,
        status: true,
        unit: true,
        unitValue: true,
        secondaryUnit: true,
        secondaryUnitValue: true,
        stockItems: {
          select: { quantity: true, reserved: true, lowThreshold: true },
        },
      },
    });

    return {
      data: products.map((p) => {
        const stock = p.stockItems.reduce((sum, s) => sum + s.quantity - s.reserved, 0);
        const lowThreshold = p.stockItems[0]?.lowThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
        return {
          id: p.id,
          sku: p.sku,
          name: p.name,
          price: p.price,
          category: p.category,
          status: p.status,
          unit: p.unit,
          unitValue: p.unitValue,
          secondaryUnit: p.secondaryUnit,
          secondaryUnitValue: p.secondaryUnitValue,
          stock,
          lowThreshold,
          isLowStock: stock > 0 && stock <= lowThreshold,
          isOutOfStock: stock <= 0,
        };
      }),
    };
  }

  private async toolGetProductDetails(input: Record<string, unknown>, workspaceId: string) {
    const product = await this.resolveProduct(input, workspaceId);

    const productWithCategories = await this.prisma.product.findFirst({
      where: { id: product.id, workspaceId, deletedAt: null },
      include: {
        stockItems: true,
        categoryMappings: {
          include: {
            category: { select: { id: true, name: true, color: true } },
          },
        },
      },
    });

    if (!productWithCategories) {
      throw new Error('Producto no encontrado');
    }

    const stock = productWithCategories.stockItems.reduce((sum, s) => sum + s.quantity - s.reserved, 0);
    const lowThreshold =
      productWithCategories.stockItems[0]?.lowThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;

    return {
      data: {
        id: productWithCategories.id,
        sku: productWithCategories.sku,
        name: productWithCategories.name,
        description: productWithCategories.description,
        shortDesc: productWithCategories.shortDesc,
        unit: productWithCategories.unit,
        unitValue: productWithCategories.unitValue,
        secondaryUnit: productWithCategories.secondaryUnit,
        secondaryUnitValue: productWithCategories.secondaryUnitValue,
        price: productWithCategories.price,
        comparePrice: productWithCategories.comparePrice,
        status: productWithCategories.status,
        category: productWithCategories.category,
        categories: productWithCategories.categoryMappings
          .filter((m) => m.category)
          .map((m) => ({
            id: m.category!.id,
            name: m.category!.name,
            color: m.category!.color,
          })),
        stock,
        lowThreshold,
        isLowStock: stock > 0 && stock <= lowThreshold,
        isOutOfStock: stock <= 0,
      },
    };
  }

  private async toolListCategories(input: Record<string, unknown>, workspaceId: string) {
    const categories = await this.prisma.productCategory.findMany({
      where: { workspaceId, deletedAt: null },
      take: Number(input.limit) || 20,
      orderBy: { sortOrder: 'asc' },
      include: {
        _count: {
          select: { products: true },
        },
      },
    });

    return {
      data: categories.map((category) => ({
        id: category.id,
        name: category.name,
        description: category.description,
        color: category.color,
        sortOrder: category.sortOrder,
        productCount: category._count.products,
      })),
    };
  }

  private async toolGetOrderDetails(input: Record<string, unknown>, workspaceId: string) {
    const where: Prisma.OrderWhereInput = { workspaceId };

    if (input.orderId) {
      where.id = String(input.orderId);
    } else if (input.orderNumber) {
      where.orderNumber = String(input.orderNumber);
    } else {
      throw new Error('Se requiere orderId o orderNumber');
    }

    const order = await this.prisma.order.findFirst({
      where,
      include: {
        customer: { select: { firstName: true, lastName: true, phone: true } },
        items: { include: { product: { select: { name: true, sku: true } } } },
      },
    });

    if (!order) {
      throw new Error('Pedido no encontrado');
    }

    return { data: order };
  }

  private async toolListOrders(input: Record<string, unknown>, workspaceId: string) {
    const where: Prisma.OrderWhereInput = { workspaceId };

    if (input.status) {
      where.status = String(input.status);
    }

    if (input.customerId) {
      where.customerId = String(input.customerId);
    }

    if (input.date === 'today' || input.date === 'hoy') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      where.createdAt = { gte: today };
    } else if (input.date === 'week' || input.date === 'semana') {
      const now = new Date();
      const day = now.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      const start = new Date(now);
      start.setDate(now.getDate() + diff);
      start.setHours(0, 0, 0, 0);
      where.createdAt = { gte: start };
    } else if (input.date === 'month' || input.date === 'mes') {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      start.setHours(0, 0, 0, 0);
      where.createdAt = { gte: start };
    }

    const orders = await this.prisma.order.findMany({
      where,
      take: Number(input.limit) || 20,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        total: true,
        createdAt: true,
        customer: { select: { firstName: true, lastName: true } },
      },
    });

    return { data: orders };
  }

  private async toolListConversations(input: Record<string, unknown>, workspaceId: string) {
    const sessions = await this.prisma.agentSession.findMany({
      where: {
        workspaceId,
        endedAt: null,
      },
      include: {
        customer: {
          select: {
            id: true,
            phone: true,
            firstName: true,
            lastName: true,
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { lastActivityAt: 'desc' },
      take: Number(input.limit) || 10,
    });

    return {
      data: sessions.map((session) => ({
        id: session.id,
        customerId: session.customerId,
        customerPhone: session.customer.phone,
        customerName: session.customer.firstName
          ? `${session.customer.firstName} ${session.customer.lastName || ''}`.trim()
          : session.customer.phone,
        channelType: session.channelType,
        agentActive: session.agentActive,
        currentState: session.currentState,
        lastMessage: session.messages[0]?.content || null,
        lastMessageRole: session.messages[0]?.role || null,
        lastActivityAt: session.lastActivityAt,
      })),
    };
  }

  private async toolOpenConversation(input: Record<string, unknown>, workspaceId: string) {
    const session = await this.resolveConversation(input, workspaceId);
    return { data: session };
  }

  private async toolGetConversationMessages(input: Record<string, unknown>, workspaceId: string) {
    const session = await this.resolveConversation(input, workspaceId);
    const limit = Number(input.limit) || 20;

    const messages = await this.prisma.agentMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        role: true,
        content: true,
        createdAt: true,
      },
    });

    return {
      data: {
        session,
        messages: messages.reverse(),
      },
    };
  }

  private async toolGetCustomerBalance(input: Record<string, unknown>, workspaceId: string) {
    const customer = await this.resolveCustomer(input, workspaceId);
    const customerId = customer.id;

    // Get unpaid orders
    const unpaidOrders = await this.prisma.order.findMany({
      where: {
        customerId,
        workspaceId,
        status: { notIn: ['cancelled', 'draft'] },
      },
      select: { orderNumber: true, total: true, paidAmount: true },
    });

    const ordersWithDebt = unpaidOrders.filter(o => o.total > o.paidAmount);
    const normalizedCustomer = this.normalizeCustomerTotals(customer);

    return {
      data: {
        ...normalizedCustomer,
        unpaidOrders: ordersWithDebt,
      },
    };
  }

  private async toolUpdateOrderStatus(input: Record<string, unknown>, workspaceId: string) {
    const status = String(input.status || '').trim();
    if (!status) {
      throw new Error('Estado inválido');
    }

    const order = await this.resolveOrder(input, workspaceId);

    const previousStatus = order.status;

    const updateData: { status: string; notes?: string } = { status };
    if (input.notes) {
      updateData.notes = String(input.notes);
    }

    await this.prisma.order.updateMany({
      where: { id: order.id, workspaceId },
      data: updateData,
    });

    const updated = await this.prisma.order.findFirst({
      where: { id: order.id, workspaceId },
    });
    if (!updated) {
      throw new Error('Pedido no encontrado');
    }

    return {
      data: updated,
      canRollback: true,
      rollbackData: { orderId: order.id, previousStatus },
    };
  }

  private async toolCancelOrder(input: Record<string, unknown>, workspaceId: string) {
    const order = await this.resolveOrder(input, workspaceId);

    if (order.status === 'cancelled') {
      throw new Error('El pedido ya está cancelado');
    }

    const previousStatus = order.status;

    await this.prisma.order.updateMany({
      where: { id: order.id, workspaceId },
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelReason: String(input.reason || 'Cancelado via Quick Action'),
      },
    });

    const updated = await this.prisma.order.findFirst({
      where: { id: order.id, workspaceId },
    });
    if (!updated) {
      throw new Error('Pedido no encontrado');
    }

    return {
      data: updated,
      canRollback: true,
      rollbackData: { orderId: order.id, previousStatus },
    };
  }

  private async toolAddOrderNote(
    input: Record<string, unknown>,
    workspaceId: string,
    userId: string
  ) {
    const note = String(input.note || '').trim();
    if (!note) {
      throw new Error('La nota no puede estar vacía');
    }

    const order = await this.resolveOrder(input, workspaceId);
    const existingNotes = order.notes ? String(order.notes) : '';
    const timestamp = new Date().toLocaleString('es-AR');
    const prefix = `[${timestamp}${userId ? ` · ${userId}` : ''}]`;
    const updatedNotes = existingNotes
      ? `${existingNotes}\n\n${prefix} ${note}`
      : `${prefix} ${note}`;

    await this.prisma.order.updateMany({
      where: { id: order.id, workspaceId },
      data: { notes: updatedNotes },
    });

    const updated = await this.prisma.order.findFirst({
      where: { id: order.id, workspaceId },
    });

    if (!updated) {
      throw new Error('Pedido no encontrado');
    }

    return { data: updated };
  }

  private async toolApplyPayment(
    input: Record<string, unknown>,
    workspaceId: string,
    userId: string
  ) {
    const customer = await this.resolveCustomer(input, workspaceId);
    const amountRaw = Number(input.amount);
    if (!Number.isFinite(amountRaw) || amountRaw <= 0) {
      throw new Error('Monto inválido');
    }
    const amount = this.toCents(amountRaw);
    const description = input.description ? String(input.description) : 'Pago registrado';
    const ledger = new LedgerService(this.prisma);

    const orderInput = {
      orderId: input.orderId,
      orderNumber: input.orderNumber,
    } as Record<string, unknown>;

    const order = orderInput.orderId || orderInput.orderNumber
      ? await this.resolveOrder(orderInput, workspaceId, customer.id)
      : null;

    if (order) {
      const result = await ledger.applyPaymentToOrder(
        workspaceId,
        customer.id,
        order.id,
        amount,
        'Payment',
        randomUUID(),
        userId
      );
      return { data: { customer, order, amount, result } };
    }

    const result = await ledger.applyPayment({
      workspaceId,
      customerId: customer.id,
      amount,
      referenceType: 'Payment',
      referenceId: randomUUID(),
      description,
      createdBy: userId,
    });

    return { data: { customer, amount, result } };
  }

  private async toolAdjustStock(input: Record<string, unknown>, workspaceId: string) {
    const product = await this.resolveProduct(input, workspaceId);
    const workspaceLowThreshold = await this.getWorkspaceLowStockThreshold(workspaceId);
    const adjustment = Number(input.quantity);
    if (!Number.isFinite(adjustment) || adjustment === 0) {
      throw new Error('Cantidad inválida');
    }

    const stockItems = Array.isArray((product as any).stockItems)
      ? ((product as any).stockItems as Array<{ quantity?: number | null; reserved?: number | null }>)
      : [];
    const previousTotalQty = stockItems.reduce((sum, s) => sum + (s.quantity || 0), 0);
    const reservedTotal = stockItems.reduce((sum, s) => sum + (s.reserved || 0), 0);
    const previousAvailable = previousTotalQty - reservedTotal;

    let stockItem = product.stockItems?.[0];
    const previousQty = stockItem?.quantity || 0;
    const previousReserved = stockItem?.reserved || 0;
    const newQty = previousQty + adjustment;
    const newTotalQty = previousTotalQty + adjustment;
    const newAvailable = newTotalQty - reservedTotal;

    if (newQty < 0 || newQty < previousReserved || newTotalQty < reservedTotal) {
      throw new Error('El stock no puede quedar negativo');
    }

    if (stockItem) {
      stockItem = await this.prisma.stockItem.update({
        where: { id: stockItem.id },
        data: { quantity: newQty },
      });

      await this.prisma.stockMovement.create({
        data: {
          stockItemId: stockItem.id,
          type: 'adjustment',
          quantity: adjustment,
          previousQty,
          newQty,
          reason: String(input.reason || 'Ajuste manual'),
        },
      });
    } else {
      stockItem = await this.prisma.stockItem.create({
        data: {
          productId: product.id,
          quantity: newQty,
          lowThreshold: workspaceLowThreshold,
        },
      });

      await this.prisma.stockMovement.create({
        data: {
          stockItemId: stockItem.id,
          type: 'adjustment',
          quantity: adjustment,
          previousQty: 0,
          newQty,
          reason: String(input.reason || 'Stock inicial'),
        },
      });
    }

    const lowThreshold = stockItem.lowThreshold ?? workspaceLowThreshold;
    if (newAvailable <= lowThreshold && newAvailable !== previousAvailable) {
      const displayName = this.buildProductDisplayName(product);
      await createNotificationIfEnabled(this.prisma, {
        workspaceId,
        type: 'stock.low',
        title: `Stock bajo: ${displayName}`,
        message: `Quedan ${newAvailable} unidades (mínimo ${lowThreshold}).`,
        entityType: 'Product',
        entityId: product.id,
        metadata: {
          productId: product.id,
          productName: displayName,
          available: newAvailable,
          lowThreshold,
          sku: product.sku,
        },
      });
    }

    return {
      data: {
        productId: product.id,
        productName: this.buildProductDisplayName(product),
        previousQuantity: previousTotalQty,
        reserved: reservedTotal,
        previousAvailable,
        adjustment,
        newQuantity: newTotalQty,
        newAvailable,
      },
    };
  }

  private async toolBulkSetStock(input: Record<string, unknown>, workspaceId: string) {
    const rawTarget = input.target ?? input.quantity ?? input.amount;
    const targetValue = Number(rawTarget);
    if (!Number.isFinite(targetValue)) {
      throw new Error('Cantidad inválida');
    }
    const target = Math.round(targetValue);
    const mode = input.mode === 'adjust' ? 'adjust' : 'set';

    if (mode === 'set' && target < 0) {
      throw new Error('El stock objetivo no puede ser negativo');
    }

    const categoryName = typeof input.categoryName === 'string' ? input.categoryName.trim() : '';
    const where: Prisma.ProductWhereInput = {
      workspaceId,
      deletedAt: null,
      status: { not: 'archived' },
    };
    if (categoryName) {
      where.OR = [
        { category: { contains: categoryName, mode: 'insensitive' } },
        { categoryMappings: { some: { category: { name: { contains: categoryName, mode: 'insensitive' } } } } },
      ];
    }

    const products = await this.prisma.product.findMany({
      where,
      include: { stockItems: true },
    });
    const workspaceLowThreshold = await this.getWorkspaceLowStockThreshold(workspaceId);

    if (products.length === 0) {
      throw new Error(
        categoryName
          ? `No encontré productos en la categoría "${categoryName}".`
          : 'No hay productos para actualizar'
      );
    }

    const plan = products.map((product) => {
      const stockItem = product.stockItems?.[0];
      const currentQty = stockItem?.quantity ?? 0;
      const reserved = stockItem?.reserved ?? 0;
      const desiredQty = mode === 'set' ? target + reserved : currentQty + target;
      return {
        product,
        stockItem,
        currentQty,
        reserved,
        desiredQty,
        adjustment: desiredQty - currentQty,
      };
    });

    const invalid = plan.filter((item) => item.desiredQty < 0);
    if (invalid.length > 0) {
      const names = invalid.slice(0, 3).map((item) => item.product.name).join(', ');
      throw new Error(`El stock resultante es negativo para: ${names}. Ajustá la cantidad.`);
    }

    const reasonBase = String(input.reason || 'Ajuste masivo de stock');
    const updated: Array<{ id: string; name: string; newQty: number; adjustment: number }> = [];

    await this.prisma.$transaction(async (tx) => {
      for (const item of plan) {
        if (item.adjustment === 0) continue;
        if (item.stockItem) {
          const updatedItem = await tx.stockItem.update({
            where: { id: item.stockItem.id },
            data: { quantity: item.desiredQty },
          });
          await tx.stockMovement.create({
            data: {
              stockItemId: updatedItem.id,
              type: 'adjustment',
              quantity: item.adjustment,
              previousQty: item.currentQty,
              newQty: item.desiredQty,
              reason: mode === 'set' ? `${reasonBase} (objetivo ${target} uds)` : reasonBase,
            },
          });
        } else {
          const createdItem = await tx.stockItem.create({
            data: {
              productId: item.product.id,
              quantity: item.desiredQty,
              lowThreshold: workspaceLowThreshold,
            },
          });
          await tx.stockMovement.create({
            data: {
              stockItemId: createdItem.id,
              type: 'adjustment',
              quantity: item.desiredQty,
              previousQty: 0,
              newQty: item.desiredQty,
              reason: mode === 'set' ? `${reasonBase} (objetivo ${target} uds)` : reasonBase,
            },
          });
        }

        const availableAfter = item.desiredQty - (item.reserved || 0);
        const lowThreshold = item.stockItem?.lowThreshold ?? workspaceLowThreshold;
        if (availableAfter <= lowThreshold) {
          const displayName = this.buildProductDisplayName(item.product);
          await createNotificationIfEnabled(tx, {
            workspaceId,
            type: 'stock.low',
            title: `Stock bajo: ${displayName}`,
            message: `Quedan ${availableAfter} unidades (mínimo ${lowThreshold}).`,
            entityType: 'Product',
            entityId: item.product.id,
            metadata: {
              productId: item.product.id,
              productName: displayName,
              available: availableAfter,
              lowThreshold,
              sku: item.product.sku,
            },
          });
        }

        updated.push({
          id: item.product.id,
          name: item.product.name,
          newQty: item.desiredQty,
          adjustment: item.adjustment,
        });
      }
    });

    const updatedCount = updated.length;
    const unchangedCount = plan.length - updatedCount;

    return {
      data: {
        mode,
        target,
        categoryName: categoryName || null,
        totalProducts: plan.length,
        updatedCount,
        unchangedCount,
        sample: updated.slice(0, 5),
      },
    };
  }

  private async toolAdjustPricesPercent(input: Record<string, unknown>, workspaceId: string) {
    const percentCandidate = input.percent ?? input.percentage ?? input.deltaPercent;
    const amountCandidate = input.amount ?? input.amountPesos ?? input.deltaAmount;
    const hasPercent = percentCandidate !== undefined && percentCandidate !== null && `${percentCandidate}`.trim() !== '';
    const hasAmount = amountCandidate !== undefined && amountCandidate !== null && `${amountCandidate}`.trim() !== '';
    if (!hasPercent && !hasAmount) {
      throw new Error('Indicá un porcentaje o un monto en pesos para ajustar precios.');
    }

    const rawPercent = hasPercent ? Number(percentCandidate) : null;
    const rawAmount = hasAmount ? Number(amountCandidate) : null;

    const mode: 'percent' | 'amount' = rawPercent !== null && Number.isFinite(rawPercent) ? 'percent' : 'amount';
    if (mode === 'percent') {
      if (!Number.isFinite(rawPercent) || rawPercent === 0) {
        throw new Error('Porcentaje inválido');
      }
      if (Math.abs(rawPercent as number) > 500) {
        throw new Error('El porcentaje máximo permitido es 500%');
      }
    } else {
      if (!Number.isFinite(rawAmount) || rawAmount === 0) {
        throw new Error('Monto inválido');
      }
      if (Math.abs(rawAmount as number) > 10000000) {
        throw new Error('El monto máximo permitido es $10.000.000');
      }
    }

    const factor = mode === 'percent' ? 1 + (rawPercent as number) / 100 : null;
    const amountCents = mode === 'amount' ? this.toCents(rawAmount as number) : null;
    if (mode === 'percent' && factor !== null && factor <= 0) {
      throw new Error('El ajuste deja precios en cero o negativo');
    }

    let categoryName = typeof input.categoryName === 'string' ? input.categoryName.trim() : '';
    const categoryId = typeof input.categoryId === 'string' ? input.categoryId.trim() : '';
    const singleName =
      (typeof input.name === 'string' && input.name.trim()) ||
      (typeof input.productName === 'string' && input.productName.trim()) ||
      '';
    const singleSku =
      (typeof input.sku === 'string' && input.sku.trim()) ||
      '';
    const singleProductId =
      (typeof input.productId === 'string' && input.productId.trim()) ||
      '';
    const query = typeof input.query === 'string' ? this.cleanProductQuery(input.query).trim() : '';

    const productIds = Array.isArray(input.productIds)
      ? (input.productIds as Array<unknown>).map((id) => String(id).trim()).filter(Boolean)
      : [];
    const productSkus = Array.isArray(input.skus)
      ? (input.skus as Array<unknown>).map((sku) => String(sku).trim()).filter(Boolean)
      : [];
    const productNames = Array.isArray(input.productNames)
      ? (input.productNames as Array<unknown>).map((name) => this.cleanProductQuery(String(name))).filter(Boolean)
      : [];

    const selectedProducts = new Map<
      string,
      {
        id: string;
        name: string;
        sku: string;
        price: number;
        unit: string | null;
        unitValue: string | null;
        secondaryUnit: string | null;
        secondaryUnitValue: string | null;
      }
    >();
    const addProducts = (
      products: Array<{
        id: string;
        name: string;
        sku: string;
        price: number;
        unit: string | null;
        unitValue: string | null;
        secondaryUnit: string | null;
        secondaryUnitValue: string | null;
      }>
    ) => {
      for (const product of products) {
        selectedProducts.set(product.id, product);
      }
    };

    const select = {
      id: true,
      name: true,
      sku: true,
      price: true,
      unit: true,
      unitValue: true,
      secondaryUnit: true,
      secondaryUnitValue: true,
    } as const;

    if (!categoryName && !categoryId) {
      categoryName = this.extractCategoryFromAllPhrase(singleName)
        || this.extractCategoryFromAllPhrase(query)
        || '';
    }

    if (categoryName || categoryId) {
      const category = await this.resolveCategory(
        categoryId ? { categoryId } : { name: categoryName },
        workspaceId
      );
      const categoryProducts = await this.prisma.product.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          status: { not: 'archived' },
          OR: [
            { categoryMappings: { some: { categoryId: category.id } } },
            { category: { contains: category.name, mode: 'insensitive' } },
          ],
        },
        select,
      });
      addProducts(categoryProducts);
      if (categoryProducts.length === 0) {
        throw new Error(`No encontré productos para la categoría "${category.name}".`);
      }
    }

    if (productIds.length > 0) {
      const byIds = await this.prisma.product.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          status: { not: 'archived' },
          id: { in: productIds },
        },
        select,
      });
      addProducts(byIds);
      if (byIds.length !== new Set(productIds).size) {
        throw new Error('Uno o más productIds no existen o están archivados.');
      }
    }

    for (const sku of productSkus) {
      const product = await this.resolveProduct({ sku }, workspaceId);
      addProducts([{
        id: product.id,
        name: product.name,
        sku: product.sku,
        price: product.price,
        unit: product.unit,
        unitValue: product.unitValue,
        secondaryUnit: product.secondaryUnit,
        secondaryUnitValue: product.secondaryUnitValue,
      }]);
    }

    if (singleProductId || singleSku || singleName) {
      const resolved = await this.resolveProduct(
        {
          ...(singleProductId ? { productId: singleProductId } : {}),
          ...(singleSku ? { sku: singleSku } : {}),
          ...(singleName ? { name: singleName } : {}),
        },
        workspaceId
      );
      addProducts([{
        id: resolved.id,
        name: resolved.name,
        sku: resolved.sku,
        price: resolved.price,
        unit: resolved.unit,
        unitValue: resolved.unitValue,
        secondaryUnit: resolved.secondaryUnit,
        secondaryUnitValue: resolved.secondaryUnitValue,
      }]);
    }

    for (const productName of productNames) {
      const product = await this.resolveProduct({ name: productName }, workspaceId);
      addProducts([{
        id: product.id,
        name: product.name,
        sku: product.sku,
        price: product.price,
        unit: product.unit,
        unitValue: product.unitValue,
        secondaryUnit: product.secondaryUnit,
        secondaryUnitValue: product.secondaryUnitValue,
      }]);
    }

    if (query) {
      const queriedProducts = await this.prisma.product.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          status: { not: 'archived' },
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { sku: { contains: query, mode: 'insensitive' } },
          ],
        },
        take: 200,
        select,
      });
      addProducts(queriedProducts);
      if (queriedProducts.length === 0) {
        throw new Error(`No encontré productos con "${query}".`);
      }
    }

    const targets = Array.from(selectedProducts.values());
    if (targets.length === 0) {
      throw new Error('Indicá al menos un producto o una categoría para ajustar precios.');
    }

    const invalid = targets.filter((product) => {
      const nextPrice = mode === 'percent'
        ? Math.round(product.price * (factor as number))
        : product.price + (amountCents as number);
      return nextPrice <= 0;
    });
    if (invalid.length > 0) {
      const names = invalid.slice(0, 3).map((product) => this.buildProductDisplayName(product)).join(', ');
      throw new Error(`El ajuste deja precio inválido para: ${names}.`);
    }

    const updated: Array<{
      id: string;
      name: string;
      previousPrice: number;
      newPrice: number;
      delta: number;
    }> = [];

    await this.prisma.$transaction(async (tx) => {
      for (const product of targets) {
        const nextPrice = mode === 'percent'
          ? Math.round(product.price * (factor as number))
          : product.price + (amountCents as number);
        if (nextPrice === product.price) continue;

        await tx.product.updateMany({
          where: { id: product.id, workspaceId, deletedAt: null },
          data: { price: nextPrice },
        });

        updated.push({
          id: product.id,
          name: product.name,
          previousPrice: product.price,
          newPrice: nextPrice,
          delta: nextPrice - product.price,
        });
      }
    });

    return {
      data: {
        mode,
        percent: mode === 'percent' ? rawPercent : null,
        amount: mode === 'amount' ? rawAmount : null,
        amountCents: mode === 'amount' ? amountCents : null,
        factor: mode === 'percent' ? factor : null,
        categoryName: categoryName || null,
        totalProducts: targets.length,
        updatedCount: updated.length,
        unchangedCount: Math.max(0, targets.length - updated.length),
        sample: updated.slice(0, 10),
      },
    };
  }

  private async toolCreateProduct(input: Record<string, unknown>, workspaceId: string) {
    const name = String(input.name || '').trim();
    if (!name) {
      throw new Error('El nombre del producto es requerido');
    }
    const priceRaw = Number(input.price);
    if (!Number.isFinite(priceRaw) || priceRaw <= 0) {
      throw new Error('Precio inválido');
    }

    const skuInput = input.sku ? String(input.sku).trim() : '';
    const sku = skuInput || `SKU-${Date.now().toString(36).toUpperCase()}`;

    const existing = await this.prisma.product.findFirst({
      where: { workspaceId, sku, deletedAt: null },
    });
    if (existing) {
      throw new Error('Ya existe un producto con ese SKU');
    }

    const unit = input.unit ? String(input.unit) : 'unit';
    const unitValue = input.unitValue ? String(input.unitValue) : null;
    const secondaryUnit = input.secondaryUnit ? String(input.secondaryUnit) : null;
    const secondaryUnitValueRaw = input.secondaryUnitValue !== undefined ? String(input.secondaryUnitValue) : null;
    const secondaryUnitValue =
      secondaryUnit === 'dozen'
        ? '12'
        : secondaryUnitValueRaw && secondaryUnitValueRaw.trim().length > 0
          ? secondaryUnitValueRaw.trim()
          : null;
    if (secondaryUnit && secondaryUnit !== 'dozen' && !secondaryUnitValue) {
      throw new Error('La segunda unidad requiere un valor (pack, caja o bulto)');
    }
    const initialStock = input.initialStock !== undefined ? Number(input.initialStock) : undefined;
    const lowThreshold = input.lowThreshold !== undefined ? Number(input.lowThreshold) : undefined;
    const workspaceLowThreshold = await this.getWorkspaceLowStockThreshold(workspaceId);
    if (initialStock !== undefined && (!Number.isFinite(initialStock) || initialStock < 0)) {
      throw new Error('Stock inicial inválido');
    }

    const categoryIds = Array.isArray(input.categoryIds)
      ? (input.categoryIds as Array<unknown>).map((id) => String(id)).filter(Boolean)
      : [];

    const product = await this.prisma.product.create({
      data: {
        workspaceId,
        sku,
        name,
        description: input.description ? String(input.description) : null,
        shortDesc: input.shortDesc ? String(input.shortDesc) : null,
        unit,
        unitValue: unit !== 'unit' ? unitValue : null,
        secondaryUnit,
        secondaryUnitValue,
        category: input.category ? String(input.category) : null,
        price: this.toCents(priceRaw),
        comparePrice: input.comparePrice !== undefined ? this.toCents(Number(input.comparePrice)) : null,
        images: Array.isArray(input.images) ? (input.images as string[]) : [],
        status: input.status ? String(input.status) : 'active',
        stockItems: initialStock !== undefined ? {
          create: {
            quantity: initialStock,
            lowThreshold: Number.isFinite(lowThreshold) ? lowThreshold : workspaceLowThreshold,
          },
        } : undefined,
        categoryMappings: categoryIds.length
          ? { create: categoryIds.map((categoryId) => ({ categoryId })) }
          : undefined,
      },
    });

    return { data: product };
  }

  private async toolUpdateProduct(input: Record<string, unknown>, workspaceId: string) {
    const product = await this.resolveProduct(input, workspaceId);
    const data = input.data && typeof input.data === 'object' ? (input.data as Record<string, unknown>) : null;
    const mergeSource = data && Object.keys(data).length > 0
      ? data
      : Object.fromEntries(Object.entries(input).filter(([key]) => !['productId', 'sku', 'name', 'data'].includes(key)));

    const updateData: Prisma.ProductUpdateManyMutationInput = {};

    if (mergeSource.name) updateData.name = String(mergeSource.name);
    if (mergeSource.description !== undefined) updateData.description = mergeSource.description ? String(mergeSource.description) : null;
    if (mergeSource.shortDesc !== undefined) updateData.shortDesc = mergeSource.shortDesc ? String(mergeSource.shortDesc) : null;
    if (mergeSource.category !== undefined) updateData.category = mergeSource.category ? String(mergeSource.category) : null;
    if (mergeSource.status) updateData.status = String(mergeSource.status);
    if (mergeSource.sku) updateData.sku = String(mergeSource.sku);
    if (mergeSource.unit) updateData.unit = String(mergeSource.unit);
    if (mergeSource.unitValue !== undefined) {
      const unit = (mergeSource.unit || product.unit || 'unit') as string;
      updateData.unitValue = unit !== 'unit' ? String(mergeSource.unitValue) : null;
    }
    if (mergeSource.secondaryUnit !== undefined) {
      const nextSecondaryUnit = mergeSource.secondaryUnit ? String(mergeSource.secondaryUnit) : null;
      const nextSecondaryUnitValue =
        nextSecondaryUnit === 'dozen'
          ? '12'
          : mergeSource.secondaryUnitValue !== undefined
            ? String(mergeSource.secondaryUnitValue)
            : product.secondaryUnitValue;
      if (nextSecondaryUnit && nextSecondaryUnit !== 'dozen' && (!nextSecondaryUnitValue || !String(nextSecondaryUnitValue).trim())) {
        throw new Error('La segunda unidad requiere un valor (pack, caja o bulto)');
      }
      updateData.secondaryUnit = nextSecondaryUnit;
      updateData.secondaryUnitValue = nextSecondaryUnitValue ? String(nextSecondaryUnitValue).trim() : null;
    } else if (mergeSource.secondaryUnitValue !== undefined) {
      const currentUnit = product.secondaryUnit;
      const nextValue =
        currentUnit === 'dozen'
          ? '12'
          : mergeSource.secondaryUnitValue !== undefined
            ? String(mergeSource.secondaryUnitValue)
            : null;
      if (currentUnit && currentUnit !== 'dozen' && (!nextValue || !nextValue.trim())) {
        throw new Error('La segunda unidad requiere un valor (pack, caja o bulto)');
      }
      updateData.secondaryUnitValue = nextValue ? nextValue.trim() : null;
    }
    if (mergeSource.price !== undefined) {
      const priceRaw = Number(mergeSource.price);
      if (!Number.isFinite(priceRaw) || priceRaw <= 0) {
        throw new Error('Precio inválido');
      }
      updateData.price = this.toCents(priceRaw);
    }
    if (mergeSource.comparePrice !== undefined) {
      const compareRaw = Number(mergeSource.comparePrice);
      if (!Number.isFinite(compareRaw) || compareRaw < 0) {
        throw new Error('Precio comparativo inválido');
      }
      updateData.comparePrice = compareRaw ? this.toCents(compareRaw) : null;
    }

    const categoryIds = Array.isArray(mergeSource.categoryIds)
      ? (mergeSource.categoryIds as Array<unknown>).map((id) => String(id)).filter(Boolean)
      : null;

    if (Object.keys(updateData).length === 0 && !categoryIds) {
      throw new Error('No hay campos para actualizar');
    }

    await this.prisma.$transaction(async (tx) => {
      if (Object.keys(updateData).length > 0) {
        await tx.product.updateMany({
          where: { id: product.id, workspaceId },
          data: updateData,
        });
      }
      if (categoryIds) {
        await tx.productCategoryMapping.deleteMany({
          where: { productId: product.id },
        });
        if (categoryIds.length > 0) {
          await tx.productCategoryMapping.createMany({
            data: categoryIds.map((categoryId) => ({ productId: product.id, categoryId })),
          });
        }
      }
    });

    const updated = await this.prisma.product.findFirst({
      where: { id: product.id, workspaceId },
    });
    if (!updated) {
      throw new Error('Producto no encontrado');
    }
    return { data: updated };
  }

  private async toolDeleteProduct(input: Record<string, unknown>, workspaceId: string) {
    const product = await this.resolveProduct(input, workspaceId);

    const orderItems = await this.prisma.orderItem.count({
      where: { productId: product.id },
    });

    if (orderItems === 0) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.stockReservation.deleteMany({ where: { productId: product.id } });
          await tx.product.deleteMany({ where: { id: product.id, workspaceId } });
        });
        return { data: { id: product.id, name: product.name, hardDeleted: true } };
      } catch (error) {
        // Fall back to soft delete
      }
    }

    await this.prisma.product.updateMany({
      where: { id: product.id, workspaceId, deletedAt: null },
      data: { deletedAt: new Date(), status: 'archived' },
    });

    return { data: { id: product.id, name: product.name, hardDeleted: false, reason: orderItems > 0 ? 'HAS_ORDER_ITEMS' : 'SOFT_DELETE' } };
  }

  private async toolCreateCategory(input: Record<string, unknown>, workspaceId: string) {
    const name = String(input.name || '').trim();
    if (!name) {
      throw new Error('El nombre de la categoría es requerido');
    }

    const rawColor = input.color !== undefined && input.color !== null ? String(input.color).trim() : '';
    const resolvedColor = rawColor ? this.resolveCategoryColorInput(rawColor) : null;
    if (rawColor && !resolvedColor) {
      throw new Error('Color inválido. Usá un nombre (verde, rojo, azul) o #RRGGBB.');
    }

    const existing = await this.prisma.productCategory.findFirst({
      where: { workspaceId, name: { equals: name, mode: 'insensitive' }, deletedAt: null },
    });
    if (existing) {
      if (resolvedColor) {
        const updated = await this.prisma.productCategory.update({
          where: { id: existing.id },
          data: { color: resolvedColor },
        });
        return { data: updated };
      }
      throw new Error('Ya existe una categoría con ese nombre');
    }

    const softDeleted = await this.prisma.productCategory.findFirst({
      where: { workspaceId, name: { equals: name, mode: 'insensitive' }, deletedAt: { not: null } },
    });
    if (softDeleted) {
      const restored = await this.prisma.productCategory.update({
        where: { id: softDeleted.id },
        data: {
          deletedAt: null,
          color: resolvedColor ?? softDeleted.color ?? this.pickRandomCategoryColor(),
          description: input.description ? String(input.description) : softDeleted.description,
          sortOrder: input.sortOrder !== undefined ? Number(input.sortOrder) : softDeleted.sortOrder,
        },
      });
      return { data: restored };
    }

    let category;
    try {
      category = await this.prisma.productCategory.create({
        data: {
          workspaceId,
          name,
          description: input.description ? String(input.description) : null,
          color: resolvedColor ?? this.pickRandomCategoryColor(),
          sortOrder: input.sortOrder !== undefined ? Number(input.sortOrder) : 0,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existingCategory = await this.prisma.productCategory.findFirst({
          where: { workspaceId, name: { equals: name, mode: 'insensitive' } },
        });
        if (existingCategory) {
          const revived = existingCategory.deletedAt
            ? await this.prisma.productCategory.update({
                where: { id: existingCategory.id },
                data: {
                  deletedAt: null,
                  color: resolvedColor ?? existingCategory.color ?? this.pickRandomCategoryColor(),
                },
              })
            : existingCategory;
          return { data: revived };
        }
      }
      throw error;
    }

    return { data: category };
  }

  private async toolAssignCategoryToProducts(input: Record<string, unknown>, workspaceId: string) {
    const categoryNameRaw = typeof input.categoryName === 'string' ? input.categoryName.trim() : '';
    const productQueryRaw = typeof input.productQuery === 'string' ? input.productQuery.trim() : '';
    const rawColor = input.color !== undefined && input.color !== null ? String(input.color).trim() : '';
    const resolvedColor = rawColor ? this.resolveCategoryColorInput(rawColor) : null;
    if (rawColor && !resolvedColor) {
      throw new Error('Color inválido. Usá un nombre (verde, rojo, azul) o #RRGGBB.');
    }

    if (!categoryNameRaw) {
      throw new Error('Necesito el nombre de la categoría');
    }
    if (!productQueryRaw) {
      throw new Error('Necesito los productos a los que aplicar la categoría');
    }

    const categoryName = this.cleanCategoryName(categoryNameRaw) || categoryNameRaw;
    const productQuery = this.cleanProductQuery(productQueryRaw);
    const fallbackProductQuery = this.singularizeProductName(productQuery);

    let category = await this.prisma.productCategory.findFirst({
      where: {
        workspaceId,
        deletedAt: null,
        name: { equals: categoryName, mode: 'insensitive' },
      },
    });

    let created = false;
    if (!category) {
      try {
        category = await this.prisma.productCategory.create({
          data: {
            workspaceId,
            name: categoryName,
            color: resolvedColor ?? this.pickRandomCategoryColor(),
          },
        });
        created = true;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          category = await this.prisma.productCategory.findFirst({
            where: {
              workspaceId,
              name: { equals: categoryName, mode: 'insensitive' },
            },
          });
        } else {
          throw error;
        }
      }
    }

    if (!category) {
      throw new Error('No se pudo crear la categoría');
    }

    if (category.deletedAt) {
      category = await this.prisma.productCategory.update({
        where: { id: category.id },
        data: {
          deletedAt: null,
          color: resolvedColor ?? category.color ?? this.pickRandomCategoryColor(),
        },
      });
    } else if (resolvedColor && resolvedColor !== category.color) {
      category = await this.prisma.productCategory.update({
        where: { id: category.id },
        data: { color: resolvedColor },
      });
    } else if (!resolvedColor && !category.color) {
      category = await this.prisma.productCategory.update({
        where: { id: category.id },
        data: { color: this.pickRandomCategoryColor() },
      });
    }

    const productWhere: Prisma.ProductWhereInput = {
      workspaceId,
      deletedAt: null,
      status: { not: 'archived' },
      OR: [
        { name: { contains: productQuery, mode: 'insensitive' } },
        { sku: { contains: productQuery, mode: 'insensitive' } },
      ],
    };
    if (fallbackProductQuery && fallbackProductQuery !== productQuery) {
      (productWhere.OR as Prisma.ProductWhereInput[]).push({
        name: { contains: fallbackProductQuery, mode: 'insensitive' },
      });
    }

    const products = await this.prisma.product.findMany({
      where: productWhere,
      select: { id: true, name: true, sku: true },
      take: 50,
    });

    if (products.length === 0) {
      throw new Error(`No encontré productos para "${productQueryRaw}".`);
    }

    await this.prisma.productCategoryMapping.createMany({
      data: products.map((product) => ({
        productId: product.id,
        categoryId: category!.id,
      })),
      skipDuplicates: true,
    });

    return {
      data: {
        category: { id: category!.id, name: category!.name, color: category!.color, created },
        productQuery,
        matchedCount: products.length,
        products: products.slice(0, 5),
      },
    };
  }

  private async toolUpdateCategory(input: Record<string, unknown>, workspaceId: string) {
    const category = await this.resolveCategory(input, workspaceId);
    const data = input.data && typeof input.data === 'object' ? (input.data as Record<string, unknown>) : null;
    const merge = data && Object.keys(data).length > 0
      ? data
      : Object.fromEntries(Object.entries(input).filter(([key]) => !['categoryId', 'name', 'data'].includes(key)));

    const updateData: Prisma.ProductCategoryUpdateManyMutationInput = {};
    if (merge.name) updateData.name = String(merge.name);
    if (merge.description !== undefined) updateData.description = merge.description ? String(merge.description) : null;
    if (merge.color !== undefined) {
      const rawColor = merge.color ? String(merge.color).trim() : '';
      if (!rawColor) {
        updateData.color = null;
      } else {
        const resolvedColor = this.resolveCategoryColorInput(rawColor);
        if (!resolvedColor) {
          throw new Error('Color inválido. Usá un nombre (verde, rojo, azul) o #RRGGBB.');
        }
        updateData.color = resolvedColor;
      }
    }
    if (merge.sortOrder !== undefined) updateData.sortOrder = Number(merge.sortOrder);

    if (Object.keys(updateData).length === 0) {
      throw new Error('No hay campos para actualizar');
    }

    await this.prisma.productCategory.updateMany({
      where: { id: category.id, workspaceId, deletedAt: null },
      data: updateData,
    });

    const updated = await this.prisma.productCategory.findFirst({
      where: { id: category.id, workspaceId },
    });
    if (!updated) {
      throw new Error('Categoría no encontrada');
    }
    return { data: updated };
  }

  private async toolDeleteCategory(input: Record<string, unknown>, workspaceId: string) {
    const category = await this.resolveCategory(input, workspaceId);

    await this.prisma.productCategory.updateMany({
      where: { id: category.id, workspaceId, deletedAt: null },
      data: { deletedAt: new Date() },
    });

    return { data: { id: category.id, name: category.name } };
  }

  private async toolSendConversationMessage(
    input: Record<string, unknown>,
    workspaceId: string,
    userId: string
  ) {
    const content = String(input.content || '').trim();
    if (!content) {
      throw new Error('El mensaje no puede estar vacío');
    }

    const session = await this.resolveConversation(input, workspaceId);

    const message = await this.prisma.agentMessage.create({
      data: {
        sessionId: session.id,
        role: 'assistant',
        content,
        metadata: { sentByHuman: true, userId },
      },
    });

    await this.prisma.agentSession.updateMany({
      where: { id: session.id, workspaceId },
      data: {
        agentActive: false,
        lastActivityAt: new Date(),
      },
    });

    if (session.channelType === 'whatsapp') {
      const whatsappNumber = await this.prisma.whatsAppNumber.findFirst({
        where: { workspaceId, isActive: true },
      });

      if (whatsappNumber) {
        try {
          const apiKey = this.resolveWhatsAppApiKey(whatsappNumber);
          if (apiKey) {
            const { InfobipClient } = await import('@nexova/integrations/whatsapp');
            const client = new InfobipClient({
              apiKey,
              baseUrl: this.resolveInfobipBaseUrl(whatsappNumber.apiUrl),
              senderNumber: whatsappNumber.phoneNumber,
            });
            await client.sendText(session.channelId, content);
          }
        } catch (error) {
          // Non-fatal: message stored, but sending failed.
        }
      }
    }

    return { data: { session, message } };
  }

  private async toolSetAgentActive(input: Record<string, unknown>, workspaceId: string) {
    if (input.agentActive === undefined) {
      throw new Error('agentActive es requerido');
    }

    const session = await this.resolveConversation(input, workspaceId);
    const agentActive = Boolean(input.agentActive);

    await this.prisma.agentSession.updateMany({
      where: { id: session.id, workspaceId },
      data: {
        agentActive,
        lastActivityAt: new Date(),
      },
    });

    return { data: { sessionId: session.id, agentActive } };
  }

  private async toolListNotifications(input: Record<string, unknown>, workspaceId: string) {
    const limit = Number(input.limit) || 10;
    const unread = this.parseOptionalBoolean(input.unread);
    const readCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const where: Prisma.NotificationWhereInput = { workspaceId };
    if (unread === true) {
      where.readAt = null;
    } else if (unread === false) {
      where.readAt = { not: null, gte: readCutoff };
    } else {
      where.OR = [{ readAt: null }, { readAt: { gte: readCutoff } }];
    }

    const notifications = await this.prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return { data: notifications };
  }

  private async toolMarkNotificationRead(input: Record<string, unknown>, workspaceId: string) {
    const notificationId = String(input.notificationId || '').trim();
    if (!notificationId) {
      throw new Error('notificationId es requerido');
    }

    const result = await this.prisma.notification.updateMany({
      where: { id: notificationId, workspaceId, readAt: null },
      data: { readAt: new Date() },
    });

    return { data: { updated: result.count > 0 } };
  }

  private async toolMarkAllNotificationsRead(_input: Record<string, unknown>, workspaceId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { workspaceId, readAt: null },
      data: { readAt: new Date() },
    });

    return { data: { updated: result.count } };
  }

  private async toolGenerateCatalogPdf(input: Record<string, unknown>, workspaceId: string) {
    const catalogService = new CatalogPdfService(this.prisma);
    const filter = {
      ...(input.category ? { category: String(input.category) } : {}),
      ...(input.search ? { search: String(input.search) } : {}),
    };

    if (!existsSync(CATALOG_DIR)) {
      await fs.mkdir(CATALOG_DIR, { recursive: true });
    }

    const result = await catalogService.generateCatalog(workspaceId, filter);
    const filename = `${result.fileRef}.pdf`;
    const filepath = path.join(CATALOG_DIR, filename);
    await fs.writeFile(filepath, result.buffer);

    return {
      data: {
        url: `/uploads/catalogs/${filename}`,
        filename: result.filename,
        productCount: result.productCount,
        pageCount: result.pageCount,
      },
    };
  }

  private async toolGetBusinessMetrics(input: Record<string, unknown>, workspaceId: string) {
    const range = typeof input.range === 'string' ? normalizeRange(input.range) : '90d';
    const metrics = await buildMetrics(this.prisma, workspaceId, range);
    return { data: metrics };
  }

  private async toolGetSalesSummary(input: Record<string, unknown>, workspaceId: string) {
    const resolvedRange = this.resolveSalesRangeFromInput(input);
    if (resolvedRange) {
      const metrics = await buildMetrics(this.prisma, workspaceId, resolvedRange);
      return { data: metrics };
    }

    const range = typeof input.range === 'string' ? normalizeRange(input.range) : '90d';
    const metrics = await buildMetrics(this.prisma, workspaceId, range);
    return { data: metrics };
  }

  private async toolGetLowStockProducts(input: Record<string, unknown>, workspaceId: string) {
    const limit = Number(input.limit) || 10;
    const thresholdRaw = input.threshold !== undefined ? Number(input.threshold) : null;
    if (thresholdRaw !== null && (!Number.isFinite(thresholdRaw) || thresholdRaw < 0)) {
      throw new Error('Umbral inválido');
    }
    const threshold = thresholdRaw !== null ? Math.floor(thresholdRaw) : null;

    const products = await this.prisma.product.findMany({
      where: { workspaceId, deletedAt: null, status: 'active' },
      select: {
        id: true,
        sku: true,
        name: true,
        unit: true,
        unitValue: true,
        stockItems: { select: { quantity: true, reserved: true, lowThreshold: true } },
      },
    });

    const lowStock = products
      .map((product) => {
        const available = product.stockItems.reduce((sum, s) => sum + s.quantity - s.reserved, 0);
        const lowThreshold = product.stockItems[0]?.lowThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
        const limitThreshold = threshold ?? lowThreshold;
        return {
          id: product.id,
          sku: product.sku,
          name: product.name,
          displayName: this.buildProductDisplayName(product),
          available,
          lowThreshold,
          limitThreshold,
          isOutOfStock: available <= 0,
        };
      })
      .filter((item) => item.available <= item.limitThreshold)
      .sort((a, b) => a.available - b.available);

    return {
      data: {
        totalLowStock: lowStock.length,
        threshold: threshold,
        products: lowStock.slice(0, limit),
      },
    };
  }

  private async toolGetBusinessInsights(input: Record<string, unknown>, workspaceId: string) {
    const range = typeof input.range === 'string' ? normalizeRange(input.range) : '90d';
    const insights = await generateBusinessInsights(this.prisma, workspaceId, range);
    return { data: insights };
  }

  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private normalizeHexColor(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const match = trimmed.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
    if (!match) return null;
    const hex = match[1].toLowerCase();
    if (hex.length === 3) {
      return `#${hex.split('').map((char) => char + char).join('')}`;
    }
    return `#${hex}`;
  }

  private mapColorNameToHex(value: string): string | null {
    const normalized = this.normalizeText(value).replace(/\s+/g, ' ').trim();
    if (!normalized) return null;
    return CATEGORY_COLOR_NAME_MAP[normalized] || null;
  }

  private resolveCategoryColorInput(value?: string): string | null {
    if (!value) return null;
    const hex = this.normalizeHexColor(value);
    if (hex) return hex;
    return this.mapColorNameToHex(value);
  }

  private trimColorToken(value: string): string {
    const tokens = value.split(' ').filter(Boolean);
    if (tokens.length === 0) return '';
    const leadingStopwords = new Set(['color', 'de', 'del', 'la', 'el']);
    while (tokens.length > 0 && leadingStopwords.has(tokens[0])) {
      tokens.shift();
    }
    const stopwords = new Set([
      'y',
      'e',
      'a',
      'al',
      'para',
      'agrega',
      'agregar',
      'asigna',
      'asignar',
      'pon',
      'poner',
      'aplica',
      'aplicar',
    ]);
    while (tokens.length > 0 && stopwords.has(tokens[tokens.length - 1])) {
      tokens.pop();
    }
    return tokens.join(' ');
  }

  private resolveCategoryColorFromCommand(command: string): { color: string | null; raw: string | null } {
    const hexMatch = command.match(/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})/);
    if (hexMatch) {
      const normalizedHex = this.normalizeHexColor(hexMatch[0]);
      if (normalizedHex) {
        return { color: normalizedHex, raw: hexMatch[0] };
      }
    }

    const normalized = this.normalizeText(command);
    if (!normalized) return { color: null, raw: null };
    const phraseMatch = normalized.match(
      /(?:\bde\s+color\b|\bcolor\b|\bque\s+sea\b|\bsea\b|\btono\b)\s+([a-z0-9]+(?:\s+[a-z0-9]+){0,2})/
    );
    if (!phraseMatch) return { color: null, raw: null };

    const raw = this.trimColorToken(phraseMatch[1]);
    if (!raw) return { color: null, raw: null };

    const mapped = this.mapColorNameToHex(raw);
    if (!mapped) return { color: null, raw: null };
    return { color: mapped, raw };
  }

  private stripColorDescriptor(value: string, rawColor: string | null): string {
    if (!rawColor) return value;
    const escaped = rawColor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let cleaned = value;
    const patterns = [
      new RegExp(`\\bque\\s+sea\\s+color\\s+${escaped}`, 'i'),
      new RegExp(`\\bque\\s+sea\\s+de\\s+color\\s+${escaped}`, 'i'),
      new RegExp(`\\bque\\s+sea\\s+(?:color\\s+)?${escaped}`, 'i'),
      new RegExp(`\\bde\\s+color\\s+${escaped}`, 'i'),
      new RegExp(`\\bcolor\\s+${escaped}`, 'i'),
    ];
    for (const pattern of patterns) {
      cleaned = cleaned.replace(pattern, ' ');
    }
    return cleaned.replace(/\s+/g, ' ').trim();
  }

  private pickRandomCategoryColor(): string {
    if (CATEGORY_COLOR_PALETTE.length === 0) {
      return '#6366f1';
    }
    const index = Math.floor(Math.random() * CATEGORY_COLOR_PALETTE.length);
    return CATEGORY_COLOR_PALETTE[index] || '#6366f1';
  }

  private normalizeOrderStatusInput(status?: unknown): string | null {
    if (!status) return null;
    const normalized = this.normalizeText(String(status));
    if (!normalized) return null;

    const inferred = this.inferOrderStatusFromCommand(normalized);
    if (inferred) return inferred;

    const directMap: Record<string, string> = {
      'draft': 'draft',
      'borrador': 'draft',
      'awaiting acceptance': 'awaiting_acceptance',
      'awaiting approval': 'awaiting_acceptance',
      'pending approval': 'awaiting_acceptance',
      'approval pending': 'awaiting_acceptance',
      'awaiting': 'awaiting_acceptance',
      'accepted': 'accepted',
      'aceptado': 'accepted',
      'processing': 'processing',
      'procesando': 'processing',
      'shipped': 'shipped',
      'enviado': 'shipped',
      'despachado': 'shipped',
      'delivered': 'delivered',
      'entregado': 'delivered',
      'cancelled': 'cancelled',
      'cancelado': 'cancelled',
      'anulado': 'cancelled',
      'returned': 'returned',
      'devuelto': 'returned',
      'paid': 'paid',
      'pagado': 'paid',
      'pending payment': 'pending_payment',
      'pendiente de pago': 'pending_payment',
      'pendiente pago': 'pending_payment',
      'sin pagar': 'pending_payment',
      'payment pending': 'pending_payment',
      'partial payment': 'partial_payment',
      'pago parcial': 'partial_payment',
      'parcialmente pagado': 'partial_payment',
      'confirmed': 'confirmed',
      'confirmado': 'confirmed',
      'preparing': 'preparing',
      'preparando': 'preparing',
      'ready': 'ready',
      'listo': 'ready',
      'trashed': 'trashed',
      'papelera': 'trashed',
      'eliminado': 'trashed',
      'borrado': 'trashed',
      'pending invoicing': 'pending_invoicing',
      'pending_invoice': 'pending_invoicing',
      'pendiente de facturacion': 'pending_invoicing',
      'pendiente de facturación': 'pending_invoicing',
      'por facturar': 'pending_invoicing',
      'invoiced': 'invoiced',
      'facturado': 'invoiced',
      'facturada': 'invoiced',
      'invoice cancelled': 'invoice_cancelled',
      'factura cancelada': 'invoice_cancelled',
      'sin factura': 'invoice_cancelled',
    };

    if (directMap[normalized]) return directMap[normalized];

    const normalizedKey = normalized.replace(/\s+/g, '_');
    const known = new Set([
      'draft',
      'awaiting_acceptance',
      'accepted',
      'processing',
      'shipped',
      'delivered',
      'cancelled',
      'returned',
      'pending_payment',
      'partial_payment',
      'paid',
      'pending_invoicing',
      'invoiced',
      'invoice_cancelled',
      'confirmed',
      'preparing',
      'ready',
    ]);
    if (known.has(normalizedKey)) {
      return normalizedKey;
    }

    return null;
  }

  private inferOrderStatusFromCommand(normalized: string): string | null {
    if (!normalized) return null;
    const hasAny = (terms: string[]) => terms.some((term) => normalized.includes(term));

    if (
      hasAny([
        'pendiente de pago',
        'pendiente pago',
        'pago pendiente',
        'por pagar',
        'sin pagar',
        'cobro pendiente',
        'cobranza pendiente',
      ])
    ) {
      return 'pending_payment';
    }

    if (
      hasAny([
        'pago parcial',
        'parcialmente pagado',
        'pago incompleto',
        'pago a cuenta',
        'seña',
      ])
    ) {
      return 'partial_payment';
    }

    if (
      hasAny([
        'pagado',
        'pagados',
        'pago completo',
        'cobrado',
        'cobrados',
      ])
    ) {
      return 'paid';
    }

    if (
      hasAny([
        'pendiente de facturacion',
        'pendiente de facturación',
        'pendiente de factura',
        'por facturar',
        'falta facturar',
      ])
    ) {
      return 'pending_invoicing';
    }

    if (
      hasAny([
        'facturado',
        'facturada',
        'facturados',
        'factura emitida',
        'ya facturado',
      ])
    ) {
      return 'invoiced';
    }

    if (
      hasAny([
        'factura cancelada',
        'sin factura',
        'no facturar',
        'cancelar factura',
      ])
    ) {
      return 'invoice_cancelled';
    }

    if (
      hasAny([
        'aprobacion',
        'aprobar',
        'por aprobar',
        'sin aprobar',
        'esperando aprobacion',
        'pendiente de aprobacion',
        'pendiente aprobacion',
        'por aceptar',
        'esperando aceptacion',
        'pendiente de aceptacion',
        'pendiente aceptacion',
      ])
    ) {
      return 'awaiting_acceptance';
    }

    if (hasAny(['borrador', 'borradores', 'draft'])) {
      return 'draft';
    }

    if (hasAny(['cancelado', 'cancelados', 'cancelada', 'canceladas', 'anulado', 'anulados'])) {
      return 'cancelled';
    }

    if (hasAny(['devuelto', 'devueltos', 'devolucion', 'devoluciones', 'retornado', 'retornados'])) {
      return 'returned';
    }

    if (hasAny(['papelera', 'eliminado', 'eliminados', 'borrado', 'borrados', 'trashed'])) {
      return 'trashed';
    }

    if (hasAny(['aceptado', 'aceptados', 'aceptada', 'aceptadas'])) {
      return 'accepted';
    }

    if (hasAny(['procesando', 'en proceso', 'procesamiento'])) {
      return 'processing';
    }

    if (hasAny(['preparando', 'en preparacion', 'preparacion'])) {
      return 'preparing';
    }

    if (hasAny(['listo para entregar', 'listo para retiro', 'listo para retirar', 'listo', 'listos'])) {
      return 'ready';
    }

    if (hasAny(['confirmado', 'confirmados', 'confirmada', 'confirmadas'])) {
      return 'confirmed';
    }

    if (hasAny(['enviado', 'enviados', 'despachado', 'despachados', 'en camino'])) {
      return 'shipped';
    }

    if (hasAny(['entregado', 'entregados', 'entregada', 'entregadas'])) {
      return 'delivered';
    }

    return null;
  }

  private normalizePhone(phone: string): string {
    const trimmed = phone.trim();
    const digits = trimmed.replace(/\D/g, '');
    if (!digits) return trimmed;
    return `+${digits}`;
  }

  private toCents(amount: number): number {
    return Math.round(amount * 100);
  }

  private formatMoney(amount: number): string {
    return new Intl.NumberFormat('es-AR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount / 100);
  }

  private buildDebtReminderMessage(params: {
    name?: string | null;
    totalDebt: number;
    orders: Array<{ orderNumber: string; pendingAmount: number }>;
  }): string {
    const greeting = params.name ? `Hola ${params.name},` : 'Hola,';
    const orderLines = params.orders.map(
      (order) => `• Pedido ${order.orderNumber}: $${this.formatMoney(order.pendingAmount)}`
    );
    return [
      `${greeting} tenés una deuda pendiente de $${this.formatMoney(params.totalDebt)}.`,
      'Corresponde a:',
      ...orderLines,
      '',
      'Si ya pagaste, enviá el comprobante para actualizar tu cuenta.',
    ].join('\n');
  }

  private formatCustomerName(customer: { firstName?: string | null; lastName?: string | null; phone?: string | null }) {
    const name = `${customer.firstName || ''} ${customer.lastName || ''}`.trim();
    return name || customer.phone || 'Cliente';
  }

  private normalizeCustomerTotals<T extends { totalSpent?: unknown }>(customer: T): T {
    if (typeof customer.totalSpent === 'bigint') {
      return {
        ...customer,
        totalSpent: Number(customer.totalSpent),
      };
    }
    return customer;
  }

  private resolveDashboardPath(page: string): string | null {
    const normalized = this.normalizeText(page);
    if (['clientes', 'cliente', 'customers', 'customer'].includes(normalized)) return '/customers';
    if (['pedidos', 'pedido', 'orders', 'order'].includes(normalized)) return '/orders';
    if (['productos', 'producto', 'products', 'product'].includes(normalized)) return '/stock';
    if (['stock', 'inventario', 'inventario', 'stock'].includes(normalized)) return '/stock';
    if (['metricas', 'metricos', 'metrics', 'ventas'].includes(normalized)) return '/metrics';
    if (['deudas', 'deuda', 'debts', 'cobranza'].includes(normalized)) return '/debts';
    if (['inbox', 'mensajes', 'conversaciones'].includes(normalized)) return '/inbox';
    if (['settings', 'configuracion', 'ajustes', 'config'].includes(normalized)) return '/settings';
    return null;
  }

  private resolveDirectNavigation(command: string): { summary: string; actions: QuickActionUIAction[] } | null {
    const normalized = this.normalizeText(command);
    const wantsTopCustomer = this.commandWantsTopCustomer(normalized);
    const wantsTopProduct = this.commandWantsTopProduct(normalized);
    const wantsSalesSummary = this.commandWantsSalesSummary(normalized);
    const wantsMetrics = this.commandWantsMetrics(normalized);
    if (!normalized) return null;

    const directPatterns: Array<{ regex: RegExp; page: string; label: string }> = [
      { regex: /^(clientes|cliente|ver clientes|abrir clientes|ir a clientes|mostrar clientes|mostrame clientes)$/, page: 'customers', label: 'clientes' },
      { regex: /^(pedidos|pedido|ver pedidos|abrir pedidos|ir a pedidos|mostrar pedidos|mostrame pedidos)$/, page: 'orders', label: 'pedidos' },
      { regex: /^(productos|producto|ver productos|abrir productos|ir a productos|mostrar productos|mostrame productos)$/, page: 'products', label: 'productos' },
      { regex: /^(stock|inventario|ver stock|abrir stock|ir a stock|mostrar stock|mostrame stock)$/, page: 'stock', label: 'stock' },
      { regex: /^(metricas|metricos|ventas|ver metricas|abrir metricas|ir a metricas|mostrar metricas|mostrame metricas)$/, page: 'metrics', label: 'métricas' },
      { regex: /^(deudas|deuda|cobranza|ver deudas|abrir deudas|ir a deudas|mostrar deudas|mostrame deudas)$/, page: 'debts', label: 'deudas' },
      { regex: /^(inbox|mensajes|conversaciones|ver inbox|abrir inbox|ir a inbox)$/, page: 'inbox', label: 'inbox' },
      { regex: /^(settings|configuracion|ajustes|ver ajustes|abrir ajustes|ir a ajustes|ver configuracion)$/, page: 'settings', label: 'configuración' },
    ];

    const match = directPatterns.find((pattern) => pattern.regex.test(normalized));
    if (!match) return null;

    const path = this.resolveDashboardPath(match.page);
    if (!path) return null;

    return {
      summary: `Listo para abrir ${match.label}.`,
      actions: [
        {
          type: 'navigate',
          label: `Ir a ${match.label}`,
          path,
        },
      ],
    };
  }

  private inferMetricsRange(command: string): string | null {
    const normalized = this.normalizeText(command);
    if (!normalized) return null;

    if (normalized.includes('este mes') || normalized.includes('mes actual') || normalized.includes('mensual')) {
      return 'month';
    }
    if (normalized.includes('esta semana') || normalized.includes('semana')) {
      return 'week';
    }
    if (normalized.includes('hoy') || normalized.includes('dia de hoy')) {
      return 'today';
    }
    if (normalized.includes('ultimos 30') || normalized.includes('ultimo mes') || normalized.includes('30 dias')) {
      return '30d';
    }
    if (normalized.includes('ultimos 90') || normalized.includes('90 dias')) {
      return '90d';
    }
    if (normalized.includes('ultimo ano') || normalized.includes('ultimo año') || normalized.includes('12 meses')) {
      return '12m';
    }
    if (normalized.includes('historico') || normalized.includes('todo') || normalized.includes('siempre')) {
      return 'all';
    }

    return null;
  }

  private applyCommandHeuristics(
    tools: ParsedToolCall[],
    command: string,
    inferredRange: string | null,
    monthRange: { from: Date; to: Date; label: string } | null
  ): ParsedToolCall[] {
    const normalized = this.normalizeText(command);
    if (tools.length === 0) {
      const fallback = this.resolveFallbackTools(command, inferredRange, monthRange);
      if (fallback.length > 0) {
        tools = fallback;
      }
    }

    const wantsSalesSummary = this.commandWantsSalesSummary(normalized);
    const wantsTopProduct = this.commandWantsTopProduct(normalized);
    const wantsTopCustomer = this.commandWantsTopCustomer(normalized);
    const wantsLowStock = this.commandWantsLowStock(normalized);
    const wantsInsights = this.commandWantsInsights(normalized);
    const wantsProductStock = this.commandWantsProductStock(normalized);
    const wantsDebtReminder = this.commandWantsDebtReminder(normalized);
    const inferredOrderStatus = this.inferOrderStatusFromCommand(normalized);
    const bulkStockIntent = this.extractBulkStockIntent(command);
    const existingBulkTool = tools.find((tool) => tool.toolName === 'bulk_set_stock');
    const priceAdjustmentIntent = this.extractPriceAdjustmentIntent(command);
    const existingPriceAdjustmentTool = tools.find((tool) => tool.toolName === 'adjust_prices_percent');
    const categoryAssignment = this.extractCategoryAssignmentIntent(command);
    const colorIntent = this.resolveCategoryColorFromCommand(command);
    const debtReminderBulk = this.extractDebtReminderBulkIntent(command);
    const debtReminderIntent = this.extractDebtReminderIntent(command);

    if (debtReminderBulk) {
      return [this.buildParsedToolCall('send_debt_reminders_bulk', {})];
    }

    if (debtReminderIntent) {
      return [this.buildParsedToolCall('send_debt_reminder', debtReminderIntent)];
    }

    if (bulkStockIntent || existingBulkTool) {
      const mergedInput = {
        ...(existingBulkTool?.input || {}),
        ...(bulkStockIntent || {}),
      };
      return [this.buildParsedToolCall('bulk_set_stock', mergedInput)];
    }

    if (priceAdjustmentIntent || existingPriceAdjustmentTool) {
      const mergedInput = {
        ...(existingPriceAdjustmentTool?.input || {}),
        ...(priceAdjustmentIntent || {}),
      };
      return [this.buildParsedToolCall('adjust_prices_percent', mergedInput)];
    }

    if (categoryAssignment) {
      return [this.buildParsedToolCall('assign_category_to_products', categoryAssignment)];
    }

    if (colorIntent.color) {
      tools = tools.map((tool) => {
        if (
          tool.toolName === 'create_category' ||
          tool.toolName === 'update_category' ||
          tool.toolName === 'assign_category_to_products'
        ) {
          if (!tool.input.color) {
            tool.input.color = colorIntent.color;
          }
        }
        return tool;
      });
    }

    const hasTool = (name: string) => tools.some((t) => t.toolName === name);
    const hasSalesSummary = hasTool('get_sales_summary');
    const hasMetrics = hasTool('get_business_metrics');
    const hasInsights = hasTool('get_business_insights');

    if (!wantsInsights && (wantsSalesSummary || wantsTopProduct || wantsTopCustomer)) {
      tools = tools.filter((tool) => tool.toolName !== 'get_business_insights');
    }

    const metricsTools = tools.filter((tool) =>
      tool.toolName === 'get_business_metrics' || tool.toolName === 'get_sales_summary'
    );
    if (metricsTools.length > 1) {
      const preferred =
        (wantsSalesSummary || wantsTopProduct || wantsTopCustomer)
          ? metricsTools.find((tool) => tool.toolName === 'get_sales_summary') || metricsTools[0]
          : metricsTools[0];
      tools = tools.filter((tool) => tool.toolName !== 'get_business_metrics' && tool.toolName !== 'get_sales_summary');
      tools = [...tools, preferred];
    }

    if (monthRange && hasMetrics && !hasSalesSummary) {
      tools = tools.map((tool) => {
        if (tool.toolName !== 'get_business_metrics') return tool;
        return this.buildParsedToolCall('get_sales_summary', {
          from: monthRange.from.toISOString(),
          to: monthRange.to.toISOString(),
          label: monthRange.label,
        });
      });
    }

    for (const tool of tools) {
      if ((tool.toolName === 'get_business_metrics' || tool.toolName === 'get_business_insights') && inferredRange) {
        if (!tool.input.range) {
          tool.input.range = inferredRange;
        }
      }

      if (tool.toolName === 'get_sales_summary') {
        if (monthRange) {
          if (!tool.input.from) tool.input.from = monthRange.from.toISOString();
          if (!tool.input.to) tool.input.to = monthRange.to.toISOString();
          if (!tool.input.label) tool.input.label = monthRange.label;
        } else if (inferredRange && !tool.input.range && !tool.input.from && !tool.input.month) {
          tool.input.range = inferredRange;
        }
      }

      if (tool.toolName === 'list_orders') {
        const normalizedStatus = this.normalizeOrderStatusInput(tool.input.status);
        if (normalizedStatus) {
          tool.input.status = normalizedStatus;
        }
        if (inferredOrderStatus) {
          tool.input.status = inferredOrderStatus;
        }
      }
    }

    const needsSalesTool = (wantsSalesSummary || wantsTopProduct || wantsTopCustomer) && !hasMetrics && !hasSalesSummary;
    if (needsSalesTool) {
      const input: Record<string, unknown> = {};
      if (monthRange) {
        input.from = monthRange.from.toISOString();
        input.to = monthRange.to.toISOString();
        input.label = monthRange.label;
      } else if (inferredRange) {
        input.range = inferredRange;
      }
      tools = [...tools, this.buildParsedToolCall('get_sales_summary', input)];
    }

    if ((wantsTopCustomer || wantsTopProduct) && hasInsights && !hasMetrics && !hasSalesSummary) {
      const input: Record<string, unknown> = {};
      if (monthRange) {
        input.from = monthRange.from.toISOString();
        input.to = monthRange.to.toISOString();
        input.label = monthRange.label;
      } else if (inferredRange) {
        input.range = inferredRange;
      }
      tools = [...tools, this.buildParsedToolCall('get_sales_summary', input)];
    }

    if (wantsLowStock && !hasTool('get_low_stock_products')) {
      const threshold = this.extractStockThreshold(command);
      const input: Record<string, unknown> = {};
      if (threshold !== null) {
        input.threshold = threshold;
      }
      tools = [...tools, this.buildParsedToolCall('get_low_stock_products', input)];
    }

    if (wantsProductStock && !wantsLowStock) {
      const toolQuery = this.extractProductQueryFromTools(tools);
      const inferredName =
        (toolQuery && !this.isGenericProductQuery(toolQuery) ? toolQuery : null) ||
        this.extractProductNameFromCommand(command);
      const cleanedName = inferredName ? this.cleanProductQuery(inferredName) : null;
      if (cleanedName) {
        const hasDetails = hasTool('get_product_details');
        const normalizedCleaned = this.normalizeText(cleanedName);
        const shouldOverrideName = (input: Record<string, unknown>) => {
          if (input.productId || input.sku) return false;
          const existingName = typeof input.name === 'string' ? input.name.trim() : '';
          if (!existingName) return true;
          if (this.isGenericProductWord(existingName)) return true;
          const normalizedExisting = this.normalizeText(existingName);
          if (/\d/.test(normalizedCleaned) && !/\d/.test(normalizedExisting)) return true;
          if (normalizedCleaned.length > normalizedExisting.length && normalizedCleaned.includes(normalizedExisting)) {
            return true;
          }
          return false;
        };
        if (hasDetails) {
          tools = tools.map((tool) => {
            if (tool.toolName !== 'get_product_details') return tool;
            if (shouldOverrideName(tool.input)) {
              tool.input.name = cleanedName;
            }
            return tool;
          });
        } else {
          tools = tools.filter((tool) =>
            tool.toolName !== 'list_products' && tool.toolName !== 'search_products'
          );
          tools = [...tools, this.buildParsedToolCall('get_product_details', { name: cleanedName })];
        }
      }
    }

    if (this.commandWantsDebtors(normalized) && !hasTool('list_debtors')) {
      tools = [...tools, this.buildParsedToolCall('list_debtors', { limit: 10 })];
    }

    if (this.commandWantsConversations(normalized) && !hasTool('list_conversations')) {
      tools = [...tools, this.buildParsedToolCall('list_conversations', { limit: 10 })];
    }

    if (this.commandWantsNotifications(normalized) && !hasTool('list_notifications')) {
      tools = [...tools, this.buildParsedToolCall('list_notifications', { limit: 10 })];
    }

    tools = tools.map((tool) => {
      if (tool.toolName !== 'send_debt_reminder') return tool;
      const hasTarget = Boolean(
        tool.input.customerId ||
        tool.input.phone ||
        tool.input.name ||
        tool.input.email
      );
      if (hasTarget) return tool;
      const extracted =
        this.extractCustomerIdentifierFromReminder(command) ||
        this.extractCustomerIdentifierFromReminder(normalized) ||
        null;
      if (extracted) {
        tool.input = { ...tool.input, ...extracted };
      }
      return tool;
    });

    return tools;
  }

  private resolveFallbackTools(
    command: string,
    inferredRange: string | null,
    monthRange: { from: Date; to: Date; label: string } | null
  ): ParsedToolCall[] {
    const normalized = this.normalizeText(command);
    if (!normalized) return [];

    if (this.commandWantsSalesSummary(normalized)) {
      const input: Record<string, unknown> = {};
      if (monthRange) {
        input.from = monthRange.from.toISOString();
        input.to = monthRange.to.toISOString();
        input.label = monthRange.label;
      } else if (inferredRange) {
        input.range = inferredRange;
      }
      return [this.buildParsedToolCall('get_sales_summary', input)];
    }

    if (this.commandWantsTopProduct(normalized)) {
      const input: Record<string, unknown> = {};
      if (monthRange) {
        input.from = monthRange.from.toISOString();
        input.to = monthRange.to.toISOString();
        input.label = monthRange.label;
      } else if (inferredRange) {
        input.range = inferredRange;
      }
      return [this.buildParsedToolCall('get_sales_summary', input)];
    }

    if (this.commandWantsLowStock(normalized)) {
      const threshold = this.extractStockThreshold(normalized);
      return [this.buildParsedToolCall('get_low_stock_products', threshold !== null ? { threshold } : {})];
    }

    if (this.commandWantsDebtReminder(normalized)) {
      if (this.extractDebtReminderBulkIntent(normalized)) {
        return [this.buildParsedToolCall('send_debt_reminders_bulk', {})];
      }
      const extracted = this.extractCustomerIdentifierFromReminder(normalized);
      return [this.buildParsedToolCall('send_debt_reminder', extracted || {})];
    }

    if (this.commandWantsPriceAdjustment(command)) {
      const priceIntent = this.extractPriceAdjustmentIntent(command);
      if (priceIntent) {
        return [this.buildParsedToolCall('adjust_prices_percent', priceIntent)];
      }
    }

    if (this.commandWantsDebtors(normalized)) {
      return [this.buildParsedToolCall('list_debtors', { limit: 10 })];
    }

    if (this.commandWantsConversations(normalized)) {
      return [this.buildParsedToolCall('list_conversations', { limit: 10 })];
    }

    if (this.commandWantsNotifications(normalized)) {
      return [this.buildParsedToolCall('list_notifications', { limit: 10 })];
    }

    if (normalized.includes('categorias') || normalized.includes('categoria')) {
      return [this.buildParsedToolCall('list_categories', { limit: 10 })];
    }

    if (normalized.includes('productos') || normalized.includes('producto')) {
      return [this.buildParsedToolCall('list_products', { limit: 10 })];
    }

    if (normalized.includes('clientes') || normalized.includes('cliente')) {
      return [this.buildParsedToolCall('list_customers', { limit: 10 })];
    }

    if (normalized.includes('pedidos') || normalized.includes('pedido')) {
      return [this.buildParsedToolCall('list_orders', { limit: 10 })];
    }

    return [];
  }

  private commandWantsSalesSummary(normalized: string): boolean {
    return (
      normalized.includes('cuanto vendi') ||
      normalized.includes('cuanto vendio') ||
      normalized.includes('que vendi') ||
      normalized.includes('vendio') ||
      normalized.includes('vendido') ||
      normalized.includes('ventas de') ||
      normalized.includes('total vendido') ||
      normalized.includes('facturacion') ||
      normalized.includes('ingresos')
    );
  }

  private commandWantsTopProduct(normalized: string): boolean {
    return (
      normalized.includes('producto mas') ||
      normalized.includes('mas vendido') ||
      normalized.includes('top producto') ||
      normalized.includes('producto top')
    );
  }

  private commandWantsTopCustomer(normalized: string): boolean {
    return (
      normalized.includes('cliente que mas') ||
      normalized.includes('cliente mas') ||
      normalized.includes('cliente top') ||
      normalized.includes('mejor cliente') ||
      normalized.includes('cliente con mas compras') ||
      normalized.includes('cliente con mas pedidos')
    );
  }

  private commandWantsInsights(normalized: string): boolean {
    return (
      normalized.includes('insights') ||
      normalized.includes('consejos') ||
      normalized.includes('recomendaciones') ||
      normalized.includes('analisis') ||
      normalized.includes('panorama') ||
      normalized.includes('diagnostico')
    );
  }

  private commandWantsMetrics(normalized: string): boolean {
    return (
      normalized.includes('metricas') ||
      normalized.includes('ventas') ||
      normalized.includes('resumen') ||
      normalized.includes('negocio')
    );
  }

  private commandWantsLowStock(normalized: string): boolean {
    return (
      normalized.includes('stock bajo') ||
      normalized.includes('poco stock') ||
      normalized.includes('pocas unidades') ||
      normalized.includes('poca unidad') ||
      normalized.includes('sin stock') ||
      normalized.includes('faltante')
    );
  }

  private commandWantsProductStock(normalized: string): boolean {
    const stockIntent =
      normalized.includes('cuantas unidades') ||
      normalized.includes('cuanta unidad') ||
      normalized.includes('cuanto stock') ||
      normalized.includes('stock de') ||
      normalized.includes('inventario de') ||
      normalized.includes('existencias') ||
      normalized.includes('unidades de') ||
      normalized.includes('cuantas tiene') ||
      normalized.includes('cuanto tiene');

    if (stockIntent) return true;

    const mentionsQuantity =
      (normalized.includes('cuantas') || normalized.includes('cuantos')) &&
      (normalized.includes('hay') ||
        normalized.includes('queda') ||
        normalized.includes('quedan') ||
        normalized.includes('habia') ||
        normalized.includes('habian') ||
        normalized.includes('tenes') ||
        normalized.includes('tenemos') ||
        normalized.includes('tiene') ||
        normalized.includes('tenia') ||
        normalized.includes('tenian'));

    if (mentionsQuantity) {
      const blocked = ['pedido', 'pedidos', 'orden', 'ordenes', 'venta', 'ventas', 'cliente', 'clientes'];
      if (!blocked.some((word) => normalized.includes(word))) {
        return true;
      }
    }

    return false;
  }

  private commandWantsPriceAdjustment(command: string): boolean {
    const normalized = this.normalizeText(command);
    const mentionsStockContext =
      normalized.includes('stock') ||
      normalized.includes('inventario') ||
      normalized.includes('existencias') ||
      normalized.includes('unidades');
    const mentionsPriceContext =
      normalized.includes('precio') ||
      normalized.includes('precios');
    if (mentionsStockContext && !mentionsPriceContext) return false;

    const hasPercent =
      /\b[+-]?\d+(?:[.,]\d+)?\s*%/.test(command) ||
      /\b\d+(?:[.,]\d+)?\s*por\s*ciento\b/.test(normalized);
    const hasAmountMarker =
      /\$\s*[+-]?\d+(?:[.,]\d+)?/.test(command) ||
      /\b[+-]?\d+(?:[.,]\d+)?\s*(?:pesos?|ars)\b/.test(normalized);

    const raiseMarkers = [
      'subi',
      'subile',
      'subir',
      'aumenta',
      'aumentar',
      'incrementa',
      'incrementar',
      'ajusta',
      'ajustar',
      'actualiza',
      'actualizar',
      'modifica',
      'modificar',
      'baja',
      'bajar',
      'disminui',
      'disminuir',
      'reduce',
      'reducir',
    ];

    const hasVerb = raiseMarkers.some((marker) => normalized.includes(marker));
    if ((hasPercent || hasAmountMarker) && hasVerb) return true;

    // fallback: "subile 1500 a coca" without explicit currency token
    if (hasVerb && /\b[+-]?\d+(?:[.,]\d+)?\b/.test(normalized)) {
      return true;
    }

    return false;
  }

  private commandWantsDebtors(normalized: string): boolean {
    return (
      normalized.includes('deudores') ||
      normalized.includes('clientes con deuda') ||
      normalized.includes('deudas') ||
      normalized.includes('deuda')
    );
  }

  private commandWantsDebtReminder(normalized: string): boolean {
    const reminderMarkers = [
      'recordatorio',
      'recordale',
      'recorda',
      'recorda',
      'avisale',
      'avisar',
      'avisa',
      'mandale',
      'manda',
      'enviar',
      'envia',
      'cobrar',
      'cobranza',
      'reclamar',
      'reclamo',
      'recordatorio de deuda',
    ];
    const mentionsReminder = reminderMarkers.some((marker) => normalized.includes(marker));
    const mentionsDebt = normalized.includes('deuda') || normalized.includes('saldo');
    return mentionsReminder && mentionsDebt;
  }

  private commandWantsConversations(normalized: string): boolean {
    return (
      normalized.includes('conversaciones') ||
      normalized.includes('inbox') ||
      normalized.includes('mensajes')
    );
  }

  private commandWantsNotifications(normalized: string): boolean {
    return (
      normalized.includes('notificaciones') ||
      normalized.includes('alertas')
    );
  }

  private extractBulkStockIntent(
    command: string
  ): { target: number; mode: 'set' | 'adjust'; categoryName?: string } | null {
    const normalized = this.normalizeText(command);
    if (!normalized) return null;

    const allSignals = [
      'todos los productos',
      'todo el stock',
      'todo el inventario',
      'todo el catalogo',
      'todos los items',
      'todas las referencias',
      'todos los articulos',
      'todos los artículos',
    ];
    const mentionsAll = allSignals.some((signal) => normalized.includes(this.normalizeText(signal)));

    const mentionsStock =
      normalized.includes('stock') || normalized.includes('inventario') || normalized.includes('existencias');
    if (!mentionsStock) return null;

    const categoryName = this.extractBulkStockCategory(normalized);
    if (!mentionsAll && !categoryName) return null;

    const numberMatch = normalized.match(/-?\d+(?:[.,]\d+)?/);
    if (!numberMatch) return null;
    const raw = Number(numberMatch[0].replace(',', '.'));
    if (!Number.isFinite(raw)) return null;

    const hasSetMarker = /(?:\ba\b|\bhasta\b|\bdejar\b|\bponer\b|\bigualar\b|\bfijar\b)\s+\d/.test(normalized);
    const hasIncreaseMarker = /(sumar|agregar|aumentar|incrementar|subir|subi|subime)/.test(normalized);
    const hasDecreaseMarker = /(bajar|disminuir|reducir|restar|quitar)/.test(normalized);

    let mode: 'set' | 'adjust' = 'set';
    if (hasSetMarker) {
      mode = 'set';
    } else if (hasIncreaseMarker || hasDecreaseMarker) {
      mode = 'adjust';
    }

    const target = hasDecreaseMarker ? -Math.abs(raw) : raw;
    if (!Number.isFinite(target)) return null;

    return categoryName ? { target, mode, categoryName } : { target, mode };
  }

  private extractBulkStockCategory(normalized: string): string | null {
    const categoryPatterns: RegExp[] = [
      /(?:categoria|categoría)\s+([a-z0-9\s]+?)(?:\s+a\s+\d+|\s+\d+|$)/i,
      /(?:todas|todos)\s+(?:los|las)?\s+([a-z0-9\s]+?)(?:\s+a\s+\d+|\s+\d+|$)/i,
      /(?:de|del|de la|de los|de las)\s+(?:todas|todos)\s+(?:los|las)?\s+([a-z0-9\s]+?)(?:\s+a\s+\d+|\s+\d+|$)/i,
    ];

    for (const pattern of categoryPatterns) {
      const match = normalized.match(pattern);
      if (match && match[1]) {
        const cleaned = this.cleanCategoryName(match[1]);
        if (cleaned) return cleaned;
      }
    }

    return null;
  }

  private cleanCategoryName(value: string): string | null {
    let cleaned = value.trim();
    cleaned = cleaned.replace(/\b(productos?|articulos?|artículos?|items?|referencias?)\b/g, ' ');
    cleaned = cleaned.replace(/\b(de|del|la|el|los|las)\b/g, ' ');
    cleaned = cleaned.replace(/\b(todo|toda|todos|todas)\b/g, ' ');
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    return cleaned.length > 1 ? cleaned : null;
  }

  private extractCategoryFromAllPhrase(value: string): string | null {
    if (!value) return null;
    const raw = value.trim();
    const patterns: RegExp[] = [
      /^(?:todas?|todos?)\s+(?:las|los)\s+(.+)$/i,
      /^(?:todas?|todos?)\s+(.+)$/i,
    ];
    for (const pattern of patterns) {
      const match = raw.match(pattern);
      if (match?.[1]) {
        const categoryName = this.cleanCategoryName(match[1]);
        if (categoryName) return categoryName;
      }
    }
    return null;
  }

  private extractPriceAdjustmentIntent(
    command: string
  ): { percent?: number; amount?: number; categoryName?: string; name?: string; productNames?: string[]; query?: string } | null {
    const normalized = this.normalizeText(command);
    if (!this.commandWantsPriceAdjustment(command)) return null;

    const percentMatch = command.match(/([+-]?\d+(?:[.,]\d+)?)\s*%/i)
      || command.match(/([+-]?\d+(?:[.,]\d+)?)\s*por\s*ciento/i);
    const amountMatch = command.match(/\$\s*([+-]?\d+(?:[.,]\d+)?)/i)
      || command.match(/([+-]?\d+(?:[.,]\d+)?)\s*(?:pesos?|ars)\b/i)
      || command.match(
        /(?:subi(?:le)?|subir|aumenta(?:r)?|incrementa(?:r)?|agrega(?:r|le)?|suma(?:r|le)?|baja(?:r|le)?|disminu(?:i|ir)|reduce|reducir|resta(?:r|le)?|quita(?:r|le)?)\s+([+-]?\d+(?:[.,]\d+)?)/i
      );

    const hasDecreaseMarker = /(baja|bajar|disminu|reduc|resta|quita|descuent)/.test(normalized);
    const hasIncreaseMarker = /(subi|subir|aument|increment|ajusta|actualiza|modifica|agrega|suma)/.test(normalized);

    let percent: number | undefined;
    let amount: number | undefined;
    let numericToken: { index: number; length: number } | null = null;

    if (percentMatch?.[1]) {
      percent = Number(String(percentMatch[1]).replace(',', '.'));
      if (!Number.isFinite(percent) || percent === 0) return null;
      const explicitSign = /^[+-]/.test(String(percentMatch[1]).trim());
      if (!explicitSign) {
        if (percent > 0 && hasDecreaseMarker && !hasIncreaseMarker) {
          percent = -percent;
        } else if (percent < 0 && hasIncreaseMarker && !hasDecreaseMarker) {
          percent = Math.abs(percent);
        }
      }
      numericToken = {
        index: percentMatch.index || 0,
        length: percentMatch[0].length,
      };
    } else if (amountMatch?.[1]) {
      amount = Number(String(amountMatch[1]).replace(',', '.'));
      if (!Number.isFinite(amount) || amount === 0) return null;
      const explicitSign = /^[+-]/.test(String(amountMatch[1]).trim());
      if (!explicitSign) {
        if (amount > 0 && hasDecreaseMarker && !hasIncreaseMarker) {
          amount = -amount;
        } else if (amount < 0 && hasIncreaseMarker && !hasDecreaseMarker) {
          amount = Math.abs(amount);
        }
      }
      numericToken = {
        index: amountMatch.index || 0,
        length: amountMatch[0].length,
      };
    } else {
      return null;
    }

    const categoryPatterns: RegExp[] = [
      /(?:categoria|categoría)\s*(?:de|del|la|las|los)?\s*["']?(.+?)["']?(?:$|,|\sy\s|\sen\s|\spara\s)/i,
      /(?:a|para)\s+(?:la\s+)?(?:categoria|categoría)\s*["']?(.+?)["']?$/i,
      /(?:a|para)\s+(?:todas?|todos?)\s+(?:las|los)\s+(.+?)$/i,
    ];
    for (const pattern of categoryPatterns) {
      const match = command.match(pattern);
      if (!match?.[1]) continue;
      const categoryName = this.cleanCategoryName(match[1]);
      if (categoryName) {
        return { ...(percent !== undefined ? { percent } : { amount }), categoryName };
      }
    }

    let tail = numericToken
      ? command.slice(numericToken.index + numericToken.length)
      : command;
    tail = tail
      .replace(/^[\s:,\-.]+/, '')
      .replace(/^(?:a|al|para|por|del|de|la|el|los|las)\s+/i, '')
      .replace(/\b(?:precio|precios)\b/gi, ' ')
      .trim();

    const parts = tail
      .split(/[,;]+/)
      .flatMap((part) => part.split(/\s+\b(?:y|e)\b\s+/i))
      .map((part) => this.cleanPriceAdjustmentTarget(part))
      .filter(Boolean);

    const uniqueParts = Array.from(new Set(parts));
    if (uniqueParts.length > 1) {
      return { ...(percent !== undefined ? { percent } : { amount }), productNames: uniqueParts };
    }
    if (uniqueParts.length === 1) {
      return { ...(percent !== undefined ? { percent } : { amount }), name: uniqueParts[0] };
    }

    const trailingTarget = command.match(/(?:a|al|para)\s+(.+)$/i);
    if (trailingTarget?.[1]) {
      const candidate = this.cleanPriceAdjustmentTarget(trailingTarget[1]);
      if (candidate) {
        return { ...(percent !== undefined ? { percent } : { amount }), query: candidate };
      }
    }

    return percent !== undefined ? { percent } : { amount };
  }

  private cleanPriceAdjustmentTarget(value: string): string {
    let cleaned = value
      .replace(/[¿?]/g, ' ')
      .replace(/["'`]/g, ' ')
      .trim();
    cleaned = cleaned
      .replace(/^(?:de|del|la|el|los|las|al|a|para)\s+/i, '')
      .replace(/\b(?:precio|precios)\b/gi, ' ')
      .replace(/\b(?:producto|productos|articulo|articulos|item|items)\b/gi, ' ')
      .replace(/\b(?:este|esta|estos|estas|ese|esa|esos|esas)\b/gi, ' ');
    cleaned = this.cleanProductQuery(cleaned)
      .replace(/[.!]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleaned) return '';
    if (this.isGenericProductWord(cleaned) || this.isGenericProductQuery(cleaned)) return '';
    return cleaned;
  }

  private extractCategoryAssignmentIntent(
    command: string
  ): { categoryName: string; productQuery: string; color?: string } | null {
    const normalized = this.normalizeText(command);
    if (!normalized.includes('categoria')) return null;

    const assignMarkers = [
      'agrega',
      'agregar',
      'agregale',
      'agregasela',
      'asigna',
      'asignar',
      'asignale',
      'asignasela',
      'pon',
      'pone',
      'poner',
      'ponle',
      'ponela',
      'aplica',
      'aplicar',
      'aplicale',
    ];
    if (!assignMarkers.some((marker) => normalized.includes(marker))) return null;

    const colorIntent = this.resolveCategoryColorFromCommand(command);
    const patterns: RegExp[] = [
      /(?:crea(?:r|me|melo)?|crea|crear|creame|creáme)\s+(?:una\s+)?categor[ií]a\s+(?:que\s+se\s+llame|llamada|llamado|de\s+nombre)?\s*["']?(.+?)["']?\s*(?:y|e)\s*(?:agreg(?:a|ar|ale|asela)|asign(?:a|ar|ale|asela)|pon(?:e|er|le|ela)|aplic(?:a|ar|ale))\s*(?:a|al|a\s+la|a\s+las|a\s+los|en|para)\s*(?:los|las)?\s*(.+)$/i,
      /(?:agreg(?:a|ar|ale|asela)|asign(?:a|ar|ale|asela)|pon(?:e|er|le|ela)|aplic(?:a|ar|ale))\s+(?:la\s+)?categor[ií]a\s+["']?(.+?)["']?\s*(?:a|al|a\s+la|a\s+las|a\s+los|en|para)\s*(?:los|las)?\s*(.+)$/i,
    ];

    for (const pattern of patterns) {
      const match = command.match(pattern);
      if (!match) continue;
      const rawCategory = match[1] || '';
      const rawProduct = match[2] || '';
      const cleanedCategory = this.stripColorDescriptor(rawCategory, colorIntent.raw);
      const categoryName = this.cleanCategoryName(cleanedCategory);
      const productQuery = this.cleanProductQuery(rawProduct);
      if (categoryName && productQuery) {
        const payload: { categoryName: string; productQuery: string; color?: string } = {
          categoryName,
          productQuery,
        };
        if (colorIntent.color) {
          payload.color = colorIntent.color;
        }
        return payload;
      }
    }

    return null;
  }

  private extractDebtReminderIntent(command: string): Record<string, unknown> | null {
    const normalized = this.normalizeText(command);
    if (!this.commandWantsDebtReminder(normalized)) return null;
    if (this.extractDebtReminderBulkIntent(command)) return null;

    const extracted = this.extractCustomerIdentifierFromReminder(command);
    if (extracted) return extracted;
    const looseName = this.extractCustomerNameLoose(command);
    if (looseName) return { name: looseName };
    return null;
  }

  private extractDebtReminderBulkIntent(command: string): boolean {
    const normalized = this.normalizeText(command);
    if (!this.commandWantsDebtReminder(normalized)) return false;
    const hasAll = normalized.includes('todos') || normalized.includes('todas');
    const hasCustomers =
      normalized.includes('clientes') ||
      normalized.includes('deudores') ||
      normalized.includes('clientes con deuda');
    return hasAll && hasCustomers;
  }

  private extractCustomerIdentifierFromReminder(command: string): { name?: string; phone?: string } | null {
    const cleaned = command.replace(/[¿?]/g, ' ').trim();
    let match = cleaned.match(/\b(?:a|al|para)\b\s+(?:el\s+cliente\s+)?(.+)$/i);
    if (!match || !match[1]) {
      const extraPatterns = [
        /recorda(?:r)?\s+(?:la\s+)?deuda\s+(?:a|al|para)?\s*(.+)$/i,
        /recordatorio\s+(?:de\s+)?deuda\s+(?:a|al|para)?\s*(.+)$/i,
        /deuda\s+(?:a|al|para)?\s*(.+)$/i,
      ];
      for (const pattern of extraPatterns) {
        const extraMatch = cleaned.match(pattern);
        if (extraMatch && extraMatch[1]) {
          match = extraMatch;
          break;
        }
      }
    }

    if (!match || !match[1]) return null;

    let candidate = match[1].trim();
    const normalizedCandidate = this.normalizeText(candidate);
    if (normalizedCandidate.includes('todos') && normalizedCandidate.includes('clientes')) return null;
    candidate = candidate.replace(/\b(sobre|por|de)\s+su\s+(deuda|saldo)\b.*$/i, '');
    candidate = candidate.replace(/\b(deuda|saldo)\b.*$/i, '');
    candidate = candidate.replace(/[.]+$/g, '').trim();
    if (candidate.length < 2) {
      if (match && match[1] && match[0] && match[0].trim() !== match[1].trim()) {
        const fallbackPatterns = [
          /recorda(?:r)?\s+(?:la\s+)?deuda\s+(?:a|al|para)?\s*(.+)$/i,
          /recordatorio\s+(?:de\s+)?deuda\s+(?:a|al|para)?\s*(.+)$/i,
          /deuda\s+(?:a|al|para)?\s*(.+)$/i,
        ];
        for (const pattern of fallbackPatterns) {
          const fallbackMatch = cleaned.match(pattern);
          if (fallbackMatch && fallbackMatch[1]) {
            candidate = fallbackMatch[1].trim();
            break;
          }
        }
      }
    }
    if (candidate.length < 2) return null;

    const blocked = ['deuda', 'saldo', 'recordatorio', 'cobranza', 'cobrar'];
    if (blocked.some((word) => candidate.toLowerCase().includes(word))) return null;

    const digits = candidate.replace(/\D/g, '');
    if (digits.length >= 6) {
      return { phone: candidate };
    }
    return { name: candidate };
  }

  private extractCustomerNameLoose(command: string): string | null {
    let candidate = command.replace(/[¿?]/g, ' ').trim();
    candidate = candidate
      .replace(/\b(recorda(?:r)?|recordatorio|recordale|recorda|avisale|avisa|manda|mandale|enviar|envia)\b/gi, '')
      .replace(/\b(deuda|saldo|recordatorio|cobranza|cobrar)\b/gi, '')
      .replace(/\b(cliente|clientes)\b/gi, '')
      .replace(/\b(a|al|para|del|de)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (candidate.length < 2) return null;
    const normalizedCandidate = this.normalizeText(candidate);
    if (normalizedCandidate.includes('todos') && normalizedCandidate.includes('clientes')) return null;
    return candidate;
  }

  private extractStockThreshold(command: string): number | null {
    const normalized = this.normalizeText(command);
    if (!this.commandWantsLowStock(normalized)) return null;
    const match = normalized.match(/\b(\d{1,4})\b/);
    if (!match) return null;
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value < 0) return null;
    return value;
  }

  private extractProductNameFromCommand(command: string): string | null {
    const cleaned = command.replace(/[¿?]/g, ' ').trim();
    const patterns = [
      /(?:cuantas?|cuanto)\s+(?:unidades?|uds?|stock|existencias?)\s+(?:tiene|tenes|tenemos|ten[ií]a|ten[ií]an|hay|hab[ií]a|hab[ií]an|queda|quedan|quedaba|quedaban)?\s*(?:de|del|la|el)?\s*(.+)$/i,
      /(?:stock|existencias?|inventario)\s+(?:de|del|la|el)?\s*(.+)$/i,
      /(?:unidades?|uds?)\s+(?:de|del|la|el)\s*(.+)$/i,
      /(?:cuantas?|cuanto)\s+(?:tiene|tenes|tenemos|ten[ií]a|ten[ií]an|hay|hab[ií]a|hab[ií]an|queda|quedan|quedaba|quedaban)\s+(?:de|del|la|el)\s*(.+)$/i,
      /(?:cuantas?|cuantos?)\s+(.+?)\s+(?:hay|hab[ií]a|hab[ií]an|tiene|tenes|tenemos|ten[ií]a|ten[ií]an|queda|quedan|quedaba|quedaban)\b/i,
    ];

    for (const pattern of patterns) {
      const match = cleaned.match(pattern);
      if (match && match[1]) {
        const candidate = this.cleanProductQuery(match[1]).replace(/[!.]+$/g, '').trim();
        if (candidate.length >= 2) return candidate;
      }
    }

    return null;
  }

  private cleanProductQuery(value: string): string {
    let cleaned = value.replace(/[¿?]/g, ' ').trim().replace(/\s+/g, ' ');
    cleaned = cleaned.replace(
      /^(?:hab[ií]a|hab[ií]an|hay|tiene|tenes|tenemos|ten[ií]a|ten[ií]an|queda|quedan|quedaba|quedaban)\s+(?:de|del|la|el)\s+/i,
      ''
    );
    cleaned = cleaned.replace(/^(?:de|del|la|el)\s+/i, '');
    return cleaned.trim();
  }

  private extractMeaningfulProductTokens(value: string): string[] {
    const normalized = this.normalizeText(value);
    const tokens = normalized.split(' ').filter(Boolean);
    const stopwords = new Set([
      'de',
      'del',
      'la',
      'el',
      'los',
      'las',
      'un',
      'una',
      'unos',
      'unas',
      'hay',
      'habia',
      'haya',
      'tiene',
      'tenes',
      'tenemos',
      'tenia',
      'tenian',
      'queda',
      'quedan',
      'quedaba',
      'quedaban',
      'cuanto',
      'cuantos',
      'cuanta',
      'cuantas',
      'stock',
      'existencia',
      'existencias',
      'inventario',
      'unidad',
      'unidades',
      'uds',
      'ud',
      'u',
      'producto',
      'productos',
      'articulo',
      'articulos',
      'item',
      'items',
      'cosa',
      'cosas',
      'lts',
      'lt',
      'l',
      'ml',
      'kg',
      'g',
      'gr',
      'grs',
    ]);
    return tokens.filter((token) => {
      if (stopwords.has(token)) return false;
      if (/^\d+(?:[.,]\d+)?$/.test(token)) return false;
      return true;
    });
  }

  private isGenericProductQuery(value: string): boolean {
    return this.extractMeaningfulProductTokens(value).length === 0;
  }

  private isGenericProductWord(value: string): boolean {
    const normalized = this.normalizeText(value);
    return [
      'producto',
      'productos',
      'articulo',
      'articulos',
      'item',
      'items',
      'cosa',
      'cosas',
      'unidad',
      'unidades',
    ].includes(normalized);
  }

  private buildUnitValueVariants(value?: string): string[] {
    if (!value) return [];
    const normalized = value.replace(',', '.').trim();
    if (!normalized) return [];
    const variants = new Set<string>();
    variants.add(normalized);
    if (normalized.includes('.')) {
      variants.add(normalized.replace('.', ','));
    } else if (normalized.includes(',')) {
      variants.add(normalized.replace(',', '.'));
    }
    return Array.from(variants);
  }

  private singularizeProductName(value: string): string {
    const trimmed = value.trim();
    if (trimmed.length <= 3) return trimmed;
    if (trimmed.endsWith('es') && trimmed.length > 4) {
      return trimmed.slice(0, -2);
    }
    if (trimmed.endsWith('s') && trimmed.length > 3) {
      return trimmed.slice(0, -1);
    }
    return trimmed;
  }

  private extractProductQueryFromTools(tools: ParsedToolCall[]): string | null {
    for (const tool of tools) {
      if (tool.toolName === 'get_product_details') {
        const name = tool.input.name;
        if (typeof name === 'string' && name.trim()) return name.trim();
      }
      if (tool.toolName === 'search_products' || tool.toolName === 'list_products') {
        const query = tool.input.query;
        if (typeof query === 'string' && query.trim()) return query.trim();
      }
    }
    return null;
  }

  private toolHasProductIdentifier(input: Record<string, unknown>): boolean {
    return Boolean(input.productId || input.sku || input.name);
  }

  private resolveMonthRange(command: string): { from: Date; to: Date; label: string } | null {
    const normalized = this.normalizeText(command);
    if (!normalized) return null;

    if (
      normalized.includes('mes pasado') ||
      normalized.includes('mes anterior') ||
      normalized.includes('mes previo')
    ) {
      const now = new Date();
      const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
      const monthIndex = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
      const label = `${MONTH_DEFINITIONS[monthIndex].label} ${year}`;
      const from = new Date(year, monthIndex, 1);
      const to = new Date(year, monthIndex + 1, 0, 23, 59, 59, 999);
      return { from, to, label };
    }

    const tokens = normalized.split(' ').filter(Boolean);
    let monthIndex: number | null = null;
    let monthLabel = '';
    let monthTokenIndex = -1;

    for (const month of MONTH_DEFINITIONS) {
      const idx = tokens.findIndex((token) => month.names.includes(token));
      if (idx >= 0) {
        monthIndex = month.index;
        monthLabel = month.label;
        monthTokenIndex = idx;
        break;
      }
    }

    if (monthIndex === null) return null;

    let year: number | null = null;
    const yearMatch = normalized.match(/\b(20\d{2})\b/);
    if (yearMatch) {
      year = Number(yearMatch[1]);
    } else {
      const nextToken = tokens[monthTokenIndex + 1];
      const prevToken = tokens[monthTokenIndex - 1];
      const shortYear = [nextToken, prevToken].find((token) => token && /^\d{2}$/.test(token));
      if (shortYear) {
        year = 2000 + Number(shortYear);
      }
    }

    const finalYear = year ?? new Date().getFullYear();
    const from = new Date(finalYear, monthIndex, 1);
    const to = new Date(finalYear, monthIndex + 1, 0, 23, 59, 59, 999);
    const label = `${monthLabel} ${finalYear}`;

    return { from, to, label };
  }

  private resolveSalesRangeFromInput(input: Record<string, unknown>): { from: Date; to: Date; label: string } | null {
    if (input.from || input.to) {
      if (!input.from) {
        throw new Error('Falta fecha desde');
      }
      const from = new Date(String(input.from));
      const to = input.to ? new Date(String(input.to)) : new Date();
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        throw new Error('Fechas inválidas');
      }
      const label = typeof input.label === 'string' && input.label.trim()
        ? String(input.label)
        : 'Rango personalizado';
      return { from, to, label };
    }

    if (input.month !== undefined && input.month !== null) {
      const monthIndex = this.parseMonthInput(input.month);
      if (monthIndex === null) {
        throw new Error('Mes inválido');
      }
      const yearRaw = input.year !== undefined ? Number(input.year) : new Date().getFullYear();
      if (!Number.isFinite(yearRaw) || yearRaw < 2000) {
        throw new Error('Año inválido');
      }
      const from = new Date(yearRaw, monthIndex, 1);
      const to = new Date(yearRaw, monthIndex + 1, 0, 23, 59, 59, 999);
      const label = `${MONTH_DEFINITIONS[monthIndex].label} ${yearRaw}`;
      return { from, to, label };
    }

    return null;
  }

  private parseMonthInput(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      const month = Math.floor(value);
      if (month >= 1 && month <= 12) return month - 1;
      if (month >= 0 && month <= 11) return month;
      return null;
    }
    if (typeof value === 'string') {
      const normalized = this.normalizeText(value);
      if (!normalized) return null;
      if (/^\d{1,2}$/.test(normalized)) {
        const month = Number(normalized);
        if (month >= 1 && month <= 12) return month - 1;
      }
      for (const month of MONTH_DEFINITIONS) {
        if (month.names.includes(normalized)) return month.index;
      }
    }
    return null;
  }

  private parseOptionalBoolean(value: unknown): boolean | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'si', 'sí', 'yes', 'y'].includes(normalized)) return true;
      if (['false', '0', 'no', 'n'].includes(normalized)) return false;
    }
    return undefined;
  }

  private buildParsedToolCall(toolName: string, input: Record<string, unknown>): ParsedToolCall {
    return {
      toolName,
      input,
      policy: TOOL_POLICIES[toolName] || {
        name: toolName,
        riskLevel: 'moderate',
        requiresConfirmation: true,
        allowedRoles: ['owner'],
        description: 'Herramienta desconocida',
      },
    };
  }

  private stableStringify(value: unknown): string {
    if (value === null || value === undefined) return 'null';
    if (typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
    }
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${this.stableStringify(obj[key])}`).join(',')}}`;
  }

  private dedupeParsedTools(tools: ParsedToolCall[]): ParsedToolCall[] {
    const seen = new Set<string>();
    const deduped: ParsedToolCall[] = [];
    for (const tool of tools) {
      const key = `${tool.toolName}:${this.stableStringify(tool.input)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(tool);
    }
    return deduped;
  }

  private async resolveCustomer(input: Record<string, unknown>, workspaceId: string) {
    const where: Prisma.CustomerWhereInput = { workspaceId, deletedAt: null };
    const customerId = input.customerId ? String(input.customerId) : undefined;
    if (customerId) {
      const customer = await this.prisma.customer.findFirst({ where: { id: customerId, workspaceId, deletedAt: null } });
      if (!customer) throw new Error('Cliente no encontrado');
      return customer;
    }

    if (input.phone) {
      const phone = String(input.phone);
      where.phone = { contains: phone.replace(/\D/g, '') };
    } else if (input.email) {
      where.email = { contains: String(input.email), mode: 'insensitive' as const };
    } else if (input.name) {
      const rawName = String(input.name).trim();
      const tokens = rawName.split(/\s+/).filter(Boolean);
      const fullNameFilter = [
        { firstName: { contains: rawName, mode: 'insensitive' as const } },
        { lastName: { contains: rawName, mode: 'insensitive' as const } },
      ];

      if (tokens.length >= 2) {
        const first = tokens[0];
        const last = tokens[tokens.length - 1];
        where.OR = [
          ...fullNameFilter,
          {
            AND: [
              { firstName: { contains: first, mode: 'insensitive' as const } },
              { lastName: { contains: last, mode: 'insensitive' as const } },
            ],
          },
          {
            AND: [
              { firstName: { contains: last, mode: 'insensitive' as const } },
              { lastName: { contains: first, mode: 'insensitive' as const } },
            ],
          },
        ];
      } else {
        where.OR = fullNameFilter;
      }
    } else {
      throw new Error('Necesito un cliente (id, nombre, teléfono o email).');
    }

    const candidates = await this.prisma.customer.findMany({
      where,
      take: 5,
      orderBy: { lastSeenAt: 'desc' },
    });

    if (candidates.length === 0) {
      throw new Error('Cliente no encontrado');
    }
    if (candidates.length > 1) {
      const names = candidates
        .map((c) => this.formatCustomerName(c))
        .join(', ');
      throw new Error(`Encontré varios clientes: ${names}. Especificá mejor.`);
    }

    return candidates[0];
  }

  private async resolveOrder(
    input: Record<string, unknown>,
    workspaceId: string,
    customerId?: string
  ) {
    const orderId = input.orderId ? String(input.orderId) : undefined;
    const orderNumber = input.orderNumber ? String(input.orderNumber).toUpperCase() : undefined;

    if (orderId) {
      const order = await this.prisma.order.findFirst({
        where: { id: orderId, workspaceId, ...(customerId ? { customerId } : {}) },
      });
      if (!order) throw new Error('Pedido no encontrado');
      return order;
    }

    if (!orderNumber) {
      throw new Error('Necesito un número de pedido');
    }

    const candidates = await this.prisma.order.findMany({
      where: {
        workspaceId,
        ...(customerId ? { customerId } : {}),
        orderNumber: { contains: orderNumber },
      },
      take: 5,
      orderBy: { createdAt: 'desc' },
    });

    if (candidates.length === 0) {
      throw new Error('Pedido no encontrado');
    }
    if (candidates.length > 1) {
      const list = candidates.map((o) => o.orderNumber).join(', ');
      throw new Error(`Encontré varios pedidos: ${list}. Usá el número completo.`);
    }

    return candidates[0];
  }

  private async resolveProduct(input: Record<string, unknown>, workspaceId: string) {
    const productId = input.productId ? String(input.productId) : undefined;
    const sku = input.sku ? String(input.sku) : undefined;
    const name = input.name ? String(input.name) : undefined;
    this.logDebug('resolveProduct:input', {
      workspaceId,
      hasProductId: Boolean(productId),
      hasSku: Boolean(sku),
      name,
    });

    if (productId) {
      const product = await this.prisma.product.findFirst({
        where: { id: productId, workspaceId, deletedAt: null, status: { not: 'archived' } },
        include: { stockItems: true },
      });
      if (!product) throw new Error('Producto no encontrado');
      return product;
    }

    if (!sku && !name) {
      throw new Error('Necesito un producto (id, SKU o nombre).');
    }

    const measurement = name ? this.parseProductMeasurement(name) : null;
    if (measurement) {
      this.logDebug('resolveProduct:measurement', {
        baseName: measurement.baseName,
        unit: measurement.unit,
        unitValue: measurement.unitValue,
        secondaryUnit: measurement.secondaryUnit,
        secondaryUnitValue: measurement.secondaryUnitValue,
      });
    }

    let candidates: Array<any> = [];

    if (!sku && measurement?.baseName) {
      const baseName = measurement.baseName.trim();
      const fallbackBaseName = this.singularizeProductName(baseName);
      const valueVariants = this.buildUnitValueVariants(measurement.unitValue);

      const where: Prisma.ProductWhereInput = {
        workspaceId,
        deletedAt: null,
        status: { not: 'archived' },
        name: { contains: baseName, mode: 'insensitive' },
      };

      if (measurement.unit) {
        where.unit = measurement.unit;
      }

      if (valueVariants.length > 0) {
        where.unitValue = { in: valueVariants };
      }

      if (measurement.secondaryUnit) {
        where.secondaryUnit = measurement.secondaryUnit;
      }
      if (measurement.secondaryUnitValue) {
        where.secondaryUnitValue = { in: this.buildUnitValueVariants(measurement.secondaryUnitValue) };
      }

      candidates = await this.prisma.product.findMany({
        where,
        include: { stockItems: true },
        take: 5,
      });
      this.logDebug('resolveProduct:query:unit', { count: candidates.length });

      if (candidates.length === 0 && (measurement.unit || valueVariants.length > 0)) {
        candidates = await this.prisma.product.findMany({
          where: {
            workspaceId,
            deletedAt: null,
            status: { not: 'archived' },
            name: { contains: baseName, mode: 'insensitive' },
          },
          include: { stockItems: true },
          take: 5,
        });
        this.logDebug('resolveProduct:query:basename', { count: candidates.length });
      }

      if (candidates.length === 0 && fallbackBaseName && fallbackBaseName !== baseName) {
        candidates = await this.prisma.product.findMany({
          where: {
            workspaceId,
            deletedAt: null,
            status: { not: 'archived' },
            name: { contains: fallbackBaseName, mode: 'insensitive' },
          },
          include: { stockItems: true },
          take: 5,
        });
        this.logDebug('resolveProduct:query:singular', { count: candidates.length });
      }
    }

    if (candidates.length === 0) {
      candidates = await this.prisma.product.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          status: { not: 'archived' },
          ...(sku
            ? { sku: { contains: sku, mode: 'insensitive' } }
            : { name: { contains: name as string, mode: 'insensitive' } }),
        },
        include: { stockItems: true },
        take: 5,
      });
      this.logDebug('resolveProduct:query:fallback', { count: candidates.length });
    }

    if (measurement && candidates.length > 1) {
      candidates = this.filterProductsByMeasurement(candidates, measurement);
      this.logDebug('resolveProduct:filtered', { count: candidates.length });
    }

    if (candidates.length === 0) {
      throw new Error('Producto no encontrado');
    }
    if (candidates.length > 1) {
      const mapped = candidates.map((p) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        unit: p.unit,
        unitValue: p.unitValue,
        secondaryUnit: p.secondaryUnit,
        secondaryUnitValue: p.secondaryUnitValue,
      }));
      throw new AmbiguousProductError(mapped);
    }

    return candidates[0];
  }

  private parseProductMeasurement(
    value: string
  ): {
    baseName: string;
    unitValue?: string;
    unit?: string;
    secondaryUnit?: string;
    secondaryUnitValue?: string;
  } | null {
    const cleaned = this.cleanProductQuery(value).replace(/\s+/g, ' ');
    const normalized = cleaned.replace(/\bde\s+(?=\d)/gi, '').replace(/\s+/g, ' ').trim();
    if (!normalized) return null;

    const secondaryUnitMap: Record<string, string> = {
      pack: 'pack',
      packs: 'pack',
      caja: 'box',
      cajas: 'box',
      box: 'box',
      bulto: 'bundle',
      bultos: 'bundle',
      docena: 'dozen',
      docenas: 'dozen',
    };

    let secondaryUnit: string | undefined;
    let secondaryUnitValue: string | undefined;
    let withoutSecondary = normalized;

    const secondaryMatch = normalized.match(
      /^(.*?)(pack|packs|caja|cajas|box|bulto|bultos|docena|docenas)\s*(?:de\s*)?(\d+(?:[.,]\d+)?)?/i
    );
    if (secondaryMatch) {
      const rawUnit = secondaryMatch[2]?.toLowerCase();
      secondaryUnit = rawUnit ? secondaryUnitMap[rawUnit] : undefined;
      const rawValue = secondaryMatch[3]?.replace(',', '.').trim();
      if (secondaryUnit === 'dozen') {
        secondaryUnitValue = '12';
      } else if (rawValue) {
        secondaryUnitValue = rawValue;
      }

      const baseCandidate = secondaryMatch[1]?.trim();
      if (baseCandidate) {
        withoutSecondary = baseCandidate;
      }
    }

    const match = withoutSecondary.match(
      /^(.*?)(\d+(?:[.,]\d+)?)(?:\s*(lts?|lt|l|ml|kg|g|grs?|gr|unidades?|uds?|u))?\b/i
    );
    if (match) {
      const baseName = match[1].trim();
      if (!baseName) return null;
      const unitValue = match[2]?.replace(',', '.').trim();
      const unitRaw = match[3]?.toLowerCase();
      const unitMap: Record<string, string> = {
        lts: 'l',
        lt: 'l',
        l: 'l',
        ml: 'ml',
        kg: 'kg',
        g: 'g',
        gr: 'g',
        grs: 'g',
        unidad: 'unit',
        unidades: 'unit',
        u: 'unit',
        uds: 'unit',
      };
      const unit = unitRaw ? (unitMap[unitRaw] || unitRaw) : undefined;
      return {
        baseName,
        unitValue,
        unit,
        secondaryUnit,
        secondaryUnitValue,
      };
    }

    if (secondaryUnit && withoutSecondary.trim()) {
      return {
        baseName: withoutSecondary.trim(),
        secondaryUnit,
        secondaryUnitValue,
      };
    }

    return null;
  }

  private filterProductsByMeasurement(
    products: Array<{
      name: string;
      unit?: string | null;
      unitValue?: string | number | null;
      secondaryUnit?: string | null;
      secondaryUnitValue?: string | number | null;
    }>,
    measurement: { unitValue?: string; unit?: string; secondaryUnit?: string; secondaryUnitValue?: string }
  ) {
    let filtered = products;
    if (measurement.unit) {
      const unitMatches = filtered.filter((p) => (p.unit || 'unit') === measurement.unit);
      if (unitMatches.length > 0) {
        filtered = unitMatches;
      }
    }

    if (measurement.unitValue) {
      const normalizedValue = measurement.unitValue.replace(',', '.').trim();
      const normalize = (value: string | number | null | undefined) =>
        value === null || value === undefined ? '' : String(value).replace(',', '.').trim();

      const valueMatches = filtered.filter((p) => normalize(p.unitValue) === normalizedValue);
      if (valueMatches.length > 0) {
        filtered = valueMatches;
      } else {
        const nameMatches = filtered.filter((p) =>
          p.name?.toLowerCase().includes(normalizedValue) ||
          p.name?.toLowerCase().includes(normalizedValue.replace('.', ','))
        );
        if (nameMatches.length > 0) {
          filtered = nameMatches;
        }
      }
    }

    if (measurement.secondaryUnit) {
      const secondaryMatches = filtered.filter((p) => p.secondaryUnit === measurement.secondaryUnit);
      if (secondaryMatches.length > 0) {
        filtered = secondaryMatches;
      }
    }

    if (measurement.secondaryUnitValue) {
      const normalizedValue = measurement.secondaryUnitValue.replace(',', '.').trim();
      const normalize = (value: string | number | null | undefined) =>
        value === null || value === undefined ? '' : String(value).replace(',', '.').trim();

      const valueMatches = filtered.filter((p) => normalize(p.secondaryUnitValue) === normalizedValue);
      if (valueMatches.length > 0) {
        filtered = valueMatches;
      }
    }

    return filtered;
  }

  private async resolveCategory(input: Record<string, unknown>, workspaceId: string) {
    const categoryId = input.categoryId ? String(input.categoryId) : undefined;
    const name = input.name ? String(input.name) : undefined;

    if (categoryId) {
      const category = await this.prisma.productCategory.findFirst({
        where: { id: categoryId, workspaceId, deletedAt: null },
      });
      if (!category) throw new Error('Categoría no encontrada');
      return category;
    }

    if (!name) {
      throw new Error('Necesito una categoría (id o nombre).');
    }

    const candidates = await this.prisma.productCategory.findMany({
      where: { workspaceId, deletedAt: null, name: { contains: name, mode: 'insensitive' } },
      take: 5,
      orderBy: { sortOrder: 'asc' },
    });

    if (candidates.length === 0) {
      throw new Error('Categoría no encontrada');
    }
    if (candidates.length > 1) {
      const list = candidates.map((c) => c.name).join(', ');
      throw new Error(`Encontré varias categorías: ${list}. Especificá mejor.`);
    }

    return candidates[0];
  }

  private async resolveConversation(input: Record<string, unknown>, workspaceId: string) {
    const sessionId = input.sessionId ? String(input.sessionId) : undefined;
    if (sessionId) {
      const session = await this.prisma.agentSession.findFirst({
        where: { id: sessionId, workspaceId },
        include: {
          customer: { select: { id: true, phone: true, firstName: true, lastName: true } },
        },
      });
      if (!session) throw new Error('Conversación no encontrada');
      return {
        id: session.id,
        customerId: session.customerId,
        customerPhone: session.customer.phone,
        customerName: session.customer.firstName
          ? `${session.customer.firstName} ${session.customer.lastName || ''}`.trim()
          : session.customer.phone,
        channelType: session.channelType,
        agentActive: session.agentActive,
        currentState: session.currentState,
        lastActivityAt: session.lastActivityAt,
        channelId: session.channelId,
      };
    }

    const customer = await this.resolveCustomer(input, workspaceId);
    const session = await this.prisma.agentSession.findFirst({
      where: { workspaceId, customerId: customer.id, endedAt: null },
      orderBy: { lastActivityAt: 'desc' },
    });

    if (!session) {
      throw new Error('No encontré una conversación activa para ese cliente');
    }

    return {
      id: session.id,
      customerId: session.customerId,
      customerPhone: customer.phone || '',
      customerName: this.formatCustomerName(customer),
      channelType: session.channelType,
      agentActive: session.agentActive,
      currentState: session.currentState,
      lastActivityAt: session.lastActivityAt,
      channelId: session.channelId,
    };
  }

  private resolveWhatsAppApiKey(number: {
    apiKeyEnc?: string | null;
    apiKeyIv?: string | null;
    provider?: string | null;
  }): string {
    if (number.apiKeyEnc && number.apiKeyIv) {
      return decrypt({ encrypted: number.apiKeyEnc, iv: number.apiKeyIv });
    }

    const provider = (number.provider || 'infobip').toLowerCase();
    if (provider === 'infobip') {
      return (process.env.INFOBIP_API_KEY || '').trim();
    }
    return '';
  }

  private resolveInfobipBaseUrl(apiUrl?: string | null): string {
    const cleaned = (apiUrl || '').trim().replace(/\/$/, '');
    const envUrl = (process.env.INFOBIP_BASE_URL || '').trim().replace(/\/$/, '');
    const defaultUrl = 'https://api.infobip.com';

    if (cleaned && cleaned.toLowerCase() !== defaultUrl) {
      return cleaned;
    }
    if (envUrl) {
      return envUrl;
    }
    return cleaned || defaultUrl;
  }

  private buildProductDisplayName(product: {
    name: string;
    unit?: string | null;
    unitValue?: string | null;
    secondaryUnit?: string | null;
    secondaryUnitValue?: string | null;
  }) {
    const unit = product.unit || 'unit';
    const unitValue = product.unitValue?.toString().trim();
    const primarySuffix = unit !== 'unit' && unitValue ? `${unitValue} ${UNIT_SHORT_LABELS[unit] || unit}` : '';
    const secondaryLabel = product.secondaryUnit ? (SECONDARY_UNIT_LABELS[product.secondaryUnit] || product.secondaryUnit) : '';
    const secondaryValue = product.secondaryUnitValue?.toString().trim();
    const secondarySuffix = secondaryLabel ? `${secondaryLabel}${secondaryValue ? ` ${secondaryValue}` : ''}`.trim() : '';

    return [product.name, primarySuffix, secondarySuffix].filter(Boolean).join(' ').trim();
  }

  private buildDisambiguatedCommand(command: string, candidate: AmbiguousProductCandidate): string {
    const trimmed = command.trim();
    if (!trimmed) return trimmed;
    if (candidate.sku) {
      const skuLower = candidate.sku.toLowerCase();
      if (trimmed.toLowerCase().includes(skuLower)) {
        return trimmed;
      }
      return `${trimmed} para el SKU ${candidate.sku}`;
    }
    if (candidate.name) {
      const nameLower = candidate.name.toLowerCase();
      if (trimmed.toLowerCase().includes(nameLower)) {
        return trimmed;
      }
      return `${trimmed} (${candidate.name})`;
    }
    return trimmed;
  }

  private async detectAmbiguousProductSelection(
    parsedTools: ParsedToolCall[],
    command: string,
    workspaceId: string
  ): Promise<{ summary: string; actions: QuickActionUIAction[] } | null> {
    const productTools = new Set([
      'adjust_stock',
      'adjust_prices_percent',
      'get_product_details',
      'update_product',
      'delete_product',
      'assign_category_to_products',
    ]);

    const candidateMap = new Map<string, AmbiguousProductCandidate>();
    const needsConfirmation = parsedTools.some((tool) => tool.policy.requiresConfirmation);
    const dangerousDescriptions = parsedTools
      .filter((tool) => tool.policy.riskLevel === 'dangerous')
      .map((tool) => tool.policy.description);
    const confirmationMessage = needsConfirmation
      ? `Esta acción ejecutará: ${dangerousDescriptions.length > 0 ? dangerousDescriptions.join(', ') : 'una actualización'}. ¿Confirmar?`
      : undefined;
    for (const tool of parsedTools) {
      if (!productTools.has(tool.toolName)) continue;
      if (tool.input.productId || tool.input.sku) continue;

      const rawName =
        (typeof tool.input.name === 'string' && tool.input.name.trim()) ||
        (typeof (tool.input as any).productName === 'string' && String((tool.input as any).productName).trim()) ||
        (typeof (tool.input as any).product === 'string' && String((tool.input as any).product).trim()) ||
        (typeof tool.input.query === 'string' && tool.input.query.trim()) ||
        (typeof (tool.input as any).search === 'string' && String((tool.input as any).search).trim()) ||
        this.extractProductNameFromCommand(command) ||
        '';

      if (!rawName) continue;

      const candidates = await this.findAmbiguousProductCandidates(
        { name: rawName },
        workspaceId,
        rawName
      );

      this.logDebug('execute:ambiguousProbe', {
        tool: tool.toolName,
        rawName,
        candidates: candidates.length,
      });

      if (candidates.length > 1) {
        candidates.forEach((candidate) => {
          if (candidate.id) candidateMap.set(candidate.id, candidate);
        });
      }
    }

    const candidates = Array.from(candidateMap.values());
    if (candidates.length <= 1) return null;

    const actions = candidates.slice(0, 5).map((candidate) => {
      const displayName = this.buildProductDisplayName(candidate);
      const label = candidate.sku ? `${displayName} (${candidate.sku})` : displayName;
      return {
        type: 'execute_command' as const,
        label: `Elegir ${label}`,
        command: this.buildDisambiguatedCommand(command, candidate),
        requiresConfirmation: needsConfirmation,
        confirmationMessage,
      };
    });

    return {
      summary: 'Encontré varios productos. Elegí el correcto para continuar.',
      actions,
    };
  }

  private async findAmbiguousProductCandidates(
    input: Record<string, unknown>,
    workspaceId: string,
    fallbackQuery?: string
  ): Promise<AmbiguousProductCandidate[]> {
    if (!workspaceId) return [];
    const name =
      (typeof input.name === 'string' && input.name.trim()) ||
      (typeof (input as any).productName === 'string' && String((input as any).productName).trim()) ||
      (typeof (input as any).product === 'string' && String((input as any).product).trim()) ||
      (typeof input.query === 'string' && input.query.trim()) ||
      (typeof (input as any).search === 'string' && String((input as any).search).trim()) ||
      (typeof (input as any).term === 'string' && String((input as any).term).trim()) ||
      (fallbackQuery ? fallbackQuery.trim() : '') ||
      '';
    if (!name) return [];

    const rawNames = name.split(',').map((value) => value.trim()).filter(Boolean);
    const uniqueNames = Array.from(new Set(rawNames.length > 0 ? rawNames : [name]));

    const candidates = await this.prisma.product.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        status: { not: 'archived' },
        OR: uniqueNames.map((value) => ({
          name: { contains: value, mode: 'insensitive' },
        })),
      },
      take: 5,
      select: {
        id: true,
        name: true,
        sku: true,
        unit: true,
        unitValue: true,
        secondaryUnit: true,
        secondaryUnitValue: true,
      },
      orderBy: { name: 'asc' },
    });

    return candidates.map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      sku: candidate.sku,
      unit: candidate.unit,
      unitValue: candidate.unitValue,
      secondaryUnit: candidate.secondaryUnit,
      secondaryUnitValue: candidate.secondaryUnitValue,
    }));
  }

  private buildQuickActionOutput(
    command: string,
    parsedTools: ParsedToolCall[],
    results: ToolExecutionResult[]
  ): { summary?: string; uiActions?: QuickActionUIAction[] } {
    const normalized = this.normalizeText(command);
    const wantsTopCustomer = this.commandWantsTopCustomer(normalized);
    const wantsTopProduct = this.commandWantsTopProduct(normalized);
    const wantsSalesSummary = this.commandWantsSalesSummary(normalized);
    const wantsMetrics = this.commandWantsMetrics(normalized);
    const wantsProductStock = this.commandWantsProductStock(normalized);
    const actions: QuickActionUIAction[] = [];
    const summaryLines: string[] = [];
    const resultMap = new Map(results.map((r) => [r.toolName, r]));
    const ambiguousProductResults = results.filter((r) => {
      if (r.success || !r.data || typeof r.data !== 'object') return false;
      return (r.data as any).kind === 'ambiguous_product';
    }) as Array<ToolExecutionResult & { data: { kind: string; candidates: AmbiguousProductCandidate[] } }>;

    if (ambiguousProductResults.length > 0) {
      const candidateMap = new Map<string, AmbiguousProductCandidate>();
      ambiguousProductResults.forEach((result) => {
        result.data.candidates?.forEach((candidate) => {
          if (candidate?.id) {
            candidateMap.set(candidate.id, candidate);
          }
        });
      });
      const candidates = Array.from(candidateMap.values());
      if (candidates.length > 0) {
        summaryLines.push('Encontré varios productos. Elegí el correcto para continuar.');
        candidates.slice(0, 5).forEach((candidate) => {
          const displayName = this.buildProductDisplayName(candidate);
          const label = candidate.sku ? `${displayName} (${candidate.sku})` : displayName;
          actions.push({
            type: 'execute_command',
            label: `Elegir ${label}`,
            command: this.buildDisambiguatedCommand(command, candidate),
          });
        });
      }
    }

    const addNavigate = (label: string, path: string, query?: Record<string, string>, _auto?: boolean) => {
      actions.push({ type: 'navigate', label, path, query });
    };

    const addOpenUrl = (label: string, url: string) => {
      actions.push({ type: 'open_url', label, url });
    };

    const navResult = resultMap.get('navigate_dashboard');
    if (navResult?.success && navResult.data && typeof navResult.data === 'object') {
      const data = navResult.data as { path?: string; query?: Record<string, string> };
      if (data.path) {
        summaryLines.push('Listo. Podés abrir la sección desde esta ventana.');
        addNavigate('Abrir', data.path, data.query);
      }
    }

    const customerResult = resultMap.get('get_customer_info');
    if (customerResult?.success) {
      const customers = Array.isArray(customerResult.data) ? customerResult.data as Array<any> : [];
      if (customers.length === 0) {
        summaryLines.push('No encontré clientes con ese criterio.');
      } else if (customers.length === 1) {
        const customer = customers[0];
        const name = this.formatCustomerName(customer);
        summaryLines.push(`Encontré a ${name}.`);
        addNavigate(`Abrir ${name}`, '/customers', { customerId: customer.id });
      } else {
        summaryLines.push(`Encontré ${customers.length} clientes.`);
        customers.slice(0, 5).forEach((customer) => {
          const name = this.formatCustomerName(customer);
          addNavigate(`Abrir ${name}`, '/customers', { customerId: customer.id });
        });
      }
    }

    const listCustomersResult = resultMap.get('list_customers');
    if (listCustomersResult?.success) {
      const customers = Array.isArray(listCustomersResult.data) ? listCustomersResult.data as Array<any> : [];
      if (customers.length === 0) {
        summaryLines.push('No encontré clientes.');
      } else {
        summaryLines.push(`Encontré ${customers.length} cliente(s).`);
        customers.slice(0, 5).forEach((customer) => {
          const name = this.formatCustomerName(customer);
          addNavigate(`Abrir ${name}`, '/customers', { customerId: customer.id });
        });
        addNavigate('Ver clientes', '/customers');
      }
    }

    const unpaidResult = resultMap.get('get_unpaid_orders');
    if (unpaidResult?.success && unpaidResult.data && typeof unpaidResult.data === 'object') {
      const data = unpaidResult.data as any;
      const customer = data.customer || {};
      const orders = Array.isArray(data.orders) ? data.orders : [];
      if (orders.length === 0) {
        summaryLines.push(`El cliente ${this.formatCustomerName(customer)} no tiene pedidos impagos.`);
      } else {
        summaryLines.push(
          `${this.formatCustomerName(customer)} tiene ${orders.length} pedido(s) impago(s) por $${this.formatMoney(data.totalPending || 0)}.`
        );
        orders.slice(0, 5).forEach((order: any) => {
          if (order.orderNumber) {
            addNavigate(`Abrir ${order.orderNumber}`, '/orders', { orderNumber: order.orderNumber });
          }
        });
      }
    }

    const balanceResult = resultMap.get('get_customer_balance');
    if (balanceResult?.success && balanceResult.data && typeof balanceResult.data === 'object') {
      const data = balanceResult.data as any;
      summaryLines.push(
        `Saldo de ${this.formatCustomerName(data)}: $${this.formatMoney(data.currentBalance || 0)}.`
      );
      if (data.id) {
        addNavigate('Ver cliente', '/customers', { customerId: data.id });
      }
    }

    const debtorsResult = resultMap.get('list_debtors');
    if (debtorsResult?.success && Array.isArray(debtorsResult.data)) {
      const customers = debtorsResult.data as Array<any>;
      if (customers.length === 0) {
        summaryLines.push('No hay clientes con deuda.');
      } else {
        summaryLines.push(`Clientes con deuda: ${customers.length}.`);
        addNavigate('Ver deudas', '/debts', undefined, true);
      }
    }

    const debtReminderResult = resultMap.get('send_debt_reminder');
    if (debtReminderResult?.success && debtReminderResult.data && typeof debtReminderResult.data === 'object') {
      const data = debtReminderResult.data as any;
      const customer = data.customer || {};
      const totalDebt = data.totalDebt ?? 0;
      summaryLines.push(
        `Recordatorio enviado a ${this.formatCustomerName(customer)} por $${this.formatMoney(totalDebt)}.`
      );
      if (customer.id) {
        addNavigate('Ver cliente', '/customers', { customerId: customer.id }, true);
      } else {
        addNavigate('Ver deudas', '/debts', undefined, true);
      }
    }

    const bulkDebtReminderResult = resultMap.get('send_debt_reminders_bulk');
    if (bulkDebtReminderResult?.success && bulkDebtReminderResult.data && typeof bulkDebtReminderResult.data === 'object') {
      const data = bulkDebtReminderResult.data as any;
      summaryLines.push(
        `Recordatorios enviados: ${data.sent || 0} · Fallidos: ${data.failed || 0} · Total deudores: ${data.total || 0}.`
      );
      addNavigate('Ver deudas', '/debts', undefined, true);
    }

    const orderDetailResult = resultMap.get('get_order_details');
    if (orderDetailResult?.success && orderDetailResult.data && typeof orderDetailResult.data === 'object') {
      const order = orderDetailResult.data as any;
      summaryLines.push(`Pedido ${order.orderNumber} (${order.status}).`);
      addNavigate(`Abrir ${order.orderNumber}`, '/orders', { orderId: order.id }, true);
    }

    const listOrdersResult = resultMap.get('list_orders');
    if (listOrdersResult?.success && Array.isArray(listOrdersResult.data)) {
      const orders = listOrdersResult.data as Array<any>;
      summaryLines.push(`Encontré ${orders.length} pedido(s).`);
      if (orders.length === 1) {
        const order = orders[0];
        if (order?.id) {
          addNavigate(`Abrir ${order.orderNumber || 'pedido'}`, '/orders', { orderId: order.id }, true);
        }
      } else if (orders.length > 1) {
        addNavigate('Ver pedidos', '/orders', undefined, true);
      }
    }

    const conversationsResult = resultMap.get('list_conversations');
    if (conversationsResult?.success && Array.isArray(conversationsResult.data)) {
      const conversations = conversationsResult.data as Array<any>;
      if (conversations.length === 0) {
        summaryLines.push('No hay conversaciones activas.');
      } else {
        summaryLines.push(`Conversaciones activas: ${conversations.length}.`);
        const first = conversations[0];
        if (first?.id) {
          addNavigate(`Abrir ${first.customerName || 'conversación'}`, '/inbox', { sessionId: first.id }, true);
        } else {
          addNavigate('Abrir inbox', '/inbox', undefined, true);
        }
      }
    }

    const openConversationResult = resultMap.get('open_conversation');
    if (openConversationResult?.success && openConversationResult.data && typeof openConversationResult.data === 'object') {
      const session = openConversationResult.data as any;
      summaryLines.push(`Abrí la conversación con ${session.customerName || 'cliente'}.`);
      if (session.id) {
        addNavigate(`Abrir ${session.customerName || 'conversación'}`, '/inbox', { sessionId: session.id }, true);
      }
    }

    const messagesResult = resultMap.get('get_conversation_messages');
    if (messagesResult?.success && messagesResult.data && typeof messagesResult.data === 'object') {
      const data = messagesResult.data as any;
      if (data.session?.id) {
        summaryLines.push(`Mostrando mensajes de ${data.session.customerName || 'cliente'}.`);
        addNavigate('Abrir conversación', '/inbox', { sessionId: data.session.id }, true);
      }
    }

    const productResult = resultMap.get('search_products');
    if (productResult?.success && Array.isArray(productResult.data)) {
      const products = productResult.data as Array<any>;
      if (products.length === 0) {
        summaryLines.push(
          wantsProductStock
            ? 'No encontré productos con esa medida. Decime el nombre del producto (ej: Coca 2.25).'
            : 'No encontré productos con ese criterio.'
        );
      } else if (wantsProductStock && products.length === 1) {
        const product = products[0];
        const displayName = this.buildProductDisplayName(product);
        summaryLines.push(`Stock de ${displayName}: ${product.stock ?? 0} unidades.`);
        if (product.id) {
          addNavigate(`Abrir ${product.name}`, '/stock', { productId: product.id }, false);
        } else {
          addNavigate('Ver stock', '/stock', undefined, false);
        }
      } else {
        summaryLines.push(`Encontré ${products.length} producto(s).`);
        addNavigate('Ver stock', '/stock', undefined, false);
        if (wantsProductStock && products.length > 1) {
          summaryLines.push('Decime cuál querés revisar.');
        }
      }
    }

    const listProductsResult = resultMap.get('list_products');
    if (listProductsResult?.success && Array.isArray(listProductsResult.data)) {
      const products = listProductsResult.data as Array<any>;
      summaryLines.push(`Encontré ${products.length} producto(s).`);
      addNavigate('Ver stock', '/stock', undefined, false);
      if (products[0]?.id) {
        addNavigate(`Abrir ${products[0].name}`, '/stock', { productId: products[0].id });
      }
    }

    const productDetailResult = resultMap.get('get_product_details');
    if (productDetailResult?.success && productDetailResult.data && typeof productDetailResult.data === 'object') {
      const product = productDetailResult.data as any;
      const displayName = this.buildProductDisplayName(product);
      summaryLines.push(`Stock de ${displayName}: ${product.stock ?? 0} unidades.`);
      if (product.id) {
        addNavigate(`Abrir ${product.name}`, '/stock', { productId: product.id }, false);
      }
    }

    const categoriesResult = resultMap.get('list_categories');
    if (categoriesResult?.success && Array.isArray(categoriesResult.data)) {
      const categories = categoriesResult.data as Array<any>;
      summaryLines.push(`Encontré ${categories.length} categoría(s).`);
      addNavigate('Ver stock', '/stock', undefined, false);
    }

    const updateCustomerResult = resultMap.get('update_customer');
    if (updateCustomerResult?.success && updateCustomerResult.data && typeof updateCustomerResult.data === 'object') {
      const customer = updateCustomerResult.data as any;
      summaryLines.push(`Actualicé los datos de ${this.formatCustomerName(customer)}.`);
      if (customer.id) {
        addNavigate('Ver cliente', '/customers', { customerId: customer.id }, true);
      }
    }

    const updateStatusResult = resultMap.get('update_order_status');
    if (updateStatusResult?.success && updateStatusResult.data && typeof updateStatusResult.data === 'object') {
      const order = updateStatusResult.data as any;
      summaryLines.push(`Actualicé ${order.orderNumber} a estado ${order.status}.`);
      if (order.id) {
        addNavigate('Ver pedido', '/orders', { orderId: order.id }, true);
      }
    }

    const cancelResult = resultMap.get('cancel_order');
    if (cancelResult?.success && cancelResult.data && typeof cancelResult.data === 'object') {
      const order = cancelResult.data as any;
      summaryLines.push(`Cancelé el pedido ${order.orderNumber}.`);
      if (order.id) {
        addNavigate('Ver pedido', '/orders', { orderId: order.id });
      }
    }

    const noteResult = resultMap.get('add_order_note');
    if (noteResult?.success && noteResult.data && typeof noteResult.data === 'object') {
      const order = noteResult.data as any;
      summaryLines.push(`Agregué la nota al pedido ${order.orderNumber}.`);
      if (order.id) {
        addNavigate('Ver pedido', '/orders', { orderId: order.id }, true);
      }
    }

    const sendMessageResult = resultMap.get('send_conversation_message');
    if (sendMessageResult?.success && sendMessageResult.data && typeof sendMessageResult.data === 'object') {
      const data = sendMessageResult.data as any;
      summaryLines.push(`Mensaje enviado a ${data.session?.customerName || 'cliente'}.`);
      if (data.session?.id) {
        addNavigate('Abrir conversación', '/inbox', { sessionId: data.session.id }, true);
      }
    }

    const agentActiveResult = resultMap.get('set_agent_active');
    if (agentActiveResult?.success && agentActiveResult.data && typeof agentActiveResult.data === 'object') {
      const data = agentActiveResult.data as any;
      summaryLines.push(`Agente ${data.agentActive ? 'activado' : 'pausado'} en la conversación.`);
      if (data.sessionId) {
        addNavigate('Abrir conversación', '/inbox', { sessionId: data.sessionId });
      }
    }

    const notificationsResult = resultMap.get('list_notifications');
    if (notificationsResult?.success && Array.isArray(notificationsResult.data)) {
      const notifications = notificationsResult.data as Array<any>;
      summaryLines.push(`Notificaciones: ${notifications.length}.`);
    }

    const bulkStockResult = resultMap.get('bulk_set_stock');
    if (bulkStockResult?.success && bulkStockResult.data && typeof bulkStockResult.data === 'object') {
      const data = bulkStockResult.data as any;
      const target = data.target ?? 0;
      const updatedCount = data.updatedCount ?? 0;
      const totalProducts = data.totalProducts ?? updatedCount;
      const unchangedCount = data.unchangedCount ?? Math.max(0, totalProducts - updatedCount);
      const categoryLabel = data.categoryName ? ` de ${data.categoryName}` : '';
      if (data.mode === 'adjust') {
        summaryLines.push(`Ajusté el stock de ${updatedCount} productos${categoryLabel} (delta ${target}).`);
      } else {
        summaryLines.push(`Actualicé el stock de ${updatedCount} productos${categoryLabel} a ${target} unidades.`);
      }
      if (unchangedCount > 0) {
        summaryLines.push(`${unchangedCount} producto(s) ya estaban en el valor objetivo.`);
      }
      addNavigate('Ver stock', '/stock');
    }

    const adjustPricesResult = resultMap.get('adjust_prices_percent');
    if (adjustPricesResult?.success && adjustPricesResult.data && typeof adjustPricesResult.data === 'object') {
      const data = adjustPricesResult.data as any;
      const mode = data.mode === 'amount' ? 'amount' : 'percent';
      const percent = Number(data.percent || 0);
      const amount = Number(data.amount || 0);
      const updatedCount = Number(data.updatedCount || 0);
      const totalProducts = Number(data.totalProducts || updatedCount);
      const unchangedCount = Number(data.unchangedCount || Math.max(0, totalProducts - updatedCount));
      const categoryLabel = data.categoryName ? ` en ${data.categoryName}` : '';
      if (mode === 'amount') {
        const direction = amount >= 0 ? 'Aumenté' : 'Bajé';
        summaryLines.push(`${direction} precios $${this.formatMoney(Math.abs(amount) * 100)}${categoryLabel} en ${updatedCount} producto(s).`);
      } else {
        const direction = percent >= 0 ? 'Aumenté' : 'Bajé';
        summaryLines.push(`${direction} precios ${Math.abs(percent)}%${categoryLabel} en ${updatedCount} producto(s).`);
      }
      if (unchangedCount > 0) {
        summaryLines.push(`${unchangedCount} producto(s) no cambiaron por redondeo.`);
      }
      addNavigate('Ver stock', '/stock', undefined, true);
    }

    const notificationReadResult = resultMap.get('mark_notification_read');
    if (notificationReadResult?.success && notificationReadResult.data && typeof notificationReadResult.data === 'object') {
      summaryLines.push('Notificación marcada como leída.');
    }

    const notificationReadAllResult = resultMap.get('mark_all_notifications_read');
    if (notificationReadAllResult?.success && notificationReadAllResult.data && typeof notificationReadAllResult.data === 'object') {
      summaryLines.push('Notificaciones marcadas como leídas.');
    }

    const paymentResult = resultMap.get('apply_payment');
    if (paymentResult?.success && paymentResult.data && typeof paymentResult.data === 'object') {
      const data = paymentResult.data as any;
      summaryLines.push(`Pago de $${this.formatMoney(data.amount || 0)} aplicado a ${this.formatCustomerName(data.customer || {})}.`);
      if (data.customer?.id) {
        addNavigate('Ver cliente', '/customers', { customerId: data.customer.id }, true);
      }
      if (data.order?.id) {
        addNavigate('Ver pedido', '/orders', { orderId: data.order.id });
      }
    }

    const stockResult = resultMap.get('adjust_stock');
    if (stockResult?.success && stockResult.data && typeof stockResult.data === 'object') {
      const data = stockResult.data as any;
      const available = typeof data.newAvailable === 'number' ? data.newAvailable : data.newQuantity;
      const availableLabel = typeof available === 'number' ? String(available) : '';
      const reservedLabel = typeof data.reserved === 'number' && data.reserved > 0 ? ` (Reservado: ${data.reserved})` : '';
      summaryLines.push(`Ajusté el stock. Stock disponible: ${availableLabel}${reservedLabel}.`);
      addNavigate('Ver stock', '/stock', undefined, true);
    }

    const createProductResult = resultMap.get('create_product');
    if (createProductResult?.success && createProductResult.data && typeof createProductResult.data === 'object') {
      const product = createProductResult.data as any;
      summaryLines.push(`Producto creado: ${product.name}.`);
      if (product.id) {
        addNavigate('Ver producto', '/stock', { productId: product.id }, true);
      }
    }

    const updateProductResult = resultMap.get('update_product');
    if (updateProductResult?.success && updateProductResult.data && typeof updateProductResult.data === 'object') {
      const product = updateProductResult.data as any;
      summaryLines.push(`Producto actualizado: ${product.name}.`);
      if (product.id) {
        addNavigate('Ver producto', '/stock', { productId: product.id }, true);
      }
    }

    const deleteProductResult = resultMap.get('delete_product');
    if (deleteProductResult?.success && deleteProductResult.data && typeof deleteProductResult.data === 'object') {
      const product = deleteProductResult.data as any;
      summaryLines.push(`Producto eliminado: ${product.name || 'producto'}.`);
    }

    const assignCategoryResult = resultMap.get('assign_category_to_products');
    if (assignCategoryResult?.success && assignCategoryResult.data && typeof assignCategoryResult.data === 'object') {
      const data = assignCategoryResult.data as any;
      const categoryName = data.category?.name || 'la categoría';
      const matchedCount = data.matchedCount ?? 0;
      if (data.category?.created) {
        summaryLines.push(`Categoría creada: ${categoryName}.`);
      }
      summaryLines.push(`Asigné ${categoryName} a ${matchedCount} producto(s).`);
      addNavigate('Ver stock', '/stock');
    }

    const createCategoryResult = resultMap.get('create_category');
    if (createCategoryResult?.success && createCategoryResult.data && typeof createCategoryResult.data === 'object') {
      const category = createCategoryResult.data as any;
      summaryLines.push(`Categoría creada: ${category.name}.`);
      addNavigate('Ver stock', '/stock', undefined, true);
    }

    const updateCategoryResult = resultMap.get('update_category');
    if (updateCategoryResult?.success && updateCategoryResult.data && typeof updateCategoryResult.data === 'object') {
      const category = updateCategoryResult.data as any;
      summaryLines.push(`Categoría actualizada: ${category.name}.`);
      addNavigate('Ver stock', '/stock', undefined, true);
    }

    const deleteCategoryResult = resultMap.get('delete_category');
    if (deleteCategoryResult?.success && deleteCategoryResult.data && typeof deleteCategoryResult.data === 'object') {
      const category = deleteCategoryResult.data as any;
      summaryLines.push(`Categoría eliminada: ${category.name || 'categoría'}.`);
    }

    const catalogResult = resultMap.get('generate_catalog_pdf');
    if (catalogResult?.success && catalogResult.data && typeof catalogResult.data === 'object') {
      const data = catalogResult.data as any;
      summaryLines.push(`Catálogo generado (${data.productCount || 0} productos).`);
      if (data.url) {
        addOpenUrl('Descargar catálogo', data.url);
      }
    }

    const salesSummaryResult = resultMap.get('get_sales_summary');
    const metricsResult = salesSummaryResult?.success
      ? salesSummaryResult
      : resultMap.get('get_business_metrics');

    if (metricsResult?.success && metricsResult.data && typeof metricsResult.data === 'object') {
      const data = metricsResult.data as any;
      const rangeLabel = data.range?.label ? ` (${data.range.label})` : '';
      const shouldShowSummary = wantsSalesSummary || wantsMetrics || (!wantsTopCustomer && !wantsTopProduct);
      if (data.summary && shouldShowSummary) {
        summaryLines.push(
          `Ventas${rangeLabel}: $${this.formatMoney(data.summary.totalRevenue || 0)} · Pedidos: ${data.summary.totalOrders || 0} · Ticket promedio: $${this.formatMoney(data.summary.avgOrderValue || 0)}`
        );
      }
      if (wantsMetrics) {
        addNavigate('Ver métricas', '/metrics', undefined, true);
      }

      if (wantsTopCustomer && Array.isArray(data.topCustomers) && data.topCustomers.length > 0) {
        const top = data.topCustomers[0];
        summaryLines.push(`Cliente top${rangeLabel}: ${top.name}.`);
        addNavigate(`Abrir ${top.name}`, '/customers', { customerId: top.id }, true);
      } else if (wantsTopCustomer) {
        summaryLines.push(`No hay datos suficientes para identificar el cliente con más compras${rangeLabel}.`);
      }


      if (wantsTopProduct && Array.isArray(data.topProducts) && data.topProducts.length > 0) {
        const top = data.topProducts[0];
        summaryLines.push(`Producto top${rangeLabel}: ${top.name}.`);
        if (top.id) {
          addNavigate(`Abrir ${top.name}`, '/stock', { productId: top.id }, true);
        } else {
          addNavigate('Ver stock', '/stock', undefined, true);
        }
      } else if (wantsTopProduct) {
        summaryLines.push(`No hay datos suficientes para identificar el producto más vendido${rangeLabel}.`);
      }
    }

    const lowStockResult = resultMap.get('get_low_stock_products');
    if (lowStockResult?.success && lowStockResult.data && typeof lowStockResult.data === 'object') {
      const data = lowStockResult.data as any;
      const products = Array.isArray(data.products) ? data.products as Array<any> : [];
      const totalLowStock = typeof data.totalLowStock === 'number' ? data.totalLowStock : products.length;

      if (totalLowStock === 0) {
        summaryLines.push('No hay productos con stock bajo.');
      } else {
        summaryLines.push(`Stock bajo en ${totalLowStock} producto(s).`);
        const sample = products.slice(0, 5);
        if (sample.length > 0) {
          const preview = sample
            .map((item) => `${item.displayName || item.name} (${item.available ?? 0} uds)`)
            .join(', ');
          summaryLines.push(`Ejemplos: ${preview}.`);
        }
        addNavigate('Ver stock', '/stock', undefined, false);
        if (products[0]?.id) {
          addNavigate(`Abrir ${products[0].displayName || products[0].name}`, '/stock', { productId: products[0].id });
        }
      }
    }

    const insightsResult = resultMap.get('get_business_insights');
    if (insightsResult?.success && insightsResult.data) {
      summaryLines.push('Consejos generados.');
    }

    const errors = results.filter((r) => {
      if (r.success || !r.error) return false;
      if (r.data && typeof r.data === 'object' && (r.data as any).kind === 'ambiguous_product') {
        return false;
      }
      return true;
    });
    if (errors.length > 0) {
      errors.forEach((err) => summaryLines.push(`⚠️ ${err.toolName}: ${err.error}`));
    }

    const summary = summaryLines.length > 0 ? summaryLines.join('\n') : undefined;

    return {
      summary,
      uiActions: actions.length > 0 ? actions : undefined,
    };
  }

  /**
   * Log action to database
   */
  private async logAction(
    actionId: string,
    request: QuickActionRequest,
    status: string,
    toolsCalled: string[] = [],
    errorMessage?: string,
    results?: ToolExecutionResult[]
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        id: actionId,
        workspaceId: request.workspaceId,
        actorType: 'user',
        actorId: request.userId,
        action: 'quick_action',
        resourceType: 'quick_action',
        resourceId: actionId,
        status: status === 'success' ? 'success' : 'failure',
        inputData: {
          command: request.command,
          toolsCalled,
        },
        outputData: results ? {
          results: results.map(r => ({
            tool: r.toolName,
            success: r.success,
            error: r.error,
            durationMs: r.durationMs,
          })),
        } : undefined,
        metadata: {
          quickActionStatus: status,
          error: errorMessage,
        },
      },
    });
  }

  /**
   * Get action history
   */
  async getHistory(workspaceId: string, limit = 50): Promise<QuickActionHistoryItem[]> {
    const logs = await this.prisma.auditLog.findMany({
      where: {
        workspaceId,
        action: 'quick_action',
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        actor: { select: { firstName: true, lastName: true, email: true } },
      },
    });

    return logs.map(log => {
      const inputData = log.inputData as Record<string, unknown> | null;
      const outputData = log.outputData as Record<string, unknown> | null;
      const metadata = log.metadata as Record<string, unknown>;
      const results = outputData?.results as Array<{ tool: string; success: boolean }> | undefined;

      return {
        id: log.id,
        command: String(inputData?.command || ''),
        status: String(metadata?.quickActionStatus || log.status) as QuickActionHistoryItem['status'],
        toolsCalled: (inputData?.toolsCalled as string[]) || [],
        resultSummary: results
          ? results.map(r => `${r.tool}: ${r.success ? '✓' : '✗'}`).join(', ')
          : metadata?.error ? String(metadata.error) : '',
        executedAt: log.createdAt,
        executedBy: log.actor?.email || log.actorId || 'unknown',
        canRerun: log.status === 'success',
        canRollback: false,
      };
    });
  }

  /**
   * Re-run a previous action
   */
  async rerun(
    actionId: string,
    userId: string,
    userRole: string,
    workspaceId: string
  ): Promise<QuickActionResult> {
    const log = await this.prisma.auditLog.findFirst({
      where: { id: actionId, workspaceId },
    });

    if (!log) {
      throw new Error('Acción no encontrada');
    }

    const inputData = log.inputData as Record<string, unknown> | null;

    return this.execute({
      command: String(inputData?.command || ''),
      workspaceId: log.workspaceId,
      userId,
    }, userRole);
  }
}
