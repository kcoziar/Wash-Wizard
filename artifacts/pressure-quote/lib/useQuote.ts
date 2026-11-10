import { useMemo } from 'react';
import * as StoreReview from 'expo-store-review';
import { Platform } from 'react-native';
import { decideAccess, type AccessDecision } from './access';
import { TEMPLATE_VERSION } from './defaults';
import { buildQuoteDoc } from './document';
import { computeEconomics, type Econ } from './economics';
import { makeId, quoteReference } from './format';
import { preparePdf } from './output';
import { computeQuote, type Calc, type Issue } from './pricing';
import { jobIssues } from './resolve';
import { useSubscription } from './revenuecat';
import { useStore } from './store';
import type { Job, QuoteDoc, Revision, Settings } from './types';

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
  | { kind: 'pdf_failed'; error: string }
  | { kind: 'error'; message: string };

const BLOCK_TEXT = 'NEEDS_ACCESS';

export function useCreateQuote() {
  const store = useStore();
  const sub = useSubscription();

  /** Previews which access rule will apply, without changing anything. */
  const preview = (job: Job): AccessDecision =>
    decideAccess({ hasRevision: job.revisions.length > 0, sample: job.sample, status: sub.status, freeUsed: store.freeUsed });

  const create = async (job: Job, opts: { allowTextOnly?: boolean } = {}): Promise<CreateResult> => {
    const settings = store.settings;
    const calc = computeQuote(job.draft);
    const issues = jobIssues(job.draft, calc);
    if (!settings.business.name.trim() && !job.sample) issues.push({ key: 'business', text: 'Add your business name' });
    if (issues.length) return { kind: 'issues', issues };

    const first = preview(job);
    if (first.kind === 'blocked') return { kind: 'blocked', decision: first };

    const finalizationId = job.pendingFinalizationId ?? makeId('f');
    const number = job.revisions.length + 1;
    const now = Date.now();
    const doc = buildQuoteDoc({ draft: job.draft, calc, business: settings.business, reference: revisionReference(job, number), issuedAt: now, sample: job.sample });

    let pdfUri: string | null = null;
    if (Platform.OS !== 'web') {
      const pdf = await preparePdf(doc);
      if (!pdf.ok && !opts.allowTextOnly) return { kind: 'pdf_failed', error: pdf.error };
      pdfUri = pdf.ok ? pdf.uri : null;
    }

    const econ = computeEconomics(job.draft, calc, settings);
    let blockedDecision: AccessDecision | null = null;
    const res = await store.commit(job.id, finalizationId, (stored, freeUsed) => {
      const d = decideAccess({ hasRevision: stored.revisions.length > 0, sample: stored.sample, status: sub.status, freeUsed });
      if (d.kind === 'blocked') {
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
        inputs: JSON.parse(JSON.stringify(stored.draft)),
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
      if (res.reason === BLOCK_TEXT && blockedDecision) return { kind: 'blocked', decision: blockedDecision };
      return { kind: 'error', message: res.reason };
    }
    store.noteMeaningful();
    return { kind: 'created', revision: res.revision, pdfUri, repeated: res.repeated };
  };

  return { preview, create };
}

/** Asks for an App Store rating only after repeated success, at most once every 120 days. */
export function useReviewPrompt() {
  const store = useStore();
  return async () => {
    const m = store.meta;
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
