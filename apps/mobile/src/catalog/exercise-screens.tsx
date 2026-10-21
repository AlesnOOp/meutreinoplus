import {
  ACTIVITY_TYPE_LABELS_PT,
  ACTIVITY_TYPES,
  EQUIPMENT_TYPE_LABELS_PT,
  EQUIPMENT_TYPES,
  MUSCLE_GROUP_LABELS_PT,
  MUSCLE_GROUPS,
  exerciseWriteSchema,
  type ExerciseView,
} from '@meutreino/shared';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { ApiClientError } from '@/api/errors';
import {
  archiveExercise,
  discardLocalChange,
  listLocalExercises,
  localEntityError,
  readLocalExercise,
  saveExercise,
  syncCatalog,
} from '@/catalog/catalog-store';
import { useSessionStore } from '@/session/session-store';
import {
  Button,
  Choice,
  Disclosure,
  EmptyState,
  Field,
  LoadingState,
  MenuLink,
  Notice,
  Screen,
  Section,
} from '@/ui/ui';

export function ExerciseListScreen() {
  const params = useLocalSearchParams<{ origin?: string }>();
  const origin = params.origin === 'user' ? 'user' : undefined;
  const account = useSessionStore((state) => state.account);
  const online = useSessionStore((state) => state.status) !== 'offline';
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState<string | null>(null);
  const [equipmentType, setEquipmentType] = useState<string | null>(null);
  const [items, setItems] = useState<ExerciseView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setRevision((value) => value + 1);
      if (account && online)
        void syncCatalog(account.id)
          .then(() => {
            if (active) setRevision((value) => value + 1);
          })
          .catch(() => undefined);
      return () => {
        active = false;
      };
    }, [account, online]),
  );

  useEffect(() => {
    if (!account) {
      return undefined;
    }
    let active = true;
    void (async () => {
      const exercises = await listLocalExercises(account.id, { q: query, origin });
      if (active) {
        setLoading(false);
        setItems(
          exercises
            .filter((exercise) => (muscle ? exercise.primaryMuscle === muscle : true))
            .filter((exercise) =>
              equipmentType
                ? exercise.equipmentTypes.includes(
                    equipmentType as ExerciseView['equipmentTypes'][number],
                  )
                : true,
            ),
        );
        setError(null);
      }
    })().catch(() => {
      if (active) {
        setLoading(false);
        setError('Não foi possível abrir a biblioteca.');
      }
    });
    return () => {
      active = false;
    };
  }, [account, equipmentType, muscle, origin, query, revision]);

  if (!account) {
    return null;
  }

  return (
    <Screen
      title={origin === 'user' ? 'Exercícios personalizados' : 'Biblioteca de exercícios'}
      subtitle="Encontre seus movimentos. Monte o treino do seu jeito."
    >
      <Field label="Pesquisar" value={query} onChangeText={setQuery} autoCapitalize="none" />
      <Disclosure title="Filtrar por músculo ou equipamento">
        <Section title="Grupo muscular" />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingBottom: 4 }}
        >
          {MUSCLE_GROUPS.map((item) => (
            <Choice
              key={item}
              label={MUSCLE_GROUP_LABELS_PT[item]}
              selected={muscle === item}
              onPress={() => setMuscle((current) => (current === item ? null : item))}
            />
          ))}
        </ScrollView>
        <Section title="Equipamento" />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingBottom: 4 }}
        >
          {EQUIPMENT_TYPES.map((item) => (
            <Choice
              key={item}
              label={EQUIPMENT_TYPE_LABELS_PT[item]}
              selected={equipmentType === item}
              onPress={() => setEquipmentType((current) => (current === item ? null : item))}
            />
          ))}
        </ScrollView>
      </Disclosure>
      {muscle || equipmentType ? (
        <Button
          label="Limpar filtros"
          variant="ghost"
          onPress={() => {
            setMuscle(null);
            setEquipmentType(null);
          }}
        />
      ) : null}
      {loading ? <LoadingState /> : null}
      {error ? <Notice tone="error" message={error} /> : null}
      {!loading && !error && items.length === 0 ? (
        <EmptyState
          title="Nenhum exercício por aqui."
          description="Tente outro nome, ajuste os filtros ou crie um exercício personalizado."
          icon="search"
        />
      ) : (
        <Section title={`${items.length} exercícios`} />
      )}
      {items.map((exercise) => (
        <MenuLink
          key={exercise.id}
          label={exercise.namePt}
          subtitle={
            exercise.primaryMuscle
              ? MUSCLE_GROUP_LABELS_PT[exercise.primaryMuscle]
              : 'Exercício personalizado'
          }
          icon="dumbbell"
          onPress={() => router.push(`/exercises/${exercise.id}`)}
        />
      ))}
      <Button icon="plus" label="Criar exercício" onPress={() => router.push('/exercises/new')} />
    </Screen>
  );
}

export function ExerciseFormScreen({ mode }: { mode: 'create' | 'edit' }) {
  const params = useLocalSearchParams<{ exerciseId?: string }>();
  const exerciseId = typeof params.exerciseId === 'string' ? params.exerciseId : undefined;
  const account = useSessionStore((state) => state.account);
  const online = useSessionStore((state) => state.status) !== 'offline';
  const [namePt, setNamePt] = useState('');
  const [alternativeName, setAlternativeName] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [activityType, setActivityType] = useState<(typeof ACTIVITY_TYPES)[number]>('strength');
  const [primaryMuscle, setPrimaryMuscle] = useState<(typeof MUSCLE_GROUPS)[number]>('other');
  const [secondaryMuscles, setSecondaryMuscles] = useState<(typeof MUSCLE_GROUPS)[number][]>([]);
  const [equipmentTypes, setEquipmentTypes] = useState<(typeof EQUIPMENT_TYPES)[number][]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!account || mode === 'create' || !exerciseId) {
        return undefined;
      }
      let active = true;
      void readLocalExercise(account.id, exerciseId).then((exercise) => {
        if (!active) {
          return;
        }
        if (!exercise?.editable || !exercise.primaryMuscle) {
          setError('Exercícios da biblioteca geral não podem ser editados.');
          return;
        }
        setNamePt(exercise.namePt);
        setAlternativeName(exercise.alternativeName ?? '');
        setDescription(exercise.description ?? '');
        setInstructions(exercise.instructions ?? '');
        setActivityType(exercise.activityType);
        setPrimaryMuscle(exercise.primaryMuscle);
        setSecondaryMuscles(exercise.secondaryMuscles);
        setEquipmentTypes(exercise.equipmentTypes);
      });
      return () => {
        active = false;
      };
    }, [account, exerciseId, mode]),
  );

  async function submit(): Promise<void> {
    if (!account) {
      return;
    }
    const parsed = exerciseWriteSchema.safeParse({
      namePt,
      alternativeName,
      description,
      instructions,
      activityType,
      primaryMuscle,
      secondaryMuscles,
      equipmentTypes,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Revise os campos.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await saveExercise(account.id, { ...parsed.data, id: exerciseId }, online);
      router.replace(`/exercises/${saved.id}`);
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : 'Não foi possível salvar o exercício.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title={mode === 'create' ? 'Novo exercício' : 'Editar exercício'}
      footer={<Button icon="check" label="Salvar" busy={busy} onPress={() => void submit()} />}
      subtitle="Descreva o movimento. Não inclua carga, séries ou recomendação clínica."
      onBack={() => router.back()}
    >
      <Field label="Nome" value={namePt} onChangeText={setNamePt} autoCapitalize="sentences" />
      <Field
        label="Nome alternativo"
        value={alternativeName}
        onChangeText={setAlternativeName}
        autoCapitalize="sentences"
      />
      <Field label="Descrição" value={description} onChangeText={setDescription} multiline />
      <Field label="Instruções" value={instructions} onChangeText={setInstructions} multiline />
      <Section title="Tipo de atividade" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {' '}
        {ACTIVITY_TYPES.map((item) => (
          <Choice
            key={item}
            label={ACTIVITY_TYPE_LABELS_PT[item]}
            selected={activityType === item}
            onPress={() => setActivityType(item)}
          />
        ))}
      </View>
      <Section title="Grupo muscular principal" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {' '}
        {MUSCLE_GROUPS.map((item) => (
          <Choice
            key={item}
            label={MUSCLE_GROUP_LABELS_PT[item]}
            selected={primaryMuscle === item}
            onPress={() => setPrimaryMuscle(item)}
          />
        ))}
      </View>
      <Disclosure title="Músculos secundários (opcional)">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {' '}
          {MUSCLE_GROUPS.filter((item) => item !== primaryMuscle).map((item) => (
            <Choice
              key={`secondary-${item}`}
              label={MUSCLE_GROUP_LABELS_PT[item]}
              selected={secondaryMuscles.includes(item)}
              onPress={() =>
                setSecondaryMuscles((current) =>
                  current.includes(item)
                    ? current.filter((muscle) => muscle !== item)
                    : [...current, item].slice(0, 6),
                )
              }
            />
          ))}
        </View>
      </Disclosure>
      <Disclosure title="Equipamentos utilizados (opcional)">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {' '}
          {EQUIPMENT_TYPES.map((item) => (
            <Choice
              key={item}
              label={EQUIPMENT_TYPE_LABELS_PT[item]}
              selected={equipmentTypes.includes(item)}
              onPress={() =>
                setEquipmentTypes((current) =>
                  current.includes(item)
                    ? current.filter((value) => value !== item)
                    : [...current, item].slice(0, 6),
                )
              }
            />
          ))}
        </View>
      </Disclosure>{' '}
      {error ? <Notice tone="error" message={error} /> : null}
    </Screen>
  );
}

export function ExerciseDetailScreen() {
  const params = useLocalSearchParams<{ exerciseId: string }>();
  const account = useSessionStore((state) => state.account);
  const online = useSessionStore((state) => state.status) !== 'offline';
  const [exercise, setExercise] = useState<ExerciseView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!account) {
        return undefined;
      }
      let active = true;
      void (async () => {
        const current = await readLocalExercise(account.id, params.exerciseId);
        const syncError = await localEntityError(account.id, params.exerciseId);
        if (active) {
          setExercise(current);
          setError(syncError ?? (current ? null : 'Exercício não encontrado.'));
        }
      })();
      return () => {
        active = false;
      };
    }, [account, params.exerciseId]),
  );

  function confirmArchive(): void {
    Alert.alert(
      'Arquivar exercício',
      'Ele sai da sua lista. Exercícios da biblioteca geral não são alterados.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Arquivar',
          style: 'destructive',
          onPress: () => {
            if (!account || !exercise) {
              return;
            }
            void archiveExercise(account.id, exercise.id, online)
              .then(() => router.back())
              .catch((caught: unknown) =>
                setError(caught instanceof Error ? caught.message : 'Não foi possível arquivar.'),
              );
          },
        },
      ],
    );
  }

  if (!exercise) {
    return (
      <Screen title="Exercício" onBack={() => router.back()}>
        {error ? <Notice tone="error" message={error} /> : <Notice message="Carregando..." />}
      </Screen>
    );
  }

  return (
    <Screen
      title={exercise.namePt}
      subtitle={
        exercise.alternativeName ??
        (exercise.origin === 'user' ? 'Exercício personalizado' : 'Biblioteca geral')
      }
      onBack={() => router.back()}
    >
      <Notice message={exercise.description ?? 'Sem descrição.'} />
      {exercise.instructions ? <Notice message={exercise.instructions} /> : null}
      <Notice
        message={`Grupo principal: ${exercise.primaryMuscle ? MUSCLE_GROUP_LABELS_PT[exercise.primaryMuscle] : 'não informado'}. Tipo: ${ACTIVITY_TYPE_LABELS_PT[exercise.activityType]}.`}
      />
      {error ? <Notice tone="error" message={error} /> : null}
      {exercise.editable ? (
        <Button label="Editar" onPress={() => router.push(`/exercises/${exercise.id}/edit`)} />
      ) : (
        <Notice message="Este exercício faz parte da biblioteca geral e não pode ser editado." />
      )}
      {exercise.editable ? (
        <Button label="Arquivar" variant="danger" onPress={confirmArchive} />
      ) : null}
      {error ? (
        <Button
          label="Descartar alteração local"
          variant="secondary"
          onPress={() => {
            if (!account) {
              return;
            }
            void discardLocalChange(account.id, exercise.id)
              .then(() => syncCatalog(account.id))
              .then(() => router.back())
              .catch(() => setError('Não foi possível descartar a alteração.'));
          }}
        />
      ) : null}
    </Screen>
  );
}
