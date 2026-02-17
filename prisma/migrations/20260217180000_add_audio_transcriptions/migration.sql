-- CreateTable
CREATE TABLE "audio_transcriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "webhook_inbox_id" UUID,
    "session_id" UUID,
    "provider" VARCHAR(50) NOT NULL,
    "message_id" VARCHAR(255) NOT NULL,
    "channel_id" VARCHAR(100),
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "mime_type" VARCHAR(100),
    "size_bytes" BIGINT,
    "duration_ms" INTEGER,
    "language" VARCHAR(20),
    "transcript" TEXT,
    "confidence" DOUBLE PRECISION,
    "error_message" TEXT,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audio_transcriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "audio_transcriptions_workspace_id_provider_message_id_key"
ON "audio_transcriptions"("workspace_id", "provider", "message_id");

-- CreateIndex
CREATE INDEX "audio_transcriptions_workspace_id_status_created_at_idx"
ON "audio_transcriptions"("workspace_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "audio_transcriptions_webhook_inbox_id_idx"
ON "audio_transcriptions"("webhook_inbox_id");

-- CreateIndex
CREATE INDEX "audio_transcriptions_session_id_idx"
ON "audio_transcriptions"("session_id");

-- CreateIndex
CREATE INDEX "audio_transcriptions_provider_message_id_idx"
ON "audio_transcriptions"("provider", "message_id");

-- AddForeignKey
ALTER TABLE "audio_transcriptions"
ADD CONSTRAINT "audio_transcriptions_workspace_id_fkey"
FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audio_transcriptions"
ADD CONSTRAINT "audio_transcriptions_webhook_inbox_id_fkey"
FOREIGN KEY ("webhook_inbox_id") REFERENCES "webhook_inbox"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audio_transcriptions"
ADD CONSTRAINT "audio_transcriptions_session_id_fkey"
FOREIGN KEY ("session_id") REFERENCES "agent_sessions"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
