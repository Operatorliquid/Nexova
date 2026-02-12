/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ORDER RECEIPT PDF SERVICE
 * Generates a printable receipt PDF for an order
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { PDFDocument, PDFImage, PDFFont, rgb, StandardFonts } from 'pdf-lib';
import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { promises as fs, existsSync } from 'fs';

const PAGE = { width: 595, height: 842 }; // A4
const MARGIN = 36;
const CONTENT_GAP = 12;
const ROW_HEIGHT = 18;
const LOGO_MAX_WIDTH = 90;
const LOGO_MAX_HEIGHT = 40;

const COLORS = {
  text: rgb(0.1, 0.1, 0.1),
  muted: rgb(0.45, 0.45, 0.45),
  border: rgb(0.86, 0.86, 0.86),
  headerBg: rgb(0.97, 0.97, 0.97),
};

interface ReceiptOrderItem {
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

interface ReceiptCustomer {
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
}

export interface ReceiptOrder {
  id: string;
  orderNumber: string;
  createdAt: Date;
  status: string;
  subtotal: number;
  shipping: number;
  discount: number;
  total: number;
  paidAmount: number;
  notes?: string | null;
  customer: ReceiptCustomer;
  items: ReceiptOrderItem[];
}

export class OrderReceiptPdfService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async generateReceipt(workspaceId: string, order: ReceiptOrder): Promise<{ buffer: Buffer; filename: string }> {
    const branding = await this.getWorkspaceBranding(workspaceId);

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const { logoImage, logoDims } = await this.loadLogo(pdfDoc, branding.logoUrl);

    const page = pdfDoc.addPage([PAGE.width, PAGE.height]);
    let currentPage = page;
    let y = PAGE.height - MARGIN;

    const dateSource = order.createdAt ? new Date(order.createdAt) : new Date();
    const dateText = dateSource.toLocaleDateString('es-AR');
    const timeText = dateSource.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

    y = this.drawHeader(currentPage, font, fontBold, {
      businessName: branding.businessName || branding.workspaceName,
      orderNumber: order.orderNumber,
      dateText,
      timeText,
      logoImage,
      logoDims,
    });

    y -= CONTENT_GAP;

    const customerName = this.formatCustomerName(order.customer);
    y = this.drawInfoBlock(currentPage, font, fontBold, y, [
      { label: 'Cliente', value: customerName || 'Consumidor final' },
      { label: 'Telefono', value: order.customer.phone || '-' },
      { label: 'Pedido', value: order.orderNumber },
    ]);

    y -= CONTENT_GAP;

    y = this.drawTableHeader(currentPage, fontBold, y);
    y -= 4;

    for (const item of order.items) {
      if (y - ROW_HEIGHT < MARGIN + 120) {
        const continuation = this.addContinuationPage(pdfDoc, fontBold, order.orderNumber);
        currentPage = continuation.page;
        y = continuation.y;
        y = this.drawTableHeader(currentPage, fontBold, y);
        y -= 4;
      }

      this.drawTableRow(currentPage, font, y, item);
      y -= ROW_HEIGHT;
    }

    y -= CONTENT_GAP;

    const pendingAmount = Math.max(0, order.total - order.paidAmount);
    y = this.drawTotals(currentPage, font, fontBold, y, [
      { label: 'Subtotal', value: order.subtotal },
      { label: 'Envio', value: order.shipping },
      { label: 'Descuento', value: order.discount, negative: true },
      { label: 'Total', value: order.total, bold: true },
      { label: 'Pagado', value: order.paidAmount },
      { label: 'Pendiente', value: pendingAmount },
    ]);

    if (order.notes) {
      y -= CONTENT_GAP;
      this.drawNotes(currentPage, font, fontBold, y, order.notes);
    }

    const pdfBytes = await pdfDoc.save();
    const buffer = Buffer.from(pdfBytes);
    const filename = `boleta_${order.orderNumber}.pdf`;

    return { buffer, filename };
  }

  private drawHeader(
    page: any,
    font: PDFFont,
    fontBold: PDFFont,
    params: {
      businessName: string;
      orderNumber: string;
      dateText: string;
      timeText: string;
      logoImage: PDFImage | null;
      logoDims: { width: number; height: number } | null;
    }
  ): number {
    const title = 'BOLETA';
    const titleSize = 24;
    const titleWidth = fontBold.widthOfTextAtSize(title, titleSize);
    const titleY = PAGE.height - MARGIN - titleSize;

    page.drawText(title, {
      x: (PAGE.width - titleWidth) / 2,
      y: titleY,
      size: titleSize,
      font: fontBold,
      color: COLORS.text,
    });

    let leftX = MARGIN;
    let headerBottom = titleY - 18;

    if (params.logoImage && params.logoDims) {
      const logoY = headerBottom - params.logoDims.height + 12;
      page.drawImage(params.logoImage, {
        x: leftX,
        y: logoY,
        width: params.logoDims.width,
        height: params.logoDims.height,
      });
      leftX += params.logoDims.width + 8;
    }

    page.drawText(params.businessName, {
      x: leftX,
      y: headerBottom,
      size: 11,
      font: fontBold,
      color: COLORS.text,
    });

    const orderText = `Pedido: ${params.orderNumber}`;
    const dateText = `Fecha: ${params.dateText}`;
    const timeText = `Hora: ${params.timeText}`;

    const rightBlockX = PAGE.width - MARGIN;
    this.drawRightText(page, font, orderText, rightBlockX, headerBottom + 6, 9, COLORS.text);
    this.drawRightText(page, font, dateText, rightBlockX, headerBottom - 6, 9, COLORS.muted);
    this.drawRightText(page, font, timeText, rightBlockX, headerBottom - 18, 9, COLORS.muted);

    page.drawLine({
      start: { x: MARGIN, y: headerBottom - 28 },
      end: { x: PAGE.width - MARGIN, y: headerBottom - 28 },
      thickness: 1,
      color: COLORS.border,
    });

    return headerBottom - 42;
  }

  private drawInfoBlock(
    page: any,
    font: PDFFont,
    fontBold: PDFFont,
    y: number,
    rows: Array<{ label: string; value: string }>
  ): number {
    let currentY = y;
    rows.forEach((row) => {
      page.drawText(`${row.label}:`, {
        x: MARGIN,
        y: currentY,
        size: 10,
        font: fontBold,
        color: COLORS.text,
      });
      page.drawText(row.value, {
        x: MARGIN + 80,
        y: currentY,
        size: 10,
        font,
        color: COLORS.text,
      });
      currentY -= 14;
    });
    return currentY;
  }

  private drawTableHeader(page: any, fontBold: PDFFont, y: number): number {
    const headerY = y - 4;
    page.drawRectangle({
      x: MARGIN,
      y: headerY - 12,
      width: PAGE.width - MARGIN * 2,
      height: 18,
      color: COLORS.headerBg,
      borderColor: COLORS.border,
      borderWidth: 1,
    });

    page.drawText('Producto', {
      x: MARGIN + 6,
      y: headerY - 8,
      size: 9,
      font: fontBold,
      color: COLORS.text,
    });
    page.drawText('Cant.', {
      x: PAGE.width * 0.6,
      y: headerY - 8,
      size: 9,
      font: fontBold,
      color: COLORS.text,
    });
    page.drawText('Precio', {
      x: PAGE.width * 0.7,
      y: headerY - 8,
      size: 9,
      font: fontBold,
      color: COLORS.text,
    });
    page.drawText('Total', {
      x: PAGE.width * 0.85,
      y: headerY - 8,
      size: 9,
      font: fontBold,
      color: COLORS.text,
    });

    return headerY - 18;
  }

  private drawTableRow(page: any, font: PDFFont, y: number, item: ReceiptOrderItem) {
    const nameMaxWidth = PAGE.width * 0.55 - MARGIN;
    const nameText = this.truncateText(item.name, nameMaxWidth, font, 9);

    page.drawText(nameText, {
      x: MARGIN + 6,
      y,
      size: 9,
      font,
      color: COLORS.text,
    });

    page.drawText(String(item.quantity), {
      x: PAGE.width * 0.6,
      y,
      size: 9,
      font,
      color: COLORS.text,
    });

    this.drawRightText(page, font, this.formatMoney(item.unitPrice), PAGE.width * 0.8, y, 9, COLORS.text);
    this.drawRightText(page, font, this.formatMoney(item.total), PAGE.width - MARGIN, y, 9, COLORS.text);
  }

  private drawTotals(
    page: any,
    font: PDFFont,
    fontBold: PDFFont,
    y: number,
    rows: Array<{ label: string; value: number; bold?: boolean; negative?: boolean }>
  ): number {
    let currentY = y;
    rows.forEach((row) => {
      const labelFont = row.bold ? fontBold : font;
      const valueFont = row.bold ? fontBold : font;
      const label = row.label;
      const value = row.negative ? `- ${this.formatMoney(row.value)}` : this.formatMoney(row.value);

      page.drawText(label, {
        x: PAGE.width * 0.6,
        y: currentY,
        size: 10,
        font: labelFont,
        color: COLORS.text,
      });

      this.drawRightText(page, valueFont, value, PAGE.width - MARGIN, currentY, 10, COLORS.text);
      currentY -= 14;
    });

    return currentY;
  }

  private drawNotes(page: any, font: PDFFont, fontBold: PDFFont, y: number, notes: string) {
    page.drawText('Notas:', {
      x: MARGIN,
      y,
      size: 10,
      font: fontBold,
      color: COLORS.text,
    });
    page.drawText(notes, {
      x: MARGIN + 40,
      y,
      size: 10,
      font,
      color: COLORS.text,
    });
  }

  private addContinuationPage(
    pdfDoc: PDFDocument,
    fontBold: PDFFont,
    orderNumber: string
  ): { page: any; y: number } {
    const page = pdfDoc.addPage([PAGE.width, PAGE.height]);
    page.drawText(`BOLETA - ${orderNumber}`, {
      x: MARGIN,
      y: PAGE.height - MARGIN - 18,
      size: 12,
      font: fontBold,
      color: COLORS.text,
    });
    page.drawLine({
      start: { x: MARGIN, y: PAGE.height - MARGIN - 28 },
      end: { x: PAGE.width - MARGIN, y: PAGE.height - MARGIN - 28 },
      thickness: 1,
      color: COLORS.border,
    });
    return { page, y: PAGE.height - MARGIN - 44 };
  }

  private drawRightText(
    page: any,
    font: PDFFont,
    text: string,
    rightX: number,
    y: number,
    size: number,
    color = COLORS.text
  ) {
    const width = font.widthOfTextAtSize(text, size);
    page.drawText(text, {
      x: rightX - width,
      y,
      size,
      font,
      color,
    });
  }

  private formatMoney(amount: number): string {
    return `$${new Intl.NumberFormat('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(
      amount / 100
    )}`;
  }

  private formatCustomerName(customer: ReceiptCustomer): string {
    const full = [customer.firstName, customer.lastName].filter(Boolean).join(' ').trim();
    return full || '';
  }

  private truncateText(text: string, maxWidth: number, font: PDFFont, size: number): string {
    if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
    let truncated = text;
    while (truncated.length > 0) {
      truncated = truncated.slice(0, -1);
      if (font.widthOfTextAtSize(`${truncated}...`, size) <= maxWidth) {
        return `${truncated}...`;
      }
    }
    return text;
  }

  private async getWorkspaceBranding(workspaceId: string): Promise<{ workspaceName: string; businessName: string; logoUrl: string }> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { name: true, settings: true },
    });

    const settings = (workspace?.settings as Record<string, unknown>) || {};
    return {
      workspaceName: workspace?.name || 'Comercio',
      businessName: (settings.businessName as string) || workspace?.name || 'Comercio',
      logoUrl: (settings.companyLogo as string) || '',
    };
  }

  private async loadLogo(
    pdfDoc: PDFDocument,
    logoUrl: string
  ): Promise<{ logoImage: PDFImage | null; logoDims: { width: number; height: number } | null }> {
    if (!logoUrl) return { logoImage: null, logoDims: null };

    const logoBuffer = await this.fetchAndProcessImage(logoUrl, LOGO_MAX_WIDTH * 2, LOGO_MAX_HEIGHT * 2);
    if (!logoBuffer) return { logoImage: null, logoDims: null };

    const logoImage = await pdfDoc.embedPng(logoBuffer);
    const scale = this.scaleToFit(logoImage.width, logoImage.height, LOGO_MAX_WIDTH, LOGO_MAX_HEIGHT);
    return { logoImage, logoDims: scale };
  }

  private scaleToFit(width: number, height: number, maxWidth: number, maxHeight: number) {
    const widthRatio = maxWidth / width;
    const heightRatio = maxHeight / height;
    const scale = Math.min(widthRatio, heightRatio);
    return { width: width * scale, height: height * scale };
  }

  private async fetchAndProcessImage(url: string, maxWidth: number, maxHeight: number): Promise<Buffer | null> {
    try {
      const inputBuffer = await this.loadImageBuffer(url);
      if (!inputBuffer) return null;

      const processedBuffer = await sharp(inputBuffer)
        .resize(maxWidth, maxHeight, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .png()
        .toBuffer();

      return processedBuffer;
    } catch {
      return null;
    }
  }

  private async loadImageBuffer(url: string): Promise<Buffer | null> {
    if (!url) return null;

    if (url.startsWith('data:')) {
      return this.bufferFromDataUrl(url);
    }

    if (url.startsWith('http://') || url.startsWith('https://')) {
      return this.fetchBuffer(url);
    }

    if (url.startsWith('/uploads/')) {
      const localPath = path.join(this.getUploadDir(), url.replace(/^\/uploads\//, ''));
      try {
        return await fs.readFile(localPath);
      } catch {
        const baseUrl = this.getPublicBaseUrlFromEnv();
        if (baseUrl) {
          return this.fetchBuffer(`${baseUrl}${url}`);
        }
      }
    }

    return null;
  }

  private async fetchBuffer(url: string): Promise<Buffer | null> {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch {
      return null;
    }
  }

  private bufferFromDataUrl(dataUrl: string): Buffer | null {
    const match = dataUrl.match(/^data:[^;]+;base64,(.*)$/);
    if (!match?.[1]) return null;
    try {
      return Buffer.from(match[1], 'base64');
    } catch {
      return null;
    }
  }

  private getUploadDir(): string {
    if (process.env.UPLOAD_DIR) {
      return process.env.UPLOAD_DIR;
    }

    const repoRoot = this.findRepoRoot(process.cwd()) || process.cwd();
    return path.join(repoRoot, 'apps', 'api', 'uploads');
  }

  private getPublicBaseUrlFromEnv(): string | null {
    const candidates = [
      process.env.API_BASE_URL,
      process.env.PUBLIC_BASE_URL,
      process.env.PUBLIC_API_URL,
      process.env.API_PUBLIC_URL,
      process.env.NGROK_URL,
      process.env.BASE_URL,
      process.env.API_URL,
    ];

    for (const candidate of candidates) {
      if (candidate && candidate.trim()) {
        return candidate.replace(/\/$/, '');
      }
    }

    return null;
  }

  private findRepoRoot(startDir: string): string | null {
    let current = startDir;
    for (let i = 0; i < 8; i += 1) {
      if (
        existsSync(path.join(current, 'pnpm-workspace.yaml')) ||
        existsSync(path.join(current, 'turbo.json'))
      ) {
        return current;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return null;
  }
}
