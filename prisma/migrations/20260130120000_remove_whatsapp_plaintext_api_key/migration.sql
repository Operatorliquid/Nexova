-- Ensure no plaintext WhatsApp API keys remain before dropping the column.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "whatsapp_numbers"
    WHERE "api_key" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Cannot drop whatsapp_numbers.api_key: plaintext keys still present. Run backfill-whatsapp-keys.ts first.';
  END IF;
END $$;

ALTER TABLE "whatsapp_numbers" DROP COLUMN IF EXISTS "api_key";
