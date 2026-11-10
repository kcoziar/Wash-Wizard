import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { JobRow } from '@/components/job';
import { Banner, Button, Card, Chip, HeroCard, IconButton, Screen, SectionLabel, T, haptic } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { RATED_KINDS, newDraft, sampleDraft } from '@/lib/defaults';
import { useSubscription } from '@/lib/revenuecat';
import { useStore } from '@/lib/store';
import { FREE_QUOTES, type ServiceKind } from '@/lib/types';

const PICKS: { kind: ServiceKind; label: string; icon: React.ComponentProps<typeof Chip>['mci'] }[] = [
  { kind: 'driveway', label: 'Driveway', icon: 'road-variant' },
  { kind: 'walkway', label: 'Walkway', icon: 'walk' },
  { kind: 'patio', label: 'Patio', icon: 'view-grid-outline' },
  { kind: 'stairs', label: 'Stairs', icon: 'stairs' },
  { kind: 'custom', label: 'Other', icon: 'plus-circle-outline' },
];

export default function HomeScreen() {
  const c = useColors();
  const store = useStore();
  const sub = useSubscription();
  const [picked, setPicked] = useState<ServiceKind[]>([]);

  const drafts = useMemo(() => store.jobs.filter((j) => j.status === 'draft' && !j.sample).slice(0, 3), [store.jobs]);
  const recent = useMemo(() => store.jobs.filter((j) => j.status !== 'draft' && !j.sample).slice(0, 3), [store.jobs]);
  const sample = useMemo(() => store.jobs.find((j) => j.sample), [store.jobs]);
  const ratesSet = RATED_KINDS.some((k) => store.settings.rates[k].rate.trim() !== '');
  const remaining = Math.max(0, FREE_QUOTES - store.freeUsed);
  const realJobs = store.jobs.filter((j) => !j.sample).length;

  const toggle = (k: ServiceKind) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));

  const start = () => {
    const job = store.createJob(newDraft(store.settings, picked));
    setPicked([]);
    haptic('success');
    router.push({ pathname: '/job/[id]', params: { id: job.id } });
  };

  const openSample = () => {
    const job = sample ?? store.createJob(sampleDraft(store.settings), { sample: true });
    router.push({ pathname: '/job/[id]/preview', params: { id: job.id, from: 'home' } });
  };

  const badge = sub.isPro ? (
    <Chip small tone="confirm" icon="star" label="Pro" onPress={() => router.push('/settings')} testID="home-pro-badge" />
  ) : sub.status === 'checking' ? null : (
    <Chip small label={remaining > 0 ? `${remaining} free ${remaining === 1 ? 'quote' : 'quotes'} left` : 'See Pro'} icon={remaining > 0 ? undefined : 'star'} onPress={() => router.push('/paywall')} testID="home-free-badge" />
  );

  if (!store.ready) return <View style={{ flex: 1, backgroundColor: c.background }} />;

  return (
    <Screen title="New quote" subtitle="Tap what you're cleaning. The math is on us." large back={false} tab right={badge}>
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
            {PICKS.map((p) => (
              <Chip key={p.kind} tone="hero" mci={p.icon} label={p.label} selected={picked.includes(p.kind)} onPress={() => toggle(p.kind)} testID={`pick-${p.kind}`} />
            ))}
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
            <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="message-square" size={18} color={c.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <T v="bodyStrong" color={c.heroForeground}>
                Paste a customer's message
              </T>
              <T v="small" color={c.heroMuted}>
                Services, sizes and contact details are pulled out for you
              </T>
            </View>
            <Feather name="chevron-right" size={18} color={c.heroMuted} />
          </Pressable>
        </HeroCard>
      </Animated.View>

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
            <JobRow key={j.id} job={j} onPress={() => router.push({ pathname: '/job/[id]', params: { id: j.id } })} />
          ))}
        </>
      ) : null}

      {realJobs === 0 || sample ? (
        <Card onPress={openSample} testID="open-sample">
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: c.uncertainSoft, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: c.uncertainBorder }}>
              <Feather name="file-text" size={18} color={c.uncertain} />
            </View>
            <View style={{ flex: 1 }}>
              <T v="bodyStrong">See a finished sample quote</T>
              <T v="small" muted>
                Marked SAMPLE. Never uses a free quote.
              </T>
            </View>
            <Feather name="chevron-right" size={18} color={c.faint} />
          </View>
        </Card>
      ) : null}
    </Screen>
  );
}
