-- Add ARCA invoices table
CREATE TABLE "arca_invoices" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "order_id" UUID,
  "cuit" VARCHAR(20) NOT NULL,
  "point_of_sale" INTEGER NOT NULL,
  "cbte_tipo" INTEGER NOT NULL,
  "cbte_nro" INTEGER NOT NULL,
  "cae" VARCHAR(20),
  "cae_expires_at" TIMESTAMP(3),
  "total" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'ARS',
  "status" VARCHAR(20) NOT NULL DEFAULT 'authorized',
  "request_data" JSONB,
  "response_data" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "arca_invoices_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "arca_invoices_workspace_id_created_at_idx" ON "arca_invoices" ("workspace_id", "created_at");
CREATE INDEX "arca_invoices_workspace_id_order_id_idx" ON "arca_invoices" ("workspace_id", "order_id");

ALTER TABLE "arca_invoices" ADD CONSTRAINT "arca_invoices_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "arca_invoices" ADD CONSTRAINT "arca_invoices_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
