import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { defaultSettings, jobLabel, newJob } from './defaults';
import { duplicateDraft } from './resolve';
import {
  commitFinalization,
  defaultMeta,
  deleteEverything,
  importJobs,
  loadAll,
  removeJob,
  saveJob,
  saveMeta,
  saveSettings,
} from './storage';
import type { Draft, Job, Ledger, Meta, Revision, Settings } from './types';

type Decide = (stored: Job, freeUsed: number) => { revision: Revision; freeUse: boolean } | { blocked: string };

interface StoreValue {
  ready: boolean;
  firstRun: boolean;
  issues: string[];
  dismissIssues: () => void;
  settings: Settings;
  meta: Meta;
  jobs: Job[];
  freeUsed: number;
  getJob: (id: string) => Job | undefined;
  updateSettings: (fn: (s: Settings) => Settings) => void;
  updateMeta: (fn: (m: Meta) => Meta) => void;
  createJob: (draft: Draft, opts?: { sample?: boolean; request?: string }) => Job;
  updateDraft: (jobId: string, fn: (d: Draft) => Draft) => void;
  updateJob: (jobId: string, fn: (j: Job) => Job) => void;
  deleteJob: (jobId: string) => Promise<void>;
  duplicateJob: (jobId: string) => Job | null;
  flush: () => Promise<void>;
  commit: (jobId: string, finalizationId: string, decide: Decide) => Promise<{ ok: true; job: Job; revision: Revision; repeated: boolean } | { ok: false; reason: string }>;
  addImported: (jobs: Job[], settings: Settings | null) => Promise<void>;
  deleteAll: () => Promise<void>;
  noteMeaningful: () => void;
}

const Ctx = createContext<StoreValue | null>(null);

const SOURCE_KEYS = new Set(['source', 'qtySource', 'rateSource']);

/** Everything in a draft that can change the customer's quote. Private economics, notes and input sources are left out. */
function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      if (!SOURCE_KEYS.has(k)) out[k] = stable((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

function facingKey(d: Draft): string {
  return JSON.stringify(stable({ lines: d.lines, pricing: d.pricing, name: d.customer.name.trim(), address: d.customer.address.trim(), note: d.customerNote, terms: d.terms, valid: d.validDays }));
}

/** Applies a new working draft: refreshes the label and marks the job changed only when the customer's quote would differ. */
export function withDraft(j: Job, draft: Draft): Job {
  const label = j.sample ? `Sample: ${jobLabel(draft)}` : jobLabel(draft);
  const latest = j.revisions.length ? j.revisions[j.revisions.length - 1] : null;
  const changed = latest ? facingKey(draft) !== facingKey(latest.inputs) : false;
  return { ...j, draft, label, dirtySince: changed ? j.dirtySince ?? Date.now() : null };
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [firstRun, setFirstRun] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [meta, setMeta] = useState<Meta>(defaultMeta);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [ledger, setLedger] = useState<Ledger>({ v: 1, entries: [] });

  const jobsRef = useRef<Job[]>([]);
  const metaRef = useRef<Meta>(meta);
  const settingsRef = useRef<Settings>(settings);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const setJobsBoth = useCallback((next: Job[]) => {
    jobsRef.current = next;
    setJobs(next);
  }, []);

  useEffect(() => {
    let alive = true;
    loadAll()
      .then((snap) => {
        if (!alive) return;
        settingsRef.current = snap.settings;
        metaRef.current = snap.meta;
        setSettings(snap.settings);
        setMeta(snap.meta);
        setLedger(snap.ledger);
        setJobsBoth(snap.jobs);
        setIssues(snap.issues);
        setFirstRun(snap.firstRun);
        setReady(true);
      })
      .catch(() => {
        if (!alive) return;
        setIssues(['Saved data could not be opened. Nothing was deleted. Restart the app to try again.']);
        setReady(true);
      });
    return () => {
      alive = false;
    };
  }, [setJobsBoth]);

  const persistJob = useCallback((id: string) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    const job = jobsRef.current.find((j) => j.id === id);
    return job ? saveJob(job) : Promise.resolve();
  }, []);

  const schedule = useCallback(
    (id: string) => {
      const t = timers.current.get(id);
      if (t) clearTimeout(t);
      timers.current.set(
        id,
        setTimeout(() => {
          persistJob(id).catch(() => setIssues((x) => Array.from(new Set([...x, 'A change could not be saved. Free some storage, then edit again.']))));
        }, 350),
      );
    },
    [persistJob],
  );

  const flush = useCallback(async () => {
    const ids = Array.from(timers.current.keys());
    await Promise.all(ids.map((id) => persistJob(id)));
  }, [persistJob]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') flush().catch(() => undefined);
    });
    return () => sub.remove();
  }, [flush]);

  const getJob = useCallback((id: string) => jobs.find((j) => j.id === id), [jobs]);

  const updateSettings = useCallback((fn: (s: Settings) => Settings) => {
    const next = fn(settingsRef.current);
    settingsRef.current = next;
    setSettings(next);
    saveSettings(next).catch(() => setIssues((x) => [...x, 'Settings could not be saved.']));
  }, []);

  const updateMeta = useCallback((fn: (m: Meta) => Meta) => {
    const next = fn(metaRef.current);
    metaRef.current = next;
    setMeta(next);
    saveMeta(next).catch(() => undefined);
  }, []);

  const createJob = useCallback(
    (draft: Draft, opts: { sample?: boolean; request?: string } = {}) => {
      const number = opts.sample ? 0 : metaRef.current.nextNumber;
      const job = newJob(draft, number, opts);
      if (!opts.sample) updateMeta((m) => ({ ...m, nextNumber: m.nextNumber + 1 }));
      setJobsBoth([job, ...jobsRef.current]);
      saveJob(job).catch(() => setIssues((x) => [...x, 'The new quote could not be saved yet. Keep the app open and try again.']));
      return job;
    },
    [setJobsBoth, updateMeta],
  );

  const updateJob = useCallback(
    (jobId: string, fn: (j: Job) => Job) => {
      const next = jobsRef.current.map((j) => (j.id === jobId ? { ...fn(j), updatedAt: Date.now() } : j));
      setJobsBoth(next);
      schedule(jobId);
    },
    [schedule, setJobsBoth],
  );

  const updateDraft = useCallback(
    (jobId: string, fn: (d: Draft) => Draft) => {
      updateJob(jobId, (j) => withDraft(j, fn(j.draft)));
    },
    [updateJob],
  );

  const deleteJob = useCallback(
    async (jobId: string) => {
      const t = timers.current.get(jobId);
      if (t) clearTimeout(t);
      timers.current.delete(jobId);
      setJobsBoth(jobsRef.current.filter((j) => j.id !== jobId));
      await removeJob(jobId);
    },
    [setJobsBoth],
  );

  const duplicateJob = useCallback(
    (jobId: string) => {
      const src = jobsRef.current.find((j) => j.id === jobId);
      if (!src) return null;
      const basis = src.revisions.length ? src.revisions[src.revisions.length - 1].inputs : src.draft;
      return createJob(duplicateDraft(basis), { sample: src.sample });
    },
    [createJob],
  );

  const commit = useCallback(
    async (jobId: string, finalizationId: string, decide: Decide) => {
      const t = timers.current.get(jobId);
      if (t) clearTimeout(t);
      timers.current.delete(jobId);
      const current = jobsRef.current.find((j) => j.id === jobId);
      if (!current) return { ok: false as const, reason: 'This job is no longer available.' };
      const withPending: Job = { ...current, pendingFinalizationId: current.pendingFinalizationId ?? finalizationId };
      const res = await commitFinalization(withPending, decide);
      if (!res.ok) {
        setJobsBoth(jobsRef.current.map((j) => (j.id === jobId ? withPending : j)));
        return res;
      }
      setLedger(res.ledger);
      setJobsBoth(jobsRef.current.map((j) => (j.id === jobId ? res.job : j)));
      return { ok: true as const, job: res.job, revision: res.revision, repeated: res.repeated };
    },
    [setJobsBoth],
  );

  const addImported = useCallback(
    async (imported: Job[], importedSettings: Settings | null) => {
      await importJobs(imported);
      const merged = [...jobsRef.current, ...imported].sort((a, b) => b.updatedAt - a.updatedAt);
      setJobsBoth(merged);
      const maxNumber = merged.reduce((mx, j) => Math.max(mx, j.number), 0);
      updateMeta((m) => ({ ...m, nextNumber: Math.max(m.nextNumber, maxNumber + 1) }));
      if (importedSettings) updateSettings(() => importedSettings);
    },
    [setJobsBoth, updateMeta, updateSettings],
  );

  const deleteAll = useCallback(async () => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current.clear();
    await deleteEverything();
    const s = defaultSettings();
    const m = { ...defaultMeta(), nextNumber: 1 };
    settingsRef.current = s;
    metaRef.current = m;
    setSettings(s);
    setMeta(m);
    setJobsBoth([]);
    await saveMeta(m);
  }, [setJobsBoth]);

  const noteMeaningful = useCallback(() => updateMeta((m) => ({ ...m, meaningfulActions: m.meaningfulActions + 1 })), [updateMeta]);

  const value = useMemo<StoreValue>(
    () => ({
      ready,
      firstRun,
      issues,
      dismissIssues: () => setIssues([]),
      settings,
      meta,
      jobs,
      freeUsed: ledger.entries.length,
      getJob,
      updateSettings,
      updateMeta,
      createJob,
      updateDraft,
      updateJob,
      deleteJob,
      duplicateJob,
      flush,
      commit,
      addImported,
      deleteAll,
      noteMeaningful,
    }),
    [ready, firstRun, issues, settings, meta, jobs, ledger, getJob, updateSettings, updateMeta, createJob, updateDraft, updateJob, deleteJob, duplicateJob, flush, commit, addImported, deleteAll, noteMeaningful],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}

export function useJob(id: string | undefined): Job | undefined {
  const { jobs } = useStore();
  return useMemo(() => (id ? jobs.find((j) => j.id === id) : undefined), [jobs, id]);
}
