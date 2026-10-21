import { router } from 'expo-router';
import { View } from 'react-native';
import { leaveThisDevice } from '@/session/leave-account';
import { useSessionStore } from '@/session/session-store';
import {
  Badge,
  BodyText,
  Button,
  Card,
  Icon,
  MenuLink,
  Notice,
  Screen,
  Section,
  usePalette,
} from '@/ui/ui';

export default function MoreScreen() {
  const account = useSessionStore((state) => state.account);
  const { palette } = usePalette();
  if (!account) return null;
  return (
    <Screen title="Do seu jeito." subtitle="Seu espaço, suas preferências." eyebrow="VOCÊ">
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View
            style={{
              width: 58,
              height: 58,
              borderRadius: 20,
              backgroundColor: palette.accentSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="user" color={palette.accent} size={28} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <BodyText style={{ fontSize: 20, fontWeight: '700' }}>
              {account.profile.displayName}
            </BodyText>
            <BodyText style={{ color: palette.muted, fontSize: 12 }}>{account.email}</BodyText>
          </View>
        </View>
        <Badge label={account.emailVerified ? 'E-mail confirmado' : 'E-mail pendente'} />
      </Card>
      {!account.emailVerified ? (
        <MenuLink
          label="Confirmar meu e-mail"
          subtitle="Libere as alterações de segurança da conta"
          icon="mail"
          onPress={() =>
            router.push({ pathname: '/verify-email', params: { email: account.email ?? '' } })
          }
        />
      ) : null}
      <Section title="Seu treino" />
      <MenuLink
        label="Academias"
        subtitle="Seus lugares para treinar"
        icon="pin"
        onPress={() => router.push('/gyms')}
      />
      <MenuLink
        label="Equipamentos"
        subtitle="Máquinas, fotos e identificação"
        icon="dumbbell"
        onPress={() => router.push('/equipment')}
      />
      <MenuLink
        label="Exercícios personalizados"
        icon="plus"
        onPress={() => router.push('/exercises?origin=user')}
      />
      <Section title="Conta e preferências" />
      <MenuLink
        label="Perfil e aparência"
        subtitle="Foto, unidades e tema"
        icon="user"
        onPress={() => router.push('/profile')}
      />
      <MenuLink
        label="Segurança da conta"
        subtitle="E-mail e senha"
        icon="shield"
        onPress={() => router.push('/account')}
      />
      <MenuLink
        label="Contas vinculadas"
        icon="link"
        onPress={() => router.push('/linked-accounts')}
      />
      <MenuLink
        label="Dispositivos conectados"
        icon="settings"
        onPress={() => router.push('/sessions')}
      />
      <MenuLink label="Privacidade e dados" icon="shield" onPress={() => router.push('/privacy')} />
      <Notice
        message={
          account.entitlement.active
            ? 'Sua assinatura está ativa.'
            : 'Nenhuma assinatura ativa. Perfil, exportação e exclusão continuam disponíveis.'
        }
      />
      <Section title="Suporte" />
      <MenuLink
        label="Diagnóstico do aplicativo"
        icon="info"
        onPress={() => router.push('/dev-status')}
      />
      <Button
        label="Sair da conta"
        icon="logout"
        variant="ghost"
        onPress={() => void leaveThisDevice()}
      />
    </Screen>
  );
}
