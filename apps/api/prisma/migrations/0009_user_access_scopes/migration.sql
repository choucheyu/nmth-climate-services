CREATE TABLE "user_access_scopes" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "allowed_data_profiles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "exhibition_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "zone_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "user_access_scopes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_access_scopes_user_id_key" ON "user_access_scopes"("user_id");
CREATE INDEX "user_access_scopes_user_id_idx" ON "user_access_scopes"("user_id");

ALTER TABLE "user_access_scopes"
ADD CONSTRAINT "user_access_scopes_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
