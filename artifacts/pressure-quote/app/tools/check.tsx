import React, { useState } from 'react';
import { View } from 'react-native';
import { Card, Chip, Field, HeroCard, KeyValue, PassMoney, Screen, SectionLabel, StatefulAmount, T } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { parseMoneyCents, parseNonNeg } from '@/lib/decimal';
import { supportedMinutes } from '@/lib/economics';
import { duration, money, percent } from '@/lib/format';
import { useStore } from '@/lib/store';
import type { InputState } from '@/lib/types';

export default function CheckTool() {
  const c = useColors();
  const store = useStore();
  const s = store.settings;
  const [price, setPrice] = useState('');
  const [hours, setHours] = useState('');
  const [costs, setCosts] = useState<{ state: InputState; amount: string }>({ state: 'unknown', amount: '' });
  const [target, setTarget] = useState(s.ownerTarget.state === 'known_value' ? s.ownerTarget.rate : '');

  const priceCents = parseMoneyCents(price);
  const h = parseNonNeg(hours);
  const minutes = h ? Math.round(h.toNumber() * 60) : null;
  const costCents = costs.state === 'known_zero' ? 0 : costs.state === 'known_value' ? parseMoneyCents(costs.amount) : null;
  const targetCents = target ? parseMoneyCents(target) : null;

  const ready = priceCents != null && priceCents > 0 && minutes != null && minutes > 0;
  const perHourBefore = ready ? (priceCents / minutes) * 60 : null;
  const perHourAfter = ready && costCents != null ? ((priceCents - costCents) / minutes) * 60 : null;
  const needed = ready && costCents != null && targetCents != null ? Math.ceil(costCents + (targetCents * minutes) / 60) : null;
  const within = ready && costCents != null && targetCents != null ? supportedMinutes(priceCents, costCents, targetCents, 0) : null;
  const verdict = perHourAfter != null && targetCents != null ? (perHourAfter >= targetCents ? 'meets' : 'below') : null;

  return (
    <Screen title="Is this price worth it?" subtitle="Private. Nothing here is saved.">
      <Card style={{ gap: 14 }}>
        <Field label="Price before tax" value={price} onChangeText={setPrice} prefix="$" decimal maxDecimals={2} placeholder="0" big testID="check-price" />
        <Field label="Whole visit, door to door" value={hours} onChangeText={setHours} suffix="hours" decimal maxDecimals={2} placeholder="e.g. 2.5" hint="Include travel, setup, cleaning, cleanup and paperwork." testID="check-hours" />
        <StatefulAmount label="Costs for this visit" state={costs.state} amount={costs.amount} onChange={(state, amount) => setCosts({ state, amount })} hint="Chemicals, fuel, help, disposal. Leave as not sure if you don't know yet." testID="check-costs" />
        <Field label="What your time should earn" value={target} onChangeText={setTarget} prefix="$" suffix="per hour" decimal maxDecimals={2} placeholder="Not set" testID="check-target" />
      </Card>

      {ready ? (
        <HeroCard style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <T v="label" color={c.heroMuted}>
              {perHourAfter != null ? 'You keep per hour' : 'Brings in per hour'}
            </T>
            {verdict ? <Chip small tone="hero" selected={verdict === 'meets'} label={verdict === 'meets' ? 'Meets your target' : 'Below your target'} /> : null}
          </View>
          <PassMoney cents={Math.round(perHourAfter ?? perHourBefore ?? 0)} color={verdict === 'below' ? c.heroWarn : c.heroForeground} testID="check-per-hour" />
          {perHourAfter == null ? (
            <T v="small" color={c.heroWarn}>
              Before costs. Add your costs, or choose none, to see what you keep.
            </T>
          ) : null}
          <View style={{ height: 1, backgroundColor: c.heroLine }} />
          <KeyValue label="Before costs" value={`${money(Math.round(perHourBefore ?? 0))}/h`} color={c.heroForeground} />
          {needed != null ? <KeyValue label="Price that reaches your target" value={money(needed)} color={c.heroForeground} testID="check-needed" /> : null}
          {within != null ? <KeyValue label="Time this price supports" value={within > 0 ? duration(within) : 'None'} color={c.heroForeground} /> : null}
          {costCents != null && priceCents ? <KeyValue label="Left after costs" value={`${money(priceCents - costCents)} (${percent((priceCents - costCents) / priceCents, 0)})`} color={c.heroForeground} /> : null}
          {targetCents == null ? (
            <T v="small" color={c.heroMuted}>
              Add what your time should earn to see the price you need.
            </T>
          ) : null}
        </HeroCard>
      ) : (
        <>
          <SectionLabel>How it works</SectionLabel>
          <T v="small" muted style={{ paddingHorizontal: 4 }}>
            Enter a price and how long the whole visit takes. You'll see what it pays per hour, and the price that reaches your target.
          </T>
        </>
      )}
    </Screen>
  );
}
