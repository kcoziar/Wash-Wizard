import { Dec } from './decimal';
import { makeId, number } from './format';
import { newDraft, newLine, SERVICE_META } from './defaults';
import { sqmToSqft } from './geometry';
import type { Draft, Line, Question, ServiceKind, Settings } from './types';

/**
 * Deterministic, on-device request reader. It extracts only facts that are
 * written in the request and never turns a budget into a price. Anything it
 * cannot place becomes a question for the operator.
 */
export const REQUEST_LIMIT = 5000;

type AreaKind = 'driveway' | 'walkway' | 'patio';

interface Mention {
  kind: ServiceKind;
  label: string;
  index: number;
  end: number;
}

interface Measure {
  type: 'rect' | 'area' | 'count';
  a: string;
  b: string;
  value: string;
  metric: boolean;
  approximate: boolean;
  combinedHint: boolean;
  index: number;
  end: number;
  text: string;
}

export interface ParsedService {
  kind: ServiceKind;
  name: string;
  evidence: string;
  measure: Measure | null;
}

export interface ParsedQuestion {
  kind: Question['kind'];
  prompt: string;
  evidence: string;
  serviceIdx: number[];
  payload: Question['payload'];
}

export interface ParsedRequest {
  text: string;
  services: ParsedService[];
  questions: ParsedQuestion[];
  customer: { name: string; phone: string; email: string; address: string };
  budget: { amount: string; evidence: string } | null;
  notes: string[];
}

const SERVICE_PATTERNS: { kind: ServiceKind; re: RegExp }[] = [
  { kind: 'driveway', re: /\b(?:concrete\s+|asphalt\s+|paver\s+)?drive\s?ways?\b/gi },
  { kind: 'patio', re: /\b(?:pool\s+decks?|pool\s+area|patios?|courtyards?|terraces?|paver\s+patios?)\b/gi },
  { kind: 'walkway', re: /\b(?:front\s+|back\s+|side\s+|garden\s+)?(?:walk\s?ways?|side\s?walks?|walk\s?paths?|path\s?ways?|paths?|front\s+walks?)\b/gi },
  { kind: 'stairs', re: /\b(?:front\s+|back\s+|porch\s+|concrete\s+)?(?:stair\s?ways?|stair\s?cases?|stairs?|steps?|stoops?)\b/gi },
];

const OTHER_SERVICES: { label: string; re: RegExp }[] = [
  { label: 'House wash', re: /\b(?:house\s+wash(?:ing)?|wash\s+(?:the|our|my)\s+house|siding|soft\s+wash(?:ing)?)\b/i },
  { label: 'Roof', re: /\broofs?\b/i },
  { label: 'Deck', re: /\b(?<!pool\s)decks?\b/i },
  { label: 'Fence', re: /\bfenc(?:e|es|ing)\b/i },
  { label: 'Gutters', re: /\bgutters?\b/i },
  { label: 'Windows', re: /\bwindows?\b/i },
  { label: 'Garage floor', re: /\bgarage\s+floor\b/i },
];

const CONDITIONS: { label: string; line: string; re: RegExp }[] = [
  { label: 'Oil stains', line: 'Oil stain treatment', re: /\boil(?:\s+(?:stains?|spots?|marks?))?\b/i },
  { label: 'Rust stains', line: 'Rust stain treatment', re: /\brust(?:\s+(?:stains?|spots?))?\b/i },
  { label: 'Mold or mildew', line: 'Mildew treatment', re: /\b(?:mold|mould|mildew|algae|moss|lichen)\b/i },
  { label: 'Gum', line: 'Gum removal', re: /\bgum\b/i },
  { label: 'Paint or graffiti', line: 'Paint or graffiti removal', re: /\b(?:graffiti|paint\s+(?:spills?|stains?))\b/i },
  { label: 'Tire marks', line: 'Tire mark removal', re: /\btire\s+marks?\b/i },
];

const APPROX = /\b(?:about|around|roughly|approx(?:imately)?|maybe|probably|estimated?|guess)\b|~/i;
const COMBINED = /\b(?:total|combined|together|altogether|in\s+all|all\s+in|both)\b/i;
const BUDGET_WORDS = /\b(?:offer(?:ed|ing)?|budget|hoping|hope|willing|pay|spend|afford|keep\s+it|max(?:imum)?|up\s+to|no\s+more\s+than|under|less\s+than|can\s+do|have|thinking)\b/i;
const COMPETITOR_WORDS = /\b(?:quoted|quote\s+from|another\s+(?:company|guy|person)|someone\s+else|other\s+(?:company|guy)|charged|last\s+year)\b/i;

function cap(s: string): string {
  const t = s.trim().replace(/\s+/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

function sentenceBounds(text: string, index: number): [number, number] {
  let start = index;
  while (start > 0 && !/[.!?\n]/.test(text[start - 1])) start--;
  let end = index;
  while (end < text.length && !/[.!?\n]/.test(text[end])) end++;
  // Decimal points inside numbers are not sentence ends.
  if (start > 1 && text[start - 1] === '.' && /\d/.test(text[start - 2] ?? '') && /\d/.test(text[start] ?? '')) {
    return sentenceBounds(text, start - 2);
  }
  return [start, end];
}

function snippet(text: string, index: number, end: number): string {
  const [s, e] = sentenceBounds(text, index);
  const sentence = text.slice(s, Math.max(e, end)).trim();
  return sentence.length > 140 ? text.slice(Math.max(0, index - 50), Math.min(text.length, end + 50)).trim() : sentence;
}

function findMentions(text: string): Mention[] {
  const out: Mention[] = [];
  for (const { kind, re } of SERVICE_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const index = m.index;
      const end = index + m[0].length;
      if (out.some((o) => index < o.end && end > o.index)) continue;
      out.push({ kind, label: m[0], index, end });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

function findMeasures(text: string): Measure[] {
  const out: Measure[] = [];
  const push = (m: Omit<Measure, 'approximate' | 'combinedHint'>) => {
    if (out.some((o) => m.index < o.end && m.end > o.index)) return;
    const [s, e] = sentenceBounds(text, m.index);
    const before = text.slice(Math.max(s, m.index - 24), m.index);
    const sentence = text.slice(s, e);
    out.push({ ...m, approximate: APPROX.test(before), combinedHint: COMBINED.test(sentence) });
  };
  // "40 ft long and 4 ft wide" / "4 feet wide by 40 feet long"
  const LEN_UNIT = "(?:'|\u2019|ft\\.?|feet|foot|m\\b|meters?|metres?)";
  const FILL = '\\s*(?:,|and|by|x|\u00D7)?\\s*(?:about\\s+|maybe\\s+|around\\s+|roughly\\s+|approx(?:imately|\\.)?\\s+)?';
  const longWide = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${LEN_UNIT})\\s*(long|wide)${FILL}(\\d+(?:\\.\\d+)?)\\s*(${LEN_UNIT})\\s*(long|wide|deep)`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = longWide.exec(text))) {
    if (m[3].toLowerCase() === m[6].toLowerCase()) continue;
    const metric = /\bm\b|met(?:er|re)s?/i.test(m[0]);
    push({ type: 'rect', a: m[1], b: m[4], value: '', metric, index: m.index, end: m.index + m[0].length, text: m[0] });
  }
  const rect = /(\d+(?:\.\d+)?)\s*(?:'|\u2019|ft\.?|feet|foot|m\b|meters?|metres?)?\s*(?:x|\u00D7|by|\*)\s*(\d+(?:\.\d+)?)\s*('|\u2019|ft\.?|feet|foot|m\b|meters?|metres?)?/gi;
  while ((m = rect.exec(text))) {
    const metric = /\bm\b|met(?:er|re)s?/i.test(m[0]);
    push({ type: 'rect', a: m[1], b: m[2], value: '', metric, index: m.index, end: m.index + m[0].length, text: m[0] });
  }
  const area = /(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*(?:sq\.?\s*(?:ft|feet|foot)\.?|square\s*(?:feet|foot|ft)|sqft|sf\b|ft2|ft\u00B2)/gi;
  while ((m = area.exec(text))) {
    const num = m[0].match(/[\d,]+(?:\.\d+)?/)?.[0].replace(/,/g, '') ?? '';
    push({ type: 'area', a: '', b: '', value: num, metric: false, index: m.index, end: m.index + m[0].length, text: m[0] });
  }
  const areaM = /(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*(?:m2|m\u00B2|sq\.?\s*m(?:eters?|etres?)?\b|square\s*met(?:er|re)s?)/gi;
  while ((m = areaM.exec(text))) {
    const num = m[0].match(/[\d,]+(?:\.\d+)?/)?.[0].replace(/,/g, '') ?? '';
    push({ type: 'area', a: '', b: '', value: num, metric: true, index: m.index, end: m.index + m[0].length, text: m[0] });
  }
  const count = /(\d+)\s*(?:front\s+|back\s+|porch\s+|concrete\s+|brick\s+)?(?:stairs|steps|stair|step)\b/gi;
  while ((m = count.exec(text))) {
    push({ type: 'count', a: '', b: '', value: m[1], metric: false, index: m.index, end: m.index + m[0].length, text: m[0] });
  }
  const flight = /flights?\s+of\s+(\d+)\s*(?:stairs|steps)?/gi;
  while ((m = flight.exec(text))) {
    push({ type: 'count', a: '', b: '', value: m[1], metric: false, index: m.index, end: m.index + m[0].length, text: m[0] });
  }
  return out.sort((a, b) => a.index - b.index);
}

function findContact(text: string) {
  const phone = text.match(/(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/)?.[0]?.trim() ?? '';
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? '';
  let name =
    text.match(/\b(?:[Mm]y name is|[Tt]his is|I am|I'm|It's)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/)?.[1] ??
    text.match(/(?:[Tt]hanks|[Tt]hank you|[Rr]egards|[Cc]heers|[Bb]est)[,!.]?\s*[-\u2013\u2014]?\s*\n?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*[.!]?\s*$/)?.[1] ??
    text.match(/\n\s*[-\u2013\u2014]\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*$/)?.[1] ??
    '';
  if (/^(Hoping|Looking|Wondering|Just|Not|Interested|Available|Free|Home|Here|Thinking)$/i.test(name.split(' ')[0] ?? '')) name = '';
  const addrRe = /\b\d{1,6}\s+(?:[A-Za-z0-9.'-]+\s+){0,4}?(?:st|street|ave|avenue|rd|road|dr|drive|ln|lane|ct|court|blvd|boulevard|way|pl|place|cir|circle|ter|terrace|pkwy|parkway|hwy|highway|trl|trail|loop|run)\b\.?(?:\s*,?\s*(?:apt|unit|#)\s*[\w-]+)?(?:,\s*[A-Za-z .]{2,30}?(?:,\s*[A-Z]{2})?(?:\s+\d{5})?)?/gi;
  let address = '';
  let m: RegExpExecArray | null;
  while ((m = addrRe.exec(text))) {
    if (/\b(?:ft|feet|foot|sq|square|steps?|stairs?|x|by|minutes?|hours?)\b/i.test(m[0])) continue;
    address = m[0].replace(/[.,\s]+$/, '');
    break;
  }
  return { name, phone, email, address };
}

export function parseRequest(raw: string): ParsedRequest {
  const text = raw.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
  const mentions = findMentions(text);
  const measures = findMeasures(text);
  const questions: ParsedQuestion[] = [];
  const notes: string[] = [];

  // One service per kind, keeping the customer's own words as the name.
  const services: ParsedService[] = [];
  const serviceIndexOf = (kind: ServiceKind) => services.findIndex((s) => s.kind === kind);
  for (const mention of mentions) {
    if (serviceIndexOf(mention.kind) >= 0) continue;
    const name = mention.kind === 'stairs' ? cap(mention.label) : cap(mention.label.replace(/s$/i, ''));
    services.push({ kind: mention.kind, name: name || SERVICE_META[mention.kind].name, evidence: snippet(text, mention.index, mention.end), measure: null });
  }

  const areaKinds = (list: Mention[]) => Array.from(new Set(list.filter((x) => x.kind !== 'stairs').map((x) => x.kind))) as AreaKind[];

  for (const meas of measures) {
    const evidence = snippet(text, meas.index, meas.end);
    if (meas.type === 'count') {
      let idx = serviceIndexOf('stairs');
      if (idx < 0) {
        services.push({ kind: 'stairs', name: 'Steps', evidence, measure: null });
        idx = services.length - 1;
      }
      if (!services[idx].measure) services[idx].measure = meas;
      continue;
    }
    const [s, e] = sentenceBounds(text, meas.index);
    let candidates = mentions.filter((x) => x.index >= s && x.end <= e && x.kind !== 'stairs');
    if (candidates.length === 0) {
      // "It's about 1,400 sq ft total." refers back to the previous sentence.
      const prev = mentions.filter((x) => x.end <= s && x.kind !== 'stairs');
      if (prev.length) {
        const [ps] = sentenceBounds(text, prev[prev.length - 1].index);
        candidates = prev.filter((x) => x.index >= ps);
      }
    }
    const kinds = areaKinds(candidates);
    if (kinds.length === 0) {
      const allArea = areaKinds(mentions);
      if (allArea.length === 1) kinds.push(allArea[0]);
    }
    if (kinds.length === 0) {
      questions.push({
        kind: 'combined_area',
        prompt: `Which surface is ${measureLabel(meas)}?`,
        evidence,
        serviceIdx: [],
        payload: { area: areaValue(meas), unit: 'sqft' },
      });
      continue;
    }
    if (kinds.length === 1) {
      const idx = serviceIndexOf(kinds[0]);
      if (!services[idx].measure) services[idx].measure = meas;
      else notes.push(`Also mentioned for ${services[idx].name}: ${meas.text.trim()}`);
      continue;
    }
    // Several surfaces in play: attach to the surface named right before the number, if any.
    const before = candidates.filter((x) => x.end <= meas.index && meas.index - x.end <= 28);
    const nearest = before[before.length - 1];
    const between = nearest ? text.slice(nearest.end, meas.index) : '';
    if (nearest && !meas.combinedHint && !/\band\b|&|\+/.test(between)) {
      const idx = serviceIndexOf(nearest.kind);
      if (!services[idx].measure) {
        services[idx].measure = meas;
        continue;
      }
    }
    const idxs = kinds.map(serviceIndexOf);
    questions.push({
      kind: 'combined_area',
      prompt: `Does ${measureLabel(meas)} include both the ${idxs.map((i) => services[i].name.toLowerCase()).join(' and the ')}?`,
      evidence,
      serviceIdx: idxs,
      payload: { area: areaValue(meas), unit: 'sqft' },
    });
  }

  // Money: a budget is never a price.
  let budget: ParsedRequest['budget'] = null;
  const moneyRe = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?!\s*(?:\/|per\b|a\s+(?:sq|square|foot|ft|step)))|(\d{1,3}(?:,\d{3})+|\d+)\s*(?:dollars|bucks)\b/gi;
  let mm: RegExpExecArray | null;
  while ((mm = moneyRe.exec(text))) {
    const whole = (mm[1] ?? mm[3] ?? '').replace(/,/g, '');
    const amount = mm[2] ? `${whole}.${mm[2]}` : whole;
    const [s] = sentenceBounds(text, mm.index);
    const before = text.slice(Math.max(s, mm.index - 60), mm.index);
    const evidence = snippet(text, mm.index, mm.index + mm[0].length);
    if (COMPETITOR_WORDS.test(before)) {
      questions.push({ kind: 'amount_meaning', prompt: `The customer mentioned $${number(Dec.parse(amount))}. What is it?`, evidence, serviceIdx: [], payload: { amount } });
    } else if (!budget && BUDGET_WORDS.test(before)) {
      budget = { amount, evidence };
    } else {
      questions.push({ kind: 'amount_meaning', prompt: `The customer mentioned $${number(Dec.parse(amount))}. What is it?`, evidence, serviceIdx: [], payload: { amount } });
    }
  }

  for (const o of OTHER_SERVICES) {
    const m = text.match(o.re);
    if (m && m.index != null) {
      questions.push({ kind: 'other_service', prompt: `The request also mentions: ${o.label.toLowerCase()}.`, evidence: snippet(text, m.index, m.index + m[0].length), serviceIdx: [], payload: { label: o.label } });
    }
  }
  for (const c of CONDITIONS) {
    const m = text.match(c.re);
    if (m && m.index != null) {
      questions.push({ kind: 'condition', prompt: `The customer mentioned ${c.label.toLowerCase()}.`, evidence: snippet(text, m.index, m.index + m[0].length), serviceIdx: [], payload: { label: c.line } });
    }
  }

  // Services without a usable quantity.
  services.forEach((svc, i) => {
    const covered = questions.some((q) => q.kind === 'combined_area' && q.serviceIdx.includes(i));
    if (!svc.measure && !covered) {
      questions.push({
        kind: 'missing_qty',
        prompt: svc.kind === 'stairs' ? `How many steps for the ${svc.name.toLowerCase()}?` : `How big is the ${svc.name.toLowerCase()}?`,
        evidence: svc.evidence,
        serviceIdx: [i],
        payload: {},
      });
    }
  });

  return { text: raw, services, questions, customer: findContact(text), budget, notes };
}

function areaValue(m: Measure): string {
  if (m.type === 'rect') {
    const d = (Dec.parse(m.a) as Dec).mul(Dec.parse(m.b) as Dec);
    return m.metric ? sqmToSqft(d, 2).toString() : d.toString();
  }
  const v = Dec.parse(m.value);
  if (!v) return '';
  return m.metric ? sqmToSqft(v, 2).toString() : v.toString();
}

function measureLabel(m: Measure): string {
  if (m.type === 'rect') return `${m.a} \u00D7 ${m.b}${m.metric ? ' m' : ' ft'}`;
  return `${number(Dec.parse(m.value))} ${m.metric ? 'm\u00B2' : 'sq ft'}`;
}

/** Builds a draft from a parsed request. Every extracted value is marked customer-supplied. */
export function draftFromRequest(parsed: ParsedRequest, settings: Settings): Draft {
  const draft = newDraft(settings, []);
  const lineIds: string[] = [];
  for (const svc of parsed.services) {
    const line: Line = { ...newLine(svc.kind, settings, svc.name), qtySource: 'customer' };
    const m = svc.measure;
    if (m) {
      if (m.type === 'rect' && !m.metric && line.qtyType === 'area') {
        line.qtyMode = 'parts';
        line.parts = [{ id: makeId('p'), shape: 'rect', a: m.a, b: m.b, subtract: false, label: '' }];
      } else if (m.type === 'count' && line.qtyType === 'each') {
        line.qty = m.value;
      } else if (line.qtyType === 'area') {
        line.qty = areaValue(m);
        if (m.metric) line.detail = '';
      }
      if (m.approximate) line.qtySource = 'customer';
    }
    draft.lines.push(line);
    lineIds.push(line.id);
  }
  draft.questions = parsed.questions.map((q) => ({
    id: makeId('q'),
    kind: q.kind,
    prompt: q.prompt,
    evidence: q.evidence,
    lineIds: q.serviceIdx.map((i) => lineIds[i]).filter(Boolean),
    resolved: false,
    answer: '',
    payload: q.payload,
  }));
  const c = parsed.customer;
  draft.customer = { name: c.name, phone: c.phone, email: c.email, address: c.address, source: 'customer' };
  if (parsed.budget) draft.budget = { state: 'known_value', amount: parsed.budget.amount, source: 'customer', evidence: parsed.budget.evidence };
  return draft;
}
