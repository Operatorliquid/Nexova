-- AlterTable
ALTER TABLE "receipts" ADD COLUMN     "file_hash" VARCHAR(64);

-- CreateIndex
CREATE UNIQUE INDEX "receipts_workspace_id_file_hash_key" ON "receipts"("workspace_id", "file_hash");
