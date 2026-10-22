CREATE TABLE meutreino.plan_reconciliations (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES meutreino.users(id) ON DELETE RESTRICT,
 plan_id uuid NOT NULL REFERENCES meutreino.workout_plans(id) ON DELETE RESTRICT,
 conflict_id uuid NOT NULL UNIQUE REFERENCES meutreino.workout_plan_conflicts(id) ON DELETE RESTRICT,
 request_hash varchar(64) NOT NULL, request jsonb NOT NULL, result jsonb NOT NULL,
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX plan_reconciliations_user_id_idx ON meutreino.plan_reconciliations(user_id);
CREATE TABLE meutreino.plan_operation_closures (
 idempotency_key varchar(200) PRIMARY KEY, operation_id uuid NOT NULL UNIQUE,
 user_id uuid NOT NULL REFERENCES meutreino.users(id) ON DELETE RESTRICT,
 plan_id uuid NOT NULL REFERENCES meutreino.workout_plans(id) ON DELETE RESTRICT,
 decision_id uuid NOT NULL REFERENCES meutreino.plan_reconciliations(id) ON DELETE RESTRICT,
 payload_hash varchar(64) NOT NULL, base_version integer CHECK(base_version IS NULL OR base_version>0),
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX plan_operation_closures_user_id_idx ON meutreino.plan_operation_closures(user_id);
CREATE TRIGGER plan_reconciliations_immutable BEFORE UPDATE OR DELETE ON meutreino.plan_reconciliations
 FOR EACH ROW EXECUTE FUNCTION meutreino.protect_resolution_history();
CREATE TRIGGER plan_operation_closures_immutable BEFORE UPDATE OR DELETE ON meutreino.plan_operation_closures
 FOR EACH ROW EXECUTE FUNCTION meutreino.protect_resolution_history();
