/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CATALOG PDF TYPES
 * Type definitions for PDF catalog generation
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export interface CatalogProductFilter {
  /** Filter by category (partial match) */
  category?: string;
  /** Filter by product status */
  status?: 'active' | 'draft' | 'archived';
  /** Only include products with stock above this quantity */
  minStock?: number;
  /** Maximum price filter */
  maxPrice?: number;
  /** Minimum price filter */
  minPrice?: number;
  /** Search by name or SKU */
  search?: string;
  /** Specific product IDs to include */
  productIds?: string[];
  /** Maximum number of products to include */
  limit?: number;
}

export interface CatalogProduct {
  id: string;
  sku: string;
  name: string;
  unit?: string | null;
  unitValue?: string | null;
  secondaryUnit?: string | null;
  secondaryUnitValue?: string | null;
  displayName?: string;
  shortDesc: string | null;
  category: string | null;
  price: number;
  comparePrice: number | null;
  currency: string;
  images: string[];
  stock: number;
}

export interface CatalogOptions {
  /** Title for the catalog header */
  title?: string;
  /** Optional logo URL or data URI to display in header */
  logoUrl?: string;
  /** Include product images in PDF */
  includeImages?: boolean;
  /** Show stock levels */
  showStock?: boolean;
  /** Show compare prices (discounts) */
  showComparePrice?: boolean;
  /** Page size */
  pageSize?: 'A4' | 'LETTER';
  /** Products per page */
  productsPerPage?: number;
  /** Include page numbers */
  showPageNumbers?: boolean;
  /** Workspace name for footer */
  workspaceName?: string;
  /** Currency formatting locale */
  locale?: string;
}

export interface CatalogResult {
  /** File reference for storage */
  fileRef: string;
  /** PDF buffer */
  buffer: Buffer;
  /** File size in bytes */
  size: number;
  /** Number of products included */
  productCount: number;
  /** Number of pages */
  pageCount: number;
  /** Generation timestamp */
  generatedAt: Date;
  /** Filename suggestion */
  filename: string;
}

export const DEFAULT_CATALOG_OPTIONS: Required<CatalogOptions> = {
  title: 'Catálogo de Productos',
  logoUrl: '',
  includeImages: true,
  showStock: true,
  showComparePrice: true,
  pageSize: 'A4',
  productsPerPage: 10,
  showPageNumbers: true,
  workspaceName: '',
  locale: 'es-AR',
};
