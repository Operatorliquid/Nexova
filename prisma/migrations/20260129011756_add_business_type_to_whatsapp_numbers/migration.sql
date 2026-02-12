-- AlterTable
ALTER TABLE "whatsapp_numbers" ADD COLUMN     "business_type" VARCHAR(50) NOT NULL DEFAULT 'commerce';

-- CreateIndex
CREATE INDEX "whatsapp_numbers_business_type_idx" ON "whatsapp_numbers"("business_type");
