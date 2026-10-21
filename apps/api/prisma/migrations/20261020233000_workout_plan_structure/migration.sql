-- Workout plan structure for Prompt 03. Existing plan rows stay in meutreino.

CREATE TYPE "meutreino"."PlannedSetKind" AS ENUM ('normal', 'warmup', 'preparatory', 'drop_set');

CREATE TYPE "meutreino"."PlanAccent" AS ENUM ('slate', 'blue', 'green', 'amber', 'red', 'violet', 'teal', 'pink');

CREATE TYPE "meutreino"."PlanConflictStatus" AS ENUM ('open', 'keep_server', 'keep_local', 'keep_both');

ALTER TABLE "meutreino"."workout_plans"
  ADD COLUMN "accent" "meutreino"."PlanAccent";

ALTER TABLE "meutreino"."workout_plan_exercises"
  ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

DROP INDEX "meutreino"."workout_plan_exercises_plan_id_order_index_key";

CREATE UNIQUE INDEX "workout_plan_exercises_active_order_idx"
  ON "meutreino"."workout_plan_exercises" ("plan_id", "order_index")
  WHERE "active";

CREATE INDEX "workout_plan_exercises_plan_id_active_idx"
  ON "meutreino"."workout_plan_exercises" ("plan_id", "active");

ALTER TABLE "meutreino"."workout_plan_sets"
  ADD COLUMN "set_kind" "meutreino"."PlannedSetKind" NOT NULL DEFAULT 'normal',
  ADD COLUMN "load_unit" "meutreino"."WeightUnit" NOT NULL DEFAULT 'kg',
  ADD COLUMN "target_load" DECIMAL(7, 2);

UPDATE "meutreino"."workout_plan_sets"
SET "target_load" = "target_load_kg"
WHERE "target_load" IS NULL
  AND "target_load_kg" IS NOT NULL;

ALTER TABLE "meutreino"."workout_plan_sets"
  DROP CONSTRAINT "workout_plan_sets_load_ck",
  DROP CONSTRAINT "workout_plan_sets_load_type_ck";

ALTER TABLE "meutreino"."workout_plan_sets"
  ADD CONSTRAINT "workout_plan_sets_load_ck" CHECK (
    ("target_load" IS NULL AND "target_load_kg" IS NULL)
    OR (
      "target_load" IS NOT NULL
      AND "target_load_kg" IS NOT NULL
      AND "target_load" >= 0
      AND "target_load" <= 4409.24
      AND "target_load_kg" >= 0
      AND "target_load_kg" <= 2000
    )
  ),
  ADD CONSTRAINT "workout_plan_sets_load_type_ck" CHECK (
    ("load_type" = 'time' AND "target_duration_seconds" IS NOT NULL AND "target_load" IS NULL AND "target_load_kg" IS NULL)
    OR ("load_type" = 'bodyweight' AND "target_load" IS NULL AND "target_load_kg" IS NULL)
    OR ("load_type" IN ('fixed', 'progressive'))
  );

CREATE TABLE "meutreino"."workout_plan_exercise_equipment" (
  "plan_exercise_id" UUID NOT NULL,
  "gym_id" UUID NOT NULL,
  "equipment_id" UUID NOT NULL,
  CONSTRAINT "workout_plan_exercise_equipment_pkey" PRIMARY KEY ("plan_exercise_id", "gym_id")
);

CREATE INDEX "workout_plan_exercise_equipment_equipment_id_idx"
  ON "meutreino"."workout_plan_exercise_equipment" ("equipment_id");

ALTER TABLE "meutreino"."workout_plan_exercise_equipment"
  ADD CONSTRAINT "workout_plan_exercise_equipment_plan_exercise_id_fkey"
    FOREIGN KEY ("plan_exercise_id") REFERENCES "meutreino"."workout_plan_exercises" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workout_plan_exercise_equipment_gym_id_fkey"
    FOREIGN KEY ("gym_id") REFERENCES "meutreino"."gyms" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workout_plan_exercise_equipment_equipment_id_fkey"
    FOREIGN KEY ("equipment_id") REFERENCES "meutreino"."equipment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "meutreino"."workout_plan_revisions" (
  "id" UUID NOT NULL,
  "plan_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workout_plan_revisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workout_plan_revisions_plan_id_version_key"
  ON "meutreino"."workout_plan_revisions" ("plan_id", "version");

ALTER TABLE "meutreino"."workout_plan_revisions"
  ADD CONSTRAINT "workout_plan_revisions_plan_id_fkey"
    FOREIGN KEY ("plan_id") REFERENCES "meutreino"."workout_plans" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workout_plan_revisions_version_ck" CHECK ("version" >= 1);

CREATE OR REPLACE FUNCTION "meutreino"."reject_plan_revision_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'workout_plan_revisions is append-only';
END;
$$;

CREATE TRIGGER "workout_plan_revisions_append_only"
  BEFORE UPDATE OR DELETE ON "meutreino"."workout_plan_revisions"
  FOR EACH ROW
  EXECUTE FUNCTION "meutreino"."reject_plan_revision_mutation"();

CREATE TABLE "meutreino"."workout_plan_conflicts" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "plan_id" UUID NOT NULL,
  "base_version" INTEGER,
  "payload" JSONB NOT NULL,
  "status" "meutreino"."PlanConflictStatus" NOT NULL DEFAULT 'open',
  "preserved_plan_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMPTZ(3),
  CONSTRAINT "workout_plan_conflicts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "workout_plan_conflicts_user_id_status_idx"
  ON "meutreino"."workout_plan_conflicts" ("user_id", "status");

ALTER TABLE "meutreino"."workout_plan_conflicts"
  ADD CONSTRAINT "workout_plan_conflicts_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "meutreino"."users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workout_plan_conflicts_plan_id_fkey"
    FOREIGN KEY ("plan_id") REFERENCES "meutreino"."workout_plans" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "meutreino"."workout_sessions"
  ADD COLUMN "plan_version" INTEGER;

ALTER TABLE "meutreino"."workout_sessions"
  ADD CONSTRAINT "workout_sessions_plan_version_ck" CHECK (
    "workout_plan_id" IS NULL OR "plan_version" >= 1
  );
