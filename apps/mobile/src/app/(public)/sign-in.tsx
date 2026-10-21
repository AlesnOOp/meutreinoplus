import { emailSchema } from '@meutreino/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { loginAccount } from '@/api/client';
import { ApiClientError } from '@/api/errors';
import { appleSignInConfigured, googleClientId } from '@/auth/providers';
import { currentDevice } from '@/auth/device';
import { ConsentToggles, SocialButtons } from '@/auth/social-buttons';
import { fieldError } from '@/forms/validation';
import { useSessionStore } from '@/session/session-store';
import { Button, Field, Notice, Screen } from '@/ui/ui';

export default function SignInScreen() {
  const setAccount = useSessionStore((state) => state.setAccount);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    const emailError = fieldError(emailSchema, email);
    if (emailError || password.length === 0) {
      setError(emailError ?? 'Informe a senha.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await loginAccount({
        email: emailSchema.parse(email),
        password,
        device: await currentDevice(),
      });
      setAccount(result.account);
      router.replace('/home');
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Não foi possível entrar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="Bom ter você de volta."
      subtitle="Seu próximo treino está te esperando."
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
      <Field
        label="Senha"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="password"
        textContentType="password"
      />
      {error ? <Notice tone="error" message={error} /> : null}
      <Button label="Entrar" busy={busy} onPress={() => void submit()} />
      <Button
        label="Esqueci a senha"
        variant="ghost"
        onPress={() => router.push('/forgot-password')}
      />
      {appleSignInConfigured() || googleClientId() !== null ? (
        <>
          <ConsentToggles
            acceptTerms={acceptTerms}
            acceptPrivacy={acceptPrivacy}
            onChangeTerms={setAcceptTerms}
            onChangePrivacy={setAcceptPrivacy}
          />
          <SocialButtons
            acceptTerms={acceptTerms}
            acceptPrivacy={acceptPrivacy}
            busy={busy}
            onBusy={setBusy}
            onError={setError}
          />
        </>
      ) : null}
    </Screen>
  );
}
