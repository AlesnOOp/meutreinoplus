import { confirmationToken } from '@/auth/confirmation-token';
import { emailSchema } from '@meutreino/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { fetchAccount, resendVerification, verifyEmail } from '@/api/client';
import { ApiClientError } from '@/api/errors';
import { useSessionStore } from '@/session/session-store';
import { Button, Card, Disclosure, Field, Icon, Notice, Screen, usePalette } from '@/ui/ui';

export default function VerifyEmailScreen() {
  const { palette } = usePalette();
  const account = useSessionStore((state) => state.account);
  const setAccount = useSessionStore((state) => state.setAccount);
  const [verified, setVerified] = useState(false);
  const params = useLocalSearchParams<{ token?: string; email?: string }>();
  const [token, setToken] = useState(typeof params.token === 'string' ? params.token : '');
  const [email, setEmail] = useState(typeof params.email === 'string' ? params.email : '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(
    params.token
      ? null
      : 'Enviamos um e-mail de confirmação. Cole o código ou o link completo recebido.',
  );
  const [error, setError] = useState<string | null>(null);

  async function confirm(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await verifyEmail(confirmationToken(token));
      setVerified(true);
      if (account) setAccount(await fetchAccount());
      setMessage('E-mail confirmado. Você já pode entrar.');
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : 'Não foi possível confirmar o e-mail.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function resend(): Promise<void> {
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Informe o e-mail.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await resendVerification(parsed.data);
      setMessage('Se a conta existir e ainda não estiver confirmada, enviaremos outro e-mail.');
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Não foi possível reenviar.');
    } finally {
      setBusy(false);
    }
  }

  if (verified)
    return (
      <Screen title="Tudo certo!" subtitle="Seu e-mail foi confirmado.">
        <Card style={{ alignItems: 'center', paddingVertical: 32 }}>
          <Icon name="check" size={48} color={palette.success} />
          <Notice tone="success" message="Sua conta está pronta. Vamos continuar?" />
        </Card>
        <Button
          label={account ? 'Voltar para meu treino' : 'Entrar na minha conta'}
          icon="arrow"
          onPress={() => router.replace(account ? '/home' : '/sign-in')}
        />
      </Screen>
    );
  return (
    <Screen
      title="Confirmar e-mail"
      subtitle="Só mais um passo para deixar sua conta pronta."
      onBack={() => router.replace('/sign-in')}
    >
      {message ? <Notice tone="success" message={message} /> : null}
      {error ? <Notice tone="error" message={error} /> : null}
      <Field
        label="Código ou link de confirmação"
        multiline
        value={token}
        onChangeText={setToken}
        autoComplete="off"
        textContentType="none"
      />
      <Button
        label="Confirmar e-mail"
        disabled={!token.trim()}
        busy={busy}
        onPress={() => void confirm()}
      />
      <Disclosure title="Não recebeu o e-mail?">
        <Field
          label="E-mail"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
        />
        <Button
          label="Reenviar confirmação"
          variant="secondary"
          busy={busy}
          onPress={() => void resend()}
        />
      </Disclosure>
      <Button
        label="Ir para entrar"
        variant="secondary"
        onPress={() => router.replace('/sign-in')}
      />
    </Screen>
  );
}
