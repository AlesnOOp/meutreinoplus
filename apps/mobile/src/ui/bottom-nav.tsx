import { router, usePathname } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from '@/ui/icon';
import { usePalette } from '@/ui/ui';

const tabs: {
  path: '/home' | '/plans' | '/treino' | '/exercises' | '/more';
  label: string;
  icon: IconName;
}[] = [
  { path: '/home', label: 'Início', icon: 'home' },
  { path: '/plans', label: 'Fichas', icon: 'layers' },
  { path: '/treino', label: 'Treinar', icon: 'dumbbell' },
  { path: '/exercises', label: 'Biblioteca', icon: 'book' },
  { path: '/more', label: 'Você', icon: 'user' },
];
export function BottomNav() {
  const pathname = usePathname();
  const { palette } = usePalette();
  const insets = useSafeAreaInsets();
  if (!tabs.some((tab) => tab.path === pathname)) return null;
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        borderTopWidth: 1,
        borderColor: palette.border,
        backgroundColor: palette.surface,
        paddingTop: 10,
        paddingBottom: Math.max(insets.bottom, 12),
        paddingHorizontal: 8,
      }}
    >
      {tabs.map((tab) => {
        const selected = pathname === tab.path;
        return (
          <Pressable
            key={tab.path}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected }}
            onPress={() => {
              if (!selected) router.navigate(tab.path);
            }}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: 52,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <View
              style={{
                paddingHorizontal: 15,
                paddingVertical: 4,
                borderRadius: 12,
                backgroundColor: selected ? palette.accentSoft : 'transparent',
              }}
            >
              <Icon name={tab.icon} color={selected ? palette.accent : palette.muted} size={22} />
            </View>
            <Text
              style={{
                color: selected ? palette.accent : palette.muted,
                fontSize: 10,
                fontWeight: selected ? '800' : '500',
              }}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
