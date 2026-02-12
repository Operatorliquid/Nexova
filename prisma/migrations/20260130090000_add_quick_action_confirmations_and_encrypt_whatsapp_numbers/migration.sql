-- Add encrypted API key fields for WhatsApp numbers
ALTER TABLE "whatsapp_numbers" ADD COLUMN "api_key_enc" TEXT;
ALTER TABLE "whatsapp_numbers" ADD COLUMN "api_key_iv" VARCHAR(32);
ALTER TABLE "whatsapp_numbers" ALTER COLUMN "api_key" DROP NOT NULL;

-- Create table for quick action confirmations
CREATE TABLE "quick_action_confirmations" (
  "token" VARCHAR(64) PRIMARY KEY,
  "workspace_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "command" VARCHAR(500) NOT NULL,
  "parsed_tools" JSONB NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "quick_action_confirmations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "quick_action_confirmations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE INDEX "quick_action_confirmations_workspace_user_idx" ON "quick_action_confirmations"("workspace_id", "user_id");
CREATE INDEX "quick_action_confirmations_expires_at_idx" ON "quick_action_confirmations"("expires_at");
