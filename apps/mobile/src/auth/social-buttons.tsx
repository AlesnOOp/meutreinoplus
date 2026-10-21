import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { loginWithApple, loginWithGoogle } from '@/api/client';
import { ApiClientError } from '@/api/errors';
import { currentDevice } from '@/auth/device';
import {
  appleSignInConfigured,
  googleClientId,
  requestAppleCredential,
  requestGoogleCredential,
} from '@/auth/providers';
import { useSessionStore } from '@/session/session-store';
import { Button, Icon, Notice, usePalette } from '@/ui/ui';

export function ConsentToggles({
  acceptTerms,
  acceptPrivacy,
  onChangeTerms,
  onChangePrivacy,
}: {
  acceptTerms: boolean;
  acceptPrivacy: boolean;
  onChangeTerms: (value: boolean) => void;
  onChangePrivacy: (value: boolean) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Check
        label="Aceito os Termos de Uso."
        selected={acceptTerms}
        onPress={() => onChangeTerms(!acceptTerms)}
      />
      <Check
        label="Estou ciente da Política de Privacidade."
        selected={acceptPrivacy}
        onPress={() => onChangePrivacy(!acceptPrivacy)}
      />
    </View>
  );
}

function Check({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { palette } = usePalette();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 8,
      }}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 7,
          borderWidth: 1.5,
          borderColor: selected ? palette.accent : palette.muted,
          backgroundColor: selected ? palette.accent : palette.surface,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {selected ? <Icon name="check" color={palette.accentText} size={16} /> : null}
      </View>
      <Text style={{ color: palette.muted, fontSize: 13, lineHeight: 20, flex: 1 }}>{label}</Text>
    </Pressable>
  );
}

export function SocialButtons({
  acceptTerms,
  acceptPrivacy,
  busy,
  onBusy,
  onError,
}: {
  acceptTerms: boolean;
  acceptPrivacy: boolean;
  busy: boolean;
  onBusy: (value: boolean) => void;
  onError: (message: string | null) => void;
}) {
  const setAccount = useSessionStore((state) => state.setAccount);
  const showApple = appleSignInConfigured();
  const showGoogle = googleClientId() !== null;
  if (!showApple && !showGoogle) {
    return null;
  }

  async function start(provider: 'apple' | 'google'): Promise<void> {
    onError(null);
    onBusy(true);
    try {
      const device = await currentDevice();
      const consent =
        acceptTerms && acceptPrivacy
          ? { acceptTerms: true as const, acceptPrivacy: true as const }
          : {};
      const result =
        provider === 'apple'
          ? await signInApple(device, consent)
          : await signInGoogle(device, consent);
      if (!result) {
        return;
      }
      setAccount(result.account);
      router.replace('/home');
    } catch (error) {
      onError(
        error instanceof ApiClientError ? error.message : 'Não foi possível entrar com o provedor.',
      );
    } finally {
      onBusy(false);
    }
  }

  return (
    <View style={{ gap: 12 }}>
      {showApple ? (
        <Button
          label="Continuar com a Apple"
          busy={busy}
          variant="secondary"
          onPress={() => void start('apple')}
        />
      ) : null}
      {showGoogle ? (
        <Button
          label="Continuar com o Google"
          busy={busy}
          variant="secondary"
          onPress={() => void start('google')}
        />
      ) : null}
      {!acceptTerms || !acceptPrivacy ? (
        <Notice message="Para criar uma conta nova, aceite os termos e a política antes de continuar." />
      ) : null}
    </View>
  );
}

async function signInApple(
  device: Awaited<ReturnType<typeof currentDevice>>,
  consent: { acceptTerms?: true; acceptPrivacy?: true },
) {
  const credential = await requestAppleCredential();
  if (!credential) {
    return null;
  }
  return loginWithApple({ ...credential, ...consent, device });
}

async function signInGoogle(
  device: Awaited<ReturnType<typeof currentDevice>>,
  consent: { acceptTerms?: true; acceptPrivacy?: true },
) {
  const credential = await requestGoogleCredential();
  if (!credential) {
    return null;
  }
  return loginWithGoogle({ ...credential, ...consent, device });
}
