/**
 * Tool Registry
 * Manages available tools for the agent
 */
import { type Prisma, type PrismaClient } from '@prisma/client';
import type { z } from 'zod';

import { type BaseTool } from './base.js';
import { type MemoryManager } from '../core/memory-manager.js';
import { type ToolContext, type ToolExecution, ToolCategory, type ToolResult, type ToolCategoryType } from '../types/index.js';

const SENSITIVE_KEY_PATTERN =
  /(password|token|secret|apiKey|apikey|accessToken|refreshToken|authorization|email|phone|dni|document|address|cbu|alias|account|card|cvv|cvc|iban|bank)/i;
const MAX_STRING_LENGTH = 500;
const MAX_ARRAY_LENGTH = 20;
const MAX_DEPTH = 4;
const MAX_INPUT_NORMALIZATION_DEPTH = 6;
const DEFAULT_TOOL_TIMEOUT_MS = 25000;

const NUMERIC_INPUT_KEYS = new Set([
  'amount',
  'quantity',
  'percent',
  'price',
  'unitprice',
  'subtotal',
  'total',
  'discount',
  'shipping',
  'pendingamount',
  'limit',
  'offset',
  'page',
  'stock',
  'available',
  'requested',
  'days',
  'hours',
  'minutes',
  'seconds',
  'ttlseconds',
  'durationdays',
]);

const BOOLEAN_INPUT_KEYS = new Set([
  'active',
  'enabled',
  'notifycustomer',
  'includeoutofstock',
  'onlyinstock',
  'strict',
  'confirmed',
  'approved',
  'mp',
  'mplink',
  'transfer',
  'cash',
]);

const ARRAY_INPUT_KEYS = new Set([
  'productnames',
  'orderids',
  'customerids',
  'tags',
  'keywords',
  'phones',
  'ids',
]);

const PHONE_INPUT_KEYS = new Set([
  'phone',
  'customerphone',
  'senderphone',
  'whatsappcontact',
  'contactphone',
]);

class ToolTimeoutError extends Error {
  code = 'TOOL_TIMEOUT';

  constructor(toolName: string, timeoutMs: number) {
    super(`Tool '${toolName}' timed out after ${timeoutMs}ms`);
    this.name = 'ToolTimeoutError';
  }
}

function resolveToolTimeoutMs(): number {
  const raw = Number.parseInt(process.env.AGENT_TOOL_TIMEOUT_MS || `${DEFAULT_TOOL_TIMEOUT_MS}`, 10);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_TOOL_TIMEOUT_MS;
  return raw;
}

function normalizePhoneValue(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 8) return value;
  return `+${digits}`;
}

function normalizeOrderNumberValue(value: string): string {
  const normalized = value.trim().toUpperCase();
  const match = normalized.match(/^ORD[\s-]*(\d{1,20})$/);
  if (!match?.[1]) return normalized;
  return `ORD-${match[1]}`;
}

function parseBooleanValue(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (['true', '1', 'yes', 'si', 'sí', 'ok'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;
  return null;
}

function parseLocaleNumber(value: string): number | null {
  const compact = value.replace(/\s+/g, '');
  if (!compact || !/^[+-]?\d[\d.,]*$/.test(compact)) return null;

  const sign = compact.startsWith('-') ? -1 : 1;
  const unsigned = compact.replace(/^[+-]/, '');
  const commaCount = (unsigned.match(/,/g) || []).length;
  const dotCount = (unsigned.match(/\./g) || []).length;

  let normalized = unsigned;
  if (commaCount > 0 && dotCount > 0) {
    const lastComma = unsigned.lastIndexOf(',');
    const lastDot = unsigned.lastIndexOf('.');
    const decimalSep = lastComma > lastDot ? ',' : '.';
    const thousandsSep = decimalSep === ',' ? '.' : ',';
    const parts = unsigned.split(decimalSep);
    const fractional = parts[parts.length - 1] || '';
    if (fractional.length > 0 && fractional.length <= 2) {
      normalized = unsigned.split(thousandsSep).join('').replace(decimalSep, '.');
    } else {
      normalized = unsigned.replace(/[.,]/g, '');
    }
  } else if (commaCount > 0) {
    const parts = unsigned.split(',');
    const fractional = parts[parts.length - 1] || '';
    if (parts.length === 2 && fractional.length > 0 && fractional.length <= 2) {
      normalized = `${parts[0]}.${fractional}`;
    } else {
      normalized = unsigned.replace(/,/g, '');
    }
  } else if (dotCount > 0) {
    const parts = unsigned.split('.');
    const fractional = parts[parts.length - 1] || '';
    if (!(parts.length === 2 && fractional.length > 0 && fractional.length <= 2)) {
      normalized = unsigned.replace(/\./g, '');
    }
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return sign * parsed;
}

function shouldTreatAsNumericKey(key: string): boolean {
  if (NUMERIC_INPUT_KEYS.has(key)) return true;
  return /(amount|price|quantity|percent|subtotal|total|discount|shipping|stock|limit|offset|page|days|hours|minutes|seconds)$/.test(
    key
  );
}

function shouldTreatAsBooleanKey(key: string): boolean {
  if (BOOLEAN_INPUT_KEYS.has(key)) return true;
  return /^(is|has|should|can|allow|enable|enabled)/.test(key);
}

function shouldTreatAsArrayKey(key: string): boolean {
  return ARRAY_INPUT_KEYS.has(key) || /(ids|names|tags|keywords)$/.test(key);
}

function normalizeScalarByKey(value: string, key?: string): unknown {
  const trimmed = value.trim();
  if (!key) return trimmed;

  if (key === 'ordernumber') {
    return normalizeOrderNumberValue(trimmed);
  }

  if (PHONE_INPUT_KEYS.has(key)) {
    return normalizePhoneValue(trimmed);
  }

  if (shouldTreatAsBooleanKey(key)) {
    const boolValue = parseBooleanValue(trimmed);
    if (boolValue !== null) return boolValue;
  }

  if (shouldTreatAsNumericKey(key)) {
    const numberValue = parseLocaleNumber(trimmed);
    if (numberValue !== null) return numberValue;
  }

  if (shouldTreatAsArrayKey(key) && trimmed.includes(',')) {
    return trimmed
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  return trimmed;
}

function normalizeToolInputValue(value: unknown, key?: string, depth = 0): unknown {
  if (depth >= MAX_INPUT_NORMALIZATION_DEPTH) return value;
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    return normalizeScalarByKey(value, key);
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeToolInputValue(item, key, depth + 1));
  }

  if (typeof value === 'object') {
    const normalized: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      const keyNormalized = childKey.trim().toLowerCase();
      normalized[childKey] = normalizeToolInputValue(childValue, keyNormalized, depth + 1);
    }
    return normalized;
  }

  return value;
}

function normalizeToolInput(input: Record<string, unknown>): Record<string, unknown> {
  const normalized = normalizeToolInputValue(input, undefined, 0);
  if (normalized && typeof normalized === 'object' && !Array.isArray(normalized)) {
    return normalized as Record<string, unknown>;
  }
  return input;
}

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

function asInputRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export interface ToolDefinitionForLLM {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export class ToolRegistry {
  private tools: Map<string, BaseTool<z.ZodSchema, unknown>> = new Map();
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

  private async executeWithTimeout<T>(
    toolName: string,
    executor: () => Promise<T>
  ): Promise<T> {
    const timeoutMs = resolveToolTimeoutMs();
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return executor();
    }

    let timer: NodeJS.Timeout | null = null;
    try {
      return await new Promise<T>((resolve, reject) => {
        timer = setTimeout(() => reject(new ToolTimeoutError(toolName, timeoutMs)), timeoutMs);
        void executor().then(resolve).catch(reject);
      });
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
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
  register(tool: BaseTool<z.ZodSchema, unknown>): void {
    const shouldLog = !(process.env.NODE_ENV === 'test' || process.env.VITEST);
    if (this.tools.has(tool.name)) {
      if (shouldLog) {
        console.warn(`[ToolRegistry] Overwriting tool: ${tool.name}`);
      }
    }
    this.tools.set(tool.name, tool);
    if (shouldLog) {
      console.warn(`[ToolRegistry] Registered tool: ${tool.name} (${tool.category})`);
    }
  }

  /**
   * Register multiple tools
   */
  registerAll(tools: BaseTool<z.ZodSchema, unknown>[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * Get a tool by name
   */
  get(name: string): BaseTool<z.ZodSchema, unknown> | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all registered tools
   */
  getAll(): BaseTool<z.ZodSchema, unknown>[] {
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

    const normalizedInput = normalizeToolInput(input);

    // Validate input (normalized first, raw fallback)
    const normalizedValidation = tool.validate(normalizedInput);
    const rawValidation = normalizedValidation.success ? null : tool.validate(input);
    const validation = normalizedValidation.success
      ? normalizedValidation
      : rawValidation && rawValidation.success
        ? rawValidation
        : normalizedValidation;
    const inputForValidation = normalizedValidation.success ? normalizedInput : input;

    if (!validation.success) {
      const execution: ToolExecution = {
        correlationId: context.correlationId,
        toolName: name,
        category: tool.category,
        input: inputForValidation,
        result: {
          success: false,
          error:
            rawValidation && !rawValidation.success && rawValidation.error !== validation.error
              ? `Validation failed: ${validation.error} (raw: ${rawValidation.error})`
              : `Validation failed: ${validation.error}`,
        },
        durationMs: Date.now() - startTime,
        validationPassed: false,
      };

      await this.recordToolExecution({
        context,
        toolName: name,
        toolCategory: tool.category,
        inputParams: inputForValidation,
        validationStatus: 'failed',
        validationErrors: {
          normalizedError: validation.error,
          ...(rawValidation && !rawValidation.success ? { rawError: rawValidation.error } : {}),
        },
        confirmationRequired: tool.requiresConfirmation,
        resultStatus: 'error',
        result: execution.result,
        durationMs: execution.durationMs,
      });

      return execution;
    }

    // Check idempotency
    const idempotencyKey = tool.getIdempotencyKey(validation.data);
    const validatedInput = asInputRecord(validation.data);
    if (idempotencyKey && this.memoryManager) {
      const alreadyExecuted = await this.memoryManager.checkIdempotency(idempotencyKey);
      if (alreadyExecuted) {
        const execution: ToolExecution = {
          correlationId: context.correlationId,
          toolName: name,
          category: tool.category,
          input: validatedInput,
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
          inputParams: validatedInput,
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
      const result = await this.executeWithTimeout(name, () =>
        tool.execute(validation.data, context)
      );

      // Mark as executed for idempotency
      if (idempotencyKey && this.memoryManager && result.success) {
        await this.memoryManager.setIdempotency(idempotencyKey);
      }

      const execution: ToolExecution = {
        correlationId: context.correlationId,
        toolName: name,
        category: tool.category,
        input: validatedInput,
        result,
        durationMs: Date.now() - startTime,
        validationPassed: true,
      };

      await this.recordToolExecution({
        context,
        toolName: name,
        toolCategory: tool.category,
        inputParams: validatedInput,
        validationStatus: 'passed',
        confirmationRequired: tool.requiresConfirmation,
        resultStatus: result.success ? 'success' : 'error',
        result,
        durationMs: execution.durationMs,
      });

      return execution;
    } catch (error) {
      const isTimeout =
        error instanceof ToolTimeoutError ||
        (error &&
          typeof error === 'object' &&
          'code' in error &&
          (error as { code?: unknown }).code === 'TOOL_TIMEOUT');

      console.error(`[ToolRegistry] Tool execution failed: ${name}`, error);
      const execution: ToolExecution = {
        correlationId: context.correlationId,
        toolName: name,
        category: tool.category,
        input: validatedInput,
        result: {
          success: false,
          error: isTimeout
            ? `Tool '${name}' exceeded execution timeout`
            : error instanceof Error
              ? error.message
              : 'Unknown error',
        },
        durationMs: Date.now() - startTime,
        validationPassed: true,
      };

      await this.recordToolExecution({
        context,
        toolName: name,
        toolCategory: tool.category,
        inputParams: validatedInput,
        validationStatus: 'passed',
        confirmationRequired: tool.requiresConfirmation,
        resultStatus: isTimeout ? 'timeout' : 'error',
        result: execution.result,
        durationMs: execution.durationMs,
        errorCode: isTimeout
          ? 'TOOL_TIMEOUT'
          : error &&
              typeof error === 'object' &&
              'code' in error &&
              typeof (error as { code?: unknown }).code === 'string'
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
