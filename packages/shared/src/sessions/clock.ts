export type PauseEvent = {
  kind: 'pause' | 'resume';
  occurredAt: string;
};

export type RestPause = {
  pausedAt: string;
  resumedAt: string | null;
};

function instant(value: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error('Horário inválido.');
  }
  return parsed;
}

export function activeSeconds(input: {
  startedAt: string;
  endedAt?: string | null;
  events: readonly PauseEvent[];
  now: string;
}): number {
  const end = instant(input.endedAt ?? input.now);
  let cursor = instant(input.startedAt);
  let active = 0;
  let paused = false;
  for (const event of input.events) {
    const at = instant(event.occurredAt);
    if (event.kind === 'pause' && !paused) {
      active += Math.max(0, at - cursor);
      paused = true;
      cursor = Math.max(cursor, at);
    } else if (event.kind === 'resume' && paused) {
      paused = false;
      cursor = Math.max(cursor, at);
    }
  }
  if (!paused) {
    active += Math.max(0, end - cursor);
  }
  return Math.floor(active / 1000);
}

export function elapsedSeconds(input: {
  startedAt: string;
  endedAt?: string | null;
  now: string;
}): number {
  const end = instant(input.endedAt ?? input.now);
  return Math.floor(Math.max(0, end - instant(input.startedAt)) / 1000);
}

export function restRemainingSeconds(input: {
  startedAt: string;
  durationSeconds: number;
  pauses: readonly RestPause[];
  now: string;
}): number {
  const durationMs = Math.max(0, input.durationSeconds) * 1000;
  const now = instant(input.now);
  let cursor = instant(input.startedAt);
  let running = 0;
  for (const pause of input.pauses) {
    const pausedAt = instant(pause.pausedAt);
    running += Math.max(0, pausedAt - cursor);
    cursor = Math.max(cursor, pause.resumedAt ? instant(pause.resumedAt) : now);
  }
  running += Math.max(0, now - cursor);
  return Math.max(0, Math.ceil((durationMs - running) / 1000));
}
