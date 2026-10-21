import { emailSchema, passwordSchema } from '@meutreino/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  changePassword,
  forgotPassword,
  requestEmailChange,
  resendCurrentVerification,
} from '@/api/client';
import { ApiClientError } from '@/api/errors';
import { passwordConfirmationError, passwordHint } from '@/forms/validation';
import { leaveEveryDevice } from '@/session/leave-account';
import { useSessionStore } from '@/session/session-store';
import { Button, Card, Disclosure, Field, Notice, Screen, Section } from '@/ui/ui';

export default function AccountScreen() {
  const account = useSessionStore((state) => state.account);
  const hasPassword =
    account?.identities.some((identity) => identity.provider === 'email') ?? false;
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [nextEmail, setNextEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function savePassword(): Promise<void> {
    const passwordError = passwordSchema.safeParse(newPassword).error?.issues[0]?.message;
    const confirmationError = passwordConfirmationError(newPassword, confirmation);
    if (passwordError || confirmationError || (hasPassword && currentPassword.length === 0)) {
      setError(passwordError ?? confirmationError ?? 'Informe a senha atual.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await changePassword({
        currentPassword: hasPassword ? currentPassword : undefined,
        newPassword,
      });
      setMessage('Senha atualizada. As outras sessões foram encerradas.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : 'Não foi possível alterar a senha.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveEmail(): Promise<void> {
    const parsed = emailSchema.safeParse(nextEmail);
    if (!parsed.success || currentPassword.length === 0) {
      setError(
        parsed.success
          ? 'Informe a senha atual para trocar o e-mail.'
          : (parsed.error.issues[0]?.message ?? 'Revise o e-mail.'),
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await requestEmailChange(parsed.data, { method: 'password', password: currentPassword });
      setMessage('Enviamos a confirmação para o novo e-mail e um aviso para o endereço atual.');
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : 'Não foi possível solicitar a troca.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="Conta"
      subtitle={account?.email ?? 'Conta sem e-mail'}
      onBack={() => router.back()}
    >
      {!account?.emailVerified ? (
        <>
          <Notice message="O e-mail ainda não foi confirmado." />
          <Button
            label="Reenviar confirmação"
            variant="secondary"
            busy={busy}
            onPress={() =>
              void resendCurrentVerification()
                .then(() =>
                  setMessage('Se a conta ainda não estiver confirmada, enviaremos outro e-mail.'),
                )
                .catch((caught: unknown) =>
                  setError(
                    caught instanceof ApiClientError
                      ? caught.message
                      : 'Não foi possível reenviar.',
                  ),
                )
            }
          />
        </>
      ) : null}
      <Card>
        <Disclosure title="Alterar minha senha">
          <Notice message={passwordHint()} />
          {hasPassword ? (
            <Field
              label="Senha atual"
              value={currentPassword}
              onChangeText={setCurrentPassword}
              secureTextEntry
              autoComplete="password"
              textContentType="password"
            />
          ) : (
            <Button
              label="Enviar link para criar senha"
              variant="secondary"
              busy={busy}
              onPress={() => {
                if (!account?.email) {
                  setError('Adicione um e-mail antes de criar uma senha.');
                  return;
                }
                void forgotPassword(account.email)
                  .then(() =>
                    setMessage(
                      'Se o e-mail estiver na conta, enviaremos o link para definir a senha.',
                    ),
                  )
                  .catch((caught: unknown) =>
                    setError(
                      caught instanceof ApiClientError
                        ? caught.message
                        : 'Não foi possível enviar o link.',
                    ),
                  );
              }}
            />
          )}
          <Field
            label="Nova senha"
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry
            autoComplete="password-new"
            textContentType="newPassword"
          />
          <Field
            label="Confirmar nova senha"
            value={confirmation}
            onChangeText={setConfirmation}
            secureTextEntry
            autoComplete="password-new"
            textContentType="newPassword"
          />
          <Button
            label={hasPassword ? 'Alterar senha' : 'Criar senha'}
            busy={busy}
            onPress={() => void savePassword()}
          />
        </Disclosure>
      </Card>
      <Card>
        <Disclosure title="Alterar meu e-mail">
          <Field
            label="Senha atual para confirmar a troca"
            value={currentPassword}
            onChangeText={setCurrentPassword}
            secureTextEntry
            autoComplete="password"
            textContentType="password"
          />
          <Field
            label="Novo e-mail"
            value={nextEmail}
            onChangeText={setNextEmail}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
          />
          <Button
            label="Solicitar troca de e-mail"
            variant="secondary"
            busy={busy}
            onPress={() => void saveEmail()}
          />
        </Disclosure>
      </Card>
      {message ? <Notice tone="success" message={message} /> : null}
      {error ? <Notice tone="error" message={error} /> : null}
      <Section
        title="Dispositivos conectados"
        detail="Encerre o acesso em todos os aparelhos quando precisar."
      />
      <Button
        label="Sair de todos os aparelhos"
        variant="danger"
        onPress={() => void leaveEveryDevice()}
      />
    </Screen>
  );
}
