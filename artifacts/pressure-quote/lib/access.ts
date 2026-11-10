import { FREE_QUOTES } from './types';

export type EntitlementStatus =
  | 'checking'
  | 'active'
  | 'grace'
  | 'pending'
  | 'expired'
  | 'none'
  | 'unreachable'
  | 'cached'
  | 'unavailable';

export const PRO_STATUSES: EntitlementStatus[] = ['active', 'grace', 'cached'];

export type AccessDecision =
  | { kind: 'revision' }
  | { kind: 'sample' }
  | { kind: 'pro' }
  | { kind: 'new_visit' }
  | { kind: 'free'; remaining: number }
  | { kind: 'blocked'; reason: 'exhausted' | 'checking' | 'pending' | 'unreachable' };

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * A revision corrects the same visit. When the latest quote named a customer and an address, and the
 * draft now names a different customer AND a different address, it is a different visit.
 */
export function isNewVisit(latest: { name: string; address: string } | null, draft: { name: string; address: string }): boolean {
  if (!latest) return false;
  const [ln, la, dn, da] = [norm(latest.name), norm(latest.address), norm(draft.name), norm(draft.address)];
  if (!ln || !la || !dn || !da) return false;
  return ln !== dn && la !== da;
}

/**
 * The single access policy for creating a quote.
 * - Corrections (revisions of the same visit), re-shares and samples never use a free quote.
 * - A "revision" that changes both the customer and the address is a new visit, unless the user is Pro.
 * - Pro (including grace and a still-valid cached verification) never uses a free quote.
 * - Unused free quotes are honored even after a subscription expires.
 * - Pending, unknown or unreachable purchase state is never turned into a demand to buy again.
 */
export function decideAccess(input: { hasRevision: boolean; newVisit?: boolean; sample: boolean; status: EntitlementStatus; freeUsed: number }): AccessDecision {
  const pro = PRO_STATUSES.includes(input.status);
  if (input.hasRevision) return input.newVisit && !pro && !input.sample ? { kind: 'new_visit' } : { kind: 'revision' };
  if (input.sample) return { kind: 'sample' };
  if (pro) return { kind: 'pro' };
  const remaining = Math.max(0, FREE_QUOTES - input.freeUsed);
  if (remaining > 0) return { kind: 'free', remaining };
  if (input.status === 'checking') return { kind: 'blocked', reason: 'checking' };
  if (input.status === 'pending') return { kind: 'blocked', reason: 'pending' };
  if (input.status === 'unreachable') return { kind: 'blocked', reason: 'unreachable' };
  return { kind: 'blocked', reason: 'exhausted' };
}
