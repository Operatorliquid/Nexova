import Fastify from 'fastify';
import Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { billingRoutes } from '../../src/routes/v1/billing.routes.js';

const ORIGINAL_ENV = {
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
};

function buildBillingTestApp() {
  const app = Fastify({ logger: false });
  const appAny = app as any;

  appAny.decorate('prisma', {});
  appAny.decorate('authenticate', async (request: any) => {
    request.user = { sub: 'user-test', isSuperAdmin: false };
    request.workspaceId = 'ws-test';
  });
  appAny.decorate('requirePermission', () => {
    return async (_request: any, _reply: any) => {};
  });

  app.register(billingRoutes, { prefix: '/billing' });
  return app;
}

describe('billing webhook signature checks', () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_unit_123';
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  afterEach(() => {
    process.env.STRIPE_SECRET_KEY = ORIGINAL_ENV.STRIPE_SECRET_KEY;
    process.env.STRIPE_WEBHOOK_SECRET = ORIGINAL_ENV.STRIPE_WEBHOOK_SECRET;
    vi.restoreAllMocks();
  });

  it('returns 503 when STRIPE_WEBHOOK_SECRET is missing', async () => {
    const app = buildBillingTestApp();
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/billing/webhook',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: 'WEBHOOK_NOT_CONFIGURED' });

    await app.close();
  });

  it('returns 400 when Stripe-Signature header is missing', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_unit_123';
    const app = buildBillingTestApp();
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/billing/webhook',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'MISSING_SIGNATURE' });

    await app.close();
  });

  it('returns 400 when webhook signature is invalid', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_unit_123';
    const app = buildBillingTestApp();
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/billing/webhook',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 'invalid-signature',
      },
      payload: '{}',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'INVALID_SIGNATURE' });

    await app.close();
  });

  it('accepts a valid signed webhook payload', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_unit_123';
    const app = buildBillingTestApp();
    await app.ready();

    const payload = JSON.stringify({
      id: 'evt_test_valid',
      object: 'event',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_test_123',
          object: 'payment_intent',
        },
      },
    });

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const signature = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: process.env.STRIPE_WEBHOOK_SECRET!,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/billing/webhook',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signature,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ received: true });

    await app.close();
  });
});
