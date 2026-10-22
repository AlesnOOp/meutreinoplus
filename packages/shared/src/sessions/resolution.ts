import { z } from 'zod';
import { canonicalJsonString } from '../sync/canonical-json';
import {
  sessionResponseSchema,
  sessionSyncPayloadSchema,
  type SessionSyncPayload,
} from './contracts';

export const conflictPreviewSchema = z.object({
  choice: z.enum(['keep_remote', 'keep_local', 'keep_both']),
  remoteVersion: z.number().int().positive(),
  localRevision: z.number().int().nonnegative(),
  previewHash: z.string(),
  changes: z.array(z.string()),
  containsExecution: z.boolean(),
  canApplyLocal: z.boolean(),
  reason: z.string().nullable(),
});
export const sessionVariantSchema = z.object({
  id: z.uuid(),
  resolutionId: z.uuid(),
  origin: z.enum(['local', 'remote']),
  choice: z.string(),
  sourceRevision: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  payload: sessionSyncPayloadSchema,
});
export const sessionVariantsSchema = z.array(sessionVariantSchema);
export const sessionResolutionSchema = sessionResponseSchema.extend({
  resolution: z.object({
    id: z.uuid(),
    choice: z.string(),
    localRevision: z.number().int().nonnegative(),
  }),
});
export const sameSessionValue = (a: unknown, b: unknown): boolean =>
  canonicalJsonString(a) === canonicalJsonString(b);

/** Enumerate every local difference before a remote decision; IDs identify the actual records. */
export function sessionDifferences(
  remote: SessionSyncPayload,
  local: SessionSyncPayload,
): string[] {
  const changes: string[] = [];
  const labels: Record<string, string> = {
    orderIndex: 'Ordem do exercício',
    status: 'Estado',
    endedAt: 'Encerramento',
    notes: 'Observações',
    planSnapshot: 'Ficha congelada',
    planVersion: 'Revisão da ficha',
    planName: 'Nome da ficha',
    gymName: 'Academia',
    gymId: 'Academia',
    startedAt: 'Início',
    exerciseSessions: 'Exercício',
    performedSets: 'Série',
    corrections: 'Correção',
    feedback: 'Avaliação',
    timeEvents: 'Evento',
    perceivedLevel: 'Avaliação',
    comment: 'Comentário',
    skipReason: 'Motivo de pular',
    repetitions: 'Repetições',
    load: 'Carga',
    loadUnit: 'Unidade',
    outcome: 'Resultado',
    completedAt: 'Horário da série',
    reason: 'Motivo da correção',
    voided: 'Anulada',
    createdAt: 'Horário da correção',
    kind: 'Tipo',
    occurredAt: 'Horário',
    restDurationSeconds: 'Descanso em segundos',
    version: 'Revisão',
    setIndex: 'Número da série',
    name: 'Nome',
    restSeconds: 'Descanso',
    equipmentName: 'Equipamento',
    machineNumber: 'Máquina',
    plannedRepetitions: 'Repetições planejadas',
    plannedLoad: 'Carga planejada',
    plannedLoadUnit: 'Unidade planejada',
  };
  const values: Record<string, string> = {
    in_progress: 'Em andamento',
    paused: 'Pausado',
    completed: 'Concluído',
    aborted: 'Cancelado',
    pending: 'Pendente',
    skipped: 'Pulado',
    pause: 'Pausa',
    resume: 'Retomada',
    rest_start: 'Início do descanso',
    rest_pause: 'Pausa do descanso',
    rest_resume: 'Retomada do descanso',
    rest_finish: 'Fim do descanso',
  };
  const text = (value: unknown): string =>
    value == null
      ? 'sem registro'
      : typeof value === 'boolean'
        ? value
          ? 'sim'
          : 'não'
        : typeof value === 'object'
          ? 'conteúdo da ficha'
          : (values[String(value)] ?? String(value));
  for (const key of [
    'status',
    'endedAt',
    'notes',
    'planSnapshot',
    'planVersion',
    'planName',
    'gymId',
    'gymName',
    'startedAt',
  ] as const) {
    if (!sameSessionValue(remote[key], local[key]))
      changes.push(
        `${labels[key]}: neste aparelho “${text(local[key])}”; sincronizado “${text(remote[key])}”.`,
      );
  }
  for (const key of [
    'exerciseSessions',
    'performedSets',
    'corrections',
    'feedback',
    'timeEvents',
  ] as const) {
    for (const item of local[key]) {
      const other = remote[key].find((row) => row.id === item.id);
      if (other && sameSessionValue(other, item)) continue;
      const exerciseId =
        'exerciseSessionId' in item
          ? item.exerciseSessionId
          : key === 'exerciseSessions'
            ? item.id
            : null;
      const correctedSet =
        'performedSetId' in item
          ? local.performedSets.find((set) => set.id === item.performedSetId)
          : null;
      const name = local.exerciseSessions.find(
        (row) => row.id === (exerciseId ?? correctedSet?.exerciseSessionId),
      )?.name;
      const title = `${labels[key]}${name ? ` de ${name}` : ''}${'setIndex' in item ? ` ${item.setIndex}` : correctedSet ? `, série ${correctedSet.setIndex}` : ''}`;
      for (const [field, value] of Object.entries(item)) {
        if (
          !labels[field] ||
          (other && sameSessionValue((other as Record<string, unknown>)[field], value))
        )
          continue;
        changes.push(
          `${title} — ${labels[field]}: neste aparelho “${text(value)}”; sincronizado “${text(other ? (other as Record<string, unknown>)[field] : null)}”.`,
        );
      }
    }
  }
  return changes;
}

/** No timestamp winner: incompatible pause/rest sequences require an explicit alternative. */
export function sessionTimelineError(payload: SessionSyncPayload): string | null {
  const start = Date.parse(payload.startedAt);
  const end = payload.endedAt ? Date.parse(payload.endedAt) : Infinity;
  const terminal = payload.status === 'completed' || payload.status === 'aborted';
  if (terminal !== (payload.endedAt !== null) || end < start)
    return 'O encerramento não é compatível com o estado do treino.';
  let paused = false;
  let rest: 'none' | 'running' | 'paused' = 'none';
  let restDeadline = 0;
  let restRemaining = 0;
  let restCanFinish = false;
  const instants = new Set<string>();
  const events = [...payload.timeEvents].sort(
    (a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id),
  );
  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    const at = Date.parse(event.occurredAt);
    if (at < start || at > end) return 'Há eventos fora do período do treino.';
    const instantKey = `${event.kind.startsWith('rest_') ? 'rest' : 'session'}:${event.occurredAt}`;
    if (instants.has(instantKey))
      return 'Eventos simultâneos exigem revisão; nenhum aparelho tem precedência.';
    instants.add(instantKey);
    if (rest === 'running' && at >= restDeadline) rest = 'none';
    switch (event.kind) {
      case 'pause':
        if (paused) return 'Pausas concorrentes: preserve ambas as versões.';
        paused = true;
        break;
      case 'resume':
        if (!paused) return 'Retomada sem pausa: preserve ambas as versões.';
        paused = false;
        break;
      case 'rest_start':
        if (rest !== 'none') return 'Descansos sobrepostos: preserve ambas as versões.';
        if (event.restDurationSeconds == null) return 'Informe a duração do descanso.';
        restDeadline = at + event.restDurationSeconds * 1000;
        restCanFinish = true;
        rest = 'running';
        break;
      case 'rest_pause':
        if (rest !== 'running') return 'Pausa de descanso incompatível.';
        restRemaining = Math.max(0, restDeadline - at);
        rest = 'paused';
        break;
      case 'rest_resume':
        if (rest !== 'paused') return 'Retomada de descanso incompatível.';
        restDeadline = at + restRemaining;
        rest = 'running';
        break;
      case 'rest_finish':
        if (!restCanFinish) return 'Fim de descanso sem início.';
        restCanFinish = false;
        rest = 'none';
        break;
    }
  }
  if (!terminal && paused !== (payload.status === 'paused'))
    return 'O estado não corresponde à sequência de pausas.';
  if (
    payload.performedSets.some(
      (set) => Date.parse(set.completedAt) < start || Date.parse(set.completedAt) > end,
    )
  )
    return 'Séries fora do período do treino.';
  return null;
}

/** Apply only edits made AFTER the persisted decision. Failure retains the full newer local version. */
export function rebaseSessionEdits(
  base: SessionSyncPayload,
  latest: SessionSyncPayload,
  remote: SessionSyncPayload,
): SessionSyncPayload | null {
  const result = structuredClone(remote);
  for (const key of ['status', 'endedAt', 'notes'] as const) {
    if (!sameSessionValue(base[key], latest[key])) Object.assign(result, { [key]: latest[key] });
  }
  for (const key of [
    'exerciseSessions',
    'performedSets',
    'corrections',
    'feedback',
    'timeEvents',
  ] as const) {
    for (const item of latest[key]) {
      const before = base[key].find((row) => row.id === item.id);
      if (before && sameSessionValue(before, item)) continue;
      if (key === 'feedback') {
        const feedback = item as SessionSyncPayload['feedback'][number];
        const existing = result.feedback.find(
          (row) => row.exerciseSessionId === feedback.exerciseSessionId,
        );
        if (existing)
          Object.assign(existing, feedback, { id: existing.id, version: existing.version });
        else result.feedback.push(structuredClone(feedback));
        continue;
      }
      const rows = result[key] as Array<{ id: string }>;
      const index = rows.findIndex((row) => row.id === item.id);
      if (key === 'performedSets' && index >= 0 && !sameSessionValue(rows[index], item))
        return null;
      if (index >= 0) rows[index] = structuredClone(item);
      else rows.push(structuredClone(item));
    }
  }
  if (
    result.corrections.some(
      (correction) => !result.performedSets.some((set) => set.id === correction.performedSetId),
    )
  )
    return null;
  if (
    (remote.status === 'completed' || remote.status === 'aborted') &&
    !sameSessionValue(result, remote)
  )
    return null;
  return sessionTimelineError(result) ? null : result;
}
