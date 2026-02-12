-- CreateTable
CREATE TABLE "stock_purchase_receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "vendor_name" VARCHAR(255),
    "issued_at" TIMESTAMP(3),
    "total" INTEGER NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'ARS',
    "file_ref" TEXT NOT NULL,
    "file_hash" VARCHAR(64) NOT NULL,
    "media_type" VARCHAR(100),
    "extracted_data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_at" TIMESTAMP(3),

    CONSTRAINT "stock_purchase_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_purchase_receipt_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "receipt_id" UUID NOT NULL,
    "raw_description" VARCHAR(500) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "is_pack" BOOLEAN NOT NULL DEFAULT false,
    "units_per_pack" INTEGER,
    "quantity_base_units" INTEGER NOT NULL,
    "matched_product_id" UUID,
    "created_product_id" UUID,
    "unit_price" INTEGER,
    "line_total" INTEGER,
    "match_confidence" DECIMAL(4,3),
    "suggested_product_data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_purchase_receipt_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_purchase_receipts_workspace_id_status_idx" ON "stock_purchase_receipts"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "stock_purchase_receipts_workspace_id_created_at_idx" ON "stock_purchase_receipts"("workspace_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "stock_purchase_receipts_workspace_id_file_hash_key" ON "stock_purchase_receipts"("workspace_id", "file_hash");

-- CreateIndex
CREATE INDEX "stock_purchase_receipt_items_receipt_id_idx" ON "stock_purchase_receipt_items"("receipt_id");

-- CreateIndex
CREATE INDEX "stock_purchase_receipt_items_matched_product_id_idx" ON "stock_purchase_receipt_items"("matched_product_id");

-- CreateIndex
CREATE INDEX "stock_purchase_receipt_items_created_product_id_idx" ON "stock_purchase_receipt_items"("created_product_id");

-- AddForeignKey
ALTER TABLE "stock_purchase_receipts" ADD CONSTRAINT "stock_purchase_receipts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_purchase_receipt_items" ADD CONSTRAINT "stock_purchase_receipt_items_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "stock_purchase_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_purchase_receipt_items" ADD CONSTRAINT "stock_purchase_receipt_items_matched_product_id_fkey" FOREIGN KEY ("matched_product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_purchase_receipt_items" ADD CONSTRAINT "stock_purchase_receipt_items_created_product_id_fkey" FOREIGN KEY ("created_product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Align index name with current Prisma schema (PostgreSQL truncates long names)
ALTER INDEX "arca_invoice_records_workspace_id_point_of_sale_cbte_tipo_cbte_" RENAME TO "arca_invoice_records_workspace_id_point_of_sale_cbte_tipo_c_key";

