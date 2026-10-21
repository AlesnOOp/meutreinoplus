import { Redirect, Stack } from 'expo-router';
import { useSessionStore } from '@/session/session-store';

export default function PublicLayout() {
  const status = useSessionStore((state) => state.status);
  if (status === 'authenticated') {
    return <Redirect href="/home" />;
  }
  return <Stack screenOptions={{ headerShown: false }} />;
}
