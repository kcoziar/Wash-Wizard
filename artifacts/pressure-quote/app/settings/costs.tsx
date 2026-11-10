import React from 'react';
import { CostRow, TimeRow } from '@/components/job';
import { Card, Field, Screen, SectionLabel, T } from '@/components/ui';
import { COST_KEYS, COST_LABELS, TIME_LABELS } from '@/lib/economics';
import { useStore } from '@/lib/store';
import type { Settings } from '@/lib/types';

const VISIT_KEYS: (keyof Settings['visit'])[] = ['travel', 'setup', 'cleanup', 'admin'];

export default function CostsScreen() {
  const store = useStore();
  const s = store.settings;
  const set = (fn: (x: Settings) => Settings) => store.updateSettings(fn);

  return (
    <Screen title="Time, costs & target pay" subtitle="Private. New jobs start with these.">
      <SectionLabel>Target pay</SectionLabel>
      <Card style={{ gap: 12 }}>
        <Field
          label="What your own time should earn"
          value={s.ownerTarget.state === 'known_value' ? s.ownerTarget.rate : ''}
          onChangeText={(t) => set((x) => ({ ...x, ownerTarget: { state: t ? 'known_value' : 'unknown', rate: t } }))}
          prefix="$"
          suffix="per hour"
          decimal
          maxDecimals={2}
          placeholder="Not set"
          testID="settings-owner-target"
        />
        <Field
          label="Margin you aim for (optional)"
          value={s.marginTarget.state === 'known_value' ? s.marginTarget.percent : ''}
          onChangeText={(t) => set((x) => ({ ...x, marginTarget: { state: t ? 'known_value' : 'unknown', percent: t } }))}
          suffix="%"
          decimal
          maxDecimals={1}
          placeholder="Not set"
          hint="Pre-fills the margin tool."
          testID="settings-margin-target"
        />
      </Card>

      <SectionLabel>Usual visit time</SectionLabel>
      <Card style={{ gap: 14 }}>
        <T v="small" muted>
          Cleaning time is worked out per job from your production rates or entered on the job.
        </T>
        {VISIT_KEYS.map((k) => (
          <TimeRow key={k} label={TIME_LABELS[k]} entry={s.visit[k]} onChange={(state, minutes) => set((x) => ({ ...x, visit: { ...x.visit, [k]: { state, minutes } } }))} testID={`settings-visit-${k}`} />
        ))}
      </Card>

      <SectionLabel>Usual costs</SectionLabel>
      <Card style={{ gap: 14 }}>
        {COST_KEYS.map((k) => (
          <CostRow key={k} label={COST_LABELS[k]} entry={s.costs[k]} onChange={(next) => set((x) => ({ ...x, costs: { ...x.costs, [k]: next } }))} testID={`settings-cost-${k}`} />
        ))}
      </Card>
    </Screen>
  );
}
