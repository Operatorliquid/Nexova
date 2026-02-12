/**
 * Agent Runtime Package
 * AI Retail Agent for Nexova - Handles WhatsApp conversations, orders, and payments
 */

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export * from './types/index.js';

// ═══════════════════════════════════════════════════════════════════════════════
// CORE
// ═══════════════════════════════════════════════════════════════════════════════

export {
  RetailAgent,
  createRetailAgent,
  type AgentConfig,
  type AgentDependencies,
} from './core/agent.js';

export {
  AgentOrchestrator,
  createOrchestrator,
  type OrchestratorConfig,
} from './core/orchestrator.js';

export {
  ConversationRouter,
  conversationRouter,
  classifyMessage,
  type RouterDecision,
} from './core/conversation-router.js';

export {
  StateMachine,
  suggestStateTransition,
} from './core/state-machine.js';

export {
  MemoryManager,
  createMemoryManager,
} from './core/memory-manager.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TOOLS
// ═══════════════════════════════════════════════════════════════════════════════

export {
  BaseTool,
  type ToolConfig,
} from './tools/base.js';

export {
  ToolRegistry,
  toolRegistry,
  type ToolDefinitionForLLM,
} from './tools/registry.js';

export {
  initializeRetailTools,
  createAllRetailTools,
  getToolNamesByCategory,
} from './tools/retail/index.js';

// ═══════════════════════════════════════════════════════════════════════════════
// PROMPTS
// ═══════════════════════════════════════════════════════════════════════════════

export {
  RETAIL_SYSTEM_PROMPT,
  buildRetailSystemPrompt,
  QUICK_ACTION_PROMPT,
} from './prompts/retail-system.js';

// ═══════════════════════════════════════════════════════════════════════════════
// WORKER
// ═══════════════════════════════════════════════════════════════════════════════

export {
  AgentWorker,
  createAgentWorker,
  type WorkerConfig,
} from './worker/agent-worker.js';

// Legacy exports removed - runtime now uses RetailAgent + AgentWorker
