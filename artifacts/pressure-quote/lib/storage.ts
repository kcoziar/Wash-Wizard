import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';
import { defaultSettings, newDraft } from './defaults';
import type { Job, Ledger, Meta, Revision, Settings } from './types';

/**
 * Local persistence. Every record lives under its own key so a single write is
 * atomic per record. Writes are serialized, and the quote finalization uses a
 * redo journal so a crash between "snapshot saved" and "free quote counted"
 * is completed on next launch, never lost and never counted twice.
 */
const P = 'pwc:v1:';
export const KEYS = {
  settings: `${P}settings`,
  meta: `${P}meta`,
  ledger: `${P}ledger`,
  journal: `${P}journal`,
  entitlement: `${P}entitlement`,
  pending: `${P}pending-purchase`,
};
const JOB_PREFIX = `${P}job:`;
export const jobKey = (id: string) => `${JOB_PREFIX}${id}`;

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
  if (defaults === null) return (raw === null || typeof raw === 'string' ? raw : null) as T;
  return (typeof raw === typeof defaults ? raw : defaults) as T;
}

export function normalizeSettings(raw: unknown): Settings {
  return mergeDefaults(defaultSettings(), raw);
}

export function defaultMeta(): Meta {
  return { schema: 1, installedAt: Date.now(), nextNumber: 1, firstOfferShown: false, reviewRequestedAt: null, meaningfulActions: 0, lastBackupAt: null };
}

const lineTemplate = (): Record<string, unknown> => ({
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

/** Returns null when the record cannot be trusted as a job. */
export function normalizeJob(raw: unknown): Job | null {
  if (!isObj(raw)) return null;
  if (typeof raw.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(raw.id)) return null;
  if (typeof raw.number !== 'number' || !Number.isInteger(raw.number) || raw.number < (raw.sample === true ? 0 : 1)) return null;
  if (raw.schema !== undefined && raw.schema !== 1) return null;
  const baseDraft = newDraft(defaultSettings(), []);
  const rawDraft = isObj(raw.draft) ? raw.draft : {};
  const draft = mergeDefaults(baseDraft, rawDraft);
  draft.lines = (Array.isArray(rawDraft.lines) ? rawDraft.lines : [])
    .map((l) => mergeDefaults(lineTemplate(), l))
    .filter((l) => typeof l.id === 'string' && l.id.length > 0) as unknown as Job['draft']['lines'];
  draft.questions = (Array.isArray(rawDraft.questions) ? rawDraft.questions : []).filter(isObj) as unknown as Job['draft']['questions'];
  const revisions = (Array.isArray(raw.revisions) ? raw.revisions : []).filter(
    (r): r is Revision => isObj(r) && typeof r.id === 'string' && typeof r.finalizationId === 'string' && isObj(r.doc) && typeof r.reference === 'string',
  );
  const now = Date.now();
  return {
    schema: 1,
    id: raw.id,
    number: raw.number,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now,
    sample: raw.sample === true,
    status: (['draft', 'quoted', 'sent', 'accepted', 'declined', 'completed'] as const).includes(raw.status as Job['status']) ? (raw.status as Job['status']) : 'draft',
    label: typeof raw.label === 'string' ? raw.label.slice(0, 200) : 'Quote',
    draft,
    request: isObj(raw.request) && typeof raw.request.text === 'string' ? { text: raw.request.text.slice(0, 10000), at: typeof raw.request.at === 'number' ? raw.request.at : now } : null,
    privateNotes: typeof raw.privateNotes === 'string' ? raw.privateNotes.slice(0, 20000) : '',
    revisions,
    dirtySince: typeof raw.dirtySince === 'number' ? raw.dirtySince : null,
    pendingFinalizationId: typeof raw.pendingFinalizationId === 'string' ? raw.pendingFinalizationId : null,
    shares: Array.isArray(raw.shares) ? (raw.shares.filter(isObj) as unknown as Job['shares']) : [],
    outcome: isObj(raw.outcome) ? (raw.outcome as unknown as Job['outcome']) : null,
    useForSuggestions: raw.useForSuggestions !== false && raw.sample !== true,
  };
}

async function quarantine(key: string, value: string) {
  try {
    await AsyncStorage.setItem(`${P}unreadable:${Date.now()}:${key.slice(P.length)}`, value);
  } catch {
    // Keep going; the original value is left untouched either way.
  }
}

function parse(raw: string | null): { ok: true; value: unknown } | { ok: false } {
  if (raw == null) return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

export interface Snapshot {
  settings: Settings;
  meta: Meta;
  ledger: Ledger;
  jobs: Job[];
  issues: string[];
  firstRun: boolean;
}

interface Journal {
  jobId: string;
  revision: Revision;
  freeUse: boolean;
  at: number;
}

function applyCommit(job: Job, ledger: Ledger, j: Journal): { job: Job; ledger: Ledger } {
  const already = job.revisions.some((r) => r.finalizationId === j.revision.finalizationId);
  const nextJob: Job = already
    ? { ...job, pendingFinalizationId: null }
    : {
        ...job,
        revisions: [...job.revisions, j.revision],
        status: job.status === 'draft' ? 'quoted' : job.status,
        dirtySince: null,
        pendingFinalizationId: null,
        updatedAt: j.at,
      };
  const counted = ledger.entries.some((e) => e.finalizationId === j.revision.finalizationId);
  const nextLedger: Ledger = j.freeUse && !counted ? { v: 1, entries: [...ledger.entries, { finalizationId: j.revision.finalizationId, jobId: j.jobId, at: j.at }] } : ledger;
  return { job: nextJob, ledger: nextLedger };
}

function normalizeLedger(raw: unknown): Ledger {
  if (!isObj(raw) || !Array.isArray(raw.entries)) return { v: 1, entries: [] };
  const seen = new Set<string>();
  const entries = raw.entries.filter((e): e is Ledger['entries'][number] => {
    if (!isObj(e) || typeof e.finalizationId !== 'string' || seen.has(e.finalizationId)) return false;
    seen.add(e.finalizationId);
    return true;
  });
  return { v: 1, entries };
}

export function loadAll(): Promise<Snapshot> {
  return serial(async () => {
    const issues: string[] = [];
    const keys = await AsyncStorage.getAllKeys();
    const jobKeys = keys.filter((k) => k.startsWith(JOB_PREFIX));
    const pairs = await AsyncStorage.multiGet([KEYS.settings, KEYS.meta, KEYS.ledger, KEYS.journal, ...jobKeys]);
    const map = new Map(pairs);

    const s = parse(map.get(KEYS.settings) ?? null);
    if (!s.ok) {
      issues.push('Your saved settings could not be read. Defaults are shown; the original was kept aside.');
      await quarantine(KEYS.settings, map.get(KEYS.settings) as string);
    }
    const firstRun = map.get(KEYS.meta) == null && jobKeys.length === 0;
    const settings = normalizeSettings(s.ok ? s.value : undefined);
    const m = parse(map.get(KEYS.meta) ?? null);
    const meta = mergeDefaults(defaultMeta(), m.ok ? m.value : undefined);
    const l = parse(map.get(KEYS.ledger) ?? null);
    let ledger = normalizeLedger(l.ok ? l.value : undefined);

    const jobs: Job[] = [];
    for (const k of jobKeys) {
      const raw = map.get(k) ?? null;
      const p = parse(raw);
      const job = p.ok ? normalizeJob(p.value) : null;
      if (!job) {
        issues.push('One saved job could not be read. It was kept aside and not deleted.');
        if (raw) await quarantine(k, raw);
        continue;
      }
      jobs.push(job);
    }

    // Finish an interrupted quote creation.
    const jr = parse(map.get(KEYS.journal) ?? null);
    if (jr.ok && isObj(jr.value)) {
      const j = jr.value as unknown as Journal;
      const idx = jobs.findIndex((x) => x.id === j.jobId);
      if (idx >= 0 && j.revision) {
        const done = applyCommit(jobs[idx], ledger, j);
        jobs[idx] = done.job;
        ledger = done.ledger;
        await AsyncStorage.multiSet([
          [jobKey(done.job.id), JSON.stringify(done.job)],
          [KEYS.ledger, JSON.stringify(ledger)],
        ]);
      }
      await AsyncStorage.removeItem(KEYS.journal);
    }

    const maxNumber = jobs.reduce((mx, j) => Math.max(mx, j.number), 0);
    if (meta.nextNumber <= maxNumber) meta.nextNumber = maxNumber + 1;
    if (map.get(KEYS.meta) == null) await AsyncStorage.setItem(KEYS.meta, JSON.stringify(meta));

    jobs.sort((a, b) => b.updatedAt - a.updatedAt);
    return { settings, meta, ledger, jobs, issues: Array.from(new Set(issues)), firstRun };
  });
}

export function saveSettings(settings: Settings) {
  return serial(() => AsyncStorage.setItem(KEYS.settings, JSON.stringify(settings)));
}

export function saveMeta(meta: Meta) {
  return serial(() => AsyncStorage.setItem(KEYS.meta, JSON.stringify(meta)));
}

export function saveJob(job: Job) {
  return serial(() => AsyncStorage.setItem(jobKey(job.id), JSON.stringify(job)));
}

export function removeJob(id: string) {
  return serial(() => AsyncStorage.removeItem(jobKey(id)));
}

export function readJob(id: string): Promise<Job | null> {
  return serial(async () => {
    const p = parse(await AsyncStorage.getItem(jobKey(id)));
    return p.ok ? normalizeJob(p.value) : null;
  });
}

/**
 * The single place a quote is created. Inside one serialized operation it
 * re-reads the job and the free-use ledger, asks the caller's access policy,
 * and commits the immutable revision plus at most one free-use entry.
 */
export function commitFinalization(
  job: Job,
  decide: (stored: Job, freeUsed: number) => { revision: Revision; freeUse: boolean } | { blocked: string },
): Promise<{ ok: true; job: Job; ledger: Ledger; revision: Revision; repeated: boolean } | { ok: false; reason: string }> {
  return serial(async () => {
    await AsyncStorage.setItem(jobKey(job.id), JSON.stringify(job));
    const stored = normalizeJob(JSON.parse((await AsyncStorage.getItem(jobKey(job.id))) ?? 'null'));
    if (!stored) return { ok: false as const, reason: 'The job could not be saved. Your inputs are still on screen.' };
    const ledgerRaw = parse(await AsyncStorage.getItem(KEYS.ledger));
    const ledger = normalizeLedger(ledgerRaw.ok ? ledgerRaw.value : undefined);

    const existing = stored.pendingFinalizationId ? stored.revisions.find((r) => r.finalizationId === stored.pendingFinalizationId) : undefined;
    if (existing) {
      const cleared = { ...stored, pendingFinalizationId: null };
      await AsyncStorage.setItem(jobKey(job.id), JSON.stringify(cleared));
      return { ok: true as const, job: cleared, ledger, revision: existing, repeated: true };
    }

    const decision = decide(stored, ledger.entries.length);
    if ('blocked' in decision) return { ok: false as const, reason: decision.blocked };

    const journal: Journal = { jobId: job.id, revision: decision.revision, freeUse: decision.freeUse, at: Date.now() };
    await AsyncStorage.setItem(KEYS.journal, JSON.stringify(journal));
    const done = applyCommit(stored, ledger, journal);
    await AsyncStorage.multiSet([
      [jobKey(done.job.id), JSON.stringify(done.job)],
      [KEYS.ledger, JSON.stringify(done.ledger)],
    ]);
    await AsyncStorage.removeItem(KEYS.journal);
    return { ok: true as const, job: done.job, ledger: done.ledger, revision: decision.revision, repeated: false };
  });
}

/** Removes local records and settings. The anonymous free-quote ledger is kept so deletion is not a reset. */
export function deleteEverything() {
  return serial(async () => {
    const keys = await AsyncStorage.getAllKeys();
    const keep = new Set([KEYS.ledger, KEYS.entitlement, KEYS.pending]);
    await AsyncStorage.multiRemove(keys.filter((k) => k.startsWith(P) && !keep.has(k)));
  });
}

// ---------- Entitlement cache (verified state only) ----------

export interface EntitlementCache {
  verifiedAt: number;
  expiresAt: number | null;
  productId: string;
}

export async function readEntitlementCache(): Promise<EntitlementCache | null> {
  const p = parse(await AsyncStorage.getItem(KEYS.entitlement));
  if (!p.ok || !isObj(p.value)) return null;
  const v = p.value;
  if (typeof v.verifiedAt !== 'number') return null;
  return { verifiedAt: v.verifiedAt, expiresAt: typeof v.expiresAt === 'number' ? v.expiresAt : null, productId: typeof v.productId === 'string' ? v.productId : '' };
}

export function writeEntitlementCache(c: EntitlementCache | null) {
  return c ? AsyncStorage.setItem(KEYS.entitlement, JSON.stringify(c)) : AsyncStorage.removeItem(KEYS.entitlement);
}

export async function readPendingPurchase(): Promise<number | null> {
  const v = await AsyncStorage.getItem(KEYS.pending);
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function writePendingPurchase(at: number | null) {
  return at ? AsyncStorage.setItem(KEYS.pending, String(at)) : AsyncStorage.removeItem(KEYS.pending);
}

// ---------- Backup ----------

export const BACKUP_APP = 'pressure-washing-calculator';
const MAX_BACKUP_BYTES = 25 * 1024 * 1024;

export function checksum(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function buildBackup(settings: Settings, jobs: Job[], appVersion: string): string {
  const payload = JSON.stringify({ settings, jobs });
  return JSON.stringify(
    {
      app: BACKUP_APP,
      kind: 'backup',
      schema: 1,
      exportedAt: Date.now(),
      appVersion,
      note: 'Contains customer details and private costs. Does not contain purchases or free-quote counts.',
      checksum: checksum(payload),
      settings,
      jobs,
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
  jobs: z.array(z.unknown()).max(10000),
});

export type BackupCheck =
  | { ok: true; jobs: Job[]; settings: Settings | null; duplicates: number; skipped: number; exportedAt: number }
  | { ok: false; error: string };

export function checkBackup(text: string, existingIds: Set<string>): BackupCheck {
  if (text.length > MAX_BACKUP_BYTES) return { ok: false, error: 'This file is too large to be a backup from this app.' };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This file is not a complete backup. It may be cut off or damaged. Nothing was changed.' };
  }
  if (isObj(data) && typeof data.schema === 'number' && data.schema > 1 && data.app === BACKUP_APP) {
    return { ok: false, error: 'This backup was made by a newer version of the app. Update the app, then try again. Nothing was changed.' };
  }
  const env = envelope.safeParse(data);
  if (!env.success) return { ok: false, error: 'This file is not a Pressure Washing Calculator+ backup. Nothing was changed.' };
  const e = env.data;
  if (e.checksum && checksum(JSON.stringify({ settings: e.settings, jobs: e.jobs })) !== e.checksum) {
    return { ok: false, error: 'This backup appears to be damaged (its check value does not match). Nothing was changed.' };
  }
  let duplicates = 0;
  let skipped = 0;
  const seen = new Set<string>();
  const jobs: Job[] = [];
  for (const raw of e.jobs) {
    const job = normalizeJob(raw);
    if (!job) {
      skipped++;
      continue;
    }
    if (existingIds.has(job.id) || seen.has(job.id)) {
      duplicates++;
      continue;
    }
    if (job.draft.lines.length > 200 || job.revisions.length > 500) {
      skipped++;
      continue;
    }
    seen.add(job.id);
    jobs.push({ ...job, pendingFinalizationId: null });
  }
  const settings = isObj(e.settings) ? normalizeSettings(e.settings) : null;
  if (settings?.business.logo && (settings.business.logo.length > 2_000_000 || !/^data:image\/(png|jpeg|jpg);base64,/.test(settings.business.logo))) {
    settings.business.logo = null;
  }
  return { ok: true, jobs, settings, duplicates, skipped, exportedAt: e.exportedAt };
}

/** Adds imported jobs. Existing records are never overwritten. Purchases and free-quote counts are never imported. */
export function importJobs(jobs: Job[]) {
  return serial(async () => {
    const pairs = jobs.map((j) => [jobKey(j.id), JSON.stringify(j)] as [string, string]);
    for (let i = 0; i < pairs.length; i += 50) await AsyncStorage.multiSet(pairs.slice(i, i + 50));
  });
}
