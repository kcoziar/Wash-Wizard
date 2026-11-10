import { Dec, parseMoneyCents, parseNonNeg } from './decimal';
import { qtyText } from './format';
import { lineQuantity } from './geometry';
import type { Draft, Line, ServiceKind } from './types';

/**
 * Money policy USD_V1
 * 1. Each selling line = quantity x rate (or flat price), rounded once to cents, HALF_UP.
 * 2. Job minimum applied once as a visible adjustment, with configurable taxability.
 * 3. Discount (fixed or percent of eligible lines) rounded once, allocated by largest
 *    remainder with a stable line-id tie break. No line goes below zero.
 * 4. If a discount drops the subtotal below the minimum the operator must choose
 *    "keep minimum" or "override for this visit".
 * 5. One tax rate applied per taxable line on its discounted amount, HALF_UP.
 * 6. Total = discounted subtotal + tax. Deposit = % of total (HALF_UP) or a fixed amount.
 */
export const MONEY_POLICY = 'USD_V1' as const;

export interface CalcLine {
  id: string;
  name: string;
  detail: string;
  kind: ServiceKind | 'trip' | 'minimum';
  treatment: 'priced' | 'free';
  qty: Dec | null;
  qtyLabel: string;
  amount: number;
  taxable: boolean;
  discountable: boolean;
  discount: number;
  net: number;
  tax: number;
  missing: ('qty' | 'rate' | 'price')[];
  issue: string | null;
}

export interface Issue {
  key: string;
  text: string;
  lineId?: string;
}

export interface Calc {
  lines: CalcLine[];
  excluded: { id: string; name: string }[];
  linesTotal: number;
  minimum: { cents: number | null; adjustment: number; line: CalcLine | null };
  preDiscount: number;
  discount: {
    kind: 'none' | 'fixed' | 'percent';
    label: string;
    requested: number;
    applied: number;
    eligible: number;
    conflict: boolean;
    decision: 'unset' | 'keep' | 'override';
    invalid: string | null;
  };
  subtotal: number;
  tax: { rate: Dec | null; label: string; amount: number; invalid: string | null };
  total: number;
  deposit: { amount: number; balance: number } | null;
  depositInvalid: string | null;
  blocking: Issue[];
  complete: boolean;
}

/** Largest-remainder allocation of `total` cents over weights. Ties go to the smaller id. */
export function allocate(total: number, items: { id: string; amount: number }[]): Map<string, number> {
  const result = new Map<string, number>();
  const sum = items.reduce((s, i) => s + i.amount, 0);
  if (total <= 0 || sum <= 0) {
    items.forEach((i) => result.set(i.id, 0));
    return result;
  }
  const T = BigInt(total);
  const S = BigInt(sum);
  let assigned = 0;
  const rems: { id: string; rem: bigint }[] = [];
  for (const i of items) {
    const exact = T * BigInt(i.amount);
    const share = Number(exact / S);
    result.set(i.id, share);
    assigned += share;
    rems.push({ id: i.id, rem: exact % S });
  }
  let left = total - assigned;
  rems.sort((x, y) => (x.rem === y.rem ? (x.id < y.id ? -1 : x.id > y.id ? 1 : 0) : x.rem > y.rem ? -1 : 1));
  for (const r of rems) {
    if (left <= 0) break;
    if (r.rem === BigInt(0)) continue;
    result.set(r.id, (result.get(r.id) ?? 0) + 1);
    left--;
  }
  return result;
}

/** Selling amount for one line, rounded once. */
export function lineAmount(line: Line): { qty: Dec | null; amount: number | null; missing: CalcLine['missing']; issue: string | null } {
  if (line.qtyType === 'flat') {
    const cents = parseMoneyCents(line.price);
    if (cents == null) return { qty: Dec.int(1), amount: null, missing: ['price'], issue: line.price.trim() ? 'Price must be in dollars and cents' : null };
    return { qty: Dec.int(1), amount: cents, missing: [], issue: null };
  }
  const { qty, issue } = lineQuantity(line);
  const rate = parseNonNeg(line.rate);
  const missing: CalcLine['missing'] = [];
  if (!qty) missing.push('qty');
  if (!rate) missing.push('rate');
  if (!qty || !rate) return { qty, amount: null, missing, issue };
  return { qty, amount: qty.mul(rate).toCents('half_up'), missing: [], issue: null };
}

function pctValid(d: Dec | null, allowZero: boolean): boolean {
  if (!d) return false;
  if (d.sign() < 0) return false;
  if (!allowZero && d.isZero()) return false;
  return d.cmp(Dec.int(100)) <= 0;
}

export function computeQuote(draft: Draft): Calc {
  const p = draft.pricing;
  const lines: CalcLine[] = [];
  const excluded: { id: string; name: string }[] = [];
  const blocking: Issue[] = [];

  for (const line of draft.lines) {
    const name = line.name.trim() || 'Service';
    if (line.treatment === 'excluded') {
      excluded.push({ id: line.id, name });
      continue;
    }
    const { qty, amount, missing, issue } = line.treatment === 'free' ? { ...lineAmount(line), missing: [] as CalcLine['missing'] } : lineAmount(line);
    const qtyLabel = line.qtyType === 'flat' ? '' : qtyText(qty, line.unit, line.eachLabel);
    const cents = line.treatment === 'free' ? 0 : amount ?? 0;
    lines.push({
      id: line.id,
      name,
      detail: line.detail.trim(),
      kind: line.kind,
      treatment: line.treatment,
      qty,
      qtyLabel,
      amount: cents,
      taxable: line.taxable,
      discountable: line.discountable,
      discount: 0,
      net: cents,
      tax: 0,
      missing: line.treatment === 'free' ? [] : missing,
      issue: line.treatment === 'free' ? null : issue,
    });
    if (line.treatment === 'priced') {
      if (missing.includes('qty')) blocking.push({ key: `qty:${line.id}`, text: `${name}: ${issue ?? 'add a quantity'}`, lineId: line.id });
      if (missing.includes('rate')) blocking.push({ key: `rate:${line.id}`, text: `${name}: add your rate`, lineId: line.id });
      if (missing.includes('price')) blocking.push({ key: `price:${line.id}`, text: `${name}: ${issue ?? 'add a price'}`, lineId: line.id });
    }
  }

  if (lines.length === 0) blocking.push({ key: 'no-lines', text: 'Add at least one service' });

  // Visit charge, counted once per visit.
  if (p.trip.state === 'known_value') {
    const cents = parseMoneyCents(p.trip.amount);
    if (cents == null) blocking.push({ key: 'trip', text: 'Trip charge must be a dollar amount' });
    else if (cents > 0) {
      lines.push({
        id: 'zz-trip',
        name: 'Trip charge',
        detail: '',
        kind: 'trip',
        treatment: 'priced',
        qty: null,
        qtyLabel: '',
        amount: cents,
        taxable: p.trip.taxable,
        discountable: p.trip.discountable,
        discount: 0,
        net: cents,
        tax: 0,
        missing: [],
        issue: null,
      });
    }
  }

  const linesTotal = lines.reduce((s, l) => s + l.amount, 0);

  // Job minimum.
  let minimumCents: number | null = null;
  if (p.minimum.state === 'known_value') {
    minimumCents = parseMoneyCents(p.minimum.amount);
    if (minimumCents == null) blocking.push({ key: 'minimum', text: 'Job minimum must be a dollar amount' });
  }
  let minimumLine: CalcLine | null = null;
  if (minimumCents != null && minimumCents > 0 && linesTotal > 0 && linesTotal < minimumCents) {
    const adj = minimumCents - linesTotal;
    minimumLine = {
      id: 'zz-minimum',
      name: 'Job minimum adjustment',
      detail: '',
      kind: 'minimum',
      treatment: 'priced',
      qty: null,
      qtyLabel: '',
      amount: adj,
      taxable: p.minimumTaxable,
      discountable: p.discount.includeMinimum,
      discount: 0,
      net: adj,
      tax: 0,
      missing: [],
      issue: null,
    };
  }
  const priced = minimumLine ? [...lines, minimumLine] : lines;
  const preDiscount = priced.reduce((s, l) => s + l.amount, 0);

  // Discount.
  const eligibleLines = priced.filter((l) => l.treatment === 'priced' && l.discountable && l.amount > 0);
  const eligible = eligibleLines.reduce((s, l) => s + l.amount, 0);
  let requested = 0;
  let invalid: string | null = null;
  let percentDec: Dec | null = null;
  if (p.discount.kind === 'fixed') {
    const c = parseMoneyCents(p.discount.value);
    if (c == null) invalid = 'Enter the discount in dollars and cents';
    else if (c > eligible) invalid = `Discount is larger than the discountable amount`;
    else requested = c;
  } else if (p.discount.kind === 'percent') {
    percentDec = Dec.parse(p.discount.value);
    if (!pctValid(percentDec, false)) invalid = 'Discount must be between 0% and 100%';
    else requested = Dec.cents(eligible).mul(percentDec as Dec).shift(2).toCents('half_up');
  }
  if (invalid) blocking.push({ key: 'discount', text: invalid });

  let applied = requested;
  let conflict = false;
  if (requested > 0 && minimumCents != null && minimumCents > 0 && preDiscount - requested < minimumCents) {
    conflict = true;
    if (p.minimumDecision === 'keep') applied = Math.max(0, Math.min(requested, preDiscount - minimumCents));
    else if (p.minimumDecision === 'unset') blocking.push({ key: 'minimum-decision', text: 'Choose: keep your minimum or override it for this visit' });
  }

  const alloc = allocate(applied, eligibleLines.map((l) => ({ id: l.id, amount: l.amount })));
  for (const l of priced) {
    l.discount = alloc.get(l.id) ?? 0;
    l.net = l.amount - l.discount;
  }
  const subtotal = preDiscount - applied;

  // Tax.
  let taxRate: Dec | null = null;
  let taxInvalid: string | null = null;
  if (p.tax.state === 'known_value') {
    taxRate = Dec.parse(p.tax.rate);
    if (!taxRate || taxRate.sign() < 0 || taxRate.cmp(Dec.int(100)) >= 0) {
      taxInvalid = 'Tax rate must be between 0% and 100%';
      taxRate = null;
      blocking.push({ key: 'tax', text: taxInvalid });
    }
  }
  let taxTotal = 0;
  for (const l of priced) {
    l.tax = taxRate && l.taxable && l.net > 0 ? Dec.cents(l.net).mul(taxRate).shift(2).toCents('half_up') : 0;
    taxTotal += l.tax;
  }
  const total = subtotal + taxTotal;

  // Deposit.
  let deposit: Calc['deposit'] = null;
  let depositInvalid: string | null = null;
  if (p.deposit.kind === 'percent') {
    const d = Dec.parse(p.deposit.value);
    if (!pctValid(d, true)) depositInvalid = 'Deposit must be between 0% and 100%';
    else {
      const amount = Dec.cents(total).mul(d as Dec).shift(2).toCents('half_up');
      deposit = { amount, balance: total - amount };
    }
  } else if (p.deposit.kind === 'fixed') {
    const c = parseMoneyCents(p.deposit.value);
    if (c == null) depositInvalid = 'Enter the deposit in dollars and cents';
    else if (c > total) depositInvalid = 'Deposit cannot be more than the total';
    else deposit = { amount: c, balance: total - c };
  }
  if (depositInvalid) blocking.push({ key: 'deposit', text: depositInvalid });

  if (lines.length > 0 && total <= 0 && !blocking.some((b) => b.lineId)) {
    blocking.push({ key: 'zero', text: 'The quote total is $0.00' });
  }

  const taxLabel = p.tax.label.trim() || 'Sales tax';

  return {
    lines,
    excluded,
    linesTotal,
    minimum: { cents: minimumCents, adjustment: minimumLine?.amount ?? 0, line: minimumLine },
    preDiscount,
    discount: {
      kind: p.discount.kind,
      label: p.discount.label.trim() || 'Discount',
      requested,
      applied,
      eligible,
      conflict,
      decision: p.minimumDecision,
      invalid,
    },
    subtotal,
    tax: { rate: taxRate, label: taxLabel, amount: taxTotal, invalid: taxInvalid },
    total,
    deposit,
    depositInvalid,
    blocking,
    complete: blocking.length === 0,
  };
}
