/**
 * Ledger Service
 * Manages customer debt/credit tracking with FIFO payment application
 */

import type { PrismaClient, Prisma } from '@prisma/client';
import type {
  CreateLedgerEntryInput,
  LedgerEntryResult,
  CustomerBalance,
  CustomerDebtSummary,
  UnpaidOrder,
  RecentPayment,
  ApplyPaymentInput,
  ApplyPaymentResult,
  OrderSettlement,
  CreateDebitInput,
  CreateDebitResult,
  CreateAdjustmentInput,
} from './types.js';

export class LedgerService {
  constructor(private prisma: PrismaClient) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // BALANCE QUERIES
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Get current balance for a customer
   * Positive = customer owes money
   * Negative = customer has credit balance
   */
  async getCustomerBalance(
    workspaceId: string,
    customerId: string
  ): Promise<CustomerBalance> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, workspaceId },
      select: {
        id: true,
        currentBalance: true,
      },
    });

    if (!customer) {
      throw new LedgerServiceError('Customer not found', 'CUSTOMER_NOT_FOUND');
    }

    return {
      customerId: customer.id,
      currentBalance: customer.currentBalance,
      hasDebt: customer.currentBalance > 0,
      hasCreditBalance: customer.currentBalance < 0,
      currency: 'ARS',
    };
  }

  /**
   * Get detailed debt summary for a customer
   */
  async getCustomerDebtSummary(
    workspaceId: string,
    customerId: string
  ): Promise<CustomerDebtSummary> {
    const balance = await this.getCustomerBalance(workspaceId, customerId);

    // Get unpaid orders (FIFO - oldest first)
    const unpaidOrders = await this.getUnpaidOrders(workspaceId, customerId);

    // Get recent payments (last 10)
    const recentPayments = await this.getRecentPayments(workspaceId, customerId);

    // Get last activity
    const lastEntry = await this.prisma.ledgerEntry.findFirst({
      where: { workspaceId, customerId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    const formattedMessage = this.formatBalanceMessage(balance, unpaidOrders);

    return {
      ...balance,
      unpaidOrders,
      recentPayments,
      lastActivityAt: lastEntry?.createdAt,
      formattedMessage,
    };
  }

  /**
   * Get unpaid orders for a customer (ordered oldest first for FIFO)
   */
  async getUnpaidOrders(
    workspaceId: string,
    customerId: string
  ): Promise<UnpaidOrder[]> {
    const orders = await this.prisma.order.findMany({
      where: {
        workspaceId,
        customerId,
        status: {
          notIn: ['cancelled', 'draft'],
        },
        // Has unpaid balance
        OR: [
          { paidAt: null },
          {
            AND: [
              { paidAmount: { lt: this.prisma.order.fields.total } },
            ],
          },
        ],
      },
      select: {
        id: true,
        orderNumber: true,
        total: true,
        paidAmount: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' }, // FIFO - oldest first
    });

    const now = new Date();

    return orders
      .filter(order => order.total > order.paidAmount)
      .map(order => ({
        orderId: order.id,
        orderNumber: order.orderNumber,
        total: order.total,
        paidAmount: order.paidAmount,
        pendingAmount: order.total - order.paidAmount,
        createdAt: order.createdAt,
        daysOld: Math.floor(
          (now.getTime() - order.createdAt.getTime()) / (1000 * 60 * 60 * 24)
        ),
      }));
  }

  /**
   * Get recent payments for a customer
   */
  async getRecentPayments(
    workspaceId: string,
    customerId: string,
    limit = 10
  ): Promise<RecentPayment[]> {
    const entries = await this.prisma.ledgerEntry.findMany({
      where: {
        workspaceId,
        customerId,
        type: 'credit',
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        amount: true,
        referenceType: true,
        createdAt: true,
      },
    });

    return entries.map(entry => ({
      id: entry.id,
      amount: entry.amount,
      method: entry.referenceType === 'Receipt' ? 'transfer' : 'mercadopago',
      createdAt: entry.createdAt,
    }));
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // DEBIT OPERATIONS (Customer owes money)
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Create a debit entry when an order is confirmed
   */
  async createOrderDebit(input: CreateDebitInput): Promise<CreateDebitResult> {
    const result = await this.prisma.$transaction(async (tx) => {
      // Get current balance
      const customer = await tx.customer.findFirst({
        where: { id: input.customerId, workspaceId: input.workspaceId },
        select: { currentBalance: true },
      });

      if (!customer) {
        throw new LedgerServiceError('Customer not found', 'CUSTOMER_NOT_FOUND');
      }

      const previousBalance = customer.currentBalance;
      const newBalance = previousBalance + input.amount;

      // Create ledger entry
      const entry = await tx.ledgerEntry.create({
        data: {
          workspaceId: input.workspaceId,
          customerId: input.customerId,
          type: 'debit',
          amount: input.amount,
          currency: 'ARS',
          balanceAfter: newBalance,
          referenceType: 'Order',
          referenceId: input.orderId,
          description: `Pedido #${input.orderNumber}`,
          createdBy: input.createdBy || 'system',
        },
      });

      // Update customer balance
      await tx.customer.updateMany({
        where: { id: input.customerId, workspaceId: input.workspaceId },
        data: { currentBalance: newBalance },
      });

      return {
        ledgerEntryId: entry.id,
        previousBalance,
        newBalance,
      };
    });

    // Update payment score asynchronously
    this.updatePaymentScore(input.workspaceId, input.customerId).catch(() => {});

    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // CREDIT OPERATIONS (Customer pays)
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Apply a payment using FIFO strategy
   * Credits oldest orders first
   */
  async applyPayment(input: ApplyPaymentInput): Promise<ApplyPaymentResult> {
    const result = await this.prisma.$transaction(async (tx) => {
      // Get current balance
      const customer = await tx.customer.findFirst({
        where: { id: input.customerId, workspaceId: input.workspaceId },
        select: { currentBalance: true },
      });

      if (!customer) {
        throw new LedgerServiceError('Customer not found', 'CUSTOMER_NOT_FOUND');
      }

      const previousBalance = customer.currentBalance;
      const newBalance = previousBalance - input.amount;

      // Create ledger entry
      const entry = await tx.ledgerEntry.create({
        data: {
          workspaceId: input.workspaceId,
          customerId: input.customerId,
          type: 'credit',
          amount: input.amount,
          currency: 'ARS',
          balanceAfter: newBalance,
          referenceType: input.referenceType,
          referenceId: input.referenceId,
          description: input.description,
          createdBy: input.createdBy || 'system',
        },
      });

      // Update customer balance
      await tx.customer.updateMany({
        where: { id: input.customerId, workspaceId: input.workspaceId },
        data: {
          currentBalance: newBalance,
          // Reset debt reminder count on payment
          debtReminderCount: 0,
          lastDebtReminderAt: null,
        },
      });

      // Apply to orders using FIFO
      const ordersSettled = await this.applyToOrdersFIFO(
        tx,
        input.workspaceId,
        input.customerId,
        input.amount
      );

      return {
        ledgerEntryId: entry.id,
        previousBalance,
        newBalance,
        appliedAmount: input.amount,
        ordersSettled,
      };
    });

    // Update payment score asynchronously
    this.updatePaymentScore(input.workspaceId, input.customerId).catch(() => {});

    return result;
  }

  /**
   * Apply payment to a specific order
   */
  async applyPaymentToOrder(
    workspaceId: string,
    customerId: string,
    orderId: string,
    amount: number,
    referenceType: 'Payment' | 'Receipt',
    referenceId: string,
    createdBy?: string
  ): Promise<ApplyPaymentResult> {
    const result = await this.prisma.$transaction(async (tx) => {
      // Get order
      const order = await tx.order.findFirst({
        where: {
          id: orderId,
          workspaceId,
          customerId,
        },
        select: {
          id: true,
          orderNumber: true,
          total: true,
          paidAmount: true,
        },
      });

      if (!order) {
        throw new LedgerServiceError('Order not found', 'ORDER_NOT_FOUND');
      }

      const pendingAmount = order.total - order.paidAmount;
      const amountToApply = Math.min(amount, pendingAmount);

      if (amountToApply <= 0) {
        throw new LedgerServiceError('Order already fully paid', 'ORDER_ALREADY_PAID');
      }

      // Get current balance
      const customer = await tx.customer.findFirst({
        where: { id: customerId, workspaceId },
        select: { currentBalance: true },
      });

      if (!customer) {
        throw new LedgerServiceError('Customer not found', 'CUSTOMER_NOT_FOUND');
      }

      const previousBalance = customer.currentBalance;
      const newBalance = previousBalance - amountToApply;

      // Create ledger entry
      const entry = await tx.ledgerEntry.create({
        data: {
          workspaceId,
          customerId,
          type: 'credit',
          amount: amountToApply,
          currency: 'ARS',
          balanceAfter: newBalance,
          referenceType,
          referenceId,
          description: `Pago aplicado a pedido #${order.orderNumber}`,
          metadata: { orderId },
          createdBy: createdBy || 'system',
        },
      });

      // Update customer balance
      await tx.customer.updateMany({
        where: { id: customerId, workspaceId },
        data: {
          currentBalance: newBalance,
          debtReminderCount: 0,
          lastDebtReminderAt: null,
        },
      });

      // Update order paid amount
      const newPaidAmount = order.paidAmount + amountToApply;
      const isFullyPaid = newPaidAmount >= order.total;

      await tx.order.updateMany({
        where: { id: orderId, workspaceId },
        data: {
          paidAmount: newPaidAmount,
          paidAt: isFullyPaid ? new Date() : undefined,
          status: isFullyPaid ? 'paid' : undefined,
        },
      });

      const settlement: OrderSettlement = {
        orderId: order.id,
        orderNumber: order.orderNumber,
        amountApplied: amountToApply,
        previousPaidAmount: order.paidAmount,
        newPaidAmount,
        isFullyPaid,
      };

      return {
        ledgerEntryId: entry.id,
        previousBalance,
        newBalance,
        appliedAmount: amountToApply,
        ordersSettled: [settlement],
      };
    });

    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ADJUSTMENT OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Create a manual adjustment (admin only)
   */
  async createAdjustment(input: CreateAdjustmentInput): Promise<LedgerEntryResult> {
    const result = await this.prisma.$transaction(async (tx) => {
      // Get current balance
      const customer = await tx.customer.findFirst({
        where: { id: input.customerId, workspaceId: input.workspaceId },
        select: { currentBalance: true },
      });

      if (!customer) {
        throw new LedgerServiceError('Customer not found', 'CUSTOMER_NOT_FOUND');
      }

      const previousBalance = customer.currentBalance;
      const newBalance =
        input.type === 'debit'
          ? previousBalance + input.amount
          : previousBalance - input.amount;

      // Create ledger entry
      const entry = await tx.ledgerEntry.create({
        data: {
          workspaceId: input.workspaceId,
          customerId: input.customerId,
          type: input.type,
          amount: input.amount,
          currency: 'ARS',
          balanceAfter: newBalance,
          referenceType: 'Adjustment',
          referenceId: crypto.randomUUID(),
          description: `Ajuste: ${input.reason}`,
          createdBy: input.createdBy,
        },
      });

      // Update customer balance
      await tx.customer.updateMany({
        where: { id: input.customerId, workspaceId: input.workspaceId },
        data: { currentBalance: newBalance },
      });

      return {
        id: entry.id,
        type: entry.type as 'debit' | 'credit',
        amount: entry.amount,
        balanceAfter: entry.balanceAfter,
        referenceType: entry.referenceType,
        referenceId: entry.referenceId,
        description: entry.description,
        createdAt: entry.createdAt,
      };
    });

    return result;
  }

  /**
   * Write off debt (bad debt)
   */
  async writeOffDebt(
    workspaceId: string,
    customerId: string,
    amount: number,
    reason: string,
    createdBy: string
  ): Promise<LedgerEntryResult> {
    const result = await this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: customerId, workspaceId },
        select: { currentBalance: true },
      });

      if (!customer) {
        throw new LedgerServiceError('Customer not found', 'CUSTOMER_NOT_FOUND');
      }

      // Can only write off up to current debt
      const amountToWriteOff = Math.min(amount, Math.max(0, customer.currentBalance));

      if (amountToWriteOff <= 0) {
        throw new LedgerServiceError('No debt to write off', 'NO_DEBT');
      }

      const newBalance = customer.currentBalance - amountToWriteOff;

      const entry = await tx.ledgerEntry.create({
        data: {
          workspaceId,
          customerId,
          type: 'credit',
          amount: amountToWriteOff,
          currency: 'ARS',
          balanceAfter: newBalance,
          referenceType: 'WriteOff',
          referenceId: crypto.randomUUID(),
          description: `Condonación de deuda: ${reason}`,
          createdBy,
        },
      });

      await tx.customer.updateMany({
        where: { id: customerId, workspaceId },
        data: { currentBalance: newBalance },
      });

      return {
        id: entry.id,
        type: entry.type as 'debit' | 'credit',
        amount: entry.amount,
        balanceAfter: entry.balanceAfter,
        referenceType: entry.referenceType,
        referenceId: entry.referenceId,
        description: entry.description,
        createdAt: entry.createdAt,
      };
    });

    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // LEDGER HISTORY
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Get ledger history for a customer
   */
  async getLedgerHistory(
    workspaceId: string,
    customerId: string,
    options?: {
      limit?: number;
      offset?: number;
      type?: 'debit' | 'credit';
    }
  ): Promise<{ entries: LedgerEntryResult[]; total: number }> {
    const where: Prisma.LedgerEntryWhereInput = {
      workspaceId,
      customerId,
      ...(options?.type && { type: options.type }),
    };

    const [entries, total] = await Promise.all([
      this.prisma.ledgerEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: options?.limit || 50,
        skip: options?.offset || 0,
        select: {
          id: true,
          type: true,
          amount: true,
          balanceAfter: true,
          referenceType: true,
          referenceId: true,
          description: true,
          createdAt: true,
        },
      }),
      this.prisma.ledgerEntry.count({ where }),
    ]);

    return {
      entries: entries.map(entry => ({
        id: entry.id,
        type: entry.type as 'debit' | 'credit',
        amount: entry.amount,
        balanceAfter: entry.balanceAfter,
        referenceType: entry.referenceType,
        referenceId: entry.referenceId,
        description: entry.description,
        createdAt: entry.createdAt,
      })),
      total,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Apply payment to orders using FIFO strategy
   */
  private async applyToOrdersFIFO(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    customerId: string,
    amount: number
  ): Promise<OrderSettlement[]> {
    // Get unpaid orders (oldest first)
    const unpaidOrders = await tx.order.findMany({
      where: {
        workspaceId,
        customerId,
        status: { notIn: ['cancelled', 'draft'] },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        orderNumber: true,
        total: true,
        paidAmount: true,
      },
    });

    const settlements: OrderSettlement[] = [];
    let remaining = amount;

    for (const order of unpaidOrders) {
      if (remaining <= 0) break;

      const pendingAmount = order.total - order.paidAmount;
      if (pendingAmount <= 0) continue;

      const amountToApply = Math.min(remaining, pendingAmount);
      const newPaidAmount = order.paidAmount + amountToApply;
      const isFullyPaid = newPaidAmount >= order.total;

      // Update order
      await tx.order.updateMany({
        where: { id: order.id, workspaceId },
        data: {
          paidAmount: newPaidAmount,
          paidAt: isFullyPaid ? new Date() : undefined,
          status: isFullyPaid ? 'paid' : undefined,
        },
      });

      settlements.push({
        orderId: order.id,
        orderNumber: order.orderNumber,
        amountApplied: amountToApply,
        previousPaidAmount: order.paidAmount,
        newPaidAmount,
        isFullyPaid,
      });

      remaining -= amountToApply;
    }

    return settlements;
  }

  /**
   * Format balance message for customer
   */
  private formatBalanceMessage(
    balance: CustomerBalance,
    unpaidOrders: UnpaidOrder[]
  ): string {
    if (balance.currentBalance === 0) {
      return 'No tenés saldo pendiente. ¡Estás al día!';
    }

    if (balance.hasCreditBalance) {
      const credit = Math.abs(balance.currentBalance);
      return `Tenés un saldo a favor de $${this.formatMoney(credit)}.`;
    }

    const debt = balance.currentBalance;
    const orderCount = unpaidOrders.length;

    if (orderCount === 0) {
      return `Tenés un saldo pendiente de $${this.formatMoney(debt)}.`;
    }

    if (orderCount === 1) {
      const order = unpaidOrders[0];
      return `Tenés un saldo pendiente de $${this.formatMoney(debt)} del pedido #${order.orderNumber}.`;
    }

    return `Tenés un saldo pendiente de $${this.formatMoney(debt)} de ${orderCount} pedidos.`;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // PAYMENT SCORE
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Calculate payment score for a customer (0-100)
   * Based on: current debt, payment history, reminders sent
   */
  async calculatePaymentScore(workspaceId: string, customerId: string): Promise<number> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, workspaceId },
      select: {
        currentBalance: true,
        debtReminderCount: true,
        orderCount: true,
        totalSpent: true,
      },
    });

    if (!customer) {
      return 100; // New customer starts with perfect score
    }

    let score = 100;

    // Factor 1: Current debt (up to -30 points)
    if (customer.currentBalance > 0) {
      // More debt = lower score
      const debtPenalty = Math.min(30, Math.floor(customer.currentBalance / 50000)); // -1 point per $500 of debt
      score -= debtPenalty;
    }

    // Factor 2: Debt reminders sent (up to -30 points)
    // Each reminder = -10 points
    score -= Math.min(30, customer.debtReminderCount * 10);

    // Factor 3: Payment history - check paid vs unpaid orders
    const orderStats = await this.prisma.order.groupBy({
      by: ['status'],
      where: {
        workspaceId,
        customerId,
        status: {
          in: [
            'paid',
            'delivered',
            'pending_payment',
            'partial_payment',
            'awaiting_acceptance',
            'accepted',
            'pending_invoicing',
            'invoiced',
            'invoice_cancelled',
            'confirmed',
          ],
        },
        deletedAt: null,
      },
      _count: true,
    });

    const paidOrders = orderStats
      .filter(s => s.status === 'paid' || s.status === 'delivered')
      .reduce((sum, s) => sum + s._count, 0);
    const unpaidOrders = orderStats
      .filter(
        s =>
          s.status === 'pending_payment' ||
          s.status === 'partial_payment' ||
          s.status === 'awaiting_acceptance' ||
          s.status === 'accepted' ||
          s.status === 'pending_invoicing' ||
          s.status === 'invoiced' ||
          s.status === 'invoice_cancelled' ||
          s.status === 'confirmed'
      )
      .reduce((sum, s) => sum + s._count, 0);

    const totalOrders = paidOrders + unpaidOrders;
    if (totalOrders > 0) {
      // Calculate paid ratio (up to -20 points if many unpaid)
      const paidRatio = paidOrders / totalOrders;
      const historyPenalty = Math.floor((1 - paidRatio) * 20);
      score -= historyPenalty;
    }

    // Factor 4: Bonus for loyal customers with good history (+10 points max)
    if (customer.orderCount >= 10 && customer.currentBalance <= 0) {
      score = Math.min(100, score + 10);
    }

    // Ensure score is within bounds
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Update payment score for a customer and save to database
   */
  async updatePaymentScore(workspaceId: string, customerId: string): Promise<number> {
    const newScore = await this.calculatePaymentScore(workspaceId, customerId);

    await this.prisma.customer.updateMany({
      where: { id: customerId, workspaceId },
      data: { paymentScore: newScore },
    });

    return newScore;
  }

  /**
   * Get payment score label and color based on score
   */
  static getScoreLabel(score: number): { label: string; color: 'green' | 'yellow' | 'orange' | 'red' } {
    if (score >= 80) return { label: 'Excelente', color: 'green' };
    if (score >= 60) return { label: 'Bueno', color: 'yellow' };
    if (score >= 40) return { label: 'Regular', color: 'orange' };
    return { label: 'Riesgoso', color: 'red' };
  }

  /**
   * Format money value for display
   */
  private formatMoney(cents: number): string {
    return new Intl.NumberFormat('es-AR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  }
}

export class LedgerServiceError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message);
    this.name = 'LedgerServiceError';
  }
}
