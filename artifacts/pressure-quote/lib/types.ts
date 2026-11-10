/**
 * Domain model. Blank never means zero: every optional number carries an
 * explicit InputState so "unknown", "none" and "not applicable" stay distinct.
 */
export type InputState = 'known_value' | 'known_zero' | 'unknown' | 'not_applicable';

/** Where a value came from. "customer" means customer-supplied and unverified. */
export type Source = 'operator' | 'customer' | 'confirmed' | 'saved' | 'derived' | 'sample' | 'record';

export type ServiceKind = 'driveway' | 'walkway' | 'patio' | 'stairs' | 'custom';
export type RatedKind = Exclude<ServiceKind, 'custom'>;
export type QuantityType = 'area' | 'linear' | 'each' | 'hours' | 'flat';
export type Unit = 'sqft' | 'sqm' | 'ft' | 'm' | 'each' | 'hour' | 'job';
export type UnitSystem = 'imperial' | 'metric';

export interface Part {
  id: string;
  shape: 'rect' | 'triangle' | 'value';
  a: string;
  b: string;
  subtract: boolean;
  label: string;
}

export interface Line {
  id: string;
  kind: ServiceKind;
  name: string;
  /** Customer-facing detail shown under the service name. */
  detail: string;
  qtyType: QuantityType;
  unit: Unit;
  /** Label for "each" quantities, e.g. "steps". */
  eachLabel: string;
  qtyMode: 'direct' | 'parts';
  qty: string;
  parts: Part[];
  qtySource: Source;
  /** Price per unit (area, linear, each, hours). */
  rate: string;
  rateSource: 'saved' | 'entered' | 'built' | 'sample' | 'none';
  /** Price for flat lines. */
  price: string;
  treatment: 'priced' | 'free' | 'excluded';
  taxable: boolean;
  discountable: boolean;
  /** Values from before the last unit switch, restored exactly on switching back (this session only). */
  unitOrigin?: LineOrigin;
  /** Values from before the last change of pricing basis, restored on switching back (this session only). */
  basisOrigin?: LineOrigin;
}

/** A snapshot of how a line was measured and priced, kept so a switch can be undone exactly. */
export interface LineOrigin {
  qtyType: QuantityType;
  unit: Unit;
  eachLabel: string;
  qtyMode: 'direct' | 'parts';
  qty: string;
  parts: Part[];
  qtySource: Source;
  rate: string;
  rateSource: Line['rateSource'];
  /** The values right after the switch. The snapshot is used only while these are unchanged. */
  after: string;
}

export type TimeKey = 'travel' | 'setup' | 'work' | 'cleanup' | 'admin';
export interface TimeEntry {
  state: InputState;
  minutes: string;
  source: Source;
}
export interface Visit {
  mode: 'total' | 'parts';
  total: TimeEntry;
  parts: Record<TimeKey, TimeEntry>;
}

export type CostKey = 'materials' | 'labor' | 'equipment' | 'vehicle' | 'disposal' | 'overhead';
export interface CostEntry {
  state: InputState;
  amount: string;
  basis: 'visit' | 'hour';
  source: Source;
}
export type Costs = Record<CostKey, CostEntry>;

export interface Pricing {
  minimum: { state: InputState; amount: string; source: Source };
  minimumTaxable: boolean;
  trip: { state: InputState; amount: string; taxable: boolean; discountable: boolean; source: Source };
  discount: { kind: 'none' | 'fixed' | 'percent'; value: string; label: string; includeMinimum: boolean };
  minimumDecision: 'unset' | 'keep' | 'override';
  tax: { state: InputState; rate: string; label: string; source: Source };
  deposit: { kind: 'none' | 'percent' | 'fixed'; value: string };
}

export interface Customer {
  name: string;
  phone: string;
  email: string;
  address: string;
  source: Source;
}

export interface Budget {
  state: InputState;
  amount: string;
  source: Source;
  evidence: string;
}

export type QuestionKind = 'combined_area' | 'missing_qty' | 'amount_meaning' | 'other_service' | 'condition' | 'extra_measure' | 'scope';

export interface Question {
  id: string;
  kind: QuestionKind;
  prompt: string;
  /** The exact words from the request that raised the question. */
  evidence: string;
  lineIds: string[];
  resolved: boolean;
  answer: string;
  /** from: 'operator' when the question came from the operator's own notes, so sizes it sets are not customer-supplied. */
  payload: { area?: string; unit?: Unit; amount?: string; label?: string; from?: 'operator' };
}

export interface Draft {
  lines: Line[];
  pricing: Pricing;
  customer: Customer;
  customerNote: string;
  terms: string;
  validDays: string;
  visit: Visit;
  costs: Costs;
  ownerTarget: { state: InputState; rate: string; source: Source };
  budget: Budget;
  questions: Question[];
}

export type JobStatus = 'draft' | 'quoted' | 'sent' | 'accepted' | 'declined' | 'completed';

/** The allowlisted customer-facing quote model. Nothing private may be added here. */
export interface QuoteDoc {
  v: 1;
  sample: boolean;
  reference: string;
  issuedAt: number;
  validUntil: number | null;
  business: { name: string; phone: string; email: string; logo: string | null };
  customer: { name: string; address: string };
  lines: { name: string; detail: string; qty: string; amount: number; included: boolean }[];
  excluded: string[];
  subtotal: number;
  minimumAdjustment: number;
  discount: { label: string; amount: number } | null;
  tax: { label: string; amount: number } | null;
  total: number;
  deposit: { amount: number; balance: number } | null;
  notes: string;
  terms: string;
}

/** Frozen private economics at the time of a revision. Never rendered for customers. */
export interface EconSummary {
  revenue: number;
  minutes: number | null;
  costs: number | null;
  revenuePerHour: number | null;
  availablePerHour: number | null;
}

export interface Revision {
  id: string;
  finalizationId: string;
  number: number;
  createdAt: number;
  policy: 'USD_V1';
  template: string;
  reference: string;
  doc: QuoteDoc;
  inputs: Draft;
  economics: EconSummary;
  freeUse: boolean;
  mode: 'free' | 'pro' | 'sample' | 'revision';
}

export interface ShareRecord {
  id: string;
  revisionId: string;
  at: number;
  channel: 'pdf' | 'text' | 'copy' | 'sms';
  /** 'sent' is reported by Messages itself; it means sent from Messages, never delivered. */
  state: 'opened' | 'closed' | 'failed' | 'marked_sent' | 'sent' | 'cancelled';
}

export interface Outcome {
  completedAt: number;
  minutes: TimeEntry;
  workMinutes: TimeEntry;
  finalPrice: { state: InputState; amount: string };
  costs: { state: InputState; amount: string };
  changed: boolean;
  note: string;
}

export interface Job {
  schema: 1;
  id: string;
  number: number;
  createdAt: number;
  updatedAt: number;
  sample: boolean;
  status: JobStatus;
  label: string;
  draft: Draft;
  request: { text: string; at: number } | null;
  privateNotes: string;
  revisions: Revision[];
  /** Set when the working draft changed after the latest revision. */
  dirtySince: number | null;
  pendingFinalizationId: string | null;
  shares: ShareRecord[];
  outcome: Outcome | null;
  useForSuggestions: boolean;
}

export interface ServiceRate {
  kind: RatedKind;
  qtyType: QuantityType;
  unit: Unit;
  eachLabel: string;
  rate: string;
  /** Units cleaned per hour of cleaning time. Blank = not set. */
  production: string;
  taxable: boolean;
}

export interface Settings {
  schema: 1;
  business: { name: string; phone: string; email: string; logo: string | null };
  units: UnitSystem;
  rates: Record<RatedKind, ServiceRate>;
  minimum: { state: InputState; amount: string };
  minimumTaxable: boolean;
  trip: { state: InputState; amount: string; taxable: boolean };
  tax: { state: InputState; rate: string; label: string };
  deposit: { kind: 'none' | 'percent' | 'fixed'; value: string };
  validDays: string;
  terms: string;
  ownerTarget: { state: InputState; rate: string };
  marginTarget: { state: InputState; percent: string };
  visit: Record<Exclude<TimeKey, 'work'>, { state: InputState; minutes: string }>;
  costs: Record<CostKey, { state: InputState; amount: string; basis: 'visit' | 'hour' }>;
  /** Default note printed on new quotes. */
  customerNote: string;
  /** The operator's own services, shown as chips after the built-in ones. */
  customServices: SavedService[];
}

export interface SavedService {
  id: string;
  name: string;
  qtyType: QuantityType;
  unit: Unit;
  eachLabel: string;
  /** Per-unit rate, or the flat price when qtyType is 'flat'. Blank = not set. */
  rate: string;
  taxable: boolean;
}

export interface Meta {
  schema: 1;
  installedAt: number;
  nextNumber: number;
  firstOfferShown: boolean;
  reviewRequestedAt: number | null;
  meaningfulActions: number;
  /** Set only after the user confirms the exported file was saved somewhere. */
  lastBackupAt: number | null;
  /** First-run setup finished or skipped. Existing installs are marked done on load. */
  onboarded: boolean;
  /** Unfinished text in the "From a customer's message" screen. */
  captureDraft: string;
  /** Backup reminder: quotes created and time when it was last answered or dismissed. */
  backupMarkQuotes: number;
  backupMarkAt: number | null;
  /** The calm "See what Pro adds" card after the first free quote. */
  offerCardDismissed: boolean;
  /** "That was your last free quote" has been shown. */
  lastFreeNoticeShown: boolean;
  /** "Pro ended" card dismissed at. */
  endedCardDismissedAt: number | null;
}

export interface LedgerEntry {
  finalizationId: string;
  jobId: string;
  at: number;
}

export interface Ledger {
  v: 1;
  entries: LedgerEntry[];
}

export const FREE_QUOTES = 3;
