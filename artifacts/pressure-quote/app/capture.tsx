import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Banner, Button, Card, Chip, Field, IconButton, Screen, SectionLabel, T, haptic } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { REQUEST_LIMIT, draftFromRequest, parseRequest, type ParsedService } from '@/lib/parser';
import { useStore } from '@/lib/store';

const EXAMPLE =
  "Hi! This is Dana Whitfield at 418 Cedar Ridge Ln. Could you give me a price to pressure wash our driveway (about 24 x 36) and the front walkway, maybe 40 ft long and 4 ft wide? Also the 6 porch steps. We were hoping to stay around $300. Thanks! 555-201-7788";

function measureLabel(m: NonNullable<ParsedService['measure']>): string {
  if (m.type === 'rect') return `${m.a} \u00D7 ${m.b} ${m.metric ? 'm' : 'ft'}`;
  if (m.type === 'area') return `${Number(m.value).toLocaleString('en-US')} ${m.metric ? 'm\u00B2' : 'sq ft'}`;
  return `${m.value} ${m.value === '1' ? 'step' : 'steps'}`;
}

export default function CaptureScreen() {
  const c = useColors();
  const store = useStore();
  const [text, setText] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);
  const parsed = useMemo(() => (text.trim().length >= 8 ? parseRequest(text) : null), [text]);

  const paste = async () => {
    setPasteError(null);
    try {
      const t = await Clipboard.getStringAsync();
      if (t.trim()) {
        setText(t.slice(0, REQUEST_LIMIT));
        haptic('select');
      } else setPasteError('Nothing to paste. Copy the customer\u2019s message first, then tap Paste.');
    } catch {
      setPasteError('Pasting is blocked here. Long-press the box and choose Paste instead.');
    }
  };

  const build = () => {
    if (!parsed) return;
    const draft = draftFromRequest(parsed, store.settings);
    const job = store.createJob(draft, { request: text.trim() });
    haptic('success');
    router.replace({ pathname: '/job/[id]', params: { id: job.id } });
  };

  const found = parsed
    ? [
        ...parsed.services.map((s) => ({ key: `s${s.name}${s.evidence}`, label: s.measure ? `${s.name} \u00B7 ${measureLabel(s.measure)}` : s.name, uncertain: !!s.measure })),
        parsed.customer.name ? { key: 'name', label: parsed.customer.name, uncertain: false } : null,
        parsed.customer.address ? { key: 'addr', label: parsed.customer.address, uncertain: false } : null,
        parsed.customer.phone ? { key: 'phone', label: parsed.customer.phone, uncertain: false } : null,
        parsed.customer.email ? { key: 'email', label: parsed.customer.email, uncertain: false } : null,
      ].filter((x): x is { key: string; label: string; uncertain: boolean } => !!x)
    : [];

  return (
    <Screen
      title="From a customer's message"
      back={false}
      modal
      right={<IconButton icon="x" label="Close" onPress={() => router.back()} testID="capture-close" />}
      footer={<Button title={parsed && parsed.services.length ? 'Build the quote' : 'Start the quote'} icon="zap" onPress={build} disabled={!parsed} testID="capture-build" />}
    >
      <Field value={text} onChangeText={(t) => setText(t)} multiline placeholder="Paste a text, email or voicemail transcript" maxLength={REQUEST_LIMIT} testID="capture-text" autoFocus={false} />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button size="md" variant="secondary" icon="clipboard" title="Paste" onPress={paste} flex testID="capture-paste" />
        {text ? (
          <Button size="md" variant="ghost" icon="x-circle" title="Clear" onPress={() => setText('')} flex />
        ) : (
          <Button size="md" variant="ghost" icon="file-text" title="Try example" onPress={() => setText(EXAMPLE)} flex testID="capture-example" />
        )}
      </View>
      {pasteError ? <Banner tone="warn" title={pasteError} /> : null}

      {parsed ? (
        <Animated.View entering={FadeIn.duration(250)} style={{ gap: 14 }}>
          <SectionLabel>What we found</SectionLabel>
          {found.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {found.map((f) => (
                <Chip key={f.key} small label={f.label} tone={f.uncertain ? 'uncertain' : undefined} />
              ))}
            </View>
          ) : (
            <T v="body" muted>
              No services or sizes yet. You can still start the quote and add them yourself.
            </T>
          )}
          {parsed.budget ? (
            <Card tone="alt" style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <Feather name="eye-off" size={16} color={c.mutedForeground} />
              <T v="small" muted style={{ flex: 1 }}>
                Budget mentioned: ${parsed.budget.amount}. Kept private and never used as the price.
              </T>
            </Card>
          ) : null}
          {parsed.questions.length ? (
            <Banner tone="warn" icon="help-circle" title={`${parsed.questions.length} ${parsed.questions.length === 1 ? 'thing' : 'things'} to check`} body="You'll answer these on the next screen, each with the customer's exact words." />
          ) : null}
          {parsed.services.some((s) => s.measure) ? (
            <T v="small" muted>
              Sizes from the customer are marked with a dashed outline until you confirm them.
            </T>
          ) : null}
        </Animated.View>
      ) : (
        <Card tone="alt" style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Feather name="lock" size={14} color={c.mutedForeground} />
            <T v="smallStrong" muted>
              Read on this iPhone only
            </T>
          </View>
          <T v="small" muted>
            The message is never uploaded. Services, sizes, name, phone and address are picked out; anything unclear becomes a question for you.
          </T>
        </Card>
      )}
    </Screen>
  );
}
