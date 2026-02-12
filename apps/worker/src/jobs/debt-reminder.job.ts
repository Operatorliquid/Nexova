/**
 * Debt Reminder Job
 * Sends WhatsApp reminders to customers with overdue payments
 */
import { Job, Queue } from 'bullmq';
import { PrismaClient, Prisma } from '@prisma/client';
import {
  COMMERCE_USAGE_METRICS,
  DEFAULT_COMMERCE_PLAN_LIMITS,
  DebtReminderPayload,
  getCommercePlanCapabilities,
  MessageSendPayload,
  QUEUES,
  resolveCommercePlan,
  type CommercePlan,
  type CommercePlanLimitConfig,
} from '@nexova/shared';
import { LedgerService, DEFAULT_DEBT_SETTINGS } from '@nexova/core';

interface DebtReminderResult {
  workspaceId: string;
  processedCustomers: number;
  remindersSent: number;
  errors: string[];
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  if (Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeLimit(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const n = Math.trunc(value);
    if (n >= 1) return n;
    return undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return undefined;
    const n = Math.trunc(parsed);
    if (n >= 1) return n;
    return undefined;
  }
  return undefined;
}

function pickPlanLimitConfig(value: unknown): Partial<CommercePlanLimitConfig> {
  const obj = asObject(value);
  const ordersPerMonth = normalizeLimit(obj.ordersPerMonth);
  const aiMetricsInsightsPerMonth = normalizeLimit(obj.aiMetricsInsightsPerMonth);
  const aiCustomerSummariesPerMonth = normalizeLimit(obj.aiCustomerSummariesPerMonth);
  const debtRemindersPerMonth = normalizeLimit(obj.debtRemindersPerMonth);

  return {
    ...(ordersPerMonth !== undefined ? { ordersPerMonth } : {}),
    ...(aiMetricsInsightsPerMonth !== undefined ? { aiMetricsInsightsPerMonth } : {}),
    ...(aiCustomerSummariesPerMonth !== undefined ? { aiCustomerSummariesPerMonth } : {}),
    ...(debtRemindersPerMonth !== undefined ? { debtRemindersPerMonth } : {}),
  };
}

function getUtcMonthPeriod(date: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  return { start, end };
}

async function getMonthlyUsage(prisma: PrismaClient, params: { workspaceId: string; metric: string; occurredAt?: Date }): Promise<bigint> {
  const { start, end } = getUtcMonthPeriod(params.occurredAt ?? new Date());
  const agg = await prisma.usageRecord.aggregate({
    where: {
      workspaceId: params.workspaceId,
      metric: params.metric,
      periodStart: start,
      periodEnd: end,
    },
    _sum: { quantity: true },
  });
  return (agg._sum.quantity ?? 0n) as bigint;
}

async function recordMonthlyUsage(
  prisma: PrismaClient,
  params: { workspaceId: string; metric: string; quantity: number | bigint; metadata?: Record<string, unknown>; occurredAt?: Date }
): Promise<void> {
  const amount = typeof params.quantity === 'bigint'
    ? params.quantity
    : (Number.isFinite(params.quantity) ? BigInt(Math.max(0, Math.trunc(params.quantity))) : 0n);
  if (amount <= 0n) return;

  const { start, end } = getUtcMonthPeriod(params.occurredAt ?? new Date());
  try {
    const existing = await prisma.usageRecord.findFirst({
      where: {
        workspaceId: params.workspaceId,
        metric: params.metric,
        periodStart: start,
        periodEnd: end,
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    if (existing?.id) {
      await prisma.usageRecord.updateMany({
        where: { id: existing.id, workspaceId: params.workspaceId },
        data: { quantity: { increment: amount } },
      });
      return;
    }

    await prisma.usageRecord.create({
      data: {
        workspaceId: params.workspaceId,
        metric: params.metric,
        quantity: amount,
        periodStart: start,
        periodEnd: end,
        metadata: (params.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  } catch {
    // Non-fatal
  }
}

export class DebtReminderJob {
  private prisma: PrismaClient;
  private ledgerService: LedgerService;
  private messageQueue: Queue<MessageSendPayload>;

  constructor(
    prisma: PrismaClient,
    messageQueue: Queue<MessageSendPayload>
  ) {
    this.prisma = prisma;
    this.ledgerService = new LedgerService(prisma);
    this.messageQueue = messageQueue;
  }

  private async getEffectivePlanLimits(plan: CommercePlan): Promise<CommercePlanLimitConfig> {
    const defaults = DEFAULT_COMMERCE_PLAN_LIMITS[plan];
    try {
      const system = await this.prisma.systemSettings.findUnique({
        where: { id: 'system' },
        select: { featureFlags: true },
      });
      const featureFlags = asObject(system?.featureFlags);
      const allLimits = asObject(featureFlags.commercePlanLimits);
      const override = pickPlanLimitConfig(allLimits[plan]);
      return { ...defaults, ...override };
    } catch {
      return defaults;
    }
  }

  /**
   * Process a debt reminder job
   */
  async process(job: Job<DebtReminderPayload>): Promise<DebtReminderResult> {
    const { workspaceId, customerId, force } = job.data;

    // Handle '*' = all workspaces
    if (workspaceId === '*') {
      return this.processAllWorkspaces(job);
    }

    console.log(`[DebtReminder] Processing workspace ${workspaceId}`);

    const result: DebtReminderResult = {
      workspaceId,
      processedCustomers: 0,
      remindersSent: 0,
      errors: [],
    };

    try {
      // Get workspace settings
      const workspace = await this.prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: {
          id: true,
          name: true,
          plan: true,
          settings: true,
        },
      });

      if (!workspace) {
        throw new Error(`Workspace ${workspaceId} not found`);
      }

      // Get debt settings from workspace settings
      const settings = workspace.settings as Record<string, unknown> || {};
      const plan = resolveCommercePlan({
        workspacePlan: workspace.plan,
        settingsPlan: settings.commercePlan,
        fallback: 'pro',
      });
      const capabilities = getCommercePlanCapabilities(plan);
      if (!capabilities.showDebtsModule) {
        console.log(`[DebtReminder] Plan ${plan} does not include debts module. Skipping.`);
        return result;
      }

      const planLimits = await this.getEffectivePlanLimits(plan);
      const monthlyLimit = planLimits.debtRemindersPerMonth;
      let remainingQuota = Number.MAX_SAFE_INTEGER;
      if (monthlyLimit !== null) {
        const used = await getMonthlyUsage(this.prisma, {
          workspaceId,
          metric: COMMERCE_USAGE_METRICS.debtRemindersSent,
        });
        remainingQuota = Math.max(0, monthlyLimit - Number(used));
        if (remainingQuota <= 0) {
          console.log(`[DebtReminder] Monthly quota reached (${monthlyLimit}). Skipping.`);
          return result;
        }
      }
      const debtSettings = {
        ...DEFAULT_DEBT_SETTINGS.debtReminders,
        ...(settings.debtReminders as Record<string, unknown> || {}),
      };

      // Check if reminders are enabled
      if (!debtSettings.enabled && !force) {
        console.log(`[DebtReminder] Reminders disabled for workspace ${workspaceId}`);
        return result;
      }

      // Check if within allowed hours
      const currentHour = new Date().getHours();
      const [startHour, endHour] = debtSettings.sendBetweenHours as [number, number];
      if (currentHour < startHour || currentHour >= endHour) {
        console.log(`[DebtReminder] Outside sending hours (${startHour}-${endHour})`);
        return result;
      }

      // Get eligible customers
      const customers = await this.getEligibleCustomers(
        workspaceId,
        customerId,
        debtSettings
      );

      result.processedCustomers = customers.length;
      console.log(`[DebtReminder] Found ${customers.length} eligible customers`);

      // Process each customer
      for (const customer of customers) {
        if (remainingQuota <= 0) break;
        try {
          const sent = await this.sendReminderIfNeeded(
            workspace,
            customer,
            debtSettings
          );
          if (sent) {
            result.remindersSent++;
            remainingQuota -= 1;
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          result.errors.push(`Customer ${customer.id}: ${errorMsg}`);
        }
      }

      if (result.remindersSent > 0) {
        await recordMonthlyUsage(this.prisma, {
          workspaceId,
          metric: COMMERCE_USAGE_METRICS.debtRemindersSent,
          quantity: result.remindersSent,
          metadata: { source: 'worker.debt_reminder_job' },
        });
      }

      console.log(
        `[DebtReminder] Completed: ${result.remindersSent} reminders sent, ${result.errors.length} errors`
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      result.errors.push(errorMsg);
      console.error(`[DebtReminder] Job failed:`, err);
    }

    return result;
  }

  /**
   * Process all workspaces
   */
  private async processAllWorkspaces(
    job: Job<DebtReminderPayload>
  ): Promise<DebtReminderResult> {
    console.log('[DebtReminder] Processing all workspaces');

    const result: DebtReminderResult = {
      workspaceId: '*',
      processedCustomers: 0,
      remindersSent: 0,
      errors: [],
    };

    // Get all active workspaces with debt reminders enabled
    const workspaces = await this.prisma.workspace.findMany({
      where: {
        status: 'active',
      },
      select: { id: true },
    });

    console.log(`[DebtReminder] Found ${workspaces.length} active workspaces`);

    for (const workspace of workspaces) {
      try {
        const wsResult = await this.process({
          ...job,
          data: { ...job.data, workspaceId: workspace.id },
        } as Job<DebtReminderPayload>);

        result.processedCustomers += wsResult.processedCustomers;
        result.remindersSent += wsResult.remindersSent;
        result.errors.push(...wsResult.errors);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        result.errors.push(`Workspace ${workspace.id}: ${errorMsg}`);
      }
    }

    return result;
  }

  /**
   * Get customers eligible for debt reminder
   */
  private async getEligibleCustomers(
    workspaceId: string,
    customerId: string | undefined,
    settings: Record<string, unknown>
  ) {
    const firstReminderDays = (settings.firstReminderDays as number) || 3;
    const maxReminders = (settings.maxReminders as number) || 3;

    const where: Prisma.CustomerWhereInput = {
      workspaceId,
      currentBalance: { gt: 0 }, // Has debt
      status: 'active',
      debtReminderCount: { lt: maxReminders }, // Haven't exceeded max reminders
      ...(customerId && { id: customerId }),
    };

    return this.prisma.customer.findMany({
      where,
      select: {
        id: true,
        phone: true,
        firstName: true,
        lastName: true,
        currentBalance: true,
        debtReminderCount: true,
        lastDebtReminderAt: true,
      },
      take: 100, // Process in batches
    });
  }

  /**
   * Send reminder to a customer if conditions are met
   */
  private async sendReminderIfNeeded(
    workspace: { id: string; name: string },
    customer: {
      id: string;
      phone: string;
      firstName: string | null;
      lastName: string | null;
      currentBalance: number;
      debtReminderCount: number;
      lastDebtReminderAt: Date | null;
    },
    settings: Record<string, unknown>
  ): Promise<boolean> {
    const {
      firstReminderDays,
      secondReminderDays,
      thirdReminderDays,
      messageTemplate,
    } = settings as {
      firstReminderDays: number;
      secondReminderDays: number;
      thirdReminderDays: number;
      messageTemplate: string;
    };

    // Determine which reminder level based on count
    const reminderLevel = customer.debtReminderCount + 1;
    let daysSinceLastReminder = 0;

    if (customer.lastDebtReminderAt) {
      daysSinceLastReminder = Math.floor(
        (Date.now() - customer.lastDebtReminderAt.getTime()) / (1000 * 60 * 60 * 24)
      );
    }

    // Check if enough time has passed for next reminder
    const daysForLevel = [firstReminderDays, secondReminderDays, thirdReminderDays];
    const requiredDays = daysForLevel[reminderLevel - 1] || firstReminderDays;

    if (customer.debtReminderCount > 0 && daysSinceLastReminder < requiredDays) {
      console.log(
        `[DebtReminder] Skipping ${customer.id}: only ${daysSinceLastReminder} days since last reminder`
      );
      return false;
    }

    // Get unpaid orders for context
    const unpaidOrders = await this.ledgerService.getUnpaidOrders(
      workspace.id,
      customer.id
    );

    if (unpaidOrders.length === 0) {
      console.log(`[DebtReminder] No unpaid orders for customer ${customer.id}`);
      return false;
    }

    // For first reminder, ensure the debt is old enough
    if (customer.debtReminderCount === 0) {
      const oldest = unpaidOrders[0];
      if (oldest && oldest.daysOld < firstReminderDays) {
        console.log(
          `[DebtReminder] Skipping ${customer.id}: debt age ${oldest.daysOld}d < ${firstReminderDays}d`
        );
        return false;
      }
    }

    // Build message from template
    const customerName = customer.firstName
      ? `${customer.firstName} ${customer.lastName || ''}`.trim()
      : 'cliente';
    const totalDebt = this.formatMoney(customer.currentBalance);
    const orderCount = unpaidOrders.length;

    const message = this.interpolateTemplate(messageTemplate, {
      customerName,
      totalDebt,
      orderCount: orderCount.toString(),
      workspaceName: workspace.name,
    });

    // Get active session for customer
    const session = await this.prisma.agentSession.findFirst({
      where: {
        workspaceId: workspace.id,
        customerId: customer.id,
        endedAt: null,
      },
      select: { id: true },
    });

    if (!session) {
      console.log(`[DebtReminder] No active session for customer ${customer.id}`);
      return false;
    }

    // Queue message for sending
    await this.messageQueue.add(
      `debt-reminder-${customer.id}`,
      {
        workspaceId: workspace.id,
        sessionId: session.id,
        to: customer.phone,
        messageType: 'text',
        content: { text: message },
        correlationId: `debt-reminder-${customer.id}-${Date.now()}`,
      },
      {
        attempts: QUEUES.MESSAGE_SEND.attempts,
        backoff: QUEUES.MESSAGE_SEND.backoff,
      }
    );

    // Update customer reminder count
    await this.prisma.customer.updateMany({
      where: { id: customer.id, workspaceId: workspace.id },
      data: {
        debtReminderCount: { increment: 1 },
        lastDebtReminderAt: new Date(),
      },
    });

    console.log(`[DebtReminder] Sent reminder to ${customer.phone} (level ${reminderLevel})`);
    return true;
  }

  /**
   * Interpolate template with variables
   */
  private interpolateTemplate(
    template: string,
    vars: Record<string, string>
  ): string {
    return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] || `{${key}}`);
  }

  /**
   * Format money value
   */
  private formatMoney(cents: number): string {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  }
}

/**
 * Create debt reminder job processor
 */
export function createDebtReminderProcessor(
  prisma: PrismaClient,
  messageQueue: Queue<MessageSendPayload>
) {
  const job = new DebtReminderJob(prisma, messageQueue);
  return (jobData: Job<DebtReminderPayload>) => job.process(jobData);
}
