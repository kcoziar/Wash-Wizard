import React, { useState } from 'react';
import { View } from 'react-native';
import { Card, Field, HeroCard, KeyValue, PassMoney, Screen, Segmented, T } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { parseMoneyCents } from '@/lib/decimal';
import { marginOf, markupOf, priceForMargin, priceForMarkup } from '@/lib/economics';
import { money, percent } from '@/lib/format';
import { useStore } from '@/lib/store';

export default function MarginTool() {
  const c = useColors();
  const store = useStore();
  const mt = store.settings.marginTarget;
  const [mode, setMode] = useState<'find' | 'check'>('find');
  const [cost, setCost] = useState('');
  const [pct, setPct] = useState(mt.state === 'known_value' ? mt.percent : '');
  const [price, setPrice] = useState('');

  const costCents = parseMoneyCents(cost);
  const priceCents = parseMoneyCents(price);
  const pctNum = pct ? Number(pct) : NaN;
  const marginTooHigh = Number.isFinite(pctNum) && pctNum >= 100;

  const marginPrice = costCents != null && costCents > 0 && pct && !marginTooHigh ? priceForMargin(costCents, pct) : null;
  const markupPrice = costCents != null && costCents > 0 && pct ? priceForMarkup(costCents, pct) : null;
  const checkMargin = costCents != null && priceCents != null ? marginOf(priceCents, costCents) : null;
  const checkMarkup = costCents != null && priceCents != null ? markupOf(priceCents, costCents) : null;

  return (
    <Screen title="Margin & markup" subtitle="Private. Nothing here is saved.">
      <Segmented
        options={[
          { value: 'find', label: 'Find a price' },
          { value: 'check', label: 'Check a price' },
        ]}
        value={mode}
        onChange={setMode}
        testID="margin-mode"
      />
      <Card style={{ gap: 14 }}>
        <Field label="Your cost for the job" value={cost} onChangeText={setCost} prefix="$" decimal maxDecimals={2} placeholder="0" big testID="margin-cost" hint="Everything it costs you to do the job, including your own pay if you count it as a cost." />
        {mode === 'find' ? (
          <Field label="Margin you want" value={pct} onChangeText={setPct} suffix="%" decimal maxDecimals={1} placeholder="e.g. 40" error={marginTooHigh ? 'A margin has to be below 100%.' : null} testID="margin-percent" />
        ) : (
          <Field label="Price you're charging" value={price} onChangeText={setPrice} prefix="$" decimal maxDecimals={2} placeholder="0" testID="margin-price" />
        )}
      </Card>

      {mode === 'find' && marginPrice != null && costCents != null ? (
        <HeroCard style={{ gap: 12 }}>
          <T v="label" color={c.heroMuted}>
            Charge at least
          </T>
          <PassMoney cents={marginPrice} color={c.heroForeground} testID="margin-result" />
          <T v="small" color={c.heroMuted}>
            {money(marginPrice - costCents)} of every {money(marginPrice)} is yours: a {pct}% margin.
          </T>
          {markupPrice != null && markupPrice !== marginPrice ? (
            <>
              <View style={{ height: 1, backgroundColor: c.heroLine }} />
              <KeyValue label={`A ${pct}% markup would give`} value={money(markupPrice)} color={c.heroForeground} />
              <T v="small" color={c.heroWarn}>
                That is only a {percent(marginOf(markupPrice, costCents), 1)} margin. Markup adds a percentage of cost; margin is a percentage of the price.
              </T>
            </>
          ) : null}
        </HeroCard>
      ) : null}

      {mode === 'check' && checkMargin != null && costCents != null && priceCents != null ? (
        <HeroCard style={{ gap: 12 }}>
          <T v="label" color={c.heroMuted}>
            Margin
          </T>
          <T v="display" color={checkMargin < 0 ? c.heroWarn : c.heroForeground} testID="margin-check-result">
            {percent(checkMargin, 1)}
          </T>
          <View style={{ height: 1, backgroundColor: c.heroLine }} />
          <KeyValue label="Left after cost" value={money(priceCents - costCents)} color={c.heroForeground} />
          <KeyValue label="Markup on cost" value={checkMarkup != null ? percent(checkMarkup, 1) : 'n/a'} color={c.heroForeground} />
          {checkMargin < 0 ? (
            <T v="small" color={c.heroWarn}>
              This price is below your cost.
            </T>
          ) : null}
        </HeroCard>
      ) : null}
    </Screen>
  );
}
