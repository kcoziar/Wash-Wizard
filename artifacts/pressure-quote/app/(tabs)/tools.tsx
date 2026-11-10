import React from 'react';
import { View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { Card, Screen, T } from '@/components/ui';
import { useColors } from '@/hooks/useColors';

const TOOLS: { href: Href; icon: React.ComponentProps<typeof Feather>['name']; title: string; body: string; testID: string }[] = [
  { href: '/tools/area', icon: 'maximize', title: 'Area calculator', body: 'Add up rectangles and triangles, take out planters and steps.', testID: 'tool-area' },
  { href: '/tools/check', icon: 'clock', title: 'Is this price worth it?', body: 'Check any price against your time, costs and target pay.', testID: 'tool-check' },
  { href: '/tools/margin', icon: 'percent', title: 'Margin & markup', body: 'Find the price for a margin, and see why markup is different.', testID: 'tool-margin' },
];

export default function ToolsScreen() {
  const c = useColors();
  return (
    <Screen title="Tools" subtitle="Free, no quote needed." large back={false} tab>
      {TOOLS.map((t) => (
        <Card key={t.testID} onPress={() => router.push(t.href)} testID={t.testID}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: c.hero, alignItems: 'center', justifyContent: 'center' }}>
              <Feather name={t.icon} size={20} color={c.accent} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <T v="h3">{t.title}</T>
              <T v="small" muted>
                {t.body}
              </T>
            </View>
            <Feather name="chevron-right" size={18} color={c.faint} />
          </View>
        </Card>
      ))}
    </Screen>
  );
}
