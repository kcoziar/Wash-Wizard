import { useMemo } from 'react';
import * as StoreReview from 'expo-store-review';
import { Platform } from 'react-native';
import { decideAccess, isNewVisit, type AccessDecision } from './access';
import { TEMPLATE_VERSION } from './defaults';
import { buildQuoteDoc } from './document';
import { computeEconomics, type Econ } from './economics';
import { makeId, quoteReference } from './format';
import { preparePdf } from './output';
import { computeQuote, type Calc, type Issue } from './pricing';
import { jobIssues } from './resolve';
import { useSubscription } from './revenuecat';
import { useStore } from './store';
import type { Draft, Job, QuoteDoc, Revision, Settings } from './types';

export function revisionReference(job: Job, revisionNumber: number): string {
  if (job.sample) return revisionNumber > 1 ? `SAMPLE-R${revisionNumber}` : 'SAMPLE';
  return quoteReference(job.number, revisionNumber);
}

export function useJobCalc(job: Job | undefined, settings: Settings): { calc: Calc | null; issues: Issue[]; econ: Econ | null } {
  return useMemo(() => {
    if (!job) return { calc: null, issues: [], econ: null };
    const calc = computeQuote(job.draft);
    const issues = jobIssues(job.draft, calc);
    if (!settings.business.name.trim() && !job.sample) issues.push({ key: 'business', text: 'Add your business name' });
    return { calc, issues, econ: computeEconomics(job.draft, calc, settings) };
  }, [job, settings]);
}

export function latestRevision(job: Job | undefined): Revision | null {
  return job && job.revisions.length ? job.revisions[job.revisions.length - 1] : null;
}

export function draftDoc(job: Job, calc: Calc, settings: Settings): QuoteDoc {
  return buildQuoteDoc({
    draft: job.draft,
    calc,
    business: settings.business,
    reference: revisionReference(job, job.revisions.length + 1),
    issuedAt: Date.now(),
    sample: job.sample,
  });
}

export type CreateResult =
  | { kind: 'created'; revision: Revision; pdfUri: string | null; repeated: boolean }
  | { kind: 'issues'; issues: Issue[] }
  | { kind: 'blocked'; decision: AccessDecision }
  | { kind: 'new_visit' }
  | { kind: 'pdf_failed'; error: string }
  | { kind: 'conflict'; message: string }
  | { kind: 'error'; message: string; committed: 'no' | 'unknown' };

const BLOCK_TEXT = 'NEEDS_ACCESS';

function newVisitFor(job: Job, draft: Draft): boolean {
  const latest = latestRevision(job);
  return latest ? isNewVisit({ name: latest.doc.customer.name, address: latest.doc.customer.address }, { name: draft.customer.name, address: draft.customer.address }) : false;
}

export function useCreateQuote() {
  const store = useStore();
  const sub = useSubscription();

  /** Previews which access rule will apply, without changing anything. */
  const preview = (job: Job): AccessDecision =>
    decideAccess({ hasRevision: job.revisions.length > 0, newVisit: newVisitFor(job, job.draft), sample: job.sample, status: sub.status, freeUsed: store.freeUsed });

  const create = async (jobArg: Job, opts: { allowTextOnly?: boolean } = {}): Promise<CreateResult> => {
    // Read the newest in-memory values: a business name saved on blur a moment ago must count.
    const settings = store.peekSettings();
    const live = store.peekJob(jobArg.id) ?? jobArg;
    // Freeze exactly what is being quoted. Edits made while the PDF is prepared stay in the working draft.
    const draft: Draft = JSON.parse(JSON.stringify(live.draft));
    const snapshot: Job = { ...live, draft };
    const calc = computeQuote(draft);
    const issues = jobIssues(draft, calc);
    if (!settings.business.name.trim() && !snapshot.sample) issues.push({ key: 'business', text: 'Add your business name' });
    if (issues.length) return { kind: 'issues', issues };

    // A Pro state whose verified period has ended is re-checked before it is relied on.
    const status = await sub.verify();
    const newVisit = newVisitFor(snapshot, draft);
    const first = decideAccess({ hasRevision: snapshot.revisions.length > 0, newVisit, sample: snapshot.sample, status, freeUsed: store.freeUsed });
    if (first.kind === 'new_visit') return { kind: 'new_visit' };
    if (first.kind === 'blocked') return { kind: 'blocked', decision: first };

    const finalizationId = snapshot.pendingFinalizationId ?? makeId('f');
    const number = snapshot.revisions.length + 1;
    const now = Date.now();
    const doc = buildQuoteDoc({ draft, calc, business: settings.business, reference: revisionReference(snapshot, number), issuedAt: now, sample: snapshot.sample });

    let pdfUri: string | null = null;
    if (Platform.OS !== 'web') {
      const pdf = await preparePdf(doc);
      if (!pdf.ok && !opts.allowTextOnly) return { kind: 'pdf_failed', error: pdf.error };
      pdfUri = pdf.ok ? pdf.uri : null;
    }

    const econ = computeEconomics(draft, calc, settings);
    const inputs: Draft = JSON.parse(JSON.stringify(draft));
    let blockedDecision: AccessDecision | null = null;
    const res = await store.commit(snapshot, finalizationId, (stored, freeUsed) => {
      const d = decideAccess({ hasRevision: stored.revisions.length > 0, newVisit, sample: stored.sample, status, freeUsed });
      if (d.kind === 'blocked' || d.kind === 'new_visit') {
        blockedDecision = d;
        return { blocked: BLOCK_TEXT };
      }
      const revision: Revision = {
        id: makeId('r'),
        finalizationId,
        number,
        createdAt: now,
        policy: 'USD_V1',
        template: TEMPLATE_VERSION,
        reference: doc.reference,
        doc,
        inputs,
        economics: {
          revenue: econ.revenue,
          minutes: econ.minutes,
          costs: econ.costs,
          revenuePerHour: econ.revenuePerHour,
          availablePerHour: econ.availablePerHour,
        },
        freeUse: d.kind === 'free',
        mode: d.kind,
      };
      return { revision, freeUse: d.kind === 'free' };
    });
    if (!res.ok) {
      const bd = blockedDecision as AccessDecision | null;
      if (res.reason === 'blocked' && bd) return bd.kind === 'new_visit' ? { kind: 'new_visit' } : { kind: 'blocked', decision: bd };
      if (res.reason === 'conflict') return { kind: 'conflict', message: res.message };
      return { kind: 'error', message: res.message, committed: res.committed };
    }
    store.noteMeaningful();
    return { kind: 'created', revision: res.revision, pdfUri, repeated: res.repeated };
  };

  return { preview, create };
}

/**
 * Asks for an App Store rating only at a moment of success (a quote marked Accepted, a finished
 * job's recap), after at least 3 such moments, at most once every 120 days. Never on paywall
 * screens, the last free quote, or while recovering from an error. Native prompt only.
 */
export function useReviewPrompt() {
  const store = useStore();
  return async () => {
    const m = store.peekMeta();
    if (m.meaningfulActions < 3) return;
    if (m.reviewRequestedAt && Date.now() - m.reviewRequestedAt < 120 * 86_400_000) return;
    try {
      if (Platform.OS === 'web' || !(await StoreReview.isAvailableAsync())) return;
      store.updateMeta((x) => ({ ...x, reviewRequestedAt: Date.now() }));
      await StoreReview.requestReview();
    } catch {
      // Rating is optional; never interrupt the operator.
    }
  };
}
