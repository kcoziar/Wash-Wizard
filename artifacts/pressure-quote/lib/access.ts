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

export interface VisitCustomer {
  name: string;
  phone: string;
}

const phoneDigits = (s: string) => s.replace(/\D+/g, '').slice(-10);

/** Small typing differences ("Sara" and "Sarah Jones") are the same person. */
function sameName(a: string, b: string): boolean {
  if (a === b) return true;
  const [aw, bw] = [a.split(' '), b.split(' ')];
  if (aw.length > 1 && bw.length > 1 && aw[aw.length - 1] === bw[bw.length - 1] && (aw[0].startsWith(bw[0].slice(0, 3)) || bw[0].startsWith(aw[0].slice(0, 3)))) return true;
  return editDistance(a, b) <= 2;
}

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}

/** Identifies the customer a revision was confirmed for, so one genuine correction stays free. */
export function customerKey(c: VisitCustomer): string {
  return `${norm(c.name)}|${phoneDigits(c.phone)}`;
}

/**
 * A revision corrects the same visit. When the latest quote named a customer or a phone number and the
 * draft now names a different customer, or a different phone number, it is a different visit.
 * Filling in a blank is never a change. The address plays no part: a blank address cannot switch the check off.
 */
export function isNewVisit(latest: VisitCustomer | null, draft: VisitCustomer): boolean {
  if (!latest) return false;
  const [ln, dn] = [norm(latest.name), norm(draft.name)];
  const [lp, dp] = [phoneDigits(latest.phone), phoneDigits(draft.phone)];
  const nameChanged = !!ln && !!dn && !sameName(ln, dn);
  const phoneChanged = lp.length >= 7 && dp.length >= 7 && lp !== dp;
  return nameChanged || phoneChanged;
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
