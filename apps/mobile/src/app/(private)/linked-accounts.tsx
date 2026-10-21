import { BodyText as Text, Button, Card, Field, Notice, Screen, usePalette } from '@/ui/ui';

import { canUnlinkIdentity } from '@meutreino/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { linkIdentity, unlinkIdentity } from '@/api/client';
import { ApiClientError } from '@/api/errors';
import {
  appleSignInConfigured,
  googleClientId,
  requestAppleCredential,
  requestGoogleCredential,
} from '@/auth/providers';
import { useSessionStore } from '@/session/session-store';

const PROVIDER_LABEL = { email: 'E-mail e senha', apple: 'Apple', google: 'Google' } as const;

export default function LinkedAccountsScreen() {
  const account = useSessionStore((state) => state.account);
  const setAccount = useSessionStore((state) => state.setAccount);
  const { palette } = usePalette();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const identities = account?.identities ?? [];

  async function link(provider: 'apple' | 'google'): Promise<void> {
    if (!account?.emailVerified) {
      setError('Confirme o e-mail antes de vincular outro método.');
      return;
    }
    if (password.length === 0) {
      setError('Informe a senha atual para confirmar que é você.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const credential =
        provider === 'apple' ? await requestAppleCredential() : await requestGoogleCredential();
      if (!credential) {
        return;
      }
      const updated = await linkIdentity({
        provider,
        ...credential,
        reauthentication: { method: 'password', password },
      });
      setAccount(updated);
      setPassword('');
      setMessage('Método vinculado a esta conta.');
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Não foi possível vincular.');
    } finally {
      setBusy(false);
    }
  }

  async function unlink(identityId: string): Promise<void> {
    if (password.length === 0) {
      setError('Informe a senha atual para desvincular.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setAccount(await unlinkIdentity(identityId, { method: 'password', password }));
      setPassword('');
      setMessage('Método desvinculado.');
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Não foi possível desvincular.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="Contas vinculadas"
      subtitle="Um provedor só é vinculado depois que você confirma a senha. E-mails iguais não unem contas sozinhos."
      onBack={() => router.back()}
    >
      {identities.map((identity) => (
        <Card key={identity.id}>
          <Text style={{ color: palette.text, fontSize: 16 }}>
            {PROVIDER_LABEL[identity.provider]}
          </Text>
          {canUnlinkIdentity(identities.length - 1) ? (
            <Button
              label="Desvincular"
              variant="secondary"
              busy={busy}
              onPress={() => void unlink(identity.id)}
            />
          ) : null}
        </Card>
      ))}
      <Field
        label="Senha atual"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="password"
        textContentType="password"
      />
      {appleSignInConfigured() && !identities.some((identity) => identity.provider === 'apple') ? (
        <Button
          label="Vincular Apple"
          variant="secondary"
          busy={busy}
          onPress={() => void link('apple')}
        />
      ) : null}
      {googleClientId() && !identities.some((identity) => identity.provider === 'google') ? (
        <Button
          label="Vincular Google"
          variant="secondary"
          busy={busy}
          onPress={() => void link('google')}
        />
      ) : null}
      {!appleSignInConfigured() && !googleClientId() ? (
        <Notice message="Novas opções de acesso estarão disponíveis em breve. Seu acesso por e-mail continua funcionando." />
      ) : null}
      {message ? <Notice tone="success" message={message} /> : null}
      {error ? <Notice tone="error" message={error} /> : null}
    </Screen>
  );
}
