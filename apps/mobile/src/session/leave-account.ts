import { Alert } from 'react-native';
import { router } from 'expo-router';
import { useSessionStore } from '@/session/session-store';

export async function leaveThisDevice(): Promise<void> {
  await leave('device');
}

export async function leaveEveryDevice(): Promise<void> {
  await leave('everywhere');
}

async function leave(scope: 'device' | 'everywhere'): Promise<void> {
  const action =
    scope === 'device'
      ? useSessionStore.getState().signOut
      : useSessionStore.getState().signOutEverywhere;
  const result = await action();
  if (result === 'needs_confirm') {
    Alert.alert(
      'Alterações ainda não sincronizadas',
      'Sair agora apaga deste aparelho os treinos, fichas, academias, equipamentos e exercícios que ainda não foram enviados.',
      [
        { text: 'Continuar na conta', style: 'cancel' },
        {
          text: 'Sair e descartar',
          style: 'destructive',
          onPress: () => {
            void action({ discardPending: true }).then((next) => {
              if (next === 'signed_out') {
                router.replace('/welcome');
              }
            });
          },
        },
      ],
    );
    return;
  }
  router.replace('/welcome');
}
