-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateTable
CREATE TABLE "workspaces" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" VARCHAR(63) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(20),
    "plan" VARCHAR(50) NOT NULL DEFAULT 'free',
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "first_name" VARCHAR(100),
    "last_name" VARCHAR(100),
    "avatar_url" VARCHAR(500),
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending_verification',
    "is_super_admin" BOOLEAN NOT NULL DEFAULT false,
    "email_verified_at" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "mfa_secret" VARCHAR(255),
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "mfa_backup_codes" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'invited',
    "invite_token" VARCHAR(255),
    "invite_expires_at" TIMESTAMP(3),
    "joined_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "resource" VARCHAR(100) NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "effect" VARCHAR(10) NOT NULL DEFAULT 'allow',
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "family" UUID NOT NULL,
    "device_info" VARCHAR(500),
    "ip_address" VARCHAR(45),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "revoke_reason" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_resets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_resets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_numbers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "phone_number" VARCHAR(20) NOT NULL,
    "display_name" VARCHAR(255) NOT NULL,
    "provider" VARCHAR(50) NOT NULL DEFAULT 'infobip',
    "api_key" VARCHAR(255) NOT NULL,
    "api_url" VARCHAR(255) NOT NULL,
    "webhook_secret" VARCHAR(255),
    "provider_config" JSONB NOT NULL DEFAULT '{}',
    "status" VARCHAR(20) NOT NULL DEFAULT 'available',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "health_status" VARCHAR(20),
    "health_checked_at" TIMESTAMP(3),
    "workspace_id" UUID,
    "allowed_roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "last_error" TEXT,
    "last_error_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" VARCHAR(50) NOT NULL DEFAULT 'system',
    "anthropic_key_enc" TEXT,
    "anthropic_key_iv" VARCHAR(32),
    "default_llm_model" VARCHAR(100) NOT NULL DEFAULT 'claude-sonnet-4-20250514',
    "rate_limits" JSONB NOT NULL DEFAULT '{}',
    "feature_flags" JSONB NOT NULL DEFAULT '{}',
    "maintenance_mode" BOOLEAN NOT NULL DEFAULT false,
    "maintenance_msg" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "channel_id" VARCHAR(100) NOT NULL,
    "channel_type" VARCHAR(20) NOT NULL DEFAULT 'whatsapp',
    "current_state" VARCHAR(50) NOT NULL DEFAULT 'IDLE',
    "previous_state" VARCHAR(50),
    "agent_active" BOOLEAN NOT NULL DEFAULT true,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "last_failure" VARCHAR(500),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "end_reason" VARCHAR(50),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "content" TEXT NOT NULL,
    "external_id" VARCHAR(255),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "token_count" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_memories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "key" VARCHAR(255),
    "content" TEXT NOT NULL,
    "importance" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "token_count" INTEGER,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_tool_executions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "correlation_id" UUID NOT NULL,
    "tool_name" VARCHAR(100) NOT NULL,
    "tool_category" VARCHAR(20) NOT NULL,
    "input_params" JSONB NOT NULL,
    "validation_status" VARCHAR(20) NOT NULL,
    "validation_errors" JSONB,
    "confirmation_required" BOOLEAN NOT NULL DEFAULT false,
    "confirmed" BOOLEAN,
    "result_status" VARCHAR(20) NOT NULL,
    "result_data" JSONB,
    "error_message" TEXT,
    "error_code" VARCHAR(50),
    "duration_ms" INTEGER NOT NULL,
    "llm_model" VARCHAR(100),
    "tokens_used" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_tool_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "handoff_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "trigger" VARCHAR(50) NOT NULL,
    "reason" VARCHAR(500),
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "priority" VARCHAR(20) NOT NULL DEFAULT 'normal',
    "claimed_by" UUID,
    "claimed_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "resolution" VARCHAR(1000),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "handoff_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "provider" VARCHAR(50) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'inactive',
    "health_status" VARCHAR(20),
    "health_checked_at" TIMESTAMP(3),
    "last_sync_at" TIMESTAMP(3),
    "credentials_enc" TEXT NOT NULL,
    "credentials_iv" VARCHAR(32) NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "last_error" TEXT,
    "last_error_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_inbox" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "provider" VARCHAR(50) NOT NULL,
    "external_id" VARCHAR(255) NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "signature" VARCHAR(500),
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "correlation_id" UUID,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMP(3),
    "error_message" TEXT,
    "processed_at" TIMESTAMP(3),
    "result" JSONB,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_inbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_outbox" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "aggregate_type" VARCHAR(50) NOT NULL,
    "aggregate_id" VARCHAR(255) NOT NULL,
    "payload" JSONB NOT NULL,
    "correlation_id" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "published_at" TIMESTAMP(3),
    "error_message" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "sku" VARCHAR(100) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "short_desc" VARCHAR(500),
    "category" VARCHAR(500),
    "price" INTEGER NOT NULL,
    "compare_price" INTEGER,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'ARS',
    "tax_rate" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "images" JSONB NOT NULL DEFAULT '[]',
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "sku" VARCHAR(100) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "price" INTEGER,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "images" JSONB NOT NULL DEFAULT '[]',
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "low_threshold" INTEGER NOT NULL DEFAULT 10,
    "location" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "stock_item_id" UUID NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "previous_qty" INTEGER NOT NULL,
    "new_qty" INTEGER NOT NULL,
    "reason" VARCHAR(500),
    "reference_type" VARCHAR(50),
    "reference_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_reservations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "quantity" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "committed_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "email" VARCHAR(255),
    "first_name" VARCHAR(100),
    "last_name" VARCHAR(100),
    "external_id" VARCHAR(255),
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "preferences" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "order_count" INTEGER NOT NULL DEFAULT 0,
    "total_spent" BIGINT NOT NULL DEFAULT 0,
    "last_order_at" TIMESTAMP(3),
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_addresses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "label" VARCHAR(100),
    "line1" VARCHAR(255) NOT NULL,
    "line2" VARCHAR(255),
    "city" VARCHAR(100) NOT NULL,
    "state" VARCHAR(100),
    "postal_code" VARCHAR(20),
    "country" VARCHAR(2) NOT NULL DEFAULT 'AR',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "order_number" VARCHAR(50) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "session_id" UUID,
    "subtotal" INTEGER NOT NULL DEFAULT 0,
    "tax" INTEGER NOT NULL DEFAULT 0,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "shipping" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'ARS',
    "notes" TEXT,
    "internal_notes" TEXT,
    "shipping_address" JSONB,
    "billing_address" JSONB,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "paid_at" TIMESTAMP(3),
    "shipped_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "sku" VARCHAR(100) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" INTEGER NOT NULL,
    "tax" INTEGER NOT NULL DEFAULT 0,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "notes" VARCHAR(500),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "previous_status" VARCHAR(20),
    "new_status" VARCHAR(20) NOT NULL,
    "reason" VARCHAR(500),
    "changed_by" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "provider" VARCHAR(50) NOT NULL,
    "external_id" VARCHAR(255),
    "method" VARCHAR(50),
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "amount" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'ARS',
    "fee" INTEGER NOT NULL DEFAULT 0,
    "net_amount" INTEGER NOT NULL DEFAULT 0,
    "provider_data" JSONB NOT NULL DEFAULT '{}',
    "error_message" TEXT,
    "error_code" VARCHAR(50),
    "payment_url" VARCHAR(1000),
    "initiated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "refunded_at" TIMESTAMP(3),
    "refund_amount" INTEGER,
    "refund_reason" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ref_type" VARCHAR(50) NOT NULL,
    "ref_id" UUID NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "filename" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size" INTEGER NOT NULL,
    "url" VARCHAR(1000) NOT NULL,
    "storage" VARCHAR(20) NOT NULL DEFAULT 's3',
    "uploaded_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "correlation_id" UUID,
    "actor_type" VARCHAR(20) NOT NULL,
    "actor_id" UUID,
    "ip_address" VARCHAR(45),
    "action" VARCHAR(100) NOT NULL,
    "resource_type" VARCHAR(50) NOT NULL,
    "resource_id" UUID,
    "status" VARCHAR(20) NOT NULL,
    "error_code" VARCHAR(50),
    "input_data" JSONB,
    "output_data" JSONB,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "metric" VARCHAR(50) NOT NULL,
    "quantity" BIGINT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_slug_key" ON "workspaces"("slug");

-- CreateIndex
CREATE INDEX "workspaces_status_idx" ON "workspaces"("status");

-- CreateIndex
CREATE INDEX "workspaces_plan_idx" ON "workspaces"("plan");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "users_is_super_admin_idx" ON "users"("is_super_admin");

-- CreateIndex
CREATE INDEX "memberships_workspace_id_idx" ON "memberships"("workspace_id");

-- CreateIndex
CREATE INDEX "memberships_role_id_idx" ON "memberships"("role_id");

-- CreateIndex
CREATE INDEX "memberships_status_idx" ON "memberships"("status");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_user_id_workspace_id_key" ON "memberships"("user_id", "workspace_id");

-- CreateIndex
CREATE INDEX "roles_workspace_id_idx" ON "roles"("workspace_id");

-- CreateIndex
CREATE INDEX "roles_is_system_idx" ON "roles"("is_system");

-- CreateIndex
CREATE UNIQUE INDEX "roles_workspace_id_name_key" ON "roles"("workspace_id", "name");

-- CreateIndex
CREATE INDEX "policies_workspace_id_resource_action_idx" ON "policies"("workspace_id", "resource", "action");

-- CreateIndex
CREATE INDEX "policies_is_active_idx" ON "policies"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "policies_workspace_id_name_key" ON "policies"("workspace_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens"("family");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "password_resets_token_hash_key" ON "password_resets"("token_hash");

-- CreateIndex
CREATE INDEX "password_resets_user_id_idx" ON "password_resets"("user_id");

-- CreateIndex
CREATE INDEX "password_resets_expires_at_idx" ON "password_resets"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_numbers_phone_number_key" ON "whatsapp_numbers"("phone_number");

-- CreateIndex
CREATE INDEX "whatsapp_numbers_status_idx" ON "whatsapp_numbers"("status");

-- CreateIndex
CREATE INDEX "whatsapp_numbers_workspace_id_idx" ON "whatsapp_numbers"("workspace_id");

-- CreateIndex
CREATE INDEX "whatsapp_numbers_provider_idx" ON "whatsapp_numbers"("provider");

-- CreateIndex
CREATE INDEX "whatsapp_numbers_is_active_idx" ON "whatsapp_numbers"("is_active");

-- CreateIndex
CREATE INDEX "agent_sessions_workspace_id_current_state_idx" ON "agent_sessions"("workspace_id", "current_state");

-- CreateIndex
CREATE INDEX "agent_sessions_workspace_id_agent_active_idx" ON "agent_sessions"("workspace_id", "agent_active");

-- CreateIndex
CREATE INDEX "agent_sessions_customer_id_idx" ON "agent_sessions"("customer_id");

-- CreateIndex
CREATE INDEX "agent_sessions_last_activity_at_idx" ON "agent_sessions"("last_activity_at");

-- CreateIndex
CREATE INDEX "agent_sessions_ended_at_idx" ON "agent_sessions"("ended_at");

-- CreateIndex
CREATE UNIQUE INDEX "agent_sessions_workspace_id_channel_id_channel_type_key" ON "agent_sessions"("workspace_id", "channel_id", "channel_type");

-- CreateIndex
CREATE INDEX "agent_messages_session_id_created_at_idx" ON "agent_messages"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_messages_role_idx" ON "agent_messages"("role");

-- CreateIndex
CREATE UNIQUE INDEX "agent_messages_session_id_external_id_key" ON "agent_messages"("session_id", "external_id");

-- CreateIndex
CREATE INDEX "agent_memories_session_id_type_idx" ON "agent_memories"("session_id", "type");

-- CreateIndex
CREATE INDEX "agent_memories_session_id_key_idx" ON "agent_memories"("session_id", "key");

-- CreateIndex
CREATE INDEX "agent_memories_expires_at_idx" ON "agent_memories"("expires_at");

-- CreateIndex
CREATE INDEX "agent_tool_executions_session_id_created_at_idx" ON "agent_tool_executions"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_tool_executions_correlation_id_idx" ON "agent_tool_executions"("correlation_id");

-- CreateIndex
CREATE INDEX "agent_tool_executions_tool_name_idx" ON "agent_tool_executions"("tool_name");

-- CreateIndex
CREATE INDEX "agent_tool_executions_result_status_idx" ON "agent_tool_executions"("result_status");

-- CreateIndex
CREATE INDEX "handoff_requests_workspace_id_status_idx" ON "handoff_requests"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "handoff_requests_workspace_id_priority_created_at_idx" ON "handoff_requests"("workspace_id", "priority", "created_at");

-- CreateIndex
CREATE INDEX "handoff_requests_session_id_idx" ON "handoff_requests"("session_id");

-- CreateIndex
CREATE INDEX "handoff_requests_claimed_by_idx" ON "handoff_requests"("claimed_by");

-- CreateIndex
CREATE INDEX "connections_workspace_id_status_idx" ON "connections"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "connections_provider_idx" ON "connections"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "connections_workspace_id_provider_key" ON "connections"("workspace_id", "provider");

-- CreateIndex
CREATE INDEX "webhook_inbox_workspace_id_status_idx" ON "webhook_inbox"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "webhook_inbox_workspace_id_provider_event_type_idx" ON "webhook_inbox"("workspace_id", "provider", "event_type");

-- CreateIndex
CREATE INDEX "webhook_inbox_status_retry_count_idx" ON "webhook_inbox"("status", "retry_count");

-- CreateIndex
CREATE INDEX "webhook_inbox_correlation_id_idx" ON "webhook_inbox"("correlation_id");

-- CreateIndex
CREATE INDEX "webhook_inbox_received_at_idx" ON "webhook_inbox"("received_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_inbox_workspace_id_provider_external_id_key" ON "webhook_inbox"("workspace_id", "provider", "external_id");

-- CreateIndex
CREATE INDEX "event_outbox_status_idx" ON "event_outbox"("status");

-- CreateIndex
CREATE INDEX "event_outbox_workspace_id_event_type_idx" ON "event_outbox"("workspace_id", "event_type");

-- CreateIndex
CREATE INDEX "event_outbox_aggregate_type_aggregate_id_idx" ON "event_outbox"("aggregate_type", "aggregate_id");

-- CreateIndex
CREATE INDEX "event_outbox_correlation_id_idx" ON "event_outbox"("correlation_id");

-- CreateIndex
CREATE INDEX "event_outbox_created_at_idx" ON "event_outbox"("created_at");

-- CreateIndex
CREATE INDEX "products_workspace_id_status_idx" ON "products"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "products_workspace_id_category_idx" ON "products"("workspace_id", "category");

-- CreateIndex
CREATE INDEX "products_workspace_id_name_idx" ON "products"("workspace_id", "name");

-- CreateIndex
CREATE INDEX "products_deleted_at_idx" ON "products"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "products_workspace_id_sku_key" ON "products"("workspace_id", "sku");

-- CreateIndex
CREATE INDEX "product_variants_product_id_status_idx" ON "product_variants"("product_id", "status");

-- CreateIndex
CREATE INDEX "product_variants_deleted_at_idx" ON "product_variants"("deleted_at");

-- CreateIndex
CREATE INDEX "stock_items_product_id_idx" ON "stock_items"("product_id");

-- CreateIndex
CREATE INDEX "stock_items_variant_id_idx" ON "stock_items"("variant_id");

-- CreateIndex
CREATE INDEX "stock_items_quantity_idx" ON "stock_items"("quantity");

-- CreateIndex
CREATE UNIQUE INDEX "stock_items_product_id_variant_id_location_key" ON "stock_items"("product_id", "variant_id", "location");

-- CreateIndex
CREATE INDEX "stock_movements_stock_item_id_created_at_idx" ON "stock_movements"("stock_item_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_type_idx" ON "stock_movements"("type");

-- CreateIndex
CREATE INDEX "stock_movements_reference_type_reference_id_idx" ON "stock_movements"("reference_type", "reference_id");

-- CreateIndex
CREATE INDEX "stock_reservations_order_id_idx" ON "stock_reservations"("order_id");

-- CreateIndex
CREATE INDEX "stock_reservations_product_id_variant_id_idx" ON "stock_reservations"("product_id", "variant_id");

-- CreateIndex
CREATE INDEX "stock_reservations_status_expires_at_idx" ON "stock_reservations"("status", "expires_at");

-- CreateIndex
CREATE INDEX "customers_workspace_id_email_idx" ON "customers"("workspace_id", "email");

-- CreateIndex
CREATE INDEX "customers_workspace_id_status_idx" ON "customers"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "customers_deleted_at_idx" ON "customers"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "customers_workspace_id_phone_key" ON "customers"("workspace_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "customers_workspace_id_external_id_key" ON "customers"("workspace_id", "external_id");

-- CreateIndex
CREATE INDEX "customer_addresses_customer_id_type_idx" ON "customer_addresses"("customer_id", "type");

-- CreateIndex
CREATE INDEX "orders_workspace_id_status_idx" ON "orders"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "orders_workspace_id_created_at_idx" ON "orders"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_customer_id_idx" ON "orders"("customer_id");

-- CreateIndex
CREATE INDEX "orders_session_id_idx" ON "orders"("session_id");

-- CreateIndex
CREATE INDEX "orders_deleted_at_idx" ON "orders"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "orders_workspace_id_order_number_key" ON "orders"("workspace_id", "order_number");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_items_product_id_idx" ON "order_items"("product_id");

-- CreateIndex
CREATE INDEX "order_status_history_order_id_created_at_idx" ON "order_status_history"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "payments_order_id_idx" ON "payments"("order_id");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE INDEX "payments_external_id_idx" ON "payments"("external_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_external_id_key" ON "payments"("provider", "external_id");

-- CreateIndex
CREATE INDEX "attachments_ref_type_ref_id_idx" ON "attachments"("ref_type", "ref_id");

-- CreateIndex
CREATE INDEX "attachments_type_idx" ON "attachments"("type");

-- CreateIndex
CREATE INDEX "audit_logs_workspace_id_created_at_idx" ON "audit_logs"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_workspace_id_action_idx" ON "audit_logs"("workspace_id", "action");

-- CreateIndex
CREATE INDEX "audit_logs_workspace_id_resource_type_resource_id_idx" ON "audit_logs"("workspace_id", "resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "audit_logs_correlation_id_idx" ON "audit_logs"("correlation_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_type_actor_id_idx" ON "audit_logs"("actor_type", "actor_id");

-- CreateIndex
CREATE INDEX "usage_records_workspace_id_metric_period_start_idx" ON "usage_records"("workspace_id", "metric", "period_start");

-- CreateIndex
CREATE INDEX "usage_records_period_start_period_end_idx" ON "usage_records"("period_start", "period_end");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_numbers" ADD CONSTRAINT "whatsapp_numbers_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "agent_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_memories" ADD CONSTRAINT "agent_memories_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "agent_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tool_executions" ADD CONSTRAINT "agent_tool_executions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "agent_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handoff_requests" ADD CONSTRAINT "handoff_requests_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handoff_requests" ADD CONSTRAINT "handoff_requests_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "agent_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connections" ADD CONSTRAINT "connections_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_inbox" ADD CONSTRAINT "webhook_inbox_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_outbox" ADD CONSTRAINT "event_outbox_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "stock_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_payment_fkey" FOREIGN KEY ("ref_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
