CREATE EXTENSION IF NOT EXISTS timescaledb;

SELECT create_hypertable('measurements', 'measured_at', if_not_exists => TRUE, migrate_data => TRUE);
SELECT create_hypertable('device_raw_packets', 'received_at', if_not_exists => TRUE, migrate_data => TRUE);

CREATE INDEX IF NOT EXISTS measurements_device_time_desc_idx
  ON measurements (device_id, measured_at DESC);

CREATE INDEX IF NOT EXISTS measurements_exhibition_time_desc_idx
  ON measurements (exhibition_id, measured_at DESC);

CREATE INDEX IF NOT EXISTS raw_packets_device_time_desc_idx
  ON device_raw_packets (device_id, received_at DESC);
