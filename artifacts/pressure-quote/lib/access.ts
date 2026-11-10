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
  | { kind: 'free'; remaining: number }
  | { kind: 'blocked'; reason: 'exhausted' | 'checking' | 'pending' };

/**
 * The single access policy for creating a quote.
 * - Revisions, re-shares and samples never use a free quote.
 * - Pro (including grace and a still-valid cached verification) never uses a free quote.
 * - Unused free quotes are honored even after a subscription expires.
 * - Pending or unknown purchase state is never turned into a demand to buy again.
 */
export function decideAccess(input: { hasRevision: boolean; sample: boolean; status: EntitlementStatus; freeUsed: number }): AccessDecision {
  if (input.hasRevision) return { kind: 'revision' };
  if (input.sample) return { kind: 'sample' };
  if (PRO_STATUSES.includes(input.status)) return { kind: 'pro' };
  const remaining = Math.max(0, FREE_QUOTES - input.freeUsed);
  if (remaining > 0) return { kind: 'free', remaining };
  if (input.status === 'checking') return { kind: 'blocked', reason: 'checking' };
  if (input.status === 'pending') return { kind: 'blocked', reason: 'pending' };
  return { kind: 'blocked', reason: 'exhausted' };
}
