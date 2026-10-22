-- Additive Recovery 03. Apply only to the explicitly selected database.
CREATE TABLE meutreino.workout_session_resolutions (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES meutreino.users(id) ON DELETE RESTRICT,
 conflict_id uuid NOT NULL UNIQUE REFERENCES meutreino.workout_session_conflicts(id) ON DELETE RESTRICT,
 workout_session_id uuid NOT NULL REFERENCES meutreino.workout_sessions(id) ON DELETE RESTRICT,
 choice text NOT NULL CHECK (choice IN ('keep_remote','keep_local','keep_both')),
 local_revision integer NOT NULL CHECK (local_revision >= 0),
 expected_version integer NOT NULL CHECK (expected_version > 0),
 request_hash varchar(64) NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX workout_session_resolutions_user_id_idx ON meutreino.workout_session_resolutions(user_id);
CREATE TABLE meutreino.workout_session_variants (
 id uuid PRIMARY KEY,
 resolution_id uuid NOT NULL REFERENCES meutreino.workout_session_resolutions(id) ON DELETE RESTRICT,
 workout_session_id uuid NOT NULL REFERENCES meutreino.workout_sessions(id) ON DELETE RESTRICT,
 origin text NOT NULL CHECK (origin IN ('local','remote')),
 source_revision integer NOT NULL CHECK (source_revision >= 0),
 payload jsonb NOT NULL,
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(resolution_id,origin)
);
CREATE INDEX workout_session_variants_workout_session_id_idx ON meutreino.workout_session_variants(workout_session_id);
CREATE TABLE meutreino.exercise_feedback_revisions (
 feedback_id uuid NOT NULL REFERENCES meutreino.exercise_feedback(id) ON DELETE RESTRICT,
 version integer NOT NULL CHECK (version > 0),
 payload jsonb NOT NULL,
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(feedback_id,version)
);
INSERT INTO meutreino.exercise_feedback_revisions(feedback_id,version,payload)
 SELECT id,version,to_jsonb(f) FROM meutreino.exercise_feedback f;
CREATE FUNCTION meutreino.protect_resolution_history() RETURNS trigger
 LANGUAGE plpgsql SET search_path = meutreino AS $$
 BEGIN RAISE EXCEPTION 'resolution history is append-only' USING ERRCODE = 'integrity_constraint_violation'; END;
$$;
CREATE TRIGGER workout_session_resolutions_immutable BEFORE UPDATE OR DELETE ON meutreino.workout_session_resolutions
 FOR EACH ROW EXECUTE FUNCTION meutreino.protect_resolution_history();
CREATE TRIGGER workout_session_variants_immutable BEFORE UPDATE OR DELETE ON meutreino.workout_session_variants
 FOR EACH ROW EXECUTE FUNCTION meutreino.protect_resolution_history();
CREATE TRIGGER exercise_feedback_revisions_immutable BEFORE UPDATE OR DELETE ON meutreino.exercise_feedback_revisions
 FOR EACH ROW EXECUTE FUNCTION meutreino.protect_resolution_history();
