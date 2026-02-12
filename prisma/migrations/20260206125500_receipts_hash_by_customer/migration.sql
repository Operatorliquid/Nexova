-- Drop old unique index
DROP INDEX IF EXISTS "receipts_workspace_id_file_hash_key";

-- Create new unique index
CREATE UNIQUE INDEX "receipts_customer_id_file_hash_key" ON "receipts"("customer_id", "file_hash");
