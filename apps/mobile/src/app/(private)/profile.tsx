import { profileUpdateSchema, type ProfileUpdate } from '@meutreino/shared';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, View } from 'react-native';
import {
  deleteProfilePhoto,
  fetchAccount,
  fetchProfilePhoto,
  updateAccount,
  uploadProfilePhoto,
} from '@/api/client';
import { ApiClientError } from '@/api/errors';
import { useThemeStore } from '@/state/theme-store';
import { useSessionStore } from '@/session/session-store';
import { Button, Choice, Disclosure, Field, Notice, Screen, Section } from '@/ui/ui';

const TIME_ZONES = ['America/Sao_Paulo', 'America/Manaus', 'America/Noronha', 'America/Rio_Branco'];

export default function ProfileScreen() {
  const account = useSessionStore((state) => state.account);
  const setAccount = useSessionStore((state) => state.setAccount);
  const [displayName, setDisplayName] = useState(account?.profile.displayName ?? '');
  const [weightUnit, setWeightUnit] = useState<ProfileUpdate['weightUnit']>(
    account?.profile.weightUnit ?? 'kg',
  );
  const [distanceUnit, setDistanceUnit] = useState<ProfileUpdate['distanceUnit']>(
    account?.profile.distanceUnit ?? 'km',
  );
  const [theme, setTheme] = useState<ProfileUpdate['theme']>(account?.profile.theme ?? 'system');
  const [timeZone, setTimeZone] = useState(account?.profile.timeZone ?? 'America/Sao_Paulo');
  const [notifyProductEmail, setNotifyProductEmail] = useState(
    account?.profile.notifyProductEmail ?? false,
  );
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    useThemeStore.getState().setPreference(theme);
    return () =>
      useThemeStore
        .getState()
        .setPreference(useSessionStore.getState().account?.profile.theme ?? 'system');
  }, [theme]);

  useEffect(() => {
    let active = true;
    fetchProfilePhoto()
      .then((uri) => {
        if (active) {
          setPhotoUri(uri);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [account?.profile.hasPhoto]);

  async function save(): Promise<void> {
    const parsed = profileUpdateSchema.safeParse({
      displayName,
      weightUnit,
      distanceUnit,
      theme,
      timeZone,
      notifyProductEmail,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Revise o perfil.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setAccount(await updateAccount(parsed.data));
      setMessage('Perfil salvo.');
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : 'Não foi possível salvar o perfil.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function pickPhoto(): Promise<void> {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Permita o acesso às fotos para escolher uma imagem.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
      base64: true,
    });
    const asset = result.canceled ? undefined : result.assets?.[0];
    const dataBase64 = asset?.base64;
    if (!dataBase64) {
      return;
    }
    const contentType =
      asset?.mimeType === 'image/png' || asset?.mimeType === 'image/webp'
        ? asset.mimeType
        : 'image/jpeg';
    if (dataBase64.length > 7_000_000) {
      setError('A foto precisa ter no máximo 5 MB.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await uploadProfilePhoto(contentType, dataBase64);
      setPhotoUri(`data:${contentType};base64,${dataBase64}`);
      setAccount(await fetchAccount());
      setMessage('Foto atualizada.');
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : 'Não foi possível enviar a foto.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function removePhoto(): Promise<void> {
    setBusy(true);
    try {
      await deleteProfilePhoto();
      setPhotoUri(null);
      if (account) {
        setAccount({ ...account, profile: { ...account.profile, hasPhoto: false } });
      }
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : 'Não foi possível remover a foto.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="Perfil"
      footer={<Button icon="check" label="Salvar perfil" busy={busy} onPress={() => void save()} />}
      subtitle={account?.email ?? 'Sem e-mail'}
      onBack={() => router.back()}
    >
      {photoUri ? (
        <Image
          source={{ uri: photoUri }}
          accessibilityLabel="Foto de perfil"
          style={{ width: 96, height: 96, borderRadius: 48 }}
        />
      ) : null}
      <Field
        label="Nome de exibição"
        value={displayName}
        onChangeText={setDisplayName}
        autoComplete="name"
        textContentType="name"
        autoCapitalize="words"
      />
      <Section title="Suas unidades" detail="Como você prefere registrar seus treinos." />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Choice label="kg" selected={weightUnit === 'kg'} onPress={() => setWeightUnit('kg')} />
        <Choice label="lb" selected={weightUnit === 'lb'} onPress={() => setWeightUnit('lb')} />
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Choice label="km" selected={distanceUnit === 'km'} onPress={() => setDistanceUnit('km')} />
        <Choice label="mi" selected={distanceUnit === 'mi'} onPress={() => setDistanceUnit('mi')} />
      </View>
      <Section title="Aparência" detail="Veja a prévia e salve para manter sua preferência." />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Choice label="Sistema" selected={theme === 'system'} onPress={() => setTheme('system')} />
        <Choice label="Claro" selected={theme === 'light'} onPress={() => setTheme('light')} />
        <Choice label="Escuro" selected={theme === 'dark'} onPress={() => setTheme('dark')} />
      </View>
      <Disclosure title="Fuso horário e comunicação">
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {TIME_ZONES.map((zone) => (
            <Choice
              key={zone}
              label={zone.replace('America/', '')}
              selected={timeZone === zone}
              onPress={() => setTimeZone(zone)}
            />
          ))}
        </View>
        <Choice
          label={notifyProductEmail ? 'E-mails do produto: sim' : 'E-mails do produto: não'}
          selected={notifyProductEmail}
          onPress={() => setNotifyProductEmail(!notifyProductEmail)}
        />
        <Notice message="Idioma: português brasileiro. E-mails de segurança continuam sendo enviados." />
      </Disclosure>
      {message ? <Notice tone="success" message={message} /> : null}
      {error ? <Notice tone="error" message={error} /> : null}

      <Button
        label="Escolher foto"
        variant="secondary"
        busy={busy}
        onPress={() => void pickPhoto()}
      />
      {account?.profile.hasPhoto ? (
        <Button
          label="Remover foto"
          variant="secondary"
          busy={busy}
          onPress={() => void removePhoto()}
        />
      ) : null}
    </Screen>
  );
}
