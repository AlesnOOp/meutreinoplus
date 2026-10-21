import { emailSchema } from '@meutreino/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { forgotPassword } from '@/api/client';
import { ApiClientError } from '@/api/errors';
import { Button, Field, Notice, Screen } from '@/ui/ui';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Informe o e-mail.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await forgotPassword(parsed.data);
      setMessage('Se houver uma conta com este e-mail, enviaremos as instruções de recuperação.');
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : 'Não foi possível enviar a recuperação.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="Recuperar senha"
      subtitle="Informe seu e-mail para receber um link de recuperação."
      onBack={() => router.back()}
    >
      <Field
        label="E-mail"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoComplete="email"
        textContentType="emailAddress"
      />
      {message ? <Notice tone="success" message={message} /> : null}
      {error ? <Notice tone="error" message={error} /> : null}
      <Button label="Enviar instruções" busy={busy} onPress={() => void submit()} />
    </Screen>
  );
}
