import React from 'react';
import { View } from 'react-native';
import { Card, Field, Screen, SectionLabel, Segmented, ServiceGlyph, StatefulAmount, T, ToggleRow } from '@/components/ui';
import { parseNonNeg } from '@/lib/decimal';
import { DEFAULT_TERMS, RATED_KINDS, SERVICE_META, unitFor } from '@/lib/defaults';
import { perUnitLabel, unitLabel } from '@/lib/format';
import { convertQuantity, convertRate } from '@/lib/geometry';
import { useStore } from '@/lib/store';
import type { QuantityType, RatedKind, ServiceRate, Settings, UnitSystem } from '@/lib/types';

function convertSaved(r: ServiceRate, system: UnitSystem): ServiceRate {
  if (r.qtyType !== 'area' && r.qtyType !== 'linear') return r;
  const to = unitFor(r.qtyType, system);
  if (to === r.unit) return r;
  const rate = parseNonNeg(r.rate);
  const prod = parseNonNeg(r.production);
  return {
    ...r,
    unit: to,
    rate: rate ? convertRate(rate, r.unit, to).toString() : r.rate,
    production: prod ? convertQuantity(prod, r.unit, to).round(0).toString() : r.production,
  };
}

export default function RatesScreen() {
  const store = useStore();
  const s = store.settings;
  const set = (fn: (x: Settings) => Settings) => store.updateSettings(fn);
  const setRate = (k: RatedKind, patch: Partial<ServiceRate>) => set((x) => ({ ...x, rates: { ...x.rates, [k]: { ...x.rates[k], ...patch } } }));

  return (
    <Screen title="Rates & quote defaults" subtitle="New quotes start with these">
      <SectionLabel>Units</SectionLabel>
      <Segmented
        testID="units"
        options={[
          { value: 'imperial', label: 'Feet' },
          { value: 'metric', label: 'Meters' },
        ]}
        value={s.units}
        onChange={(v) => set((x) => ({ ...x, units: v, rates: Object.fromEntries(RATED_KINDS.map((k) => [k, convertSaved(x.rates[k], v)])) as Settings['rates'] }))}
      />

      <SectionLabel>Your rates</SectionLabel>
      {RATED_KINDS.map((k) => {
        const r = s.rates[k];
        return (
          <Card key={k} style={{ gap: 12 }} testID={`rate-${k}`}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <ServiceGlyph kind={k} />
              <T v="h3" style={{ flex: 1 }}>
                {SERVICE_META[k].name}
              </T>
            </View>
            <Segmented
              compact
              options={[
                { value: 'area', label: 'By area' },
                { value: 'linear', label: 'By length' },
                { value: 'each', label: 'By count' },
              ]}
              value={r.qtyType as 'area' | 'linear' | 'each'}
              onChange={(v: QuantityType) => setRate(k, { qtyType: v, unit: unitFor(v, s.units), rate: '', production: '', eachLabel: v === 'each' ? r.eachLabel || SERVICE_META[k].eachLabel || 'items' : r.eachLabel })}
              testID={`rate-${k}-type`}
            />
            {r.qtyType === 'each' ? <Field label="Counting" value={r.eachLabel} onChangeText={(t) => setRate(k, { eachLabel: t })} placeholder="steps" maxLength={30} /> : null}
            <Field label={`Rate ${perUnitLabel(r.unit, r.eachLabel)}`} value={r.rate} onChangeText={(t) => setRate(k, { rate: t })} prefix="$" decimal maxDecimals={4} placeholder="Not set" testID={`rate-${k}-value`} />
            <Field
              label="You clean about this much per hour (optional)"
              value={r.production}
              onChangeText={(t) => setRate(k, { production: t })}
              suffix={`${unitLabel(r.unit, r.eachLabel)}/h`}
              decimal
              maxDecimals={0}
              placeholder="Not set"
              hint="Used to estimate cleaning time for the worth-it check."
              testID={`rate-${k}-production`}
            />
            <ToggleRow title="Taxable" value={r.taxable} onChange={(v) => setRate(k, { taxable: v })} />
          </Card>
        );
      })}

      <SectionLabel>Every visit</SectionLabel>
      <Card style={{ gap: 16 }}>
        <StatefulAmount label="Job minimum" state={s.minimum.state} amount={s.minimum.amount} onChange={(state, amount) => set((x) => ({ ...x, minimum: { state, amount } }))} testID="default-minimum" />
        {s.minimum.state === 'known_value' ? <ToggleRow title="Charge tax on the minimum adjustment" value={s.minimumTaxable} onChange={(v) => set((x) => ({ ...x, minimumTaxable: v }))} /> : null}
        <StatefulAmount label="Trip charge" state={s.trip.state} amount={s.trip.amount} allowNA onChange={(state, amount) => set((x) => ({ ...x, trip: { ...x.trip, state, amount } }))} testID="default-trip" />
        {s.trip.state === 'known_value' ? <ToggleRow title="Charge tax on the trip" value={s.trip.taxable} onChange={(v) => set((x) => ({ ...x, trip: { ...x.trip, taxable: v } }))} /> : null}
      </Card>

      <SectionLabel>Tax</SectionLabel>
      <Card style={{ gap: 12 }}>
        <StatefulAmount label="Sales tax rate" state={s.tax.state} amount={s.tax.rate} prefix="" suffix="%" noneLabel="No tax" maxDecimals={4} onChange={(state, rate) => set((x) => ({ ...x, tax: { ...x.tax, state, rate } }))} testID="default-tax" />
        {s.tax.state === 'known_value' ? <Field label="Tax name on the quote" value={s.tax.label} onChangeText={(t) => set((x) => ({ ...x, tax: { ...x.tax, label: t } }))} maxLength={40} /> : null}
      </Card>

      <SectionLabel>Deposit</SectionLabel>
      <Card style={{ gap: 12 }}>
        <Segmented
          options={[
            { value: 'none', label: 'None' },
            { value: 'percent', label: '% of total' },
            { value: 'fixed', label: 'Fixed $' },
          ]}
          value={s.deposit.kind}
          onChange={(v) => set((x) => ({ ...x, deposit: { kind: v, value: '' } }))}
          testID="default-deposit"
        />
        {s.deposit.kind !== 'none' ? (
          <Field value={s.deposit.value} onChangeText={(t) => set((x) => ({ ...x, deposit: { ...x.deposit, value: t } }))} prefix={s.deposit.kind === 'fixed' ? '$' : undefined} suffix={s.deposit.kind === 'percent' ? '%' : undefined} decimal maxDecimals={2} placeholder="0" />
        ) : null}
      </Card>

      <SectionLabel>Quote wording</SectionLabel>
      <Card style={{ gap: 12 }}>
        <Field label="Quotes are valid for" value={s.validDays} onChangeText={(t) => set((x) => ({ ...x, validDays: t.replace(/[^0-9]/g, '').slice(0, 3) }))} suffix="days" keyboardType="number-pad" inputMode="numeric" />
        <Field label="Terms" value={s.terms} onChangeText={(t) => set((x) => ({ ...x, terms: t }))} multiline maxLength={2000} testID="default-terms" />
        {s.terms !== DEFAULT_TERMS ? (
          <T v="smallStrong" muted onPress={() => set((x) => ({ ...x, terms: DEFAULT_TERMS }))} accessibilityRole="button">
            Reset to the standard terms
          </T>
        ) : null}
      </Card>
    </Screen>
  );
}
