import { jobLabel } from './defaults';
import type { Draft, Job } from './types';

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

export function facingKey(d: Draft): string {
  return JSON.stringify(stable({ lines: d.lines, pricing: d.pricing, name: d.customer.name.trim(), address: d.customer.address.trim(), note: d.customerNote, terms: d.terms, valid: d.validDays }));
}

/** Applies a new working draft: refreshes the label and marks the job changed only when the customer's quote would differ. */
export function withDraft(j: Job, draft: Draft): Job {
  const label = j.sample ? `Sample: ${jobLabel(draft)}` : jobLabel(draft);
  const latest = j.revisions.length ? j.revisions[j.revisions.length - 1] : null;
  const changed = latest ? facingKey(draft) !== facingKey(latest.inputs) : false;
  return { ...j, draft, label, dirtySince: changed ? j.dirtySince ?? Date.now() : null };
}
