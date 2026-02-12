import { describe, it, expect } from 'vitest';
import { RetailAgent } from '../../src/core/agent.js';
import { StateMachine } from '../../src/core/state-machine.js';
import { AgentState, type SessionMemory } from '../../src/types/index.js';
import { createMockPrisma, createMockRedis } from './mocks.js';

function buildMemory(): SessionMemory {
  return {
    sessionId: 'sess-test-001',
    workspaceId: 'ws-test-001',
    customerId: 'cust-test-001',
    state: AgentState.IDLE,
    cart: null,
    pendingConfirmation: null,
    context: {
      customerInfo: null,
    },
    lastActivityAt: new Date(),
  };
}

describe('RetailAgent mode resolution', () => {
  const prisma = createMockPrisma();
  const redis = createMockRedis();
  const agent = new RetailAgent(prisma, redis, { anthropicApiKey: 'test-key' });

  it('routes to payments mode on payment intent', () => {
    const memory = buildMemory();
    const fsm = new StateMachine(AgentState.IDLE);
    const mode = (agent as any).resolveAgentMode('quiero pagar con transferencia', memory, fsm, true);
    expect(mode).toBe('payments');
  });

  it('routes to info mode on info intent', () => {
    const memory = buildMemory();
    const fsm = new StateMachine(AgentState.IDLE);
    const mode = (agent as any).resolveAgentMode('¿a qué hora abren?', memory, fsm, true);
    expect(mode).toBe('info');
  });

  it('routes to order mode by default', () => {
    const memory = buildMemory();
    const fsm = new StateMachine(AgentState.IDLE);
    const mode = (agent as any).resolveAgentMode('quiero 3 cocas', memory, fsm, true);
    expect(mode).toBe('order');
  });
});
