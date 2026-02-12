import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RetailAgent } from '../../src/core/agent.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { createMockPrisma, createMockRedis, mockWorkspace, mockCustomer, mockSession } from './mocks.js';

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

describe('Owner mode confirmations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses owner focus context to avoid asking again (fills tool input)', async () => {
    const mockPrisma = createMockPrisma();
    const mockRedis = createMockRedis();

    const AnthropicModule = await import('@anthropic-ai/sdk');
    const Anthropic = vi.mocked(AnthropicModule.default);
    const mockAnthropicCreate = vi.fn();
    (Anthropic as any).mockImplementation(() => ({
      messages: {
        create: mockAnthropicCreate,
      },
    }));

    const agent = new RetailAgent(mockPrisma as any, mockRedis as any, { anthropicApiKey: 'test-key' });

    // Skip full initialization (retail tool bootstrap) for unit test.
    (agent as any).initialized = true;

    // Keep owner prompt context minimal.
    (agent as any).memoryService = {
      buildContext: vi.fn(async () => ''),
    };

    // Seed focus context in Redis-backed session memory.
    const memoryManager = (agent as any).memoryManager;
    await memoryManager.initSession(mockSession.id, mockWorkspace.id, mockCustomer.id);
    const memory = await memoryManager.getSession(mockSession.id);
    memory.context.ownerFocus = {
      customerId: 'cust-focus-001',
      customerPhone: '+5491100000000',
      customerName: 'Jose Stratta',
      orderNumber: 'ORD-00029',
      updatedAt: new Date().toISOString(),
    };
    await memoryManager.saveSession(memory);

    const registry = new ToolRegistry();
    registry.setMemoryManager(memoryManager);
    registry.setPrisma(mockPrisma as any);

    const toolExecute = vi.fn(async (input: any) => ({
      success: true,
      data: { ok: true, received: input },
    }));

    registry.register({
      name: 'admin_send_debt_reminder',
      description: 'Send debt reminder (test)',
      category: 'mutation',
      inputSchema: { safeParse: (v: any) => ({ success: true, data: v }) },
      validate: (v: any) => ({ success: true, data: v }),
      execute: toolExecute,
      getJsonSchema: () => ({ type: 'object' }),
      requiresConfirmation: false,
      getIdempotencyKey: () => null,
    } as any);

    (agent as any).ownerToolRegistry = registry;

    // Claude: tool_use without specifying customer/order.
    mockAnthropicCreate
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'admin_send_debt_reminder',
            input: {},
          },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Listo, recordatorio enviado.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      });

    const result = await agent.processMessage({
      workspaceId: mockWorkspace.id,
      sessionId: mockSession.id,
      customerId: mockCustomer.id,
      channelId: mockSession.channelId,
      channelType: 'whatsapp',
      message: 'Envíale su deuda',
      messageId: 'msg-001',
      correlationId: '00000000-0000-0000-0000-000000000010',
      isOwner: true,
    });

    expect(toolExecute).toHaveBeenCalledTimes(1);
    expect(toolExecute.mock.calls[0]?.[0]).toMatchObject({
      customerId: 'cust-focus-001',
    });
    expect(result.response).toContain('Listo');
  });

  it('asks confirmation for owner mutations and executes after yes', async () => {
    const mockPrisma = createMockPrisma();
    const mockRedis = createMockRedis();

    const AnthropicModule = await import('@anthropic-ai/sdk');
    const Anthropic = vi.mocked(AnthropicModule.default);
    const mockAnthropicCreate = vi.fn();
    (Anthropic as any).mockImplementation(() => ({
      messages: {
        create: mockAnthropicCreate,
      },
    }));

    const agent = new RetailAgent(mockPrisma as any, mockRedis as any, { anthropicApiKey: 'test-key' });

    // Skip full initialization (retail tool bootstrap) for unit test.
    (agent as any).initialized = true;

    // Keep owner prompt context minimal.
    (agent as any).memoryService = {
      buildContext: vi.fn(async () => ''),
    };

    const registry = new ToolRegistry();
    registry.setMemoryManager((agent as any).memoryManager);
    registry.setPrisma(mockPrisma as any);

    const toolExecute = vi.fn(async () => ({
      success: true,
      data: { message: 'pedido creado' },
    }));

    registry.register({
      name: 'admin_create_order',
      description: 'Create order (test)',
      category: 'mutation',
      inputSchema: { safeParse: (v: any) => ({ success: true, data: v }) },
      validate: (v: any) => ({ success: true, data: v }),
      execute: toolExecute,
      getJsonSchema: () => ({ type: 'object' }),
      requiresConfirmation: true,
      getIdempotencyKey: () => null,
    } as any);

    (agent as any).ownerToolRegistry = registry;

    mockAnthropicCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'admin_create_order',
          input: {
            customerPhone: '+5491112345678',
            items: [{ productId: 'prod-001', quantity: 1 }],
          },
        },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const first = await agent.processMessage({
      workspaceId: mockWorkspace.id,
      sessionId: mockSession.id,
      customerId: mockCustomer.id,
      channelId: mockSession.channelId,
      channelType: 'whatsapp',
      message: 'crea un pedido para +5491112345678',
      messageId: 'msg-001',
      correlationId: '00000000-0000-0000-0000-000000000001',
      isOwner: true,
    });

    expect(first.response.toLowerCase()).toContain('confirm');
    expect(toolExecute).not.toHaveBeenCalled();

    const second = await agent.processMessage({
      workspaceId: mockWorkspace.id,
      sessionId: mockSession.id,
      customerId: mockCustomer.id,
      channelId: mockSession.channelId,
      channelType: 'whatsapp',
      message: 'si',
      messageId: 'msg-002',
      correlationId: '00000000-0000-0000-0000-000000000002',
      isOwner: true,
    });

    expect(toolExecute).toHaveBeenCalledTimes(1);
    expect(second.response).toContain('pedido creado');
  });

  it('uses product name (not productId) in adjust_stock confirmation', async () => {
    const mockPrisma = createMockPrisma();
    const mockRedis = createMockRedis();

    const AnthropicModule = await import('@anthropic-ai/sdk');
    const Anthropic = vi.mocked(AnthropicModule.default);
    const mockAnthropicCreate = vi.fn();
    (Anthropic as any).mockImplementation(() => ({
      messages: {
        create: mockAnthropicCreate,
      },
    }));

    const agent = new RetailAgent(mockPrisma as any, mockRedis as any, { anthropicApiKey: 'test-key' });

    // Skip full initialization (retail tool bootstrap) for unit test.
    (agent as any).initialized = true;

    // Keep owner prompt context minimal.
    (agent as any).memoryService = {
      buildContext: vi.fn(async () => ''),
    };

    const registry = new ToolRegistry();
    registry.setMemoryManager((agent as any).memoryManager);
    registry.setPrisma(mockPrisma as any);

    registry.register({
      name: 'adjust_stock',
      description: 'Adjust stock (test)',
      category: 'mutation',
      inputSchema: { safeParse: (v: any) => ({ success: true, data: v }) },
      validate: (v: any) => ({ success: true, data: v }),
      execute: vi.fn(async () => ({ success: true, data: { message: 'ok' } })),
      getJsonSchema: () => ({ type: 'object' }),
      requiresConfirmation: true,
      getIdempotencyKey: () => null,
    } as any);

    (agent as any).ownerToolRegistry = registry;

    mockAnthropicCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'adjust_stock',
          input: {
            productId: 'prod-001',
            quantity: 10,
          },
        },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const first = await agent.processMessage({
      workspaceId: mockWorkspace.id,
      sessionId: mockSession.id,
      customerId: mockCustomer.id,
      channelId: mockSession.channelId,
      channelType: 'whatsapp',
      message: 'agrega 10 unidades a coca',
      messageId: 'msg-001',
      correlationId: '00000000-0000-0000-0000-000000000001',
      isOwner: true,
    });

    expect(first.response).toContain('Confirm');
    expect(first.response).toContain('Coca');
    expect(first.response).not.toContain('prod-001');
  });
});
