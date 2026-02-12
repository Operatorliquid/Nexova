/**
 * Memory Manager
 * Handles session state, cart, and context in Redis
 */
import type { Redis } from 'ioredis';
import {
  SessionMemory,
  Cart,
  CartItem,
  ShippingAddress,
  AgentState,
  AgentStateType,
  CustomerInfo,
  CommerceProfile,
  PendingConfirmation,
} from '../types/index.js';

const SESSION_TTL = Number(process.env.SESSION_TTL_SECONDS || 60 * 60 * 24 * 7); // default 7 days

export class MemoryManager {
  private redis: Redis;
  private prefix = 'agent:';

  constructor(redis: Redis) {
    this.redis = redis;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SESSION MEMORY
  // ═══════════════════════════════════════════════════════════════════════════════

  private sessionKey(sessionId: string): string {
    return `${this.prefix}session:${sessionId}`;
  }

  /**
   * Get or create session memory
   */
  async getSession(sessionId: string): Promise<SessionMemory | null> {
    const data = await this.redis.get(this.sessionKey(sessionId));
    if (!data) return null;

    const parsed = JSON.parse(data) as SessionMemory;
    // Restore Date objects
    parsed.lastActivityAt = new Date(parsed.lastActivityAt);
    if (parsed.cart) {
      parsed.cart.createdAt = new Date(parsed.cart.createdAt);
      parsed.cart.updatedAt = new Date(parsed.cart.updatedAt);
    }
    return parsed;
  }

  /**
   * Initialize new session
   */
  async initSession(
    sessionId: string,
    workspaceId: string,
    customerId: string
  ): Promise<SessionMemory> {
    const memory: SessionMemory = {
      sessionId,
      workspaceId,
      customerId,
      state: AgentState.IDLE,
      cart: null,
      pendingConfirmation: null,
      context: {
        customerInfo: null,
      },
      lastActivityAt: new Date(),
    };

    await this.saveSession(memory);
    return memory;
  }

  /**
   * Save session memory
   */
  async saveSession(memory: SessionMemory): Promise<void> {
    memory.lastActivityAt = new Date();
    await this.redis.setex(
      this.sessionKey(memory.sessionId),
      SESSION_TTL,
      JSON.stringify(memory)
    );
  }

  /**
   * Update session state
   */
  async updateState(sessionId: string, state: AgentStateType): Promise<void> {
    const memory = await this.getSession(sessionId);
    if (memory) {
      memory.state = state;
      await this.saveSession(memory);
    }
  }

  /**
   * Delete session
   */
  async deleteSession(sessionId: string): Promise<void> {
    await this.redis.del(this.sessionKey(sessionId));
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // CART MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Get cart for session
   */
  async getCart(sessionId: string): Promise<Cart | null> {
    const memory = await this.getSession(sessionId);
    return memory?.cart || null;
  }

  /**
   * Initialize empty cart
   */
  async initCart(
    sessionId: string,
    workspaceId: string,
    customerId: string
  ): Promise<Cart> {
    const cart: Cart = {
      sessionId,
      workspaceId,
      customerId,
      items: [],
      subtotal: 0,
      shipping: 0,
      discount: 0,
      total: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const memory = await this.getSession(sessionId);
    if (memory) {
      memory.cart = cart;
      await this.saveSession(memory);
    }

    return cart;
  }

  /**
   * Add item to cart
   */
  async addToCart(sessionId: string, item: CartItem): Promise<Cart | null> {
    const memory = await this.getSession(sessionId);
    if (!memory) return null;

    if (!memory.cart) {
      memory.cart = {
        sessionId,
        workspaceId: memory.workspaceId,
        customerId: memory.customerId,
        items: [],
        subtotal: 0,
        shipping: 0,
        discount: 0,
        total: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }

    const cart = memory.cart;

    // Check if item already exists
    const existingIndex = cart.items.findIndex(
      (i) => i.productId === item.productId && i.variantId === item.variantId
    );

    if (existingIndex >= 0) {
      // Update quantity
      const existingItem = cart.items[existingIndex]!;
      existingItem.quantity += item.quantity;
      existingItem.total = existingItem.quantity * existingItem.unitPrice;
    } else {
      // Add new item
      cart.items.push(item);
    }

    // Recalculate totals
    this.recalculateCart(cart);
    cart.updatedAt = new Date();

    await this.saveSession(memory);
    return cart;
  }

  /**
   * Update cart item quantity
   */
  async updateCartItem(
    sessionId: string,
    productId: string,
    quantity: number,
    variantId?: string
  ): Promise<Cart | null> {
    const memory = await this.getSession(sessionId);
    if (!memory?.cart) return null;

    const cart = memory.cart;
    const itemIndex = cart.items.findIndex(
      (i) => i.productId === productId && i.variantId === variantId
    );

    if (itemIndex < 0) return cart;

    if (quantity <= 0) {
      // Remove item
      cart.items.splice(itemIndex, 1);
    } else {
      // Update quantity
      const item = cart.items[itemIndex]!;
      item.quantity = quantity;
      item.total = item.unitPrice * quantity;
    }

    this.recalculateCart(cart);
    cart.updatedAt = new Date();

    await this.saveSession(memory);
    return cart;
  }

  /**
   * Remove item from cart
   */
  async removeFromCart(
    sessionId: string,
    productId: string,
    variantId?: string
  ): Promise<Cart | null> {
    return this.updateCartItem(sessionId, productId, 0, variantId);
  }

  /**
   * Clear cart
   */
  async clearCart(sessionId: string): Promise<void> {
    const memory = await this.getSession(sessionId);
    if (memory) {
      memory.cart = null;
      await this.saveSession(memory);
    }
  }

  /**
   * Set shipping address
   */
  async setShippingAddress(
    sessionId: string,
    address: ShippingAddress,
    shippingCost?: number
  ): Promise<Cart | null> {
    const memory = await this.getSession(sessionId);
    if (!memory?.cart) return null;

    const cart = memory.cart;
    cart.shippingAddress = address;
    if (shippingCost !== undefined) {
      cart.shipping = shippingCost;
    }
    this.recalculateCart(cart);

    await this.saveSession(memory);
    return cart;
  }

  /**
   * Set cart notes
   */
  async setCartNotes(sessionId: string, notes: string): Promise<Cart | null> {
    const memory = await this.getSession(sessionId);
    if (!memory?.cart) return null;

    memory.cart.notes = notes;
    memory.cart.updatedAt = new Date();

    await this.saveSession(memory);
    return memory.cart;
  }

  /**
   * Apply discount
   */
  async applyDiscount(sessionId: string, discount: number): Promise<Cart | null> {
    const memory = await this.getSession(sessionId);
    if (!memory?.cart) return null;

    memory.cart.discount = discount;
    this.recalculateCart(memory.cart);

    await this.saveSession(memory);
    return memory.cart;
  }

  private recalculateCart(cart: Cart): void {
    cart.subtotal = cart.items.reduce((sum, item) => sum + item.total, 0);
    cart.total = cart.subtotal + cart.shipping - cart.discount;
    if (cart.total < 0) cart.total = 0;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // CONTEXT MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Set customer info in context
   */
  async setCustomerInfo(sessionId: string, info: CustomerInfo): Promise<void> {
    const memory = await this.getSession(sessionId);
    if (memory) {
      memory.context.customerInfo = info;
      await this.saveSession(memory);
    }
  }

  /**
   * Set commerce profile in context
   */
  async setCommerceProfile(sessionId: string, profile: CommerceProfile): Promise<void> {
    const memory = await this.getSession(sessionId);
    if (memory) {
      memory.context.commerceProfile = profile;
      await this.saveSession(memory);
    }
  }

  /**
   * Set pending order ID
   */
  async setPendingOrderId(sessionId: string, orderId: string): Promise<void> {
    const memory = await this.getSession(sessionId);
    if (memory) {
      memory.context.pendingOrderId = orderId;
      await this.saveSession(memory);
    }
  }

  /**
   * Set interrupted topic (for returning to after answering a question)
   */
  async setInterruptedTopic(sessionId: string, topic: string): Promise<void> {
    const memory = await this.getSession(sessionId);
    if (memory) {
      memory.context.interruptedTopic = topic;
      await this.saveSession(memory);
    }
  }

  /**
   * Clear interrupted topic
   */
  async clearInterruptedTopic(sessionId: string): Promise<void> {
    const memory = await this.getSession(sessionId);
    if (memory) {
      delete memory.context.interruptedTopic;
      await this.saveSession(memory);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // PENDING CONFIRMATION
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Set pending confirmation
   */
  async setPendingConfirmation(
    sessionId: string,
    confirmation: PendingConfirmation
  ): Promise<void> {
    const memory = await this.getSession(sessionId);
    if (memory) {
      memory.pendingConfirmation = confirmation;
      await this.saveSession(memory);
    }
  }

  /**
   * Get pending confirmation
   */
  async getPendingConfirmation(sessionId: string): Promise<PendingConfirmation | null> {
    const memory = await this.getSession(sessionId);
    if (!memory?.pendingConfirmation) return null;

    // Check if expired
    const expiry = new Date(memory.pendingConfirmation.expiresAt);
    if (expiry < new Date()) {
      memory.pendingConfirmation = null;
      await this.saveSession(memory);
      return null;
    }

    return memory.pendingConfirmation;
  }

  /**
   * Clear pending confirmation
   */
  async clearPendingConfirmation(sessionId: string): Promise<void> {
    const memory = await this.getSession(sessionId);
    if (memory) {
      memory.pendingConfirmation = null;
      await this.saveSession(memory);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // IDEMPOTENCY
  // ═══════════════════════════════════════════════════════════════════════════════

  private idempotencyKey(key: string): string {
    return `${this.prefix}idempotency:${key}`;
  }

  /**
   * Check if operation was already executed
   */
  async checkIdempotency(key: string): Promise<boolean> {
    const exists = await this.redis.exists(this.idempotencyKey(key));
    return exists === 1;
  }

  /**
   * Mark operation as executed
   */
  async setIdempotency(key: string, ttlSeconds = 3600): Promise<void> {
    await this.redis.setex(this.idempotencyKey(key), ttlSeconds, '1');
  }

  /**
   * Get stored idempotency value (if any)
   */
  async getIdempotencyValue(key: string): Promise<string | null> {
    return this.redis.get(this.idempotencyKey(key));
  }

  /**
   * Store a custom idempotency value (e.g., orderId)
   */
  async setIdempotencyValue(
    key: string,
    value: string,
    ttlSeconds = 3600
  ): Promise<void> {
    await this.redis.setex(this.idempotencyKey(key), ttlSeconds, value);
  }
}

export function createMemoryManager(redis: Redis): MemoryManager {
  return new MemoryManager(redis);
}
