import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import Constants from 'expo-constants';
import Purchases, { PURCHASES_ERROR_CODE } from 'react-native-purchases';
import type { CustomerInfo, PurchasesError, PurchasesOffering, PurchasesPackage } from 'react-native-purchases';
import type { EntitlementStatus } from './access';
import { readEntitlementCache, readPendingPurchase, writeEntitlementCache, writePendingPurchase } from './storage';
import { MANAGE_SUBSCRIPTIONS_URL } from '@/constants/legal';

const REVENUECAT_TEST_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY;
const REVENUECAT_IOS_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY;
const REVENUECAT_ANDROID_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY;

export const REVENUECAT_ENTITLEMENT_IDENTIFIER = 'pro';

/** Expo Go, web and development builds use RevenueCat's Test Store: purchases are simulated, never charged. */
export const IS_TEST_STORE = __DEV__ || Platform.OS === 'web' || Constants.executionEnvironment === 'storeClient';

const PENDING_WINDOW_MS = 72 * 60 * 60 * 1000;

let configureError: string | null = null;

function getRevenueCatApiKey() {
  if (!REVENUECAT_TEST_API_KEY || !REVENUECAT_IOS_API_KEY || !REVENUECAT_ANDROID_API_KEY) {
    throw new Error('RevenueCat Public API Keys not found');
  }
  if (IS_TEST_STORE) return REVENUECAT_TEST_API_KEY;
  if (Platform.OS === 'ios') return REVENUECAT_IOS_API_KEY;
  if (Platform.OS === 'android') return REVENUECAT_ANDROID_API_KEY;
  return REVENUECAT_TEST_API_KEY;
}

export function initializeRevenueCat() {
  try {
    const apiKey = getRevenueCatApiKey();
    Purchases.setLogLevel(__DEV__ ? Purchases.LOG_LEVEL.WARN : Purchases.LOG_LEVEL.ERROR);
    Purchases.configure({ apiKey });
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
  | { kind: 'error'; message: string; code?: string };

export type RestoreOutcome = { kind: 'restored' } | { kind: 'nothing' } | { kind: 'error'; message: string };

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
  isTestStore: boolean;
  unavailableReason: string | null;
  refresh: () => Promise<void>;
  loadOffering: () => Promise<void>;
  purchase: (pkg: PurchasesPackage) => Promise<PurchaseOutcome>;
  restore: () => Promise<RestoreOutcome>;
  openManage: () => Promise<void>;
}

const Ctx = createContext<SubscriptionValue | null>(null);

function errorText(e: unknown): { code?: string; message: string; cancelled: boolean } {
  const err = e as Partial<PurchasesError> | undefined;
  const code = err?.code as string | undefined;
  const cancelled = !!err?.userCancelled || code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR;
  if (code === PURCHASES_ERROR_CODE.NETWORK_ERROR || code === PURCHASES_ERROR_CODE.OFFLINE_CONNECTION_ERROR) {
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

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<EntitlementStatus>(configureError ? 'unavailable' : 'checking');
  const [info, setInfo] = useState<CustomerInfo | null>(null);
  const [offering, setOffering] = useState<PurchasesOffering | null>(null);
  const [offeringState, setOfferingState] = useState<SubscriptionValue['offeringState']>('idle');
  const pendingRef = useRef<number | null>(null);
  const lastRefresh = useRef(0);

  const apply = useCallback(async (ci: CustomerInfo) => {
    setInfo(ci);
    const ent = ci.entitlements.active[REVENUECAT_ENTITLEMENT_IDENTIFIER];
    if (ent) {
      pendingRef.current = null;
      writePendingPurchase(null).catch(() => undefined);
      writeEntitlementCache({ verifiedAt: Date.now(), expiresAt: ent.expirationDateMillis ?? null, productId: ent.productIdentifier }).catch(() => undefined);
      setStatus(ent.billingIssueDetectedAt ? 'grace' : 'active');
      return;
    }
    writeEntitlementCache(null).catch(() => undefined);
    const pendingSince = pendingRef.current;
    if (pendingSince && Date.now() - pendingSince < PENDING_WINDOW_MS) {
      setStatus('pending');
      return;
    }
    setStatus(ci.entitlements.all[REVENUECAT_ENTITLEMENT_IDENTIFIER] ? 'expired' : 'none');
  }, []);

  const refresh = useCallback(async () => {
    if (configureError) {
      setStatus('unavailable');
      return;
    }
    lastRefresh.current = Date.now();
    try {
      const ci = await Purchases.getCustomerInfo();
      await apply(ci);
    } catch {
      const cache = await readEntitlementCache();
      if (cache && cache.expiresAt != null && cache.expiresAt > Date.now()) setStatus('cached');
      else setStatus('unreachable');
    }
  }, [apply]);

  const loadOffering = useCallback(async () => {
    if (configureError) {
      setOfferingState('error');
      return;
    }
    setOfferingState('loading');
    try {
      const offerings = await Purchases.getOfferings();
      const current = offerings.current ?? null;
      setOffering(current);
      setOfferingState(current && current.availablePackages.length > 0 ? 'ready' : 'error');
    } catch {
      setOfferingState('error');
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
      if (s === 'active' && Date.now() - lastRefresh.current > 30_000) refresh().catch(() => undefined);
    });
    return () => {
      alive = false;
      Purchases.removeCustomerInfoUpdateListener(listener);
      sub.remove();
    };
  }, [apply, refresh]);

  const purchase = useCallback(
    async (pkg: PurchasesPackage): Promise<PurchaseOutcome> => {
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
          await writePendingPurchase(pendingRef.current);
          setStatus('pending');
          return { kind: 'pending' };
        }
        return { kind: 'error', message: err.message, code: err.code };
      }
    },
    [apply],
  );

  const restore = useCallback(async (): Promise<RestoreOutcome> => {
    try {
      const ci = await Purchases.restorePurchases();
      await apply(ci);
      return ci.entitlements.active[REVENUECAT_ENTITLEMENT_IDENTIFIER] ? { kind: 'restored' } : { kind: 'nothing' };
    } catch (e) {
      return { kind: 'error', message: errorText(e).message };
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

  const ent = info?.entitlements.active[REVENUECAT_ENTITLEMENT_IDENTIFIER] ?? info?.entitlements.all[REVENUECAT_ENTITLEMENT_IDENTIFIER];

  const value = useMemo<SubscriptionValue>(
    () => ({
      status,
      isPro: status === 'active' || status === 'grace' || status === 'cached',
      info,
      expiresAt: ent?.expirationDateMillis ?? null,
      willRenew: !!ent?.willRenew,
      productId: ent?.productIdentifier ?? null,
      isSandbox: !!ent?.isSandbox,
      offering,
      offeringState,
      isTestStore: IS_TEST_STORE,
      unavailableReason: configureError,
      refresh,
      loadOffering,
      purchase,
      restore,
      openManage,
    }),
    [status, info, ent, offering, offeringState, refresh, loadOffering, purchase, restore, openManage],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSubscription() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSubscription must be used within a SubscriptionProvider');
  return ctx;
}
