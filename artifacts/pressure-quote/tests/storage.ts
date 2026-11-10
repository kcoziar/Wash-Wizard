/**
 * Storage and quote-creation guarantees, run against an in-memory store that can fail on demand.
 * Run: pnpm --filter @workspace/pressure-quote run test
 */
import { CORE_KINDS, defaultSettings, newJob, sampleDraft, shownKinds } from '../lib/defaults';
import { buildQuoteDoc } from '../lib/document';
import { computeQuote } from '../lib/pricing';
import {
  KEYS,
  buildBackup,
  checkBackup,
  commitFinalization,
  deleteEverything,
  importJobs,
  removeJob,
  jobKey,
  loadAll,
  salvageLedger,
  saveJob,
  setStorageBackend,
  type Decide,
  type KV,
} from '../lib/storage';
import type { Job, Revision } from '../lib/types';

// ---------- Harness ----------

type Op = 'get' | 'set' | 'remove' | 'multiGet' | 'multiSet' | 'multiRemove' | 'keys';

class MemoryKV implements KV {
  data = new Map<string, string>();
  /** Return true to make the next matching call throw, as a full disk or a killed app would. */
  failWhen: ((op: Op, keys: readonly string[]) => boolean) | null = null;
  private check(op: Op, keys: readonly string[]) {
    if (this.failWhen?.(op, keys)) throw new Error(`injected ${op} failure`);
  }
  async getItem(k: string) {
    this.check('get', [k]);
    return this.data.get(k) ?? null;
  }
  async setItem(k: string, v: string) {
    this.check('set', [k]);
    this.data.set(k, v);
  }
  async removeItem(k: string) {
    this.check('remove', [k]);
    this.data.delete(k);
  }
  async multiGet(keys: readonly string[]) {
    this.check('multiGet', keys);
    return keys.map((k) => [k, this.data.get(k) ?? null] as const);
  }
  async multiSet(pairs: ReadonlyArray<readonly [string, string]>) {
    this.check('multiSet', pairs.map((p) => p[0]));
    for (const [k, v] of pairs) this.data.set(k, v);
  }
  async multiRemove(keys: readonly string[]) {
    this.check('multiRemove', keys);
    for (const k of keys) this.data.delete(k);
  }
  async getAllKeys() {
    this.check('keys', []);
    return Array.from(this.data.keys());
  }
  keysWith(prefix: string) {
    return Array.from(this.data.keys()).filter((k) => k.startsWith(prefix));
  }
}

function fresh(): MemoryKV {
  const kv = new MemoryKV();
  setStorageBackend(kv);
  return kv;
}

const show = (v: unknown) => JSON.stringify(v);
const assert = {
  equal(actual: unknown, expected: unknown, message?: string) {
    if (!Object.is(actual, expected)) throw new Error(message ?? `Expected ${show(expected)}, got ${show(actual)}`);
  },
  ok(value: unknown, message?: string) {
    if (!value) throw new Error(message ?? `Expected a truthy value, got ${show(value)}`);
  },
};

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
  } catch (e) {
    failures.push(`${name}\n    ${(e as Error).message.split('\n').join('\n    ')}`);
  }
}

// ---------- Fixtures ----------

const settings = defaultSettings();
// A tiny but valid JPEG data URI body (base64 alphabet only).
const LOGO = `data:image/jpeg;base64,${'/9j/4AAQSkZJRgABAQAAAQABAAD'.padEnd(1200, 'A')}`;

let counter = 1;
function makeJob(opts: { sample?: boolean } = {}): Job {
  return newJob(sampleDraft(settings), counter++, { sample: opts.sample });
}

function makeRevision(job: Job, finalizationId: string, mode: Revision['mode'], logo: string | null = null): Revision {
  const calc = computeQuote(job.draft);
  const number = job.revisions.length + 1;
  const doc = buildQuoteDoc({
    draft: job.draft,
    calc,
    business: { name: 'Clean Co', phone: '555-111-2222', email: '', logo },
    reference: `Q-${String(job.number).padStart(4, '0')}${number > 1 ? `-R${number}` : ''}`,
    issuedAt: 1_700_000_000_000,
    sample: job.sample,
  });
  return {
    id: `r_${finalizationId}`,
    finalizationId,
    number,
    createdAt: 1_700_000_000_000 + number,
    policy: 'USD_V1',
    template: 't1',
    reference: doc.reference,
    doc,
    inputs: JSON.parse(JSON.stringify(job.draft)),
    economics: { revenue: calc.total, minutes: null, costs: null, revenuePerHour: null, availablePerHour: null },
    freeUse: mode === 'free',
    mode,
  };
}

/** The access rule used by the app, reduced to what storage needs: free while under three. */
function freeDecide(finalizationId: string, logo: string | null = null): Decide {
  return (stored, freeUsed) => {
    if (stored.revisions.length) return { revision: makeRevision(stored, finalizationId, 'revision', logo), freeUse: false };
    if (freeUsed >= 3) return { blocked: 'NEEDS_ACCESS' };
    return { revision: makeRevision(stored, finalizationId, 'free', logo), freeUse: true };
  };
}

async function ledgerCount(kv: MemoryKV): Promise<number> {
  const raw = kv.data.get(KEYS.ledger);
  return raw ? (JSON.parse(raw) as { entries: unknown[] }).entries.length : 0;
}

// ---------- Tests ----------

async function run() {
  await test('Creating a quote saves the revision and counts one free quote', async () => {
    const kv = fresh();
    const job = makeJob();
    await saveJob(job);
    const res = await commitFinalization(job, 'f1', freeDecide('f1'));
    assert.ok(res.ok, 'commit failed');
    if (!res.ok) return;
    assert.equal(res.job.revisions.length, 1);
    assert.equal(res.job.status, 'quoted');
    assert.equal(await ledgerCount(kv), 1);
    assert.equal(kv.keysWith(`${KEYS.journal}:`).length, 0, 'journal left behind');
  });

  await test('Replaying the same creation returns the saved quote and never counts twice', async () => {
    const kv = fresh();
    const job = makeJob();
    await saveJob(job);
    const a = await commitFinalization(job, 'f1', freeDecide('f1'));
    const b = await commitFinalization(job, 'f1', freeDecide('f1'));
    assert.ok(a.ok && b.ok);
    if (!a.ok || !b.ok) return;
    assert.equal(b.repeated, true);
    assert.equal(b.revision.id, a.revision.id);
    assert.equal(b.job.revisions.length, 1);
    assert.equal(await ledgerCount(kv), 1);
  });

  await test('A double tap with two creation ids makes one quote and one free use', async () => {
    const kv = fresh();
    const job = makeJob();
    await saveJob(job);
    const [a, b] = await Promise.all([commitFinalization(job, 'fA', freeDecide('fA')), commitFinalization(job, 'fB', freeDecide('fB'))]);
    assert.ok(a.ok, 'first should succeed');
    assert.ok(!b.ok && b.reason === 'conflict', `second should be a conflict, got ${show(b)}`);
    if (!b.ok) assert.equal(b.committed, 'no');
    assert.equal(await ledgerCount(kv), 1);
    const loaded = await loadAll();
    assert.equal(loaded.jobs[0].revisions.length, 1);
  });

  await test('A stale screen cannot create over a newer saved quote', async () => {
    const kv = fresh();
    const job = makeJob();
    await saveJob(job);
    const first = await commitFinalization(job, 'f1', freeDecide('f1'));
    assert.ok(first.ok);
    // The stale copy still has no revisions.
    const res = await commitFinalization(job, 'f2', freeDecide('f2'));
    assert.ok(!res.ok && res.reason === 'conflict', `expected conflict, got ${show(res)}`);
    assert.equal(await ledgerCount(kv), 1);
  });

  await test('Saving a stale copy of a job never drops a saved quote', async () => {
    fresh();
    const job = makeJob();
    await saveJob(job);
    const res = await commitFinalization(job, 'f1', freeDecide('f1'));
    assert.ok(res.ok);
    const stale = { ...job, privateNotes: 'Edited on an old screen' };
    const out = await saveJob(stale);
    assert.equal(out.merged, true);
    assert.equal(out.job.revisions.length, 1);
    const loaded = await loadAll();
    assert.equal(loaded.jobs[0].revisions.length, 1);
    assert.equal(loaded.jobs[0].privateNotes, 'Edited on an old screen');
  });

  await test('The fourth new quote is refused without Pro, and nothing is counted', async () => {
    const kv = fresh();
    for (let i = 0; i < 3; i++) {
      const j = makeJob();
      await saveJob(j);
      const r = await commitFinalization(j, `f${i}`, freeDecide(`f${i}`));
      assert.ok(r.ok);
    }
    const j4 = makeJob();
    await saveJob(j4);
    const r4 = await commitFinalization(j4, 'f4', freeDecide('f4'));
    assert.ok(!r4.ok && r4.reason === 'blocked');
    assert.equal(await ledgerCount(kv), 3);
  });

  await test('A crash after the journal is written is finished on next launch, counted once', async () => {
    const kv = fresh();
    const job = makeJob();
    await saveJob(job);
    // Fail the write that saves the job with its new revision and the ledger together.
    kv.failWhen = (op, keys) => op === 'multiSet' && keys.includes(jobKey(job.id)) && keys.includes(KEYS.ledger);
    const res = await commitFinalization(job, 'f1', freeDecide('f1'));
    assert.ok(!res.ok && res.committed === 'unknown', `expected an unknown commit, got ${show(res)}`);
    assert.equal(kv.keysWith(`${KEYS.journal}:`).length, 1, 'the journal must survive the failure');
    kv.failWhen = null;
    const loaded = await loadAll();
    assert.equal(loaded.jobs[0].revisions.length, 1, 'the quote is recovered');
    assert.equal(loaded.ledger.entries.length, 1, 'counted once');
    assert.equal(kv.keysWith(`${KEYS.journal}:`).length, 0, 'journal cleared');
    // Trying again with the same id after recovery replays, never double counts.
    const again = await commitFinalization(job, 'f1', freeDecide('f1'));
    assert.ok(again.ok && again.repeated);
    assert.equal(await ledgerCount(kv), 1);
  });

  await test('A failure before the journal is written uses nothing', async () => {
    const kv = fresh();
    const job = makeJob();
    await saveJob(job);
    kv.failWhen = (op, keys) => op === 'multiSet' && keys.some((k) => k.startsWith(`${KEYS.journal}:`));
    const res = await commitFinalization(job, 'f1', freeDecide('f1'));
    assert.ok(!res.ok && res.committed === 'no');
    kv.failWhen = null;
    const loaded = await loadAll();
    assert.equal(loaded.jobs[0].revisions.length, 0);
    assert.equal(loaded.ledger.entries.length, 0);
  });

  await test('A damaged free-quote record is rebuilt and never goes down', async () => {
    const kv = fresh();
    const jobs: Job[] = [];
    for (let i = 0; i < 2; i++) {
      const j = makeJob();
      await saveJob(j);
      const r = await commitFinalization(j, `f${i}`, freeDecide(`f${i}`));
      assert.ok(r.ok);
      if (r.ok) jobs.push(r.job);
    }
    // A third free quote whose job was later deleted is only visible in the damaged record.
    kv.data.set(KEYS.ledger, '{"v":1,"entries":[{"finalizationId":"f0","jobId":"x"},{"finalizationId":"f1"},{"finalizationId":"gone-job-quote","jobId":"y","at":5}');
    const loaded = await loadAll();
    assert.equal(loaded.ledger.entries.length, 3, `expected 3, got ${loaded.ledger.entries.length}`);
    assert.ok(kv.keysWith('pwc:v1:unreadable:').length >= 1, 'the damaged record is kept aside');
    assert.equal(salvageLedger('not json at all').entries.length, 0);
  });

  await test('Delete all keeps the anonymous free-quote count', async () => {
    const kv = fresh();
    const j = makeJob();
    await saveJob(j);
    await commitFinalization(j, 'f1', freeDecide('f1'));
    await deleteEverything();
    const loaded = await loadAll();
    assert.equal(loaded.jobs.length, 0);
    assert.equal(loaded.ledger.entries.length, 1);
    assert.ok(!kv.keysWith('pwc:v1:job:').length);
  });

  await test('2,000 quotes that share a logo store it once and load it back on every quote', async () => {
    const kv = fresh();
    const many: Job[] = [];
    for (let i = 0; i < 2000; i++) {
      const j = makeJob();
      const rev = makeRevision(j, `fl${i}`, 'pro', LOGO);
      many.push({ ...j, revisions: [rev], status: 'quoted' });
    }
    const res = await importJobs(many);
    assert.equal(res.saved.length, 2000);
    assert.equal(kv.keysWith('pwc:v1:logo:').length, 1, 'one stored copy of the logo');
    const body = LOGO.slice(23, 400);
    assert.ok(kv.keysWith('pwc:v1:job:').every((k) => !(kv.data.get(k) ?? '').includes(body)), 'jobs must not each carry the logo');
    const loaded = await loadAll();
    assert.equal(loaded.jobs.length, 2000);
    assert.ok(loaded.jobs.every((j) => j.revisions[0].doc.business.logo === LOGO), 'every quote shows its logo');
    // And through a backup file.
    const file = buildBackup(settings, loaded.jobs, '1.0.0', 1_700_000_000_000);
    assert.equal(file.split(body).length - 1, 1, 'the backup stores the logo once');
    const check = checkBackup(file, new Set());
    assert.ok(check.ok, check.ok ? '' : check.error);
    if (check.ok) {
      assert.equal(check.jobs.length, 2000);
      assert.ok(check.jobs.every((j) => j.revisions[0].doc.business.logo === LOGO));
    }
  });

  await test('A backup with an unsafe logo is refused for that job, and nothing unsafe is saved', async () => {
    fresh();
    const good = makeJob();
    const bad = makeJob();
    const goodRev = makeRevision(good, 'g1', 'pro', LOGO);
    const badRev = makeRevision(bad, 'b1', 'pro', null);
    const file = buildBackup(settings, [{ ...good, revisions: [goodRev], status: 'quoted' }, { ...bad, revisions: [badRev], status: 'quoted' }], '1.0.0', 1_700_000_000_000);
    const parsed = JSON.parse(file);
    const evil = 'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+';
    parsed.jobs[1].revisions[0].doc.business.logo = evil;
    delete parsed.checksum;
    const check = checkBackup(JSON.stringify(parsed), new Set());
    assert.ok(check.ok, check.ok ? '' : check.error);
    if (!check.ok) return;
    assert.equal(check.jobs.length, 1, 'the job with the unsafe logo is skipped');
    assert.equal(check.skipped, 1);
    assert.ok(!JSON.stringify(check.jobs).includes('svg'), 'nothing unsafe survives');
    const quoteBreak = JSON.parse(file);
    quoteBreak.jobs[1].revisions[0].doc.business.logo = 'data:image/png;base64,AAAA"><script>alert(1)</script>';
    delete quoteBreak.checksum;
    const check2 = checkBackup(JSON.stringify(quoteBreak), new Set());
    assert.ok(check2.ok && check2.jobs.length === 1 && check2.skipped === 1, 'markup in a logo is refused');
  });

  await test('Importing never overwrites a job that is already here', async () => {
    fresh();
    const j = makeJob();
    await saveJob({ ...j, privateNotes: 'Mine' });
    const res = await importJobs([{ ...j, privateNotes: 'From backup' }]);
    assert.equal(res.saved.length, 0);
    const loaded = await loadAll();
    assert.equal(loaded.jobs[0].privateNotes, 'Mine');
  });

  await test('Storage that cannot be read stops the load instead of starting empty', async () => {
    const kv = fresh();
    const j = makeJob();
    await saveJob(j);
    kv.failWhen = (op) => op === 'keys';
    let threw = false;
    try {
      await loadAll();
    } catch {
      threw = true;
    }
    assert.ok(threw, 'loadAll must throw so nothing is written over unseen data');
    kv.failWhen = null;
    assert.ok(kv.data.has(jobKey(j.id)));
  });

  await test('A sample quote never counts as a free quote', async () => {
    const kv = fresh();
    const s = makeJob({ sample: true });
    await saveJob(s);
    const res = await commitFinalization(s, 's1', (stored) => ({ revision: makeRevision(stored, 's1', 'sample'), freeUse: false }));
    assert.ok(res.ok);
    assert.equal(await ledgerCount(kv), 0);
  });

  await test('Data saved before the new services were added opens unchanged', async () => {
    const kv = fresh();
    // Settings exactly as the previous version wrote them: four rates, no services list.
    const prev = JSON.parse(JSON.stringify(settings)) as Record<string, unknown> & { rates: Record<string, Record<string, string>> };
    delete prev.services;
    for (const k of Object.keys(prev.rates)) if (!(CORE_KINDS as string[]).includes(k)) delete prev.rates[k];
    prev.rates.driveway.rate = '0.18';
    prev.rates.stairs.rate = '8';
    kv.data.set(KEYS.settings, JSON.stringify(prev));
    const job = makeJob();
    await saveJob(job);
    const res = await commitFinalization(job, 'old1', freeDecide('old1'));
    assert.ok(res.ok, 'commit failed');
    if (!res.ok) return;
    const savedJob = kv.data.get(jobKey(job.id));

    const snap = await loadAll();
    assert.equal(snap.issues.length, 0, `issues: ${snap.issues.join('; ')}`);
    assert.equal(snap.settings.rates.driveway.rate, '0.18');
    assert.equal(snap.settings.rates.stairs.rate, '8');
    // New services arrive blank, never with an invented rate, and Home keeps the four it had.
    for (const k of ['house', 'roof', 'deck', 'fence', 'gutters'] as const) assert.equal(snap.settings.rates[k].rate, '', `${k} rate`);
    assert.equal(snap.settings.rates.fence.qtyType, 'linear');
    assert.equal(JSON.stringify(shownKinds(snap.settings).first), JSON.stringify(CORE_KINDS));
    const loaded = snap.jobs.find((j) => j.id === job.id);
    assert.ok(loaded, 'job missing');
    assert.equal(JSON.stringify(loaded), savedJob, 'job changed on load');
    assert.equal(loaded?.revisions[0].doc.total, res.job.revisions[0].doc.total);
    assert.equal(await ledgerCount(kv), 1);
  });

  await test('A quote finished after the job was deleted does not bring it back or use a free quote', async () => {
    const kv = fresh();
    const j = makeJob();
    await saveJob(j);
    await removeJob(j.id);
    const res = await commitFinalization(j, 'late1', freeDecide('late1'));
    assert.ok(!res.ok, 'the commit must be refused');
    assert.equal(kv.data.has(jobKey(j.id)), false, 'the job stays deleted');
    assert.equal(await ledgerCount(kv), 0);
    // The same after Delete all.
    const k = makeJob();
    await saveJob(k);
    await deleteEverything();
    const res2 = await commitFinalization(k, 'late2', freeDecide('late2'));
    assert.ok(!res2.ok);
    assert.equal((await loadAll()).jobs.length, 0);
    assert.equal(await ledgerCount(kv), 0);
  });

  await test('Finishing an older snapshot keeps the newer saved draft, marked as changed', async () => {
    const kv = fresh();
    const j = makeJob();
    await saveJob(j);
    const snapshot: Job = JSON.parse(JSON.stringify(j));
    const edited: Job = { ...j, updatedAt: j.updatedAt + 5000, draft: { ...j.draft, customer: { ...j.draft.customer, name: 'Edited Later' } } };
    await saveJob(edited);
    // As in the app, the revision is built from the snapshot being quoted.
    const res = await commitFinalization(snapshot, 'f1', () => ({ revision: makeRevision(snapshot, 'f1', 'free'), freeUse: true }));
    assert.ok(res.ok, 'commit failed');
    if (!res.ok) return;
    assert.equal(res.job.draft.customer.name, 'Edited Later');
    assert.ok(res.job.dirtySince !== null, 'the newer draft is marked as changed since the quote');
    assert.equal(res.job.revisions[0].inputs.customer.name, snapshot.draft.customer.name, 'the quote is what was snapshotted');
    const stored = JSON.parse(kv.data.get(jobKey(j.id)) ?? '{}') as Job;
    assert.equal(stored.draft.customer.name, 'Edited Later');
  });

  await test('An import that fails partway reports exactly what was saved', async () => {
    const kv = fresh();
    const jobs = Array.from({ length: 30 }, () => makeJob());
    // The second batch writes its first 3 records, then the disk fills.
    let calls = 0;
    kv.failWhen = (op, keys) => {
      if (op !== 'multiSet') return false;
      calls++;
      if (calls === 2) {
        for (const key of keys.filter((x) => x.startsWith('pwc:v1:job:')).slice(0, 3)) kv.data.set(key, JSON.stringify(jobs.find((j) => jobKey(j.id) === key)));
        return true;
      }
      return false;
    };
    const res = await importJobs(jobs);
    kv.failWhen = null;
    const onDisk = kv.keysWith('pwc:v1:job:').length;
    assert.equal(res.saved.length, onDisk, `reported ${res.saved.length} saved, ${onDisk} on disk`);
    assert.equal(res.notSaved, 30 - onDisk);
  });

  if (failures.length) {
    console.error(`\n${failures.length} failed, ${passed} passed\n`);
    for (const f of failures) console.error(`  \u2717 ${f}\n`);
    throw new Error('Storage tests failed');
  }
  console.log(`All ${passed} storage tests passed.`);
}

run().catch((e) => {
  console.error(e);
  throw e;
});
