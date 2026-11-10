import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Banner, Button, Card, Chip, Field, IconButton, Screen, SectionLabel, Segmented, T, haptic } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { track } from '@/lib/analytics';
import { REQUEST_LIMIT, describeMeasure, draftFromRequest, guessMode, parseRequest, type ParsedService, type RequestMode } from '@/lib/parser';
import { useStore } from '@/lib/store';

const EXAMPLE =
  "Hi! This is Dana Whitfield at 418 Cedar Ridge Ln. Could you give me a price to pressure wash our driveway (about 24 x 36) and the front walkway, maybe 40 ft long and 4 ft wide? Also the 6 porch steps. We were hoping to stay around $300. Thanks! 555-201-7788";

const LIMIT_TEXT = REQUEST_LIMIT.toLocaleString('en-US');
const MODES: { value: RequestMode; label: string }[] = [
  { value: 'customer', label: "Customer's message" },
  { value: 'operator', label: 'My notes' },
];
/** The iPhone's own Paste control reads the clipboard without the "Allow Paste" prompt. */
const NATIVE_PASTE = Platform.OS === 'ios' && Clipboard.isPasteButtonAvailable;

function serviceLabel(s: ParsedService): string {
  if (s.negated) return `${s.name} · not included`;
  return [
    s.name,
    s.measure ? describeMeasure(s.measure) : null,
    s.flatPrice ? `$${s.flatPrice} flat` : null,
    s.rate ? `$${s.rate.amount} ${s.rate.label}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export default function CaptureScreen() {
  const c = useColors();
  const store = useStore();
  const { text: incoming } = useLocalSearchParams<{ text?: string }>();
  // An unfinished message comes back when the screen is reopened.
  const [restored] = useState(() => !incoming && store.meta.captureDraft.trim().length > 0);
  const [text, setTextState] = useState(() => (incoming ? incoming.slice(0, REQUEST_LIMIT) : store.meta.captureDraft));
  const [cut, setCut] = useState(() => !!incoming && incoming.length > REQUEST_LIMIT);
  const [exampleMode, setExampleMode] = useState(false);
  const [pasteError, setPasteError] = useState<string | null>(null);
  // Pasted text is a customer's message. Typed text is guessed until the operator picks.
  const [mode, setMode] = useState<RequestMode>(() => (incoming ? 'customer' : guessMode(store.meta.captureDraft)));
  const [modePicked, setModePicked] = useState(!!incoming);
  const building = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const units = store.settings.units;
  const parsed = useMemo(() => (text.trim().length >= 8 ? parseRequest(text, { units, mode }) : null), [text, units, mode]);
  const notes = mode === 'operator';

  const persist = (t: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      store.updateMeta((m) => (m.captureDraft === t ? m : { ...m, captureDraft: t }));
    }, 500);
  };
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  const setText = (t: string, opts: { example?: boolean; pasted?: boolean } = {}) => {
    setTextState(t);
    if (!t.trim()) {
      setExampleMode(false);
      setModePicked(false);
    }
    if (opts.pasted || opts.example) {
      setMode('customer');
      setModePicked(true);
    } else if (!modePicked) setMode(guessMode(t));
    // The fictional example is never saved as the user's own unfinished message.
    persist(opts.example || (exampleMode && t.trim()) ? '' : t);
  };

  const takePasted = (t: string) => {
    if (t.trim()) {
      setPasteError(null);
      setExampleMode(false);
      setCut(t.length > REQUEST_LIMIT);
      setText(t.slice(0, REQUEST_LIMIT), { pasted: true });
      haptic('select');
      track('paste_used');
    } else setPasteError('Nothing to paste. Copy the customer\u2019s message first, then tap Paste.');
  };

  const paste = async () => {
    setPasteError(null);
    try {
      takePasted(await Clipboard.getStringAsync());
    } catch {
      setPasteError('Pasting is blocked here. Long-press the box and choose Paste instead.');
    }
  };

  const tryExample = () => {
    setCut(false);
    setExampleMode(true);
    setText(EXAMPLE, { example: true });
  };

  const useOwn = () => {
    setExampleMode(false);
    setText('');
  };

  const pickMode = (m: RequestMode) => {
    setMode(m);
    setModePicked(true);
  };

  const build = () => {
    if (!parsed || building.current) return;
    building.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    store.updateMeta((m) => ({ ...m, captureDraft: '' }));
    const draft = draftFromRequest(parsed, store.settings);
    // Example mode is practice: the quote is marked SAMPLE, never uses a free quote and never feeds suggestions.
    const job = store.createJob(draft, { request: text.trim(), sample: exampleMode });
    haptic('success');
    router.replace({ pathname: '/job/[id]', params: { id: job.id } });
  };

  const found = parsed
    ? [
        ...parsed.services.map((s, i) => ({ key: `s${i}`, label: serviceLabel(s), uncertain: !notes && !!s.measure && !s.negated })),
        parsed.customer.name ? { key: 'name', label: parsed.customer.name, uncertain: !notes } : null,
        parsed.customer.address ? { key: 'addr', label: parsed.customer.address, uncertain: !notes } : null,
        parsed.customer.phone ? { key: 'phone', label: parsed.customer.phone, uncertain: false } : null,
        parsed.customer.email ? { key: 'email', label: parsed.customer.email, uncertain: false } : null,
      ].filter((x): x is { key: string; label: string; uncertain: boolean } => !!x)
    : [];

  const pasteButton = NATIVE_PASTE ? (
    <Clipboard.ClipboardPasteButton
      acceptedContentTypes={['plain-text']}
      onPress={(d) => {
        if (d.type === 'text') takePasted(d.text);
      }}
      backgroundColor={c.secondary}
      foregroundColor={c.secondaryForeground}
      cornerStyle="large"
      displayMode="iconAndLabel"
      style={{ flex: 1, height: 44 }}
      testID="capture-paste"
    />
  ) : (
    <Button size="md" variant="secondary" icon="clipboard" title="Paste" onPress={paste} flex testID="capture-paste" />
  );

  return (
    <Screen
      title={notes ? 'From your notes' : "From a customer's message"}
      back={false}
      modal
      right={<IconButton icon="x" label="Close" onPress={() => router.back()} testID="capture-close" />}
      footer={<Button title={parsed && parsed.services.length ? 'Build the quote' : 'Start the quote'} icon="zap" onPress={build} disabled={!parsed} testID="capture-build" />}
    >
      {exampleMode ? (
        <Banner
          tone="info"
          icon="file-text"
          title="Example mode"
          body="This is a made-up message. The quote it builds is marked SAMPLE and never uses a free quote."
          action={<Button size="sm" variant="outline" title="Use my own message" onPress={useOwn} testID="capture-use-own" />}
          testID="capture-example-note"
        />
      ) : null}
      {restored && !exampleMode && text === store.meta.captureDraft && text.trim() ? <Banner tone="info" icon="rotate-ccw" title="Your unfinished message is back." testID="capture-restored" /> : null}
      <Segmented options={MODES} value={mode} onChange={pickMode} testID="capture-mode" />
      <Field
        value={text}
        onChangeText={(t) => setText(t)}
        multiline
        placeholder={notes ? 'driveway 20 by 40, 250 flat\nsteps 6 at $5 a step' : 'Paste a text, email or voicemail transcript'}
        accessibilityLabel={notes ? 'Your notes' : "Customer's message"}
        maxLength={REQUEST_LIMIT}
        testID="capture-text"
        autoFocus={false}
        hint={text.length > REQUEST_LIMIT - 500 ? `${text.length.toLocaleString('en-US')} of ${LIMIT_TEXT} characters` : undefined}
      />
      {cut ? (
        <Banner tone="warn" icon="scissors" title={`Only the first ${LIMIT_TEXT} characters fit`} body="The end of the message was left out. Check it for anything else the customer asked for, and add it to the quote yourself." testID="capture-cut" />
      ) : null}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {pasteButton}
        {text ? (
          <Button
            size="md"
            variant="ghost"
            icon="x-circle"
            title="Clear"
            onPress={() => {
              setCut(false);
              setText('');
            }}
            flex
            testID="capture-clear"
          />
        ) : (
          <Button size="md" variant="ghost" icon="file-text" title="Try example" onPress={tryExample} flex testID="capture-example" />
        )}
      </View>
      {pasteError ? <Banner tone="warn" title={pasteError} /> : null}
      {!text ? (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', paddingHorizontal: 2 }}>
          <Feather name="mic" size={14} color={c.mutedForeground} />
          <T v="small" muted style={{ flex: 1 }}>
            Or tap the mic on your keyboard and say the job, like {'\u201C'}driveway about twenty by forty, two hundred fifty flat{'\u201D'}.
          </T>
        </View>
      ) : null}

      {parsed ? (
        <Animated.View entering={FadeIn.duration(250)} style={{ gap: 14 }}>
          <SectionLabel>What we found</SectionLabel>
          {found.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} testID="capture-found">
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
              <T v="small" muted style={{ flex: 1 }} testID="capture-budget">
                Budget mentioned: ${parsed.budget.amount}. Kept private and never used as the price.
              </T>
            </Card>
          ) : null}
          {parsed.questions.length ? (
            <Banner
              tone="warn"
              icon="help-circle"
              title={`${parsed.questions.length} ${parsed.questions.length === 1 ? 'thing' : 'things'} to check`}
              body={notes ? "You'll answer these on the next screen, next to your own words." : "You'll answer these on the next screen, each with the customer's exact words."}
            />
          ) : null}
          {notes ? (
            <T v="small" muted>
              Sizes count as yours. A number becomes a price only with {'\u201C'}flat{'\u201D'} or a rate like {'\u201C'}a foot{'\u201D'}, so a stray number is never priced.
            </T>
          ) : found.some((f) => f.uncertain) ? (
            <T v="small" muted>
              What the customer wrote is marked with a dashed outline until you check it.
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
            The text is never uploaded. Services, sizes, name, phone and address are picked out; anything unclear becomes a question for you.
          </T>
        </Card>
      )}
    </Screen>
  );
}
