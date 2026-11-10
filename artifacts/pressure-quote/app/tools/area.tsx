import React, { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { PartsEditor } from '@/components/job';
import { Button, Card, Chip, Screen, SectionLabel, Segmented, SERVICE_ICON, T, haptic } from '@/components/ui';
import { parseNonNeg } from '@/lib/decimal';
import { RATED_KINDS, SERVICE_META, newDraft, newLine } from '@/lib/defaults';
import { makeId, number } from '@/lib/format';
import { convertRate, partsTotal } from '@/lib/geometry';
import { useStore } from '@/lib/store';
import type { Part, RatedKind } from '@/lib/types';

const blank = (): Part => ({ id: makeId('p'), shape: 'rect', a: '', b: '', subtract: false, label: '' });

export default function AreaTool() {
  const store = useStore();
  const [unit, setUnit] = useState<'sqft' | 'sqm'>(store.settings.units === 'metric' ? 'sqm' : 'sqft');
  const [parts, setParts] = useState<Part[]>(() => [blank()]);
  const [kind, setKind] = useState<RatedKind | null>(null);
  const result = partsTotal(parts);
  const areaKinds = RATED_KINDS.filter((k) => store.settings.rates[k].qtyType === 'area');

  const startQuote = () => {
    if (!result.total || !kind) return;
    const s = store.settings;
    const line = newLine(kind, s);
    if (line.unit !== unit) {
      const r = parseNonNeg(line.rate);
      if (r) line.rate = convertRate(r, line.unit, unit).toString();
      line.unit = unit;
    }
    line.qtyMode = 'parts';
    line.parts = parts.map((p) => ({ ...p, id: makeId('p') }));
    const draft = newDraft(s);
    draft.lines = [line];
    const job = store.createJob(draft);
    haptic('success');
    router.replace({ pathname: '/job/[id]', params: { id: job.id } });
  };

  return (
    <Screen
      title="Area calculator"
      subtitle="Shapes add up; cut-outs come off"
      footer={
        result.total && areaKinds.length ? (
          <Button title={kind ? `Quote this ${SERVICE_META[kind].name.toLowerCase()}` : 'Pick a service to quote it'} icon="zap" disabled={!kind} onPress={startQuote} testID="area-start-quote" />
        ) : undefined
      }
    >
      <Segmented
        options={[
          { value: 'sqft', label: 'Feet' },
          { value: 'sqm', label: 'Meters' },
        ]}
        value={unit}
        onChange={setUnit}
        testID="area-unit"
      />
      <Card>
        <PartsEditor parts={parts} onChange={setParts} unit={unit} testID="area-parts" />
      </Card>
      {result.total && areaKinds.length ? (
        <>
          <SectionLabel>Use it on a quote</SectionLabel>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {areaKinds.map((k) => (
              <Chip key={k} label={SERVICE_META[k].name} mci={SERVICE_ICON[k]} selected={kind === k} onPress={() => setKind(k)} testID={`area-kind-${k}`} />
            ))}
          </View>
          <T v="small" muted>
            Starts a new draft with {number(result.total)} {unit === 'sqm' ? 'm\u00B2' : 'sq ft'} and every shape kept, so you can adjust it later.
          </T>
        </>
      ) : (
        <T v="small" muted style={{ paddingHorizontal: 4 }}>
          Measure each part of an odd-shaped area as a rectangle or triangle. Subtract planters, pads or anything you will not clean.
        </T>
      )}
    </Screen>
  );
}
