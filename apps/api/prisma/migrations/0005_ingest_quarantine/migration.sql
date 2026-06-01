CREATE TABLE "ingest_quarantine" (
    "id" UUID NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data_profile" TEXT NOT NULL,
    "registration" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "frame_hex" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "parsed" JSONB NOT NULL DEFAULT '{}',
    "parse_version" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'real',
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ingest_quarantine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ingest_quarantine_data_profile_registration_received_at_idx"
  ON "ingest_quarantine"("data_profile", "registration", "received_at");

CREATE INDEX "ingest_quarantine_reason_status_received_at_idx"
  ON "ingest_quarantine"("reason", "status", "received_at");
