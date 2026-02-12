/**
 * Retail Tools Index
 * Exports all retail-specific tools and initializer
 */
import { PrismaClient } from '@prisma/client';
import { BaseTool } from '../base.js';
import { ToolRegistry, toolRegistry } from '../registry.js';
import { MemoryManager } from '../../core/memory-manager.js';
import { LedgerService } from '@nexova/core';
import type { MercadoPagoIntegrationService } from '@nexova/integrations';

// Import tool creators
import { createCustomerTools } from './customer.tools.js';
import { createProductTools } from './product.tools.js';
import { createStockTools } from './stock.tools.js';
import { createCartTools } from './cart.tools.js';
import { createOrderTools } from './order.tools.js';
import { createCommerceTools } from './commerce.tools.js';
import { createSystemTools } from './system.tools.js';
import { createPaymentTools, type PaymentToolsDependencies } from './payment.tools.js';
import { createCatalogTools, type CatalogToolsDependencies, type FileUploader } from './catalog.tools.js';

// Re-export individual tools for direct access if needed
export * from './customer.tools.js';
export * from './product.tools.js';
export * from './stock.tools.js';
export * from './cart.tools.js';
export * from './order.tools.js';
export * from './commerce.tools.js';
export * from './system.tools.js';
export * from './payment.tools.js';
export * from './catalog.tools.js';

/**
 * Dependencies for retail tools initialization
 */
export interface RetailToolsDependencies {
  prisma: PrismaClient;
  memoryManager: MemoryManager;
  ledgerService?: LedgerService;
  mpService?: MercadoPagoIntegrationService;
  catalogDeps?: {
    messageQueue: CatalogToolsDependencies['messageQueue'];
    fileUploader: FileUploader;
  };
}

/**
 * Create all retail tools
 */
export function createAllRetailTools(
  prisma: PrismaClient,
  memoryManager: MemoryManager,
  options?: {
    ledgerService?: LedgerService;
    mpService?: MercadoPagoIntegrationService;
    catalogDeps?: {
      messageQueue: CatalogToolsDependencies['messageQueue'];
      fileUploader: FileUploader;
    };
  }
): BaseTool<any, any>[] {
  const tools = [
    ...createCustomerTools(prisma),
    ...createProductTools(prisma),
    ...createStockTools(prisma),
    ...createCartTools(prisma, memoryManager),
    ...createOrderTools(prisma, memoryManager),
    ...createCommerceTools(prisma, options?.mpService),
    ...createSystemTools(prisma),
  ];

  // Add payment tools if ledger service is available
  if (options?.ledgerService) {
    tools.push(
      ...createPaymentTools({
        prisma,
        ledgerService: options.ledgerService,
        mpService: options.mpService,
      })
    );
  }

  // Add catalog tools if dependencies are available
  if (options?.catalogDeps) {
    tools.push(
      ...createCatalogTools({
        prisma,
        messageQueue: options.catalogDeps.messageQueue,
        fileUploader: options.catalogDeps.fileUploader,
      })
    );
  }

  return tools;
}

/**
 * Initialize retail tools in the registry
 */
export function initializeRetailTools(
  prisma: PrismaClient,
  memoryManager: MemoryManager,
  registry: ToolRegistry = toolRegistry,
  options?: {
    ledgerService?: LedgerService;
    mpService?: MercadoPagoIntegrationService;
    catalogDeps?: {
      messageQueue: CatalogToolsDependencies['messageQueue'];
      fileUploader: FileUploader;
    };
  }
): void {
  // Set memory manager for idempotency
  registry.setMemoryManager(memoryManager);
  registry.setPrisma(prisma);

  // Create and register all tools
  const tools = createAllRetailTools(prisma, memoryManager, options);
  registry.registerAll(tools);

  console.log(`[RetailTools] Initialized ${tools.length} tools`);
}

/**
 * Get list of tool names by category
 */
export function getToolNamesByCategory(): {
  query: string[];
  mutation: string[];
  system: string[];
} {
  const tools = toolRegistry.getAll();

  return {
    query: tools.filter((t) => t.category === 'query').map((t) => t.name),
    mutation: tools.filter((t) => t.category === 'mutation').map((t) => t.name),
    system: tools.filter((t) => t.category === 'system').map((t) => t.name),
  };
}
