-- CreateTable
CREATE TABLE "arca_invoice_records" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" uuid NOT NULL,
    "point_of_sale" integer NOT NULL,
    "cbte_tipo" integer NOT NULL,
    "cbte_nro" integer NOT NULL,
    "cbte_fch" timestamp(3) NOT NULL,
    "total" integer NOT NULL,
    "currency" varchar(3) NOT NULL DEFAULT 'ARS',
    "doc_tipo" integer NOT NULL,
    "doc_nro" varchar(20) NOT NULL,
    "status" varchar(20) NOT NULL DEFAULT 'authorized',
    "origin" varchar(20) NOT NULL DEFAULT 'external',
    "created_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamp(3) NOT NULL,

    CONSTRAINT "arca_invoice_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "arca_invoice_records_workspace_id_point_of_sale_cbte_tipo_cbte_nro_key" ON "arca_invoice_records"("workspace_id", "point_of_sale", "cbte_tipo", "cbte_nro");

-- CreateIndex
CREATE INDEX "arca_invoice_records_workspace_id_cbte_fch_idx" ON "arca_invoice_records"("workspace_id", "cbte_fch");

-- AddForeignKey
ALTER TABLE "arca_invoice_records" ADD CONSTRAINT "arca_invoice_records_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
