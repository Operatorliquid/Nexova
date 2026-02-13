-- Add customer billing/invoicing fields (nullable)
ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "cuit" VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "business_name" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "fiscal_address" TEXT,
  ADD COLUMN IF NOT EXISTS "vat_condition" VARCHAR(50);
