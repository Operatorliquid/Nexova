-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "payment_score" INTEGER NOT NULL DEFAULT 100;

-- CreateTable
CREATE TABLE "customer_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "created_by" VARCHAR(20) NOT NULL DEFAULT 'user',
    "user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_notes_customer_id_created_at_idx" ON "customer_notes"("customer_id", "created_at");

-- AddForeignKey
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
