/**
 * Catalog Tools
 * Tools for generating and sending PDF catalogs
 */
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { BaseTool } from '../base.js';
import { ToolCategory, ToolContext, ToolResult } from '../../types/index.js';
import {
  CatalogPdfService,
  CatalogProductFilter,
  CatalogOptions,
  CatalogResult,
} from '@nexova/core';
import { MessageSendPayload } from '@nexova/shared';

// ═══════════════════════════════════════════════════════════════════════════════
// GENERATE CATALOG PDF TOOL
// ═══════════════════════════════════════════════════════════════════════════════

const GenerateCatalogPdfInputSchema = z.object({
  category: z.string().optional().describe('Filter products by category (partial match)'),
  search: z.string().optional().describe('Search by product name or SKU'),
  minStock: z.number().optional().describe('Only include products with at least this stock'),
  minPrice: z.number().optional().describe('Minimum price filter (in cents)'),
  maxPrice: z.number().optional().describe('Maximum price filter (in cents)'),
  productIds: z.array(z.string()).optional().describe('Specific product IDs to include'),
  limit: z.number().optional().describe('Maximum products to include (default 100)'),
  title: z.string().optional().describe('Custom catalog title'),
  includeImages: z.boolean().optional().describe('Include product images (default true)'),
  showStock: z.boolean().optional().describe('Show stock levels (default true)'),
});

type GenerateCatalogPdfInput = z.infer<typeof GenerateCatalogPdfInputSchema>;

interface GenerateCatalogPdfOutput {
  fileRef: string;
  productCount: number;
  pageCount: number;
  filename: string;
  sizeKb: number;
}

export class GenerateCatalogPdfTool extends BaseTool<
  typeof GenerateCatalogPdfInputSchema,
  GenerateCatalogPdfOutput
> {
  private catalogService: CatalogPdfService;
  private prisma: PrismaClient;
  private catalogStorage: Map<string, CatalogResult>;

  constructor(prisma: PrismaClient, catalogStorage: Map<string, CatalogResult>) {
    super({
      name: 'generate_catalog_pdf',
      description: `Generate a PDF catalog from available stock. Use this when customers ask for a product catalog, price list, or want to see available products in PDF format.

Returns a file_ref that can be sent via WhatsApp using send_pdf_whatsapp tool.

Examples:
- "Mandame el catálogo" → generate_catalog_pdf()
- "Quiero ver los productos de bebidas" → generate_catalog_pdf(category: "bebidas")
- "Catálogo de productos con stock" → generate_catalog_pdf(minStock: 1)`,
      category: ToolCategory.QUERY,
      inputSchema: GenerateCatalogPdfInputSchema,
    });
    this.prisma = prisma;
    this.catalogService = new CatalogPdfService(prisma);
    this.catalogStorage = catalogStorage;
  }

  async execute(
    input: GenerateCatalogPdfInput,
    context: ToolContext
  ): Promise<ToolResult<GenerateCatalogPdfOutput>> {
    try {
      // Get workspace info for catalog title
      const workspace = await this.prisma.workspace.findUnique({
        where: { id: context.workspaceId },
        select: { name: true, settings: true },
      });

      const settings = (workspace?.settings as Record<string, unknown>) || {};
      const businessName =
        (settings.businessName as string) || workspace?.name || 'Productos';
      const logoUrl = (settings.companyLogo as string) || undefined;

      // Build filter
      const filter: CatalogProductFilter = {
        category: input.category,
        search: input.search,
        minStock: input.minStock,
        minPrice: input.minPrice,
        maxPrice: input.maxPrice,
        productIds: input.productIds,
        limit: input.limit || 100,
        status: 'active',
      };

      // Build options
      const options: CatalogOptions = {
        title: input.title || 'Catálogo',
        includeImages: input.includeImages ?? true,
        showStock: false,
        workspaceName: businessName,
        logoUrl,
      };

      // Generate catalog
      const result = await this.catalogService.generateCatalog(
        context.workspaceId,
        filter,
        options
      );

      // Store the buffer for later retrieval
      this.catalogStorage.set(result.fileRef, result);

      // Schedule cleanup after 30 minutes
      setTimeout(() => {
        this.catalogStorage.delete(result.fileRef);
      }, 30 * 60 * 1000);

      return {
        success: true,
        data: {
          fileRef: result.fileRef,
          productCount: result.productCount,
          pageCount: result.pageCount,
          filename: result.filename,
          sizeKb: Math.round(result.size / 1024),
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Error generating catalog: ${message}`,
      };
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEND PDF WHATSAPP TOOL
// ═══════════════════════════════════════════════════════════════════════════════

const SendPdfWhatsappInputSchema = z.object({
  fileRef: z.string().describe('The file reference returned by generate_catalog_pdf'),
  caption: z.string().optional().describe('Optional message to send with the PDF'),
});

type SendPdfWhatsappInput = z.infer<typeof SendPdfWhatsappInputSchema>;

interface SendPdfWhatsappOutput {
  sent: boolean;
  filename: string;
}

export class SendPdfWhatsappTool extends BaseTool<
  typeof SendPdfWhatsappInputSchema,
  SendPdfWhatsappOutput
> {
  private prisma: PrismaClient;
  private messageQueue: Queue<MessageSendPayload>;
  private catalogStorage: Map<string, CatalogResult>;
  private fileUploader: FileUploader;

  constructor(
    prisma: PrismaClient,
    messageQueue: Queue<MessageSendPayload>,
    catalogStorage: Map<string, CatalogResult>,
    fileUploader: FileUploader
  ) {
    super({
      name: 'send_pdf_whatsapp',
      description: `Send a generated PDF catalog to the customer via WhatsApp.

Use this after generate_catalog_pdf to send the catalog to the customer.

Example flow:
1. Customer asks for catalog
2. Call generate_catalog_pdf() → returns fileRef
3. Call send_pdf_whatsapp(fileRef) → sends the PDF`,
      category: ToolCategory.MUTATION,
      inputSchema: SendPdfWhatsappInputSchema,
    });
    this.prisma = prisma;
    this.messageQueue = messageQueue;
    this.catalogStorage = catalogStorage;
    this.fileUploader = fileUploader;
  }

  async execute(
    input: SendPdfWhatsappInput,
    context: ToolContext
  ): Promise<ToolResult<SendPdfWhatsappOutput>> {
    try {
      // Get the stored catalog
      const catalog = this.catalogStorage.get(input.fileRef);
      if (!catalog) {
        return {
          success: false,
          error: 'Catalog not found. It may have expired. Please generate a new catalog.',
        };
      }

      // Get customer phone
      const customer = await this.prisma.customer.findFirst({
        where: { id: context.customerId, workspaceId: context.workspaceId },
        select: { phone: true },
      });

      if (!customer?.phone) {
        return {
          success: false,
          error: 'Customer phone number not found',
        };
      }

      // Upload PDF to media storage and get URL
      const mediaUrl = await this.fileUploader.upload(
        catalog.buffer,
        catalog.filename,
        'application/pdf',
        context.workspaceId
      );

      // Queue message for sending
      await this.messageQueue.add(
        `catalog-${input.fileRef}`,
        {
          workspaceId: context.workspaceId,
          sessionId: context.sessionId,
          to: customer.phone,
          messageType: 'media',
          content: {
            text: input.caption || `📋 ${catalog.filename}`,
            mediaUrl,
            mediaType: 'document',
          },
          correlationId: context.correlationId,
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
        }
      );

      return {
        success: true,
        data: {
          sent: true,
          filename: catalog.filename,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Error sending catalog: ${message}`,
      };
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FILE UPLOADER INTERFACE
// ═══════════════════════════════════════════════════════════════════════════════

export interface FileUploader {
  upload(
    buffer: Buffer,
    filename: string,
    mimeType: string,
    workspaceId: string
  ): Promise<string>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

export interface CatalogToolsDependencies {
  prisma: PrismaClient;
  messageQueue: Queue<MessageSendPayload>;
  fileUploader: FileUploader;
}

// Shared storage for catalog buffers (in-memory, workspace-isolated)
const catalogStorage = new Map<string, CatalogResult>();

export function createCatalogTools(
  deps: CatalogToolsDependencies
): BaseTool<any, any>[] {
  const { prisma, messageQueue, fileUploader } = deps;

  return [
    new GenerateCatalogPdfTool(prisma, catalogStorage),
    new SendPdfWhatsappTool(prisma, messageQueue, catalogStorage, fileUploader),
  ];
}

/**
 * Get catalog buffer by fileRef (for external use, e.g., API download)
 */
export function getCatalogBuffer(fileRef: string): CatalogResult | undefined {
  return catalogStorage.get(fileRef);
}
