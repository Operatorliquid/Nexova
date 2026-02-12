-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "current_balance" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "debt_reminder_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "last_debt_reminder_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "paid_amount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "workspace_integrations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "provider" VARCHAR(50) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'disconnected',
    "access_token_enc" TEXT,
    "access_token_iv" VARCHAR(32),
    "refresh_token_enc" TEXT,
    "refresh_token_iv" VARCHAR(32),
    "token_expires_at" TIMESTAMP(3),
    "external_user_id" VARCHAR(100),
    "external_email" VARCHAR(255),
    "provider_data" JSONB NOT NULL DEFAULT '{}',
    "webhook_secret_enc" TEXT,
    "webhook_secret_iv" VARCHAR(32),
    "links_generated" INTEGER NOT NULL DEFAULT 0,
    "payments_received" INTEGER NOT NULL DEFAULT 0,
    "amount_collected" BIGINT NOT NULL DEFAULT 0,
    "connected_at" TIMESTAMP(3),
    "disconnected_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "session_id" UUID,
    "file_ref" VARCHAR(500) NOT NULL,
    "file_type" VARCHAR(20) NOT NULL,
    "file_size_bytes" INTEGER,
    "file_url" VARCHAR(1000),
    "extracted_amount" INTEGER,
    "extracted_date" TIMESTAMP(3),
    "extracted_confidence" DOUBLE PRECISION,
    "extracted_raw_text" TEXT,
    "declared_amount" INTEGER,
    "declared_date" TIMESTAMP(3),
    "applied_amount" INTEGER,
    "order_id" UUID,
    "ledger_entry_id" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending_review',
    "rejection_reason" VARCHAR(500),
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),
    "confirmed_by" UUID,
    "applied_at" TIMESTAMP(3),
    "applied_by" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "type" VARCHAR(10) NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'ARS',
    "balance_after" INTEGER NOT NULL,
    "reference_type" VARCHAR(50) NOT NULL,
    "reference_id" UUID NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_by" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workspace_integrations_provider_status_idx" ON "workspace_integrations"("provider", "status");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_integrations_workspace_id_provider_key" ON "workspace_integrations"("workspace_id", "provider");

-- CreateIndex
CREATE INDEX "receipts_workspace_id_customer_id_idx" ON "receipts"("workspace_id", "customer_id");

-- CreateIndex
CREATE INDEX "receipts_workspace_id_status_idx" ON "receipts"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "receipts_order_id_idx" ON "receipts"("order_id");

-- CreateIndex
CREATE INDEX "ledger_entries_workspace_id_customer_id_created_at_idx" ON "ledger_entries"("workspace_id", "customer_id", "created_at");

-- CreateIndex
CREATE INDEX "ledger_entries_reference_type_reference_id_idx" ON "ledger_entries"("reference_type", "reference_id");

-- CreateIndex
CREATE INDEX "ledger_entries_workspace_id_customer_id_balance_after_idx" ON "ledger_entries"("workspace_id", "customer_id", "balance_after");

-- AddForeignKey
ALTER TABLE "workspace_integrations" ADD CONSTRAINT "workspace_integrations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "agent_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
