import { useCallback, useEffect, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { countPendingOperations, syncCatalog } from '@/catalog/catalog-store';
import { syncPlans } from '@/plans/plan-store';
import { syncSessions } from '@/sessions/session-store';
import { useSessionStore } from '@/session/session-store';
import { Button, usePalette } from '@/ui/ui';

export function ConnectionStatus() {
  const account = useSessionStore((state) => state.account);
  const status = useSessionStore((state) => state.status);
  const bootstrap = useSessionStore((state) => state.bootstrap);
  const [pending, setPending] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { palette } = usePalette();
  const insets = useSafeAreaInsets();
  const refresh = useCallback(async () => {
    if (account) setPending(await countPendingOperations(account.id));
  }, [account]);
  useEffect(() => {
    let active = true;
    const update = () => {
      if (account && active)
        void countPendingOperations(account.id)
          .then((value) => {
            if (active) setPending(value);
          })
          .catch(() => undefined);
    };
    update();
    const timer = setInterval(update, 5000);
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') update();
    });
    return () => {
      active = false;
      clearInterval(timer);
      listener.remove();
    };
  }, [account]);
  async function synchronize() {
    if (!account) return;
    setBusy(true);
    setError(null);
    try {
      await bootstrap();
      if (
        useSessionStore.getState().status !== 'authenticated' ||
        useSessionStore.getState().account?.id !== account.id
      ) {
        setError('Servidor indisponível. Os dados continuam neste aparelho.');
        return;
      }
      await syncCatalog(account.id);
      await syncPlans(account.id);
      await syncSessions(account.id);
    } catch {
      setError('Não foi possível concluir. Pendências e conflitos continuam preservados.');
    } finally {
      await refresh().catch(() => undefined);
      setBusy(false);
    }
  }
  return (
    <View
      style={{
        backgroundColor: palette.surface,
        paddingHorizontal: 16,
        paddingTop: insets.top + 6,
        paddingBottom: 6,
        gap: 4,
      }}
    >
      <Text accessibilityLiveRegion="polite" style={{ color: palette.text, fontSize: 13 }}>
        {status === 'offline'
          ? 'Offline · dados neste aparelho'
          : 'Conta conectada · última sessão validada'}
        {pending > 0 ? ` · ${pending} pendência(s) de envio` : ' · sem pendências locais'}
      </Text>
      {error ? (
        <Text accessibilityRole="alert" style={{ color: palette.text }}>
          {error}
        </Text>
      ) : null}
      {status === 'offline' || pending > 0 || error ? (
        <Button
          label={status === 'offline' ? 'Tentar conexão e sincronizar' : 'Sincronizar pendências'}
          variant="secondary"
          busy={busy}
          onPress={() => void synchronize()}
        />
      ) : null}
    </View>
  );
}
