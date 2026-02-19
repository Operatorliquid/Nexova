-- Keep receipts table in sync with Prisma schema used by API:
-- - payment_method is required by manual receipt upload flow.
-- - file_ref must be nullable for cash/manual receipts.
ALTER TABLE "receipts"
  ADD COLUMN IF NOT EXISTS "payment_method" VARCHAR(50);

ALTER TABLE "receipts"
  ALTER COLUMN "file_ref" DROP NOT NULL;
