import React, { useState } from 'react';
import { Linking, Platform, Pressable, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Banner, Button, Card, Divider, Screen, SectionLabel, T, haptic } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { APP_NAME, SUPPORT_EMAIL } from '@/constants/legal';

const FAQ: { q: string; a: string }[] = [
  {
    q: 'What uses one of my free quotes?',
    a: 'Creating a new quote to send. Drafts, fixing a quote you already made, revisions and sharing again never count.',
  },
  {
    q: 'Why do some numbers have a dashed outline?',
    a: "They came from the customer's message or an estimate, so they still need your OK. Tap Looks right and the outline turns into a tick.",
  },
  {
    q: 'Can customers see my costs or hourly pay?',
    a: 'No. The quote only shows the services, prices, tax, deposit, terms and your business details. Costs, times, budgets and notes stay private.',
  },
  {
    q: 'Where are my jobs stored?',
    a: 'On this iPhone only. Use Backup & data to save a backup file to Files or iCloud Drive. Restoring purchases brings back Pro, not jobs.',
  },
  {
    q: 'How do I cancel Pro?',
    a: 'Settings \u203A Manage subscription opens your Apple subscriptions. Cancel at least 24 hours before it renews. Your jobs and quotes stay.',
  },
];

export default function SupportScreen() {
  const c = useColors();
  const [open, setOpen] = useState<number | null>(0);
  const [copied, setCopied] = useState(false);
  const [mailFailed, setMailFailed] = useState(false);

  const email = async () => {
    setMailFailed(false);
    const subject = encodeURIComponent(`${APP_NAME} support`);
    const body = encodeURIComponent(`\n\n\u2014\nApp version ${Constants.expoConfig?.version ?? '1.0.0'} \u00B7 ${Platform.OS} ${String(Platform.Version)}`);
    try {
      await Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`);
    } catch {
      setMailFailed(true);
    }
  };

  const copy = async () => {
    try {
      await Clipboard.setStringAsync(SUPPORT_EMAIL);
      haptic('success');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMailFailed(true);
    }
  };

  return (
    <Screen title="Support" subtitle="A real person reads every message">
      <Card style={{ gap: 12 }}>
        <T v="body">Questions, a problem, or an idea for the app? Write to us and include what you were doing. Please leave out customer details.</T>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button title="Email support" icon="mail" onPress={email} flex testID="support-email" />
          <Button title={copied ? 'Copied' : 'Copy address'} icon={copied ? 'check' : 'copy'} variant="secondary" onPress={copy} flex testID="support-copy" />
        </View>
        <T v="small" muted selectable>
          {SUPPORT_EMAIL}
        </T>
        {mailFailed ? <Banner tone="warn" title="Mail isn't set up on this device" body={`Write to ${SUPPORT_EMAIL} from any email app.`} /> : null}
      </Card>

      <SectionLabel>Common questions</SectionLabel>
      <Card style={{ paddingVertical: 4 }}>
        {FAQ.map((f, i) => (
          <View key={f.q}>
            {i > 0 ? <Divider /> : null}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: open === i }}
              onPress={() => setOpen(open === i ? null : i)}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14, opacity: pressed ? 0.6 : 1 })}
              testID={`faq-${i}`}
            >
              <T v="bodyStrong" style={{ flex: 1 }}>
                {f.q}
              </T>
              <Feather name={open === i ? 'chevron-up' : 'chevron-down'} size={18} color={c.mutedForeground} />
            </Pressable>
            {open === i ? (
              <Animated.View entering={FadeIn.duration(200)} style={{ paddingBottom: 14 }}>
                <T v="body" muted>
                  {f.a}
                </T>
              </Animated.View>
            ) : null}
          </View>
        ))}
      </Card>
    </Screen>
  );
}
