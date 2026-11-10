import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import type { PurchasesPackage } from 'react-native-purchases';
import { Banner, Button, Card, HeroCard, IconButton, Screen, Sheet, T, TextLink, haptic } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { APP_NAME } from '@/constants/legal';
import { paywallFrom, track } from '@/lib/analytics';
import { date, money } from '@/lib/format';
import { openLegal, openSupport } from '@/lib/links';
import { TEXT_SEND_AVAILABLE } from '@/lib/output';
import { requestResume } from '@/lib/resume';
import { useSubscription } from '@/lib/revenuecat';
import { useStore } from '@/lib/store';
import { FREE_QUOTES, type Job } from '@/lib/types';

const PRO_NAME = `${APP_NAME} Pro`;
const SENT_STATES = new Set<Job['status']>(['sent', 'accepted', 'declined', 'completed']);

/** Only features this build ships are listed. */
const PRO_ADDS: { icon: React.ComponentProps<typeof Feather>['name']; title: string; body: string }[] = [
  { icon: 'plus-circle', title: 'Unlimited new quotes', body: 'Quote every job that comes in, all year.' },
  ...(TEXT_SEND_AVAILABLE
    ? [{ icon: 'message-circle' as const, title: 'Sent in one tap by text', body: 'Messages opens with their number, the PDF and a short note. You press Send.' }]
    : []),
];

function perMonth(pkg: PurchasesPackage): string | null {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: pkg.product.currencyCode }).format(Math.floor((pkg.product.price / 12) * 100) / 100);
  } catch {
    return null;
  }
}

function duration(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (!m) return `${r} s`;
  return r ? `${m} min ${r} s` : `${m} min`;
}

export default function PaywallScreen() {
  const c = useColors();
  const { from, ref, job: jobParam } = useLocalSearchParams<{ from?: string; ref?: string; job?: string }>();
  const sub = useSubscription();
  const store = useStore();
  const [selected, setSelected] = useState<'annual' | 'monthly'>('annual');
  const [notice, setNotice] = useState<{ tone: 'info' | 'warn' | 'danger' | 'success'; title: string; body?: string } | null>(null);
  const [confirmTest, setConfirmTest] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const awaitingPro = useRef(false);
  const fromValue = paywallFrom(from);
  const resumeJob = from === 'limit' && jobParam ? jobParam : null;

  useEffect(() => {
    track('paywall_viewed', fromValue);
    if (sub.status !== 'unavailable' && (sub.offeringState === 'idle' || sub.offeringState === 'error')) sub.loadOffering().catch(() => undefined);
    // Once on open; "Try again" handles later failures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  /** Back to the draft that hit the limit; it is created there without another tap. */
  const finishToDraft = () => {
    if (resumeJob) requestResume(resumeJob);
    close();
  };

  // A purchase the App Store was still finishing: continue as soon as Pro switches on.
  useEffect(() => {
    if (sub.isPro && awaitingPro.current) {
      awaitingPro.current = false;
      haptic('success');
      if (resumeJob) finishToDraft();
      else setCelebrate(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub.isPro]);

  const annual = sub.offering?.annual ?? null;
  const monthly = sub.offering?.monthly ?? null;
  const pkg = selected === 'annual' ? annual ?? monthly : monthly ?? annual;
  const period: 'year' | 'month' = pkg && pkg === annual ? 'year' : 'month';
  const savings = annual && monthly && monthly.product.price > 0 ? Math.round((1 - annual.product.price / (monthly.product.price * 12)) * 100) : null;
  const remaining = Math.max(0, FREE_QUOTES - store.freeUsed);
  const intro = pkg ? sub.introFor(pkg, period) : null;

  // Personal lines, only from this user's own records.
  const made = useMemo(() => store.jobs.filter((j) => !j.sample && j.revisions.length > 0), [store.jobs]);
  const speed = useMemo(() => {
    const own = jobParam ? made.find((j) => j.id === jobParam) : undefined;
    const target = own ?? [...made].sort((a, b) => b.revisions[0].createdAt - a.revisions[0].createdAt)[0];
    if (!target) return null;
    const ms = target.revisions[0].createdAt - target.createdAt;
    if (!(ms > 0 && ms < 10 * 60_000)) return null;
    return `${target.request ? 'From message to quote' : 'From new job to quote'} in ${duration(ms)}.`;
  }, [made, jobParam]);
  const usage = useMemo(() => {
    if (!made.length) return null;
    const worth = made.reduce((sum, j) => sum + j.revisions[j.revisions.length - 1].doc.total, 0);
    const verb = made.every((j) => SENT_STATES.has(j.status)) ? 'sent' : 'created';
    const ratesSaved = Object.values(store.settings.rates).some((r) => r.rate.trim() !== '');
    return `You've ${verb} ${made.length} ${made.length === 1 ? 'quote' : 'quotes'} worth ${money(worth)}. ${ratesSaved ? 'Your rates and terms are saved.' : 'Your jobs and terms are saved.'}`;
  }, [made, store.settings.rates]);
  const atLimit = from === 'limit' || from === 'last-free' || remaining === 0;

  const doPurchase = async () => {
    if (!pkg) return;
    setNotice(null);
    const res = await sub.purchase(pkg);
    if (res.kind === 'success') {
      haptic('success');
      track('purchase', fromValue);
      if (resumeJob) finishToDraft();
      else setCelebrate(true);
    } else if (res.kind === 'processing') {
      track('purchase', fromValue);
      awaitingPro.current = true;
      setNotice({ tone: 'info', title: 'Purchase received', body: 'The App Store is finishing it. Pro switches on by itself in a moment; there is nothing more to buy.' });
    } else if (res.kind === 'pending') {
      setNotice({ tone: 'info', title: 'Waiting for approval', body: 'This purchase needs approval, for example through Ask to Buy. Nothing more to do; Pro switches on once it is approved.' });
    } else if (res.kind === 'error') {
      haptic('warn');
      setNotice({ tone: 'danger', title: 'The purchase did not go through', body: res.message });
    }
  };

  const buy = () => {
    if (!pkg || sub.busy) return;
    if (sub.isTestStore) setConfirmTest(true);
    else doPurchase();
  };

  const restore = async () => {
    setNotice(null);
    const res = await sub.restore();
    if (res.kind === 'restored') {
      haptic('success');
      track('restore', fromValue);
      if (resumeJob) finishToDraft();
      else setCelebrate(true);
    } else if (res.kind === 'nothing') setNotice({ tone: 'info', title: 'No purchase to restore', body: 'Nothing active was found for this Apple ID. If you subscribed with a different Apple ID, sign in with it and try again.' });
    else if (res.kind === 'error') setNotice({ tone: 'danger', title: 'Restore did not finish', body: res.message });
  };

  const recheck = async () => {
    setRechecking(true);
    try {
      await sub.refresh();
      if (sub.offeringState !== 'ready') await sub.loadOffering();
    } finally {
      setRechecking(false);
    }
  };

  const links = (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 18, rowGap: 10, paddingTop: 2 }}>
      <TextLink title={sub.busy ? 'Working...' : 'Restore'} onPress={restore} testID="paywall-restore" color={c.mutedForeground} />
      <TextLink title="Manage" onPress={() => sub.openManage()} testID="paywall-manage" color={c.mutedForeground} />
      <TextLink title="Support" onPress={openSupport} testID="paywall-support" color={c.mutedForeground} />
      <TextLink title="Terms" onPress={() => openLegal('terms')} testID="paywall-terms" color={c.mutedForeground} />
      <TextLink title="Privacy" onPress={() => openLegal('privacy')} testID="paywall-privacy" color={c.mutedForeground} />
    </View>
  );

  // ---------- Already Pro ----------
  if (sub.isPro || celebrate) {
    return (
      <Screen
        title=""
        back={false}
        modal
        right={<IconButton icon="x" label="Close" onPress={close} testID="paywall-close" />}
        footer={<Button title={resumeJob ? 'Back to my quote' : 'Close'} onPress={resumeJob ? finishToDraft : close} testID="paywall-done" />}
      >
        <Animated.View entering={FadeInDown.duration(420)} style={{ alignItems: 'center', gap: 14, paddingTop: 24 }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
            <Feather name="check" size={36} color={c.accentForeground} />
          </View>
          <T v="hero" style={{ textAlign: 'center' }}>
            {celebrate ? "You're on Pro" : 'Pro is active'}
          </T>
          <T v="body" muted style={{ textAlign: 'center', maxWidth: 320 }}>
            Unlimited new quotes are on. Your drafts, jobs and settings are exactly where you left them.
          </T>
        </Animated.View>
        <Card style={{ gap: 6 }}>
          <T v="bodyStrong">{sub.productId?.includes('annual') ? `${PRO_NAME}, yearly` : sub.productId?.includes('monthly') ? `${PRO_NAME}, monthly` : PRO_NAME}</T>
          {sub.expiresAt ? (
            <T v="small" muted>
              {sub.willRenew ? `Renews ${date(sub.expiresAt)}` : `Ends ${date(sub.expiresAt)}. It will not renew.`}
            </T>
          ) : null}
          {sub.status === 'grace' ? <Banner tone="warn" title="The App Store couldn't charge your card" body="Pro stays on for now. Update your payment method in Manage subscription." /> : null}
          {sub.status === 'cached' ? (
            <T v="small" muted>
              Verified earlier on this iPhone. It refreshes when the App Store is reachable.
            </T>
          ) : null}
          <View style={{ marginTop: 6 }}>
            <Button size="md" variant="outline" title="Manage subscription" onPress={() => sub.openManage()} />
          </View>
        </Card>
        {sub.isTestStore ? (
          <T v="small" muted style={{ textAlign: 'center' }}>
            Test purchase. Nothing was charged.
          </T>
        ) : null}
      </Screen>
    );
  }

  const unavailable = sub.status === 'unavailable';
  const unresolved = sub.status === 'pending' || sub.status === 'checking' || sub.status === 'unreachable';
  const offeringFailed = !unavailable && sub.offeringState === 'error';
  const loading = !unavailable && (sub.offeringState === 'loading' || sub.offeringState === 'idle');
  const showPlans = !unavailable && !unresolved && !!(annual || monthly);

  // A new purchase is never offered while an earlier one, or the check of one, is unresolved.
  let cta: React.ReactNode;
  if (unavailable) cta = <Button title="Keep using free tools" onPress={close} testID="paywall-free" />;
  else if (sub.status === 'pending') cta = <Button title="Check again" icon="refresh-cw" onPress={recheck} loading={rechecking} testID="paywall-recheck" />;
  else if (sub.status === 'checking') cta = <Button title="Checking your subscription" loading disabled onPress={() => undefined} testID="paywall-checking" />;
  else if (sub.status === 'unreachable') cta = <Button title="Try again" icon="refresh-cw" onPress={recheck} loading={rechecking} testID="paywall-recheck" />;
  else if (offeringFailed) cta = <Button title="Try again" icon="refresh-cw" onPress={() => sub.loadOffering()} testID="paywall-retry" />;
  else
    cta = (
      <Button
        title={pkg ? `Subscribe \u00B7 ${pkg.product.priceString} / ${period}` : 'Loading prices'}
        onPress={buy}
        loading={sub.busy || loading}
        disabled={!pkg || sub.busy}
        testID="paywall-buy"
      />
    );

  const later = remaining > 0 ? `Not now. I have ${remaining} free ${remaining === 1 ? 'quote' : 'quotes'} left` : resumeJob ? 'Keep my draft, decide later' : 'Not now';

  return (
    <Screen
      title=""
      back={false}
      modal
      right={<IconButton icon="x" label="Close" onPress={close} testID="paywall-close" />}
      footer={
        <>
          {cta}
          {!unavailable ? (
            <Pressable onPress={close} accessibilityRole="button" accessibilityLabel={later} testID="paywall-later" style={({ pressed }) => ({ alignItems: 'center', justifyContent: 'center', minHeight: 44, opacity: pressed ? 0.6 : 1 })}>
              <T v="smallStrong" muted>
                {later}
              </T>
            </Pressable>
          ) : null}
          {links}
        </>
      }
    >
      <Animated.View entering={FadeIn.duration(350)} style={{ gap: 10 }}>
        {from === 'first' && ref ? (
          <T v="label" color={c.confirm} testID="paywall-eyebrow">
            Quote {ref} is ready
          </T>
        ) : from === 'last-free' ? (
          <T v="label" color={c.confirm} testID="paywall-eyebrow">
            That was your last free quote
          </T>
        ) : from === 'limit' ? (
          <T v="label" muted testID="paywall-eyebrow">
            Your draft is saved
          </T>
        ) : null}
        <T v="hero" testID="paywall-headline">
          Make every quote this easy.
        </T>
        {from === 'last-free' ? (
          <T v="body" muted>
            New quotes need Pro; everything you've made stays.
          </T>
        ) : null}
        {speed ? (
          <T v="bodyStrong" testID="paywall-speed">
            {speed}
          </T>
        ) : null}
        {atLimit && usage ? (
          <T v="body" muted testID="paywall-usage">
            {usage}
          </T>
        ) : null}
      </Animated.View>

      <HeroCard style={{ gap: 16 }}>
        <T v="label" color={c.heroMuted}>
          Pro adds
        </T>
        {PRO_ADDS.map((b) => (
          <View key={b.title} style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: c.heroAccentSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Feather name={b.icon} size={16} color={c.accent} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <T v="bodyStrong" color={c.heroForeground}>
                {b.title}
              </T>
              <T v="small" color={c.heroMuted}>
                {b.body}
              </T>
            </View>
          </View>
        ))}
        <T v="small" color={c.heroMuted} testID="paywall-honesty">
          Free includes {FREE_QUOTES} complete quotes with all of this. Pro removes the limit.
        </T>
      </HeroCard>

      <Card tone="alt" style={{ gap: 4 }} testID="paywall-always-free">
        <T v="bodyStrong">Always free</T>
        <T v="small" muted>
          Corrections and re-sharing, every quote you've saved, the tools, and backup. Nothing you've made is ever locked.
        </T>
      </Card>

      {sub.status === 'pending' ? (
        <Banner tone="info" icon="clock" title="A purchase is waiting for approval" body="There is nothing more to buy. Pro switches on once it is approved. Your draft is saved." testID="paywall-pending" />
      ) : null}
      {sub.status === 'unreachable' ? (
        <Banner tone="warn" icon="wifi-off" title="The App Store can't be reached right now" body="If you already have Pro, it is not lost. Your draft is saved. Try again when you're online, or use Restore." testID="paywall-unreachable" />
      ) : null}
      {sub.status === 'expired' ? <Banner tone="info" title="Your Pro subscription has ended" body="Your jobs and quotes are all still here. Resubscribe any time." /> : null}
      {unavailable ? (
        <Banner
          tone="warn"
          title="Purchases aren't available in this build"
          body="Everything else works. Drafts, revisions and the free tools are not affected."
          action={<Button size="sm" variant="outline" title="Contact support" onPress={openSupport} />}
          testID="paywall-unavailable"
        />
      ) : null}
      {offeringFailed && !unresolved ? (
        sub.offeringError === 'offline' ? (
          <Banner tone="warn" icon="wifi-off" title="You're offline" body="Prices come from the App Store and need a connection. Your draft is saved." testID="paywall-offline" />
        ) : (
          <Banner
            tone="warn"
            title="Prices didn't load from the App Store"
            body="This is a problem on our side, not your connection. Try again shortly, or let us know."
            action={<Button size="sm" variant="outline" title="Contact support" onPress={openSupport} />}
            testID="paywall-config"
          />
        )
      ) : null}
      {notice ? <Banner tone={notice.tone} title={notice.title} body={notice.body} testID="paywall-notice" /> : null}

      {showPlans ? (
        <Animated.View entering={FadeInDown.duration(380)} style={{ gap: 10 }}>
          {annual ? (
            <PlanCard
              selected={pkg === annual}
              onPress={() => setSelected('annual')}
              title="Yearly"
              price={`${annual.product.priceString} / year`}
              detail={`Best if you quote year-round.${perMonth(annual) ? ` ${perMonth(annual)} a month, billed yearly.` : ''}`}
              offer={sub.introFor(annual, 'year')}
              badge={savings && savings > 0 ? `Save ${savings}%` : null}
              testID="plan-annual"
            />
          ) : null}
          {monthly ? (
            <PlanCard
              selected={pkg === monthly}
              onPress={() => setSelected('monthly')}
              title="Monthly"
              price={`${monthly.product.priceString} / month`}
              detail="Good for a short season. Cancel when it ends; your quotes stay."
              offer={sub.introFor(monthly, 'month')}
              badge={null}
              testID="plan-monthly"
            />
          ) : null}
          <T v="small" muted style={{ textAlign: 'center', paddingHorizontal: 8 }} testID="paywall-terms-text">
            {pkg ? `${PRO_NAME} \u00B7 ${pkg.product.priceString} per ${period}. ` : ''}
            {intro ? `${intro}. ` : ''}Renews automatically until you cancel. Cancel any time in your Apple ID settings, at least 24 hours before renewal.
          </T>
        </Animated.View>
      ) : null}

      <Sheet
        visible={confirmTest}
        onClose={() => setConfirmTest(false)}
        title="Test purchase"
        body={`${APP_NAME} is running in a preview, so purchases use a test store. Nothing is charged. Real purchases need the App Store version.`}
        actions={
          <>
            <Button
              title="Continue test purchase"
              onPress={() => {
                setConfirmTest(false);
                doPurchase();
              }}
              testID="test-purchase-confirm"
            />
            <Button variant="ghost" title="Cancel" onPress={() => setConfirmTest(false)} />
          </>
        }
      />
    </Screen>
  );
}

function PlanCard({
  selected,
  onPress,
  title,
  price,
  detail,
  offer,
  badge,
  testID,
}: {
  selected: boolean;
  onPress: () => void;
  title: string;
  price: string;
  detail: string;
  offer: string | null;
  badge: string | null;
  testID?: string;
}) {
  const c = useColors();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityLabel={`${title}, ${price}`}
      accessibilityState={{ selected }}
      onPress={() => {
        haptic('select');
        onPress();
      }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        padding: 16,
        borderRadius: c.radius + 4,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? c.foreground : c.border,
        backgroundColor: c.card,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: selected ? c.foreground : c.input, alignItems: 'center', justifyContent: 'center' }}>
        {selected ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.foreground }} /> : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <T v="bodyStrong">{title}</T>
          {badge ? (
            <View style={{ backgroundColor: c.accent, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
              <T v="smallStrong" color={c.accentForeground}>
                {badge}
              </T>
            </View>
          ) : null}
        </View>
        <T v="num">{price}</T>
        <T v="small" muted>
          {detail}
        </T>
        {offer ? (
          <T v="smallStrong" color={c.confirm}>
            {offer}
          </T>
        ) : null}
      </View>
    </Pressable>
  );
}
