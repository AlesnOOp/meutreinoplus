-- Recovery 04: immutable origin-to-official revision binding; no business objects in public.
CREATE TABLE meutreino.plan_revision_origins (
 id uuid PRIMARY KEY,
 plan_id uuid NOT NULL REFERENCES meutreino.workout_plans(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 user_id uuid NOT NULL REFERENCES meutreino.users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 version integer NOT NULL CHECK(version > 0),
 request_hash varchar(64) NOT NULL,
 parent_id uuid,
 operation_id uuid NOT NULL UNIQUE REFERENCES meutreino.sync_operations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 snapshot jsonb NOT NULL,
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(plan_id,version),
 FOREIGN KEY(plan_id,version) REFERENCES meutreino.workout_plan_revisions(plan_id,version) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX plan_revision_origins_user_id_idx ON meutreino.plan_revision_origins(user_id);
CREATE TRIGGER plan_revision_origins_immutable BEFORE UPDATE OR DELETE ON meutreino.plan_revision_origins
 FOR EACH ROW EXECUTE FUNCTION meutreino.protect_resolution_history();
