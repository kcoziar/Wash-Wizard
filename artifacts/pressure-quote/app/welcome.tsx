import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Chip, Field, HeroCard, Screen, Segmented, SERVICE_ICON, T, TextLink, haptic } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { track } from '@/lib/analytics';
import { parseMoneyCents } from '@/lib/decimal';
import { CORE_KINDS, RATED_KINDS, SERVICE_META, newDraft, newLine, unitFor } from '@/lib/defaults';
import { money, moneyRate, perUnitLabel, unitLabel } from '@/lib/format';
import { computeQuote } from '@/lib/pricing';
import { applyAnswers, type RateAnswer, type SetupAnswers } from '@/lib/onboarding';
import { useStore } from '@/lib/store';
import type { RatedKind, Unit } from '@/lib/types';

const STEPS = ['What do you clean?', 'Your rates', 'Minimum, tax and target', 'Name on your quotes'];

/** Sizes for the live example only. Always labelled as examples and never saved. */
const EXAMPLE_AREA: Partial<Record<RatedKind, { sqft: string; sqm: string }>> = {
  driveway: { sqft: '600', sqm: '56' },
  walkway: { sqft: '120', sqm: '11' },
  patio: { sqft: '300', sqm: '28' },
  stairs: { sqft: '60', sqm: '6' },
  house: { sqft: '2400', sqm: '220' },
  roof: { sqft: '2000', sqm: '185' },
  deck: { sqft: '300', sqm: '28' },
};
const EXAMPLE_LENGTH: Partial<Record<RatedKind, { ft: string; m: string }>> = {
  fence: { ft: '150', m: '45' },
  gutters: { ft: '160', m: '50' },
};

function exampleQty(kind: RatedKind, unit: Unit): string {
  if (unit === 'sqft' || unit === 'sqm') return EXAMPLE_AREA[kind]?.[unit] ?? (unit === 'sqft' ? '300' : '28');
  if (unit === 'ft' || unit === 'm') return EXAMPLE_LENGTH[kind]?.[unit] ?? (unit === 'ft' ? '40' : '12');
  if (unit === 'each') return '6';
  return '2';
}

export default function Welcome() {
  const c = useColors();
  const store = useStore();
  const s = store.settings;
  const [step, setStep] = useState(0);
  const [skipped, setSkipped] = useState<Set<number>>(() => new Set());
  const [kinds, setKinds] = useState<RatedKind[]>([]);
  const [rates, setRates] = useState<Record<RatedKind, RateAnswer>>(
    () => Object.fromEntries(RATED_KINDS.map((k) => [k, { mode: s.rates[k].qtyType === 'flat' ? 'flat' : 'rate', value: s.rates[k].rate }])) as Record<RatedKind, RateAnswer>,
  );
  const [minimum, setMinimum] = useState(s.minimum.state === 'known_value' ? s.minimum.amount : '');
  const [target, setTarget] = useState(s.ownerTarget.state === 'known_value' ? s.ownerTarget.rate : '');
  const [taxCharge, setTaxCharge] = useState<'yes' | 'no' | ''>(s.tax.state === 'known_zero' ? 'no' : s.tax.state === 'known_value' ? 'yes' : '');
  const [taxRate, setTaxRate] = useState(s.tax.state === 'known_value' ? s.tax.rate : '');
  const [name, setName] = useState(s.business.name);
  const [phone, setPhone] = useState(s.business.phone);

  const answers: SetupAnswers = { services: kinds, rates, minimum, target, name, phone, tax: { charge: taxCharge, rate: taxRate } };
  // Services picked on the first step; everything when that step was skipped.
  const shown = kinds.length && !skipped.has(0) ? kinds : step === 0 ? [] : CORE_KINDS;

  const example = useMemo(() => {
    const settings = applyAnswers(s, answers, skipped);
    const draft = newDraft(settings, []);
    draft.lines = shown.map((k) => {
      const line = newLine(k, settings);
      if (line.qtyType !== 'flat') line.qty = exampleQty(k, line.unit);
      return line;
    });
    return { draft, calc: computeQuote(draft), settings };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, kinds, rates, minimum, target, name, phone, taxCharge, taxRate, skipped, step]);

  const leave = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const finish = (skip: Set<number>) => {
    store.updateSettings((x) => applyAnswers(x, answers, skip));
    store.updateMeta((m) => ({ ...m, onboarded: true }));
    track('setup_finished');
    haptic('success');
    leave();
  };
  const skipSetup = () => {
    store.updateMeta((m) => ({ ...m, onboarded: true }));
    track('setup_skipped');
    leave();
  };
  const advance = (skip: boolean) => {
    const next = new Set(skipped);
    if (skip) next.add(step);
    else next.delete(step);
    setSkipped(next);
    if (step === STEPS.length - 1) finish(next);
    else setStep(step + 1);
    haptic('select');
  };
  const setRate = (k: RatedKind, patch: Partial<RateAnswer>) => setRates((r) => ({ ...r, [k]: { ...r[k], ...patch } }));
  const toggleKind = (k: RatedKind) => setKinds((list) => (list.includes(k) ? list.filter((x) => x !== k) : RATED_KINDS.filter((x) => x === k || list.includes(x))));

  const { calc, draft, settings } = example;
  const business = settings.business.name.trim();

  return (
    <Screen
      title={STEPS[step]}
      subtitle={`Step ${step + 1} of ${STEPS.length} · about 30 seconds`}
      back={step > 0}
      onBack={() => setStep(step - 1)}
      right={<TextLink title="Skip setup" onPress={skipSetup} testID="welcome-skip-all" />}
      footer={
        <View style={{ gap: 6 }}>
          <Button title={step === STEPS.length - 1 ? 'Finish setup' : 'Next'} icon={step === STEPS.length - 1 ? 'check' : 'arrow-right'} onPress={() => advance(false)} testID="welcome-next" />
          <View style={{ alignItems: 'center' }}>
            <TextLink title={step === 1 ? "I'll set rates on the quote" : 'Skip this'} color={c.mutedForeground} onPress={() => advance(true)} testID="welcome-skip" />
          </View>
        </View>
      }
    >
      <View style={{ flexDirection: 'row', gap: 6 }} accessibilityLabel={`Step ${step + 1} of ${STEPS.length}`}>
        {STEPS.map((t, i) => (
          <View key={t} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= step ? c.primary : c.border }} />
        ))}
      </View>

      {step === 0 ? (
        <Card style={{ gap: 12 }}>
          <T v="body" muted>
            Pick everything you quote. Anything else can go on a quote as its own service.
          </T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {RATED_KINDS.map((k) => (
              <Chip key={k} label={SERVICE_META[k].name} mci={SERVICE_ICON[k]} selected={kinds.includes(k)} onPress={() => toggleKind(k)} testID={`welcome-kind-${k}`} />
            ))}
          </View>
        </Card>
      ) : null}

      {step === 1
        ? shown.map((k) => {
            const r = s.rates[k];
            const perUnit = r.qtyType === 'flat' ? perUnitLabel(unitFor(SERVICE_META[k].qtyType, s.units), SERVICE_META[k].eachLabel) : perUnitLabel(r.unit, r.eachLabel);
            const a = rates[k];
            return (
              <Card key={k} style={{ gap: 10 }} testID={`welcome-rate-${k}`}>
                <T v="h3">{SERVICE_META[k].name}</T>
                <Segmented
                  compact
                  options={[
                    { value: 'rate', label: `Price ${perUnit.replace('/ ', 'per ')}` },
                    { value: 'flat', label: 'Flat price' },
                  ]}
                  value={a.mode}
                  onChange={(v) => setRate(k, { mode: v, value: '' })}
                  testID={`welcome-rate-${k}-mode`}
                />
                <Field
                  value={a.value}
                  onChangeText={(t) => setRate(k, { value: t })}
                  prefix="$"
                  suffix={a.mode === 'rate' ? perUnit : undefined}
                  decimal
                  maxDecimals={a.mode === 'rate' ? 4 : 2}
                  placeholder={a.mode === 'rate' ? 'Your rate' : 'Your usual price'}
                  accessibilityLabel={`${SERVICE_META[k].name} ${a.mode === 'rate' ? `rate ${perUnit.replace('/ ', 'per ')}` : 'flat price'}`}
                  testID={`welcome-rate-${k}-value`}
                />
              </Card>
            );
          })
        : null}
      {step === 1 ? (
        <T v="small" muted style={{ paddingHorizontal: 4 }}>
          Your own prices, not suggestions. Leave any blank and set it on the quote.
        </T>
      ) : null}

      {step === 2 ? (
        <Card style={{ gap: 14 }}>
          <Field
            label="Smallest job you'll take (optional)"
            value={minimum}
            onChangeText={setMinimum}
            prefix="$"
            decimal
            maxDecimals={2}
            placeholder="Not set"
            hint="A quote below this is raised to it, and the quote says so."
            testID="welcome-minimum"
          />
          <View style={{ gap: 8 }}>
            <T v="label">Do you charge sales tax?</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Chip label="No" selected={taxCharge === 'no'} onPress={() => setTaxCharge(taxCharge === 'no' ? '' : 'no')} testID="welcome-tax-no" />
              <Chip label="Yes" selected={taxCharge === 'yes'} onPress={() => setTaxCharge(taxCharge === 'yes' ? '' : 'yes')} testID="welcome-tax-yes" />
            </View>
            {taxCharge === 'yes' ? (
              <Field label="Tax rate" value={taxRate} onChangeText={setTaxRate} suffix="%" decimal maxDecimals={3} placeholder="For example 8.25" testID="welcome-tax-rate" />
            ) : null}
            <T v="small" muted>
              {taxCharge === 'no' ? 'Quotes show no tax line.' : taxCharge === 'yes' ? 'Added to taxable lines on every quote. You can change it per job.' : 'Until you answer, quotes say "Plus any applicable sales tax" under the total.'}
            </T>
          </View>
          <Field
            label="What your time should earn (optional)"
            value={target}
            onChangeText={setTarget}
            prefix="$"
            suffix="per hour"
            decimal
            maxDecimals={2}
            placeholder="Not set"
            hint="Private. Each quote shows whether the visit earns it."
            testID="welcome-target"
          />
        </Card>
      ) : null}

      {step === 3 ? (
        <Card style={{ gap: 14 }}>
          <Field label="Business name" value={name} onChangeText={setName} placeholder="As customers know you" autoCapitalize="words" textContentType="organizationName" maxLength={80} testID="welcome-name" />
          <Field label="Phone on your quotes (optional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" inputMode="tel" textContentType="telephoneNumber" maxLength={40} testID="welcome-phone" />
        </Card>
      ) : null}

      <HeroCard style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <T v="label" color={c.heroMuted}>
            Example quote
          </T>
          <T v="small" color={c.heroMuted} numberOfLines={1} style={{ flexShrink: 1, marginLeft: 12 }}>
            {business || 'Your business'}
          </T>
        </View>
        {draft.lines.length === 0 ? (
          <T v="small" color={c.heroMuted}>
            Pick a service to see a quote take shape in your own numbers.
          </T>
        ) : (
          draft.lines.map((l) => {
            const cl = calc.lines.find((x) => x.id === l.id);
            const priced = !!cl && cl.missing.length === 0 && !cl.issue;
            return (
              <View key={l.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }} testID={`welcome-example-${l.kind}`}>
                <View style={{ flex: 1 }}>
                  <T v="bodyStrong" color={c.heroForeground}>
                    {l.name}
                  </T>
                  <T v="small" color={c.heroMuted}>
                    {l.qtyType === 'flat' ? 'Flat price' : `${l.qty} ${unitLabel(l.unit, l.eachLabel)} (example size)${priced ? ` \u00D7 ${moneyRate(l.rate)}` : ''}`}
                  </T>
                </View>
                <T v={priced ? 'num' : 'small'} color={priced ? c.heroForeground : c.heroMuted}>
                  {priced && cl ? money(cl.amount) : 'Rate on the quote'}
                </T>
              </View>
            );
          })
        )}
        {draft.lines.length > 0 ? (
          <View style={{ borderTopWidth: 1, borderTopColor: c.heroBorder, paddingTop: 10, gap: 4 }}>
            {calc.complete ? (
              <>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <T v="smallStrong" color={c.heroMuted}>
                    Total before tax
                  </T>
                  <T v="numLg" color={c.heroForeground} testID="welcome-example-total">
                    {money(calc.total)}
                  </T>
                </View>
                {calc.minimum.adjustment > 0 ? (
                  <T v="small" color={c.heroMuted}>
                    Raised to your {money(parseMoneyCents(settings.minimum.amount) ?? 0)} job minimum
                  </T>
                ) : null}
              </>
            ) : (
              <T v="small" color={c.heroMuted}>
                Add a rate above and the total appears here.
              </T>
            )}
            {settings.ownerTarget.state === 'known_value' ? (
              <T v="small" color={c.heroMuted}>
                Your time: {money(parseMoneyCents(settings.ownerTarget.rate) ?? 0)}/h. Each quote shows whether the visit earns it.
              </T>
            ) : null}
          </View>
        ) : null}
      </HeroCard>
      {draft.lines.some((l) => l.qtyType !== 'flat') ? (
        <T v="small" muted style={{ paddingHorizontal: 4 }}>
          Example sizes only. Your quotes use the sizes you enter.
        </T>
      ) : null}
    </Screen>
  );
}
