UPDATE "measurements"
SET "source" = 'real'
WHERE "source" = 'device';

UPDATE "measurements"
SET "source" = 'derived'
WHERE "source" = 'synthetic_target_approach';

UPDATE "measurement_adjustments"
SET "type" = 'derived'
WHERE "type" = 'synthetic_target_approach';

ALTER TABLE "measurements"
ALTER COLUMN "source" SET DEFAULT 'real';
