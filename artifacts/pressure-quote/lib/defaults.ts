import { makeId } from './format';
import type {
  CostKey,
  Costs,
  Draft,
  Job,
  Line,
  QuantityType,
  RatedKind,
  ServiceKind,
  ServiceRate,
  Settings,
  TimeKey,
  Unit,
  UnitSystem,
  Visit,
} from './types';

export const TEMPLATE_VERSION = 'clean-pass-1';

export const SERVICE_META: Record<ServiceKind, { name: string; qtyType: QuantityType; eachLabel: string }> = {
  driveway: { name: 'Driveway', qtyType: 'area', eachLabel: '' },
  walkway: { name: 'Walkway', qtyType: 'area', eachLabel: '' },
  patio: { name: 'Patio', qtyType: 'area', eachLabel: '' },
  stairs: { name: 'Stairs', qtyType: 'each', eachLabel: 'steps' },
  house: { name: 'House wash', qtyType: 'area', eachLabel: '' },
  roof: { name: 'Roof', qtyType: 'area', eachLabel: '' },
  deck: { name: 'Deck', qtyType: 'area', eachLabel: '' },
  fence: { name: 'Fence', qtyType: 'linear', eachLabel: '' },
  gutters: { name: 'Gutters', qtyType: 'linear', eachLabel: '' },
  custom: { name: 'Custom service', qtyType: 'flat', eachLabel: '' },
};

export const RATED_KINDS: RatedKind[] = ['driveway', 'walkway', 'patio', 'stairs', 'house', 'roof', 'deck', 'fence', 'gutters'];
/** Shown first when the operator has not picked their own list. Also what earlier versions showed. */
export const CORE_KINDS: RatedKind[] = ['driveway', 'walkway', 'patio', 'stairs'];

/** The operator's own list first, in the built-in order; the remaining built-ins sit behind "More". */
export function shownKinds(settings: Pick<Settings, 'services'>): { first: RatedKind[]; more: RatedKind[] } {
  const picked = RATED_KINDS.filter((k) => settings.services.includes(k));
  const first = picked.length ? picked : CORE_KINDS;
  return { first, more: RATED_KINDS.filter((k) => !first.includes(k)) };
}

export const DEFAULT_TERMS =
  'Price covers the areas and conditions listed above. If we find something different on site, we will talk with you before doing any extra work. Results on oil, rust and deep stains vary and are not guaranteed unless listed. Please clear the work areas and make an outdoor water tap available.';

export function unitFor(qtyType: QuantityType, system: UnitSystem): Unit {
  switch (qtyType) {
    case 'area':
      return system === 'metric' ? 'sqm' : 'sqft';
    case 'linear':
      return system === 'metric' ? 'm' : 'ft';
    case 'each':
      return 'each';
    case 'hours':
      return 'hour';
    case 'flat':
      return 'job';
  }
}

export const DEFAULT_CUSTOMER_NOTE = 'Reply YES to book.';

export function defaultSettings(): Settings {
  const rates = Object.fromEntries(RATED_KINDS.map((k) => [k, defaultRate(k, 'imperial')])) as Settings['rates'];
  return {
    schema: 1,
    business: { name: '', phone: '', email: '', logo: null },
    units: 'imperial',
    rates,
    minimum: { state: 'unknown', amount: '' },
    minimumTaxable: true,
    trip: { state: 'unknown', amount: '', taxable: true },
    tax: { state: 'unknown', rate: '', label: 'Sales tax' },
    deposit: { kind: 'none', value: '' },
    validDays: '30',
    terms: DEFAULT_TERMS,
    ownerTarget: { state: 'unknown', rate: '' },
    marginTarget: { state: 'unknown', percent: '' },
    visit: {
      travel: { state: 'unknown', minutes: '' },
      setup: { state: 'unknown', minutes: '' },
      cleanup: { state: 'unknown', minutes: '' },
      admin: { state: 'unknown', minutes: '' },
    },
    costs: {
      materials: { state: 'unknown', amount: '', basis: 'visit' },
      labor: { state: 'unknown', amount: '', basis: 'hour' },
      equipment: { state: 'unknown', amount: '', basis: 'hour' },
      vehicle: { state: 'unknown', amount: '', basis: 'visit' },
      disposal: { state: 'unknown', amount: '', basis: 'visit' },
      overhead: { state: 'unknown', amount: '', basis: 'visit' },
    },
    customerNote: DEFAULT_CUSTOMER_NOTE,
    customServices: [],
    savedSizes: {},
    services: [...CORE_KINDS],
  };
}

/** A built-in service with no rate saved yet. */
export function defaultRate(kind: RatedKind, system: UnitSystem): ServiceRate {
  const meta = SERVICE_META[kind];
  return { kind, qtyType: meta.qtyType, unit: unitFor(meta.qtyType, system), eachLabel: meta.eachLabel, rate: '', production: '', taxable: true };
}

export function newLine(kind: ServiceKind, settings: Settings, name?: string): Line {
  const meta = SERVICE_META[kind];
  const rated = kind === 'custom' ? null : settings.rates[kind];
  const qtyType = rated?.qtyType ?? meta.qtyType;
  const saved = rated?.rate ?? '';
  // A saved flat price fills the price; any other saved rate fills the rate.
  const rate = qtyType === 'flat' ? '' : saved;
  const price = qtyType === 'flat' ? saved : '';
  return {
    id: makeId('l'),
    kind,
    name: name ?? meta.name,
    detail: '',
    qtyType,
    unit: rated?.unit ?? unitFor(qtyType, settings.units),
    eachLabel: rated?.eachLabel ?? meta.eachLabel,
    qtyMode: 'direct',
    qty: '',
    parts: [],
    qtySource: 'operator',
    rate,
    rateSource: saved ? 'saved' : 'none',
    price,
    treatment: 'priced',
    taxable: rated?.taxable ?? true,
    discountable: true,
  };
}

function visitFromSettings(settings: Settings): Visit {
  const parts = {} as Visit['parts'];
  const keys: TimeKey[] = ['travel', 'setup', 'work', 'cleanup', 'admin'];
  let anyKnown = false;
  for (const k of keys) {
    if (k === 'work') {
      parts.work = { state: 'unknown', minutes: '', source: 'operator' };
      continue;
    }
    const s = settings.visit[k];
    if (s.state !== 'unknown') anyKnown = true;
    parts[k] = { state: s.state, minutes: s.minutes, source: s.state === 'unknown' ? 'operator' : 'saved' };
  }
  return { mode: anyKnown ? 'parts' : 'total', total: { state: 'unknown', minutes: '', source: 'operator' }, parts };
}

function costsFromSettings(settings: Settings): Costs {
  const out = {} as Costs;
  (Object.keys(settings.costs) as CostKey[]).forEach((k) => {
    const s = settings.costs[k];
    out[k] = { state: s.state, amount: s.amount, basis: s.basis, source: s.state === 'unknown' ? 'operator' : 'saved' };
  });
  return out;
}

export function newDraft(settings: Settings, kinds: ServiceKind[] = []): Draft {
  return {
    lines: kinds.map((k) => newLine(k, settings)),
    pricing: {
      minimum: { state: settings.minimum.state, amount: settings.minimum.amount, source: 'saved' },
      minimumTaxable: settings.minimumTaxable,
      trip: { state: settings.trip.state, amount: settings.trip.amount, taxable: settings.trip.taxable, discountable: false, source: 'saved' },
      discount: { kind: 'none', value: '', label: 'Discount', includeMinimum: false },
      minimumDecision: 'unset',
      tax: { state: settings.tax.state, rate: settings.tax.rate, label: settings.tax.label, source: 'saved' },
      deposit: { ...settings.deposit },
    },
    customer: { name: '', phone: '', email: '', address: '', source: 'operator' },
    customerNote: settings.customerNote,
    terms: settings.terms,
    validDays: settings.validDays,
    visit: visitFromSettings(settings),
    costs: costsFromSettings(settings),
    ownerTarget: { state: settings.ownerTarget.state, rate: settings.ownerTarget.rate, source: settings.ownerTarget.state === 'unknown' ? 'operator' : 'saved' },
    budget: { state: 'unknown', amount: '', source: 'operator', evidence: '' },
    questions: [],
  };
}

export function jobLabel(draft: Draft): string {
  const names = draft.lines.filter((l) => l.treatment !== 'excluded').map((l) => l.name.trim()).filter(Boolean);
  if (names.length === 0) return 'New quote';
  if (names.length <= 2) return names.join(' + ');
  return `${names[0]} + ${names.length - 1} more`;
}

export function newJob(draft: Draft, number: number, opts: { sample?: boolean; request?: string } = {}): Job {
  const now = Date.now();
  return {
    schema: 1,
    id: makeId('j'),
    number,
    createdAt: now,
    updatedAt: now,
    sample: !!opts.sample,
    status: 'draft',
    label: opts.sample ? `Sample: ${jobLabel(draft)}` : jobLabel(draft),
    draft,
    request: opts.request ? { text: opts.request, at: now } : null,
    privateNotes: '',
    revisions: [],
    dirtySince: null,
    pendingFinalizationId: null,
    shares: [],
    outcome: null,
    useForSuggestions: !opts.sample,
  };
}

/** A clearly labelled sample job. Its rates belong to the sample and are never saved as the operator's. */
export function sampleDraft(settings: Settings): Draft {
  const d = newDraft(settings, []);
  const base = (kind: ServiceKind, name: string): Line => ({ ...newLine(kind, settings, name), rateSource: 'sample', qtySource: 'sample' });
  const drive = base('driveway', 'Driveway');
  drive.unit = 'sqft';
  drive.qtyMode = 'parts';
  drive.parts = [{ id: makeId('p'), shape: 'rect', a: '24', b: '36', subtract: false, label: 'Main pad' }];
  drive.rate = '0.18';
  drive.detail = 'Surface clean and rinse';
  const walk = base('walkway', 'Front walk');
  walk.unit = 'sqft';
  walk.qty = '120';
  walk.rate = '0.25';
  const steps = base('stairs', 'Front steps');
  steps.qty = '6';
  steps.rate = '8';
  const curb = base('custom', 'Curb rinse');
  curb.treatment = 'free';
  curb.detail = 'Included with this visit';
  const stains = base('custom', 'Oil stain treatment');
  stains.treatment = 'excluded';
  d.lines = [drive, walk, steps, curb, stains];
  d.pricing.minimum = { state: 'known_value', amount: '150', source: 'sample' };
  d.pricing.trip = { state: 'not_applicable', amount: '', taxable: false, discountable: false, source: 'sample' };
  d.pricing.tax = { state: 'known_zero', rate: '', label: 'Sales tax', source: 'sample' };
  d.pricing.deposit = { kind: 'none', value: '' };
  d.customer = { name: 'Sample Customer', phone: '', email: '', address: '123 Example Street', source: 'sample' };
  d.visit = {
    mode: 'parts',
    total: { state: 'unknown', minutes: '', source: 'sample' },
    parts: {
      travel: { state: 'known_value', minutes: '30', source: 'sample' },
      setup: { state: 'known_value', minutes: '15', source: 'sample' },
      work: { state: 'known_value', minutes: '120', source: 'sample' },
      cleanup: { state: 'known_value', minutes: '15', source: 'sample' },
      admin: { state: 'known_value', minutes: '10', source: 'sample' },
    },
  };
  d.costs = {
    materials: { state: 'known_value', amount: '12', basis: 'visit', source: 'sample' },
    labor: { state: 'known_zero', amount: '', basis: 'hour', source: 'sample' },
    equipment: { state: 'known_value', amount: '6', basis: 'hour', source: 'sample' },
    vehicle: { state: 'known_value', amount: '9', basis: 'visit', source: 'sample' },
    disposal: { state: 'not_applicable', amount: '', basis: 'visit', source: 'sample' },
    overhead: { state: 'known_value', amount: '10', basis: 'visit', source: 'sample' },
  };
  d.ownerTarget = { state: 'known_value', rate: '50', source: 'sample' };
  return d;
}
