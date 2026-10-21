import { displayNameSchema, emailSchema, passwordSchema, registerSchema } from '@meutreino/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { registerAccount } from '@/api/client';
import { ApiClientError } from '@/api/errors';
import { ConsentToggles } from '@/auth/social-buttons';
import { fieldError, passwordConfirmationError, passwordHint } from '@/forms/validation';
import { Button, Field, Notice, Screen } from '@/ui/ui';

export default function SignUpScreen() {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({});

  async function submit(): Promise<void> {
    const nextErrors = {
      displayName: fieldError(displayNameSchema, displayName),
      email: fieldError(emailSchema, email),
      password: fieldError(passwordSchema, password),
      confirmation: passwordConfirmationError(password, confirmation),
    };
    setFieldErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }
    if (!acceptTerms || !acceptPrivacy) {
      setError('Aceite os Termos de Uso e confirme a ciência da Política de Privacidade.');
      return;
    }
    const parsed = registerSchema.safeParse({
      displayName,
      email,
      password,
      acceptTerms: true,
      acceptPrivacy: true,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Revise os dados.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await registerAccount(parsed.data);
      router.replace({ pathname: '/verify-email', params: { email: parsed.data.email } });
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : 'Não foi possível criar a conta.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="Criar conta"
      subtitle="Um espaço para cuidar da sua rotina de treino."
      onBack={() => router.back()}
    >
      <Field
        label="Nome"
        value={displayName}
        onChangeText={setDisplayName}
        error={fieldErrors.displayName}
        autoComplete="name"
        textContentType="name"
        autoCapitalize="words"
      />
      <Field
        label="E-mail"
        value={email}
        onChangeText={setEmail}
        error={fieldErrors.email}
        keyboardType="email-address"
        autoComplete="email"
        textContentType="emailAddress"
      />
      <Field
        label="Senha"
        value={password}
        onChangeText={setPassword}
        error={fieldErrors.password}
        secureTextEntry
        autoComplete="password-new"
        textContentType="newPassword"
      />
      <Notice message={passwordHint()} />
      <Field
        label="Confirmar senha"
        value={confirmation}
        onChangeText={setConfirmation}
        error={fieldErrors.confirmation}
        secureTextEntry
        autoComplete="password-new"
        textContentType="newPassword"
      />
      <ConsentToggles
        acceptTerms={acceptTerms}
        acceptPrivacy={acceptPrivacy}
        onChangeTerms={setAcceptTerms}
        onChangePrivacy={setAcceptPrivacy}
      />
      {error ? <Notice tone="error" message={error} /> : null}
      <Button label="Criar conta" busy={busy} onPress={() => void submit()} />
    </Screen>
  );
}
