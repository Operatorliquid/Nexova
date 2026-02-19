/**
 * Tool Base Class
 * Foundation for all agent tools with Zod validation
 */
import { z } from 'zod';

import { type ToolCategoryType, type ToolContext, type ToolResult } from '../types/index.js';

export interface ToolConfig<TInput extends z.ZodSchema> {
  name: string;
  description: string;
  category: ToolCategoryType;
  inputSchema: TInput;
  requiresConfirmation?: boolean;
  idempotencyKey?: (input: z.infer<TInput>) => string;
}

export abstract class BaseTool<TInput extends z.ZodSchema, TOutput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly category: ToolCategoryType;
  readonly inputSchema: TInput;
  readonly requiresConfirmation: boolean;
  readonly idempotencyKeyFn: ((input: z.infer<TInput>) => string) | undefined;

  constructor(config: ToolConfig<TInput>) {
    this.name = config.name;
    this.description = config.description;
    this.category = config.category;
    this.inputSchema = config.inputSchema;
    this.requiresConfirmation = config.requiresConfirmation ?? false;
    this.idempotencyKeyFn = config.idempotencyKey;
  }

  /**
   * Validate input against schema
   */
  validate(input: unknown): { success: true; data: z.infer<TInput> } | { success: false; error: string } {
    const result = this.inputSchema.safeParse(input);
    if (result.success) {
      return { success: true, data: result.data as z.infer<TInput> };
    }
    return {
      success: false,
      error: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', '),
    };
  }

  /**
   * Get idempotency key for this operation
   */
  getIdempotencyKey(input: z.infer<TInput>): string | null {
    if (!this.idempotencyKeyFn) return null;
    return `${this.name}:${this.idempotencyKeyFn(input)}`;
  }

  /**
   * Execute the tool - implemented by subclasses
   */
  abstract execute(input: z.infer<TInput>, context: ToolContext): Promise<ToolResult<TOutput>>;

  /**
   * Get JSON Schema for Claude
   */
  getJsonSchema(): Record<string, unknown> {
    return zodToJsonSchema(this.inputSchema);
  }
}

/**
 * Convert Zod schema to JSON Schema (simplified version)
 */
function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const withDescription = (base: Record<string, unknown>): Record<string, unknown> => {
    return schema.description ? { ...base, description: schema.description } : base;
  };

  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const fieldSchema = value;
      properties[key] = zodToJsonSchema(fieldSchema);
      if (!fieldSchema.isOptional()) {
        required.push(key);
      }
    }

    return withDescription({
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
    });
  }

  if (schema instanceof z.ZodString) {
    return withDescription({ type: 'string' });
  }

  if (schema instanceof z.ZodNumber) {
    return withDescription({ type: 'number' });
  }

  if (schema instanceof z.ZodBoolean) {
    return withDescription({ type: 'boolean' });
  }

  if (schema instanceof z.ZodArray) {
    const element = schema.element as z.ZodTypeAny;
    return withDescription({
      type: 'array',
      items: zodToJsonSchema(element),
    });
  }

  if (schema instanceof z.ZodEnum) {
    return withDescription({
      type: 'string',
      enum: schema.options,
    });
  }

  if (schema instanceof z.ZodOptional) {
    const inner = schema.unwrap() as z.ZodTypeAny;
    return zodToJsonSchema(inner);
  }

  if (schema instanceof z.ZodNullable) {
    const unwrapped = schema.unwrap() as z.ZodTypeAny;
    const inner = zodToJsonSchema(unwrapped);
    return withDescription({ ...inner, nullable: true });
  }

  if (schema instanceof z.ZodDefault) {
    const inner = schema.removeDefault() as z.ZodTypeAny;
    return zodToJsonSchema(inner);
  }

  if (schema instanceof z.ZodEffects) {
    const inner = schema.innerType() as z.ZodTypeAny;
    return zodToJsonSchema(inner);
  }

  if (schema instanceof z.ZodUnion) {
    const options = schema.options as readonly z.ZodTypeAny[];
    return withDescription({
      anyOf: options.map((opt) => zodToJsonSchema(opt)),
    });
  }

  if (schema instanceof z.ZodLiteral) {
    return withDescription({
      type: typeof schema.value,
      const: schema.value,
    });
  }

  if (schema instanceof z.ZodRecord) {
    const valueSchema = schema.valueSchema as z.ZodTypeAny;
    return withDescription({
      type: 'object',
      additionalProperties: zodToJsonSchema(valueSchema),
    });
  }

  return withDescription({ type: 'object' });
}

/**
 * Helper to create tool description with parameter info
 */
export function describeParams(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, desc]) => `- ${key}: ${desc}`)
    .join('\n');
}
