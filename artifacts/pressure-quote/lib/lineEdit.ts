import { Dec, parseNonNeg } from './decimal';
import { unitFor } from './defaults';
import { makeId, sanitizeDecimal } from './format';
import { convertQuantity, M_PER_FT, SQM_PER_SQFT } from './geometry';
import type { Line, LineOrigin, Part, QuantityType, ServiceRate, Unit, UnitSystem } from './types';

/** Precision kept when converting, so a converted line prices the same as the original. */
const QTY_DP = 4;
const RATE_DP = 6;

function convText(text: string, from: Unit, to: Unit): string {
  const d = parseNonNeg(text);
  if (!d) return text;
  return convertQuantity(d, from, to).round(QTY_DP).toString();
}

function convRate(text: string, from: Unit, to: Unit): string {
  const r = parseNonNeg(text);
  if (!r || from === to) return text;
  let out: Dec | null = r;
  if (from === 'sqft' && to === 'sqm') out = r.div(SQM_PER_SQFT, RATE_DP);
  else if (from === 'sqm' && to === 'sqft') out = r.mul(SQM_PER_SQFT).round(RATE_DP);
  else if (from === 'ft' && to === 'm') out = r.div(M_PER_FT, RATE_DP);
  else if (from === 'm' && to === 'ft') out = r.mul(M_PER_FT).round(RATE_DP);
  return out ? out.toString() : text;
}

const lengthOf = (area: Unit): Unit => (area === 'sqm' ? 'm' : 'ft');

/** Converts measured shapes between square feet and square meters: sides as lengths, typed areas as areas. */
export function convertParts(parts: Part[], from: Unit, to: Unit): Part[] {
  if (from === to) return parts;
  return parts.map((p) => (p.shape === 'value' ? { ...p, a: convText(p.a, from, to) } : { ...p, a: convText(p.a, lengthOf(from), lengthOf(to)), b: convText(p.b, lengthOf(from), lengthOf(to)) }));
}

const fingerprint = (l: Pick<Line, 'qtyType' | 'unit' | 'qty' | 'parts' | 'rate'>) => JSON.stringify([l.qtyType, l.unit, l.qty, l.rate, l.parts.map((p) => [p.shape, p.a, p.b, p.subtract])]);

function snapshot(line: Line): Omit<LineOrigin, 'after'> {
  return {
    qtyType: line.qtyType,
    unit: line.unit,
    eachLabel: line.eachLabel,
    qtyMode: line.qtyMode,
    qty: line.qty,
    parts: line.parts,
    qtySource: line.qtySource,
    rate: line.rate,
    rateSource: line.rateSource,
  };
}

function restore(line: Line, o: LineOrigin): Line {
  const { after: _after, ...values } = o;
  return { ...line, ...values };
}

/**
 * Switches an area or length line between feet and meters. The size and rate are converted with
 * enough precision that the price holds, and switching back restores exactly what was entered.
 */
export function switchLineUnit(line: Line, to: Unit): Line {
  if (line.unit === to) return line;
  const o = line.unitOrigin;
  if (o && o.unit === to && o.qtyType === line.qtyType && o.after === fingerprint(line)) return { ...restore(line, o), unitOrigin: undefined };
  const converted: Line = {
    ...line,
    unit: to,
    qty: convText(line.qty, line.unit, to),
    parts: line.qtyType === 'area' ? convertParts(line.parts, line.unit, to) : line.parts,
    rate: convRate(line.rate, line.unit, to),
  };
  return { ...converted, unitOrigin: { ...snapshot(line), after: fingerprint(converted) } };
}

/**
 * Changes how a line is priced (area, length, count, hours, flat). A size or rate never carries over
 * to a different kind of quantity: the new basis starts blank, or from the saved rate for that basis.
 * Switching back restores the earlier size and rate.
 */
export function switchLineBasis(line: Line, to: QuantityType, system: UnitSystem, saved?: ServiceRate | null): Line {
  if (line.qtyType === to) return line;
  const o = line.basisOrigin;
  const before = { ...snapshot(line), after: '' };
  if (o && o.qtyType === to) {
    const back = restore(line, o);
    return { ...back, unitOrigin: undefined, basisOrigin: { ...before, after: fingerprint(back) } };
  }
  const useSaved = !!saved && saved.qtyType === to && saved.rate.trim() !== '';
  const next: Line = {
    ...line,
    qtyType: to,
    unit: useSaved && saved ? saved.unit : unitFor(to, system),
    eachLabel: to === 'each' ? line.eachLabel || saved?.eachLabel || 'items' : line.eachLabel,
    qtyMode: 'direct',
    qty: '',
    parts: [],
    qtySource: 'operator',
    rate: to !== 'flat' && useSaved && saved ? saved.rate : '',
    rateSource: useSaved ? 'saved' : 'none',
    price: to === 'flat' && useSaved && saved && !line.price.trim() ? saved.rate : line.price,
    unitOrigin: undefined,
  };
  return { ...next, basisOrigin: { ...before, after: fingerprint(next) } };
}

/**
 * "I already know the price": the line becomes a flat price. A size already entered stays on the
 * quote as the customer-facing detail, and switching back to the size restores it.
 */
export function toFlatPrice(line: Line, sizeText: string | null): Line {
  const next = switchLineBasis(line, 'flat', 'imperial', null);
  return { ...next, detail: line.detail.trim() || sizeText || '' };
}

const DIMENSIONS = /^\s*(\d+(?:[.,]\d+)?)\s*(?:x|\u00D7|\*|by)\s*(\d+(?:[.,]\d+)?)\s*(?:ft|feet|foot|m|meters?|metres?|')?\s*$/i;

/**
 * "24x36", "24 \u00D7 36" or "24 by 36" pasted or dictated into an area size: the line becomes one
 * measured rectangle in its own unit, so the area is worked out rather than guessed.
 */
export function sizeFromDimensions(line: Line, text: string): Line | null {
  if (line.qtyType !== 'area') return null;
  const m = DIMENSIONS.exec(text);
  if (!m) return null;
  const a = sanitizeDecimal(m[1]);
  const b = sanitizeDecimal(m[2]);
  if (!a || !b || !parseNonNeg(a) || parseNonNeg(a)?.isZero() || !parseNonNeg(b) || parseNonNeg(b)?.isZero()) return null;
  return { ...line, qtyMode: 'parts', qty: '', parts: [{ id: makeId('p'), shape: 'rect', a, b, subtract: false, label: '' }], qtySource: 'operator', unitOrigin: undefined };
}
