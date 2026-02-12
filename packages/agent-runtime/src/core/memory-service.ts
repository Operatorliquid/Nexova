/**
 * Memory Service
 * Builds and updates long-term memory using agent_memories.
 */
import { PrismaClient, type AgentMemory } from '@prisma/client';
import Anthropic from '@anthropic-ai/sdk';

interface MemoryServiceSettings {
  enabled: boolean;
  readEnabled: boolean;
  writeEnabled: boolean;
  summaryModel: string;
  summaryMaxTokens: number;
  summaryRecentMessages: number;
  summaryMinMessages: number;
  summaryUpdateEvery: number;
  summaryTtlDays: number;
  factTtlDays: number;
  preferenceTtlDays: number;
  entityTtlDays: number;
  maxFacts: number;
  maxPreferences: number;
  maxEntities: number;
}

const DEFAULT_SETTINGS: MemoryServiceSettings = {
  enabled: (process.env.AGENT_MEMORY_ENABLED || 'true').toLowerCase() === 'true',
  readEnabled: (process.env.AGENT_MEMORY_READ_ENABLED || 'true').toLowerCase() === 'true',
  writeEnabled: (process.env.AGENT_MEMORY_WRITE_ENABLED || 'true').toLowerCase() === 'true',
  summaryModel: process.env.AGENT_MEMORY_MODEL || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
  summaryMaxTokens: Number.parseInt(process.env.AGENT_MEMORY_MAX_TOKENS || '512', 10),
  summaryRecentMessages: Number.parseInt(process.env.AGENT_MEMORY_RECENT_MESSAGES || '12', 10),
  summaryMinMessages: Number.parseInt(process.env.AGENT_MEMORY_MIN_MESSAGES || '6', 10),
  summaryUpdateEvery: Number.parseInt(process.env.AGENT_MEMORY_UPDATE_EVERY || '3', 10),
  summaryTtlDays: Number.parseInt(process.env.AGENT_MEMORY_SUMMARY_TTL_DAYS || '30', 10),
  factTtlDays: Number.parseInt(process.env.AGENT_MEMORY_FACT_TTL_DAYS || '180', 10),
  preferenceTtlDays: Number.parseInt(process.env.AGENT_MEMORY_PREFERENCE_TTL_DAYS || '365', 10),
  entityTtlDays: Number.parseInt(process.env.AGENT_MEMORY_ENTITY_TTL_DAYS || '180', 10),
  maxFacts: Number.parseInt(process.env.AGENT_MEMORY_MAX_FACTS || '8', 10),
  maxPreferences: Number.parseInt(process.env.AGENT_MEMORY_MAX_PREFERENCES || '6', 10),
  maxEntities: Number.parseInt(process.env.AGENT_MEMORY_MAX_ENTITIES || '6', 10),
};

const SETTINGS_CACHE_TTL_MS = 5 * 60 * 1000;
const REDACTION_TOKEN = '[REDACTED]';
const PII_PATTERNS: RegExp[] = [
  // Email
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  // Phone numbers (7+ digits with optional symbols)
  /(?:\+?\d[\d\s().-]{6,}\d)/g,
  // Credit/debit card numbers (13-19 digits)
  /\b(?:\d[ -]*?){13,19}\b/g,
  // DNI (Argentina)
  /\b\d{7,8}\b/g,
  // CUIT/CUIL
  /\b\d{2}-?\d{8}-?\d\b/g,
  // CBU (Argentina bank account)
  /\b\d{22}\b/g,
];

export class MemoryService {
  private prisma: PrismaClient;
  private anthropic: Anthropic;
  private settingsCache = new Map<string, { value: MemoryServiceSettings; expiresAt: number }>();

  constructor(prisma: PrismaClient, anthropic: Anthropic) {
    this.prisma = prisma;
    this.anthropic = anthropic;
  }

  async buildContext(sessionId: string, workspaceId: string, since?: Date): Promise<string> {
    try {
      const settings = await this.getSettings(workspaceId);
      if (!settings.enabled || !settings.readEnabled) return '';

      const now = new Date();
      const sinceFilter = since ? { updatedAt: { gte: since } } : {};
      const summary = await this.prisma.agentMemory.findFirst({
        where: {
          sessionId,
          type: 'summary',
          key: 'latest',
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          ...sinceFilter,
        },
        orderBy: { updatedAt: 'desc' },
      });

      const facts = await this.prisma.agentMemory.findMany({
        where: {
          sessionId,
          type: 'fact',
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          ...sinceFilter,
        },
        orderBy: [{ importance: 'desc' }, { updatedAt: 'desc' }],
        take: settings.maxFacts,
      });

      const preferences = await this.prisma.agentMemory.findMany({
        where: {
          sessionId,
          type: 'preference',
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          ...sinceFilter,
        },
        orderBy: [{ importance: 'desc' }, { updatedAt: 'desc' }],
        take: settings.maxPreferences,
      });

      const entities = await this.prisma.agentMemory.findMany({
        where: {
          sessionId,
          type: 'entity',
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          ...sinceFilter,
        },
        orderBy: [{ importance: 'desc' }, { updatedAt: 'desc' }],
        take: settings.maxEntities,
      });

      const parts: string[] = [];
      if (summary?.content) {
        parts.push(`Resumen: ${summary.content}`);
      }
      if (facts.length) {
        parts.push(`Hechos relevantes:\n- ${facts.map((f) => f.content).join('\n- ')}`);
      }
      if (preferences.length) {
        parts.push(`Preferencias del cliente:\n- ${preferences.map((p) => p.content).join('\n- ')}`);
      }
      if (entities.length) {
        parts.push(`Entidades/Referencias:\n- ${entities.map((e) => e.content).join('\n- ')}`);
      }

      return parts.join('\n\n');
    } catch (error) {
      console.error('[MemoryService] Failed to build context:', error);
      return '';
    }
  }

  async updateFromTurn(params: {
    sessionId: string;
    workspaceId: string;
  }): Promise<void> {
    const settings = await this.getSettings(params.workspaceId);
    if (!settings.enabled || !settings.writeEnabled) return;

    let contextStartAt: Date | undefined;
    const session = await this.prisma.agentSession.findFirst({
      where: { id: params.sessionId, workspaceId: params.workspaceId },
      select: { metadata: true },
    });
    const metadata = (session?.metadata as Record<string, unknown>) || {};
    if (typeof metadata.contextStartAt === 'string') {
      const parsed = new Date(metadata.contextStartAt);
      if (!Number.isNaN(parsed.getTime())) {
        contextStartAt = parsed;
      }
    }

    const messageWhere = {
      sessionId: params.sessionId,
      role: { in: ['user', 'assistant'] },
      ...(contextStartAt ? { createdAt: { gte: contextStartAt } } : {}),
    };

    const messageCount = await this.prisma.agentMessage.count({
      where: messageWhere,
    });

    if (messageCount < settings.summaryMinMessages) return;
    if (settings.summaryUpdateEvery > 1 && messageCount % settings.summaryUpdateEvery !== 0) {
      return;
    }

    const history = await this.prisma.agentMessage.findMany({
      where: messageWhere,
      orderBy: { createdAt: 'desc' },
      take: settings.summaryRecentMessages,
      select: { role: true, content: true },
    });

    const recentMessages = history.reverse();
    if (recentMessages.length === 0) return;

    const existingSummary = await this.prisma.agentMemory.findFirst({
      where: {
        sessionId: params.sessionId,
        type: 'summary',
        key: 'latest',
        ...(contextStartAt ? { updatedAt: { gte: contextStartAt } } : {}),
      },
      orderBy: { updatedAt: 'desc' },
    });

    const prompt = this.buildMemoryPrompt({
      summary: existingSummary?.content || '',
      messages: recentMessages,
    });

    const response = await this.anthropic.messages.create({
      model: settings.summaryModel,
      max_tokens: settings.summaryMaxTokens,
      temperature: 0.2,
      system: 'Sos un servicio de extracción de memoria. Devolvé SOLO JSON válido sin texto adicional.',
      messages: [{ role: 'user', content: prompt }],
    });

    const jsonText = this.extractJson(response.content?.[0]?.type === 'text' ? response.content[0].text : '');
    if (!jsonText) return;

    const parsed = this.safeParseJson(jsonText) as {
      summary?: string;
      facts?: Array<string | { key?: string; value?: string; importance?: number }>;
      preferences?: Array<string | { key?: string; value?: string; importance?: number }>;
      entities?: Array<string | { key?: string; value?: string; importance?: number }>;
    } | null;

    if (!parsed) return;

    if (parsed.summary && parsed.summary.trim()) {
      const sanitizedSummary = this.sanitizeMemoryContent(parsed.summary.trim());
      if (sanitizedSummary) {
        await this.upsertMemory({
          sessionId: params.sessionId,
          type: 'summary',
          key: 'latest',
          content: sanitizedSummary,
          importance: 0.7,
          expiresAt: this.expireAt(settings.summaryTtlDays),
        });
      }
    }

    await this.upsertMemoryBatch(params.sessionId, 'fact', parsed.facts, settings.factTtlDays);
    await this.upsertMemoryBatch(params.sessionId, 'preference', parsed.preferences, settings.preferenceTtlDays);
    await this.upsertMemoryBatch(params.sessionId, 'entity', parsed.entities, settings.entityTtlDays);
  }

  private async upsertMemoryBatch(
    sessionId: string,
    type: 'fact' | 'preference' | 'entity',
    items: Array<string | { key?: string; value?: string; importance?: number }> | undefined,
    ttlDays: number
  ): Promise<void> {
    if (!items || items.length === 0) return;
    for (const item of items) {
      const normalized = this.normalizeMemoryItem(item);
      if (!normalized) continue;
      await this.upsertMemory({
        sessionId,
        type,
        key: normalized.key,
        content: normalized.content,
        importance: normalized.importance,
        expiresAt: this.expireAt(ttlDays),
      });
    }
  }

  private async upsertMemory(params: {
    sessionId: string;
    type: AgentMemory['type'];
    key?: string | null;
    content: string;
    importance: number;
    expiresAt?: Date | null;
  }): Promise<void> {
    const key = params.key || null;
    const existing = await this.prisma.agentMemory.findFirst({
      where: {
        sessionId: params.sessionId,
        type: params.type,
        ...(key ? { key } : {}),
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (existing) {
      await this.prisma.agentMemory.update({
        where: { id: existing.id },
        data: {
          content: params.content,
          importance: params.importance,
          expiresAt: params.expiresAt ?? null,
        },
      });
      return;
    }

    await this.prisma.agentMemory.create({
      data: {
        sessionId: params.sessionId,
        type: params.type,
        key,
        content: params.content,
        importance: params.importance,
        expiresAt: params.expiresAt ?? null,
      },
    });
  }

  private normalizeMemoryItem(
    item: string | { key?: string; value?: string; importance?: number }
  ): { key?: string; content: string; importance: number } | null {
    if (typeof item === 'string') {
      const trimmed = item.trim();
      if (!trimmed) return null;
      const sanitized = this.sanitizeMemoryContent(trimmed);
      if (!sanitized) return null;
      const safeKey = sanitized.includes(REDACTION_TOKEN)
        ? undefined
        : this.slugifyKey(sanitized);
      return {
        key: safeKey,
        content: sanitized,
        importance: 0.6,
      };
    }

    if (item && typeof item === 'object') {
      const value = (item.value || '').trim();
      if (!value) return null;
      const sanitized = this.sanitizeMemoryContent(value);
      if (!sanitized) return null;
      const keySource = item.key?.trim() || sanitized;
      const key = keySource.includes(REDACTION_TOKEN)
        ? undefined
        : this.slugifyKey(keySource);
      return {
        key,
        content: sanitized,
        importance: typeof item.importance === 'number' ? item.importance : 0.6,
      };
    }

    return null;
  }

  private buildMemoryPrompt(params: {
    summary: string;
    messages: Array<{ role: string; content: string }>;
  }): string {
    const history = params.messages
      .map((m) => `${m.role === 'user' ? 'Cliente' : 'Asistente'}: ${m.content}`)
      .join('\n');

    return `Resumen previo (si existe):\n${params.summary || '(vacío)'}\n\n` +
      `Mensajes recientes:\n${history}\n\n` +
      `Extraé memoria en JSON con esta forma estricta:\n` +
      `{"summary":"...","facts":["..."],"preferences":["..."],"entities":["..."]}\n` +
      `Reglas: no inventes, omití vacíos, facts/preferencias/entidades deben ser frases cortas y útiles.`;
  }

  private extractJson(text: string): string | null {
    if (!text) return null;
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    return text.slice(start, end + 1);
  }

  private safeParseJson(text: string): unknown | null {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  private sanitizeMemoryContent(text: string): string | null {
    if (!text) return null;
    let sanitized = text;
    let redacted = false;
    for (const pattern of PII_PATTERNS) {
      const next = sanitized.replace(pattern, REDACTION_TOKEN);
      if (next !== sanitized) {
        redacted = true;
        sanitized = next;
      }
    }
    const trimmed = sanitized.trim();
    if (!trimmed) return null;
    if (redacted) {
      const withoutRedaction = trimmed
        .replace(new RegExp(`\\${REDACTION_TOKEN}`, 'g'), '')
        .replace(/[^a-z0-9]+/gi, '');
      if (withoutRedaction.length < 3) {
        return null;
      }
    }
    return trimmed;
  }

  private expireAt(days: number): Date | null {
    if (!Number.isFinite(days) || days <= 0) return null;
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  private slugifyKey(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 200);
  }

  private async getSettings(workspaceId: string): Promise<MemoryServiceSettings> {
    const cached = this.settingsCache.get(workspaceId);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const base = { ...DEFAULT_SETTINGS };

    try {
      const workspace = await this.prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { settings: true },
      });
      const settings = (workspace?.settings as Record<string, unknown>) || {};

      const parseBool = (value: unknown, fallback: boolean): boolean => {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') return value.toLowerCase() === 'true';
        return fallback;
      };
      const parseNumber = (value: unknown, fallback: number): number => {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'string') {
          const parsed = Number.parseInt(value, 10);
          return Number.isFinite(parsed) ? parsed : fallback;
        }
        return fallback;
      };
      const parseString = (value: unknown, fallback: string): string => {
        return typeof value === 'string' && value.trim() ? value : fallback;
      };

      const resolved: MemoryServiceSettings = {
        enabled: parseBool(settings.agentMemoryEnabled, base.enabled),
        readEnabled: parseBool(settings.agentMemoryReadEnabled, base.readEnabled),
        writeEnabled: parseBool(settings.agentMemoryWriteEnabled, base.writeEnabled),
        summaryModel: parseString(settings.agentMemoryModel, base.summaryModel),
        summaryMaxTokens: parseNumber(settings.agentMemoryMaxTokens, base.summaryMaxTokens),
        summaryRecentMessages: parseNumber(settings.agentMemoryRecentMessages, base.summaryRecentMessages),
        summaryMinMessages: parseNumber(settings.agentMemoryMinMessages, base.summaryMinMessages),
        summaryUpdateEvery: parseNumber(settings.agentMemoryUpdateEvery, base.summaryUpdateEvery),
        summaryTtlDays: parseNumber(settings.agentMemorySummaryTtlDays, base.summaryTtlDays),
        factTtlDays: parseNumber(settings.agentMemoryFactTtlDays, base.factTtlDays),
        preferenceTtlDays: parseNumber(settings.agentMemoryPreferenceTtlDays, base.preferenceTtlDays),
        entityTtlDays: parseNumber(settings.agentMemoryEntityTtlDays, base.entityTtlDays),
        maxFacts: parseNumber(settings.agentMemoryMaxFacts, base.maxFacts),
        maxPreferences: parseNumber(settings.agentMemoryMaxPreferences, base.maxPreferences),
        maxEntities: parseNumber(settings.agentMemoryMaxEntities, base.maxEntities),
      };

      this.settingsCache.set(workspaceId, {
        value: resolved,
        expiresAt: now + SETTINGS_CACHE_TTL_MS,
      });
      return resolved;
    } catch (error) {
      console.error('[MemoryService] Failed to load workspace settings:', error);
    }

    this.settingsCache.set(workspaceId, {
      value: base,
      expiresAt: now + SETTINGS_CACHE_TTL_MS,
    });
    return base;
  }
}
