import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router, useFocusEffect } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { JobRow, NoticeCard, OfferCard } from '@/components/job';
import { Banner, Button, Card, Chip, HeroCard, IconButton, Screen, SectionLabel, SERVICE_ICON, T, haptic } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { track } from '@/lib/analytics';
import { RATED_KINDS, SERVICE_META, newDraft, shownKinds } from '@/lib/defaults';
import { exampleDraft, isExampleJob, EXAMPLE_MESSAGE } from '@/lib/example';
import { REQUEST_LIMIT, draftFromRequest, parseRequest } from '@/lib/parser';
import { backupDue, markBackup, quotesCreated } from '@/lib/reminders';
import { useSubscription } from '@/lib/revenuecat';
import { useStore } from '@/lib/store';
import { FREE_QUOTES, type ServiceKind } from '@/lib/types';

/** The iPhone's own Paste control reads the clipboard only when tapped, without the "Allow Paste" prompt. */
const NATIVE_PASTE = Platform.OS === 'ios' && Clipboard.isPasteButtonAvailable;


export default function HomeScreen() {
  const c = useColors();
  const store = useStore();
  const sub = useSubscription();
  const [picked, setPicked] = useState<ServiceKind[]>([]);
  const [showMore, setShowMore] = useState(false);

  const drafts = useMemo(() => store.jobs.filter((j) => j.status === 'draft' && !j.sample).slice(0, 3), [store.jobs]);
  const recent = useMemo(() => store.jobs.filter((j) => j.status !== 'draft' && !j.sample).slice(0, 3), [store.jobs]);
  const example = useMemo(() => store.jobs.find(isExampleJob), [store.jobs]);
  const kinds = shownKinds(store.settings);
  // A service picked from "More" stays visible until the quote starts.
  const pickKinds: ServiceKind[] = [...kinds.first, ...kinds.more.filter((k) => showMore || picked.includes(k)), 'custom'];
  const ratesSet = RATED_KINDS.some((k) => store.settings.rates[k].rate.trim() !== '');
  const remaining = Math.max(0, FREE_QUOTES - store.freeUsed);
  const realJobs = store.jobs.filter((j) => !j.sample).length;

  const created = quotesCreated(store.jobs);
  const showBackup = store.ready && backupDue(store.meta, created, Date.now());
  const showEnded = sub.status === 'expired' && store.meta.endedCardDismissedAt == null;

  const toggle = (k: ServiceKind) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));

  // A second tap while the first is still navigating must not create a second draft.
  const navigating = useRef(false);
  // Whether the clipboard holds text. This check never reads the text itself.
  const [clipHasText, setClipHasText] = useState(false);
  useFocusEffect(
    useCallback(() => {
      navigating.current = false;
      if (Platform.OS === 'web') return;
      let alive = true;
      Clipboard.hasStringAsync()
        .then((has) => alive && setClipHasText(has))
        .catch(() => alive && setClipHasText(false));
      return () => {
        alive = false;
      };
    }, []),
  );

  // First run: the short, skippable setup, shown once.
  const welcomed = useRef(false);
  useEffect(() => {
    if (!store.ready || store.loadError || store.meta.onboarded || welcomed.current) return;
    welcomed.current = true;
    router.push('/welcome');
  }, [store.ready, store.loadError, store.meta.onboarded]);

  // Pasted text is always a customer's message. With a service found, go straight to the job.
  const fromPaste = (raw: string) => {
    if (navigating.current) return;
    const text = raw.trim();
    if (!text) return;
    track('paste_used');
    navigating.current = true;
    const parsed = text.length <= REQUEST_LIMIT ? parseRequest(text, { units: store.settings.units, mode: 'customer' }) : null;
    if (parsed && parsed.services.length) {
      const job = store.createJob(draftFromRequest(parsed, store.settings), { request: text });
      haptic('success');
      router.push({ pathname: '/job/[id]', params: { id: job.id } });
    } else router.push({ pathname: '/capture', params: { text } });
  };

  const pasteFallback = async () => {
    try {
      const t = await Clipboard.getStringAsync();
      if (t.trim()) fromPaste(t);
      else router.push('/capture');
    } catch {
      router.push('/capture');
    }
  };

  const similar = (jobId: string) => {
    if (navigating.current) return;
    const job = store.similarJob(jobId);
    if (!job) return;
    navigating.current = true;
    haptic('success');
    router.push({ pathname: '/job/[id]', params: { id: job.id } });
  };

  const start = () => {
    if (navigating.current) return;
    navigating.current = true;
    const job = store.createJob(newDraft(store.settings, picked));
    setPicked([]);
    setShowMore(false);
    haptic('success');
    router.push({ pathname: '/job/[id]', params: { id: job.id } });
  };

  // A made-up message with sample sizes and rates: a complete quote in one tap, marked SAMPLE.
  const openExample = () => {
    if (navigating.current) return;
    navigating.current = true;
    const job = example ?? store.createJob(exampleDraft(store.settings), { sample: true, request: EXAMPLE_MESSAGE });
    haptic('success');
    router.push({ pathname: '/job/[id]', params: { id: job.id } });
  };

  const badge = sub.isPro ? (
    <Chip small tone="confirm" icon="star" label="Pro" onPress={() => router.push('/settings')} testID="home-pro-badge" />
  ) : sub.status === 'checking' ? null : (
    <Chip small label={`${remaining} free ${remaining === 1 ? 'quote' : 'quotes'} left`} icon={remaining > 0 ? undefined : 'star'} onPress={() => router.push({ pathname: '/paywall', params: { from: 'home' } })} testID="home-free-badge" />
  );

  if (!store.ready) return <View style={{ flex: 1, backgroundColor: c.background }} />;

  return (
    <Screen title="New quote" subtitle="For pressure washing businesses." large back={false} tab right={badge}>
      {store.issues.length ? (
        <Banner tone="warn" title="Something needs attention" body={store.issues.join(' ')} action={<Button size="sm" variant="outline" title="Dismiss" onPress={store.dismissIssues} />} />
      ) : null}

      <Animated.View entering={FadeInDown.duration(380)}>
        <HeroCard style={{ gap: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <T v="label" color={c.heroMuted}>
              What are we cleaning?
            </T>
            {picked.length ? (
              <Pressable onPress={() => setPicked([])} hitSlop={8}>
                <T v="smallStrong" color={c.heroMuted}>
                  Clear
                </T>
              </Pressable>
            ) : null}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {pickKinds.map((k) => (
              <Chip
                key={k}
                tone="hero"
                mci={k === 'custom' ? 'plus-circle-outline' : SERVICE_ICON[k]}
                label={k === 'custom' ? 'Other' : SERVICE_META[k].name}
                selected={picked.includes(k)}
                onPress={() => toggle(k)}
                testID={`pick-${k}`}
              />
            ))}
            {kinds.more.length && !showMore ? <Chip tone="hero" mci="dots-horizontal" label="More" onPress={() => setShowMore(true)} testID="pick-more" /> : null}
          </View>
          <Button variant="lime" icon="arrow-right" title={picked.length ? `Start quote · ${picked.length} ${picked.length === 1 ? 'service' : 'services'}` : 'Start a quote'} onPress={start} testID="start-quote" />
          <View style={{ height: 1, backgroundColor: c.heroLine }} />
          <Pressable
            testID="open-capture"
            accessibilityRole="button"
            onPress={() => {
              haptic();
              router.push('/capture');
            }}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, opacity: pressed ? 0.7 : 1 })}
          >
            <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: c.heroGlass, alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="message-square" size={18} color={c.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <T v="bodyStrong" color={c.heroForeground}>
                {clipHasText ? 'Copied a customer\u2019s message?' : 'Paste a customer\u2019s message'}
              </T>
              <T v="small" color={c.heroMuted}>
                {clipHasText ? 'Paste it and the quote is built from it' : 'Services, sizes and contact details are pulled out for you'}
              </T>
            </View>
            <Feather name="chevron-right" size={18} color={c.heroMuted} />
          </Pressable>
          {clipHasText ? (
            NATIVE_PASTE ? (
              <Clipboard.ClipboardPasteButton
                acceptedContentTypes={['plain-text']}
                onPress={(d) => {
                  if (d.type === 'text') fromPaste(d.text);
                }}
                backgroundColor={c.accent}
                foregroundColor={c.accentForeground}
                cornerStyle="large"
                displayMode="iconAndLabel"
                style={{ width: '100%', height: 48 }}
                testID="home-paste"
              />
            ) : (
              <Button variant="secondary" icon="clipboard" title="Paste message" onPress={pasteFallback} testID="home-paste" />
            )
          ) : null}
        </HeroCard>
      </Animated.View>

      {showEnded ? (
        <NoticeCard
          icon="info"
          title="Pro ended"
          body={`Your ${realJobs} ${realJobs === 1 ? 'job' : 'jobs'} and your rates are all still here.`}
          onOpen={() => router.push({ pathname: '/paywall', params: { from: 'home' } })}
          onDismiss={() => store.updateMeta((m) => ({ ...m, endedCardDismissedAt: Date.now() }))}
          testID="home-ended"
        />
      ) : null}

      {showBackup ? (
        <NoticeCard
          icon="download"
          title={`Back up your ${created} quotes`}
          body={store.meta.lastBackupAt ? 'Save a fresh copy to Files or iCloud Drive' : 'They live only on this iPhone. Save a copy to Files.'}
          onOpen={() => router.push('/settings/backup')}
          onDismiss={() => store.updateMeta((m) => markBackup(m, created, Date.now(), false))}
          testID="home-backup"
        />
      ) : null}

      {!sub.isPro && sub.status !== 'checking' && store.freeUsed >= 1 && remaining > 0 && !store.meta.offerCardDismissed ? (
        <OfferCard
          remaining={remaining}
          onOpen={() => router.push({ pathname: '/paywall', params: { from: 'home' } })}
          onDismiss={() => store.updateMeta((m) => ({ ...m, offerCardDismissed: true }))}
        />
      ) : null}

      {!ratesSet ? (
        <Card onPress={() => router.push('/settings/rates')} testID="home-set-rates" tone="alt">
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: c.muted, alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="sliders" size={18} color={c.foreground} />
            </View>
            <View style={{ flex: 1 }}>
              <T v="bodyStrong">Save your rates once</T>
              <T v="small" muted>
                Then every new quote prices itself the moment you add a size.
              </T>
            </View>
            <Feather name="chevron-right" size={18} color={c.faint} />
          </View>
        </Card>
      ) : null}

      {drafts.length ? (
        <>
          <SectionLabel>Pick up where you left off</SectionLabel>
          {drafts.map((j) => (
            <JobRow key={j.id} job={j} onPress={() => router.push({ pathname: '/job/[id]', params: { id: j.id } })} />
          ))}
        </>
      ) : null}

      {recent.length ? (
        <>
          <SectionLabel right={<IconButton icon="arrow-right" label="See all jobs" size={30} onPress={() => router.push('/jobs')} />}>Recent quotes</SectionLabel>
          {recent.map((j) => (
            <JobRow key={j.id} job={j} onPress={() => router.push({ pathname: '/job/[id]', params: { id: j.id } })} onSimilar={() => similar(j.id)} />
          ))}
        </>
      ) : null}

      {realJobs === 0 || example ? (
        <Card onPress={openExample} testID="open-example">
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: c.uncertainSoft, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: c.uncertainBorder }}>
              <Feather name="play" size={18} color={c.uncertain} />
            </View>
            <View style={{ flex: 1 }}>
              <T v="bodyStrong">Try it with an example message</T>
              <T v="small" muted>
                Made-up customer, sizes and rates. Marked SAMPLE. Never uses a free quote.
              </T>
            </View>
            <Feather name="chevron-right" size={18} color={c.faint} />
          </View>
        </Card>
      ) : null}
    </Screen>
  );
}
