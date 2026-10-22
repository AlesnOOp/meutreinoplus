import { Redirect, router } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useSessionStore } from '@/session/session-store';
import { Button, Notice, Screen, usePalette } from '@/ui/ui';

export default function IndexScreen() {
  const status = useSessionStore((state) => state.status);
  const bootstrap = useSessionStore((state) => state.bootstrap);
  const account = useSessionStore((state) => state.account);
  const { palette } = usePalette();

  if (status === 'booting') {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: palette.background,
        }}
      >
        <ActivityIndicator color={palette.accent} />
      </View>
    );
  }
  if (status === 'authenticated' || (status === 'offline' && account)) {
    return <Redirect href="/home" />;
  }
  if (status === 'offline') {
    return (
      <Screen
        title="Sem conexão"
        subtitle="Não foi possível recuperar uma conta validada neste aparelho."
      >
        <Notice message="Tente de novo quando a rede voltar. Seus dados locais não foram apagados." />
        <Button label="Tentar novamente" onPress={() => void bootstrap()} />
        <Button
          label="Ir para o início"
          variant="secondary"
          onPress={() => router.replace('/welcome')}
        />
      </Screen>
    );
  }
  return <Redirect href="/welcome" />;
}
