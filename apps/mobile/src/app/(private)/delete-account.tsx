import { DELETE_ACCOUNT_CONFIRMATION } from '@meutreino/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { deleteAccount } from '@/api/client';
import { ApiClientError } from '@/api/errors';
import { useSessionStore } from '@/session/session-store';
import { Button, Field, Notice, Screen } from '@/ui/ui';

export default function DeleteAccountScreen() {
  const signOut = useSessionStore((state) => state.signOut);
  const [confirmation, setConfirmation] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (confirmation !== DELETE_ACCOUNT_CONFIRMATION) {
      setError(`Digite exatamente: ${DELETE_ACCOUNT_CONFIRMATION}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await deleteAccount(confirmation, { method: 'password', password });
      await signOut({ reason: 'account_deleted' });
      router.replace('/welcome');
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : 'Não foi possível excluir a conta.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="Excluir conta"
      subtitle="A exclusão é imediata. A senha, o e-mail e os dados pessoais são apagados. Identificadores de compra, se existirem, ficam por obrigação fiscal, sem o seu e-mail."
      onBack={() => router.back()}
    >
      <Notice
        tone="error"
        message="Esta ação encerra todas as sessões e não pode ser desfeita no aplicativo."
      />
      <Field
        label="Senha atual"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="password"
        textContentType="password"
      />
      <Field
        label={`Digite ${DELETE_ACCOUNT_CONFIRMATION}`}
        value={confirmation}
        onChangeText={setConfirmation}
        autoComplete="off"
        textContentType="none"
      />
      {error ? <Notice tone="error" message={error} /> : null}
      <Button
        label="Excluir minha conta"
        variant="danger"
        busy={busy}
        disabled={confirmation !== DELETE_ACCOUNT_CONFIRMATION || !password}
        onPress={() => void submit()}
      />
    </Screen>
  );
}
