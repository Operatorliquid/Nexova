/**
 * ARCA Invoice PDF Service
 * Generates a printable invoice PDF (for WhatsApp delivery).
 *
 * NOTE: AFIP/ARCA WSFEv1 doesn't provide a "download PDF" in this flow.
 * We generate a PDF representation with the authorized invoice data we store.
 */

import { PDFDocument, type PDFFont, type PDFImage, type PDFPage, rgb, StandardFonts } from 'pdf-lib';
import * as QRCode from 'qrcode';

const PAGE = { width: 595, height: 842 }; // A4
const MARGIN = 36;
const TABLE_ROW_HEIGHT = 20;
const TABLE_MAX_ROWS = 14;

const COLORS = {
  pageBg: rgb(1, 1, 1),
  white: rgb(1, 1, 1),
  panelBg: rgb(0.88, 0.88, 0.88),
  panelBgDark: rgb(0.56, 0.56, 0.56),
  textDark: rgb(0.03, 0.03, 0.03),
  textMutedDark: rgb(0.16, 0.16, 0.16),
  borderSoft: rgb(0.45, 0.45, 0.45),
  rowStripe: rgb(0.965, 0.965, 0.965),
};

type PdfColor = ReturnType<typeof rgb>;

export interface ArcaInvoicePdfItem {
  name: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
}

export interface ArcaInvoicePdfData {
  businessName: string;
  issuerAddress?: string | null;
  issuerPhone?: string | null;
  issuerVatCondition?: string | null;
  issuerCuit?: string | null;
  invoiceLabel: string;
  invoiceNumber: string;
  orderNumber: string;
  issuedAt: Date;
  cae?: string | null;
  caeExpiresAt?: Date | null;
  customerName: string;
  customerPhone: string;
  customerAddress?: string | null;
  customerDocument?: string | null;
  customerVatCondition?: string | null;
  saleCondition?: string | null;
  arcaQrUrl?: string | null;
  totalCents: number;
  items?: ArcaInvoicePdfItem[];
}

export class ArcaInvoicePdfService {
  async generateInvoicePdf(data: ArcaInvoicePdfData): Promise<{ buffer: Buffer; filename: string }> {
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const qrImage = await this.buildQrImage(pdfDoc, data.arcaQrUrl || '');

    const page = pdfDoc.addPage([PAGE.width, PAGE.height]);
    this.drawBackground(page);

    const contentTop = PAGE.height - MARGIN;
    const headerBottom = this.drawHeader(page, font, fontBold, contentTop, data);
    const infoBottom = this.drawInfoPanels(page, font, fontBold, headerBottom - 12, data);
    const tableBottom = this.drawItemsTable(page, font, fontBold, infoBottom - 12, data.items || []);
    this.drawTotalsPanel(page, font, fontBold, tableBottom - 6, data.totalCents, data.items || []);
    this.drawFooter(page, font, fontBold, data, qrImage);

    const pdfBytes = await pdfDoc.save();
    const buffer = Buffer.from(pdfBytes);
    const filename = `factura_${this.sanitizeFilename(data.orderNumber || 'pedido')}_${this.sanitizeFilename(
      data.invoiceNumber || 'comprobante'
    )}.pdf`;

    return { buffer, filename };
  }

  private drawBackground(page: PDFPage): void {
    page.drawRectangle({
      x: 0,
      y: 0,
      width: PAGE.width,
      height: PAGE.height,
      color: COLORS.pageBg,
    });
  }

  private drawHeader(
    page: PDFPage,
    font: PDFFont,
    fontBold: PDFFont,
    topY: number,
    data: ArcaInvoicePdfData
  ): number {
    const headerHeight = 122;
    const headerBottom = topY - headerHeight;
    const leftWidth = 310;
    const rightWidth = PAGE.width - MARGIN * 2 - leftWidth - 12;
    const leftX = MARGIN;
    const rightX = leftX + leftWidth + 12;

    const logoBoxW = 98;
    const logoBoxH = 62;
    const logoBoxY = topY - logoBoxH - 8;
    page.drawRectangle({
      x: leftX,
      y: logoBoxY,
      width: logoBoxW,
      height: logoBoxH,
      color: COLORS.white,
    });

    const logoText = this.truncateText(fontBold, this.readSafe(data.businessName).toUpperCase(), 18, logoBoxW - 18);
    page.drawText(logoText || 'NEX', {
      x: leftX + 10,
      y: logoBoxY + 20,
      size: 18,
      font: fontBold,
      color: rgb(0.82, 0.12, 0.13),
    });

    const businessInfoX = leftX + logoBoxW + 10;
    const businessName = this.readSafe(data.businessName).toUpperCase() || 'COMERCIO';
    page.drawText(this.truncateText(fontBold, businessName, 11, leftWidth - logoBoxW - 20), {
      x: businessInfoX,
      y: topY - 20,
      size: 11,
      font: fontBold,
      color: COLORS.textDark,
    });

    const issuerAddress = this.readSafe(data.issuerAddress) || '-';
    const issuerPhone = this.readSafe(data.issuerPhone) || '-';
    const issuerVat = this.readSafe(data.issuerVatCondition) || 'No informado';
    const issuerCuit = this.readSafe(data.issuerCuit) || '-';

    const infoRows = [
      `Domicilio: ${issuerAddress}`,
      `Telefono: ${issuerPhone}`,
      `CUIT: ${issuerCuit}`,
      `IVA: ${issuerVat.toUpperCase()}`,
    ];
    let rowY = topY - 35;
    for (const row of infoRows) {
      page.drawText(this.truncateText(font, row, 8.5, leftWidth - logoBoxW - 16), {
        x: businessInfoX,
        y: rowY,
        size: 8.5,
        font,
        color: COLORS.textDark,
      });
      rowY -= 12;
    }

    const letter = this.resolveInvoiceLetter(data.invoiceLabel);
    const letterBoxSize = 32;
    const letterBoxX = rightX;
    const letterBoxY = topY - 32;
    page.drawRectangle({
      x: letterBoxX,
      y: letterBoxY,
      width: letterBoxSize,
      height: letterBoxSize,
      borderColor: COLORS.textDark,
      borderWidth: 1.2,
    });
    page.drawText(letter, {
      x: letterBoxX + 9,
      y: letterBoxY + 8,
      size: 22,
      font: fontBold,
      color: COLORS.textDark,
    });

    page.drawLine({
      start: { x: letterBoxX + letterBoxSize + 8, y: headerBottom + 6 },
      end: { x: letterBoxX + letterBoxSize + 8, y: topY - 4 },
      thickness: 1,
      color: COLORS.borderSoft,
    });

    const rightInfoX = letterBoxX + letterBoxSize + 18;
    const invoiceTitle = `${this.readSafe(data.invoiceLabel).toUpperCase()} N° ${this.readSafe(data.invoiceNumber)}`;
    page.drawText(this.truncateText(fontBold, invoiceTitle, 11, rightWidth - 54), {
      x: rightInfoX,
      y: topY - 20,
      size: 11,
      font: fontBold,
      color: COLORS.textDark,
    });

    const issuedDateLabel = `Fecha: ${data.issuedAt.toLocaleDateString('es-AR')}`;
    const orderLabel = `Pedido: ${this.readSafe(data.orderNumber)}`;
    const customerDocLabel = `Doc. receptor: ${this.readSafe(data.customerDocument) || '-'}`;
    const cuitLabel = `CUIT emisor: ${issuerCuit}`;

    const rightRows = [issuedDateLabel, cuitLabel, orderLabel, customerDocLabel];
    let rightRowY = topY - 38;
    for (const row of rightRows) {
      page.drawText(this.truncateText(font, row, 8.5, rightWidth - 54), {
        x: rightInfoX,
        y: rightRowY,
        size: 8.5,
        font,
        color: COLORS.textDark,
      });
      rightRowY -= 12;
    }

    return headerBottom;
  }

  private drawInfoPanels(
    page: PDFPage,
    font: PDFFont,
    fontBold: PDFFont,
    topY: number,
    data: ArcaInvoicePdfData
  ): number {
    const panelHeight = 92;
    const panelY = topY - panelHeight;
    const panelWidth = PAGE.width - MARGIN * 2;
    const leftPanelWidth = Math.round(panelWidth * 0.62);
    const rightPanelWidth = panelWidth - leftPanelWidth;
    const leftX = MARGIN;
    const rightX = leftX + leftPanelWidth;

    page.drawRectangle({
      x: leftX,
      y: panelY,
      width: leftPanelWidth,
      height: panelHeight,
      color: COLORS.panelBg,
    });
    page.drawRectangle({
      x: rightX,
      y: panelY,
      width: rightPanelWidth,
      height: panelHeight,
      color: COLORS.panelBg,
    });

    page.drawLine({
      start: { x: rightX, y: panelY },
      end: { x: rightX, y: panelY + panelHeight },
      thickness: 1,
      color: COLORS.borderSoft,
    });

    page.drawText('INFORMACION DEL CLIENTE', {
      x: leftX + 8,
      y: panelY + panelHeight - 16,
      size: 8,
      font: fontBold,
      color: COLORS.textMutedDark,
    });
    page.drawText('CONDICIONES DE VENTA', {
      x: rightX + 8,
      y: panelY + panelHeight - 16,
      size: 8,
      font: fontBold,
      color: COLORS.textMutedDark,
    });

    const customerName = this.readSafe(data.customerName) || 'Consumidor final';
    const customerAddress = this.readSafe(data.customerAddress) || 'No informada';
    const customerVat = this.readSafe(data.customerVatCondition) || 'Consumidor final';
    const phone = this.readSafe(data.customerPhone) || '-';
    const customerDoc = this.readSafe(data.customerDocument) || '-';

    const customerRows = [
      `Cliente: ${customerName}`,
      `Direccion: ${customerAddress}`,
      `Documento: ${customerDoc}`,
      `Telefono: ${phone}`,
      `Condicion: ${customerVat}`,
    ];

    let customerY = panelY + panelHeight - 32;
    for (const row of customerRows) {
      page.drawText(this.truncateText(font, row, 8.3, leftPanelWidth - 16), {
        x: leftX + 8,
        y: customerY,
        size: 8.3,
        font,
        color: COLORS.textDark,
      });
      customerY -= 13;
    }

    const saleRows = [
      `Condicion de venta: ${this.readSafe(data.saleCondition) || 'Cuenta corriente'}`,
      'Moneda: ARS',
      `Comprobante: ${this.readSafe(data.invoiceNumber) || '-'}`,
    ];
    let saleY = panelY + panelHeight - 32;
    for (const row of saleRows) {
      page.drawText(this.truncateText(font, row, 8.3, rightPanelWidth - 16), {
        x: rightX + 8,
        y: saleY,
        size: 8.3,
        font,
        color: COLORS.textDark,
      });
      saleY -= 13;
    }

    return panelY;
  }

  private drawItemsTable(
    page: PDFPage,
    font: PDFFont,
    fontBold: PDFFont,
    topY: number,
    items: ArcaInvoicePdfItem[]
  ): number {
    page.drawText('CONCEPTOS', {
      x: MARGIN,
      y: topY - 2,
      size: 10,
      font: fontBold,
      color: COLORS.textDark,
    });

    const tableTop = topY - 16;
    const tableWidth = PAGE.width - MARGIN * 2;
    const colX = {
      qty: MARGIN,
      code: MARGIN + 46,
      desc: MARGIN + 114,
      unit: MARGIN + 364,
      subtotal: MARGIN + 454,
    };

    page.drawRectangle({
      x: MARGIN,
      y: tableTop - 18,
      width: tableWidth,
      height: 18,
      color: COLORS.panelBgDark,
      borderColor: COLORS.borderSoft,
      borderWidth: 0.8,
    });

    page.drawText('Cantidad', {
      x: colX.qty + 4,
      y: tableTop - 12,
      size: 7.8,
      font: fontBold,
      color: COLORS.textDark,
    });
    page.drawText('Codigo', {
      x: colX.code + 4,
      y: tableTop - 12,
      size: 7.8,
      font: fontBold,
      color: COLORS.textDark,
    });
    page.drawText('Descripcion', {
      x: colX.desc + 4,
      y: tableTop - 12,
      size: 7.8,
      font: fontBold,
      color: COLORS.textDark,
    });
    page.drawText('Precio Unitario', {
      x: colX.unit + 4,
      y: tableTop - 12,
      size: 7.8,
      font: fontBold,
      color: COLORS.textDark,
    });
    page.drawText('Subtotal', {
      x: colX.subtotal + 4,
      y: tableTop - 12,
      size: 7.8,
      font: fontBold,
      color: COLORS.textDark,
    });

    const safeItems = items.slice(0, TABLE_MAX_ROWS);
    const hiddenCount = Math.max(items.length - safeItems.length, 0);
    const rows = hiddenCount > 0
      ? [
          ...safeItems,
          {
            name: `... y ${hiddenCount} item(s) mas`,
            quantity: 0,
            unitPriceCents: 0,
            totalCents: 0,
          },
        ]
      : safeItems;

    const tableBodyTop = tableTop - 18;
    let rowTop = tableBodyTop;
    let rowIndex = 0;
    for (const item of rows) {
      const rowBottom = rowTop - TABLE_ROW_HEIGHT;
      if (rowIndex % 2 === 1) {
        page.drawRectangle({
          x: MARGIN,
          y: rowBottom,
          width: tableWidth,
          height: TABLE_ROW_HEIGHT,
          color: COLORS.rowStripe,
        });
      }
      page.drawRectangle({
        x: MARGIN,
        y: rowBottom,
        width: tableWidth,
        height: TABLE_ROW_HEIGHT,
        borderColor: COLORS.borderSoft,
        borderWidth: 0.8,
      });
      this.drawTableColumnLines(page, rowBottom, TABLE_ROW_HEIGHT);

      const isSummaryRow = item.quantity === 0 && item.unitPriceCents === 0 && item.totalCents === 0;
      page.drawText(isSummaryRow ? '' : this.formatQuantity(item.quantity), {
        x: colX.qty + 4,
        y: rowBottom + 6,
        size: 8,
        font,
        color: COLORS.textDark,
      });
      page.drawText(isSummaryRow ? '' : '-', {
        x: colX.code + 4,
        y: rowBottom + 6,
        size: 8,
        font,
        color: COLORS.textDark,
      });
      page.drawText(this.truncateText(font, item.name || '-', 8, 200), {
        x: colX.desc + 4,
        y: rowBottom + 6,
        size: 8,
        font,
        color: COLORS.textDark,
      });
      this.drawRightText(page, font, isSummaryRow ? '' : this.formatMoney(item.unitPriceCents), colX.subtotal - 8, rowBottom + 6, 8, COLORS.textDark);
      this.drawRightText(page, font, isSummaryRow ? '' : this.formatMoney(item.totalCents), MARGIN + tableWidth - 8, rowBottom + 6, 8, COLORS.textDark);

      rowTop = rowBottom;
      rowIndex += 1;
    }

    return rowTop;
  }

  private drawTableColumnLines(page: PDFPage, rowBottom: number, rowHeight: number): void {
    const xPositions = [MARGIN + 46, MARGIN + 114, MARGIN + 364, MARGIN + 454];
    for (const x of xPositions) {
      page.drawLine({
        start: { x, y: rowBottom },
        end: { x, y: rowBottom + rowHeight },
        thickness: 0.8,
        color: COLORS.borderSoft,
      });
    }
  }

  private drawTotalsPanel(
    page: PDFPage,
    font: PDFFont,
    fontBold: PDFFont,
    topY: number,
    totalCents: number,
    items: ArcaInvoicePdfItem[]
  ): void {
    const width = 300;
    const x = PAGE.width - MARGIN - width;
    const subtotalCents = items.reduce((sum, item) => sum + (item.totalCents || 0), 0) || totalCents;
    const panelTop = topY;

    page.drawRectangle({
      x,
      y: panelTop - 44,
      width,
      height: 20,
      color: COLORS.panelBg,
    });
    page.drawText('Subtotal No Gravado', {
      x: x + 8,
      y: panelTop - 38,
      size: 8.5,
      font,
      color: COLORS.textMutedDark,
    });
    this.drawRightText(page, fontBold, this.formatMoney(subtotalCents), x + width - 10, panelTop - 38, 8.5, COLORS.textMutedDark);

    page.drawRectangle({
      x,
      y: panelTop - 68,
      width,
      height: 24,
      color: COLORS.panelBgDark,
    });
    page.drawText('TOTAL', {
      x: x + 8,
      y: panelTop - 60,
      size: 14,
      font: fontBold,
      color: COLORS.white,
    });
    this.drawRightText(page, fontBold, this.formatMoney(totalCents), x + width - 10, panelTop - 60, 17, COLORS.white);
  }

  private drawFooter(
    page: PDFPage,
    font: PDFFont,
    fontBold: PDFFont,
    data: ArcaInvoicePdfData,
    qrImage: PDFImage | null
  ): void {
    const footerTop = 120;
    page.drawLine({
      start: { x: MARGIN, y: footerTop + 18 },
      end: { x: PAGE.width - MARGIN, y: footerTop + 18 },
      thickness: 2,
      color: COLORS.borderSoft,
    });

    if (qrImage) {
      const qrSize = 92;
      page.drawRectangle({
        x: MARGIN,
        y: footerTop - qrSize + 12,
        width: qrSize,
        height: qrSize,
        color: COLORS.white,
      });
      page.drawImage(qrImage, {
        x: MARGIN + 4,
        y: footerTop - qrSize + 16,
        width: qrSize - 8,
        height: qrSize - 8,
      });
    } else {
      page.drawRectangle({
        x: MARGIN,
        y: footerTop - 80,
        width: 92,
        height: 92,
        borderColor: COLORS.borderSoft,
        borderWidth: 1,
      });
      page.drawText('QR', {
        x: MARGIN + 36,
        y: footerTop - 34,
        size: 12,
        font: fontBold,
        color: COLORS.textDark,
      });
    }

    const textX = MARGIN + 106;
    const cae = this.readSafe(data.cae) || '-';
    const caeExpires = data.caeExpiresAt ? data.caeExpiresAt.toLocaleDateString('es-AR') : '-';
    page.drawText(`CAE N°: ${cae}`, {
      x: textX,
      y: footerTop - 8,
      size: 12,
      font: fontBold,
      color: COLORS.textDark,
    });
    page.drawText(`Fecha de Vto. de CAE: ${caeExpires}`, {
      x: textX,
      y: footerTop - 24,
      size: 8.5,
      font,
      color: COLORS.textDark,
    });
    page.drawText('Comprobante autorizado ARCA - Representacion impresa de comprobante electronico', {
      x: textX,
      y: footerTop - 38,
      size: 7.5,
      font,
      color: COLORS.textDark,
    });
  }

  private async buildQrImage(pdfDoc: PDFDocument, qrUrl: string): Promise<PDFImage | null> {
    const safeUrl = this.readSafe(qrUrl);
    if (!safeUrl) return null;
    try {
      const dataUrl = await QRCode.toDataURL(safeUrl, {
        margin: 1,
        width: 280,
      });
      const base64 = dataUrl.split(',')[1];
      if (!base64) return null;
      return await pdfDoc.embedPng(Buffer.from(base64, 'base64'));
    } catch {
      return null;
    }
  }

  private resolveInvoiceLetter(invoiceLabel: string): string {
    const label = this.readSafe(invoiceLabel).toUpperCase();
    const match = label.match(/\b([ABCEM])\b/);
    if (match && match[1]) return match[1];
    if (label.includes('FACTURA A')) return 'A';
    if (label.includes('FACTURA B')) return 'B';
    if (label.includes('FACTURA C')) return 'C';
    return 'B';
  }

  private readSafe(value?: string | null): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private formatQuantity(quantity: number): string {
    const normalized = Number.isFinite(quantity) ? quantity : 0;
    return new Intl.NumberFormat('es-AR', {
      minimumFractionDigits: normalized % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(normalized);
  }

  private drawRightText(
    page: PDFPage,
    font: PDFFont,
    text: string,
    rightX: number,
    y: number,
    size: number,
    color: PdfColor
  ): void {
    const safeText = text || '';
    const width = font.widthOfTextAtSize(safeText, size);
    page.drawText(safeText, {
      x: rightX - width,
      y,
      size,
      font,
      color,
    });
  }

  private truncateText(font: PDFFont, text: string, size: number, maxWidth: number): string {
    const trimmed = (text || '').trim();
    if (!trimmed) return trimmed;
    if (font.widthOfTextAtSize(trimmed, size) <= maxWidth) return trimmed;

    const chars = Array.from(trimmed);
    while (chars.length > 0) {
      const candidate = `${chars.slice(0, -1).join('')}...`;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) return candidate;
      chars.pop();
    }
    return '...';
  }

  private formatMoney(cents: number): string {
    return `$ ${new Intl.NumberFormat('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format((cents || 0) / 100)}`;
  }

  private sanitizeFilename(name: string): string {
    return (name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  }
}
