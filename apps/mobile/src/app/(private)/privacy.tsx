import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Share } from 'react-native';
import { downloadExport, readExport, requestExport } from '@/api/client';
import { ApiClientError } from '@/api/errors';
import { Button, Notice, Screen, Section } from '@/ui/ui';

export default function PrivacyScreen() {
  const [exportId, setExportId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const created = await requestExport();
      setExportId(created.id);
      setStatus(created.status);
      setMessage('Exportação pronta com os dados que existem hoje.');
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Não foi possível exportar.');
    } finally {
      setBusy(false);
    }
  }

  async function refresh(): Promise<void> {
    if (!exportId) {
      return;
    }
    setBusy(true);
    try {
      const current = await readExport(exportId);
      setStatus(current.status);
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : 'Não foi possível consultar a exportação.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function download(): Promise<void> {
    if (!exportId) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = await downloadExport(exportId);
      if (Platform.OS === 'web') {
        const blob = new Blob([body], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'meutreino-dados.json';
        anchor.click();
        URL.revokeObjectURL(url);
        setMessage('Arquivo baixado.');
      } else {
        await Share.share({ title: 'meutreino-dados.json', message: body });
        setMessage('Arquivo pronto para compartilhar ou salvar.');
      }
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : 'Não foi possível baixar o arquivo.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="Privacidade e meus dados"
      subtitle="A exportação contém a conta, os consentimentos e os metadados das sessões. Ela não inclui a senha nem tokens."
      onBack={() => router.back()}
    >
      <Section title="Seus dados são seus" detail="Gere uma cópia e salve onde preferir." />
      <Button label="Solicitar exportação" busy={busy} onPress={() => void create()} />
      {status ? <Notice message={`Situação: ${status}`} /> : null}
      {exportId ? (
        <Button
          label="Atualizar situação"
          variant="secondary"
          busy={busy}
          onPress={() => void refresh()}
        />
      ) : null}
      {status === 'ready' ? (
        <Button
          label="Baixar arquivo"
          variant="secondary"
          busy={busy}
          onPress={() => void download()}
        />
      ) : null}
      <Section
        title="Encerrar minha conta"
        detail="A exclusão é permanente. Considere exportar seus dados antes."
      />
      <Button
        label="Excluir conta"
        variant="danger"
        onPress={() => router.push('/delete-account')}
      />
      {message ? <Notice tone="success" message={message} /> : null}
      {error ? <Notice tone="error" message={error} /> : null}
    </Screen>
  );
}
