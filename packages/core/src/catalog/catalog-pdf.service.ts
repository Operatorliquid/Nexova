/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CATALOG PDF SERVICE
 * Generates PDF catalogs from product stock
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { PDFDocument, PDFImage, PDFPage, PDFFont, rgb, StandardFonts } from 'pdf-lib';
import sharp from 'sharp';
import { PrismaClient, Prisma } from '@prisma/client';
import { promises as fs, existsSync } from 'fs';
import path from 'path';
import {
  CatalogProductFilter,
  CatalogProduct,
  CatalogOptions,
  CatalogResult,
  DEFAULT_CATALOG_OPTIONS,
} from './types.js';
import { randomUUID } from 'crypto';

// Page dimensions in points (1 point = 1/72 inch)
const PAGE_SIZES = {
  A4: { width: 595, height: 842 },
  LETTER: { width: 612, height: 792 },
};

// Layout constants
const MARGIN = 36;
const HEADER_HEIGHT = 150;
const FOOTER_HEIGHT = 24;
const CONTENT_GAP = 10;
const CARD_GAP = 18;
const CARD_HEIGHT = 240;
const CATEGORY_HEADER_HEIGHT = 22;
const HEADER_BAND_HEIGHT = 8;
const LOGO_MAX_WIDTH = 90;
const LOGO_MAX_HEIGHT = 36;

const COLORS = {
  primary: rgb(0.12, 0.43, 0.45),
  headerBg: rgb(0.98, 0.98, 0.97),
  textDark: rgb(0.1, 0.1, 0.1),
  textMuted: rgb(0.45, 0.45, 0.45),
  border: rgb(0.9, 0.9, 0.9),
  cardBg: rgb(0.97, 0.95, 0.94),
  price: rgb(0.15, 0.35, 0.2),
};

const UNIT_SHORT_LABELS: Record<string, string> = {
  unit: 'uds',
  kg: 'kg',
  g: 'g',
  l: 'lts',
  ml: 'ml',
  m: 'm',
  cm: 'cm',
  pack: 'pack',
  dozen: 'doc',
  box: 'caja',
};

const SECONDARY_UNIT_LABELS: Record<string, string> = {
  pack: 'Pack',
  box: 'Caja',
  bundle: 'Bulto',
  dozen: 'Docena',
};

const buildProductDisplayName = (product: {
  name: string;
  unit?: string | null;
  unitValue?: string | null;
  secondaryUnit?: string | null;
  secondaryUnitValue?: string | null;
}) => {
  const unit = product.unit || 'unit';
  const unitValue = product.unitValue?.toString().trim();
  const primarySuffix = unit !== 'unit' && unitValue ? `${unitValue} ${UNIT_SHORT_LABELS[unit] || unit}` : '';
  const secondaryLabel = product.secondaryUnit ? (SECONDARY_UNIT_LABELS[product.secondaryUnit] || product.secondaryUnit) : '';
  const secondaryValue = product.secondaryUnitValue?.toString().trim();
  const secondarySuffix = secondaryLabel ? `${secondaryLabel}${secondaryValue ? ` ${secondaryValue}` : ''}`.trim() : '';

  return [product.name, primarySuffix, secondarySuffix].filter(Boolean).join(' ').trim();
};

interface WorkspaceBranding {
  workspaceName: string;
  businessName: string;
  logoUrl: string;
}

interface CategoryGroup {
  name: string;
  products: CatalogProduct[];
}

export class CatalogPdfService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Generate a PDF catalog for a workspace
   */
  async generateCatalog(
    workspaceId: string,
    filter: CatalogProductFilter = {},
    options: CatalogOptions = {}
  ): Promise<CatalogResult> {
    const opts = { ...DEFAULT_CATALOG_OPTIONS, ...options };

    // Resolve branding for header/footer
    const branding = await this.getWorkspaceBranding(workspaceId);

    if (!options.workspaceName) {
      opts.workspaceName = branding.businessName || branding.workspaceName || opts.workspaceName;
    }

    if (!options.logoUrl && branding.logoUrl) {
      opts.logoUrl = branding.logoUrl;
    }

    // Fetch products matching filter
    const products = await this.fetchProducts(workspaceId, filter);

    if (products.length === 0) {
      throw new CatalogError('No products found matching the filter criteria');
    }

    const grouped = this.groupByCategory(products);

    // Create PDF document
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const pageSize = PAGE_SIZES[opts.pageSize];
    const dateText = `Fecha: ${new Date().toLocaleDateString(opts.locale)}`;

    let logoImage: PDFImage | null = null;
    let logoDims: { width: number; height: number } | null = null;

    if (opts.logoUrl) {
      const logoBuffer = await this.fetchAndProcessImage(
        opts.logoUrl,
        LOGO_MAX_WIDTH * 2,
        LOGO_MAX_HEIGHT * 2
      );
      if (logoBuffer) {
        logoImage = await pdfDoc.embedPng(logoBuffer);
        logoDims = this.scaleToFit(
          logoImage.width,
          logoImage.height,
          LOGO_MAX_WIDTH,
          LOGO_MAX_HEIGHT
        );
      }
    }

    const pages: PDFPage[] = [];
    const imageCache = new Map<string, Buffer>();

    const newPage = (): { page: PDFPage; y: number } => {
      const page = pdfDoc.addPage([pageSize.width, pageSize.height]);
      pages.push(page);

      this.drawHeader(
        page,
        font,
        fontBold,
        {
          title: 'CATÁLOGO',
          businessName: opts.workspaceName || branding.businessName || branding.workspaceName,
          dateText,
          logoImage,
          logoDims,
        },
        pageSize.width
      );

      const y = page.getHeight() - HEADER_HEIGHT - CONTENT_GAP;
      return { page, y };
    };

    let { page, y } = newPage();

    const cardWidth = (pageSize.width - MARGIN * 2 - CARD_GAP) / 2;

    for (const category of grouped) {
      const requiredHeight = CATEGORY_HEADER_HEIGHT + CARD_HEIGHT;
      if (y - requiredHeight < FOOTER_HEIGHT + MARGIN) {
        ({ page, y } = newPage());
      }

      this.drawCategoryHeader(page, fontBold, category.name, y);
      y -= CATEGORY_HEADER_HEIGHT + 8;

      let col = 0;

      for (let i = 0; i < category.products.length; i += 1) {
        if (y - CARD_HEIGHT < FOOTER_HEIGHT + MARGIN) {
          ({ page, y } = newPage());
          this.drawCategoryHeader(page, fontBold, category.name, y);
          y -= CATEGORY_HEADER_HEIGHT + 8;
          col = 0;
        }

        const x = MARGIN + col * (cardWidth + CARD_GAP);
        await this.drawCard(
          pdfDoc,
          page,
          category.products[i],
          x,
          y - CARD_HEIGHT,
          cardWidth,
          CARD_HEIGHT,
          font,
          fontBold,
          opts,
          imageCache
        );

        if (col === 0) {
          col = 1;
        } else {
          col = 0;
          y -= CARD_HEIGHT + CARD_GAP;
        }
      }

      if (col === 1) {
        y -= CARD_HEIGHT + CARD_GAP;
      }

      y -= 6;
    }

    // Draw footers after layout
    pages.forEach((p, index) => {
      this.drawFooter(
        p,
        font,
        index + 1,
        pages.length,
        opts.workspaceName,
        pageSize.width,
        opts.showPageNumbers,
        dateText
      );
    });

    // Generate PDF buffer
    const pdfBytes = await pdfDoc.save();
    const buffer = Buffer.from(pdfBytes);

    // Generate file reference
    const fileRef = `catalog_${workspaceId}_${randomUUID().slice(0, 8)}`;
    const filename = `catalogo_${new Date().toISOString().slice(0, 10)}.pdf`;

    return {
      fileRef,
      buffer,
      size: buffer.length,
      productCount: products.length,
      pageCount: pages.length,
      generatedAt: new Date(),
      filename,
    };
  }

  /**
   * Fetch products matching the filter criteria
   */
  private async fetchProducts(
    workspaceId: string,
    filter: CatalogProductFilter
  ): Promise<CatalogProduct[]> {
    const where: Prisma.ProductWhereInput = {
      workspaceId,
      deletedAt: null,
    };

    // Apply status filter (default to active)
    where.status = filter.status || 'active';

    // Category filter
    if (filter.category) {
      where.category = { contains: filter.category, mode: 'insensitive' };
    }

    // Price filters
    if (filter.minPrice !== undefined || filter.maxPrice !== undefined) {
      where.price = {};
      if (filter.minPrice !== undefined) {
        where.price.gte = filter.minPrice;
      }
      if (filter.maxPrice !== undefined) {
        where.price.lte = filter.maxPrice;
      }
    }

    // Search filter
    if (filter.search) {
      where.OR = [
        { name: { contains: filter.search, mode: 'insensitive' } },
        { sku: { contains: filter.search, mode: 'insensitive' } },
      ];
    }

    // Specific product IDs
    if (filter.productIds && filter.productIds.length > 0) {
      where.id = { in: filter.productIds };
    }

    // Query products with stock information
    const products = await this.prisma.product.findMany({
      where,
      select: {
        id: true,
        sku: true,
        name: true,
        unit: true,
        unitValue: true,
        secondaryUnit: true,
        secondaryUnitValue: true,
        shortDesc: true,
        category: true,
        price: true,
        comparePrice: true,
        currency: true,
        images: true,
        stockItems: {
          select: {
            quantity: true,
            reserved: true,
          },
        },
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      take: filter.limit || 500,
    });

    // Transform and filter by stock
    const result: CatalogProduct[] = [];

    for (const product of products) {
      // Calculate total available stock
      const totalStock = product.stockItems.reduce(
        (sum, item) => sum + (item.quantity - item.reserved),
        0
      );

      // Apply stock filter
      if (filter.minStock !== undefined && totalStock < filter.minStock) {
        continue;
      }

      result.push({
        id: product.id,
        sku: product.sku,
        name: product.name,
        unit: product.unit,
        unitValue: product.unitValue,
        secondaryUnit: product.secondaryUnit,
        secondaryUnitValue: product.secondaryUnitValue,
        displayName: buildProductDisplayName(product),
        shortDesc: product.shortDesc,
        category: product.category,
        price: product.price,
        comparePrice: product.comparePrice,
        currency: product.currency,
        images: product.images as string[],
        stock: totalStock,
      });
    }

    return result;
  }

  private groupByCategory(products: CatalogProduct[]): CategoryGroup[] {
    const groups = new Map<string, CatalogProduct[]>();

    for (const product of products) {
      const key = product.category?.trim() || 'Otros';
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)?.push(product);
    }

    return Array.from(groups.entries()).map(([name, items]) => ({ name, products: items }));
  }

  private async getWorkspaceBranding(workspaceId: string): Promise<WorkspaceBranding> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { name: true, settings: true },
    });

    const settings = (workspace?.settings as Record<string, unknown>) || {};

    return {
      workspaceName: workspace?.name || '',
      businessName: (settings.businessName as string) || '',
      logoUrl: (settings.companyLogo as string) || '',
    };
  }

  private drawHeader(
    page: PDFPage,
    font: PDFFont,
    fontBold: PDFFont,
    header: {
      title: string;
      businessName?: string;
      dateText: string;
      logoImage: PDFImage | null;
      logoDims: { width: number; height: number } | null;
    },
    pageWidth: number
  ): void {
    const pageHeight = page.getHeight();
    const headerBottom = pageHeight - HEADER_HEIGHT;

    page.drawRectangle({
      x: 0,
      y: headerBottom,
      width: pageWidth,
      height: HEADER_HEIGHT,
      color: COLORS.headerBg,
    });

    page.drawRectangle({
      x: 0,
      y: pageHeight - HEADER_BAND_HEIGHT,
      width: pageWidth,
      height: HEADER_BAND_HEIGHT,
      color: COLORS.primary,
    });

    const topTextY = pageHeight - HEADER_BAND_HEIGHT - 18;
    const dateWidth = font.widthOfTextAtSize(header.dateText, 9);
    page.drawText(header.dateText, {
      x: pageWidth - MARGIN - dateWidth,
      y: topTextY,
      size: 9,
      font,
      color: COLORS.textMuted,
    });

    let brandX = MARGIN;
    if (header.logoImage && header.logoDims) {
      const logoY = pageHeight - MARGIN - header.logoDims.height;
      page.drawImage(header.logoImage, {
        x: MARGIN,
        y: logoY,
        width: header.logoDims.width,
        height: header.logoDims.height,
      });
      brandX = MARGIN + header.logoDims.width + 8;
    }

    if (header.businessName) {
      page.drawText(header.businessName, {
        x: brandX,
        y: topTextY,
        size: 10,
        font,
        color: COLORS.textMuted,
      });
    }

    const titleSize = 40;
    const titleWidth = fontBold.widthOfTextAtSize(header.title, titleSize);
    page.drawText(header.title, {
      x: (pageWidth - titleWidth) / 2,
      y: pageHeight - HEADER_HEIGHT + 50,
      size: titleSize,
      font: fontBold,
      color: COLORS.textDark,
    });
  }

  private drawCategoryHeader(
    page: PDFPage,
    fontBold: PDFFont,
    title: string,
    y: number
  ): void {
    page.drawText(title.toUpperCase(), {
      x: MARGIN,
      y: y - CATEGORY_HEADER_HEIGHT + 6,
      size: 11,
      font: fontBold,
      color: COLORS.textMuted,
    });
  }

  private async drawCard(
    pdfDoc: PDFDocument,
    page: PDFPage,
    product: CatalogProduct,
    x: number,
    y: number,
    width: number,
    height: number,
    font: PDFFont,
    fontBold: PDFFont,
    options: Required<CatalogOptions>,
    imageCache: Map<string, Buffer>
  ): Promise<void> {
    page.drawRectangle({
      x,
      y,
      width,
      height,
      color: COLORS.cardBg,
      borderColor: COLORS.border,
      borderWidth: 0.5,
    });

    const padding = 14;
    const titleSize = 14;
    const priceSize = 12;
    const descSize = 9;

    const titleText = product.displayName || product.name;
    const title = this.truncateTextToWidth(titleText, width - padding * 2, fontBold, titleSize);
    const titleY = y + height - padding - titleSize;

    page.drawText(title, {
      x: x + padding,
      y: titleY,
      size: titleSize,
      font: fontBold,
      color: COLORS.textDark,
    });

    const priceText = this.formatPrice(product.price, product.currency, options.locale);
    const priceY = titleY - 18;
    page.drawText(priceText, {
      x: x + padding,
      y: priceY,
      size: priceSize,
      font: fontBold,
      color: COLORS.price,
    });

    if (options.showComparePrice && product.comparePrice && product.comparePrice > product.price) {
      const compareText = this.formatPrice(product.comparePrice, product.currency, options.locale);
      const compareWidth = font.widthOfTextAtSize(compareText, 9);
      const compareX = x + padding + 70;
      const compareY = priceY + 1;
      page.drawText(compareText, {
        x: compareX,
        y: compareY,
        size: 9,
        font,
        color: COLORS.textMuted,
      });
      page.drawLine({
        start: { x: compareX, y: compareY + 4 },
        end: { x: compareX + compareWidth, y: compareY + 4 },
        thickness: 0.4,
        color: COLORS.textMuted,
      });
    }

    if (product.shortDesc) {
      const desc = this.truncateTextToWidth(product.shortDesc, width - padding * 2, font, descSize);
      page.drawText(desc, {
        x: x + padding,
        y: priceY - 16,
        size: descSize,
        font,
        color: COLORS.textMuted,
      });
    }

    if (options.includeImages && product.images.length > 0) {
      const maxImageWidth = width - padding * 2;
      const maxImageHeight = height * 0.45;
      const imageUrl = product.images[0];
      const cacheKey = `${imageUrl}|${Math.round(maxImageWidth)}x${Math.round(maxImageHeight)}`;

      let imageBuffer = imageCache.get(cacheKey) || null;
      if (!imageBuffer) {
        imageBuffer = await this.fetchAndProcessImage(
          imageUrl,
          Math.round(maxImageWidth * 2),
          Math.round(maxImageHeight * 2)
        );
        if (imageBuffer) {
          imageCache.set(cacheKey, imageBuffer);
        }
      }

      if (imageBuffer) {
        const image = await pdfDoc.embedPng(imageBuffer);
        const scaled = this.scaleToFit(image.width, image.height, maxImageWidth, maxImageHeight);
        const imageX = x + (width - scaled.width) / 2;
        const imageY = y + padding;
        page.drawImage(image, {
          x: imageX,
          y: imageY,
          width: scaled.width,
          height: scaled.height,
        });
      }
    }
  }

  private drawFooter(
    page: PDFPage,
    font: PDFFont,
    pageNumber: number,
    totalPages: number,
    workspaceName: string,
    pageWidth: number,
    showPageNumbers: boolean,
    dateText: string
  ): void {
    const y = MARGIN / 2;

    if (workspaceName) {
      page.drawText(workspaceName, {
        x: MARGIN,
        y,
        size: 9,
        font,
        color: COLORS.textMuted,
      });
    }

    if (showPageNumbers) {
      const pageText = `Página ${pageNumber} de ${totalPages}`;
      const textWidth = font.widthOfTextAtSize(pageText, 9);
      page.drawText(pageText, {
        x: pageWidth - MARGIN - textWidth,
        y,
        size: 9,
        font,
        color: COLORS.textMuted,
      });
    }

    const dateWidth = font.widthOfTextAtSize(dateText, 9);
    page.drawText(dateText, {
      x: (pageWidth - dateWidth) / 2,
      y,
      size: 9,
      font,
      color: COLORS.textMuted,
    });
  }

  private async fetchAndProcessImage(
    url: string,
    maxWidth: number,
    maxHeight: number
  ): Promise<Buffer | null> {
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

  private scaleToFit(
    width: number,
    height: number,
    maxWidth: number,
    maxHeight: number
  ): { width: number; height: number } {
    const ratio = Math.min(maxWidth / width, maxHeight / height, 1);
    return {
      width: width * ratio,
      height: height * ratio,
    };
  }

  /**
   * Format price with currency
   */
  private formatPrice(cents: number, currency: string, locale: string): string {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  }

  private truncateTextToWidth(
    text: string,
    maxWidth: number,
    font: PDFFont,
    size: number
  ): string {
    if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;

    let truncated = text;
    while (truncated.length > 0) {
      const test = `${truncated}...`;
      if (font.widthOfTextAtSize(test, size) <= maxWidth) {
        return test;
      }
      truncated = truncated.slice(0, -1);
    }

    return '';
  }
}

/**
 * Error class for catalog operations
 */
export class CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogError';
  }
}
