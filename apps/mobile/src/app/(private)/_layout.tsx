import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useSessionStore } from '@/session/session-store';
import { usePalette } from '@/ui/ui';
import { BottomNav } from '@/ui/bottom-nav';
import { ConnectionStatus } from '@/session/connection-status';

export default function PrivateLayout() {
  const status = useSessionStore((state) => state.status);
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
  if (status === 'offline' && !account) return <Redirect href="/" />;
  if (!account || (status !== 'authenticated' && status !== 'offline')) {
    return <Redirect href="/welcome" />;
  }
  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <ConnectionStatus />
      <Stack screenOptions={{ headerShown: false }} />
      <BottomNav />
    </View>
  );
}
