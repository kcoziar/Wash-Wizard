import React, { useMemo, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { QuoteDocView } from '@/components/QuoteDocView';
import { STATUS_LABEL } from '@/components/job';
import { Banner, Button, Card, Chip, EmptyState, Field, IconButton, Screen, SectionLabel, Sheet, T, haptic } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { date, makeId, money, shortDate } from '@/lib/format';
import { copyText, printDoc, sharePdf, shareText, type ShareResult } from '@/lib/output';
import { useSubscription } from '@/lib/revenuecat';
import { useJob, useStore } from '@/lib/store';
import { draftDoc, latestRevision, revisionReference, useCreateQuote, useJobCalc, useReviewPrompt } from '@/lib/useQuote';
import type { Issue } from '@/lib/pricing';
import type { JobStatus, QuoteDoc, Revision, ShareRecord } from '@/lib/types';

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

  const [busy, setBusy] = useState(false);
  const [askSent, setAskSent] = useState<Revision | null>(null);
  const [pdfFailed, setPdfFailed] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'warn' | 'danger' | 'info'; text: string } | null>(null);
  const [justCreated, setJustCreated] = useState<string | null>(null);

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
    return draftDoc(job, calc, store.settings);
  }, [job, calc, viewing, store.settings]);

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

  const record = (revisionId: string, channel: ShareRecord['channel'], state: ShareRecord['state']) =>
    store.updateJob(job.id, (j) => ({ ...j, shares: [...j.shares, { id: makeId('s'), revisionId, at: Date.now(), channel, state }] }));

  const afterSendQuestion = (revision: Revision) => {
    if (!store.meta.firstOfferShown && revision.mode === 'free') {
      store.updateMeta((m) => ({ ...m, firstOfferShown: true }));
      setTimeout(() => router.push({ pathname: '/paywall', params: { from: 'first' } }), 350);
      return;
    }
    askReview().catch(() => undefined);
  };

  const shareRevisionPdf = async (revision: Revision, pdfUri?: string | null): Promise<ShareResult> => {
    const res = await sharePdf(revision.doc, pdfUri ?? undefined);
    record(revision.id, 'pdf', res);
    if (res === 'failed') setNotice({ tone: 'warn', text: 'The PDF could not be shared from this device. Share the quote as text instead.' });
    return res;
  };

  const runCreate = async (allowTextOnly = false) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await store.flush();
      const res = await create(job, { allowTextOnly });
      if (res.kind === 'issues') {
        setNotice({ tone: 'warn', text: 'A few things still need an answer. They are listed above.' });
        return;
      }
      if (res.kind === 'blocked') {
        if (res.decision.kind === 'blocked' && res.decision.reason === 'exhausted') router.push({ pathname: '/paywall', params: { from: 'limit' } });
        else if (res.decision.kind === 'blocked' && res.decision.reason === 'pending') setNotice({ tone: 'info', text: 'Your purchase is waiting for approval. Your draft is saved; create the quote as soon as it goes through.' });
        else setNotice({ tone: 'info', text: 'Still checking your subscription. Try again in a moment. Your draft is saved.' });
        return;
      }
      if (res.kind === 'pdf_failed') {
        setPdfFailed(res.error);
        return;
      }
      if (res.kind === 'error') {
        setNotice({ tone: 'danger', text: `The quote was not created: ${res.message} Nothing was used from your free quotes. Try again.` });
        return;
      }
      haptic('success');
      setJustCreated(res.revision.id);
      if (isWeb) return;
      if (res.pdfUri) {
        await shareRevisionPdf(res.revision, res.pdfUri);
      } else {
        const r = await shareText(res.revision.doc);
        record(res.revision.id, 'text', r);
      }
      setAskSent(res.revision);
    } finally {
      setBusy(false);
    }
  };

  const setStatus = (status: JobStatus) => {
    store.updateJob(job.id, (j) => ({ ...j, status }));
    if (viewing && status === 'sent') record(viewing.id, 'pdf', 'marked_sent');
    if (status === 'accepted') store.noteMeaningful();
  };

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
            ) : (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Button title="Share PDF" icon="share" flex onPress={async () => { await shareRevisionPdf(viewing); if (job.status === 'quoted') setAskSent(viewing); }} testID="preview-share-pdf" />
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
          </>
        ) : null}

        <Animated.View entering={FadeIn.duration(300)}>
          <QuoteDocView doc={viewing.doc} testID="quote-doc" />
        </Animated.View>

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
                    <T v="small">
                      {s.state === 'marked_sent'
                        ? 'Marked as sent'
                        : s.state === 'failed'
                          ? `${s.channel === 'pdf' ? 'PDF' : s.channel === 'text' ? 'Text' : 'Copy'} did not open`
                          : s.channel === 'copy'
                            ? 'Copied as text'
                            : `Share sheet opened (${s.channel === 'pdf' ? 'PDF' : 'text'})`}
                    </T>
                    <T v="small" muted>
                      {shortDate(s.at)}
                    </T>
                  </View>
                ))}
              <T v="small" muted style={{ marginTop: 4 }}>
                Opening the share sheet doesn't confirm the customer got it. Mark it Sent when you know.
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
            afterSendQuestion(r);
          }}
        />
      </Screen>
    );
  }

  // ---------- Draft preview ----------
  const decision = preview(job);
  const nextRef = revisionReference(job, job.revisions.length + 1);
  const businessMissing = issues.some((i) => i.key === 'business');
  const fixIssue = (i: Issue) => {
    if (i.lineId) router.push({ pathname: '/job/[id]/line', params: { id: job.id, lineId: i.lineId } });
    else if (['minimum', 'trip', 'discount', 'tax', 'deposit'].some((k) => i.key.startsWith(k))) router.push({ pathname: '/job/[id]/pricing', params: { id: job.id } });
    else router.back();
  };

  let access: React.ReactNode = null;
  let cta: { title: string; onPress: () => void; icon: React.ComponentProps<typeof Feather>['name'] } = { title: latest ? `Create update ${nextRef} & share` : 'Create & share quote', onPress: () => runCreate(false), icon: 'send' };
  if (issues.length) {
    cta = { title: `Finish ${issues.length} ${issues.length === 1 ? 'item' : 'items'} first`, onPress: () => fixIssue(issues.find((i) => i.key !== 'business') ?? issues[0]), icon: 'arrow-up' };
  } else if (decision.kind === 'free') {
    access = <Banner tone="info" icon="gift" title="Creating this quote uses 1 of your 3 free quotes. Drafts, corrections and re-sharing are free." body={`${decision.remaining} of 3 left.`} testID="access-free" />;
  } else if (decision.kind === 'pro') {
    access = <Banner tone="success" icon="star" title="Pro: unlimited quotes" testID="access-pro" />;
  } else if (decision.kind === 'revision') {
    access = <Banner tone="info" icon="edit-3" title={`This creates ${nextRef}. Corrections are always free.`} body={`${latest?.reference} stays in the history.`} testID="access-revision" />;
  } else if (decision.kind === 'sample') {
    access = <Banner tone="info" icon="file-text" title="Sample quotes are free and marked SAMPLE." testID="access-sample" />;
  } else if (decision.kind === 'blocked') {
    if (decision.reason === 'exhausted') {
      access = <Banner tone="info" icon="star" title="You've used your 3 free quotes" body="Your draft is saved. Pro creates unlimited quotes. Revisions and re-sharing stay free either way." testID="access-blocked" />;
      cta = { title: 'Unlock unlimited quotes', onPress: () => router.push({ pathname: '/paywall', params: { from: 'limit' } }), icon: 'star' };
    } else if (decision.reason === 'pending') {
      access = <Banner tone="warn" title="Your purchase is waiting for approval" body="Nothing more to buy. Your draft is saved; create the quote once it goes through." testID="access-pending" />;
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
      {issues.length ? (
        <Card tone="uncertain" style={{ gap: 4 }} testID="preview-issues">
          <T v="bodyStrong" style={{ marginBottom: 4 }}>
            Before you send
          </T>
          {issues.map((i) =>
            i.key === 'business' ? null : (
              <Pressable key={i.key} onPress={() => fixIssue(i)} accessibilityRole="button" style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, opacity: pressed ? 0.6 : 1 })}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.uncertain }} />
                <T v="body" style={{ flex: 1 }}>
                  {i.text}
                </T>
                <Feather name="chevron-right" size={16} color={c.uncertain} />
              </Pressable>
            ),
          )}
          {businessMissing ? (
            <View style={{ gap: 10, marginTop: 6 }}>
              <T v="body">Add your business name. It goes at the top of every quote.</T>
              <Field value={store.settings.business.name} onChangeText={(t) => store.updateSettings((s) => ({ ...s, business: { ...s.business, name: t } }))} placeholder="Business name" autoCapitalize="words" testID="preview-business-name" maxLength={80} />
              <Field value={store.settings.business.phone} onChangeText={(t) => store.updateSettings((s) => ({ ...s, business: { ...s.business, phone: t } }))} placeholder="Phone (optional)" keyboardType="phone-pad" inputMode="tel" testID="preview-business-phone" />
            </View>
          ) : null}
        </Card>
      ) : null}

      {notice ? <Banner tone={notice.tone} title={notice.text} /> : null}
      {access}

      <QuoteDocView doc={doc} testID="quote-doc" />

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
