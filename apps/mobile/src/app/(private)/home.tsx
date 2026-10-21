import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { listLocalPlans, type LocalPlan } from '@/plans/plan-store';
import { listLocalSessions, type LocalSession } from '@/sessions/session-store';
import { useSessionStore } from '@/session/session-store';
import { brand } from '@/theme/colors';
import {
  Badge,
  Button,
  Card,
  Icon,
  MenuLink,
  Notice,
  Screen,
  Section,
  Stat,
  usePalette,
} from '@/ui/ui';

export default function HomeScreen() {
  const account = useSessionStore((state) => state.account);
  const status = useSessionStore((state) => state.status);
  const { palette } = usePalette();
  const [now, setNow] = useState(() => Date.now());
  const [plans, setPlans] = useState<LocalPlan[]>([]);
  const [sessions, setSessions] = useState<LocalSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      setNow(Date.now());
      if (account)
        void Promise.all([listLocalPlans(account.id, 'active'), listLocalSessions(account.id)])
          .then(([p, s]) => {
            if (active) {
              setPlans(p);
              setSessions(s);
              setError(null);
            }
          })
          .catch(() => {
            if (active) setError('Não foi possível atualizar seu painel. Tente abrir suas fichas.');
          });
      return () => {
        active = false;
      };
    }, [account]),
  );
  if (!account) return null;
  const open = sessions.find((s) => s.status === 'in_progress' || s.status === 'paused');
  const completed = sessions.filter((s) => s.status === 'completed');
  const weekly = completed.filter(
    (s) => now - new Date(s.startedAt).getTime() < 7 * 86_400_000,
  ).length;
  const start = () =>
    open
      ? router.push(`/treino/${open.id}`)
      : plans.length
        ? router.push('/plans')
        : router.push('/plans/new');
  return (
    <Screen
      title={`Bora, ${account.profile.displayName.split(' ')[0]}?`}
      subtitle="Um treino de cada vez. No seu ritmo."
      eyebrow="SEU MOVIMENTO, SUA EVOLUÇÃO"
      headerRight={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Abrir meu perfil"
          onPress={() => router.navigate('/more')}
          style={{
            width: 43,
            height: 43,
            borderRadius: 16,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: palette.accentSoft,
          }}
        >
          <Text style={{ color: palette.accent, fontWeight: '800', fontSize: 18 }}>
            {account.profile.displayName.slice(0, 1).toUpperCase()}
          </Text>
        </Pressable>
      }
    >
      {error ? <Notice message={error} tone="error" /> : null}
      {status === 'offline' ? (
        <Notice message="Você está offline. Continue treinando; seus registros ficam neste aparelho." />
      ) : null}
      <View
        style={{
          backgroundColor: brand.violet,
          borderRadius: 28,
          padding: 24,
          gap: 16,
          overflow: 'hidden',
        }}
      >
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            right: -18,
            top: -18,
            width: 148,
            height: 148,
            borderRadius: 74,
            backgroundColor: '#7751E3',
          }}
        />
        <View
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <View
            style={{
              borderRadius: 8,
              backgroundColor: '#FFFFFF22',
              paddingHorizontal: 10,
              paddingVertical: 6,
            }}
          >
            <Text style={{ color: 'white', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 }}>
              {open ? 'TREINO EM ANDAMENTO' : 'SEU PRÓXIMO TREINO'}
            </Text>
          </View>
          <Icon name="dumbbell" color={brand.lime} size={40} />
        </View>
        <Text
          style={{
            color: 'white',
            fontSize: 30,
            lineHeight: 35,
            letterSpacing: -1,
            fontWeight: '800',
            maxWidth: 250,
          }}
        >
          {open
            ? open.planName
            : plans.length
              ? 'Seu próximo\npasso começa aqui.'
              : 'Tudo começa\ncom a sua ficha.'}
        </Text>
        <Text style={{ color: '#E9E1FF', fontSize: 13, lineHeight: 21, maxWidth: 260 }}>
          {open
            ? 'Seu progresso está salvo. Continue de onde parou.'
            : 'Organize seus exercícios e registre cada conquista.'}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={start}
          style={({ pressed }) => ({
            backgroundColor: brand.lime,
            borderRadius: 17,
            padding: 17,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text style={{ color: brand.ink, fontWeight: '800', fontSize: 15 }}>
            {open
              ? 'Continuar treino'
              : plans.length
                ? 'Escolher meu treino'
                : 'Criar primeira ficha'}
          </Text>
          <Icon name="arrow" color={brand.ink} size={20} />
        </Pressable>
      </View>
      <Card style={{ flexDirection: 'row', gap: 12 }}>
        <Stat label="nos últimos 7 dias" value={weekly} color={palette.accent} />
        <View style={{ width: 1, backgroundColor: palette.border }} />
        <Stat label="treinos concluídos" value={completed.length} />
        <View style={{ width: 1, backgroundColor: palette.border }} />
        <Stat label="fichas ativas" value={plans.length} />
      </Card>
      <Section title="Sua rotina" detail="Tudo pronto para o próximo treino." />
      {plans.slice(0, 2).map((plan) => (
        <MenuLink
          key={plan.id}
          label={plan.name}
          subtitle={`${plan.exercises.length} exercícios · ${plan.exercises.reduce((n, e) => n + e.sets.length, 0)} séries`}
          icon="layers"
          badge={plan.pending ? 'Local' : undefined}
          onPress={() => router.push(`/plans/${plan.id}`)}
        />
      ))}
      {plans.length ? (
        <Button
          label="Ver todas as fichas"
          variant="ghost"
          onPress={() => router.navigate('/plans')}
        />
      ) : (
        <MenuLink
          label="Monte sua primeira ficha"
          subtitle="Nome, exercícios e séries do seu jeito"
          icon="plus"
          onPress={() => router.push('/plans/new')}
        />
      )}
      <Section title="Seu espaço de treino" />
      <MenuLink
        label="Academias e equipamentos"
        subtitle="Identifique a máquina certa em cada lugar"
        icon="pin"
        tint="#D06038"
        onPress={() => router.push('/gyms')}
      />
      {!account.emailVerified ? (
        <MenuLink
          label="Confirme seu e-mail"
          subtitle="Conclua a configuração da conta"
          icon="mail"
          onPress={() =>
            router.push({ pathname: '/verify-email', params: { email: account.email ?? '' } })
          }
        />
      ) : (
        <Badge label="Seu treino também funciona offline" />
      )}
    </Screen>
  );
}
