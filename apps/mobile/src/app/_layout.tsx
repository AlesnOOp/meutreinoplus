import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useSessionStore } from '@/session/session-store';
import { useThemeStore } from '@/state/theme-store';
import { palettes } from '@/theme/colors';
import { resolveColorScheme } from '@/theme/scheme';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
    },
  },
});

export default function RootLayout() {
  const preference = useThemeStore((state) => state.preference);
  const bootstrap = useSessionStore((state) => state.bootstrap);
  const systemScheme = useColorScheme();
  const scheme = resolveColorScheme(preference, systemScheme);
  const palette = palettes[scheme];

  useEffect(() => {
    let restoring = false;
    const restore = async () => {
      if (restoring) return;
      restoring = true;
      try {
        await bootstrap();
      } catch {
        // Cached data stays available while the server cannot be reached.
      } finally {
        restoring = false;
        await SplashScreen.hideAsync().catch(() => undefined);
      }
    };
    const recover = () => {
      if (AppState.currentState === 'active' && useSessionStore.getState().status === 'offline') {
        void restore();
      }
    };
    void restore();
    const subscription = AppState.addEventListener('change', recover);
    const timer = setInterval(recover, 15_000);
    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, [bootstrap]);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: palette.background },
          }}
        />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
