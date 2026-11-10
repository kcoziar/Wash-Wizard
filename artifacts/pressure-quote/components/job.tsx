import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Button, Card, Chip, Field, haptic, IconButton, Segmented, ServiceGlyph, T, TextLink, Tick } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { type Dec, parseMoneyCents, parseNonNeg } from '@/lib/decimal';
import { rateFromTime } from '@/lib/economics';
import { SERVICE_META } from '@/lib/defaults';
import { partQuantity, partsTotal } from '@/lib/geometry';
import { sizeFromDimensions, switchLineBasis, toFlatPrice } from '@/lib/lineEdit';
import { duration, makeId, money, moneyRate, number, perUnitLabel, rateInput, shortDate, unitLabel } from '@/lib/format';
import { computeQuote, type CalcLine } from '@/lib/pricing';
import type { InputState, Job, JobStatus, Line, Part, Question, RatedKind, Settings, Unit } from '@/lib/types';
import type { Resolution } from '@/lib/resolve';
import { SIDES_LABEL } from '@/lib/parser';
import { sizeKeyLabel } from '@/lib/sizes';

// ---------- Rate from time ----------

/** For a line with no rate: work one out from the operator's own cleaning time and hourly figure. */
export function RateBuilder({ line, qty, ownerRate, hourlyCosts, onUse }: { line: Line; qty: Dec; ownerRate: string; hourlyCosts: number; onUse: (rate: string) => void }) {
  const [minutes, setMinutes] = useState('');
  const [target, setTarget] = useState(ownerRate);
  const mins = parseNonNeg(minutes);
  const pay = parseMoneyCents(target);
  const rate = mins && pay ? rateFromTime(qty, mins.toNumber(), pay + hourlyCosts) : null;
  const sizeText = `${number(qty)} ${unitLabel(line.unit, line.eachLabel)}`;
  return (
    <Card style={{ gap: 12 }} testID="rate-builder">
      <View style={{ gap: 4 }}>
        <T v="bodyStrong">No rate yet? Work one out from your time</T>
        <T v="small" muted>
          Uses only your own numbers. It is what covers your time, not what others charge.
        </T>
      </View>
      <Field label={`Cleaning time for ${sizeText}`} value={minutes} onChangeText={setMinutes} suffix="min" decimal maxDecimals={0} placeholder="e.g. 90" testID="rate-builder-minutes" />
      <Field label="What your time should earn" value={target} onChangeText={setTarget} prefix="$" suffix="per hour" decimal maxDecimals={2} placeholder="e.g. 60" testID="rate-builder-target" />
      {rate && pay ? (
        <View style={{ gap: 10 }}>
          <T v="small" muted testID="rate-builder-result">
            {`${moneyRate(rate.toString())} ${perUnitLabel(line.unit, line.eachLabel)} pays ${money(pay, { noCents: pay % 100 === 0 })}/h for ${duration(mins?.toNumber() ?? 0)} of cleaning`}
            {hourlyCosts > 0 ? `, plus ${money(hourlyCosts)}/h in per-hour costs` : ''}. Travel, setup and per-visit costs are checked on the whole visit.
          </T>
          <Button size="md" variant="secondary" icon="check" title={`Use ${moneyRate(rate.toString())} ${perUnitLabel(line.unit, line.eachLabel)}`} onPress={() => onUse(rateInput(rate))} testID="rate-builder-use" />
        </View>
      ) : null}
    </Card>
  );
}

// ---------- Status ----------

export const STATUS_LABEL: Record<JobStatus, string> = {
  draft: 'Draft',
  quoted: 'Ready to send',
  sent: 'Sent',
  accepted: 'Accepted',
  declined: 'Declined',
  completed: 'Completed',
};

export function StatusChip({ status, sample, hero }: { status: JobStatus; sample?: boolean; hero?: boolean }) {
  const c = useColors();
  const tone =
    status === 'accepted' || status === 'completed'
      ? { bg: hero ? c.heroAccentSoft : c.confirmSoft, fg: hero ? c.accent : c.confirm }
      : status === 'declined'
        ? { bg: hero ? c.heroDangerSoft : c.destructiveSoft, fg: hero ? c.heroDanger : c.destructive }
        : status === 'draft'
          ? { bg: hero ? c.heroGlass : c.muted, fg: hero ? c.heroMuted : c.mutedForeground }
          : { bg: hero ? c.heroGlassStrong : c.secondary, fg: hero ? c.heroForeground : c.foreground };
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {sample ? (
        <View style={{ backgroundColor: c.uncertainSoft, borderRadius: 999, paddingHorizontal: 9, height: 24, justifyContent: 'center', borderWidth: 1, borderColor: c.uncertainBorder, borderStyle: 'dashed' }}>
          <T v="smallStrong" color={c.uncertain} style={{ fontSize: 13 }}>
            Sample
          </T>
        </View>
      ) : null}
      <View style={{ backgroundColor: tone.bg, borderRadius: 999, paddingHorizontal: 10, height: 24, justifyContent: 'center' }}>
        <T v="smallStrong" color={tone.fg} style={{ fontSize: 13 }}>
          {STATUS_LABEL[status]}
        </T>
      </View>
    </View>
  );
}

/** Total for lists: the latest frozen quote, otherwise the live draft when it is complete. */
export function jobTotal(job: Job): { cents: number | null; frozen: boolean } {
  if (job.revisions.length && !job.dirtySince) return { cents: job.revisions[job.revisions.length - 1].doc.total, frozen: true };
  const calc = computeQuote(job.draft);
  if (calc.complete) return { cents: calc.total, frozen: false };
  if (job.revisions.length) return { cents: job.revisions[job.revisions.length - 1].doc.total, frozen: true };
  return { cents: null, frozen: false };
}

export function JobRow({ job, onPress, onSimilar }: { job: Job; onPress: () => void; onSimilar?: () => void }) {
  const c = useColors();
  const total = useMemo(() => jobTotal(job), [job]);
  const kind = job.draft.lines[0]?.kind ?? 'custom';
  const ref = job.revisions.length ? job.revisions[job.revisions.length - 1].reference : job.sample ? 'SAMPLE' : `Q-${String(job.number).padStart(4, '0')}`;
  const row = (
    <Card onPress={onPress} testID={`job-row-${job.id}`} style={{ padding: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <ServiceGlyph kind={kind} size={40} />
        <View style={{ flex: 1, gap: 2 }}>
          <T v="bodyStrong" numberOfLines={1}>
            {job.draft.customer.name.trim() || job.label}
          </T>
          <T v="small" muted numberOfLines={1}>
            {job.draft.customer.name.trim() ? `${job.label} · ` : ''}
            {ref} · {shortDate(job.updatedAt)}
          </T>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <T v="num" color={total.cents == null ? c.faint : undefined}>
            {total.cents == null ? '\u2014' : money(total.cents)}
          </T>
          <StatusChip status={job.status} sample={job.sample} />
        </View>
      </View>
    </Card>
  );
  if (!onSimilar) return row;
  return (
    <View style={{ gap: 2 }}>
      {row}
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 4 }}>
        <TextLink title="Quote similar work" icon="copy" color={c.mutedForeground} onPress={onSimilar} testID={`job-similar-${job.id}`} />
      </View>
    </View>
  );
}

// ---------- Line card ----------

function needsText(cl: CalcLine | undefined, line: Line): string | null {
  if (line.treatment !== 'priced') return null;
  if (!cl) return 'Needs details';
  if (cl.missing.includes('qty')) return line.qtyMode === 'parts' ? 'Finish measuring' : 'Needs size';
  if (cl.missing.includes('rate')) return 'Needs rate';
  if (cl.missing.includes('price')) return 'Needs price';
  return null;
}

export function LineCard({
  line,
  calcLine,
  settings,
  onChange,
  onOpen,
  onSaveRate,
  testID,
}: {
  line: Line;
  calcLine: CalcLine | undefined;
  settings: Settings;
  onChange: (next: Line) => void;
  onOpen: () => void;
  /** Absent on sample jobs: their rates are never saved as the operator's. */
  onSaveRate?: (line: Line) => void;
  testID?: string;
}) {
  const c = useColors();
  const needs = needsText(calcLine, line);
  const rated = line.kind !== 'custom' ? settings.rates[line.kind as RatedKind] : null;
  const flat = line.qtyType === 'flat';
  // A flat line's saved value is its price; every other line's is its rate.
  const value = flat ? line.price : line.rate;
  const valueText = (v: string, r: { unit: Unit; eachLabel: string } = line) => (flat ? money(parseMoneyCents(v) ?? 0) : `${moneyRate(v)} ${perUnitLabel(r.unit, r.eachLabel)}`);
  // A copied or reopened job can carry a rate that is no longer the saved one: no tick then, and the operator chooses.
  const matchesSaved = !!rated && rated.rate.trim() !== '' && rated.rate === value && rated.qtyType === line.qtyType && (flat || rated.unit === line.unit);
  const ratePrompt = useMemo(() => {
    if (!onSaveRate || !rated || (line.rateSource !== 'entered' && line.rateSource !== 'saved') || line.treatment !== 'priced') return null;
    // A different way of pricing only becomes the usual when nothing is saved for this service yet.
    if (rated.qtyType !== line.qtyType && rated.rate.trim() !== '') return null;
    const r = parseNonNeg(value);
    if (!r || r.isZero()) return null;
    if (matchesSaved) return null;
    return { saved: rated.rate.trim() && rated.qtyType === line.qtyType ? valueText(rated.rate, rated) : null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rated, line, matchesSaved, value]);
  const rateMissing = line.treatment === 'priced' && !flat && !parseNonNeg(line.rate);

  const customerQty = line.qtySource === 'customer' && line.qtyType !== 'flat' && (line.qty.trim() !== '' || line.parts.length > 0);
  const muted = line.treatment === 'excluded';
  const unitText = unitLabel(line.unit, line.eachLabel);

  return (
    <Card testID={testID} style={{ padding: 14, gap: 12, opacity: muted ? 0.75 : 1 }}>
      <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={`Edit ${line.name}`} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, opacity: pressed ? 0.6 : 1 })}>
        <ServiceGlyph kind={line.kind} size={38} />
        <View style={{ flex: 1 }}>
          <T v="h3" numberOfLines={1}>
            {line.name || 'Service'}
          </T>
          <T v="small" muted numberOfLines={1}>
            {line.treatment === 'free'
              ? 'Included at no charge'
              : line.treatment === 'excluded'
                ? 'Listed as not included'
                : calcLine && calcLine.qtyLabel && line.qtyType !== 'flat' && !calcLine.missing.length
                  ? `${calcLine.qtyLabel} \u00D7 ${moneyRate(line.rate)}`
                  : line.detail || (line.qtyType === 'flat' ? 'Flat price' : `Priced ${perUnitLabel(line.unit, line.eachLabel).replace('/ ', 'per ')}`)}
          </T>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          {line.treatment === 'free' ? (
            <T v="smallStrong" color={c.confirm}>
              Included
            </T>
          ) : line.treatment === 'excluded' ? (
            <T v="smallStrong" muted>
              Not included
            </T>
          ) : needs ? (
            <T v="smallStrong" color={c.uncertain}>
              {needs}
            </T>
          ) : (
            <T v="num">{money(calcLine?.amount ?? 0)}</T>
          )}
        </View>
        <Feather name="chevron-right" size={18} color={c.faint} />
      </Pressable>

      {line.treatment === 'priced' ? (
        line.qtyType === 'flat' ? (
          <Field
            testID={testID ? `${testID}-price` : undefined}
            value={line.price}
            onChangeText={(t) => onChange({ ...line, price: t, rateSource: 'entered' })}
            prefix="$"
            decimal
            maxDecimals={2}
            placeholder="Price"
            accessibilityLabel={`${line.name || 'Service'} price`}
            tone={!line.price ? 'uncertain' : matchesSaved ? 'confirm' : undefined}
          />
        ) : (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {line.qtyMode === 'parts' ? (
              <Pressable
                onPress={onOpen}
                accessibilityRole="button"
                style={({ pressed }) => ({
                  flex: 1,
                  minHeight: 48,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderStyle: customerQty || calcLine?.missing.includes('qty') ? 'dashed' : 'solid',
                  borderColor: customerQty || calcLine?.missing.includes('qty') ? c.uncertainBorder : c.input,
                  backgroundColor: customerQty ? c.uncertainSoft : c.card,
                  paddingHorizontal: 12,
                  justifyContent: 'center',
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <T v="smallStrong" muted style={{ fontSize: 13 }}>
                  MEASURED
                </T>
                <T v="bodyStrong" color={customerQty ? c.uncertain : undefined} numberOfLines={1}>
                  {calcLine?.qty ? `${number(calcLine.qty)} ${unitText}` : 'Finish shapes'}
                </T>
              </Pressable>
            ) : (
              <Field
                style={{ flex: 1 }}
                testID={testID ? `${testID}-qty` : undefined}
                value={line.qty}
                onChangeText={(t) => onChange({ ...line, qty: t, qtySource: 'operator' })}
                onOtherText={(t) => {
                  const measured = sizeFromDimensions(line, t);
                  if (measured) onChange(measured);
                }}
                suffix={unitText}
                decimal
                placeholder={line.qtyType === 'each' ? 'How many' : 'Size'}
                accessibilityLabel={`${line.name || 'Service'} ${line.qtyType === 'each' ? `number of ${line.eachLabel || 'items'}` : 'size'} in ${unitText}`}
                tone={customerQty || !line.qty ? 'uncertain' : undefined}
              />
            )}
            <Field
              style={{ flex: 1 }}
              testID={testID ? `${testID}-rate` : undefined}
              value={line.rate}
              onChangeText={(t) => onChange({ ...line, rate: t, rateSource: 'entered' })}
              prefix="$"
              suffix={perUnitLabel(line.unit, line.eachLabel)}
              decimal
              maxDecimals={6}
              placeholder="Rate"
              accessibilityLabel={`${line.name || 'Service'} rate in dollars ${perUnitLabel(line.unit, line.eachLabel).replace('/ ', 'per ')}`}
              tone={!line.rate ? 'uncertain' : line.rateSource === 'saved' && matchesSaved ? 'confirm' : undefined}
            />
          </View>
        )
      ) : null}

      {customerQty && line.treatment === 'priced' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Chip small tone="uncertain" icon="message-circle" label="Customer's size" />
          <TextLink testID={testID ? `${testID}-confirm` : undefined} title="Looks right" icon="check" color={c.confirm} onPress={() => onChange({ ...line, qtySource: 'confirmed' })} />
          <TextLink title="Measure" icon="maximize" onPress={onOpen} />
        </View>
      ) : null}

      {rateMissing ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 18 }}>
          <TextLink title="Work out my rate" icon="clock" color={c.mutedForeground} onPress={onOpen} testID={testID ? `${testID}-build-rate` : undefined} />
          <TextLink
            title="I already know the price"
            icon="tag"
            color={c.mutedForeground}
            onPress={() => onChange(toFlatPrice(line, calcLine?.qty ? `${number(calcLine.qty)} ${unitText}` : null))}
            testID={testID ? `${testID}-flat` : undefined}
          />
        </View>
      ) : null}
      {flat && rated && line.treatment === 'priced' ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
          <TextLink
            title="Price by size instead"
            icon="maximize"
            color={c.mutedForeground}
            onPress={() => onChange(switchLineBasis(line, rated.qtyType === 'flat' ? SERVICE_META[line.kind].qtyType : rated.qtyType, settings.units, rated))}
            testID={testID ? `${testID}-by-size` : undefined}
          />
        </View>
      ) : null}

      {ratePrompt ? (
        <View style={{ backgroundColor: c.cardAlt, borderRadius: 12, padding: 12, gap: 10, borderWidth: 1, borderColor: c.border }}>
          <T v="small">
            {ratePrompt.saved
              ? `Your saved ${line.kind} ${flat ? 'price' : 'rate'} is ${ratePrompt.saved}. Use ${flat ? valueText(value) : moneyRate(line.rate)} for:`
              : `Save ${valueText(value)} as your ${line.kind} ${flat ? 'price' : 'rate'} for next time?`}
          </T>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button size="sm" variant="outline" title="This job only" flex onPress={() => onChange({ ...line, rateSource: 'built' })} testID={testID ? `${testID}-rate-job` : undefined} />
            <Button size="sm" variant="primary" title="Save for future" flex onPress={() => onSaveRate?.(line)} testID={testID ? `${testID}-rate-save` : undefined} />
          </View>
        </View>
      ) : null}
    </Card>
  );
}

// ---------- Questions from a pasted request ----------

export function QuestionCard({
  question,
  lines,
  onResolve,
  testID,
}: {
  question: Question;
  lines: Line[];
  onResolve: (r: Resolution) => string | null;
  testID?: string;
}) {
  const c = useColors();
  const [mode, setMode] = useState<'idle' | 'split' | 'qty'>('idle');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const group = lines.filter((l) => question.lineIds.includes(l.id));
  const unit: Unit = question.payload.unit ?? 'sqft';

  const run = (r: Resolution) => {
    const err = onResolve(r);
    setError(err);
    if (!err) haptic('success');
  };

  let actions: React.ReactNode = null;
  switch (question.kind) {
    case 'combined_area':
      actions =
        group.length >= 2 ? (
          <>
            <Button size="md" variant="primary" title="Price as one area" onPress={() => run({ kind: 'combine' })} testID={`${testID}-combine`} />
            {group.length === 2 ? <Button size="md" variant="outline" title={`Split between ${group[0].name.toLowerCase()} and ${group[1].name.toLowerCase()}`} onPress={() => setMode('split')} testID={`${testID}-split`} /> : null}
            <Button size="md" variant="ghost" title="I'll measure on site" onPress={() => run({ kind: 'measure' })} testID={`${testID}-measure`} />
          </>
        ) : (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {(['driveway', 'walkway', 'patio'] as RatedKind[]).map((k) => (
                <Chip key={k} label={`Use for ${k}`} onPress={() => run({ kind: 'assign', service: k })} testID={`${testID}-assign-${k}`} />
              ))}
            </View>
            <Button size="md" variant="ghost" title="I'll measure on site" onPress={() => run({ kind: 'measure' })} testID={`${testID}-measure`} />
          </>
        );
      break;
    case 'size_meaning':
      actions = (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {group.map((l) => (
              <Chip key={l.id} label={`${l.name} area`} onPress={() => run({ kind: 'use_for', lineId: l.id })} testID={`${testID}-use-${l.kind}`} />
            ))}
          </View>
          <Button size="md" variant="outline" title="Home size only, save as a note" onPress={() => run({ kind: 'note' })} testID={`${testID}-note`} />
          <Button size="md" variant="ghost" title="I'll measure on site" onPress={() => run({ kind: 'measure' })} testID={`${testID}-measure`} />
        </>
      );
      break;
    case 'missing_qty':
      actions = group[0] ? (
        <>
          {question.payload.sizeKey && question.payload.area && question.payload.unit === group[0].unit ? (
            <Button
              size="md"
              variant="primary"
              title={`Use my usual ${number(parseNonNeg(question.payload.area))} ${unitLabel(group[0].unit, group[0].eachLabel)}`}
              onPress={() => run({ kind: 'qty', qty: question.payload.area ?? '' })}
              testID={`${testID}-usual`}
            />
          ) : null}
          <Button
            size="md"
            variant={question.payload.sizeKey && question.payload.area ? 'outline' : 'primary'}
            title={question.payload.sizeKey && question.payload.area ? 'Enter a different size' : 'Enter the size'}
            onPress={() => setMode('qty')}
            testID={`${testID}-qty`}
          />
          {question.payload.sizeKey && !question.payload.area ? (
            <T v="small" muted>
              Saved as your usual {sizeKeyLabel(question.payload.sizeKey)}, offered in one tap next time.
            </T>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button size="md" variant="outline" title="Measure on site" flex onPress={() => run({ kind: 'measure' })} testID={`${testID}-measure`} />
            <Button size="md" variant="outline" title="Include free" flex onPress={() => run({ kind: 'free' })} testID={`${testID}-free`} />
          </View>
          <Button size="md" variant="ghost" title={`Take ${group[0].name.toLowerCase()} off the quote`} onPress={() => run({ kind: 'remove' })} testID={`${testID}-remove`} />
        </>
      ) : (
        // A size the reader could not place on one surface: the operator decides on the line itself.
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button size="md" variant="outline" title="Measure on site" flex onPress={() => run({ kind: 'measure' })} testID={`${testID}-measure`} />
          <Button size="md" variant="outline" title="Got it" flex onPress={() => run({ kind: 'ignore' })} testID={`${testID}-ignore`} />
        </View>
      );
      break;
    case 'amount_meaning':
      // A per-unit amount ("$0.15/sq ft") is never a budget for the whole job.
      actions = question.payload.label ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button size="md" variant="primary" title="Save as a note" flex onPress={() => run({ kind: 'note' })} testID={`${testID}-note`} />
          <Button size="md" variant="outline" title="Ignore" flex onPress={() => run({ kind: 'ignore' })} testID={`${testID}-ignore`} />
        </View>
      ) : (
        <>
          <Button size="md" variant="primary" title="It's their budget (private)" onPress={() => run({ kind: 'budget' })} testID={`${testID}-budget`} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button size="md" variant="outline" title="Save as a note" flex onPress={() => run({ kind: 'note' })} testID={`${testID}-note`} />
            <Button size="md" variant="outline" title="Ignore" flex onPress={() => run({ kind: 'ignore' })} testID={`${testID}-ignore`} />
          </View>
        </>
      );
      break;
    case 'extra_measure':
      actions =
        question.payload.label === SIDES_LABEL ? (
          <>
            {group[0] && question.payload.area ? (
              <Button size="md" variant="primary" title="Yes, price the second side too" onPress={() => run({ kind: 'second' })} testID={`${testID}-second`} />
            ) : null}
            <Button size="md" variant="outline" title="My rate covers both sides" onPress={() => run({ kind: 'ignore' })} testID={`${testID}-ignore`} />
          </>
        ) : (
        <>
          {group[0] && question.payload.area ? (
            <>
              <Button size="md" variant="primary" title="Use this size instead" onPress={() => run({ kind: 'replace' })} testID={`${testID}-replace`} />
              <Button size="md" variant="outline" title={`Add a second ${group[0].name.toLowerCase()}`} onPress={() => run({ kind: 'second' })} testID={`${testID}-second`} />
            </>
          ) : null}
          <Button size="md" variant="ghost" title="Keep the first size" onPress={() => run({ kind: 'ignore' })} testID={`${testID}-ignore`} />
        </>
        );
      break;
    case 'scope':
      actions = (
        <>
          <Button size="md" variant="primary" title="Keep it listed as not included" onPress={() => run({ kind: 'keep_excluded' })} testID={`${testID}-keep`} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button size="md" variant="outline" title="Remove it" flex onPress={() => run({ kind: 'remove' })} testID={`${testID}-remove`} />
            <Button size="md" variant="outline" title="Price it anyway" flex onPress={() => run({ kind: 'include' })} testID={`${testID}-include`} />
          </View>
        </>
      );
      break;
    case 'other_service':
    case 'condition':
      actions = (
        <>
          <Button size="md" variant="primary" title={question.kind === 'condition' ? 'Add a priced line for it' : 'Add it to this quote'} onPress={() => run({ kind: 'price' })} testID={`${testID}-price`} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button size="md" variant="outline" title="Not included" flex onPress={() => run({ kind: 'exclude' })} />
            <Button size="md" variant="outline" title={question.kind === 'condition' ? 'No change' : 'Not needed'} flex onPress={() => run({ kind: 'ignore' })} />
          </View>
        </>
      );
      break;
  }

  return (
    <Card tone="uncertain" testID={testID} style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Feather name="help-circle" size={18} color={c.uncertain} style={{ marginTop: 2 }} />
        <View style={{ flex: 1, gap: 6 }}>
          <T v="bodyStrong">{question.prompt}</T>
          {question.evidence ? (
            <View style={{ borderLeftWidth: 2, borderLeftColor: c.uncertainBorder, paddingLeft: 10 }}>
              <T v="small" muted style={{ fontStyle: 'italic' }}>
                {'\u201C'}
                {question.evidence}
                {'\u201D'}
              </T>
            </View>
          ) : null}
        </View>
      </View>
      {mode === 'split' && group.length === 2 ? (
        <View style={{ gap: 10 }}>
          <Field
            label={`${group[0].name} share of ${question.payload.area} ${unitLabel(unit)}`}
            value={value}
            onChangeText={setValue}
            decimal
            suffix={unitLabel(unit)}
            autoFocus
            error={error}
            hint={(() => {
              const total = parseNonNeg(question.payload.area ?? '');
              const first = parseNonNeg(value);
              if (!total || !first || first.cmp(total) >= 0) return undefined;
              return `${group[1].name} gets ${number(total.sub(first))} ${unitLabel(unit)}`;
            })()}
          />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button size="md" variant="ghost" title="Back" flex onPress={() => setMode('idle')} />
            <Button size="md" title="Split it" flex onPress={() => run({ kind: 'split', first: value })} testID={`${testID}-split-go`} />
          </View>
        </View>
      ) : mode === 'qty' ? (
        <View style={{ gap: 10 }}>
          <Field
            label={group[0] ? `${group[0].name} size` : 'Size'}
            value={value}
            onChangeText={setValue}
            decimal
            suffix={group[0] ? unitLabel(group[0].unit, group[0].eachLabel) : undefined}
            autoFocus
            error={error}
            testID={`${testID}-qty-input`}
          />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button size="md" variant="ghost" title="Back" flex onPress={() => setMode('idle')} />
            <Button size="md" title="Use this size" flex onPress={() => run({ kind: 'qty', qty: value })} testID={`${testID}-qty-go`} />
          </View>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          {actions}
          {error ? (
            <T v="small" color={c.destructive}>
              {error}
            </T>
          ) : null}
        </View>
      )}
    </Card>
  );
}

// ---------- Measurement shapes ----------

export function PartsEditor({ parts, onChange, unit, testID }: { parts: Part[]; onChange: (p: Part[]) => void; unit: Unit; testID?: string }) {
  const c = useColors();
  const metric = unit === 'sqm';
  const len = metric ? 'm' : 'ft';
  const area = metric ? 'm\u00B2' : 'sq ft';
  const result = partsTotal(parts);
  const update = (id: string, patch: Partial<Part>) => onChange(parts.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const add = (subtract: boolean) => onChange([...parts, { id: makeId('p'), shape: 'rect', a: '', b: '', subtract, label: '' }]);

  return (
    <View style={{ gap: 10 }} testID={testID}>
      {parts.map((p, i) => {
        const q = partQuantity(p);
        return (
          <View
            key={p.id}
            style={{
              backgroundColor: p.subtract ? c.destructiveSoft : c.cardAlt,
              borderRadius: 14,
              padding: 12,
              gap: 10,
              borderWidth: 1,
              borderColor: p.subtract ? 'transparent' : c.border,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: p.subtract ? c.destructive : c.primary, alignItems: 'center', justifyContent: 'center' }}>
                <Feather name={p.subtract ? 'minus' : 'plus'} size={13} color={p.subtract ? c.destructiveForeground : c.primaryForeground} />
              </View>
              <T v="smallStrong" style={{ flex: 1 }}>
                {p.subtract ? 'Subtract' : `Shape ${parts.filter((x, j) => !x.subtract && j <= i).length}`}
                {q ? `  ·  ${number(q)} ${area}` : ''}
              </T>
              <Pressable accessibilityRole="button" accessibilityLabel="Remove shape" hitSlop={10} onPress={() => onChange(parts.filter((x) => x.id !== p.id))} testID={`${testID}-remove-${i}`}>
                <Feather name="x" size={18} color={c.mutedForeground} />
              </Pressable>
            </View>
            <Segmented
              compact
              options={[
                { value: 'rect', label: 'Rectangle' },
                { value: 'triangle', label: 'Triangle' },
                { value: 'value', label: 'Known area' },
              ]}
              value={p.shape}
              onChange={(v) => update(p.id, { shape: v })}
            />
            {p.shape === 'value' ? (
              <Field value={p.a} onChangeText={(t) => update(p.id, { a: t })} decimal suffix={area} placeholder="Area" testID={`${testID}-a-${i}`} />
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Field style={{ flex: 1 }} value={p.a} onChangeText={(t) => update(p.id, { a: t })} decimal suffix={len} placeholder={p.shape === 'rect' ? 'Length' : 'Base'} testID={`${testID}-a-${i}`} />
                <T v="h3" muted>
                  {'\u00D7'}
                </T>
                <Field style={{ flex: 1 }} value={p.b} onChangeText={(t) => update(p.id, { b: t })} decimal suffix={len} placeholder={p.shape === 'rect' ? 'Width' : 'Height'} testID={`${testID}-b-${i}`} />
              </View>
            )}
          </View>
        );
      })}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button size="md" variant="outline" icon="plus" title="Add shape" flex onPress={() => add(false)} testID={`${testID}-add`} />
        <Button size="md" variant="outline" icon="minus" title="Cut-out" flex onPress={() => add(true)} testID={`${testID}-subtract`} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, paddingTop: 2 }}>
        <T v="bodyStrong">Total</T>
        {result.total ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <T v="numLg" testID={`${testID}-total`}>
              {number(result.total)} {area}
            </T>
            <Tick />
          </View>
        ) : (
          <T v="smallStrong" color={c.uncertain}>
            {result.issue}
          </T>
        )}
      </View>
      {result.subtracted.sign() > 0 && result.total ? (
        <T v="small" muted style={{ paddingHorizontal: 4 }}>
          {number(result.added)} {area} measured, {number(result.subtracted)} {area} taken out.
        </T>
      ) : null}
    </View>
  );
}

// ---------- Time & cost rows ----------

export function TimeRow({ label, entry, onChange, placeholder, hint, testID }: { label: string; entry: { state: InputState; minutes: string }; onChange: (state: InputState, minutes: string) => void; placeholder?: string; hint?: string; testID?: string }) {
  const none = entry.state === 'known_zero' || entry.state === 'not_applicable';
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <T v="bodyStrong" style={{ flex: 1 }}>
          {label}
        </T>
        <Chip small label="None" selected={none} onPress={() => onChange(none ? 'unknown' : 'known_zero', '')} testID={testID ? `${testID}-none` : undefined} />
      </View>
      {!none ? (
        <Field
          value={entry.state === 'known_value' ? entry.minutes : ''}
          onChangeText={(t) => onChange(t ? 'known_value' : 'unknown', t)}
          decimal
          maxDecimals={0}
          suffix="min"
          placeholder={placeholder ?? 'Not set'}
          hint={entry.state === 'known_value' && entry.minutes ? duration(Number(entry.minutes)) : hint}
          testID={testID}
        />
      ) : null}
    </View>
  );
}

export function CostRow<E extends { state: InputState; amount: string; basis: 'visit' | 'hour' }>({ label, entry, onChange, testID }: { label: string; entry: E; onChange: (next: E) => void; testID?: string }) {
  const none = entry.state === 'known_zero' || entry.state === 'not_applicable';
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <T v="bodyStrong" style={{ flex: 1 }}>
          {label}
        </T>
        <Chip small label="None" selected={none} onPress={() => onChange({ ...entry, state: none ? 'unknown' : 'known_zero', amount: '' })} testID={testID ? `${testID}-none` : undefined} />
      </View>
      {!none ? (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Field
            style={{ flex: 1 }}
            value={entry.state === 'known_value' ? entry.amount : ''}
            onChangeText={(t) => onChange({ ...entry, state: t ? 'known_value' : 'unknown', amount: t })}
            prefix="$"
            decimal
            maxDecimals={2}
            placeholder="Not set"
            testID={testID}
          />
          <View style={{ width: 132 }}>
            <Segmented
              compact
              options={[
                { value: 'visit', label: '/visit' },
                { value: 'hour', label: '/hour' },
              ]}
              value={entry.basis}
              onChange={(v) => onChange({ ...entry, basis: v })}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

// ---------- Offer ----------

/** A calm, dismissible offer after a free quote. It never interrupts the send flow. */
/** One calm, dismissible line: tap to act, X to put it away. */
export function NoticeCard({
  icon,
  title,
  body,
  onOpen,
  onDismiss,
  testID,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  title: string;
  body: string;
  onOpen: () => void;
  onDismiss: () => void;
  testID: string;
}) {
  const c = useColors();
  return (
    <Card tone="alt" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }} testID={testID}>
      <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${title}. ${body}`} style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, opacity: pressed ? 0.6 : 1 })} testID={`${testID}-open`}>
        <Feather name={icon} size={18} color={c.foreground} />
        <View style={{ flex: 1 }}>
          <T v="bodyStrong">{title}</T>
          <T v="small" muted>
            {body}
          </T>
        </View>
      </Pressable>
      <IconButton icon="x" label="Dismiss" size={32} onPress={onDismiss} testID={`${testID}-dismiss`} />
    </Card>
  );
}

export function OfferCard({ remaining, onOpen, onDismiss }: { remaining: number; onOpen: () => void; onDismiss: () => void }) {
  return <NoticeCard icon="star" title={`${remaining} free ${remaining === 1 ? 'quote' : 'quotes'} left`} body="See what Pro adds" onOpen={onOpen} onDismiss={onDismiss} testID="offer-card" />;
}
