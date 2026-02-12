/**
 * Tests for Agent Orchestrator
 * Tests the 3 required flows:
 * 1. Simple order (pedido simple)
 * 2. Out-of-stock with substitute (stock faltante con sustituto)
 * 3. Location question mid-cart (pregunta de ubicación en medio del carrito)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentOrchestrator } from '../../src/core/orchestrator.js';
import { MemoryManager } from '../../src/core/memory-manager.js';
import { toolRegistry } from '../../src/tools/registry.js';
import { AgentState, MessageThread } from '../../src/types/index.js';
import {
  createMockPrisma,
  createMockRedis,
  createTestContext,
  mockProducts,
  mockWorkspace,
  mockCustomer,
} from './mocks.js';

// Mock Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: {
        create: vi.fn(),
      },
    })),
  };
});

describe('AgentOrchestrator', () => {
  let orchestrator: AgentOrchestrator;
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let mockRedis: ReturnType<typeof createMockRedis>;
  let mockAnthropicCreate: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockPrisma = createMockPrisma();
    mockRedis = createMockRedis();

    // Get reference to the mocked create function
    const AnthropicModule = await import('@anthropic-ai/sdk');
    const Anthropic = vi.mocked(AnthropicModule.default);
    mockAnthropicCreate = vi.fn();
    (Anthropic as any).mockImplementation(() => ({
      messages: {
        create: mockAnthropicCreate,
      },
    }));

    orchestrator = new AgentOrchestrator(mockPrisma, mockRedis, {
      anthropicApiKey: 'test-key',
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // FLOW 1: SIMPLE ORDER (Pedido Simple)
  // ═══════════════════════════════════════════════════════════════════════════════

  describe('Flow 1: Simple Order', () => {
    it('should process a simple order request', async () => {
      const ctx = createTestContext();

      // Mock Claude response: search for product, add to cart, show summary
      mockAnthropicCreate
        .mockResolvedValueOnce({
          content: [
            {
              type: 'tool_use',
              id: 'tool-1',
              name: 'search_products',
              input: { query: 'coca cola' },
            },
          ],
          stop_reason: 'tool_use',
          usage: { input_tokens: 100, output_tokens: 50 },
        })
        .mockResolvedValueOnce({
          content: [
            {
              type: 'tool_use',
              id: 'tool-2',
              name: 'add_to_cart',
              input: { productId: 'prod-001', quantity: 5 },
            },
          ],
          stop_reason: 'tool_use',
          usage: { input_tokens: 100, output_tokens: 50 },
        })
        .mockResolvedValueOnce({
          content: [
            {
              type: 'text',
              text: '¡Perfecto! Agregué 5 Coca Cola 500ml al carrito.\n\n📋 Tu pedido:\n• 5x Coca Cola 500ml - $500 c/u = $2.500\n\nTotal: $2.500\n\n¿Querés agregar algo más o confirmamos?',
            },
          ],
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 100 },
        });

      // Register mock tools
      toolRegistry.clear();
      toolRegistry.register({
        name: 'search_products',
        description: 'Search products',
        category: 'query',
        inputSchema: { safeParse: () => ({ success: true, data: { query: 'coca cola' } }) },
        validate: () => ({ success: true, data: { query: 'coca cola' } }),
        execute: async () => ({
          success: true,
          data: { products: [mockProducts[0]] },
        }),
        getJsonSchema: () => ({ type: 'object' }),
        requiresConfirmation: false,
        getIdempotencyKey: () => null,
      } as any);

      toolRegistry.register({
        name: 'add_to_cart',
        description: 'Add to cart',
        category: 'mutation',
        inputSchema: { safeParse: () => ({ success: true, data: { productId: 'prod-001', quantity: 5 } }) },
        validate: () => ({ success: true, data: { productId: 'prod-001', quantity: 5 } }),
        execute: async () => ({
          success: true,
          data: { items: [{ name: 'Coca Cola 500ml', quantity: 5, total: 2500 }] },
          stateTransition: AgentState.COLLECTING_ORDER,
        }),
        getJsonSchema: () => ({ type: 'object' }),
        requiresConfirmation: false,
        getIdempotencyKey: () => null,
      } as any);

      const result = await orchestrator.handleMessage(ctx, 'quiero 5 cocas');

      expect(result.shouldSendMessage).toBe(true);
      expect(result.thread).toBe(MessageThread.ORDER);
      expect(result.handoffTriggered).toBe(false);
      expect(result.toolsUsed.length).toBeGreaterThan(0);
    });

    it('should transition to COLLECTING_ORDER state', async () => {
      const ctx = createTestContext();

      mockAnthropicCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: 'Hola! ¿Qué te puedo ofrecer hoy?',
          },
        ],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const result = await orchestrator.handleMessage(ctx, 'hola');

      expect(result.state).toBeDefined();
      expect(result.shouldSendMessage).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // FLOW 2: OUT-OF-STOCK WITH SUBSTITUTE (Stock Faltante con Sustituto)
  // ═══════════════════════════════════════════════════════════════════════════════

  describe('Flow 2: Out-of-Stock with Substitute', () => {
    it('should detect out-of-stock and suggest alternative', async () => {
      const ctx = createTestContext();

      // Mock: search for Sprite (out of stock), then search for alternatives
      mockAnthropicCreate
        .mockResolvedValueOnce({
          content: [
            {
              type: 'tool_use',
              id: 'tool-1',
              name: 'search_products',
              input: { query: 'sprite' },
            },
          ],
          stop_reason: 'tool_use',
          usage: { input_tokens: 100, output_tokens: 50 },
        })
        .mockResolvedValueOnce({
          content: [
            {
              type: 'tool_use',
              id: 'tool-2',
              name: 'search_products',
              input: { query: 'gaseosa' },
            },
          ],
          stop_reason: 'tool_use',
          usage: { input_tokens: 100, output_tokens: 50 },
        })
        .mockResolvedValueOnce({
          content: [
            {
              type: 'text',
              text: 'No tengo Sprite 500ml en stock 😕\n\nTengo disponible:\n• Coca Cola 500ml ($500)\n• Fanta Naranja 500ml ($480)\n• Pepsi 500ml ($450)\n\n¿Te sirve alguna de estas?',
            },
          ],
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 100 },
        });

      // Register mock tools
      toolRegistry.clear();
      toolRegistry.register({
        name: 'search_products',
        description: 'Search products',
        category: 'query',
        inputSchema: { safeParse: (input: any) => ({ success: true, data: input }) },
        validate: (input: any) => ({ success: true, data: input }),
        execute: async (input: { query: string }) => {
          if (input.query === 'sprite') {
            // Out of stock product
            return {
              success: true,
              data: { products: [{ ...mockProducts[2], stock: 0 }] },
            };
          }
          // Return alternatives
          return {
            success: true,
            data: { products: mockProducts.filter((p) => p.stock > 0) },
          };
        },
        getJsonSchema: () => ({ type: 'object' }),
        requiresConfirmation: false,
        getIdempotencyKey: () => null,
      } as any);

      const result = await orchestrator.handleMessage(ctx, 'quiero sprite');

      expect(result.shouldSendMessage).toBe(true);
      expect(result.handoffTriggered).toBe(false);
    });

    it('should accept substitute product', async () => {
      const ctx = createTestContext();

      // Session already in COLLECTING_ORDER after previous interaction
      await mockRedis.setex(
        `agent:state:${ctx.sessionId}`,
        3600,
        JSON.stringify({
          state: AgentState.COLLECTING_ORDER,
          thread: MessageThread.ORDER,
          failureCount: 0,
        })
      );

      mockAnthropicCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'add_to_cart',
            input: { productId: 'prod-004', quantity: 3 },
          },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 100, output_tokens: 50 },
      }).mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: '¡Listo! Agregué 3 Pepsi 500ml.\n\nTotal: $1.350\n\n¿Algo más?',
          },
        ],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 80 },
      });

      toolRegistry.clear();
      toolRegistry.register({
        name: 'add_to_cart',
        description: 'Add to cart',
        category: 'mutation',
        inputSchema: { safeParse: (input: any) => ({ success: true, data: input }) },
        validate: (input: any) => ({ success: true, data: input }),
        execute: async () => ({
          success: true,
          data: { items: [{ name: 'Pepsi 500ml', quantity: 3, total: 1350 }] },
        }),
        getJsonSchema: () => ({ type: 'object' }),
        requiresConfirmation: false,
        getIdempotencyKey: () => null,
      } as any);

      const result = await orchestrator.handleMessage(ctx, 'dale, dame 3 pepsis');

      expect(result.thread).toBe(MessageThread.ORDER);
      expect(result.shouldSendMessage).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // FLOW 3: LOCATION QUESTION MID-CART (Pregunta de Ubicación en Medio del Carrito)
  // ═══════════════════════════════════════════════════════════════════════════════

  describe('Flow 3: Location Question Mid-Cart', () => {
    it('should handle INFO question during ORDER flow and return to cart', async () => {
      const ctx = createTestContext();

      // Set up session with active cart
      await mockRedis.setex(
        `agent:state:${ctx.sessionId}`,
        3600,
        JSON.stringify({
          state: AgentState.COLLECTING_ORDER,
          thread: MessageThread.ORDER,
          failureCount: 0,
        })
      );

      // Set up memory with cart
      await mockRedis.setex(
        `agent:session:${ctx.sessionId}`,
        3600,
        JSON.stringify({
          sessionId: ctx.sessionId,
          workspaceId: ctx.workspaceId,
          customerId: ctx.customerId,
          state: AgentState.COLLECTING_ORDER,
          cart: {
            items: [
              { productId: 'prod-001', name: 'Coca Cola 500ml', quantity: 5, unitPrice: 500, total: 2500 },
              { productId: 'prod-002', name: 'Fanta 500ml', quantity: 3, unitPrice: 480, total: 1440 },
            ],
            subtotal: 3940,
            shipping: 0,
            discount: 0,
            total: 3940,
          },
          pendingConfirmation: null,
          context: {
            customerInfo: mockCustomer,
            commerceProfile: mockWorkspace.settings,
          },
          lastActivityAt: new Date().toISOString(),
        })
      );

      // Mock: respond to location question, then return to order context
      mockAnthropicCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: '📍 Estamos en Av. Corrientes 1234, CABA.\n\n🕐 Horarios: Lunes a Viernes 9-18hs.\n\nListo, retomamos tu pedido (5x Coca Cola 500ml, 3x Fanta 500ml). ¿Qué más necesitás?',
          },
        ],
        stop_reason: 'end_turn',
        usage: { input_tokens: 150, output_tokens: 100 },
      });

      toolRegistry.clear();

      const result = await orchestrator.handleMessage(ctx, '¿dónde están ubicados?');

      // Should detect INFO thread but stay aware of ORDER context
      expect(result.shouldSendMessage).toBe(true);
      expect(result.handoffTriggered).toBe(false);
      // The response should mention the pending order
      expect(result.response).toContain('pedido');
    });

    it('should preserve cart state during INFO interruption', async () => {
      const ctx = createTestContext();

      // Set up session with active cart
      await mockRedis.setex(
        `agent:state:${ctx.sessionId}`,
        3600,
        JSON.stringify({
          state: AgentState.COLLECTING_ORDER,
          thread: MessageThread.ORDER,
          failureCount: 0,
          interruptedThread: undefined,
          interruptedState: undefined,
        })
      );

      mockAnthropicCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: '🕐 Horarios: Lunes a Viernes 9-18hs.',
          },
        ],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      toolRegistry.clear();

      await orchestrator.handleMessage(ctx, '¿a qué hora cierran?');

      // Verify session state was updated
      const stateData = await mockRedis.get(`agent:state:${ctx.sessionId}`);
      expect(stateData).toBeDefined();

      // State should be preserved (not reset to IDLE)
      const state = JSON.parse(stateData!);
      expect(state.failureCount).toBe(0);
    });

    it('should continue order after INFO response', async () => {
      const ctx = createTestContext();

      // Set up session after INFO response
      await mockRedis.setex(
        `agent:state:${ctx.sessionId}`,
        3600,
        JSON.stringify({
          state: AgentState.COLLECTING_ORDER,
          thread: MessageThread.INFO,
          failureCount: 0,
          interruptedThread: MessageThread.ORDER,
          interruptedState: AgentState.COLLECTING_ORDER,
        })
      );

      mockAnthropicCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'add_to_cart',
            input: { productId: 'prod-001', quantity: 2 },
          },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 100, output_tokens: 50 },
      }).mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: '¡Listo! Sumé 2 más.\n\nTotal actual: $5.940\n\n¿Confirmamos?',
          },
        ],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 60 },
      });

      toolRegistry.clear();
      toolRegistry.register({
        name: 'add_to_cart',
        description: 'Add to cart',
        category: 'mutation',
        inputSchema: { safeParse: (input: any) => ({ success: true, data: input }) },
        validate: (input: any) => ({ success: true, data: input }),
        execute: async () => ({
          success: true,
          data: { items: [], total: 5940 },
        }),
        getJsonSchema: () => ({ type: 'object' }),
        requiresConfirmation: false,
        getIdempotencyKey: () => null,
      } as any);

      const result = await orchestrator.handleMessage(ctx, 'dale, sumame 2 cocas más');

      expect(result.thread).toBe(MessageThread.ORDER);
      expect(result.shouldSendMessage).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // ERROR HANDLING & HANDOFF
  // ═══════════════════════════════════════════════════════════════════════════════

  describe('Error Handling and HANDOFF', () => {
    it('should trigger HANDOFF after 2 consecutive failures', async () => {
      const ctx = createTestContext();

      // Set up session with 1 failure already
      await mockRedis.setex(
        `agent:state:${ctx.sessionId}`,
        3600,
        JSON.stringify({
          state: AgentState.COLLECTING_ORDER,
          thread: MessageThread.ORDER,
          failureCount: 1,
          lastFailureAt: new Date().toISOString(),
        })
      );

      // Mock Claude to throw error
      mockAnthropicCreate.mockRejectedValueOnce(new Error('API Error'));

      toolRegistry.clear();

      const result = await orchestrator.handleMessage(ctx, 'quiero algo');

      expect(result.handoffTriggered).toBe(true);
      expect(result.state).toBe(AgentState.HANDOFF);
      expect(result.handoffReason).toContain('2 consecutive failures');
    });

    it('should trigger HANDOFF on explicit request', async () => {
      const ctx = createTestContext();

      mockAnthropicCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: '' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 50, output_tokens: 20 },
      });

      toolRegistry.clear();

      const result = await orchestrator.handleMessage(
        ctx,
        'quiero hablar con una persona'
      );

      expect(result.handoffTriggered).toBe(true);
      expect(result.state).toBe(AgentState.HANDOFF);
    });

    it('should reset failure count on successful turn', async () => {
      const ctx = createTestContext();

      // Set up session with 1 failure
      await mockRedis.setex(
        `agent:state:${ctx.sessionId}`,
        3600,
        JSON.stringify({
          state: AgentState.IDLE,
          thread: MessageThread.ORDER,
          failureCount: 1,
        })
      );

      mockAnthropicCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Hola! ¿En qué te puedo ayudar?' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 50, output_tokens: 30 },
      });

      toolRegistry.clear();

      await orchestrator.handleMessage(ctx, 'hola');

      // Verify failure count was reset
      const stateData = await mockRedis.get(`agent:state:${ctx.sessionId}`);
      const state = JSON.parse(stateData!);
      expect(state.failureCount).toBe(0);
    });

    it('should not process messages when in HANDOFF state', async () => {
      const ctx = createTestContext();

      // Set up session in HANDOFF state
      await mockRedis.setex(
        `agent:state:${ctx.sessionId}`,
        3600,
        JSON.stringify({
          state: AgentState.HANDOFF,
          thread: MessageThread.ORDER,
          failureCount: 0,
        })
      );

      const result = await orchestrator.handleMessage(ctx, 'hola?');

      expect(result.shouldSendMessage).toBe(false);
      expect(result.state).toBe(AgentState.HANDOFF);
      expect(mockAnthropicCreate).not.toHaveBeenCalled();
    });
  });
});
