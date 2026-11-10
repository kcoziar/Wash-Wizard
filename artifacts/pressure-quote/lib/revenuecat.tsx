import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import Constants from 'expo-constants';
import Purchases, { PURCHASES_ERROR_CODE } from 'react-native-purchases';
import type { CustomerInfo, PurchasesError, PurchasesOffering, PurchasesPackage } from 'react-native-purchases';
import type { EntitlementStatus } from './access';
import { readEntitlementCache, readPendingPurchase, writeEntitlementCache, writePendingPurchase } from './storage';
import { MANAGE_SUBSCRIPTIONS_URL } from '@/constants/legal';
import { introOfferText, pickRevenueCatKey } from './rcKey';

const REVENUECAT_TEST_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY;
const REVENUECAT_IOS_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY;
const REVENUECAT_ANDROID_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY;

export const REVENUECAT_ENTITLEMENT_IDENTIFIER = 'pro';

/**
 * Expo Go, web and every development (__DEV__) build use RevenueCat's Test Store: purchases are
 * simulated, never charged, and do not exercise Apple StoreKit. Only a release build uses the App Store.
 */
export const IS_TEST_STORE = __DEV__ || Platform.OS === 'web' || Constants.executionEnvironment === 'storeClient';

/**
 * How long a purchase that has not unlocked Pro yet blocks a second purchase. Kept short: if the
 * App Store never confirms it, the buyer gets Restore and Support instead of a locked button.
 */
const PENDING_WINDOW_MS = 10 * 60 * 1000;

const keyChoice = pickRevenueCatKey({
  testStore: IS_TEST_STORE,
  os: Platform.OS,
  testKey: REVENUECAT_TEST_API_KEY,
  iosKey: REVENUECAT_IOS_API_KEY,
  androidKey: REVENUECAT_ANDROID_API_KEY,
});

let configureError: string | null = null;

export function initializeRevenueCat() {
  if (!keyChoice.ok) {
    configureError = keyChoice.message;
    throw new Error(keyChoice.message);
  }
  try {
    Purchases.setLogLevel(__DEV__ ? Purchases.LOG_LEVEL.WARN : Purchases.LOG_LEVEL.ERROR);
    Purchases.configure({ apiKey: keyChoice.key });
    configureError = null;
  } catch (err) {
    configureError = err instanceof Error ? err.message : 'Purchases could not start';
    throw err;
  }
}

export type PurchaseOutcome =
  | { kind: 'success' }
  | { kind: 'processing' }
  | { kind: 'pending' }
  | { kind: 'cancelled' }
  | { kind: 'busy' }
  | { kind: 'error'; message: string; code?: string };

export type RestoreOutcome = { kind: 'restored' } | { kind: 'nothing' } | { kind: 'busy' } | { kind: 'error'; message: string };

/** Why prices are missing: no connection, or the store/RevenueCat setup itself. */
export type OfferingError = 'offline' | 'config' | null;

interface SubscriptionValue {
  status: EntitlementStatus;
  isPro: boolean;
  info: CustomerInfo | null;
  expiresAt: number | null;
  willRenew: boolean;
  productId: string | null;
  isSandbox: boolean;
  offering: PurchasesOffering | null;
  offeringState: 'idle' | 'loading' | 'ready' | 'error';
  offeringError: OfferingError;
  isTestStore: boolean;
  unavailableReason: string | null;
  /** True while a purchase or restore is running; no second one can start. */
  busy: boolean;
  /** An earlier purchase on this phone never switched Pro on, and the short wait for it is over. */
  unconfirmedPurchase: boolean;
  /** Exact intro-offer wording for a package the user is eligible for, or null. */
  introFor: (pkg: PurchasesPackage, period: 'year' | 'month') => string | null;
  refresh: () => Promise<EntitlementStatus>;
  /** Re-checks a Pro state whose verified period has run out before a premium action. */
  verify: () => Promise<EntitlementStatus>;
  loadOffering: () => Promise<void>;
  purchase: (pkg: PurchasesPackage) => Promise<PurchaseOutcome>;
  restore: () => Promise<RestoreOutcome>;
  openManage: () => Promise<void>;
  diagnostics: () => Promise<string[]>;
}

const Ctx = createContext<SubscriptionValue | null>(null);

const OFFLINE_CODES = new Set<string>([PURCHASES_ERROR_CODE.NETWORK_ERROR, PURCHASES_ERROR_CODE.OFFLINE_CONNECTION_ERROR]);

function errorText(e: unknown): { code?: string; message: string; cancelled: boolean } {
  const err = e as Partial<PurchasesError> | undefined;
  const code = err?.code as string | undefined;
  const cancelled = !!err?.userCancelled || code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR;
  if (code && OFFLINE_CODES.has(code)) {
    return { code, cancelled, message: 'The App Store could not be reached. Check your connection and try again. If you were charged, Restore purchases recovers it.' };
  }
  if (code === PURCHASES_ERROR_CODE.PURCHASE_NOT_ALLOWED_ERROR) {
    return { code, cancelled, message: 'Purchases are turned off on this device, for example by Screen Time restrictions.' };
  }
  if (code === PURCHASES_ERROR_CODE.STORE_PROBLEM_ERROR) {
    return { code, cancelled, message: 'The App Store had a problem completing this. Nothing else changed; try again in a moment.' };
  }
  return { code, cancelled, message: err?.message || 'The purchase did not complete.' };
}

const PRO_LIKE = new Set<EntitlementStatus>(['active', 'grace', 'cached']);
const MAX_TIMER_MS = 2_000_000_000;

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatusState] = useState<EntitlementStatus>(configureError ? 'unavailable' : 'checking');
  const [info, setInfo] = useState<CustomerInfo | null>(null);
  const [offering, setOffering] = useState<PurchasesOffering | null>(null);
  const [offeringState, setOfferingState] = useState<SubscriptionValue['offeringState']>('idle');
  const [offeringError, setOfferingError] = useState<OfferingError>(null);
  const [validUntil, setValidUntilState] = useState<number | null>(null);
  const [introEligible, setIntroEligible] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [unconfirmedPurchase, setUnconfirmed] = useState(false);
  const pendingRef = useRef<number | null>(null);
  const lastRefresh = useRef(0);
  const statusRef = useRef<EntitlementStatus>(status);
  const validUntilRef = useRef<number | null>(null);
  const opRef = useRef(false);

  const setStatus = useCallback((s: EntitlementStatus) => {
    statusRef.current = s;
    setStatusState(s);
  }, []);
  const setValidUntil = useCallback((v: number | null) => {
    validUntilRef.current = v;
    setValidUntilState(v);
  }, []);

  const apply = useCallback(
    async (ci: CustomerInfo): Promise<EntitlementStatus> => {
      setInfo(ci);
      const ent = ci.entitlements.active[REVENUECAT_ENTITLEMENT_IDENTIFIER];
      if (ent) {
        pendingRef.current = null;
        setUnconfirmed(false);
        writePendingPurchase(null).catch(() => undefined);
        writeEntitlementCache({ verifiedAt: Date.now(), expiresAt: ent.expirationDateMillis ?? null, productId: ent.productIdentifier }).catch(() => undefined);
        setValidUntil(ent.expirationDateMillis ?? null);
        const next: EntitlementStatus = ent.billingIssueDetectedAt ? 'grace' : 'active';
        setStatus(next);
        return next;
      }
      setValidUntil(null);
      writeEntitlementCache(null).catch(() => undefined);
      const pendingSince = pendingRef.current;
      if (pendingSince && Date.now() - pendingSince < PENDING_WINDOW_MS) {
        setStatus('pending');
        return 'pending';
      }
      setUnconfirmed(!!pendingSince);
      const next: EntitlementStatus = ci.entitlements.all[REVENUECAT_ENTITLEMENT_IDENTIFIER] ? 'expired' : 'none';
      setStatus(next);
      return next;
    },
    [setStatus, setValidUntil],
  );

  const refresh = useCallback(async (): Promise<EntitlementStatus> => {
    if (configureError) {
      setStatus('unavailable');
      return 'unavailable';
    }
    lastRefresh.current = Date.now();
    try {
      const ci = await Purchases.getCustomerInfo();
      return await apply(ci);
    } catch {
      const cache = await readEntitlementCache();
      // A cached verification only counts until the period it covered ends.
      if (cache && cache.expiresAt != null && cache.expiresAt > Date.now()) {
        setValidUntil(cache.expiresAt);
        setStatus('cached');
        return 'cached';
      }
      setValidUntil(null);
      const next: EntitlementStatus = pendingRef.current && Date.now() - pendingRef.current < PENDING_WINDOW_MS ? 'pending' : 'unreachable';
      setStatus(next);
      return next;
    }
  }, [apply, setStatus, setValidUntil]);

  const verify = useCallback(async (): Promise<EntitlementStatus> => {
    const s = statusRef.current;
    const until = validUntilRef.current;
    if (s === 'checking' || s === 'unreachable' || (PRO_LIKE.has(s) && until != null && until <= Date.now())) return refresh();
    return s;
  }, [refresh]);

  const loadOffering = useCallback(async () => {
    if (configureError) {
      setOfferingState('error');
      setOfferingError('config');
      return;
    }
    setOfferingState('loading');
    setOfferingError(null);
    try {
      const offerings = await Purchases.getOfferings();
      const current = offerings.current ?? null;
      setOffering(current);
      if (!current || current.availablePackages.length === 0) {
        setOfferingState('error');
        setOfferingError('config');
        return;
      }
      setOfferingState('ready');
      const ids = current.availablePackages.filter((p) => p.product.introPrice).map((p) => p.product.identifier);
      if (ids.length) {
        try {
          const el = await Purchases.checkTrialOrIntroductoryPriceEligibility(ids);
          const eligible = Purchases.INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE;
          setIntroEligible(Object.fromEntries(ids.map((id) => [id, el[id]?.status === eligible])));
        } catch {
          // Unknown eligibility: show the regular price only.
        }
      }
    } catch (e) {
      const code = (e as Partial<PurchasesError> | undefined)?.code as string | undefined;
      setOfferingState('error');
      setOfferingError(code && OFFLINE_CODES.has(code) ? 'offline' : 'config');
    }
  }, []);

  useEffect(() => {
    let alive = true;
    readPendingPurchase()
      .then((p) => {
        if (alive) pendingRef.current = p;
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) refresh().catch(() => undefined);
      });
    if (configureError) return;
    const listener = (ci: CustomerInfo) => {
      apply(ci).catch(() => undefined);
    };
    Purchases.addCustomerInfoUpdateListener(listener);
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      const until = validUntilRef.current;
      const lapsed = PRO_LIKE.has(statusRef.current) && until != null && until <= Date.now();
      if (lapsed || Date.now() - lastRefresh.current > 30_000) refresh().catch(() => undefined);
    });
    return () => {
      alive = false;
      Purchases.removeCustomerInfoUpdateListener(listener);
      sub.remove();
    };
  }, [apply, refresh]);

  // Re-check when the verified period ends, even if the app stays open.
  useEffect(() => {
    if (!PRO_LIKE.has(status) || validUntil == null) return;
    const ms = Math.max(0, Math.min(validUntil - Date.now() + 1000, MAX_TIMER_MS));
    const t = setTimeout(() => {
      refresh().catch(() => undefined);
    }, ms);
    return () => clearTimeout(t);
  }, [status, validUntil, refresh]);

  const purchase = useCallback(
    async (pkg: PurchasesPackage): Promise<PurchaseOutcome> => {
      if (opRef.current) return { kind: 'busy' };
      // A purchase waiting for approval must never be bought again.
      if (statusRef.current === 'pending') return { kind: 'pending' };
      opRef.current = true;
      setBusy(true);
      try {
        const { customerInfo } = await Purchases.purchasePackage(pkg);
        if (customerInfo.entitlements.active[REVENUECAT_ENTITLEMENT_IDENTIFIER]) {
          await apply(customerInfo);
          return { kind: 'success' };
        }
        pendingRef.current = Date.now();
        await writePendingPurchase(pendingRef.current);
        await apply(customerInfo);
        return { kind: 'processing' };
      } catch (e) {
        const err = errorText(e);
        if (err.cancelled) return { kind: 'cancelled' };
        if (err.code === PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR) {
          pendingRef.current = Date.now();
          await writePendingPurchase(pendingRef.current).catch(() => undefined);
          setStatus('pending');
          return { kind: 'pending' };
        }
        return { kind: 'error', message: err.message, code: err.code };
      } finally {
        opRef.current = false;
        setBusy(false);
      }
    },
    [apply, setStatus],
  );

  const restore = useCallback(async (): Promise<RestoreOutcome> => {
    if (opRef.current) return { kind: 'busy' };
    opRef.current = true;
    setBusy(true);
    try {
      const ci = await Purchases.restorePurchases();
      // Restore is the App Store's own answer: nothing found means nothing is waiting, so the buy button comes back.
      if (!ci.entitlements.active[REVENUECAT_ENTITLEMENT_IDENTIFIER]) {
        pendingRef.current = null;
        await writePendingPurchase(null).catch(() => undefined);
      }
      await apply(ci);
      return ci.entitlements.active[REVENUECAT_ENTITLEMENT_IDENTIFIER] ? { kind: 'restored' } : { kind: 'nothing' };
    } catch (e) {
      return { kind: 'error', message: errorText(e).message };
    } finally {
      opRef.current = false;
      setBusy(false);
    }
  }, [apply]);

  const openManage = useCallback(async () => {
    const url = info?.managementURL || MANAGE_SUBSCRIPTIONS_URL;
    try {
      await Linking.openURL(url);
    } catch {
      await Linking.openURL(MANAGE_SUBSCRIPTIONS_URL).catch(() => undefined);
    }
  }, [info]);

  const diagnostics = useCallback(async (): Promise<string[]> => {
    let id = 'not available';
    if (!configureError) {
      try {
        id = await Purchases.getAppUserID();
      } catch {
        id = 'not available';
      }
    }
    return [
      `RevenueCat user ID: ${id}`,
      `Pro status: ${statusRef.current}`,
      `Purchases: ${IS_TEST_STORE ? 'Test Store (no charges)' : 'App Store'}${configureError ? ` - ${configureError}` : ''}`,
    ];
  }, []);

  const introFor = useCallback(
    (pkg: PurchasesPackage, period: 'year' | 'month') =>
      introEligible[pkg.product.identifier] ? introOfferText(pkg.product.introPrice, { priceString: pkg.product.priceString, period }) : null,
    [introEligible],
  );

  const ent = info?.entitlements.active[REVENUECAT_ENTITLEMENT_IDENTIFIER] ?? info?.entitlements.all[REVENUECAT_ENTITLEMENT_IDENTIFIER];

  const value = useMemo<SubscriptionValue>(
    () => ({
      status,
      isPro: PRO_LIKE.has(status) && (validUntil == null || validUntil > Date.now()),
      info,
      expiresAt: ent?.expirationDateMillis ?? validUntil ?? null,
      willRenew: !!ent?.willRenew,
      productId: ent?.productIdentifier ?? null,
      isSandbox: !!ent?.isSandbox,
      offering,
      offeringState,
      offeringError,
      isTestStore: IS_TEST_STORE,
      unavailableReason: configureError,
      busy,
      introFor,
      refresh,
      verify,
      loadOffering,
      purchase,
      restore,
      unconfirmedPurchase,
      openManage,
      diagnostics,
    }),
    [status, validUntil, info, ent, offering, offeringState, offeringError, busy, unconfirmedPurchase, introFor, refresh, verify, loadOffering, purchase, restore, openManage, diagnostics],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSubscription() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSubscription must be used within a SubscriptionProvider');
  return ctx;
}
