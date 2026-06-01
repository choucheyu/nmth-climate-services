-- Device network identity fields.
ALTER TABLE "devices" ADD COLUMN "ip_address" TEXT;
ALTER TABLE "devices" ADD COLUMN "mac_address" TEXT;

-- Per-user BOT destination contacts, separated from global NotificationChannel configuration.
CREATE TABLE "user_notification_contacts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "label" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_notification_contacts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_notification_contacts_user_id_type_key" ON "user_notification_contacts"("user_id", "type");
CREATE INDEX "user_notification_contacts_type_enabled_idx" ON "user_notification_contacts"("type", "enabled");
ALTER TABLE "user_notification_contacts" ADD CONSTRAINT "user_notification_contacts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Device-level warning threshold notification controls.
ALTER TABLE "threshold_profiles" ALTER COLUMN "warning_temperature_min" SET DEFAULT 18;
ALTER TABLE "threshold_profiles" ALTER COLUMN "warning_temperature_max" SET DEFAULT 25;
ALTER TABLE "threshold_profiles" ALTER COLUMN "warning_humidity_min" SET DEFAULT 50;
ALTER TABLE "threshold_profiles" ALTER COLUMN "warning_humidity_max" SET DEFAULT 60;
ALTER TABLE "threshold_profiles" ADD COLUMN "max_notifications" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "threshold_profiles" ADD COLUMN "unresolved_reminder_minutes" INTEGER NOT NULL DEFAULT 1440;

UPDATE "threshold_profiles"
SET
    "warning_temperature_min" = COALESCE("warning_temperature_min", 18),
    "warning_temperature_max" = COALESCE("warning_temperature_max", 25),
    "warning_humidity_min" = COALESCE("warning_humidity_min", 50),
    "warning_humidity_max" = COALESCE("warning_humidity_max", 60);
