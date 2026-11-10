import React, { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Button, Card, Chip, Divider, EmptyState, Field, HeroCard, Screen, SectionLabel, Segmented, T, ToggleRow, haptic } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { parseMoneyCents, parseNonNeg } from '@/lib/decimal';
import { centsToInput, duration, money, shortDate } from '@/lib/format';
import { useJob, useStore } from '@/lib/store';
import { perHourLabel, recapNumbers, type RecapNumbers } from '@/lib/recap';
import { latestRevision } from '@/lib/useQuote';
import type { Outcome } from '@/lib/types';

function diffMinutes(a: number, b: number): string {
  const d = Math.round(b - a);
  if (d === 0) return 'on plan';
  return `${d > 0 ? '+' : '\u2212'}${duration(Math.abs(d))}`;
}

function CompareRow({ label, planned, actual, note, testID }: { label: string; planned: string; actual: string; note?: string | null; testID?: string }) {
  return (
    <View style={{ gap: 4, paddingVertical: 10 }} testID={testID}>
      <T v="smallStrong" muted>
        {label}
      </T>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <T v="small" muted>
            Estimated
          </T>
          <T v="num">{planned}</T>
        </View>
        <View style={{ flex: 1 }}>
          <T v="small" muted>
            Actual
          </T>
          <T v="num">{actual}</T>
        </View>
      </View>
      {note ? (
        <T v="small" muted>
          {note}
        </T>
      ) : null}
    </View>
  );
}

const perHourText = (v: number | null) => (v != null ? `${money(Math.round(v), { noCents: true })}/h` : 'Not known');

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
  // A saved recap opens as its result; Edit recap goes back to the form.
  const [editing, setEditing] = useState(!prior);

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
    store.updateJob(job.id, (j) => ({ ...j, status: 'completed', outcome: prior ? { ...outcome, completedAt: prior.completedAt } : outcome, useForSuggestions: useIt }));
    store.noteMeaningful();
    haptic('success');
    setEditing(false);
  };

  if (!editing && job.outcome) {
    const r: RecapNumbers = recapNumbers(latest.economics, job.outcome);
    const o = job.outcome;
    return (
      <Screen
        title="Job recap"
        subtitle={`${latest.reference} \u00B7 finished ${shortDate(o.completedAt)}`}
        footer={
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button title="Edit recap" variant="secondary" icon="edit-3" onPress={() => setEditing(true)} flex testID="finish-edit" />
            <Button title="Done" onPress={() => router.back()} flex testID="finish-close" />
          </View>
        }
      >
        <Animated.View entering={FadeInDown.duration(380)}>
          <HeroCard style={{ gap: 12 }}>
            <T v="label" color={c.heroMuted}>
              {perHourLabel(r.basis)}
            </T>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
              <T v="display" color={c.heroForeground} testID="finish-per-hour">
                {r.perHour != null ? money(Math.round(r.perHour), { noCents: true }) : '\u2014'}
              </T>
              {r.perHour != null ? (
                <T v="h2" color={c.heroMuted} style={{ marginBottom: 6 }}>
                  /hour
                </T>
              ) : null}
            </View>
            <T v="small" color={c.heroMuted}>
              {r.perHour == null
                ? 'Add how long the visit took to see this.'
                : r.plannedPerHour != null
                  ? `You estimated about ${money(Math.round(r.plannedPerHour), { noCents: true })}/h on the same basis when you quoted it.`
                  : r.basis === 'before_costs'
                    ? 'No costs were entered, so this is not profit or take-home pay.'
                    : 'Saved with this job.'}
            </T>
          </HeroCard>
        </Animated.View>

        <SectionLabel>Estimated vs actual</SectionLabel>
        <Card style={{ paddingVertical: 4 }} testID="finish-compare">
          <CompareRow
            label="Whole visit"
            planned={r.plannedMinutes != null ? duration(r.plannedMinutes) : 'Not set'}
            actual={r.minutes != null ? duration(r.minutes) : 'Not recorded'}
            note={r.plannedMinutes != null && r.minutes != null ? diffMinutes(r.plannedMinutes, r.minutes) : null}
            testID="compare-time"
          />
          <Divider />
          <CompareRow
            label="Price before tax"
            planned={money(r.quoted)}
            actual={money(r.price)}
            note={r.price !== r.quoted ? `${r.price > r.quoted ? '+' : '\u2212'}${money(Math.abs(r.price - r.quoted))} from the quote` : 'As quoted'}
            testID="compare-price"
          />
          <Divider />
          <CompareRow
            label="Costs"
            planned={r.plannedCosts != null ? money(r.plannedCosts) : 'Not set'}
            actual={r.costsSource === 'entered' && r.costs != null ? money(r.costs) : r.costsSource === 'planned' ? 'As planned' : 'Not entered'}
            testID="compare-costs"
          />
          <Divider />
          <CompareRow label={r.basis === 'after_costs' ? 'Per hour after costs' : 'Per hour before costs'} planned={perHourText(r.plannedPerHour)} actual={perHourText(r.perHour)} testID="compare-hourly" />
        </Card>
        {o.note ? (
          <Card tone="alt" style={{ gap: 4 }}>
            <T v="smallStrong" muted>
              Private note
            </T>
            <T v="body">{o.note}</T>
          </Card>
        ) : null}
        <Card tone="alt">
          <T v="body" muted>
            {job.useForSuggestions
              ? o.workMinutes.state === 'known_value'
                ? 'With five finished jobs like this, new quotes suggest a cleaning time from your own records.'
                : 'Add the cleaning time to use this job for suggestions on future quotes.'
              : 'This job is not used for time suggestions.'}
          </T>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen
      title={prior ? 'Edit recap' : 'Job done'}
      subtitle={`${latest.reference} · ${money(latest.doc.total)}`}
      footer={<Button title="Save recap" icon="check" onPress={save} disabled={!!priceError || !!costError} testID="finish-save" />}
    >
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
            No costs were set on the quote, so the recap shows what came in per hour before costs, not profit.
          </T>
        ) : null}
      </Card>

      <SectionLabel>Private note</SectionLabel>
      <Card style={{ gap: 8 }}>
        <Field value={note} onChangeText={setNote} multiline placeholder="Heavier oil stains than expected, customer wants the back patio next spring..." maxLength={800} testID="finish-note" />
        <ToggleRow title="Use for time suggestions" subtitle="Cleaning times you record help estimate future jobs of the same surface" value={useIt} onChange={setUseIt} testID="finish-use" />
      </Card>
    </Screen>
  );
}
