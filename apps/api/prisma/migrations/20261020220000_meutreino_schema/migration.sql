-- Move existing business objects into schema meutreino without recreating them.
-- public._prisma_migrations stays in public: Prisma 7.10 records history there and
-- exposes no setting to relocate it. citext stays in public because it is an extension.

CREATE SCHEMA IF NOT EXISTS "meutreino";

ALTER TYPE "public"."AccountDeletionStatus" SET SCHEMA "meutreino";
ALTER TYPE "public"."ActivityType" SET SCHEMA "meutreino";
ALTER TYPE "public"."AuthProvider" SET SCHEMA "meutreino";
ALTER TYPE "public"."BillingEnvironment" SET SCHEMA "meutreino";
ALTER TYPE "public"."CardioActivity" SET SCHEMA "meutreino";
ALTER TYPE "public"."ConsentPurpose" SET SCHEMA "meutreino";
ALTER TYPE "public"."DataExportStatus" SET SCHEMA "meutreino";
ALTER TYPE "public"."DevicePlatform" SET SCHEMA "meutreino";
ALTER TYPE "public"."DistanceUnit" SET SCHEMA "meutreino";
ALTER TYPE "public"."EquipmentType" SET SCHEMA "meutreino";
ALTER TYPE "public"."ExerciseOrigin" SET SCHEMA "meutreino";
ALTER TYPE "public"."ExerciseSessionStatus" SET SCHEMA "meutreino";
ALTER TYPE "public"."GymAccessRole" SET SCHEMA "meutreino";
ALTER TYPE "public"."LinkStatus" SET SCHEMA "meutreino";
ALTER TYPE "public"."LoadType" SET SCHEMA "meutreino";
ALTER TYPE "public"."MediaKind" SET SCHEMA "meutreino";
ALTER TYPE "public"."MuscleGroup" SET SCHEMA "meutreino";
ALTER TYPE "public"."MuscleRole" SET SCHEMA "meutreino";
ALTER TYPE "public"."PlanStatus" SET SCHEMA "meutreino";
ALTER TYPE "public"."ProfessionalPermission" SET SCHEMA "meutreino";
ALTER TYPE "public"."ProfessionalStatus" SET SCHEMA "meutreino";
ALTER TYPE "public"."SecurityAuditOutcome" SET SCHEMA "meutreino";
ALTER TYPE "public"."SessionStatus" SET SCHEMA "meutreino";
ALTER TYPE "public"."SlotType" SET SCHEMA "meutreino";
ALTER TYPE "public"."SubscriptionProvider" SET SCHEMA "meutreino";
ALTER TYPE "public"."SubscriptionStatus" SET SCHEMA "meutreino";
ALTER TYPE "public"."SyncEntityType" SET SCHEMA "meutreino";
ALTER TYPE "public"."SyncOperationStatus" SET SCHEMA "meutreino";
ALTER TYPE "public"."SyncOperationType" SET SCHEMA "meutreino";
ALTER TYPE "public"."ThemePreference" SET SCHEMA "meutreino";
ALTER TYPE "public"."UnitSystem" SET SCHEMA "meutreino";
ALTER TYPE "public"."UserStatus" SET SCHEMA "meutreino";
ALTER TYPE "public"."WeekStart" SET SCHEMA "meutreino";
ALTER TYPE "public"."WeightUnit" SET SCHEMA "meutreino";

ALTER TABLE "public"."users" SET SCHEMA "meutreino";
ALTER TABLE "public"."auth_identities" SET SCHEMA "meutreino";
ALTER TABLE "public"."auth_sessions" SET SCHEMA "meutreino";
ALTER TABLE "public"."user_profiles" SET SCHEMA "meutreino";
ALTER TABLE "public"."consent_records" SET SCHEMA "meutreino";
ALTER TABLE "public"."account_deletion_requests" SET SCHEMA "meutreino";
ALTER TABLE "public"."data_export_requests" SET SCHEMA "meutreino";
ALTER TABLE "public"."gyms" SET SCHEMA "meutreino";
ALTER TABLE "public"."user_gyms" SET SCHEMA "meutreino";
ALTER TABLE "public"."media_assets" SET SCHEMA "meutreino";
ALTER TABLE "public"."equipment" SET SCHEMA "meutreino";
ALTER TABLE "public"."exercises" SET SCHEMA "meutreino";
ALTER TABLE "public"."exercise_muscles" SET SCHEMA "meutreino";
ALTER TABLE "public"."exercise_equipment_requirements" SET SCHEMA "meutreino";
ALTER TABLE "public"."equipment_exercise_links" SET SCHEMA "meutreino";
ALTER TABLE "public"."workout_plans" SET SCHEMA "meutreino";
ALTER TABLE "public"."workout_plan_exercises" SET SCHEMA "meutreino";
ALTER TABLE "public"."workout_plan_sets" SET SCHEMA "meutreino";
ALTER TABLE "public"."weekly_schedules" SET SCHEMA "meutreino";
ALTER TABLE "public"."weekly_schedule_slots" SET SCHEMA "meutreino";
ALTER TABLE "public"."workout_sessions" SET SCHEMA "meutreino";
ALTER TABLE "public"."exercise_sessions" SET SCHEMA "meutreino";
ALTER TABLE "public"."performed_sets" SET SCHEMA "meutreino";
ALTER TABLE "public"."performed_set_corrections" SET SCHEMA "meutreino";
ALTER TABLE "public"."exercise_feedback" SET SCHEMA "meutreino";
ALTER TABLE "public"."professional_profiles" SET SCHEMA "meutreino";
ALTER TABLE "public"."student_professional_links" SET SCHEMA "meutreino";
ALTER TABLE "public"."link_permissions" SET SCHEMA "meutreino";
ALTER TABLE "public"."subscriptions" SET SCHEMA "meutreino";
ALTER TABLE "public"."subscription_events" SET SCHEMA "meutreino";
ALTER TABLE "public"."billing_retention_records" SET SCHEMA "meutreino";
ALTER TABLE "public"."devices" SET SCHEMA "meutreino";
ALTER TABLE "public"."sync_operations" SET SCHEMA "meutreino";
ALTER TABLE "public"."audit_logs" SET SCHEMA "meutreino";
ALTER TABLE "public"."email_verification_tokens" SET SCHEMA "meutreino";
ALTER TABLE "public"."password_reset_tokens" SET SCHEMA "meutreino";
ALTER TABLE "public"."email_change_tokens" SET SCHEMA "meutreino";
ALTER TABLE "public"."security_audit_events" SET SCHEMA "meutreino";

ALTER FUNCTION "public"."audit_logs_append_only"() SET SCHEMA "meutreino";
ALTER FUNCTION "public"."equipment_photo_kind"() SET SCHEMA "meutreino";
ALTER FUNCTION "public"."exercises_visual_kind"() SET SCHEMA "meutreino";
ALTER FUNCTION "public"."profile_photo_kind"() SET SCHEMA "meutreino";
ALTER FUNCTION "public"."protect_exercise_session_of_locked_workout"() SET SCHEMA "meutreino";
ALTER FUNCTION "public"."protect_locked_workout_session"() SET SCHEMA "meutreino";
ALTER FUNCTION "public"."reject_row_mutation"() SET SCHEMA "meutreino";
ALTER FUNCTION "public"."security_audit_events_append_only"() SET SCHEMA "meutreino";

ALTER FUNCTION "meutreino"."audit_logs_append_only"() SET search_path = meutreino, public;
ALTER FUNCTION "meutreino"."equipment_photo_kind"() SET search_path = meutreino, public;
ALTER FUNCTION "meutreino"."exercises_visual_kind"() SET search_path = meutreino, public;
ALTER FUNCTION "meutreino"."profile_photo_kind"() SET search_path = meutreino, public;
ALTER FUNCTION "meutreino"."protect_exercise_session_of_locked_workout"() SET search_path = meutreino, public;
ALTER FUNCTION "meutreino"."protect_locked_workout_session"() SET search_path = meutreino, public;
ALTER FUNCTION "meutreino"."reject_row_mutation"() SET search_path = meutreino, public;
ALTER FUNCTION "meutreino"."security_audit_events_append_only"() SET search_path = meutreino, public;

CREATE TYPE "meutreino"."ArchiveStatus" AS ENUM ('active', 'archived');

ALTER TABLE "meutreino"."gyms" ADD COLUMN "nickname" VARCHAR(80);
ALTER TABLE "meutreino"."gyms" ADD COLUMN "branch_name" VARCHAR(80);
ALTER TABLE "meutreino"."gyms" ADD COLUMN "city" VARCHAR(80);
ALTER TABLE "meutreino"."gyms" ADD COLUMN "status" "meutreino"."ArchiveStatus" NOT NULL DEFAULT 'active';
ALTER TABLE "meutreino"."gyms" ADD COLUMN "is_preferred" BOOLEAN NOT NULL DEFAULT false;
DROP INDEX IF EXISTS "meutreino"."gyms_owner_user_id_deleted_at_idx";
CREATE INDEX "gyms_owner_user_id_status_idx" ON "meutreino"."gyms"("owner_user_id", "status");
CREATE UNIQUE INDEX "gyms_one_preferred_per_owner" ON "meutreino"."gyms"("owner_user_id") WHERE "is_preferred" = true AND "status" = 'active';

ALTER TABLE "meutreino"."equipment" ADD COLUMN "name" VARCHAR(120);
UPDATE "meutreino"."equipment" SET "name" = "nickname" WHERE "name" IS NULL;
ALTER TABLE "meutreino"."equipment" ALTER COLUMN "name" SET NOT NULL;
ALTER TABLE "meutreino"."equipment" ALTER COLUMN "nickname" DROP NOT NULL;
ALTER TABLE "meutreino"."equipment" ALTER COLUMN "nickname" TYPE VARCHAR(80);
ALTER TABLE "meutreino"."equipment" ADD COLUMN "status" "meutreino"."ArchiveStatus" NOT NULL DEFAULT 'active';

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'meutreino'
    AND rel.relname = 'equipment'
    AND con.contype = 'f'
    AND pg_get_constraintdef(con.oid) LIKE '%gyms%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE meutreino.equipment DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE "meutreino"."equipment" ALTER COLUMN "gym_id" SET NOT NULL;
ALTER TABLE "meutreino"."equipment"
  ADD CONSTRAINT "equipment_gym_id_fkey"
  FOREIGN KEY ("gym_id") REFERENCES "meutreino"."gyms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
DROP INDEX IF EXISTS "meutreino"."equipment_user_id_deleted_at_idx";
CREATE INDEX "equipment_user_id_status_idx" ON "meutreino"."equipment"("user_id", "status");

ALTER TABLE "meutreino"."exercises" ADD COLUMN "description" TEXT;
ALTER TABLE "meutreino"."exercises" ADD COLUMN "status" "meutreino"."ArchiveStatus" NOT NULL DEFAULT 'active';

INSERT INTO "meutreino"."exercises" (
  "id", "origin", "owner_user_id", "name_pt", "alternative_name", "activity_type", "description", "instructions", "version", "status", "created_at", "updated_at"
) VALUES
  ('10000000-0000-4000-8000-000000000001', 'system', NULL, 'Agachamento livre', 'Agachamento com barra', 'strength', 'Flexão de joelhos e quadris com a barra apoiada nos ombros.', 'Movimento informativo. O MeuTreino+ não define carga, séries ou repetições.', 1, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('10000000-0000-4000-8000-000000000002', 'system', NULL, 'Leg press', 'Leg press 45°', 'strength', 'Empurrar a plataforma com os pés enquanto o quadril permanece apoiado.', 'A numeração da máquina fica no equipamento da sua academia, não neste exercício.', 1, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('10000000-0000-4000-8000-000000000003', 'system', NULL, 'Supino reto', 'Supino com barra', 'strength', 'Empurrar a barra a partir do peito, com as costas apoiadas no banco.', 'Descrição de organização do treino, sem recomendação de carga.', 1, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('10000000-0000-4000-8000-000000000004', 'system', NULL, 'Puxada frontal', 'Puxada alta', 'strength', 'Puxar a barra ou o triângulo em direção ao tronco, partindo de cima.', 'Não substitui orientação de um profissional.', 1, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('10000000-0000-4000-8000-000000000005', 'system', NULL, 'Desenvolvimento com halteres', NULL, 'strength', 'Elevar os halteres da altura dos ombros até os braços estenderem.', 'Texto original do MeuTreino+. Sem mídia de terceiros.', 1, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('10000000-0000-4000-8000-000000000006', 'system', NULL, 'Rosca direta', NULL, 'strength', 'Flexionar os cotovelos mantendo os braços ao lado do tronco.', 'Não há sugestão de peso.', 1, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('10000000-0000-4000-8000-000000000007', 'system', NULL, 'Tríceps na polia', 'Tríceps pulley', 'strength', 'Estender os cotovelos empurrando a pegada da polia para baixo.', 'A polia usada é a que você cadastrar na academia.', 1, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('10000000-0000-4000-8000-000000000008', 'system', NULL, 'Remada curvada', NULL, 'strength', 'Puxar a barra em direção ao abdômen com o tronco inclinado.', 'Descrição do movimento, sem prescrição.', 1, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('10000000-0000-4000-8000-000000000009', 'system', NULL, 'Prancha', NULL, 'strength', 'Sustentar o corpo apoiado nos antebraços e nas pontas dos pés.', 'O registro de tempo, se existir no futuro, é o que você anotar.', 1, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('10000000-0000-4000-8000-000000000010', 'system', NULL, 'Elevação de panturrilha', 'Panturrilha em pé', 'strength', 'Elevar os calcanhares na máquina ou no step.', 'Sem recomendação clínica.', 1, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('10000000-0000-4000-8000-000000000011', 'system', NULL, 'Afundo', 'Avanço', 'strength', 'Dar um passo à frente e descer até o joelho de trás aproximar do chão.', 'Pode ser feito com halteres ou com o peso do corpo.', 1, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('10000000-0000-4000-8000-000000000012', 'system', NULL, 'Abdominal crunch', NULL, 'strength', 'Flexionar o tronco em direção aos joelhos, deitado de costas.', 'Não é avaliação de core nem indicação terapêutica.', 1, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "meutreino"."exercise_muscles" ("exercise_id", "muscle_group", "role") VALUES
  ('10000000-0000-4000-8000-000000000001', 'quadriceps', 'primary'),
  ('10000000-0000-4000-8000-000000000001', 'glutes', 'secondary'),
  ('10000000-0000-4000-8000-000000000002', 'quadriceps', 'primary'),
  ('10000000-0000-4000-8000-000000000002', 'glutes', 'secondary'),
  ('10000000-0000-4000-8000-000000000003', 'chest', 'primary'),
  ('10000000-0000-4000-8000-000000000003', 'triceps', 'secondary'),
  ('10000000-0000-4000-8000-000000000004', 'back', 'primary'),
  ('10000000-0000-4000-8000-000000000004', 'biceps', 'secondary'),
  ('10000000-0000-4000-8000-000000000005', 'shoulders', 'primary'),
  ('10000000-0000-4000-8000-000000000005', 'triceps', 'secondary'),
  ('10000000-0000-4000-8000-000000000006', 'biceps', 'primary'),
  ('10000000-0000-4000-8000-000000000007', 'triceps', 'primary'),
  ('10000000-0000-4000-8000-000000000008', 'back', 'primary'),
  ('10000000-0000-4000-8000-000000000008', 'biceps', 'secondary'),
  ('10000000-0000-4000-8000-000000000009', 'core', 'primary'),
  ('10000000-0000-4000-8000-000000000010', 'calves', 'primary'),
  ('10000000-0000-4000-8000-000000000011', 'quadriceps', 'primary'),
  ('10000000-0000-4000-8000-000000000011', 'glutes', 'secondary'),
  ('10000000-0000-4000-8000-000000000012', 'core', 'primary');

INSERT INTO "meutreino"."exercise_equipment_requirements" ("exercise_id", "equipment_type") VALUES
  ('10000000-0000-4000-8000-000000000001', 'barbell'),
  ('10000000-0000-4000-8000-000000000002', 'machine'),
  ('10000000-0000-4000-8000-000000000003', 'barbell'),
  ('10000000-0000-4000-8000-000000000003', 'bench'),
  ('10000000-0000-4000-8000-000000000004', 'cable'),
  ('10000000-0000-4000-8000-000000000005', 'dumbbell'),
  ('10000000-0000-4000-8000-000000000006', 'barbell'),
  ('10000000-0000-4000-8000-000000000007', 'cable'),
  ('10000000-0000-4000-8000-000000000008', 'barbell'),
  ('10000000-0000-4000-8000-000000000009', 'bodyweight'),
  ('10000000-0000-4000-8000-000000000010', 'machine'),
  ('10000000-0000-4000-8000-000000000011', 'dumbbell'),
  ('10000000-0000-4000-8000-000000000012', 'bodyweight');
