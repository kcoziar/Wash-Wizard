import React, { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Banner, Button, Card, EmptyState, Field, Screen, SectionLabel, Segmented, StatefulAmount, T, ToggleRow } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { money } from '@/lib/format';
import { useJob, useStore } from '@/lib/store';
import { useJobCalc } from '@/lib/useQuote';
import type { Pricing } from '@/lib/types';

export default function PricingScreen() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useStore();
  const job = useJob(id);
  const { calc } = useJobCalc(job, store.settings);
  const [saved, setSaved] = useState(false);

  if (!store.ready) return <View style={{ flex: 1, backgroundColor: c.background }} />;
  if (!job || !calc) {
    return (
      <Screen title="Visit pricing">
        <EmptyState icon="inbox" title="This job is no longer here" action={<Button title="Back" onPress={() => router.back()} />} />
      </Screen>
    );
  }

  const p = job.draft.pricing;
  const setP = (fn: (x: Pricing) => Pricing) => {
    setSaved(false);
    store.updateDraft(job.id, (d) => ({ ...d, pricing: fn(d.pricing) }));
  };
  const setDraft = (patch: Partial<typeof job.draft>) => {
    setSaved(false);
    store.updateDraft(job.id, (d) => ({ ...d, ...patch }));
  };

  const saveDefaults = () => {
    store.updateSettings((s) => ({
      ...s,
      minimum: { state: p.minimum.state, amount: p.minimum.amount },
      minimumTaxable: p.minimumTaxable,
      trip: { state: p.trip.state, amount: p.trip.amount, taxable: p.trip.taxable },
      tax: { state: p.tax.state, rate: p.tax.rate, label: p.tax.label },
      deposit: { ...p.deposit },
      validDays: job.draft.validDays,
      terms: job.draft.terms,
      customerNote: job.draft.customerNote,
    }));
    setSaved(true);
  };

  return (
    <Screen title="Visit pricing & terms" subtitle={calc.complete ? `Total ${money(calc.total)}` : 'Finish the services to see the total'} footer={<Button title="Done" onPress={() => router.back()} testID="pricing-done" />}>
      <SectionLabel>Job minimum</SectionLabel>
      <Card style={{ gap: 10 }}>
        <StatefulAmount
          label="Smallest job you'll do"
          state={p.minimum.state}
          amount={p.minimum.amount}
          onChange={(state, amount) => setP((x) => ({ ...x, minimum: { state, amount, source: 'operator' } }))}
          testID="pricing-minimum"
        />
        {calc.minimum.adjustment > 0 ? (
          <T v="small" muted>
            Services come to {money(calc.linesTotal)}, so the quote adds {money(calc.minimum.adjustment)} to reach your minimum.
          </T>
        ) : null}
        {p.minimum.state === 'known_value' ? <ToggleRow title="Charge tax on the minimum adjustment" value={p.minimumTaxable} onChange={(v) => setP((x) => ({ ...x, minimumTaxable: v }))} /> : null}
      </Card>

      <SectionLabel>Trip charge</SectionLabel>
      <Card style={{ gap: 10 }}>
        <StatefulAmount
          label="Once per visit"
          state={p.trip.state}
          amount={p.trip.amount}
          allowNA
          onChange={(state, amount) => setP((x) => ({ ...x, trip: { ...x.trip, state, amount, source: 'operator' } }))}
          testID="pricing-trip"
        />
        {p.trip.state === 'known_value' ? (
          <>
            <ToggleRow title="Charge tax on the trip" value={p.trip.taxable} onChange={(v) => setP((x) => ({ ...x, trip: { ...x.trip, taxable: v } }))} />
            <ToggleRow title="Discounts apply to the trip" value={p.trip.discountable} onChange={(v) => setP((x) => ({ ...x, trip: { ...x.trip, discountable: v } }))} />
          </>
        ) : null}
      </Card>

      <SectionLabel>Discount</SectionLabel>
      <Card style={{ gap: 10 }}>
        <Segmented
          testID="pricing-discount-kind"
          options={[
            { value: 'none', label: 'None' },
            { value: 'fixed', label: '$ off' },
            { value: 'percent', label: '% off' },
          ]}
          value={p.discount.kind}
          onChange={(v) => setP((x) => ({ ...x, discount: { ...x.discount, kind: v, value: '' }, minimumDecision: 'unset' }))}
        />
        {p.discount.kind !== 'none' ? (
          <>
            <Field
              value={p.discount.value}
              onChangeText={(t) => setP((x) => ({ ...x, discount: { ...x.discount, value: t }, minimumDecision: 'unset' }))}
              prefix={p.discount.kind === 'fixed' ? '$' : undefined}
              suffix={p.discount.kind === 'percent' ? '%' : undefined}
              decimal
              maxDecimals={2}
              placeholder="0"
              error={calc.discount.invalid}
              testID="pricing-discount-value"
            />
            <Field label="Shown on the quote as" value={p.discount.label} onChangeText={(t) => setP((x) => ({ ...x, discount: { ...x.discount, label: t } }))} maxLength={40} placeholder="Discount" />
            {p.minimum.state === 'known_value' ? <ToggleRow title="Discount the minimum adjustment too" value={p.discount.includeMinimum} onChange={(v) => setP((x) => ({ ...x, discount: { ...x.discount, includeMinimum: v } }))} /> : null}
            {calc.discount.applied > 0 ? (
              <T v="small" muted>
                Takes {money(calc.discount.applied)} off {money(calc.discount.eligible)} of eligible work.
              </T>
            ) : null}
          </>
        ) : null}
        {calc.discount.conflict ? (
          <Banner
            tone={p.minimumDecision === 'unset' ? 'warn' : 'info'}
            title="This discount goes below your job minimum"
            body={p.minimumDecision === 'keep' ? 'Keeping your minimum: the discount stops at the minimum.' : p.minimumDecision === 'override' ? 'Going below your minimum for this visit only.' : 'Choose which one wins for this visit.'}
            action={
              <Segmented
                compact
                testID="pricing-minimum-decision"
                options={[
                  { value: 'keep', label: 'Keep minimum' },
                  { value: 'override', label: 'Allow below' },
                ]}
                value={p.minimumDecision === 'unset' ? ('' as 'keep') : p.minimumDecision}
                onChange={(v) => setP((x) => ({ ...x, minimumDecision: v }))}
              />
            }
          />
        ) : null}
      </Card>

      <SectionLabel>Tax</SectionLabel>
      <Card style={{ gap: 10 }}>
        <StatefulAmount
          label="Sales tax rate"
          state={p.tax.state}
          amount={p.tax.rate}
          prefix=""
          suffix="%"
          noneLabel="No tax"
          maxDecimals={4}
          onChange={(state, rate) => setP((x) => ({ ...x, tax: { ...x.tax, state, rate, source: 'operator' } }))}
          testID="pricing-tax"
          hint={p.tax.state === 'unknown' ? 'Not sure means the quote shows no tax line. Check your local rules.' : undefined}
        />
        {calc.tax.invalid ? (
          <T v="small" color={c.destructive}>
            {calc.tax.invalid}
          </T>
        ) : null}
        {p.tax.state === 'known_value' ? <Field label="Tax name on the quote" value={p.tax.label} onChangeText={(t) => setP((x) => ({ ...x, tax: { ...x.tax, label: t } }))} maxLength={40} /> : null}
      </Card>

      <SectionLabel>Deposit</SectionLabel>
      <Card style={{ gap: 10 }}>
        <Segmented
          testID="pricing-deposit-kind"
          options={[
            { value: 'none', label: 'None' },
            { value: 'percent', label: '% of total' },
            { value: 'fixed', label: 'Fixed $' },
          ]}
          value={p.deposit.kind}
          onChange={(v) => setP((x) => ({ ...x, deposit: { kind: v, value: '' } }))}
        />
        {p.deposit.kind !== 'none' ? (
          <Field
            value={p.deposit.value}
            onChangeText={(t) => setP((x) => ({ ...x, deposit: { ...x.deposit, value: t } }))}
            prefix={p.deposit.kind === 'fixed' ? '$' : undefined}
            suffix={p.deposit.kind === 'percent' ? '%' : undefined}
            decimal
            maxDecimals={2}
            placeholder="0"
            error={calc.depositInvalid}
            testID="pricing-deposit-value"
            hint={calc.deposit && calc.deposit.amount > 0 ? `${money(calc.deposit.amount)} to book, ${money(calc.deposit.balance)} on completion` : undefined}
          />
        ) : null}
      </Card>

      <SectionLabel>Quote details</SectionLabel>
      <Card style={{ gap: 12 }}>
        <Field label="Valid for" value={job.draft.validDays} onChangeText={(t) => setDraft({ validDays: t.replace(/[^0-9]/g, '').slice(0, 3) })} suffix="days" keyboardType="number-pad" inputMode="numeric" testID="pricing-valid" />
        <Field label="Note to the customer" value={job.draft.customerNote} onChangeText={(t) => setDraft({ customerNote: t })} multiline placeholder="Thanks for reaching out! Happy to answer any questions." maxLength={800} testID="pricing-note" />
        <Field label="Terms" value={job.draft.terms} onChangeText={(t) => setDraft({ terms: t })} multiline maxLength={2000} testID="pricing-terms" />
        {job.draft.terms !== store.settings.terms ? <Button size="sm" variant="ghost" title="Use my default terms" onPress={() => setDraft({ terms: store.settings.terms })} /> : null}
      </Card>

      {saved ? <Banner tone="success" title="Saved as your defaults" body="New quotes start with these settings." /> : null}
      <Button variant="outline" icon="bookmark" title="Use these as my defaults" onPress={saveDefaults} testID="pricing-save-defaults" />
    </Screen>
  );
}
