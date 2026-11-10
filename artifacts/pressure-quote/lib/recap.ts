import { parseMoneyCents, parseNonNeg } from './decimal';
import type { EconSummary, Outcome } from './types';

/** Estimated (from the quote) against actual (from the recap), always on the same basis. */
export interface RecapNumbers {
  quoted: number;
  price: number;
  plannedMinutes: number | null;
  minutes: number | null;
  plannedCosts: number | null;
  costs: number | null;
  costsSource: 'entered' | 'planned' | 'unknown';
  /** Costs known: what was left per hour after them. Otherwise only what came in per hour. */
  basis: 'after_costs' | 'before_costs';
  perHour: number | null;
  plannedPerHour: number | null;
}

export function recapNumbers(econ: EconSummary, outcome: Outcome): RecapNumbers {
  const price = outcome.finalPrice.state === 'known_value' ? (parseMoneyCents(outcome.finalPrice.amount) ?? econ.revenue) : econ.revenue;
  const minutes = outcome.minutes.state === 'known_value' ? (parseNonNeg(outcome.minutes.minutes)?.toNumber() ?? null) : null;
  const entered = outcome.costs.state === 'known_value' ? parseMoneyCents(outcome.costs.amount) : null;
  const costs = entered ?? econ.costs;
  const basis: RecapNumbers['basis'] = costs != null ? 'after_costs' : 'before_costs';
  const hours = minutes && minutes > 0 ? minutes / 60 : null;
  const perHour = hours == null ? null : basis === 'after_costs' ? (price - (costs as number)) / hours : price / hours;
  // Compare like with like: a before-costs actual is never set against an after-costs plan.
  const plannedPerHour = basis === 'after_costs' ? (econ.costs != null ? econ.availablePerHour : null) : econ.revenuePerHour;
  return {
    quoted: econ.revenue,
    price,
    plannedMinutes: econ.minutes,
    minutes,
    plannedCosts: econ.costs,
    costs,
    costsSource: entered != null ? 'entered' : econ.costs != null ? 'planned' : 'unknown',
    basis,
    perHour,
    plannedPerHour,
  };
}

export function perHourLabel(basis: RecapNumbers['basis']): string {
  return basis === 'after_costs' ? 'Left per hour after costs' : 'Brought in per hour \u00B7 Before costs';
}
