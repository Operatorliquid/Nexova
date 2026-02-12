/**
 * Agent Orchestrator
 * Main entry point for processing incoming messages
 * Handles: FSM, routing, tool execution, audit logging, error handling
 */
import { PrismaClient, Prisma } from '@prisma/client';
import type { Redis } from 'ioredis';
import Anthropic from '@anthropic-ai/sdk';

import {
  OrchestratorContext,
  OrchestratorResult,
  SessionState,
  AgentTurnAudit,
  AgentState,
  AgentStateType,
  MessageThread,
  MessageThreadType,
  ToolContext,
  ToolExecution,
} from '../types/index.js';
import { StateMachine } from './state-machine.js';
import { MemoryManager, createMemoryManager } from './memory-manager.js';
import { MemoryService } from './memory-service.js';
import { ConversationRouter, classifyMessage } from './conversation-router.js';
import { ToolRegistry, toolRegistry } from '../tools/registry.js';
import { initializeRetailTools } from '../tools/retail/index.js';
import { buildRetailSystemPrompt } from '../prompts/retail-system.js';
import { createNotificationIfEnabled } from '../utils/notifications.js';

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const MAX_CONSECUTIVE_FAILURES = 2;
const MAX_TOOL_ITERATIONS = 10;
const SESSION_STATE_KEY_PREFIX = 'agent:state:';
const SESSION_STATE_TTL = 60 * 60 * 24; // 24 hours

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

export interface OrchestratorConfig {
  anthropicApiKey: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

const DEFAULT_CONFIG = {
  model: 'claude-sonnet-4-20250514',
  maxTokens: 4096,
  temperature: 0.7,
};

// ═══════════════════════════════════════════════════════════════════════════════
// AGENT ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════════════════

export class AgentOrchestrator {
  private prisma: PrismaClient;
  private redis: Redis;
  private anthropic: Anthropic;
  private memoryManager: MemoryManager;
  private memoryService: MemoryService;
  private router: ConversationRouter;
  private config: Required<OrchestratorConfig>;
  private initialized = false;

  constructor(prisma: PrismaClient, redis: Redis, config: OrchestratorConfig) {
    this.prisma = prisma;
    this.redis = redis;
    this.config = { ...DEFAULT_CONFIG, ...config } as Required<OrchestratorConfig>;

    this.anthropic = new Anthropic({
      apiKey: config.anthropicApiKey,
    });

    this.memoryManager = createMemoryManager(redis);
    this.memoryService = new MemoryService(this.prisma, this.anthropic);
    this.router = new ConversationRouter();
  }

  /**
   * Initialize tools (call once before processing)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    initializeRetailTools(this.prisma, this.memoryManager);
    this.initialized = true;
    console.log('[Orchestrator] Initialized');
  }

  /**
   * Main entry point: handle an incoming message
   */
  async handleMessage(
    ctx: OrchestratorContext,
    message: string
  ): Promise<OrchestratorResult> {
    const startTime = Date.now();
    const toolsUsed: ToolExecution[] = [];
    let totalTokens = 0;

    await this.initialize();

    // 1. Load session state
    const sessionState = await this.loadSessionState(ctx.sessionId);
    const fsm = new StateMachine(sessionState.state);

    // 2. Check if agent is in HANDOFF state
    if (sessionState.state === AgentState.HANDOFF) {
      return {
        response: '',
        state: AgentState.HANDOFF,
        thread: sessionState.thread,
        toolsUsed: [],
        tokensUsed: 0,
        shouldSendMessage: false,
        handoffTriggered: true,
        handoffReason: 'Session in HANDOFF state - awaiting human',
      };
    }

    // 2b. Respect workspace availability status (commerce only)
    const availabilityStatus = await this.resolveWorkspaceAvailability(ctx.workspaceId);
    if (availabilityStatus === 'unavailable') {
      return {
        response: 'No estamos disponibles por el momento.',
        state: sessionState.state,
        thread: sessionState.thread,
        toolsUsed: [],
        tokensUsed: 0,
        shouldSendMessage: true,
        handoffTriggered: false,
      };
    }
    if (availabilityStatus === 'vacation') {
      return {
        response: 'Estamos de vacaciones, volveremos pronto.',
        state: sessionState.state,
        thread: sessionState.thread,
        toolsUsed: [],
        tokensUsed: 0,
        shouldSendMessage: true,
        handoffTriggered: false,
      };
    }

    // 3. Route message to ORDER or INFO thread
    const routerDecision = this.router.route(
      message,
      sessionState.state,
      sessionState.thread
    );

    // Save interrupted context if switching threads during order
    if (routerDecision.shouldInterrupt && sessionState.thread === MessageThread.ORDER) {
      sessionState.interruptedThread = sessionState.thread;
      sessionState.interruptedState = sessionState.state;
    }

    // 4. Check for HANDOFF triggers
    if (routerDecision.handoffRequested || routerDecision.sentimentNegative) {
      const trigger = routerDecision.handoffRequested ? 'customer_request' : 'negative_sentiment';
      const reason = routerDecision.handoffRequested
        ? 'Customer requested human assistance'
        : 'Negative sentiment detected';

      await this.triggerHandoff(ctx, sessionState, reason, trigger);

      return {
        response: 'Te comunico con un representante. Un momento por favor. 🙋',
        state: AgentState.HANDOFF,
        thread: sessionState.thread,
        toolsUsed: [],
        tokensUsed: 0,
        shouldSendMessage: true,
        handoffTriggered: true,
        handoffReason: reason,
      };
    }

    // 5. Prepare audit entry
    const audit: AgentTurnAudit = {
      correlationId: ctx.correlationId,
      sessionId: ctx.sessionId,
      workspaceId: ctx.workspaceId,
      messageId: ctx.messageId,
      timestamp: new Date(),
      input: {
        content: message,
        thread: sessionState.thread,
        previousState: sessionState.state,
      },
      decision: {
        newThread: routerDecision.thread,
        newState: sessionState.state, // Will be updated
        reasoning: `Router: ${routerDecision.thread} (confidence: ${routerDecision.confidence.toFixed(2)})`,
      },
      toolCalls: [],
      result: {
        response: '',
        finalState: sessionState.state,
        tokensUsed: 0,
        totalDurationMs: 0,
        handoffTriggered: false,
      },
    };

    try {
      // 6. Get or initialize session memory
      let memory = await this.memoryManager.getSession(ctx.sessionId);
      if (!memory) {
        memory = await this.memoryManager.initSession(
          ctx.sessionId,
          ctx.workspaceId,
          ctx.customerId
        );
      }

      // 7. Build context
      const toolContext: ToolContext = {
        workspaceId: ctx.workspaceId,
        sessionId: ctx.sessionId,
        customerId: ctx.customerId,
        correlationId: ctx.correlationId,
        currentState: fsm.getState(),
      };

      // 8. Load conversation history and commerce profile
      const contextStartAt = await this.getSessionContextStartAt(ctx.sessionId, ctx.workspaceId);
      const history = await this.getConversationHistory(ctx.sessionId, contextStartAt);
      const workspace = await this.prisma.workspace.findUnique({
        where: { id: ctx.workspaceId },
        select: { name: true, settings: true },
      });
      const workspaceSettings = (workspace?.settings as Record<string, unknown>) || {};
      const commerceProfile = memory.context.commerceProfile || workspaceSettings || {};
      const commerceName =
        (workspaceSettings.businessName as string) ||
        'Tu Comercio';

      // 9. Build system prompt
      const memoryContext = await this.memoryService.buildContext(ctx.sessionId, ctx.workspaceId);
      const systemPrompt = buildRetailSystemPrompt(
        commerceName,
        commerceProfile as any,
        { memoryContext }
      );

      // 10. Prepare messages for Claude
      const claudeMessages: Anthropic.MessageParam[] = history.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

      // Add context about returning to order if applicable
      let contextPrefix = '';
      if (routerDecision.thread === MessageThread.INFO &&
          sessionState.interruptedThread === MessageThread.ORDER &&
          memory.cart &&
          memory.cart.items.length > 0) {
        contextPrefix = `[Nota interna: El cliente interrumpió un pedido en curso con ${memory.cart.items.length} items para hacer una consulta. Después de responder, recordale el pedido pendiente.]\n\n`;
      }

      claudeMessages.push({ role: 'user', content: contextPrefix + message });

      // Store user message
      await this.storeMessage(ctx.sessionId, 'user', message, ctx.messageId);

      // 11. Get tool definitions
      const tools = toolRegistry.getToolDefinitions().map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema as Anthropic.Tool.InputSchema,
      }));

      // 12. Agent loop with tool execution
      let response = '';
      let iterations = 0;
      let pendingToolResults: Array<{ tool_use_id: string; content: string }> = [];

      while (iterations < MAX_TOOL_ITERATIONS) {
        iterations++;

        const requestMessages = [...claudeMessages];

        // Add tool results if any
        if (pendingToolResults.length > 0) {
          requestMessages.push({
            role: 'user',
            content: pendingToolResults.map((tr) => ({
              type: 'tool_result' as const,
              tool_use_id: tr.tool_use_id,
              content: tr.content,
            })),
          });
          pendingToolResults = [];
        }

        // Call Claude
        const llmResponse = await this.anthropic.messages.create({
          model: this.config.model,
          max_tokens: this.config.maxTokens,
          temperature: this.config.temperature,
          system: systemPrompt,
          messages: requestMessages,
          tools,
        });

        totalTokens += llmResponse.usage.input_tokens + llmResponse.usage.output_tokens;

        // Process response
        let hasToolUse = false;

        for (const block of llmResponse.content) {
          if (block.type === 'text') {
            response = block.text;
          } else if (block.type === 'tool_use') {
            hasToolUse = true;
            const toolStart = Date.now();

            // Execute tool
            const execution = await toolRegistry.execute(
              block.name,
              block.input as Record<string, unknown>,
              toolContext
            );

            toolsUsed.push(execution);

            // Log to audit
            audit.toolCalls.push({
              name: block.name,
              input: block.input as Record<string, unknown>,
              output: execution.result,
              durationMs: Date.now() - toolStart,
            });

            // Handle state transition from tool
            if (execution.result.stateTransition) {
              if (fsm.canTransition(execution.result.stateTransition)) {
                fsm.transition(execution.result.stateTransition);
                await this.memoryManager.updateState(ctx.sessionId, execution.result.stateTransition);
              }
            }

            // Add tool result for next iteration
            pendingToolResults.push({
              tool_use_id: block.id,
              content: JSON.stringify(execution.result),
            });
          }
        }

        // Exit if no tool use or end turn
        if (!hasToolUse || llmResponse.stop_reason === 'end_turn') {
          break;
        }
      }

      // 13. Check if we should return to ORDER thread
      if (routerDecision.thread === MessageThread.INFO &&
          sessionState.interruptedThread === MessageThread.ORDER &&
          memory.cart &&
          memory.cart.items.length > 0) {
        // Append return-to-order reminder if not already in response
        if (!response.toLowerCase().includes('pedido')) {
          response += '\n\n' + this.router.buildReturnToOrderContext(memory.cart);
        }
      }

      // 14. Store assistant response
      if (response) {
        await this.storeMessage(ctx.sessionId, 'assistant', response);
      }

      // 15. Update session state
      const newState = fsm.getState();
      const newThread = routerDecision.thread;

      await this.saveSessionState(ctx.sessionId, {
        state: newState,
        thread: newThread,
        failureCount: 0, // Reset on success
        lastFailureAt: undefined,
        interruptedThread: sessionState.interruptedThread,
        interruptedState: sessionState.interruptedState,
      });

      // Update DB session
      await this.prisma.agentSession.updateMany({
        where: { id: ctx.sessionId, workspaceId: ctx.workspaceId },
        data: {
          currentState: newState,
          lastActivityAt: new Date(),
        },
      });

      // 16. Complete audit
      audit.decision.newState = newState;
      audit.result = {
        response,
        finalState: newState,
        tokensUsed: totalTokens,
        totalDurationMs: Date.now() - startTime,
        handoffTriggered: false,
      };

      await this.saveAudit(audit);

      return {
        response,
        state: newState,
        thread: newThread,
        toolsUsed,
        tokensUsed: totalTokens,
        shouldSendMessage: response.length > 0 && fsm.isAgentActive(),
        handoffTriggered: false,
      };
    } catch (error) {
      console.error('[Orchestrator] Error processing message:', error);

      // Increment failure count
      sessionState.failureCount++;
      sessionState.lastFailureAt = new Date();

      // Check for HANDOFF due to consecutive failures
      if (sessionState.failureCount >= MAX_CONSECUTIVE_FAILURES) {
        const reason = `${MAX_CONSECUTIVE_FAILURES} consecutive failures`;
        await this.triggerHandoff(ctx, sessionState, reason, 'negative_sentiment');

        // Complete audit with error
        audit.result = {
          response: '',
          finalState: AgentState.HANDOFF,
          tokensUsed: totalTokens,
          totalDurationMs: Date.now() - startTime,
          handoffTriggered: true,
          handoffReason: reason,
        };
        await this.saveAudit(audit);

        return {
          response: 'Estoy teniendo problemas técnicos. Te comunico con un representante. 🙋',
          state: AgentState.HANDOFF,
          thread: sessionState.thread,
          toolsUsed,
          tokensUsed: totalTokens,
          shouldSendMessage: true,
          handoffTriggered: true,
          handoffReason: reason,
        };
      }

      // Save updated failure count
      await this.saveSessionState(ctx.sessionId, sessionState);

      // Complete audit with error
      audit.result = {
        response: '',
        finalState: sessionState.state,
        tokensUsed: totalTokens,
        totalDurationMs: Date.now() - startTime,
        handoffTriggered: false,
      };
      await this.saveAudit(audit);

      return {
        response: 'Disculpá, tuve un problema. ¿Podés repetir tu mensaje?',
        state: sessionState.state,
        thread: sessionState.thread,
        toolsUsed,
        tokensUsed: totalTokens,
        shouldSendMessage: true,
        handoffTriggered: false,
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SESSION STATE (Redis)
  // ═══════════════════════════════════════════════════════════════════════════════

  private sessionStateKey(sessionId: string): string {
    return `${SESSION_STATE_KEY_PREFIX}${sessionId}`;
  }

  private async loadSessionState(sessionId: string): Promise<SessionState> {
    const data = await this.redis.get(this.sessionStateKey(sessionId));
    if (data) {
      const parsed = JSON.parse(data) as SessionState;
      if (parsed.lastFailureAt) {
        parsed.lastFailureAt = new Date(parsed.lastFailureAt);
      }
      return parsed;
    }

    // Default state
    return {
      state: AgentState.IDLE,
      thread: MessageThread.ORDER,
      failureCount: 0,
    };
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
    const businessType = typeof settings.businessType === 'string' ? settings.businessType : null;
    if (businessType !== 'commerce') return null;

    const status = typeof settings.availabilityStatus === 'string' ? settings.availabilityStatus : null;
    if (status === 'available' || status === 'unavailable' || status === 'vacation') {
      return status;
    }
    return null;
  }

  private async saveSessionState(sessionId: string, state: SessionState): Promise<void> {
    await this.redis.setex(
      this.sessionStateKey(sessionId),
      SESSION_STATE_TTL,
      JSON.stringify(state)
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // HANDOFF
  // ═══════════════════════════════════════════════════════════════════════════════

  private async triggerHandoff(
    ctx: OrchestratorContext,
    sessionState: SessionState,
    reason: string,
    trigger: string
  ): Promise<void> {
    // Save current state (no forzar HANDOFF aquí)
    await this.saveSessionState(ctx.sessionId, sessionState);

    let handoffId: string | null = null;
    let existingHandoff = await this.prisma.handoffRequest.findFirst({
      where: {
        workspaceId: ctx.workspaceId,
        sessionId: ctx.sessionId,
        status: 'pending',
      },
      orderBy: { createdAt: 'desc' },
    });

    const now = new Date();
    const repeatWindowMs = 2 * 60 * 60 * 1000; // 2 hours
    if (existingHandoff) {
      const ageMs = now.getTime() - existingHandoff.createdAt.getTime();
      if (ageMs > repeatWindowMs) {
        await this.prisma.handoffRequest.updateMany({
          where: { id: existingHandoff.id, workspaceId: ctx.workspaceId },
          data: { status: 'expired', resolvedAt: now, resolution: 'Expired by new request' },
        });
        existingHandoff = null;
      }
    }

    const priority = trigger === 'negative_sentiment' ? 'high' : 'normal';
    const handoff = existingHandoff
      ? existingHandoff
      : await this.prisma.handoffRequest.create({
          data: {
            workspaceId: ctx.workspaceId,
            sessionId: ctx.sessionId,
            trigger,
            reason,
            priority,
            status: 'pending',
          },
        });
    handoffId = handoff.id;

    try {
      await createNotificationIfEnabled(this.prisma, {
        workspaceId: ctx.workspaceId,
        type: 'handoff.requested',
        title: 'Solicitud de humano',
        message: existingHandoff
          ? 'Un cliente reiteró su solicitud de hablar con un humano'
          : 'Un cliente pidió hablar con un humano',
        entityType: 'Handoff',
        entityId: handoff.id,
        metadata: {
          sessionId: ctx.sessionId,
          customerId: ctx.customerId,
          trigger,
          priority,
          reason,
          repeat: Boolean(existingHandoff),
        },
      });
    } catch (error) {
      console.error('[Orchestrator] Failed to create handoff notification:', error);
    }

    const session = await this.prisma.agentSession.findFirst({
      where: { id: ctx.sessionId, workspaceId: ctx.workspaceId },
      select: { metadata: true },
    });
    const metadata = (session?.metadata as Record<string, unknown>) || {};

    // Update DB metadata (sin desactivar IA ni forzar HANDOFF)
    await this.prisma.agentSession.updateMany({
      where: { id: ctx.sessionId, workspaceId: ctx.workspaceId },
      data: {
        lastFailure: reason,
        metadata: {
          ...metadata,
          handoffId,
          handoffReason: reason,
          handoffRequestedAt: now.toISOString(),
        },
      },
    });

    console.log(`[Orchestrator] HANDOFF triggered: ${reason}${handoffId ? ` (${handoffId})` : ''}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // CONVERSATION HISTORY
  // ═══════════════════════════════════════════════════════════════════════════════

  private async getConversationHistory(
    sessionId: string,
    since?: Date
  ): Promise<Array<{ role: string; content: string }>> {
    const messages = await this.prisma.agentMessage.findMany({
      where: {
        sessionId,
        ...(since ? { createdAt: { gte: since } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
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

  private async storeMessage(
    sessionId: string,
    role: string,
    content: string,
    externalId?: string
  ): Promise<void> {
    // Idempotency check
    if (externalId) {
      const existing = await this.prisma.agentMessage.findFirst({
        where: { sessionId, externalId },
      });
      if (existing) return;
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

  // ═══════════════════════════════════════════════════════════════════════════════
  // AUDIT LOGGING
  // ═══════════════════════════════════════════════════════════════════════════════

  private async saveAudit(audit: AgentTurnAudit): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          workspaceId: audit.workspaceId,
          correlationId: audit.correlationId,
          actorType: 'agent',
          actorId: null,
          action: 'agent.turn',
          resourceType: 'AgentSession',
          resourceId: audit.sessionId,
          status: audit.result.handoffTriggered ? 'handoff' : 'success',
          inputData: {
            messageId: audit.messageId,
            content: audit.input.content,
            thread: audit.input.thread,
            previousState: audit.input.previousState,
          } as Prisma.InputJsonValue,
          outputData: {
            decision: audit.decision,
            toolCalls: audit.toolCalls.map((tc) => ({
              name: tc.name,
              success: tc.output.success,
              durationMs: tc.durationMs,
            })),
            result: {
              finalState: audit.result.finalState,
              tokensUsed: audit.result.tokensUsed,
              totalDurationMs: audit.result.totalDurationMs,
              handoffTriggered: audit.result.handoffTriggered,
              handoffReason: audit.result.handoffReason,
            },
          } as Prisma.InputJsonValue,
          metadata: Prisma.JsonNull,
        },
      });
    } catch (error) {
      console.error('[Orchestrator] Failed to save audit:', error);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SESSION MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Get or create session for a customer
   */
  async getOrCreateSession(
    workspaceId: string,
    customerId: string,
    channelId: string,
    channelType: 'whatsapp' | 'web' | 'api' = 'whatsapp'
  ): Promise<string> {
    // Look for existing active session
    const existing = await this.prisma.agentSession.findFirst({
      where: {
        workspaceId,
        customerId,
        channelId,
        channelType,
        endedAt: null,
      },
    });

    if (existing) {
      return existing.id;
    }

    // Create new session
    const session = await this.prisma.agentSession.create({
      data: {
        workspaceId,
        customerId,
        channelId,
        channelType,
        currentState: AgentState.IDLE,
        agentActive: true,
      },
    });

    // Initialize memory
    await this.memoryManager.initSession(session.id, workspaceId, customerId);

    // Initialize state
    await this.saveSessionState(session.id, {
      state: AgentState.IDLE,
      thread: MessageThread.ORDER,
      failureCount: 0,
    });

    return session.id;
  }

  /**
   * Get or create customer by phone number
   */
  async getOrCreateCustomer(workspaceId: string, phone: string): Promise<string> {
    let customer = await this.prisma.customer.findUnique({
      where: { workspaceId_phone: { workspaceId, phone } },
    });

    if (!customer) {
      customer = await this.prisma.customer.create({
        data: {
          workspaceId,
          phone,
          status: 'active',
        },
      });

      try {
        await createNotificationIfEnabled(this.prisma, {
          workspaceId,
          type: 'customer.new',
          title: 'Nuevo cliente',
          message: `Cliente ${phone} registrado`,
          entityType: 'Customer',
          entityId: customer.id,
          metadata: {
            customerId: customer.id,
            phone,
            sessionId: null,
          },
        });
      } catch (error) {
        // Non-blocking
      }
    }

    return customer.id;
  }

  /**
   * Release handoff and return to agent
   */
  async releaseHandoff(sessionId: string): Promise<void> {
    await this.saveSessionState(sessionId, {
      state: AgentState.IDLE,
      thread: MessageThread.ORDER,
      failureCount: 0,
    });

    const session = await this.prisma.agentSession.findFirst({
      where: { id: sessionId },
      select: { workspaceId: true },
    });
    if (!session) {
      return;
    }

    await this.prisma.agentSession.updateMany({
      where: { id: sessionId, workspaceId: session.workspaceId },
      data: {
        currentState: AgentState.IDLE,
        agentActive: true,
        lastFailure: null,
        endReason: null,
        failureCount: 0,
      },
    });
  }
}

/**
 * Create an orchestrator instance
 */
export function createOrchestrator(
  prisma: PrismaClient,
  redis: Redis,
  config: OrchestratorConfig
): AgentOrchestrator {
  return new AgentOrchestrator(prisma, redis, config);
}
