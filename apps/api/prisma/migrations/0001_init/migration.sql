-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'zh-TW',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "risk_level" TEXT NOT NULL DEFAULT 'normal',
    "ip_address" TEXT,
    "user_agent" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_channels" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "masked_identifier" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_routes" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "level" TEXT,
    "schedule" JSONB NOT NULL DEFAULT '{}',
    "recipients" JSONB NOT NULL DEFAULT '[]',
    "channel_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "variables" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "alert_id" UUID,
    "report_job_id" UUID,
    "event_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "recipient" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_groups" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "device_name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "group_id" UUID,
    "exhibition_id" UUID,
    "zone_id" UUID,
    "point_type" TEXT NOT NULL DEFAULT 'ambient',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "archived_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3),
    "last_parse_status" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_status_events" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_calibrations" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "calibrated_at" TIMESTAMP(3) NOT NULL,
    "valid_until" TIMESTAMP(3),
    "certificate_url" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_calibrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_maintenance_logs" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "note" TEXT,
    "performed_by" TEXT,
    "performed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_maintenance_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_replacement_history" (
    "id" UUID NOT NULL,
    "old_device_id" UUID NOT NULL,
    "new_device_id" UUID NOT NULL,
    "replaced_at" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_replacement_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_raw_packets" (
    "id" UUID NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "device_id" UUID NOT NULL,
    "registration" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "frame_hex" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "parse_version" TEXT NOT NULL,
    "parse_status" TEXT NOT NULL DEFAULT 'parsed',
    "parse_error" TEXT,

    CONSTRAINT "device_raw_packets_pkey" PRIMARY KEY ("id","received_at")
);

-- CreateTable
CREATE TABLE "measurements" (
    "id" UUID NOT NULL,
    "measured_at" TIMESTAMP(3) NOT NULL,
    "device_id" UUID NOT NULL,
    "exhibition_id" UUID,
    "zone_id" UUID,
    "source" TEXT NOT NULL DEFAULT 'real',
    "temperature_c" DOUBLE PRECISION NOT NULL,
    "humidity_percent" DOUBLE PRECISION NOT NULL,
    "dehumidify_setpoint" DOUBLE PRECISION,
    "quality_flags" JSONB NOT NULL DEFAULT '[]',
    "parse_version" TEXT NOT NULL,
    "raw_packet_id" UUID,
    "raw_packet_received_at" TIMESTAMP(3),
    "operator_user_id" UUID,
    "adjustment_id" UUID,
    "reason" TEXT,
    "method" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "measurements_pkey" PRIMARY KEY ("id","measured_at")
);

-- CreateTable
CREATE TABLE "exhibitions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "owner" TEXT,
    "preservation_goal" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exhibitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exhibition_zones" (
    "id" UUID NOT NULL,
    "exhibition_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exhibition_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "floor_plans" (
    "id" UUID NOT NULL,
    "exhibition_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "active_version_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "floor_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "floor_plan_versions" (
    "id" UUID NOT NULL,
    "floor_plan_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "pdf_original_path" TEXT NOT NULL,
    "rendered_image_path" TEXT,
    "page_number" INTEGER NOT NULL DEFAULT 1,
    "width" INTEGER,
    "height" INTEGER,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "floor_plan_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "floor_plan_points" (
    "id" UUID NOT NULL,
    "floor_plan_id" UUID NOT NULL,
    "version_id" UUID,
    "zone_id" UUID,
    "device_id" UUID,
    "name" TEXT NOT NULL,
    "x_ratio" DOUBLE PRECISION NOT NULL,
    "y_ratio" DOUBLE PRECISION NOT NULL,
    "display_style" JSONB NOT NULL DEFAULT '{}',
    "threshold_profile_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "floor_plan_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "threshold_profiles" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "warning_temperature_min" DOUBLE PRECISION,
    "warning_temperature_max" DOUBLE PRECISION,
    "critical_temperature_min" DOUBLE PRECISION,
    "critical_temperature_max" DOUBLE PRECISION,
    "warning_humidity_min" DOUBLE PRECISION,
    "warning_humidity_max" DOUBLE PRECISION,
    "critical_humidity_min" DOUBLE PRECISION,
    "critical_humidity_max" DOUBLE PRECISION,
    "trigger_duration_minutes" INTEGER NOT NULL DEFAULT 10,
    "recovery_duration_minutes" INTEGER NOT NULL DEFAULT 10,
    "hysteresis" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "repeat_interval_minutes" INTEGER NOT NULL DEFAULT 60,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "threshold_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "threshold_assignments" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "exhibition_id" UUID,
    "zone_id" UUID,
    "device_id" UUID,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "active_from" TIMESTAMP(3),
    "active_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "threshold_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL,
    "exhibition_id" UUID,
    "zone_id" UUID,
    "device_id" UUID,
    "type" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "triggered_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "last_notified_at" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_events" (
    "id" UUID NOT NULL,
    "alert_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "level" TEXT,
    "message" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_notifications" (
    "id" UUID NOT NULL,
    "alert_id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3),
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_acknowledgements" (
    "id" UUID NOT NULL,
    "alert_id" UUID NOT NULL,
    "user_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_acknowledgements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_escalation_policies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "rules" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alert_escalation_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_silence_windows" (
    "id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "scope_id" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_silence_windows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "exhibition_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_jobs" (
    "id" UUID NOT NULL,
    "report_id" UUID,
    "exhibition_id" UUID,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB,
    "error" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_exports" (
    "id" UUID NOT NULL,
    "report_id" UUID,
    "report_job_id" UUID,
    "format" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "file_size" INTEGER,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_exports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_reports" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "cron" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'zh-TW',
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "recipients" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weather_stations" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "station_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weather_stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weather_observations" (
    "id" UUID NOT NULL,
    "station_id" UUID NOT NULL,
    "observed_at" TIMESTAMP(3) NOT NULL,
    "temperature_c" DOUBLE PRECISION,
    "humidity_percent" DOUBLE PRECISION,
    "rainfall_mm" DOUBLE PRECISION,
    "wind_speed" DOUBLE PRECISION,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weather_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "measurement_adjustments" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "source_range" JSONB NOT NULL DEFAULT '{}',
    "operator_user_id" UUID,
    "audit_log_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "measurement_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_report_jobs" (
    "id" UUID NOT NULL,
    "exhibition_id" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'deterministic',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_report_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_report_outputs" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'zh-TW',
    "summary" TEXT NOT NULL,
    "content" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_report_outputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_report_evidence" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_report_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL DEFAULT '{}',
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_retention_policies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "raw_packet_days" INTEGER NOT NULL DEFAULT 3650,
    "measurement_days" INTEGER NOT NULL DEFAULT 3650,
    "report_export_days" INTEGER NOT NULL DEFAULT 1095,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_retention_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_jobs" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "target" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "error" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backup_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "i18n_messages" (
    "id" UUID NOT NULL,
    "locale" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "namespace" TEXT NOT NULL DEFAULT 'app',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "i18n_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_token_hash_key" ON "user_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "user_sessions_user_id_expires_at_idx" ON "user_sessions"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "notification_channels_type_enabled_idx" ON "notification_channels"("type", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "notification_channels_type_name_key" ON "notification_channels"("type", "name");

-- CreateIndex
CREATE INDEX "notification_routes_event_type_level_idx" ON "notification_routes"("event_type", "level");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_key_locale_key" ON "notification_templates"("key", "locale");

-- CreateIndex
CREATE INDEX "notification_deliveries_event_type_status_idx" ON "notification_deliveries"("event_type", "status");

-- CreateIndex
CREATE INDEX "notification_deliveries_created_at_idx" ON "notification_deliveries"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "device_groups_code_key" ON "device_groups"("code");

-- CreateIndex
CREATE UNIQUE INDEX "devices_device_name_key" ON "devices"("device_name");

-- CreateIndex
CREATE INDEX "devices_exhibition_id_zone_id_idx" ON "devices"("exhibition_id", "zone_id");

-- CreateIndex
CREATE INDEX "devices_last_seen_at_idx" ON "devices"("last_seen_at");

-- CreateIndex
CREATE INDEX "device_status_events_device_id_started_at_idx" ON "device_status_events"("device_id", "started_at");

-- CreateIndex
CREATE INDEX "device_calibrations_device_id_calibrated_at_idx" ON "device_calibrations"("device_id", "calibrated_at");

-- CreateIndex
CREATE INDEX "device_maintenance_logs_device_id_performed_at_idx" ON "device_maintenance_logs"("device_id", "performed_at");

-- CreateIndex
CREATE INDEX "device_replacement_history_old_device_id_replaced_at_idx" ON "device_replacement_history"("old_device_id", "replaced_at");

-- CreateIndex
CREATE INDEX "device_raw_packets_device_id_received_at_idx" ON "device_raw_packets"("device_id", "received_at");

-- CreateIndex
CREATE INDEX "measurements_device_id_measured_at_idx" ON "measurements"("device_id", "measured_at");

-- CreateIndex
CREATE INDEX "measurements_exhibition_id_measured_at_idx" ON "measurements"("exhibition_id", "measured_at");

-- CreateIndex
CREATE INDEX "measurements_source_measured_at_idx" ON "measurements"("source", "measured_at");

-- CreateIndex
CREATE UNIQUE INDEX "measurements_device_id_measured_at_source_parse_version_key" ON "measurements"("device_id", "measured_at", "source", "parse_version");

-- CreateIndex
CREATE UNIQUE INDEX "exhibitions_code_key" ON "exhibitions"("code");

-- CreateIndex
CREATE INDEX "exhibitions_status_idx" ON "exhibitions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "exhibition_zones_exhibition_id_code_key" ON "exhibition_zones"("exhibition_id", "code");

-- CreateIndex
CREATE INDEX "floor_plans_exhibition_id_idx" ON "floor_plans"("exhibition_id");

-- CreateIndex
CREATE UNIQUE INDEX "floor_plan_versions_floor_plan_id_version_key" ON "floor_plan_versions"("floor_plan_id", "version");

-- CreateIndex
CREATE INDEX "floor_plan_points_floor_plan_id_version_id_idx" ON "floor_plan_points"("floor_plan_id", "version_id");

-- CreateIndex
CREATE INDEX "threshold_assignments_exhibition_id_zone_id_device_id_idx" ON "threshold_assignments"("exhibition_id", "zone_id", "device_id");

-- CreateIndex
CREATE INDEX "alerts_status_level_triggered_at_idx" ON "alerts"("status", "level", "triggered_at");

-- CreateIndex
CREATE INDEX "alerts_device_id_triggered_at_idx" ON "alerts"("device_id", "triggered_at");

-- CreateIndex
CREATE INDEX "alert_events_alert_id_created_at_idx" ON "alert_events"("alert_id", "created_at");

-- CreateIndex
CREATE INDEX "alert_notifications_alert_id_status_idx" ON "alert_notifications"("alert_id", "status");

-- CreateIndex
CREATE INDEX "alert_acknowledgements_alert_id_created_at_idx" ON "alert_acknowledgements"("alert_id", "created_at");

-- CreateIndex
CREATE INDEX "alert_silence_windows_scope_scope_id_starts_at_ends_at_idx" ON "alert_silence_windows"("scope", "scope_id", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "report_jobs_status_created_at_idx" ON "report_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "report_exports_created_at_idx" ON "report_exports"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "weather_stations_provider_station_code_key" ON "weather_stations"("provider", "station_code");

-- CreateIndex
CREATE INDEX "weather_observations_observed_at_idx" ON "weather_observations"("observed_at");

-- CreateIndex
CREATE UNIQUE INDEX "weather_observations_station_id_observed_at_key" ON "weather_observations"("station_id", "observed_at");

-- CreateIndex
CREATE INDEX "measurement_adjustments_type_created_at_idx" ON "measurement_adjustments"("type", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_report_jobs_exhibition_id_month_provider_key" ON "ai_report_jobs"("exhibition_id", "month", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "ai_report_outputs_job_id_locale_key" ON "ai_report_outputs"("job_id", "locale");

-- CreateIndex
CREATE INDEX "ai_report_evidence_job_id_key_idx" ON "ai_report_evidence"("job_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_key_key" ON "system_settings"("key");

-- CreateIndex
CREATE INDEX "backup_jobs_status_created_at_idx" ON "backup_jobs"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "i18n_messages_locale_key_key" ON "i18n_messages"("locale", "key");

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_routes" ADD CONSTRAINT "notification_routes_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "notification_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "notification_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "alerts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_report_job_id_fkey" FOREIGN KEY ("report_job_id") REFERENCES "report_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "device_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_exhibition_id_fkey" FOREIGN KEY ("exhibition_id") REFERENCES "exhibitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "exhibition_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_status_events" ADD CONSTRAINT "device_status_events_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_calibrations" ADD CONSTRAINT "device_calibrations_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_maintenance_logs" ADD CONSTRAINT "device_maintenance_logs_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_replacement_history" ADD CONSTRAINT "device_replacement_history_old_device_id_fkey" FOREIGN KEY ("old_device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_replacement_history" ADD CONSTRAINT "device_replacement_history_new_device_id_fkey" FOREIGN KEY ("new_device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_raw_packets" ADD CONSTRAINT "device_raw_packets_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_exhibition_id_fkey" FOREIGN KEY ("exhibition_id") REFERENCES "exhibitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "exhibition_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_adjustment_id_fkey" FOREIGN KEY ("adjustment_id") REFERENCES "measurement_adjustments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exhibition_zones" ADD CONSTRAINT "exhibition_zones_exhibition_id_fkey" FOREIGN KEY ("exhibition_id") REFERENCES "exhibitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floor_plans" ADD CONSTRAINT "floor_plans_exhibition_id_fkey" FOREIGN KEY ("exhibition_id") REFERENCES "exhibitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floor_plan_versions" ADD CONSTRAINT "floor_plan_versions_floor_plan_id_fkey" FOREIGN KEY ("floor_plan_id") REFERENCES "floor_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floor_plan_points" ADD CONSTRAINT "floor_plan_points_floor_plan_id_fkey" FOREIGN KEY ("floor_plan_id") REFERENCES "floor_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floor_plan_points" ADD CONSTRAINT "floor_plan_points_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "floor_plan_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floor_plan_points" ADD CONSTRAINT "floor_plan_points_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "exhibition_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floor_plan_points" ADD CONSTRAINT "floor_plan_points_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floor_plan_points" ADD CONSTRAINT "floor_plan_points_threshold_profile_id_fkey" FOREIGN KEY ("threshold_profile_id") REFERENCES "threshold_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threshold_assignments" ADD CONSTRAINT "threshold_assignments_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "threshold_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threshold_assignments" ADD CONSTRAINT "threshold_assignments_exhibition_id_fkey" FOREIGN KEY ("exhibition_id") REFERENCES "exhibitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threshold_assignments" ADD CONSTRAINT "threshold_assignments_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "exhibition_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threshold_assignments" ADD CONSTRAINT "threshold_assignments_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_exhibition_id_fkey" FOREIGN KEY ("exhibition_id") REFERENCES "exhibitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "exhibition_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_notifications" ADD CONSTRAINT "alert_notifications_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_acknowledgements" ADD CONSTRAINT "alert_acknowledgements_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_exhibition_id_fkey" FOREIGN KEY ("exhibition_id") REFERENCES "exhibitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_jobs" ADD CONSTRAINT "report_jobs_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_jobs" ADD CONSTRAINT "report_jobs_exhibition_id_fkey" FOREIGN KEY ("exhibition_id") REFERENCES "exhibitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_report_job_id_fkey" FOREIGN KEY ("report_job_id") REFERENCES "report_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weather_observations" ADD CONSTRAINT "weather_observations_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "weather_stations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_report_jobs" ADD CONSTRAINT "ai_report_jobs_exhibition_id_fkey" FOREIGN KEY ("exhibition_id") REFERENCES "exhibitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_report_outputs" ADD CONSTRAINT "ai_report_outputs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "ai_report_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_report_evidence" ADD CONSTRAINT "ai_report_evidence_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "ai_report_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
