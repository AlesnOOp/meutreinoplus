import {
  BodyText as Text,
  Badge,
  Button,
  Card,
  Choice,
  Disclosure,
  EmptyState,
  Field,
  MenuLink,
  Notice,
  Progress,
  Screen,
  Section,
  Stat,
  usePalette,
} from '@/ui/ui';

import {
  PERCEIVED_LEVELS,
  PERCEIVED_LEVEL_DISCLAIMER_PT,
  PERCEIVED_LEVEL_EMOJI,
  PERCEIVED_LEVEL_LABELS_PT,
  SESSION_STATUS_LABELS_PT,
  hasUnfinishedPlannedSets,
  projectClock,
  projectRest,
  sessionSummary,
} from '@meutreino/shared';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { listLocalGyms } from '@/catalog/catalog-store';
import { useSessionStore } from '@/session/session-store';
import {
  correctLocalSet,
  finishLocalSession,
  listLocalSessions,
  markLocalExercise,
  pushLocalClock,
  readLocalSession,
  readOpenLocalSession,
  recordLocalSet,
  resolveLocalSessionConflict,
  saveLocalFeedback,
  startLocalSession,
  syncSessions,
  visibleSets,
  type LocalSession,
} from '@/sessions/session-store';

function formatClock(total: number): string {
  const seconds = Math.max(0, Math.floor(total));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const body = `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  return hours > 0 ? `${hours}:${body}` : body;
}

export function WorkoutHomeScreen() {
  const account = useSessionStore((state) => state.account);
  const online = useSessionStore((state) => state.status) !== 'offline';
  const [sessions, setSessions] = useState<LocalSession[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!account) {
      return;
    }
    if (online) {
      await syncSessions(account.id).catch(() => undefined);
    }
    setSessions(await listLocalSessions(account.id));
  }, [account, online]);

  useFocusEffect(
    useCallback(() => {
      void reload().catch(() => setError('Não foi possível abrir os treinos.'));
    }, [reload]),
  );

  const open = sessions.find(
    (session) => session.status === 'in_progress' || session.status === 'paused',
  );
  return (
    <Screen title="Treinos" subtitle="Entre no ritmo. Cada série conta.">
      {error ? <Notice tone="error" message={error} /> : null}
      {!online ? <Notice message="Sem conexão. O treino continua neste aparelho." /> : null}
      {open ? (
        <View style={{ gap: 8 }}>
          <Notice
            message={`${open.planName} está ${SESSION_STATUS_LABELS_PT[open.status].toLowerCase()}.`}
          />
          <Button label="Continuar treino" onPress={() => router.push(`/treino/${open.id}`)} />

          <Button
            label="Cancelar treino"
            variant="danger"
            onPress={() => router.push(`/treino/${open.id}?cancel=1`)}
          />
        </View>
      ) : (
        <>
          <EmptyState
            title="Pronto para se mover?"
            description="Escolha uma ficha e comece a registrar seu treino. Seus dados também ficam disponíveis offline."
            icon="dumbbell"
          />
          <Button
            label="Escolher uma ficha"
            icon="play"
            onPress={() => router.navigate('/plans')}
          />
        </>
      )}
      <Section title="Seu histórico neste aparelho" />
      {sessions
        .filter((session) => session.status === 'completed' || session.status === 'aborted')
        .map((session) => (
          <MenuLink
            key={session.id}
            label={session.planName}
            subtitle={new Date(session.startedAt).toLocaleDateString('pt-BR', {
              day: 'numeric',
              month: 'short',
            })}
            badge={SESSION_STATUS_LABELS_PT[session.status]}
            icon="trophy"
            onPress={() => router.push(`/treino/${session.id}/resumo`)}
          />
        ))}
    </Screen>
  );
}

export function StartWorkoutScreen() {
  const params = useLocalSearchParams<{ planId: string }>();
  const account = useSessionStore((state) => state.account);
  const online = useSessionStore((state) => state.status) !== 'offline';
  const [gyms, setGyms] = useState<{ id: string; name: string }[]>([]);
  const [gymId, setGymId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!account) {
        return;
      }
      void listLocalGyms(account.id).then((items) => {
        setGyms(items.map((gym) => ({ id: gym.id, name: gym.name })));
        const preferred = items.find((gym) => gym.isPreferred);
        if (preferred) {
          setGymId(preferred.id);
        }
      });
      void readOpenLocalSession(account.id).then((open) => {
        if (open) {
          router.replace(`/treino/${open.id}`);
        }
      });
    }, [account]),
  );

  if (!account) {
    return null;
  }

  return (
    <Screen
      title="Iniciar treino"
      subtitle="A ficha fica congelada neste treino."
      onBack={() => router.back()}
    >
      {error ? <Notice tone="error" message={error} /> : null}
      <Choice label="Sem academia" selected={gymId == null} onPress={() => setGymId(null)} />
      {gyms.map((gym) => (
        <Choice
          key={gym.id}
          label={gym.name}
          selected={gymId === gym.id}
          onPress={() => setGymId(gym.id)}
        />
      ))}
      <Button
        label="Começar"
        busy={busy}
        onPress={() => {
          setBusy(true);
          const gym = gyms.find((item) => item.id === gymId) ?? null;
          void startLocalSession(account.id, params.planId, gym, online)
            .then((session) => router.replace(`/treino/${session.id}`))
            .catch(() => setError('Não foi possível iniciar o treino.'))
            .finally(() => setBusy(false));
        }}
      />
    </Screen>
  );
}

export function SessionScreen() {
  const params = useLocalSearchParams<{ sessionId: string; cancel?: string }>();
  const account = useSessionStore((state) => state.account);
  const online = useSessionStore((state) => state.status) !== 'offline';
  const [session, setSession] = useState<LocalSession | null>(null);
  const [now, setNow] = useState(() => new Date().toISOString());
  const [error, setError] = useState<string | null>(null);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(params.cancel === '1');

  const reload = useCallback(async () => {
    if (!account) {
      return;
    }
    if (online) {
      await syncSessions(account.id).catch(() => undefined);
    }
    setSession(await readLocalSession(account.id, params.sessionId));
  }, [account, online, params.sessionId]);

  useFocusEffect(
    useCallback(() => {
      void reload().catch(() => setError('Não foi possível abrir o treino.'));
    }, [reload]),
  );

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date().toISOString()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!account || !session) {
    return (
      <Screen title="Treino" onBack={() => router.back()}>
        {error ? (
          <Notice tone="error" message={error} />
        ) : (
          <Notice message="Carregando o treino." />
        )}
      </Screen>
    );
  }

  const clock = projectClock(session, session.endedAt ?? now);
  const rest = projectRest(session.timeEvents, now);
  const open = session.status === 'in_progress' || session.status === 'paused';
  return (
    <Screen
      title={session.planName}
      subtitle={SESSION_STATUS_LABELS_PT[session.status]}
      onBack={() => router.back()}
    >
      {error ? <Notice tone="error" message={error} /> : null}
      {!online ? <Notice message="Sem conexão. As séries ficam salvas neste aparelho." /> : null}
      {session.pending ? (
        <Notice message="Há registros deste treino ainda não sincronizados." />
      ) : null}
      {session.conflictOperationId ? (
        <View style={{ gap: 8 }}>
          <Notice
            tone="error"
            message="Este treino divergiu de outro aparelho. Escolha o que preservar. Nenhuma série é apagada."
          />
          <Button
            label="Manter este aparelho"
            onPress={() =>
              void resolveLocalSessionConflict(account.id, session.id, 'keep_local').then(reload)
            }
          />
          <Button
            label="Manter os dois"
            variant="secondary"
            onPress={() =>
              void resolveLocalSessionConflict(account.id, session.id, 'keep_both').then(reload)
            }
          />
          <Button
            label="Usar o servidor"
            variant="secondary"
            onPress={() =>
              void resolveLocalSessionConflict(account.id, session.id, 'keep_server').then(reload)
            }
          />
        </View>
      ) : null}
      <WorkoutClock
        value={formatClock(clock.activeSeconds)}
        detail={session.gymName ?? 'Seu treino, no seu ritmo'}
        paused={session.status === 'paused'}
      />
      <Card>
        <Progress
          value={
            session.exerciseSessions.length
              ? session.exerciseSessions.filter((e) => e.status === 'completed').length /
                session.exerciseSessions.length
              : 0
          }
          label="Exercícios concluídos"
        />
        <Text>{`${session.exerciseSessions.filter((e) => e.status === 'completed').length} de ${session.exerciseSessions.length} exercícios · Tempo total ${formatClock(clock.elapsedSeconds)}`}</Text>
      </Card>
      {rest ? (
        <Notice
          message={
            rest.paused
              ? `Descanso pausado. Faltam ${formatClock(rest.remainingSeconds)}.`
              : `Descanso: ${formatClock(rest.remainingSeconds)}.`
          }
        />
      ) : null}
      {open ? (
        <Button
          label={session.status === 'paused' ? 'Retomar' : 'Pausar'}
          variant="secondary"
          onPress={() => {
            void pushLocalClock(
              account.id,
              session.id,
              session.status === 'paused' ? 'resume' : 'pause',
            )
              .then(setSession)
              .catch(() => setError('Não foi possível atualizar o cronômetro.'));
          }}
        />
      ) : null}
      <Section title="Um exercício de cada vez" detail="Toque para registrar suas séries." />
      {session.exerciseSessions.map((exercise) => (
        <MenuLink
          key={exercise.id}
          label={exercise.name}
          icon={exercise.status === 'completed' ? 'check' : 'dumbbell'}
          subtitle={`Exercício ${exercise.orderIndex}`}
          badge={
            exercise.status === 'pending'
              ? 'A fazer'
              : exercise.status === 'in_progress'
                ? 'Em curso'
                : exercise.status === 'completed'
                  ? 'Feito'
                  : 'Pulado'
          }
          onPress={() => router.push(`/treino/${session.id}/exercicio/${exercise.id}`)}
        />
      ))}
      {open && !confirmFinish ? (
        <Button icon="trophy" label="Finalizar treino" onPress={() => setConfirmFinish(true)} />
      ) : null}
      {open && confirmFinish ? (
        <View style={{ gap: 8 }}>
          {hasUnfinishedPlannedSets(session) ? (
            <Notice message="Ainda há séries planejadas sem conclusão." />
          ) : null}
          <Button
            label={
              hasUnfinishedPlannedSets(session) ? 'Finalizar mesmo assim' : 'Confirmar finalização'
            }
            onPress={() => {
              void finishLocalSession(account.id, session.id, 'completed', session.notes)
                .then(() => router.replace(`/treino/${session.id}/resumo`))
                .catch(() => setError('Não foi possível finalizar o treino.'));
            }}
          />
        </View>
      ) : null}
      {open && !confirmCancel ? (
        <Button label="Cancelar treino" variant="danger" onPress={() => setConfirmCancel(true)} />
      ) : null}
      {open && confirmCancel ? (
        <Button
          label="Confirmar cancelamento"
          variant="danger"
          onPress={() => {
            void finishLocalSession(account.id, session.id, 'aborted', session.notes)
              .then(() => router.replace('/treino'))
              .catch(() => setError('Não foi possível cancelar o treino.'));
          }}
        />
      ) : null}
      {!open ? (
        <Button label="Ver resumo" onPress={() => router.push(`/treino/${session.id}/resumo`)} />
      ) : null}
    </Screen>
  );
}

export function ExerciseSessionScreen() {
  const params = useLocalSearchParams<{ sessionId: string; exerciseSessionId: string }>();
  const account = useSessionStore((state) => state.account);
  const [session, setSession] = useState<LocalSession | null>(null);
  const [reps, setReps] = useState('');
  const [load, setLoad] = useState('');
  const recording = useRef(false);
  const [saving, setSaving] = useState(false);
  const [comment, setComment] = useState('');
  const [level, setLevel] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date().toISOString());

  const reload = useCallback(async () => {
    if (!account) {
      return;
    }
    const current = await readLocalSession(account.id, params.sessionId);
    setSession(current);
    const feedback = current?.feedback.find(
      (item) => item.exerciseSessionId === params.exerciseSessionId,
    );
    setComment(feedback?.comment ?? '');
    setLevel(feedback?.perceivedLevel ?? null);
  }, [account, params.exerciseSessionId, params.sessionId]);

  useFocusEffect(
    useCallback(() => {
      void reload().catch(() => setError('Não foi possível abrir o exercício.'));
    }, [reload]),
  );

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date().toISOString()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!account || !session) {
    return (
      <Screen title="Exercício" onBack={() => router.back()}>
        <Notice message="Carregando o exercício." />
      </Screen>
    );
  }
  const exercise = session.exerciseSessions.find((item) => item.id === params.exerciseSessionId);
  if (!exercise) {
    return (
      <Screen title="Exercício" onBack={() => router.back()}>
        <Notice tone="error" message="Exercício não encontrado." />
      </Screen>
    );
  }
  const planned = session.planSnapshot.exercises.find(
    (item) => item.id === exercise.planExerciseId,
  );
  const performed = visibleSets(session, exercise.id);
  const rest = projectRest(session.timeEvents, now);
  const open = session.status === 'in_progress' || session.status === 'paused';
  const equipment = [
    exercise.gymName,
    exercise.equipmentName,
    exercise.machineNumber ? `Máquina ${exercise.machineNumber}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  async function saveSet(outcome: 'completed' | 'skipped', plannedSetId: string | null) {
    const repetitions = reps.trim() ? Number(reps) : null;
    const normalizedLoad = load.trim().replace(',', '.');
    if (outcome === 'completed' && repetitions == null && !normalizedLoad) {
      setError('Informe as repetições ou a carga. Peso corporal fica sem carga.');
      return;
    }
    if (repetitions != null && (!Number.isInteger(repetitions) || repetitions < 0)) {
      setError('As repetições não podem ser negativas.');
      return;
    }
    if (normalizedLoad && !/^\d{1,4}(?:\.\d{1,2})?$/.test(normalizedLoad)) {
      setError('Informe a carga com até duas casas decimais.');
      return;
    }
    if (recording.current) return;
    recording.current = true;
    setSaving(true);
    try {
      const saved = await recordLocalSet(account!.id, session!.id, {
        exerciseSessionId: exercise!.id,
        plannedSetId,
        repetitions,
        load: normalizedLoad || null,
        loadUnit: 'kg',
        outcome,
      });
      setSession(saved);
      setReps('');
      setLoad('');
      setError(null);
      const restSeconds =
        planned?.sets.find((set) => set.id === plannedSetId)?.restSeconds ?? exercise!.restSeconds;
      if (outcome === 'completed' && restSeconds && restSeconds > 0) {
        setSession(
          await pushLocalClock(account!.id, session!.id, 'rest_start', {
            durationSeconds: restSeconds,
            exerciseSessionId: exercise!.id,
          }),
        );
      }
    } finally {
      recording.current = false;
      setSaving(false);
    }
  }

  return (
    <Screen
      title={exercise.name}
      subtitle={equipment || 'Sem academia selecionada'}
      onBack={() => router.back()}
    >
      {error ? <Notice tone="error" message={error} /> : null}
      {session.pending ? (
        <Notice message="Série salva neste aparelho. A sincronização continua depois." />
      ) : null}
      {rest && rest.exerciseSessionId === exercise.id ? (
        <View style={{ gap: 8 }}>
          <WorkoutClock
            value={formatClock(rest.remainingSeconds)}
            detail="Respire. Seu intervalo faz parte do treino."
            paused={rest.paused}
            rest
          />
          <Button
            label={rest.paused ? 'Retomar descanso' : 'Pausar descanso'}
            variant="secondary"
            onPress={() => {
              void pushLocalClock(
                account.id,
                session.id,
                rest.paused ? 'rest_resume' : 'rest_pause',
                {
                  durationSeconds: rest.durationSeconds,
                  exerciseSessionId: exercise.id,
                },
              ).then(setSession);
            }}
          />
          <Button
            label="Encerrar descanso"
            variant="secondary"
            onPress={() => {
              void pushLocalClock(account.id, session.id, 'rest_finish', {
                durationSeconds: rest.durationSeconds,
                exerciseSessionId: exercise.id,
              }).then(setSession);
            }}
          />
          <Button
            label="Reiniciar descanso"
            variant="secondary"
            onPress={() => {
              void pushLocalClock(account.id, session.id, 'rest_start', {
                durationSeconds: rest.durationSeconds,
                exerciseSessionId: exercise.id,
              }).then(setSession);
            }}
          />
        </View>
      ) : null}
      {planned?.sets.map((set) => {
        const done = performed.find((item) => item.plannedSetId === set.id);
        return (
          <Card key={set.id} style={{ padding: 16 }}>
            <Badge
              label={
                done
                  ? done.outcome === 'skipped'
                    ? 'PULADA'
                    : 'CONCLUÍDA'
                  : `SÉRIE ${set.setIndex}`
              }
            />
            <Text>
              {`Série ${set.setIndex}: ${set.repetitions ?? '—'} reps · ${set.load ? `${set.load} ${set.loadUnit}` : 'sem carga'}`}
            </Text>
            {done ? (
              <Text>{`Feito: ${done.repetitions ?? '—'} reps · ${done.load ? `${done.load} ${done.loadUnit}` : 'sem carga'}`}</Text>
            ) : null}
          </Card>
        );
      })}
      {open ? (
        <View style={{ gap: 8 }}>
          <Section title="Registre sua série" />
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Field
                label="Repetições feitas"
                value={reps}
                onChangeText={setReps}
                keyboardType="number-pad"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Carga feita (kg)"
                value={load}
                onChangeText={setLoad}
                keyboardType="decimal-pad"
              />
            </View>
          </View>
          <Button
            icon="check"
            label="Concluir série"
            busy={saving}
            onPress={() => {
              const next = planned?.sets.find(
                (set) => !performed.some((item) => item.plannedSetId === set.id),
              );
              void saveSet('completed', next?.id ?? null).catch(() =>
                setError('Não foi possível registrar a série.'),
              );
            }}
          />
          <Disclosure title="Pular ou adicionar uma série extra">
            <Button
              label="Pular série"
              busy={saving}
              variant="secondary"
              onPress={() => {
                const next = planned?.sets.find(
                  (set) => !performed.some((item) => item.plannedSetId === set.id),
                );
                void saveSet('skipped', next?.id ?? null).catch(() =>
                  setError('Não foi possível pular a série.'),
                );
              }}
            />
            <Button
              label="Adicionar série extra"
              busy={saving}
              variant="secondary"
              onPress={() => {
                void saveSet('completed', null).catch(() =>
                  setError('Não foi possível adicionar a série.'),
                );
              }}
            />
          </Disclosure>
        </View>
      ) : null}
      {performed.map((set) => (
        <Card key={set.id}>
          <Text>{`Registrada ${set.setIndex}: ${set.outcome === 'skipped' ? 'pulada' : `${set.repetitions ?? '—'} reps`}`}</Text>
          {open ? (
            <Button
              label="Desfazer marcação"
              variant="secondary"
              onPress={() => {
                void correctLocalSet(account.id, session.id, set.id, {
                  repetitions: null,
                  load: null,
                  loadUnit: null,
                  voided: true,
                  reason: 'Marcação desfeita pelo aluno.',
                })
                  .then(setSession)
                  .catch(() => setError('Não foi possível desfazer a série.'));
              }}
            />
          ) : null}
          {open ? (
            <Button
              label="Corrigir valores"
              variant="secondary"
              onPress={() => {
                const repetitions = reps.trim() ? Number(reps) : set.repetitions;
                void correctLocalSet(account.id, session.id, set.id, {
                  repetitions,
                  load: load.trim() ? load.trim() : set.load,
                  loadUnit: 'kg',
                  voided: false,
                  reason: 'Correção informada pelo aluno.',
                })
                  .then(setSession)
                  .catch(() => setError('Não foi possível corrigir a série.'));
              }}
            />
          ) : null}
        </Card>
      ))}
      <Section title="Como foi esse exercício?" detail="Seu feedback é opcional." />
      <Notice message={PERCEIVED_LEVEL_DISCLAIMER_PT} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {PERCEIVED_LEVELS.map((item) => (
          <Choice
            key={item}
            label={`${PERCEIVED_LEVEL_EMOJI[item]}`}
            accessibilityLabel={`${PERCEIVED_LEVEL_LABELS_PT[item]}, ${item} de 5`}
            selected={level === item}
            onPress={() => setLevel(item)}
          />
        ))}
      </View>
      <Text>{level ? PERCEIVED_LEVEL_LABELS_PT[level as 1 | 2 | 3 | 4 | 5] : 'Sem avaliação'}</Text>
      <Field
        label="Comentário do exercício"
        value={comment}
        onChangeText={setComment}
        multiline
        autoCapitalize="sentences"
      />
      {open ? (
        <Button
          label="Salvar comentário"
          variant="secondary"
          onPress={() => {
            if (level == null && !comment.trim()) {
              setError('Informe um comentário ou uma avaliação.');
              return;
            }
            void saveLocalFeedback(account.id, session.id, exercise.id, {
              perceivedLevel: level,
              comment: comment.trim() || null,
            })
              .then(setSession)
              .catch(() => setError('Não foi possível salvar o comentário.'));
          }}
        />
      ) : null}
      {open ? (
        <Button
          label="Concluir exercício"
          onPress={() => {
            void markLocalExercise(account.id, session.id, exercise.id, 'completed')
              .then(() => router.back())
              .catch(() => setError('Não foi possível concluir o exercício.'));
          }}
        />
      ) : null}
      {open ? (
        <Button
          label="Pular exercício"
          variant="secondary"
          onPress={() => {
            void markLocalExercise(account.id, session.id, exercise.id, 'skipped')
              .then(() => router.back())
              .catch(() => setError('Não foi possível pular o exercício.'));
          }}
        />
      ) : null}
    </Screen>
  );
}

export function SessionSummaryScreen() {
  const params = useLocalSearchParams<{ sessionId: string }>();
  const account = useSessionStore((state) => state.account);
  const [session, setSession] = useState<LocalSession | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!account) {
        return;
      }
      void readLocalSession(account.id, params.sessionId).then(setSession);
    }, [account, params.sessionId]),
  );

  if (!session) {
    return (
      <Screen title="Resumo" onBack={() => router.back()}>
        <Notice message="Carregando o resumo." />
      </Screen>
    );
  }
  const summary = sessionSummary(session, session.endedAt ?? new Date().toISOString());
  const started = new Date(summary.startedAt);
  return (
    <Screen
      title={summary.planName}
      subtitle={summary.gymName ?? 'Sem academia'}
      onBack={() => router.back()}
    >
      <Text>{started.toLocaleString('pt-BR')}</Text>
      <Text>{`Início ${started.toLocaleTimeString('pt-BR')}`}</Text>
      <Text>
        {summary.endedAt
          ? `Término ${new Date(summary.endedAt).toLocaleTimeString('pt-BR')}`
          : 'Em andamento'}
      </Text>
      <WorkoutClock value={formatClock(summary.activeSeconds)} detail="Tempo dedicado a você." />
      <Card style={{ flexDirection: 'row', gap: 16 }}>
        <Stat label="exercícios feitos" value={summary.completedExercises} />
        <Stat label="séries realizadas" value={summary.performedSets} />
      </Card>
      <Notice
        message={`${summary.plannedSets} séries planejadas · ${summary.skippedExercises} exercícios pulados`}
      />
      <Section title="O que ficou registrado" />
      {summary.loads.map((item) => (
        <Text key={`${item.exerciseName}-${item.setIndex}`}>
          {`${item.exerciseName} série ${item.setIndex}: planejado ${item.plannedLoad ?? 'sem carga'} ${item.plannedLoadUnit ?? ''} · feito ${item.load} ${item.loadUnit ?? ''}`}
        </Text>
      ))}
      {summary.feedback.map((item) => (
        <Text key={item.id}>
          {`${item.perceivedLevel ? PERCEIVED_LEVEL_EMOJI[item.perceivedLevel as 1 | 2 | 3 | 4 | 5] : ''} ${item.comment ?? ''}`}
        </Text>
      ))}
    </Screen>
  );
}

function WorkoutClock({
  value,
  detail,
  paused = false,
  rest = false,
}: {
  value: string;
  detail: string;
  paused?: boolean;
  rest?: boolean;
}) {
  const { palette } = usePalette();
  return (
    <Card
      style={{
        backgroundColor: rest ? palette.accentSoft : palette.surface,
        alignItems: 'center',
        paddingVertical: 26,
      }}
    >
      <Badge label={rest ? 'TEMPO DE DESCANSO' : paused ? 'TREINO PAUSADO' : 'TEMPO DE TREINO'} />
      <Text
        style={{
          fontSize: 48,
          lineHeight: 58,
          fontWeight: '800',
          letterSpacing: -2,
          color: palette.accent,
          fontVariant: ['tabular-nums'],
        }}
      >
        {value}
      </Text>
      <Text style={{ color: palette.muted, fontSize: 13, textAlign: 'center' }}>{detail}</Text>
    </Card>
  );
}
