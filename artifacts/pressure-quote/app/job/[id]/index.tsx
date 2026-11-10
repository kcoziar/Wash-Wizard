import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { LineCard, QuestionCard, StatusChip } from '@/components/job';
import { Banner, Button, Card, Chip, EmptyState, Field, HeroCard, IconButton, PassMoney, Screen, SectionLabel, Sheet, T, haptic } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { SERVICE_META, newLine } from '@/lib/defaults';
import { duration, money, percent } from '@/lib/format';
import { confirmQuantities, resolveQuestion, unconfirmed, type Resolution } from '@/lib/resolve';
import { useJob, useStore, withDraft } from '@/lib/store';
import { latestRevision, useJobCalc } from '@/lib/useQuote';
import type { Line, RatedKind, ServiceKind } from '@/lib/types';

const ADD: ServiceKind[] = ['driveway', 'walkway', 'patio', 'stairs', 'custom'];
const ADD_ICON: Record<ServiceKind, React.ComponentProps<typeof Chip>['mci']> = {
  driveway: 'road-variant',
  walkway: 'walk',
  patio: 'view-grid-outline',
  stairs: 'stairs',
  custom: 'plus-circle-outline',
};

export default function JobScreen() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useStore();
  const job = useJob(id);
  const { calc, issues, econ } = useJobCalc(job, store.settings);
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [moreContact, setMoreContact] = useState(false);
  const [showRequest, setShowRequest] = useState(false);

  if (!store.ready) return <View style={{ flex: 1, backgroundColor: c.background }} />;
  if (!job || !calc) {
    return (
      <Screen title="Job">
        <EmptyState icon="inbox" title="This job is no longer here" body="It may have been deleted." action={<Button title="Back to jobs" onPress={() => router.replace('/jobs')} />} />
      </Screen>
    );
  }

  const latest = latestRevision(job);
  const dirty = !!latest && !!job.dirtySince;
  const d = job.draft;
  const pending = unconfirmed(d);
  const openQuestions = d.questions.filter((q) => !q.resolved);
  const customerChanged = !!latest && (d.customer.name.trim() !== latest.doc.customer.name || d.customer.address.trim() !== latest.doc.customer.address);

  const setLine = (next: Line) => store.updateDraft(job.id, (dr) => ({ ...dr, lines: dr.lines.map((l) => (l.id === next.id ? next : l)) }));
  const saveRate = (line: Line) => {
    const kind = line.kind as RatedKind;
    store.updateSettings((s) => ({ ...s, rates: { ...s.rates, [kind]: { ...s.rates[kind], rate: line.rate, unit: line.unit, qtyType: line.qtyType } } }));
    setLine({ ...line, rateSource: 'saved' });
    haptic('success');
  };
  const addLine = (kind: ServiceKind) => {
    const line = newLine(kind, store.settings);
    store.updateDraft(job.id, (dr) => ({ ...dr, lines: [...dr.lines, line] }));
    if (kind === 'custom') router.push({ pathname: '/job/[id]/line', params: { id: job.id, lineId: line.id } });
  };
  const resolve = (questionId: string, r: Resolution): string | null => {
    const res = resolveQuestion(job.draft, questionId, r, store.settings);
    if (!res.ok) return res.error;
    store.updateJob(job.id, (j) => ({
      ...withDraft(j, res.draft),
      privateNotes: res.privateNote ? [j.privateNotes.trim(), res.privateNote].filter(Boolean).join('\n') : j.privateNotes,
    }));
    return null;
  };
  const setCustomer = (patch: Partial<typeof d.customer>) => store.updateDraft(job.id, (dr) => ({ ...dr, customer: { ...dr.customer, ...patch, source: 'operator' } }));

  const p = d.pricing;
  const pricingSummary = [
    p.minimum.state === 'known_value' && p.minimum.amount ? `Minimum $${p.minimum.amount}` : null,
    p.trip.state === 'known_value' && p.trip.amount ? `Trip $${p.trip.amount}` : null,
    p.discount.kind !== 'none' && p.discount.value ? `Discount ${p.discount.kind === 'percent' ? `${p.discount.value}%` : `$${p.discount.value}`}` : null,
    p.tax.state === 'known_value' && p.tax.rate ? `Tax ${p.tax.rate}%` : p.tax.state === 'known_zero' ? 'No tax' : null,
    p.deposit.kind !== 'none' && p.deposit.value ? `Deposit ${p.deposit.kind === 'percent' ? `${p.deposit.value}%` : `$${p.deposit.value}`}` : null,
  ].filter(Boolean) as string[];

  const perHour = econ?.availablePerHour ?? econ?.revenuePerHour ?? null;
  const soFar = calc.lines.filter((l) => l.kind !== 'minimum' && l.treatment === 'priced' && l.missing.length === 0 && !l.issue).reduce((t, l) => t + l.amount, 0);
  const ctaTitle = !latest ? 'Review & create quote' : dirty ? `Review update ${job.sample ? '' : `R${job.revisions.length + 1}`}`.trim() : `Open quote ${latest.reference}`;

  return (
    <Screen
      title={job.draft.customer.name.trim() || job.label}
      subtitle={latest ? `${latest.reference}${dirty ? ' · edited' : ''}` : job.sample ? 'Sample job' : 'Draft · saved as you go'}
      right={<IconButton icon="more-horizontal" label="More actions" onPress={() => setMenu(true)} testID="job-menu" />}
      footer={<Button title={ctaTitle} icon={latest && !dirty ? 'file-text' : 'arrow-right'} variant={latest && !dirty ? 'secondary' : 'primary'} onPress={() => router.push({ pathname: '/job/[id]/preview', params: { id: job.id } })} testID="job-review" />}
    >
      <HeroCard style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <T v="label" color={c.heroMuted}>
            Quote total
          </T>
          <StatusChip status={job.status} sample={job.sample} hero />
        </View>
        <PassMoney cents={calc.complete ? calc.total : null} color={c.heroForeground} testID="job-total" />
        {!calc.complete && soFar > 0 ? (
          <T v="small" color={c.heroMuted} testID="job-so-far">
            {money(soFar)} priced so far, before tax
          </T>
        ) : null}
        {issues.length ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.heroWarn }} />
            <T v="smallStrong" color={c.heroWarn} testID="job-issue-count">
              {issues.length === 1 ? issues[0].text : `${issues.length} things to finish before you can send`}
            </T>
          </View>
        ) : (
          <T v="small" color={c.heroMuted}>
            {[
              `Services ${money(calc.linesTotal)}`,
              calc.minimum.adjustment > 0 ? `minimum +${money(calc.minimum.adjustment)}` : null,
              calc.discount.applied > 0 ? `${calc.discount.label.toLowerCase()} \u2212${money(calc.discount.applied)}` : null,
              calc.tax.amount > 0 ? `tax ${money(calc.tax.amount)}` : null,
              calc.deposit && calc.deposit.amount > 0 ? `deposit ${money(calc.deposit.amount)}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </T>
        )}
        <Pressable
          testID="job-earnings"
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/job/[id]/earnings', params: { id: job.id } })}
          style={({ pressed }) => ({ marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12, padding: 12, opacity: pressed ? 0.7 : 1 })}
        >
          <Feather name="eye-off" size={16} color={c.accent} />
          <View style={{ flex: 1 }}>
            <T v="smallStrong" color={c.heroForeground}>
              {perHour != null && econ?.minutes
                ? `About ${money(Math.round(perHour), { noCents: true })}/h ${econ.availablePerHour != null ? 'for your time' : 'before costs'} · ${duration(econ.minutes)}`
                : 'Is this visit worth your time?'}
            </T>
            <T v="small" color={c.heroMuted}>
              {econ?.verdict === 'meets'
                ? `Meets your target${econ.margin != null ? ` · ${percent(econ.margin, 0)} margin after your pay` : ''}`
                : econ?.verdict === 'below'
                  ? 'Below your hourly target. Tap to see what price works.'
                  : 'Private to you. Never on the quote.'}
            </T>
          </View>
          <Feather name="chevron-right" size={16} color={c.heroMuted} />
        </Pressable>
      </HeroCard>

      {dirty ? (
        <Banner
          tone="info"
          icon="edit-3"
          title={`Changed since ${latest?.reference}`}
          body="Your customer still has the earlier version. Review to create an updated quote. Corrections never use a free quote."
        />
      ) : null}

      {openQuestions.length ? (
        <>
          <SectionLabel>From the customer's message</SectionLabel>
          {openQuestions.map((q) => (
            <QuestionCard key={q.id} question={q} lines={d.lines} onResolve={(r) => resolve(q.id, r)} testID={`question-${q.kind}`} />
          ))}
        </>
      ) : null}

      {d.customer.source === 'record' && (d.customer.name.trim() || d.customer.address.trim()) ? (
        <Card tone="uncertain" style={{ gap: 12 }} testID="customer-record">
          <T v="bodyStrong">Same customer as the earlier job?</T>
          <T v="body" muted>
            {[d.customer.name, d.customer.address].filter(Boolean).join(' · ')}
          </T>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button size="md" variant="outline" title="New customer" flex onPress={() => store.updateDraft(job.id, (dr) => ({ ...dr, customer: { name: '', phone: '', email: '', address: '', source: 'operator' } }))} />
            <Button size="md" title="Yes, same" flex onPress={() => store.updateDraft(job.id, (dr) => ({ ...dr, customer: { ...dr.customer, source: 'confirmed' } }))} testID="customer-record-confirm" />
          </View>
        </Card>
      ) : null}

      {pending.length > 1 ? (
        <Banner
          tone="warn"
          icon="message-circle"
          title={`${pending.length} sizes came from the customer`}
          body="Check them against what you know, or measure on site. Confirm when they look right."
          action={<Button size="sm" variant="outline" title="They look right" onPress={() => store.updateDraft(job.id, (dr) => confirmQuantities(dr))} testID="confirm-all-sizes" />}
        />
      ) : null}

      <SectionLabel>Services</SectionLabel>
      {d.lines.length === 0 ? (
        <Card tone="alt">
          <T v="body" muted>
            Add what you're cleaning. Each service prices itself from a size and your rate.
          </T>
        </Card>
      ) : null}
      {d.lines.map((line, i) => (
        <LineCard
          key={line.id}
          line={line}
          calcLine={calc.lines.find((cl) => cl.id === line.id)}
          settings={store.settings}
          onChange={setLine}
          onSaveRate={saveRate}
          onOpen={() => router.push({ pathname: '/job/[id]/line', params: { id: job.id, lineId: line.id } })}
          testID={`line-${i}`}
        />
      ))}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {ADD.map((k) => (
          <Chip key={k} small mci={ADD_ICON[k]} label={`${k === 'custom' ? 'Other' : SERVICE_META[k].name}`} icon={undefined} onPress={() => addLine(k)} testID={`add-${k}`} />
        ))}
      </View>

      <SectionLabel>Customer</SectionLabel>
      <Card style={{ gap: 12 }}>
        <Field label="Name" value={d.customer.name} onChangeText={(t) => setCustomer({ name: t })} placeholder="Who is this for?" autoCapitalize="words" testID="customer-name" textContentType="name" />
        <Field label="Address" value={d.customer.address} onChangeText={(t) => setCustomer({ address: t })} placeholder="Where is the job?" autoCapitalize="words" testID="customer-address" textContentType="fullStreetAddress" />
        {moreContact || d.customer.phone || d.customer.email ? (
          <>
            <Field label="Phone" value={d.customer.phone} onChangeText={(t) => setCustomer({ phone: t })} keyboardType="phone-pad" inputMode="tel" testID="customer-phone" />
            <Field label="Email" value={d.customer.email} onChangeText={(t) => setCustomer({ email: t })} keyboardType="email-address" inputMode="email" autoCapitalize="none" testID="customer-email" />
            <T v="small" muted>
              Phone and email stay in the app. The quote shows the name and address.
            </T>
          </>
        ) : (
          <Pressable onPress={() => setMoreContact(true)} hitSlop={8} accessibilityRole="button">
            <T v="smallStrong" muted>
              + Phone and email
            </T>
          </Pressable>
        )}
        {customerChanged ? (
          <Banner
            tone="warn"
            title="Quoting a different customer?"
            body="Start a copy for them instead, so this customer's quote history stays accurate."
            action={
              <Button
                size="sm"
                variant="outline"
                title="Duplicate for new customer"
                onPress={() => {
                  const copy = store.duplicateJob(job.id);
                  if (copy) router.replace({ pathname: '/job/[id]', params: { id: copy.id } });
                }}
              />
            }
          />
        ) : null}
      </Card>

      <SectionLabel>Visit pricing & terms</SectionLabel>
      <Card onPress={() => router.push({ pathname: '/job/[id]/pricing', params: { id: job.id } })} testID="open-pricing">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1, gap: 4 }}>
            <T v="bodyStrong">Minimum, trip, discount, tax, deposit</T>
            <T v="small" muted numberOfLines={2}>
              {pricingSummary.length ? pricingSummary.join(' · ') : 'Nothing extra on this visit'}
              {calc.discount.conflict && p.minimumDecision === 'unset' ? ' · needs a decision' : ''}
            </T>
          </View>
          <Feather name="chevron-right" size={18} color={c.faint} />
        </View>
      </Card>

      <SectionLabel>Private</SectionLabel>
      <Card style={{ gap: 12 }}>
        <Field label="Private notes" value={job.privateNotes} onChangeText={(t) => store.updateJob(job.id, (j) => ({ ...j, privateNotes: t }))} multiline placeholder="Gate code, dog in yard, oil stain by garage..." testID="private-notes" />
        {d.budget.state === 'known_value' ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Feather name="eye-off" size={14} color={c.mutedForeground} />
            <T v="small" muted style={{ flex: 1 }}>
              Customer budget: ${d.budget.amount}. Never shown on the quote.
            </T>
          </View>
        ) : null}
        {job.request ? (
          <View style={{ gap: 6 }}>
            <Pressable onPress={() => setShowRequest((v) => !v)} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Feather name={showRequest ? 'chevron-down' : 'chevron-right'} size={16} color={c.mutedForeground} />
              <T v="smallStrong" muted>
                Original message
              </T>
            </Pressable>
            {showRequest ? (
              <T v="small" muted selectable>
                {job.request.text}
              </T>
            ) : null}
          </View>
        ) : null}
      </Card>

      <Sheet visible={menu} onClose={() => setMenu(false)} title={job.label}>
        <Button
          variant="secondary"
          icon="copy"
          title="Duplicate as a new job"
          onPress={() => {
            setMenu(false);
            const copy = store.duplicateJob(job.id);
            if (copy) router.push({ pathname: '/job/[id]', params: { id: copy.id } });
          }}
          testID="menu-duplicate"
        />
        {latest && (job.status === 'sent' || job.status === 'accepted') ? (
          <Button
            variant="secondary"
            icon="check-square"
            title="Finish job & recap"
            onPress={() => {
              setMenu(false);
              router.push({ pathname: '/job/[id]/finish', params: { id: job.id } });
            }}
          />
        ) : null}
        <Button
          variant="danger"
          icon="trash-2"
          title={job.sample ? 'Delete sample' : 'Delete job'}
          onPress={() => {
            setMenu(false);
            setConfirmDelete(true);
          }}
          testID="menu-delete"
        />
      </Sheet>

      <Sheet
        visible={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={job.sample ? 'Delete the sample?' : 'Delete this job?'}
        body={latest ? `This removes the job and its quote history (${job.revisions.map((r) => r.reference).join(', ')}) from this iPhone. Free quotes already used are not returned.` : 'This removes the draft from this iPhone.'}
        actions={
          <>
            <Button
              variant="danger"
              title="Delete"
              onPress={async () => {
                setConfirmDelete(false);
                await store.deleteJob(job.id);
                router.back();
              }}
              testID="confirm-delete"
            />
            <Button variant="ghost" title="Keep it" onPress={() => setConfirmDelete(false)} />
          </>
        }
      />
    </Screen>
  );
}
