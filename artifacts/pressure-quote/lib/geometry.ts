import { Dec, parseNonNeg } from './decimal';
import type { Line, Part, Unit } from './types';

/** Exact unit definitions. */
export const SQM_PER_SQFT = Dec.parse('0.09290304') as Dec;
export const M_PER_FT = Dec.parse('0.3048') as Dec;

export function partQuantity(p: Part): Dec | null {
  const a = parseNonNeg(p.a);
  if (p.shape === 'value') return a;
  const b = parseNonNeg(p.b);
  if (!a || !b) return null;
  const product = a.mul(b);
  return p.shape === 'triangle' ? product.half() : product;
}

export interface PartsResult {
  total: Dec | null;
  added: Dec;
  subtracted: Dec;
  issue: string | null;
}

/** Sums shapes and removes exclusions. Exclusions larger than the measured area are an error, not zero. */
export function partsTotal(parts: Part[]): PartsResult {
  let added = Dec.zero();
  let subtracted = Dec.zero();
  let missing = false;
  for (const p of parts) {
    const q = partQuantity(p);
    if (!q) {
      missing = true;
      continue;
    }
    if (p.subtract) subtracted = subtracted.add(q);
    else added = added.add(q);
  }
  if (parts.length === 0) return { total: null, added, subtracted, issue: 'Add a measurement' };
  if (missing) return { total: null, added, subtracted, issue: 'Finish each measurement' };
  const total = added.sub(subtracted);
  if (total.sign() < 0) return { total: null, added, subtracted, issue: 'Exclusions are larger than the measured area' };
  return { total, added, subtracted, issue: null };
}

export function lineQuantity(line: Line): { qty: Dec | null; issue: string | null } {
  if (line.qtyType === 'flat') return { qty: Dec.int(1), issue: null };
  if (line.qtyMode === 'parts' && (line.qtyType === 'area' || line.qtyType === 'linear')) {
    const r = partsTotal(line.parts);
    return { qty: r.total, issue: r.issue };
  }
  const q = parseNonNeg(line.qty);
  if (!q) return { qty: null, issue: line.qty.trim() ? 'Quantity must be a positive number' : 'Add a quantity' };
  return { qty: q, issue: null };
}

export function sqftToSqm(d: Dec): Dec {
  return d.mul(SQM_PER_SQFT);
}

export function sqmToSqft(d: Dec, scale = 4): Dec {
  return d.div(SQM_PER_SQFT, scale) as Dec;
}

/** Converts a per-unit rate between unit systems (used when the operator switches units). */
export function convertRate(rate: Dec, from: Unit, to: Unit): Dec {
  if (from === to) return rate;
  if (from === 'sqft' && to === 'sqm') return rate.div(SQM_PER_SQFT, 4) as Dec;
  if (from === 'sqm' && to === 'sqft') return rate.mul(SQM_PER_SQFT).round(4);
  if (from === 'ft' && to === 'm') return rate.div(M_PER_FT, 4) as Dec;
  if (from === 'm' && to === 'ft') return rate.mul(M_PER_FT).round(4);
  return rate;
}

export function convertQuantity(q: Dec, from: Unit, to: Unit): Dec {
  if (from === to) return q;
  if (from === 'sqft' && to === 'sqm') return sqftToSqm(q);
  if (from === 'sqm' && to === 'sqft') return sqmToSqft(q, 4);
  if (from === 'ft' && to === 'm') return q.mul(M_PER_FT);
  if (from === 'm' && to === 'ft') return q.div(M_PER_FT, 4) as Dec;
  return q;
}
