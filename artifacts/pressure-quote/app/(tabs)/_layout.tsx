import React from 'react';
import { Platform, StyleSheet, useColorScheme, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Tabs } from 'expo-router';
import { NativeTabs } from 'expo-router/native-tabs';
import { SymbolView, type SFSymbol } from 'expo-symbols';

// iOS 26 uses NativeTabs (liquid glass, system appearance). Older iOS, Android and web use the classic bar with brand colors.
function NativeTabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf={{ default: 'plus.circle', selected: 'plus.circle.fill' }} />
        <NativeTabs.Trigger.Label>Quote</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="jobs">
        <NativeTabs.Trigger.Icon sf={{ default: 'tray.full', selected: 'tray.full.fill' }} />
        <NativeTabs.Trigger.Label>Jobs</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="tools">
        <NativeTabs.Trigger.Icon sf={{ default: 'ruler', selected: 'ruler.fill' }} />
        <NativeTabs.Trigger.Label>Tools</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon sf={{ default: 'gearshape', selected: 'gearshape.fill' }} />
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

const TABS: { name: string; title: string; sf: SFSymbol; feather: React.ComponentProps<typeof Feather>['name'] }[] = [
  { name: 'index', title: 'Quote', sf: 'plus.circle', feather: 'plus-circle' },
  { name: 'jobs', title: 'Jobs', sf: 'tray.full', feather: 'inbox' },
  { name: 'tools', title: 'Tools', sf: 'ruler', feather: 'tool' },
  { name: 'settings', title: 'Settings', sf: 'gearshape', feather: 'settings' },
];

function ClassicTabLayout() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const isIOS = Platform.OS === 'ios';
  const isWeb = Platform.OS === 'web';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.foreground,
        tabBarInactiveTintColor: colors.faint,
        tabBarLabelStyle: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: isIOS ? 'transparent' : colors.background,
          borderTopWidth: isWeb ? 1 : 0,
          borderTopColor: colors.border,
          elevation: 0,
          ...(isWeb ? { height: 84 } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView intensity={100} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
          ) : isWeb ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} />
          ) : null,
      }}
    >
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{
            title: t.title,
            tabBarButtonTestID: `tab-${t.name}`,
            tabBarIcon: ({ color }) => {
              const tint = typeof color === 'string' ? color : undefined;
              return isIOS ? <SymbolView name={t.sf} tintColor={tint} size={24} /> : <Feather name={t.feather} size={22} color={tint} />;
            },
          }}
        />
      ))}
    </Tabs>
  );
}

export default function TabLayout() {
  if (isLiquidGlassAvailable()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}
