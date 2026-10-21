-- CreateEnum
CREATE TYPE "WeightUnit" AS ENUM ('kg', 'lb');

-- CreateEnum
CREATE TYPE "DistanceUnit" AS ENUM ('km', 'mi');

-- CreateEnum
CREATE TYPE "ThemePreference" AS ENUM ('system', 'light', 'dark');

-- CreateEnum
CREATE TYPE "SecurityAuditOutcome" AS ENUM ('success', 'failure');

-- AlterEnum
ALTER TYPE "MediaKind" ADD VALUE 'profile_photo';

-- AlterEnum
ALTER TYPE "DevicePlatform" ADD VALUE 'web';

-- AlterTable
ALTER TABLE "auth_sessions" ADD COLUMN     "device_label" VARCHAR(80),
ADD COLUMN     "family_id" UUID NOT NULL,
ADD COLUMN     "last_used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "devices" ADD COLUMN     "installation_id" UUID NOT NULL;

-- AlterTable
ALTER TABLE "user_profiles" ADD COLUMN     "distance_unit" "DistanceUnit" NOT NULL DEFAULT 'km',
ADD COLUMN     "notify_product_email" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "photo_asset_id" UUID,
ADD COLUMN     "theme" "ThemePreference" NOT NULL DEFAULT 'system',
ADD COLUMN     "time_zone" VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo',
ADD COLUMN     "weight_unit" "WeightUnit" NOT NULL DEFAULT 'kg';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_verified_at" TIMESTAMPTZ(3),
ADD COLUMN     "password_changed_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_change_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "next_email" CITEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_change_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_audit_events" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "event_type" VARCHAR(80) NOT NULL,
    "outcome" "SecurityAuditOutcome" NOT NULL,
    "subject_hash" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_tokens_token_hash_key" ON "email_verification_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "email_verification_tokens_user_id_created_at_idx" ON "email_verification_tokens"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_created_at_idx" ON "password_reset_tokens"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "email_change_tokens_token_hash_key" ON "email_change_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "email_change_tokens_user_id_created_at_idx" ON "email_change_tokens"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "security_audit_events_user_id_created_at_idx" ON "security_audit_events"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "security_audit_events_event_type_created_at_idx" ON "security_audit_events"("event_type", "created_at");

-- CreateIndex
CREATE INDEX "auth_sessions_family_id_idx" ON "auth_sessions"("family_id");

-- CreateIndex
CREATE UNIQUE INDEX "devices_user_id_installation_id_key" ON "devices"("user_id", "installation_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_photo_asset_id_key" ON "user_profiles"("photo_asset_id");

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_photo_asset_id_fkey" FOREIGN KEY ("photo_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_change_tokens" ADD CONSTRAINT "email_change_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_audit_events" ADD CONSTRAINT "security_audit_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "email_verification_tokens"
  ADD CONSTRAINT "email_verification_tokens_expiry_ck" CHECK ("expires_at" > "created_at"),
  ADD CONSTRAINT "email_verification_tokens_hash_ck" CHECK ("token_hash" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "email_verification_tokens_used_ck" CHECK ("used_at" IS NULL OR "used_at" >= "created_at");

ALTER TABLE "password_reset_tokens"
  ADD CONSTRAINT "password_reset_tokens_expiry_ck" CHECK ("expires_at" > "created_at"),
  ADD CONSTRAINT "password_reset_tokens_hash_ck" CHECK ("token_hash" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "password_reset_tokens_used_ck" CHECK ("used_at" IS NULL OR "used_at" >= "created_at");

ALTER TABLE "email_change_tokens"
  ADD CONSTRAINT "email_change_tokens_expiry_ck" CHECK ("expires_at" > "created_at"),
  ADD CONSTRAINT "email_change_tokens_hash_ck" CHECK ("token_hash" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "email_change_tokens_used_ck" CHECK ("used_at" IS NULL OR "used_at" >= "created_at"),
  ADD CONSTRAINT "email_change_tokens_email_ck" CHECK (char_length("next_email"::text) BETWEEN 3 AND 254);

ALTER TABLE "user_profiles"
  ADD CONSTRAINT "user_profiles_time_zone_ck" CHECK (char_length(btrim("time_zone")) >= 1);

ALTER TABLE "security_audit_events"
  ADD CONSTRAINT "security_audit_events_type_ck" CHECK (char_length(btrim("event_type")) >= 1),
  ADD CONSTRAINT "security_audit_events_subject_ck" CHECK (
    "subject_hash" IS NULL OR "subject_hash" ~ '^[a-f0-9]{64}$'
  );

CREATE FUNCTION "security_audit_events_append_only"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'security audit events are append-only'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."event_type" IS DISTINCT FROM OLD."event_type"
    OR NEW."outcome" IS DISTINCT FROM OLD."outcome"
    OR NEW."subject_hash" IS DISTINCT FROM OLD."subject_hash"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  THEN
    RAISE EXCEPTION 'security audit events are append-only'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NEW."user_id" IS DISTINCT FROM OLD."user_id"
    AND (OLD."user_id" IS NULL OR NEW."user_id" IS NOT NULL)
  THEN
    RAISE EXCEPTION 'security audit subject can only be detached'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "security_audit_events_append_only_trg"
  BEFORE UPDATE OR DELETE ON "security_audit_events"
  FOR EACH ROW EXECUTE FUNCTION "security_audit_events_append_only"();

