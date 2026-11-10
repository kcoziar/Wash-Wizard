import { Dec, parseNonNeg } from './decimal';
import { makeId, money } from './format';
import { newLine } from './defaults';
import type { Calc, Issue } from './pricing';
import type { Draft, Line, Question, RatedKind, Settings } from './types';

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
  | { kind: 'ignore' };

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

  switch (r.kind) {
    case 'combine': {
      if (!area || group.length === 0) return { ok: false, error: 'There is no combined area to use.' };
      const [first, ...others] = group;
      first.name = joinNames(group.map((l) => l.name));
      first.qtyMode = 'direct';
      first.parts = [];
      first.qty = area.toString();
      first.qtySource = 'customer';
      lines = lines.filter((l) => !others.some((o) => o.id === l.id));
      answer = `Priced as one area: ${first.name}`;
      break;
    }
    case 'split': {
      if (!area || group.length !== 2) return { ok: false, error: 'Split works for two surfaces. Edit each line instead.' };
      const first = parseNonNeg(r.first);
      if (!first || first.isZero() || first.cmp(area) >= 0) return { ok: false, error: `Enter an amount above 0 and below ${area.toString()}.` };
      const second = area.sub(first);
      group[0].qtyMode = 'direct';
      group[0].parts = [];
      group[0].qty = first.toString();
      group[0].qtySource = 'customer';
      group[1].qtyMode = 'direct';
      group[1].parts = [];
      group[1].qty = second.toString();
      group[1].qtySource = 'customer';
      answer = `Split: ${group[0].name} ${first.toString()}, ${group[1].name} ${second.toString()}`;
      break;
    }
    case 'assign': {
      if (!area) return { ok: false, error: 'There is no area to assign.' };
      let target = lines.find((l) => l.kind === r.service && !l.qty.trim() && l.parts.length === 0);
      if (!target) {
        target = newLine(r.service, settings);
        lines.push(target);
      }
      target.qtyMode = 'direct';
      target.qty = area.toString();
      target.qtySource = 'customer';
      answer = `Used for ${target.name}`;
      break;
    }
    case 'measure':
      answer = 'Measure on site';
      break;
    case 'qty': {
      const v = parseNonNeg(r.qty);
      const line = group[0];
      if (!line) return { ok: false, error: 'That service is no longer on this quote.' };
      if (!v || v.isZero()) return { ok: false, error: 'Enter a number above 0.' };
      line.qtyMode = 'direct';
      line.parts = [];
      line.qty = v.toString();
      line.qtySource = 'operator';
      answer = `${line.name}: ${v.toString()}`;
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
  copy.lines = copy.lines.map((l) => ({ ...l, id: makeId('l'), parts: l.parts.map((p) => ({ ...p, id: makeId('p') })) }));
  return copy;
}
