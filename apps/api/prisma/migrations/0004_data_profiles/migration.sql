ALTER TABLE "devices" ADD COLUMN "data_profile" TEXT NOT NULL DEFAULT 'REAL';
ALTER TABLE "measurements" ADD COLUMN "data_profile" TEXT NOT NULL DEFAULT 'REAL';
ALTER TABLE "exhibitions" ADD COLUMN "data_profile" TEXT NOT NULL DEFAULT 'REAL';
ALTER TABLE "floor_plans" ADD COLUMN "data_profile" TEXT NOT NULL DEFAULT 'REAL';
ALTER TABLE "alerts" ADD COLUMN "data_profile" TEXT NOT NULL DEFAULT 'REAL';

DROP INDEX IF EXISTS "devices_device_name_key";
DROP INDEX IF EXISTS "exhibitions_code_key";
DROP INDEX IF EXISTS "measurements_device_id_measured_at_source_parse_version_key";

CREATE UNIQUE INDEX "devices_data_profile_device_name_key" ON "devices"("data_profile", "device_name");
CREATE UNIQUE INDEX "exhibitions_data_profile_code_key" ON "exhibitions"("data_profile", "code");
CREATE UNIQUE INDEX "measurements_device_id_measured_at_data_profile_source_parse_version_key" ON "measurements"("device_id", "measured_at", "data_profile", "source", "parse_version");

CREATE INDEX "devices_data_profile_idx" ON "devices"("data_profile");
CREATE INDEX "measurements_data_profile_measured_at_idx" ON "measurements"("data_profile", "measured_at");
CREATE INDEX "exhibitions_data_profile_status_idx" ON "exhibitions"("data_profile", "status");
CREATE INDEX "floor_plans_data_profile_idx" ON "floor_plans"("data_profile");
CREATE INDEX "alerts_data_profile_status_level_triggered_at_idx" ON "alerts"("data_profile", "status", "level", "triggered_at");
