-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

CREATE EXTENSION IF NOT EXISTS citext;

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'pending_deletion', 'deleted');

-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('email', 'apple', 'google');

-- CreateEnum
CREATE TYPE "UnitSystem" AS ENUM ('metric', 'imperial');

-- CreateEnum
CREATE TYPE "WeekStart" AS ENUM ('monday', 'sunday');

-- CreateEnum
CREATE TYPE "ConsentPurpose" AS ENUM ('terms_of_use', 'privacy_policy', 'health_data_processing', 'professional_sharing');

-- CreateEnum
CREATE TYPE "AccountDeletionStatus" AS ENUM ('scheduled', 'processing', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "DataExportStatus" AS ENUM ('pending', 'processing', 'ready', 'failed', 'expired');

-- CreateEnum
CREATE TYPE "GymAccessRole" AS ENUM ('owner');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('equipment_photo', 'user_exercise_reference', 'licensed_exercise_reference');

-- CreateEnum
CREATE TYPE "ExerciseOrigin" AS ENUM ('system', 'user');

-- CreateEnum
CREATE TYPE "MuscleGroup" AS ENUM ('chest', 'back', 'shoulders', 'biceps', 'triceps', 'forearms', 'core', 'glutes', 'quadriceps', 'hamstrings', 'calves', 'full_body', 'other');

-- CreateEnum
CREATE TYPE "MuscleRole" AS ENUM ('primary', 'secondary');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('strength', 'cardio', 'mobility', 'flexibility', 'other');

-- CreateEnum
CREATE TYPE "EquipmentType" AS ENUM ('barbell', 'dumbbell', 'kettlebell', 'machine', 'cable', 'bodyweight', 'band', 'bench', 'pullup_bar', 'treadmill', 'bike', 'elliptical', 'other');

-- CreateEnum
CREATE TYPE "LoadType" AS ENUM ('fixed', 'progressive', 'bodyweight', 'time');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "SlotType" AS ENUM ('workout_plan', 'cardio', 'rest');

-- CreateEnum
CREATE TYPE "CardioActivity" AS ENUM ('walk', 'run', 'bike', 'spinning', 'hiit', 'elliptical');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('in_progress', 'paused', 'completed', 'aborted');

-- CreateEnum
CREATE TYPE "ExerciseSessionStatus" AS ENUM ('pending', 'in_progress', 'completed', 'skipped');

-- CreateEnum
CREATE TYPE "ProfessionalStatus" AS ENUM ('draft', 'active', 'suspended');

-- CreateEnum
CREATE TYPE "LinkStatus" AS ENUM ('invited', 'pending_consent', 'active', 'revoked', 'declined', 'expired');

-- CreateEnum
CREATE TYPE "ProfessionalPermission" AS ENUM ('read_plans', 'write_plans', 'read_sessions', 'read_feedback');

-- CreateEnum
CREATE TYPE "SubscriptionProvider" AS ENUM ('apple', 'google');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('trialing', 'active', 'grace_period', 'billing_retry', 'expired', 'revoked');

-- CreateEnum
CREATE TYPE "BillingEnvironment" AS ENUM ('sandbox', 'production');

-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('ios', 'android');

-- CreateEnum
CREATE TYPE "SyncEntityType" AS ENUM ('user_profile', 'gym', 'equipment', 'exercise', 'workout_plan', 'weekly_schedule', 'workout_session', 'performed_set', 'exercise_feedback', 'student_professional_link');

-- CreateEnum
CREATE TYPE "SyncOperationType" AS ENUM ('upsert', 'delete', 'correct');

-- CreateEnum
CREATE TYPE "SyncOperationStatus" AS ENUM ('pending', 'applied', 'rejected', 'conflict');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" CITEXT,
    "password_hash" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "locale" VARCHAR(35) NOT NULL DEFAULT 'pt-BR',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_identities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "AuthProvider" NOT NULL,
    "provider_subject" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" UUID,
    "refresh_token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "replaced_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "display_name" VARCHAR(80) NOT NULL,
    "unit_system" "UnitSystem" NOT NULL DEFAULT 'metric',
    "week_starts_on" "WeekStart" NOT NULL DEFAULT 'monday',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "document_version" VARCHAR(40) NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_deletion_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "AccountDeletionStatus" NOT NULL DEFAULT 'scheduled',
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduled_purge_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),

    CONSTRAINT "account_deletion_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_export_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "DataExportStatus" NOT NULL DEFAULT 'pending',
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "storage_key" TEXT,

    CONSTRAINT "data_export_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gyms" (
    "id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "gyms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_gyms" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "gym_id" UUID NOT NULL,
    "role" "GymAccessRole" NOT NULL DEFAULT 'owner',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "user_gyms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "content_type" VARCHAR(100) NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "gym_id" UUID,
    "machine_number" VARCHAR(40),
    "nickname" VARCHAR(120) NOT NULL,
    "photo_asset_id" UUID,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exercises" (
    "id" UUID NOT NULL,
    "origin" "ExerciseOrigin" NOT NULL,
    "owner_user_id" UUID,
    "name_pt" VARCHAR(160) NOT NULL,
    "alternative_name" VARCHAR(160),
    "activity_type" "ActivityType" NOT NULL,
    "instructions" TEXT,
    "visual_asset_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exercise_muscles" (
    "exercise_id" UUID NOT NULL,
    "muscle_group" "MuscleGroup" NOT NULL,
    "role" "MuscleRole" NOT NULL,

    CONSTRAINT "exercise_muscles_pkey" PRIMARY KEY ("exercise_id","muscle_group")
);

-- CreateTable
CREATE TABLE "exercise_equipment_requirements" (
    "exercise_id" UUID NOT NULL,
    "equipment_type" "EquipmentType" NOT NULL,

    CONSTRAINT "exercise_equipment_requirements_pkey" PRIMARY KEY ("exercise_id","equipment_type")
);

-- CreateTable
CREATE TABLE "equipment_exercise_links" (
    "equipment_id" UUID NOT NULL,
    "exercise_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "equipment_exercise_links_pkey" PRIMARY KEY ("equipment_id","exercise_id")
);

-- CreateTable
CREATE TABLE "workout_plans" (
    "id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "authored_by_user_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "status" "PlanStatus" NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "duplicated_from_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "workout_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_plan_exercises" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "exercise_id" UUID NOT NULL,
    "order_index" INTEGER NOT NULL,
    "rest_seconds" INTEGER,
    "notes" TEXT,

    CONSTRAINT "workout_plan_exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_plan_sets" (
    "id" UUID NOT NULL,
    "plan_exercise_id" UUID NOT NULL,
    "set_index" INTEGER NOT NULL,
    "target_repetitions" INTEGER,
    "target_repetitions_max" INTEGER,
    "load_type" "LoadType" NOT NULL,
    "target_load_kg" DECIMAL(7,2),
    "target_duration_seconds" INTEGER,
    "rest_seconds" INTEGER,
    "notes" TEXT,

    CONSTRAINT "workout_plan_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_schedules" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "time_zone" VARCHAR(64) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "weekly_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_schedule_slots" (
    "id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "slot_type" "SlotType" NOT NULL,
    "workout_plan_id" UUID,
    "cardio_activity" "CardioActivity",
    "notes" TEXT,

    CONSTRAINT "weekly_schedule_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "workout_plan_id" UUID,
    "plan_name_snapshot" VARCHAR(120) NOT NULL,
    "gym_id" UUID,
    "status" "SessionStatus" NOT NULL DEFAULT 'in_progress',
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3),
    "duration_seconds" INTEGER,
    "locked_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workout_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exercise_sessions" (
    "id" UUID NOT NULL,
    "workout_session_id" UUID NOT NULL,
    "plan_exercise_id" UUID,
    "exercise_id" UUID NOT NULL,
    "exercise_name_snapshot" VARCHAR(160) NOT NULL,
    "order_index" INTEGER NOT NULL,
    "status" "ExerciseSessionStatus" NOT NULL DEFAULT 'pending',
    "started_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "skip_reason" VARCHAR(200),

    CONSTRAINT "exercise_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performed_sets" (
    "id" UUID NOT NULL,
    "exercise_session_id" UUID NOT NULL,
    "set_index" INTEGER NOT NULL,
    "planned_repetitions" INTEGER,
    "planned_load_kg" DECIMAL(7,2),
    "planned_duration_seconds" INTEGER,
    "performed_repetitions" INTEGER,
    "performed_load_kg" DECIMAL(7,2),
    "performed_duration_seconds" INTEGER,
    "completed_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "performed_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performed_set_corrections" (
    "id" UUID NOT NULL,
    "performed_set_id" UUID NOT NULL,
    "corrected_by_user_id" UUID NOT NULL,
    "performed_repetitions" INTEGER,
    "performed_load_kg" DECIMAL(7,2),
    "performed_duration_seconds" INTEGER,
    "reason" VARCHAR(300) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "performed_set_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exercise_feedback" (
    "id" UUID NOT NULL,
    "exercise_session_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "perceived_level" SMALLINT NOT NULL,
    "comment" TEXT,
    "discomfort_reported" BOOLEAN NOT NULL DEFAULT false,
    "discomfort_note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "exercise_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "professional_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "status" "ProfessionalStatus" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "professional_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_professional_links" (
    "id" UUID NOT NULL,
    "student_user_id" UUID NOT NULL,
    "professional_user_id" UUID NOT NULL,
    "invited_by_user_id" UUID NOT NULL,
    "status" "LinkStatus" NOT NULL DEFAULT 'invited',
    "consent_granted_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "student_professional_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "link_permissions" (
    "id" UUID NOT NULL,
    "link_id" UUID NOT NULL,
    "permission" "ProfessionalPermission" NOT NULL,
    "granted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "link_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "SubscriptionProvider" NOT NULL,
    "product_code" VARCHAR(120) NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "environment" "BillingEnvironment" NOT NULL,
    "store_original_transaction_id" TEXT NOT NULL,
    "current_period_start" TIMESTAMPTZ(3) NOT NULL,
    "current_period_end" TIMESTAMPTZ(3) NOT NULL,
    "will_renew" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_events" (
    "id" UUID NOT NULL,
    "subscription_id" UUID,
    "provider" "SubscriptionProvider" NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "event_type" VARCHAR(120) NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_retention_records" (
    "id" UUID NOT NULL,
    "former_user_id" UUID NOT NULL,
    "provider" "SubscriptionProvider" NOT NULL,
    "store_original_transaction_id" TEXT NOT NULL,
    "retain_until" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_retention_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "platform" "DevicePlatform" NOT NULL,
    "app_version" VARCHAR(40) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_operations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "entity_type" "SyncEntityType" NOT NULL,
    "entity_id" UUID NOT NULL,
    "operation" "SyncOperationType" NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "base_version" INTEGER,
    "status" "SyncOperationStatus" NOT NULL DEFAULT 'pending',
    "conflict_code" VARCHAR(80),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_at" TIMESTAMPTZ(3),

    CONSTRAINT "sync_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" VARCHAR(80) NOT NULL,
    "entity_type" VARCHAR(80) NOT NULL,
    "entity_id" UUID NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "auth_identities_user_id_idx" ON "auth_identities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_identities_provider_provider_subject_key" ON "auth_identities"("provider", "provider_subject");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_refresh_token_hash_key" ON "auth_sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "auth_sessions_user_id_revoked_at_idx" ON "auth_sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_user_id_key" ON "user_profiles"("user_id");

-- CreateIndex
CREATE INDEX "consent_records_user_id_purpose_recorded_at_idx" ON "consent_records"("user_id", "purpose", "recorded_at");

-- CreateIndex
CREATE INDEX "account_deletion_requests_status_scheduled_purge_at_idx" ON "account_deletion_requests"("status", "scheduled_purge_at");

-- CreateIndex
CREATE INDEX "data_export_requests_user_id_requested_at_idx" ON "data_export_requests"("user_id", "requested_at");

-- CreateIndex
CREATE INDEX "gyms_owner_user_id_deleted_at_idx" ON "gyms"("owner_user_id", "deleted_at");

-- CreateIndex
CREATE INDEX "user_gyms_gym_id_idx" ON "user_gyms"("gym_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_gyms_user_id_gym_id_key" ON "user_gyms"("user_id", "gym_id");

-- CreateIndex
CREATE INDEX "media_assets_owner_user_id_kind_idx" ON "media_assets"("owner_user_id", "kind");

-- CreateIndex
CREATE INDEX "equipment_user_id_deleted_at_idx" ON "equipment"("user_id", "deleted_at");

-- CreateIndex
CREATE INDEX "equipment_gym_id_idx" ON "equipment"("gym_id");

-- CreateIndex
CREATE INDEX "exercises_owner_user_id_deleted_at_idx" ON "exercises"("owner_user_id", "deleted_at");

-- CreateIndex
CREATE INDEX "exercises_name_pt_idx" ON "exercises"("name_pt");

-- CreateIndex
CREATE INDEX "workout_plans_owner_user_id_status_idx" ON "workout_plans"("owner_user_id", "status");

-- CreateIndex
CREATE INDEX "workout_plan_exercises_exercise_id_idx" ON "workout_plan_exercises"("exercise_id");

-- CreateIndex
CREATE UNIQUE INDEX "workout_plan_exercises_plan_id_order_index_key" ON "workout_plan_exercises"("plan_id", "order_index");

-- CreateIndex
CREATE UNIQUE INDEX "workout_plan_sets_plan_exercise_id_set_index_key" ON "workout_plan_sets"("plan_exercise_id", "set_index");

-- CreateIndex
CREATE INDEX "weekly_schedules_user_id_is_active_idx" ON "weekly_schedules"("user_id", "is_active");

-- CreateIndex
CREATE INDEX "weekly_schedule_slots_workout_plan_id_idx" ON "weekly_schedule_slots"("workout_plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_schedule_slots_schedule_id_day_of_week_position_key" ON "weekly_schedule_slots"("schedule_id", "day_of_week", "position");

-- CreateIndex
CREATE INDEX "workout_sessions_user_id_started_at_idx" ON "workout_sessions"("user_id", "started_at");

-- CreateIndex
CREATE INDEX "workout_sessions_workout_plan_id_idx" ON "workout_sessions"("workout_plan_id");

-- CreateIndex
CREATE INDEX "exercise_sessions_exercise_id_idx" ON "exercise_sessions"("exercise_id");

-- CreateIndex
CREATE UNIQUE INDEX "exercise_sessions_workout_session_id_order_index_key" ON "exercise_sessions"("workout_session_id", "order_index");

-- CreateIndex
CREATE UNIQUE INDEX "performed_sets_exercise_session_id_set_index_key" ON "performed_sets"("exercise_session_id", "set_index");

-- CreateIndex
CREATE INDEX "performed_set_corrections_performed_set_id_created_at_idx" ON "performed_set_corrections"("performed_set_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "exercise_feedback_exercise_session_id_key" ON "exercise_feedback"("exercise_session_id");

-- CreateIndex
CREATE INDEX "exercise_feedback_user_id_idx" ON "exercise_feedback"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "professional_profiles_user_id_key" ON "professional_profiles"("user_id");

-- CreateIndex
CREATE INDEX "student_professional_links_professional_user_id_status_idx" ON "student_professional_links"("professional_user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "student_professional_links_student_user_id_professional_use_key" ON "student_professional_links"("student_user_id", "professional_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "link_permissions_link_id_permission_key" ON "link_permissions"("link_id", "permission");

-- CreateIndex
CREATE INDEX "subscriptions_user_id_status_idx" ON "subscriptions"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_provider_store_original_transaction_id_key" ON "subscriptions"("provider", "store_original_transaction_id");

-- CreateIndex
CREATE INDEX "subscription_events_subscription_id_idx" ON "subscription_events"("subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_events_provider_provider_event_id_key" ON "subscription_events"("provider", "provider_event_id");

-- CreateIndex
CREATE INDEX "billing_retention_records_retain_until_idx" ON "billing_retention_records"("retain_until");

-- CreateIndex
CREATE INDEX "devices_user_id_idx" ON "devices"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sync_operations_idempotency_key_key" ON "sync_operations"("idempotency_key");

-- CreateIndex
CREATE INDEX "sync_operations_user_id_status_created_at_idx" ON "sync_operations"("user_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "sync_operations_entity_type_entity_id_idx" ON "sync_operations"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at");

-- AddForeignKey
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_export_requests" ADD CONSTRAINT "data_export_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gyms" ADD CONSTRAINT "gyms_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_gyms" ADD CONSTRAINT "user_gyms_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_gyms" ADD CONSTRAINT "user_gyms_gym_id_fkey" FOREIGN KEY ("gym_id") REFERENCES "gyms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_gym_id_fkey" FOREIGN KEY ("gym_id") REFERENCES "gyms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_photo_asset_id_fkey" FOREIGN KEY ("photo_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_visual_asset_id_fkey" FOREIGN KEY ("visual_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_muscles" ADD CONSTRAINT "exercise_muscles_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_equipment_requirements" ADD CONSTRAINT "exercise_equipment_requirements_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_exercise_links" ADD CONSTRAINT "equipment_exercise_links_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_exercise_links" ADD CONSTRAINT "equipment_exercise_links_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_plans" ADD CONSTRAINT "workout_plans_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_plans" ADD CONSTRAINT "workout_plans_authored_by_user_id_fkey" FOREIGN KEY ("authored_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_plans" ADD CONSTRAINT "workout_plans_duplicated_from_id_fkey" FOREIGN KEY ("duplicated_from_id") REFERENCES "workout_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_plan_exercises" ADD CONSTRAINT "workout_plan_exercises_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "workout_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_plan_exercises" ADD CONSTRAINT "workout_plan_exercises_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_plan_sets" ADD CONSTRAINT "workout_plan_sets_plan_exercise_id_fkey" FOREIGN KEY ("plan_exercise_id") REFERENCES "workout_plan_exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_schedules" ADD CONSTRAINT "weekly_schedules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_schedule_slots" ADD CONSTRAINT "weekly_schedule_slots_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "weekly_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_schedule_slots" ADD CONSTRAINT "weekly_schedule_slots_workout_plan_id_fkey" FOREIGN KEY ("workout_plan_id") REFERENCES "workout_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_workout_plan_id_fkey" FOREIGN KEY ("workout_plan_id") REFERENCES "workout_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_gym_id_fkey" FOREIGN KEY ("gym_id") REFERENCES "gyms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_sessions" ADD CONSTRAINT "exercise_sessions_workout_session_id_fkey" FOREIGN KEY ("workout_session_id") REFERENCES "workout_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_sessions" ADD CONSTRAINT "exercise_sessions_plan_exercise_id_fkey" FOREIGN KEY ("plan_exercise_id") REFERENCES "workout_plan_exercises"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_sessions" ADD CONSTRAINT "exercise_sessions_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performed_sets" ADD CONSTRAINT "performed_sets_exercise_session_id_fkey" FOREIGN KEY ("exercise_session_id") REFERENCES "exercise_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performed_set_corrections" ADD CONSTRAINT "performed_set_corrections_performed_set_id_fkey" FOREIGN KEY ("performed_set_id") REFERENCES "performed_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performed_set_corrections" ADD CONSTRAINT "performed_set_corrections_corrected_by_user_id_fkey" FOREIGN KEY ("corrected_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_feedback" ADD CONSTRAINT "exercise_feedback_exercise_session_id_fkey" FOREIGN KEY ("exercise_session_id") REFERENCES "exercise_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_feedback" ADD CONSTRAINT "exercise_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professional_profiles" ADD CONSTRAINT "professional_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_professional_links" ADD CONSTRAINT "student_professional_links_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_professional_links" ADD CONSTRAINT "student_professional_links_professional_user_id_fkey" FOREIGN KEY ("professional_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_professional_links" ADD CONSTRAINT "student_professional_links_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link_permissions" ADD CONSTRAINT "link_permissions_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "student_professional_links"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_operations" ADD CONSTRAINT "sync_operations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_operations" ADD CONSTRAINT "sync_operations_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Integrity rules that the Prisma schema cannot express.
-- Extension must already exist before the users table is created.

ALTER TABLE "users"
  ADD CONSTRAINT "users_locale_supported_ck" CHECK ("locale" = 'pt-BR'),
  ADD CONSTRAINT "users_email_length_ck" CHECK ("email" IS NULL OR char_length("email"::text) <= 254);

ALTER TABLE "user_profiles"
  ADD CONSTRAINT "user_profiles_version_ck" CHECK ("version" >= 1),
  ADD CONSTRAINT "user_profiles_display_name_ck" CHECK (char_length(btrim("display_name")) >= 1);

ALTER TABLE "account_deletion_requests"
  ADD CONSTRAINT "account_deletion_requests_schedule_ck" CHECK ("scheduled_purge_at" > "requested_at");

ALTER TABLE "data_export_requests"
  ADD CONSTRAINT "data_export_requests_ready_ck" CHECK ("status" <> 'ready' OR "storage_key" IS NOT NULL);

ALTER TABLE "media_assets"
  ADD CONSTRAINT "media_assets_byte_size_ck" CHECK ("byte_size" > 0 AND "byte_size" <= 15000000),
  ADD CONSTRAINT "media_assets_content_type_ck" CHECK ("content_type" IN ('image/jpeg', 'image/png', 'image/webp'));

ALTER TABLE "exercises"
  ADD CONSTRAINT "exercises_origin_owner_ck" CHECK (
    ("origin" = 'system' AND "owner_user_id" IS NULL)
    OR ("origin" = 'user' AND "owner_user_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "exercises_version_ck" CHECK ("version" >= 1);

ALTER TABLE "gyms"
  ADD CONSTRAINT "gyms_version_ck" CHECK ("version" >= 1);

ALTER TABLE "equipment"
  ADD CONSTRAINT "equipment_version_ck" CHECK ("version" >= 1);

ALTER TABLE "workout_plans"
  ADD CONSTRAINT "workout_plans_version_ck" CHECK ("version" >= 1);

ALTER TABLE "workout_plan_exercises"
  ADD CONSTRAINT "workout_plan_exercises_order_ck" CHECK ("order_index" >= 1),
  ADD CONSTRAINT "workout_plan_exercises_rest_ck" CHECK ("rest_seconds" IS NULL OR "rest_seconds" BETWEEN 0 AND 3600);

ALTER TABLE "workout_plan_sets"
  ADD CONSTRAINT "workout_plan_sets_index_ck" CHECK ("set_index" >= 1),
  ADD CONSTRAINT "workout_plan_sets_reps_ck" CHECK ("target_repetitions" IS NULL OR "target_repetitions" BETWEEN 1 AND 999),
  ADD CONSTRAINT "workout_plan_sets_reps_max_ck" CHECK (
    "target_repetitions_max" IS NULL
    OR (
      "target_repetitions" IS NOT NULL
      AND "target_repetitions_max" >= "target_repetitions"
      AND "target_repetitions_max" <= 999
    )
  ),
  ADD CONSTRAINT "workout_plan_sets_duration_ck" CHECK (
    "target_duration_seconds" IS NULL OR "target_duration_seconds" BETWEEN 1 AND 86400
  ),
  ADD CONSTRAINT "workout_plan_sets_rest_ck" CHECK ("rest_seconds" IS NULL OR "rest_seconds" BETWEEN 0 AND 3600),
  ADD CONSTRAINT "workout_plan_sets_load_ck" CHECK (
    "target_load_kg" IS NULL OR ("target_load_kg" >= 0 AND "target_load_kg" <= 2000)
  ),
  ADD CONSTRAINT "workout_plan_sets_load_type_ck" CHECK (
    ("load_type" = 'time' AND "target_duration_seconds" IS NOT NULL)
    OR ("load_type" = 'bodyweight' AND "target_load_kg" IS NULL)
    OR ("load_type" IN ('fixed', 'progressive'))
  );

ALTER TABLE "weekly_schedules"
  ADD CONSTRAINT "weekly_schedules_version_ck" CHECK ("version" >= 1),
  ADD CONSTRAINT "weekly_schedules_time_zone_ck" CHECK (char_length(btrim("time_zone")) >= 1);

ALTER TABLE "weekly_schedule_slots"
  ADD CONSTRAINT "weekly_schedule_slots_day_ck" CHECK ("day_of_week" BETWEEN 1 AND 7),
  ADD CONSTRAINT "weekly_schedule_slots_position_ck" CHECK ("position" >= 1),
  ADD CONSTRAINT "weekly_schedule_slots_type_ck" CHECK (
    ("slot_type" = 'workout_plan' AND "workout_plan_id" IS NOT NULL AND "cardio_activity" IS NULL)
    OR ("slot_type" = 'cardio' AND "cardio_activity" IS NOT NULL AND "workout_plan_id" IS NULL)
    OR ("slot_type" = 'rest' AND "cardio_activity" IS NULL AND "workout_plan_id" IS NULL)
  );

ALTER TABLE "workout_sessions"
  ADD CONSTRAINT "workout_sessions_version_ck" CHECK ("version" >= 1),
  ADD CONSTRAINT "workout_sessions_duration_ck" CHECK ("duration_seconds" IS NULL OR "duration_seconds" >= 0),
  ADD CONSTRAINT "workout_sessions_ended_ck" CHECK ("ended_at" IS NULL OR "ended_at" >= "started_at"),
  ADD CONSTRAINT "workout_sessions_lock_ck" CHECK (
    (
      "status" IN ('completed', 'aborted')
      AND "locked_at" IS NOT NULL
      AND "ended_at" IS NOT NULL
      AND "duration_seconds" IS NOT NULL
    )
    OR (
      "status" IN ('in_progress', 'paused')
      AND "locked_at" IS NULL
    )
  );

ALTER TABLE "exercise_sessions"
  ADD CONSTRAINT "exercise_sessions_order_ck" CHECK ("order_index" >= 1),
  ADD CONSTRAINT "exercise_sessions_ended_ck" CHECK (
    "ended_at" IS NULL OR "started_at" IS NULL OR "ended_at" >= "started_at"
  ),
  ADD CONSTRAINT "exercise_sessions_skip_ck" CHECK ("status" <> 'skipped' OR "skip_reason" IS NOT NULL);

ALTER TABLE "performed_sets"
  ADD CONSTRAINT "performed_sets_index_ck" CHECK ("set_index" >= 1),
  ADD CONSTRAINT "performed_sets_result_ck" CHECK (
    "performed_repetitions" IS NOT NULL
    OR "performed_duration_seconds" IS NOT NULL
    OR "performed_load_kg" IS NOT NULL
  ),
  ADD CONSTRAINT "performed_sets_reps_ck" CHECK (
    "performed_repetitions" IS NULL OR "performed_repetitions" BETWEEN 0 AND 999
  ),
  ADD CONSTRAINT "performed_sets_duration_ck" CHECK (
    "performed_duration_seconds" IS NULL OR "performed_duration_seconds" BETWEEN 0 AND 86400
  ),
  ADD CONSTRAINT "performed_sets_load_ck" CHECK (
    "performed_load_kg" IS NULL OR ("performed_load_kg" >= 0 AND "performed_load_kg" <= 2000)
  );

ALTER TABLE "performed_set_corrections"
  ADD CONSTRAINT "performed_set_corrections_value_ck" CHECK (
    "performed_repetitions" IS NOT NULL
    OR "performed_duration_seconds" IS NOT NULL
    OR "performed_load_kg" IS NOT NULL
  ),
  ADD CONSTRAINT "performed_set_corrections_reason_ck" CHECK (char_length(btrim("reason")) >= 1);

ALTER TABLE "exercise_feedback"
  ADD CONSTRAINT "exercise_feedback_level_ck" CHECK ("perceived_level" BETWEEN 1 AND 5),
  ADD CONSTRAINT "exercise_feedback_version_ck" CHECK ("version" >= 1),
  ADD CONSTRAINT "exercise_feedback_discomfort_ck" CHECK (
    ("discomfort_reported" = false AND "discomfort_note" IS NULL)
    OR "discomfort_reported" = true
  );

ALTER TABLE "student_professional_links"
  ADD CONSTRAINT "student_professional_links_distinct_ck" CHECK ("student_user_id" <> "professional_user_id"),
  ADD CONSTRAINT "student_professional_links_active_ck" CHECK (
    "status" <> 'active' OR ("consent_granted_at" IS NOT NULL AND "revoked_at" IS NULL)
  ),
  ADD CONSTRAINT "student_professional_links_revoked_ck" CHECK (
    "status" <> 'revoked' OR "revoked_at" IS NOT NULL
  );

ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_period_ck" CHECK ("current_period_end" > "current_period_start");

CREATE UNIQUE INDEX "weekly_schedules_one_active_per_user"
  ON "weekly_schedules" ("user_id")
  WHERE "is_active" = true;

CREATE UNIQUE INDEX "exercise_muscles_one_primary"
  ON "exercise_muscles" ("exercise_id")
  WHERE "role" = 'primary';

CREATE FUNCTION "reject_row_mutation"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'rows in % are append-only', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER "consent_records_append_only"
  BEFORE UPDATE OR DELETE ON "consent_records"
  FOR EACH ROW EXECUTE FUNCTION "reject_row_mutation"();

CREATE TRIGGER "performed_sets_append_only"
  BEFORE UPDATE OR DELETE ON "performed_sets"
  FOR EACH ROW EXECUTE FUNCTION "reject_row_mutation"();

CREATE TRIGGER "performed_set_corrections_append_only"
  BEFORE UPDATE OR DELETE ON "performed_set_corrections"
  FOR EACH ROW EXECUTE FUNCTION "reject_row_mutation"();

CREATE TRIGGER "subscription_events_append_only"
  BEFORE UPDATE OR DELETE ON "subscription_events"
  FOR EACH ROW EXECUTE FUNCTION "reject_row_mutation"();

CREATE FUNCTION "protect_locked_workout_session"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."locked_at" IS NOT NULL THEN
    IF NEW."status" IS DISTINCT FROM OLD."status"
      OR NEW."started_at" IS DISTINCT FROM OLD."started_at"
      OR NEW."ended_at" IS DISTINCT FROM OLD."ended_at"
      OR NEW."duration_seconds" IS DISTINCT FROM OLD."duration_seconds"
      OR NEW."plan_name_snapshot" IS DISTINCT FROM OLD."plan_name_snapshot"
      OR NEW."user_id" IS DISTINCT FROM OLD."user_id"
      OR NEW."workout_plan_id" IS DISTINCT FROM OLD."workout_plan_id"
      OR NEW."gym_id" IS DISTINCT FROM OLD."gym_id"
      OR NEW."locked_at" IS DISTINCT FROM OLD."locked_at"
    THEN
      RAISE EXCEPTION 'locked workout session cannot change recorded results'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "workout_sessions_protect_locked"
  BEFORE UPDATE ON "workout_sessions"
  FOR EACH ROW EXECUTE FUNCTION "protect_locked_workout_session"();

CREATE FUNCTION "protect_exercise_session_of_locked_workout"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_locked timestamp with time zone;
BEGIN
  SELECT "locked_at" INTO parent_locked
  FROM "workout_sessions"
  WHERE "id" = OLD."workout_session_id";

  IF parent_locked IS NOT NULL THEN
    RAISE EXCEPTION 'exercise session belongs to a locked workout'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "exercise_sessions_protect_locked_parent"
  BEFORE UPDATE OR DELETE ON "exercise_sessions"
  FOR EACH ROW EXECUTE FUNCTION "protect_exercise_session_of_locked_workout"();

CREATE FUNCTION "exercises_visual_kind"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  asset_kind "MediaKind";
BEGIN
  IF NEW."visual_asset_id" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "kind" INTO asset_kind FROM "media_assets" WHERE "id" = NEW."visual_asset_id";

  IF asset_kind IS NULL THEN
    RAISE EXCEPTION 'exercise visual asset does not exist';
  END IF;

  IF NEW."origin" = 'system' AND asset_kind <> 'licensed_exercise_reference' THEN
    RAISE EXCEPTION 'system exercise visuals must be licensed references';
  END IF;

  IF NEW."origin" = 'user' AND asset_kind = 'licensed_exercise_reference' THEN
    RAISE EXCEPTION 'custom exercises cannot use the licensed reference library';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "exercises_visual_kind_trg"
  BEFORE INSERT OR UPDATE OF "visual_asset_id", "origin" ON "exercises"
  FOR EACH ROW EXECUTE FUNCTION "exercises_visual_kind"();

CREATE FUNCTION "equipment_photo_kind"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  asset_kind "MediaKind";
BEGIN
  IF NEW."photo_asset_id" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "kind" INTO asset_kind FROM "media_assets" WHERE "id" = NEW."photo_asset_id";

  IF asset_kind IS DISTINCT FROM 'equipment_photo' THEN
    RAISE EXCEPTION 'equipment photos must use an equipment_photo asset';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "equipment_photo_kind_trg"
  BEFORE INSERT OR UPDATE OF "photo_asset_id" ON "equipment"
  FOR EACH ROW EXECUTE FUNCTION "equipment_photo_kind"();

CREATE FUNCTION "audit_logs_append_only"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit logs are append-only'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."action" IS DISTINCT FROM OLD."action"
    OR NEW."entity_type" IS DISTINCT FROM OLD."entity_type"
    OR NEW."entity_id" IS DISTINCT FROM OLD."entity_id"
    OR NEW."metadata" IS DISTINCT FROM OLD."metadata"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  THEN
    RAISE EXCEPTION 'audit logs are append-only'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NEW."actor_user_id" IS DISTINCT FROM OLD."actor_user_id"
    AND (OLD."actor_user_id" IS NULL OR NEW."actor_user_id" IS NOT NULL)
  THEN
    RAISE EXCEPTION 'audit actor can only be detached'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "audit_logs_append_only_trg"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "audit_logs_append_only"();
