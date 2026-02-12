import fs from 'node:fs';
import path from 'node:path';
import { RetailAgent } from '../packages/agent-runtime/src/core/agent.js';
import { StateMachine } from '../packages/agent-runtime/src/core/state-machine.js';
import { AgentState, type SessionMemory } from '../packages/agent-runtime/src/types/index.js';
import { createMockPrisma, createMockRedis } from '../packages/agent-runtime/test/unit/mocks.js';

const casesDir = path.resolve(process.cwd(), 'docs/evals/cases');
const files = fs.readdirSync(casesDir).filter((f) => f.endsWith('.json'));

function buildMemory(): SessionMemory {
  return {
    sessionId: 'sess-eval',
    workspaceId: 'ws-eval',
    customerId: 'cust-eval',
    state: AgentState.IDLE,
    cart: null,
    pendingConfirmation: null,
    context: { customerInfo: null },
    lastActivityAt: new Date(),
  };
}

const prisma = createMockPrisma();
const redis = createMockRedis();
const agent = new RetailAgent(prisma, redis, { anthropicApiKey: 'test-key' });

let failed = 0;

for (const file of files) {
  const content = fs.readFileSync(path.join(casesDir, file), 'utf-8');
  const testCase = JSON.parse(content) as {
    id: string;
    description?: string;
    messages: Array<{ role: string; content: string }>;
    expect?: { mode?: string };
  };

  const firstUser = testCase.messages.find((m) => m.role === 'user');
  if (!firstUser) continue;

  const mode = (agent as any).resolveAgentMode(
    firstUser.content,
    buildMemory(),
    new StateMachine(AgentState.IDLE),
    true
  ) as string;

  const expected = testCase.expect?.mode;
  const ok = !expected || expected === mode;

  if (!ok) failed += 1;
  const status = ok ? 'OK' : 'FAIL';
  console.log(`[${status}] ${testCase.id} -> mode=${mode}${expected ? ` (expected ${expected})` : ''}`);
}

if (failed > 0) {
  console.error(`\n${failed} casos fallaron.`);
  process.exit(1);
}
