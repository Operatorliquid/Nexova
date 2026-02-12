/**
 * Tool Base Class
 * Foundation for all agent tools with Zod validation
 */
import { z } from 'zod';
import { ToolCategoryType, ToolContext, ToolResult } from '../types/index.js';

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
      return { success: true, data: result.data };
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
 * Uses any types for Zod internals since _def is not fully typed
 */
function zodToJsonSchema(schema: z.ZodSchema): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const def = schema._def as any;

  // Handle ZodObject
  if (def.typeName === 'ZodObject') {
    const shape = (schema as z.ZodObject<any>).shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value as z.ZodSchema);

      // Check if required (not optional)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fieldDef = (value as any)._def;
      if (fieldDef.typeName !== 'ZodOptional' && fieldDef.typeName !== 'ZodDefault') {
        required.push(key);
      }
    }

    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }

  // Handle ZodString
  if (def.typeName === 'ZodString') {
    const result: Record<string, unknown> = { type: 'string' };
    if (def.description) result.description = def.description;
    return result;
  }

  // Handle ZodNumber
  if (def.typeName === 'ZodNumber') {
    const result: Record<string, unknown> = { type: 'number' };
    if (def.description) result.description = def.description;
    return result;
  }

  // Handle ZodBoolean
  if (def.typeName === 'ZodBoolean') {
    return { type: 'boolean' };
  }

  // Handle ZodArray
  if (def.typeName === 'ZodArray') {
    return {
      type: 'array',
      items: zodToJsonSchema(def.type),
    };
  }

  // Handle ZodEnum
  if (def.typeName === 'ZodEnum') {
    return {
      type: 'string',
      enum: def.values,
    };
  }

  // Handle ZodOptional
  if (def.typeName === 'ZodOptional') {
    return zodToJsonSchema(def.innerType);
  }

  // Handle ZodDefault
  if (def.typeName === 'ZodDefault') {
    const inner = zodToJsonSchema(def.innerType);
    return { ...inner, default: def.defaultValue() };
  }

  // Handle ZodNullable
  if (def.typeName === 'ZodNullable') {
    const inner = zodToJsonSchema(def.innerType);
    return { ...inner, nullable: true };
  }

  // Handle ZodEffects (from .refine(), .transform(), etc.)
  if (def.typeName === 'ZodEffects') {
    return zodToJsonSchema(def.schema);
  }

  // Handle ZodUnion
  if (def.typeName === 'ZodUnion') {
    const options = def.options.map((opt: z.ZodSchema) => zodToJsonSchema(opt));
    return { anyOf: options };
  }

  // Handle ZodLiteral
  if (def.typeName === 'ZodLiteral') {
    const value = def.value;
    return { type: typeof value, const: value };
  }

  // Handle ZodRecord
  if (def.typeName === 'ZodRecord') {
    return {
      type: 'object',
      additionalProperties: zodToJsonSchema(def.valueType),
    };
  }

  // Handle described schemas
  if (def.description) {
    return { type: 'string', description: def.description };
  }

  // Fallback - return string type to avoid missing type error
  return { type: 'object' };
}

/**
 * Helper to create tool description with parameter info
 */
export function describeParams(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, desc]) => `- ${key}: ${desc}`)
    .join('\n');
}
