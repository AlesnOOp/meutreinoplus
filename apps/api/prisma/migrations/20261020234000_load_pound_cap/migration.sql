ALTER TABLE "meutreino"."workout_plan_sets"
  DROP CONSTRAINT "workout_plan_sets_load_ck";

ALTER TABLE "meutreino"."workout_plan_sets"
  ADD CONSTRAINT "workout_plan_sets_load_ck" CHECK (
    ("target_load" IS NULL AND "target_load_kg" IS NULL)
    OR (
      "target_load" IS NOT NULL
      AND "target_load_kg" IS NOT NULL
      AND "target_load" >= 0
      AND "target_load" <= 4409.25
      AND "target_load_kg" >= 0
      AND "target_load_kg" <= 2000
    )
  );
