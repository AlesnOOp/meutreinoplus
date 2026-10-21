import { confirmationToken } from '@/auth/confirmation-token';
import { passwordSchema } from '@meutreino/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { resetPassword } from '@/api/client';
import { ApiClientError } from '@/api/errors';
import { passwordConfirmationError, passwordHint } from '@/forms/validation';
import { Button, Field, Notice, Screen } from '@/ui/ui';

export default function ResetPasswordScreen() {
  const params = useLocalSearchParams<{ token?: string }>();
  const [token, setToken] = useState(typeof params.token === 'string' ? params.token : '');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    const passwordError = passwordSchema.safeParse(password).error?.issues[0]?.message;
    const confirmationError = passwordConfirmationError(password, confirmation);
    if (passwordError || confirmationError || token.trim().length < 20) {
      setError(passwordError ?? confirmationError ?? 'Abra o link recebido por e-mail.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await resetPassword(confirmationToken(token), password);
      setMessage('Senha alterada. As sessões anteriores foram encerradas. Entre novamente.');
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : 'Não foi possível redefinir a senha.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Nova senha" subtitle={passwordHint()} onBack={() => router.replace('/sign-in')}>
      <Field
        label="Código ou link de recuperação"
        multiline
        value={token}
        onChangeText={setToken}
        autoComplete="off"
        textContentType="none"
      />
      <Field
        label="Nova senha"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="password-new"
        textContentType="newPassword"
      />
      <Field
        label="Confirmar senha"
        value={confirmation}
        onChangeText={setConfirmation}
        secureTextEntry
        autoComplete="password-new"
        textContentType="newPassword"
      />
      {message ? <Notice tone="success" message={message} /> : null}
      {error ? <Notice tone="error" message={error} /> : null}
      <Button label="Salvar senha" busy={busy} onPress={() => void submit()} />
      <Button label="Entrar" variant="secondary" onPress={() => router.replace('/sign-in')} />
    </Screen>
  );
}
