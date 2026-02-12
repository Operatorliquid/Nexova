/**
 * Retail Agent Core
 * Main orchestrator for the AI retail assistant
 */
import { PrismaClient, Prisma } from '@prisma/client';
import type { Redis } from 'ioredis';
import Anthropic from '@anthropic-ai/sdk';
import { LedgerService } from '@nexova/core';
import { MercadoPagoIntegrationService, type MercadoPagoConfig } from '@nexova/integrations';
import type { Queue } from 'bullmq';
import {
  getCommercePlanCapabilities,
  resolveCommercePlan,
  type MessageSendPayload,
} from '@nexova/shared';

import {
  InteractiveButtonsPayload,
  InteractiveListPayload,
  ProcessMessageInput,
  ProcessMessageOutput,
  ToolContext,
  ToolExecution,
  AgentState,
  ToolCategory,
  MessageThread,
  Cart,
  SessionMemory,
  PendingConfirmation,
  AuditEntry,
} from '../types/index.js';
import { StateMachine } from './state-machine.js';
import { MemoryManager, createMemoryManager } from './memory-manager.js';
import { MemoryService } from './memory-service.js';
import { ToolRegistry, toolRegistry, initializeRetailTools } from '../tools/index.js';
import { classifyMessage } from './conversation-router.js';
import type { FileUploader } from '../tools/retail/catalog.tools.js';
import { buildRetailSystemPrompt } from '../prompts/retail-system.js';
import { buildRetailOwnerSystemPrompt } from '../prompts/retail-owner-system.js';
import { createAdminTools } from '../tools/retail/admin.tools.js';
import { buildProductDisplayName } from '../tools/retail/product-utils.js';
import { createNotificationIfEnabled } from '../utils/notifications.js';
import { withVisibleOrders } from '../utils/orders.js';

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

export interface AgentConfig {
  anthropicApiKey: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  maxToolIterations?: number;
}

export interface AgentDependencies {
  catalogDeps?: {
    messageQueue: Queue<MessageSendPayload>;
    fileUploader: FileUploader;
  };
}

const DEFAULT_CONFIG: Partial<AgentConfig> = {
  model: 'claude-sonnet-4-20250514',
  maxTokens: 4096,
  temperature: 0.7,
  maxToolIterations: 10,
};

// Always send order summary as PDF when there is at least one item.
const LONG_ORDER_SUMMARY_THRESHOLD = 0;
const LLM_TIMEOUT_MS = Number.parseInt(process.env.LLM_TIMEOUT_MS || '300000', 10);
const QUICK_PARSE_ENABLED = (process.env.AGENT_QUICK_PARSE_ENABLED || '').toLowerCase() === 'true';
const HISTORY_LIMIT = Number.parseInt(process.env.LLM_HISTORY_LIMIT || '20', 10);
const CART_STALE_MINUTES = Number.parseInt(process.env.CART_STALE_MINUTES || '60', 10);
const HANDOFF_KEYWORDS = [
  'hablar con',
  'quiero hablar',
  'necesito hablar',
  'humano',
  'persona',
  'operador',
  'representante',
  'asesor',
  'dueño',
  'encargado',
  'gerente',
  'supervisor',
];
const NEGATIVE_SENTIMENT_KEYWORDS = [
  'no entiendo',
  'no me sirve',
  'esto no funciona',
  'problema',
  'error',
  'mal',
  'molesto',
  'enojado',
  'frustrado',
  'cansado',
];
const NEGATIVE_SENTIMENT_THRESHOLD = Number.parseInt(
  process.env.AGENT_NEGATIVE_SENTIMENT_THRESHOLD || '2',
  10
);
const NEGATIVE_SENTIMENT_HANDOFF_ENABLED =
  (process.env.AGENT_NEGATIVE_SENTIMENT_HANDOFF || 'true').toLowerCase() === 'true';

if ((process.env.AGENT_AVAILABILITY_DEBUG || '') === '1') {
  console.log('[Agent] Loaded RetailAgent module from', import.meta.url);
}

const getMercadoPagoConfig = (): MercadoPagoConfig => ({
  clientId: process.env.MP_CLIENT_ID || '',
  clientSecret: process.env.MP_CLIENT_SECRET || '',
  redirectUri: process.env.MP_REDIRECT_URI || 'http://localhost:3000/api/v1/integrations/mercadopago/callback',
  sandbox: process.env.MP_SANDBOX === 'true',
});

type OrderIntentAction = 'add' | 'remove' | 'other';
interface OrderIntentResult {
  action: OrderIntentAction;
  cleanText: string;
  confidence?: number;
}

type AgentMode = 'order' | 'info' | 'payments';

const CATALOG_TOOL_NAMES = new Set([
  'send_catalog_pdf',
  'generate_catalog_pdf',
  'send_pdf_whatsapp',
]);

const INFO_TOOL_ALLOWLIST = new Set([
  'get_commerce_profile',
  'search_products',
  'get_product_details',
  'get_categories',
  'list_categories',
  'get_full_stock',
  'get_customer_info',
  'get_customer_notes',
  'get_customer_debt',
  'get_order_history',
  'get_order_details',
  'get_unpaid_orders',
  'get_payment_status',
  'send_catalog_pdf',
  'generate_catalog_pdf',
  'send_pdf_whatsapp',
]);

const PAYMENT_TOOL_ALLOWLIST = new Set([
  'create_payment_link',
  'create_mp_payment_link',
  'extract_receipt_amount',
  'process_payment_receipt',
  'process_receipt',
  'update_receipt_amount',
  'apply_receipt_to_order',
  'apply_payment_to_balance',
  'get_customer_balance',
  'get_unpaid_orders',
  'get_payment_status',
  'get_order_details',
  'get_order_history',
  'get_customer_debt',
  'get_customer_info',
  'get_customer_notes',
]);

const MEMORY_MUTATING_TOOLS = new Set([
  'add_to_cart',
  'update_cart_item',
  'remove_from_cart',
  'clear_cart',
  'set_cart_notes',
  'confirm_order',
]);

const PAYMENT_INTENT_KEYWORDS = [
  'pagar',
  'pago',
  'transferencia',
  'comprobante',
  'recibo',
  'mercadopago',
  'mp',
  'alias',
  'cbu',
  'link de pago',
];

const DEFAULT_SUBAGENTS_ENABLED = (process.env.AGENT_SUBAGENTS_ENABLED || 'true').toLowerCase() === 'true';

// ═══════════════════════════════════════════════════════════════════════════════
// AGENT CLASS
// ═══════════════════════════════════════════════════════════════════════════════

export class RetailAgent {
  private prisma: PrismaClient;
  private anthropic: Anthropic;
  private memoryManager: MemoryManager;
  private memoryService: MemoryService;
  private config: Required<AgentConfig>;
  private deps: AgentDependencies;
  private ownerToolRegistry: ToolRegistry | null = null;
  private initialized = false;

  constructor(
    prisma: PrismaClient,
    redis: Redis,
    config: AgentConfig,
    deps: AgentDependencies = {}
  ) {
    this.prisma = prisma;
    this.config = { ...DEFAULT_CONFIG, ...config } as Required<AgentConfig>;
    this.deps = deps;

    this.anthropic = new Anthropic({
      apiKey: config.anthropicApiKey,
    });

    this.memoryManager = createMemoryManager(redis);
    this.memoryService = new MemoryService(this.prisma, this.anthropic);
  }

  /**
   * Initialize tools and registry
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const ledgerService = new LedgerService(this.prisma);
    const mpConfig = getMercadoPagoConfig();
    const mpService = mpConfig.clientId && mpConfig.clientSecret
      ? new MercadoPagoIntegrationService(this.prisma, mpConfig)
      : undefined;

    initializeRetailTools(this.prisma, this.memoryManager, toolRegistry, {
      ledgerService,
      mpService,
      ...(this.deps.catalogDeps ? { catalogDeps: this.deps.catalogDeps } : {}),
    });

    // Owner registry: standard tools + restricted admin tools (must only be used in owner-mode).
    const ownerRegistry = new ToolRegistry();
    initializeRetailTools(this.prisma, this.memoryManager, ownerRegistry, {
      ledgerService,
      mpService,
      ...(this.deps.catalogDeps ? { catalogDeps: this.deps.catalogDeps } : {}),
    });
    ownerRegistry.registerAll(
      createAdminTools(this.prisma, {
        messageQueue: this.deps.catalogDeps?.messageQueue,
      })
    );
    this.ownerToolRegistry = ownerRegistry;

    this.initialized = true;

    console.log('[RetailAgent] Initialized');
  }

  private async enrichConfirmationInput(
    toolName: string,
    input: Record<string, unknown>,
    workspaceId: string
  ): Promise<Record<string, unknown>> {
    if (toolName !== 'adjust_stock') return input;

    const productId = typeof input.productId === 'string' ? input.productId.trim() : '';
    const sku = typeof input.sku === 'string' ? input.sku.trim() : '';
    const productName = typeof input.productName === 'string' ? input.productName.trim() : '';

    // If we already have a meaningful product label, don't overwrite it.
    if (productName && productName !== productId && productName !== sku) {
      return input;
    }

    if (!productId && !sku) return input;

    try {
      const product = await this.prisma.product.findFirst({
        where: {
          workspaceId,
          deletedAt: null,
          ...(productId ? { id: productId } : { sku }),
        },
        select: {
          name: true,
          unit: true,
          unitValue: true,
          secondaryUnit: true,
          secondaryUnitValue: true,
        },
      });

      if (!product) return input;

      return {
        ...input,
        productName: buildProductDisplayName(product),
      };
    } catch {
      return input;
    }
  }

  private buildOwnerFocusMemory(memory: SessionMemory): string {
    const focus = memory.context.ownerFocus;
    if (!focus) return '';

    const lines: string[] = [];
    const customerLabelParts: string[] = [];

    if (focus.customerName) customerLabelParts.push(String(focus.customerName));
    if (focus.customerPhone) customerLabelParts.push(String(focus.customerPhone));
    if (!focus.customerName && !focus.customerPhone && focus.customerId) {
      customerLabelParts.push(String(focus.customerId));
    }

    if (customerLabelParts.length > 0) {
      lines.push(`Cliente en foco: ${customerLabelParts.join(' · ')}`);
    }
    if (focus.orderNumber || focus.orderId) {
      lines.push(`Pedido en foco: ${focus.orderNumber || focus.orderId}`);
    }

    if (lines.length === 0) return '';

    return [
      'Contexto en foco (si el owner dice "su", "ese cliente" o "ese pedido" y no especifica otro):',
      `- ${lines.join('\n- ')}`,
    ].join('\n');
  }

  private enrichOwnerToolInputFromFocus(
    toolName: string,
    input: Record<string, unknown>,
    memory: SessionMemory
  ): Record<string, unknown> {
    const focus = memory.context.ownerFocus;
    if (!focus) return input;

    const hasAny = (keys: string[]) =>
      keys.some((k) => typeof input[k] === 'string' && String(input[k]).trim().length > 0);

    if (toolName === 'admin_send_debt_reminder') {
      if (hasAny(['customerId', 'phone', 'orderNumber'])) return input;
      if (focus.customerId) return { ...input, customerId: focus.customerId };
      if (focus.customerPhone) return { ...input, phone: focus.customerPhone };
      if (focus.orderNumber) return { ...input, orderNumber: focus.orderNumber };
      return input;
    }

    if (toolName === 'admin_send_customer_message') {
      if (hasAny(['customerId', 'phone', 'orderNumber'])) return input;
      if (focus.customerId) return { ...input, customerId: focus.customerId };
      if (focus.customerPhone) return { ...input, phone: focus.customerPhone };
      if (focus.orderNumber) return { ...input, orderNumber: focus.orderNumber };
      return input;
    }

    if (toolName === 'admin_get_order_details') {
      if (hasAny(['orderNumber'])) return input;
      if (focus.orderNumber) return { ...input, orderNumber: focus.orderNumber };
      return input;
    }

    if (toolName === 'admin_update_order_status' || toolName === 'admin_cancel_order') {
      if (hasAny(['orderId', 'orderNumber'])) return input;
      if (focus.orderId) return { ...input, orderId: focus.orderId };
      if (focus.orderNumber) return { ...input, orderNumber: focus.orderNumber };
      return input;
    }

    if (toolName === 'admin_create_order') {
      if (hasAny(['customerId', 'customerPhone'])) return input;
      if (focus.customerId) return { ...input, customerId: focus.customerId };
      if (focus.customerPhone) return { ...input, customerPhone: focus.customerPhone };
      return input;
    }

    return input;
  }

  private async maybeUpdateOwnerFocusFromToolExecution(params: {
    toolName: string;
    toolInput: Record<string, unknown>;
    toolResult: { success?: boolean; data?: unknown };
    memory: SessionMemory;
  }): Promise<void> {
    const { toolName, toolInput, toolResult, memory } = params;
    if (!toolResult?.success) return;

    const data = (toolResult as { data?: any }).data;
    const patch: NonNullable<SessionMemory['context']['ownerFocus']> = {};

    const buildCustomerName = (customer: any): string | undefined => {
      if (!customer || typeof customer !== 'object') return undefined;
      const firstName = typeof customer.firstName === 'string' ? customer.firstName.trim() : '';
      const lastName = typeof customer.lastName === 'string' ? customer.lastName.trim() : '';
      const businessName = typeof customer.businessName === 'string' ? customer.businessName.trim() : '';
      const full = [firstName, lastName].filter(Boolean).join(' ').trim();
      return full || businessName || undefined;
    };

    if (toolName === 'admin_get_or_create_customer') {
      if (typeof data?.customerId === 'string') patch.customerId = data.customerId;
      if (typeof data?.phone === 'string') patch.customerPhone = data.phone;
      const name = buildCustomerName(data);
      if (name) patch.customerName = name;
    }

    if (toolName === 'admin_list_orders') {
      const orders = Array.isArray(data?.orders) ? data.orders : [];
      if (orders.length > 0) {
        const customerIds = new Set<string>();
        for (const o of orders) {
          if (o?.customer?.id) customerIds.add(String(o.customer.id));
        }

        // Only set focus automatically if the result is unambiguous (single customer).
        if (customerIds.size === 1) {
          const first = orders[0];
          if (first?.id) patch.orderId = String(first.id);
          if (first?.orderNumber) patch.orderNumber = String(first.orderNumber);
          if (first?.customer?.id) patch.customerId = String(first.customer.id);
          if (first?.customer?.phone) patch.customerPhone = String(first.customer.phone);
          const name = buildCustomerName(first.customer);
          if (name) patch.customerName = name;
        }
      }
    }

    if (toolName === 'admin_get_order_details') {
      if (typeof data?.id === 'string') patch.orderId = data.id;
      if (typeof data?.orderNumber === 'string') patch.orderNumber = data.orderNumber;
      if (data?.customer) {
        if (typeof data.customer.id === 'string') patch.customerId = data.customer.id;
        if (typeof data.customer.phone === 'string') patch.customerPhone = data.customer.phone;
        const name = buildCustomerName(data.customer);
        if (name) patch.customerName = name;
      }
    }

    if (toolName === 'admin_update_order_status' || toolName === 'admin_cancel_order') {
      if (typeof data?.orderId === 'string') patch.orderId = data.orderId;
      if (typeof data?.orderNumber === 'string') patch.orderNumber = data.orderNumber;
    }

    if (toolName === 'admin_create_order') {
      if (typeof data?.orderId === 'string') patch.orderId = data.orderId;
      if (typeof data?.orderNumber === 'string') patch.orderNumber = data.orderNumber;
      if (typeof data?.customerId === 'string') patch.customerId = data.customerId;
    }

    if (toolName === 'admin_send_debt_reminder') {
      if (typeof data?.customerId === 'string') patch.customerId = data.customerId;
      if (typeof data?.phone === 'string') patch.customerPhone = data.phone;
    }

    if (toolName === 'admin_send_customer_message') {
      // Tool doesn't return customerId; use the input as a fallback to keep focus consistent.
      const inputCustomerId = typeof toolInput.customerId === 'string' ? toolInput.customerId : '';
      const inputPhone = typeof toolInput.phone === 'string' ? toolInput.phone : '';
      const inputOrderNumber = typeof toolInput.orderNumber === 'string' ? toolInput.orderNumber : '';
      if (inputCustomerId) patch.customerId = inputCustomerId;
      if (inputPhone) patch.customerPhone = inputPhone;
      if (inputOrderNumber) patch.orderNumber = inputOrderNumber;
    }

    const hasPatch = Object.values(patch).some((v) => typeof v === 'string' && v.trim().length > 0);
    if (!hasPatch) return;

    memory.context.ownerFocus = {
      ...(memory.context.ownerFocus || {}),
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    await this.memoryManager.saveSession(memory);
  }

  private async processOwnerMessage(input: ProcessMessageInput): Promise<ProcessMessageOutput> {
    const { workspaceId, sessionId, customerId, channelId, channelType, message, messageId, correlationId } = input;
    const normalizedChannelType = channelType || 'whatsapp';

    await this.initialize();

    const toolsUsed: ToolExecution[] = [];
    let totalTokens = 0;

    await this.audit({
      correlationId,
      sessionId,
      workspaceId,
      timestamp: new Date(),
      phase: 'input',
      data: { messageId, message, channelId, channelType: normalizedChannelType, mode: 'owner' },
    });

    try {
      // Ensure a memory session exists, but keep owner-mode stateless (IDLE).
      const memory =
        (await this.memoryManager.getSession(sessionId)) ??
        (await this.memoryManager.initSession(sessionId, workspaceId, customerId));
      if (memory.state !== AgentState.IDLE) {
        memory.state = AgentState.IDLE;
        await this.memoryManager.updateState(sessionId, AgentState.IDLE);
        await this.memoryManager.saveSession(memory);
      }

      const registry = this.ownerToolRegistry ?? toolRegistry;

      const toolContext: ToolContext = {
        workspaceId,
        sessionId,
        customerId,
        correlationId,
        currentState: AgentState.IDLE,
        channelType: normalizedChannelType,
        isOwner: true,
      };

      // Handle pending confirmation before any other owner flow.
      const pendingConfirmation = await this.memoryManager.getPendingConfirmation(sessionId);
      if (pendingConfirmation) {
        const decision = parseConfirmationResponse(message);

        await this.storeMessage(sessionId, 'user', message, messageId);

        if (decision === true) {
          await this.memoryManager.clearPendingConfirmation(sessionId);

          await this.audit({
            correlationId,
            sessionId,
            workspaceId,
            timestamp: new Date(),
            phase: 'tool_call',
            data: { tool: pendingConfirmation.toolName, input: pendingConfirmation.toolInput, mode: 'owner' },
          });

          const execution = await registry.execute(
            pendingConfirmation.toolName,
            pendingConfirmation.toolInput,
            toolContext
          );
          toolsUsed.push(execution);

          await this.audit({
            correlationId,
            sessionId,
            workspaceId,
            timestamp: new Date(),
            phase: 'result',
            data: {
              tool: pendingConfirmation.toolName,
              success: execution.result.success,
              error: execution.result.error,
              mode: 'owner',
            },
          });

          const response = buildConfirmationResultMessage(execution, pendingConfirmation);
          await this.storeMessage(sessionId, 'assistant', response);
          await this.prisma.agentSession.updateMany({
            where: { id: sessionId, workspaceId },
            data: { currentState: AgentState.IDLE, lastActivityAt: new Date(), agentActive: true },
          });

          return {
            response,
            state: AgentState.IDLE,
            toolsUsed,
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }

        if (decision === false) {
          await this.memoryManager.clearPendingConfirmation(sessionId);
          const response = 'Perfecto, no hago cambios. ¿Querés que haga algo más?';
          await this.storeMessage(sessionId, 'assistant', response);
          await this.prisma.agentSession.updateMany({
            where: { id: sessionId, workspaceId },
            data: { currentState: AgentState.IDLE, lastActivityAt: new Date(), agentActive: true },
          });
          return {
            response,
            state: AgentState.IDLE,
            toolsUsed: [],
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }

        const response = pendingConfirmation.message;
        await this.storeMessage(sessionId, 'assistant', response);
        await this.prisma.agentSession.updateMany({
          where: { id: sessionId, workspaceId },
          data: { currentState: AgentState.IDLE, lastActivityAt: new Date(), agentActive: true },
        });
        return {
          response,
          state: AgentState.IDLE,
          toolsUsed: [],
          tokensUsed: 0,
          shouldSendMessage: true,
        };
      }

      const contextStartAt = await this.getSessionContextStartAt(sessionId, workspaceId);
      const history = await this.getConversationHistory(sessionId, contextStartAt);
      const recentHistory = HISTORY_LIMIT > 0 ? history.slice(-HISTORY_LIMIT) : history;

      const workspace = await this.prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { name: true, settings: true },
      });
      const settings = (workspace?.settings as Record<string, unknown>) || {};
      const commerceName = (settings.businessName as string) || workspace?.name || 'Tu Comercio';

      const memoryContext = await this.memoryService.buildContext(sessionId, workspaceId, contextStartAt);
      const focusMemory = this.buildOwnerFocusMemory(memory);
      const combinedMemoryContext = [focusMemory, memoryContext].filter((part) => part && part.trim()).join('\n\n');
      const systemPrompt = buildRetailOwnerSystemPrompt({ commerceName, memoryContext: combinedMemoryContext });

      const claudeMessages: Anthropic.MessageParam[] = recentHistory.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

      claudeMessages.push({ role: 'user', content: message });
      await this.storeMessage(sessionId, 'user', message, messageId);

      const ownerSafeTools = new Set([
        // Product/stock queries
        'search_products',
        'get_product_details',
        'get_categories',
        'list_categories',
        'get_full_stock',
        // Stock mutations
        'adjust_stock',
      ]);
      const tools = registry
        .getToolDefinitions()
        .filter((t) => t.name.startsWith('admin_') || ownerSafeTools.has(t.name))
        .map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema as Anthropic.Tool.InputSchema,
        }));
      const allowedToolNames = new Set(tools.map((tool) => tool.name));

      let response = '';
      let iterations = 0;
      let pendingToolResults: Array<{ tool_use_id: string; content: string }> = [];
      let confirmationRequested = false;

      while (iterations < this.config.maxToolIterations) {
        iterations++;

        const requestMessages = [...claudeMessages];

        if (pendingToolResults.length > 0) {
          const toolResultMessage: Anthropic.MessageParam = {
            role: 'user',
            content: pendingToolResults.map((tr) => ({
              type: 'tool_result' as const,
              tool_use_id: tr.tool_use_id,
              content: tr.content,
            })),
          };
          requestMessages.push(toolResultMessage);
          claudeMessages.push(toolResultMessage);
          pendingToolResults = [];
        }

        const modelConfig = {
          model: this.config.model,
          maxTokens: this.config.maxTokens,
          temperature: this.config.temperature,
        };

        console.log(
          `[RetailAgent] Owner Claude request (iter ${iterations}, model ${modelConfig.model}, msgLen ${message.length}, history ${recentHistory.length}, tools ${tools.length})`
        );
        const llmStart = Date.now();
        const llmResponse = await this.callClaudeWithTimeout(() =>
          this.anthropic.messages.create(
            {
              model: modelConfig.model,
              max_tokens: modelConfig.maxTokens,
              temperature: modelConfig.temperature,
              system: systemPrompt,
              messages: requestMessages,
              tools,
            },
            { timeout: LLM_TIMEOUT_MS }
          )
        );
        const llmDuration = Date.now() - llmStart;
        console.log(`[RetailAgent] Owner Claude response in ${llmDuration}ms (iter ${iterations})`);

        totalTokens += llmResponse.usage.input_tokens + llmResponse.usage.output_tokens;

        let hasToolUse = false;

        for (const block of llmResponse.content) {
          if (block.type === 'text') {
            response = block.text;
          } else if (block.type === 'tool_use') {
            hasToolUse = true;
            if (!allowedToolNames.has(block.name)) {
              pendingToolResults.push({
                tool_use_id: block.id,
                content: JSON.stringify({
                  success: false,
                  error: 'Tool no permitido en owner-mode',
                }),
              });
              continue;
            }

            const toolInput = this.enrichOwnerToolInputFromFocus(
              block.name,
              block.input as Record<string, unknown>,
              memory
            );

            if (registry.requiresConfirmation(block.name)) {
              const enrichedInput = await this.enrichConfirmationInput(
                block.name,
                toolInput,
                workspaceId
              );
              const confirmation = buildConfirmationRequest(block.name, enrichedInput);
              await this.memoryManager.setPendingConfirmation(sessionId, confirmation);
              response = confirmation.message;
              confirmationRequested = true;
              break;
            }

            await this.audit({
              correlationId,
              sessionId,
              workspaceId,
              timestamp: new Date(),
              phase: 'tool_call',
              data: { tool: block.name, input: toolInput, mode: 'owner' },
            });

            const execution = await registry.execute(
              block.name,
              toolInput,
              toolContext
            );
            toolsUsed.push(execution);

            await this.audit({
              correlationId,
              sessionId,
              workspaceId,
              timestamp: new Date(),
              phase: 'result',
              data: {
                tool: block.name,
                success: execution.result.success,
                error: execution.result.error,
                mode: 'owner',
              },
            });

            await this.maybeUpdateOwnerFocusFromToolExecution({
              toolName: block.name,
              toolInput,
              toolResult: execution.result,
              memory,
            });

            pendingToolResults.push({
              tool_use_id: block.id,
              content: JSON.stringify(execution.result),
            });
          }
        }

        if (confirmationRequested) {
          break;
        }

        if (!hasToolUse || llmResponse.stop_reason === 'end_turn') {
          break;
        }

        claudeMessages.push({
          role: 'assistant',
          content: llmResponse.content,
        });
      }

      if (response) {
        await this.storeMessage(sessionId, 'assistant', response);
      }

      await this.prisma.agentSession.updateMany({
        where: { id: sessionId, workspaceId },
        data: { currentState: AgentState.IDLE, lastActivityAt: new Date(), agentActive: true },
      });

      return {
        response,
        state: AgentState.IDLE,
        toolsUsed,
        tokensUsed: totalTokens,
        shouldSendMessage: true,
      };
    } catch (error) {
      console.error('[RetailAgent] Owner processing failed:', error);
      const response = 'Tuve un problema procesando tu consulta. Probá de nuevo en unos segundos.';
      await this.storeMessage(sessionId, 'assistant', response);
      await this.prisma.agentSession.updateMany({
        where: { id: sessionId, workspaceId },
        data: { currentState: AgentState.IDLE, lastActivityAt: new Date(), agentActive: true },
      });
      return {
        response,
        state: AgentState.IDLE,
        toolsUsed,
        tokensUsed: totalTokens,
        shouldSendMessage: true,
      };
    }
  }

  /**
   * Process an incoming message
   */
  async processMessage(input: ProcessMessageInput): Promise<ProcessMessageOutput> {
    const { workspaceId, sessionId, customerId, channelId, channelType, message, messageId, correlationId, isOwner } = input;
    const normalizedChannelType = channelType || 'whatsapp';

    await this.initialize();

    if (isOwner) {
      return this.processOwnerMessage(input);
    }

    // Start timing
    const startTime = Date.now();
    const toolsUsed: ToolExecution[] = [];
    let totalTokens = 0;

    // Audit: Input
    await this.audit({
      correlationId,
      sessionId,
      workspaceId,
      timestamp: new Date(),
      phase: 'input',
      data: { messageId, message, channelId, channelType: normalizedChannelType },
    });

    try {
      // Get or initialize session memory
      let memory: SessionMemory =
        (await this.memoryManager.getSession(sessionId)) ??
        (await this.memoryManager.initSession(sessionId, workspaceId, customerId));

      if (memory.state === AgentState.HANDOFF) {
        const sessionRecord = await this.prisma.agentSession.findFirst({
          where: { id: sessionId, workspaceId },
          select: { agentActive: true },
        });
        if (sessionRecord?.agentActive) {
          memory.state = AgentState.IDLE;
          await this.memoryManager.updateState(sessionId, AgentState.IDLE);
        }
      }

      if (
        CART_STALE_MINUTES > 0 &&
        memory.cart &&
        memory.cart.items.length > 0 &&
        !memory.context.editingOrderId
      ) {
        const lastCartActivity =
          memory.cart.updatedAt || memory.cart.createdAt || memory.lastActivityAt;
        const staleMs = CART_STALE_MINUTES * 60 * 1000;
        if (Date.now() - lastCartActivity.getTime() > staleMs) {
          console.log(
            `[Agent] Clearing stale cart for session ${sessionId} (last activity ${lastCartActivity.toISOString()})`
          );
          memory.cart = null;
          memory.pendingConfirmation = null;
          memory.state = AgentState.IDLE;
          resetOrderFlowContext(memory);
          await this.memoryManager.saveSession(memory);
          await this.prisma.agentSession.updateMany({
            where: { id: sessionId, workspaceId },
            data: { currentState: AgentState.IDLE, lastActivityAt: new Date() },
          });
        }
      }

      const availabilityStatus = await this.resolveWorkspaceAvailability(workspaceId);
      if ((process.env.AGENT_AVAILABILITY_DEBUG || '') === '1') {
        console.log(`[Agent] Availability status for ${workspaceId}: ${availabilityStatus ?? 'null'}`);
      }
      if (availabilityStatus === 'unavailable' || availabilityStatus === 'vacation') {
        const response =
          availabilityStatus === 'unavailable'
            ? 'No estamos disponibles por el momento.'
            : 'Estamos de vacaciones, volveremos pronto.';

        await this.storeMessage(sessionId, 'user', message, messageId);
        await this.storeMessage(sessionId, 'assistant', response);

        memory.lastActivityAt = new Date();
        await this.memoryManager.saveSession(memory);
        await this.prisma.agentSession.updateMany({
          where: { id: sessionId, workspaceId },
          data: { lastActivityAt: new Date() },
        });

        return {
          response,
          state: memory.state,
          toolsUsed,
          tokensUsed: totalTokens,
          shouldSendMessage: true,
        };
      }

      // Initialize state machine with current state
      const fsm = new StateMachine(memory.state);

      // Build tool context
      const toolContext: ToolContext = {
        workspaceId,
        sessionId,
        customerId,
        correlationId,
        currentState: fsm.getState(),
        channelType: normalizedChannelType,
      };

      const normalizedMessage = message.toLowerCase().trim();
      const wantsHuman = HANDOFF_KEYWORDS.some((keyword) => normalizedMessage.includes(keyword));
      if (wantsHuman) {
        const execution = await toolRegistry.execute(
          'request_handoff',
          {
            reason: 'Solicitud directa del cliente',
            priority: 'normal',
            trigger: 'customer_request',
            context: message,
          },
          toolContext
        );
        toolsUsed.push(execution);

        const toolMessage =
          execution.result.data && typeof (execution.result.data as any).message === 'string'
            ? (execution.result.data as any).message
            : undefined;
        const response = toolMessage || 'Te voy a comunicar con un operador. En breve te atienden.';

        await this.storeMessage(sessionId, 'user', message, messageId);
        await this.storeMessage(sessionId, 'assistant', response);
        memory.lastActivityAt = new Date();
        await this.memoryManager.saveSession(memory);
        await this.prisma.agentSession.updateMany({
          where: { id: sessionId, workspaceId },
          data: { lastActivityAt: new Date() },
        });

        return {
          response,
          state: fsm.getState(),
          toolsUsed,
          tokensUsed: totalTokens,
          shouldSendMessage: true,
        };
      }

      if (NEGATIVE_SENTIMENT_HANDOFF_ENABLED && isNegativeSentiment(normalizedMessage)) {
        const execution = await toolRegistry.execute(
          'request_handoff',
          {
            reason: 'Cliente con frustración o malestar',
            priority: 'normal',
            trigger: 'negative_sentiment',
            context: message,
          },
          toolContext
        );
        toolsUsed.push(execution);

        const toolMessage =
          execution.result.data && typeof (execution.result.data as any).message === 'string'
            ? (execution.result.data as any).message
            : undefined;
        const response = toolMessage || 'Te voy a comunicar con un operador. En breve te atienden.';

        await this.storeMessage(sessionId, 'user', message, messageId);
        await this.storeMessage(sessionId, 'assistant', response);
        memory.lastActivityAt = new Date();
        await this.memoryManager.saveSession(memory);
        await this.prisma.agentSession.updateMany({
          where: { id: sessionId, workspaceId },
          data: { lastActivityAt: new Date() },
        });

        return {
          response,
          state: fsm.getState(),
          toolsUsed,
          tokensUsed: totalTokens,
          shouldSendMessage: true,
        };
      }

      let messageForParsing = message;
      let skipQuickParse = false;
      if (this.shouldClassifyOrderIntent(message, fsm, memory)) {
        const intent = await this.classifyOrderIntent(message);
        if (intent?.cleanText) {
          messageForParsing = intent.cleanText;
        }
        if (intent?.action === 'remove') {
          skipQuickParse = true;
        }
      }

      const respondWithPrimaryMenu = async (
        variant: 'primary' | 'primary_lite' = 'primary'
      ): Promise<ProcessMessageOutput> => {
        await this.storeMessage(sessionId, 'user', message, messageId);
        await this.memoryManager.clearPendingConfirmation(sessionId);
        await this.memoryManager.clearCart(sessionId);
        const refreshed = await this.memoryManager.getSession(sessionId);
        if (refreshed) {
          memory = refreshed;
        } else {
          memory.cart = null;
          memory.pendingConfirmation = null;
        }

        memory.context.pendingOrderDecision = undefined;
        memory.context.pendingOrderId = undefined;
        memory.context.pendingOrderNumber = undefined;
        memory.context.pendingCancelOrderId = undefined;
        memory.context.pendingCancelOrderNumber = undefined;
        memory.context.pendingStockAdjustment = undefined;
        memory.context.pendingCatalogOffer = undefined;
        memory.context.activeOrdersPrompt = undefined;
        memory.context.activeOrdersAction = undefined;
        memory.context.activeOrdersAwaiting = undefined;
        memory.context.activeOrdersPayable = undefined;
        memory.context.paymentStage = undefined;
        memory.context.paymentOrders = undefined;
        memory.context.paymentOrderId = undefined;
        memory.context.paymentOrderNumber = undefined;
        memory.context.paymentPendingAmount = undefined;
        memory.context.paymentReceiptId = undefined;
        memory.context.paymentReceiptAmount = undefined;
        memory.context.pendingProductSelection = undefined;
        memory.context.repeatOrders = undefined;
        memory.context.repeatOrderId = undefined;
        memory.context.repeatOrderNumber = undefined;
        memory.context.editingOrderId = undefined;
        memory.context.editingOrderNumber = undefined;
        memory.context.editingOrderOriginalItems = undefined;
        memory.context.orderViewAwaitingAck = undefined;
        memory.context.orderViewAwaitingNumber = undefined;
        memory.context.interruptedTopic = undefined;
        memory.context.otherInquiry = undefined;

        const [customerRecord, sessionRecord] = await Promise.all([
          this.prisma.customer.findFirst({
          where: { id: customerId, workspaceId },
          select: { firstName: true, lastName: true, metadata: true },
          }),
          this.prisma.agentSession.findFirst({
            where: { id: sessionId, workspaceId },
            select: { metadata: true },
          }),
        ]);
        const customerMetadata = (customerRecord?.metadata as Record<string, unknown>) || {};
        const sessionMetadata = (sessionRecord?.metadata as Record<string, unknown>) || {};
        const updatedMetadata = {
          ...sessionMetadata,
          contextStartAt: new Date().toISOString(),
        };
        const dni = typeof customerMetadata.dni === 'string' ? customerMetadata.dni : undefined;
        const needsRegistration = !customerRecord?.firstName || !customerRecord?.lastName || !dni;

        if (needsRegistration) {
          memory.context.pendingRegistration = undefined;
          await this.memoryManager.saveSession(memory);

          if (fsm.canTransition(AgentState.NEEDS_DETAILS)) {
            fsm.transition(AgentState.NEEDS_DETAILS);
            await this.memoryManager.updateState(sessionId, AgentState.NEEDS_DETAILS);
          }

          const response = buildNewCustomerMessage();
          await this.storeMessage(sessionId, 'assistant', response);
          await this.prisma.agentSession.updateMany({
            where: { id: sessionId, workspaceId },
            data: {
              currentState: AgentState.NEEDS_DETAILS,
              metadata: updatedMetadata,
              lastActivityAt: new Date(),
            },
          });

          return {
            response,
            state: AgentState.NEEDS_DETAILS,
            toolsUsed: [],
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }

        const menuContent = variant === 'primary_lite'
          ? buildPrimaryMenuLiteContent()
          : buildPrimaryMenuContent();
        memory.context.lastMenu = 'primary';
        await this.memoryManager.saveSession(memory);

        if (fsm.canTransition(AgentState.IDLE)) {
          fsm.transition(AgentState.IDLE);
          await this.memoryManager.updateState(sessionId, AgentState.IDLE);
        }

        await this.storeMessage(sessionId, 'assistant', menuContent.text);
        await this.prisma.agentSession.updateMany({
          where: { id: sessionId, workspaceId },
          data: {
            currentState: AgentState.IDLE,
            metadata: updatedMetadata,
            lastActivityAt: new Date(),
          },
        });

        return {
          response: menuContent.text,
          responseType: 'interactive-buttons',
          responsePayload: menuContent.interactive,
          state: AgentState.IDLE,
          toolsUsed: [],
          tokensUsed: 0,
          shouldSendMessage: true,
        };
      };

      const handlePendingOrderDecision = async (
        pendingOrder: { id: string; orderNumber?: string | null },
        decision: PendingOrderDecision | null
      ): Promise<ProcessMessageOutput> => {
        const orderNumber = pendingOrder.orderNumber || 'tu pedido';

        if (!decision) {
          await this.storeMessage(sessionId, 'user', message, messageId);
          await this.memoryManager.clearPendingConfirmation(sessionId);
          await this.memoryManager.clearCart(sessionId);
          memory.pendingConfirmation = null;
          memory.cart = null;

          memory.context.pendingOrderDecision = true;
          memory.context.pendingOrderId = pendingOrder.id;
          memory.context.pendingOrderNumber = pendingOrder.orderNumber || undefined;
          memory.context.pendingOrderOptions = undefined;
          await this.memoryManager.saveSession(memory);

          const menuContent = buildPendingOrderChoiceContent(orderNumber);
          await this.storeMessage(sessionId, 'assistant', menuContent.text);
          await this.prisma.agentSession.updateMany({
            where: { id: sessionId, workspaceId },
            data: { lastActivityAt: new Date(), agentActive: true },
          });

          return {
            response: menuContent.text,
            responseType: 'interactive-buttons',
            responsePayload: menuContent.interactive,
            state: fsm.getState(),
            toolsUsed: [],
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }

        if (decision === 'back') {
          memory.context.pendingOrderDecision = undefined;
          memory.context.pendingOrderId = undefined;
          memory.context.pendingOrderNumber = undefined;
          memory.context.pendingOrderOptions = undefined;
          memory.context.lastMenu = 'primary';
          await this.memoryManager.saveSession(memory);

          const menuContent = buildPrimaryMenuContent();
          await this.storeMessage(sessionId, 'user', message, messageId);
          await this.storeMessage(sessionId, 'assistant', menuContent.text);

          await this.prisma.agentSession.updateMany({
            where: { id: sessionId, workspaceId },
            data: { lastActivityAt: new Date(), agentActive: true, currentState: AgentState.IDLE },
          });

          if (fsm.canTransition(AgentState.IDLE)) {
            fsm.transition(AgentState.IDLE);
            await this.memoryManager.updateState(sessionId, AgentState.IDLE);
          }

          return {
            response: menuContent.text,
            responseType: 'interactive-buttons',
            responsePayload: menuContent.interactive,
            state: AgentState.IDLE,
            toolsUsed: [],
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }

        if (decision === 'new') {
          memory.context.pendingOrderDecision = undefined;
          memory.context.pendingOrderId = undefined;
          memory.context.pendingOrderNumber = undefined;
          memory.context.pendingOrderOptions = undefined;
          memory.context.editingOrderId = undefined;
          memory.context.editingOrderNumber = undefined;
          memory.context.editingOrderOriginalItems = undefined;
          memory.cart = null;
          await this.memoryManager.saveSession(memory);

          if (fsm.canTransition(AgentState.COLLECTING_ORDER)) {
            fsm.transition(AgentState.COLLECTING_ORDER);
            await this.memoryManager.updateState(sessionId, AgentState.COLLECTING_ORDER);
          }

          const exampleProducts = await this.getOrderExampleProducts(workspaceId);
          const response = buildStartOrderMessage(exampleProducts, {
            greeting: shouldPrefaceGreeting(message),
          });

          await this.storeMessage(sessionId, 'user', message, messageId);
          await this.storeMessage(sessionId, 'assistant', response);

          await this.prisma.agentSession.updateMany({
            where: { id: sessionId, workspaceId },
            data: {
              currentState: AgentState.COLLECTING_ORDER,
              lastActivityAt: new Date(),
              agentActive: true,
            },
          });

          return {
            response,
            state: AgentState.COLLECTING_ORDER,
            toolsUsed: [],
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }

        const order = await this.prisma.order.findFirst({
          where: withVisibleOrders({
            id: pendingOrder.id,
            workspaceId,
            customerId,
            status: 'awaiting_acceptance',
          }),
          include: {
            items: true,
          },
        });

        if (!order) {
          memory.context.pendingOrderDecision = undefined;
          memory.context.pendingOrderId = undefined;
          memory.context.pendingOrderNumber = undefined;
          memory.context.pendingOrderOptions = undefined;
          await this.memoryManager.saveSession(memory);
          return respondWithPrimaryMenu();
        }

        const cartItems = order.items.map((item) => ({
          productId: item.productId,
          ...(item.variantId ? { variantId: item.variantId } : {}),
          sku: item.sku,
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.total,
          availableStock: 0,
        }));

        memory.context.pendingOrderDecision = undefined;
        memory.context.pendingOrderId = undefined;
        memory.context.pendingOrderNumber = undefined;
        memory.context.pendingOrderOptions = undefined;
        memory.context.editingOrderId = order.id;
        memory.context.editingOrderNumber = order.orderNumber;
        memory.context.editingOrderOriginalItems = cartItems.map((item) => ({
          productId: item.productId,
          variantId: item.variantId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          name: item.name,
        }));
        memory.cart = {
          sessionId,
          workspaceId,
          customerId,
          items: cartItems,
          subtotal: order.subtotal,
          shipping: order.shipping,
          discount: order.discount,
          total: order.total,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        await this.memoryManager.saveSession(memory);

        if (fsm.canTransition(AgentState.COLLECTING_ORDER)) {
          fsm.transition(AgentState.COLLECTING_ORDER);
          await this.memoryManager.updateState(sessionId, AgentState.COLLECTING_ORDER);
        }

        let response = '';
        const toolsUsed: ToolExecution[] = [];
        const shouldSendPdf = order.items.length > LONG_ORDER_SUMMARY_THRESHOLD;
        if (shouldSendPdf) {
          const execution = await toolRegistry.execute(
            'send_order_pdf',
            { orderId: order.id },
            toolContext
          );
          toolsUsed.push(execution);
          response = execution.result.success
            ? `🛒 Te envié el resumen del pedido ${order.orderNumber} en PDF.\nDime si quieres agregar o sacar algo.`
            : buildExistingOrderSummaryMessage({
                orderNumber: order.orderNumber,
                items: order.items.map((item) => ({
                  name: item.name,
                  quantity: item.quantity,
                  total: item.total,
                })),
                total: order.total,
              });
        } else {
          response = buildExistingOrderSummaryMessage({
            orderNumber: order.orderNumber,
            items: order.items.map((item) => ({
              name: item.name,
              quantity: item.quantity,
              total: item.total,
            })),
            total: order.total,
          });
        }

        await this.storeMessage(sessionId, 'user', message, messageId);
        await this.storeMessage(sessionId, 'assistant', response);

        await this.prisma.agentSession.updateMany({
          where: { id: sessionId, workspaceId },
          data: {
            currentState: AgentState.COLLECTING_ORDER,
            lastActivityAt: new Date(),
            agentActive: true,
          },
        });

        return {
          response,
          state: AgentState.COLLECTING_ORDER,
          toolsUsed,
          tokensUsed: 0,
          shouldSendMessage: true,
        };
      };

      if (memory.context.otherInquiry) {
        if (isReturnToMenu(message) || isMenuRequest(message)) {
          memory.context.otherInquiry = undefined;
          await this.memoryManager.saveSession(memory);
          return respondWithPrimaryMenu();
        }

        if (wasCatalogExplicitlyRequested(message)) {
          memory.context.otherInquiry = undefined;
          await this.memoryManager.saveSession(memory);

          await this.storeMessage(sessionId, 'user', message, messageId);

          const execution = await toolRegistry.execute(
            'send_catalog_pdf',
            {},
            toolContext
          );

          toolsUsed.push(execution);

          const dataMessage = (execution.result.data as { message?: string } | undefined)?.message;
          const response =
            execution.result.success && dataMessage
              ? dataMessage
              : execution.result.error || 'No pude enviar el catálogo.';

          await this.storeMessage(sessionId, 'assistant', response);

          await this.prisma.agentSession.updateMany({
            where: { id: sessionId, workspaceId },
            data: { lastActivityAt: new Date(), agentActive: true },
          });

          return {
            response,
            state: fsm.getState(),
            toolsUsed,
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }

        const contextStartAt = await this.getSessionContextStartAt(sessionId, workspaceId);
        const history = await this.getConversationHistory(sessionId, contextStartAt);
        const recentHistory = HISTORY_LIMIT > 0 ? history.slice(-HISTORY_LIMIT) : history;

        const commerceProfile = memory.context.commerceProfile ||
          await this.loadCommerceProfile(workspaceId);

        const workspace = await this.prisma.workspace.findUnique({
          where: { id: workspaceId },
          select: { settings: true },
        });
        const workspaceSettings = (workspace?.settings as Record<string, unknown>) || {};
        const commerceName =
          (workspaceSettings.businessName as string) ||
          'Tu Comercio';

        const subagentsEnabled = this.isSubagentsEnabled(workspaceSettings);
        const agentMode = this.resolveAgentMode(message, memory, fsm, subagentsEnabled);
        const taskHint = this.buildTaskHintWithMode(fsm, memory, agentMode);
        const memoryContext = await this.memoryService.buildContext(
          sessionId,
          workspaceId,
          contextStartAt
        );
        const systemPrompt = buildRetailSystemPrompt(
          commerceName,
          commerceProfile,
          { compact: false, taskHint, memoryContext }
        );

        const claudeMessages: Anthropic.MessageParam[] = recentHistory.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));

        claudeMessages.push({ role: 'user', content: message });

        await this.storeMessage(sessionId, 'user', message, messageId);

        let baseTools = toolRegistry
          .getQueryTools()
          .filter((t) => !CATALOG_TOOL_NAMES.has(t.name))
          .map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.input_schema as Anthropic.Tool.InputSchema,
          }));

        if (agentMode === 'payments') {
          baseTools = toolRegistry.getToolDefinitions().map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.input_schema as Anthropic.Tool.InputSchema,
          }));
        }

        const tools = subagentsEnabled
          ? this.selectToolsForMode({ mode: agentMode, allowCatalogTools: false, baseTools })
          : baseTools;
        const allowedToolNames = new Set(tools.map((tool) => tool.name));

        let response = '';
        let iterations = 0;
        let pendingToolResults: Array<{ tool_use_id: string; content: string }> = [];
        let confirmationRequested = false;

        while (iterations < this.config.maxToolIterations) {
          iterations++;

          const requestMessages = [...claudeMessages];

          if (pendingToolResults.length > 0) {
            const toolResultMessage: Anthropic.MessageParam = {
              role: 'user',
              content: pendingToolResults.map((tr) => ({
                type: 'tool_result' as const,
                tool_use_id: tr.tool_use_id,
                content: tr.content,
              })),
            };
            requestMessages.push(toolResultMessage);
            claudeMessages.push(toolResultMessage);
            pendingToolResults = [];
          }

          const modelConfig = {
            model: this.config.model,
            maxTokens: this.config.maxTokens,
            temperature: this.config.temperature,
          };

          console.log(
            `[RetailAgent] Claude request (iter ${iterations}, model ${modelConfig.model}, msgLen ${message.length}, history ${recentHistory.length}, tools ${tools.length}, state ${fsm.getState()})`
          );
          const llmStart = Date.now();
          const llmResponse = await this.callClaudeWithTimeout(() =>
            this.anthropic.messages.create({
              model: modelConfig.model,
              max_tokens: modelConfig.maxTokens,
              temperature: modelConfig.temperature,
              system: systemPrompt,
              messages: requestMessages,
              tools,
            }, { timeout: LLM_TIMEOUT_MS })
          );
          const llmDuration = Date.now() - llmStart;
          console.log(
            `[RetailAgent] Claude response in ${llmDuration}ms (iter ${iterations}, msgLen ${message.length}, history ${recentHistory.length})`
          );

          totalTokens += llmResponse.usage.input_tokens + llmResponse.usage.output_tokens;

          let hasToolUse = false;

          for (const block of llmResponse.content) {
            if (block.type === 'text') {
              response = block.text;
            } else if (block.type === 'tool_use') {
              hasToolUse = true;
              if (!allowedToolNames.has(block.name)) {
                pendingToolResults.push({
                  tool_use_id: block.id,
                  content: JSON.stringify({
                    success: false,
                    error: 'Tool not allowed in this context',
                  }),
                });
                continue;
              }

              if (toolRegistry.requiresConfirmation(block.name)) {
                const enrichedInput = await this.enrichConfirmationInput(
                  block.name,
                  block.input as Record<string, unknown>,
                  workspaceId
                );
                const confirmation = buildConfirmationRequest(block.name, enrichedInput);
                await this.memoryManager.setPendingConfirmation(sessionId, confirmation);
                response = confirmation.message;
                confirmationRequested = true;
                break;
              }

              await this.audit({
                correlationId,
                sessionId,
                workspaceId,
                timestamp: new Date(),
                phase: 'tool_call',
                data: { tool: block.name, input: block.input },
              });

              const execution = await toolRegistry.execute(
                block.name,
                block.input as Record<string, unknown>,
                toolContext
              );

              toolsUsed.push(execution);
              if (MEMORY_MUTATING_TOOLS.has(block.name)) {
                const refreshed = await this.memoryManager.getSession(sessionId);
                if (refreshed) {
                  memory = refreshed;
                }
              }

              if (execution.result.stateTransition) {
                if (fsm.canTransition(execution.result.stateTransition)) {
                  fsm.transition(execution.result.stateTransition);
                  await this.memoryManager.updateState(sessionId, execution.result.stateTransition);
                }
              }

              await this.audit({
                correlationId,
                sessionId,
                workspaceId,
                timestamp: new Date(),
                phase: 'result',
                data: {
                  tool: block.name,
                  success: execution.result.success,
                  error: execution.result.error,
                },
              });

              pendingToolResults.push({
                tool_use_id: block.id,
                content: JSON.stringify(execution.result),
              });
            }
          }

          if (confirmationRequested) {
            break;
          }

          if (!hasToolUse || llmResponse.stop_reason === 'end_turn') {
            break;
          }

          claudeMessages.push({
            role: 'assistant',
            content: llmResponse.content,
          });
        }

        response = stripCatalogMentionsIfNotRequested(response, message);
        response = applyProductInquiryFallback(response, message, toolsUsed, memory, fsm);
        response = enforceMenuForOrdering(response, memory, fsm);

        const updated = updateLastProductInquiry(message, toolsUsed, memory, fsm);
        if (updated) {
          await this.memoryManager.saveSession(memory);
        }

        if (response) {
          await this.storeMessage(sessionId, 'assistant', response);
        }

        await this.prisma.agentSession.updateMany({
          where: { id: sessionId, workspaceId },
          data: {
            currentState: fsm.getState(),
            lastActivityAt: new Date(),
          },
        });

        return {
          response,
          state: fsm.getState(),
          toolsUsed,
          tokensUsed: totalTokens,
          shouldSendMessage: true,
        };
      }

      if (!memory.context.invoiceDataCollection) {
        const catalogDecision = parseCatalogOfferDecision(message);
        if (catalogDecision) {
          const lastAssistant = await this.prisma.agentMessage.findFirst({
            where: { sessionId, role: 'assistant' },
            orderBy: { createdAt: 'desc' },
            select: { content: true },
          });

          if (lastAssistant && isCatalogOfferResponse(lastAssistant.content)) {
            if (catalogDecision === 'back') {
              return respondWithPrimaryMenu();
            }

            if (catalogDecision === 'yes') {
              const execution = await toolRegistry.execute(
                'send_catalog_pdf',
                {},
                toolContext
              );

              const response = execution.result.success
                ? 'Te envío el catálogo para que veas lo que tenemos disponible. Decime qué querés agregar a tu pedido.'
                : 'No pude enviar el catálogo. Decime qué otros productos querés agregar.';

              await this.storeMessage(sessionId, 'user', message, messageId);
              await this.storeMessage(sessionId, 'assistant', response);

              if (fsm.canTransition(AgentState.COLLECTING_ORDER)) {
                fsm.transition(AgentState.COLLECTING_ORDER);
                await this.memoryManager.updateState(sessionId, AgentState.COLLECTING_ORDER);
              }

              await this.prisma.agentSession.updateMany({
                where: { id: sessionId, workspaceId },
                data: { currentState: fsm.getState(), lastActivityAt: new Date() },
              });

              return {
                response,
                state: fsm.getState(),
                toolsUsed: [execution],
                tokensUsed: 0,
                shouldSendMessage: true,
              };
            }

            if (catalogDecision === 'no') {
              const response = 'Perfecto. Decime qué otro producto querés agregar a tu pedido.';
              await this.storeMessage(sessionId, 'user', message, messageId);
              await this.storeMessage(sessionId, 'assistant', response);

              if (fsm.canTransition(AgentState.COLLECTING_ORDER)) {
                fsm.transition(AgentState.COLLECTING_ORDER);
                await this.memoryManager.updateState(sessionId, AgentState.COLLECTING_ORDER);
              }

              await this.prisma.agentSession.updateMany({
                where: { id: sessionId, workspaceId },
                data: { currentState: fsm.getState(), lastActivityAt: new Date() },
              });

              return {
                response,
                state: fsm.getState(),
                toolsUsed: [],
                tokensUsed: 0,
                shouldSendMessage: true,
              };
            }
          }
        }
      }

      if (memory.context.invoiceDataCollection) {
        const flow = memory.context.invoiceDataCollection;

        const respondInvoiceFlow = async (params: {
          response: string;
          responseType?: 'interactive-buttons' | 'interactive-list';
          responsePayload?: InteractiveButtonsPayload | InteractiveListPayload;
        }) => {
          await this.storeMessage(sessionId, 'user', message, messageId);
          await this.storeMessage(sessionId, 'assistant', params.response);

          await this.prisma.agentSession.updateMany({
            where: { id: sessionId, workspaceId },
            data: { currentState: fsm.getState(), lastActivityAt: new Date() },
          });

          return {
            response: params.response,
            responseType: params.responseType,
            responsePayload: params.responsePayload,
            state: fsm.getState(),
            toolsUsed,
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        };

        const shouldCancelInvoiceCollection = (input: string) => {
          const normalized = normalizeSimpleText(input);
          if (!normalized) return false;
          const keywords = [
            'cancelar',
            'cancela',
            'cancelalo',
            'cancelarlo',
            'cancel',
            'eliminar',
            'elimina',
            'eliminarlo',
            'anular',
            'anula',
            'borrar',
            'borra',
            'salir',
          ];
          return keywords.some((keyword) => normalized.includes(keyword));
        };

        if (shouldCancelInvoiceCollection(message)) {
          memory.context.invoiceDataCollection = undefined;
          await this.memoryManager.saveSession(memory);
          return await respondInvoiceFlow({
            response: 'Perfecto, cancele la recoleccion de datos fiscales\nSi quieres volver a completar tus datos fiscales ve a Pedidos activos, elige tu pedido > Emitir factura',
          });
        }

        const handleFieldValue = (field: InvoiceFieldKey, value: string) => {
          const trimmed = value.trim();
          if (!trimmed) {
            return { error: 'Ese dato no puede estar vacío. Probá de nuevo.' };
          }
          if (field === 'cuit') {
            const parsed = normalizeCuitInput(trimmed);
            if (!parsed.value) {
              return { error: parsed.error || 'El CUIT debe tener 11 números. Probá de nuevo.' };
            }
            return { value: parsed.value };
          }
          if (field === 'vatCondition') {
            const resolved = resolveVatConditionId(trimmed);
            if (!resolved) {
              return { error: 'Elegí una opción de la lista para la condición frente al IVA.' };
            }
            return { value: resolved };
          }
          return { value: trimmed };
        };

        if (flow.step === 'confirm') {
          const decision = parseInvoiceDataConfirmDecision(message);
          if (!decision) {
            const confirmContent = buildInvoiceConfirmContent(flow.data);
            return await respondInvoiceFlow({
              response: confirmContent.text,
              responseType: confirmContent.responseType,
              responsePayload: confirmContent.responsePayload,
            });
          }

          if (decision === 'edit') {
            flow.step = 'edit_select';
            flow.editingField = undefined;
            memory.context.invoiceDataCollection = flow;
            await this.memoryManager.saveSession(memory);

            const editContent = buildInvoiceEditListContent(flow.data);
            return await respondInvoiceFlow({
              response: editContent.text,
              responseType: editContent.responseType,
              responsePayload: editContent.responsePayload,
            });
          }

          const { cuit, businessName, fiscalAddress, vatCondition } = flow.data;
          try {
            await this.prisma.customer.updateMany({
              where: { id: customerId, workspaceId },
              data: {
                cuit: cuit || null,
                businessName: businessName || null,
                fiscalAddress: fiscalAddress || null,
                vatCondition: vatCondition || null,
              },
            });

            const order = await this.prisma.order.findFirst({
              where: { id: flow.orderId, workspaceId },
              select: { status: true, orderNumber: true },
            });

            if (order) {
              await this.prisma.$transaction([
                this.prisma.order.updateMany({
                  where: { id: flow.orderId, workspaceId },
                  data: { status: 'pending_invoicing' },
                }),
                this.prisma.orderStatusHistory.create({
                  data: {
                    orderId: flow.orderId,
                    previousStatus: order.status,
                    newStatus: 'pending_invoicing',
                    reason: 'Datos fiscales confirmados por cliente',
                    changedBy: 'customer',
                  },
                }),
              ]);
            }

            memory.context.invoiceDataCollection = undefined;
            await this.memoryManager.saveSession(memory);

            return await respondInvoiceFlow({
              response: order
                ? `Perfecto, ya guardé tus datos fiscales. Tu pedido ${order.orderNumber} quedó pendiente de facturación.`
                : 'Perfecto, ya guardé tus datos fiscales.',
            });
          } catch (error) {
            console.error('[InvoiceFlow] Failed to save customer invoice data:', error);
            return await respondInvoiceFlow({
              response: 'No pude guardar los datos fiscales. Intentá de nuevo.',
            });
          }
        }

        if (flow.step === 'edit_select') {
          const selection = parseInvoiceEditSelection(message);
          if (!selection) {
            const editContent = buildInvoiceEditListContent(flow.data);
            return await respondInvoiceFlow({
              response: editContent.text,
              responseType: editContent.responseType,
              responsePayload: editContent.responsePayload,
            });
          }

          flow.step = 'edit_field';
          flow.editingField = selection;
          memory.context.invoiceDataCollection = flow;
          await this.memoryManager.saveSession(memory);

          const prompt = buildInvoiceFieldPromptContent(selection, 'edit', {
            vatPage: flow.vatPage,
          });
          return await respondInvoiceFlow({
            response: prompt.text,
            responseType: prompt.responseType,
            responsePayload: prompt.responsePayload,
          });
        }

        if (flow.step === 'edit_field') {
          const field = flow.editingField;
          if (!field) {
            flow.step = 'edit_select';
            memory.context.invoiceDataCollection = flow;
            await this.memoryManager.saveSession(memory);
            const editContent = buildInvoiceEditListContent(flow.data);
            return await respondInvoiceFlow({
              response: editContent.text,
              responseType: editContent.responseType,
              responsePayload: editContent.responsePayload,
            });
          }

          if (field === 'vatCondition') {
            const paging = parseVatConditionPaging(message);
            if (paging) {
              flow.vatPage = paging === 'more' ? 1 : 0;
              memory.context.invoiceDataCollection = flow;
              await this.memoryManager.saveSession(memory);
              const content = buildVatConditionListContent('edit', undefined, flow.vatPage);
              return await respondInvoiceFlow({
                response: content.text,
                responseType: content.responseType,
                responsePayload: content.responsePayload,
              });
            }
          }

          const parsed = handleFieldValue(field, message);
          if (parsed.error) {
            if (field === 'vatCondition') {
              const content = buildVatConditionListContent('edit', parsed.error, flow.vatPage ?? 0);
              return await respondInvoiceFlow({
                response: content.text,
                responseType: content.responseType,
                responsePayload: content.responsePayload,
              });
            }
            return await respondInvoiceFlow({ response: parsed.error });
          }

          flow.data = { ...flow.data, [field]: parsed.value };
          flow.step = 'confirm';
          flow.editingField = undefined;
          memory.context.invoiceDataCollection = flow;
          await this.memoryManager.saveSession(memory);

          const confirmContent = buildInvoiceConfirmContent(flow.data);
          return await respondInvoiceFlow({
            response: confirmContent.text,
            responseType: confirmContent.responseType,
            responsePayload: confirmContent.responsePayload,
          });
        }

        if (
          flow.step === 'cuit' ||
          flow.step === 'businessName' ||
          flow.step === 'fiscalAddress' ||
          flow.step === 'vatCondition'
        ) {
          const field = flow.step;
          if (field === 'vatCondition') {
            const paging = parseVatConditionPaging(message);
            if (paging) {
              flow.vatPage = paging === 'more' ? 1 : 0;
              memory.context.invoiceDataCollection = flow;
              await this.memoryManager.saveSession(memory);
              const content = buildVatConditionListContent('initial', undefined, flow.vatPage);
              return await respondInvoiceFlow({
                response: content.text,
                responseType: content.responseType,
                responsePayload: content.responsePayload,
              });
            }
          }

          const parsed = handleFieldValue(field, message);
          if (parsed.error) {
            if (field === 'vatCondition') {
              const content = buildVatConditionListContent('initial', parsed.error, flow.vatPage ?? 0);
              return await respondInvoiceFlow({
                response: content.text,
                responseType: content.responseType,
                responsePayload: content.responsePayload,
              });
            }
            return await respondInvoiceFlow({ response: parsed.error });
          }

          flow.data = { ...flow.data, [field]: parsed.value };
          const next = getNextMissingInvoiceField(flow.data, field);
          if (next) {
            flow.step = next;
            memory.context.invoiceDataCollection = flow;
            await this.memoryManager.saveSession(memory);
            const prompt = buildInvoiceFieldPromptContent(next, 'initial', {
              vatPage: flow.vatPage,
            });
            return await respondInvoiceFlow({
              response: prompt.text,
              responseType: prompt.responseType,
              responsePayload: prompt.responsePayload,
            });
          }

          flow.step = 'confirm';
          memory.context.invoiceDataCollection = flow;
          await this.memoryManager.saveSession(memory);
          const confirmContent = buildInvoiceConfirmContent(flow.data);
          return await respondInvoiceFlow({
            response: confirmContent.text,
            responseType: confirmContent.responseType,
            responsePayload: confirmContent.responsePayload,
          });
        }
      }

      if (!memory.context.invoiceDataCollection && !memory.context.pendingInvoicePrompt) {
        if (isInvoiceDataEditIntent(message)) {
          const response =
            'Todavía no puedo editar datos de facturación por WhatsApp. Si querés solicitar factura, escribí Menu, elegí la opción Pedidos activos y luego Solicitar factura.';
          await this.storeMessage(sessionId, 'user', message, messageId);
          await this.storeMessage(sessionId, 'assistant', response);
          await this.prisma.agentSession.updateMany({
            where: { id: sessionId, workspaceId },
            data: { currentState: fsm.getState(), lastActivityAt: new Date() },
          });

          return {
            response,
            state: fsm.getState(),
            toolsUsed,
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }
      }

      if (isRegretMessage(message)) {
        return respondWithPrimaryMenu('primary_lite');
      }

      if (isReturnToMenu(message)) {
        return respondWithPrimaryMenu();
      }

      if (memory.context.orderViewAwaitingAck && isAcknowledgement(message)) {
        memory.context.orderViewAwaitingAck = undefined;
        await this.memoryManager.saveSession(memory);
        return respondWithPrimaryMenu();
      }

      if (memory.context.pendingInvoicePrompt) {
        const decision = parseInvoiceDecision(message);
        if (decision !== null) {
          const { orderId, orderNumber } = memory.context.pendingInvoicePrompt;
          memory.context.pendingInvoicePrompt = undefined;
          memory.context.pendingCatalogOffer = undefined;
          await this.memoryManager.saveSession(memory);

          let response = '';
          let responseType: 'interactive-buttons' | 'interactive-list' | undefined;
          let responsePayload: InteractiveButtonsPayload | InteractiveListPayload | undefined;
          try {
            const order = await this.prisma.order.findFirst({
              where: { id: orderId, workspaceId },
              select: { status: true, orderNumber: true },
            });

            if (!order) {
              response = 'No encontré tu pedido para actualizar la factura.';
            } else {
              response = decision
                ? `Perfecto, vamos a preparar la factura del pedido ${orderNumber || order.orderNumber}.`
                : `Perfecto, tu pedido ${orderNumber || order.orderNumber} quedó confirmado. Gracias.`;

              if (decision) {
                const customer = await this.prisma.customer.findFirst({
                  where: { id: customerId, workspaceId },
                  select: {
                    cuit: true,
                    businessName: true,
                    fiscalAddress: true,
                    vatCondition: true,
                  },
                });

                const data = {
                  cuit: customer?.cuit || undefined,
                  businessName: customer?.businessName || undefined,
                  fiscalAddress: customer?.fiscalAddress || undefined,
                  vatCondition: customer?.vatCondition || undefined,
                };

                const nextField = getFirstMissingInvoiceField(data);
                if (nextField) {
                  memory.context.invoiceDataCollection = {
                    orderId,
                    orderNumber,
                    step: nextField,
                    data,
                    vatPage: 0,
                  };
                  await this.memoryManager.saveSession(memory);
                  const prompt = buildInvoiceFieldPromptContent(nextField, 'initial');
                  response = prompt.text;
                  responseType = prompt.responseType;
                  responsePayload = prompt.responsePayload;
                } else {
                  memory.context.invoiceDataCollection = {
                    orderId,
                    orderNumber,
                    step: 'confirm',
                    data,
                    vatPage: 0,
                  };
                  await this.memoryManager.saveSession(memory);
                  const confirmContent = buildInvoiceConfirmContent(data);
                  response = confirmContent.text;
                  responseType = confirmContent.responseType;
                  responsePayload = confirmContent.responsePayload;
                }
              }
            }
          } catch (error) {
            console.error('[InvoicePrompt] Failed to handle invoice prompt:', error);
            response = 'No pude procesar la respuesta de facturación. Intentá de nuevo más tarde.';
          }

          await this.storeMessage(sessionId, 'user', message, messageId);
          await this.storeMessage(sessionId, 'assistant', response);

          await this.prisma.agentSession.updateMany({
            where: { id: sessionId, workspaceId },
            data: { currentState: fsm.getState(), lastActivityAt: new Date() },
          });

          return {
            response,
            responseType,
            responsePayload,
            state: fsm.getState(),
            toolsUsed,
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }
      }

      if (!memory.context.pendingCatalogOffer) {
        const decision = parseCatalogOfferDecision(message);
        if (decision) {
          const lastAssistant = await this.prisma.agentMessage.findFirst({
            where: { sessionId, role: 'assistant' },
            orderBy: { createdAt: 'desc' },
            select: { content: true },
          });
          if (lastAssistant && isCatalogOfferResponse(lastAssistant.content)) {
            memory.context.pendingCatalogOffer = { requested: [] };
            await this.memoryManager.saveSession(memory);
          }
        }
      }

      if (memory.context.pendingCatalogOffer) {
        const decision = parseCatalogOfferDecision(message);
        if (decision) {
          memory.context.pendingCatalogOffer = undefined;
          await this.memoryManager.saveSession(memory);

          if (decision === 'back') {
            return respondWithPrimaryMenu();
          }

          if (decision === 'yes') {
            const execution = await toolRegistry.execute(
              'send_catalog_pdf',
              {},
              toolContext
            );

            const response = execution.result.success
              ? 'Te envío el catálogo para que veas lo que tenemos disponible. Decime qué querés agregar a tu pedido.'
              : 'No pude enviar el catálogo. Decime qué otros productos querés agregar.';

            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', response);

            if (fsm.canTransition(AgentState.COLLECTING_ORDER)) {
              fsm.transition(AgentState.COLLECTING_ORDER);
              await this.memoryManager.updateState(sessionId, AgentState.COLLECTING_ORDER);
            }

            await this.prisma.agentSession.updateMany({
              where: { id: sessionId, workspaceId },
              data: { currentState: fsm.getState(), lastActivityAt: new Date() },
            });

            return {
              response,
              state: fsm.getState(),
              toolsUsed: [execution],
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }

          if (decision === 'no') {
            const response = 'Perfecto. Decime qué otros productos querés agregar a tu pedido.';
            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', response);

            if (fsm.canTransition(AgentState.COLLECTING_ORDER)) {
              fsm.transition(AgentState.COLLECTING_ORDER);
              await this.memoryManager.updateState(sessionId, AgentState.COLLECTING_ORDER);
            }

            await this.prisma.agentSession.updateMany({
              where: { id: sessionId, workspaceId },
              data: { currentState: fsm.getState(), lastActivityAt: new Date() },
            });

            return {
              response,
              state: fsm.getState(),
              toolsUsed: [],
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }
        } else {
          memory.context.pendingCatalogOffer = undefined;
          await this.memoryManager.saveSession(memory);
        }
      }

      if (memory.context.pendingProductSelection) {
        if (isReturnToMenu(message)) {
          memory.context.pendingProductSelection = undefined;
          await this.memoryManager.saveSession(memory);
          return respondWithPrimaryMenu();
        }

        const {
          options,
          quantity,
          requestedName,
          requestedSecondaryUnit,
          remainingSegments,
          pendingUnknown,
          pendingErrors,
          pendingShortages,
        } = memory.context.pendingProductSelection;
        const selectionResult = parseProductSelection(message, options);

        if (!selectionResult.selection) {
        const selectionContent = buildProductSelectionContent(
          requestedName || 'ese producto',
          quantity,
          options,
          requestedSecondaryUnit || undefined
        );
          const response = selectionResult.ambiguous
            ? [
                'Hay más de una opción que coincide.',
                'Elegí la correcta:',
                '',
                selectionContent.text,
              ].join('\n')
            : selectionContent.text;

          await this.storeMessage(sessionId, 'user', message, messageId);
          await this.storeMessage(sessionId, 'assistant', response);

          return {
            response,
            responseType: selectionContent.responseType,
            responsePayload: selectionContent.responsePayload,
            state: fsm.getState(),
            toolsUsed: [],
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }

        const carryOverUnknown = pendingUnknown ? [...pendingUnknown] : [];
        const carryOverErrors = pendingErrors ? [...pendingErrors] : [];
        const carryOverShortages = pendingShortages ? [...pendingShortages] : [];

        memory.context.pendingProductSelection = undefined;
        await this.memoryManager.saveSession(memory);

        const execution = await toolRegistry.execute(
          'add_to_cart',
          {
            productId: selectionResult.selection.productId,
            variantId: selectionResult.selection.variantId,
            quantity: (() => {
              const multiplier = resolveSecondaryUnitMultiplier(
                requestedSecondaryUnit || null,
                selectionResult.selection.secondaryUnit,
                selectionResult.selection.secondaryUnitValue
              );
              return multiplier ? quantity * multiplier : quantity;
            })(),
          },
          toolContext
        );
        toolsUsed.push(execution);

        if (!execution.result.success) {
          const shortages = extractInsufficientStock(execution.result.data);
          if (shortages.length > 0 && shortages.some((detail) => detail.available > 0)) {
            memory.context.pendingStockAdjustment = { items: shortages };
            await this.memoryManager.saveSession(memory);
            const response = buildInsufficientStockMessage(shortages);
            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', response);
            return {
              response,
              state: fsm.getState(),
              toolsUsed,
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }

          const response = execution.result.error || 'No pude agregar ese producto.';
          await this.storeMessage(sessionId, 'user', message, messageId);
          await this.storeMessage(sessionId, 'assistant', response);
          return {
            response,
            state: fsm.getState(),
            toolsUsed,
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }

        let storedUserMessage = false;
        if (remainingSegments && remainingSegments.length > 0) {
          await this.storeMessage(sessionId, 'user', message, messageId);
          storedUserMessage = true;
          const continuation = await this.continueQuickOrderParse(
            remainingSegments,
            toolContext,
            memory,
            fsm,
            toolsUsed,
            {
              unknown: carryOverUnknown,
              errors: carryOverErrors,
              shortages: carryOverShortages,
            }
          );
          if (continuation) {
            return continuation;
          }
        }

        const cart = await this.memoryManager.getCart(sessionId);
        if (!cart || cart.items.length === 0) {
          const response = 'No pude agregar ese producto.';
          await this.storeMessage(sessionId, 'user', message, messageId);
          await this.storeMessage(sessionId, 'assistant', response);
          return {
            response,
            state: fsm.getState(),
            toolsUsed,
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }

        const isEditingExistingOrder = !!memory.context.editingOrderId;
        const actions = isEditingExistingOrder ? buildEditOrderActionsContent() : buildOrderActionsContent();
        const shouldSendPdf = cart.items.length > LONG_ORDER_SUMMARY_THRESHOLD;
        let response = '';

        if (shouldSendPdf) {
          const pdfExecution = await toolRegistry.execute(
            'send_order_pdf',
            {
              summary: buildCartSummaryPayload(cart, memory.context.editingOrderNumber),
            },
            toolContext
          );
          toolsUsed.push(pdfExecution);
          response = pdfExecution.result.success
            ? '🛒 Te envié el resumen del pedido en PDF.'
            : buildOrderSummaryMessage(cart);
        } else {
          response = buildOrderSummaryMessage(cart);
        }

        if (!storedUserMessage) {
          await this.storeMessage(sessionId, 'user', message, messageId);
        }
        await this.storeMessage(sessionId, 'assistant', response);

        if (fsm.canTransition(AgentState.AWAITING_CONFIRMATION)) {
          fsm.transition(AgentState.AWAITING_CONFIRMATION);
          await this.memoryManager.updateState(sessionId, AgentState.AWAITING_CONFIRMATION);
        }

        await this.prisma.agentSession.updateMany({
          where: { id: sessionId, workspaceId },
          data: {
            currentState: fsm.getState(),
            lastActivityAt: new Date(),
          },
        });

        return {
          response,
          responseType: 'interactive-buttons',
          responsePayload: actions.interactive,
          state: fsm.getState(),
          toolsUsed,
          tokensUsed: 0,
          shouldSendMessage: true,
        };
      }

      if (memory.context.pendingStockAdjustment) {
        const decision = parseConfirmationResponse(message);
        if (decision === true) {
          const cart = await this.memoryManager.getCart(sessionId);
          if (!cart) {
            memory.context.pendingStockAdjustment = undefined;
            await this.memoryManager.saveSession(memory);
            return respondWithPrimaryMenu();
          }

          for (const item of memory.context.pendingStockAdjustment.items) {
            if (!item.productId) continue;
            const variantId = item.variantId;
            const existing = cart.items.find(
              (i) => i.productId === item.productId && (i.variantId || null) === (variantId || null)
            );
            if (item.available <= 0) {
              await toolRegistry.execute(
                'remove_from_cart',
                { productId: item.productId, variantId },
                toolContext
              );
              continue;
            }

            const mode = item.mode || (existing ? 'set' : 'add');
            if (mode === 'add' && !existing) {
              await toolRegistry.execute(
                'add_to_cart',
                { productId: item.productId, variantId, quantity: item.available },
                toolContext
              );
            } else if (mode === 'add' && existing) {
              await toolRegistry.execute(
                'add_to_cart',
                { productId: item.productId, variantId, quantity: item.available },
                toolContext
              );
            } else {
              await toolRegistry.execute(
                'update_cart_item',
                { productId: item.productId, variantId, quantity: item.available },
                toolContext
              );
            }
          }

          memory.context.pendingStockAdjustment = undefined;
          await this.memoryManager.saveSession(memory);

          const updatedCart = await this.memoryManager.getCart(sessionId);
          if (!updatedCart || updatedCart.items.length === 0) {
            const response = 'Listo. No quedó ningún producto en el pedido.';
            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', response);
            return {
              response,
              state: fsm.getState(),
              toolsUsed: [],
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }

          const isEditingExistingOrder = !!memory.context.editingOrderId;
          const actions = isEditingExistingOrder ? buildEditOrderActionsContent() : buildOrderActionsContent();
          const shouldSendPdf = updatedCart.items.length > LONG_ORDER_SUMMARY_THRESHOLD;
          let response = '';
          if (shouldSendPdf) {
            const execution = await toolRegistry.execute(
              'send_order_pdf',
              { summary: buildCartSummaryPayload(updatedCart, memory.context.editingOrderNumber) },
              toolContext
            );
            response = execution.result.success
              ? '🛒 Te envié el resumen del pedido en PDF.'
              : buildOrderSummaryMessage(updatedCart);
          } else {
            response = buildOrderSummaryMessage(updatedCart);
          }

          await this.storeMessage(sessionId, 'user', message, messageId);
          await this.storeMessage(sessionId, 'assistant', response);

          if (fsm.canTransition(AgentState.AWAITING_CONFIRMATION)) {
            fsm.transition(AgentState.AWAITING_CONFIRMATION);
            await this.memoryManager.updateState(sessionId, AgentState.AWAITING_CONFIRMATION);
          }

          return {
            response,
            responseType: 'interactive-buttons',
            responsePayload: actions.interactive,
            state: fsm.getState(),
            toolsUsed: [],
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }

        if (decision === false) {
          memory.context.pendingStockAdjustment = undefined;
          await this.memoryManager.saveSession(memory);
          const response = 'Ok, decime qué querés cambiar.';
          await this.storeMessage(sessionId, 'user', message, messageId);
          await this.storeMessage(sessionId, 'assistant', response);
          if (fsm.canTransition(AgentState.COLLECTING_ORDER)) {
            fsm.transition(AgentState.COLLECTING_ORDER);
            await this.memoryManager.updateState(sessionId, AgentState.COLLECTING_ORDER);
          }
          return {
            response,
            state: fsm.getState(),
            toolsUsed: [],
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }

        const response = buildInsufficientStockMessage(memory.context.pendingStockAdjustment.items);
        await this.storeMessage(sessionId, 'user', message, messageId);
        await this.storeMessage(sessionId, 'assistant', response);
        return {
          response,
          state: fsm.getState(),
          toolsUsed: [],
          tokensUsed: 0,
          shouldSendMessage: true,
        };
      }

      if (memory.context.orderViewAwaitingNumber) {
        if (isAcknowledgement(message) || isReturnToMenu(message)) {
          memory.context.orderViewAwaitingNumber = undefined;
          await this.memoryManager.saveSession(memory);
          return respondWithPrimaryMenu();
        }

        const orderReference = extractOrderNumber(message) || extractOrderDigits(message);
        if (!orderReference) {
          const response = 'Pasame el número de pedido para enviártelo en PDF.';
          await this.storeMessage(sessionId, 'user', message, messageId);
          await this.storeMessage(sessionId, 'assistant', response);
          return {
            response,
            state: fsm.getState(),
            toolsUsed: [],
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }

        memory.context.orderViewAwaitingNumber = undefined;
        await this.memoryManager.saveSession(memory);
        const orderViewRequest = { orderNumber: orderReference };
        const orderViewHandled = await this.handleOrderViewRequest(
          orderViewRequest,
          toolContext,
          memory,
          fsm,
          message,
          messageId
        );
        if (orderViewHandled) {
          return orderViewHandled;
        }
      }

      const orderViewRequest = parseOrderViewRequest(message);
      if (orderViewRequest) {
        const handled = await this.handleOrderViewRequest(
          orderViewRequest,
          toolContext,
          memory,
          fsm,
          message,
          messageId
        );
        if (handled) {
          return handled;
        }
      }

      // Handle pending confirmation before any other flow
      const pendingConfirmation = await this.memoryManager.getPendingConfirmation(sessionId);
      if (pendingConfirmation) {
        const decision = parseConfirmationResponse(message);

        await this.storeMessage(sessionId, 'user', message, messageId);

        if (decision === true) {
          await this.memoryManager.clearPendingConfirmation(sessionId);

          await this.audit({
            correlationId,
            sessionId,
            workspaceId,
            timestamp: new Date(),
            phase: 'tool_call',
            data: { tool: pendingConfirmation.toolName, input: pendingConfirmation.toolInput },
          });

          const execution = await toolRegistry.execute(
            pendingConfirmation.toolName,
            pendingConfirmation.toolInput,
            toolContext
          );

          toolsUsed.push(execution);

          if (execution.result.stateTransition) {
            if (fsm.canTransition(execution.result.stateTransition)) {
              fsm.transition(execution.result.stateTransition);
              await this.memoryManager.updateState(sessionId, execution.result.stateTransition);
            }
          }

          await this.audit({
            correlationId,
            sessionId,
            workspaceId,
            timestamp: new Date(),
            phase: 'result',
            data: {
              tool: pendingConfirmation.toolName,
              success: execution.result.success,
              error: execution.result.error,
            },
          });

          const response = buildConfirmationResultMessage(execution, pendingConfirmation);

          await this.storeMessage(sessionId, 'assistant', response);

          await this.prisma.agentSession.updateMany({
            where: { id: sessionId, workspaceId },
            data: {
              currentState: fsm.getState(),
              lastActivityAt: new Date(),
            },
          });

          return {
            response,
            state: fsm.getState(),
            toolsUsed,
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }

        if (decision === false) {
          await this.memoryManager.clearPendingConfirmation(sessionId);
          const response = 'Perfecto, no hago cambios. ¿Querés que haga algo más?';

          await this.storeMessage(sessionId, 'assistant', response);
          await this.prisma.agentSession.updateMany({
            where: { id: sessionId, workspaceId },
            data: { lastActivityAt: new Date() },
          });

          return {
            response,
            state: fsm.getState(),
            toolsUsed: [],
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }

        const response = pendingConfirmation.message;
        await this.storeMessage(sessionId, 'assistant', response);
        await this.prisma.agentSession.updateMany({
          where: { id: sessionId, workspaceId },
          data: { lastActivityAt: new Date() },
        });

        return {
          response,
          state: fsm.getState(),
          toolsUsed: [],
          tokensUsed: 0,
          shouldSendMessage: true,
        };
      }

      if (memory.context.editingOrderId && memory.context.editingOrderNumber) {
        const normalized = normalizeSimpleText(message);
        if (normalized.includes('cancel') || normalized.includes('anular')) {
          memory.context.pendingCancelOrderId = memory.context.editingOrderId;
          memory.context.pendingCancelOrderNumber = memory.context.editingOrderNumber;
          await this.memoryManager.saveSession(memory);

          const confirmContent = buildCancelOrderConfirmation(memory.context.editingOrderNumber);
          await this.storeMessage(sessionId, 'user', message, messageId);
          await this.storeMessage(sessionId, 'assistant', confirmContent.text);

          return {
            response: confirmContent.text,
            responseType: 'interactive-buttons',
            responsePayload: confirmContent.interactive,
            state: fsm.getState(),
            toolsUsed: [],
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }
      }

      // Pending decision (pre-quick-parse): edit existing awaiting-acceptance order vs create new
      if (memory.context.pendingOrderDecision && memory.context.pendingOrderId) {
        if (memory.context.pendingOrderOptions && memory.context.pendingOrderOptions.length > 1) {
          const selection = parsePendingOrderSelection(message, memory.context.pendingOrderOptions);
          const decision = parsePendingOrderDecision(message);

          if (selection?.action === 'select') {
            memory.context.pendingOrderOptions = undefined;
            await this.memoryManager.saveSession(memory);
            return await handlePendingOrderDecision(selection.order, 'edit');
          }

          if (selection?.action === 'new' || selection?.action === 'back' || decision === 'new' || decision === 'back') {
            const pendingOrder = {
              id: memory.context.pendingOrderId,
              orderNumber: memory.context.pendingOrderNumber,
            };
            const resolvedDecision =
              selection?.action === 'new' || decision === 'new' ? 'new' : 'back';
            memory.context.pendingOrderOptions = undefined;
            await this.memoryManager.saveSession(memory);
            return await handlePendingOrderDecision(pendingOrder, resolvedDecision);
          }

          if (decision === 'edit') {
            const selectionContent = buildPendingOrderSelectionContent(memory.context.pendingOrderOptions);
            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', selectionContent.text);
            return {
              response: selectionContent.text,
              responseType: selectionContent.responseType,
              responsePayload: selectionContent.responsePayload,
              state: fsm.getState(),
              toolsUsed: [],
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }

          const choiceContent = buildPendingOrdersChoiceContent(memory.context.pendingOrderOptions);
          await this.storeMessage(sessionId, 'user', message, messageId);
          await this.storeMessage(sessionId, 'assistant', choiceContent.text);
          return {
            response: choiceContent.text,
            responseType: 'interactive-buttons',
            responsePayload: choiceContent.interactive,
            state: fsm.getState(),
            toolsUsed: [],
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }

        const decision = parsePendingOrderDecision(message);
        const pendingOrder = {
          id: memory.context.pendingOrderId,
          orderNumber: memory.context.pendingOrderNumber,
        };

        return await handlePendingOrderDecision(pendingOrder, decision);
      }

      // Direct cancel intent (without going through "Pedidos activos")
      if (!memory.context.pendingCancelOrderId && !memory.context.activeOrdersPrompt) {
        const cancelRequest = parseActiveOrderAction(message);
        if (cancelRequest?.action === 'cancel') {
          // If there's an in-progress cart (new order), treat "cancelar" as cancelling the current cart,
          // not as cancelling an existing awaiting-acceptance order.
          const cart = await this.memoryManager.getCart(sessionId);
          if (cart && cart.items.length > 0 && !memory.context.editingOrderId) {
            const response = 'No hay problema, si luego quieres hacer un pedido escribe menu!';
            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.memoryManager.clearPendingConfirmation(sessionId);
            await this.memoryManager.clearCart(sessionId);
            memory.cart = null;
            memory.pendingConfirmation = null;
            memory.state = AgentState.IDLE;
            resetOrderFlowContext(memory);
            await this.memoryManager.saveSession(memory);

            if (fsm.canTransition(AgentState.IDLE)) {
              fsm.transition(AgentState.IDLE);
              await this.memoryManager.updateState(sessionId, AgentState.IDLE);
            }

            await this.storeMessage(sessionId, 'assistant', response);
            await this.prisma.agentSession.updateMany({
              where: { id: sessionId, workspaceId },
              data: { currentState: AgentState.IDLE, lastActivityAt: new Date() },
            });

            return {
              response,
              state: AgentState.IDLE,
              toolsUsed: [],
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }

          const awaitingOrders = await this.prisma.order.findMany({
            where: withVisibleOrders({
              workspaceId,
              customerId,
              status: 'awaiting_acceptance',
            }),
            orderBy: { createdAt: 'desc' },
            select: { id: true, orderNumber: true },
          });

          if (awaitingOrders.length === 0) {
            const response = 'No hay pedidos esperando aprobación para cancelar.';
            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', response);
            return {
              response,
              state: fsm.getState(),
              toolsUsed: [],
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }

          if (cancelRequest.orderNumber) {
            const matchResult = resolveAwaitingOrder(cancelRequest.orderNumber, awaitingOrders);
            if (matchResult.order) {
              memory.context.pendingCancelOrderId = matchResult.order.id;
              memory.context.pendingCancelOrderNumber = matchResult.order.orderNumber;
              await this.memoryManager.saveSession(memory);

              const confirmContent = buildCancelOrderConfirmation(matchResult.order.orderNumber);
              await this.storeMessage(sessionId, 'user', message, messageId);
              await this.storeMessage(sessionId, 'assistant', confirmContent.text);

              return {
                response: confirmContent.text,
                responseType: 'interactive-buttons',
                responsePayload: confirmContent.interactive,
                state: fsm.getState(),
                toolsUsed: [],
                tokensUsed: 0,
                shouldSendMessage: true,
              };
            }
          }

          if (awaitingOrders.length === 1) {
            const onlyOrder = awaitingOrders[0];
            memory.context.pendingCancelOrderId = onlyOrder.id;
            memory.context.pendingCancelOrderNumber = onlyOrder.orderNumber;
            await this.memoryManager.saveSession(memory);

            const confirmContent = buildCancelOrderConfirmation(onlyOrder.orderNumber);
            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', confirmContent.text);

            return {
              response: confirmContent.text,
              responseType: 'interactive-buttons',
              responsePayload: confirmContent.interactive,
              state: fsm.getState(),
              toolsUsed: [],
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }

          memory.context.activeOrdersPrompt = true;
          memory.context.activeOrdersAction = 'cancel';
          memory.context.activeOrdersAwaiting = awaitingOrders.map((order) => ({
            id: order.id,
            orderNumber: order.orderNumber,
          }));
          memory.context.activeOrdersPayable = undefined;
          await this.memoryManager.saveSession(memory);

          const selectionContent = buildAwaitingOrderSelectionContent(
            memory.context.activeOrdersAwaiting,
            'cancel'
          );
          await this.storeMessage(sessionId, 'user', message, messageId);
          await this.storeMessage(sessionId, 'assistant', selectionContent.text);

          return {
            response: selectionContent.text,
            responseType: selectionContent.responseType,
            responsePayload: selectionContent.responsePayload,
            state: fsm.getState(),
            toolsUsed: [],
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }
      }

      if (
        fsm.getState() === AgentState.IDLE &&
        !memory.context.editingOrderId &&
        !memory.context.pendingOrderDecision
      ) {
        const decision = parsePendingOrderDecision(message);
        const parsed = parseQuantityMessage(messageForParsing);
        if (decision || parsed.segments.length > 0) {
          const awaitingOrders = await this.prisma.order.findMany({
            where: withVisibleOrders({
              workspaceId,
              customerId,
              status: 'awaiting_acceptance',
            }),
            orderBy: { createdAt: 'desc' },
            select: { id: true, orderNumber: true },
          });
          if (awaitingOrders.length > 0) {
            if (awaitingOrders.length > 1 && decision !== 'new' && decision !== 'back') {
              await this.storeMessage(sessionId, 'user', message, messageId);
              await this.memoryManager.clearPendingConfirmation(sessionId);
              await this.memoryManager.clearCart(sessionId);
              memory.pendingConfirmation = null;
              memory.cart = null;

              memory.context.pendingOrderDecision = true;
              memory.context.pendingOrderOptions = awaitingOrders.map((order) => ({
                id: order.id,
                orderNumber: order.orderNumber || undefined,
              }));
              memory.context.pendingOrderId = awaitingOrders[0].id;
              memory.context.pendingOrderNumber = awaitingOrders[0].orderNumber || undefined;
              await this.memoryManager.saveSession(memory);

              const choiceContent = buildPendingOrdersChoiceContent(memory.context.pendingOrderOptions);
              await this.storeMessage(sessionId, 'assistant', choiceContent.text);
              await this.prisma.agentSession.updateMany({
                where: { id: sessionId, workspaceId },
                data: { lastActivityAt: new Date(), agentActive: true },
              });

              return {
                response: choiceContent.text,
                responseType: 'interactive-buttons',
                responsePayload: choiceContent.interactive,
                state: fsm.getState(),
                toolsUsed: [],
                tokensUsed: 0,
                shouldSendMessage: true,
              };
            }

            const pendingOrder = awaitingOrders[0];
            return await handlePendingOrderDecision(pendingOrder, decision);
          }
        }
      }

      const shouldAttemptQuickParse =
        !skipQuickParse &&
        (QUICK_PARSE_ENABLED || shouldForceQuickParse(messageForParsing, fsm));
      const unitFollowUpValue = isUnitOnlyFollowUp(message) ? extractUnitValueFromMessage(message) : null;
      if (
        unitFollowUpValue &&
        memory.context.lastProductInquiry &&
        isRecentProductInquiry(memory.context.lastProductInquiry) &&
        fsm.getState() === AgentState.IDLE &&
        !memory.context.pendingOrderDecision &&
        !memory.context.pendingProductSelection &&
        !memory.context.pendingCancelOrderId &&
        !memory.context.activeOrdersPrompt &&
        !memory.context.pendingCatalogOffer &&
        !memory.context.paymentStage &&
        !memory.context.editingOrderId
      ) {
        const baseName = memory.context.lastProductInquiry.name;
        const query = `${baseName} ${unitFollowUpValue}`;
        const execution = await toolRegistry.execute(
          'search_products',
          { query, onlyInStock: true, limit: 5 },
          toolContext
        );
        toolsUsed.push(execution);
        const data = execution.result?.data as { products?: unknown } | undefined;
        const products = Array.isArray(data?.products) ? data?.products : [];
        let response = '';

        if (products.length === 0) {
          const fallbackExecution = await toolRegistry.execute(
            'search_products',
            { query: baseName, onlyInStock: true, limit: 5 },
            toolContext
          );
          toolsUsed.push(fallbackExecution);
          const matches = extractProductMatchesFromTools([fallbackExecution]);
          const menuLine = 'Si querés hacer un pedido, escribí menu para realizar un pedido.';
          if (matches.length > 0) {
            const options = matches.slice(0, 5).map((product) => {
              const priceText = formatPrice(product.price);
              return `• ${product.displayName}${priceText ? ` - ${priceText}` : ''}`;
            });
            response = [
              `No tengo ${baseName} de ${unitFollowUpValue}.`,
              'Tengo estas opciones:',
              ...options,
              '',
              '¿Cuál te interesa?',
              '',
              menuLine,
            ].join('\n');
          } else {
            response = [
              `No tengo ${baseName} de ${unitFollowUpValue}.`,
              '',
              menuLine,
            ].join('\n');
          }
        } else {
          response = applyProductInquiryFallback(
            'Si querés hacer un pedido, escribí menu para realizar un pedido.',
            message,
            toolsUsed,
            memory,
            fsm
          );
        }

        const updated = updateLastProductInquiry(message, toolsUsed, memory, fsm);
        if (updated) {
          await this.memoryManager.saveSession(memory);
        }

        await this.storeMessage(sessionId, 'user', message, messageId);
        await this.storeMessage(sessionId, 'assistant', response);

        await this.prisma.agentSession.updateMany({
          where: { id: sessionId, workspaceId },
          data: { currentState: fsm.getState(), lastActivityAt: new Date() },
        });

        return {
          response,
          state: fsm.getState(),
          toolsUsed,
          tokensUsed: 0,
          shouldSendMessage: true,
        };
      }
      if (shouldAttemptQuickParse) {
        const quickOrderResult = await this.tryQuickOrderParse(
          messageForParsing,
          toolContext,
          memory,
          fsm,
          messageId
        );
        if (quickOrderResult) {
          return quickOrderResult;
        }
      }

      // Handle order action buttons (confirm/edit/cancel) before LLM
      const orderAction =
        !memory.context.pendingOrderDecision &&
        !memory.context.activeOrdersPrompt &&
        !memory.context.pendingCancelOrderId
          ? parseOrderAction(message)
          : null;
      if (orderAction) {
        const cart = await this.memoryManager.getCart(sessionId);

        if (!cart || cart.items.length === 0) {
          const catalogDecision = parseCatalogOfferDecision(message);
          if (catalogDecision) {
            const lastAssistant = await this.prisma.agentMessage.findFirst({
              where: { sessionId, role: 'assistant' },
              orderBy: { createdAt: 'desc' },
              select: { content: true },
            });

            if (lastAssistant && isCatalogOfferResponse(lastAssistant.content)) {
              if (catalogDecision === 'back') {
                return respondWithPrimaryMenu();
              }

              if (catalogDecision === 'yes') {
                const execution = await toolRegistry.execute(
                  'send_catalog_pdf',
                  {},
                  toolContext
                );

                const response = execution.result.success
                  ? 'Te envío el catálogo para que veas lo que tenemos disponible. Decime qué querés agregar a tu pedido.'
                  : 'No pude enviar el catálogo. Decime qué otros productos querés agregar.';

                await this.storeMessage(sessionId, 'user', message, messageId);
                await this.storeMessage(sessionId, 'assistant', response);

                if (fsm.canTransition(AgentState.COLLECTING_ORDER)) {
                  fsm.transition(AgentState.COLLECTING_ORDER);
                  await this.memoryManager.updateState(sessionId, AgentState.COLLECTING_ORDER);
                }

                await this.prisma.agentSession.updateMany({
                  where: { id: sessionId, workspaceId },
                  data: { currentState: fsm.getState(), lastActivityAt: new Date() },
                });

                return {
                  response,
                  state: fsm.getState(),
                  toolsUsed: [execution],
                  tokensUsed: 0,
                  shouldSendMessage: true,
                };
              }

              if (catalogDecision === 'no') {
                const response = 'Perfecto. Decime qué otros productos querés agregar a tu pedido.';
                await this.storeMessage(sessionId, 'user', message, messageId);
                await this.storeMessage(sessionId, 'assistant', response);

                if (fsm.canTransition(AgentState.COLLECTING_ORDER)) {
                  fsm.transition(AgentState.COLLECTING_ORDER);
                  await this.memoryManager.updateState(sessionId, AgentState.COLLECTING_ORDER);
                }

                await this.prisma.agentSession.updateMany({
                  where: { id: sessionId, workspaceId },
                  data: { currentState: fsm.getState(), lastActivityAt: new Date() },
                });

                return {
                  response,
                  state: fsm.getState(),
                  toolsUsed: [],
                  tokensUsed: 0,
                  shouldSendMessage: true,
                };
              }
            }
          }

          const response = 'No hay un pedido en curso.';
          await this.storeMessage(sessionId, 'user', message, messageId);
          await this.storeMessage(sessionId, 'assistant', response);
          await this.prisma.agentSession.updateMany({
            where: { id: sessionId, workspaceId },
            data: { lastActivityAt: new Date() },
          });

          return {
            response,
            state: fsm.getState(),
            toolsUsed: [],
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }

        if (orderAction === 'edit') {
          const response = '¿Qué deseas editar sobre tu pedido?';
          await this.storeMessage(sessionId, 'user', message, messageId);
          await this.storeMessage(sessionId, 'assistant', response);

          if (fsm.canTransition(AgentState.COLLECTING_ORDER)) {
            fsm.transition(AgentState.COLLECTING_ORDER);
            await this.memoryManager.updateState(sessionId, AgentState.COLLECTING_ORDER);
          }

          await this.prisma.agentSession.updateMany({
            where: { id: sessionId, workspaceId },
            data: {
              currentState: fsm.getState(),
              lastActivityAt: new Date(),
            },
          });

          return {
            response,
            state: fsm.getState(),
            toolsUsed: [],
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }

        if (orderAction === 'cancel') {
          const wasEditingOrder = !!memory.context.editingOrderId;
          await this.memoryManager.clearCart(sessionId);
          if (wasEditingOrder) {
            memory.context.editingOrderId = undefined;
            memory.context.editingOrderNumber = undefined;
            memory.context.editingOrderOriginalItems = undefined;
            await this.memoryManager.saveSession(memory);
          }

          if (fsm.canTransition(AgentState.IDLE)) {
            fsm.transition(AgentState.IDLE);
            await this.memoryManager.updateState(sessionId, AgentState.IDLE);
          }

          const menuContent = buildPrimaryMenuContent();
          const response = wasEditingOrder ? 'Edición cancelada.' : 'Pedido cancelado.';
          await this.storeMessage(sessionId, 'user', message, messageId);
          await this.storeMessage(sessionId, 'assistant', response);
          memory.context.lastMenu = 'primary';
          await this.memoryManager.saveSession(memory);
          await this.prisma.agentSession.updateMany({
            where: { id: sessionId, workspaceId },
            data: {
              currentState: fsm.getState(),
              lastActivityAt: new Date(),
            },
          });

          return {
            response,
            responseType: 'interactive-buttons',
            responsePayload: {
              ...menuContent.interactive,
              body: `${response}\n\n${menuContent.interactive.body}`,
            },
            state: fsm.getState(),
            toolsUsed: [],
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }

        if (orderAction === 'confirm') {
          await this.storeMessage(sessionId, 'user', message, messageId);

          if (memory.context.editingOrderId) {
            const cart = await this.memoryManager.getCart(sessionId);
            const originalItems = memory.context.editingOrderOriginalItems || [];

            if (!cart) {
              const response = 'No hay cambios pendientes para confirmar.';
              await this.storeMessage(sessionId, 'assistant', response);
              return {
                response,
                state: fsm.getState(),
                toolsUsed: [],
                tokensUsed: 0,
                shouldSendMessage: true,
              };
            }

            const diff = buildOrderEditDiff(
              originalItems.map((item) => ({
                productId: item.productId,
                variantId: item.variantId,
                quantity: item.quantity,
              })),
              cart.items.map((item) => ({
                productId: item.productId,
                variantId: item.variantId,
                quantity: item.quantity,
              }))
            );

            if (diff.length === 0) {
              memory.context.editingOrderId = undefined;
              memory.context.editingOrderNumber = undefined;
              memory.context.editingOrderOriginalItems = undefined;
              memory.cart = null;
              await this.memoryManager.saveSession(memory);

              if (fsm.canTransition(AgentState.IDLE)) {
                fsm.transition(AgentState.IDLE);
                await this.memoryManager.updateState(sessionId, AgentState.IDLE);
              }

              const response = 'No había cambios. Tu pedido sigue igual.';
              await this.storeMessage(sessionId, 'assistant', response);
              await this.prisma.agentSession.updateMany({
                where: { id: sessionId, workspaceId },
                data: {
                  currentState: fsm.getState(),
                  lastActivityAt: new Date(),
                },
              });

              return {
                response,
                state: fsm.getState(),
                toolsUsed: [],
                tokensUsed: 0,
                shouldSendMessage: true,
              };
            }

            let errorMessage: string | undefined;
            let stockShortage = false;

            for (const action of diff) {
              const execution = await toolRegistry.execute(
                'modify_order_if_not_processed',
                {
                  orderId: memory.context.editingOrderId,
                  action: action.action,
                  productId: action.productId,
                  variantId: action.variantId,
                  quantity: action.quantity,
                },
                toolContext
              );

              toolsUsed.push(execution);

              if (!execution.result.success) {
                const insufficient = extractInsufficientStock(execution.result.data);
                if (insufficient.length > 0) {
                  memory.context.pendingStockAdjustment = { items: insufficient };
                  await this.memoryManager.saveSession(memory);
                  errorMessage = buildInsufficientStockMessage(insufficient);
                  stockShortage = true;
                } else {
                  errorMessage = execution.result.error || 'No pude modificar el pedido.';
                }
                break;
              }
            }

            if (errorMessage) {
              if (stockShortage && fsm.canTransition(AgentState.COLLECTING_ORDER)) {
                fsm.transition(AgentState.COLLECTING_ORDER);
                await this.memoryManager.updateState(sessionId, AgentState.COLLECTING_ORDER);
              }
              const response = errorMessage;
              await this.storeMessage(sessionId, 'assistant', response);
              await this.prisma.agentSession.updateMany({
                where: { id: sessionId, workspaceId },
                data: {
                  currentState: fsm.getState(),
                  lastActivityAt: new Date(),
                },
              });

              return {
                response,
                state: fsm.getState(),
                toolsUsed,
                tokensUsed: 0,
                shouldSendMessage: true,
              };
            }

            memory.context.editingOrderId = undefined;
            memory.context.editingOrderNumber = undefined;
            memory.context.editingOrderOriginalItems = undefined;
            memory.cart = null;
            await this.memoryManager.saveSession(memory);

            if (fsm.canTransition(AgentState.IDLE)) {
              fsm.transition(AgentState.IDLE);
              await this.memoryManager.updateState(sessionId, AgentState.IDLE);
            }

            const response = 'Perfecto, tu pedido se editó con éxito.';
            await this.storeMessage(sessionId, 'assistant', response);
            await this.prisma.agentSession.updateMany({
              where: { id: sessionId, workspaceId },
              data: {
                currentState: fsm.getState(),
                lastActivityAt: new Date(),
              },
            });

            return {
              response,
              state: fsm.getState(),
              toolsUsed,
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }

          const execution = await toolRegistry.execute(
            'confirm_order',
            {},
            toolContext
          );

          toolsUsed.push(execution);

          if (execution.result.stateTransition) {
            if (fsm.canTransition(execution.result.stateTransition)) {
              fsm.transition(execution.result.stateTransition);
              await this.memoryManager.updateState(sessionId, execution.result.stateTransition);
            }
          }

          const dataMessage = (execution.result.data as { message?: string } | undefined)?.message;
          let response = '';
          if (!execution.result.success) {
            const insufficient = extractInsufficientStock(execution.result.data);
            if (insufficient.length > 0) {
              memory.context.pendingStockAdjustment = { items: insufficient };
              await this.memoryManager.saveSession(memory);
              response = buildInsufficientStockMessage(insufficient);
              if (fsm.canTransition(AgentState.COLLECTING_ORDER)) {
                fsm.transition(AgentState.COLLECTING_ORDER);
                await this.memoryManager.updateState(sessionId, AgentState.COLLECTING_ORDER);
              }
            } else {
              response = execution.result.error || 'No pude confirmar el pedido.';
            }
          } else {
            response = dataMessage || 'Pedido confirmado.';

            const orderData = execution.result.data as { orderId?: string; orderNumber?: string } | undefined;
            let isWhatsappChannel = toolContext.channelType === 'whatsapp';
            if (!isWhatsappChannel) {
              const sessionRecord = await this.prisma.agentSession.findFirst({
                where: { id: sessionId, workspaceId },
                select: { channelType: true },
              });
              isWhatsappChannel = sessionRecord?.channelType === 'whatsapp';
            }

            let shouldPromptInvoice = false;
            if (isWhatsappChannel && orderData?.orderId) {
              const workspacePlan = await this.prisma.workspace.findUnique({
                where: { id: workspaceId },
                select: { plan: true, settings: true },
              });
              const workspaceSettingsForPlan =
                (workspacePlan?.settings as Record<string, unknown> | undefined) || {};
              const plan = resolveCommercePlan({
                workspacePlan: workspacePlan?.plan,
                settingsPlan: workspaceSettingsForPlan.commercePlan,
                fallback: 'pro',
              });
              shouldPromptInvoice = getCommercePlanCapabilities(plan).askInvoiceAfterOrder;
            }

            if (isWhatsappChannel && orderData?.orderId && shouldPromptInvoice) {
              const promptBody = `${response}\n\n¿Necesitás factura para tu pedido?`;
              const freshMemory = await this.memoryManager.getSession(sessionId);
              const targetMemory = freshMemory ?? memory;
              targetMemory.context.pendingInvoicePrompt = {
                orderId: orderData.orderId,
                orderNumber: orderData.orderNumber || '',
              };
              targetMemory.state = fsm.getState();
              await this.memoryManager.saveSession(targetMemory);

              await this.storeMessage(sessionId, 'assistant', promptBody);
              await this.prisma.agentSession.updateMany({
                where: { id: sessionId, workspaceId },
                data: {
                  currentState: fsm.getState(),
                  lastActivityAt: new Date(),
                },
              });

              return {
                response: promptBody,
                responseType: 'interactive-buttons',
                responsePayload: {
                  body: promptBody,
                  buttons: [
                    { id: 'invoice_yes', title: 'Sí' },
                    { id: 'invoice_no', title: 'No' },
                  ],
                },
                state: fsm.getState(),
                toolsUsed,
                tokensUsed: 0,
                shouldSendMessage: true,
              };
            }
          }

          await this.storeMessage(sessionId, 'assistant', response);
          await this.prisma.agentSession.updateMany({
            where: { id: sessionId, workspaceId },
            data: {
              currentState: fsm.getState(),
              lastActivityAt: new Date(),
            },
          });

          return {
            response,
            state: fsm.getState(),
            toolsUsed,
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }
      }

      // Load workspace settings (for commerce name/profile)
      const workspace = await this.prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { name: true, settings: true },
      });
      const workspaceSettings = (workspace?.settings as Record<string, unknown>) || {};
      const commerceName =
        (workspaceSettings.businessName as string) ||
        'Tu Comercio';

      // Strict registration flow (no phone request, no guessing)
      const customerRecord = await this.prisma.customer.findFirst({
        where: { id: customerId, workspaceId },
        select: { firstName: true, lastName: true, metadata: true },
      });
      const customerMetadata = (customerRecord?.metadata as Record<string, unknown>) || {};
      const dni = typeof customerMetadata.dni === 'string' ? customerMetadata.dni : undefined;
      const needsRegistration = !customerRecord?.firstName || !customerRecord?.lastName || !dni;

      // Always refresh last seen
      await this.prisma.customer.updateMany({
        where: { id: customerId, workspaceId },
        data: { lastSeenAt: new Date() },
      });

      if (needsRegistration) {
        const pending = memory.context.pendingRegistration || {};
        const extracted = extractRegistrationParts(message);
        const merged = { ...pending, ...extracted };
        const hasFullName = !!(merged.firstName && merged.lastName);
        const hasDni = !!merged.dni;

        if (hasFullName && hasDni) {
          await toolRegistry.execute(
            'update_customer_info',
            {
              firstName: merged.firstName,
              lastName: merged.lastName,
              dni: merged.dni,
            },
            toolContext
          );
        }

        if (hasFullName && hasDni) {
          memory.context.pendingRegistration = undefined;
          memory.context.lastMenu = 'primary';
        } else {
          memory.context.pendingRegistration = merged;
        }
        await this.memoryManager.saveSession(memory);

        const menuContent = hasFullName && hasDni ? buildPrimaryMenuContent() : null;
        const response = hasFullName && hasDni
          ? buildRegisteredMessage(
              `${merged.firstName} ${merged.lastName}`.trim(),
              menuContent!.text
            )
          : buildNewCustomerMessage();

        await this.storeMessage(sessionId, 'user', message, messageId);
        await this.storeMessage(sessionId, 'assistant', response);

        await this.prisma.agentSession.updateMany({
          where: { id: sessionId, workspaceId },
          data: {
            currentState: hasFullName && hasDni ? AgentState.IDLE : AgentState.NEEDS_DETAILS,
            lastActivityAt: new Date(),
            agentActive: true,
          },
        });
        await this.memoryManager.updateState(
          sessionId,
          hasFullName && hasDni ? AgentState.IDLE : AgentState.NEEDS_DETAILS
        );

        return {
          response,
          responseType: hasFullName && hasDni ? 'interactive-buttons' : undefined,
          responsePayload: menuContent?.interactive,
          state: hasFullName && hasDni ? AgentState.IDLE : AgentState.NEEDS_DETAILS,
          toolsUsed: [],
          tokensUsed: 0,
          shouldSendMessage: true,
        };
      }

      if (memory.context.pendingCancelOrderId && memory.context.pendingCancelOrderNumber) {
        const cancelDecision = parseCancelDecision(message);
        const cancelOrderId = memory.context.pendingCancelOrderId;
        const cancelOrderNumber = memory.context.pendingCancelOrderNumber;

        if (cancelDecision === null) {
          const confirmContent = buildCancelOrderConfirmation(cancelOrderNumber);
          await this.storeMessage(sessionId, 'user', message, messageId);
          await this.storeMessage(sessionId, 'assistant', confirmContent.text);

          return {
            response: confirmContent.text,
            responseType: 'interactive-buttons',
            responsePayload: confirmContent.interactive,
            state: fsm.getState(),
            toolsUsed: [],
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }

        if (cancelDecision === false) {
          memory.context.pendingCancelOrderId = undefined;
          memory.context.pendingCancelOrderNumber = undefined;
          memory.context.lastMenu = 'primary';
          await this.memoryManager.saveSession(memory);

          const menuContent = buildPrimaryMenuContent();
          const response = 'Perfecto, no cancelo el pedido.';
          await this.storeMessage(sessionId, 'user', message, messageId);
          await this.storeMessage(sessionId, 'assistant', response);

          return {
            response,
            responseType: 'interactive-buttons',
            responsePayload: {
              ...menuContent.interactive,
              body: `${response}\n\n${menuContent.interactive.body}`,
            },
            state: fsm.getState(),
            toolsUsed: [],
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }

        memory.context.pendingCancelOrderId = undefined;
        memory.context.pendingCancelOrderNumber = undefined;
        await this.memoryManager.saveSession(memory);

        const execution = await toolRegistry.execute(
          'cancel_order_if_not_processed',
          {
            orderId: cancelOrderId,
            reason: 'Cancelado por cliente',
          },
          toolContext
        );
        toolsUsed.push(execution);

        const cancelResponse = execution.result.success
          ? `Listo, tu pedido ${cancelOrderNumber} fue cancelado con éxito.`
          : execution.result.error || 'No pude cancelar el pedido.';

        const menuContent = buildPrimaryMenuContent();
        const response = cancelResponse;

        await this.storeMessage(sessionId, 'user', message, messageId);
        await this.storeMessage(sessionId, 'assistant', response);
        memory.context.lastMenu = 'primary';
        await this.memoryManager.saveSession(memory);

        return {
          response,
          responseType: 'interactive-buttons',
          responsePayload: {
            ...menuContent.interactive,
            body: `${response}\n\n${menuContent.interactive.body}`,
          },
          state: fsm.getState(),
          toolsUsed,
          tokensUsed: 0,
          shouldSendMessage: true,
        };
      }

      if (memory.context.activeOrdersPrompt) {
        if (isReturnToMenu(message) || isMenuRequest(message)) {
          memory.context.activeOrdersPrompt = undefined;
          memory.context.activeOrdersAction = undefined;
          memory.context.activeOrdersAwaiting = undefined;
          memory.context.activeOrdersPayable = undefined;
          memory.context.activeOrdersSubmenu = undefined;
          memory.context.activeOrdersInvoiceOptions = undefined;
          memory.context.lastMenu = 'primary';
          await this.memoryManager.saveSession(memory);

          const menuContent = buildPrimaryMenuContent();
          await this.storeMessage(sessionId, 'user', message, messageId);
          await this.storeMessage(sessionId, 'assistant', menuContent.text);

          return {
            response: menuContent.text,
            responseType: 'interactive-buttons',
            responsePayload: menuContent.interactive,
            state: fsm.getState(),
            toolsUsed: [],
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }

        if (isAcknowledgement(message)) {
          memory.context.activeOrdersPrompt = undefined;
          memory.context.activeOrdersAction = undefined;
          memory.context.activeOrdersAwaiting = undefined;
          memory.context.activeOrdersPayable = undefined;
          memory.context.activeOrdersSubmenu = undefined;
          memory.context.activeOrdersInvoiceOptions = undefined;
          memory.context.lastMenu = 'primary';
          await this.memoryManager.saveSession(memory);

          const menuContent = buildPrimaryMenuContent();
          await this.storeMessage(sessionId, 'user', message, messageId);
          await this.storeMessage(sessionId, 'assistant', menuContent.text);

          return {
            response: menuContent.text,
            responseType: 'interactive-buttons',
            responsePayload: menuContent.interactive,
            state: fsm.getState(),
            toolsUsed: [],
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }

        let request = parseActiveOrderAction(message);
        const awaitingOrders = memory.context.activeOrdersAwaiting || [];
        const payableOrders = memory.context.activeOrdersPayable || [];
        const selectionAction = memory.context.activeOrdersAction;
        const invoiceOptions = memory.context.activeOrdersInvoiceOptions || [];
        const isOtherMenu = memory.context.activeOrdersSubmenu === 'other';

        if (request?.action === 'other') {
          const otherContent = buildActiveOrdersOtherContent();
          memory.context.activeOrdersSubmenu = 'other';
          await this.memoryManager.saveSession(memory);
          await this.storeMessage(sessionId, 'user', message, messageId);
          await this.storeMessage(sessionId, 'assistant', otherContent.text);

          return {
            response: otherContent.text,
            responseType: 'interactive-buttons',
            responsePayload: otherContent.interactive,
            state: fsm.getState(),
            toolsUsed: [],
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }

        if (isOtherMenu) {
          if (!request) {
            const otherContent = buildActiveOrdersOtherContent();
            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', otherContent.text);

            return {
              response: otherContent.text,
              responseType: 'interactive-buttons',
              responsePayload: otherContent.interactive,
              state: fsm.getState(),
              toolsUsed: [],
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }

          if (request.action === 'cancel' || request.action === 'invoice') {
            memory.context.activeOrdersSubmenu = undefined;
            await this.memoryManager.saveSession(memory);
          }
        }

        if (!request && selectionAction) {
          if (selectionAction === 'invoice') {
            if (!invoiceOptions.length) {
              memory.context.activeOrdersAction = undefined;
              memory.context.activeOrdersPrompt = undefined;
              memory.context.activeOrdersAwaiting = undefined;
              memory.context.activeOrdersPayable = undefined;
              memory.context.activeOrdersSubmenu = undefined;
              memory.context.activeOrdersInvoiceOptions = undefined;
              await this.memoryManager.saveSession(memory);

              const response = 'No encontré pedidos recientes para facturar.';
              await this.storeMessage(sessionId, 'user', message, messageId);
              await this.storeMessage(sessionId, 'assistant', response);

              return {
                response,
                state: fsm.getState(),
                toolsUsed: [],
                tokensUsed: 0,
                shouldSendMessage: true,
              };
            }

            const selection = parseInvoiceRequestSelection(message, invoiceOptions);
            if (!selection.order) {
              const selectionContent = buildInvoiceRequestSelectionContent(invoiceOptions);
              const response = selection.ambiguous
                ? [
                    'Hay más de un pedido que coincide con ese número.',
                    'Seleccioná el pedido correcto:',
                    '',
                    selectionContent.text,
                  ].join('\n')
                : selectionContent.text;

              await this.storeMessage(sessionId, 'user', message, messageId);
              await this.storeMessage(sessionId, 'assistant', response);

              return {
                response,
                responseType: selectionContent.responseType,
                responsePayload: selectionContent.responsePayload,
                state: fsm.getState(),
                toolsUsed: [],
                tokensUsed: 0,
                shouldSendMessage: true,
              };
            }

            const selected = await this.prisma.order.findFirst({
              where: withVisibleOrders({
                id: selection.order.id,
                workspaceId,
                customerId,
              }),
              select: { id: true, orderNumber: true, status: true },
            });

            if (!selected) {
              const response = 'No encontré ese pedido para solicitar la factura.';
              await this.storeMessage(sessionId, 'user', message, messageId);
              await this.storeMessage(sessionId, 'assistant', response);

              return {
                response,
                state: fsm.getState(),
                toolsUsed: [],
                tokensUsed: 0,
                shouldSendMessage: true,
              };
            }

            if (['pending_invoicing', 'invoiced'].includes(selected.status)) {
              const selectionContent = buildInvoiceRequestSelectionContent(invoiceOptions);
              const response = [
                'Ese pedido ya tiene una solicitud de factura.',
                '',
                selectionContent.text,
              ].join('\n');

              await this.storeMessage(sessionId, 'user', message, messageId);
              await this.storeMessage(sessionId, 'assistant', response);

              return {
                response,
                responseType: selectionContent.responseType,
                responsePayload: selectionContent.responsePayload,
                state: fsm.getState(),
                toolsUsed: [],
                tokensUsed: 0,
                shouldSendMessage: true,
              };
            }

            const customer = await this.prisma.customer.findFirst({
              where: { id: customerId, workspaceId },
              select: {
                cuit: true,
                businessName: true,
                fiscalAddress: true,
                vatCondition: true,
              },
            });

            const data = {
              cuit: customer?.cuit || undefined,
              businessName: customer?.businessName || undefined,
              fiscalAddress: customer?.fiscalAddress || undefined,
              vatCondition: customer?.vatCondition || undefined,
            };

            const nextField = getFirstMissingInvoiceField(data);

            memory.context.activeOrdersPrompt = undefined;
            memory.context.activeOrdersAction = undefined;
            memory.context.activeOrdersAwaiting = undefined;
            memory.context.activeOrdersPayable = undefined;
            memory.context.activeOrdersSubmenu = undefined;
            memory.context.activeOrdersInvoiceOptions = undefined;

            if (nextField) {
              memory.context.invoiceDataCollection = {
                orderId: selected.id,
                orderNumber: selected.orderNumber,
                step: nextField,
                data,
                vatPage: 0,
              };
              await this.memoryManager.saveSession(memory);
              const prompt = buildInvoiceFieldPromptContent(nextField, 'initial', { vatPage: 0 });
              await this.storeMessage(sessionId, 'user', message, messageId);
              await this.storeMessage(sessionId, 'assistant', prompt.text);

              return {
                response: prompt.text,
                responseType: prompt.responseType,
                responsePayload: prompt.responsePayload,
                state: fsm.getState(),
                toolsUsed: [],
                tokensUsed: 0,
                shouldSendMessage: true,
              };
            }

            await this.prisma.$transaction([
              this.prisma.order.updateMany({
                where: { id: selected.id, workspaceId },
                data: { status: 'pending_invoicing' },
              }),
              this.prisma.orderStatusHistory.create({
                data: {
                  orderId: selected.id,
                  previousStatus: selected.status,
                  newStatus: 'pending_invoicing',
                  reason: 'Solicitud de factura desde pedidos activos',
                  changedBy: 'customer',
                },
              }),
            ]);

            await this.memoryManager.saveSession(memory);
            const response = `Listo recibimos tu solicitud de factura por el ${selected.orderNumber}`;
            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', response);

            return {
              response,
              state: fsm.getState(),
              toolsUsed: [],
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }

          if (!awaitingOrders.length) {
            memory.context.activeOrdersAction = undefined;
            memory.context.activeOrdersPrompt = undefined;
            memory.context.activeOrdersAwaiting = undefined;
            memory.context.activeOrdersPayable = undefined;
            memory.context.activeOrdersSubmenu = undefined;
            memory.context.activeOrdersInvoiceOptions = undefined;
            await this.memoryManager.saveSession(memory);

            const response = 'No hay pedidos esperando aprobación para editar o cancelar.';
            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', response);

            return {
              response,
              state: fsm.getState(),
              toolsUsed: [],
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }

          const selection = parseActiveOrderSelection(message, awaitingOrders);
          if (selection.order) {
            request = {
              action: selectionAction,
              orderNumber: selection.order.orderNumber,
              orderId: selection.order.id,
            };
          } else {
            const selectionContent = buildAwaitingOrderSelectionContent(awaitingOrders, selectionAction);
            const response = selection.ambiguous
              ? [
                  'Hay más de un pedido que coincide con ese número.',
                  'Seleccioná el pedido correcto:',
                  '',
                  selectionContent.text,
                ].join('\n')
              : selectionContent.text;

            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', response);

            return {
              response,
              responseType: selectionContent.responseType,
              responsePayload: selectionContent.responsePayload,
              state: fsm.getState(),
              toolsUsed: [],
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }
        }

        if (!request) {
          const response = [
            '¿Qué querés hacer?',
            'Podés elegir una opción o escribir el número de pedido.',
          ].join('\n');

          await this.storeMessage(sessionId, 'user', message, messageId);
          await this.storeMessage(sessionId, 'assistant', response);

          return {
            response,
            state: fsm.getState(),
            toolsUsed: [],
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }

        if (request.action === 'pay') {
          memory.context.activeOrdersAction = undefined;
          memory.context.activeOrdersSubmenu = undefined;
          memory.context.activeOrdersInvoiceOptions = undefined;
          const commerceSettings = (await this.loadCommerceProfile(workspaceId)) as Record<string, unknown>;
          const paymentOptions = resolvePaymentMethodsEnabled(commerceSettings);
          const hasPaymentOption = paymentOptions.mpLink || paymentOptions.transfer || paymentOptions.cash;

          if (!hasPaymentOption) {
            const response = 'No hay métodos de pago habilitados en este momento.';
            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', response);

            return {
              response,
              state: fsm.getState(),
              toolsUsed: [],
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }

          if (!payableOrders.length) {
            const response = 'No tenés pedidos con saldo pendiente.';
            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', response);

            return {
              response,
              state: fsm.getState(),
              toolsUsed: [],
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }

          if (!request.orderNumber) {
            if (payableOrders.length === 1) {
              const onlyOrder = payableOrders[0];
              memory.context.activeOrdersPrompt = undefined;
              memory.context.activeOrdersAction = undefined;
              memory.context.activeOrdersAwaiting = undefined;
              memory.context.activeOrdersPayable = undefined;
              memory.context.activeOrdersSubmenu = undefined;
              memory.context.activeOrdersInvoiceOptions = undefined;
              memory.context.paymentOrders = payableOrders;
              memory.context.paymentOrderId = onlyOrder.id;
              memory.context.paymentOrderNumber = onlyOrder.orderNumber;
              memory.context.paymentPendingAmount = onlyOrder.pendingAmount;
              memory.context.paymentStage = 'select_method';
              await this.memoryManager.saveSession(memory);

              const methodContent = buildPaymentMethodContent(
                onlyOrder.orderNumber,
                onlyOrder.pendingAmount,
                paymentOptions
              );
              await this.storeMessage(sessionId, 'user', message, messageId);
              await this.storeMessage(sessionId, 'assistant', methodContent.text);

              return {
                response: methodContent.text,
                responseType: 'interactive-buttons',
                responsePayload: methodContent.interactive,
                state: fsm.getState(),
                toolsUsed: [],
                tokensUsed: 0,
                shouldSendMessage: true,
              };
            }

            memory.context.activeOrdersPrompt = undefined;
            memory.context.activeOrdersAction = undefined;
            memory.context.activeOrdersAwaiting = undefined;
            memory.context.activeOrdersPayable = undefined;
            memory.context.activeOrdersSubmenu = undefined;
            memory.context.activeOrdersInvoiceOptions = undefined;
            memory.context.paymentStage = 'select_order';
            memory.context.paymentOrders = payableOrders;
            await this.memoryManager.saveSession(memory);

            const selectionContent = buildPaymentOrderSelectionContent(payableOrders);
            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', selectionContent.text);

            return {
              response: selectionContent.text,
              responseType: selectionContent.responseType,
              responsePayload: selectionContent.responsePayload,
              state: fsm.getState(),
              toolsUsed: [],
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }

          const matchResult = resolveAwaitingOrder(request.orderNumber, payableOrders);
          const orderMatch = matchResult.order;

          if (!orderMatch) {
            const pendingList = payableOrders.map((o) => `• ${o.orderNumber}`);
            const response = matchResult.ambiguous
              ? [
                  'Hay más de un pedido que coincide con ese número.',
                  'Por favor escribí el número completo (por ejemplo: "Pagar ORD-00008").',
                  ...pendingList,
                ].join('\n')
              : [
                  'No encontré ese pedido con saldo pendiente.',
                  pendingList.length ? 'Pedidos disponibles:' : '',
                  ...pendingList,
                ]
                  .filter(Boolean)
                  .join('\n');

            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', response);

            return {
              response,
              state: fsm.getState(),
              toolsUsed: [],
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }

          memory.context.activeOrdersPrompt = undefined;
          memory.context.activeOrdersAction = undefined;
          memory.context.activeOrdersAwaiting = undefined;
          memory.context.activeOrdersPayable = undefined;
          memory.context.activeOrdersSubmenu = undefined;
          memory.context.activeOrdersInvoiceOptions = undefined;
          memory.context.paymentOrders = payableOrders;
          memory.context.paymentOrderId = orderMatch.id;
          memory.context.paymentOrderNumber = orderMatch.orderNumber;
          memory.context.paymentPendingAmount = orderMatch.pendingAmount;
          memory.context.paymentStage = 'select_method';
          await this.memoryManager.saveSession(memory);

          const methodContent = buildPaymentMethodContent(
            orderMatch.orderNumber,
            orderMatch.pendingAmount,
            paymentOptions
          );
          await this.storeMessage(sessionId, 'user', message, messageId);
          await this.storeMessage(sessionId, 'assistant', methodContent.text);

          return {
            response: methodContent.text,
            responseType: 'interactive-buttons',
            responsePayload: methodContent.interactive,
            state: fsm.getState(),
            toolsUsed: [],
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }

        if (request.action === 'invoice') {
          const recentOrders = await this.prisma.order.findMany({
            where: withVisibleOrders({
              workspaceId,
              customerId,
              status: { notIn: ['draft', 'pending_invoicing', 'invoiced'] },
            }),
            orderBy: { createdAt: 'desc' },
            take: 5,
            select: { id: true, orderNumber: true },
          });

          if (!recentOrders.length) {
            const response = 'No encontré pedidos recientes para facturar.';
            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', response);

            return {
              response,
              state: fsm.getState(),
              toolsUsed: [],
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }

          memory.context.activeOrdersAction = 'invoice';
          memory.context.activeOrdersInvoiceOptions = recentOrders.map((order) => ({
            id: order.id,
            orderNumber: order.orderNumber,
          }));
          await this.memoryManager.saveSession(memory);

          const selectionContent = buildInvoiceRequestSelectionContent(memory.context.activeOrdersInvoiceOptions);
          await this.storeMessage(sessionId, 'user', message, messageId);
          await this.storeMessage(sessionId, 'assistant', selectionContent.text);

          return {
            response: selectionContent.text,
            responseType: selectionContent.responseType,
            responsePayload: selectionContent.responsePayload,
            state: fsm.getState(),
            toolsUsed: [],
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }

        if (!request.orderNumber && !request.orderId) {
          if (!awaitingOrders.length) {
            const response = 'No hay pedidos esperando aprobación para editar o cancelar.';
            memory.context.activeOrdersAction = undefined;
            memory.context.activeOrdersSubmenu = undefined;
            memory.context.activeOrdersInvoiceOptions = undefined;
            await this.memoryManager.saveSession(memory);
            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', response);

            return {
              response,
              state: fsm.getState(),
              toolsUsed: [],
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }

          memory.context.activeOrdersAction = request.action === 'cancel' ? 'cancel' : 'edit';
          await this.memoryManager.saveSession(memory);

          const selectionContent = buildAwaitingOrderSelectionContent(awaitingOrders, memory.context.activeOrdersAction);
          await this.storeMessage(sessionId, 'user', message, messageId);
          await this.storeMessage(sessionId, 'assistant', selectionContent.text);

          return {
            response: selectionContent.text,
            responseType: selectionContent.responseType,
            responsePayload: selectionContent.responsePayload,
            state: fsm.getState(),
            toolsUsed: [],
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }

        const matchResult = resolveActiveOrderSelection(request, awaitingOrders);
        const orderMatch = matchResult.order;

        if (!orderMatch) {
          const pendingList = awaitingOrders.map((o) => `• ${o.orderNumber}`);
          const response = matchResult.ambiguous
            ? [
                'Hay más de un pedido que coincide con ese número.',
                'Por favor escribí el número completo (por ejemplo: "Editar ORD-00008").',
                ...pendingList,
              ].join('\n')
            : [
                'Solo podés editar o cancelar pedidos que estén esperando aprobación.',
                pendingList.length ? 'Pedidos disponibles:' : '',
                ...pendingList,
              ]
                .filter(Boolean)
                .join('\n');
          await this.storeMessage(sessionId, 'user', message, messageId);
          await this.storeMessage(sessionId, 'assistant', response);

          return {
            response,
            state: fsm.getState(),
            toolsUsed: [],
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }

        memory.context.activeOrdersPrompt = undefined;
        memory.context.activeOrdersAction = undefined;
        memory.context.activeOrdersAwaiting = undefined;
        memory.context.activeOrdersPayable = undefined;
        await this.memoryManager.saveSession(memory);

        if (request.action === 'cancel') {
          memory.context.pendingCancelOrderId = orderMatch.id;
          memory.context.pendingCancelOrderNumber = orderMatch.orderNumber;
          await this.memoryManager.saveSession(memory);

          const confirmContent = buildCancelOrderConfirmation(orderMatch.orderNumber);
          await this.storeMessage(sessionId, 'user', message, messageId);
          await this.storeMessage(sessionId, 'assistant', confirmContent.text);

          return {
            response: confirmContent.text,
            responseType: 'interactive-buttons',
            responsePayload: confirmContent.interactive,
            state: fsm.getState(),
            toolsUsed: [],
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }

        const order = await this.prisma.order.findFirst({
          where: withVisibleOrders({
            id: orderMatch.id,
            workspaceId,
            customerId,
            status: 'awaiting_acceptance',
          }),
          include: { items: true },
        });

        if (!order) {
          const response = 'No encontré ese pedido para editar.';
          await this.storeMessage(sessionId, 'user', message, messageId);
          await this.storeMessage(sessionId, 'assistant', response);

          return {
            response,
            state: fsm.getState(),
            toolsUsed: [],
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }

        const cartItems = order.items.map((item) => ({
          productId: item.productId,
          ...(item.variantId ? { variantId: item.variantId } : {}),
          sku: item.sku,
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.total,
          availableStock: 0,
        }));

        memory.cart = {
          sessionId,
          workspaceId,
          customerId,
          items: cartItems,
          subtotal: order.subtotal,
          shipping: order.shipping,
          discount: order.discount,
          total: order.total,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        memory.context.editingOrderId = order.id;
        memory.context.editingOrderNumber = order.orderNumber;
        memory.context.editingOrderOriginalItems = order.items.map((item) => ({
          productId: item.productId,
          variantId: item.variantId ?? undefined,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          name: item.name,
        }));
        await this.memoryManager.saveSession(memory);

        if (fsm.canTransition(AgentState.COLLECTING_ORDER)) {
          fsm.transition(AgentState.COLLECTING_ORDER);
          await this.memoryManager.updateState(sessionId, AgentState.COLLECTING_ORDER);
        }

        let response = '';
        const shouldSendPdf = order.items.length > LONG_ORDER_SUMMARY_THRESHOLD;
        if (shouldSendPdf) {
          const execution = await toolRegistry.execute(
            'send_order_pdf',
            { orderId: order.id },
            toolContext
          );
          toolsUsed.push(execution);
          response = execution.result.success
            ? `🛒 Te envié el resumen del pedido ${order.orderNumber} en PDF.\nDime si quieres agregar o sacar algo.`
            : buildExistingOrderSummaryMessage({
                orderNumber: order.orderNumber,
                items: order.items.map((item) => ({
                  name: item.name,
                  quantity: item.quantity,
                  total: item.total,
                })),
                total: order.total,
              });
        } else {
          response = buildExistingOrderSummaryMessage({
            orderNumber: order.orderNumber,
            items: order.items.map((item) => ({
              name: item.name,
              quantity: item.quantity,
              total: item.total,
            })),
            total: order.total,
          });
        }

        await this.storeMessage(sessionId, 'user', message, messageId);
        await this.storeMessage(sessionId, 'assistant', response);

        await this.prisma.agentSession.updateMany({
          where: { id: sessionId, workspaceId },
          data: {
            currentState: AgentState.COLLECTING_ORDER,
            lastActivityAt: new Date(),
            agentActive: true,
          },
        });

        return {
          response,
          state: AgentState.COLLECTING_ORDER,
          toolsUsed,
          tokensUsed: 0,
          shouldSendMessage: true,
        };
      }

      const repeatAction = parseRepeatOrderAction(message);
      if (repeatAction) {
        if (repeatAction.action === 'back') {
          const recentOrders = memory.context.repeatOrders?.length
            ? memory.context.repeatOrders
            : await this.prisma.order.findMany({
                where: withVisibleOrders({
                  workspaceId,
                  customerId,
                  status: { notIn: ['cancelled', 'draft'] },
                }),
                orderBy: { createdAt: 'desc' },
                take: 3,
                select: { id: true, orderNumber: true },
              });

          if (recentOrders.length === 0) {
            const response = 'No encontré pedidos anteriores para rehacer.';
            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', response);
            return {
              response,
              state: fsm.getState(),
              toolsUsed: [],
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }

          memory.context.repeatOrders = recentOrders.map((order) => ({
            id: order.id,
            orderNumber: order.orderNumber,
          }));
          memory.context.repeatOrderId = undefined;
          memory.context.repeatOrderNumber = undefined;
          await this.memoryManager.saveSession(memory);

          const selectionContent = buildRepeatOrderSelectionContent(memory.context.repeatOrders);
          await this.storeMessage(sessionId, 'user', message, messageId);
          await this.storeMessage(sessionId, 'assistant', selectionContent.text);

          return {
            response: selectionContent.text,
            responseType: selectionContent.responseType,
            responsePayload: selectionContent.responsePayload,
            state: fsm.getState(),
            toolsUsed: [],
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }

        if (!repeatAction.orderId) {
          const response = 'No encontré ese pedido.';
          await this.storeMessage(sessionId, 'user', message, messageId);
          await this.storeMessage(sessionId, 'assistant', response);
          return {
            response,
            state: fsm.getState(),
            toolsUsed: [],
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }

        const order = await this.prisma.order.findFirst({
          where: withVisibleOrders({
            id: repeatAction.orderId,
            workspaceId,
            customerId,
          }),
          include: { items: true },
        });

        if (!order) {
          const response = 'No encontré ese pedido.';
          await this.storeMessage(sessionId, 'user', message, messageId);
          await this.storeMessage(sessionId, 'assistant', response);
          return {
            response,
            state: fsm.getState(),
            toolsUsed: [],
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }

        if (repeatAction.action === 'edit') {
          const cartItems = order.items.map((item) => ({
            productId: item.productId,
            ...(item.variantId ? { variantId: item.variantId } : {}),
            sku: item.sku,
            name: item.name,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            total: item.total,
            availableStock: 0,
          }));

          memory.cart = {
            sessionId,
            workspaceId,
            customerId,
            items: cartItems,
            subtotal: order.subtotal,
            shipping: order.shipping,
            discount: order.discount,
            total: order.total,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          memory.context.editingOrderId = undefined;
          memory.context.editingOrderNumber = undefined;
          memory.context.editingOrderOriginalItems = undefined;
          await this.memoryManager.saveSession(memory);

          if (fsm.canTransition(AgentState.COLLECTING_ORDER)) {
            fsm.transition(AgentState.COLLECTING_ORDER);
            await this.memoryManager.updateState(sessionId, AgentState.COLLECTING_ORDER);
          }

          const response = buildExistingOrderSummaryMessage({
            orderNumber: order.orderNumber,
            items: order.items.map((item) => ({
              name: item.name,
              quantity: item.quantity,
              total: item.total,
            })),
            total: order.total,
          });

          await this.storeMessage(sessionId, 'user', message, messageId);
          await this.storeMessage(sessionId, 'assistant', response);

          await this.prisma.agentSession.updateMany({
            where: { id: sessionId, workspaceId },
            data: {
              currentState: AgentState.COLLECTING_ORDER,
              lastActivityAt: new Date(),
              agentActive: true,
            },
          });

          return {
            response,
            state: AgentState.COLLECTING_ORDER,
            toolsUsed: [],
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }

        // clone
        if (repeatAction.action === 'clone') {
          await this.memoryManager.clearCart(sessionId);
          memory.cart = null;
          memory.context.editingOrderId = undefined;
          memory.context.editingOrderNumber = undefined;
          memory.context.editingOrderOriginalItems = undefined;
          await this.memoryManager.saveSession(memory);

          const toolsUsed: ToolExecution[] = [];
          const errors: string[] = [];
          const unknown: string[] = [];
          const shortages: InsufficientStockDetail[] = [];

          for (const item of order.items) {
            const execution = await toolRegistry.execute(
              'add_to_cart',
              {
                productId: item.productId,
                variantId: item.variantId ?? undefined,
                quantity: item.quantity,
              },
              toolContext
            );
            toolsUsed.push(execution);

            if (!execution.result.success) {
              const insufficient = extractInsufficientStock(execution.result.data);
              if (insufficient.length > 0) {
                shortages.push(...insufficient);
              } else {
                errors.push(execution.result.error || `No pude agregar ${item.name}.`);
                unknown.push(item.name);
              }
            }
          }

          const cart = await this.memoryManager.getCart(sessionId);
          if (!cart || cart.items.length === 0) {
            const hasStockAvailable = shortages.some((detail) => detail.available > 0);
            if (shortages.length > 0 && hasStockAvailable) {
              memory.context.pendingStockAdjustment = { items: shortages };
              await this.memoryManager.saveSession(memory);
              const response = buildInsufficientStockMessage(shortages);
              await this.storeMessage(sessionId, 'user', message, messageId);
              await this.storeMessage(sessionId, 'assistant', response);
              return {
                response,
                state: fsm.getState(),
                toolsUsed,
                tokensUsed: 0,
                shouldSendMessage: true,
              };
            }

            if (unknown.length > 0 || shortages.length > 0) {
              const requested = [
                ...unknown,
                ...shortages.map((detail) => detail.name),
              ];
              const offerContent = buildCatalogOfferContent(requested);
              memory.context.pendingCatalogOffer = { requested };
              await this.memoryManager.saveSession(memory);

              await this.storeMessage(sessionId, 'assistant', offerContent.text);
              return {
                response: offerContent.text,
                responseType: 'interactive-buttons',
                responsePayload: offerContent.interactive,
                state: fsm.getState(),
                toolsUsed,
                tokensUsed: 0,
                shouldSendMessage: true,
              };
            }

            const issueLines = [
              ...errors.map((e) => `• ${e}`),
              ...unknown.map((u) => `• No encontré "${u}"`),
            ];
            const response = issueLines.length
              ? ['No pude rehacer el pedido:', ...issueLines, '¿Querés intentar de nuevo?'].join('\n')
              : 'No pude rehacer el pedido. ¿Querés intentar de nuevo?';

            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', response);
            return {
              response,
              state: fsm.getState(),
              toolsUsed,
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }

          const actions = buildOrderActionsContent();
          let response = buildOrderSummaryMessage(cart);

          if (shortages.length > 0) {
            memory.context.pendingStockAdjustment = { items: shortages };
            await this.memoryManager.saveSession(memory);
            response = [
              buildInsufficientStockMessage(shortages),
              '',
              response,
            ].join('\n');
          }

          const issueLines = [
            ...errors.map((e) => `• ${e}`),
            ...unknown.map((u) => `• No encontré "${u}"`),
          ];
          if (issueLines.length > 0) {
            response = [
              '⚠️ Algunos productos no se pudieron agregar:',
              ...issueLines,
              '',
              response,
            ].join('\n');
          }

          await this.storeMessage(sessionId, 'user', message, messageId);
          await this.storeMessage(sessionId, 'assistant', response);

          if (fsm.canTransition(AgentState.AWAITING_CONFIRMATION)) {
            fsm.transition(AgentState.AWAITING_CONFIRMATION);
            await this.memoryManager.updateState(sessionId, AgentState.AWAITING_CONFIRMATION);
          }

          await this.prisma.agentSession.updateMany({
            where: { id: sessionId, workspaceId },
            data: {
              currentState: fsm.getState(),
              lastActivityAt: new Date(),
              agentActive: true,
            },
          });

          return {
            response,
            responseType: 'interactive-buttons',
            responsePayload: actions.interactive,
            state: fsm.getState(),
            toolsUsed,
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }
      }

      const repeatOrders = memory.context.repeatOrders || [];
      const repeatSelection = repeatOrders.length
        ? parseRepeatOrderSelection(message, repeatOrders)
        : null;
      const repeatRaw = message.trim().toLowerCase();

      if (repeatSelection?.order) {
        const orderId = repeatSelection.order.id;
        const orderNumber = repeatSelection.order.orderNumber;

        memory.context.repeatOrderId = orderId;
        memory.context.repeatOrderNumber = orderNumber;
        await this.memoryManager.saveSession(memory);

        const execution = await toolRegistry.execute(
          'send_order_pdf',
          { orderId },
          toolContext
        );
        toolsUsed.push(execution);

        const actionContent = buildRepeatOrderActionsContent(orderNumber, orderId);
        await this.storeMessage(sessionId, 'user', message, messageId);
        await this.storeMessage(sessionId, 'assistant', actionContent.text);

        await this.prisma.agentSession.updateMany({
          where: { id: sessionId, workspaceId },
          data: { lastActivityAt: new Date(), agentActive: true },
        });

        return {
          response: actionContent.text,
          responseType: 'interactive-buttons',
          responsePayload: actionContent.interactive,
          state: fsm.getState(),
          toolsUsed,
          tokensUsed: 0,
          shouldSendMessage: true,
        };
      }

      if (!repeatOrders.length && repeatRaw.startsWith('repeat_order_select:')) {
        const orderId = repeatRaw.split(':')[1];
        if (orderId) {
          const order = await this.prisma.order.findFirst({
            where: withVisibleOrders({
              id: orderId,
              workspaceId,
              customerId,
            }),
            select: { id: true, orderNumber: true },
          });

          if (order) {
            memory.context.repeatOrderId = order.id;
            memory.context.repeatOrderNumber = order.orderNumber;
            await this.memoryManager.saveSession(memory);

            const execution = await toolRegistry.execute(
              'send_order_pdf',
              { orderId: order.id },
              toolContext
            );
            toolsUsed.push(execution);

            const actionContent = buildRepeatOrderActionsContent(order.orderNumber, order.id);
            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', actionContent.text);

            await this.prisma.agentSession.updateMany({
              where: { id: sessionId, workspaceId },
              data: { lastActivityAt: new Date(), agentActive: true },
            });

            return {
              response: actionContent.text,
              responseType: 'interactive-buttons',
              responsePayload: actionContent.interactive,
              state: fsm.getState(),
              toolsUsed,
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }
        }
      }
      

      // Registered customers: handle menu selections regardless of current state
      const selection = parseMenuSelection(message, memory.context.lastMenu);

      if (selection === 'order') {
        const awaitingOrders = await this.prisma.order.findMany({
          where: withVisibleOrders({
            workspaceId,
            customerId,
            status: 'awaiting_acceptance',
          }),
          orderBy: { createdAt: 'desc' },
          select: { id: true, orderNumber: true },
        });

        if (awaitingOrders.length > 0) {
          if (awaitingOrders.length > 1) {
            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.memoryManager.clearPendingConfirmation(sessionId);
            await this.memoryManager.clearCart(sessionId);
            memory.pendingConfirmation = null;
            memory.cart = null;

            memory.context.pendingOrderDecision = true;
            memory.context.pendingOrderOptions = awaitingOrders.map((order) => ({
              id: order.id,
              orderNumber: order.orderNumber || undefined,
            }));
            memory.context.pendingOrderId = awaitingOrders[0].id;
            memory.context.pendingOrderNumber = awaitingOrders[0].orderNumber || undefined;
            await this.memoryManager.saveSession(memory);

            const choiceContent = buildPendingOrdersChoiceContent(memory.context.pendingOrderOptions);
            await this.storeMessage(sessionId, 'assistant', choiceContent.text);
            await this.prisma.agentSession.updateMany({
              where: { id: sessionId, workspaceId },
              data: { lastActivityAt: new Date(), agentActive: true },
            });

            return {
              response: choiceContent.text,
              responseType: 'interactive-buttons',
              responsePayload: choiceContent.interactive,
              state: fsm.getState(),
              toolsUsed: [],
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }

          const pendingOrder = awaitingOrders[0];
          return await handlePendingOrderDecision(pendingOrder, null);
        }

        await this.memoryManager.clearCart(sessionId);
        await this.memoryManager.updateState(sessionId, AgentState.COLLECTING_ORDER);

        const exampleProducts = await this.getOrderExampleProducts(workspaceId);
        const response = buildStartOrderMessage(exampleProducts, {
          greeting: shouldPrefaceGreeting(message),
        });

        await this.storeMessage(sessionId, 'user', message, messageId);
        await this.storeMessage(sessionId, 'assistant', response);
        memory.state = AgentState.COLLECTING_ORDER;
        memory.context.lastMenu = undefined;
        await this.memoryManager.saveSession(memory);

        await this.prisma.agentSession.updateMany({
          where: { id: sessionId, workspaceId },
          data: {
            currentState: AgentState.COLLECTING_ORDER,
            lastActivityAt: new Date(),
            agentActive: true,
          },
        });

        return {
          response,
          state: AgentState.COLLECTING_ORDER,
          toolsUsed: [],
          tokensUsed: 0,
          shouldSendMessage: true,
        };
      }

      if (selection === 'active') {
        const awaitingOrders = await this.prisma.order.findMany({
          where: withVisibleOrders({
            workspaceId,
            customerId,
            status: 'awaiting_acceptance',
          }),
          orderBy: { createdAt: 'desc' },
          select: { id: true, orderNumber: true, total: true, paidAmount: true, status: true },
        });

        const acceptedOrders = await this.prisma.order.findMany({
          where: withVisibleOrders({
            workspaceId,
            customerId,
            status: { in: ['accepted', 'confirmed'] },
          }),
          orderBy: { createdAt: 'desc' },
          take: 2,
          select: { id: true, orderNumber: true, total: true, paidAmount: true, status: true },
        });

        const processingOrders = await this.prisma.order.findMany({
          where: withVisibleOrders({
            workspaceId,
            customerId,
            status: 'processing',
          }),
          orderBy: { createdAt: 'desc' },
          select: { id: true, orderNumber: true, total: true, paidAmount: true, status: true },
        });

        const orders = [...awaitingOrders, ...acceptedOrders, ...processingOrders];
        let response = '';
        let responseType: ProcessMessageOutput['responseType'];
        let responsePayload: ProcessMessageOutput['responsePayload'];
        if (orders.length === 0) {
          response = 'No tenés pedidos activos en este momento.';
          memory.context.activeOrdersPrompt = undefined;
          memory.context.activeOrdersAction = undefined;
          memory.context.activeOrdersAwaiting = undefined;
          memory.context.activeOrdersPayable = undefined;
          memory.context.activeOrdersSubmenu = undefined;
          memory.context.activeOrdersInvoiceOptions = undefined;
        } else {
          const commerceSettings = (await this.loadCommerceProfile(workspaceId)) as Record<string, unknown>;
          const paymentOptions = resolvePaymentMethodsEnabled(commerceSettings);
          const hasPaymentOption = paymentOptions.mpLink || paymentOptions.transfer || paymentOptions.cash;
          const payableOrders = orders
            .filter((order) => order.total > order.paidAmount)
            .map((order) => ({
              id: order.id,
              orderNumber: order.orderNumber,
              pendingAmount: order.total - order.paidAmount,
            }));

          const content = buildActiveOrdersContent(orders, {
            includePayButton: payableOrders.length > 0 && hasPaymentOption,
          });
          response = content.text;
          responseType = 'interactive-buttons';
          responsePayload = content.interactive;
          memory.context.activeOrdersPrompt = true;
          memory.context.activeOrdersAction = undefined;
          memory.context.activeOrdersAwaiting = awaitingOrders.map((order) => ({
            id: order.id,
            orderNumber: order.orderNumber,
          }));
          memory.context.activeOrdersPayable = payableOrders;
          memory.context.activeOrdersSubmenu = undefined;
          memory.context.activeOrdersInvoiceOptions = undefined;
        }

        await this.storeMessage(sessionId, 'user', message, messageId);
        await this.storeMessage(sessionId, 'assistant', response);
        await this.memoryManager.saveSession(memory);
        await this.prisma.agentSession.updateMany({
          where: { id: sessionId, workspaceId },
          data: { lastActivityAt: new Date(), agentActive: true },
        });

        return {
          response,
          responseType,
          responsePayload,
          state: fsm.getState(),
          toolsUsed: [],
          tokensUsed: 0,
          shouldSendMessage: true,
        };
      }

      if (selection === 'catalog') {
        await this.storeMessage(sessionId, 'user', message, messageId);

        const execution = await toolRegistry.execute(
          'send_catalog_pdf',
          {},
          toolContext
        );

        toolsUsed.push(execution);

        const dataMessage = (execution.result.data as { message?: string } | undefined)?.message;
        const response =
          execution.result.success && dataMessage
            ? dataMessage
            : execution.result.error || 'No pude enviar el catálogo.';

        await this.storeMessage(sessionId, 'assistant', response);
        await this.prisma.agentSession.updateMany({
          where: { id: sessionId, workspaceId },
          data: { lastActivityAt: new Date(), agentActive: true },
        });

        return {
          response,
          state: fsm.getState(),
          toolsUsed,
          tokensUsed: 0,
          shouldSendMessage: true,
        };
      }

      if (selection === 'repeat') {
        const recentOrders = await this.prisma.order.findMany({
          where: withVisibleOrders({
            workspaceId,
            customerId,
            status: { notIn: ['cancelled', 'draft'] },
          }),
          orderBy: { createdAt: 'desc' },
          take: 3,
          select: { id: true, orderNumber: true },
        });

        if (recentOrders.length === 0) {
          const response = 'No encontré pedidos anteriores para rehacer.';
          await this.storeMessage(sessionId, 'user', message, messageId);
          await this.storeMessage(sessionId, 'assistant', response);
          return {
            response,
            state: fsm.getState(),
            toolsUsed: [],
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }

        memory.context.repeatOrders = recentOrders.map((order) => ({
          id: order.id,
          orderNumber: order.orderNumber,
        }));
        memory.context.repeatOrderId = undefined;
        memory.context.repeatOrderNumber = undefined;
        await this.memoryManager.saveSession(memory);

        const selectionContent = buildRepeatOrderSelectionContent(memory.context.repeatOrders);
        await this.storeMessage(sessionId, 'user', message, messageId);
        await this.storeMessage(sessionId, 'assistant', selectionContent.text);

        await this.prisma.agentSession.updateMany({
          where: { id: sessionId, workspaceId },
          data: { lastActivityAt: new Date(), agentActive: true },
        });

        return {
          response: selectionContent.text,
          responseType: selectionContent.responseType,
          responsePayload: selectionContent.responsePayload,
          state: fsm.getState(),
          toolsUsed: [],
          tokensUsed: 0,
          shouldSendMessage: true,
        };
      }

      if (selection === 'more') {
        const menuContent = buildSecondaryMenuContent();

        await this.storeMessage(sessionId, 'user', message, messageId);
        await this.storeMessage(sessionId, 'assistant', menuContent.text);
        memory.context.lastMenu = 'secondary';
        await this.memoryManager.saveSession(memory);

        await this.prisma.agentSession.updateMany({
          where: { id: sessionId, workspaceId },
          data: { lastActivityAt: new Date(), agentActive: true },
        });

        return {
          response: menuContent.text,
          responseType: 'interactive-buttons',
          responsePayload: menuContent.interactive,
          state: fsm.getState(),
          toolsUsed: [],
          tokensUsed: 0,
          shouldSendMessage: true,
        };
      }

      if (selection === 'other') {
        const response = 'Que necesitas? estoy aqui para ayudarte';
        await this.storeMessage(sessionId, 'user', message, messageId);
        await this.storeMessage(sessionId, 'assistant', response);
        memory.context.otherInquiry = true;
        memory.context.lastMenu = undefined;
        await this.memoryManager.saveSession(memory);

        await this.prisma.agentSession.updateMany({
          where: { id: sessionId, workspaceId },
          data: { lastActivityAt: new Date(), agentActive: true },
        });

        return {
          response,
          state: fsm.getState(),
          toolsUsed: [],
          tokensUsed: 0,
          shouldSendMessage: true,
        };
      }

      if (selection) {
        const response = buildUnavailableMenuOptionMessage();

        await this.storeMessage(sessionId, 'user', message, messageId);
        await this.storeMessage(sessionId, 'assistant', response);
        memory.context.lastMenu = 'primary';
        await this.memoryManager.saveSession(memory);

        await this.prisma.agentSession.updateMany({
          where: { id: sessionId, workspaceId },
          data: { lastActivityAt: new Date(), agentActive: true },
        });

        return {
          response,
          state: fsm.getState(),
          toolsUsed: [],
          tokensUsed: 0,
          shouldSendMessage: true,
        };
      }

      if (
        isAcknowledgement(message) &&
        fsm.getState() === AgentState.IDLE &&
        !memory.context.pendingOrderDecision &&
        !memory.context.pendingCancelOrderId &&
        !memory.context.activeOrdersPrompt &&
        !memory.context.orderViewAwaitingNumber &&
        !memory.context.orderViewAwaitingAck &&
        !memory.context.editingOrderId &&
        !memory.context.pendingRegistration
      ) {
        await this.storeMessage(sessionId, 'user', message, messageId);
        await this.prisma.agentSession.updateMany({
          where: { id: sessionId, workspaceId },
          data: { lastActivityAt: new Date(), agentActive: true },
        });

        return {
          response: '',
          state: fsm.getState(),
          toolsUsed: [],
          tokensUsed: 0,
          shouldSendMessage: false,
        };
      }

      // Registered customers: show menu on explicit menu request even outside idle
      if (fsm.getState() !== AgentState.IDLE && isMenuRequest(message)) {
        const menuContent = buildPrimaryMenuContent();
        const response = menuContent.text;

        await this.storeMessage(sessionId, 'user', message, messageId);
        await this.storeMessage(sessionId, 'assistant', response);
        memory.context.lastMenu = 'primary';
        await this.memoryManager.saveSession(memory);

        await this.prisma.agentSession.updateMany({
          where: { id: sessionId, workspaceId },
          data: { lastActivityAt: new Date(), agentActive: true },
        });

        return {
          response,
          responseType: 'interactive-buttons',
          responsePayload: menuContent.interactive,
          state: fsm.getState(),
          toolsUsed: [],
          tokensUsed: 0,
          shouldSendMessage: true,
        };
      }

      // Registered customers: show menu when idle + greeting
      if (fsm.getState() === AgentState.IDLE) {

        if (shouldShowMenu(message)) {
          const menuContent = buildPrimaryMenuContent();
          const response = menuContent.text;

          await this.storeMessage(sessionId, 'user', message, messageId);
          await this.storeMessage(sessionId, 'assistant', response);
          memory.context.lastMenu = 'primary';
          await this.memoryManager.saveSession(memory);

          await this.prisma.agentSession.updateMany({
            where: { id: sessionId, workspaceId },
            data: { lastActivityAt: new Date(), agentActive: true },
          });

          return {
            response,
            responseType: 'interactive-buttons',
            responsePayload: menuContent.interactive,
            state: fsm.getState(),
            toolsUsed: [],
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }
      }

      if (memory.context.paymentStage) {
        if (isReturnToMenu(message)) {
          clearPaymentContext(memory);
          await this.memoryManager.saveSession(memory);
          return await respondWithPrimaryMenu();
        }
        if (isPaymentBack(message)) {
          clearPaymentContext(memory);
          await this.memoryManager.saveSession(memory);
          return await respondWithPrimaryMenu();
        }

        const stage = memory.context.paymentStage;

        if (stage === 'select_order') {
          const paymentOrders = memory.context.paymentOrders || [];
          if (!paymentOrders.length) {
            clearPaymentContext(memory);
            await this.memoryManager.saveSession(memory);
            const response = 'No tenés pedidos con saldo pendiente.';
            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', response);

            return {
              response,
              state: fsm.getState(),
              toolsUsed: [],
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }

          const selection = parsePaymentOrderSelection(message, paymentOrders);
          if (!selection.order) {
            const selectionContent = buildPaymentOrderSelectionContent(paymentOrders);
            const response = selection.ambiguous
              ? 'Hay más de un pedido que coincide con ese número. Elegí el número completo.'
              : selectionContent.text;

            const payload =
              selection.ambiguous && selectionContent.responseType === 'interactive-buttons'
                ? {
                    ...(selectionContent.responsePayload as InteractiveButtonsPayload),
                    body: `${response}\n\n${(selectionContent.responsePayload as InteractiveButtonsPayload).body}`,
                  }
                : selection.ambiguous && selectionContent.responseType === 'interactive-list'
                  ? {
                      ...(selectionContent.responsePayload as InteractiveListPayload),
                      body: `${response}\n\n${(selectionContent.responsePayload as InteractiveListPayload).body}`,
                    }
                  : selectionContent.responsePayload;

            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', response);

            return {
              response,
              responseType: selectionContent.responseType,
              responsePayload: payload,
              state: fsm.getState(),
              toolsUsed: [],
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }

          memory.context.paymentOrderId = selection.order.id;
          memory.context.paymentOrderNumber = selection.order.orderNumber;
          memory.context.paymentPendingAmount = selection.order.pendingAmount;
          memory.context.paymentStage = 'select_method';
          await this.memoryManager.saveSession(memory);

          const commerceSettings = (await this.loadCommerceProfile(workspaceId)) as Record<string, unknown>;
          const paymentOptions = resolvePaymentMethodsEnabled(commerceSettings);
          const hasMpTool = !!toolRegistry.get('create_mp_payment_link');
          const availableOptions = {
            mpLink: paymentOptions.mpLink && hasMpTool,
            transfer: paymentOptions.transfer,
            cash: paymentOptions.cash,
          };

          const methodContent = buildPaymentMethodContent(
            selection.order.orderNumber,
            selection.order.pendingAmount,
            availableOptions
          );

          await this.storeMessage(sessionId, 'user', message, messageId);
          await this.storeMessage(sessionId, 'assistant', methodContent.text);

          return {
            response: methodContent.text,
            responseType: 'interactive-buttons',
            responsePayload: methodContent.interactive,
            state: fsm.getState(),
            toolsUsed: [],
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }

        if (stage === 'select_method') {
          const orderNumber = memory.context.paymentOrderNumber;
          const pendingAmount = memory.context.paymentPendingAmount;
          const orderId = memory.context.paymentOrderId;

          if (!orderNumber || pendingAmount === undefined || !orderId) {
            clearPaymentContext(memory);
            await this.memoryManager.saveSession(memory);
            const response = 'No pude identificar el pedido para pagar.';
            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', response);

            return {
              response,
              state: fsm.getState(),
              toolsUsed: [],
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }

          const commerceSettings = (await this.loadCommerceProfile(workspaceId)) as Record<string, unknown>;
          const paymentOptions = resolvePaymentMethodsEnabled(commerceSettings);
          const hasMpTool = !!toolRegistry.get('create_mp_payment_link');
          const availableOptions = {
            mpLink: paymentOptions.mpLink && hasMpTool,
            transfer: paymentOptions.transfer,
            cash: paymentOptions.cash,
          };
          const hasAnyOption = availableOptions.mpLink || availableOptions.transfer || availableOptions.cash;

          if (!hasAnyOption) {
            clearPaymentContext(memory);
            await this.memoryManager.saveSession(memory);
            const response = 'No hay métodos de pago habilitados en este momento.';
            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', response);

            return {
              response,
              state: fsm.getState(),
              toolsUsed: [],
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }

          const method = parsePaymentMethodSelection(message);
          if (!method) {
            const methodContent = buildPaymentMethodContent(orderNumber, pendingAmount, availableOptions);
            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', methodContent.text);

            return {
              response: methodContent.text,
              responseType: 'interactive-buttons',
              responsePayload: methodContent.interactive,
              state: fsm.getState(),
              toolsUsed: [],
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }

          if (method === 'more') {
            const methodContent = buildPaymentMethodContent(orderNumber, pendingAmount, availableOptions);
            if (!methodContent.missingMethod) {
              await this.storeMessage(sessionId, 'user', message, messageId);
              await this.storeMessage(sessionId, 'assistant', methodContent.text);
              return {
                response: methodContent.text,
                responseType: 'interactive-buttons',
                responsePayload: methodContent.interactive,
                state: fsm.getState(),
                toolsUsed: [],
                tokensUsed: 0,
                shouldSendMessage: true,
              };
            }

            memory.context.paymentStage = 'select_method_more';
            await this.memoryManager.saveSession(memory);
            const moreContent = buildPaymentMethodMoreContent(
              orderNumber,
              pendingAmount,
              methodContent.missingMethod
            );
            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', moreContent.text);

            return {
              response: moreContent.text,
              responseType: 'interactive-buttons',
              responsePayload: moreContent.interactive,
              state: fsm.getState(),
              toolsUsed: [],
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }

          if (method === 'back') {
            clearPaymentContext(memory);
            await this.memoryManager.saveSession(memory);
            return await respondWithPrimaryMenu();
          }

          if (method === 'link') {
            if (!availableOptions.mpLink) {
              const response = 'El link de pago no está disponible. Podés elegir otro método.';
              const methodContent = buildPaymentMethodContent(orderNumber, pendingAmount, availableOptions);
              await this.storeMessage(sessionId, 'user', message, messageId);
              await this.storeMessage(sessionId, 'assistant', response);

              return {
                response,
                responseType: 'interactive-buttons',
                responsePayload: {
                  ...methodContent.interactive,
                  body: `${response}\n\n${methodContent.interactive.body}`,
                },
                state: fsm.getState(),
                toolsUsed: [],
                tokensUsed: 0,
                shouldSendMessage: true,
              };
            }

            const execution = await toolRegistry.execute(
              'create_mp_payment_link',
              { orderId },
              toolContext
            );
            toolsUsed.push(execution);

            if (!execution.result.success) {
              const response = execution.result.error || 'No pude generar el link de pago.';
              const methodContent = buildPaymentMethodContent(orderNumber, pendingAmount, availableOptions);
              await this.storeMessage(sessionId, 'user', message, messageId);
              await this.storeMessage(sessionId, 'assistant', response);

              return {
                response,
                responseType: 'interactive-buttons',
                responsePayload: {
                  ...methodContent.interactive,
                  body: `${response}\n\n${methodContent.interactive.body}`,
                },
                state: fsm.getState(),
                toolsUsed,
                tokensUsed: 0,
                shouldSendMessage: true,
              };
            }

            const data = execution.result.data as { message?: string; paymentUrl?: string } | undefined;
            const paymentUrl = data?.paymentUrl;
            if (!paymentUrl) {
              const response = data?.message || 'Listo, generé el link de pago.';
              const methodContent = buildPaymentMethodContent(orderNumber, pendingAmount, availableOptions);
              await this.storeMessage(sessionId, 'user', message, messageId);
              await this.storeMessage(sessionId, 'assistant', response);

              return {
                response,
                responseType: 'interactive-buttons',
                responsePayload: {
                  ...methodContent.interactive,
                  body: `${response}\n\n${methodContent.interactive.body}`,
                },
                state: fsm.getState(),
                toolsUsed,
                tokensUsed: 0,
                shouldSendMessage: true,
              };
            }

            memory.context.paymentMethod = 'link';
            memory.context.paymentStage = 'await_receipt';
            await this.memoryManager.saveSession(memory);

            const linkContent = buildLinkPaymentContent(orderNumber, paymentUrl);
            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', linkContent.text);

            return {
              response: linkContent.text,
              responseType: 'interactive-buttons',
              responsePayload: linkContent.interactive,
              state: fsm.getState(),
              toolsUsed,
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }

          if (method === 'transfer') {
            if (!availableOptions.transfer) {
              const response = 'La transferencia no está disponible. Elegí otro método.';
              const methodContent = buildPaymentMethodContent(orderNumber, pendingAmount, availableOptions);
              await this.storeMessage(sessionId, 'user', message, messageId);
              await this.storeMessage(sessionId, 'assistant', response);

              return {
                response,
                responseType: 'interactive-buttons',
                responsePayload: {
                  ...methodContent.interactive,
                  body: `${response}\n\n${methodContent.interactive.body}`,
                },
                state: fsm.getState(),
                toolsUsed: [],
                tokensUsed: 0,
                shouldSendMessage: true,
              };
            }

            const paymentAlias = typeof commerceSettings.paymentAlias === 'string'
              ? commerceSettings.paymentAlias.trim()
              : '';
            const paymentCbu = typeof commerceSettings.paymentCbu === 'string'
              ? commerceSettings.paymentCbu.trim()
              : '';
            if (!paymentAlias && !paymentCbu) {
              const response = 'No tengo un alias ni CBU configurado. Elegí otro método.';
              const methodContent = buildPaymentMethodContent(orderNumber, pendingAmount, availableOptions);
              await this.storeMessage(sessionId, 'user', message, messageId);
              await this.storeMessage(sessionId, 'assistant', response);

              return {
                response,
                responseType: 'interactive-buttons',
                responsePayload: {
                  ...methodContent.interactive,
                  body: `${response}\n\n${methodContent.interactive.body}`,
                },
                state: fsm.getState(),
                toolsUsed: [],
                tokensUsed: 0,
                shouldSendMessage: true,
              };
            }

            memory.context.paymentMethod = 'transfer';
            memory.context.paymentStage = 'await_receipt';
            await this.memoryManager.saveSession(memory);

            const receiptContent = buildTransferPaymentContent(orderNumber, {
              alias: paymentAlias,
              cbu: paymentCbu,
            });
            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', receiptContent.text);

            return {
              response: receiptContent.text,
              responseType: 'interactive-buttons',
              responsePayload: receiptContent.interactive,
              state: fsm.getState(),
              toolsUsed: [],
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }

          if (method === 'cash') {
            if (!availableOptions.cash) {
              const response = 'El pago en efectivo no está disponible. Elegí otro método.';
              const methodContent = buildPaymentMethodContent(orderNumber, pendingAmount, availableOptions);
              await this.storeMessage(sessionId, 'user', message, messageId);
              await this.storeMessage(sessionId, 'assistant', response);

              return {
                response,
                responseType: 'interactive-buttons',
                responsePayload: {
                  ...methodContent.interactive,
                  body: `${response}\n\n${methodContent.interactive.body}`,
                },
                state: fsm.getState(),
                toolsUsed: [],
                tokensUsed: 0,
                shouldSendMessage: true,
              };
            }

            clearPaymentContext(memory);
            memory.context.lastMenu = 'primary';
            await this.memoryManager.saveSession(memory);

            const response = 'Perfecto, el repartidor aguarda tu pago en efectivo.';
            const menuContent = buildPrimaryMenuContent();
            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', response);

            return {
              response,
              responseType: 'interactive-buttons',
              responsePayload: {
                ...menuContent.interactive,
                body: `${response}\n\n${menuContent.interactive.body}`,
              },
              state: fsm.getState(),
              toolsUsed: [],
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }
        }

        if (stage === 'select_method_more') {
          const orderNumber = memory.context.paymentOrderNumber;
          const pendingAmount = memory.context.paymentPendingAmount;
          const orderId = memory.context.paymentOrderId;

          if (!orderNumber || pendingAmount === undefined || !orderId) {
            clearPaymentContext(memory);
            await this.memoryManager.saveSession(memory);
            const response = 'No pude identificar el pedido para pagar.';
            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', response);

            return {
              response,
              state: fsm.getState(),
              toolsUsed: [],
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }

          const commerceSettings = (await this.loadCommerceProfile(workspaceId)) as Record<string, unknown>;
          const paymentOptions = resolvePaymentMethodsEnabled(commerceSettings);
          const hasMpTool = !!toolRegistry.get('create_mp_payment_link');
          const availableOptions = {
            mpLink: paymentOptions.mpLink && hasMpTool,
            transfer: paymentOptions.transfer,
            cash: paymentOptions.cash,
          };

          const method = parsePaymentMethodSelection(message);
          if (!method || method === 'more') {
            const methodContent = buildPaymentMethodContent(orderNumber, pendingAmount, availableOptions);
            const missingMethod = methodContent.missingMethod;
            if (!missingMethod) {
              memory.context.paymentStage = 'select_method';
              await this.memoryManager.saveSession(memory);
              await this.storeMessage(sessionId, 'user', message, messageId);
              await this.storeMessage(sessionId, 'assistant', methodContent.text);
              return {
                response: methodContent.text,
                responseType: 'interactive-buttons',
                responsePayload: methodContent.interactive,
                state: fsm.getState(),
                toolsUsed: [],
                tokensUsed: 0,
                shouldSendMessage: true,
              };
            }

            const moreContent = buildPaymentMethodMoreContent(orderNumber, pendingAmount, missingMethod);
            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', moreContent.text);

            return {
              response: moreContent.text,
              responseType: 'interactive-buttons',
              responsePayload: moreContent.interactive,
              state: fsm.getState(),
              toolsUsed: [],
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }

          if (method === 'prev') {
            memory.context.paymentStage = 'select_method';
            await this.memoryManager.saveSession(memory);
            const methodContent = buildPaymentMethodContent(orderNumber, pendingAmount, availableOptions);
            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', methodContent.text);

            return {
              response: methodContent.text,
              responseType: 'interactive-buttons',
              responsePayload: methodContent.interactive,
              state: fsm.getState(),
              toolsUsed: [],
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }

          if (method === 'back') {
            clearPaymentContext(memory);
            await this.memoryManager.saveSession(memory);
            return await respondWithPrimaryMenu();
          }

          if (method === 'link') {
            if (!availableOptions.mpLink) {
              const response = 'El link de pago no está disponible. Podés elegir otro método.';
              const methodContent = buildPaymentMethodContent(orderNumber, pendingAmount, availableOptions);
              await this.storeMessage(sessionId, 'user', message, messageId);
              await this.storeMessage(sessionId, 'assistant', response);

              return {
                response,
                responseType: 'interactive-buttons',
                responsePayload: {
                  ...methodContent.interactive,
                  body: `${response}\n\n${methodContent.interactive.body}`,
                },
                state: fsm.getState(),
                toolsUsed: [],
                tokensUsed: 0,
                shouldSendMessage: true,
              };
            }

            const execution = await toolRegistry.execute(
              'create_mp_payment_link',
              { orderId },
              toolContext
            );
            toolsUsed.push(execution);

            if (!execution.result.success) {
              const response = execution.result.error || 'No pude generar el link de pago.';
              const methodContent = buildPaymentMethodContent(orderNumber, pendingAmount, availableOptions);
              await this.storeMessage(sessionId, 'user', message, messageId);
              await this.storeMessage(sessionId, 'assistant', response);

              return {
                response,
                responseType: 'interactive-buttons',
                responsePayload: {
                  ...methodContent.interactive,
                  body: `${response}\n\n${methodContent.interactive.body}`,
                },
                state: fsm.getState(),
                toolsUsed,
                tokensUsed: 0,
                shouldSendMessage: true,
              };
            }

            const data = execution.result.data as { message?: string; paymentUrl?: string } | undefined;
            const paymentUrl = data?.paymentUrl;
            if (!paymentUrl) {
              const response = data?.message || 'Listo, generé el link de pago.';
              const methodContent = buildPaymentMethodContent(orderNumber, pendingAmount, availableOptions);
              await this.storeMessage(sessionId, 'user', message, messageId);
              await this.storeMessage(sessionId, 'assistant', response);

              return {
                response,
                responseType: 'interactive-buttons',
                responsePayload: {
                  ...methodContent.interactive,
                  body: `${response}\n\n${methodContent.interactive.body}`,
                },
                state: fsm.getState(),
                toolsUsed,
                tokensUsed: 0,
                shouldSendMessage: true,
              };
            }

            memory.context.paymentMethod = 'link';
            memory.context.paymentStage = 'await_receipt';
            await this.memoryManager.saveSession(memory);

            const linkContent = buildLinkPaymentContent(orderNumber, paymentUrl);
            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', linkContent.text);

            return {
              response: linkContent.text,
              responseType: 'interactive-buttons',
              responsePayload: linkContent.interactive,
              state: fsm.getState(),
              toolsUsed,
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }

          if (method === 'transfer') {
            if (!availableOptions.transfer) {
              const response = 'La transferencia no está disponible. Elegí otro método.';
              const methodContent = buildPaymentMethodContent(orderNumber, pendingAmount, availableOptions);
              await this.storeMessage(sessionId, 'user', message, messageId);
              await this.storeMessage(sessionId, 'assistant', response);

              return {
                response,
                responseType: 'interactive-buttons',
                responsePayload: {
                  ...methodContent.interactive,
                  body: `${response}\n\n${methodContent.interactive.body}`,
                },
                state: fsm.getState(),
                toolsUsed: [],
                tokensUsed: 0,
                shouldSendMessage: true,
              };
            }

            const paymentAlias = typeof commerceSettings.paymentAlias === 'string'
              ? commerceSettings.paymentAlias.trim()
              : '';
            const paymentCbu = typeof commerceSettings.paymentCbu === 'string'
              ? commerceSettings.paymentCbu.trim()
              : '';
            if (!paymentAlias && !paymentCbu) {
              const response = 'No tengo un alias ni CBU configurado. Elegí otro método.';
              const methodContent = buildPaymentMethodContent(orderNumber, pendingAmount, availableOptions);
              await this.storeMessage(sessionId, 'user', message, messageId);
              await this.storeMessage(sessionId, 'assistant', response);

              return {
                response,
                responseType: 'interactive-buttons',
                responsePayload: {
                  ...methodContent.interactive,
                  body: `${response}\n\n${methodContent.interactive.body}`,
                },
                state: fsm.getState(),
                toolsUsed: [],
                tokensUsed: 0,
                shouldSendMessage: true,
              };
            }

            memory.context.paymentMethod = 'transfer';
            memory.context.paymentStage = 'await_receipt';
            await this.memoryManager.saveSession(memory);

            const receiptContent = buildTransferPaymentContent(orderNumber, {
              alias: paymentAlias,
              cbu: paymentCbu,
            });
            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', receiptContent.text);

            return {
              response: receiptContent.text,
              responseType: 'interactive-buttons',
              responsePayload: receiptContent.interactive,
              state: fsm.getState(),
              toolsUsed: [],
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }

          if (method === 'cash') {
            if (!availableOptions.cash) {
              const response = 'El pago en efectivo no está disponible. Elegí otro método.';
              const methodContent = buildPaymentMethodContent(orderNumber, pendingAmount, availableOptions);
              await this.storeMessage(sessionId, 'user', message, messageId);
              await this.storeMessage(sessionId, 'assistant', response);

              return {
                response,
                responseType: 'interactive-buttons',
                responsePayload: {
                  ...methodContent.interactive,
                  body: `${response}\n\n${methodContent.interactive.body}`,
                },
                state: fsm.getState(),
                toolsUsed: [],
                tokensUsed: 0,
                shouldSendMessage: true,
              };
            }

            clearPaymentContext(memory);
            memory.context.lastMenu = 'primary';
            await this.memoryManager.saveSession(memory);

            const response = 'Perfecto, el repartidor aguarda tu pago en efectivo.';
            const menuContent = buildPrimaryMenuContent();
            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', response);

            return {
              response,
              responseType: 'interactive-buttons',
              responsePayload: {
                ...menuContent.interactive,
                body: `${response}\n\n${menuContent.interactive.body}`,
              },
              state: fsm.getState(),
              toolsUsed: [],
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }
        }

        if (stage === 'await_receipt') {
          const orderNumber = memory.context.paymentOrderNumber;
          const orderId = memory.context.paymentOrderId;
          const pendingAmount = memory.context.paymentPendingAmount;
          const paymentMethod = memory.context.paymentMethod || 'transfer';

          if (!orderNumber || !orderId || pendingAmount === undefined) {
            clearPaymentContext(memory);
            await this.memoryManager.saveSession(memory);
            const response = 'No pude identificar el pedido para pagar.';
            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', response);

            return {
              response,
              state: fsm.getState(),
              toolsUsed: [],
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }

          const method = parsePaymentMethodSelection(message);
          if (method === 'back') {
            clearPaymentContext(memory);
            await this.memoryManager.saveSession(memory);
            return await respondWithPrimaryMenu();
          }

          const attachment = extractAttachmentInfo(message);
          if (!attachment) {
            const receiptContent = buildReceiptRequestContent(orderNumber);
            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', receiptContent.text);

            return {
              response: receiptContent.text,
              responseType: 'interactive-buttons',
              responsePayload: receiptContent.interactive,
              state: fsm.getState(),
              toolsUsed: [],
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }

          let declaredAmount = extractDeclaredReceiptAmount(message, attachment);
          let extractedAmount: number | undefined;
          let extractedConfidence: number | undefined;
          let extractedText: string | undefined;

          if (toolRegistry.get('extract_receipt_amount')) {
            const ocrExecution = await toolRegistry.execute(
              'extract_receipt_amount',
              {
                fileRef: attachment.fileRef,
                fileType: attachment.fileType,
                ...(memory.context.paymentPendingAmount
                  ? { expectedAmount: memory.context.paymentPendingAmount }
                  : {}),
              },
              toolContext
            );
            toolsUsed.push(ocrExecution);
            if (ocrExecution.result.success) {
              const data = ocrExecution.result.data as {
                amountCents?: number;
                confidence?: number;
                extractedText?: string;
              } | undefined;
              if (data?.amountCents) {
                extractedAmount = data.amountCents;
              }
              if (typeof data?.confidence === 'number') {
                extractedConfidence = data.confidence;
              }
              if (data?.extractedText) {
                extractedText = data.extractedText;
              }
            }
          }

          if (declaredAmount) {
            const pendingAmount = memory.context.paymentPendingAmount;
            const maxCents = 2_147_483_647;
            if (declaredAmount > maxCents) {
              declaredAmount = null;
            } else if (pendingAmount && declaredAmount > pendingAmount * 10) {
              declaredAmount = null;
            }
          }

          const receiptExecution = await toolRegistry.execute(
            'process_receipt',
            {
              fileRef: attachment.fileRef,
              fileType: attachment.fileType,
              orderId,
              paymentMethod,
              ...(declaredAmount ? { declaredAmount } : {}),
              ...(extractedAmount ? { extractedAmount } : {}),
              ...(typeof extractedConfidence === 'number' ? { extractedConfidence } : {}),
              ...(extractedText ? { extractedText } : {}),
            },
            toolContext
          );
          toolsUsed.push(receiptExecution);

          if (!receiptExecution.result.success) {
            const response = receiptExecution.result.error || 'No pude registrar el comprobante.';
            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', response);

            return {
              response,
              state: fsm.getState(),
              toolsUsed,
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }

          const receiptData = receiptExecution.result.data as { receiptId?: string } | undefined;
          const receiptId = receiptData?.receiptId;
          if (!receiptId) {
            const response = 'No pude registrar el comprobante.';
            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', response);

            return {
              response,
              state: fsm.getState(),
              toolsUsed,
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }

          memory.context.paymentReceiptId = receiptId;

          const resolvedAmount = declaredAmount ?? extractedAmount;

          if (!resolvedAmount) {
            memory.context.paymentStage = 'await_receipt_amount';
            await this.memoryManager.saveSession(memory);

            const response = '¿De cuánto es el pago?';
            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', response);

            return {
              response,
              state: fsm.getState(),
              toolsUsed,
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }

          clearPaymentContext(memory);
          memory.context.lastMenu = 'primary';
          await this.memoryManager.saveSession(memory);

          const response = `Recibí tu comprobante por $${formatMoneyCents(resolvedAmount)} del pedido ${orderNumber}. Lo estamos revisando y te aviso cuando esté aprobado.`;
          await this.storeMessage(sessionId, 'user', message, messageId);
          await this.storeMessage(sessionId, 'assistant', response);

          return {
            response,
            state: fsm.getState(),
            toolsUsed,
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }

        if (stage === 'await_receipt_amount') {
          const orderNumber = memory.context.paymentOrderNumber;
          const receiptId = memory.context.paymentReceiptId;
          const orderId = memory.context.paymentOrderId;

          if (!orderNumber || !receiptId || !orderId) {
            clearPaymentContext(memory);
            await this.memoryManager.saveSession(memory);
            const response = 'No pude continuar con el pago.';
            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', response);

            return {
              response,
              state: fsm.getState(),
              toolsUsed: [],
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }

          const amount = extractMoneyCents(message);
          if (!amount) {
            const response = 'No pude leer el monto. ¿De cuánto es el pago?';
            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', response);

            return {
              response,
              state: fsm.getState(),
              toolsUsed: [],
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }

          const updateExecution = await toolRegistry.execute(
            'update_receipt_amount',
            { receiptId, declaredAmount: amount },
            toolContext
          );
          toolsUsed.push(updateExecution);

          if (!updateExecution.result.success) {
            const response = updateExecution.result.error || 'No pude registrar el monto del comprobante.';
            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', response);

            return {
              response,
              state: fsm.getState(),
              toolsUsed,
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }

          clearPaymentContext(memory);
          memory.context.lastMenu = 'primary';
          await this.memoryManager.saveSession(memory);

          const response = `Recibí el monto de $${formatMoneyCents(amount)} para el pedido ${orderNumber}. Lo estamos revisando y te aviso cuando esté aprobado.`;
          await this.storeMessage(sessionId, 'user', message, messageId);
          await this.storeMessage(sessionId, 'assistant', response);

          return {
            response,
            state: fsm.getState(),
            toolsUsed,
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }

        if (stage === 'confirm_receipt') {
          const orderNumber = memory.context.paymentOrderNumber;
          const receiptId = memory.context.paymentReceiptId;
          const orderId = memory.context.paymentOrderId;
          const amount = memory.context.paymentReceiptAmount;

          if (!orderNumber || !receiptId || !orderId || amount === undefined) {
            clearPaymentContext(memory);
            await this.memoryManager.saveSession(memory);
            const response = 'No pude confirmar el pago.';
            await this.storeMessage(sessionId, 'user', message, messageId);
            await this.storeMessage(sessionId, 'assistant', response);

            return {
              response,
              state: fsm.getState(),
              toolsUsed: [],
              tokensUsed: 0,
              shouldSendMessage: true,
            };
          }

          clearPaymentContext(memory);
          memory.context.lastMenu = 'primary';
          await this.memoryManager.saveSession(memory);

          const response = `Recibí tu comprobante por $${formatMoneyCents(amount)} del pedido ${orderNumber}. Lo estamos revisando y te aviso cuando esté aprobado.`;
          await this.storeMessage(sessionId, 'user', message, messageId);
          await this.storeMessage(sessionId, 'assistant', response);

          return {
            response,
            state: fsm.getState(),
            toolsUsed,
            tokensUsed: 0,
            shouldSendMessage: true,
          };
        }
      }

      // Get conversation history (respect context reset)
      const contextStartAt = await this.getSessionContextStartAt(sessionId, workspaceId);
      const history = await this.getConversationHistory(sessionId, contextStartAt);
      const recentHistory = HISTORY_LIMIT > 0 ? history.slice(-HISTORY_LIMIT) : history;

      // Build system prompt with commerce context
      const commerceProfile = memory.context.commerceProfile ||
        await this.loadCommerceProfile(workspaceId);

      const subagentsEnabled = this.isSubagentsEnabled(workspaceSettings);
      const agentMode = this.resolveAgentMode(message, memory, fsm, subagentsEnabled);
      const taskHint = this.buildTaskHintWithMode(fsm, memory, agentMode);
      const memoryContext = await this.memoryService.buildContext(
        sessionId,
        workspaceId,
        contextStartAt
      );
      const systemPrompt = buildRetailSystemPrompt(
        commerceName,
        commerceProfile,
        { compact: false, taskHint, memoryContext }
      );

      // Build messages for Claude
      const claudeMessages: Anthropic.MessageParam[] = recentHistory.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

      // Add current user message
      claudeMessages.push({ role: 'user', content: message });

      // Store user message
      await this.storeMessage(sessionId, 'user', message, messageId);

      // Get tool definitions
      const allowCatalogTools = wasCatalogExplicitlyRequested(message);
      const baseTools = toolRegistry
        .getToolDefinitions()
        .filter((t) => {
          if (CATALOG_TOOL_NAMES.has(t.name)) return allowCatalogTools;
          return true;
        })
        .map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema as Anthropic.Tool.InputSchema,
        }));
      const tools = subagentsEnabled
        ? this.selectToolsForMode({ mode: agentMode, allowCatalogTools, baseTools })
        : baseTools;
      const allowedToolNames = new Set(tools.map((tool) => tool.name));

      // Agent loop
      let response = '';
      let iterations = 0;
      let pendingToolResults: Array<{ tool_use_id: string; content: string }> = [];

      let confirmationRequested = false;

      while (iterations < this.config.maxToolIterations) {
        iterations++;

        // Build request
        const requestMessages = [...claudeMessages];

        // Add tool results if any
        if (pendingToolResults.length > 0) {
          const toolResultMessage: Anthropic.MessageParam = {
            role: 'user',
            content: pendingToolResults.map((tr) => ({
              type: 'tool_result' as const,
              tool_use_id: tr.tool_use_id,
              content: tr.content,
            })),
          };
          requestMessages.push(toolResultMessage);
          // Persist tool_result in conversation to keep tool_use -> tool_result sequence
          claudeMessages.push(toolResultMessage);
          pendingToolResults = [];
        }

        const modelConfig = {
          model: this.config.model,
          maxTokens: this.config.maxTokens,
          temperature: this.config.temperature,
        };
        // Call Claude
        console.log(
          `[RetailAgent] Claude request (iter ${iterations}, model ${modelConfig.model}, msgLen ${message.length}, history ${recentHistory.length}, tools ${tools.length}, state ${fsm.getState()})`
        );
        const llmStart = Date.now();
        const llmResponse = await this.callClaudeWithTimeout(() =>
          this.anthropic.messages.create({
            model: modelConfig.model,
            max_tokens: modelConfig.maxTokens,
            temperature: modelConfig.temperature,
            system: systemPrompt,
            messages: requestMessages,
            tools,
          }, { timeout: LLM_TIMEOUT_MS })
        );
        const llmDuration = Date.now() - llmStart;
        console.log(
          `[RetailAgent] Claude response in ${llmDuration}ms (iter ${iterations}, msgLen ${message.length}, history ${recentHistory.length})`
        );

        totalTokens += llmResponse.usage.input_tokens + llmResponse.usage.output_tokens;

        // Parse response
        let hasToolUse = false;

        for (const block of llmResponse.content) {
          if (block.type === 'text') {
            response = block.text;
          } else if (block.type === 'tool_use') {
            hasToolUse = true;
            if (!allowedToolNames.has(block.name)) {
              pendingToolResults.push({
                tool_use_id: block.id,
                content: JSON.stringify({
                  success: false,
                  error: 'Tool not allowed in this context',
                }),
              });
              continue;
            }

            if (toolRegistry.requiresConfirmation(block.name)) {
              const enrichedInput = await this.enrichConfirmationInput(
                block.name,
                block.input as Record<string, unknown>,
                workspaceId
              );
              const confirmation = buildConfirmationRequest(block.name, enrichedInput);
              await this.memoryManager.setPendingConfirmation(sessionId, confirmation);
              response = confirmation.message;
              confirmationRequested = true;
              break;
            }

            // Audit: Tool call
            await this.audit({
              correlationId,
              sessionId,
              workspaceId,
              timestamp: new Date(),
              phase: 'tool_call',
              data: { tool: block.name, input: block.input },
            });

            // Execute tool
            const execution = await toolRegistry.execute(
              block.name,
              block.input as Record<string, unknown>,
              toolContext
            );

            toolsUsed.push(execution);
            if (MEMORY_MUTATING_TOOLS.has(block.name)) {
              const refreshed = await this.memoryManager.getSession(sessionId);
              if (refreshed) {
                memory = refreshed;
              }
            }

            // Handle state transition
            if (execution.result.stateTransition) {
              if (fsm.canTransition(execution.result.stateTransition)) {
                fsm.transition(execution.result.stateTransition);
                await this.memoryManager.updateState(sessionId, execution.result.stateTransition);
              }
            }

            // Audit: Result
            await this.audit({
              correlationId,
              sessionId,
              workspaceId,
              timestamp: new Date(),
              phase: 'result',
              data: {
                tool: block.name,
                success: execution.result.success,
                error: execution.result.error,
              },
            });

            // Add tool result for next iteration
            pendingToolResults.push({
              tool_use_id: block.id,
              content: JSON.stringify(execution.result),
            });
          }
        }

        if (confirmationRequested) {
          break;
        }

        // If no tool use or end turn, we're done
        if (!hasToolUse || llmResponse.stop_reason === 'end_turn') {
          break;
        }

        // CRITICAL: Add assistant response with tool_use blocks to conversation
        // This ensures tool_result blocks have corresponding tool_use in previous message
        claudeMessages.push({
          role: 'assistant',
          content: llmResponse.content,
        });
      }

      let responseType: ProcessMessageOutput['responseType'];
      let responsePayload: ProcessMessageOutput['responsePayload'];

      response = applyProductInquiryFallback(response, message, toolsUsed, memory, fsm);
      response = enforceMenuForOrdering(response, memory, fsm);

      const updated = updateLastProductInquiry(message, toolsUsed, memory, fsm);
      if (updated) {
        await this.memoryManager.saveSession(memory);
      }

      // If cart was mutated, respond with order summary + action buttons
      const cartMutationTools = new Set(['add_to_cart', 'update_cart_item', 'remove_from_cart', 'clear_cart']);
      const hasCartMutation = toolsUsed.some((t) => cartMutationTools.has(t.toolName));
      if (hasCartMutation) {
        const cart = await this.memoryManager.getCart(sessionId);
        if (cart && cart.items.length > 0) {
          const isEditingExistingOrder = !!memory.context.editingOrderId;
          const shouldSendPdf = cart.items.length > LONG_ORDER_SUMMARY_THRESHOLD;
          if (isEditingExistingOrder) {
            const actions = buildEditOrderActionsContent();
            if (shouldSendPdf) {
              const execution = await toolRegistry.execute(
                'send_order_pdf',
                {
                  summary: buildCartSummaryPayload(cart, memory.context.editingOrderNumber),
                },
                toolContext
              );
              toolsUsed.push(execution);
              response = execution.result.success
                ? '🛒 Te envié el resumen actualizado en PDF.'
                : `Perfecto, revisa si está bien:\n\n${buildOrderSummaryMessage(cart)}`;
            } else {
              response = `Perfecto, revisa si está bien:\n\n${buildOrderSummaryMessage(cart)}`;
            }
            responseType = 'interactive-buttons';
            responsePayload = actions.interactive;
          } else {
            const actions = buildOrderActionsContent();
            if (shouldSendPdf) {
              const execution = await toolRegistry.execute(
                'send_order_pdf',
                {
                  summary: buildCartSummaryPayload(cart),
                },
                toolContext
              );
              toolsUsed.push(execution);
              response = execution.result.success
                ? '🛒 Te envié el resumen del pedido en PDF.'
                : buildOrderSummaryMessage(cart);
            } else {
              response = buildOrderSummaryMessage(cart);
            }
            responseType = 'interactive-buttons';
            responsePayload = actions.interactive;
          }

          if (fsm.canTransition(AgentState.AWAITING_CONFIRMATION)) {
            fsm.transition(AgentState.AWAITING_CONFIRMATION);
            await this.memoryManager.updateState(sessionId, AgentState.AWAITING_CONFIRMATION);
          }
        } else {
          response = 'Tu pedido quedó vacío.';
          if (fsm.canTransition(AgentState.IDLE)) {
            fsm.transition(AgentState.IDLE);
            await this.memoryManager.updateState(sessionId, AgentState.IDLE);
          }
        }
      }

      if (response && isCatalogOfferResponse(response)) {
        const parsed = parseQuantityMessage(message);
        const requested = parsed.segments.map((segment) => segment.name);
        const offerContent = buildCatalogOfferContent(requested);

        memory.context.pendingCatalogOffer = { requested };
        await this.memoryManager.saveSession(memory);

        response = offerContent.text;
        responseType = 'interactive-buttons';
        responsePayload = offerContent.interactive;
      }

      if (response && !responseType && isPrimaryMenuResponse(response)) {
        const menuContent = buildPrimaryMenuContent();
        memory.context.lastMenu = 'primary';
        await this.memoryManager.saveSession(memory);

        response = menuContent.text;
        responseType = 'interactive-buttons';
        responsePayload = menuContent.interactive;
      }

      // Store assistant response
      if (response) {
        await this.storeMessage(sessionId, 'assistant', response);
      }

      // Update session
      await this.prisma.agentSession.updateMany({
        where: { id: sessionId, workspaceId },
        data: {
          currentState: fsm.getState(),
          lastActivityAt: new Date(),
        },
      });

      // Audit: Decision
      await this.audit({
        correlationId,
        sessionId,
        workspaceId,
        timestamp: new Date(),
        phase: 'decision',
        data: {
          finalState: fsm.getState(),
          toolsUsed: toolsUsed.length,
          tokens: totalTokens,
          durationMs: Date.now() - startTime,
        },
      });

      const handoffTriggered = toolsUsed.some(
        (tool) => tool.toolName === 'request_handoff' && tool.result?.success
      );

      return {
        response,
        responseType,
        responsePayload,
        state: fsm.getState(),
        toolsUsed,
        tokensUsed: totalTokens,
        shouldSendMessage: response.length > 0 && (fsm.isAgentActive() || handoffTriggered),
      };
    } catch (error) {
      console.error('[RetailAgent] Error processing message:', error);

      // Audit: Error
      await this.audit({
        correlationId,
        sessionId,
        workspaceId,
        timestamp: new Date(),
        phase: 'result',
        data: {
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        },
      });

      const isTimeout = error instanceof Error && error.message === 'LLM_TIMEOUT';
      return {
        response: isTimeout
          ? 'Estoy tardando más de lo normal. ¿Podés reenviar tu pedido o dividirlo en dos mensajes?'
          : 'Disculpá, tuve un problema procesando tu mensaje. ¿Podés intentar de nuevo?',
        state: AgentState.IDLE,
        toolsUsed,
        tokensUsed: totalTokens,
        shouldSendMessage: true,
      };
    }
  }

  /**
   * Get conversation history for a session
   */
  private async getConversationHistory(
    sessionId: string,
    since?: Date
  ): Promise<Array<{ role: string; content: string }>> {
    const contextLimit = Number(process.env.AGENT_CONTEXT_LIMIT || 120);
    const messages = await this.prisma.agentMessage.findMany({
      where: {
        sessionId,
        ...(since ? { createdAt: { gte: since } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: Number.isFinite(contextLimit) && contextLimit > 0 ? contextLimit : 120, // Limit context window
      select: {
        role: true,
        content: true,
      },
    });

    return messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role,
        content: m.content,
      }));
  }

  private async getSessionContextStartAt(
    sessionId: string,
    workspaceId: string
  ): Promise<Date | undefined> {
    const session = await this.prisma.agentSession.findFirst({
      where: { id: sessionId, workspaceId },
      select: { metadata: true },
    });
    const metadata = (session?.metadata as Record<string, unknown>) || {};
    const value = metadata.contextStartAt;
    if (typeof value === 'string') {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }
    return undefined;
  }

  private async callClaudeWithTimeout<T>(fn: () => Promise<T>, timeoutMs = LLM_TIMEOUT_MS): Promise<T> {
    let timeoutId: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('LLM_TIMEOUT')), timeoutMs);
    });

    try {
      return await Promise.race([fn(), timeoutPromise]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  /**
   * Store a message in the database
   */
  private async storeMessage(
    sessionId: string,
    role: string,
    content: string,
    externalId?: string
  ): Promise<void> {
    // Check for duplicate
    if (externalId) {
      const existing = await this.prisma.agentMessage.findFirst({
        where: { sessionId, externalId },
      });
      if (existing) return; // Idempotency
    }

    await this.prisma.agentMessage.create({
      data: {
        sessionId,
        role,
        content,
        externalId: externalId ?? null,
      },
    });
  }

  private async resolveWorkspaceAvailability(
    workspaceId: string
  ): Promise<'available' | 'unavailable' | 'vacation' | null> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { settings: true },
    });
    if (!workspace) return null;

    const settings = (workspace.settings as Record<string, unknown>) || {};
    const businessType = typeof settings.businessType === 'string' ? settings.businessType : 'commerce';
    if (businessType !== 'commerce') return null;

    const status = typeof settings.availabilityStatus === 'string' ? settings.availabilityStatus : null;
    if (status === 'available' || status === 'unavailable' || status === 'vacation') {
      return status;
    }
    return null;
  }

  /**
   * Load commerce profile
   */
  private async loadCommerceProfile(workspaceId: string): Promise<any> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { settings: true },
    });

    return workspace?.settings || {};
  }

  private shouldClassifyOrderIntent(
    message: string,
    fsm: StateMachine,
    memory: SessionMemory
  ): boolean {
    const normalized = normalizeSimpleText(message);
    if (!normalized) return false;
    if (isMenuRequest(message) || isReturnToMenu(message)) return false;
    if (memory.context.pendingOrderDecision) return false;
    if (memory.context.pendingCancelOrderId) return false;
    if (memory.context.activeOrdersPrompt) return false;
    if (memory.context.paymentStage) return false;
    if (memory.context.pendingRegistration) return false;
    if (!fsm.isInOrderFlow() && !memory.context.editingOrderId) return false;

    const hasNumber = /\d/.test(normalized);
    const hasActionWord = /(agreg|sum|anad|pon|met|quit|sac|elim|borr|canc)/.test(normalized);
    return hasNumber || hasActionWord;
  }

  private async classifyOrderIntent(message: string): Promise<OrderIntentResult | null> {
    try {
      const system = [
        'Sos un clasificador de intención para edición de pedidos.',
        'Devolvé SOLO JSON válido sin texto extra.',
        'Campos:',
        '- action: "add" | "remove" | "other"',
        '- clean_text: string (solo productos con cantidades, sin verbos ni pedidos)',
        '- confidence: number (0-1)',
        'Reglas:',
        '- Si el mensaje pide agregar productos, action="add".',
        '- Si pide sacar/quitar/eliminar productos, action="remove".',
        '- Si no hay productos o no es claro, action="other" y clean_text="".',
        '- Mantener cantidades, unidades y nombres; no inventar productos.',
        'Ejemplos:',
        'Usuario: "agregame 5 cocas 2.25" -> {"action":"add","clean_text":"5 cocas 2.25","confidence":0.86}',
        'Usuario: "quitame 2 cocas" -> {"action":"remove","clean_text":"2 cocas","confidence":0.86}',
        'Usuario: "hola" -> {"action":"other","clean_text":"","confidence":0.2}',
      ].join('\n');

      const response = await this.anthropic.messages.create({
        model: this.config.model,
        max_tokens: 256,
        temperature: 0,
        system,
        messages: [{ role: 'user', content: message }],
      });

      const text = response?.content?.[0]?.type === 'text'
        ? response.content[0].text
        : '';
      if (!text) return null;

      const parsed = safeParseJson(text) as Record<string, unknown> | null;
      if (!parsed || typeof parsed.action !== 'string') return null;

      const action = parsed.action as OrderIntentAction;
      if (!['add', 'remove', 'other'].includes(action)) return null;

      const cleanCandidate = parsed['clean_text'] ?? parsed['cleanText'];
      const cleanText = typeof cleanCandidate === 'string' ? cleanCandidate.trim() : '';
      const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : undefined;

      return { action, cleanText, confidence };
    } catch (error) {
      console.warn('[RetailAgent] Intent classification failed:', error);
      return null;
    }
  }

  /**
   * Create audit log entry
   */
  private async audit(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          workspaceId: entry.workspaceId,
          correlationId: entry.correlationId,
          actorType: 'agent',
          actorId: null,
          action: `agent.${entry.phase}`,
          resourceType: 'AgentSession',
          resourceId: entry.sessionId,
          status: 'success',
          inputData: entry.data as Prisma.InputJsonValue,
          metadata: Prisma.JsonNull,
        },
      });
    } catch (error) {
      console.error('[RetailAgent] Failed to create audit log:', error);
    }
  }

  /**
   * Get or create session for customer
   */
  async getOrCreateSession(
    workspaceId: string,
    customerId: string,
    channelId: string,
    channelType = 'whatsapp'
  ): Promise<string> {
    const normalizedChannelId = channelType === 'whatsapp'
      ? this.normalizePhone(channelId)
      : channelId;
    const channelIds = new Set<string>();
    channelIds.add(channelId);
    channelIds.add(normalizedChannelId);
    if (normalizedChannelId.startsWith('+')) {
      channelIds.add(normalizedChannelId.slice(1));
    }

    // Look for existing session (unique by workspace+channel)
    const existing = await this.prisma.agentSession.findFirst({
      where: {
        workspaceId,
        channelType,
        OR: Array.from(channelIds).map((id) => ({ channelId: id })),
      },
    });

    if (existing) {
      // Re-open ended sessions or fix mismatched customer assignment.
      // Do NOT auto-reactivate sessions paused by a human.
      if (existing.endedAt || existing.customerId !== customerId) {
        const currentMetadata = (existing.metadata as Record<string, unknown>) || {};
        const contextStartAt = new Date().toISOString();
        await this.prisma.agentSession.updateMany({
          where: { id: existing.id, workspaceId },
          data: {
            customerId,
            endedAt: null,
            endReason: null,
            currentState: AgentState.IDLE,
            previousState: null,
            agentActive: true,
            failureCount: 0,
            lastFailure: null,
            lastActivityAt: new Date(),
            metadata: {
              ...currentMetadata,
              contextStartAt,
            } as Prisma.InputJsonValue,
          },
        });

        // Reset memory for a clean session state
        await this.memoryManager.initSession(existing.id, workspaceId, customerId);
      }

      return existing.id;
    }

    // Create new session
    const session = await this.prisma.agentSession.create({
      data: {
        workspaceId,
        customerId,
        channelId: normalizedChannelId,
        channelType,
        currentState: AgentState.IDLE,
        agentActive: true,
        metadata: {
          contextStartAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    });

    // Initialize memory
    await this.memoryManager.initSession(session.id, workspaceId, customerId);

    return session.id;
  }

  /**
   * Get or create customer by phone
   */
  async getOrCreateCustomer(
    workspaceId: string,
    phone: string,
    options?: { silent?: boolean; deletedAt?: Date | null; metadata?: Record<string, unknown> }
  ): Promise<string> {
    const normalizedPhone = this.normalizePhone(phone);
    const normalizedDigits = this.normalizePhoneDigits(phone);
    const phoneCandidates = new Set<string>();
    phoneCandidates.add(phone);
    phoneCandidates.add(normalizedPhone);
    if (normalizedPhone.startsWith('+')) {
      phoneCandidates.add(normalizedPhone.slice(1));
    }

    let customer = await this.prisma.customer.findFirst({
      where: {
        workspaceId,
        OR: Array.from(phoneCandidates).map((value) => ({ phone: value })),
      },
    });

    if (!customer && normalizedDigits) {
      const suffixLength = Math.min(7, normalizedDigits.length);
      const suffix = normalizedDigits.slice(-suffixLength);
      const fuzzyCandidates = await this.prisma.customer.findMany({
        where: {
          workspaceId,
          phone: { endsWith: suffix },
        },
      });

      customer =
        fuzzyCandidates.find((candidate) =>
          this.normalizePhoneDigits(candidate.phone) === normalizedDigits
        ) || null;
    }

    if (customer && customer.phone !== normalizedPhone) {
      const existingNormalized = await this.prisma.customer.findFirst({
        where: { workspaceId, phone: normalizedPhone },
        select: { id: true },
      });
      if (!existingNormalized || existingNormalized.id === customer.id) {
        await this.prisma.customer.updateMany({
          where: { id: customer.id, workspaceId },
          data: { phone: normalizedPhone },
        });
      }
    }

    if (customer && options?.metadata && typeof customer.metadata === 'object' && customer.metadata) {
      const currentMetadata = (customer.metadata as Record<string, unknown>) || {};
      let shouldUpdate = false;
      for (const [key, value] of Object.entries(options.metadata)) {
        if (currentMetadata[key] !== value) {
          shouldUpdate = true;
          break;
        }
      }
      if (shouldUpdate) {
        const mergedMetadata = { ...currentMetadata, ...options.metadata };
        await this.prisma.customer.updateMany({
          where: { id: customer.id, workspaceId },
          data: { metadata: mergedMetadata as Prisma.InputJsonValue },
        });
      }
    }

    if (!customer) {
      customer = await this.prisma.customer.create({
        data: {
          workspaceId,
          phone: normalizedPhone,
          status: 'active',
          deletedAt: options?.deletedAt ?? null,
          metadata: (options?.metadata ?? {}) as Prisma.InputJsonValue,
        },
      });

      try {
        if (!options?.silent) {
          await createNotificationIfEnabled(this.prisma, {
            workspaceId,
            type: 'customer.new',
            title: 'Nuevo cliente',
            message: `Cliente ${normalizedPhone} registrado`,
            entityType: 'Customer',
            entityId: customer.id,
            metadata: {
              customerId: customer.id,
              phone: normalizedPhone,
              sessionId: null,
            },
          });
        }
      } catch (error) {
        // Non-blocking
      }
    }

    return customer.id;
  }

  private async tryQuickOrderParse(
    message: string,
    toolContext: ToolContext,
    memory: SessionMemory,
    fsm: StateMachine,
    messageId: string
  ): Promise<ProcessMessageOutput | null> {
    if (fsm.getState() !== AgentState.COLLECTING_ORDER && fsm.getState() !== AgentState.IDLE) {
      return null;
    }

    const normalized = normalizeMatchText(message);
    if (!normalized) return null;

    if (shouldSkipQuickParse(message)) return null;

    const parsed = parseQuantityMessage(message);
    if (parsed.hasLeadingWithoutQuantity && !parsed.canInferLeading) return null;
    const segments = parsed.segments;
    if (segments.length === 0) return null;
    if (segments.length === 1 && fsm.getState() !== AgentState.COLLECTING_ORDER && message.trim().length < 25) {
      return null;
    }

    const candidates = await this.loadProductCandidates(memory.workspaceId);
    if (candidates.length === 0) {
      const requested = segments.map((segment) => segment.name);
      const offerContent = buildCatalogOfferContent(requested);
      const latest = (await this.memoryManager.getSession(memory.sessionId)) || memory;
      latest.context.pendingCatalogOffer = { requested };
      await this.memoryManager.saveSession(latest);

      await this.storeMessage(memory.sessionId, 'user', message, messageId);
      await this.storeMessage(memory.sessionId, 'assistant', offerContent.text);

      return {
        response: offerContent.text,
        responseType: 'interactive-buttons',
        responsePayload: offerContent.interactive,
        state: fsm.getState(),
        toolsUsed: [],
        tokensUsed: 0,
        shouldSendMessage: true,
      };
    }

    const toolsUsed: ToolExecution[] = [];
    const errors: string[] = [];
    const unknown: string[] = [];
    const shortages: InsufficientStockDetail[] = [];

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index]!;
      const requestedSecondaryUnit = extractRequestedSecondaryUnit(segment.name);
      const matchResult = matchSegmentToProduct(segment, candidates);
      if (matchResult.type === 'none') {
        unknown.push(segment.name);
        continue;
      }

      if (matchResult.type === 'ambiguous') {
        const options = matchResult.options.slice(0, 10);
        const remainingSegments = segments.slice(index + 1);
        const latest = (await this.memoryManager.getSession(memory.sessionId)) || memory;
        latest.context.pendingProductSelection = {
          quantity: segment.quantity,
          requestedName: segment.name,
          options,
          requestedSecondaryUnit: requestedSecondaryUnit || undefined,
          remainingSegments,
          pendingUnknown: unknown.length > 0 ? [...unknown] : undefined,
          pendingErrors: errors.length > 0 ? [...errors] : undefined,
          pendingShortages: shortages.length > 0 ? [...shortages] : undefined,
        };
        await this.memoryManager.saveSession(latest);

        const selectionContent = buildProductSelectionContent(
          segment.name,
          segment.quantity,
          options,
          requestedSecondaryUnit || undefined
        );

        await this.storeMessage(memory.sessionId, 'user', message, messageId);
        await this.storeMessage(memory.sessionId, 'assistant', selectionContent.text);

        return {
          response: selectionContent.text,
          responseType: selectionContent.responseType,
          responsePayload: selectionContent.responsePayload,
          state: fsm.getState(),
          toolsUsed: [],
          tokensUsed: 0,
          shouldSendMessage: true,
        };
      }

      const match = matchResult.match;
      const multiplier = resolveSecondaryUnitMultiplier(
        requestedSecondaryUnit,
        match.secondaryUnit,
        match.secondaryUnitValue
      );
      const adjustedQuantity = multiplier ? segment.quantity * multiplier : segment.quantity;
      const execution = await toolRegistry.execute(
        'add_to_cart',
        {
          productId: match.productId,
          variantId: match.variantId,
          quantity: adjustedQuantity,
        },
        toolContext
      );
      toolsUsed.push(execution);

      if (!execution.result.success) {
        const insufficient = extractInsufficientStock(execution.result.data);
        if (insufficient.length > 0) {
          shortages.push(...insufficient);
        } else {
          errors.push(execution.result.error || `No pude agregar ${match.name}.`);
        }
      }
    }

    await this.storeMessage(memory.sessionId, 'user', message, messageId);

    const cart = await this.memoryManager.getCart(memory.sessionId);
    if (!cart || cart.items.length === 0) {
      const hasStockAvailable = shortages.some((detail) => detail.available > 0);
      if (shortages.length > 0 && hasStockAvailable) {
        const latest = (await this.memoryManager.getSession(memory.sessionId)) || memory;
        latest.context.pendingStockAdjustment = { items: shortages };
        await this.memoryManager.saveSession(latest);
        const response = buildInsufficientStockMessage(shortages);
        await this.storeMessage(memory.sessionId, 'assistant', response);
        return {
          response,
          state: fsm.getState(),
          toolsUsed,
          tokensUsed: 0,
          shouldSendMessage: true,
        };
      }

      if (unknown.length > 0 || shortages.length > 0) {
        const requested = [
          ...unknown,
          ...shortages.map((detail) => detail.name),
        ];
        const offerContent = buildCatalogOfferContent(requested);
        const latest = (await this.memoryManager.getSession(memory.sessionId)) || memory;
        latest.context.pendingCatalogOffer = { requested };
        await this.memoryManager.saveSession(latest);

        await this.storeMessage(memory.sessionId, 'assistant', offerContent.text);
        return {
          response: offerContent.text,
          responseType: 'interactive-buttons',
          responsePayload: offerContent.interactive,
          state: fsm.getState(),
          toolsUsed,
          tokensUsed: 0,
          shouldSendMessage: true,
        };
      }

      const issueLines = [
        ...errors.map((e) => `• ${e}`),
        ...unknown.map((u) => `• No encontré "${u}"`),
      ];
      const response = issueLines.length
        ? ['No pude agregar esos productos:', ...issueLines, '¿Querés intentar de nuevo?'].join('\n')
        : 'No pude interpretar tu pedido. ¿Podés reenviarlo?';

      await this.storeMessage(memory.sessionId, 'assistant', response);
      return {
        response,
        state: fsm.getState(),
        toolsUsed,
        tokensUsed: 0,
        shouldSendMessage: true,
      };
    }

    const isEditingExistingOrder = !!memory.context.editingOrderId;
    const actions = isEditingExistingOrder ? buildEditOrderActionsContent() : buildOrderActionsContent();
    const shouldSendPdf = cart.items.length > LONG_ORDER_SUMMARY_THRESHOLD;
    let response = '';

    if (shouldSendPdf) {
      const execution = await toolRegistry.execute(
        'send_order_pdf',
        {
          summary: buildCartSummaryPayload(cart, memory.context.editingOrderNumber),
        },
        toolContext
      );
      toolsUsed.push(execution);
      response = execution.result.success
        ? '🛒 Te envié el resumen del pedido en PDF.'
        : buildOrderSummaryMessage(cart);
    } else {
      response = buildOrderSummaryMessage(cart);
    }

    if (shortages.length > 0) {
      const latest = (await this.memoryManager.getSession(memory.sessionId)) || memory;
      latest.context.pendingStockAdjustment = { items: shortages };
      await this.memoryManager.saveSession(latest);
      response = [
        buildInsufficientStockMessage(shortages),
        '',
        response,
      ].join('\n');
    }

    const issueLines = [
      ...errors.map((e) => `• ${e}`),
      ...unknown.map((u) => `• No encontré "${u}"`),
    ];
    if (issueLines.length > 0) {
      response = [
        '⚠️ Algunos productos no se pudieron agregar:',
        ...issueLines,
        '',
        response,
      ].join('\n');
    }

    await this.storeMessage(memory.sessionId, 'assistant', response);

    if (fsm.canTransition(AgentState.AWAITING_CONFIRMATION)) {
      fsm.transition(AgentState.AWAITING_CONFIRMATION);
      await this.memoryManager.updateState(memory.sessionId, AgentState.AWAITING_CONFIRMATION);
    }

    await this.prisma.agentSession.updateMany({
      where: { id: memory.sessionId, workspaceId: memory.workspaceId },
      data: {
        currentState: fsm.getState(),
        lastActivityAt: new Date(),
      },
    });

    return {
      response,
      responseType: 'interactive-buttons',
      responsePayload: actions.interactive,
      state: fsm.getState(),
      toolsUsed,
      tokensUsed: 0,
      shouldSendMessage: true,
    };
  }

  private async continueQuickOrderParse(
    segments: Array<{ quantity: number; name: string }>,
    toolContext: ToolContext,
    memory: SessionMemory,
    fsm: StateMachine,
    toolsUsed: ToolExecution[],
    carryOver: {
      unknown: string[];
      errors: string[];
      shortages: InsufficientStockDetail[];
    }
  ): Promise<ProcessMessageOutput | null> {
    if (!segments || segments.length === 0) return null;

    const candidates = await this.loadProductCandidates(memory.workspaceId);
    if (candidates.length === 0) {
      const requested = [
        ...carryOver.unknown,
        ...carryOver.shortages.map((detail) => detail.name),
        ...segments.map((segment) => segment.name),
      ];
      const offerContent = buildCatalogOfferContent(requested);
      const latest = (await this.memoryManager.getSession(memory.sessionId)) || memory;
      latest.context.pendingCatalogOffer = { requested };
      await this.memoryManager.saveSession(latest);

      await this.storeMessage(memory.sessionId, 'assistant', offerContent.text);

      return {
        response: offerContent.text,
        responseType: 'interactive-buttons',
        responsePayload: offerContent.interactive,
        state: fsm.getState(),
        toolsUsed,
        tokensUsed: 0,
        shouldSendMessage: true,
      };
    }

    const errors = [...carryOver.errors];
    const unknown = [...carryOver.unknown];
    const shortages = [...carryOver.shortages];

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index]!;
      const requestedSecondaryUnit = extractRequestedSecondaryUnit(segment.name);
      const matchResult = matchSegmentToProduct(segment, candidates);
      if (matchResult.type === 'none') {
        unknown.push(segment.name);
        continue;
      }

      if (matchResult.type === 'ambiguous') {
        const options = matchResult.options.slice(0, 10);
        const remainingSegments = segments.slice(index + 1);
        const latest = (await this.memoryManager.getSession(memory.sessionId)) || memory;
        latest.context.pendingProductSelection = {
          quantity: segment.quantity,
          requestedName: segment.name,
          options,
          requestedSecondaryUnit: requestedSecondaryUnit || undefined,
          remainingSegments,
          pendingUnknown: unknown.length > 0 ? [...unknown] : undefined,
          pendingErrors: errors.length > 0 ? [...errors] : undefined,
          pendingShortages: shortages.length > 0 ? [...shortages] : undefined,
        };
        await this.memoryManager.saveSession(latest);

        const selectionContent = buildProductSelectionContent(
          segment.name,
          segment.quantity,
          options,
          requestedSecondaryUnit || undefined
        );

        await this.storeMessage(memory.sessionId, 'assistant', selectionContent.text);

        return {
          response: selectionContent.text,
          responseType: selectionContent.responseType,
          responsePayload: selectionContent.responsePayload,
          state: fsm.getState(),
          toolsUsed,
          tokensUsed: 0,
          shouldSendMessage: true,
        };
      }

      const match = matchResult.match;
      const multiplier = resolveSecondaryUnitMultiplier(
        requestedSecondaryUnit,
        match.secondaryUnit,
        match.secondaryUnitValue
      );
      const adjustedQuantity = multiplier ? segment.quantity * multiplier : segment.quantity;
      const execution = await toolRegistry.execute(
        'add_to_cart',
        {
          productId: match.productId,
          variantId: match.variantId,
          quantity: adjustedQuantity,
        },
        toolContext
      );
      toolsUsed.push(execution);

      if (!execution.result.success) {
        const insufficient = extractInsufficientStock(execution.result.data);
        if (insufficient.length > 0) {
          shortages.push(...insufficient);
        } else {
          errors.push(execution.result.error || `No pude agregar ${match.name}.`);
        }
      }
    }

    const cart = await this.memoryManager.getCart(memory.sessionId);
    if (!cart || cart.items.length === 0) {
      const hasStockAvailable = shortages.some((detail) => detail.available > 0);
      if (shortages.length > 0 && hasStockAvailable) {
        const latest = (await this.memoryManager.getSession(memory.sessionId)) || memory;
        latest.context.pendingStockAdjustment = { items: shortages };
        await this.memoryManager.saveSession(latest);
        const response = buildInsufficientStockMessage(shortages);
        await this.storeMessage(memory.sessionId, 'assistant', response);
        return {
          response,
          state: fsm.getState(),
          toolsUsed,
          tokensUsed: 0,
          shouldSendMessage: true,
        };
      }

      if (unknown.length > 0 || shortages.length > 0) {
        const requested = [
          ...unknown,
          ...shortages.map((detail) => detail.name),
        ];
        const offerContent = buildCatalogOfferContent(requested);
        const latest = (await this.memoryManager.getSession(memory.sessionId)) || memory;
        latest.context.pendingCatalogOffer = { requested };
        await this.memoryManager.saveSession(latest);

        await this.storeMessage(memory.sessionId, 'assistant', offerContent.text);
        return {
          response: offerContent.text,
          responseType: 'interactive-buttons',
          responsePayload: offerContent.interactive,
          state: fsm.getState(),
          toolsUsed,
          tokensUsed: 0,
          shouldSendMessage: true,
        };
      }

      const issueLines = [
        ...errors.map((e) => `• ${e}`),
        ...unknown.map((u) => `• No encontré "${u}"`),
      ];
      const response = issueLines.length
        ? ['No pude agregar esos productos:', ...issueLines, '¿Querés intentar de nuevo?'].join('\n')
        : 'No pude interpretar tu pedido. ¿Podés reenviarlo?';

      await this.storeMessage(memory.sessionId, 'assistant', response);
      return {
        response,
        state: fsm.getState(),
        toolsUsed,
        tokensUsed: 0,
        shouldSendMessage: true,
      };
    }

    const isEditingExistingOrder = !!memory.context.editingOrderId;
    const actions = isEditingExistingOrder ? buildEditOrderActionsContent() : buildOrderActionsContent();
    const shouldSendPdf = cart.items.length > LONG_ORDER_SUMMARY_THRESHOLD;
    let response = '';

    if (shouldSendPdf) {
      const execution = await toolRegistry.execute(
        'send_order_pdf',
        {
          summary: buildCartSummaryPayload(cart, memory.context.editingOrderNumber),
        },
        toolContext
      );
      toolsUsed.push(execution);
      response = execution.result.success
        ? '🛒 Te envié el resumen del pedido en PDF.'
        : buildOrderSummaryMessage(cart);
    } else {
      response = buildOrderSummaryMessage(cart);
    }

    if (shortages.length > 0) {
      const latest = (await this.memoryManager.getSession(memory.sessionId)) || memory;
      latest.context.pendingStockAdjustment = { items: shortages };
      await this.memoryManager.saveSession(latest);
      response = [
        buildInsufficientStockMessage(shortages),
        '',
        response,
      ].join('\n');
    }

    const issueLines = [
      ...errors.map((e) => `• ${e}`),
      ...unknown.map((u) => `• No encontré "${u}"`),
    ];
    if (issueLines.length > 0) {
      response = [
        '⚠️ Algunos productos no se pudieron agregar:',
        ...issueLines,
        '',
        response,
      ].join('\n');
    }

    await this.storeMessage(memory.sessionId, 'assistant', response);

    if (fsm.canTransition(AgentState.AWAITING_CONFIRMATION)) {
      fsm.transition(AgentState.AWAITING_CONFIRMATION);
      await this.memoryManager.updateState(memory.sessionId, AgentState.AWAITING_CONFIRMATION);
    }

    await this.prisma.agentSession.updateMany({
      where: { id: memory.sessionId, workspaceId: memory.workspaceId },
      data: {
        currentState: fsm.getState(),
        lastActivityAt: new Date(),
      },
    });

    return {
      response,
      responseType: 'interactive-buttons',
      responsePayload: actions.interactive,
      state: fsm.getState(),
      toolsUsed,
      tokensUsed: 0,
      shouldSendMessage: true,
    };
  }

  private async loadProductCandidates(workspaceId: string): Promise<Array<{
    productId: string;
    variantId?: string;
    name: string;
    normalized: string;
    tokens: Set<string>;
    price: number;
    secondaryUnit?: string | null;
    secondaryUnitValue?: string | number | null;
  }>> {
    const products = await this.prisma.product.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        status: 'active',
      },
      include: {
        stockItems: true,
        variants: {
          where: { deletedAt: null, status: 'active' },
          include: { stockItems: true },
        },
      },
    });

    const candidates: Array<{
      productId: string;
      variantId?: string;
      name: string;
      normalized: string;
      tokens: Set<string>;
      price: number;
      secondaryUnit?: string | null;
      secondaryUnitValue?: string | number | null;
    }> = [];

    for (const product of products) {
      const baseName = buildProductCandidateName(product);
      if (!baseName) continue;

      const baseStock = product.stockItems.reduce(
        (sum, item) => sum + item.quantity - item.reserved,
        0
      );
      const hasVariants = product.variants.length > 0;
      const variantsWithStock = product.variants.filter((variant) =>
        variant.stockItems.reduce((sum, item) => sum + item.quantity - item.reserved, 0) > 0
      );

      if ((!hasVariants || variantsWithStock.length === 0) && baseStock > 0) {
        const baseNormalized = normalizeMatchText(baseName);
        if (baseNormalized) {
          candidates.push({
            productId: product.id,
            name: baseName,
            normalized: baseNormalized,
            tokens: new Set(baseNormalized.split(' ')),
            price: product.price,
            secondaryUnit: product.secondaryUnit,
            secondaryUnitValue: product.secondaryUnitValue,
          });
        }
      }

      for (const variant of variantsWithStock) {
        const variantName = `${baseName} - ${variant.name}`.trim();
        const variantNormalized = normalizeMatchText(variantName);
        if (!variantNormalized) continue;
        candidates.push({
          productId: product.id,
          variantId: variant.id,
          name: variantName,
          normalized: variantNormalized,
          tokens: new Set(variantNormalized.split(' ')),
          price: variant.price ?? product.price,
          secondaryUnit: product.secondaryUnit,
          secondaryUnitValue: product.secondaryUnitValue,
        });
      }
    }

    return candidates;
  }

  private async handleOrderViewRequest(
    request: { orderNumber?: string },
    toolContext: ToolContext,
    memory: SessionMemory,
    fsm: StateMachine,
    message: string,
    messageId: string
  ): Promise<ProcessMessageOutput | null> {
    if (!request.orderNumber) {
      const response = '¿Qué pedido querés ver? Pasame el número (ej: ORD-00008).';
      memory.context.orderViewAwaitingNumber = true;
      await this.memoryManager.saveSession(memory);
      await this.storeMessage(memory.sessionId, 'user', message, messageId);
      await this.storeMessage(memory.sessionId, 'assistant', response);
      return {
        response,
        state: fsm.getState(),
        toolsUsed: [],
        tokensUsed: 0,
        shouldSendMessage: true,
      };
    }

    const reference = request.orderNumber.trim();
    const hasLetters = /[a-zA-Z]/.test(reference);
    const exactReference = hasLetters ? reference.toUpperCase() : null;
    let order = exactReference
      ? await this.prisma.order.findFirst({
          where: withVisibleOrders({
            workspaceId: memory.workspaceId,
            customerId: memory.customerId,
            orderNumber: exactReference,
          }),
        })
      : null;

    const digits = normalizeOrderDigits(reference);
    if (!order && digits) {
      // Try exact numeric order number
      order = await this.prisma.order.findFirst({
        where: withVisibleOrders({
          workspaceId: memory.workspaceId,
          customerId: memory.customerId,
          orderNumber: digits,
        }),
      });
    }

    if (!order && digits) {
      const candidates = await this.prisma.order.findMany({
        where: withVisibleOrders({
          workspaceId: memory.workspaceId,
          customerId: memory.customerId,
          orderNumber: { endsWith: digits },
        }),
        orderBy: { createdAt: 'desc' },
        take: 5,
      });

      if (candidates.length === 1) {
        order = candidates[0]!;
      } else if (candidates.length > 1) {
        const response = [
          'Hay más de un pedido con ese número.',
          'Pasame el número completo para poder enviártelo.',
          ...candidates.map((candidate) => `• ${candidate.orderNumber}`),
        ].join('\n');
        await this.storeMessage(memory.sessionId, 'user', message, messageId);
        await this.storeMessage(memory.sessionId, 'assistant', response);
        return {
          response,
          state: fsm.getState(),
          toolsUsed: [],
          tokensUsed: 0,
          shouldSendMessage: true,
        };
      }
    }

    if (!order) {
      const response = 'No encontré ese pedido. Revisá el número e intentá de nuevo.';
      await this.storeMessage(memory.sessionId, 'user', message, messageId);
      await this.storeMessage(memory.sessionId, 'assistant', response);
      return {
        response,
        state: fsm.getState(),
        toolsUsed: [],
        tokensUsed: 0,
        shouldSendMessage: true,
      };
    }

    await this.memoryManager.clearPendingConfirmation(memory.sessionId);
    await this.memoryManager.clearCart(memory.sessionId);
    memory.context.pendingOrderDecision = undefined;
    memory.context.pendingOrderId = undefined;
    memory.context.pendingOrderNumber = undefined;
    memory.context.pendingCancelOrderId = undefined;
    memory.context.pendingCancelOrderNumber = undefined;
    memory.context.activeOrdersPrompt = undefined;
    memory.context.activeOrdersAction = undefined;
    memory.context.activeOrdersAwaiting = undefined;
    memory.context.activeOrdersPayable = undefined;
    memory.context.editingOrderId = undefined;
    memory.context.editingOrderNumber = undefined;
    memory.context.editingOrderOriginalItems = undefined;
    memory.context.orderViewAwaitingNumber = undefined;
    memory.context.orderViewAwaitingAck = true;
    memory.context.lastMenu = 'primary';
    await this.memoryManager.saveSession(memory);

    if (fsm.canTransition(AgentState.IDLE)) {
      fsm.transition(AgentState.IDLE);
      await this.memoryManager.updateState(memory.sessionId, AgentState.IDLE);
    }

    const execution = await toolRegistry.execute(
      'send_order_pdf',
      { orderId: order.id },
      toolContext
    );

    const response = execution.result.success
      ? `Te envié el pedido ${order.orderNumber} en PDF.`
      : execution.result.error || 'No pude enviar el pedido en PDF.';

    await this.storeMessage(memory.sessionId, 'user', message, messageId);
    await this.storeMessage(memory.sessionId, 'assistant', response);

    await this.prisma.agentSession.updateMany({
      where: { id: memory.sessionId, workspaceId: memory.workspaceId },
      data: { currentState: fsm.getState(), lastActivityAt: new Date() },
    });

    return {
      response,
      state: fsm.getState(),
      toolsUsed: [execution],
      tokensUsed: 0,
      shouldSendMessage: true,
    };
  }

  private async getOrderExampleProducts(workspaceId: string): Promise<string[]> {
    const stockItems = await this.prisma.stockItem.findMany({
      where: {
        quantity: { gt: 0 },
        product: {
          workspaceId,
          deletedAt: null,
          status: 'active',
        },
      },
      select: {
        quantity: true,
        reserved: true,
        product: { select: { name: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 12,
    });

    const names: string[] = [];
    for (const item of stockItems) {
      const available = item.quantity - item.reserved;
      if (available <= 0) continue;
      const name = item.product?.name?.trim();
      if (!name || names.includes(name)) continue;
      names.push(name);
      if (names.length >= 2) break;
    }

    return names;
  }

  private isSubagentsEnabled(settings?: Record<string, unknown>): boolean {
    if (!settings) return DEFAULT_SUBAGENTS_ENABLED;
    const value = settings.agentSubagentsEnabled;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.toLowerCase() === 'true';
    return DEFAULT_SUBAGENTS_ENABLED;
  }

  private resolveAgentMode(
    message: string,
    memory: SessionMemory,
    fsm: StateMachine,
    subagentsEnabled: boolean
  ): AgentMode {
    if (!subagentsEnabled) return 'order';

    const normalized = message.toLowerCase();
    const hasPaymentContext =
      Boolean(memory.context.paymentStage) ||
      Boolean(memory.context.paymentOrders) ||
      Boolean(memory.context.paymentOrderId);
    const paymentIntent = PAYMENT_INTENT_KEYWORDS.some((keyword) => normalized.includes(keyword));
    if (hasPaymentContext || paymentIntent) {
      return 'payments';
    }

    const decision = classifyMessage(message, fsm.getState(), MessageThread.ORDER);
    if (decision.thread === MessageThread.INFO) {
      return 'info';
    }

    return 'order';
  }

  private buildModeHint(mode: AgentMode): string {
    switch (mode) {
      case 'info':
        return 'Modo INFO: respondé consultas generales y mantené el foco en información del comercio.';
      case 'payments':
        return 'Modo PAGOS: ayudá con pagos, comprobantes y estados de deuda/pedidos.';
      case 'order':
      default:
        return 'Modo PEDIDO: priorizá armado, edición y confirmación de pedidos.';
    }
  }

  private buildTaskHintWithMode(fsm: StateMachine, memory: SessionMemory, mode: AgentMode): string {
    const base = buildTaskHint(fsm, memory);
    const modeHint = this.buildModeHint(mode);
    return [base, modeHint].filter(Boolean).join('\n');
  }

  private selectToolsForMode<TTool extends { name: string; description: string; input_schema: unknown }>(params: {
    mode: AgentMode;
    allowCatalogTools: boolean;
    baseTools: TTool[];
  }): TTool[] {
    const { mode, allowCatalogTools, baseTools } = params;
    const allTools = toolRegistry.getAll();

    let allowedNames: Set<string> | null = null;
    if (mode === 'info') {
      allowedNames = INFO_TOOL_ALLOWLIST;
    } else if (mode === 'payments') {
      allowedNames = PAYMENT_TOOL_ALLOWLIST;
    }

    let filtered = baseTools;
    if (allowedNames) {
      const allowed = new Set<string>();
      for (const tool of allTools) {
        if (tool.category === ToolCategory.QUERY || tool.category === ToolCategory.SYSTEM || allowedNames.has(tool.name)) {
          allowed.add(tool.name);
        }
      }
      filtered = baseTools.filter((tool) => allowed.has(tool.name));
    }

    if (!allowCatalogTools) {
      filtered = filtered.filter((tool) => !CATALOG_TOOL_NAMES.has(tool.name));
    }

    return filtered.length > 0 ? filtered : baseTools;
  }

  private normalizePhone(phone: string): string {
    const trimmed = phone.trim();
    const digits = trimmed.replace(/\D/g, '');
    if (!digits) return trimmed;
    return `+${digits}`;
  }

  private normalizePhoneDigits(phone: string): string {
    return phone.trim().replace(/\D/g, '');
  }
}

function isNegativeSentiment(normalizedMessage: string): boolean {
  if (!normalizedMessage) return false;
  const hits = NEGATIVE_SENTIMENT_KEYWORDS.filter((keyword) => normalizedMessage.includes(keyword));
  return hits.length >= Math.max(1, NEGATIVE_SENTIMENT_THRESHOLD);
}

/**
 * Create a retail agent instance
 */
export function createRetailAgent(
  prisma: PrismaClient,
  redis: Redis,
  config: AgentConfig,
  deps?: AgentDependencies
): RetailAgent {
  return new RetailAgent(prisma, redis, config, deps);
}

function buildNewCustomerMessage(): string {
  return [
    '¡Hola! 😊 Veo que sos un cliente nuevo. Para poder continuar, necesito que me pases:',
    '',
    '📝 *Datos para registro:*',
    '• Nombre completo',
    '• DNI',
  ].join('\n');
}

function buildRegisteredMessage(fullName: string, menuText: string): string {
  const name = fullName.trim();
  return [
    `¡Perfecto ${name}! 👍 Ya tengo tus datos registrados.`,
    '',
    menuText,
  ].join('\n');
}

function buildPrimaryMenuContent(): { text: string; interactive: InteractiveButtonsPayload } {
  const text = [
    '¿Qué querés hacer?',
    '',
    '1. Hacer pedido',
    '2. Ver pedidos activos',
    '3. Más opciones',
    '',
  ].join('\n');

  return {
    text,
    interactive: {
      body: '¿Qué querés hacer? ✨',
      buttons: [
        { id: 'menu_primary_order', title: '🛒 Hacer pedido' },
        { id: 'menu_primary_active', title: '📦 Pedidos activos' },
        { id: 'menu_primary_more', title: '➕ Más opciones' },
      ],
    },
  };
}

function buildPrimaryMenuLiteContent(): { text: string; interactive: InteractiveButtonsPayload } {
  const text = [
    '¿Qué querés hacer?',
    '',
    '1. Hacer pedido',
    '2. Ver pedidos activos',
    '',
  ].join('\n');

  return {
    text,
    interactive: {
      body: '¿Qué querés hacer? ✨',
      buttons: [
        { id: 'menu_primary_order', title: '🛒 Hacer pedido' },
        { id: 'menu_primary_active', title: '📦 Pedidos activos' },
      ],
    },
  };
}

function buildSecondaryMenuContent(): { text: string; interactive: InteractiveButtonsPayload } {
  const text = [
    'Más opciones:',
    '',
    '1. Ver catálogo',
    '2. Rehacer ultimo pedido',
    '3. Otro',
    '',
  ].join('\n');

  return {
    text,
    interactive: {
      body: 'Más opciones ✨',
      buttons: [
        { id: 'menu_secondary_catalog', title: '📒 Ver catálogo' },
        { id: 'menu_secondary_repeat', title: '🔁 Rehacer pedido' },
        { id: 'menu_secondary_other', title: '🙋 Otro' },
      ],
    },
  };
}

function isPrimaryMenuResponse(text: string): boolean {
  const normalized = normalizeSimpleText(text);
  if (!normalized) return false;

  const hasOrder = normalized.includes('hacer pedido') || normalized.includes('hacer un pedido');
  const hasActive = normalized.includes('pedidos activos');
  const hasMore = normalized.includes('mas opciones');
  const hasPrompt = normalized.includes('que queres hacer') || normalized.includes('que deseas hacer');
  const hasLegacyPrompt = normalized.includes('en que te puedo ayudar') || normalized.includes('en que puedo ayudarte');
  const hasLegacyOptions = normalized.includes('catalogo') && (normalized.includes('precios') || normalized.includes('consultar'));

  const isPrimaryMenu = hasOrder && hasActive && hasMore && hasPrompt;
  const isLegacyMenu = hasOrder && hasLegacyPrompt && hasLegacyOptions;

  return isPrimaryMenu || isLegacyMenu;
}

function buildPendingOrderChoiceContent(orderNumber?: string): { text: string; interactive: InteractiveButtonsPayload } {
  const text = [
    'Tenés un pedido esperando aprobación.',
    orderNumber ? `Pedido: ${orderNumber}` : '',
    '',
    '¿Querés editar ese o crear otro?',
    '',
    '1. Editar',
    '2. Crear nuevo pedido',
    '3. Volver al inicio',
    '',
  ].filter(Boolean).join('\n');

  return {
    text,
    interactive: {
      body: text,
      buttons: [
        { id: 'pending_order_edit', title: '✏️ Editar' },
        { id: 'pending_order_new', title: '🆕 Nuevo pedido' },
        { id: 'pending_order_back', title: '🏠 Volver' },
      ],
    },
  };
}

function buildPendingOrdersChoiceContent(
  orders: Array<{ id: string; orderNumber?: string }>
): { text: string; interactive: InteractiveButtonsPayload } {
  const lines = orders.map((order) => `Pedido: ${order.orderNumber || 'Sin número'}`);
  const text = [
    'Tenés pedidos esperando aprobación.',
    ...lines,
    '',
    '¿Querés editar alguno o crear otro?',
    '',
    '1. Editar',
    '2. Crear nuevo pedido',
    '3. Volver al inicio',
    '',
  ].join('\n');

  return {
    text,
    interactive: {
      body: text,
      buttons: [
        { id: 'pending_order_edit', title: '✏️ Editar' },
        { id: 'pending_order_new', title: '🆕 Nuevo pedido' },
        { id: 'pending_order_back', title: '🏠 Volver' },
      ],
    },
  };
}

function buildPendingOrderSelectionContent(
  orders: Array<{ id: string; orderNumber?: string }>
): { text: string; responseType: 'interactive-list'; responsePayload: InteractiveListPayload } {
  const lines = orders.map((order) => `• ${order.orderNumber || 'Pedido'}`);
  const text = [
    'Tenés pedidos esperando aprobación.',
    ...lines,
    '',
    'Elegí el pedido que querés editar:',
  ].join('\n');

  return {
    text,
    responseType: 'interactive-list',
    responsePayload: {
      body: 'Seleccioná el pedido que querés editar',
      buttonText: 'Ver pedidos',
      sections: [
        {
          title: 'Pedidos esperando aprobación',
          rows: orders.map((order) => ({
            id: `pending_order_select:${order.id}`,
            title: order.orderNumber || 'Pedido',
            description: 'Editar pedido',
          })),
        },
      ],
    },
  };
}

function buildActiveOrdersContent(
  orders: Array<{ orderNumber: string; total: number; status: string }>,
  options: { includePayButton: boolean }
): { text: string; interactive: InteractiveButtonsPayload } {
  const statusLabels: Record<string, string> = {
    awaiting_acceptance: 'Esperando aprobación',
    accepted: 'Aceptado',
    confirmed: 'Aceptado',
    processing: 'En procesamiento',
    pending_payment: 'Pendiente de pago',
    partial_payment: 'Pago parcial',
    paid: 'Pagado',
    cancelled: 'Cancelado',
  };
  const statusEmojis: Record<string, string> = {
    awaiting_acceptance: '⏳',
    accepted: '✅',
    confirmed: '✅',
    processing: '⚙️',
    pending_payment: '💸',
    partial_payment: '💸',
    paid: '✅',
    cancelled: '❌',
  };

  const lines = orders.map((order) => {
    const label = statusLabels[order.status] || order.status;
    const emoji = statusEmojis[order.status] || '📦';
    return `• ${emoji} ${order.orderNumber} - $${formatMoneyCents(order.total)} - ${label}`;
  });

  const text = [
    '📦 *Pedidos activos*',
    ...lines,
    '',
    '¿Qué querés hacer?',
  ].join('\n');

  const buttons = [
    ...(options.includePayButton ? [{ id: 'active_orders_pay', title: '💳 Pagar pedido' }] : []),
    { id: 'active_orders_edit', title: '✏️ Editar' },
    { id: 'active_orders_other', title: 'Otro' },
  ];

  return {
    text,
    interactive: {
      body: text,
      buttons,
    },
  };
}

function buildActiveOrdersOtherContent(): { text: string; interactive: InteractiveButtonsPayload } {
  const text = '¿Qué querés hacer?';
  return {
    text,
    interactive: {
      body: text,
      buttons: [
        { id: 'active_orders_invoice', title: 'Solicitar factura' },
        { id: 'active_orders_cancel', title: 'Cancelar pedido' },
      ],
    },
  };
}

function buildInvoiceRequestSelectionContent(
  orders: Array<{ id: string; orderNumber: string }>
): { text: string; responseType: 'interactive-list'; responsePayload: InteractiveListPayload } {
  const lines = orders.map((order) => `• ${order.orderNumber}`);
  const text = [
    'Elegí el pedido para solicitar la factura:',
    ...lines,
  ].join('\n');

  return {
    text,
    responseType: 'interactive-list',
    responsePayload: {
      body: 'Seleccioná el pedido para facturar',
      buttonText: 'Ver pedidos',
      sections: [
        {
          title: 'Últimos pedidos',
          rows: orders.map((order) => ({
            id: `invoice_request_select:${order.id}`,
            title: order.orderNumber,
          })),
        },
      ],
    },
  };
}

function parseInvoiceRequestSelection(
  message: string,
  orders: Array<{ id: string; orderNumber: string }>
): { order: { id: string; orderNumber: string } | null; ambiguous: boolean } {
  const raw = message.trim();
  if (raw.toLowerCase().startsWith('invoice_request_select:')) {
    const id = raw.split(':')[1];
    const match = orders.find((order) => order.id === id);
    return { order: match || null, ambiguous: false };
  }

  const reference = extractOrderNumber(message) || extractOrderDigits(message);
  if (!reference) return { order: null, ambiguous: false };

  const match = resolveAwaitingOrder(reference, orders);
  return { order: match.order as { id: string; orderNumber: string } | null, ambiguous: match.ambiguous };
}

function buildAwaitingOrderSelectionContent(
  orders: Array<{ id: string; orderNumber: string }>,
  action: 'edit' | 'cancel'
): { text: string; responseType: 'interactive-buttons' | 'interactive-list'; responsePayload: InteractiveButtonsPayload | InteractiveListPayload } {
  const actionLabel = action === 'cancel' ? 'cancelar' : 'editar';
  const emoji = action === 'cancel' ? '🗑️' : '✏️';

  const lines = orders.map((order) => `• ${order.orderNumber}`);
  const text = [
    `Estos son los pedidos que podés ${actionLabel}:`,
    ...lines,
    '',
    `Elegí el pedido que querés ${actionLabel}:`,
  ].join('\n');

  if (orders.length <= 3) {
    return {
      text,
      responseType: 'interactive-buttons',
      responsePayload: {
        body: text,
        buttons: orders.map((order) => ({
          id: `active_orders_select:${order.id}`,
          title: `${emoji} ${order.orderNumber}`,
        })),
      },
    };
  }

  return {
    text,
    responseType: 'interactive-list',
    responsePayload: {
      body: `Seleccioná el pedido que querés ${actionLabel}`,
      buttonText: 'Ver pedidos',
      sections: [
        {
          title: `Pedidos para ${actionLabel}`,
          rows: orders.map((order) => ({
            id: `active_orders_select:${order.id}`,
            title: order.orderNumber,
          })),
        },
      ],
    },
  };
}

function buildRepeatOrderSelectionContent(
  orders: Array<{ id: string; orderNumber: string }>
): { text: string; responseType: 'interactive-buttons' | 'interactive-list'; responsePayload: InteractiveButtonsPayload | InteractiveListPayload } {
  const lines = orders.map((order) => `• ${order.orderNumber}`);
  const text = [
    'Estos son tus ultimos pedidos, mira el pedido completo para rehacerlo',
    '',
    ...lines,
  ].join('\n');

  if (orders.length <= 3) {
    return {
      text,
      responseType: 'interactive-buttons',
      responsePayload: {
        body: text,
        buttons: orders.map((order) => ({
          id: `repeat_order_select:${order.id}`,
          title: `🧾 ${order.orderNumber}`,
        })),
      },
    };
  }

  return {
    text,
    responseType: 'interactive-list',
    responsePayload: {
      body: 'Seleccioná el pedido que querés rehacer',
      buttonText: 'Ver pedidos',
      sections: [
        {
          title: 'Últimos pedidos',
          rows: orders.map((order) => ({
            id: `repeat_order_select:${order.id}`,
            title: order.orderNumber,
          })),
        },
      ],
    },
  };
}

function buildRepeatOrderActionsContent(orderNumber: string, orderId: string): { text: string; interactive: InteractiveButtonsPayload } {
  const text = `Te envié la boleta del pedido ${orderNumber}. ¿Qué querés hacer?`;

  return {
    text,
    interactive: {
      body: text,
      buttons: [
        { id: `repeat_order_edit:${orderId}`, title: '✏️ Editar' },
        { id: `repeat_order_clone:${orderId}`, title: 'Hacer mismo pedido' },
        { id: 'repeat_order_back', title: '↩️ Volver' },
      ],
    },
  };
}

function buildProductSelectionContent(
  requestedName: string,
  quantity: number,
  options: Array<{ productId: string; variantId?: string; name: string; price?: number; secondaryUnit?: string | null; secondaryUnitValue?: string | number | null }>,
  requestedSecondaryUnit?: 'pack' | 'box' | 'bundle' | 'dozen'
): { text: string; responseType: 'interactive-buttons' | 'interactive-list'; responsePayload: InteractiveButtonsPayload | InteractiveListPayload } {
  const lines = options.map((option) => {
    const multiplier = resolveSecondaryUnitMultiplier(
      requestedSecondaryUnit || null,
      option.secondaryUnit,
      option.secondaryUnitValue
    );
    if (multiplier && typeof option.price === 'number') {
      const priceText = formatSecondaryUnitPrice(
        requestedSecondaryUnit!,
        multiplier,
        option.price
      );
      return `• ${option.name} - ${priceText}`;
    }
    const priceText = typeof option.price === 'number' ? `$${formatMoneyCents(option.price)}` : null;
    return priceText ? `• ${option.name} - ${priceText}` : `• ${option.name}`;
  });
  const quantityLabel = requestedSecondaryUnit
    ? `${quantity} ${SECONDARY_UNIT_LABELS[requestedSecondaryUnit] || requestedSecondaryUnit}`
    : `${quantity} unidad${quantity === 1 ? '' : 'es'}`;
  const text = [
    `Encontré varias opciones para "${requestedName}".`,
    `¿Cuál querés para ${quantityLabel}?`,
    '',
    ...lines,
  ].join('\n');

  if (options.length <= 3) {
    return {
      text,
      responseType: 'interactive-buttons',
      responsePayload: {
        body: text,
        buttons: options.map((option) => ({
          id: `product_select:${option.productId}${option.variantId ? `:${option.variantId}` : ''}`,
          title: option.name.slice(0, 20),
        })),
      },
    };
  }

  return {
    text,
    responseType: 'interactive-list',
    responsePayload: {
      body: `Seleccioná la opción para ${requestedName}`,
      buttonText: 'Ver opciones',
      sections: [
        {
          title: 'Opciones disponibles',
          rows: options.map((option) => ({
            id: `product_select:${option.productId}${option.variantId ? `:${option.variantId}` : ''}`,
            title: option.name,
          })),
        },
      ],
    },
  };
}

function buildPaymentOrderSelectionContent(
  orders: Array<{ id: string; orderNumber: string; pendingAmount: number }>
): { text: string; responseType: 'interactive-buttons' | 'interactive-list'; responsePayload: InteractiveButtonsPayload | InteractiveListPayload } {
  const lines = orders.map(
    (order) => `• ${order.orderNumber} - Pendiente $${formatMoneyCents(order.pendingAmount)}`
  );
  const text = ['Elegí el pedido que querés pagar:', ...lines].join('\n');

  if (orders.length <= 3) {
    return {
      text,
      responseType: 'interactive-buttons',
      responsePayload: {
        body: text,
        buttons: orders.map((order) => ({
          id: `pay_order:${order.id}`,
          title: `💳 ${order.orderNumber}`,
        })),
      },
    };
  }

  return {
    text,
    responseType: 'interactive-list',
    responsePayload: {
      body: 'Seleccioná el pedido que querés pagar',
      buttonText: 'Ver pedidos',
      sections: [
        {
          title: 'Pedidos con saldo pendiente',
          rows: orders.map((order) => ({
            id: `pay_order:${order.id}`,
            title: order.orderNumber,
            description: `Pendiente $${formatMoneyCents(order.pendingAmount)}`,
          })),
        },
      ],
    },
  };
}

type PaymentMethodKey = 'link' | 'transfer' | 'cash';

const PAYMENT_METHOD_ORDER: PaymentMethodKey[] = ['link', 'transfer', 'cash'];

function resolveAvailablePaymentMethods(options: {
  mpLink: boolean;
  transfer: boolean;
  cash: boolean;
}): PaymentMethodKey[] {
  const methods: PaymentMethodKey[] = [];
  if (options.mpLink) methods.push('link');
  if (options.transfer) methods.push('transfer');
  if (options.cash) methods.push('cash');
  return PAYMENT_METHOD_ORDER.filter((method) => methods.includes(method));
}

function resolvePaymentMethodButton(method: PaymentMethodKey): { id: string; title: string } {
  if (method === 'link') return { id: 'payment_method_link', title: '💳 Link de pago' };
  if (method === 'transfer') return { id: 'payment_method_transfer', title: '🏦 Transferencia' };
  return { id: 'payment_method_cash', title: '💵 Efectivo' };
}

function buildPaymentMethodContent(
  orderNumber: string,
  pendingAmount: number,
  options: { mpLink: boolean; transfer: boolean; cash: boolean }
): { text: string; interactive: InteractiveButtonsPayload; missingMethod?: PaymentMethodKey } {
  const text = [
    `¿Cómo querés pagar el pedido ${orderNumber}?`,
    `Pendiente: $${formatMoneyCents(pendingAmount)}`,
  ].join('\n');

  const availableMethods = resolveAvailablePaymentMethods(options);
  const hasOverflow = availableMethods.length > 2;
  const primaryMethods = hasOverflow ? availableMethods.slice(0, 2) : availableMethods;
  const missingMethod = hasOverflow ? availableMethods[2] : undefined;

  const buttons = primaryMethods.map(resolvePaymentMethodButton);
  if (hasOverflow) {
    buttons.push({ id: 'payment_method_more', title: '➕ Más opciones' });
  } else {
    buttons.push({ id: 'payment_method_back', title: '↩️ Volver' });
  }

  return {
    text,
    interactive: {
      body: text,
      buttons,
    },
    missingMethod,
  };
}

function buildPaymentMethodMoreContent(
  orderNumber: string,
  pendingAmount: number,
  missingMethod: PaymentMethodKey
): { text: string; interactive: InteractiveButtonsPayload } {
  const text = [
    `Más opciones de pago para el pedido ${orderNumber}:`,
    `Pendiente: $${formatMoneyCents(pendingAmount)}`,
  ].join('\n');

  const buttons: Array<{ id: string; title: string }> = [
    resolvePaymentMethodButton(missingMethod),
    { id: 'payment_method_prev', title: '↩️ Paso anterior' },
    { id: 'payment_method_back', title: '🏠 Volver al inicio' },
  ];

  return {
    text,
    interactive: {
      body: text,
      buttons,
    },
  };
}

function buildReceiptRequestContent(orderNumber: string): { text: string; interactive: InteractiveButtonsPayload } {
  const text = [
    `Perfecto. Enviame el comprobante (foto o PDF) para el pedido ${orderNumber}.`,
  ].join('\n');

  return {
    text,
    interactive: {
      body: text,
      buttons: [
        { id: 'payment_method_back', title: '↩️ Volver' },
      ],
    },
  };
}

function buildLinkPaymentContent(
  orderNumber: string,
  paymentUrl: string
): { text: string; interactive: InteractiveButtonsPayload } {
  const text = [
    `Acá tenés el link de pago para el pedido ${orderNumber}:`,
    paymentUrl,
    '',
    'Cuando pagues, enviame el comprobante (foto o PDF) y el monto en el mensaje.',
  ].join('\n');

  return {
    text,
    interactive: {
      body: text,
      buttons: [{ id: 'payment_method_back', title: '↩️ Volver' }],
    },
  };
}

function buildTransferPaymentContent(
  orderNumber: string,
  payment: { alias?: string; cbu?: string }
): { text: string; interactive: InteractiveButtonsPayload } {
  const paymentLines: string[] = [];
  if (payment.alias) {
    paymentLines.push(`Alias: ${payment.alias}`);
  }
  if (payment.cbu) {
    paymentLines.push(`CBU: ${payment.cbu}`);
  }

  const text = [
    `Perfecto. Podés transferir para el pedido ${orderNumber}.`,
    ...paymentLines,
    '',
    'Cuando hagas la transferencia, enviame el comprobante (foto o PDF) y el monto en el mensaje.',
  ].join('\n');

  return {
    text,
    interactive: {
      body: text,
      buttons: [{ id: 'payment_method_back', title: '↩️ Volver' }],
    },
  };
}

function buildReceiptConfirmationContent(orderNumber: string, amountCents: number): { text: string; interactive: InteractiveButtonsPayload } {
  const text = `Detecté $${formatMoneyCents(amountCents)} para el pedido ${orderNumber}. ¿Confirmás que lo aplique?`;

  return {
    text,
    interactive: {
      body: text,
      buttons: [
        { id: 'payment_receipt_confirm', title: '✅ Confirmar' },
        { id: 'payment_receipt_cancel', title: '❌ Cancelar' },
      ],
    },
  };
}

function resolvePaymentMethodsEnabled(settings?: Record<string, unknown>): {
  mpLink: boolean;
  transfer: boolean;
  cash: boolean;
} {
  const defaults = { mpLink: true, transfer: true, cash: true };
  if (!settings) return defaults;

  const raw = settings.paymentMethodsEnabled as
    | { mpLink?: boolean; transfer?: boolean; cash?: boolean }
    | undefined;

  return {
    mpLink: typeof raw?.mpLink === 'boolean' ? raw.mpLink : defaults.mpLink,
    transfer: typeof raw?.transfer === 'boolean' ? raw.transfer : defaults.transfer,
    cash: typeof raw?.cash === 'boolean' ? raw.cash : defaults.cash,
  };
}

function buildExistingOrderSummaryMessage(order: {
  orderNumber: string;
  items: Array<{ name: string; quantity: number; total: number }>;
  total: number;
}): string {
  const lines = order.items.map((item) => {
    const lineTotal = formatMoneyCents(item.total);
    return `• ${item.quantity} ${item.name} - $${lineTotal}`;
  });

  const total = formatMoneyCents(order.total);

  return [
    `Este es tu pedido actual (${order.orderNumber}):`,
    ...lines,
    '',
    `Total: $${total}`,
    '',
    'Dime si quieres agregar o sacar algo.',
  ].join('\n');
}

function buildEditOrderActionsContent(): { text: string; interactive: InteractiveButtonsPayload } {
  const text = [
    'Perfecto, revisa si está bien:',
    '1. Confirmar',
    '2. Editar',
  ].join('\n');

  return {
    text,
    interactive: {
      body: '¿Querés confirmar estos cambios?',
      buttons: [
        { id: 'order_edit_confirm', title: '✅ Confirmar' },
        { id: 'order_edit_continue', title: '✏️ Editar' },
      ],
    },
  };
}

function buildCancelOrderConfirmation(orderNumber: string): { text: string; interactive: InteractiveButtonsPayload } {
  const text = `¿Seguro querés cancelar el pedido ${orderNumber}?`;

  return {
    text,
    interactive: {
      body: text,
      buttons: [
        { id: 'cancel_order_yes', title: '✅ Sí' },
        { id: 'cancel_order_no', title: '❌ No' },
      ],
    },
  };
}

function buildUnavailableMenuOptionMessage(): string {
  return [
    'Esa opción todavía no está disponible.',
    'Por ahora podés elegir:',
    '1. Hacer pedido',
    '',
    'Respondé con el número.',
  ].join('\n');
}

function shouldPrefaceGreeting(message: string): boolean {
  const normalized = normalizeSimpleText(message);
  if (!normalized) return false;

  const greetings = [
    'hola',
    'buenas',
    'buen dia',
    'buenas tardes',
    'buenas noches',
    'como estas',
    'como andas',
    'que tal',
  ];

  // Match greeting as exact, prefix, or as a word/phrase inside a coalesced message.
  return greetings.some((g) => {
    if (normalized === g) return true;
    if (normalized.startsWith(`${g} `)) return true;
    if (normalized.includes(` ${g} `)) return true;
    if (normalized.endsWith(` ${g}`)) return true;
    return false;
  });
}

function buildStartOrderMessage(
  exampleProducts: string[],
  options?: { greeting?: boolean }
): string {
  const example = buildOrderExample(exampleProducts);
  const lines: string[] = [];
  if (options?.greeting) {
    lines.push('¡Hola!');
    lines.push('');
  }
  lines.push('¡Perfecto! Decime los productos que querés agregar a tu pedido.');
  lines.push(`Ejemplo: \"${example}\".`);
  return lines.join('\n');
}

function buildOrderExample(names: string[]): string {
  if (names.length >= 2) {
    return `${names[0]}, ${names[1]}`;
  }
  if (names.length === 1) {
    return `${names[0]}, ${names[0]}`;
  }
  return '2 cocas, 1 agua';
}

function buildOrderSummaryMessage(cart: Cart): string {
  const lines = cart.items.map((item) => {
    const unit = formatMoneyCents(item.unitPrice);
    const lineTotal = formatMoneyCents(item.total);
    if (item.quantity > 1) {
      return `• ${item.quantity}x ${item.name} - $${unit} c/u = $${lineTotal}`;
    }
    return `• ${item.quantity}x ${item.name} - $${lineTotal}`;
  });

  const total = formatMoneyCents(cart.total);

  return [
    '🛒 *Tu pedido actual:*',
    ...lines,
    '',
    `*Total: $${total}*`,
  ].join('\n');
}


function buildTaskHint(fsm: StateMachine, memory: SessionMemory): string | undefined {
  if (memory.context.otherInquiry) {
    return [
      'El cliente hizo una consulta general sobre el negocio.',
      'Respondé con información pública del comercio (dirección, horarios, medios de pago, ubicación).',
      'Si consulta por un producto o precio, respondé con disponibilidad y precio usando herramientas de consulta.',
      'No muestres cantidades de stock.',
      'Solo ofrecé o enviá catálogo si el cliente lo pide explícitamente.',
      'Nunca digas que enviaste el catálogo si no se envió realmente.',
      'Evitá datos sensibles o internos (ganancias, metricas, informacion personal).',
      'No inicies ni modifiques pedidos; usá solo herramientas de consulta si hace falta.',
    ].join('\n');
  }

  if (memory.context.editingOrderId && memory.context.editingOrderNumber) {
    return [
      `El cliente está editando el pedido ${memory.context.editingOrderNumber}.`,
      'Usá SOLO herramientas de carrito (add_to_cart, update_cart_item, remove_from_cart).',
      'No confirmes ni modifiques la orden hasta que el cliente confirme.',
    ].join('\n');
  }

  if (fsm.getState() === AgentState.COLLECTING_ORDER) {
    return [
      'El cliente está armando un pedido.',
      'Identificá productos y cantidades, buscá con search_products y agregá al carrito.',
    ].join('\n');
  }

  return undefined;
}

function shouldForceMenuForOrdering(memory: SessionMemory, fsm: StateMachine): boolean {
  if (memory.context.otherInquiry) return true;
  if (fsm.getState() !== AgentState.IDLE) return false;
  if (memory.context.pendingOrderDecision) return false;
  if (memory.context.activeOrdersPrompt) return false;
  if (memory.context.pendingCancelOrderId) return false;
  if (memory.context.pendingCatalogOffer) return false;
  if (memory.context.pendingProductSelection) return false;
  if (memory.context.pendingStockAdjustment) return false;
  if (memory.context.editingOrderId) return false;
  if (memory.context.paymentStage) return false;
  if (memory.context.orderViewAwaitingAck || memory.context.orderViewAwaitingNumber) return false;
  return true;
}

function enforceMenuForOrdering(response: string, memory: SessionMemory, fsm: StateMachine): string {
  if (!response) return response;
  if (!shouldForceMenuForOrdering(memory, fsm)) return response;

  const menuLine = 'Si querés hacer un pedido, escribí menu para realizar un pedido.';
  const normalizedMenu = normalizeSimpleText(menuLine);
  const normalizedResponse = normalizeSimpleText(response);
  if (normalizedResponse.includes('escribi menu')) return response;

  const orderInvitePatterns = [
    'queres hacer un pedido',
    'queres hacer pedido',
    'queres pedir',
    'queres agregar',
    'queres agregar algo',
    'queres agregar algo mas',
    'confirmamos este pedido',
    'queres confirmar',
    'cuantas queres',
    'cuantos queres',
    'cual te interesa',
    'elegi',
    'que queres hacer',
    'responde con el numero',
  ];

  const filtered = response.split('\n').filter((line) => {
    const normalized = normalizeSimpleText(line);
    if (!normalized) return true;
    const isMenuLine = /^\d+\s/.test(normalized);
    if (
      isMenuLine &&
      (normalized.includes('hacer pedido') ||
        normalized.includes('pedidos activos') ||
        normalized.includes('mas opciones'))
    ) {
      return false;
    }
    if (/\bqueres\s+\d+\b/.test(normalized)) return false;
    if (orderInvitePatterns.some((pattern) => normalized.includes(pattern))) return false;
    return true;
  });

  while (filtered.length > 0 && filtered[filtered.length - 1].trim() === '') {
    filtered.pop();
  }

  const result = filtered.length === 0
    ? [menuLine]
    : normalizeSimpleText(filtered[filtered.length - 1]) === normalizedMenu
      ? filtered
      : [...filtered, '', menuLine];

  return result.join('\n');
}

function wasCatalogExplicitlyRequested(message: string): boolean {
  const normalized = normalizeSimpleText(message);
  if (!normalized) return false;

  const phrases = [
    'catalogo',
    'catálogo',
    'ver catalogo',
    'ver el catalogo',
    'ver catálogo',
    'ver el catálogo',
    'lista de productos',
    'lista productos',
    'listado de productos',
    'productos disponibles',
    'ver productos',
    'mostrar productos',
    'mostrar catalogo',
    'mostrar catálogo',
    'catalogo de productos',
    'catálogo de productos',
  ];

  return phrases.some((phrase) => normalized.includes(phrase));
}

function isGreetingMessage(message: string): boolean {
  const normalized = normalizeSimpleText(message);
  if (!normalized) return false;
  const greetings = [
    'hola',
    'holi',
    'buenas',
    'buenos dias',
    'buenas tardes',
    'buenas noches',
    'hey',
    'como estas',
    'como andas',
    'que tal',
    'todo bien',
  ];
  return greetings.some((greeting) => normalized === greeting || normalized.startsWith(`${greeting} `));
}

function responseLooksLikeCatalog(response: string): boolean {
  const normalized = normalizeSimpleText(response);
  if (!normalized) return false;

  if (normalized.includes('catalogo') || normalized.includes('catálogo')) return true;
  if (normalized.includes('productos disponibles')) return true;

  const lines = response.split('\n').map((line) => line.trim()).filter(Boolean);
  const bulletLines = lines.filter((line) => line.startsWith('•'));
  const priceBullets = bulletLines.filter((line) => /\$\s?\d/.test(line));
  const categoryHits = ['bebidas', 'alimentos', 'galletitas', 'otros', 'snacks', 'limpieza'].filter((cat) =>
    normalized.includes(cat)
  );

  return priceBullets.length >= 3 && categoryHits.length >= 1;
}

function stripCatalogMentionsIfNotRequested(response: string, message: string): string {
  if (!response) return response;
  if (wasCatalogExplicitlyRequested(message)) return response;

  if (responseLooksLikeCatalog(response)) {
    return isGreetingMessage(message)
      ? '¡Hola! ¿En qué puedo ayudarte?'
      : 'Decime qué producto te interesa y te ayudo.';
  }

  const filteredLines = response
    .split('\n')
    .filter((line) => !normalizeSimpleText(line).includes('catalogo'));

  let cleaned = filteredLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  if (!cleaned) {
    cleaned = 'Decime qué necesitás y te ayudo.';
  }

  return cleaned;
}

type ProductInquiryMatch = {
  displayName: string;
  name?: string;
  unit?: string;
  unitValue?: string;
  price?: number;
  availableStock?: number;
};

function extractProductMatchesFromTools(toolsUsed: ToolExecution[]): ProductInquiryMatch[] {
  const matches: ProductInquiryMatch[] = [];

  for (const tool of toolsUsed) {
    if (!tool?.result?.success) continue;

    if (tool.toolName === 'search_products') {
      const data = tool.result.data as { products?: unknown } | undefined;
      const products = Array.isArray(data?.products) ? data?.products : [];
      for (const product of products) {
        if (!product || typeof product !== 'object') continue;
        const maybe = product as Record<string, unknown>;
        const displayName =
          typeof maybe.displayName === 'string' && maybe.displayName.trim()
            ? maybe.displayName
            : typeof maybe.name === 'string'
              ? maybe.name
              : '';
        if (!displayName) continue;
        matches.push({
          displayName,
          name: typeof maybe.name === 'string' ? maybe.name : undefined,
          unit: typeof maybe.unit === 'string' ? maybe.unit : undefined,
          unitValue: typeof maybe.unitValue === 'string' ? maybe.unitValue : undefined,
          price: typeof maybe.price === 'number' ? maybe.price : undefined,
          availableStock: typeof maybe.availableStock === 'number' ? maybe.availableStock : undefined,
        });
      }
    }

    if (tool.toolName === 'get_product_details') {
      const data = tool.result.data as Record<string, unknown> | undefined;
      const displayName =
        typeof data?.displayName === 'string' && data.displayName.trim()
          ? data.displayName
          : typeof data?.name === 'string'
            ? data.name
            : '';
      if (!displayName) continue;
      matches.push({
        displayName,
        name: typeof data?.name === 'string' ? data.name : undefined,
        unit: typeof data?.unit === 'string' ? data.unit : undefined,
        unitValue: typeof data?.unitValue === 'string' ? data.unitValue : undefined,
        price: typeof data?.price === 'number' ? data.price : undefined,
        availableStock: typeof data?.availableStock === 'number' ? data.availableStock : undefined,
      });
    }
  }

  return matches;
}

function detectPriceIntent(message: string): boolean {
  const normalized = normalizeSimpleText(message);
  if (!normalized) return false;
  return (
    normalized.includes('cuanto') ||
    normalized.includes('precio') ||
    normalized.includes('vale') ||
    normalized.includes('sale') ||
    normalized.includes('cuesta') ||
    normalized.includes('valor') ||
    normalized.includes('costo')
  );
}

function detectAvailabilityIntent(message: string): boolean {
  const normalized = normalizeSimpleText(message);
  if (!normalized) return false;
  return (
    normalized.includes('tenes') ||
    normalized.includes('tienes') ||
    normalized.includes('hay') ||
    normalized.includes('queda') ||
    normalized.includes('disponible') ||
    normalized.includes('stock')
  );
}

const UNIT_FOLLOWUP_STOPWORDS = new Set([
  'y',
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
  'otro',
  'otra',
  'mas',
  'más',
  'tenes',
  'tienes',
  'hay',
  'queda',
  'disponible',
  'stock',
  'cuanto',
  'precio',
  'vale',
  'sale',
  'cuesta',
  'valor',
  'costo',
]);

const UNIT_FOLLOWUP_UNITS = new Set([
  'l',
  'lt',
  'lts',
  'litro',
  'litros',
  'kg',
  'kilo',
  'kilos',
  'g',
  'gr',
  'gramo',
  'gramos',
  'ml',
  'cc',
  'unidad',
  'unidades',
  'pack',
  'paquete',
  'paquetes',
]);

function extractUnitValueFromMessage(message: string): string | null {
  const match = message.match(/(\d+(?:[.,]\d+)?)/);
  if (!match) return null;
  return match[1].replace(',', '.');
}

function isUnitOnlyFollowUp(message: string): boolean {
  const unitValue = extractUnitValueFromMessage(message);
  if (!unitValue) return false;
  const normalized = normalizeSimpleText(message);
  if (!normalized) return false;
  const tokens = normalized.split(' ').filter(Boolean);
  const remaining = tokens.filter((token) => {
    if (UNIT_FOLLOWUP_STOPWORDS.has(token)) return false;
    if (UNIT_FOLLOWUP_UNITS.has(token)) return false;
    if (/^\d+$/.test(token)) return false;
    return true;
  });
  return remaining.length === 0;
}

const LAST_PRODUCT_INQUIRY_MAX_AGE_MS = 15 * 60 * 1000;

function isRecentProductInquiry(info?: { at?: string } | null): boolean {
  if (!info?.at) return false;
  const time = new Date(info.at).getTime();
  if (!Number.isFinite(time)) return false;
  return Date.now() - time <= LAST_PRODUCT_INQUIRY_MAX_AGE_MS;
}

function selectPrimaryProductMatch(matches: ProductInquiryMatch[]): ProductInquiryMatch | null {
  if (!matches.length) return null;
  return matches[0] || null;
}

function shouldTrackProductInquiry(message: string, memory: SessionMemory, fsm: StateMachine): boolean {
  if (fsm.getState() !== AgentState.IDLE && !memory.context.otherInquiry) return false;
  return detectPriceIntent(message) || detectAvailabilityIntent(message) || isUnitOnlyFollowUp(message);
}

function updateLastProductInquiry(
  message: string,
  toolsUsed: ToolExecution[],
  memory: SessionMemory,
  fsm: StateMachine
): boolean {
  if (!shouldTrackProductInquiry(message, memory, fsm)) return false;
  const matches = extractProductMatchesFromTools(toolsUsed);
  const primary = selectPrimaryProductMatch(matches);
  if (!primary || !primary.name) return false;

  const payload = {
    name: primary.name,
    unit: primary.unit,
    unitValue: primary.unitValue,
    displayName: primary.displayName,
    at: new Date().toISOString(),
  };

  memory.context.lastProductInquiry = payload;
  return true;
}

function shouldOverrideProductInquiry(response: string, productsCount: number): boolean {
  const menuLine = 'Si querés hacer un pedido, escribí menu para realizar un pedido.';
  const normalizedMenu = normalizeSimpleText(menuLine);
  const normalized = normalizeSimpleText(response);
  if (!normalized) return true;
  if (normalized === normalizedMenu) return true;
  if (
    productsCount > 0 &&
    (normalized.includes('no tengo') ||
      normalized.includes('no hay') ||
      normalized.includes('sin stock') ||
      normalized.includes('no contamos'))
  ) {
    return true;
  }
  return false;
}

function formatPrice(amount?: number): string | null {
  if (typeof amount !== 'number' || Number.isNaN(amount)) return null;
  return `$${formatMoneyCents(amount)}`;
}

function applyProductInquiryFallback(
  response: string,
  message: string,
  toolsUsed: ToolExecution[],
  memory: SessionMemory,
  fsm: StateMachine
): string {
  const products = extractProductMatchesFromTools(toolsUsed);
  if (products.length === 0) return response;
  if (fsm.getState() !== AgentState.IDLE && !memory.context.otherInquiry) return response;
  if (!shouldOverrideProductInquiry(response, products.length)) return response;

  const wantsPrice = detectPriceIntent(message);
  const wantsAvailability = detectAvailabilityIntent(message);
  const menuLine = 'Si querés hacer un pedido, escribí menu para realizar un pedido.';

  if (products.length === 1) {
    const product = products[0];
    const priceText = formatPrice(product.price);
    const hasStock = product.availableStock === undefined ? true : product.availableStock > 0;

    let info = '';
    if (!hasStock) {
      info = `No tengo ${product.displayName} disponible en este momento.`;
      if (wantsPrice && priceText) {
        info = `${info} Precio: ${priceText}.`;
      }
    } else if (wantsPrice && wantsAvailability) {
      info = `Sí, tengo ${product.displayName}${priceText ? ` a ${priceText}` : ''}.`;
    } else if (wantsPrice) {
      info = priceText
        ? `El precio de ${product.displayName} es ${priceText}.`
        : `El precio de ${product.displayName} está disponible en el local.`;
    } else {
      info = `Sí, tengo ${product.displayName}${priceText ? ` a ${priceText}` : ''}.`;
    }

    return [info, '', menuLine].join('\n');
  }

  const lines = products.slice(0, 5).map((product) => {
    const priceText = wantsPrice ? formatPrice(product.price) : null;
    return `• ${product.displayName}${priceText ? ` - ${priceText}` : ''}`;
  });
  const listText = lines.join('\n');
  const question = '¿Cuál te interesa?';

  return ['Tengo estas opciones:', listText, '', question, '', menuLine].join('\n');
}

type InsufficientStockDetail = {
  productId?: string;
  variantId?: string;
  name: string;
  available: number;
  requested: number;
  mode?: 'add' | 'set';
};

function extractInsufficientStock(data: unknown): InsufficientStockDetail[] {
  if (!data || typeof data !== 'object') return [];
  const maybe = (data as { insufficientStock?: unknown }).insufficientStock;
  if (!Array.isArray(maybe)) return [];
  const results: InsufficientStockDetail[] = [];
  for (const item of maybe) {
    const name = typeof item?.name === 'string' ? item.name : '';
    const available = typeof item?.available === 'number' ? item.available : NaN;
    const requested = typeof item?.requested === 'number' ? item.requested : NaN;
    const productId = typeof item?.productId === 'string' ? item.productId : undefined;
    const variantId = typeof item?.variantId === 'string' ? item.variantId : undefined;
    const mode = item?.mode === 'add' || item?.mode === 'set' ? item.mode : undefined;
    if (!name || Number.isNaN(available) || Number.isNaN(requested)) {
      continue;
    }
    results.push({ name, available, requested, productId, variantId, mode });
  }
  return results;
}

function buildInsufficientStockMessage(details: InsufficientStockDetail[]): string {
  const lines = details.map((detail) => {
    if (detail.available <= 0) {
      return `• ${detail.name}: sin stock.`;
    }
    return `• ${detail.name}: pediste ${detail.requested}, tengo ${detail.available}.`;
  });

  return [
    '⚠️ No tengo stock suficiente:',
    ...lines,
    '',
    '¿Querés que lo ajuste a lo disponible? (Sí/No)',
  ].join('\n');
}

function buildCatalogOfferContent(requested: string[]): { text: string; interactive: InteractiveButtonsPayload } {
  const uniqueRequested = Array.from(new Set(requested.map((item) => item.trim()).filter(Boolean)));
  const list = uniqueRequested.length > 0
    ? uniqueRequested.map((item) => `• ${item}`).join('\n')
    : '';

  const text = [
    'No tengo ese producto disponible en este momento.',
    list ? '' : undefined,
    list || undefined,
    '',
    '¿Querés que te mande el catálogo para elegir otro producto?',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    text,
    interactive: {
      body: text,
      buttons: [
        { id: 'catalog_offer_yes', title: '📒 Ver catálogo' },
        { id: 'catalog_offer_back', title: '🏠 Volver al inicio' },
      ],
    },
  };
}

function isCatalogOfferResponse(text: string): boolean {
  const normalized = normalizeSimpleText(text);
  if (!normalized) return false;

  return normalized.includes('catalogo') && (
    normalized.includes('queres') ||
    normalized.includes('queres que') ||
    normalized.includes('queres que te mande') ||
    normalized.includes('queres que te envie') ||
    normalized.includes('no tengo')
  );
}

function buildCartSummaryPayload(cart: Cart, orderNumber?: string) {
  return {
    orderNumber: orderNumber || 'PEDIDO EN CURSO',
    items: cart.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      total: item.total,
    })),
    subtotal: cart.subtotal,
    shipping: cart.shipping,
    discount: cart.discount,
    total: cart.total,
    paidAmount: 0,
    notes: cart.notes,
    createdAt: new Date().toISOString(),
  };
}

function buildOrderActionsContent(): { text: string; interactive: InteractiveButtonsPayload } {
  const text = [
    'Elegí una opción:',
    '1. Confirmar',
    '2. Editar',
    '3. Cancelar',
  ].join('\n');

  return {
    text,
    interactive: {
      body: '¿Qué querés hacer con tu pedido?',
      buttons: [
        { id: 'order_confirm', title: '✅ Confirmar' },
        { id: 'order_edit', title: '✏️ Editar' },
        { id: 'order_cancel', title: '🗑️ Cancelar' },
      ],
    },
  };
}

function clearPaymentContext(memory: SessionMemory): void {
  memory.context.activeOrdersPayable = undefined;
  memory.context.paymentStage = undefined;
  memory.context.paymentMethod = undefined;
  memory.context.paymentOrders = undefined;
  memory.context.paymentOrderId = undefined;
  memory.context.paymentOrderNumber = undefined;
  memory.context.paymentPendingAmount = undefined;
  memory.context.paymentReceiptId = undefined;
  memory.context.paymentReceiptAmount = undefined;
}

type MenuSelection = 'order' | 'catalog' | 'more' | 'active' | 'repeat' | 'other' | null;
type OrderAction = 'confirm' | 'edit' | 'cancel' | null;
type PendingOrderDecision = 'edit' | 'new' | 'back' | null;
type PendingOrderSelection =
  | { action: 'select'; order: { id: string; orderNumber?: string } }
  | { action: 'new' | 'back' }
  | null;
type ActiveOrderAction = 'edit' | 'cancel' | 'pay' | 'other' | 'invoice' | null;
type CancelDecision = boolean | null;
type ActiveOrderRequest = { action: ActiveOrderAction; orderNumber?: string; orderId?: string } | null;
type OrderViewRequest = { orderNumber?: string } | null;
type PaymentMethodSelection = 'link' | 'transfer' | 'cash' | 'back' | 'more' | 'prev' | null;
type CatalogOfferDecision = 'yes' | 'no' | 'back' | null;

function parseMenuSelection(message: string, lastMenu?: 'primary' | 'secondary'): MenuSelection {
  const raw = message.trim().toLowerCase();
  const normalized = normalizeSimpleText(message);
  if (!raw && !normalized) return null;

  // Button payloads
  if (raw === 'menu_primary_order') return 'order';
  if (raw === 'menu_primary_active') return 'active';
  if (raw === 'menu_primary_more') return 'more';
  if (raw === 'menu_secondary_catalog') return 'catalog';
  if (raw === 'menu_secondary_repeat') return 'repeat';
  if (raw === 'menu_secondary_other') return 'other';

  if (normalized.includes('rehacer pedido') || normalized.includes('repetir pedido')) {
    return 'repeat';
  }
  if (
    normalized === 'hacer pedido' ||
    normalized === 'hacer un pedido' ||
    normalized.includes('quiero hacer pedido') ||
    normalized.includes('quiero hacer un pedido') ||
    normalized.includes('quiero pedir') ||
    normalized.includes('quiero comprar') ||
    normalized.includes('hacer pedido') ||
    normalized.includes('hacer un pedido')
  ) {
    return 'order';
  }

  // Numeric selections (exact or short)
  if (/^1([.)-]?)$/.test(normalized) || /^opcion\\s*1$/.test(normalized)) {
    return lastMenu === 'secondary' ? 'catalog' : 'order';
  }
  if (/^2([.)-]?)$/.test(normalized) || /^opcion\\s*2$/.test(normalized)) {
    return lastMenu === 'secondary' ? 'repeat' : 'active';
  }
  if (/^3([.)-]?)$/.test(normalized) || /^opcion\\s*3$/.test(normalized)) {
    return lastMenu === 'secondary' ? 'other' : 'more';
  }
  if (/^4([.)-]?)$/.test(normalized) || /^opcion\\s*4$/.test(normalized)) return 'catalog';
  if (/^5([.)-]?)$/.test(normalized) || /^opcion\\s*5$/.test(normalized)) return 'other';

  if (wasCatalogExplicitlyRequested(message)) {
    return 'catalog';
  }

  return null;
}

function parseOrderAction(message: string): OrderAction {
  const raw = message.trim().toLowerCase();
  const normalized = normalizeSimpleText(message);
  if (!raw && !normalized) return null;

  if (raw === 'order_confirm') return 'confirm';
  if (raw === 'order_edit_confirm') return 'confirm';
  if (raw === 'order_edit') return 'edit';
  if (raw === 'order_edit_continue') return 'edit';
  if (raw === 'order_cancel') return 'cancel';

  if (/^1([.)-]?)$/.test(normalized)) return 'confirm';
  if (/^2([.)-]?)$/.test(normalized)) return 'edit';
  if (/^3([.)-]?)$/.test(normalized)) return 'cancel';

  const yes = new Set(['si', 'sí', 's', 'ok', 'okay', 'confirmo', 'confirmar', 'dale', 'de acuerdo']);
  const no = new Set(['no', 'n', 'cancelar', 'cancela']);
  if (yes.has(normalized)) return 'confirm';
  if (no.has(normalized)) return 'cancel';
  if (normalized.includes('editar') || normalized.includes('modificar') || normalized.includes('cambiar')) return 'edit';

  return null;
}

function isInvoiceDataEditIntent(message: string): boolean {
  const normalized = normalizeSimpleText(message);
  if (!normalized) return false;

  const editKeywords = ['editar', 'modificar', 'cambiar', 'actualizar', 'corregir'];
  const invoiceKeywords = [
    'factura',
    'facturacion',
    'datos fiscales',
    'datos de factura',
    'datos de facturacion',
    'fiscal',
    'cuit',
    'razon social',
    'domicilio fiscal',
    'iva',
  ];

  const hasEdit = editKeywords.some((keyword) => normalized.includes(keyword));
  if (!hasEdit) return false;

  return invoiceKeywords.some((keyword) => normalized.includes(keyword));
}

function parsePendingOrderDecision(message: string): PendingOrderDecision {
  const raw = message.trim().toLowerCase();
  const normalized = normalizeSimpleText(message);
  if (!raw && !normalized) return null;

  if (raw.startsWith('menu_primary_') || raw.startsWith('menu_secondary_')) return null;

  if (raw === 'pending_order_edit') return 'edit';
  if (raw === 'pending_order_new') return 'new';
  if (raw === 'pending_order_back') return 'back';

  if (/^1([.)-]?)$/.test(normalized)) return 'edit';
  if (/^2([.)-]?)$/.test(normalized)) return 'new';
  if (/^3([.)-]?)$/.test(normalized)) return 'back';

  if (normalized.includes('editar')) return 'edit';
  if (normalized.includes('nuevo') || normalized.includes('crear')) return 'new';
  if (normalized.includes('inicio') || normalized.includes('menu') || normalized.includes('menú') || normalized.includes('volver')) return 'back';

  return null;
}

function parsePendingOrderSelection(
  message: string,
  orders: Array<{ id: string; orderNumber?: string }>
): PendingOrderSelection {
  const raw = message.trim();
  const normalized = normalizeSimpleText(message);
  if (!raw && !normalized) return null;

  if (raw.toLowerCase().startsWith('pending_order_select:')) {
    const id = raw.split(':')[1];
    const match = orders.find((order) => order.id === id);
    if (match) {
      return { action: 'select', order: match };
    }
  }

  if (raw === 'pending_order_new') return { action: 'new' };
  if (raw === 'pending_order_back') return { action: 'back' };

  const decision = parsePendingOrderDecision(message);
  if (decision === 'new') return { action: 'new' };
  if (decision === 'back') return { action: 'back' };

  const reference = extractOrderNumber(message) || extractOrderDigits(message);
  if (reference) {
    const matchResult = resolveAwaitingOrder(reference, orders);
    if (matchResult.order) {
      return { action: 'select', order: matchResult.order };
    }
  }

  return null;
}

function parseCancelDecision(message: string): CancelDecision {
  const raw = message.trim().toLowerCase();
  const normalized = normalizeSimpleText(message);
  if (!raw && !normalized) return null;

  if (raw === 'cancel_order_yes') return true;
  if (raw === 'cancel_order_no') return false;
  if (raw.includes('cancel_order_yes')) return true;
  if (raw.includes('cancel_order_no')) return false;

  if (/^1([.)-]?)$/.test(normalized)) return true;
  if (/^2([.)-]?)$/.test(normalized)) return false;

  const yes = new Set(['si', 'sí', 's', 'ok', 'okay', 'confirmo', 'confirmar', 'dale', 'de acuerdo']);
  const no = new Set(['no', 'n', 'cancelar', 'cancela']);
  if (yes.has(normalized)) return true;
  if (no.has(normalized)) return false;

  return null;
}

function parseInvoiceDecision(message: string): boolean | null {
  const raw = message.trim().toLowerCase();
  const normalized = normalizeSimpleText(message);
  if (!raw && !normalized) return null;

  if (raw === 'invoice_yes') return true;
  if (raw === 'invoice_no') return false;
  if (raw.includes('invoice_yes')) return true;
  if (raw.includes('invoice_no')) return false;

  if (/^1([.)-]?)$/.test(normalized)) return true;
  if (/^2([.)-]?)$/.test(normalized)) return false;

  const yes = new Set(['si', 'sí', 's', 'ok', 'okay', 'dale', 'confirmo', 'confirmar', 'quiero', 'necesito', 'sí necesito']);
  const no = new Set(['no', 'n', 'no gracias', 'nah', 'no necesito', 'sin factura']);
  if (yes.has(normalized)) return true;
  if (no.has(normalized)) return false;

  if (normalized.includes('factura') && normalized.includes('si')) return true;
  if (normalized.includes('factura') && (normalized.includes('no') || normalized.includes('sin'))) return false;

  return null;
}

type InvoiceFieldKey = 'cuit' | 'businessName' | 'fiscalAddress' | 'vatCondition';

const INVOICE_FIELD_ORDER: InvoiceFieldKey[] = ['cuit', 'businessName', 'fiscalAddress', 'vatCondition'];
const INVOICE_FIELD_LABELS: Record<InvoiceFieldKey, string> = {
  cuit: 'CUIT',
  businessName: 'Razón social',
  fiscalAddress: 'Domicilio fiscal',
  vatCondition: 'Condición frente al IVA',
};

const VAT_CONDITION_OPTIONS = [
  { id: '1', label: 'Responsable inscripto' },
  { id: '4', label: 'Sujeto exento' },
  { id: '5', label: 'Consumidor final' },
  { id: '6', label: 'Responsable monotributo' },
  { id: '7', label: 'Sujeto no categorizado' },
  { id: '8', label: 'Proveedor del exterior' },
  { id: '9', label: 'Cliente del exterior' },
  { id: '10', label: 'IVA liberado' },
  { id: '13', label: 'Monotributista social' },
  { id: '15', label: 'IVA no alcanzado' },
  { id: '16', label: 'Monotributo trabajador independiente promovido' },
];
const VAT_CONDITION_PAGE_SIZE = 9;

const resolveVatConditionLabel = (value?: string): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const byId = VAT_CONDITION_OPTIONS.find((option) => option.id === trimmed);
  if (byId) return byId.label;
  const normalized = normalizeSimpleText(trimmed);
  const byLabel = VAT_CONDITION_OPTIONS.find(
    (option) => normalizeSimpleText(option.label) === normalized
  );
  return byLabel?.label || trimmed;
};

const resolveVatConditionId = (input: string): string | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const raw = trimmed.toLowerCase();
  if (raw === 'invoice_vat_more' || raw === 'invoice_vat_back') return null;
  if (trimmed.toLowerCase().startsWith('invoice_vat:')) {
    const id = trimmed.split(':')[1];
    if (id && VAT_CONDITION_OPTIONS.some((option) => option.id === id)) {
      return id;
    }
  }
  const digits = trimmed.replace(/\D/g, '');
  if (digits && VAT_CONDITION_OPTIONS.some((option) => option.id === digits)) {
    return digits;
  }
  const normalized = normalizeSimpleText(trimmed);
  const exact = VAT_CONDITION_OPTIONS.find(
    (option) => normalizeSimpleText(option.label) === normalized
  );
  if (exact) return exact.id;
  const partial = VAT_CONDITION_OPTIONS.filter((option) => {
    const optionNormalized = normalizeSimpleText(option.label);
    return optionNormalized.includes(normalized) || normalized.includes(optionNormalized);
  });
  if (partial.length === 1) return partial[0]!.id;
  return null;
};

const parseVatConditionPaging = (input: string): 'more' | 'back' | null => {
  const raw = input.trim().toLowerCase();
  if (raw === 'invoice_vat_more') return 'more';
  if (raw === 'invoice_vat_back') return 'back';
  return null;
};

const normalizeCuitInput = (input: string): { value: string | null; error?: string } => {
  const digits = input.replace(/\D/g, '');
  if (!digits) {
    return { value: null, error: 'Necesito un CUIT válido (11 números).' };
  }
  if (digits.length !== 11) {
    return { value: null, error: 'El CUIT debe tener 11 números. Probá de nuevo.' };
  }
  return { value: digits };
};

const getNextMissingInvoiceField = (
  data: { cuit?: string; businessName?: string; fiscalAddress?: string; vatCondition?: string },
  currentField?: InvoiceFieldKey
): InvoiceFieldKey | null => {
  const startIndex = currentField ? INVOICE_FIELD_ORDER.indexOf(currentField) + 1 : 0;
  for (let i = startIndex; i < INVOICE_FIELD_ORDER.length; i += 1) {
    const key = INVOICE_FIELD_ORDER[i];
    if (!data[key]) return key;
  }
  return null;
};

const getFirstMissingInvoiceField = (
  data: { cuit?: string; businessName?: string; fiscalAddress?: string; vatCondition?: string }
): InvoiceFieldKey | null => getNextMissingInvoiceField(data);

const buildInvoiceFieldPrompt = (field: InvoiceFieldKey, mode: 'initial' | 'edit'): string => {
  if (field === 'cuit') {
    return mode === 'initial'
      ? 'Para realizar la factura necesito tu número de CUIT.'
      : 'Decime tu CUIT (11 números):';
  }
  if (field === 'businessName') {
    return mode === 'initial' ? '¿Cuál es tu razón social?' : 'Decime tu razón social:';
  }
  if (field === 'fiscalAddress') {
    return mode === 'initial' ? '¿Cuál es tu domicilio fiscal?' : 'Decime tu domicilio fiscal:';
  }
  return mode === 'initial'
    ? '¿Cuál es tu condición frente al IVA?'
    : 'Decime tu condición frente al IVA:';
};

const buildVatConditionListContent = (
  mode: 'initial' | 'edit',
  bodyOverride?: string,
  page = 0
): { text: string; responseType: 'interactive-list'; responsePayload: InteractiveListPayload } => {
  const text = mode === 'initial'
    ? '¿Cuál es tu condición frente al IVA? Elegí una opción:'
    : 'Elegí tu condición frente al IVA:';
  const bodyText = bodyOverride || text;

  const start = page * VAT_CONDITION_PAGE_SIZE;
  const slice = VAT_CONDITION_OPTIONS.slice(start, start + VAT_CONDITION_PAGE_SIZE);
  const hasNext = start + VAT_CONDITION_PAGE_SIZE < VAT_CONDITION_OPTIONS.length;
  const hasPrev = page > 0;

  const rows = slice.map((option) => ({
    id: `invoice_vat:${option.id}`,
    title: option.label,
  }));

  if (hasNext) {
    rows.push({ id: 'invoice_vat_more', title: 'Más opciones' });
  }
  if (hasPrev) {
    rows.push({ id: 'invoice_vat_back', title: 'Volver' });
  }

  return {
    text: bodyText,
    responseType: 'interactive-list',
    responsePayload: {
      body: bodyText,
      buttonText: 'Ver opciones',
      sections: [
        {
          title: 'Condición frente al IVA',
          rows,
        },
      ],
    },
  };
};

const buildInvoiceFieldPromptContent = (
  field: InvoiceFieldKey,
  mode: 'initial' | 'edit',
  options?: { vatPage?: number; bodyOverride?: string }
): { text: string; responseType?: 'interactive-buttons' | 'interactive-list'; responsePayload?: InteractiveButtonsPayload | InteractiveListPayload } => {
  if (field === 'vatCondition') {
    return buildVatConditionListContent(mode, options?.bodyOverride, options?.vatPage ?? 0);
  }
  return { text: buildInvoiceFieldPrompt(field, mode) };
};

const buildInvoiceDataSummary = (data: {
  cuit?: string;
  businessName?: string;
  fiscalAddress?: string;
  vatCondition?: string;
}): string => {
  const vatLabel = resolveVatConditionLabel(data.vatCondition);
  return [
    'Estos son los datos para la factura:',
    `• CUIT: ${data.cuit || 'Sin dato'}`,
    `• Razón social: ${data.businessName || 'Sin dato'}`,
    `• Domicilio fiscal: ${data.fiscalAddress || 'Sin dato'}`,
    `• Condición frente al IVA: ${vatLabel || 'Sin dato'}`,
    '',
    '¿Están correctos?',
  ].join('\n');
};

const buildInvoiceConfirmContent = (data: {
  cuit?: string;
  businessName?: string;
  fiscalAddress?: string;
  vatCondition?: string;
}): { text: string; responseType: 'interactive-buttons'; responsePayload: InteractiveButtonsPayload } => {
  const text = buildInvoiceDataSummary(data);
  return {
    text,
    responseType: 'interactive-buttons',
    responsePayload: {
      body: text,
      buttons: [
        { id: 'invoice_data_confirm', title: 'Confirmar' },
        { id: 'invoice_data_edit', title: 'Editar' },
      ],
    },
  };
};

const buildInvoiceEditListContent = (data: {
  cuit?: string;
  businessName?: string;
  fiscalAddress?: string;
  vatCondition?: string;
}): { text: string; responseType: 'interactive-list'; responsePayload: InteractiveListPayload } => {
  const text = 'Decime qué dato querés modificar:';
  return {
    text,
    responseType: 'interactive-list',
    responsePayload: {
      body: 'Elegí el dato que querés modificar',
      buttonText: 'Editar dato',
      sections: [
        {
          title: 'Datos fiscales',
          rows: INVOICE_FIELD_ORDER.map((key) => ({
            id: `invoice_edit:${key}`,
            title: INVOICE_FIELD_LABELS[key],
            description: key === 'vatCondition'
              ? resolveVatConditionLabel(data[key]) || 'Sin dato'
              : data[key] || 'Sin dato',
          })),
        },
      ],
    },
  };
};

const parseInvoiceDataConfirmDecision = (message: string): 'confirm' | 'edit' | null => {
  const raw = message.trim().toLowerCase();
  const normalized = normalizeSimpleText(message);
  if (!raw && !normalized) return null;

  if (raw === 'invoice_data_confirm') return 'confirm';
  if (raw === 'invoice_data_edit') return 'edit';
  if (raw.includes('invoice_data_confirm')) return 'confirm';
  if (raw.includes('invoice_data_edit')) return 'edit';

  if (normalized.includes('confirm') || normalized.includes('ok') || normalized.includes('listo')) return 'confirm';
  if (normalized.includes('editar') || normalized.includes('modificar') || normalized.includes('cambiar')) return 'edit';

  return null;
};

const parseInvoiceEditSelection = (message: string): InvoiceFieldKey | null => {
  const raw = message.trim().toLowerCase();
  const normalized = normalizeSimpleText(message);
  if (!raw && !normalized) return null;

  if (raw.startsWith('invoice_edit:')) {
    const key = raw.split(':')[1] as InvoiceFieldKey | undefined;
    if (key && INVOICE_FIELD_ORDER.includes(key)) return key;
  }

  if (normalized.includes('cuit')) return 'cuit';
  if (normalized.includes('razon') || normalized.includes('razón') || normalized.includes('social')) return 'businessName';
  if (normalized.includes('domicilio') || normalized.includes('direccion') || normalized.includes('dirección')) return 'fiscalAddress';
  if (normalized.includes('iva')) return 'vatCondition';

  return null;
};

function parseCatalogOfferDecision(message: string): CatalogOfferDecision {
  const raw = message.trim().toLowerCase();
  const normalized = normalizeSimpleText(message);
  if (!raw && !normalized) return null;

  if (raw === 'catalog_offer_yes') return 'yes';
  if (raw === 'catalog_offer_back') return 'back';

  if (normalized.includes('volver') || normalized.includes('inicio') || normalized.includes('menu')) {
    return 'back';
  }

  const yes = new Set(['si', 'sí', 's', 'ok', 'okay', 'dale', 'de acuerdo', 'mandalo', 'mandálo', 'enviamelo', 'enviámelo', 'enviar']);
  const no = new Set(['no', 'n', 'no gracias', 'no gracias', 'nah']);

  if (yes.has(normalized)) return 'yes';
  if (no.has(normalized)) return 'no';

  if (normalized.includes('catalogo') || normalized.includes('catálogo')) return 'yes';

  return null;
}

function parseActiveOrderAction(message: string): ActiveOrderRequest {
  const raw = message.trim().toLowerCase();
  const normalized = normalizeSimpleText(message);
  if (!raw && !normalized) return null;

  if (raw === 'active_orders_pay') return { action: 'pay' };
  if (raw === 'active_orders_edit') return { action: 'edit' };
  if (raw === 'active_orders_cancel') return { action: 'cancel' };
  if (raw === 'active_orders_other') return { action: 'other' };
  if (raw === 'active_orders_invoice') return { action: 'invoice' };

  let action: ActiveOrderAction = null;
  if (normalized.includes('cancel')) action = 'cancel';
  if (normalized.includes('anular')) action = 'cancel';
  if (normalized.includes('factura')) action = 'invoice';
  if (normalized.includes('otro') || normalized.includes('otra')) action = 'other';
  if (normalized.includes('pagar') || normalized.includes('pago') || normalized.includes('abonar') || normalized.includes('abono')) action = 'pay';
  if (normalized.includes('editar') || normalized.includes('modificar') || normalized.includes('cambiar')) action = 'edit';
  if (!action) return null;

  const orderNumber = extractOrderNumber(message) || extractOrderDigits(message);
  return { action, orderNumber: orderNumber ?? undefined };
}

function parseActiveOrderSelection(
  message: string,
  orders: Array<{ id: string; orderNumber: string }>
): { order: { id: string; orderNumber: string } | null; ambiguous: boolean } {
  const raw = message.trim();
  if (raw.toLowerCase().startsWith('active_orders_select:')) {
    const id = raw.split(':')[1];
    const match = orders.find((order) => order.id === id);
    return { order: match || null, ambiguous: false };
  }

  const reference = extractOrderNumber(message) || extractOrderDigits(message);
  if (!reference) return { order: null, ambiguous: false };

  const match = resolveAwaitingOrder(reference, orders);
  return { order: match.order, ambiguous: match.ambiguous };
}

function parseRepeatOrderSelection(
  message: string,
  orders: Array<{ id: string; orderNumber: string }>
): { order: { id: string; orderNumber: string } | null; ambiguous: boolean } {
  const raw = message.trim();
  if (raw.toLowerCase().startsWith('repeat_order_select:')) {
    const id = raw.split(':')[1];
    const match = orders.find((order) => order.id === id);
    return { order: match || null, ambiguous: false };
  }

  const reference = extractOrderNumber(message) || extractOrderDigits(message);
  if (!reference) return { order: null, ambiguous: false };

  const match = resolveAwaitingOrder(reference, orders);
  return { order: match.order, ambiguous: match.ambiguous };
}

function parseRepeatOrderAction(message: string): { action: 'edit' | 'clone' | 'back'; orderId?: string } | null {
  const raw = message.trim().toLowerCase();
  if (!raw) return null;

  if (raw === 'repeat_order_back') return { action: 'back' };

  if (raw.startsWith('repeat_order_edit:')) {
    const orderId = raw.split(':')[1];
    return orderId ? { action: 'edit', orderId } : null;
  }

  if (raw.startsWith('repeat_order_clone:')) {
    const orderId = raw.split(':')[1];
    return orderId ? { action: 'clone', orderId } : null;
  }

  return null;
}

function parseProductSelection(
  message: string,
  options: Array<{ productId: string; variantId?: string; name: string; price?: number; secondaryUnit?: string | null; secondaryUnitValue?: string | number | null }>
): { selection: { productId: string; variantId?: string; name: string; price?: number; secondaryUnit?: string | null; secondaryUnitValue?: string | number | null } | null; ambiguous: boolean } {
  const raw = message.trim();
  if (raw.toLowerCase().startsWith('product_select:')) {
    const parts = raw.split(':').slice(1);
    const productId = parts[0];
    const variantId = parts[1];
    const match = options.find(
      (option) =>
        option.productId === productId &&
        ((option.variantId || null) === (variantId || null))
    );
    return { selection: match || null, ambiguous: false };
  }

  const normalized = normalizeMatchText(message);
  if (!normalized) return { selection: null, ambiguous: false };

  const normalizedOptions = options.map((option) => ({
    option,
    normalized: normalizeMatchText(option.name),
  }));

  const exact = normalizedOptions.find((entry) => entry.normalized === normalized);
  if (exact) return { selection: exact.option, ambiguous: false };

  const partial = normalizedOptions.filter(
    (entry) => entry.normalized.includes(normalized) || normalized.includes(entry.normalized)
  );

  if (partial.length === 1) {
    return { selection: partial[0]!.option, ambiguous: false };
  }
  if (partial.length > 1) {
    return { selection: null, ambiguous: true };
  }

  return { selection: null, ambiguous: false };
}

function parseOrderViewRequest(message: string): OrderViewRequest {
  const normalized = normalizeSimpleText(message);
  if (!normalized) return null;

  const hasOrderKeyword = normalized.includes('pedido') || normalized.includes('orden');
  if (!hasOrderKeyword) return null;

  const hasVerb =
    normalized.includes('ver') ||
    normalized.includes('mostrar') ||
    normalized.includes('pasame') ||
    normalized.includes('pasas') ||
    normalized.includes('pasás') ||
    normalized.includes('pasar') ||
    normalized.includes('pasa') ||
    normalized.includes('mandame') ||
    normalized.includes('mandar') ||
    normalized.includes('enviar');

  if (!hasVerb) return null;

  const orderNumber = extractOrderNumber(message) || extractOrderDigits(message);
  return { orderNumber: orderNumber ?? undefined };
}

function parsePaymentMethodSelection(message: string): PaymentMethodSelection {
  const raw = message.trim().toLowerCase();
  const normalized = normalizeSimpleText(message);
  if (!raw && !normalized) return null;

  if (raw === 'payment_method_link') return 'link';
  if (raw === 'payment_method_transfer') return 'transfer';
  if (raw === 'payment_method_cash') return 'cash';
  if (raw === 'payment_method_back') return 'back';
  if (raw === 'payment_method_more') return 'more';
  if (raw === 'payment_method_prev') return 'prev';

  if (normalized.includes('mercado') || normalized.includes('link') || normalized.includes('tarjeta')) return 'link';
  if (normalized.includes('transfer') || normalized.includes('recibo') || normalized.includes('deposito') || normalized.includes('comprobante')) return 'transfer';
  if (normalized.includes('efectivo') || normalized.includes('cash')) return 'cash';
  if (normalized.includes('mas opciones') || normalized.includes('más opciones') || normalized.includes('opciones')) return 'more';
  if (normalized.includes('paso anterior') || normalized.includes('anterior')) return 'prev';
  if (normalized.includes('volver') || normalized.includes('menu') || normalized.includes('menú') || normalized.includes('inicio')) return 'back';

  return null;
}

function isPaymentBack(message: string): boolean {
  const raw = message.trim().toLowerCase();
  return raw === 'payment_method_back';
}

function parsePaymentReceiptDecision(message: string): boolean | null {
  const raw = message.trim().toLowerCase();
  if (raw === 'payment_receipt_confirm') return true;
  if (raw === 'payment_receipt_cancel') return false;
  return parseCancelDecision(message);
}

function parsePaymentOrderSelection(
  message: string,
  orders: Array<{ id: string; orderNumber: string; pendingAmount: number }>
): { order: { id: string; orderNumber: string; pendingAmount: number } | null; ambiguous: boolean } {
  const raw = message.trim();
  if (raw.toLowerCase().startsWith('pay_order:')) {
    const id = raw.split(':')[1];
    const match = orders.find((order) => order.id === id);
    return { order: match || null, ambiguous: false };
  }

  const reference = extractOrderNumber(message) || extractOrderDigits(message);
  if (!reference) return { order: null, ambiguous: false };

  const match = resolveAwaitingOrder(reference, orders);
  return { order: match.order, ambiguous: match.ambiguous };
}

function extractAttachmentInfo(message: string): { fileRef: string; fileType: 'image' | 'pdf'; caption?: string } | null {
  const fileRefMatch = message.match(/fileRef:\s*([^\s]+)/i);
  if (!fileRefMatch) return null;

  const fileRef = fileRefMatch[1];
  const typeMatch = message.match(/\((image|pdf)\)/i);
  const inferredType = typeMatch?.[1]?.toLowerCase() === 'pdf' ? 'pdf' : 'image';

  const captionMatch = message.match(/Mensaje:\s*([\s\S]+)/i);
  const caption = captionMatch?.[1]?.trim();

  const fileType = inferAttachmentType(fileRef, inferredType);

  return { fileRef, fileType, caption };
}

function inferAttachmentType(fileRef: string, fallback: 'image' | 'pdf'): 'image' | 'pdf' {
  const lower = fileRef.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.webp')) return 'image';
  return fallback;
}

function extractMoneyCents(message: string): number | null {
  const match = message.match(/(?:\$|ars)?\s*([0-9][0-9.,]*)/i);
  if (!match) return null;

  let value = match[1];
  if (value.includes('.') && value.includes(',')) {
    value = value.replace(/\./g, '').replace(',', '.');
  } else if (value.includes(',')) {
    const parts = value.split(',');
    if (parts[1] && parts[1].length === 2) {
      value = `${parts[0].replace(/\./g, '')}.${parts[1]}`;
    } else {
      value = value.replace(/,/g, '');
    }
  } else {
    value = value.replace(/,/g, '');
  }

  const amount = Number(value);
  if (Number.isNaN(amount) || amount <= 0) return null;
  return Math.round(amount * 100);
}

function extractDeclaredReceiptAmount(
  message: string,
  attachment: { caption?: string }
): number | null {
  const caption = attachment.caption?.trim();
  if (caption) {
    const amount = extractMoneyCents(caption);
    if (amount) return amount;
  }

  if (/fileRef:/i.test(message) || /archivo adjunto/i.test(message)) {
    return null;
  }

  return extractMoneyCents(message);
}

function extractOrderNumber(message: string): string | null {
  const match = message.match(/ord[-\s]?\d+/i);
  if (!match) return null;
  const digits = match[0].replace(/[^0-9]/g, '');
  if (!digits) return null;
  return `ORD-${digits}`;
}

function extractOrderDigits(message: string): string | null {
  const targeted = message.match(/(?:pedido|orden|ord)\s*#?\s*(\d{1,10})/i);
  if (targeted?.[1]) return targeted[1];
  const fallback = message.match(/\b\d{1,10}\b/);
  return fallback?.[0] ?? null;
}

function normalizeOrderDigits(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  if (!digits) return null;
  const normalized = digits.replace(/^0+/, '');
  return normalized || '0';
}

function resolveAwaitingOrder<T extends { id: string; orderNumber?: string | null }>(
  reference: string | undefined,
  orders: T[]
): { order: T | null; ambiguous: boolean } {
  if (!reference) return { order: null, ambiguous: false };
  const trimmed = reference.trim();
  if (!trimmed) return { order: null, ambiguous: false };

  const exact = orders.find((o) => (o.orderNumber || '').toLowerCase() === trimmed.toLowerCase());
  if (exact) return { order: exact, ambiguous: false };

  const refDigits = normalizeOrderDigits(trimmed);
  if (!refDigits) return { order: null, ambiguous: false };

  const matches = orders.filter((o) => {
    if (!o.orderNumber) return false;
    const digits = normalizeOrderDigits(o.orderNumber);
    return digits ? digits === refDigits || digits.endsWith(refDigits) : false;
  });

  if (matches.length === 1) return { order: matches[0], ambiguous: false };
  if (matches.length > 1) return { order: null, ambiguous: true };
  return { order: null, ambiguous: false };
}

function resolveActiveOrderSelection<T extends { id: string; orderNumber: string }>(
  request: { orderId?: string; orderNumber?: string },
  orders: T[]
): { order: T | null; ambiguous: boolean } {
  if (request.orderId) {
    const match = orders.find((order) => order.id === request.orderId);
    return { order: match || null, ambiguous: false };
  }

  return resolveAwaitingOrder(request.orderNumber, orders);
}

function isAcknowledgement(message: string): boolean {
  const normalized = normalizeSimpleText(message);
  if (!normalized) return false;

  const positive = new Set([
    'ok',
    'okay',
    'okey',
    'listo',
    'bueno',
    'perfecto',
    'genial',
    'esta bien',
    'está bien',
    'de acuerdo',
    'dale',
    'si',
    'sí',
    'vale',
    'gracias',
    'grx',
  ]);
  const negative = new Set([
    'no',
    'n',
    'nop',
    'nope',
    'ninguno',
    'ninguna',
    'nada',
    'no gracias',
  ]);

  if (positive.has(normalized)) return true;
  if (negative.has(normalized)) return true;
  if (normalized.startsWith('ok ')) return true;
  if (normalized.startsWith('okey ')) return true;
  if (normalized.startsWith('okay ')) return true;
  if (normalized === 'nono' || normalized === 'no no') return true;

  return false;
}

function isReturnToMenu(message: string): boolean {
  const normalized = normalizeSimpleText(message);
  if (!normalized) return false;

  const direct = new Set([
    'menu',
    'menú',
    'menu principal',
    'menú principal',
    'inicio',
    'volver al menu',
    'volver al menú',
    'volver al inicio',
    'regresar al menu',
    'regresar al menú',
    'regresar al inicio',
    'volver al menu principal',
    'volver al menú principal',
    'ir al menu',
    'ir al menú',
    'ir al inicio',
    'volver',
    'regresar',
    'reset',
    'resetear',
    'reiniciar',
    'reiniciar pedido',
    'reiniciar carrito',
    'limpiar',
    'limpiar pedido',
    'limpiar carrito',
    'borrar carrito',
    'borrar pedido',
    'empezar de nuevo',
  ]);

  if (direct.has(normalized)) return true;

  return /(volver|regresar|ir)\s+(al|a)\s+(menu|menú|inicio|comienzo)/.test(normalized);
}

function isRegretMessage(message: string): boolean {
  const normalized = normalizeSimpleText(message);
  if (!normalized) return false;
  if (normalized.includes('no me arrepent')) return false;
  return normalized.includes('arrepent');
}

function normalizeSimpleText(message: string): string {
  return message
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.,!¡?¿;:()"']/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resetOrderFlowContext(memory: SessionMemory): void {
  memory.context.pendingOrderDecision = undefined;
  memory.context.pendingOrderId = undefined;
  memory.context.pendingOrderNumber = undefined;
  memory.context.pendingCancelOrderId = undefined;
  memory.context.pendingCancelOrderNumber = undefined;
  memory.context.pendingStockAdjustment = undefined;
  memory.context.pendingCatalogOffer = undefined;
  memory.context.activeOrdersPrompt = undefined;
  memory.context.activeOrdersAction = undefined;
  memory.context.activeOrdersAwaiting = undefined;
  memory.context.activeOrdersPayable = undefined;
  memory.context.paymentStage = undefined;
  memory.context.paymentOrders = undefined;
  memory.context.paymentOrderId = undefined;
  memory.context.paymentOrderNumber = undefined;
  memory.context.paymentPendingAmount = undefined;
  memory.context.paymentReceiptId = undefined;
  memory.context.paymentReceiptAmount = undefined;
  memory.context.pendingProductSelection = undefined;
  memory.context.repeatOrders = undefined;
  memory.context.repeatOrderId = undefined;
  memory.context.repeatOrderNumber = undefined;
  memory.context.editingOrderId = undefined;
  memory.context.editingOrderNumber = undefined;
  memory.context.editingOrderOriginalItems = undefined;
  memory.context.orderViewAwaitingAck = undefined;
  memory.context.orderViewAwaitingNumber = undefined;
  memory.context.interruptedTopic = undefined;
  memory.context.lastMenu = undefined;
}

function shouldSkipQuickParse(message: string): boolean {
  const normalized = normalizeSimpleText(message);
  if (!normalized) return true;

  const blockers = [
    'sacar',
    'quitar',
    'restar',
    'menos',
    'eliminar',
    'bajar',
    'reducir',
    'cambiar',
    'editar',
    'modificar',
  ];

  return blockers.some((word) => normalized.includes(word));
}

const ORDER_STOPWORDS = new Set([
  'de',
  'del',
  'la',
  'las',
  'los',
  'el',
  'y',
  'a',
  'al',
  'por',
  'para',
  'con',
  'sin',
  'un',
  'una',
  'unos',
  'unas',
  'agregar',
  'agrega',
  'agregue',
  'agreguen',
  'agregado',
  'agregados',
  'agregada',
  'agregadas',
  'agregame',
  'agregamelo',
  'agregamela',
  'sumar',
  'suma',
  'sumen',
  'sumenme',
  'sumame',
  'sumamelo',
  'añadir',
  'añadi',
  'anadir',
  'añadan',
  'anadan',
  'poner',
  'pone',
  'pongan',
  'poneme',
  'ponme',
  'ponelos',
  'ponelas',
  'mete',
  'meteme',
  'metelos',
  'metelas',
  'podes',
  'podrias',
  'puedes',
  'podras',
  'podriamos',
  'queres',
  'quiero',
  'queria',
  'quisiera',
  'necesito',
  'porfa',
  'porfavor',
  'favor',
  'quitame',
  'quiteme',
  'quitarme',
  'quitamelo',
  'quitamela',
  'quitameee',
  'quitamee',
  'quitameeee',
  'quiten',
  'quitenme',
  'quitar',
  'sacame',
  'sacamee',
  'sacameee',
  'sacameeee',
  'sacarme',
  'sacalo',
  'sacala',
  'sacalos',
  'sacalas',
  'sacar',
  'eliminar',
  'eliminame',
  'eliminamee',
  'eliminameee',
  'eliminameeee',
  'eliminen',
  'eliminamelo',
  'eliminamela',
  'borrame',
  'borrameee',
  'borra',
  'borrar',
]);

const ORDER_NAME_TRAILING_STOPWORDS = new Set([
  'entonces',
  'porfa',
  'porfavor',
  'favor',
  'gracias',
  'ok',
  'okey',
  'dale',
]);

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

const SECONDARY_UNIT_SYNONYMS: Record<string, 'pack' | 'box' | 'bundle' | 'dozen'> = {
  pack: 'pack',
  packs: 'pack',
  paquete: 'pack',
  paquetes: 'pack',
  paq: 'pack',
  caja: 'box',
  cajas: 'box',
  box: 'box',
  bulto: 'bundle',
  bultos: 'bundle',
  docena: 'dozen',
  docenas: 'dozen',
  doc: 'dozen',
};

type QuantityParseResult = {
  segments: Array<{ quantity: number; name: string }>;
  hasLeadingWithoutQuantity: boolean;
  canInferLeading: boolean;
};

function normalizeOrderToken(token: string): string {
  if (!token) return '';
  return token
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .replace(/([a-z])\1{2,}/g, '$1')
    .trim();
}

function isOrderCommandLike(text: string): boolean {
  const normalized = normalizeOrderToken(text);
  if (!normalized) return false;
  return /^(agreg|sum|anad|pon|met|quit|sac|elim|borr|canc)/.test(normalized);
}

function parseQuantityMessage(message: string): QuantityParseResult {
  const cleaned = message
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[!?¡¿,;:()"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) {
    return { segments: [], hasLeadingWithoutQuantity: false, canInferLeading: false };
  }

  const tokens = cleaned.split(' ');
  const segments: Array<{ quantity: number; name: string }> = [];
  const quantities: number[] = [];
  let firstNumberIndex = -1;

  for (let idx = 0; idx < tokens.length; idx += 1) {
    const token = tokens[idx] ?? '';
    if (/^\d+$/.test(token)) {
      const value = Number.parseInt(token, 10);
      if (Number.isFinite(value)) {
        quantities.push(value);
      }
      if (firstNumberIndex === -1) {
        firstNumberIndex = idx;
      }
    }
  }

  const leadingTokens =
    firstNumberIndex > 0 ? tokens.slice(0, firstNumberIndex) : [];
  const leadingName = leadingTokens
    .filter((token) => token && !ORDER_STOPWORDS.has(token))
    .filter((token) => !isOrderCommandLike(token))
    .join(' ')
    .trim();
  const hasLeadingWithoutQuantity = !!leadingName && !isOrderCommandLike(leadingName);

  let dominantQuantity: number | null = null;
  let dominantCount = 0;
  if (quantities.length > 0) {
    const counts = new Map<number, number>();
    for (const qty of quantities) {
      counts.set(qty, (counts.get(qty) || 0) + 1);
    }
    for (const [qty, count] of counts.entries()) {
      if (count > dominantCount) {
        dominantCount = count;
        dominantQuantity = qty;
      }
    }
  }

  const canInferLeading = hasLeadingWithoutQuantity && dominantQuantity !== null && dominantCount >= 2;
  if (hasLeadingWithoutQuantity && canInferLeading && dominantQuantity !== null) {
    segments.push({ quantity: dominantQuantity, name: leadingName });
  }

  let i = firstNumberIndex === -1 ? 0 : firstNumberIndex;

  while (i < tokens.length) {
    const token = tokens[i] ?? '';
    if (/^\d+$/.test(token)) {
      const quantity = Number.parseInt(token, 10);
      i += 1;
      const nameTokens: string[] = [];
      while (i < tokens.length && !/^\d+$/.test(tokens[i] ?? '')) {
        nameTokens.push(tokens[i]!);
        i += 1;
      }
      if (nameTokens.length > 0 && Number.isFinite(quantity) && quantity > 0) {
        const filteredTokens = nameTokens
          .filter((token) => token && !ORDER_STOPWORDS.has(token))
          .filter((token) => !isOrderCommandLike(token));
        while (
          filteredTokens.length > 0 &&
          ORDER_NAME_TRAILING_STOPWORDS.has(filteredTokens[filteredTokens.length - 1]!)
        ) {
          filteredTokens.pop();
        }
        const normalizedName = filteredTokens.join(' ').trim();
        if (!normalizedName) {
          continue;
        }
        segments.push({
          quantity,
          name: normalizedName,
        });
      }
      continue;
    }
    i += 1;
  }

  return { segments, hasLeadingWithoutQuantity, canInferLeading };
}

function shouldForceQuickParse(message: string, fsm: StateMachine): boolean {
  if (fsm.getState() !== AgentState.COLLECTING_ORDER && fsm.getState() !== AgentState.IDLE) {
    return false;
  }
  if (shouldSkipQuickParse(message)) return false;

  const parsed = parseQuantityMessage(message);
  if (parsed.hasLeadingWithoutQuantity && !parsed.canInferLeading) {
    return false;
  }

  if (parsed.segments.length >= 2) return true;
  return fsm.getState() === AgentState.COLLECTING_ORDER && parsed.segments.length === 1;
}

function matchSegmentToProduct(
  segment: { quantity: number; name: string },
  candidates: Array<{
    productId: string;
    variantId?: string;
    name: string;
    normalized: string;
    tokens: Set<string>;
    price: number;
    secondaryUnit?: string | null;
    secondaryUnitValue?: string | number | null;
  }>
): { type: 'match'; match: { productId: string; variantId?: string; name: string; price: number; secondaryUnit?: string | null; secondaryUnitValue?: string | number | null } }
  | { type: 'ambiguous'; options: Array<{ productId: string; variantId?: string; name: string; price: number; secondaryUnit?: string | null; secondaryUnitValue?: string | number | null }> }
  | { type: 'none' } {
  const segmentTokens = tokenizeProductTokens(segment.name);
  if (segmentTokens.length === 0) return { type: 'none' };
  const segmentNormalized = segmentTokens.join(' ');

  let bestScore = 0;
  let bestMatch: { productId: string; variantId?: string; name: string; price: number; secondaryUnit?: string | null; secondaryUnitValue?: string | number | null } | null = null;
  const scoredMatches: Array<{ candidate: { productId: string; variantId?: string; name: string; price: number; secondaryUnit?: string | null; secondaryUnitValue?: string | number | null }; score: number }> = [];

  const directMatches = candidates.filter((candidate) => candidate.normalized.includes(segmentNormalized));
  if (directMatches.length === 1) {
    const match = directMatches[0];
    return {
      type: 'match',
      match: {
        productId: match.productId,
        variantId: match.variantId,
        name: match.name,
        price: match.price,
        secondaryUnit: match.secondaryUnit,
        secondaryUnitValue: match.secondaryUnitValue,
      },
    };
  }
  if (directMatches.length > 1) {
    return {
      type: 'ambiguous',
      options: directMatches.map((match) => ({
        productId: match.productId,
        variantId: match.variantId,
        name: match.name,
        price: match.price,
        secondaryUnit: match.secondaryUnit,
        secondaryUnitValue: match.secondaryUnitValue,
      })),
    };
  }

  for (const candidate of candidates) {
    if (!candidate.normalized) continue;
    let matches = 0;
    for (const token of segmentTokens) {
      const singular = token.endsWith('s') && token.length > 3 ? token.slice(0, -1) : token;
      if (candidate.tokens.has(token) || candidate.tokens.has(singular)) {
        matches += 1;
      }
    }

    const score = matches / segmentTokens.length;
    if (score > bestScore) {
      bestScore = score;
      bestMatch = {
        productId: candidate.productId,
        variantId: candidate.variantId,
        name: candidate.name,
        price: candidate.price,
        secondaryUnit: candidate.secondaryUnit,
        secondaryUnitValue: candidate.secondaryUnitValue,
      };
    }
    if (score > 0) {
      scoredMatches.push({
        candidate: {
          productId: candidate.productId,
          variantId: candidate.variantId,
          name: candidate.name,
          price: candidate.price,
          secondaryUnit: candidate.secondaryUnit,
          secondaryUnitValue: candidate.secondaryUnitValue,
        },
        score,
      });
    }
  }

  if (bestScore >= 0.6 && bestMatch) {
    const closeMatches = scoredMatches
      .filter((entry) => entry.score >= bestScore - 0.1 && entry.score >= 0.6)
      .map((entry) => entry.candidate);

    if (closeMatches.length > 1 && segmentTokens.length <= 2) {
      return { type: 'ambiguous', options: closeMatches };
    }

    return { type: 'match', match: bestMatch };
  }

  return { type: 'none' };
}

function tokenizeProductTokens(value: string): string[] {
  const normalized = normalizeMatchText(value);
  if (!normalized) return [];
  const tokens = normalized.split(' ').filter(Boolean).filter((token) => !ORDER_STOPWORDS.has(token));
  while (tokens.length > 0 && ORDER_NAME_TRAILING_STOPWORDS.has(tokens[tokens.length - 1]!)) {
    tokens.pop();
  }
  return tokens;
}

function extractRequestedSecondaryUnit(value: string): 'pack' | 'box' | 'bundle' | 'dozen' | null {
  const normalized = normalizeMatchText(value);
  if (!normalized) return null;
  const tokens = normalized.split(' ').filter(Boolean);
  for (const token of tokens) {
    if (SECONDARY_UNIT_SYNONYMS[token]) {
      return SECONDARY_UNIT_SYNONYMS[token];
    }
  }
  return null;
}

function resolveSecondaryUnitMultiplier(
  requestedUnit: 'pack' | 'box' | 'bundle' | 'dozen' | null,
  productSecondaryUnit?: string | null,
  productSecondaryUnitValue?: string | number | null
): number | null {
  if (!requestedUnit || !productSecondaryUnit) return null;
  if (requestedUnit !== productSecondaryUnit) return null;
  if (requestedUnit === 'dozen') return 12;
  if (productSecondaryUnitValue === null || productSecondaryUnitValue === undefined) return null;
  const value = Number.parseFloat(productSecondaryUnitValue.toString().replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function formatSecondaryUnitPrice(
  unit: 'pack' | 'box' | 'bundle' | 'dozen',
  unitValue: number,
  unitPrice: number
): string {
  const label = (SECONDARY_UNIT_LABELS[unit] || unit).toLowerCase();
  const article = unit === 'box' || unit === 'dozen' ? 'la' : 'el';
  const total = formatMoneyCents(unitPrice * unitValue);
  return `$${total} ${article} ${label}`;
}

function buildProductCandidateName(product: {
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

function normalizeMatchText(message: string): string {
  return message
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeParseJson(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function isMenuRequest(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return true;
  const relaxed = normalizeSimpleText(message).replace(/([a-z])\1+/g, '$1');

  const greetings = [
    'hola',
    'buenas',
    'buen dia',
    'buenas tardes',
    'buenas noches',
    'como estas',
    'como andas',
    'que tal',
    'todo bien',
    'menu',
    'menú',
    'opciones',
    'ayuda',
  ];

  return greetings.some(
    (g) =>
      normalized === g ||
      normalized.startsWith(`${g} `) ||
      relaxed === g ||
      relaxed.startsWith(`${g} `)
  );
}

function shouldShowMenu(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return true;

  if (isMenuRequest(message)) return true;

  // Very short or vague messages
  return normalized.length <= 3;
}

function extractRegistrationParts(
  message: string
): { firstName?: string; lastName?: string; dni?: string } {
  const dni = extractDni(message);
  const name = extractFullName(message.replace(dni || '', ' '));

  const result: { firstName?: string; lastName?: string; dni?: string } = {};
  if (dni) result.dni = dni;

  if (name) {
    const parts = name.split(' ').filter(Boolean);
    if (parts.length >= 2) {
      result.firstName = parts[0];
      result.lastName = parts.slice(1).join(' ');
    }
  }

  return result;
}

function extractDni(message: string): string | null {
  const keywordMatch = message.match(/(?:dni|documento|doc)\s*[:\-]?\s*([0-9.\-\s]{7,20})/i);
  if (keywordMatch?.[1]) {
    const digits = keywordMatch[1].replace(/\D/g, '');
    if (digits.length >= 7 && digits.length <= 11) return digits;
  }

  const digitsMatch = message.match(/\b[\d.\-]{7,20}\b/);
  if (digitsMatch?.[0]) {
    const digits = digitsMatch[0].replace(/\D/g, '');
    if (digits.length >= 7 && digits.length <= 11) return digits;
  }

  return null;
}

function extractFullName(message: string): string | null {
  const patterns = [
    /me llamo\s+(.+)/i,
    /mi nombre es\s+(.+)/i,
    /soy\s+(.+)/i,
    /nombre\s*[:\-]?\s+(.+)/i,
  ];

  let candidate: string | null = null;
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) {
      candidate = match[1];
      break;
    }
  }

  const cleaned = cleanName(candidate || message);
  const parts = cleaned
    .split(' ')
    .filter(Boolean)
    .filter((part) => !['dni', 'documento', 'doc'].includes(part.toLowerCase()));

  if (parts.length < 2 || parts.length > 5) {
    return null;
  }

  return parts.join(' ');
}

function cleanName(value: string): string {
  return value
    .replace(/\d{7,11}/g, ' ')
    .replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatMoneyCents(amount: number): string {
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount / 100);
}

type OrderDraftItem = {
  productId: string;
  variantId?: string;
  quantity: number;
};

function buildOrderEditDiff(
  originalItems: OrderDraftItem[],
  updatedItems: OrderDraftItem[]
): Array<{ action: 'add' | 'remove' | 'update_quantity'; productId: string; variantId?: string; quantity: number }> {
  const keyFor = (item: OrderDraftItem) => `${item.productId}:${item.variantId ?? 'null'}`;
  const originalMap = new Map(originalItems.map((item) => [keyFor(item), item]));
  const updatedMap = new Map(updatedItems.map((item) => [keyFor(item), item]));
  const keys = new Set([...originalMap.keys(), ...updatedMap.keys()]);
  const actions: Array<{ action: 'add' | 'remove' | 'update_quantity'; productId: string; variantId?: string; quantity: number }> = [];

  for (const key of keys) {
    const original = originalMap.get(key);
    const updated = updatedMap.get(key);

    if (!original && updated) {
      actions.push({
        action: 'add',
        productId: updated.productId,
        variantId: updated.variantId,
        quantity: updated.quantity,
      });
      continue;
    }

    if (original && !updated) {
      actions.push({
        action: 'remove',
        productId: original.productId,
        variantId: original.variantId,
        quantity: 0,
      });
      continue;
    }

    if (original && updated && original.quantity !== updated.quantity) {
      actions.push({
        action: 'update_quantity',
        productId: updated.productId,
        variantId: updated.variantId,
        quantity: updated.quantity,
      });
    }
  }

  return actions;
}

function parseConfirmationResponse(message: string): boolean | null {
  const raw = message.trim().toLowerCase();
  const normalized = normalizeSimpleText(message);
  if (!raw && !normalized) return null;

  if (raw.includes('order_confirm')) return true;
  if (raw.includes('order_cancel')) return false;

  const yes = new Set(['si', 'sí', 's', 'ok', 'okay', 'confirmo', 'confirmar', 'dale', 'de acuerdo']);
  const no = new Set(['no', 'n', 'cancelar', 'cancela', 'rechazo']);

  if (yes.has(normalized)) return true;
  if (no.has(normalized)) return false;
  return null;
}

function buildConfirmationRequest(
  toolName: string,
  input: Record<string, unknown>
): PendingConfirmation {
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  const message = buildConfirmationMessage(toolName, input);

  return {
    action: toolName,
    toolName,
    toolInput: input,
    message,
    expiresAt,
  };
}

function buildConfirmationMessage(toolName: string, input: Record<string, unknown>): string {
  const getId = () => (input.orderNumber || input.orderId || input.productId || input.sku || input.categoryName) as string | undefined;
  const formatMoney = (amount?: number) => {
    if (amount === undefined || Number.isNaN(amount)) return undefined;
    return `$${formatMoneyCents(amount)}`;
  };

  switch (toolName) {
    case 'confirm_order':
      return '¿Confirmás que confirme el pedido actual? (Sí/No)';
    case 'cancel_order_if_not_processed': {
      const id = getId();
      return `¿Confirmás que cancele el pedido${id ? ` ${id}` : ''}? (Sí/No)`;
    }
    case 'admin_cancel_order': {
      const id = getId();
      return `¿Confirmás que cancele el pedido${id ? ` ${id}` : ''}? (Sí/No)`;
    }
    case 'admin_create_order': {
      const customer = (input.customerPhone || input.customerId) as string | undefined;
      return `¿Confirmás que cree el pedido${customer ? ` para ${customer}` : ''}? (Sí/No)`;
    }
    case 'admin_adjust_prices_percent': {
      const percent = typeof input.percent === 'number' ? input.percent : undefined;
      const amount = typeof input.amount === 'number' ? input.amount : undefined;
      const category = input.categoryName as string | undefined;
      const query = input.query as string | undefined;
      const names = Array.isArray(input.productNames) ? input.productNames.filter((v) => typeof v === 'string') : [];
      const productLabel =
        category ? `en categoría ${category}` :
          names.length > 0 ? `en ${names.length} producto(s)` :
            query ? `en productos que coincidan con "${query}"` :
              (input.name as string | undefined) || (input.sku as string | undefined) || (input.productId as string | undefined) || 'en los productos indicados';
      const changeLabel = percent !== undefined
        ? `${percent}%`
        : amount !== undefined
          ? `$${amount.toLocaleString('es-AR', { maximumFractionDigits: 2 })}`
          : '';
      return `¿Confirmás que ajuste precios ${changeLabel ? `${changeLabel} ` : ''}${productLabel}? (Sí/No)`;
    }
    case 'modify_order_if_not_processed': {
      const id = getId();
      return `¿Confirmás que modifique el pedido${id ? ` ${id}` : ''}? (Sí/No)`;
    }
    case 'process_payment_receipt': {
      const amount = formatMoney(input.amount as number | undefined);
      return `¿Confirmás que registre el pago${amount ? ` por ${amount}` : ''}? (Sí/No)`;
    }
    case 'apply_receipt_to_order': {
      const amount = formatMoney(input.amount as number | undefined);
      return `¿Confirmás que aplique el comprobante${amount ? ` por ${amount}` : ''} al pedido? (Sí/No)`;
    }
    case 'apply_payment_to_balance': {
      const amount = formatMoney(input.amount as number | undefined);
      return `¿Confirmás que aplique el pago${amount ? ` por ${amount}` : ''} como saldo a favor? (Sí/No)`;
    }
    case 'adjust_stock': {
      const quantity = input.quantity as number | undefined;
      const product = (input.productName || input.sku || input.productId) as string | undefined;
      return `¿Confirmás que ajuste el stock${product ? ` de ${product}` : ''}${quantity !== undefined ? ` en ${quantity}` : ''}? (Sí/No)`;
    }
    case 'create_product': {
      const name = input.name as string | undefined;
      return `¿Confirmás que cree el producto${name ? ` "${name}"` : ''}? (Sí/No)`;
    }
    case 'update_product': {
      const name = (input.name || input.sku || input.productId) as string | undefined;
      return `¿Confirmás que actualice el producto${name ? ` "${name}"` : ''}? (Sí/No)`;
    }
    case 'delete_product': {
      const name = (input.productName || input.sku || input.productId) as string | undefined;
      return `¿Confirmás que elimine el producto${name ? ` "${name}"` : ''}? (Sí/No)`;
    }
    case 'create_category': {
      const name = input.name as string | undefined;
      return `¿Confirmás que cree la categoría${name ? ` "${name}"` : ''}? (Sí/No)`;
    }
    case 'delete_category': {
      const name = (input.categoryName || input.categoryId) as string | undefined;
      return `¿Confirmás que elimine la categoría${name ? ` "${name}"` : ''}? (Sí/No)`;
    }
    case 'assign_category_to_product': {
      const category = input.categoryName as string | undefined;
      const product = (input.productName || input.sku || input.productId) as string | undefined;
      return `¿Confirmás que asigne la categoría${category ? ` "${category}"` : ''}${product ? ` al producto "${product}"` : ''}? (Sí/No)`;
    }
    default:
      return '¿Confirmás que realice esta acción? (Sí/No)';
  }
}

function buildConfirmationResultMessage(
  execution: ToolExecution,
  pending: PendingConfirmation
): string {
  if (execution.result.success) {
    const data = execution.result.data as Record<string, unknown> | undefined;
    const message = data?.message as string | undefined;
    if (message) return message;
    return 'Listo, quedó confirmado.';
  }

  const error = execution.result.error || 'No pude completar la acción.';
  return `No pude completar la acción solicitada: ${error}`;
}
