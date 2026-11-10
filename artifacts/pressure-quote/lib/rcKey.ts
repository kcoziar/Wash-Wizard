/**
 * Picks the one RevenueCat public key this build needs. Pure, so it can be tested.
 * - Test Store (Expo Go, web, development builds): the test key only.
 * - A real iOS build: the iOS key only, and it must be an Apple App Store key (appl_).
 * Keys for other platforms are never required.
 */
export type RcKeyResult =
  | { ok: true; key: string; env: 'test' | 'ios' | 'android' }
  | { ok: false; problem: 'missing' | 'wrong_kind' | 'unsupported'; message: string };

export function pickRevenueCatKey(input: { testStore: boolean; os: string; testKey?: string; iosKey?: string; androidKey?: string }): RcKeyResult {
  const clean = (k?: string) => (k ?? '').trim();
  if (input.testStore) {
    const k = clean(input.testKey);
    if (!k) return { ok: false, problem: 'missing', message: 'This build has no RevenueCat Test Store key.' };
    return { ok: true, key: k, env: 'test' };
  }
  if (input.os === 'ios') {
    const k = clean(input.iosKey);
    if (!k) return { ok: false, problem: 'missing', message: 'This build has no RevenueCat iOS key.' };
    if (!k.startsWith('appl_')) return { ok: false, problem: 'wrong_kind', message: 'The RevenueCat key in this build is not an Apple App Store key.' };
    return { ok: true, key: k, env: 'ios' };
  }
  if (input.os === 'android') {
    const k = clean(input.androidKey);
    if (!k) return { ok: false, problem: 'missing', message: 'This build has no RevenueCat Android key.' };
    if (!k.startsWith('goog_')) return { ok: false, problem: 'wrong_kind', message: 'The RevenueCat key in this build is not a Google Play key.' };
    return { ok: true, key: k, env: 'android' };
  }
  return { ok: false, problem: 'unsupported', message: 'Purchases are not supported on this platform.' };
}

/** Describes an introductory offer exactly as the store configured it, or null when there is none. */
export function introOfferText(
  intro: { price: number; priceString: string; periodUnit: string; periodNumberOfUnits: number; cycles: number } | null | undefined,
  regular: { priceString: string; period: 'year' | 'month' },
): string | null {
  if (!intro || !intro.periodNumberOfUnits) return null;
  const unit = intro.periodUnit.toLowerCase().replace(/s$/, '');
  if (!['day', 'week', 'month', 'year'].includes(unit)) return null;
  const cycles = Math.max(1, intro.cycles || 1);
  const n = intro.periodNumberOfUnits * cycles;
  const span = `${n} ${unit}${n === 1 ? '' : 's'}`;
  const then = `then ${regular.priceString} per ${regular.period}`;
  if (intro.price === 0) return `${span} free, ${then}`;
  if (cycles > 1) {
    const each = intro.periodNumberOfUnits === 1 ? unit : `${intro.periodNumberOfUnits} ${unit}s`;
    return `${intro.priceString} per ${each} for ${span}, ${then}`;
  }
  return `${intro.priceString} for the first ${span}, ${then}`;
}
