/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * RETAIL TOOL SCHEMAS
 * Zod schemas for agent tool inputs/outputs with business rule validation
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════════
// COMMON SCHEMAS & CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

/** Business rule constants - configurable per workspace */
export const BUSINESS_RULES = {
  /** Maximum discount percentage allowed (0-100) */
  MAX_DISCOUNT_PERCENT: 30,
  /** Maximum items per order */
  MAX_ITEMS_PER_ORDER: 50,
  /** Maximum quantity per line item */
  MAX_QUANTITY_PER_ITEM: 100,
  /** Minimum order value for free shipping (in cents) */
  FREE_SHIPPING_THRESHOLD: 50000,
  /** Payment amount threshold requiring receipt attachment (in cents) */
  RECEIPT_REQUIRED_THRESHOLD: 100000,
  /** Stock adjustment limit without manager approval */
  STOCK_ADJUSTMENT_LIMIT: 100,
  /** Order draft expiry in minutes */
  DRAFT_EXPIRY_MINUTES: 30,
} as const;

/** UUID v4 validation */
const uuidSchema = z.string().uuid();

/** Phone number in E.164 format */
const phoneSchema = z.string().regex(/^\+[1-9]\d{1,14}$/, 'Invalid E.164 phone format');

/** Currency code (ISO 4217) */
const currencySchema = z.enum(['ARS', 'USD', 'BRL', 'CLP', 'MXN']);

/** Positive integer (for prices in cents, quantities) */
const positiveInt = z.number().int().positive();

/** Non-negative integer */
const nonNegativeInt = z.number().int().nonnegative();

/** Percentage (0-100) */
const percentageSchema = z.number().min(0).max(100);

/** Idempotency key format */
const idempotencyKeySchema = z.string().min(16).max(64);

// ═══════════════════════════════════════════════════════════════════════════════
// 1. CREATE_ORDER_DRAFT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Creates a new order draft for a customer.
 *
 * @requiresConfirmation false
 * @idempotencyKey `draft:{sessionId}:{timestamp}`
 */
export const CreateOrderDraftInputSchema = z.object({
  /** Customer ID (required if not inferrable from session) */
  customerId: uuidSchema.optional(),
  /** Initial notes for the order */
  notes: z.string().max(500).optional(),
  /** Currency for the order */
  currency: currencySchema.default('ARS'),
  /** Idempotency key to prevent duplicate drafts */
  idempotencyKey: idempotencyKeySchema.optional(),
});

export const CreateOrderDraftOutputSchema = z.object({
  /** Created draft order ID */
  orderId: uuidSchema,
  /** Human-readable order number */
  orderNumber: z.string(),
  /** Current status */
  status: z.literal('draft'),
  /** Draft expiry timestamp (ISO8601) */
  expiresAt: z.string().datetime(),
  /** Message to show customer */
  message: z.string(),
});

export type CreateOrderDraftInput = z.infer<typeof CreateOrderDraftInputSchema>;
export type CreateOrderDraftOutput = z.infer<typeof CreateOrderDraftOutputSchema>;

// ═══════════════════════════════════════════════════════════════════════════════
// 2. ADD_ITEM_TO_DRAFT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Adds a product to the order draft.
 *
 * Business Rules:
 * - Stock must be available (quantity <= available)
 * - Max items per order: 50
 * - Max quantity per item: 100
 * - Discount cannot exceed MAX_DISCOUNT_PERCENT
 *
 * @requiresConfirmation false
 * @idempotencyKey `item:{orderId}:{productId}:{variantId}:{timestamp}`
 */
export const AddItemToDraftInputSchema = z
  .object({
    /** Order draft ID */
    orderId: uuidSchema,
    /** Product ID to add */
    productId: uuidSchema,
    /** Product variant ID (optional) */
    variantId: uuidSchema.optional(),
    /** Quantity to add */
    quantity: z
      .number()
      .int()
      .positive()
      .max(BUSINESS_RULES.MAX_QUANTITY_PER_ITEM, `Maximum ${BUSINESS_RULES.MAX_QUANTITY_PER_ITEM} units per item`),
    /** Line item discount percentage (0-30) */
    discountPercent: percentageSchema
      .max(BUSINESS_RULES.MAX_DISCOUNT_PERCENT, `Discount cannot exceed ${BUSINESS_RULES.MAX_DISCOUNT_PERCENT}%`)
      .default(0),
    /** Item-specific notes */
    notes: z.string().max(200).optional(),
    /** Idempotency key */
    idempotencyKey: idempotencyKeySchema.optional(),
  })
  .refine(
    (data) => data.quantity <= BUSINESS_RULES.MAX_QUANTITY_PER_ITEM,
    { message: `Quantity exceeds maximum allowed (${BUSINESS_RULES.MAX_QUANTITY_PER_ITEM})` }
  );

export const AddItemToDraftOutputSchema = z.object({
  /** Order item ID */
  itemId: uuidSchema,
  /** Order ID */
  orderId: uuidSchema,
  /** Product details */
  product: z.object({
    id: uuidSchema,
    sku: z.string(),
    name: z.string(),
    unitPrice: positiveInt,
  }),
  /** Quantity added */
  quantity: positiveInt,
  /** Line total (after discount) */
  lineTotal: positiveInt,
  /** Discount applied */
  discountAmount: nonNegativeInt,
  /** Current stock available */
  stockAvailable: nonNegativeInt,
  /** Updated order totals */
  orderTotals: z.object({
    subtotal: nonNegativeInt,
    discount: nonNegativeInt,
    tax: nonNegativeInt,
    total: nonNegativeInt,
    itemCount: positiveInt,
  }),
  /** Message to show customer */
  message: z.string(),
});

export type AddItemToDraftInput = z.infer<typeof AddItemToDraftInputSchema>;
export type AddItemToDraftOutput = z.infer<typeof AddItemToDraftOutputSchema>;

// ═══════════════════════════════════════════════════════════════════════════════
// 3. SET_DELIVERY_DETAILS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sets delivery address and shipping method for an order.
 *
 * Business Rules:
 * - Address must be complete (line1, city, country required)
 * - Free shipping if order total >= FREE_SHIPPING_THRESHOLD
 *
 * @requiresConfirmation false
 * @idempotencyKey `delivery:{orderId}:{timestamp}`
 */
export const SetDeliveryDetailsInputSchema = z.object({
  /** Order ID */
  orderId: uuidSchema,
  /** Shipping address */
  address: z.object({
    /** Recipient name */
    recipientName: z.string().min(2).max(100),
    /** Recipient phone */
    recipientPhone: phoneSchema.optional(),
    /** Street address line 1 */
    line1: z.string().min(5).max(255),
    /** Street address line 2 */
    line2: z.string().max(255).optional(),
    /** City */
    city: z.string().min(2).max(100),
    /** State/Province */
    state: z.string().max(100).optional(),
    /** Postal code */
    postalCode: z.string().max(20).optional(),
    /** Country code (ISO 3166-1 alpha-2) */
    country: z.string().length(2).default('AR'),
    /** Delivery instructions */
    instructions: z.string().max(500).optional(),
  }),
  /** Shipping method */
  shippingMethod: z.enum(['standard', 'express', 'pickup', 'same_day']).default('standard'),
  /** Preferred delivery date (ISO8601) */
  preferredDate: z.string().datetime().optional(),
  /** Idempotency key */
  idempotencyKey: idempotencyKeySchema.optional(),
});

export const SetDeliveryDetailsOutputSchema = z.object({
  /** Order ID */
  orderId: uuidSchema,
  /** Validated address */
  address: z.object({
    line1: z.string(),
    city: z.string(),
    country: z.string(),
    formatted: z.string(),
  }),
  /** Shipping method selected */
  shippingMethod: z.string(),
  /** Calculated shipping cost */
  shippingCost: nonNegativeInt,
  /** Whether free shipping was applied */
  freeShipping: z.boolean(),
  /** Estimated delivery date */
  estimatedDelivery: z.string().optional(),
  /** Updated order totals */
  orderTotals: z.object({
    subtotal: nonNegativeInt,
    shipping: nonNegativeInt,
    tax: nonNegativeInt,
    total: nonNegativeInt,
  }),
  /** Message to show customer */
  message: z.string(),
});

export type SetDeliveryDetailsInput = z.infer<typeof SetDeliveryDetailsInputSchema>;
export type SetDeliveryDetailsOutput = z.infer<typeof SetDeliveryDetailsOutputSchema>;

// ═══════════════════════════════════════════════════════════════════════════════
// 4. REQUEST_CONFIRMATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generates order summary and requests customer confirmation.
 * This transitions the order from 'draft' to 'pending_confirmation'.
 *
 * Business Rules:
 * - Order must have at least 1 item
 * - Delivery details must be set
 * - Stock must still be available for all items
 *
 * @requiresConfirmation false (this IS the confirmation request)
 * @idempotencyKey `confirm_request:{orderId}:{timestamp}`
 */
export const RequestConfirmationInputSchema = z.object({
  /** Order ID */
  orderId: uuidSchema,
  /** Include itemized breakdown in message */
  includeBreakdown: z.boolean().default(true),
  /** Custom message to append */
  customMessage: z.string().max(500).optional(),
  /** Idempotency key */
  idempotencyKey: idempotencyKeySchema.optional(),
});

export const RequestConfirmationOutputSchema = z.object({
  /** Order ID */
  orderId: uuidSchema,
  /** Order number */
  orderNumber: z.string(),
  /** New status */
  status: z.literal('pending_confirmation'),
  /** Order summary */
  summary: z.object({
    /** Items in order */
    items: z.array(
      z.object({
        name: z.string(),
        quantity: positiveInt,
        unitPrice: positiveInt,
        lineTotal: positiveInt,
      })
    ),
    /** Delivery address (formatted) */
    deliveryAddress: z.string(),
    /** Shipping method */
    shippingMethod: z.string(),
    /** Totals breakdown */
    totals: z.object({
      subtotal: nonNegativeInt,
      discount: nonNegativeInt,
      shipping: nonNegativeInt,
      tax: nonNegativeInt,
      total: positiveInt,
    }),
  }),
  /** Formatted message for customer */
  confirmationMessage: z.string(),
  /** Confirmation expiry (customer must confirm before this) */
  expiresAt: z.string().datetime(),
  /** Expected confirmation phrases */
  expectedResponses: z.array(z.string()),
});

export type RequestConfirmationInput = z.infer<typeof RequestConfirmationInputSchema>;
export type RequestConfirmationOutput = z.infer<typeof RequestConfirmationOutputSchema>;

// ═══════════════════════════════════════════════════════════════════════════════
// 5. CONFIRM_ORDER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Confirms the order after customer approval.
 * This commits stock reservations and initiates payment.
 *
 * Business Rules:
 * - Order must be in 'pending_confirmation' status
 * - Customer must have explicitly confirmed
 * - Stock reservations must still be valid
 *
 * @requiresConfirmation TRUE - HUMAN MUST CONFIRM
 * @idempotencyKey `confirm:{orderId}:{confirmationToken}`
 */
export const ConfirmOrderInputSchema = z.object({
  /** Order ID */
  orderId: uuidSchema,
  /** Confirmation token (from customer message or action) */
  confirmationToken: z.string().min(1),
  /** Payment method to use */
  paymentMethod: z.enum(['mercadopago', 'cash', 'transfer', 'credit_card', 'debit_card']),
  /** Additional payment instructions */
  paymentInstructions: z.string().max(500).optional(),
  /** Idempotency key */
  idempotencyKey: idempotencyKeySchema.optional(),
});

export const ConfirmOrderOutputSchema = z.object({
  /** Order ID */
  orderId: uuidSchema,
  /** Order number */
  orderNumber: z.string(),
  /** New status */
  status: z.enum(['awaiting_acceptance', 'accepted', 'pending_payment', 'partial_payment', 'paid']),
  /** Payment details */
  payment: z.object({
    /** Payment ID */
    paymentId: uuidSchema,
    /** Payment method */
    method: z.string(),
    /** Amount to pay */
    amount: positiveInt,
    /** Currency */
    currency: currencySchema,
    /** Payment URL (for online payments) */
    paymentUrl: z.string().url().optional(),
    /** Payment instructions (for cash/transfer) */
    instructions: z.string().optional(),
    /** Payment expiry */
    expiresAt: z.string().datetime().optional(),
  }),
  /** Stock committed */
  stockCommitted: z.boolean(),
  /** Message for customer */
  message: z.string(),
});

export type ConfirmOrderInput = z.infer<typeof ConfirmOrderInputSchema>;
export type ConfirmOrderOutput = z.infer<typeof ConfirmOrderOutputSchema>;

// ═══════════════════════════════════════════════════════════════════════════════
// 6. ADJUST_STOCK
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Adjusts stock levels for a product.
 *
 * Business Rules:
 * - Stock cannot go negative
 * - Adjustments > STOCK_ADJUSTMENT_LIMIT require manager approval
 * - Must provide a reason for audit trail
 *
 * @requiresConfirmation TRUE if adjustment > STOCK_ADJUSTMENT_LIMIT
 * @idempotencyKey `stock:{productId}:{variantId}:{reason}:{timestamp}`
 */
export const AdjustStockInputSchema = z
  .object({
    /** Product ID */
    productId: uuidSchema,
    /** Variant ID (optional) */
    variantId: uuidSchema.optional(),
    /** Adjustment type */
    adjustmentType: z.enum([
      'increase',      // Add stock (received shipment)
      'decrease',      // Remove stock (damaged, lost)
      'correction',    // Fix inventory count
      'return',        // Customer return
    ]),
    /** Quantity to adjust (always positive, direction from type) */
    quantity: positiveInt,
    /** Reason for adjustment (required for audit) */
    reason: z.string().min(10).max(500),
    /** Reference document (invoice, return ID, etc.) */
    reference: z.string().max(100).optional(),
    /** Location/warehouse */
    location: z.string().max(100).optional(),
    /** Idempotency key */
    idempotencyKey: idempotencyKeySchema.optional(),
  })
  .refine(
    (data) => data.quantity > 0,
    { message: 'Quantity must be positive' }
  );

export const AdjustStockOutputSchema = z.object({
  /** Stock movement ID */
  movementId: uuidSchema,
  /** Product ID */
  productId: uuidSchema,
  /** Variant ID */
  variantId: uuidSchema.optional(),
  /** Previous quantity */
  previousQuantity: nonNegativeInt,
  /** Adjustment made */
  adjustment: z.number().int(),
  /** New quantity */
  newQuantity: nonNegativeInt,
  /** Reserved quantity (pending orders) */
  reserved: nonNegativeInt,
  /** Available quantity (new - reserved) */
  available: nonNegativeInt,
  /** Whether low stock alert triggered */
  lowStockAlert: z.boolean(),
  /** Whether approval was required */
  approvalRequired: z.boolean(),
  /** Message */
  message: z.string(),
});

export type AdjustStockInput = z.infer<typeof AdjustStockInputSchema>;
export type AdjustStockOutput = z.infer<typeof AdjustStockOutputSchema>;

// ═══════════════════════════════════════════════════════════════════════════════
// 7. REGISTER_PAYMENT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Registers a payment for an order.
 *
 * Business Rules:
 * - Payment amount must match or exceed order total (overpayment handled as credit)
 * - Payments > RECEIPT_REQUIRED_THRESHOLD require receipt attachment
 * - Cash payments require manual confirmation
 *
 * @requiresConfirmation TRUE for cash/transfer payments
 * @idempotencyKey `payment:{orderId}:{externalId}` or `payment:{orderId}:{timestamp}`
 */
export const RegisterPaymentInputSchema = z
  .object({
    /** Order ID */
    orderId: uuidSchema,
    /** Payment method */
    method: z.enum(['mercadopago', 'cash', 'transfer', 'credit_card', 'debit_card', 'other']),
    /** Amount received (in cents) */
    amount: positiveInt,
    /** Currency */
    currency: currencySchema.default('ARS'),
    /** External payment ID (from gateway) */
    externalId: z.string().max(255).optional(),
    /** Payment reference (receipt number, transfer ref) */
    reference: z.string().max(255).optional(),
    /** Notes */
    notes: z.string().max(500).optional(),
    /** Receipt attachment ID (required for large payments) */
    receiptId: uuidSchema.optional(),
    /** Idempotency key */
    idempotencyKey: idempotencyKeySchema.optional(),
  })
  .refine(
    (data) => {
      // Receipt required for large payments (except mercadopago which has its own)
      if (data.amount >= BUSINESS_RULES.RECEIPT_REQUIRED_THRESHOLD && data.method !== 'mercadopago') {
        return data.receiptId !== undefined;
      }
      return true;
    },
    {
      message: `Payments over ${BUSINESS_RULES.RECEIPT_REQUIRED_THRESHOLD / 100} require a receipt attachment`,
      path: ['receiptId'],
    }
  );

export const RegisterPaymentOutputSchema = z.object({
  /** Payment ID */
  paymentId: uuidSchema,
  /** Order ID */
  orderId: uuidSchema,
  /** Order number */
  orderNumber: z.string(),
  /** Payment status */
  status: z.enum(['pending', 'processing', 'completed', 'failed']),
  /** Amount registered */
  amount: positiveInt,
  /** Amount still due (0 if fully paid) */
  amountDue: nonNegativeInt,
  /** Overpayment amount (if any) */
  overpayment: nonNegativeInt,
  /** Updated order status */
  orderStatus: z.string(),
  /** Whether receipt was attached */
  receiptAttached: z.boolean(),
  /** Message */
  message: z.string(),
});

export type RegisterPaymentInput = z.infer<typeof RegisterPaymentInputSchema>;
export type RegisterPaymentOutput = z.infer<typeof RegisterPaymentOutputSchema>;

// ═══════════════════════════════════════════════════════════════════════════════
// 8. ATTACH_RECEIPT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Attaches a receipt or document to a payment/order.
 *
 * Business Rules:
 * - File must be valid type (image, pdf)
 * - Max file size: 10MB
 * - Required for payments > RECEIPT_REQUIRED_THRESHOLD
 *
 * @requiresConfirmation false
 * @idempotencyKey `receipt:{paymentId}:{fileHash}`
 */
export const AttachReceiptInputSchema = z.object({
  /** Payment ID to attach to */
  paymentId: uuidSchema,
  /** File type */
  fileType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  /** File name */
  fileName: z.string().max(255),
  /** File size in bytes (max 10MB) */
  fileSize: z.number().int().positive().max(10 * 1024 * 1024, 'File size cannot exceed 10MB'),
  /** Base64 encoded file content or URL */
  content: z.union([
    z.string().url(),
    z.string().regex(/^data:/, 'Must be data URL or regular URL'),
  ]),
  /** Receipt type */
  receiptType: z.enum(['payment_proof', 'invoice', 'transfer_receipt', 'other']).default('payment_proof'),
  /** Idempotency key */
  idempotencyKey: idempotencyKeySchema.optional(),
});

export const AttachReceiptOutputSchema = z.object({
  /** Attachment ID */
  attachmentId: uuidSchema,
  /** Payment ID */
  paymentId: uuidSchema,
  /** Storage URL */
  url: z.string().url(),
  /** File name */
  fileName: z.string(),
  /** File size */
  fileSize: z.number(),
  /** Upload timestamp */
  uploadedAt: z.string().datetime(),
  /** Message */
  message: z.string(),
});

export type AttachReceiptInput = z.infer<typeof AttachReceiptInputSchema>;
export type AttachReceiptOutput = z.infer<typeof AttachReceiptOutputSchema>;

// ═══════════════════════════════════════════════════════════════════════════════
// 9. GET_CUSTOMER_CONTEXT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Retrieves customer information and history for context.
 *
 * Business Rules:
 * - Only returns data for customers in the same workspace
 * - PII is limited based on data retention settings
 *
 * @requiresConfirmation false
 * @idempotencyKey N/A (read-only)
 */
export const GetCustomerContextInputSchema = z.object({
  /** Customer ID (optional if phone provided) */
  customerId: uuidSchema.optional(),
  /** Customer phone (E.164 format) */
  phone: phoneSchema.optional(),
  /** Include order history */
  includeOrders: z.boolean().default(true),
  /** Maximum orders to return */
  orderLimit: z.number().int().positive().max(20).default(5),
  /** Include preferences */
  includePreferences: z.boolean().default(true),
}).refine(
  (data) => data.customerId !== undefined || data.phone !== undefined,
  { message: 'Either customerId or phone must be provided' }
);

export const GetCustomerContextOutputSchema = z.object({
  /** Customer ID */
  customerId: uuidSchema,
  /** Customer phone */
  phone: z.string(),
  /** Customer name */
  name: z.string().optional(),
  /** Customer status */
  status: z.enum(['active', 'blocked']),
  /** Customer since */
  firstSeenAt: z.string().datetime(),
  /** Last interaction */
  lastSeenAt: z.string().datetime(),
  /** Order statistics */
  stats: z.object({
    totalOrders: nonNegativeInt,
    totalSpent: nonNegativeInt,
    averageOrderValue: nonNegativeInt,
    lastOrderDate: z.string().datetime().optional(),
  }),
  /** Recent orders (if requested) */
  recentOrders: z
    .array(
      z.object({
        orderId: uuidSchema,
        orderNumber: z.string(),
        status: z.string(),
        total: positiveInt,
        itemCount: positiveInt,
        createdAt: z.string().datetime(),
      })
    )
    .optional(),
  /** Customer preferences (if requested) */
  preferences: z
    .object({
      preferredPaymentMethod: z.string().optional(),
      preferredShippingMethod: z.string().optional(),
      defaultAddress: z.string().optional(),
      language: z.string().optional(),
      notes: z.string().optional(),
    })
    .optional(),
  /** Active draft order (if any) */
  activeDraft: z
    .object({
      orderId: uuidSchema,
      orderNumber: z.string(),
      itemCount: positiveInt,
      total: positiveInt,
      expiresAt: z.string().datetime(),
    })
    .optional(),
});

export type GetCustomerContextInput = z.infer<typeof GetCustomerContextInputSchema>;
export type GetCustomerContextOutput = z.infer<typeof GetCustomerContextOutputSchema>;

// ═══════════════════════════════════════════════════════════════════════════════
// 10. LIST_PRODUCTS / SEARCH_PRODUCTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Lists or searches products in the catalog.
 *
 * Business Rules:
 * - Only returns active products (status = 'active')
 * - Respects workspace catalog settings
 * - Stock info included only if requested
 *
 * @requiresConfirmation false
 * @idempotencyKey N/A (read-only)
 */
export const ListProductsInputSchema = z.object({
  /** Search query (name, SKU, keywords) */
  query: z.string().max(200).optional(),
  /** Category filter */
  category: z.string().max(200).optional(),
  /** Price range filter (min) */
  minPrice: nonNegativeInt.optional(),
  /** Price range filter (max) */
  maxPrice: positiveInt.optional(),
  /** Only show in-stock products */
  inStockOnly: z.boolean().default(false),
  /** Include stock information */
  includeStock: z.boolean().default(true),
  /** Include variants */
  includeVariants: z.boolean().default(false),
  /** Sort by */
  sortBy: z.enum(['name', 'price_asc', 'price_desc', 'popularity', 'newest']).default('name'),
  /** Pagination: page number */
  page: z.number().int().positive().default(1),
  /** Pagination: items per page */
  pageSize: z.number().int().positive().max(50).default(10),
});

export const ListProductsOutputSchema = z.object({
  /** Products found */
  products: z.array(
    z.object({
      /** Product ID */
      id: uuidSchema,
      /** SKU */
      sku: z.string(),
      /** Product name */
      name: z.string(),
      /** Short description */
      description: z.string().optional(),
      /** Category */
      category: z.string().optional(),
      /** Price (in cents) */
      price: positiveInt,
      /** Compare-at price (for discounts) */
      comparePrice: positiveInt.optional(),
      /** Currency */
      currency: currencySchema,
      /** Primary image URL */
      imageUrl: z.string().url().optional(),
      /** Stock available (if requested) */
      stockAvailable: nonNegativeInt.optional(),
      /** In stock flag */
      inStock: z.boolean(),
      /** Variants (if requested) */
      variants: z
        .array(
          z.object({
            id: uuidSchema,
            name: z.string(),
            sku: z.string(),
            price: positiveInt.optional(),
            stockAvailable: nonNegativeInt.optional(),
            inStock: z.boolean(),
          })
        )
        .optional(),
    })
  ),
  /** Pagination info */
  pagination: z.object({
    page: z.number(),
    pageSize: z.number(),
    totalItems: z.number(),
    totalPages: z.number(),
    hasMore: z.boolean(),
  }),
  /** Search metadata */
  metadata: z.object({
    query: z.string().optional(),
    category: z.string().optional(),
    appliedFilters: z.array(z.string()),
  }),
});

export type ListProductsInput = z.infer<typeof ListProductsInputSchema>;
export type ListProductsOutput = z.infer<typeof ListProductsOutputSchema>;

// ═══════════════════════════════════════════════════════════════════════════════
// 11. SEND_CATALOG (WhatsApp-specific)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sends a formatted catalog/product list via WhatsApp.
 *
 * Business Rules:
 * - Max 10 products per message (WhatsApp limitation)
 * - Formats output for WhatsApp readability
 *
 * @requiresConfirmation false
 * @idempotencyKey N/A (message sending)
 */
export const SendCatalogInputSchema = z.object({
  /** Product IDs to include (max 10) */
  productIds: z.array(uuidSchema).max(10).optional(),
  /** Category to send */
  category: z.string().optional(),
  /** Search query */
  query: z.string().optional(),
  /** Include prices */
  includePrices: z.boolean().default(true),
  /** Include stock status */
  includeStock: z.boolean().default(true),
  /** Message format */
  format: z.enum(['list', 'carousel', 'detailed']).default('list'),
  /** Custom header message */
  headerMessage: z.string().max(200).optional(),
  /** Custom footer message */
  footerMessage: z.string().max(200).optional(),
}).refine(
  (data) => data.productIds !== undefined || data.category !== undefined || data.query !== undefined,
  { message: 'Must provide productIds, category, or query' }
);

export const SendCatalogOutputSchema = z.object({
  /** Number of products sent */
  productCount: z.number(),
  /** Formatted message content */
  messageContent: z.string(),
  /** Message ID (from channel) */
  messageId: z.string().optional(),
  /** Products included */
  products: z.array(
    z.object({
      id: uuidSchema,
      name: z.string(),
      price: positiveInt,
      inStock: z.boolean(),
    })
  ),
  /** Whether more products available */
  hasMore: z.boolean(),
  /** Message */
  message: z.string(),
});

export type SendCatalogInput = z.infer<typeof SendCatalogInputSchema>;
export type SendCatalogOutput = z.infer<typeof SendCatalogOutputSchema>;

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL REGISTRY METADATA
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Tool metadata for registry
 */
export interface ToolMetadata {
  name: string;
  description: string;
  category: 'query' | 'mutation';
  requiresConfirmation: boolean;
  idempotencyKeyPattern: string | null;
  riskLevel: 'low' | 'medium' | 'high';
  rateLimitPerMinute: number;
}

export const RETAIL_TOOLS_METADATA: Record<string, ToolMetadata> = {
  create_order_draft: {
    name: 'create_order_draft',
    description: 'Creates a new order draft for the customer',
    category: 'mutation',
    requiresConfirmation: false,
    idempotencyKeyPattern: 'draft:{sessionId}:{timestamp}',
    riskLevel: 'low',
    rateLimitPerMinute: 10,
  },
  add_item_to_draft: {
    name: 'add_item_to_draft',
    description: 'Adds a product to the current order draft',
    category: 'mutation',
    requiresConfirmation: false,
    idempotencyKeyPattern: 'item:{orderId}:{productId}:{variantId}:{timestamp}',
    riskLevel: 'low',
    rateLimitPerMinute: 30,
  },
  set_delivery_details: {
    name: 'set_delivery_details',
    description: 'Sets delivery address and shipping method for the order',
    category: 'mutation',
    requiresConfirmation: false,
    idempotencyKeyPattern: 'delivery:{orderId}:{timestamp}',
    riskLevel: 'low',
    rateLimitPerMinute: 10,
  },
  request_confirmation: {
    name: 'request_confirmation',
    description: 'Shows order summary and requests customer confirmation',
    category: 'mutation',
    requiresConfirmation: false,
    idempotencyKeyPattern: 'confirm_request:{orderId}:{timestamp}',
    riskLevel: 'low',
    rateLimitPerMinute: 5,
  },
  confirm_order: {
    name: 'confirm_order',
    description: 'Confirms the order after customer approval - COMMITS STOCK AND INITIATES PAYMENT',
    category: 'mutation',
    requiresConfirmation: true, // HUMAN MUST CONFIRM
    idempotencyKeyPattern: 'confirm:{orderId}:{confirmationToken}',
    riskLevel: 'high',
    rateLimitPerMinute: 5,
  },
  adjust_stock: {
    name: 'adjust_stock',
    description: 'Adjusts inventory stock levels',
    category: 'mutation',
    requiresConfirmation: true, // For large adjustments
    idempotencyKeyPattern: 'stock:{productId}:{variantId}:{reason}:{timestamp}',
    riskLevel: 'high',
    rateLimitPerMinute: 20,
  },
  register_payment: {
    name: 'register_payment',
    description: 'Registers a payment for an order',
    category: 'mutation',
    requiresConfirmation: true, // For cash/transfer
    idempotencyKeyPattern: 'payment:{orderId}:{externalId}',
    riskLevel: 'high',
    rateLimitPerMinute: 10,
  },
  attach_receipt: {
    name: 'attach_receipt',
    description: 'Attaches a receipt or proof of payment',
    category: 'mutation',
    requiresConfirmation: false,
    idempotencyKeyPattern: 'receipt:{paymentId}:{fileHash}',
    riskLevel: 'low',
    rateLimitPerMinute: 10,
  },
  get_customer_context: {
    name: 'get_customer_context',
    description: 'Retrieves customer information and order history',
    category: 'query',
    requiresConfirmation: false,
    idempotencyKeyPattern: null,
    riskLevel: 'low',
    rateLimitPerMinute: 30,
  },
  list_products: {
    name: 'list_products',
    description: 'Lists or searches products in the catalog',
    category: 'query',
    requiresConfirmation: false,
    idempotencyKeyPattern: null,
    riskLevel: 'low',
    rateLimitPerMinute: 60,
  },
  send_catalog: {
    name: 'send_catalog',
    description: 'Sends formatted product catalog via WhatsApp',
    category: 'mutation',
    requiresConfirmation: false,
    idempotencyKeyPattern: null,
    riskLevel: 'low',
    rateLimitPerMinute: 10,
  },
};
