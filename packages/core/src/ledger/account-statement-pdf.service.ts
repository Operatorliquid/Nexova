/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ACCOUNT STATEMENT PDF SERVICE
 * Generates customer debt/account statement PDFs
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import type { PrismaClient } from '@prisma/client';
import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from 'pdf-lib';

const PAGE = { width: 595, height: 842 }; // A4
const MARGIN = 36;
const TABLE_ROW_HEIGHT = 16;
const SECTION_GAP = 14;

const COLORS = {
  text: rgb(0.1, 0.1, 0.1),
  muted: rgb(0.45, 0.45, 0.45),
  border: rgb(0.86, 0.86, 0.86),
  headerBg: rgb(0.97, 0.97, 0.97),
  danger: rgb(0.62, 0.11, 0.11),
};

type StatementOrder = {
  id: string;
  orderNumber: string;
  status: string;
  total: number;
  paidAmount: number;
  createdAt: Date;
};

type StatementLedgerEntry = {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  referenceType: string;
  description: string;
  createdAt: Date;
};

type StatementCustomer = {
  id: string;
  phone: string;
  firstName: string | null;
  lastName: string | null;
  cuit: string | null;
  businessName: string | null;
  fiscalAddress: string | null;
  metadata: unknown;
};

type StatementWorkspace = {
  name: string;
  settings: unknown;
};

export interface AccountStatementPdfResult {
  buffer: Buffer;
  filename: string;
  customerName: string;
  totalDebt: number;
  unpaidOrdersCount: number;
  generatedAt: Date;
}

export class AccountStatementPdfService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async generateCustomerStatement(
    workspaceId: string,
    customerId: string,
    options?: { asOf?: Date; includeRecentLedgerEntries?: number }
  ): Promise<AccountStatementPdfResult> {
    const asOf = options?.asOf || new Date();
    const includeRecentLedgerEntries = Math.max(0, Math.min(50, options?.includeRecentLedgerEntries ?? 15));

    const [customer, workspace, orders, ledgerEntries] = await Promise.all([
      this.prisma.customer.findFirst({
        where: { id: customerId, workspaceId, deletedAt: null },
        select: {
          id: true,
          phone: true,
          firstName: true,
          lastName: true,
          cuit: true,
          businessName: true,
          fiscalAddress: true,
          metadata: true,
        },
      }),
      this.prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { name: true, settings: true },
      }),
      this.prisma.order.findMany({
        where: {
          workspaceId,
          customerId,
          deletedAt: null,
          status: { notIn: ['cancelled', 'draft', 'returned', 'trashed'] },
          createdAt: { lte: asOf },
        },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          total: true,
          paidAmount: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.ledgerEntry.findMany({
        where: {
          workspaceId,
          customerId,
          createdAt: { lte: asOf },
        },
        select: {
          id: true,
          type: true,
          amount: true,
          balanceAfter: true,
          referenceType: true,
          description: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: includeRecentLedgerEntries,
      }),
    ]);

    if (!customer) {
      throw new Error('Cliente no encontrado');
    }

    const typedWorkspace: StatementWorkspace | null = workspace
      ? { name: workspace.name, settings: workspace.settings }
      : null;

    const typedCustomer: StatementCustomer = customer;
    const typedOrders: StatementOrder[] = orders;
    const typedLedgerEntries: StatementLedgerEntry[] = ledgerEntries;

    const unpaidOrders = typedOrders
      .map((order) => ({
        ...order,
        pendingAmount: Math.max(0, order.total - order.paidAmount),
      }))
      .filter((order) => order.pendingAmount > 0);

    const totalDebt = unpaidOrders.reduce((sum, order) => sum + order.pendingAmount, 0);
    const customerName = this.resolveCustomerName(typedCustomer);
    const workspaceName = this.resolveWorkspaceName(typedWorkspace);
    const customerDni = this.resolveCustomerDni(typedCustomer.metadata);

    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

    let page = pdf.addPage([PAGE.width, PAGE.height]);
    let y = PAGE.height - MARGIN;

    const ensureSpace = (neededHeight: number): void => {
      if (y - neededHeight >= MARGIN) return;
      page = pdf.addPage([PAGE.width, PAGE.height]);
      y = PAGE.height - MARGIN;
    };

    const drawSectionTitle = (title: string): void => {
      ensureSpace(24);
      page.drawText(title, {
        x: MARGIN,
        y,
        size: 13,
        font: fontBold,
        color: COLORS.text,
      });
      y -= 8;
      page.drawLine({
        start: { x: MARGIN, y },
        end: { x: PAGE.width - MARGIN, y },
        thickness: 1,
        color: COLORS.border,
      });
      y -= 14;
    };

    this.drawHeader(page, font, fontBold, {
      workspaceName,
      generatedAt: asOf,
    });
    y -= 62;

    drawSectionTitle('Datos del cliente');
    y = this.drawInfoRows(page, font, fontBold, y, [
      { label: 'Cliente', value: customerName },
      { label: 'Telefono', value: typedCustomer.phone || '-' },
      { label: 'DNI', value: customerDni || '-' },
      { label: 'CUIT', value: typedCustomer.cuit || '-' },
      { label: 'Razon social', value: typedCustomer.businessName || '-' },
      { label: 'Domicilio fiscal', value: typedCustomer.fiscalAddress || '-' },
    ]);

    y -= SECTION_GAP;

    drawSectionTitle('Resumen de deuda');
    y = this.drawInfoRows(page, font, fontBold, y, [
      { label: 'Total adeudado', value: this.formatMoney(totalDebt), highlight: totalDebt > 0 },
      { label: 'Pedidos con saldo pendiente', value: String(unpaidOrders.length) },
      { label: 'Fecha de corte', value: this.formatDateTime(asOf) },
    ]);

    y -= SECTION_GAP;
    drawSectionTitle('Detalle de pedidos pendientes');

    if (unpaidOrders.length === 0) {
      ensureSpace(24);
      page.drawText('No hay pedidos pendientes de pago al momento del corte.', {
        x: MARGIN,
        y,
        size: 10,
        font,
        color: COLORS.muted,
      });
      y -= 18;
    } else {
      const xOrder = MARGIN + 4;
      const xDate = MARGIN + 150;
      const xTotal = MARGIN + 260;
      const xPaid = MARGIN + 360;
      const xPending = MARGIN + 458;

      const drawOrdersHeader = (): void => {
        ensureSpace(TABLE_ROW_HEIGHT + 8);
        page.drawRectangle({
          x: MARGIN,
          y: y - TABLE_ROW_HEIGHT + 4,
          width: PAGE.width - MARGIN * 2,
          height: TABLE_ROW_HEIGHT,
          color: COLORS.headerBg,
          borderColor: COLORS.border,
          borderWidth: 1,
        });
        page.drawText('Pedido', { x: xOrder, y: y - 8, size: 9, font: fontBold, color: COLORS.text });
        page.drawText('Fecha', { x: xDate, y: y - 8, size: 9, font: fontBold, color: COLORS.text });
        page.drawText('Total', { x: xTotal, y: y - 8, size: 9, font: fontBold, color: COLORS.text });
        page.drawText('Pagado', { x: xPaid, y: y - 8, size: 9, font: fontBold, color: COLORS.text });
        page.drawText('Pendiente', { x: xPending, y: y - 8, size: 9, font: fontBold, color: COLORS.text });
        y -= TABLE_ROW_HEIGHT + 2;
      };

      drawOrdersHeader();

      unpaidOrders.forEach((order) => {
        ensureSpace(TABLE_ROW_HEIGHT + 2);
        page.drawText(order.orderNumber, {
          x: xOrder,
          y: y - 8,
          size: 9,
          font,
          color: COLORS.text,
        });
        page.drawText(this.formatDate(order.createdAt), {
          x: xDate,
          y: y - 8,
          size: 9,
          font,
          color: COLORS.text,
        });
        page.drawText(this.formatMoney(order.total), {
          x: xTotal,
          y: y - 8,
          size: 9,
          font,
          color: COLORS.text,
        });
        page.drawText(this.formatMoney(order.paidAmount), {
          x: xPaid,
          y: y - 8,
          size: 9,
          font,
          color: COLORS.text,
        });
        page.drawText(this.formatMoney(order.pendingAmount), {
          x: xPending,
          y: y - 8,
          size: 9,
          font: fontBold,
          color: COLORS.danger,
        });
        y -= TABLE_ROW_HEIGHT;

        page.drawLine({
          start: { x: MARGIN, y: y + 2 },
          end: { x: PAGE.width - MARGIN, y: y + 2 },
          thickness: 0.5,
          color: COLORS.border,
        });

        if (y - TABLE_ROW_HEIGHT < MARGIN + 60) {
          page = pdf.addPage([PAGE.width, PAGE.height]);
          y = PAGE.height - MARGIN;
          drawOrdersHeader();
        }
      });
    }

    y -= SECTION_GAP;
    drawSectionTitle('Movimientos recientes');

    if (typedLedgerEntries.length === 0) {
      ensureSpace(24);
      page.drawText('Sin movimientos registrados.', {
        x: MARGIN,
        y,
        size: 10,
        font,
        color: COLORS.muted,
      });
      y -= 18;
    } else {
      const xDate = MARGIN + 4;
      const xType = MARGIN + 92;
      const xRef = MARGIN + 172;
      const xAmount = MARGIN + 356;
      const xBalance = MARGIN + 456;

      const drawLedgerHeader = (): void => {
        ensureSpace(TABLE_ROW_HEIGHT + 8);
        page.drawRectangle({
          x: MARGIN,
          y: y - TABLE_ROW_HEIGHT + 4,
          width: PAGE.width - MARGIN * 2,
          height: TABLE_ROW_HEIGHT,
          color: COLORS.headerBg,
          borderColor: COLORS.border,
          borderWidth: 1,
        });
        page.drawText('Fecha', { x: xDate, y: y - 8, size: 9, font: fontBold, color: COLORS.text });
        page.drawText('Tipo', { x: xType, y: y - 8, size: 9, font: fontBold, color: COLORS.text });
        page.drawText('Detalle', { x: xRef, y: y - 8, size: 9, font: fontBold, color: COLORS.text });
        page.drawText('Monto', { x: xAmount, y: y - 8, size: 9, font: fontBold, color: COLORS.text });
        page.drawText('Saldo', { x: xBalance, y: y - 8, size: 9, font: fontBold, color: COLORS.text });
        y -= TABLE_ROW_HEIGHT + 2;
      };

      drawLedgerHeader();

      typedLedgerEntries.forEach((entry) => {
        ensureSpace(TABLE_ROW_HEIGHT + 2);
        const typeLabel = entry.type === 'debit' ? 'Cargo' : 'Pago';
        const description = this.clipText(entry.description || entry.referenceType || '-', 30);
        const amountPrefix = entry.type === 'debit' ? '+' : '-';

        page.drawText(this.formatDate(entry.createdAt), {
          x: xDate,
          y: y - 8,
          size: 8.5,
          font,
          color: COLORS.text,
        });
        page.drawText(typeLabel, {
          x: xType,
          y: y - 8,
          size: 8.5,
          font,
          color: COLORS.text,
        });
        page.drawText(description, {
          x: xRef,
          y: y - 8,
          size: 8.5,
          font,
          color: COLORS.text,
        });
        page.drawText(`${amountPrefix}${this.formatMoney(entry.amount)}`, {
          x: xAmount,
          y: y - 8,
          size: 8.5,
          font,
          color: entry.type === 'debit' ? COLORS.danger : COLORS.text,
        });
        page.drawText(this.formatMoney(entry.balanceAfter), {
          x: xBalance,
          y: y - 8,
          size: 8.5,
          font,
          color: COLORS.text,
        });
        y -= TABLE_ROW_HEIGHT;

        page.drawLine({
          start: { x: MARGIN, y: y + 2 },
          end: { x: PAGE.width - MARGIN, y: y + 2 },
          thickness: 0.5,
          color: COLORS.border,
        });

        if (y - TABLE_ROW_HEIGHT < MARGIN + 50) {
          page = pdf.addPage([PAGE.width, PAGE.height]);
          y = PAGE.height - MARGIN;
          drawLedgerHeader();
        }
      });
    }

    const pdfBytes = await pdf.save();
    const buffer = Buffer.from(pdfBytes);

    return {
      buffer,
      filename: this.buildFilename(customerName, asOf),
      customerName,
      totalDebt,
      unpaidOrdersCount: unpaidOrders.length,
      generatedAt: asOf,
    };
  }

  private drawHeader(
    page: PDFPage,
    font: PDFFont,
    fontBold: PDFFont,
    params: {
      workspaceName: string;
      generatedAt: Date;
    }
  ): void {
    const title = 'RESUMEN DE CUENTA';
    page.drawText(title, {
      x: MARGIN,
      y: PAGE.height - MARGIN,
      size: 20,
      font: fontBold,
      color: COLORS.text,
    });

    page.drawText(params.workspaceName, {
      x: MARGIN,
      y: PAGE.height - MARGIN - 22,
      size: 10,
      font: fontBold,
      color: COLORS.text,
    });

    page.drawText(`Emitido: ${this.formatDateTime(params.generatedAt)}`, {
      x: MARGIN,
      y: PAGE.height - MARGIN - 36,
      size: 9,
      font,
      color: COLORS.muted,
    });

    page.drawLine({
      start: { x: MARGIN, y: PAGE.height - MARGIN - 48 },
      end: { x: PAGE.width - MARGIN, y: PAGE.height - MARGIN - 48 },
      thickness: 1,
      color: COLORS.border,
    });
  }

  private drawInfoRows(
    page: PDFPage,
    font: PDFFont,
    fontBold: PDFFont,
    y: number,
    rows: Array<{ label: string; value: string; highlight?: boolean }>
  ): number {
    let currentY = y;
    rows.forEach((row) => {
      page.drawText(`${row.label}:`, {
        x: MARGIN,
        y: currentY,
        size: 9.5,
        font: fontBold,
        color: COLORS.text,
      });

      const lines = this.wrapText(row.value || '-', 68);
      lines.forEach((line, index) => {
        page.drawText(line, {
          x: MARGIN + 120,
          y: currentY - index * 12,
          size: 9.5,
          font: row.highlight ? fontBold : font,
          color: row.highlight ? COLORS.danger : COLORS.text,
        });
      });
      currentY -= Math.max(1, lines.length) * 12;
    });
    return currentY;
  }

  private resolveCustomerName(customer: StatementCustomer): string {
    const fullName = [customer.firstName, customer.lastName].filter(Boolean).join(' ').trim();
    if (fullName) return fullName;
    if (customer.businessName?.trim()) return customer.businessName.trim();
    return customer.phone;
  }

  private resolveCustomerDni(metadata: unknown): string | null {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return null;
    }
    const value = (metadata as Record<string, unknown>).dni;
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed || null;
  }

  private resolveWorkspaceName(workspace: StatementWorkspace | null): string {
    if (!workspace) return 'NEXOVA';
    const settings = workspace.settings;
    if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
      const businessName = (settings as Record<string, unknown>).businessName;
      if (typeof businessName === 'string' && businessName.trim()) {
        return businessName.trim();
      }
    }
    return workspace.name || 'NEXOVA';
  }

  private formatDate(date: Date): string {
    return date.toLocaleDateString('es-AR');
  }

  private formatDateTime(date: Date): string {
    const datePart = date.toLocaleDateString('es-AR');
    const timePart = date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    return `${datePart} ${timePart}`;
  }

  private formatMoney(cents: number): string {
    const pesos = cents / 100;
    return `$${new Intl.NumberFormat('es-AR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(pesos)}`;
  }

  private clipText(value: string, maxLength: number): string {
    if (value.length <= maxLength) return value;
    return `${value.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
  }

  private wrapText(value: string, maxCharsPerLine: number): string[] {
    const source = value || '';
    if (source.length <= maxCharsPerLine) return [source];

    const words = source.split(/\s+/).filter(Boolean);
    if (words.length === 0) return [''];

    const lines: string[] = [];
    let current = '';

    words.forEach((word) => {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= maxCharsPerLine) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    });

    if (current) lines.push(current);
    return lines;
  }

  private buildFilename(customerName: string, date: Date): string {
    const safeCustomer = customerName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase() || 'cliente';

    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `resumen_cuenta_${safeCustomer}_${yyyy}${mm}${dd}.pdf`;
  }
}

