import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { ConsentToggles, SocialButtons } from '@/auth/social-buttons';
import { appleSignInConfigured, googleClientId } from '@/auth/providers';
import { brand } from '@/theme/colors';
import { Button, Icon, Notice, Screen, usePalette } from '@/ui/ui';

export default function WelcomeScreen() {
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { palette } = usePalette();
  const social = appleSignInConfigured() || googleClientId() !== null;
  return (
    <Screen
      title="Seu treino.\nSeu próximo nível."
      subtitle="Menos distração. Mais movimento."
      eyebrow="FEITO PARA O SEU RITMO"
    >
      <View
        style={{
          backgroundColor: brand.violet,
          borderRadius: 30,
          padding: 26,
          minHeight: 260,
          overflow: 'hidden',
          justifyContent: 'space-between',
          gap: 24,
        }}
      >
        <View
          style={{
            position: 'absolute',
            width: 230,
            height: 230,
            borderWidth: 1,
            borderColor: '#FFFFFF25',
            borderRadius: 115,
            right: -45,
            top: -50,
          }}
        />
        <View
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <View
            style={{
              backgroundColor: brand.lime,
              borderRadius: 20,
              padding: 18,
              transform: [{ rotate: '-12deg' }],
            }}
          >
            <Icon name="dumbbell" size={54} color={brand.ink} />
          </View>
          <Icon name="trophy" color={brand.coral} size={42} />
        </View>
        <View style={{ gap: 8 }}>
          <Text style={{ color: 'white', fontSize: 27, fontWeight: '800', letterSpacing: -0.8 }}>
            O progresso é seu.
          </Text>
          <Text style={{ color: '#E9E1FF', fontSize: 14, lineHeight: 22 }}>
            Suas fichas, suas séries e cada treino registrado. Até quando a internet não acompanha.
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {['ORGANIZE', 'TREINE', 'REGISTRE'].map((label) => (
            <Text
              key={label}
              style={{
                color: brand.lime,
                fontSize: 9,
                fontWeight: '800',
                letterSpacing: 1.4,
                flex: 1,
              }}
            >
              {label}
            </Text>
          ))}
        </View>
      </View>
      <Button label="Começar agora" icon="arrow" onPress={() => router.push('/sign-up')} />
      <Button
        label="Já tenho uma conta"
        variant="secondary"
        onPress={() => router.push('/sign-in')}
      />
      {social ? (
        <>
          <ConsentToggles
            acceptTerms={acceptTerms}
            acceptPrivacy={acceptPrivacy}
            onChangeTerms={setAcceptTerms}
            onChangePrivacy={setAcceptPrivacy}
          />
          <SocialButtons
            acceptTerms={acceptTerms}
            acceptPrivacy={acceptPrivacy}
            busy={busy}
            onBusy={setBusy}
            onError={setError}
          />
        </>
      ) : null}
      {error ? <Notice tone="error" message={error} /> : null}
      <Text style={{ color: palette.muted, fontSize: 11, lineHeight: 18, textAlign: 'center' }}>
        Você organiza o treino definido por você ou pelo seu profissional. O MeuTreino+ não
        prescreve exercícios.
      </Text>
    </Screen>
  );
}
