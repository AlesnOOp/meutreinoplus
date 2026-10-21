import { useId, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  InputAccessoryView,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
  type TextProps,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeStore } from '@/state/theme-store';
import { palettes } from '@/theme/colors';
import { resolveColorScheme } from '@/theme/scheme';
import { Icon, type IconName } from '@/ui/icon';
export { Icon } from '@/ui/icon';

export function usePalette() {
  const preference = useThemeStore((state) => state.preference);
  const systemScheme = useColorScheme();
  const scheme = resolveColorScheme(preference, systemScheme);
  return { palette: palettes[scheme], scheme };
}

export function BodyText({ style, ...props }: TextProps) {
  const { palette } = usePalette();
  return <Text {...props} style={[{ color: palette.text, fontSize: 15, lineHeight: 23 }, style]} />;
}

export function Screen({
  title,
  subtitle,
  children,
  onBack,
  eyebrow,
  headerRight,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onBack?: () => void;
  eyebrow?: string;
  headerRight?: ReactNode;
  footer?: ReactNode;
}) {
  const { palette } = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: palette.background }}
      edges={['top', 'left', 'right']}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
        >
          <View style={styles.topline}>
            {onBack ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Voltar"
                onPress={onBack}
                style={({ pressed }) => [
                  styles.iconButton,
                  {
                    backgroundColor: palette.surface,
                    borderColor: palette.border,
                    opacity: pressed ? 0.6 : 1,
                  },
                ]}
              >
                <Icon name="back" color={palette.text} />
              </Pressable>
            ) : (
              <View style={styles.wordmark}>
                <View style={[styles.brandMark, { backgroundColor: palette.accent }]}>
                  <Icon name="dumbbell" size={17} color={palette.accentText} />
                </View>
                <Text
                  style={{
                    color: palette.text,
                    fontWeight: '800',
                    fontSize: 16,
                    letterSpacing: -0.5,
                  }}
                >
                  meutreino<Text style={{ color: palette.accent }}>+</Text>
                </Text>
              </View>
            )}
            {headerRight}
          </View>
          <View style={{ gap: 7, marginBottom: 8 }}>
            {eyebrow ? (
              <Text style={[styles.eyebrow, { color: palette.accent }]}>{eyebrow}</Text>
            ) : null}
            <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>
              {title}
            </Text>
            {subtitle ? (
              <Text style={[styles.subtitle, { color: palette.muted }]}>{subtitle}</Text>
            ) : null}
          </View>
          {children}
        </ScrollView>
        {footer ? (
          <View
            style={{
              backgroundColor: palette.background,
              borderTopWidth: 1,
              borderColor: palette.border,
              paddingHorizontal: 22,
              paddingTop: 12,
              paddingBottom: Math.max(insets.bottom, 16),
            }}
          >
            {footer}
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  error,
  secureTextEntry,
  multiline,
  placeholder,
  ...props
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  error?: string | null;
} & Pick<
  TextInputProps,
  | 'secureTextEntry'
  | 'keyboardType'
  | 'autoComplete'
  | 'textContentType'
  | 'autoCapitalize'
  | 'multiline'
  | 'placeholder'
>) {
  const { palette } = usePalette();
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(false);
  const accessoryId = useId();
  const numeric = props.keyboardType === 'number-pad' || props.keyboardType === 'decimal-pad';
  return (
    <View style={{ gap: 8 }}>
      <Text style={[styles.label, { color: palette.text }]}>{label}</Text>
      <View
        style={[
          styles.inputShell,
          {
            backgroundColor: palette.surface,
            borderColor: error ? palette.danger : focused ? palette.accent : palette.border,
            borderWidth: focused ? 2 : 1,
          },
        ]}
      >
        {label.toLowerCase().includes('pesquis') ? (
          <Icon name="search" color={palette.muted} size={20} />
        ) : null}
        <TextInput
          {...props}
          accessibilityLabel={label}
          accessibilityHint={error || undefined}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={secureTextEntry && !visible}
          autoCapitalize={props.autoCapitalize ?? 'none'}
          autoCorrect={false}
          multiline={multiline}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={
            placeholder ??
            (label.toLowerCase().includes('pesquis') ? 'Encontre pelo nome...' : undefined)
          }
          placeholderTextColor={palette.muted}
          selectionColor={palette.accent}
          inputAccessoryViewID={numeric && Platform.OS === 'ios' ? accessoryId : undefined}
          style={[
            styles.input,
            {
              color: palette.text,
              minHeight: multiline ? 108 : 54,
              textAlignVertical: multiline ? 'top' : 'center',
            },
          ]}
        />
        {secureTextEntry ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={visible ? 'Ocultar senha' : 'Mostrar senha'}
            hitSlop={8}
            onPress={() => setVisible(!visible)}
            style={{ padding: 10 }}
          >
            <Icon name={visible ? 'eyeOff' : 'eye'} color={palette.muted} size={21} />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={{ color: palette.danger, fontSize: 13 }}>
          {error}
        </Text>
      ) : null}
      {numeric && Platform.OS === 'ios' ? (
        <InputAccessoryView nativeID={accessoryId}>
          <View style={{ backgroundColor: palette.surface, padding: 8, alignItems: 'flex-end' }}>
            <Pressable
              accessibilityRole="button"
              onPress={Keyboard.dismiss}
              style={{ padding: 10 }}
            >
              <Text style={{ color: palette.accent, fontWeight: '700' }}>Concluir</Text>
            </Pressable>
          </View>
        </InputAccessoryView>
      ) : null}
    </View>
  );
}

export function Button({
  label,
  onPress,
  busy,
  variant = 'primary',
  disabled,
  icon,
  compact = false,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  icon?: IconName;
  compact?: boolean;
}) {
  const { palette } = usePalette();
  const color =
    variant === 'primary'
      ? palette.accentText
      : variant === 'danger'
        ? palette.danger
        : palette.accent;
  const background =
    variant === 'primary'
      ? palette.accent
      : variant === 'danger'
        ? palette.dangerSoft
        : variant === 'ghost'
          ? 'transparent'
          : palette.accentSoft;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled || busy), busy: Boolean(busy) }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: background,
          minHeight: compact ? 48 : 56,
          paddingHorizontal: compact ? 14 : 20,
          opacity: disabled || busy ? 0.5 : pressed ? 0.78 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={color} />
      ) : (
        <>
          {icon ? <Icon name={icon} color={color} size={20} /> : null}
          <Text style={[styles.buttonLabel, { color }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

export function Notice({
  message,
  tone = 'info',
}: {
  message: string;
  tone?: 'info' | 'error' | 'success';
}) {
  const { palette } = usePalette();
  const color =
    tone === 'error' ? palette.danger : tone === 'success' ? palette.success : palette.muted;
  return (
    <View
      style={[
        styles.notice,
        {
          backgroundColor:
            tone === 'error'
              ? palette.dangerSoft
              : tone === 'success'
                ? palette.successSoft
                : palette.soft,
        },
      ]}
    >
      <Icon
        name={tone === 'error' ? 'alert' : tone === 'success' ? 'check' : 'info'}
        color={color}
        size={18}
      />
      <Text
        accessibilityRole={tone === 'error' ? 'alert' : undefined}
        accessibilityLiveRegion="polite"
        style={{ color, fontSize: 13, lineHeight: 20, flex: 1 }}
      >
        {message}
      </Text>
    </View>
  );
}

export function MenuLink({
  label,
  onPress,
  subtitle,
  icon = 'chevron',
  badge,
  tint,
  plain = false,
}: {
  label: string;
  onPress: () => void;
  subtitle?: string;
  icon?: IconName;
  badge?: string;
  tint?: string;
  plain?: boolean;
}) {
  const { palette } = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[label, subtitle, badge].filter(Boolean).join(', ')}
      onPress={onPress}
      style={({ pressed }) => [
        styles.menu,
        {
          backgroundColor: plain ? 'transparent' : palette.surface,
          borderColor: plain ? 'transparent' : palette.border,
          padding: plain ? 0 : 15,
          minHeight: plain ? 48 : 70,
          opacity: pressed ? 0.65 : 1,
        },
      ]}
    >
      {icon !== 'chevron' ? (
        <View
          style={[styles.menuIcon, { backgroundColor: tint ? `${tint}18` : palette.accentSoft }]}
        >
          <Icon name={icon} color={tint ?? palette.accent} />
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ color: palette.text, fontSize: 16, lineHeight: 22, fontWeight: '600' }}>
          {label}
        </Text>
        {subtitle ? (
          <Text style={{ color: palette.muted, fontSize: 13, lineHeight: 19 }}>{subtitle}</Text>
        ) : null}
      </View>
      {badge ? <Badge label={badge} /> : null}
      <Icon name="chevron" size={17} color={palette.muted} />
    </Pressable>
  );
}

export function Choice({
  label,
  selected,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  accessibilityLabel?: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { palette } = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        {
          backgroundColor: selected ? palette.accent : palette.surface,
          borderColor: selected ? palette.accent : palette.border,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text
        style={{
          color: selected ? palette.accentText : palette.muted,
          fontSize: 14,
          fontWeight: '600',
          textAlign: 'center',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const { palette } = usePalette();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: palette.surface, borderColor: palette.border },
        style,
      ]}
    >
      {children}
    </View>
  );
}
export function Section({ title, detail }: { title: string; detail?: string }) {
  const { palette } = usePalette();
  return (
    <View style={{ marginTop: 12, marginBottom: 2, gap: 4 }}>
      <Text
        accessibilityRole="header"
        style={{ color: palette.text, fontSize: 19, fontWeight: '700', letterSpacing: -0.5 }}
      >
        {title}
      </Text>
      {detail ? (
        <Text style={{ color: palette.muted, fontSize: 13, lineHeight: 20 }}>{detail}</Text>
      ) : null}
    </View>
  );
}
export function Badge({ label }: { label: string }) {
  const { palette } = usePalette();
  return (
    <View
      style={{
        backgroundColor: palette.accentSoft,
        borderRadius: 8,
        paddingHorizontal: 9,
        paddingVertical: 5,
        alignSelf: 'flex-start',
      }}
    >
      <Text style={{ color: palette.accent, fontSize: 11, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}
export function EmptyState({
  title,
  description,
  icon = 'layers',
}: {
  title: string;
  description: string;
  icon?: IconName;
}) {
  const { palette } = usePalette();
  return (
    <Card style={{ alignItems: 'center', paddingVertical: 32, gap: 12 }}>
      <View style={{ backgroundColor: palette.accentSoft, borderRadius: 22, padding: 18 }}>
        <Icon name={icon} color={palette.accent} size={32} />
      </View>
      <Text style={{ color: palette.text, fontSize: 20, fontWeight: '700', textAlign: 'center' }}>
        {title}
      </Text>
      <Text
        style={{
          color: palette.muted,
          fontSize: 14,
          lineHeight: 22,
          textAlign: 'center',
          maxWidth: 280,
        }}
      >
        {description}
      </Text>
    </Card>
  );
}
export function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  const { palette } = usePalette();
  return (
    <View style={{ flex: 1, gap: 5 }}>
      <Text
        style={{
          color: color ?? palette.text,
          fontSize: 27,
          lineHeight: 34,
          fontWeight: '800',
          letterSpacing: -1,
          fontVariant: ['tabular-nums'],
        }}
      >
        {value}
      </Text>
      <Text style={{ color: palette.muted, fontSize: 12, lineHeight: 17 }}>{label}</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  content: {
    padding: 22,
    paddingBottom: 48,
    gap: 14,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  topline: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 44,
    marginBottom: 12,
  },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandMark: {
    width: 29,
    height: 29,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButton: {
    width: 48,
    height: 48,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 31, fontWeight: '800', lineHeight: 37, letterSpacing: -1.1 },
  eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  subtitle: { fontSize: 14, lineHeight: 22 },
  label: { fontSize: 13, fontWeight: '600', marginLeft: 2 },
  inputShell: {
    gap: 8,
    borderRadius: 17,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  input: { flex: 1, minWidth: 0, fontSize: 16, paddingVertical: 14 },
  button: {
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 9,
    paddingVertical: 13,
  },
  buttonLabel: {
    fontSize: 15,
    fontWeight: '700',
    flexShrink: 1,
    textAlign: 'center',
    lineHeight: 22,
  },
  notice: { borderRadius: 15, padding: 13, flexDirection: 'row', gap: 9, alignItems: 'flex-start' },
  menu: {
    minHeight: 70,
    padding: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 20,
    borderWidth: 1,
  },
  menuIcon: {
    width: 48,
    height: 48,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choice: {
    minHeight: 48,
    minWidth: 48,
    flexGrow: 1,
    flexShrink: 1,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  card: { borderRadius: 24, padding: 20, borderWidth: 1, gap: 12 },
});

export function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const { palette } = usePalette();
  return (
    <View style={{ gap: 12 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(!expanded)}
        style={{
          minHeight: 48,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <Text style={{ color: palette.accent, fontWeight: '600', fontSize: 14, flex: 1 }}>
          {title}
        </Text>
        <Icon name={expanded ? 'up' : 'down'} color={palette.accent} size={18} />
      </Pressable>
      {expanded ? children : null}
    </View>
  );
}

export function Progress({ value, label }: { value: number; label: string }) {
  const { palette } = usePalette();
  const percent = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      style={{ gap: 9 }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: palette.muted, fontSize: 12 }}>{label}</Text>
        <Text style={{ color: palette.accent, fontWeight: '800', fontSize: 12 }}>{percent}%</Text>
      </View>
      <View
        style={{ height: 7, borderRadius: 4, backgroundColor: palette.soft, overflow: 'hidden' }}
      >
        <View
          style={{
            width: `${percent}%`,
            height: 7,
            backgroundColor: palette.accent,
            borderRadius: 4,
          }}
        />
      </View>
    </View>
  );
}

export function LoadingState({ label = 'Preparando seu espaço...' }: { label?: string }) {
  const { palette } = usePalette();
  return (
    <View
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
      style={{ minHeight: 130, alignItems: 'center', justifyContent: 'center', gap: 14 }}
    >
      <ActivityIndicator color={palette.accent} />
      <Text style={{ color: palette.muted, fontSize: 13 }}>{label}</Text>
    </View>
  );
}

export function ColorSwatch({
  label,
  color,
  selected,
  onPress,
}: {
  label: string;
  color: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { palette } = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        minWidth: 65,
        minHeight: 76,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
      }}
    >
      <View
        style={{
          padding: 4,
          borderWidth: 2,
          borderColor: selected ? palette.accent : 'transparent',
          borderRadius: 20,
        }}
      >
        <View
          style={{
            width: 31,
            height: 31,
            borderRadius: 13,
            backgroundColor: color,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {selected ? <Icon name="check" size={19} color="white" /> : null}
        </View>
      </View>
      <Text style={{ color: palette.muted, fontSize: 10 }}>{label}</Text>
    </Pressable>
  );
}
