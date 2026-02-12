/**
 * Tool Registry
 * Manages available tools for the agent
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { BaseTool } from './base.js';
import { ToolContext, ToolExecution, ToolCategory, ToolResult, ToolCategoryType } from '../types/index.js';
import { MemoryManager } from '../core/memory-manager.js';

const SENSITIVE_KEY_PATTERN =
  /(password|token|secret|apiKey|apikey|accessToken|refreshToken|authorization|email|phone|dni|document|address|cbu|alias|account|card|cvv|cvc|iban|bank)/i;
const MAX_STRING_LENGTH = 500;
const MAX_ARRAY_LENGTH = 20;
const MAX_DEPTH = 4;

function truncateString(value: string, maxLength = MAX_STRING_LENGTH): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}…`;
}

function sanitizePayload(value: unknown, depth = 0, key?: string): unknown {
  if (value === undefined) return undefined;
  if (key && SENSITIVE_KEY_PATTERN.test(key)) {
    return '[REDACTED]';
  }

  if (value === null) return null;

  if (typeof value === 'string') return truncateString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return '[Function]';
  if (typeof value === 'symbol') return value.toString();

  if (depth >= MAX_DEPTH) {
    return '[MaxDepth]';
  }

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_LENGTH).map((item) => sanitizePayload(item, depth + 1));
    if (value.length > MAX_ARRAY_LENGTH) {
      items.push(`[+${value.length - MAX_ARRAY_LENGTH} more]`);
    }
    return items;
  }

  if (typeof value === 'object' && value && typeof (value as { toJSON?: () => unknown }).toJSON === 'function') {
    try {
      const jsonValue = (value as { toJSON: () => unknown }).toJSON();
      return sanitizePayload(jsonValue, depth + 1, key);
    } catch {
      // Fall through to object handling
    }
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      const sanitized = sanitizePayload(childValue, depth + 1, childKey);
      if (sanitized !== undefined) {
        result[childKey] = sanitized;
      }
    }
    return result;
  }

  return String(value);
}

function buildResultData(result: ToolResult): Record<string, unknown> | null {
  const summary: Record<string, unknown> = {};

  if (result.data !== undefined) {
    summary.data = sanitizePayload(result.data, 0);
  }
  if (result.stateTransition) {
    summary.stateTransition = result.stateTransition;
  }
  if (typeof result.requiresConfirmation === 'boolean') {
    summary.requiresConfirmation = result.requiresConfirmation;
  }
  if (result.confirmationMessage) {
    summary.confirmationMessage = truncateString(result.confirmationMessage, 300);
  }

  return Object.keys(summary).length > 0 ? summary : null;
}

export interface ToolDefinitionForLLM {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export class ToolRegistry {
  private tools: Map<string, BaseTool<any, any>> = new Map();
  private memoryManager?: MemoryManager;
  private prisma?: PrismaClient;

  /**
   * Set memory manager for idempotency checks
   */
  setMemoryManager(manager: MemoryManager): void {
    this.memoryManager = manager;
  }

  /**
   * Set Prisma client for tool execution logging
   */
  setPrisma(prisma: PrismaClient): void {
    this.prisma = prisma;
  }

  private async recordToolExecution(params: {
    context: ToolContext;
    toolName: string;
    toolCategory: ToolCategoryType;
    inputParams: Record<string, unknown>;
    validationStatus: 'passed' | 'failed';
    validationErrors?: unknown;
    confirmationRequired: boolean;
    resultStatus: 'success' | 'error' | 'timeout' | 'cancelled';
    result: ToolResult;
    durationMs: number;
    errorCode?: string;
  }): Promise<void> {
    if (!this.prisma) return;
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) return;

    try {
      const resultData = buildResultData(params.result);

      await this.prisma.agentToolExecution.create({
        data: {
          sessionId: params.context.sessionId,
          correlationId: params.context.correlationId,
          toolName: params.toolName,
          toolCategory: params.toolCategory,
          inputParams: sanitizePayload(params.inputParams, 0) as Prisma.InputJsonValue,
          validationStatus: params.validationStatus,
          validationErrors: params.validationErrors
            ? sanitizePayload(params.validationErrors, 0) as Prisma.InputJsonValue
            : undefined,
          confirmationRequired: params.confirmationRequired,
          confirmed: null,
          resultStatus: params.resultStatus,
          resultData: resultData ? (resultData as Prisma.InputJsonValue) : undefined,
          errorMessage: params.result.success ? null : params.result.error || null,
          errorCode: params.errorCode || null,
          durationMs: params.durationMs,
          llmModel: null,
          tokensUsed: null,
        },
      });
    } catch (error) {
      console.error('[ToolRegistry] Failed to record tool execution:', error);
    }
  }

  /**
   * Register a tool
   */
  register(tool: BaseTool<any, any>): void {
    const shouldLog = !(process.env.NODE_ENV === 'test' || process.env.VITEST);
    if (this.tools.has(tool.name)) {
      if (shouldLog) {
        console.warn(`[ToolRegistry] Overwriting tool: ${tool.name}`);
      }
    }
    this.tools.set(tool.name, tool);
    if (shouldLog) {
      console.log(`[ToolRegistry] Registered tool: ${tool.name} (${tool.category})`);
    }
  }

  /**
   * Register multiple tools
   */
  registerAll(tools: BaseTool<any, any>[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * Get a tool by name
   */
  get(name: string): BaseTool<any, any> | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all registered tools
   */
  getAll(): BaseTool<any, any>[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tools in Claude format
   */
  getToolDefinitions(): ToolDefinitionForLLM[] {
    return this.getAll().map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.getJsonSchema(),
    }));
  }

  /**
   * Get only query tools (safe, read-only)
   */
  getQueryTools(): ToolDefinitionForLLM[] {
    return this.getAll()
      .filter((tool) => tool.category === ToolCategory.QUERY)
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.getJsonSchema(),
      }));
  }

  /**
   * Execute a tool by name
   */
  async execute(
    name: string,
    input: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolExecution> {
    const startTime = Date.now();
    const tool = this.get(name);

    if (!tool) {
      const execution: ToolExecution = {
        correlationId: context.correlationId,
        toolName: name,
        category: ToolCategory.SYSTEM,
        input,
        result: {
          success: false,
          error: `Tool '${name}' not found`,
        },
        durationMs: Date.now() - startTime,
        validationPassed: false,
      };

      await this.recordToolExecution({
        context,
        toolName: name,
        toolCategory: ToolCategory.SYSTEM,
        inputParams: input,
        validationStatus: 'failed',
        validationErrors: { message: `Tool '${name}' not found` },
        confirmationRequired: false,
        resultStatus: 'error',
        result: execution.result,
        durationMs: execution.durationMs,
      });

      return execution;
    }

    // Validate input
    const validation = tool.validate(input);
    if (!validation.success) {
      const execution: ToolExecution = {
        correlationId: context.correlationId,
        toolName: name,
        category: tool.category,
        input,
        result: {
          success: false,
          error: `Validation failed: ${validation.error}`,
        },
        durationMs: Date.now() - startTime,
        validationPassed: false,
      };

      await this.recordToolExecution({
        context,
        toolName: name,
        toolCategory: tool.category,
        inputParams: input,
        validationStatus: 'failed',
        validationErrors: { message: validation.error },
        confirmationRequired: tool.requiresConfirmation,
        resultStatus: 'error',
        result: execution.result,
        durationMs: execution.durationMs,
      });

      return execution;
    }

    // Check idempotency
    const idempotencyKey = tool.getIdempotencyKey(validation.data);
    if (idempotencyKey && this.memoryManager) {
      const alreadyExecuted = await this.memoryManager.checkIdempotency(idempotencyKey);
      if (alreadyExecuted) {
        const execution: ToolExecution = {
          correlationId: context.correlationId,
          toolName: name,
          category: tool.category,
          input,
          result: {
            success: true,
            data: { message: 'Operation already executed (idempotency)' },
          },
          durationMs: Date.now() - startTime,
          validationPassed: true,
        };

        await this.recordToolExecution({
          context,
          toolName: name,
          toolCategory: tool.category,
          inputParams: validation.data,
          validationStatus: 'passed',
          confirmationRequired: tool.requiresConfirmation,
          resultStatus: 'success',
          result: execution.result,
          durationMs: execution.durationMs,
        });

        return execution;
      }
    }

    // Execute tool
    try {
      const result = await tool.execute(validation.data, context);

      // Mark as executed for idempotency
      if (idempotencyKey && this.memoryManager && result.success) {
        await this.memoryManager.setIdempotency(idempotencyKey);
      }

      const execution: ToolExecution = {
        correlationId: context.correlationId,
        toolName: name,
        category: tool.category,
        input: validation.data,
        result,
        durationMs: Date.now() - startTime,
        validationPassed: true,
      };

      await this.recordToolExecution({
        context,
        toolName: name,
        toolCategory: tool.category,
        inputParams: validation.data,
        validationStatus: 'passed',
        confirmationRequired: tool.requiresConfirmation,
        resultStatus: result.success ? 'success' : 'error',
        result,
        durationMs: execution.durationMs,
      });

      return execution;
    } catch (error) {
      console.error(`[ToolRegistry] Tool execution failed: ${name}`, error);
      const execution: ToolExecution = {
        correlationId: context.correlationId,
        toolName: name,
        category: tool.category,
        input: validation.data,
        result: {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        durationMs: Date.now() - startTime,
        validationPassed: true,
      };

      await this.recordToolExecution({
        context,
        toolName: name,
        toolCategory: tool.category,
        inputParams: validation.data,
        validationStatus: 'passed',
        confirmationRequired: tool.requiresConfirmation,
        resultStatus: 'error',
        result: execution.result,
        durationMs: execution.durationMs,
        errorCode: error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string'
          ? (error as { code?: string }).code
          : undefined,
      });

      return execution;
    }
  }

  /**
   * Check if tool requires confirmation
   */
  requiresConfirmation(name: string): boolean {
    const tool = this.get(name);
    return tool?.requiresConfirmation ?? false;
  }

  /**
   * Clear all tools
   */
  clear(): void {
    this.tools.clear();
  }
}

// Singleton instance
export const toolRegistry = new ToolRegistry();
