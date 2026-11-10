import React, { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { PartsEditor } from '@/components/job';
import { Banner, Button, Card, EmptyState, Field, Screen, SectionLabel, Segmented, Sheet, T, ToggleRow } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { parseNonNeg } from '@/lib/decimal';
import { unitFor } from '@/lib/defaults';
import { convertQuantity, convertRate } from '@/lib/geometry';
import { makeId, money, moneyRate, number, perUnitLabel, unitLabel } from '@/lib/format';
import { lineAmount } from '@/lib/pricing';
import { useJob, useStore } from '@/lib/store';
import type { Line, Part, QuantityType, Unit } from '@/lib/types';

const QTY_TYPES: { value: QuantityType; label: string }[] = [
  { value: 'area', label: 'Area' },
  { value: 'each', label: 'Count' },
  { value: 'linear', label: 'Length' },
  { value: 'hours', label: 'Hours' },
  { value: 'flat', label: 'Flat' },
];

function conv(text: string, from: Unit, to: Unit, dp: number): string {
  const d = parseNonNeg(text);
  if (!d) return text;
  return convertQuantity(d, from, to).round(dp).toString();
}

/** Switches area/length units on a line while keeping the same amount as closely as the new units allow. */
function switchUnit(line: Line, to: Unit): Line {
  const from = line.unit;
  if (from === to) return line;
  const lenFrom: Unit = from === 'sqm' ? 'm' : 'ft';
  const lenTo: Unit = to === 'sqm' ? 'm' : 'ft';
  const rate = parseNonNeg(line.rate);
  const parts: Part[] = line.parts.map((p) =>
    p.shape === 'value' ? { ...p, a: conv(p.a, from, to, 2) } : { ...p, a: conv(p.a, lenFrom, lenTo, 2), b: conv(p.b, lenFrom, lenTo, 2) },
  );
  return {
    ...line,
    unit: to,
    qty: conv(line.qty, from, to, 2),
    parts: line.qtyType === 'area' ? parts : line.parts,
    rate: rate ? convertRate(rate, from, to).toString() : line.rate,
  };
}

export default function LineScreen() {
  const c = useColors();
  const { id, lineId } = useLocalSearchParams<{ id: string; lineId: string }>();
  const store = useStore();
  const job = useJob(id);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const line = job?.draft.lines.find((l) => l.id === lineId);

  if (!store.ready) return <View style={{ flex: 1, backgroundColor: c.background }} />;
  if (!job || !line) {
    return (
      <Screen title="Service">
        <EmptyState icon="slash" title="This service was removed" action={<Button title="Back" onPress={() => router.back()} />} />
      </Screen>
    );
  }

  const set = (patch: Partial<Line>) => store.updateDraft(job.id, (d) => ({ ...d, lines: d.lines.map((l) => (l.id === line.id ? { ...l, ...patch } : l)) }));
  const setWhole = (next: Line) => store.updateDraft(job.id, (d) => ({ ...d, lines: d.lines.map((l) => (l.id === line.id ? next : l)) }));
  const amount = lineAmount(line);
  const isArea = line.qtyType === 'area';
  const customerQty = line.qtySource === 'customer' && line.qtyType !== 'flat';

  return (
    <Screen
      title={line.name || 'Service'}
      subtitle={line.treatment === 'priced' ? (amount.amount != null ? money(amount.amount) : 'Not priced yet') : line.treatment === 'free' ? 'Included at no charge' : 'Not included'}
      footer={<Button title="Done" onPress={() => router.back()} testID="line-done" />}
    >
      <Card style={{ gap: 12 }}>
        <Field label="Service name" value={line.name} onChangeText={(t) => set({ name: t })} autoCapitalize="words" testID="line-name" maxLength={80} />
        <Field label="What's included (shown to the customer)" value={line.detail} onChangeText={(t) => set({ detail: t })} placeholder="e.g. Surface clean and rinse" multiline testID="line-detail" maxLength={300} />
      </Card>

      <SectionLabel>On this quote</SectionLabel>
      <Segmented
        testID="line-treatment"
        options={[
          { value: 'priced', label: 'Priced' },
          { value: 'free', label: 'Included free' },
          { value: 'excluded', label: 'Not included' },
        ]}
        value={line.treatment}
        onChange={(v) => set({ treatment: v })}
      />

      {line.treatment !== 'excluded' ? (
        <>
          <SectionLabel>Priced by</SectionLabel>
          <Segmented
            compact
            testID="line-qtytype"
            options={QTY_TYPES}
            value={line.qtyType}
            onChange={(v) => set({ qtyType: v, unit: unitFor(v, store.settings.units), qtyMode: 'direct', eachLabel: v === 'each' ? line.eachLabel || 'items' : line.eachLabel })}
          />
          {line.qtyType === 'area' || line.qtyType === 'linear' ? (
            <Segmented
              compact
              testID="line-unit"
              options={
                line.qtyType === 'area'
                  ? [
                      { value: 'sqft', label: 'Square feet' },
                      { value: 'sqm', label: 'Square meters' },
                    ]
                  : [
                      { value: 'ft', label: 'Feet' },
                      { value: 'm', label: 'Meters' },
                    ]
              }
              value={line.unit}
              onChange={(v) => setWhole(switchUnit(line, v as Unit))}
            />
          ) : null}

          {line.qtyType === 'each' ? <Field label="What are you counting?" value={line.eachLabel} onChangeText={(t) => set({ eachLabel: t })} placeholder="steps, panels, posts..." maxLength={30} /> : null}

          {line.qtyType !== 'flat' ? (
            <Card style={{ gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <T v="bodyStrong">Size</T>
                {isArea ? (
                  <View style={{ width: 200 }}>
                    <Segmented
                      compact
                      testID="line-qtymode"
                      options={[
                        { value: 'direct', label: 'Total' },
                        { value: 'parts', label: 'Measure' },
                      ]}
                      value={line.qtyMode}
                      onChange={(v) => set({ qtyMode: v, qtySource: 'operator', parts: v === 'parts' && line.parts.length === 0 ? [{ id: makeId('p'), shape: 'rect', a: '', b: '', subtract: false, label: '' }] : line.parts })}
                    />
                  </View>
                ) : null}
              </View>
              {isArea && line.qtyMode === 'parts' ? (
                <PartsEditor parts={line.parts} unit={line.unit} onChange={(parts) => set({ parts, qtySource: 'operator' })} testID="line-parts" />
              ) : (
                <Field value={line.qty} onChangeText={(t) => set({ qty: t, qtySource: 'operator' })} decimal suffix={unitLabel(line.unit, line.eachLabel)} placeholder="0" big testID="line-qty" tone={customerQty ? 'uncertain' : undefined} />
              )}
              {customerQty ? (
                <Banner
                  tone="warn"
                  icon="message-circle"
                  title="This size came from the customer"
                  body="Edit it, measure it, or confirm it if it looks right."
                  action={<Button size="sm" variant="outline" title="It looks right" onPress={() => set({ qtySource: 'confirmed' })} testID="line-confirm-qty" />}
                />
              ) : null}
            </Card>
          ) : null}

          {line.treatment === 'priced' ? (
            <Card style={{ gap: 10 }}>
              {line.qtyType === 'flat' ? (
                <Field label="Price" value={line.price} onChangeText={(t) => set({ price: t })} prefix="$" decimal maxDecimals={2} placeholder="0.00" big testID="line-price" />
              ) : (
                <Field
                  label={`Your rate ${perUnitLabel(line.unit, line.eachLabel)}`}
                  value={line.rate}
                  onChangeText={(t) => set({ rate: t, rateSource: 'entered' })}
                  prefix="$"
                  decimal
                  maxDecimals={4}
                  placeholder="0.00"
                  big
                  testID="line-rate"
                  hint={line.rateSource === 'saved' ? 'Your saved rate' : line.rateSource === 'sample' ? 'Sample rate, not yours' : undefined}
                />
              )}
              {amount.amount != null ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 2 }}>
                  <T v="body" muted>
                    {line.qtyType === 'flat' ? 'Line total' : `${number(amount.qty)} ${unitLabel(line.unit, line.eachLabel)} \u00D7 ${moneyRate(line.rate)}`}
                  </T>
                  <T v="num">{money(amount.amount)}</T>
                </View>
              ) : amount.issue ? (
                <T v="small" color={c.uncertain}>
                  {amount.issue}
                </T>
              ) : null}
            </Card>
          ) : null}

          {line.treatment === 'priced' ? (
            <Card style={{ paddingVertical: 4 }}>
              <ToggleRow title="Charge tax on this" value={line.taxable} onChange={(v) => set({ taxable: v })} testID="line-taxable" />
              <ToggleRow title="Discounts apply" value={line.discountable} onChange={(v) => set({ discountable: v })} testID="line-discountable" />
            </Card>
          ) : null}
        </>
      ) : (
        <Card tone="alt">
          <T v="body" muted>
            Listed under "Not included" on the quote so the customer knows it is not part of this price.
          </T>
        </Card>
      )}

      <Button variant="danger" icon="trash-2" title="Remove from quote" onPress={() => setConfirmRemove(true)} testID="line-remove" />

      <Sheet
        visible={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        title={`Remove ${line.name || 'this service'}?`}
        body="You can add it again any time."
        actions={
          <>
            <Button
              variant="danger"
              title="Remove"
              onPress={() => {
                setConfirmRemove(false);
                store.updateDraft(job.id, (d) => ({ ...d, lines: d.lines.filter((l) => l.id !== line.id) }));
                router.back();
              }}
              testID="line-remove-confirm"
            />
            <Button variant="ghost" title="Keep it" onPress={() => setConfirmRemove(false)} />
          </>
        }
      />
    </Screen>
  );
}
