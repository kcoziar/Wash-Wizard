import React, { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Banner, Button, Card, Divider, Screen, SectionLabel, T, TextLink, haptic } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { SUPPORT_EMAIL, SUPPORT_FAQ } from '@/constants/legal';
import { useSubscription } from '@/lib/revenuecat';
import { HAS_SUPPORT_PAGE, SUPPORT_PAGE } from '@/lib/links';
import { emailSupport } from '@/lib/support';

const FAQ = SUPPORT_FAQ;

export default function SupportScreen() {
  const c = useColors();
  const [open, setOpen] = useState<number | null>(0);
  const [copied, setCopied] = useState(false);
  const [mailFailed, setMailFailed] = useState(false);

  const sub = useSubscription();

  const email = async () => {
    setMailFailed(false);
    // The purchase ID and Pro status let support find a subscription without asking for receipts.
    const lines = await sub.diagnostics().catch(() => [] as string[]);
    if (!(await emailSupport({ lines }))) setMailFailed(true);
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
        <T v="small" muted>
          The email includes the app version and your purchase ID so we can find your subscription. Nothing about your customers is added.
        </T>
        {HAS_SUPPORT_PAGE ? <TextLink title="Visit the support page" icon="external-link" onPress={() => Linking.openURL(SUPPORT_PAGE).catch(() => undefined)} testID="support-web" /> : null}
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
