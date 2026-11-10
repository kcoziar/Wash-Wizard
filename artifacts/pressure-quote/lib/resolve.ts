import { Dec, parseNonNeg } from './decimal';
import { makeId, money, number, unitLabel } from './format';
import { newDraft, newLine } from './defaults';
import { convertQuantity, lineQuantity } from './geometry';
import type { Calc, Issue } from './pricing';
import type { Draft, Job, Line, Question, RatedKind, Settings, Unit } from './types';

/** One-tap answers to the questions raised by a request. Every answer is explicit and reversible by editing. */
export type Resolution =
  | { kind: 'combine' }
  | { kind: 'split'; first: string }
  | { kind: 'assign'; service: RatedKind }
  | { kind: 'measure' }
  | { kind: 'qty'; qty: string }
  | { kind: 'free' }
  | { kind: 'budget' }
  | { kind: 'note' }
  | { kind: 'price' }
  | { kind: 'exclude' }
  | { kind: 'ignore' }
  /** Take the service off the quote. */
  | { kind: 'remove' }
  /** A second size for one surface: use it instead of the first. */
  | { kind: 'replace' }
  /** A second size for one surface: it is another area of the same kind. */
  | { kind: 'second' }
  /** The request said to leave a surface out: price it anyway. */
  | { kind: 'include' }
  /** The request said to leave a surface out: keep it listed as not included. */
  | { kind: 'keep_excluded' };

const AREA_UNITS: Unit[] = ['sqft', 'sqm'];

/** The question's size in a line's own unit, or null when the two cannot be compared (an area for a per-foot line). */
function sizeFor(q: Question, line: Line): Dec | null {
  const v = parseNonNeg(q.payload.area ?? '');
  if (!v) return null;
  const from: Unit = q.payload.unit ?? 'sqft';
  if (from === line.unit) return v;
  if (AREA_UNITS.includes(from) && AREA_UNITS.includes(line.unit)) return convertQuantity(v, from, line.unit).round(2);
  return null;
}

function setSize(line: Line, v: Dec, source: Line['qtySource']) {
  line.qtyMode = 'direct';
  line.parts = [];
  line.qty = v.toString();
  line.qtySource = source;
}

export type ResolveResult = { ok: true; draft: Draft; privateNote?: string } | { ok: false; error: string };

function joinNames(names: string[]): string {
  if (names.length === 0) return 'Combined area';
  const [first, ...rest] = names;
  return [first, ...rest.map((n) => n.charAt(0).toLowerCase() + n.slice(1))].join(' & ');
}

export function resolveQuestion(draft: Draft, questionId: string, r: Resolution, settings: Settings): ResolveResult {
  const q = draft.questions.find((x) => x.id === questionId);
  if (!q) return { ok: false, error: 'This question was already answered.' };
  let lines: Line[] = draft.lines.map((l) => ({ ...l }));
  let budget = draft.budget;
  let privateNote: string | undefined;
  let answer = '';
  const group = lines.filter((l) => q.lineIds.includes(l.id));
  const area = Dec.parse(q.payload.area ?? '');

  const payloadUnit: Unit = q.payload.unit ?? 'sqft';
  const source: Line['qtySource'] = q.payload.from === 'operator' ? 'operator' : 'customer';

  switch (r.kind) {
    case 'combine': {
      if (!area || group.length === 0) return { ok: false, error: 'There is no combined area to use.' };
      const [first, ...others] = group;
      const v = sizeFor(q, first);
      if (!v) return { ok: false, error: `${first.name} is not priced by area. Enter its size on the line instead.` };
      first.name = joinNames(group.map((l) => l.name));
      setSize(first, v, source);
      lines = lines.filter((l) => !others.some((o) => o.id === l.id));
      answer = `Priced as one area: ${first.name}`;
      break;
    }
    case 'split': {
      if (!area || group.length !== 2) return { ok: false, error: 'Split works for two surfaces. Edit each line instead.' };
      const first = parseNonNeg(r.first);
      if (!first || first.isZero() || first.cmp(area) >= 0) return { ok: false, error: `Enter an amount above 0 and below ${number(area)}.` };
      const second = area.sub(first);
      const shares = [first, second].map((share, i) => {
        const line = group[i];
        if (line.unit === payloadUnit) return share;
        if (AREA_UNITS.includes(line.unit) && AREA_UNITS.includes(payloadUnit)) return convertQuantity(share, payloadUnit, line.unit).round(2);
        return null;
      });
      if (!shares[0] || !shares[1]) return { ok: false, error: 'One of these is not priced by area. Enter each size on its line instead.' };
      setSize(group[0], shares[0], source);
      setSize(group[1], shares[1], source);
      answer = `Split: ${group[0].name} ${number(shares[0])}, ${group[1].name} ${number(shares[1])} ${unitLabel(group[1].unit)}`;
      break;
    }
    case 'assign': {
      if (!area) return { ok: false, error: 'There is no area to assign.' };
      let target = lines.find((l) => l.kind === r.service && !l.qty.trim() && l.parts.length === 0);
      const fresh = !target;
      if (!target) target = newLine(r.service, settings);
      const v = sizeFor(q, target);
      if (!v) return { ok: false, error: `${target.name} is not priced by area. Add it and enter its size on the line.` };
      if (fresh) lines.push(target);
      setSize(target, v, source);
      answer = `Used for ${target.name}`;
      break;
    }
    case 'replace': {
      const line = group[0];
      if (!line) return { ok: false, error: 'That service is no longer on this quote.' };
      const v = sizeFor(q, line);
      if (!v) return { ok: false, error: 'This size does not fit how the line is priced. Edit the line instead.' };
      setSize(line, v, source);
      answer = `Used ${q.payload.label || 'the second size'}`;
      break;
    }
    case 'second': {
      const base = group[0];
      if (!base) return { ok: false, error: 'That service is no longer on this quote.' };
      const v = sizeFor(q, base);
      if (!v) return { ok: false, error: 'This size does not fit how the line is priced. Add the line yourself.' };
      const line: Line = { ...base, id: makeId('l'), name: `${base.name} 2`, detail: '', parts: [], qtyMode: 'direct', qty: v.toString(), qtySource: source };
      lines.splice(lines.findIndex((l) => l.id === base.id) + 1, 0, line);
      answer = `Added ${line.name}`;
      break;
    }
    case 'remove': {
      if (group.length === 0) return { ok: false, error: 'That service is no longer on this quote.' };
      lines = lines.filter((l) => !q.lineIds.includes(l.id));
      answer = group.length === 1 ? `Removed ${group[0].name}` : 'Removed';
      break;
    }
    case 'include': {
      if (group.length === 0) return { ok: false, error: 'That service is no longer on this quote.' };
      for (const l of group) l.treatment = 'priced';
      answer = 'Priced anyway';
      break;
    }
    case 'keep_excluded':
      answer = 'Listed as not included';
      break;
    case 'measure':
      answer = 'Measure on site';
      break;
    case 'qty': {
      const v = parseNonNeg(r.qty);
      const line = group[0];
      if (!line) return { ok: false, error: 'That service is no longer on this quote.' };
      if (!v || v.isZero()) return { ok: false, error: 'Enter a number above 0.' };
      setSize(line, v, 'operator');
      answer = `${line.name}: ${number(v)} ${unitLabel(line.unit, line.eachLabel)}`;
      break;
    }
    case 'free': {
      const line = group[0];
      if (!line) return { ok: false, error: 'That service is no longer on this quote.' };
      line.treatment = 'free';
      answer = `${line.name} included at no charge`;
      break;
    }
    case 'budget': {
      const amt = q.payload.amount ?? '';
      if (!parseNonNeg(amt)) return { ok: false, error: 'There is no amount to use.' };
      budget = { state: 'known_value', amount: amt, source: 'customer', evidence: q.evidence };
      answer = 'Saved as the customer budget (not a price)';
      break;
    }
    case 'note': {
      const cents = Dec.parse(q.payload.amount ?? '')?.toCents() ?? 0;
      privateNote = `Customer mentioned ${money(cents)}: \u201C${q.evidence}\u201D`;
      answer = 'Saved to private notes';
      break;
    }
    case 'price': {
      const line = newLine('custom', settings, q.payload.label || 'Extra service');
      line.qtySource = 'customer';
      lines.push(line);
      answer = `Added ${line.name} to price`;
      break;
    }
    case 'exclude': {
      const line = newLine('custom', settings, q.payload.label || 'Extra service');
      line.treatment = 'excluded';
      lines.push(line);
      answer = `Listed as not included: ${line.name}`;
      break;
    }
    case 'ignore':
      answer = 'Not needed';
      break;
  }

  const questions: Question[] = draft.questions.map((x) => (x.id === q.id ? { ...x, resolved: true, answer } : x));
  return { ok: true, draft: { ...draft, lines, budget, questions }, privateNote };
}

/**
 * Closes questions the operator has already answered by editing: a size entered on the line,
 * a line removed, a left-out surface priced after all. Returns the same draft when nothing changed.
 */
export function reconcileQuestions(draft: Draft): Draft {
  let changed = false;
  const questions = draft.questions.map((q) => {
    if (q.resolved || q.lineIds.length === 0) return q;
    const group = draft.lines.filter((l) => q.lineIds.includes(l.id));
    let answer = '';
    if (group.length === 0) answer = 'Removed from the quote';
    else if (q.kind === 'missing_qty') {
      const l = group[0];
      if (l.treatment === 'excluded') answer = 'Listed as not included';
      else if (l.qtyType === 'flat' || lineQuantity(l).qty) answer = 'Size entered';
    } else if (q.kind === 'scope' && group.every((l) => l.treatment !== 'excluded')) answer = 'Priced anyway';
    if (!answer) return q;
    changed = true;
    return { ...q, resolved: true, answer };
  });
  return changed ? { ...draft, questions } : draft;
}

/** Customer-supplied quantities the operator has not yet confirmed. */
export function unconfirmed(draft: Draft): Line[] {
  return draft.lines.filter((l) => l.treatment !== 'excluded' && l.qtyType !== 'flat' && l.qtySource === 'customer' && (l.qty.trim() !== '' || l.parts.length > 0));
}

export function confirmQuantities(draft: Draft, lineIds?: string[]): Draft {
  return {
    ...draft,
    lines: draft.lines.map((l) => (l.qtySource === 'customer' && (!lineIds || lineIds.includes(l.id)) ? { ...l, qtySource: 'confirmed' } : l)),
  };
}

/** Everything that must be settled before the quote can be created. */
export function jobIssues(draft: Draft, calc: Calc): Issue[] {
  const out: Issue[] = [];
  for (const q of draft.questions) if (!q.resolved) out.push({ key: `q:${q.id}`, text: q.prompt });
  if (draft.customer.source === 'record' && (draft.customer.name.trim() || draft.customer.address.trim())) {
    out.push({ key: 'customer-record', text: 'Confirm the customer for this visit' });
  }
  const pending = unconfirmed(draft);
  if (pending.length) {
    out.push({
      key: 'confirm',
      text: pending.length === 1 ? `Confirm the customer's size for ${pending[0].name.toLowerCase()}` : `Confirm ${pending.length} sizes the customer gave`,
    });
  }
  return [...out, ...calc.blocking];
}

/** A safe copy of earlier work for a new visit: same scope and rates, fresh identity, carried-over customer flagged. */
export function duplicateDraft(source: Draft): Draft {
  const copy: Draft = JSON.parse(JSON.stringify(source));
  copy.questions = [];
  copy.budget = { state: 'unknown', amount: '', source: 'operator', evidence: '' };
  copy.pricing.minimumDecision = 'unset';
  copy.pricing.discount = { ...copy.pricing.discount, kind: 'none', value: '' };
  copy.customer = { ...copy.customer, source: 'record' };
  // Undo snapshots belong to the original job; a copy never restores another visit's sizes.
  copy.lines = copy.lines.map(({ unitOrigin: _u, basisOrigin: _b, ...l }) => ({ ...l, id: makeId('l'), parts: l.parts.map((p) => ({ ...p, id: makeId('p') })) }));
  return copy;
}

/**
 * "Quote similar work": the same services, rates and terms for a new customer. Sizes, counts and hours
 * are cleared so the new place is measured fresh; flat prices stay. Time and costs start from the
 * operator's usual, like any new job, because one visit's numbers are never another's.
 */
export function similarDraft(source: Draft, settings: Settings): Draft {
  const copy = duplicateDraft(source);
  const fresh = newDraft(settings);
  copy.customer = { name: '', phone: '', email: '', address: '', source: 'operator' };
  copy.visit = fresh.visit;
  copy.costs = fresh.costs;
  copy.ownerTarget = fresh.ownerTarget;
  copy.lines = copy.lines
    .filter((l) => l.treatment !== 'excluded')
    .map((l) => (l.qtyType === 'flat' ? { ...l, qtySource: 'operator' as const } : { ...l, qtyMode: 'direct' as const, qty: '', parts: [], qtySource: 'operator' as const }));
  return copy;
}

export interface PastCustomer {
  name: string;
  address: string;
  phone: string;
  email: string;
  jobId: string;
}

/** Earlier customers whose name has a word starting with what is being typed. Newest first, one per name and address. */
export function pastCustomers(jobs: Job[], query: string, currentJobId: string, limit = 3): PastCustomer[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  if (q.length < 2) return [];
  const seen = new Set<string>();
  const out: PastCustomer[] = [];
  for (const j of [...jobs].sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (j.sample || j.id === currentJobId) continue;
    const cu = j.draft.customer;
    const name = cu.name.trim().replace(/\s+/g, ' ');
    const lower = name.toLowerCase();
    if (!name || !(lower.startsWith(q) || lower.includes(` ${q}`))) continue;
    const key = `${lower}|${cu.address.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, address: cu.address.trim(), phone: cu.phone.trim(), email: cu.email.trim(), jobId: j.id });
    if (out.length >= limit) break;
  }
  return out;
}

/** "Start from their last quote": the services and sizes from that customer's latest quote, for the same place. */
export function linesFromLastQuote(job: Job): Line[] {
  const source = job.revisions.length ? job.revisions[job.revisions.length - 1].inputs : job.draft;
  return duplicateDraft(source).lines.filter((l) => l.treatment !== 'excluded');
}
