import type { SQLiteDatabase } from 'expo-sqlite';

export type PlanChoice = 'keep_server' | 'keep_local' | 'keep_both';
export type PlanConflictIntent = {
  plan_id: string;
  conflict_id: string;
  choice: PlanChoice;
  payload: string | null;
};
const labels: Record<PlanChoice, string> = {
  keep_server: 'Manter a versão sincronizada',
  keep_local: 'Manter a versão deste aparelho',
  keep_both: 'Guardar as duas fichas',
};
export const resolutionLabel = (choice: PlanChoice) => labels[choice];
export async function readPlanConflictIntent(db: SQLiteDatabase, planId: string) {
  return db.getFirstAsync<PlanConflictIntent>(
    'SELECT * FROM plan_conflict_intents WHERE plan_id=?',
    planId,
  );
}
/** Must run in the same exclusive transaction as the edit or new session. */
export async function assertPlanCanGainDependencies(db: SQLiteDatabase, planId: string) {
  const intent = await readPlanConflictIntent(db, planId);
  if (intent && intent.choice !== 'keep_local')
    throw new Error(
      `A decisão desta ficha aguarda confirmação. Abra o conflito e repita “${labels[intent.choice]}” antes de editar ou iniciar outro treino. Os dados estão preservados.`,
    );
}

/** Inspect all states, including attempted, acknowledged and superseded operations. No writes. */
export async function inspectPlanConflictDependencies(
  db: SQLiteDatabase,
  planId: string,
  operationId: string,
  originId: string | null,
) {
  const revisions = await db.getAllAsync<{
    id: string;
    parent_id: string | null;
    server_version: number | null;
  }>('SELECT * FROM local_plan_revisions WHERE plan_id=?', planId);
  const affected = new Set<string>(originId ? [originId] : []);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of revisions)
      if (row.parent_id && affected.has(row.parent_id) && !affected.has(row.id)) {
        affected.add(row.id);
        changed = true;
      }
  }
  const operations = await db.getAllAsync<{
    id: string;
    status: string;
    attempt_count: number;
    payload: string;
  }>("SELECT * FROM sync_queue WHERE entity_type='workout_plan' AND entity_id=?", planId);
  const sessions = await db.getAllAsync<{
    id: string;
    source_plan_revision_id: string | null;
    pending: number;
    payload: string;
  }>('SELECT * FROM sessions WHERE plan_id=?', planId);
  const linkedSessions = sessions.filter((row) => {
    if (row.source_plan_revision_id) return affected.has(row.source_plan_revision_id);
    const value = JSON.parse(row.payload) as {
      planVersion: number;
      planSnapshot: { version: number };
    };
    return value.planVersion < 1 || value.planVersion !== value.planSnapshot.version;
  });
  const affectedOperations = operations.filter((row) => {
    const value = JSON.parse(row.payload) as {
      revisionOrigin?: { id: string; parentId: string | null };
    };
    return (
      row.id === operationId || (value.revisionOrigin && affected.has(value.revisionOrigin.id))
    );
  });
  // Unknown legacy operations cannot safely be discarded while resolving another revision.
  const unknownOperations = operations.filter((row) => {
    const value = JSON.parse(row.payload) as { revisionOrigin?: unknown };
    return row.id !== operationId && !value.revisionOrigin;
  });
  return {
    revisions: revisions.filter((row) => affected.has(row.id)),
    descendants: revisions.filter((row) => row.id !== originId && affected.has(row.id)),
    sessions: linkedSessions,
    operations: affectedOperations,
    unknownOperations,
    missingOrigin: originId
      ? !revisions.some((row) => row.id === originId)
      : revisions.length > 0 || operations.some((row) => row.id !== operationId),
  };
}

/** A session may have read A before a discard completed. Recheck at its first write. */
export async function assertSessionOriginAvailable(
  db: SQLiteDatabase,
  planId: string,
  originId: string | null,
) {
  await assertPlanCanGainDependencies(db, planId);
  if (!originId) return;
  const origin = await db.getFirstAsync<{ server_version: number | null }>(
    'SELECT server_version FROM local_plan_revisions WHERE id=? AND plan_id=?',
    originId,
    planId,
  );
  if (origin?.server_version) return;
  const operation = await db.getFirstAsync<{ status: string }>(
    "SELECT status FROM sync_queue WHERE entity_type='workout_plan' AND entity_id=? AND json_extract(payload,'$.revisionOrigin.id')=? ORDER BY rowid DESC LIMIT 1",
    planId,
    originId,
  );
  if (!origin || !operation || !['pending', 'in_flight', 'error'].includes(operation.status))
    throw new Error(
      'A decisão sobre esta ficha mudou antes do início do treino. Reabra a ficha e inicie novamente com a revisão disponível. Nenhum treino foi criado.',
    );
}
