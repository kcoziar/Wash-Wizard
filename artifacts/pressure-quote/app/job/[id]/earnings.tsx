import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { CostRow, TimeRow } from '@/components/job';
import { Banner, Button, Card, Chip, EmptyState, Field, HeroCard, Screen, SectionLabel, Segmented, T } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { COST_KEYS, COST_LABELS, TIME_KEYS, TIME_LABELS, derivedWorkMinutes, suggestWorkMinutes } from '@/lib/economics';
import { duration, money, percent } from '@/lib/format';
import { useJob, useStore } from '@/lib/store';
import { useJobCalc } from '@/lib/useQuote';
import type { CostEntry, CostKey, Draft, InputState, TimeKey } from '@/lib/types';

const QUICK_MINUTES = [45, 60, 90, 120, 180, 240];

export default function EarningsScreen() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useStore();
  const job = useJob(id);
  const { calc, econ } = useJobCalc(job, store.settings);
  const [editCosts, setEditCosts] = useState(false);
  const [saved, setSaved] = useState<'parts' | 'total' | null>(null);
  const suggestion = useMemo(() => (job ? suggestWorkMinutes(store.jobs, job.draft, job.id) : null), [store.jobs, job]);

  if (!store.ready) return <View style={{ flex: 1, backgroundColor: c.background }} />;
  if (!job || !calc || !econ) {
    return (
      <Screen title="Your numbers">
        <EmptyState icon="inbox" title="This job is no longer here" action={<Button title="Back" onPress={() => router.back()} />} />
      </Screen>
    );
  }

  const d = job.draft;
  const setDraft = (fn: (x: Draft) => Draft) => {
    setSaved(null);
    store.updateDraft(job.id, fn);
  };
  const setPart = (k: TimeKey, state: InputState, minutes: string) => setDraft((x) => ({ ...x, visit: { ...x.visit, parts: { ...x.visit.parts, [k]: { state, minutes, source: 'operator' } } } }));
  const setCost = (k: CostKey, next: CostEntry) => setDraft((x) => ({ ...x, costs: { ...x.costs, [k]: next } }));
  const derived = derivedWorkMinutes(d, store.settings);
  const perHour = econ.availablePerHour ?? econ.revenuePerHour;
  const hours = econ.minutes != null ? econ.minutes / 60 : null;
  const needed = econ.target != null && hours != null && econ.costs != null ? Math.ceil(econ.fixedCosts + (econ.target + econ.perHourCosts) * hours) : null;

  const costSummary = (() => {
    const known = COST_KEYS.filter((k) => d.costs[k].state === 'known_value');
    if (econ.missingCosts.length === COST_KEYS.length) return 'Not set yet';
    const parts = [econ.fixedCosts > 0 ? `${money(econ.fixedCosts)} per visit` : null, econ.perHourCosts > 0 ? `${money(econ.perHourCosts)}/h` : null].filter(Boolean);
    const base = parts.length ? parts.join(' + ') : known.length ? '$0' : 'None';
    return econ.missingCosts.length ? `${base} · ${econ.missingCosts.length} not set` : base;
  })();

  // Only step-by-step times are saved as usual. One job's total depends on that job, so it is never applied to others.
  const saveUsual = () => {
    const parts = d.visit.mode === 'parts';
    store.updateSettings((s) => ({
      ...s,
      visit: parts
        ? {
            travel: { state: d.visit.parts.travel.state, minutes: d.visit.parts.travel.minutes },
            setup: { state: d.visit.parts.setup.state, minutes: d.visit.parts.setup.minutes },
            cleanup: { state: d.visit.parts.cleanup.state, minutes: d.visit.parts.cleanup.minutes },
            admin: { state: d.visit.parts.admin.state, minutes: d.visit.parts.admin.minutes },
          }
        : s.visit,
      costs: Object.fromEntries(COST_KEYS.map((k) => [k, { state: d.costs[k].state, amount: d.costs[k].amount, basis: d.costs[k].basis }])) as typeof s.costs,
      ownerTarget: { state: d.ownerTarget.state, rate: d.ownerTarget.rate },
    }));
    setSaved(parts ? 'parts' : 'total');
  };

  return (
    <Screen title="Is it worth it?" subtitle="Private to you. Never on the quote." footer={<Button title="Done" onPress={() => router.back()} testID="earnings-done" />}>
      <HeroCard style={{ gap: 14 }}>
        <T v="label" color={c.heroMuted}>
          What you make for your time
        </T>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
          <T v="display" color={c.heroForeground} testID="earnings-per-hour">
            {perHour != null ? money(Math.round(perHour), { noCents: true }) : '\u2014'}
          </T>
          {perHour != null ? (
            <T v="h2" color={c.heroMuted} style={{ marginBottom: 6 }}>
              /hour
            </T>
          ) : null}
        </View>
        <T v="small" color={c.heroMuted}>
          {econ.availablePerHour != null
            ? 'After your costs, across the whole visit'
            : econ.revenuePerHour != null
              ? 'Before costs. Add your costs to see what is really left.'
              : 'Add how long the whole visit takes, including travel and setup.'}
        </T>
        {econ.verdict !== 'unknown' ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Feather name={econ.verdict === 'meets' ? 'check-circle' : 'alert-triangle'} size={16} color={econ.verdict === 'meets' ? c.accent : c.heroWarn} />
            <T v="smallStrong" color={econ.verdict === 'meets' ? c.accent : c.heroWarn} testID="earnings-verdict">
              {econ.verdict === 'meets' ? `Meets your ${money(econ.target ?? 0, { noCents: true })}/h target` : `Below your ${money(econ.target ?? 0, { noCents: true })}/h target`}
            </T>
          </View>
        ) : null}
        <View style={{ height: 1, backgroundColor: c.heroLine }} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 12 }}>
          {[
            { k: 'Quote before tax', v: money(econ.revenue) },
            { k: 'Whole visit', v: econ.minutes != null ? duration(econ.minutes) : 'Not set' },
            { k: 'Costs', v: econ.costs != null ? money(econ.costs) : 'Not set' },
            { k: 'Left for you', v: econ.available != null ? money(econ.available) : '\u2014' },
          ].map((x) => (
            <View key={x.k} style={{ width: '50%', gap: 2 }}>
              <T v="small" color={c.heroMuted}>
                {x.k}
              </T>
              <T v="num" color={c.heroForeground}>
                {x.v}
              </T>
            </View>
          ))}
        </View>
        {econ.margin != null ? (
          <T v="small" color={c.heroMuted}>
            {percent(econ.margin, 0)} of the price is left after costs and your target pay.
          </T>
        ) : null}
      </HeroCard>

      {econ.verdict === 'below' && needed != null ? (
        <Card tone="uncertain" style={{ gap: 8 }} testID="earnings-needed">
          <T v="bodyStrong">To reach your target</T>
          <T v="body">
            Quote about {money(needed)} before tax for {duration(econ.minutes)} of work
            {econ.supportedMinutes != null && econ.supportedMinutes > 0 ? `, or plan to finish the whole visit within ${duration(econ.supportedMinutes)} at this price.` : '.'}
          </T>
          <Button size="md" variant="outline" title="Adjust the quote" onPress={() => router.back()} />
        </Card>
      ) : null}

      <SectionLabel>Whole visit time</SectionLabel>
      <Segmented
        testID="visit-mode"
        options={[
          { value: 'total', label: 'One total' },
          { value: 'parts', label: 'Step by step' },
        ]}
        value={d.visit.mode}
        onChange={(v) => setDraft((x) => ({ ...x, visit: { ...x.visit, mode: v } }))}
      />
      {suggestion ? (
        <Banner
          tone="info"
          icon="trending-up"
          title={`Your last ${suggestion.count} finished ${suggestion.kind} jobs suggest about ${duration(suggestion.workMinutes)} of cleaning`}
          body={`Range ${duration(suggestion.low)} to ${duration(suggestion.high)}, scaled to this size from the cleaning times you recorded. Travel, setup and pack-up stay as you enter them.`}
          action={
            <Button
              size="sm"
              variant="outline"
              title={`Use ${duration(suggestion.workMinutes)} for cleaning`}
              onPress={() =>
                setDraft((x) => ({ ...x, visit: { ...x.visit, mode: 'parts', parts: { ...x.visit.parts, work: { state: 'known_value', minutes: String(suggestion.workMinutes), source: 'derived' } } } }))
              }
              testID="use-suggestion"
            />
          }
        />
      ) : null}
      <Card style={{ gap: 14 }}>
        {d.visit.mode === 'total' ? (
          <>
            <TimeRow
              label="From leaving to leaving"
              entry={d.visit.total}
              onChange={(state, minutes) => setDraft((x) => ({ ...x, visit: { ...x.visit, total: { state, minutes, source: 'operator' } } }))}
              testID="visit-total"
            />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {QUICK_MINUTES.map((m) => (
                <Chip
                  key={m}
                  small
                  label={duration(m)}
                  selected={d.visit.total.state === 'known_value' && d.visit.total.minutes === String(m)}
                  onPress={() => setDraft((x) => ({ ...x, visit: { ...x.visit, total: { state: 'known_value', minutes: String(m), source: 'operator' } } }))}
                />
              ))}
            </View>
          </>
        ) : (
          TIME_KEYS.map((k) => (
            <TimeRow
              key={k}
              label={TIME_LABELS[k]}
              entry={d.visit.parts[k]}
              onChange={(state, minutes) => setPart(k, state, minutes)}
              placeholder={k === 'work' && derived != null ? `About ${derived} from your production rates` : undefined}
              hint={k === 'work' && d.visit.parts.work.state === 'unknown' ? (derived != null ? 'Estimated from your production rates. Type to override.' : 'Add production rates in Settings to estimate this.') : undefined}
              testID={`visit-${k}`}
            />
          ))
        )}
        {econ.missingTime.length && d.visit.mode === 'parts' ? (
          <T v="small" color={c.uncertain}>
            Not set: {econ.missingTime.join(', ').toLowerCase()}. Use None for steps that don't apply.
          </T>
        ) : null}
      </Card>

      <SectionLabel>Costs for this visit</SectionLabel>
      <Card style={{ gap: 14 }}>
        <Pressable onPress={() => setEditCosts((v) => !v)} accessibilityRole="button" testID="toggle-costs" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <T v="bodyStrong">{costSummary}</T>
            <T v="small" muted>
              Chemicals, fuel, help, equipment wear
            </T>
          </View>
          <Feather name={editCosts ? 'chevron-up' : 'chevron-down'} size={18} color={c.mutedForeground} />
        </Pressable>
        {editCosts ? COST_KEYS.map((k) => <CostRow key={k} label={COST_LABELS[k]} entry={d.costs[k]} onChange={(next) => setCost(k, { ...next, source: 'operator' })} testID={`cost-${k}`} />) : null}
      </Card>

      <SectionLabel>Your target pay</SectionLabel>
      <Card style={{ gap: 8 }}>
        <Field
          label="What your own time should earn"
          value={d.ownerTarget.state === 'known_value' ? d.ownerTarget.rate : ''}
          onChangeText={(t) => setDraft((x) => ({ ...x, ownerTarget: { state: t ? 'known_value' : 'unknown', rate: t, source: 'operator' } }))}
          prefix="$"
          suffix="per hour"
          decimal
          maxDecimals={2}
          placeholder="Not set"
          testID="owner-target"
        />
      </Card>

      {saved ? (
        <Banner
          tone="success"
          title="Saved as your usual"
          body={
            saved === 'parts'
              ? 'New jobs start with these travel, setup, pack-up and admin times, these costs and this target. Cleaning time is set per job.'
              : 'New jobs start with these costs and this target. A one-total time is not saved, because it depends on the job. Use Step by step to save travel and setup times.'
          }
        />
      ) : null}
      <Button variant="outline" icon="bookmark" title={d.visit.mode === 'parts' ? 'Use these as my usual' : 'Use these costs and target as my usual'} onPress={saveUsual} testID="earnings-save-usual" />
    </Screen>
  );
}
