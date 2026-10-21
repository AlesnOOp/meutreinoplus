import { gymWriteSchema } from '@meutreino/shared';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { ApiClientError } from '@/api/errors';
import {
  archiveGym,
  listLocalGyms,
  readLocalGym,
  saveGym,
  syncCatalog,
} from '@/catalog/catalog-store';
import { useSessionStore } from '@/session/session-store';
import {
  Button,
  Choice,
  EmptyState,
  Field,
  LoadingState,
  MenuLink,
  Notice,
  Screen,
  Section,
} from '@/ui/ui';

export function GymListScreen() {
  const account = useSessionStore((state) => state.account);
  const online = useSessionStore((state) => state.status) !== 'offline';
  const [items, setItems] = useState<
    { id: string; name: string; isPreferred: boolean; city: string | null }[]
  >([]);
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
          await syncCatalog(account.id).catch(() => undefined);
        }
        const gyms = await listLocalGyms(account.id);
        if (active) {
          setLoading(false);
          setItems(gyms);
          setError(null);
        }
      })().catch(() => {
        if (active) {
          setLoading(false);
          setError('Não foi possível abrir as academias.');
        }
      });
      return () => {
        active = false;
      };
    }, [account, online]),
  );

  if (!account) {
    return null;
  }

  return (
    <Screen
      title="Minhas academias"
      subtitle="Seus lugares de treino, sempre à mão."
      onBack={() => router.back()}
    >
      {loading ? <LoadingState /> : null}
      {error ? <Notice tone="error" message={error} /> : null}
      {!loading && !error && items.length === 0 ? (
        <EmptyState
          title="Qual é o seu lugar?"
          description="Adicione sua academia para organizar as máquinas e os equipamentos de cada unidade."
          icon="pin"
        />
      ) : null}
      {items.map((gym) => (
        <MenuLink
          key={gym.id}
          label={gym.name}
          subtitle={gym.city ?? 'Sua academia'}
          icon="pin"
          badge={gym.isPreferred ? 'Preferida' : undefined}
          onPress={() => router.push(`/gyms/${gym.id}`)}
        />
      ))}
      <Button icon="plus" label="Nova academia" onPress={() => router.push('/gyms/new')} />
    </Screen>
  );
}

export function GymFormScreen({ mode }: { mode: 'create' | 'edit' }) {
  const params = useLocalSearchParams<{ gymId?: string }>();
  const gymId = typeof params.gymId === 'string' ? params.gymId : undefined;
  const account = useSessionStore((state) => state.account);
  const online = useSessionStore((state) => state.status) !== 'offline';
  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [branchName, setBranchName] = useState('');
  const [city, setCity] = useState('');
  const [notes, setNotes] = useState('');
  const [isPreferred, setIsPreferred] = useState(false);
  const [ready, setReady] = useState(mode === 'create');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!account || mode === 'create' || !gymId) {
        return undefined;
      }
      let active = true;
      void readLocalGym(account.id, gymId).then((gym) => {
        if (!active || !gym) {
          if (active) {
            setError('Academia não encontrada.');
          }
          return;
        }
        setName(gym.name);
        setNickname(gym.nickname ?? '');
        setBranchName(gym.branchName ?? '');
        setCity(gym.city ?? '');
        setNotes(gym.notes ?? '');
        setIsPreferred(gym.isPreferred);
        setReady(true);
      });
      return () => {
        active = false;
      };
    }, [account, gymId, mode]),
  );

  async function submit(): Promise<void> {
    if (!account) {
      return;
    }
    const parsed = gymWriteSchema.safeParse({
      name,
      nickname,
      branchName,
      city,
      notes,
      isPreferred,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Revise os campos.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await saveGym(account.id, { ...parsed.data, id: gymId }, online);
      router.replace(`/gyms/${saved.id}`);
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : 'Não foi possível salvar a academia.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (!ready && !error) {
    return (
      <Screen title="Academia" subtitle="Carregando..." onBack={() => router.back()}>
        <Notice message="Carregando..." />
      </Screen>
    );
  }

  return (
    <Screen
      title={mode === 'create' ? 'Nova academia' : 'Editar academia'}
      footer={<Button icon="check" label="Salvar" busy={busy} onPress={() => void submit()} />}
      subtitle="O nome é obrigatório. Unidade, cidade e apelido ajudam quando você treina em mais de um lugar."
      onBack={() => router.back()}
    >
      <Field
        label="Nome"
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        autoComplete="name"
      />
      <Section
        title="Detalhes da unidade"
        detail="Campos opcionais para reconhecer sua academia."
      />
      <Field label="Apelido" value={nickname} onChangeText={setNickname} autoCapitalize="words" />
      <Field
        label="Unidade ou filial"
        value={branchName}
        onChangeText={setBranchName}
        autoCapitalize="words"
      />
      <Field label="Cidade" value={city} onChangeText={setCity} autoCapitalize="words" />
      <Field
        label="Observações"
        value={notes}
        onChangeText={setNotes}
        autoCapitalize="sentences"
        multiline
      />
      <Choice
        label="Usar como academia preferida"
        selected={isPreferred}
        onPress={() => setIsPreferred((value) => !value)}
      />
      {error ? <Notice tone="error" message={error} /> : null}
    </Screen>
  );
}

export function GymDetailScreen() {
  const params = useLocalSearchParams<{ gymId: string }>();
  const gymId = params.gymId;
  const account = useSessionStore((state) => state.account);
  const online = useSessionStore((state) => state.status) !== 'offline';
  const [gym, setGym] = useState<Awaited<ReturnType<typeof readLocalGym>>>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!account) {
        return undefined;
      }
      let active = true;
      void readLocalGym(account.id, gymId).then((value) => {
        if (active) {
          setGym(value);
          if (!value) {
            setError('Academia não encontrada.');
          }
        }
      });
      return () => {
        active = false;
      };
    }, [account, gymId]),
  );

  function confirmArchive(): void {
    Alert.alert(
      'Arquivar academia',
      'Os equipamentos e o histórico permanecem. A academia sai da lista ativa.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Arquivar',
          style: 'destructive',
          onPress: () => {
            if (!account) {
              return;
            }
            void archiveGym(account.id, gymId, online)
              .then(() => router.back())
              .catch(() => setError('Não foi possível arquivar a academia.'));
          },
        },
      ],
    );
  }

  if (!gym) {
    return (
      <Screen title="Academia" onBack={() => router.back()}>
        {error ? <Notice tone="error" message={error} /> : <Notice message="Carregando..." />}
      </Screen>
    );
  }

  return (
    <Screen
      title={gym.name}
      subtitle={
        [gym.nickname, gym.branchName, gym.city].filter(Boolean).join(' · ') ||
        'Sem unidade informada.'
      }
      onBack={() => router.back()}
    >
      {gym.isPreferred ? <Notice tone="success" message="Esta é a academia preferencial." /> : null}
      {gym.notes ? <Notice message={gym.notes} /> : null}
      {error ? <Notice tone="error" message={error} /> : null}
      <Button label="Ver equipamentos" onPress={() => router.push(`/equipment?gymId=${gym.id}`)} />
      <Button
        label="Novo equipamento"
        variant="secondary"
        onPress={() => router.push(`/gyms/${gym.id}/equipment/new`)}
      />
      <Button
        label="Editar"
        variant="secondary"
        onPress={() => router.push(`/gyms/${gym.id}/edit`)}
      />
      <Button label="Arquivar" variant="danger" onPress={confirmArchive} />
    </Screen>
  );
}
