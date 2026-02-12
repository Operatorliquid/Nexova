/**
 * ARCA Invoice PDF Service
 * Generates a simple, printable invoice PDF (for WhatsApp delivery).
 *
 * NOTE: AFIP/ARCA WSFEv1 doesn't provide a "download PDF" in this flow.
 * We generate a PDF representation with the authorized invoice data we store.
 */

import { PDFDocument, PDFFont, rgb, StandardFonts } from 'pdf-lib';

const PAGE = { width: 595, height: 842 }; // A4
const MARGIN = 36;
const LINE_GAP = 14;

const COLORS = {
  text: rgb(0.1, 0.1, 0.1),
  muted: rgb(0.45, 0.45, 0.45),
  border: rgb(0.86, 0.86, 0.86),
  headerBg: rgb(0.97, 0.97, 0.97),
};

export interface ArcaInvoicePdfItem {
  name: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
}

export interface ArcaInvoicePdfData {
  businessName: string;
  invoiceLabel: string;
  invoiceNumber: string;
  orderNumber: string;
  issuedAt: Date;
  cae?: string | null;
  caeExpiresAt?: Date | null;
  customerName: string;
  customerPhone: string;
  totalCents: number;
  items?: ArcaInvoicePdfItem[];
}

export class ArcaInvoicePdfService {
  async generateInvoicePdf(data: ArcaInvoicePdfData): Promise<{ buffer: Buffer; filename: string }> {
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let page = pdfDoc.addPage([PAGE.width, PAGE.height]);
    let y = PAGE.height - MARGIN;

    y = this.drawHeader(page, font, fontBold, y, data);
    y -= 18;

    y = this.drawInfoBlock(page, font, fontBold, y, [
      { label: 'Cliente', value: data.customerName || '-' },
      { label: 'Telefono', value: data.customerPhone || '-' },
      { label: 'Pedido', value: data.orderNumber || '-' },
      { label: 'Total', value: this.formatMoney(data.totalCents) },
    ]);

    if (data.items && data.items.length > 0) {
      y -= 12;
      y = this.drawTableHeader(page, fontBold, y);
      y -= 6;

      for (const item of data.items) {
        if (y < MARGIN + 90) {
          page = pdfDoc.addPage([PAGE.width, PAGE.height]);
          y = PAGE.height - MARGIN;
          y = this.drawTableHeader(page, fontBold, y);
          y -= 6;
        }
        y = this.drawItemRow(page, font, y, item);
      }
    }

    const pdfBytes = await pdfDoc.save();
    const buffer = Buffer.from(pdfBytes);
    const filename = `factura_${this.sanitizeFilename(data.orderNumber || 'pedido')}_${this.sanitizeFilename(
      data.invoiceNumber || 'comprobante'
    )}.pdf`;

    return { buffer, filename };
  }

  private drawHeader(
    page: any,
    font: PDFFont,
    fontBold: PDFFont,
    y: number,
    data: ArcaInvoicePdfData
  ): number {
    const title = 'FACTURA';
    page.drawText(title, {
      x: MARGIN,
      y: y - 22,
      size: 18,
      font: fontBold,
      color: COLORS.text,
    });

    page.drawText(data.businessName || 'Nexova', {
      x: MARGIN,
      y: y - 40,
      size: 10,
      font: font,
      color: COLORS.muted,
    });

    const rightX = PAGE.width - MARGIN;
    const label = `${data.invoiceLabel} ${data.invoiceNumber}`;
    const labelWidth = fontBold.widthOfTextAtSize(label, 11);
    page.drawText(label, {
      x: rightX - labelWidth,
      y: y - 24,
      size: 11,
      font: fontBold,
      color: COLORS.text,
    });

    const issued = `Fecha: ${data.issuedAt.toLocaleDateString('es-AR')}`;
    const issuedWidth = font.widthOfTextAtSize(issued, 9);
    page.drawText(issued, {
      x: rightX - issuedWidth,
      y: y - 40,
      size: 9,
      font,
      color: COLORS.muted,
    });

    const cae = data.cae ? `CAE: ${data.cae}` : '';
    if (cae) {
      const caeWidth = font.widthOfTextAtSize(cae, 9);
      page.drawText(cae, {
        x: rightX - caeWidth,
        y: y - 54,
        size: 9,
        font,
        color: COLORS.muted,
      });
    }

    const caeExpires = data.caeExpiresAt ? `Venc. CAE: ${data.caeExpiresAt.toLocaleDateString('es-AR')}` : '';
    if (caeExpires) {
      const expWidth = font.widthOfTextAtSize(caeExpires, 9);
      page.drawText(caeExpires, {
        x: rightX - expWidth,
        y: y - 68,
        size: 9,
        font,
        color: COLORS.muted,
      });
    }

    page.drawLine({
      start: { x: MARGIN, y: y - 80 },
      end: { x: PAGE.width - MARGIN, y: y - 80 },
      thickness: 1,
      color: COLORS.border,
    });

    return y - 92;
  }

  private drawInfoBlock(
    page: any,
    font: PDFFont,
    fontBold: PDFFont,
    y: number,
    rows: Array<{ label: string; value: string }>
  ): number {
    let currentY = y;
    for (const row of rows) {
      page.drawText(`${row.label}:`, {
        x: MARGIN,
        y: currentY,
        size: 10,
        font: fontBold,
        color: COLORS.text,
      });
      page.drawText(row.value || '-', {
        x: MARGIN + 80,
        y: currentY,
        size: 10,
        font,
        color: COLORS.text,
      });
      currentY -= LINE_GAP;
    }
    return currentY;
  }

  private drawTableHeader(page: any, fontBold: PDFFont, y: number): number {
    page.drawRectangle({
      x: MARGIN,
      y: y - 16,
      width: PAGE.width - MARGIN * 2,
      height: 20,
      color: COLORS.headerBg,
      borderColor: COLORS.border,
      borderWidth: 1,
    });

    page.drawText('Producto', {
      x: MARGIN + 6,
      y: y - 12,
      size: 9,
      font: fontBold,
      color: COLORS.text,
    });

    page.drawText('Cant.', {
      x: PAGE.width * 0.62,
      y: y - 12,
      size: 9,
      font: fontBold,
      color: COLORS.text,
    });

    page.drawText('Precio', {
      x: PAGE.width * 0.72,
      y: y - 12,
      size: 9,
      font: fontBold,
      color: COLORS.text,
    });

    page.drawText('Total', {
      x: PAGE.width * 0.84,
      y: y - 12,
      size: 9,
      font: fontBold,
      color: COLORS.text,
    });

    return y - 30;
  }

  private drawItemRow(page: any, font: PDFFont, y: number, item: ArcaInvoicePdfItem): number {
    const name = item.name || '-';
    const qty = String(item.quantity || 0);
    const unitPrice = this.formatMoney(item.unitPriceCents || 0);
    const total = this.formatMoney(item.totalCents || 0);

    page.drawText(this.truncateText(font, name, 9, PAGE.width * 0.58 - MARGIN - 8), {
      x: MARGIN + 6,
      y,
      size: 9,
      font,
      color: COLORS.text,
    });

    page.drawText(qty, {
      x: PAGE.width * 0.62,
      y,
      size: 9,
      font,
      color: COLORS.text,
    });

    page.drawText(unitPrice, {
      x: PAGE.width * 0.72,
      y,
      size: 9,
      font,
      color: COLORS.text,
    });

    page.drawText(total, {
      x: PAGE.width * 0.84,
      y,
      size: 9,
      font,
      color: COLORS.text,
    });

    return y - 14;
  }

  private truncateText(font: PDFFont, text: string, size: number, maxWidth: number): string {
    const trimmed = (text || '').trim();
    if (!trimmed) return trimmed;
    if (font.widthOfTextAtSize(trimmed, size) <= maxWidth) return trimmed;

    const chars = Array.from(trimmed);
    while (chars.length > 0) {
      const candidate = `${chars.slice(0, -1).join('')}…`;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) return candidate;
      chars.pop();
    }
    return '…';
  }

  private formatMoney(cents: number): string {
    return `$${new Intl.NumberFormat('es-AR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format((cents || 0) / 100)}`;
  }

  private sanitizeFilename(name: string): string {
    return (name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  }
}

