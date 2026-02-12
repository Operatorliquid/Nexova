-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "flow_token" VARCHAR(64),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_states" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" VARCHAR(50) NOT NULL,
    "state" VARCHAR(128) NOT NULL,
    "user_id" UUID,
    "flow_token" VARCHAR(64),
    "redirect_uri" VARCHAR(1000),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "oauth_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_checkout_intents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "flow_token" VARCHAR(64) NOT NULL,
    "workspace_id" UUID,
    "user_id" UUID,
    "email" VARCHAR(255),
    "plan" VARCHAR(50) NOT NULL,
    "months" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "status" VARCHAR(30) NOT NULL DEFAULT 'pending_auth',
    "stripe_checkout_session_id" VARCHAR(255),
    "stripe_payment_intent_id" VARCHAR(255),
    "stripe_customer_id" VARCHAR(255),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "billing_checkout_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "user_id" UUID,
    "plan" VARCHAR(50) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'active',
    "billing_cycle_months" INTEGER NOT NULL DEFAULT 1,
    "current_period_start" TIMESTAMP(3) NOT NULL,
    "current_period_end" TIMESTAMP(3) NOT NULL,
    "next_charge_at" TIMESTAMP(3),
    "stripe_customer_id" VARCHAR(255),
    "stripe_subscription_id" VARCHAR(255),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "workspace_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "user_id" UUID,
    "checkout_intent_id" UUID,
    "stripe_checkout_session_id" VARCHAR(255) NOT NULL,
    "stripe_payment_intent_id" VARCHAR(255),
    "stripe_customer_id" VARCHAR(255),
    "amount" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "plan" VARCHAR(50) NOT NULL,
    "months" INTEGER NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'paid',
    "paid_at" TIMESTAMP(3) NOT NULL,
    "next_charge_at" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "billing_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_tokens_token_hash_key" ON "email_verification_tokens"("token_hash");
CREATE INDEX "email_verification_tokens_user_id_idx" ON "email_verification_tokens"("user_id");
CREATE INDEX "email_verification_tokens_expires_at_idx" ON "email_verification_tokens"("expires_at");
CREATE INDEX "email_verification_tokens_flow_token_idx" ON "email_verification_tokens"("flow_token");

CREATE UNIQUE INDEX "oauth_states_state_key" ON "oauth_states"("state");
CREATE INDEX "oauth_states_provider_expires_at_idx" ON "oauth_states"("provider", "expires_at");
CREATE INDEX "oauth_states_flow_token_idx" ON "oauth_states"("flow_token");

CREATE UNIQUE INDEX "billing_checkout_intents_flow_token_key" ON "billing_checkout_intents"("flow_token");
CREATE UNIQUE INDEX "billing_checkout_intents_stripe_checkout_session_id_key" ON "billing_checkout_intents"("stripe_checkout_session_id");
CREATE INDEX "billing_checkout_intents_status_expires_at_idx" ON "billing_checkout_intents"("status", "expires_at");
CREATE INDEX "billing_checkout_intents_workspace_id_idx" ON "billing_checkout_intents"("workspace_id");
CREATE INDEX "billing_checkout_intents_user_id_idx" ON "billing_checkout_intents"("user_id");
CREATE INDEX "billing_checkout_intents_email_idx" ON "billing_checkout_intents"("email");

CREATE UNIQUE INDEX "workspace_subscriptions_workspace_id_key" ON "workspace_subscriptions"("workspace_id");
CREATE UNIQUE INDEX "workspace_subscriptions_stripe_subscription_id_key" ON "workspace_subscriptions"("stripe_subscription_id");
CREATE INDEX "workspace_subscriptions_status_idx" ON "workspace_subscriptions"("status");
CREATE INDEX "workspace_subscriptions_next_charge_at_idx" ON "workspace_subscriptions"("next_charge_at");

CREATE UNIQUE INDEX "billing_payments_stripe_checkout_session_id_key" ON "billing_payments"("stripe_checkout_session_id");
CREATE INDEX "billing_payments_workspace_id_paid_at_idx" ON "billing_payments"("workspace_id", "paid_at");
CREATE INDEX "billing_payments_user_id_paid_at_idx" ON "billing_payments"("user_id", "paid_at");
CREATE INDEX "billing_payments_plan_paid_at_idx" ON "billing_payments"("plan", "paid_at");

-- AddForeignKey
ALTER TABLE "email_verification_tokens"
  ADD CONSTRAINT "email_verification_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "oauth_states"
  ADD CONSTRAINT "oauth_states_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "billing_checkout_intents"
  ADD CONSTRAINT "billing_checkout_intents_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "billing_checkout_intents"
  ADD CONSTRAINT "billing_checkout_intents_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "workspace_subscriptions"
  ADD CONSTRAINT "workspace_subscriptions_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workspace_subscriptions"
  ADD CONSTRAINT "workspace_subscriptions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "billing_payments"
  ADD CONSTRAINT "billing_payments_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "billing_payments"
  ADD CONSTRAINT "billing_payments_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "billing_payments"
  ADD CONSTRAINT "billing_payments_checkout_intent_id_fkey"
  FOREIGN KEY ("checkout_intent_id") REFERENCES "billing_checkout_intents"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
