import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { confirmEmailChange } from '@/api/client';
import { ApiClientError } from '@/api/errors';
import { useSessionStore } from '@/session/session-store';
import { Button, Notice, Screen } from '@/ui/ui';

export default function ConfirmEmailScreen() {
  const params = useLocalSearchParams<{ token?: string }>();
  const token = typeof params.token === 'string' ? params.token : '';
  const signOut = useSessionStore((state) => state.signOut);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(
    token ? null : 'Abra o link enviado ao novo e-mail.',
  );

  async function confirm(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await confirmEmailChange(token);
      await signOut({ reason: 'revoked' });
      setMessage('E-mail alterado. Entre novamente com o novo endereço.');
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : 'Não foi possível confirmar o e-mail.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Confirmar novo e-mail" subtitle="A alteração encerra as sessões abertas.">
      {message ? <Notice tone="success" message={message} /> : null}
      {error ? <Notice tone="error" message={error} /> : null}
      <Button
        label="Confirmar alteração"
        busy={busy}
        disabled={!token}
        onPress={() => void confirm()}
      />
      <Button label="Entrar" variant="secondary" onPress={() => router.replace('/sign-in')} />
    </Screen>
  );
}
