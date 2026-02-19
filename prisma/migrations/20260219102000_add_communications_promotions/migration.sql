-- CreateTable
CREATE TABLE "promotions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "description" VARCHAR(500),
    "promo_type" VARCHAR(20) NOT NULL,
    "value" INTEGER NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broadcast_campaigns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "promotion_id" UUID,
    "name" VARCHAR(150) NOT NULL,
    "message" TEXT NOT NULL,
    "image_url" TEXT,
    "target_type" VARCHAR(30) NOT NULL DEFAULT 'all_customers',
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "total_recipients" INTEGER NOT NULL DEFAULT 0,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "broadcast_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broadcast_recipients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "customer_id" UUID,
    "phone" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "provider" VARCHAR(30),
    "provider_message_id" VARCHAR(255),
    "error_message" TEXT,
    "sent_at" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "broadcast_recipients_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "promotion_id" UUID;

-- CreateIndex
CREATE INDEX "promotions_workspace_id_status_idx" ON "promotions"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "promotions_workspace_id_starts_at_ends_at_idx" ON "promotions"("workspace_id", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "promotions_product_id_idx" ON "promotions"("product_id");

-- CreateIndex
CREATE INDEX "promotions_deleted_at_idx" ON "promotions"("deleted_at");

-- CreateIndex
CREATE INDEX "broadcast_campaigns_workspace_id_status_idx" ON "broadcast_campaigns"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "broadcast_campaigns_workspace_id_created_at_idx" ON "broadcast_campaigns"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "broadcast_campaigns_promotion_id_idx" ON "broadcast_campaigns"("promotion_id");

-- CreateIndex
CREATE UNIQUE INDEX "broadcast_recipients_campaign_id_phone_key" ON "broadcast_recipients"("campaign_id", "phone");

-- CreateIndex
CREATE INDEX "broadcast_recipients_workspace_id_status_idx" ON "broadcast_recipients"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "broadcast_recipients_campaign_id_status_idx" ON "broadcast_recipients"("campaign_id", "status");

-- CreateIndex
CREATE INDEX "broadcast_recipients_customer_id_idx" ON "broadcast_recipients"("customer_id");

-- CreateIndex
CREATE INDEX "orders_workspace_id_promotion_id_idx" ON "orders"("workspace_id", "promotion_id");

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_campaigns" ADD CONSTRAINT "broadcast_campaigns_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_campaigns" ADD CONSTRAINT "broadcast_campaigns_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "broadcast_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
