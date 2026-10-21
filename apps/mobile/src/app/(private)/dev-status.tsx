import { BodyText as Text, Notice, Screen, usePalette } from '@/ui/ui';

import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';

import { fetchHealthReport, getApiBaseUrl } from '@/api/health';
import { readLocalDatabaseStatus, type LocalDatabaseStatus } from '@/db/local-database';
import { isSecureStoreAvailable } from '@/security/secure-store';
import { useSessionStore } from '@/session/session-store';

export default function DevStatusScreen() {
  const account = useSessionStore((state) => state.account);
  const { palette } = usePalette();
  const apiConfigured = getApiBaseUrl() !== null;
  const health = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealthReport,
    enabled: apiConfigured,
  });
  const [localStatus, setLocalStatus] = useState<LocalDatabaseStatus | null>(null);
  const [localError, setLocalError] = useState(false);
  const [secureStoreAvailable, setSecureStoreAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    if (!account) {
      return () => {
        active = false;
      };
    }
    readLocalDatabaseStatus(account.id)
      .then((status) => {
        if (active) {
          setLocalStatus(status);
        }
      })
      .catch(() => {
        if (active) {
          setLocalError(true);
        }
      });
    isSecureStoreAvailable()
      .then((available) => {
        if (active) {
          setSecureStoreAvailable(available);
        }
      })
      .catch(() => {
        if (active) {
          setSecureStoreAvailable(false);
        }
      });
    return () => {
      active = false;
    };
  }, [account]);

  return (
    <Screen
      title="Diagnóstico"
      subtitle="Estado da fundação. Nenhum treino é simulado aqui."
      onBack={() => router.back()}
    >
      <Text style={{ color: palette.text, fontSize: 16, lineHeight: 24 }}>
        {apiConfigured
          ? health.isPending
            ? 'Consultando a API...'
            : health.isError
              ? 'A API não respondeu.'
              : health.data?.status === 'ok'
                ? 'API disponível. Banco de dados ativo.'
                : 'API no ar, mas o banco de dados não respondeu.'
          : 'Defina EXPO_PUBLIC_API_URL em apps/mobile/.env.'}
      </Text>
      <Notice
        message={
          localError
            ? 'Não foi possível abrir o banco local.'
            : localStatus
              ? `Banco ${localStatus.databaseName}. Esquema ${localStatus.schemaVersion}. Pendências: ${localStatus.pendingSyncCount}.`
              : 'Abrindo o banco deste usuário...'
        }
      />
      <Notice
        message={
          secureStoreAvailable === null
            ? 'Verificando o cofre seguro...'
            : secureStoreAvailable
              ? 'Cofre seguro disponível. O refresh token não fica no SQLite.'
              : 'Cofre seguro indisponível. O refresh token fica só na memória desta sessão.'
        }
      />
    </Screen>
  );
}
