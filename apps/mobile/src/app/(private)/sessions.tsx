import { BodyText as Text, Badge, Button, Card, Notice, Screen, usePalette } from '@/ui/ui';

import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { listSessions, revokeSession } from '@/api/client';
import { ApiClientError } from '@/api/errors';

type SessionItem = {
  id: string;
  current: boolean;
  deviceLabel: string | null;
  platform: string | null;
  lastUsedAt: string;
};

export default function SessionsScreen() {
  const { palette } = usePalette();
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function applySessions(result: { sessions: SessionItem[] }, failed: unknown): void {
    if (failed) {
      setError(
        failed instanceof ApiClientError ? failed.message : 'Não foi possível listar as sessões.',
      );
    } else {
      setSessions(result.sessions);
      setError(null);
    }
    setBusy(false);
  }

  function load(): void {
    setBusy(true);
    void listSessions().then(
      (result) => applySessions(result, null),
      (caught: unknown) => applySessions({ sessions: [] }, caught),
    );
  }

  useEffect(() => {
    let active = true;
    void listSessions().then(
      (result) => {
        if (active) {
          applySessions(result, null);
        }
      },
      (caught: unknown) => {
        if (active) {
          applySessions({ sessions: [] }, caught);
        }
      },
    );
    return () => {
      active = false;
    };
  }, []);

  return (
    <Screen
      title="Seus dispositivos"
      subtitle="Veja onde sua conta está conectada e controle o acesso."
      onBack={() => router.back()}
    >
      {sessions.map((session) => (
        <Card key={session.id}>
          {session.current ? <Badge label="ESTE APARELHO" /> : null}
          <Text style={{ color: palette.text, fontSize: 16, lineHeight: 24 }}>
            {session.deviceLabel ?? session.platform ?? 'Aparelho'} ·{' '}
            {session.current ? 'este aparelho' : 'outro aparelho'} · último uso{' '}
            {new Date(session.lastUsedAt).toLocaleString('pt-BR')}
          </Text>
          {session.current ? null : (
            <Button
              label="Encerrar sessão"
              variant="secondary"
              onPress={() =>
                void revokeSession(session.id)
                  .then(() => load())
                  .catch((caught: unknown) =>
                    setError(
                      caught instanceof ApiClientError
                        ? caught.message
                        : 'Não foi possível encerrar.',
                    ),
                  )
              }
            />
          )}
        </Card>
      ))}
      {error ? <Notice tone="error" message={error} /> : null}
      <Button label="Atualizar" variant="secondary" busy={busy} onPress={() => void load()} />
    </Screen>
  );
}
