import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import type { PurchasesPackage } from 'react-native-purchases';
import { Banner, Button, Card, HeroCard, IconButton, Screen, Sheet, T, TextLink, haptic } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { APP_NAME } from '@/constants/legal';
import { date } from '@/lib/format';
import { useSubscription } from '@/lib/revenuecat';
import { useStore } from '@/lib/store';
import { FREE_QUOTES } from '@/lib/types';

const BENEFITS: { icon: React.ComponentProps<typeof Feather>['name']; title: string; body: string }[] = [
  { icon: 'send', title: 'Unlimited quotes', body: 'Create as many as you need. Corrections and re-sharing are always free.' },
  { icon: 'zap', title: 'Priced the moment you add a size', body: 'Your rates, minimum, trip charge and tax fill in every quote.' },
  { icon: 'clock', title: 'Worth-it check on every visit', body: 'See what the whole visit pays per hour before you say yes.' },
  { icon: 'lock', title: 'Your data stays on your iPhone', body: 'No account to make. Back up to a file any time.' },
];

function perMonth(pkg: PurchasesPackage): string | null {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: pkg.product.currencyCode }).format(Math.floor((pkg.product.price / 12) * 100) / 100);
  } catch {
    return null;
  }
}

export default function PaywallScreen() {
  const c = useColors();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const sub = useSubscription();
  const store = useStore();
  const [selected, setSelected] = useState<'annual' | 'monthly'>('annual');
  const [busy, setBusy] = useState<'buy' | 'restore' | null>(null);
  const [notice, setNotice] = useState<{ tone: 'info' | 'warn' | 'danger' | 'success'; title: string; body?: string } | null>(null);
  const [confirmTest, setConfirmTest] = useState(false);
  const [celebrate, setCelebrate] = useState(false);

  useEffect(() => {
    if (sub.status !== 'unavailable' && (sub.offeringState === 'idle' || sub.offeringState === 'error')) sub.loadOffering().catch(() => undefined);
    // Load once on open; "Try again" handles later failures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const annual = sub.offering?.annual ?? null;
  const monthly = sub.offering?.monthly ?? null;
  const pkg = selected === 'annual' ? annual ?? monthly : monthly ?? annual;
  const savings = annual && monthly && monthly.product.price > 0 ? Math.round((1 - annual.product.price / (monthly.product.price * 12)) * 100) : null;
  const remaining = Math.max(0, FREE_QUOTES - store.freeUsed);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const doPurchase = async () => {
    if (!pkg) return;
    setBusy('buy');
    setNotice(null);
    const res = await sub.purchase(pkg);
    setBusy(null);
    if (res.kind === 'success') {
      haptic('success');
      setCelebrate(true);
    } else if (res.kind === 'processing') {
      setNotice({ tone: 'info', title: 'Purchase received', body: 'The App Store is finishing it. Pro switches on by itself in a moment.' });
    } else if (res.kind === 'pending') {
      setNotice({ tone: 'info', title: 'Waiting for approval', body: 'This purchase needs approval, for example through Ask to Buy. Nothing more to do; Pro switches on once it is approved.' });
    } else if (res.kind === 'error') {
      haptic('warn');
      setNotice({ tone: 'danger', title: 'The purchase did not go through', body: res.message });
    }
  };

  const buy = () => {
    if (!pkg) return;
    if (sub.isTestStore) setConfirmTest(true);
    else doPurchase();
  };

  const restore = async () => {
    setBusy('restore');
    setNotice(null);
    const res = await sub.restore();
    setBusy(null);
    if (res.kind === 'restored') {
      haptic('success');
      setCelebrate(true);
    } else if (res.kind === 'nothing') setNotice({ tone: 'info', title: 'No purchase to restore', body: 'Nothing active was found for this Apple ID. If you subscribed with a different Apple ID, sign in with it and try again.' });
    else setNotice({ tone: 'danger', title: 'Restore did not finish', body: res.message });
  };

  const footer = (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 18, rowGap: 10, paddingTop: 2 }}>
      <TextLink title={busy === 'restore' ? 'Restoring...' : 'Restore'} onPress={restore} testID="paywall-restore" color={c.mutedForeground} />
      <TextLink title="Manage" onPress={() => sub.openManage()} testID="paywall-manage" color={c.mutedForeground} />
      <TextLink title="Support" onPress={() => router.push('/settings/support')} color={c.mutedForeground} />
      <TextLink title="Terms" onPress={() => router.push({ pathname: '/settings/legal', params: { doc: 'terms' } })} testID="paywall-terms" color={c.mutedForeground} />
      <TextLink title="Privacy" onPress={() => router.push({ pathname: '/settings/legal', params: { doc: 'privacy' } })} testID="paywall-privacy" color={c.mutedForeground} />
    </View>
  );

  // ---------- Already Pro ----------
  if (sub.isPro || celebrate) {
    return (
      <Screen title="" back={false} modal right={<IconButton icon="x" label="Close" onPress={close} testID="paywall-close" />} footer={<Button title={celebrate ? 'Back to my quote' : 'Close'} onPress={close} testID="paywall-done" />}>
        <Animated.View entering={FadeInDown.duration(420)} style={{ alignItems: 'center', gap: 14, paddingTop: 24 }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
            <Feather name="check" size={36} color={c.accentForeground} />
          </View>
          <T v="hero" style={{ textAlign: 'center' }}>
            {celebrate ? "You're on Pro" : 'Pro is active'}
          </T>
          <T v="body" muted style={{ textAlign: 'center', maxWidth: 320 }}>
            Unlimited quotes are on. Your drafts, jobs and settings are exactly where you left them.
          </T>
        </Animated.View>
        <Card style={{ gap: 6 }}>
          <T v="bodyStrong">{sub.productId?.includes('annual') ? 'Pro, yearly' : sub.productId?.includes('monthly') ? 'Pro, monthly' : 'Pro'}</T>
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
  const offeringFailed = !unavailable && sub.offeringState === 'error';
  const loading = !unavailable && (sub.offeringState === 'loading' || sub.offeringState === 'idle');

  let cta: React.ReactNode;
  if (unavailable) cta = <Button title="Keep using free tools" onPress={close} testID="paywall-free" />;
  else if (offeringFailed) cta = <Button title="Try again" icon="refresh-cw" onPress={() => sub.loadOffering()} testID="paywall-retry" />;
  else
    cta = (
      <Button
        title={pkg ? `Continue with ${pkg === annual ? 'yearly' : 'monthly'}` : 'Loading prices'}
        variant="primary"
        onPress={buy}
        loading={busy === 'buy' || loading}
        disabled={!pkg}
        testID="paywall-buy"
      />
    );

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
            <Pressable onPress={close} accessibilityRole="button" testID="paywall-free" style={({ pressed }) => ({ alignItems: 'center', paddingVertical: 6, opacity: pressed ? 0.6 : 1 })}>
              <T v="smallStrong" muted>
                Keep using free tools
              </T>
            </Pressable>
          ) : null}
          {footer}
        </>
      }
    >
      <Animated.View entering={FadeIn.duration(350)} style={{ gap: 10 }}>
        {from === 'first' ? (
          <T v="label" color={c.confirm}>
            Your first quote is out
          </T>
        ) : from === 'limit' ? (
          <T v="label" muted>
            Your draft is saved
          </T>
        ) : null}
        <T v="hero" testID="paywall-headline">
          Make your next quote this easy.
        </T>
        <T v="body" muted>
          Your next pressure washing quote, ready to send. Know whether the whole visit is worth your time before you say yes.
        </T>
      </Animated.View>

      <HeroCard style={{ gap: 16 }}>
        {BENEFITS.map((b) => (
          <View key={b.title} style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: 'rgba(200,242,60,0.14)', alignItems: 'center', justifyContent: 'center' }}>
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
      </HeroCard>

      {sub.status === 'pending' ? <Banner tone="info" icon="clock" title="A purchase is waiting for approval" body="No need to buy again. Pro switches on once it is approved." action={<Button size="sm" variant="outline" title="Check again" onPress={() => sub.refresh()} />} /> : null}
      {sub.status === 'unreachable' ? (
        <Banner tone="warn" icon="wifi-off" title="The App Store can't be reached right now" body="If you already have Pro, it is not lost. Try again when you are online." action={<Button size="sm" variant="outline" title="Try again" onPress={() => { sub.refresh(); sub.loadOffering(); }} />} />
      ) : null}
      {sub.status === 'expired' ? <Banner tone="info" title="Your Pro subscription has ended" body="Your jobs and quotes are all still here. Resubscribe any time." /> : null}
      {unavailable ? (
        <Banner tone="warn" title="Purchases aren't available in this build" body="Everything else works. Drafts, revisions and the free tools are not affected." testID="paywall-unavailable" />
      ) : null}
      {offeringFailed ? <Banner tone="warn" title="Prices didn't load" body="Check your connection, then try again." /> : null}
      {notice ? <Banner tone={notice.tone} title={notice.title} body={notice.body} testID="paywall-notice" /> : null}

      {!unavailable && (annual || monthly) ? (
        <Animated.View entering={FadeInDown.duration(380)} style={{ gap: 10 }}>
          {annual ? (
            <PlanCard
              selected={pkg === annual}
              onPress={() => setSelected('annual')}
              title="Yearly"
              price={`${annual.product.priceString} / year`}
              detail={perMonth(annual) ? `${perMonth(annual)} a month, billed yearly` : 'Billed yearly'}
              badge={savings && savings > 0 ? `Save ${savings}%` : null}
              testID="plan-annual"
            />
          ) : null}
          {monthly ? <PlanCard selected={pkg === monthly} onPress={() => setSelected('monthly')} title="Monthly" price={`${monthly.product.priceString} / month`} detail="Billed monthly" badge={null} testID="plan-monthly" /> : null}
          <T v="small" muted style={{ textAlign: 'center', paddingHorizontal: 8 }}>
            {pkg ? `${pkg.product.priceString} per ${pkg === annual ? 'year' : 'month'}. ` : ''}Renews automatically until you cancel. Cancel any time in your Apple ID settings, at least 24 hours before renewal.
          </T>
        </Animated.View>
      ) : null}

      {!sub.isPro && remaining > 0 ? (
        <T v="small" muted style={{ textAlign: 'center' }}>
          You still have {remaining} free {remaining === 1 ? 'quote' : 'quotes'}.
        </T>
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

function PlanCard({ selected, onPress, title, price, detail, badge, testID }: { selected: boolean; onPress: () => void; title: string; price: string; detail: string; badge: string | null; testID?: string }) {
  const c = useColors();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <T v="bodyStrong">{title}</T>
          {badge ? (
            <View style={{ backgroundColor: c.accent, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
              <T v="smallStrong" color={c.accentForeground}>
                {badge}
              </T>
            </View>
          ) : null}
        </View>
        <T v="small" muted>
          {detail}
        </T>
      </View>
      <T v="num">{price}</T>
    </Pressable>
  );
}
