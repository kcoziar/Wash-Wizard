import { Dec, parseMoneyCents, parseNonNeg } from './decimal';
import { lineQuantity } from './geometry';
import { RATED_KINDS } from './defaults';
import type { Calc } from './pricing';
import type { CostKey, Draft, InputState, Job, RatedKind, Settings, TimeKey } from './types';

export const TIME_KEYS: TimeKey[] = ['travel', 'setup', 'work', 'cleanup', 'admin'];
export const COST_KEYS: CostKey[] = ['materials', 'labor', 'equipment', 'vehicle', 'disposal', 'overhead'];

export const TIME_LABELS: Record<TimeKey, string> = {
  travel: 'Travel, round trip',
  setup: 'Setup',
  work: 'Cleaning',
  cleanup: 'Pack up',
  admin: 'Admin & follow-up',
};

export const COST_LABELS: Record<CostKey, string> = {
  materials: 'Chemicals & materials',
  labor: 'Paid help',
  equipment: 'Equipment wear',
  vehicle: 'Fuel & vehicle',
  disposal: 'Disposal & access',
  overhead: 'Overhead share',
};

const RATED: RatedKind[] = RATED_KINDS;

function minutesOf(e: { state: InputState; minutes: string }): number | null {
  if (e.state === 'known_zero' || e.state === 'not_applicable') return 0;
  if (e.state !== 'known_value') return null;
  const d = parseNonNeg(e.minutes);
  return d ? d.toNumber() : null;
}

/** Cleaning minutes estimated from the operator's own production rates. Null when any line lacks one. */
export function derivedWorkMinutes(draft: Draft, settings: Settings): number | null {
  let total = 0;
  let any = false;
  for (const line of draft.lines) {
    if (line.treatment === 'excluded') continue;
    if (!RATED.includes(line.kind as RatedKind) || line.qtyType === 'flat') return null;
    const rate = settings.rates[line.kind as RatedKind];
    const production = parseNonNeg(rate.production);
    if (!production || production.isZero() || rate.unit !== line.unit) return null;
    const { qty } = lineQuantity(line);
    if (!qty) return null;
    total += (qty.toNumber() / production.toNumber()) * 60;
    any = true;
  }
  return any ? Math.round(total) : null;
}

export interface Econ {
  revenue: number;
  minutes: number | null;
  missingTime: string[];
  workDerived: boolean;
  fixedCosts: number;
  perHourCosts: number;
  costs: number | null;
  missingCosts: CostKey[];
  revenuePerHour: number | null;
  available: number | null;
  availablePerHour: number | null;
  target: number | null;
  afterTarget: number | null;
  margin: number | null;
  supportedMinutes: number | null;
  verdict: 'meets' | 'below' | 'unknown';
}

/** Whole-visit minutes supported at the owner's target pay. Null when the hourly burden is zero. */
export function supportedMinutes(revenue: number, fixed: number, targetPerHour: number, variablePerHour: number): number | null {
  const den = targetPerHour + variablePerHour;
  if (den <= 0) return null;
  const num = revenue - fixed;
  if (num <= 0) return 0;
  return Math.floor((num * 60) / den);
}

/** Per-hour costs for a visit length, rounded HALF_UP to the cent. */
export function hourlyCostCents(perHourCents: number, minutes: number): number | null {
  if (perHourCents === 0) return 0;
  const m = Dec.parse(String(minutes));
  if (!m) return null;
  const v = Dec.cents(perHourCents).mul(m).div(Dec.int(60), 2, 'half_up');
  return v ? v.toCents('half_up') : null;
}

/** The job's known per-hour costs (paid help, equipment wear and so on), in cents per hour. */
export function knownHourlyCosts(draft: Draft): number {
  let cents = 0;
  for (const k of COST_KEYS) {
    const e = draft.costs[k];
    if (e.basis !== 'hour' || e.state !== 'known_value') continue;
    cents += parseMoneyCents(e.amount) ?? 0;
  }
  return cents;
}

/**
 * A rate built only from the operator's own numbers: the cleaning time at their hourly figure,
 * spread over the size and rounded up to cover it. A cost-covering figure, never a market rate.
 */
export function rateFromTime(qty: Dec, minutes: number, perHourCents: number): Dec | null {
  if (qty.sign() <= 0 || !Number.isFinite(minutes) || minutes <= 0 || !Number.isFinite(perHourCents) || perHourCents <= 0) return null;
  const m = Dec.parse(String(minutes));
  if (!m) return null;
  return Dec.cents(perHourCents).mul(m).div(qty.mul(Dec.int(60)), 4, 'up');
}

export function visitMinutes(draft: Draft, settings: Settings): { minutes: number | null; missing: string[]; workDerived: boolean } {
  const v = draft.visit;
  if (v.mode === 'total') {
    const m = minutesOf(v.total);
    return { minutes: m, missing: m == null ? ['Whole visit time'] : [], workDerived: false };
  }
  let total = 0;
  const missing: string[] = [];
  let workDerived = false;
  for (const k of TIME_KEYS) {
    let m = minutesOf(v.parts[k]);
    if (m == null && k === 'work' && v.parts.work.state === 'unknown') {
      m = derivedWorkMinutes(draft, settings);
      if (m != null) workDerived = true;
    }
    if (m == null) missing.push(TIME_LABELS[k]);
    else total += m;
  }
  return { minutes: missing.length ? null : total, missing, workDerived };
}

export function computeEconomics(draft: Draft, calc: Calc, settings: Settings, revenueOverride?: number): Econ {
  const revenue = revenueOverride ?? calc.subtotal;
  const { minutes, missing: missingTime, workDerived } = visitMinutes(draft, settings);

  let fixedCosts = 0;
  let perHourCosts = 0;
  const missingCosts: CostKey[] = [];
  for (const k of COST_KEYS) {
    const c = draft.costs[k];
    if (c.state === 'known_zero' || c.state === 'not_applicable') continue;
    const cents = c.state === 'known_value' ? parseMoneyCents(c.amount) : null;
    if (cents == null) {
      missingCosts.push(k);
      continue;
    }
    if (c.basis === 'hour') perHourCosts += cents;
    else fixedCosts += cents;
  }
  const costsKnown = missingCosts.length === 0;
  const hours = minutes != null ? minutes / 60 : null;

  const revenuePerHour = hours && hours > 0 ? revenue / hours : null;
  // Hourly costs follow the same decimal rounding as every other stored amount (HALF_UP to the cent).
  const hourly = minutes != null ? hourlyCostCents(perHourCosts, minutes) : null;
  const costs = costsKnown && hourly != null ? fixedCosts + hourly : null;
  const available = costs != null ? revenue - costs : null;
  const availablePerHour = available != null && hours && hours > 0 ? available / hours : null;

  const target = draft.ownerTarget.state === 'known_value' ? parseMoneyCents(draft.ownerTarget.rate) : null;
  const afterTarget = available != null && target != null && hours != null ? Math.round(available - target * hours) : null;
  const margin = afterTarget != null && revenue > 0 ? afterTarget / revenue : null;
  const supported = costsKnown && target != null ? supportedMinutes(revenue, fixedCosts, target, perHourCosts) : null;
  // The verdict uses the exact figures; only the displayed supported time is rounded down to a minute.
  const verdict: Econ['verdict'] =
    costsKnown && target != null && minutes != null && target + perHourCosts > 0 ? ((revenue - fixedCosts) * 60 >= (target + perHourCosts) * minutes ? 'meets' : 'below') : 'unknown';

  return {
    revenue,
    minutes,
    missingTime,
    workDerived,
    fixedCosts,
    perHourCosts,
    costs,
    missingCosts,
    revenuePerHour,
    available,
    availablePerHour,
    target,
    afterTarget,
    margin,
    supportedMinutes: supported,
    verdict,
  };
}

/** Lowest price that reaches a margin target: C / (1 - m), rounded up to the next cent. */
export function priceForMargin(costCents: number, marginPercent: string): number | null {
  const m = Dec.parse(marginPercent);
  if (!m || m.sign() < 0 || m.cmp(Dec.int(100)) >= 0) return null;
  const price = Dec.cents(costCents).mul(Dec.int(100)).div(Dec.int(100).sub(m), 2, 'up');
  return price ? Number(price.n) : null;
}

/** Cost plus markup: C x (1 + k), rounded HALF_UP. Markup is not margin. */
export function priceForMarkup(costCents: number, markupPercent: string): number | null {
  const k = Dec.parse(markupPercent);
  if (!k || k.sign() < 0) return null;
  return Dec.cents(costCents).mul(Dec.int(100).add(k)).shift(2).toCents('half_up');
}

export function marginOf(priceCents: number, costCents: number): number | null {
  return priceCents > 0 ? (priceCents - costCents) / priceCents : null;
}

export function markupOf(priceCents: number, costCents: number): number | null {
  return costCents > 0 ? (priceCents - costCents) / costCents : null;
}

export interface Suggestion {
  /** Cleaning time only. Travel, setup and pack-up are the operator's own entries for this visit. */
  workMinutes: number;
  low: number;
  high: number;
  count: number;
  from: number;
  to: number;
  kind: RatedKind;
}

/**
 * Cleaning-time suggestion from at least five of the operator's own finished jobs of the same single
 * surface, scaled by area. Only the separately recorded cleaning time is scaled, never a whole visit,
 * so known travel and setup are never contradicted. Jobs that mixed surfaces are left out.
 */
export function suggestWorkMinutes(jobs: Job[], draft: Draft, currentJobId: string): Suggestion | null {
  const priced = (d: Draft) => d.lines.filter((l) => l.treatment !== 'excluded');
  const lines = priced(draft);
  const primary = lines[0];
  if (!primary || !RATED.includes(primary.kind as RatedKind) || primary.qtyType !== 'area') return null;
  const kind = primary.kind as RatedKind;
  const unit = primary.unit;
  /** Total area when every priced line is this one surface in this unit; otherwise not comparable. */
  const areaOf = (d: Draft): number | null => {
    const ls = priced(d);
    if (!ls.length) return null;
    let sum = 0;
    for (const l of ls) {
      if (l.kind !== kind || l.unit !== unit || l.qtyType !== 'area') return null;
      const { qty } = lineQuantity(l);
      if (!qty) return null;
      sum += qty.toNumber();
    }
    return sum > 0 ? sum : null;
  };
  const current = areaOf(draft);
  if (!current) return null;

  const samples: { perUnit: number; at: number }[] = [];
  for (const j of jobs) {
    if (j.id === currentJobId || j.sample || !j.useForSuggestions || j.status !== 'completed' || !j.outcome) continue;
    if (j.outcome.workMinutes.state !== 'known_value') continue;
    const mins = parseNonNeg(j.outcome.workMinutes.minutes)?.toNumber();
    const basis = j.revisions.length ? j.revisions[j.revisions.length - 1].inputs : j.draft;
    const area = areaOf(basis);
    if (!mins || !area) continue;
    samples.push({ perUnit: mins / area, at: j.outcome.completedAt });
  }
  if (samples.length < 5) return null;
  const sorted = samples.map((x) => x.perUnit).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const times = samples.map((x) => x.at);
  return {
    workMinutes: Math.max(5, Math.round((median * current) / 5) * 5),
    low: Math.round(sorted[0] * current),
    high: Math.round(sorted[sorted.length - 1] * current),
    count: samples.length,
    from: Math.min(...times),
    to: Math.max(...times),
    kind,
  };
}
