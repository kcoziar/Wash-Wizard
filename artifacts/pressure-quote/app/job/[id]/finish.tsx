import React, { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Button, Card, Chip, EmptyState, Field, HeroCard, Screen, SectionLabel, Segmented, T, ToggleRow, haptic } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { parseMoneyCents, parseNonNeg } from '@/lib/decimal';
import { centsToInput, duration, money } from '@/lib/format';
import { useJob, useStore } from '@/lib/store';
import { latestRevision } from '@/lib/useQuote';
import type { Outcome } from '@/lib/types';

const QUICK = [60, 90, 120, 150, 180, 240];

export default function FinishScreen() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useStore();
  const job = useJob(id);
  const latest = latestRevision(job);
  const prior = job?.outcome ?? null;

  const [minutes, setMinutes] = useState(prior?.minutes.state === 'known_value' ? prior.minutes.minutes : '');
  const [work, setWork] = useState(prior?.workMinutes.state === 'known_value' ? prior.workMinutes.minutes : '');
  const [priceMode, setPriceMode] = useState<'quoted' | 'different'>(prior?.finalPrice.state === 'known_value' ? 'different' : 'quoted');
  const [price, setPrice] = useState(prior?.finalPrice.state === 'known_value' ? prior.finalPrice.amount : '');
  const [costMode, setCostMode] = useState<'planned' | 'different'>(prior?.costs.state === 'known_value' ? 'different' : 'planned');
  const [costs, setCosts] = useState(prior?.costs.state === 'known_value' ? prior.costs.amount : '');
  const [note, setNote] = useState(prior?.note ?? '');
  const [useIt, setUseIt] = useState(job?.useForSuggestions ?? true);
  const [done, setDone] = useState<{ perHour: number | null; planned: number | null } | null>(null);

  if (!store.ready) return <View style={{ flex: 1, backgroundColor: c.background }} />;
  if (!job || !latest) {
    return (
      <Screen title="Finish job">
        <EmptyState icon="inbox" title="Create the quote first" body="A recap compares the finished job with its quote." action={<Button title="Back" onPress={() => router.back()} />} />
      </Screen>
    );
  }

  const quotedRevenue = latest.economics.revenue;
  const plannedCosts = latest.economics.costs;
  const minutesN = parseNonNeg(minutes)?.toNumber() ?? null;
  const priceCents = priceMode === 'different' ? parseMoneyCents(price) : quotedRevenue;
  const costCents = costMode === 'different' ? parseMoneyCents(costs) : plannedCosts;
  const priceError = priceMode === 'different' && price && priceCents == null ? 'Enter a dollar amount' : null;
  const costError = costMode === 'different' && costs && costCents == null ? 'Enter a dollar amount' : null;

  const save = () => {
    const outcome: Outcome = {
      completedAt: Date.now(),
      minutes: { state: minutes ? 'known_value' : 'unknown', minutes, source: 'operator' },
      workMinutes: { state: work ? 'known_value' : 'unknown', minutes: work, source: 'operator' },
      finalPrice: priceMode === 'different' && price ? { state: 'known_value', amount: price } : { state: 'unknown', amount: '' },
      costs: costMode === 'different' && costs ? { state: 'known_value', amount: costs } : { state: 'unknown', amount: '' },
      changed: (priceMode === 'different' && !!price) || (costMode === 'different' && !!costs),
      note: note.trim(),
    };
    store.updateJob(job.id, (j) => ({ ...j, status: 'completed', outcome, useForSuggestions: useIt }));
    store.noteMeaningful();
    haptic('success');
    const perHour = minutesN && priceCents != null && costCents != null ? (priceCents - costCents) / (minutesN / 60) : minutesN && priceCents != null ? priceCents / (minutesN / 60) : null;
    setDone({ perHour, planned: latest.economics.availablePerHour ?? latest.economics.revenuePerHour });
  };

  if (done) {
    return (
      <Screen title="Job recap" subtitle={latest.reference} back={false} footer={<Button title="Done" onPress={() => router.back()} testID="finish-close" />}>
        <Animated.View entering={FadeInDown.duration(380)}>
          <HeroCard style={{ gap: 12 }}>
            <T v="label" color={c.heroMuted}>
              You made
            </T>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
              <T v="display" color={c.heroForeground} testID="finish-per-hour">
                {done.perHour != null ? money(Math.round(done.perHour), { noCents: true }) : '\u2014'}
              </T>
              {done.perHour != null ? (
                <T v="h2" color={c.heroMuted} style={{ marginBottom: 6 }}>
                  /hour
                </T>
              ) : null}
            </View>
            <T v="small" color={c.heroMuted}>
              {done.perHour == null
                ? 'Add the visit time next time to see your real hourly.'
                : done.planned != null
                  ? `You planned about ${money(Math.round(done.planned), { noCents: true })}/h when you quoted it.`
                  : 'Saved with this job.'}
            </T>
          </HeroCard>
        </Animated.View>
        <Card tone="alt">
          <T v="body" muted>
            {useIt ? 'After five finished jobs like this, new quotes suggest a visit time from your own history.' : 'This job is not used for time suggestions.'}
          </T>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen title="Job done" subtitle={`${latest.reference} · ${money(latest.doc.total)}`} footer={<Button title="Save recap" icon="check" onPress={save} disabled={!!priceError || !!costError} testID="finish-save" />}>
      <SectionLabel>How long did the whole visit take?</SectionLabel>
      <Card style={{ gap: 12 }}>
        <Field
          value={minutes}
          onChangeText={setMinutes}
          decimal
          maxDecimals={0}
          suffix="min"
          placeholder={latest.economics.minutes != null ? `Planned ${duration(latest.economics.minutes)}` : 'Travel, setup, cleaning, pack up'}
          hint={minutesN ? duration(minutesN) : 'Include travel and setup. Leave blank if you are not sure.'}
          testID="finish-minutes"
          big
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {QUICK.map((m) => (
            <Chip key={m} small label={duration(m)} selected={minutes === String(m)} onPress={() => setMinutes(String(m))} />
          ))}
        </View>
        <Field label="Cleaning time only (optional)" value={work} onChangeText={setWork} decimal maxDecimals={0} suffix="min" placeholder="Not set" testID="finish-work" />
      </Card>

      <SectionLabel>Price before tax</SectionLabel>
      <Card style={{ gap: 10 }}>
        <Segmented
          options={[
            { value: 'quoted', label: `As quoted, ${money(quotedRevenue)}` },
            { value: 'different', label: 'Different' },
          ]}
          value={priceMode}
          onChange={(v) => {
            setPriceMode(v);
            if (v === 'different' && !price) setPrice(centsToInput(quotedRevenue));
          }}
          testID="finish-price-mode"
        />
        {priceMode === 'different' ? <Field value={price} onChangeText={setPrice} prefix="$" decimal maxDecimals={2} error={priceError} testID="finish-price" /> : null}
      </Card>

      <SectionLabel>Costs</SectionLabel>
      <Card style={{ gap: 10 }}>
        <Segmented
          options={[
            { value: 'planned', label: plannedCosts != null ? `As planned, ${money(plannedCosts)}` : 'As planned' },
            { value: 'different', label: 'Different' },
          ]}
          value={costMode}
          onChange={(v) => {
            setCostMode(v);
            if (v === 'different' && !costs && plannedCosts != null) setCosts(centsToInput(plannedCosts));
          }}
          testID="finish-cost-mode"
        />
        {costMode === 'different' ? <Field value={costs} onChangeText={setCosts} prefix="$" decimal maxDecimals={2} error={costError} testID="finish-costs" /> : null}
        {costMode === 'planned' && plannedCosts == null ? (
          <T v="small" muted>
            No costs were set on the quote, so the recap shows what you made before costs.
          </T>
        ) : null}
      </Card>

      <SectionLabel>Private note</SectionLabel>
      <Card style={{ gap: 8 }}>
        <Field value={note} onChangeText={setNote} multiline placeholder="Heavier oil stains than expected, customer wants the back patio next spring..." maxLength={800} testID="finish-note" />
        <ToggleRow title="Use for time suggestions" subtitle="Helps estimate future visits from your own jobs" value={useIt} onChange={setUseIt} testID="finish-use" />
      </Card>
    </Screen>
  );
}
