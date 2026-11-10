import { parseNonNeg } from './decimal';
import { RATED_KINDS, SERVICE_META, unitFor } from './defaults';
import type { RatedKind, Settings } from './types';

export type RateAnswer = { mode: 'rate' | 'flat'; value: string };
export type SetupAnswers = {
  /** Built-in services picked on the first step. They lead on Home; the rest stay under "More". */
  services?: RatedKind[];
  rates: Partial<Record<RatedKind, RateAnswer>>;
  minimum: string;
  target: string;
  /** "Do you charge sales tax?": unanswered leaves the quote saying "Plus any applicable sales tax". */
  tax?: { charge: 'yes' | 'no' | ''; rate: string };
  name: string;
  phone: string;
};

/** Setup steps, in order. A skipped step saves nothing. */
export const SETUP_STEP = { services: 0, rates: 1, minimumAndTarget: 2, business: 3 } as const;

const positive = (t: string) => {
  const d = parseNonNeg(t);
  return !!d && !d.isZero();
};

/**
 * The first-run answers applied to the saved settings. Only steps that were answered count, and a
 * blank or zero answer changes nothing, so skipping never saves a made-up value.
 */
export function applyAnswers(base: Settings, a: SetupAnswers, skipped: ReadonlySet<number>): Settings {
  const next: Settings = { ...base, rates: { ...base.rates } };
  const picked = RATED_KINDS.filter((k) => a.services?.includes(k));
  if (!skipped.has(SETUP_STEP.services) && picked.length) next.services = picked;
  if (!skipped.has(SETUP_STEP.rates)) {
    for (const k of RATED_KINDS) {
      const ans = a.rates[k];
      if (!ans || !positive(ans.value)) continue;
      const r = base.rates[k];
      if (ans.mode === 'flat') {
        next.rates[k] = { ...r, qtyType: 'flat', unit: 'job', rate: ans.value, production: '' };
      } else {
        const qtyType = r.qtyType === 'flat' ? SERVICE_META[k].qtyType : r.qtyType;
        const unit = r.qtyType === 'flat' ? unitFor(qtyType, base.units) : r.unit;
        next.rates[k] = { ...r, qtyType, unit, rate: ans.value, production: r.qtyType === qtyType ? r.production : '' };
      }
    }
  }
  if (!skipped.has(SETUP_STEP.minimumAndTarget)) {
    if (positive(a.minimum)) next.minimum = { state: 'known_value', amount: a.minimum };
    if (positive(a.target)) next.ownerTarget = { state: 'known_value', rate: a.target };
    if (a.tax?.charge === 'no') next.tax = { ...base.tax, state: 'known_zero', rate: '' };
    else if (a.tax?.charge === 'yes' && positive(a.tax.rate)) next.tax = { ...base.tax, state: 'known_value', rate: a.tax.rate.trim() };
  }
  if (!skipped.has(SETUP_STEP.business)) {
    const name = a.name.trim();
    const phone = a.phone.trim();
    if (name || phone) next.business = { ...base.business, name: name || base.business.name, phone: phone || base.business.phone };
  }
  return next;
}
