import { afterEach, describe, expect, it } from 'vitest';

import { ToolRegistry } from '../../src/tools/registry.js';
import { AgentState, ToolCategory, type ToolContext } from '../../src/types/index.js';

const context: ToolContext = {
  workspaceId: 'workspace-1',
  sessionId: 'session-1',
  customerId: 'customer-1',
  correlationId: 'corr-1',
  currentState: AgentState.IDLE,
  channelType: 'whatsapp',
};

const originalTimeout = process.env.AGENT_TOOL_TIMEOUT_MS;

afterEach(() => {
  if (originalTimeout === undefined) {
    delete process.env.AGENT_TOOL_TIMEOUT_MS;
  } else {
    process.env.AGENT_TOOL_TIMEOUT_MS = originalTimeout;
  }
});

describe('ToolRegistry guardrails', () => {
  it('normalizes locale numeric strings before validation', async () => {
    const registry = new ToolRegistry();
    let receivedAmount: unknown;

    registry.register({
      name: 'test_numeric_amount',
      description: 'Test numeric normalization',
      category: ToolCategory.MUTATION,
      requiresConfirmation: false,
      validate: (input: unknown) => {
        const payload = (input || {}) as Record<string, unknown>;
        receivedAmount = payload.amount;
        if (typeof payload.amount === 'number') {
          return { success: true, data: payload };
        }
        return { success: false, error: 'amount must be number' };
      },
      execute: async () => ({ success: true, data: { ok: true } }),
      getIdempotencyKey: () => null,
      getJsonSchema: () => ({ type: 'object' }),
    } as any);

    const result = await registry.execute(
      'test_numeric_amount',
      { amount: '30.000' },
      context
    );

    expect(result.result.success).toBe(true);
    expect(receivedAmount).toBe(30000);
  });

  it('normalizes boolean and comma-separated list values', async () => {
    const registry = new ToolRegistry();
    let receivedNotify: unknown;
    let receivedNames: unknown;

    registry.register({
      name: 'test_boolean_and_array',
      description: 'Test boolean and array normalization',
      category: ToolCategory.MUTATION,
      requiresConfirmation: false,
      validate: (input: unknown) => {
        const payload = (input || {}) as Record<string, unknown>;
        receivedNotify = payload.notifyCustomer;
        receivedNames = payload.productNames;
        if (typeof payload.notifyCustomer === 'boolean' && Array.isArray(payload.productNames)) {
          return { success: true, data: payload };
        }
        return { success: false, error: 'invalid normalized payload' };
      },
      execute: async () => ({ success: true, data: { ok: true } }),
      getIdempotencyKey: () => null,
      getJsonSchema: () => ({ type: 'object' }),
    } as any);

    const result = await registry.execute(
      'test_boolean_and_array',
      {
        notifyCustomer: 'si',
        productNames: 'Coca, Sprite,  Agua',
      },
      context
    );

    expect(result.result.success).toBe(true);
    expect(receivedNotify).toBe(true);
    expect(receivedNames).toEqual(['Coca', 'Sprite', 'Agua']);
  });

  it('returns timeout error when tool execution exceeds limit', async () => {
    process.env.AGENT_TOOL_TIMEOUT_MS = '20';

    const registry = new ToolRegistry();
    registry.register({
      name: 'test_tool_timeout',
      description: 'Test timeout',
      category: ToolCategory.QUERY,
      requiresConfirmation: false,
      validate: (input: unknown) => ({ success: true, data: (input || {}) as Record<string, unknown> }),
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 120));
        return { success: true, data: { slow: true } };
      },
      getIdempotencyKey: () => null,
      getJsonSchema: () => ({ type: 'object' }),
    } as any);

    const result = await registry.execute(
      'test_tool_timeout',
      {},
      context
    );

    expect(result.result.success).toBe(false);
    expect(result.result.error).toContain("exceeded execution timeout");
  });
});
