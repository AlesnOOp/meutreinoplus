import { equipmentWriteSchema, type ExerciseView } from '@meutreino/shared';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useState } from 'react';
import { Alert, AppState, Image, Linking } from 'react-native';
import { photoPermissionAction, prepareEquipmentPhoto } from '@/catalog/photo-policy';
import { downloadEquipmentPhotoRequest } from '@/api/catalog';
import { ApiClientError } from '@/api/errors';
import {
  archiveEquipment,
  cacheDownloadedPhoto,
  listLocalEquipment,
  listLocalExercises,
  localEntityError,
  readLocalEquipment,
  readLocalGym,
  removeEquipmentPhoto,
  saveEquipment,
  saveEquipmentPhoto,
} from '@/catalog/catalog-store';
import { useSessionStore } from '@/session/session-store';
import {
  Button,
  EmptyState,
  Field,
  LoadingState,
  MenuLink,
  Notice,
  Screen,
  Section,
} from '@/ui/ui';

export function EquipmentListScreen() {
  const params = useLocalSearchParams<{ gymId?: string }>();
  const gymId = typeof params.gymId === 'string' ? params.gymId : undefined;
  const account = useSessionStore((state) => state.account);
  const [items, setItems] = useState<Awaited<ReturnType<typeof listLocalEquipment>>>([]);
  const [gymName, setGymName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!account) {
        return undefined;
      }
      let active = true;
      void (async () => {
        const [equipment, gym] = await Promise.all([
          listLocalEquipment(account.id, gymId),
          gymId ? readLocalGym(account.id, gymId) : Promise.resolve(null),
        ]);
        if (active) {
          setLoading(false);
          setItems(equipment);
          setGymName(gym?.name ?? null);
        }
      })().catch(() => {
        if (active) {
          setLoading(false);
          setError('Não foi possível abrir os equipamentos.');
        }
      });
      return () => {
        active = false;
      };
    }, [account, gymId]),
  );

  if (!account) {
    return null;
  }

  return (
    <Screen
      title={gymName ? `Equipamentos · ${gymName}` : 'Meus equipamentos'}
      subtitle="Reconheça cada máquina e encontre seus exercícios."
      onBack={() => router.back()}
    >
      {loading ? <LoadingState /> : null}
      {error ? <Notice tone="error" message={error} /> : null}
      {!loading && !error && items.length === 0 ? (
        <EmptyState
          title="Cada máquina no seu lugar."
          description="Cadastre os equipamentos dentro de uma academia. Adicione número e foto para reconhecer na hora."
          icon="dumbbell"
        />
      ) : null}
      {items.map((item) => (
        <MenuLink
          key={item.id}
          label={item.name}
          subtitle={item.machineNumber ? `Máquina ${item.machineNumber}` : 'Sem número de máquina'}
          icon="dumbbell"
          onPress={() => router.push(`/gyms/${item.gymId}/equipment/${item.id}`)}
        />
      ))}
      {gymId ? (
        <Button
          label="Novo equipamento"
          onPress={() => router.push(`/gyms/${gymId}/equipment/new`)}
        />
      ) : (
        <Button label="Escolher uma academia" icon="pin" onPress={() => router.push('/gyms')} />
      )}
    </Screen>
  );
}

export function EquipmentFormScreen({ mode }: { mode: 'create' | 'edit' }) {
  const params = useLocalSearchParams<{ gymId: string; equipmentId?: string }>();
  const account = useSessionStore((state) => state.account);
  const online = useSessionStore((state) => state.status) !== 'offline';
  const [name, setName] = useState('');
  const [machineNumber, setMachineNumber] = useState('');
  const [nickname, setNickname] = useState('');
  const [notes, setNotes] = useState('');
  const [exerciseIds, setExerciseIds] = useState<string[]>([]);
  const [exercises, setExercises] = useState<ExerciseView[]>([]);
  const [query, setQuery] = useState('');
  const [ready, setReady] = useState(mode === 'create');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!account) {
        return undefined;
      }
      let active = true;
      void (async () => {
        const library = await listLocalExercises(account.id, {});
        if (!active) {
          return;
        }
        setExercises(library);
        if (mode === 'edit' && params.equipmentId) {
          const current = await readLocalEquipment(account.id, params.equipmentId);
          if (!active) {
            return;
          }
          if (!current) {
            setError('Equipamento não encontrado.');
            return;
          }
          setName(current.name);
          setMachineNumber(current.machineNumber ?? '');
          setNickname(current.nickname ?? '');
          setNotes(current.notes ?? '');
          setExerciseIds(current.exerciseIds);
          setReady(true);
        }
      })();
      return () => {
        active = false;
      };
    }, [account, mode, params.equipmentId]),
  );

  async function submit(): Promise<void> {
    if (!account) {
      return;
    }
    const parsed = equipmentWriteSchema.safeParse({
      name,
      machineNumber,
      nickname,
      notes,
      exerciseIds,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Revise os campos.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await saveEquipment(
        account.id,
        params.gymId,
        { ...parsed.data, id: params.equipmentId },
        online,
      );
      router.replace(`/gyms/${params.gymId}/equipment/${saved.id}`);
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : 'Não foi possível salvar o equipamento.',
      );
    } finally {
      setBusy(false);
    }
  }

  const visible = exercises
    .filter((exercise) => {
      const needle = query.trim().toLocaleLowerCase('pt-BR');
      return !needle || exercise.namePt.toLocaleLowerCase('pt-BR').includes(needle);
    })
    .slice(0, 12);

  return (
    <Screen
      title={mode === 'create' ? 'Novo equipamento' : 'Editar equipamento'}
      footer={<Button icon="check" label="Salvar" busy={busy} onPress={() => void submit()} />}
      subtitle="Associe os exercícios que você faz nesta máquina. A associação vale para esta academia."
      onBack={() => router.back()}
    >
      {!ready && mode === 'edit' ? <Notice message="Carregando..." /> : null}
      <Field label="Nome" value={name} onChangeText={setName} autoCapitalize="words" />
      <Field label="Número" value={machineNumber} onChangeText={setMachineNumber} />
      <Field label="Apelido" value={nickname} onChangeText={setNickname} autoCapitalize="words" />
      <Field label="Observações" value={notes} onChangeText={setNotes} multiline />
      <Field label="Buscar exercício" value={query} onChangeText={setQuery} autoCapitalize="none" />
      {visible.map((exercise) => {
        const selected = exerciseIds.includes(exercise.id);
        return (
          <Button
            key={exercise.id}
            label={`${selected ? 'Vinculado · ' : ''}${exercise.namePt}`}
            variant={selected ? 'primary' : 'secondary'}
            onPress={() =>
              setExerciseIds((current) =>
                current.includes(exercise.id)
                  ? current.filter((id) => id !== exercise.id)
                  : [...current, exercise.id],
              )
            }
          />
        );
      })}
      {error ? <Notice tone="error" message={error} /> : null}
    </Screen>
  );
}

export function EquipmentDetailScreen() {
  const params = useLocalSearchParams<{ gymId: string; equipmentId: string }>();
  const account = useSessionStore((state) => state.account);
  const online = useSessionStore((state) => state.status) !== 'offline';
  const [equipment, setEquipment] = useState<Awaited<ReturnType<typeof readLocalEquipment>>>(null);
  const [names, setNames] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [permissionBlocked, setPermissionBlocked] = useState(false);

  const load = useCallback(async () => {
    if (!account) {
      return;
    }
    const current = await readLocalEquipment(account.id, params.equipmentId);
    setEquipment(current);
    if (!current) {
      setError('Equipamento não encontrado.');
      return;
    }
    const exercises = await listLocalExercises(account.id, {});
    setNames(
      exercises
        .filter((exercise) => current.exerciseIds.includes(exercise.id))
        .map((exercise) => exercise.namePt),
    );
    const syncError = await localEntityError(account.id, params.equipmentId);
    if (syncError) {
      setError(syncError);
    }
  }, [account, params.equipmentId]);

  useFocusEffect(
    useCallback(() => {
      void load();
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') {
          // Recheck on the next capture rather than assuming Settings granted access.
          setPermissionBlocked(false);
          setError(null);
          void load();
        }
      });
      return () => subscription.remove();
    }, [load]),
  );

  async function pick(source: 'library' | 'camera'): Promise<void> {
    if (!account || !equipment) {
      return;
    }
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const permission =
        source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (photoPermissionAction(permission) !== 'capture') {
        setPermissionBlocked(photoPermissionAction(permission) === 'settings');
        setError(
          source === 'camera'
            ? 'Permita a câmera para fotografar a máquina.'
            : 'Permita o acesso às fotos para continuar.',
        );
        return;
      }
      setPermissionBlocked(false);
      const launched =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({
              mediaTypes: ['images'],
              quality: 0.7,
              base64: true,
            })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ['images'],
              quality: 0.7,
              base64: true,
            });
      if (launched.canceled || !launched.assets[0]?.base64) {
        return;
      }
      const asset = launched.assets[0];
      const dataBase64 = asset?.base64;
      if (!dataBase64) {
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const { contentType, dataBase64 } = prepareEquipmentPhoto(asset);
        // Verify that native image decoding succeeds before preserving the payload.
        await new Promise<void>((resolve, reject) =>
          Image.getSize(
            `data:${contentType};base64,${dataBase64}`,
            () => resolve(),
            () => reject(new Error('A imagem está corrompida ou não pode ser exibida.')),
          ),
        );
        await saveEquipmentPhoto(
          account.id,
          params.gymId,
          equipment.id,
          contentType,
          dataBase64,
          online,
        );
        const saved = await readLocalEquipment(account.id, equipment.id);
        setMessage(
          saved?.photoPending
            ? 'Foto salva neste aparelho. Envio pendente; use Sincronizar quando houver conexão.'
            : 'Foto enviada ao servidor e salva neste aparelho.',
        );
        await load();
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : 'Não foi possível salvar a foto. A pendência local foi preservada.',
        );
      } finally {
        await load().catch(() => undefined);
      }
    } finally {
      setBusy(false);
    }
  }

  function confirmArchive(): void {
    Alert.alert(
      'Arquivar equipamento',
      'A máquina sai da lista ativa e as associações já feitas permanecem no histórico.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Arquivar',
          style: 'destructive',
          onPress: () => {
            if (!account) {
              return;
            }
            void archiveEquipment(account.id, params.gymId, params.equipmentId, online)
              .then(() => router.back())
              .catch(() => setError('Não foi possível arquivar o equipamento.'));
          },
        },
      ],
    );
  }

  if (!equipment) {
    return (
      <Screen title="Equipamento" onBack={() => router.back()}>
        {error ? <Notice tone="error" message={error} /> : <Notice message="Carregando..." />}
      </Screen>
    );
  }

  return (
    <Screen
      title={equipment.name}
      subtitle={[
        equipment.machineNumber ? `Número ${equipment.machineNumber}` : 'Sem número',
        equipment.nickname,
      ]
        .filter(Boolean)
        .join(' · ')}
      onBack={() => router.back()}
    >
      {equipment.photoUri ? (
        <Image
          accessibilityLabel={`Foto de ${equipment.name}`}
          source={{ uri: equipment.photoUri }}
          onError={() => setError('Não foi possível exibir esta imagem. Escolha outra foto.')}
          style={{ width: '100%', height: 220, borderRadius: 16 }}
        />
      ) : (
        <Notice
          message={
            equipment.hasPhoto
              ? 'Há uma foto salva. Abra com conexão para baixá-la.'
              : 'Nenhuma foto desta máquina.'
          }
        />
      )}
      {equipment.notes ? <Notice message={equipment.notes} /> : null}
      <Notice
        message={
          names.length > 0 ? `Exercícios: ${names.join(', ')}` : 'Nenhum exercício associado.'
        }
      />
      {message ? <Notice tone="success" message={message} /> : null}
      {error ? <Notice tone="error" message={error} /> : null}
      {permissionBlocked ? (
        <Button
          label="Abrir configurações de permissão"
          variant="secondary"
          onPress={() =>
            void Linking.openSettings().catch(() =>
              setError('Abra os Ajustes do aparelho e permita câmera ou fotos para MeuTreino+.'),
            )
          }
        />
      ) : null}
      {equipment.photoPending ? (
        <Notice message="Foto com alteração local pendente de envio." />
      ) : null}
      {!equipment.photoUri && equipment.hasPhoto ? (
        <Button
          label="Baixar foto"
          variant="secondary"
          busy={busy}
          onPress={() => {
            if (!account) {
              return;
            }
            setBusy(true);
            void downloadEquipmentPhotoRequest(params.gymId, equipment.id)
              .then(async (dataUrl) => {
                if (!dataUrl) {
                  setError('Nenhuma foto deste equipamento.');
                  return;
                }
                await cacheDownloadedPhoto(account.id, equipment.id, dataUrl);
                await load();
              })
              .catch(() => setError('Não foi possível baixar a foto.'))
              .finally(() => setBusy(false));
          }}
        />
      ) : null}
      <Section
        title="Fotos do equipamento"
        detail="Uma referência visual para encontrar a máquina."
      />
      <Button
        label="Escolher foto"
        busy={busy}
        onPress={() =>
          void pick('library').catch(() =>
            setError('Não foi possível abrir suas fotos. Verifique a permissão nos Ajustes.'),
          )
        }
      />
      <Button
        label="Tirar foto"
        variant="secondary"
        busy={busy}
        onPress={() =>
          void pick('camera').catch(() => setError('A câmera não está disponível neste aparelho.'))
        }
      />
      {equipment.hasPhoto || equipment.photoUri ? (
        <Button
          label="Remover foto"
          variant="secondary"
          onPress={() => {
            if (!account) {
              return;
            }
            void removeEquipmentPhoto(account.id, params.gymId, equipment.id, online)
              .then(() => load())
              .catch(() => setError('Não foi possível remover a foto.'));
          }}
        />
      ) : null}
      <Button
        label="Editar"
        variant="secondary"
        onPress={() => router.push(`/gyms/${params.gymId}/equipment/${equipment.id}/edit`)}
      />
      <Button label="Arquivar" variant="danger" onPress={confirmArchive} />
    </Screen>
  );
}
