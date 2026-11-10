import './nativeStorage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { defaultSettings, newJob } from './defaults';
import { reportError } from './analytics';
import { withDraft } from './jobState';
import { clearAppCaches } from './output';
import { duplicateDraft, reconcileQuestions, similarDraft } from './resolve';
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
  type CommitResult,
  type Decide,
} from './storage';
import type { Draft, Job, Ledger, Meta, Settings } from './types';

export { withDraft } from './jobState';

interface StoreValue {
  ready: boolean;
  /** Set when saved data could not be opened. Nothing is written until it loads. */
  loadError: string | null;
  reload: () => void;
  firstRun: boolean;
  issues: string[];
  dismissIssues: () => void;
  settings: Settings;
  meta: Meta;
  jobs: Job[];
  freeUsed: number;
  getJob: (id: string) => Job | undefined;
  /** Latest values, including changes made earlier in the same event, before React re-renders. */
  peekJob: (id: string) => Job | undefined;
  peekSettings: () => Settings;
  peekMeta: () => Meta;
  updateSettings: (fn: (s: Settings) => Settings) => void;
  updateMeta: (fn: (m: Meta) => Meta) => void;
  createJob: (draft: Draft, opts?: { sample?: boolean; request?: string }) => Job;
  updateDraft: (jobId: string, fn: (d: Draft) => Draft) => void;
  updateJob: (jobId: string, fn: (j: Job) => Job) => void;
  deleteJob: (jobId: string) => Promise<void>;
  /** Copies a job into a new one: from its latest sent quote (default) or from its current working draft. */
  duplicateJob: (jobId: string, from?: 'latest' | 'draft') => Job | null;
  /** A new draft with the same services, rates and terms, for a new customer and fresh sizes. */
  similarJob: (jobId: string) => Job | null;
  /** Moves a working draft that describes a different visit into its own new job, and restores the original to its latest quote. */
  separateVisit: (jobId: string) => Job | null;
  flush: () => Promise<void>;
  commit: (snapshot: Job, finalizationId: string, decide: Decide) => Promise<CommitResult>;
  addImported: (jobs: Job[], settings: Settings | null) => Promise<{ saved: number; notSaved: number }>;
  deleteAll: () => Promise<{ cachesCleared: boolean }>;
  noteMeaningful: () => void;
}

const Ctx = createContext<StoreValue | null>(null);

function mergeRevisions(mem: Job, written: Job): Job {
  const have = new Set(mem.revisions.map((r) => r.finalizationId));
  const extra = written.revisions.filter((r) => !have.has(r.finalizationId));
  if (!extra.length) return mem;
  return withDraft({ ...mem, revisions: [...mem.revisions, ...extra].sort((a, b) => a.number - b.number), status: mem.status === 'draft' ? 'quoted' : mem.status }, mem.draft);
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [firstRun, setFirstRun] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [meta, setMeta] = useState<Meta>(defaultMeta);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [ledger, setLedger] = useState<Ledger>({ v: 1, entries: [] });

  const loaded = useRef(false);
  const jobsRef = useRef<Job[]>([]);
  const metaRef = useRef<Meta>(meta);
  const settingsRef = useRef<Settings>(settings);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const addIssue = useCallback((text: string) => setIssues((x) => (x.includes(text) ? x : [...x, text])), []);

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
        setLoadError(null);
        loaded.current = true;
        setReady(true);
      })
      .catch((e) => {
        reportError(e, 'storage');
        if (!alive) return;
        setLoadError('Your saved jobs and settings could not be opened. Nothing was deleted or changed.');
      });
    return () => {
      alive = false;
    };
  }, [setJobsBoth, attempt]);

  const reload = useCallback(() => {
    setLoadError(null);
    setAttempt((n) => n + 1);
  }, []);

  const persistJob = useCallback(
    (id: string) => {
      const t = timers.current.get(id);
      if (t) clearTimeout(t);
      timers.current.delete(id);
      const job = jobsRef.current.find((j) => j.id === id);
      if (!job || !loaded.current) return Promise.resolve();
      return saveJob(job).then((res) => {
        if (!res.merged) return;
        // Storage held quote revisions this screen had not seen; keep them.
        setJobsBoth(jobsRef.current.map((j) => (j.id === id ? mergeRevisions(j, res.job) : j)));
      });
    },
    [setJobsBoth],
  );

  const schedule = useCallback(
    (id: string) => {
      const t = timers.current.get(id);
      if (t) clearTimeout(t);
      timers.current.set(
        id,
        setTimeout(() => {
          persistJob(id).catch(() => addIssue('A change could not be saved. Free some storage on this iPhone, then edit again.'));
        }, 350),
      );
    },
    [persistJob, addIssue],
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
  const peekJob = useCallback((id: string) => jobsRef.current.find((j) => j.id === id), []);
  const peekSettings = useCallback(() => settingsRef.current, []);
  const peekMeta = useCallback(() => metaRef.current, []);

  const updateSettings = useCallback(
    (fn: (s: Settings) => Settings) => {
      if (!loaded.current) return;
      const next = fn(settingsRef.current);
      settingsRef.current = next;
      setSettings(next);
      saveSettings(next).catch(() => addIssue('Settings could not be saved. Free some storage on this iPhone, then change them again.'));
    },
    [addIssue],
  );

  const updateMeta = useCallback((fn: (m: Meta) => Meta) => {
    if (!loaded.current) return;
    const next = fn(metaRef.current);
    metaRef.current = next;
    setMeta(next);
    saveMeta(next).catch(() => undefined);
  }, []);

  const createJob = useCallback(
    (draft: Draft, opts: { sample?: boolean; request?: string } = {}) => {
      const number = opts.sample ? 0 : metaRef.current.nextNumber;
      const job = newJob(draft, number, opts);
      if (!loaded.current) return job;
      if (!opts.sample) updateMeta((m) => ({ ...m, nextNumber: m.nextNumber + 1 }));
      setJobsBoth([job, ...jobsRef.current]);
      saveJob(job).catch(() => addIssue('The new job could not be saved yet. Keep the app open and try again.'));
      return job;
    },
    [setJobsBoth, updateMeta, addIssue],
  );

  const updateJob = useCallback(
    (jobId: string, fn: (j: Job) => Job) => {
      if (!loaded.current) return;
      const next = jobsRef.current.map((j) => (j.id === jobId ? { ...fn(j), updatedAt: Date.now() } : j));
      setJobsBoth(next);
      schedule(jobId);
    },
    [schedule, setJobsBoth],
  );

  const updateDraft = useCallback(
    (jobId: string, fn: (d: Draft) => Draft) => {
      // Questions the operator already settled by editing a line close on their own.
      updateJob(jobId, (j) => withDraft(j, reconcileQuestions(fn(j.draft))));
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

  // Duplicate copies what the operator is looking at now: the current draft, not the last quote.
  const duplicateJob = useCallback(
    (jobId: string, from: 'latest' | 'draft' = 'draft') => {
      const src = jobsRef.current.find((j) => j.id === jobId);
      if (!src) return null;
      const basis = from === 'latest' && src.revisions.length ? src.revisions[src.revisions.length - 1].inputs : src.draft;
      return createJob(duplicateDraft(basis), { sample: src.sample });
    },
    [createJob],
  );

  const similarJob = useCallback(
    (jobId: string) => {
      const src = jobsRef.current.find((j) => j.id === jobId);
      if (!src) return null;
      return createJob(similarDraft(src.draft, settingsRef.current));
    },
    [createJob],
  );

  const separateVisit = useCallback(
    (jobId: string) => {
      const src = jobsRef.current.find((j) => j.id === jobId);
      if (!src || !src.revisions.length) return null;
      const moved: Draft = JSON.parse(JSON.stringify(src.draft));
      const copy = createJob({ ...moved, customer: { ...moved.customer } }, { sample: src.sample });
      const latest = src.revisions[src.revisions.length - 1];
      updateJob(jobId, (j) => ({ ...withDraft(j, JSON.parse(JSON.stringify(latest.inputs))), dirtySince: null, pendingFinalizationId: null }));
      return copy;
    },
    [createJob, updateJob],
  );

  const commit = useCallback(
    async (snapshot: Job, finalizationId: string, decide: Decide): Promise<CommitResult> => {
      if (!loaded.current) return { ok: false, reason: 'storage', message: 'Saved data is not open yet. Nothing was used.', committed: 'no' };
      const res = await commitFinalization(snapshot, finalizationId, decide);
      if (!res.ok) {
        // Keep the same finalization for a retry, so an interrupted save is never counted twice.
        if (res.committed === 'unknown') setJobsBoth(jobsRef.current.map((j) => (j.id === snapshot.id ? { ...j, pendingFinalizationId: finalizationId } : j)));
        return res;
      }
      setLedger(res.ledger);
      const mem = jobsRef.current.find((j) => j.id === snapshot.id);
      // Edits made while the quote was being prepared stay in the working draft and show as changes.
      const next: Job = mem
        ? withDraft({ ...mem, revisions: res.job.revisions, status: mem.status === 'draft' ? 'quoted' : mem.status, pendingFinalizationId: null, dirtySince: null, updatedAt: Date.now() }, mem.draft)
        : res.job;
      setJobsBoth(mem ? jobsRef.current.map((j) => (j.id === snapshot.id ? next : j)) : [next, ...jobsRef.current]);
      if (mem) schedule(snapshot.id);
      return { ...res, job: next };
    },
    [setJobsBoth, schedule],
  );

  const addImported = useCallback(
    async (imported: Job[], importedSettings: Settings | null) => {
      if (!loaded.current) return { saved: 0, notSaved: imported.length };
      const res = await importJobs(imported);
      if (res.saved.length) {
        const merged = [...jobsRef.current, ...res.saved].sort((a, b) => b.updatedAt - a.updatedAt);
        setJobsBoth(merged);
        const maxNumber = merged.reduce((mx, j) => Math.max(mx, j.number), 0);
        updateMeta((m) => ({ ...m, nextNumber: Math.max(m.nextNumber, maxNumber + 1) }));
      }
      if (importedSettings && res.notSaved === 0) updateSettings(() => importedSettings);
      return { saved: res.saved.length, notSaved: res.notSaved };
    },
    [setJobsBoth, updateMeta, updateSettings],
  );

  const deleteAll = useCallback(async () => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current.clear();
    await deleteEverything();
    const cachesCleared = clearAppCaches();
    const s = defaultSettings();
    const m = { ...defaultMeta(), nextNumber: 1, onboarded: true };
    settingsRef.current = s;
    metaRef.current = m;
    setSettings(s);
    setMeta(m);
    setJobsBoth([]);
    await saveMeta(m);
    return { cachesCleared };
  }, [setJobsBoth]);

  const noteMeaningful = useCallback(() => updateMeta((m) => ({ ...m, meaningfulActions: m.meaningfulActions + 1 })), [updateMeta]);

  const value = useMemo<StoreValue>(
    () => ({
      ready,
      loadError,
      reload,
      firstRun,
      issues,
      dismissIssues: () => setIssues([]),
      settings,
      meta,
      jobs,
      freeUsed: ledger.entries.length,
      getJob,
      peekJob,
      peekSettings,
      peekMeta,
      updateSettings,
      updateMeta,
      createJob,
      updateDraft,
      updateJob,
      deleteJob,
      duplicateJob,
      similarJob,
      separateVisit,
      flush,
      commit,
      addImported,
      deleteAll,
      noteMeaningful,
    }),
    [ready, loadError, reload, firstRun, issues, settings, meta, jobs, ledger, getJob, peekJob, peekSettings, peekMeta, updateSettings, updateMeta, createJob, updateDraft, updateJob, deleteJob, duplicateJob, similarJob, separateVisit, flush, commit, addImported, deleteAll, noteMeaningful],
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

