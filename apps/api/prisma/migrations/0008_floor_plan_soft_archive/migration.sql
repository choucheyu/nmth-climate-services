ALTER TABLE "floor_plans"
ADD COLUMN "archived_at" TIMESTAMP(3);

ALTER TABLE "floor_plan_versions"
ADD COLUMN "archived_at" TIMESTAMP(3);

ALTER TABLE "floor_plan_points"
ADD COLUMN "archived_at" TIMESTAMP(3);

CREATE INDEX "floor_plans_archived_at_idx" ON "floor_plans"("archived_at");
CREATE INDEX "floor_plan_versions_archived_at_idx" ON "floor_plan_versions"("archived_at");
CREATE INDEX "floor_plan_points_archived_at_idx" ON "floor_plan_points"("archived_at");
