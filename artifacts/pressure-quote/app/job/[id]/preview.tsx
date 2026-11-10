import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { QuoteDocView } from '@/components/QuoteDocView';
import { OfferCard, STATUS_LABEL } from '@/components/job';
import { Banner, Button, Card, Chip, EmptyState, Field, IconButton, Screen, SectionLabel, Sheet, T, TextLink, haptic, type TextInputHandle } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { date, makeId, money, shortDate } from '@/lib/format';
import { track, trackQuoteCreated } from '@/lib/analytics';
import { canText, copyText, printDoc, sharePdf, shareText, smsAddress, textQuote, type ShareResult } from '@/lib/output';
import { takeResume } from '@/lib/resume';
import { useSubscription } from '@/lib/revenuecat';
import { useJob, useStore } from '@/lib/store';
import { draftDoc, latestRevision, revisionReference, useCreateQuote, useJobCalc, useReviewPrompt } from '@/lib/useQuote';
import type { Issue } from '@/lib/pricing';
import { FREE_QUOTES, type JobStatus, type QuoteDoc, type Revision, type ShareRecord } from '@/lib/types';

const isWeb = Platform.OS === 'web';
const STATUS_CHOICES: JobStatus[] = ['quoted', 'sent', 'accepted', 'declined'];

export default function PreviewScreen() {
  const c = useColors();
  const { id, rev, from } = useLocalSearchParams<{ id: string; rev?: string; from?: string }>();
  const store = useStore();
  const sub = useSubscription();
  const job = useJob(id);
  const { calc, issues } = useJobCalc(job, store.settings);
  const { preview, create } = useCreateQuote();
  const askReview = useReviewPrompt();
  const focused = useIsFocused();

  const [busy, setBusy] = useState(false);
  const [askSent, setAskSent] = useState<Revision | null>(null);
  const [pdfFailed, setPdfFailed] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'warn' | 'danger' | 'info'; text: string } | null>(null);
  const [justCreated, setJustCreated] = useState<string | null>(null);
  const [newVisit, setNewVisit] = useState(false);
  const [smsReady, setSmsReady] = useState(false);
  /** The quote that used the last free quote, so its share flow can end with the one-time notice. */
  const lastFreeRef = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    canText().then((ok) => {
      if (live) setSmsReady(ok);
    });
    return () => {
      live = false;
    };
  }, []);

  // The business block is decided once, when the screen opens, and stays until the user leaves.
  // Typing is held locally and saved on blur and on Create, so the field never vanishes mid-word.
  const [askBusiness, setAskBusiness] = useState<boolean | null>(null);
  const [bizName, setBizName] = useState('');
  const [bizPhone, setBizPhone] = useState('');
  const nameRef = useRef<TextInputHandle>(null);
  useEffect(() => {
    if (askBusiness !== null || !store.ready || !job) return;
    const missing = !store.settings.business.name.trim() && !job.sample;
    setAskBusiness(missing);
    if (missing) setBizPhone(store.settings.business.phone);
  }, [askBusiness, store.ready, store.settings.business, job]);

  const saveBusiness = () => {
    if (!askBusiness) return;
    const name = bizName.trim();
    const phone = bizPhone.trim();
    const cur = store.peekSettings().business;
    if (name === cur.name && phone === cur.phone) return;
    store.updateSettings((st) => ({ ...st, business: { ...st.business, name: name || st.business.name, phone } }));
  };

  const latest = latestRevision(job);
  const dirty = !!latest && !!job?.dirtySince;
  const viewing: Revision | null = useMemo(() => {
    if (!job) return null;
    if (rev) return job.revisions.find((r) => r.id === rev) ?? null;
    if (latest && (!dirty || justCreated === latest.id)) return latest;
    return null;
  }, [job, rev, latest, dirty, justCreated]);

  const doc: QuoteDoc | null = useMemo(() => {
    if (!job || !calc) return null;
    if (viewing) return viewing.doc;
    // The name and phone being typed above show on the preview straight away, before they are saved.
    const typed = askBusiness ? { ...store.settings, business: { ...store.settings.business, name: bizName.trim() || store.settings.business.name, phone: bizPhone.trim() } } : store.settings;
    return draftDoc(job, calc, typed);
  }, [job, calc, viewing, store.settings, askBusiness, bizName, bizPhone]);

  // The customer's number is private. It is only used to address a text the operator sends.
  const smsTo = job && !job.sample ? smsAddress(job.draft.customer.phone) : null;
  const firstName = job?.draft.customer.name.trim().split(/\s+/)[0] ?? '';
  const canSms = smsReady && !!smsTo;
  const textLabel = firstName ? `Text to ${firstName}` : 'Text the quote';

  const record = (revisionId: string, channel: ShareRecord['channel'], state: ShareRecord['state']) => {
    if (!job) return;
    store.updateJob(job.id, (j) => ({ ...j, shares: [...j.shares, { id: makeId('s'), revisionId, at: Date.now(), channel, state }] }));
  };

  /** Runs when the share flow for a quote ends, whatever the answer was. */
  const afterShareFlow = (revision: Revision, sent: boolean) => {
    if (lastFreeRef.current === revision.id && !store.peekMeta().lastFreeNoticeShown) {
      lastFreeRef.current = null;
      store.updateMeta((m) => ({ ...m, lastFreeNoticeShown: true }));
      setTimeout(() => router.push({ pathname: '/paywall', params: { from: 'last-free', job: revision.id } }), 350);
      return;
    }
  };

  const shareRevisionPdf = async (revision: Revision, pdfUri?: string | null): Promise<ShareResult> => {
    const res = await sharePdf(revision.doc, pdfUri ?? undefined);
    record(revision.id, 'pdf', res);
    if (res === 'failed') setNotice({ tone: 'warn', text: 'The PDF could not be shared from this device. Share the quote as text instead.' });
    return res;
  };

  /** Messages opens with the number, the PDF and a short note. Nothing is marked Sent here. */
  const sendByText = async (revision: Revision, pdfUri?: string | null): Promise<'asked' | 'done'> => {
    if (!smsTo) return 'done';
    const r = await textQuote(smsTo, revision.doc, pdfUri ?? null);
    track('text_send_used');
    record(revision.id, 'sms', r === 'sent' ? 'sent' : r === 'cancelled' ? 'cancelled' : r === 'failed' ? 'failed' : 'opened');
    if (r === 'failed') setNotice({ tone: 'warn', text: 'Messages did not open. Share the PDF instead.' });
    if (r === 'sent' || r === 'unknown') {
      setAskSent(revision);
      return 'asked';
    }
    return 'done';
  };

  const runCreate = async (allowTextOnly = false) => {
    if (busy || !job) return;
    const jobId = job.id;
    setBusy(true);
    setNotice(null);
    try {
      saveBusiness();
      await store.flush();
      const before = preview(store.peekJob(jobId) ?? job);
      const res = await create(job, { allowTextOnly });
      if (res.kind === 'issues') {
        setNotice({ tone: 'warn', text: 'A few things still need an answer. They are listed above.' });
        return;
      }
      if (res.kind === 'new_visit') {
        setNewVisit(true);
        return;
      }
      if (res.kind === 'blocked') {
        const reason = res.decision.kind === 'blocked' ? res.decision.reason : null;
        if (reason === 'exhausted' || reason === 'unreachable') router.push({ pathname: '/paywall', params: { from: 'limit', job: jobId } });
        else if (reason === 'pending') setNotice({ tone: 'info', text: 'Your purchase is waiting for approval. Your draft is saved; create the quote as soon as it goes through.' });
        else setNotice({ tone: 'info', text: 'Still checking your subscription. Try again in a moment. Your draft is saved.' });
        return;
      }
      if (res.kind === 'pdf_failed') {
        setPdfFailed(res.error);
        return;
      }
      if (res.kind === 'conflict') {
        setNotice({ tone: 'warn', text: res.message });
        return;
      }
      if (res.kind === 'error') {
        setNotice({ tone: res.committed === 'no' ? 'danger' : 'warn', text: res.message });
        return;
      }
      haptic('success');
      setJustCreated(res.revision.id);
      if (!res.repeated && !job.sample && res.revision.number === 1) {
        trackQuoteCreated(store.jobs.filter((j) => !j.sample && j.revisions.length > 0 && j.id !== jobId).length + 1);
      }
      if (!res.repeated && res.revision.mode === 'free' && before.kind === 'free' && before.remaining <= 1) lastFreeRef.current = res.revision.id;
      if (isWeb) {
        // No share sheet in the browser preview; the flow ends here.
        afterShareFlow(res.revision, false);
        return;
      }
      if (canSms) {
        if ((await sendByText(res.revision, res.pdfUri)) === 'done') afterShareFlow(res.revision, false);
        return;
      }
      let shared: ShareResult;
      if (res.pdfUri) {
        shared = await shareRevisionPdf(res.revision, res.pdfUri);
      } else {
        shared = await shareText(res.revision.doc);
        record(res.revision.id, 'text', shared);
        if (shared === 'failed') setNotice({ tone: 'warn', text: 'The share sheet did not open. Use Text or Copy below to send the quote.' });
      }
      // A share that never opened cannot have gone out, so there is nothing to ask.
      if (shared !== 'failed') setAskSent(res.revision);
      else afterShareFlow(res.revision, false);
    } finally {
      setBusy(false);
    }
  };

  // Back from a purchase made at the free-quote limit: create the quote without a second tap.
  useEffect(() => {
    if (!focused || !store.ready || !job) return;
    if (takeResume(job.id)) runCreate(false);
    // Only when the screen regains focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused, store.ready, job?.id]);

  if (!store.ready) return <View style={{ flex: 1, backgroundColor: c.background }} />;
  if (!job || !calc || !doc) {
    return (
      <Screen title="Quote">
        <EmptyState icon="file-text" title="This quote is no longer here" action={<Button title="Back" onPress={() => router.back()} />} />
      </Screen>
    );
  }

  const editButton = (
    <IconButton
      icon="edit-3"
      label="Edit job"
      tone="filled"
      testID="preview-edit"
      onPress={() => (from === 'home' || !router.canGoBack() ? router.replace({ pathname: '/job/[id]', params: { id: job.id } }) : router.back())}
    />
  );

  const setStatus = (status: JobStatus) => {
    store.updateJob(job.id, (j) => ({ ...j, status }));
    if (viewing && status === 'sent') record(viewing.id, 'pdf', 'marked_sent');
    if (status === 'accepted' && job.status !== 'accepted' && !job.sample) {
      store.noteMeaningful();
      // Give the status change a moment to land before the system sheet can appear.
      setTimeout(() => askReview().catch(() => undefined), 700);
    }
  };

  const remaining = Math.max(0, FREE_QUOTES - store.freeUsed);
  const showOfferCard = !sub.isPro && sub.status !== 'checking' && store.freeUsed >= 1 && remaining > 0 && !store.meta.offerCardDismissed;

  // ---------- Frozen quote view ----------
  if (viewing) {
    const shares = job.shares.filter((s) => s.revisionId === viewing.id);
    const isLatest = latest?.id === viewing.id;
    return (
      <Screen
        title={viewing.reference}
        subtitle={`Created ${date(viewing.createdAt)}`}
        right={editButton}
        footer={
          <>
            {isWeb ? (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Button title="Print / PDF" icon="printer" flex onPress={() => printDoc(viewing.doc).then((ok) => !ok && setNotice({ tone: 'warn', text: 'Printing is not available here.' }))} testID="preview-print" />
                <Button title="Copy text" variant="secondary" icon="copy" flex onPress={async () => { const ok = await copyText(viewing.doc); record(viewing.id, 'copy', ok ? 'opened' : 'failed'); setNotice(ok ? { tone: 'success', text: 'Quote copied. Paste it into a text or email.' } : { tone: 'warn', text: 'Copy did not work here.' }); }} testID="preview-copy" />
              </View>
            ) : canSms ? (
              <>
                <Button
                  title={textLabel}
                  icon="message-circle"
                  loading={busy}
                  onPress={async () => {
                    if (busy) return;
                    setBusy(true);
                    try {
                      const r = await textQuote(smsTo ?? '', viewing.doc, null);
                      track('text_send_used');
                      record(viewing.id, 'sms', r === 'sent' ? 'sent' : r === 'cancelled' ? 'cancelled' : r === 'failed' ? 'failed' : 'opened');
                      if (r === 'failed') setNotice({ tone: 'warn', text: 'Messages did not open. Share the PDF instead.' });
                      else if ((r === 'sent' || r === 'unknown') && job.status === 'quoted') setAskSent(viewing);
                    } finally {
                      setBusy(false);
                    }
                  }}
                  testID="preview-sms"
                />
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Button title="Share PDF" size="md" variant="secondary" icon="share" flex onPress={async () => { const r = await shareRevisionPdf(viewing); if (r !== 'failed' && job.status === 'quoted') setAskSent(viewing); }} testID="preview-share-pdf" />
                  <Button title="Copy" size="md" variant="secondary" icon="copy" flex onPress={async () => { const ok = await copyText(viewing.doc); record(viewing.id, 'copy', ok ? 'opened' : 'failed'); setNotice(ok ? { tone: 'success', text: 'Quote copied. Paste it into a text or email.' } : { tone: 'warn', text: 'Copy did not work.' }); }} testID="preview-copy" />
                </View>
              </>
            ) : (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Button title="Share PDF" icon="share" flex onPress={async () => { const r = await shareRevisionPdf(viewing); if (r !== 'failed' && job.status === 'quoted') setAskSent(viewing); }} testID="preview-share-pdf" />
                <Button title="Text" variant="secondary" icon="message-square" onPress={async () => { const r = await shareText(viewing.doc); record(viewing.id, 'text', r); if (r !== 'failed' && job.status === 'quoted') setAskSent(viewing); }} testID="preview-share-text" />
                <Button title="Copy" variant="secondary" icon="copy" onPress={async () => { const ok = await copyText(viewing.doc); record(viewing.id, 'copy', ok ? 'opened' : 'failed'); setNotice(ok ? { tone: 'success', text: 'Quote copied. Paste it into a text or email.' } : { tone: 'warn', text: 'Copy did not work.' }); }} testID="preview-copy" />
              </View>
            )}
          </>
        }
      >
        {justCreated === viewing.id ? (
          <Animated.View entering={FadeInDown.duration(380)}>
            <Card tone="confirm" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.confirm, alignItems: 'center', justifyContent: 'center' }}>
                <Feather name="check" size={20} color={c.card} />
              </View>
              <View style={{ flex: 1 }}>
                <T v="bodyStrong">Quote {viewing.reference} is ready</T>
                <T v="small" muted>
                  {money(viewing.doc.total)} · saved with this job
                </T>
              </View>
            </Card>
          </Animated.View>
        ) : null}
        {notice ? <Banner tone={notice.tone} title={notice.text} /> : null}
        {showOfferCard && isLatest && viewing.mode === 'free' ? (
          <OfferCard
            remaining={remaining}
            onOpen={() => router.push({ pathname: '/paywall', params: { from: 'first', ref: viewing.reference, job: job.id } })}
            onDismiss={() => store.updateMeta((m) => ({ ...m, offerCardDismissed: true }))}
          />
        ) : null}
        {isLatest && dirty && justCreated !== viewing.id ? (
          <Banner
            tone="info"
            icon="edit-3"
            title="The job changed after this quote"
            body="Your customer has this version. Review the changes to create an update."
            action={<Button size="sm" variant="outline" title="Review update" onPress={() => router.replace({ pathname: '/job/[id]/preview', params: { id: job.id } })} />}
          />
        ) : null}
        {!isLatest ? <Banner tone="info" icon="clock" title="Earlier version" body={`The latest is ${latest?.reference}.`} /> : null}

        {isLatest ? (
          <>
            <SectionLabel>Status</SectionLabel>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {STATUS_CHOICES.map((s) => (
                <Chip key={s} small label={STATUS_LABEL[s]} selected={job.status === s} onPress={() => setStatus(s)} testID={`status-${s}`} />
              ))}
              {job.status === 'completed' ? <Chip small label="Completed" selected /> : null}
            </View>
            {job.status === 'sent' || job.status === 'accepted' ? (
              <Button variant="outline" icon="check-square" title="Job done? Add a quick recap" onPress={() => router.push({ pathname: '/job/[id]/finish', params: { id: job.id } })} testID="preview-finish" />
            ) : null}
            {job.status === 'completed' ? (
              <Button
                variant="outline"
                icon="bar-chart-2"
                title={job.outcome ? 'Recap: estimated vs actual' : 'Add a quick recap'}
                onPress={() => router.push({ pathname: '/job/[id]/finish', params: { id: job.id } })}
                testID="preview-recap"
              />
            ) : null}
          </>
        ) : null}

        <Animated.View entering={FadeIn.duration(300)}>
          <QuoteDocView doc={viewing.doc} testID="quote-doc" />
        </Animated.View>

        {isLatest && !job.sample ? (
          <TextLink
            title="Duplicate for another visit"
            icon="copy"
            onPress={() => {
              const copy = store.duplicateJob(job.id);
              if (copy) router.push({ pathname: '/job/[id]', params: { id: copy.id } });
            }}
            testID="preview-duplicate"
          />
        ) : null}

        {shares.length ? (
          <>
            <SectionLabel>Activity</SectionLabel>
            <Card style={{ gap: 6 }}>
              {shares
                .slice()
                .reverse()
                .slice(0, 8)
                .map((s) => (
                  <View key={s.id} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <T v="small">{shareLabel(s)}</T>
                    <T v="small" muted>
                      {shortDate(s.at)}
                    </T>
                  </View>
                ))}
              <T v="small" muted style={{ marginTop: 4 }}>
                Opening Messages or the share sheet doesn't confirm the customer got it. Mark it Sent when you know.
              </T>
            </Card>
          </>
        ) : null}

        {job.revisions.length > 1 ? (
          <>
            <SectionLabel>All versions</SectionLabel>
            <Card style={{ paddingVertical: 4 }}>
              {job.revisions
                .slice()
                .reverse()
                .map((r) => (
                  <Pressable
                    key={r.id}
                    onPress={() => router.setParams({ rev: r.id })}
                    accessibilityRole="button"
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 10, opacity: pressed ? 0.6 : 1 })}
                  >
                    <Feather name={r.id === viewing.id ? 'disc' : 'circle'} size={14} color={r.id === viewing.id ? c.foreground : c.faint} />
                    <T v="bodyStrong" style={{ flex: 1 }}>
                      {r.reference}
                    </T>
                    <T v="small" muted>
                      {date(r.createdAt)}
                    </T>
                    <T v="num">{money(r.doc.total)}</T>
                  </Pressable>
                ))}
            </Card>
          </>
        ) : null}

        <SentSheet
          revision={askSent}
          onClose={(sent) => {
            const r = askSent;
            setAskSent(null);
            if (!r) return;
            if (sent) {
              store.updateJob(job.id, (j) => ({ ...j, status: j.status === 'quoted' || j.status === 'draft' ? 'sent' : j.status }));
              record(r.id, 'pdf', 'marked_sent');
            }
            afterShareFlow(r, sent);
          }}
        />
      </Screen>
    );
  }

  // ---------- Draft preview ----------
  const decision = preview(job);
  const nextRef = revisionReference(job, job.revisions.length + 1);
  // A name typed here counts straight away; it is saved on blur and again on Create.
  const open = issues.filter((i) => !(i.key === 'business' && bizName.trim()));
  const onlyBusiness = open.length === 1 && open[0].key === 'business';
  const fixIssue = (i: Issue) => {
    if (i.key === 'business') nameRef.current?.focus();
    else if (i.lineId) router.push({ pathname: '/job/[id]/line', params: { id: job.id, lineId: i.lineId } });
    else if (['minimum', 'trip', 'discount', 'tax', 'deposit'].some((k) => i.key.startsWith(k))) router.push({ pathname: '/job/[id]/pricing', params: { id: job.id } });
    else if (from === 'home' || !router.canGoBack()) router.replace({ pathname: '/job/[id]', params: { id: job.id } });
    else router.back();
  };

  let access: React.ReactNode = null;
  const sendWord = canSms ? (firstName ? `text to ${firstName}` : 'text') : 'share';
  let cta: { title: string; onPress: () => void; icon: React.ComponentProps<typeof Feather>['name'] } = {
    title: latest ? `Create update ${nextRef} & ${sendWord}` : `Create & ${sendWord}${canSms ? '' : ' quote'}`,
    onPress: () => runCreate(false),
    icon: canSms ? 'message-circle' : 'send',
  };
  if (onlyBusiness) {
    cta = { title: 'Add your business name to send', onPress: () => fixIssue(open[0]), icon: 'edit-3' };
  } else if (open.length) {
    cta = { title: `Finish ${open.length} ${open.length === 1 ? 'item' : 'items'} first`, onPress: () => fixIssue(open.find((i) => i.key !== 'business') ?? open[0]), icon: 'arrow-up' };
  } else if (decision.kind === 'free') {
    access = <Banner tone="info" icon="gift" title="Creating this quote uses 1 of your 3 free quotes. Drafts, corrections and re-sharing are free." body={`${decision.remaining} of 3 left.`} testID="access-free" />;
  } else if (decision.kind === 'pro') {
    access = <Banner tone="success" icon="star" title="Pro: unlimited quotes" testID="access-pro" />;
  } else if (decision.kind === 'revision') {
    access = <Banner tone="info" icon="edit-3" title={`This creates ${nextRef}. Corrections are always free.`} body={`${latest?.reference} stays in the history.`} testID="access-revision" />;
  } else if (decision.kind === 'new_visit') {
    access = (
      <Banner
        tone="info"
        icon="copy"
        title="This is a different customer and address"
        body={`Corrections to ${latest?.reference ?? 'a quote'} are free. A different visit gets its own quote, and ${latest?.reference ?? 'the original'} stays as it was.`}
        testID="access-new-visit"
      />
    );
    cta = { title: 'Start a separate quote', onPress: () => setNewVisit(true), icon: 'copy' };
  } else if (decision.kind === 'sample') {
    access = <Banner tone="info" icon="file-text" title="Sample quotes are free and marked SAMPLE." testID="access-sample" />;
  } else if (decision.kind === 'blocked') {
    if (decision.reason === 'exhausted') {
      access = <Banner tone="info" icon="star" title="You've used your 3 free quotes" body="Your draft is saved. Pro creates unlimited quotes. Revisions and re-sharing stay free either way." testID="access-blocked" />;
      cta = { title: 'Unlock unlimited quotes', onPress: () => router.push({ pathname: '/paywall', params: { from: 'limit', job: job.id } }), icon: 'star' };
    } else if (decision.reason === 'pending') {
      access = <Banner tone="warn" title="Your purchase is waiting for approval" body="Nothing more to buy. Your draft is saved; create the quote once it goes through." testID="access-pending" />;
      cta = { title: 'Check again', onPress: () => sub.refresh(), icon: 'refresh-cw' };
    } else if (decision.reason === 'unreachable') {
      access = <Banner tone="warn" icon="wifi-off" title="Your free quotes are used, and the App Store can't be reached" body="If you have Pro, it isn't lost. Your draft is saved; try again when you're online." testID="access-unreachable" />;
      cta = { title: 'Check again', onPress: () => sub.refresh(), icon: 'refresh-cw' };
    } else {
      access = <Banner tone="info" title="Checking your subscription..." testID="access-checking" />;
      cta = { title: 'Check again', onPress: () => sub.refresh(), icon: 'refresh-cw' };
    }
  }

  return (
    <Screen
      title={latest ? `Update ${nextRef}` : 'Review quote'}
      subtitle={calc.complete ? `${money(calc.total)} · what your customer will see` : 'What your customer will see'}
      right={editButton}
      footer={<Button title={cta.title} icon={cta.icon} onPress={cta.onPress} loading={busy} testID="preview-create" />}
    >
      {latest ? (
        <Banner
          tone="info"
          icon="file-text"
          title={`Your customer has ${latest.reference}`}
          body="It stays viewable and shareable while you work on this update."
          action={<Button size="sm" variant="outline" title={`Open ${latest.reference}`} onPress={() => router.setParams({ rev: latest.id })} testID="preview-open-latest" />}
        />
      ) : null}

      {askBusiness ? (
        <Card tone={bizName.trim() ? undefined : 'uncertain'} style={{ gap: 10 }} testID="preview-business">
          <T v="bodyStrong">Your business on the quote</T>
          <T v="small" muted>
            It goes at the top of every quote. You can change it later in Settings.
          </T>
          <Field
            inputRef={nameRef}
            value={bizName}
            onChangeText={setBizName}
            onBlur={saveBusiness}
            placeholder="Business name"
            accessibilityLabel="Business name"
            autoCapitalize="words"
            textContentType="organizationName"
            autoFocus={issues.length === 1}
            returnKeyType="done"
            testID="preview-business-name"
            maxLength={80}
          />
          <Field value={bizPhone} onChangeText={setBizPhone} onBlur={saveBusiness} placeholder="Phone (optional)" accessibilityLabel="Business phone" keyboardType="phone-pad" inputMode="tel" textContentType="telephoneNumber" testID="preview-business-phone" maxLength={40} />
        </Card>
      ) : null}

      {open.some((i) => i.key !== 'business') ? (
        <Card tone="uncertain" style={{ gap: 4 }} testID="preview-issues">
          <T v="bodyStrong" style={{ marginBottom: 4 }}>
            Before you send
          </T>
          {open.map((i) =>
            i.key === 'business' ? null : (
              <Pressable key={i.key} onPress={() => fixIssue(i)} accessibilityRole="button" accessibilityLabel={i.text} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, opacity: pressed ? 0.6 : 1 })}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.uncertain }} />
                <T v="body" style={{ flex: 1 }}>
                  {i.text}
                </T>
                <Feather name="chevron-right" size={16} color={c.uncertain} />
              </Pressable>
            ),
          )}
        </Card>
      ) : null}

      {notice ? <Banner tone={notice.tone} title={notice.text} /> : null}
      {access}

      <QuoteDocView doc={doc} testID="quote-doc" />

      <Sheet
        visible={newVisit}
        onClose={() => setNewVisit(false)}
        title="Start a separate quote?"
        body={`${job.draft.customer.name.trim() || 'This customer'} gets a new quote of their own with everything you entered. ${latest?.reference ?? 'The original quote'} goes back to what was sent.`}
        testID="new-visit-sheet"
        actions={
          <>
            <Button
              title="Start a separate quote"
              icon="copy"
              onPress={() => {
                setNewVisit(false);
                const copy = store.separateVisit(job.id);
                if (copy) router.replace({ pathname: '/job/[id]/preview', params: { id: copy.id } });
              }}
              testID="new-visit-confirm"
            />
            <Button variant="ghost" title="Keep editing" onPress={() => setNewVisit(false)} />
          </>
        }
      />

      <Sheet
        visible={!!pdfFailed}
        onClose={() => setPdfFailed(null)}
        title="The PDF could not be made"
        body={`${pdfFailed ?? ''} Your draft is saved and nothing was used.`}
        actions={
          <>
            <Button
              title="Create & share as text"
              onPress={() => {
                setPdfFailed(null);
                runCreate(true);
              }}
              testID="pdf-fallback-text"
            />
            <Button
              variant="ghost"
              title="Try the PDF again"
              onPress={() => {
                setPdfFailed(null);
                runCreate(false);
              }}
            />
          </>
        }
      />
    </Screen>
  );
}

function SentSheet({ revision, onClose }: { revision: Revision | null; onClose: (sent: boolean) => void }) {
  return (
    <Sheet
      visible={!!revision}
      onClose={() => onClose(false)}
      title="Did it go out?"
      body="Closing the share sheet doesn't tell us whether the message was sent. Mark it so your job list stays accurate."
      testID="sent-sheet"
      actions={
        <>
          <Button title="Yes, mark as sent" icon="check" onPress={() => onClose(true)} testID="mark-sent" />
          <Button variant="ghost" title="Not yet" onPress={() => onClose(false)} testID="not-sent" />
        </>
      }
    />
  );
}

function shareLabel(s: ShareRecord): string {
  if (s.state === 'marked_sent') return 'Marked as sent';
  if (s.channel === 'sms') {
    if (s.state === 'sent') return 'Sent from Messages';
    if (s.state === 'cancelled') return 'Messages closed without sending';
    if (s.state === 'failed') return 'Messages did not open';
    return 'Messages opened';
  }
  if (s.state === 'failed') return `${s.channel === 'pdf' ? 'PDF' : s.channel === 'text' ? 'Text' : 'Copy'} did not open`;
  if (s.channel === 'copy') return 'Copied as text';
  return `Share sheet opened (${s.channel === 'pdf' ? 'PDF' : 'text'})`;
}
