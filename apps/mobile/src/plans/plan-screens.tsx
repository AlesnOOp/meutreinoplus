import { getPlanRequest } from '@/api/plans';
import { resolutionLabel } from './conflict-containment';
import { planColors } from '@/theme/colors';
import {
  BodyText as Text,
  Badge,
  Button,
  Card,
  Choice,
  ColorSwatch,
  Disclosure,
  EmptyState,
  Field,
  LoadingState,
  MenuLink,
  Notice,
  Screen,
  Section,
  Stat,
} from '@/ui/ui';

import {
  PLAN_ACCENT_LABELS_PT,
  PLAN_ACCENTS,
  PLANNED_SET_KIND_LABELS_PT,
  PLANNED_SET_KINDS,
  PROGRESSIVE_LOAD_NOTE_PT,
  planWriteSchema,
  type PlanExerciseInput,
  type PlanSetInput,
} from '@meutreino/shared';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { listLocalEquipment, listLocalExercises, listLocalGyms } from '@/catalog/catalog-store';
import {
  createLocalPlan,
  duplicateLocalPlan,
  emptyPlanSet,
  listLocalPlans,
  readLocalPlan,
  resolveLocalConflict,
  reconcileLocalPlanConflict,
  syncPlans,
  updateLocalPlan,
  type LocalPlan,
} from '@/plans/plan-store';
import { useSessionStore } from '@/session/session-store';

export function PlanListScreen({ archived = false }: { archived?: boolean }) {
  const account = useSessionStore((state) => state.account);
  const online = useSessionStore((state) => state.status) !== 'offline';
  const [items, setItems] = useState<LocalPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!account) {
        return undefined;
      }
      let active = true;
      void (async () => {
        if (online) {
          await syncPlans(account.id).catch(() => undefined);
        }
        const plans = await listLocalPlans(account.id, archived ? 'archived' : 'active');
        if (active) {
          setLoading(false);
          setItems(plans);
          setError(null);
        }
      })().catch(() => {
        if (active) {
          setLoading(false);
          setError('Não foi possível abrir as fichas.');
        }
      });
      return () => {
        active = false;
      };
    }, [account, archived, online]),
  );

  if (!account) {
    return null;
  }

  return (
    <Screen
      title={archived ? 'Fichas arquivadas' : 'Minhas fichas'}
      subtitle="Sua rotina organizada. Seu próximo treino a um toque."
    >
      {loading ? <LoadingState /> : null}
      {error ? <Notice tone="error" message={error} /> : null}
      {!loading && !error && items.length === 0 ? (
        <EmptyState
          title={archived ? 'Tudo em dia.' : 'Sua rotina começa aqui.'}
          description={
            archived
              ? 'As fichas que você arquivar ficam aqui para quando precisar.'
              : 'Crie uma ficha, adicione seus exercícios e deixe tudo pronto para treinar.'
          }
        />
      ) : null}
      {items.map((plan) => (
        <MenuLink
          key={plan.id}
          label={plan.name}
          subtitle={`${plan.exercises.length} exercícios · ${plan.exercises.reduce((n, e) => n + e.sets.length, 0)} séries`}
          icon="layers"
          tint={planColors[plan.accent ?? 'violet']}
          badge={plan.pending ? 'Local' : undefined}
          onPress={() => router.push(`/plans/${plan.id}`)}
        />
      ))}
      {archived ? null : (
        <>
          <Button icon="plus" label="Nova ficha" onPress={() => router.push('/plans/new')} />
          <Button
            label="Fichas arquivadas"
            variant="secondary"
            onPress={() => router.push('/plans/archived')}
          />
        </>
      )}
    </Screen>
  );
}

export function PlanFormScreen({ mode }: { mode: 'create' | 'edit' }) {
  const params = useLocalSearchParams<{ planId?: string }>();
  const planId = typeof params.planId === 'string' ? params.planId : undefined;
  const account = useSessionStore((state) => state.account);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [accent, setAccent] = useState<(typeof PLAN_ACCENTS)[number] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!account || mode === 'create' || !planId) {
        return undefined;
      }
      let active = true;
      void readLocalPlan(account.id, planId).then((plan) => {
        if (active && plan) {
          setName(plan.name);
          setDescription(plan.description ?? '');
          setAccent(plan.accent ?? null);
        }
      });
      return () => {
        active = false;
      };
    }, [account, mode, planId]),
  );

  if (!account) {
    return null;
  }

  async function save() {
    const parsed = planWriteSchema.safeParse({
      name,
      description,
      accent,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Revise a ficha.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'create') {
        const created = await createLocalPlan(account!.id, {
          name: parsed.data.name,
          description: parsed.data.description ?? null,
          accent: parsed.data.accent ?? null,
        });
        router.replace(`/plans/${created.id}`);
        return;
      }
      if (!planId) {
        return;
      }
      await updateLocalPlan(account!.id, planId, (plan) => {
        plan.name = parsed.data.name;
        plan.description = parsed.data.description ?? null;
        plan.accent = parsed.data.accent ?? null;
      });
      router.back();
    } catch {
      setError('Não foi possível salvar a ficha.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title={mode === 'create' ? 'Nova ficha' : 'Editar ficha'}
      footer={<Button icon="check" label="Salvar ficha" busy={busy} onPress={() => void save()} />}
      subtitle="Dê um nome que você reconheça, como Treino A ou Inferiores."
      onBack={() => router.back()}
    >
      {error ? <Notice tone="error" message={error} /> : null}
      <Field label="Nome" value={name} onChangeText={setName} autoCapitalize="words" />
      <Field
        label="Descrição"
        value={description}
        onChangeText={setDescription}
        autoCapitalize="sentences"
        multiline
      />
      <Text accessibilityRole="text">Cor</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {PLAN_ACCENTS.map((item) => (
          <ColorSwatch
            key={item}
            label={PLAN_ACCENT_LABELS_PT[item]}
            color={planColors[item]}
            selected={accent === item}
            onPress={() => setAccent(accent === item ? null : item)}
          />
        ))}
      </View>
    </Screen>
  );
}

export function PlanDetailScreen() {
  const params = useLocalSearchParams<{ planId: string }>();
  const planId = params.planId;
  const account = useSessionStore((state) => state.account);
  const online = useSessionStore((state) => state.status) !== 'offline';
  const [plan, setPlan] = useState<LocalPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!account) {
      return;
    }
    if (online) {
      await syncPlans(account.id).catch(() => undefined);
    }
    setPlan(await readLocalPlan(account.id, planId));
  }, [account, online, planId]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void reload()
        .then(() => {
          if (active) {
            setError(null);
          }
        })
        .catch(() => {
          if (active) {
            setError('Não foi possível abrir a ficha.');
          }
        });
      return () => {
        active = false;
      };
    }, [reload]),
  );

  if (!account) {
    return null;
  }
  if (!plan) {
    return (
      <Screen title="Ficha" onBack={() => router.back()}>
        {error ? <Notice tone="error" message={error} /> : <Notice message="Carregando a ficha." />}
      </Screen>
    );
  }

  async function move(index: number, direction: -1 | 1) {
    const next = index + direction;
    if (!plan || next < 0 || next >= plan.exercises.length) {
      return;
    }
    await updateLocalPlan(account!.id, plan.id, (current) => {
      const [item] = current.exercises.splice(index, 1);
      if (item) {
        current.exercises.splice(next, 0, item);
      }
    });
    setPlan(await readLocalPlan(account!.id, plan.id));
  }

  async function archiveOrRestore() {
    await updateLocalPlan(account!.id, plan!.id, (current) => {
      current.status = current.status === 'active' ? 'archived' : 'active';
    });
    router.back();
  }

  return (
    <Screen
      title={plan.name}
      subtitle={plan.description ?? 'Configuração da ficha.'}
      onBack={() => router.back()}
    >
      {error ? <Notice tone="error" message={error} /> : null}
      {plan.pending ? (
        <Notice message="Há alterações desta ficha ainda não sincronizadas. Elas permanecem neste aparelho." />
      ) : null}
      {plan.resolutionPendingChoice ? (
        <Notice
          message={`Uma decisão aguarda confirmação. Repita “${resolutionLabel(plan.resolutionPendingChoice)}” nas opções abaixo para retomar. Edições e novos treinos podem aguardar essa confirmação.`}
        />
      ) : null}
      {plan.conflictOperationId ? (
        <ConflictActions
          online={online}
          legacyPendingChoice={plan.resolutionPendingChoice}
          reconciliationPending={plan.reconciliationPending}
          onReconcile={async (choice, descendants) => {
            if (!online) throw new Error('Conecte-se para confirmar a decisão. Nada foi apagado.');
            const submit = async (expectedVersion?: number) => {
              await reconcileLocalPlanConflict(
                account.id,
                plan.id,
                choice,
                descendants,
                descendants === 'reapply' ? (plan.originRevisionId ?? null) : null,
                expectedVersion,
                Boolean(plan.reconciliationPending),
                plan.originRevisionId ?? undefined,
              );
            };
            try {
              if (plan.reconciliationPending) await submit();
              else {
                const remote = await getPlanRequest(plan.id);
                await new Promise<void>((resolve, reject) =>
                  Alert.alert(
                    'Confirmar reconciliação',
                    `Servidor: ${remote.name} (revisão ${remote.version}). Edição local exibida: ${plan.name}. ${choice === 'keep_both' ? 'Será criada uma ficha independente para a versão em conflito. ' : ''}${descendants === 'archive' ? 'As edições posteriores serão arquivadas sem apagar o conteúdo.' : 'A última edição local será reaplicada como uma nova revisão ' + (choice === 'keep_both' ? 'na cópia.' : 'sobre a versão do servidor.')}`,
                    [
                      { text: 'Cancelar', style: 'cancel', onPress: () => resolve() },
                      {
                        text: 'Confirmar',
                        onPress: () => {
                          void submit(remote.version).then(resolve, reject);
                        },
                      },
                    ],
                    { cancelable: true, onDismiss: () => resolve() },
                  ),
                );
              }
            } finally {
              await reload();
            }
          }}
          onChoice={async (choice) => {
            if (!online) {
              setError(
                'A revisão das duas versões precisa de conexão. A cópia deste aparelho continua salva.',
              );
              return;
            }
            await resolveLocalConflict(account.id, plan.id, choice);
            await reload();
          }}
        />
      ) : null}
      {plan.status === 'active' && plan.exercises.length > 0 ? (
        <Button
          icon="play"
          label="Iniciar treino"
          onPress={() => router.push(`/treino/iniciar?planId=${plan.id}`)}
        />
      ) : null}
      <Card style={{ flexDirection: 'row' }}>
        <Stat label="exercícios" value={plan.exercises.length} />
        <Stat
          label="séries planejadas"
          value={plan.exercises.reduce((n, e) => n + e.sets.length, 0)}
        />
      </Card>
      <Section
        title="Exercícios da ficha"
        detail="Toque no exercício para configurar suas séries."
      />
      {plan.exercises.length === 0 ? (
        <EmptyState
          title="Vamos montar sua ficha?"
          description="Adicione exercícios da biblioteca ou crie os seus."
          icon="dumbbell"
        />
      ) : null}
      {plan.exercises.map((exercise, index) => (
        <Card key={exercise.id}>
          <Badge label={`EXERCÍCIO ${index + 1}`} />
          <MenuLink
            plain
            label={exercise.exerciseName ?? 'Exercício'}
            onPress={() => router.push(`/plans/${plan.id}/exercises/${exercise.id}`)}
          />
          <Text>
            {exercise.equipment.length > 0
              ? exercise.equipment
                  .map((item) => {
                    const machine = item.machineNumber
                      ? `Máquina ${item.machineNumber}`
                      : item.equipmentName;
                    const archived = item.equipmentStatus === 'archived' ? ' (arquivado)' : '';
                    return `${item.gymName ?? 'Academia'} · ${machine ?? 'Equipamento'}${archived}`;
                  })
                  .join(' · ')
              : 'Sem equipamento preferencial'}
          </Text>
          <Text>
            {exercise.restSeconds !== null
              ? `Descanso configurado: ${exercise.restSeconds} segundos`
              : 'Sem descanso padrão'}
          </Text>
          {exercise.sets.map((set, setPosition) => (
            <Text key={set.id}>
              {`Série ${setPosition + 1} · ${set.repetitions ?? '—'} reps · ${formatLoad(set)}`}
            </Text>
          ))}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Button
                compact
                icon="up"
                label="Subir"
                disabled={index === 0}
                variant="ghost"
                onPress={() => void move(index, -1)}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                compact
                icon="down"
                label="Descer"
                disabled={index === plan.exercises.length - 1}
                variant="ghost"
                onPress={() => void move(index, 1)}
              />
            </View>
          </View>
        </Card>
      ))}
      {plan.status === 'active' ? (
        <Button
          icon="plus"
          label="Adicionar exercício"
          onPress={() => router.push(`/plans/${plan.id}/exercises/add`)}
        />
      ) : null}
      <Disclosure title="Gerenciar esta ficha">
        <Button
          label="Editar nome"
          variant="secondary"
          onPress={() => router.push(`/plans/${plan.id}/edit`)}
        />
        <Button
          label="Duplicar ficha"
          variant="secondary"
          onPress={() =>
            void duplicateLocalPlan(account.id, plan.id).then((copy) =>
              router.push(`/plans/${copy.id}`),
            )
          }
        />
        <Button
          label={plan.status === 'active' ? 'Arquivar ficha' : 'Restaurar ficha'}
          variant="secondary"
          onPress={() => void archiveOrRestore()}
        />
      </Disclosure>
    </Screen>
  );
}

export function ExercisePickerScreen() {
  const params = useLocalSearchParams<{ planId: string; replaceId?: string }>();
  const account = useSessionStore((state) => state.account);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<{ id: string; namePt: string }[]>([]);

  useFocusEffect(
    useCallback(() => {
      if (!account) {
        return undefined;
      }
      let active = true;
      void listLocalExercises(account.id, { q: query }).then((exercises) => {
        if (active) {
          setItems(exercises.map((exercise) => ({ id: exercise.id, namePt: exercise.namePt })));
        }
      });
      return () => {
        active = false;
      };
    }, [account, query]),
  );

  if (!account) {
    return null;
  }

  async function choose(exerciseId: string, exerciseName: string) {
    if (!account) {
      return;
    }
    if (typeof params.replaceId === 'string') {
      const replaceId = params.replaceId;
      Alert.alert('Substituir exercício', 'O que fazer com as séries já configuradas?', [
        {
          text: 'Preservar séries',
          onPress: () =>
            void updateLocalPlan(account!.id, params.planId, (plan) => {
              const exercise = plan.exercises.find((item) => item.id === replaceId);
              if (exercise) {
                exercise.exerciseId = exerciseId;
                exercise.exerciseName = exerciseName;
              }
            }).then(() => router.back()),
        },
        {
          text: 'Redefinir séries',
          style: 'destructive',
          onPress: () =>
            void updateLocalPlan(account!.id, params.planId, (plan) => {
              const exercise = plan.exercises.find((item) => item.id === replaceId);
              if (exercise) {
                exercise.exerciseId = exerciseId;
                exercise.exerciseName = exerciseName;
                exercise.sets = [emptyPlanSet()];
              }
            }).then(() => router.back()),
        },
        { text: 'Cancelar', style: 'cancel' },
      ]);
      return;
    }
    await updateLocalPlan(account.id, params.planId, (plan) => {
      plan.exercises.push({
        id: Crypto.randomUUID(),
        exerciseId,
        exerciseName,
        orderIndex: plan.exercises.length + 1,
        restSeconds: null,
        notes: null,
        equipment: [],
        sets: [emptyPlanSet()],
      });
    });
    router.back();
  }

  return (
    <Screen
      title="Selecionar exercício"
      subtitle="Catálogo geral ou exercício personalizado."
      onBack={() => router.back()}
    >
      <Field
        label="Pesquisar exercícios"
        value={query}
        onChangeText={setQuery}
        autoCapitalize="words"
      />
      {items.length === 0 ? <Notice message="Nenhum exercício encontrado neste aparelho." /> : null}
      {items.map((exercise) => (
        <MenuLink
          key={exercise.id}
          label={exercise.namePt}
          onPress={() => void choose(exercise.id, exercise.namePt)}
        />
      ))}
    </Screen>
  );
}

export function ExerciseConfigScreen() {
  const params = useLocalSearchParams<{ planId: string; planExerciseId: string }>();
  const account = useSessionStore((state) => state.account);
  const [exercise, setExercise] = useState<PlanExerciseInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!account) {
        return undefined;
      }
      let active = true;
      void readLocalPlan(account.id, params.planId).then((plan) => {
        const found = plan?.exercises.find((item) => item.id === params.planExerciseId) ?? null;
        if (active) {
          setExercise(found ? (JSON.parse(JSON.stringify(found)) as PlanExerciseInput) : null);
        }
      });
      return () => {
        active = false;
      };
    }, [account, params.planExerciseId, params.planId]),
  );

  if (!account || !exercise) {
    return (
      <Screen title="Exercício" onBack={() => router.back()}>
        <Notice message="Carregando o exercício." />
      </Screen>
    );
  }

  function updateSet(setId: string, change: (set: PlanSetInput) => void) {
    setExercise((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        sets: current.sets.map((set) => {
          if (set.id !== setId) {
            return set;
          }
          const next = { ...set };
          change(next);
          return next;
        }),
      };
    });
  }

  async function save(next = exercise) {
    if (!next) {
      return;
    }
    setBusy(true);
    try {
      await updateLocalPlan(account!.id, params.planId, (plan) => {
        const index = plan.exercises.findIndex((item) => item.id === params.planExerciseId);
        if (index >= 0) {
          plan.exercises[index] = { ...next, orderIndex: index + 1 };
        }
      });
      router.back();
    } catch {
      setError('Não foi possível salvar o exercício.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title={exercise.exerciseName ?? 'Configurar exercício'}
      footer={
        <Button icon="check" label="Salvar exercício" busy={busy} onPress={() => void save()} />
      }
      subtitle="Configure suas séries e salve as alterações ao terminar."
      onBack={() => router.back()}
    >
      {error ? <Notice tone="error" message={error} /> : null}
      <Section title="Séries planejadas" detail="Defina as repetições e a carga de cada série." />
      {exercise.sets.some((set) => set.loadType === 'progressive') ? (
        <Notice message={PROGRESSIVE_LOAD_NOTE_PT} />
      ) : null}
      {exercise.sets.map((set, index) => (
        <Card key={set.id}>
          <Badge label={`SÉRIE ${index + 1}`} />
          <Disclosure title={`Tipo: ${PLANNED_SET_KIND_LABELS_PT[set.kind]}`}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {PLANNED_SET_KINDS.map((kind) => (
                <Choice
                  key={kind}
                  label={PLANNED_SET_KIND_LABELS_PT[kind]}
                  selected={set.kind === kind}
                  onPress={() =>
                    updateSet(set.id, (current) => {
                      current.kind = kind;
                    })
                  }
                />
              ))}
            </View>
          </Disclosure>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Field
                label="Repetições"
                value={set.repetitions === null ? '' : String(set.repetitions)}
                onChangeText={(value) =>
                  updateSet(set.id, (current) => {
                    current.repetitions = value.trim() === '' ? null : Number(value);
                  })
                }
                keyboardType="number-pad"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Carga"
                value={set.load ?? ''}
                onChangeText={(value) =>
                  updateSet(set.id, (current) => {
                    current.load = value.trim() === '' ? null : value.trim();
                    if (current.load !== null && current.loadType === 'bodyweight') {
                      current.loadType = 'fixed';
                    }
                  })
                }
                keyboardType="decimal-pad"
              />
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Choice
              label="kg"
              selected={set.loadUnit === 'kg'}
              onPress={() =>
                updateSet(set.id, (current) => {
                  current.loadUnit = 'kg';
                })
              }
            />
            <Choice
              label="lb"
              selected={set.loadUnit === 'lb'}
              onPress={() =>
                updateSet(set.id, (current) => {
                  current.loadUnit = 'lb';
                })
              }
            />
          </View>
          <Disclosure title="Mais opções desta série">
            <Button
              label="Usar esta carga em todas"
              variant="secondary"
              onPress={() =>
                setExercise({
                  ...exercise,
                  sets: exercise.sets.map((item) => ({
                    ...item,
                    load: set.load,
                    loadUnit: set.loadUnit,
                    loadType: set.load === null ? 'bodyweight' : 'fixed',
                  })),
                })
              }
            />
            <Button
              label="Carga diferente nesta série"
              variant="secondary"
              onPress={() =>
                updateSet(set.id, (current) => {
                  current.loadType = 'progressive';
                })
              }
            />
            <Button
              label="Sem carga externa"
              variant="secondary"
              onPress={() =>
                updateSet(set.id, (current) => {
                  current.load = null;
                  current.loadType = 'bodyweight';
                })
              }
            />
            <Button
              label="Duplicar série"
              variant="secondary"
              onPress={() =>
                setExercise({
                  ...exercise,
                  sets: [...exercise.sets, { ...set, id: Crypto.randomUUID() }],
                })
              }
            />
            <Button
              label="Remover série"
              variant="danger"
              onPress={() =>
                setExercise({
                  ...exercise,
                  sets: exercise.sets.filter((item) => item.id !== set.id),
                })
              }
            />
          </Disclosure>
        </Card>
      ))}
      <Button
        icon="plus"
        label="Adicionar série"
        variant="secondary"
        onPress={() => setExercise({ ...exercise, sets: [...exercise.sets, emptyPlanSet()] })}
      />

      <Disclosure title="Descanso, observações e equipamento">
        <Field
          label="Observações"
          value={exercise.notes ?? ''}
          onChangeText={(value) => setExercise({ ...exercise, notes: value || null })}
          autoCapitalize="sentences"
          multiline
        />
        <Field
          label="Descanso padrão (segundos)"
          value={exercise.restSeconds === null ? '' : String(exercise.restSeconds)}
          onChangeText={(value) =>
            setExercise({
              ...exercise,
              restSeconds: value.trim() === '' ? null : Number(value),
            })
          }
          keyboardType="number-pad"
        />
        <Button
          label="Equipamento por academia"
          variant="secondary"
          onPress={() => {
            void updateLocalPlan(account.id, params.planId, (plan) => {
              const index = plan.exercises.findIndex((item) => item.id === exercise.id);
              if (index >= 0) {
                plan.exercises[index] = exercise;
              }
            }).then(() =>
              router.push(`/plans/${params.planId}/exercises/${exercise.id}/equipment`),
            );
          }}
        />
        <Button
          label="Substituir exercício"
          variant="secondary"
          onPress={() =>
            router.push(`/plans/${params.planId}/exercises/add?replaceId=${exercise.id}`)
          }
        />
      </Disclosure>
      <Button
        label="Remover da ficha"
        variant="danger"
        onPress={() =>
          void updateLocalPlan(account.id, params.planId, (plan) => {
            plan.exercises = plan.exercises.filter((item) => item.id !== exercise.id);
          }).then(() => router.back())
        }
      />
    </Screen>
  );
}

export function EquipmentPickerScreen() {
  const params = useLocalSearchParams<{ planId: string; planExerciseId: string }>();
  const account = useSessionStore((state) => state.account);
  const [gyms, setGyms] = useState<
    { id: string; name: string; equipment: { id: string; label: string }[] }[]
  >([]);
  const [selected, setSelected] = useState<PlanExerciseInput['equipment']>([]);

  useFocusEffect(
    useCallback(() => {
      if (!account) {
        return undefined;
      }
      let active = true;
      void (async () => {
        const plan = await readLocalPlan(account.id, params.planId);
        const exercise = plan?.exercises.find((item) => item.id === params.planExerciseId);
        const localGyms = await listLocalGyms(account.id);
        const groups = [];
        for (const gym of localGyms) {
          const equipment = await listLocalEquipment(account.id, gym.id);
          groups.push({
            id: gym.id,
            name: gym.name,
            equipment: equipment.map((item) => ({
              id: item.id,
              label: item.machineNumber
                ? `${item.name} · Máquina ${item.machineNumber}`
                : item.name,
            })),
          });
        }
        if (active) {
          setSelected(exercise?.equipment ?? []);
          setGyms(groups);
        }
      })();
      return () => {
        active = false;
      };
    }, [account, params.planExerciseId, params.planId]),
  );

  if (!account) {
    return null;
  }

  async function choose(
    gymId: string,
    gymName: string,
    equipmentId: string | null,
    label: string | null,
  ) {
    const next = selected.filter((item) => item.gymId !== gymId);
    if (equipmentId && label) {
      const [equipmentName, machineNumber] = label.split(' · Máquina ');
      next.push({
        gymId,
        gymName,
        equipmentId,
        equipmentName: equipmentName ?? label,
        machineNumber: machineNumber ?? null,
        equipmentStatus: 'active',
      });
    }
    setSelected(next);
    await updateLocalPlan(account!.id, params.planId, (plan) => {
      const exercise = plan.exercises.find((item) => item.id === params.planExerciseId);
      if (exercise) {
        exercise.equipment = next;
      }
    });
  }

  return (
    <Screen
      title="Equipamento"
      subtitle="A mesma ficha pode apontar para máquinas diferentes em cada academia."
      onBack={() => router.back()}
    >
      {gyms.length === 0 ? (
        <Notice message="Cadastre uma academia e um equipamento para associá-los à ficha." />
      ) : null}
      {gyms.map((gym) => (
        <View key={gym.id} style={{ gap: 8 }}>
          <Text>{gym.name}</Text>
          <Choice
            label="Sem equipamento"
            selected={!selected.some((item) => item.gymId === gym.id)}
            onPress={() => void choose(gym.id, gym.name, null, null)}
          />
          {gym.equipment.map((item) => (
            <Choice
              key={item.id}
              label={item.label}
              selected={selected.some((preference) => preference.equipmentId === item.id)}
              onPress={() => void choose(gym.id, gym.name, item.id, item.label)}
            />
          ))}
        </View>
      ))}
    </Screen>
  );
}

function ConflictActions({
  online,
  onChoice,
  onReconcile,
  legacyPendingChoice,
  reconciliationPending,
}: {
  online: boolean;
  onChoice: (choice: 'keep_server' | 'keep_local' | 'keep_both') => Promise<void>;
  onReconcile: (
    choice: 'keep_server' | 'keep_both',
    descendants: 'archive' | 'reapply',
  ) => Promise<void>;
  legacyPendingChoice?: 'keep_server' | 'keep_local' | 'keep_both';
  reconciliationPending?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function act(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Decisão não confirmada. Reabra a ficha e retome.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 8 }}>
      {error ? <Notice tone="error" message={error} /> : null}
      <Notice message="Esta ficha mudou em outro lugar. Arquivar preserva o conteúdo local no histórico. Reaplicar cria outra revisão com a última edição exibida nesta ficha, sem modificar sua origem." />
      {!online ? (
        <Notice message="Conecte-se para confirmar; as alterações continuam neste aparelho." />
      ) : null}
      {reconciliationPending ? (
        <Button
          label="Retomar reconciliação"
          disabled={busy}
          onPress={() => void act(() => onReconcile('keep_server', 'archive'))}
        />
      ) : legacyPendingChoice ? (
        <Button
          label={`Retomar: ${resolutionLabel(legacyPendingChoice)}`}
          disabled={busy}
          onPress={() => void act(() => onChoice(legacyPendingChoice))}
        />
      ) : (
        <>
          <Button
            label="Manter a versão deste aparelho"
            disabled={busy}
            onPress={() => void act(() => onChoice('keep_local'))}
          />
          <Button
            label="Manter servidor e arquivar edições locais"
            variant="secondary"
            disabled={busy}
            onPress={() => void act(() => onReconcile('keep_server', 'archive'))}
          />
          <Button
            label="Reaplicar última edição sobre a versão do servidor"
            variant="secondary"
            disabled={busy}
            onPress={() => void act(() => onReconcile('keep_server', 'reapply'))}
          />
          <Button
            label="Guardar duas fichas e arquivar edições posteriores"
            variant="secondary"
            disabled={busy}
            onPress={() => void act(() => onReconcile('keep_both', 'archive'))}
          />
          <Button
            label="Guardar duas fichas e reaplicar última edição na cópia"
            variant="secondary"
            disabled={busy}
            onPress={() => void act(() => onReconcile('keep_both', 'reapply'))}
          />
        </>
      )}
    </View>
  );
}

function formatLoad(set: PlanSetInput): string {
  if (set.load === null) {
    return 'sem carga externa';
  }
  const display = set.load.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  return `${display} ${set.loadUnit}`;
}
