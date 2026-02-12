/**
 * Tools Module
 * Exports tool base classes, registry, and retail tools
 */

// Base tool system
export { BaseTool, type ToolConfig, describeParams } from './base.js';
export { ToolRegistry, toolRegistry, type ToolDefinitionForLLM } from './registry.js';

// Retail tools
export {
  initializeRetailTools,
  createAllRetailTools,
  getToolNamesByCategory,
} from './retail/index.js';

// Re-export retail tools for direct access
export * from './retail/customer.tools.js';
export * from './retail/product.tools.js';
export * from './retail/cart.tools.js';
export * from './retail/order.tools.js';
export * from './retail/commerce.tools.js';
export * from './retail/system.tools.js';
