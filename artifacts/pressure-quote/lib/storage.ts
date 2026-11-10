import { z } from 'zod';
import { CORE_KINDS, RATED_KINDS, defaultRate, defaultSettings, newDraft } from './defaults';
import { withDraft } from './jobState';
import { parseNonNeg } from './decimal';
import { isSafeLogo } from './logo';
import { SIZE_KEY } from './sizes';
import type { Draft, Job, Ledger, Line, Meta, Outcome, Question, QuoteDoc, Revision, SavedService, SavedSize, Settings, ShareRecord, TimeEntry } from './types';

/**
 * Local persistence. Every record lives under its own key so a single write is atomic per record.
 * Writes are serialized. Creating a quote writes a per-quote recovery journal first, so a crash between
 * "quote saved" and "free quote counted" is completed on next launch: never lost, never counted twice.
 * Logos inside saved quotes are stored once per distinct image and referenced by key.
 */

/** The key-value contract the app needs. AsyncStorage satisfies it; tests inject an in-memory store with faults. */
export interface KV {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  multiGet(keys: readonly string[]): Promise<readonly (readonly [string, string | null])[]>;
  multiSet(pairs: ReadonlyArray<readonly [string, string]>): Promise<void>;
  multiRemove(keys: readonly string[]): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
}

let backend: KV | null = null;
export function setStorageBackend(kv: KV) {
  backend = kv;
  knownLogos.clear();
}
function db(): KV {
  if (!backend) throw new Error('Storage is not ready');
  return backend;
}

const P = 'pwc:v1:';
export const KEYS = {
  settings: `${P}settings`,
  meta: `${P}meta`,
  ledger: `${P}ledger`,
  /** Single journal used by earlier builds; still recovered. */
  journal: `${P}journal`,
  entitlement: `${P}entitlement`,
  pending: `${P}pending-purchase`,
};
const JOB_PREFIX = `${P}job:`;
const JOURNAL_PREFIX = `${P}journal:`;
const LOGO_PREFIX = `${P}logo:`;
export const jobKey = (id: string) => `${JOB_PREFIX}${id}`;
const journalKey = (finalizationId: string) => `${JOURNAL_PREFIX}${finalizationId}`;

let chain: Promise<unknown> = Promise.resolve();
/** Runs storage work one operation at a time. */
export function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parse(raw: string | null | undefined): { ok: true; value: unknown } | { ok: false } {
  if (raw == null) return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

/** Fills missing or mistyped fields from defaults without discarding valid stored values. */
export function mergeDefaults<T>(defaults: T, raw: unknown): T {
  if (raw === undefined) return defaults;
  if (Array.isArray(defaults)) return (Array.isArray(raw) ? raw : defaults) as T;
  if (isObj(defaults)) {
    if (!isObj(raw)) return defaults;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(defaults)) out[k] = mergeDefaults((defaults as Record<string, unknown>)[k], raw[k]);
    return out as T;
  }
  // Nullable fields hold either text (a logo) or a timestamp; both must survive a reload.
  if (defaults === null) return (raw === null || typeof raw === 'string' || (typeof raw === 'number' && Number.isFinite(raw)) ? raw : null) as T;
  if (typeof defaults === 'number') return (typeof raw === 'number' && Number.isFinite(raw) ? raw : defaults) as T;
  return (typeof raw === typeof defaults ? raw : defaults) as T;
}

// ---------- Field validation ----------

const STATES = ['known_value', 'known_zero', 'unknown', 'not_applicable'] as const;
const SOURCES = ['operator', 'customer', 'confirmed', 'saved', 'derived', 'sample', 'record'] as const;
const KINDS = ['driveway', 'walkway', 'patio', 'stairs', 'house', 'roof', 'deck', 'fence', 'gutters', 'custom'] as const;
const QTY_TYPES = ['area', 'linear', 'each', 'hours', 'flat'] as const;
const UNITS = ['sqft', 'sqm', 'ft', 'm', 'each', 'hour', 'job'] as const;
const QUESTION_KINDS = ['combined_area', 'missing_qty', 'amount_meaning', 'other_service', 'condition', 'extra_measure', 'scope', 'size_meaning'] as const;
const MAX_TEXT = 20_000;

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}
function text(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}
function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Resets enumerated fields to their default when the stored value is not one of the allowed values; caps text. */
function fixFields(v: unknown, base: unknown, enums: Record<string, readonly string[]>) {
  if (!isObj(v) || !isObj(base)) return;
  for (const k of Object.keys(base)) {
    const bv = base[k];
    if (isObj(bv)) fixFields(v[k], bv, enums);
    else if (typeof bv === 'string') {
      if (enums[k] && !enums[k].includes(v[k] as string)) v[k] = bv;
      else if (typeof v[k] === 'string' && (v[k] as string).length > MAX_TEXT) v[k] = (v[k] as string).slice(0, MAX_TEXT);
    }
  }
}

const DRAFT_ENUMS: Record<string, readonly string[]> = {
  state: STATES,
  source: SOURCES,
  basis: ['visit', 'hour'],
  kind: ['none', 'fixed', 'percent'],
  minimumDecision: ['unset', 'keep', 'override'],
  mode: ['total', 'parts'],
};

const SETTINGS_ENUMS: Record<string, readonly string[]> = {
  state: STATES,
  basis: ['visit', 'hour'],
  units: ['imperial', 'metric'],
  qtyType: QTY_TYPES,
  unit: UNITS,
};

const lineTemplate = (): Line => ({
  id: '',
  kind: 'custom',
  name: '',
  detail: '',
  qtyType: 'flat',
  unit: 'job',
  eachLabel: '',
  qtyMode: 'direct',
  qty: '',
  parts: [],
  qtySource: 'operator',
  rate: '',
  rateSource: 'none',
  price: '',
  treatment: 'priced',
  taxable: true,
  discountable: true,
});

function normalizeLine(raw: unknown): Line | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || !raw.id) return null;
  const l = mergeDefaults(lineTemplate(), raw);
  return {
    ...l,
    id: l.id.slice(0, 64),
    kind: oneOf(l.kind, KINDS, 'custom'),
    name: l.name.slice(0, 200),
    detail: l.detail.slice(0, 500),
    qtyType: oneOf(l.qtyType, QTY_TYPES, 'flat'),
    unit: oneOf(l.unit, UNITS, 'job'),
    eachLabel: l.eachLabel.slice(0, 40),
    qtyMode: oneOf(l.qtyMode, ['direct', 'parts'] as const, 'direct'),
    qty: l.qty.slice(0, 40),
    parts: (Array.isArray(raw.parts) ? raw.parts : []).slice(0, 50).filter(isObj).map((p, i) => ({
      id: text(p.id, 64) || `p${i}`,
      shape: oneOf(p.shape, ['rect', 'triangle', 'value'] as const, 'value'),
      a: text(p.a, 40),
      b: text(p.b, 40),
      subtract: p.subtract === true,
      label: text(p.label, 80),
    })),
    qtySource: oneOf(l.qtySource, SOURCES, 'operator'),
    rate: l.rate.slice(0, 40),
    rateSource: oneOf(l.rateSource, ['saved', 'entered', 'built', 'sample', 'none'] as const, 'none'),
    price: l.price.slice(0, 40),
    treatment: oneOf(l.treatment, ['priced', 'free', 'excluded'] as const, 'priced'),
  };
}

function normalizeQuestion(raw: unknown): Question | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || !raw.id) return null;
  if (!(QUESTION_KINDS as readonly string[]).includes(raw.kind as string)) return null;
  const p = isObj(raw.payload) ? raw.payload : {};
  const payload: Question['payload'] = {};
  if (typeof p.area === 'string') payload.area = p.area.slice(0, 40);
  if (typeof p.unit === 'string' && (UNITS as readonly string[]).includes(p.unit)) payload.unit = p.unit as Question['payload']['unit'];
  if (typeof p.amount === 'string') payload.amount = p.amount.slice(0, 40);
  if (typeof p.label === 'string') payload.label = p.label.slice(0, 120);
  if (p.from === 'operator') payload.from = 'operator';
  if (typeof p.sizeKey === 'string' && SIZE_KEY.test(p.sizeKey)) payload.sizeKey = p.sizeKey;
  return {
    id: raw.id.slice(0, 64),
    kind: raw.kind as Question['kind'],
    prompt: text(raw.prompt, 500),
    evidence: text(raw.evidence, 1000),
    lineIds: (Array.isArray(raw.lineIds) ? raw.lineIds : []).filter((x): x is string => typeof x === 'string').slice(0, 50),
    resolved: raw.resolved === true,
    answer: text(raw.answer, 200),
    payload,
  };
}

/** Rebuilds a draft from stored data with every field type- and value-checked. */
export function normalizeDraft(raw: unknown): Draft {
  const base = newDraft(defaultSettings(), []);
  const r = isObj(raw) ? raw : {};
  const d = mergeDefaults(base, r);
  fixFields(d, base, DRAFT_ENUMS);
  d.lines = (Array.isArray(r.lines) ? r.lines : []).slice(0, 200).map(normalizeLine).filter((l): l is Line => l !== null);
  d.questions = (Array.isArray(r.questions) ? r.questions : []).slice(0, 50).map(normalizeQuestion).filter((q): q is Question => q !== null);
  return d;
}

function normalizeService(raw: unknown): SavedService | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || !raw.id || typeof raw.name !== 'string' || !raw.name.trim()) return null;
  return {
    id: raw.id.slice(0, 64),
    name: raw.name.slice(0, 80),
    qtyType: oneOf(raw.qtyType, QTY_TYPES, 'flat'),
    unit: oneOf(raw.unit, UNITS, 'job'),
    eachLabel: text(raw.eachLabel, 40),
    rate: text(raw.rate, 40),
    taxable: raw.taxable !== false,
  };
}

export function normalizeSettings(raw: unknown): Settings {
  const base = defaultSettings();
  const s = mergeDefaults(base, raw);
  fixFields(s, base, SETTINGS_ENUMS);
  const savedRates = isObj(raw) && isObj(raw.rates) ? raw.rates : {};
  for (const k of Object.keys(base.rates) as (keyof Settings['rates'])[]) {
    // A service added after these settings were saved starts blank, measured in the operator's units.
    s.rates[k] = isObj(savedRates[k]) ? { ...s.rates[k], kind: k } : defaultRate(k, s.units);
  }
  const listed = isObj(raw) && Array.isArray(raw.services) ? raw.services : [];
  const services = RATED_KINDS.filter((k) => listed.includes(k));
  s.services = services.length ? services : [...CORE_KINDS];
  s.deposit.kind = oneOf(s.deposit.kind, ['none', 'percent', 'fixed'] as const, base.deposit.kind);
  s.business.logo = isSafeLogo(s.business.logo) ? s.business.logo : null;
  s.customServices = (isObj(raw) && Array.isArray(raw.customServices) ? raw.customServices : [])
    .slice(0, 50)
    .map(normalizeService)
    .filter((x): x is SavedService => x !== null);
  s.savedSizes = {};
  const sizes = isObj(raw) && isObj(raw.savedSizes) ? raw.savedSizes : {};
  for (const [k, v] of Object.entries(sizes).slice(0, 50)) {
    if (!SIZE_KEY.test(k) || !isObj(v) || typeof v.qty !== 'string' || typeof v.unit !== 'string' || !(UNITS as readonly string[]).includes(v.unit)) continue;
    const d = parseNonNeg(v.qty);
    if (d && !d.isZero()) s.savedSizes[k] = { qty: v.qty.trim().slice(0, 20), unit: v.unit as SavedSize['unit'] };
  }
  return s;
}

export function defaultMeta(): Meta {
  return {
    schema: 1,
    installedAt: Date.now(),
    nextNumber: 1,
    firstOfferShown: false,
    reviewRequestedAt: null,
    meaningfulActions: 0,
    lastBackupAt: null,
    onboarded: false,
    captureDraft: '',
    backupMarkQuotes: 0,
    backupMarkAt: null,
    offerCardDismissed: false,
    lastFreeNoticeShown: false,
    endedCardDismissedAt: null,
  };
}

export function normalizeMeta(raw: unknown): Meta {
  const m = mergeDefaults(defaultMeta(), raw);
  // Installs from before the welcome screen existed have already been set up.
  if (isObj(raw) && raw.onboarded === undefined) m.onboarded = true;
  m.captureDraft = m.captureDraft.slice(0, 20_000);
  m.nextNumber = Math.max(1, Math.floor(m.nextNumber));
  return m;
}

// ---------- Quote documents and logos ----------

const amount = z.number().finite().min(-1e12).max(1e12);
const str = (max: number) => z.string().max(max);
const docShape = z.object({
  v: z.literal(1),
  sample: z.boolean(),
  reference: str(60),
  issuedAt: z.number().finite(),
  validUntil: z.number().finite().nullable(),
  business: z.object({ name: str(300), phone: str(100), email: str(300), logo: z.string().nullable() }),
  customer: z.object({ name: str(300), address: str(1000) }),
  lines: z.array(z.object({ name: str(300), detail: str(1000), qty: str(200), amount, included: z.boolean() })).max(300),
  excluded: z.array(str(300)).max(300),
  subtotal: amount,
  minimumAdjustment: amount,
  discount: z.object({ label: str(200), amount }).nullable(),
  tax: z.object({ label: str(200), amount }).nullable(),
  total: amount,
  deposit: z.object({ amount, balance: amount }).nullable(),
  notes: str(10_000),
  terms: str(MAX_TEXT),
});

const LOGO_REF = /^logo:[a-z0-9]{4,16}-[a-z0-9]{1,10}$/;
export function logoRef(data: string): string {
  return `logo:${checksum(data)}-${data.length.toString(36)}`;
}
const docRefs = new WeakMap<QuoteDoc, string>();

type LogoLookup = (ref: string) => string | undefined;
interface ReadOpts {
  /** Reject a record with any invalid part instead of dropping that part. Used for imports. */
  strict: boolean;
  logo: LogoLookup;
}

/** Validates a stored quote document. Logos must be the allowlisted data-URI form or a known stored logo. */
export function normalizeDoc(raw: unknown, opts: ReadOpts): QuoteDoc | null {
  const parsed = docShape.safeParse(raw);
  if (!parsed.success) return null;
  const doc = parsed.data as QuoteDoc;
  const logo = doc.business.logo;
  if (logo == null) return doc;
  if (LOGO_REF.test(logo)) {
    const data = opts.logo(logo);
    if (data && isSafeLogo(data)) return { ...doc, business: { ...doc.business, logo: data } };
    return opts.strict ? null : { ...doc, business: { ...doc.business, logo: null } };
  }
  if (isSafeLogo(logo)) return doc;
  return opts.strict ? null : { ...doc, business: { ...doc.business, logo: null } };
}

function normalizeRevision(raw: unknown, opts: ReadOpts): Revision | null {
  if (!isObj(raw)) return null;
  if (typeof raw.id !== 'string' || !raw.id || raw.id.length > 80) return null;
  if (typeof raw.finalizationId !== 'string' || !raw.finalizationId || raw.finalizationId.length > 80) return null;
  if (typeof raw.number !== 'number' || !Number.isInteger(raw.number) || raw.number < 1) return null;
  if (typeof raw.reference !== 'string' || !raw.reference || raw.reference.length > 60) return null;
  const doc = normalizeDoc(raw.doc, opts);
  if (!doc) return null;
  const e = isObj(raw.economics) ? raw.economics : {};
  const freeUse = raw.freeUse === true;
  return {
    id: raw.id,
    finalizationId: raw.finalizationId,
    number: raw.number,
    createdAt: num(raw.createdAt, doc.issuedAt),
    policy: 'USD_V1',
    template: text(raw.template, 40),
    reference: raw.reference,
    doc,
    inputs: normalizeDraft(raw.inputs),
    economics: { revenue: num(e.revenue, doc.total), minutes: numOrNull(e.minutes), costs: numOrNull(e.costs), revenuePerHour: numOrNull(e.revenuePerHour), availablePerHour: numOrNull(e.availablePerHour) },
    freeUse,
    mode: oneOf(raw.mode, ['free', 'pro', 'sample', 'revision'] as const, freeUse ? 'free' : 'revision'),
  };
}

function normalizeTime(raw: unknown): TimeEntry {
  const t = isObj(raw) ? raw : {};
  return { state: oneOf(t.state, STATES, 'unknown'), minutes: text(t.minutes, 20), source: oneOf(t.source, SOURCES, 'record') };
}

function normalizeOutcome(raw: unknown): Outcome | null {
  if (!isObj(raw)) return null;
  const fp = isObj(raw.finalPrice) ? raw.finalPrice : {};
  const co = isObj(raw.costs) ? raw.costs : {};
  return {
    completedAt: num(raw.completedAt, Date.now()),
    minutes: normalizeTime(raw.minutes),
    workMinutes: normalizeTime(raw.workMinutes),
    finalPrice: { state: oneOf(fp.state, STATES, 'unknown'), amount: text(fp.amount, 40) },
    costs: { state: oneOf(co.state, STATES, 'unknown'), amount: text(co.amount, 40) },
    changed: raw.changed === true,
    note: text(raw.note, 5000),
  };
}

function normalizeShare(raw: unknown): ShareRecord | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || typeof raw.revisionId !== 'string') return null;
  return {
    id: raw.id.slice(0, 64),
    revisionId: raw.revisionId.slice(0, 80),
    at: num(raw.at, 0),
    channel: oneOf(raw.channel, ['pdf', 'text', 'copy', 'sms'] as const, 'text'),
    state: oneOf(raw.state, ['opened', 'closed', 'failed', 'marked_sent', 'sent', 'cancelled'] as const, 'closed'),
  };
}

/** Reads one job record. Strict mode rejects the whole record when any revision is invalid. */
export function readJobRecord(raw: unknown, opts: ReadOpts): { job: Job | null; dropped: number } {
  if (!isObj(raw)) return { job: null, dropped: 0 };
  if (typeof raw.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(raw.id)) return { job: null, dropped: 0 };
  if (typeof raw.number !== 'number' || !Number.isInteger(raw.number) || raw.number < (raw.sample === true ? 0 : 1)) return { job: null, dropped: 0 };
  if (raw.schema !== undefined && raw.schema !== 1) return { job: null, dropped: 0 };
  const rawRevisions = Array.isArray(raw.revisions) ? raw.revisions : [];
  if (opts.strict && rawRevisions.length > 500) return { job: null, dropped: 0 };
  const revisions: Revision[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const r of rawRevisions.slice(0, 1000)) {
    const rev = normalizeRevision(r, opts);
    if (!rev || seen.has(rev.finalizationId)) {
      if (opts.strict) return { job: null, dropped: dropped + 1 };
      dropped++;
      continue;
    }
    seen.add(rev.finalizationId);
    revisions.push(rev);
  }
  revisions.sort((a, b) => a.number - b.number);
  const now = Date.now();
  const sample = raw.sample === true;
  const job: Job = {
    schema: 1,
    id: raw.id,
    number: raw.number,
    createdAt: num(raw.createdAt, now),
    updatedAt: num(raw.updatedAt, now),
    sample,
    status: oneOf(raw.status, ['draft', 'quoted', 'sent', 'accepted', 'declined', 'completed'] as const, revisions.length ? 'quoted' : 'draft'),
    label: text(raw.label, 200) || 'Quote',
    draft: normalizeDraft(raw.draft),
    request: isObj(raw.request) && typeof raw.request.text === 'string' ? { text: raw.request.text.slice(0, 10_000), at: num(raw.request.at, now) } : null,
    privateNotes: text(raw.privateNotes, MAX_TEXT),
    revisions,
    dirtySince: numOrNull(raw.dirtySince),
    pendingFinalizationId: typeof raw.pendingFinalizationId === 'string' ? raw.pendingFinalizationId.slice(0, 80) : null,
    shares: (Array.isArray(raw.shares) ? raw.shares : []).slice(0, 2000).map(normalizeShare).filter((x): x is ShareRecord => x !== null),
    outcome: normalizeOutcome(raw.outcome),
    useForSuggestions: raw.useForSuggestions !== false && !sample,
    ...(typeof raw.correctedCustomer === 'string' && raw.correctedCustomer ? { correctedCustomer: raw.correctedCustomer.slice(0, 300) } : {}),
  };
  if (job.status === 'draft' && revisions.length) job.status = 'quoted';
  return { job, dropped };
}

/** Returns null when the record cannot be trusted as a job. */
export function normalizeJob(raw: unknown): Job | null {
  return readJobRecord(raw, { strict: false, logo: () => undefined }).job;
}

/** Collects the logo references a raw stored job uses. */
function rawLogoRefs(raw: unknown, into: Set<string>) {
  if (!isObj(raw) || !Array.isArray(raw.revisions)) return;
  for (const r of raw.revisions) {
    const logo = isObj(r) && isObj(r.doc) && isObj(r.doc.business) ? r.doc.business.logo : null;
    if (typeof logo === 'string' && LOGO_REF.test(logo)) into.add(logo);
  }
}

function dehydrateDoc(doc: QuoteDoc, logos: Map<string, string>): QuoteDoc {
  const logo = doc.business.logo;
  if (!logo || !logo.startsWith('data:')) return doc;
  let ref = docRefs.get(doc);
  if (!ref) {
    ref = logoRef(logo);
    docRefs.set(doc, ref);
  }
  logos.set(ref, logo);
  return { ...doc, business: { ...doc.business, logo: ref } };
}

function dehydrateRevision(r: Revision, logos: Map<string, string>): Revision {
  const doc = dehydrateDoc(r.doc, logos);
  return doc === r.doc ? r : { ...r, doc };
}

function dehydrateJob(job: Job, logos: Map<string, string>): Job {
  if (!job.revisions.some((r) => r.doc.business.logo?.startsWith('data:'))) return job;
  return { ...job, revisions: job.revisions.map((r) => dehydrateRevision(r, logos)) };
}

/** Logo keys this session has confirmed are stored. */
const knownLogos = new Set<string>();

/** Writes records plus any logos they reference that are not stored yet, in one multi-set. */
async function writeWithLogos(pairs: [string, string][], logos: Map<string, string>) {
  const fresh = Array.from(logos.entries()).filter(([ref]) => !knownLogos.has(ref));
  const all: [string, string][] = [...fresh.map(([ref, data]) => [`${LOGO_PREFIX}${ref}`, data] as [string, string]), ...pairs];
  await db().multiSet(all);
  for (const [ref] of fresh) knownLogos.add(ref);
}

async function writeJobRecord(job: Job, extra: [string, string][] = []) {
  const logos = new Map<string, string>();
  const stored = dehydrateJob(job, logos);
  await writeWithLogos([[jobKey(job.id), JSON.stringify(stored)], ...extra], logos);
}

async function readLogos(refs: Set<string>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!refs.size) return out;
  const pairs = await db().multiGet(Array.from(refs).map((r) => `${LOGO_PREFIX}${r}`));
  for (const [k, v] of pairs) {
    if (typeof v === 'string') {
      const ref = k.slice(LOGO_PREFIX.length);
      out.set(ref, v);
      knownLogos.add(ref);
    }
  }
  return out;
}

/** Reads, validates and re-attaches logos for one stored job. Throws on storage failure. */
async function readStoredJob(id: string): Promise<{ raw: unknown; job: Job | null } | null> {
  const p = parse(await db().getItem(jobKey(id)));
  if (!p.ok || p.value === undefined) return p.ok ? null : { raw: undefined, job: null };
  const refs = new Set<string>();
  rawLogoRefs(p.value, refs);
  const logos = await readLogos(refs);
  return { raw: p.value, job: readJobRecord(p.value, { strict: false, logo: (r) => logos.get(r) }).job };
}

async function quarantine(key: string, value: string) {
  try {
    await db().setItem(`${P}unreadable:${Date.now()}:${key.slice(P.length)}`, value);
  } catch {
    // Keep going; the original value is left untouched either way.
  }
}

// ---------- Ledger and journals ----------

function normalizeLedger(raw: unknown): Ledger {
  if (!isObj(raw) || !Array.isArray(raw.entries)) return { v: 1, entries: [] };
  const seen = new Set<string>();
  const entries = raw.entries.filter((e): e is Ledger['entries'][number] => {
    if (!isObj(e) || typeof e.finalizationId !== 'string' || !e.finalizationId || seen.has(e.finalizationId)) return false;
    seen.add(e.finalizationId);
    return true;
  });
  return { v: 1, entries: entries.map((e) => ({ finalizationId: e.finalizationId, jobId: typeof e.jobId === 'string' ? e.jobId : '', at: num(e.at, 0) })) };
}

/** Rebuilds the free-quote record from the quotes themselves. */
async function rebuildLedger(): Promise<Ledger> {
  const keys = (await db().getAllKeys()).filter((k) => k.startsWith(JOB_PREFIX));
  const pairs = await db().multiGet(keys);
  const entries: Ledger['entries'] = [];
  for (const [, v] of pairs) {
    const p = parse(v);
    if (!p.ok || !isObj(p.value) || !Array.isArray(p.value.revisions)) continue;
    for (const r of p.value.revisions) {
      if (isObj(r) && r.freeUse === true && typeof r.finalizationId === 'string') entries.push({ finalizationId: r.finalizationId, jobId: String(p.value.id), at: num(r.createdAt, 0) });
    }
  }
  return normalizeLedger({ entries });
}

async function readLedger(): Promise<Ledger> {
  const raw = await db().getItem(KEYS.ledger);
  const p = parse(raw);
  if (p.ok) return normalizeLedger(p.value);
  // An unreadable record is never silently reset to zero. It is rebuilt from the saved quotes, and
  // every free-quote entry still legible in the damaged copy is kept, so the count never goes down.
  await quarantine(KEYS.ledger, raw as string);
  const rebuilt = await rebuildLedger();
  const salvaged = salvageLedger(typeof raw === 'string' ? raw : '');
  const merged = normalizeLedger({ entries: [...rebuilt.entries, ...salvaged.entries] });
  await db().setItem(KEYS.ledger, JSON.stringify(merged));
  return merged;
}

/** Free-quote entries that can still be read from a damaged ledger record. */
export function salvageLedger(raw: string): Ledger {
  const entries: Ledger['entries'] = [];
  const re = /"finalizationId"\s*:\s*"([^"\\]{1,80})"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) entries.push({ finalizationId: m[1], jobId: '', at: 0 });
  return normalizeLedger({ entries });
}

interface Journal {
  jobId: string;
  revision: Revision;
  freeUse: boolean;
  at: number;
}

function applyCommit(job: Job, ledger: Ledger, j: Journal, draft?: Draft): { job: Job; ledger: Ledger } {
  const already = job.revisions.some((r) => r.finalizationId === j.revision.finalizationId);
  const nextJob: Job = already
    ? { ...job, pendingFinalizationId: null }
    : withDraft(
        {
          ...job,
          revisions: [...job.revisions, j.revision].sort((a, b) => a.number - b.number),
          status: job.status === 'draft' ? 'quoted' : job.status,
          dirtySince: null,
          pendingFinalizationId: null,
          updatedAt: Math.max(job.updatedAt, j.at),
        },
        draft ?? job.draft,
      );
  const counted = ledger.entries.some((e) => e.finalizationId === j.revision.finalizationId);
  const nextLedger: Ledger = j.freeUse && !counted ? { v: 1, entries: [...ledger.entries, { finalizationId: j.revision.finalizationId, jobId: j.jobId, at: j.at }] } : ledger;
  return { job: nextJob, ledger: nextLedger };
}

function readJournal(raw: unknown, logo: LogoLookup): Journal | null {
  if (!isObj(raw) || typeof raw.jobId !== 'string') return null;
  const revision = normalizeRevision(raw.revision, { strict: false, logo });
  if (!revision) return null;
  return { jobId: raw.jobId, revision, freeUse: raw.freeUse === true, at: num(raw.at, Date.now()) };
}

/** Finishes every interrupted quote creation. Runs inside a serialized operation. */
async function recoverJournals(): Promise<number> {
  const keys = (await db().getAllKeys()).filter((k) => k === KEYS.journal || k.startsWith(JOURNAL_PREFIX));
  if (!keys.length) return 0;
  let recovered = 0;
  for (const key of keys) {
    const p = parse(await db().getItem(key));
    if (!p.ok || p.value === undefined) {
      await db().removeItem(key);
      continue;
    }
    const refs = new Set<string>();
    if (isObj(p.value)) rawLogoRefs({ revisions: [p.value.revision] }, refs);
    const logos = await readLogos(refs);
    const j = readJournal(p.value, (r) => logos.get(r));
    if (!j) {
      await db().removeItem(key);
      continue;
    }
    const ledger = await readLedger();
    const stored = await readStoredJob(j.jobId);
    if (stored?.job) {
      const done = applyCommit(stored.job, ledger, j);
      await writeJobRecord(done.job, [[KEYS.ledger, JSON.stringify(done.ledger)]]);
    } else if (j.freeUse && !ledger.entries.some((e) => e.finalizationId === j.revision.finalizationId)) {
      // The job is gone, but the free quote was spent; it still counts.
      await db().setItem(KEYS.ledger, JSON.stringify({ v: 1, entries: [...ledger.entries, { finalizationId: j.revision.finalizationId, jobId: j.jobId, at: j.at }] }));
    }
    await db().removeItem(key);
    recovered++;
  }
  return recovered;
}

// ---------- Load ----------

export interface Snapshot {
  settings: Settings;
  meta: Meta;
  ledger: Ledger;
  jobs: Job[];
  issues: string[];
  firstRun: boolean;
}

/** Loads everything. Throws when storage itself cannot be read, so the app never writes over data it could not see. */
export function loadAll(): Promise<Snapshot> {
  return serial(async () => {
    const issues: string[] = [];
    await recoverJournals();
    const keys = await db().getAllKeys();
    const jobKeys = keys.filter((k) => k.startsWith(JOB_PREFIX));
    const ledger = await readLedger();
    const pairs = await db().multiGet([KEYS.settings, KEYS.meta, ...jobKeys]);
    const map = new Map<string, string | null>(pairs.map(([k, v]) => [k, v]));

    const s = parse(map.get(KEYS.settings));
    if (!s.ok) {
      issues.push('Your saved settings could not be read. Defaults are shown; the original was kept aside.');
      await quarantine(KEYS.settings, map.get(KEYS.settings) as string);
    }
    const rawMeta = map.get(KEYS.meta);
    const firstRun = rawMeta == null && jobKeys.length === 0;
    const settings = normalizeSettings(s.ok ? s.value : undefined);
    const m = parse(rawMeta);
    const meta = normalizeMeta(m.ok ? m.value : undefined);
    if (rawMeta == null && jobKeys.length > 0) meta.onboarded = true;

    const parsed: { key: string; raw: string; value: unknown }[] = [];
    const refs = new Set<string>();
    for (const k of jobKeys) {
      const raw = map.get(k);
      if (raw == null) continue;
      const p = parse(raw);
      if (!p.ok) {
        issues.push('One saved job could not be read. It was kept aside and not deleted.');
        await quarantine(k, raw);
        continue;
      }
      rawLogoRefs(p.value, refs);
      parsed.push({ key: k, raw, value: p.value });
    }
    const logos = await readLogos(refs);

    const jobs: Job[] = [];
    for (const { key, raw, value } of parsed) {
      const { job, dropped } = readJobRecord(value, { strict: false, logo: (r) => logos.get(r) });
      if (!job) {
        issues.push('One saved job could not be read. It was kept aside and not deleted.');
        await quarantine(key, raw);
        continue;
      }
      if (dropped) {
        issues.push('Part of a saved quote history could not be read. The rest of the job is here; the original was kept aside.');
        await quarantine(key, raw);
      }
      jobs.push(job);
    }

    // Remove stored logos nothing refers to any more.
    const orphanLogos = keys.filter((k) => k.startsWith(LOGO_PREFIX) && !refs.has(k.slice(LOGO_PREFIX.length)));
    if (orphanLogos.length) await db().multiRemove(orphanLogos).catch(() => undefined);

    const maxNumber = jobs.reduce((mx, j) => Math.max(mx, j.number), 0);
    if (meta.nextNumber <= maxNumber) meta.nextNumber = maxNumber + 1;
    if (rawMeta == null || !m.ok) await db().setItem(KEYS.meta, JSON.stringify(meta));

    jobs.sort((a, b) => b.updatedAt - a.updatedAt);
    return { settings, meta, ledger, jobs, issues: Array.from(new Set(issues)), firstRun };
  });
}

// ---------- Saves ----------

export function saveSettings(settings: Settings) {
  return serial(() => db().setItem(KEYS.settings, JSON.stringify(settings)));
}

export function saveMeta(meta: Meta) {
  return serial(() => db().setItem(KEYS.meta, JSON.stringify(meta)));
}

/**
 * Saves a job without ever losing a stored quote revision: when the stored record has revisions this
 * copy does not (for example a stale screen), they are kept. Returns the record actually written.
 */
export function saveJob(job: Job): Promise<{ job: Job; merged: boolean }> {
  return serial(async () => {
    const p = parse(await db().getItem(jobKey(job.id)));
    let out = job;
    if (p.ok && isObj(p.value) && Array.isArray(p.value.revisions)) {
      const have = new Set(job.revisions.map((r) => r.finalizationId));
      const missingRaw = p.value.revisions.filter((r) => isObj(r) && typeof r.finalizationId === 'string' && !have.has(r.finalizationId));
      if (missingRaw.length) {
        const refs = new Set<string>();
        rawLogoRefs({ revisions: missingRaw }, refs);
        const logos = await readLogos(refs);
        const missing = missingRaw.map((r) => normalizeRevision(r, { strict: false, logo: (x) => logos.get(x) })).filter((r): r is Revision => r !== null);
        if (missing.length) {
          out = withDraft(
            { ...job, revisions: [...job.revisions, ...missing].sort((a, b) => a.number - b.number), status: job.status === 'draft' ? 'quoted' : job.status },
            job.draft,
          );
        }
      }
    }
    await writeJobRecord(out);
    return { job: out, merged: out !== job };
  });
}

export function removeJob(id: string) {
  return serial(() => db().removeItem(jobKey(id)));
}

export function readJob(id: string): Promise<Job | null> {
  return serial(async () => (await readStoredJob(id))?.job ?? null);
}

export type CommitResult =
  | { ok: true; job: Job; ledger: Ledger; revision: Revision; repeated: boolean }
  | { ok: false; reason: 'blocked' | 'conflict' | 'storage'; message: string; committed: 'no' | 'unknown' };

export type Decide = (stored: Job, freeUsed: number) => { revision: Revision; freeUse: boolean } | { blocked: string };

/**
 * The single place a quote is created. Inside one serialized operation it finishes any interrupted
 * creation, re-reads the stored job and the free-use ledger, replays an already-committed
 * finalization, refuses a stale snapshot, asks the caller's access policy, and commits the immutable
 * revision plus at most one free-use entry. The job's draft becomes the frozen snapshot that was quoted.
 */
export function commitFinalization(snapshot: Job, finalizationId: string, decide: Decide): Promise<CommitResult> {
  return serial(async (): Promise<CommitResult> => {
    let journalWritten = false;
    try {
      await recoverJournals();
      const read = await readStoredJob(snapshot.id);
      if (read && !read.job) {
        return { ok: false, reason: 'storage', message: 'This job could not be read from storage. Nothing was used.', committed: 'no' };
      }
      const stored = read?.job ?? null;
      // A job deleted (or wiped by Delete all) while its quote was being made stays deleted, and nothing is used.
      if (!stored) return { ok: false, reason: 'conflict', message: 'This job was deleted, so the quote was not made. Nothing was used.', committed: 'no' };
      const ledger = await readLedger();
      const base: Job = stored;

      const existing = base.revisions.find((r) => r.finalizationId === finalizationId);
      if (existing) {
        const cleared: Job = { ...base, pendingFinalizationId: null };
        if (base.pendingFinalizationId) await writeJobRecord(cleared);
        return { ok: true, job: cleared, ledger, revision: existing, repeated: true };
      }
      if (stored && stored.revisions.length !== snapshot.revisions.length) {
        return { ok: false, reason: 'conflict', message: 'This job changed somewhere else while the quote was being made. Check it, then create the quote again. Nothing was used.', committed: 'no' };
      }

      const decision = decide(base, ledger.entries.length);
      if ('blocked' in decision) return { ok: false, reason: 'blocked', message: decision.blocked, committed: 'no' };

      const j: Journal = { jobId: snapshot.id, revision: decision.revision, freeUse: decision.freeUse, at: Date.now() };
      const logos = new Map<string, string>();
      await writeWithLogos([[journalKey(finalizationId), JSON.stringify({ ...j, revision: dehydrateRevision(j.revision, logos) })]], logos);
      journalWritten = true;
      // Edits saved after the snapshot was taken are newer than the quote: they stay, marked as changed since it.
      const newer = stored.updatedAt > snapshot.updatedAt && JSON.stringify(stored.draft) !== JSON.stringify(snapshot.draft);
      const done = applyCommit(base, ledger, j, newer ? stored.draft : snapshot.draft);
      if (newer) done.job = { ...done.job, dirtySince: done.job.dirtySince ?? j.at };
      await writeJobRecord(done.job, [[KEYS.ledger, JSON.stringify(done.ledger)]]);
      await db().removeItem(journalKey(finalizationId)).catch(() => undefined);
      return { ok: true, job: done.job, ledger: done.ledger, revision: decision.revision, repeated: false };
    } catch {
      return journalWritten
        ? { ok: false, reason: 'storage', message: 'The quote was made but could not be fully saved. Try again; it will not be counted twice.', committed: 'unknown' }
        : { ok: false, reason: 'storage', message: 'The quote could not be saved, so nothing was used. Free some storage on this iPhone and try again.', committed: 'no' };
    }
  });
}

/** Removes local records and settings. The anonymous free-quote ledger is kept so deletion is not a reset. */
export function deleteEverything() {
  return serial(async () => {
    await recoverJournals().catch(() => undefined);
    const keys = await db().getAllKeys();
    const keep = new Set([KEYS.ledger, KEYS.entitlement, KEYS.pending]);
    await db().multiRemove(keys.filter((k) => k.startsWith(P) && !keep.has(k)));
    knownLogos.clear();
  });
}

// ---------- Entitlement cache (verified state only) ----------

export interface EntitlementCache {
  verifiedAt: number;
  expiresAt: number | null;
  productId: string;
}

export async function readEntitlementCache(): Promise<EntitlementCache | null> {
  const p = parse(await db().getItem(KEYS.entitlement));
  if (!p.ok || !isObj(p.value)) return null;
  const v = p.value;
  if (typeof v.verifiedAt !== 'number') return null;
  return { verifiedAt: v.verifiedAt, expiresAt: numOrNull(v.expiresAt), productId: typeof v.productId === 'string' ? v.productId : '' };
}

export function writeEntitlementCache(c: EntitlementCache | null) {
  return c ? db().setItem(KEYS.entitlement, JSON.stringify(c)) : db().removeItem(KEYS.entitlement);
}

export async function readPendingPurchase(): Promise<number | null> {
  const v = await db().getItem(KEYS.pending);
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function writePendingPurchase(at: number | null) {
  return at ? db().setItem(KEYS.pending, String(at)) : db().removeItem(KEYS.pending);
}

// ---------- Backup ----------

export const BACKUP_APP = 'pressure-washing-calculator';
/** Files above this size are only accepted with a matching check value. */
const MAX_UNVERIFIED_CHARS = 25 * 1024 * 1024;
/** No backup this app writes comes near this size. */
export const MAX_BACKUP_CHARS = 120 * 1024 * 1024;

export function checksum(t: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function backupPayload(settings: Settings, jobs: Job[]) {
  const logos = new Map<string, string>();
  const out = jobs.map((j) => dehydrateJob({ ...j, pendingFinalizationId: null }, logos));
  return logos.size ? { settings, jobs: out, logos: Object.fromEntries(logos) } : { settings, jobs: out };
}

export function buildBackup(settings: Settings, jobs: Job[], appVersion: string, exportedAt = Date.now()): string {
  const payload = backupPayload(settings, jobs);
  return JSON.stringify(
    {
      app: BACKUP_APP,
      kind: 'backup',
      schema: 1,
      exportedAt,
      appVersion,
      note: 'Contains customer details and private costs. Does not contain purchases or free-quote counts.',
      checksum: checksum(JSON.stringify(payload)),
      ...payload,
    },
    null,
    1,
  );
}

const envelope = z.object({
  app: z.literal(BACKUP_APP),
  kind: z.literal('backup'),
  schema: z.number().int().positive(),
  exportedAt: z.number(),
  checksum: z.string().max(16).optional(),
  settings: z.unknown(),
  jobs: z.array(z.unknown()).max(10_000),
  logos: z.record(z.string(), z.string()).optional(),
});

export type BackupCheck =
  | { ok: true; jobs: Job[]; settings: Settings | null; duplicates: number; skipped: number; exportedAt: number }
  | { ok: false; error: string };

export function checkBackup(input: string, existingIds: Set<string>): BackupCheck {
  if (input.length > MAX_BACKUP_CHARS) return { ok: false, error: 'This file is too large to be a backup from this app. Nothing was changed.' };
  let data: unknown;
  try {
    data = JSON.parse(input);
  } catch {
    return { ok: false, error: 'This file is not a complete backup. It may be cut off or damaged. Nothing was changed.' };
  }
  if (isObj(data) && typeof data.schema === 'number' && data.schema > 1 && data.app === BACKUP_APP) {
    return { ok: false, error: 'This backup was made by a newer version of the app. Update the app, then try again. Nothing was changed.' };
  }
  const env = envelope.safeParse(data);
  if (!env.success) return { ok: false, error: 'This file is not a Pressure Washing Calculator+ backup. Nothing was changed.' };
  const e = env.data;
  if (!e.checksum && input.length > MAX_UNVERIFIED_CHARS) {
    return { ok: false, error: 'This file is too large to check without its check value. Nothing was changed.' };
  }
  if (e.checksum) {
    const payload = e.logos ? { settings: e.settings, jobs: e.jobs, logos: e.logos } : { settings: e.settings, jobs: e.jobs };
    if (checksum(JSON.stringify(payload)) !== e.checksum) {
      return { ok: false, error: 'This backup appears to be damaged (its check value does not match). Nothing was changed.' };
    }
  }
  const logos = e.logos ?? {};
  const lookup: LogoLookup = (ref) => (Object.prototype.hasOwnProperty.call(logos, ref) ? logos[ref] : undefined);
  let duplicates = 0;
  let skipped = 0;
  const seen = new Set<string>();
  const jobs: Job[] = [];
  for (const raw of e.jobs) {
    const { job } = readJobRecord(raw, { strict: true, logo: lookup });
    if (!job) {
      skipped++;
      continue;
    }
    if (existingIds.has(job.id) || seen.has(job.id)) {
      duplicates++;
      continue;
    }
    if (!isObj(raw) || !isObj(raw.draft) || (Array.isArray(raw.draft.lines) && raw.draft.lines.length > 200)) {
      skipped++;
      continue;
    }
    seen.add(job.id);
    jobs.push({ ...job, pendingFinalizationId: null });
  }
  const settings = isObj(e.settings) ? normalizeSettings(e.settings) : null;
  return { ok: true, jobs, settings, duplicates, skipped, exportedAt: e.exportedAt };
}

/**
 * Adds imported jobs in batches. Existing records are never overwritten. Purchases and free-quote counts
 * are never imported. Stops at the first failed batch and reports exactly which jobs were saved.
 */
export function importJobs(jobs: Job[]): Promise<{ saved: Job[]; notSaved: number }> {
  return serial(async () => {
    const saved: Job[] = [];
    const preexisting = new Set<string>();
    let alreadyHere = 0;
    for (let i = 0; i < jobs.length; i += 25) {
      const batch = jobs.slice(i, i + 25);
      try {
        const present = await db().multiGet(batch.map((j) => jobKey(j.id)));
        const taken = new Set(present.filter(([, v]) => v != null).map(([k]) => k));
        const fresh = batch.filter((j) => !taken.has(jobKey(j.id)));
        for (const j of batch) if (taken.has(jobKey(j.id))) preexisting.add(j.id);
        alreadyHere += batch.length - fresh.length;
        const logos = new Map<string, string>();
        const pairs = fresh.map((j) => [jobKey(j.id), JSON.stringify(dehydrateJob(j, logos))] as [string, string]);
        if (pairs.length) await writeWithLogos(pairs, logos);
        saved.push(...fresh);
      } catch {
        // A failed batch may still have written some records. Count what is really there, so the
        // operator is told exactly what was saved.
        try {
          const batch = jobs.slice(i, i + 25);
          const there = new Set((await db().multiGet(batch.map((j) => jobKey(j.id)))).filter(([, v]) => v != null).map(([k]) => k));
          const before = new Set(saved.map((j) => j.id));
          saved.push(...batch.filter((j) => there.has(jobKey(j.id)) && !before.has(j.id) && !preexisting.has(j.id)));
        } catch {
          // Unreadable right now: report only what is known to be saved.
        }
        return { saved, notSaved: jobs.length - saved.length - alreadyHere };
      }
    }
    return { saved, notSaved: 0 };
  });
}
