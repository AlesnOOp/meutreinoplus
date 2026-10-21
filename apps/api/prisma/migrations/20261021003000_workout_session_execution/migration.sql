-- Prompt 04. Extends the existing session tables in meutreino.
-- Does not recreate workout_sessions and does not touch other schemas.

DO $$
BEGIN
  IF (SELECT count(*) FROM "meutreino"."workout_sessions") > 0 THEN
    RAISE EXCEPTION 'refusing to require plan_snapshot while workout sessions already exist';
  END IF;
END $$;

CREATE TYPE "meutreino"."PerformedSetOutcome" AS ENUM ('completed', 'skipped');

CREATE TYPE "meutreino"."SessionTimeKind" AS ENUM (
  'pause',
  'resume',
  'rest_start',
  'rest_pause',
  'rest_resume',
  'rest_finish'
);

CREATE TYPE "meutreino"."SessionConflictStatus" AS ENUM ('open', 'keep_server', 'keep_local', 'keep_both');

ALTER TABLE "meutreino"."workout_sessions"
  ADD COLUMN "plan_snapshot" JSONB NOT NULL,
  ADD COLUMN "gym_name" VARCHAR(120),
  ADD COLUMN "paused_at" TIMESTAMPTZ(3),
  ADD COLUMN "elapsed_seconds" INTEGER,
  ADD COLUMN "notes" TEXT;

ALTER TABLE "meutreino"."workout_sessions"
  ADD CONSTRAINT "workout_sessions_paused_ck" CHECK (
    ("status" = 'paused' AND "paused_at" IS NOT NULL)
    OR ("status" <> 'paused' AND "paused_at" IS NULL)
  ),
  ADD CONSTRAINT "workout_sessions_elapsed_ck" CHECK (
    "elapsed_seconds" IS NULL OR "elapsed_seconds" >= 0
  );

CREATE UNIQUE INDEX "workout_sessions_one_open_per_user"
  ON "meutreino"."workout_sessions" ("user_id")
  WHERE "status" IN ('in_progress', 'paused');

ALTER TABLE "meutreino"."exercise_sessions"
  ADD COLUMN "planned_rest_seconds" INTEGER,
  ADD COLUMN "gym_name" VARCHAR(120),
  ADD COLUMN "equipment_name" VARCHAR(160),
  ADD COLUMN "machine_number" VARCHAR(40);

ALTER TABLE "meutreino"."exercise_sessions"
  ADD CONSTRAINT "exercise_sessions_rest_ck" CHECK (
    "planned_rest_seconds" IS NULL OR "planned_rest_seconds" BETWEEN 0 AND 3600
  );

ALTER TABLE "meutreino"."performed_sets"
  ADD COLUMN "planned_set_id" UUID,
  ADD COLUMN "outcome" "meutreino"."PerformedSetOutcome" NOT NULL DEFAULT 'completed',
  ADD COLUMN "planned_load" DECIMAL(7, 2),
  ADD COLUMN "planned_load_unit" "meutreino"."WeightUnit",
  ADD COLUMN "performed_load" DECIMAL(7, 2),
  ADD COLUMN "performed_load_unit" "meutreino"."WeightUnit",
  ADD COLUMN "notes" VARCHAR(500);

ALTER TABLE "meutreino"."performed_sets"
  DROP CONSTRAINT "performed_sets_result_ck";

ALTER TABLE "meutreino"."performed_sets"
  ADD CONSTRAINT "performed_sets_result_ck" CHECK (
    "outcome" = 'skipped'
    OR "performed_repetitions" IS NOT NULL
    OR "performed_duration_seconds" IS NOT NULL
    OR "performed_load_kg" IS NOT NULL
  ),
  ADD CONSTRAINT "performed_sets_entered_load_ck" CHECK (
    ("planned_load" IS NULL OR "planned_load" >= 0)
    AND ("performed_load" IS NULL OR "performed_load" >= 0)
  );

ALTER TABLE "meutreino"."performed_set_corrections"
  ADD COLUMN "performed_load" DECIMAL(7, 2),
  ADD COLUMN "performed_load_unit" "meutreino"."WeightUnit",
  ADD COLUMN "voided" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "meutreino"."performed_set_corrections"
  DROP CONSTRAINT "performed_set_corrections_value_ck";

ALTER TABLE "meutreino"."performed_set_corrections"
  ADD CONSTRAINT "performed_set_corrections_value_ck" CHECK (
    "voided" = true
    OR "performed_repetitions" IS NOT NULL
    OR "performed_duration_seconds" IS NOT NULL
    OR "performed_load_kg" IS NOT NULL
  ),
  ADD CONSTRAINT "performed_set_corrections_entered_load_ck" CHECK (
    "performed_load" IS NULL OR "performed_load" >= 0
  );

ALTER TABLE "meutreino"."exercise_feedback"
  ALTER COLUMN "perceived_level" DROP NOT NULL;

ALTER TABLE "meutreino"."exercise_feedback"
  DROP CONSTRAINT "exercise_feedback_level_ck";

ALTER TABLE "meutreino"."exercise_feedback"
  ADD CONSTRAINT "exercise_feedback_level_ck" CHECK (
    "perceived_level" IS NULL OR "perceived_level" BETWEEN 1 AND 5
  ),
  ADD CONSTRAINT "exercise_feedback_content_ck" CHECK (
    "perceived_level" IS NOT NULL OR "comment" IS NOT NULL
  );

CREATE TABLE "meutreino"."session_time_events" (
  "id" UUID NOT NULL,
  "workout_session_id" UUID NOT NULL,
  "exercise_session_id" UUID,
  "kind" "meutreino"."SessionTimeKind" NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "rest_duration_seconds" INTEGER,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "session_time_events_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "meutreino"."session_time_events"
  ADD CONSTRAINT "session_time_events_workout_session_id_fkey"
    FOREIGN KEY ("workout_session_id") REFERENCES "meutreino"."workout_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "session_time_events_exercise_session_id_fkey"
    FOREIGN KEY ("exercise_session_id") REFERENCES "meutreino"."exercise_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "session_time_events_rest_ck" CHECK (
    "rest_duration_seconds" IS NULL OR "rest_duration_seconds" BETWEEN 0 AND 3600
  );

CREATE INDEX "session_time_events_session_time_idx"
  ON "meutreino"."session_time_events" ("workout_session_id", "occurred_at");

CREATE TRIGGER "session_time_events_append_only"
  BEFORE UPDATE OR DELETE ON "meutreino"."session_time_events"
  FOR EACH ROW EXECUTE FUNCTION "meutreino"."reject_row_mutation"();

CREATE TABLE "meutreino"."workout_session_conflicts" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "workout_session_id" UUID NOT NULL,
  "base_version" INTEGER,
  "payload" JSONB NOT NULL,
  "status" "meutreino"."SessionConflictStatus" NOT NULL DEFAULT 'open',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMPTZ(3),
  CONSTRAINT "workout_session_conflicts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "meutreino"."workout_session_conflicts"
  ADD CONSTRAINT "workout_session_conflicts_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "meutreino"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workout_session_conflicts_workout_session_id_fkey"
    FOREIGN KEY ("workout_session_id") REFERENCES "meutreino"."workout_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "workout_session_conflicts_user_status_idx"
  ON "meutreino"."workout_session_conflicts" ("user_id", "status");

CREATE OR REPLACE FUNCTION "meutreino"."protect_locked_workout_session"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."plan_snapshot" IS DISTINCT FROM OLD."plan_snapshot"
    OR NEW."plan_version" IS DISTINCT FROM OLD."plan_version"
    OR NEW."plan_name_snapshot" IS DISTINCT FROM OLD."plan_name_snapshot"
    OR NEW."started_at" IS DISTINCT FROM OLD."started_at"
    OR NEW."user_id" IS DISTINCT FROM OLD."user_id"
    OR NEW."gym_name" IS DISTINCT FROM OLD."gym_name"
    OR NEW."workout_plan_id" IS DISTINCT FROM OLD."workout_plan_id"
    OR NEW."gym_id" IS DISTINCT FROM OLD."gym_id"
  THEN
    RAISE EXCEPTION 'workout session photograph is immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF OLD."locked_at" IS NOT NULL THEN
    IF NEW."status" IS DISTINCT FROM OLD."status"
      OR NEW."ended_at" IS DISTINCT FROM OLD."ended_at"
      OR NEW."duration_seconds" IS DISTINCT FROM OLD."duration_seconds"
      OR NEW."elapsed_seconds" IS DISTINCT FROM OLD."elapsed_seconds"
      OR NEW."paused_at" IS DISTINCT FROM OLD."paused_at"
      OR NEW."notes" IS DISTINCT FROM OLD."notes"
      OR NEW."locked_at" IS DISTINCT FROM OLD."locked_at"
    THEN
      RAISE EXCEPTION 'locked workout session cannot change recorded results'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION "meutreino"."protect_locked_workout_session"() SET search_path = meutreino, public;
