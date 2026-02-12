/**
 * Test Mocks for Agent Runtime
 */
import { vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK DATA
// ═══════════════════════════════════════════════════════════════════════════════

export const mockWorkspace = {
  id: 'ws-test-001',
  name: 'Distribuidora Test',
  slug: 'distribuidora-test',
  settings: {
    address: 'Av. Corrientes 1234, CABA',
    schedule: 'Lunes a Viernes 9-18hs',
    deliveryInfo: 'Envío gratis a partir de $10.000',
    paymentMethods: ['Efectivo', 'MercadoPago', 'Transferencia'],
  },
};

export const mockCustomer = {
  id: 'cust-test-001',
  workspaceId: mockWorkspace.id,
  phone: '+5491155551234',
  firstName: 'Juan',
  lastName: 'Pérez',
  dni: '12345678',
  status: 'active',
};

export const mockSession = {
  id: 'sess-test-001',
  workspaceId: mockWorkspace.id,
  customerId: mockCustomer.id,
  channelId: '+5491155550000',
  channelType: 'whatsapp',
  currentState: 'IDLE',
  agentActive: true,
  endedAt: null,
};

export const mockProducts = [
  {
    id: 'prod-001',
    workspaceId: mockWorkspace.id,
    sku: 'COCA-500',
    name: 'Coca Cola 500ml',
    price: 500,
    stock: 100,
    isActive: true,
  },
  {
    id: 'prod-002',
    workspaceId: mockWorkspace.id,
    sku: 'FANTA-500',
    name: 'Fanta Naranja 500ml',
    price: 480,
    stock: 50,
    isActive: true,
  },
  {
    id: 'prod-003',
    workspaceId: mockWorkspace.id,
    sku: 'SPRITE-500',
    name: 'Sprite 500ml',
    price: 480,
    stock: 0, // Out of stock
    isActive: true,
  },
  {
    id: 'prod-004',
    workspaceId: mockWorkspace.id,
    sku: 'PEPSI-500',
    name: 'Pepsi 500ml',
    price: 450,
    stock: 75,
    isActive: true,
  },
];

function withStockMetadata(product: (typeof mockProducts)[number]) {
  return {
    ...product,
    status: 'active',
    deletedAt: null,
    description: product.name,
    shortDesc: product.name,
    stockItems: [{ quantity: product.stock, reserved: 0 }],
    variants: [],
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK REDIS
// ═══════════════════════════════════════════════════════════════════════════════

export function createMockRedis(): Redis {
  const store = new Map<string, string>();

  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    setex: vi.fn(async (key: string, _ttl: number, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
    exists: vi.fn(async (key: string) => (store.has(key) ? 1 : 0)),
  } as unknown as Redis;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK PRISMA
// ═══════════════════════════════════════════════════════════════════════════════

export function createMockPrisma(): PrismaClient {
  const messages: Array<{
    id: string;
    sessionId: string;
    role: string;
    content: string;
    externalId: string | null;
    createdAt: Date;
  }> = [];

  const auditLogs: Array<Record<string, unknown>> = [];
  const memories: Array<{
    id: string;
    sessionId: string;
    type: string;
    key: string | null;
    content: string;
    importance: number;
    expiresAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }> = [];

  const handoffs: Array<{
    id: string;
    workspaceId: string;
    sessionId: string;
    status: string;
    createdAt: Date;
  }> = [];

  return {
    workspace: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        if (where.id === mockWorkspace.id) return mockWorkspace;
        return null;
      }),
    },
    customer: {
      findUnique: vi.fn(async () => mockCustomer),
      create: vi.fn(async ({ data }: { data: any }) => ({ id: 'new-cust', ...data })),
    },
    product: {
      findMany: vi.fn(async ({ where }: { where: any }) => {
        if (where.name?.contains) {
          const search = where.name.contains.toLowerCase();
          return mockProducts
            .filter((p) => p.name.toLowerCase().includes(search))
            .map(withStockMetadata);
        }
        return mockProducts.map(withStockMetadata);
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const found = mockProducts.find((p) => p.id === where.id);
        return found ? withStockMetadata(found) : null;
      }),
      findFirst: vi.fn(async ({ where }: { where: { id?: string } }) => {
        const found = where.id
          ? mockProducts.find((p) => p.id === where.id)
          : mockProducts[0];
        return found ? withStockMetadata(found) : null;
      }),
    },
    productVariant: {
      findUnique: vi.fn(async () => null),
    },
    agentSession: {
      findFirst: vi.fn(async () => mockSession),
      create: vi.fn(async ({ data }: { data: any }) => ({
        id: 'new-sess',
        ...data,
      })),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: any }) => ({
        ...mockSession,
        ...data,
      })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    agentMessage: {
      findMany: vi.fn(async ({ where }: { where: { sessionId: string } }) => {
        return messages
          .filter((m) => m.sessionId === where.sessionId)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      }),
      findFirst: vi.fn(async ({ where }: { where: { sessionId: string; externalId: string } }) => {
        return messages.find(
          (m) => m.sessionId === where.sessionId && m.externalId === where.externalId
        );
      }),
      count: vi.fn(async ({ where }: { where: { sessionId: string } }) => {
        return messages.filter((m) => m.sessionId === where.sessionId).length;
      }),
      create: vi.fn(async ({ data }: { data: any }) => {
        const msg = {
          id: `msg-${messages.length + 1}`,
          ...data,
          createdAt: new Date(),
        };
        messages.push(msg);
        return msg;
      }),
    },
    agentMemory: {
      findFirst: vi.fn(async ({ where }: { where: any }) => {
        return memories.find(
          (m) =>
            m.sessionId === where.sessionId &&
            m.type === where.type &&
            (where.key ? m.key === where.key : true)
        );
      }),
      findMany: vi.fn(async ({ where, take }: { where: any; take?: number }) => {
        const filtered = memories.filter((m) => m.sessionId === where.sessionId && m.type === where.type);
        return typeof take === 'number' ? filtered.slice(0, take) : filtered;
      }),
      create: vi.fn(async ({ data }: { data: any }) => {
        const memory = {
          id: `mem-${memories.length + 1}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        memories.push(memory);
        return memory;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: any }) => {
        const idx = memories.findIndex((m) => m.id === where.id);
        if (idx >= 0) {
          memories[idx] = { ...memories[idx], ...data, updatedAt: new Date() };
          return memories[idx]!;
        }
        return null;
      }),
    },
    handoffRequest: {
      findFirst: vi.fn(async ({ where }: { where: any }) => {
        return handoffs.find(
          (h) =>
            h.workspaceId === where.workspaceId &&
            h.sessionId === where.sessionId &&
            h.status === where.status
        );
      }),
      create: vi.fn(async ({ data }: { data: any }) => {
        const handoff = {
          id: `handoff-${handoffs.length + 1}`,
          createdAt: new Date(),
          status: 'pending',
          ...data,
        };
        handoffs.push(handoff);
        return handoff;
      }),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    auditLog: {
      create: vi.fn(async ({ data }: { data: any }) => {
        const log = { id: `audit-${auditLogs.length + 1}`, ...data, createdAt: new Date() };
        auditLogs.push(log);
        return log;
      }),
    },
    $queryRaw: vi.fn(async () => [{ '?column?': 1 }]),
  } as unknown as PrismaClient;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK ANTHROPIC RESPONSES
// ═══════════════════════════════════════════════════════════════════════════════

export interface MockAnthropicMessage {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  >;
  stop_reason: 'end_turn' | 'tool_use';
  usage: { input_tokens: number; output_tokens: number };
}

export function createMockAnthropicResponse(
  text: string,
  toolCalls?: Array<{ name: string; input: Record<string, unknown> }>
): MockAnthropicMessage {
  const content: MockAnthropicMessage['content'] = [];

  if (toolCalls && toolCalls.length > 0) {
    for (let i = 0; i < toolCalls.length; i++) {
      content.push({
        type: 'tool_use',
        id: `tool-${i}`,
        name: toolCalls[i]!.name,
        input: toolCalls[i]!.input,
      });
    }
  }

  content.push({ type: 'text', text });

  return {
    content,
    stop_reason: toolCalls && toolCalls.length > 0 ? 'tool_use' : 'end_turn',
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST CONTEXT BUILDER
// ═══════════════════════════════════════════════════════════════════════════════

export function createTestContext(overrides?: Partial<{
  workspaceId: string;
  sessionId: string;
  customerId: string;
  channelId: string;
  messageId: string;
  correlationId: string;
}>) {
  return {
    workspaceId: mockWorkspace.id,
    sessionId: mockSession.id,
    customerId: mockCustomer.id,
    channelId: '+5491155550000',
    channelType: 'whatsapp' as const,
    messageId: `msg-${Date.now()}`,
    correlationId: `corr-${Date.now()}`,
    ...overrides,
  };
}
