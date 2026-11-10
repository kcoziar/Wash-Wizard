import { Dec } from './decimal';
import { makeId, number } from './format';
import { newDraft, newLine, SERVICE_META } from './defaults';
import { convertRate, lineQuantity, M_PER_FT, SQM_PER_SQFT } from './geometry';
import type { Draft, Line, Part, Question, RatedKind, ServiceKind, Settings, Source, Unit, UnitSystem } from './types';

/**
 * Deterministic, on-device request reader. It extracts only facts that are
 * written in the request and never turns a budget into a price. Anything it
 * cannot place becomes a question for the operator.
 *
 * Two modes:
 * - customer: a message from a customer. Sizes, name and address are marked
 *   customer-supplied until the operator confirms them; money is a budget or a question.
 * - operator: the operator's own notes ("driveway 20 by 40, 250 flat"). Sizes are the
 *   operator's, and "250 flat" or "15 cents a foot" set the line's price or rate.
 */
export const REQUEST_LIMIT = 5000;

export type RequestMode = 'customer' | 'operator';
export interface ParseOptions {
  units?: UnitSystem;
  mode?: RequestMode;
}

type LenUnit = 'ft' | 'm';
type AreaUnit = 'sqft' | 'sqm';
type RateFamily = 'area' | 'foot' | 'linear' | 'each' | 'hour';

interface Span {
  index: number;
  end: number;
}

interface Mention extends Span {
  kind: RatedKind;
  /** The customer's own words, e.g. "front walkway". */
  label: string;
  /** Location word that tells two surfaces of the same kind apart ("front", "back"). */
  qualifier: string;
  /** Noun family: a sidewalk and a walkway are different surfaces, steps and stairs are not. */
  group: string;
  negated: boolean;
}

export interface Measure extends Span {
  type: 'rect' | 'area' | 'count' | 'length';
  a: string;
  b: string;
  aUnit: LenUnit;
  bUnit: LenUnit;
  /** Which side was called the length ("40 ft long"), when the request says so. */
  longSide: 'a' | 'b' | null;
  value: string;
  areaUnit: AreaUnit;
  approximate: boolean;
  combinedHint: boolean;
  /** "excluding 100 sq ft": an area to take away. */
  exclusion: boolean;
  text: string;
}

export interface ParsedService {
  kind: ServiceKind;
  name: string;
  evidence: string;
  measure: Measure | null;
  exclusions: Measure[];
  /** The request asks to leave this surface out. */
  negated: boolean;
  /** Operator notes only: "250 flat". */
  flatPrice: string | null;
  /** Operator notes only: "$0.15 a square foot". */
  rate: { amount: string; family: RateFamily; unit: Unit | null; label: string; evidence: string } | null;
  qualifier: string;
  group: string;
}

export interface ParsedQuestion {
  kind: Question['kind'];
  prompt: string;
  evidence: string;
  serviceIdx: number[];
  payload: Question['payload'];
  /** The size the question is about; draftFromRequest converts it to the line's unit. */
  measure?: Measure;
}

export interface ParsedRequest {
  text: string;
  mode: RequestMode;
  units: UnitSystem;
  services: ParsedService[];
  questions: ParsedQuestion[];
  customer: { name: string; phone: string; email: string; address: string };
  budget: { amount: string; evidence: string } | null;
}

// ---------- Text preparation ----------

const SMALL: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const NUM_WORD = `(?:${[...Object.keys(SMALL), ...Object.keys(TENS), 'hundred', 'thousand'].sort((a, b) => b.length - a.length).join('|')})`;
const NUM_RUN = new RegExp(`\\b(?:an?\\s+(?=hundred\\b|thousand\\b))?${NUM_WORD}(?:(?:\\s+|-)(?:and\\s+)?${NUM_WORD})*\\b`, 'gi');

/** "twenty four by forty" -> "24 by 40", "two fifty flat" -> "250 flat", "twelve hundred" -> "1200". */
function convertRun(run: string): string {
  const tokens = run.toLowerCase().split(/[\s-]+/).filter(Boolean);
  const out: string[] = [];
  let total = 0;
  let current = 0;
  let started = false;
  let last: 'none' | 'unit' | 'teen' | 'tens' | 'hundred' | 'thousand' = 'none';
  const flush = () => {
    if (started) out.push(String(total + current));
    total = 0;
    current = 0;
    started = false;
    last = 'none';
  };
  for (const t of tokens) {
    if (t === 'a' || t === 'an') {
      flush();
      current = 1;
      started = true;
      last = 'unit';
      continue;
    }
    if (t === 'and') {
      if (last === 'hundred' || last === 'thousand') continue;
      flush();
      out.push('and');
      continue;
    }
    if (t in SMALL) {
      const v = SMALL[t];
      const teen = v >= 10;
      const ok = last === 'none' || last === 'hundred' || last === 'thousand' || (!teen && v > 0 && last === 'tens');
      if (!ok) flush();
      current += v;
      started = true;
      last = teen ? 'teen' : last === 'tens' ? 'teen' : 'unit';
      continue;
    }
    if (t in TENS) {
      if (last === 'unit' && total === 0 && current > 0 && current < 10) {
        // Spoken prices: "two fifty" is 250.
        current = current * 100 + TENS[t];
        last = 'tens';
        continue;
      }
      const ok = last === 'none' || last === 'hundred' || last === 'thousand';
      if (!ok) flush();
      current += TENS[t];
      started = true;
      last = 'tens';
      continue;
    }
    if (t === 'hundred') {
      if (last === 'hundred') flush();
      current = (current || 1) * 100;
      started = true;
      last = 'hundred';
      continue;
    }
    if (t === 'thousand') {
      if (last === 'thousand') flush();
      total += (current || 1) * 1000;
      current = 0;
      started = true;
      last = 'thousand';
    }
  }
  flush();
  return out.join(' ');
}

interface Shift {
  origStart: number;
  origEnd: number;
  newStart: number;
  newEnd: number;
}

/** The text the reader works on (number words as digits, plain quotes), plus a map back to the customer's own words. */
class RequestText {
  readonly orig: string;
  readonly text: string;
  private shifts: Shift[];

  constructor(raw: string) {
    this.orig = raw;
    const shifts: Shift[] = [];
    let text = '';
    let last = 0;
    NUM_RUN.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = NUM_RUN.exec(raw))) {
      const digits = convertRun(m[0]);
      text += raw.slice(last, m.index);
      const newStart = text.length;
      text += digits;
      shifts.push({ origStart: m.index, origEnd: m.index + m[0].length, newStart, newEnd: text.length });
      last = m.index + m[0].length;
    }
    text += raw.slice(last);
    this.text = text.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
    this.shifts = shifts;
  }

  /** Position in the original text for a position in the working text. */
  toOrig(i: number, edge: 'start' | 'end'): number {
    let delta = 0;
    for (const s of this.shifts) {
      if (i < s.newStart) break;
      if (i < s.newEnd || (i === s.newEnd && edge === 'end')) return edge === 'start' ? s.origStart : s.origEnd;
      delta = s.origEnd - s.newEnd;
    }
    return i + delta;
  }

  /** The customer's own words for a span of the working text. */
  slice(index: number, end: number): string {
    return this.orig.slice(this.toOrig(index, 'start'), this.toOrig(end, 'end'));
  }
}

// ---------- Sentences ----------

const ABBR = /(?:^|[^a-z])(?:sq|ft|approx|st|ave|rd|dr|ln|ct|blvd|pl|cir|ter|hwy|pkwy|apt|no|mr|mrs|ms|jr|sr|etc|vs|est|n|s|e|w)$/i;

function isStop(t: string, i: number): boolean {
  const ch = t[i];
  if (ch === '\n' || ch === '!' || ch === '?') return true;
  if (ch !== '.') return false;
  const next = t[i + 1];
  if (next !== undefined && !/\s/.test(next)) return false;
  if (ABBR.test(t.slice(Math.max(0, i - 8), i))) {
    const after = t.slice(i + 1).match(/^\s*(\S)/)?.[1] ?? '';
    if (/[a-z0-9$]/.test(after)) return false;
  }
  return true;
}

function sentenceBounds(t: string, index: number): [number, number] {
  let start = Math.min(index, t.length);
  while (start > 0 && !isStop(t, start - 1)) start--;
  let end = Math.min(index, t.length);
  while (end < t.length && !isStop(t, end)) end++;
  return [start, end];
}

function snippet(src: RequestText, index: number, end: number): string {
  const [s, e] = sentenceBounds(src.text, index);
  const sentence = src.slice(s, Math.max(e, end)).trim();
  if (sentence.length <= 140) return sentence;
  return src.slice(Math.max(0, index - 50), Math.min(src.text.length, end + 50)).trim();
}

const overlaps = (a: Span, b: Span) => a.index < b.end && a.end > b.index;

// ---------- Contact ----------

const NAME_STOP = new Set(
  'hoping looking wondering just not interested available free home here thinking also please thanks thank hi hello hey the we our my can could would will at from and in on for to with driveway driveways patio patios walkway walkways sidewalk path steps stairs stoop deck pool front back side concrete asphalt brick stone pavers cement flat total about around approx maybe i so ok okay yes no sure great good sorry glad happy new call text email phone cell mobile address'.split(' '),
);

function ci(word: string): string {
  return word.replace(/[a-z]/g, (ch) => `[${ch.toUpperCase()}${ch}]`);
}
const SUFFIXES = 'street st avenue ave road rd drive dr lane ln court ct boulevard blvd way place pl circle cir terrace ter parkway pkwy highway hwy trail trl loop run crescent cres close alley pike point pt crossing xing ridge row'.split(' ');
const SUFFIX_CI = `(?:${SUFFIXES.map(ci).join('|')})`;
const SUFFIX_I = `(?:${SUFFIXES.join('|')})`;
const DIR = '(?:[NSEW]|NE|NW|SE|SW|North|South|East|West)\\.?';
const TAIL =
  "(?:\\s*,?\\s*(?:[Aa]pt|[Aa]partment|[Uu]nit|[Ss]uite|[Ss]te|#)\\.?\\s*[\\w-]+)?(?:\\s*,\\s*[A-Z][A-Za-z.'-]*(?:\\s+[A-Z][A-Za-z.'-]*){0,2})?(?:\\s*,\\s*[A-Z]{2}\\b)?(?:,?\\s+\\d{5}(?:-\\d{4})?\\b)?";
const ADDRESS_CAP = new RegExp(`\\b\\d{1,6}[A-Za-z]?\\s+(?:${DIR}\\s+)?(?:(?:[A-Z][A-Za-z'.-]*|\\d+(?:st|nd|rd|th))\\s+){1,4}?${SUFFIX_CI}\\b(?:\\s+${SUFFIX_CI}\\b)?\\.?${TAIL}`, 'g');
const ADDRESS_LOWER = new RegExp(`\\b\\d{1,6}\\s+(?:[a-z][a-z'.-]*\\s+){1,3}?${SUFFIX_I}\\b(?:\\s+${SUFFIX_I}\\b)?\\.?${TAIL}`, 'gi');
const ADDRESS_CUE = /\b(?:at|address(?:\s+is)?|located\s+at|live\s+at|lives\s+at|house\s+(?:is\s+)?at|home\s+(?:is\s+)?at|property\s+(?:is\s+)?at|on)\s*:?\s*$/i;
const ADDRESS_STOP = /\b(?:ft|feet|foot|sq|square|steps?|stairs?|x|by|minutes?|hours?|about|around|maybe|and|or|the|of|wide|long|total|driveway|patio|walkway|sidewalk|path)\b/i;

/** Trims a trailing ", Thanks" that only looked like a city, then trailing punctuation. */
function addressSpan(m: RegExpExecArray): Span {
  let s = m[0];
  const city = s.match(/,\s*([A-Z][A-Za-z.'-]*)/);
  if (city?.index != null && NAME_STOP.has(city[1].toLowerCase())) s = s.slice(0, city.index);
  return { index: m.index, end: m.index + s.replace(/[.,\s]+$/, '').length };
}

function findAddress(text: string): Span | null {
  ADDRESS_CAP.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ADDRESS_CAP.exec(text))) {
    const street = m[0].replace(new RegExp(`${SUFFIX_CI}\\b[\\s\\S]*$`), '');
    if (ADDRESS_STOP.test(street)) {
      ADDRESS_CAP.lastIndex = m.index + 1;
      continue;
    }
    return addressSpan(m);
  }
  ADDRESS_LOWER.lastIndex = 0;
  while ((m = ADDRESS_LOWER.exec(text))) {
    const street = m[0].replace(new RegExp(`${SUFFIX_I}\\b[\\s\\S]*$`, 'i'), '');
    const before = text.slice(Math.max(0, m.index - 24), m.index);
    if (!ADDRESS_CUE.test(before) || ADDRESS_STOP.test(street)) {
      ADDRESS_LOWER.lastIndex = m.index + 1;
      continue;
    }
    return addressSpan(m);
  }
  return null;
}

function cleanName(raw: string | undefined): string {
  if (!raw) return '';
  const words = raw.trim().split(/\s+/);
  if (!words[0] || NAME_STOP.has(words[0].toLowerCase())) return '';
  if (words[1] && NAME_STOP.has(words[1].toLowerCase())) return words[0];
  return words.slice(0, 2).join(' ');
}

function findName(text: string): string {
  const NAME = "([A-Z][a-z'-]+(?:\\s+[A-Z][a-z'-]+)?)";
  const patterns = [
    new RegExp(`\\b(?:[Mm]y name is|[Tt]his is|I am|I'm|[Ii]t's|[Ii]t is)\\s+${NAME}`),
    new RegExp(`(?:[Tt]hanks|[Tt]hank you|[Tt]hx|[Rr]egards|[Cc]heers|[Bb]est|[Ss]incerely)[,!.]?\\s*[-\\u2013\\u2014]*\\s*\\n?\\s*${NAME}(?=\\s*(?:$|[\\n.!,]|[-\\u2013\\u2014]|\\(?\\+?\\d))`),
    new RegExp(`(?:^|\\n|[.!?]\\s*|\\s)[-\\u2013\\u2014]{1,2}\\s*${NAME}(?=\\s*(?:$|\\n|[,.]?\\s*\\(?\\+?\\d))`),
  ];
  for (const re of patterns) {
    const name = cleanName(text.match(re)?.[1]);
    if (name) return name;
  }
  return '';
}

interface Contact {
  name: string;
  phone: string;
  email: string;
  address: string;
  spans: Span[];
}

function findContact(src: RequestText): Contact {
  const text = src.text;
  const spans: Span[] = [];
  const phoneM = text.match(/(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/);
  const emailM = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (phoneM?.index != null) spans.push({ index: phoneM.index, end: phoneM.index + phoneM[0].length });
  if (emailM?.index != null) spans.push({ index: emailM.index, end: emailM.index + emailM[0].length });
  const addr = findAddress(text);
  if (addr) spans.push(addr);
  return {
    name: findName(text),
    phone: phoneM && phoneM.index != null ? src.slice(phoneM.index, phoneM.index + phoneM[0].length).trim() : '',
    email: emailM?.[0] ?? '',
    address: addr ? src.slice(addr.index, addr.end).trim() : '',
    spans,
  };
}

// ---------- Surfaces ----------

const LOC_ADJ = 'front|back|rear|side(?!\\s?walk)|upper|lower|top|bottom|north|south|east|west|left|right|main|second|other|entry|entrance|garden|pool|city|public|porch|guest';
const STAIR_PLACE = 'patio|deck|garage|basement|driveway|porch';
const MATERIAL = 'concrete|asphalt|pavers?|brick|stone|flagstone|cement|tile|stamped|aggregate|gravel';

const KIND_NOUNS: { kind: RatedKind; nouns: string; place: string }[] = [
  { kind: 'stairs', nouns: 'stair\\s?ways?|stair\\s?cases?|stairs?|steps?|stoops?', place: `${LOC_ADJ}|${STAIR_PLACE}` },
  { kind: 'driveway', nouns: 'drive\\s?ways?', place: LOC_ADJ },
  { kind: 'patio', nouns: 'pool\\s+decks?|pool\\s+areas?|patios?|courtyards?|terraces?|lanais?', place: LOC_ADJ },
  { kind: 'walkway', nouns: 'walk\\s?ways?|side\\s?walks?|walk\\s?paths?|path\\s?ways?|paths?|walks?', place: LOC_ADJ },
];

function nounGroup(kind: RatedKind, noun: string): string {
  const n = noun.toLowerCase().replace(/\s+/g, '');
  if (kind === 'walkway') return /^sidewalk/.test(n) ? 'sidewalk' : 'walkway';
  if (kind === 'patio') return /^pool/.test(n) ? 'pooldeck' : 'patio';
  return kind;
}

const NEG_BEFORE =
  /\b(?:(?:do\s+not|don'?t|no\s+need\s+to|not|never|won'?t\s+need\s+to)\s+(?:need\s+(?:to\s+)?|want\s+(?:you\s+)?(?:to\s+)?|have\s+to\s+)?(?:(?:pressure|power)\s+)?(?:wash|clean|do|touch|include|worry\s+about|bother\s+with)?\s*|(?:skip|skipping|except(?:\s+for)?|excluding|exclude|without|minus|other\s+than|but\s+not|not\s+including|leave\s+out|leaving\s+out|leave\s+off|no)\s+)(?:the\s+|our\s+|my\s+|that\s+|any\s+)?$/i;
const NEG_AFTER = /^\s*(?:(?:is|are)\s+(?:fine|ok|okay|good|already\s+(?:clean|done)|not\s+needed|done\s+already)\b|(?:does(?:\s+not|n'?t)|do(?:\s+not|n'?t))\s+need\b|can\s+be\s+skipped\b)/i;
const PHANTOM_BEFORE = /\b(?:next|first|few|following|these|those|what|any|further|baby|simple|easy|small|take|taking|took|same|several|couple|more|extra|additional|necessary|proper)\s+$/i;

function findMentions(text: string, blocked: Span[]): Mention[] {
  const out: Mention[] = [];
  for (const { kind, nouns, place } of KIND_NOUNS) {
    const re = new RegExp(`\\b(?:(${LOC_ADJ})\\s+(?:and|&|or|\\/)\\s+)?(?:(${place})\\s+)?(?:(${MATERIAL})\\s+)?(${nouns})\\b`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const index = m.index;
      const end = index + m[0].length;
      if (out.some((o) => overlaps(o, { index, end })) || blocked.some((b) => overlaps(b, { index, end }))) continue;
      const [first, second, material, noun] = [m[1], m[2], m[3], m[4]];
      if (/^walks?$/i.test(noun) && !second && !material) continue;
      if (kind === 'stairs') {
        const [s] = sentenceBounds(text, index);
        if (PHANTOM_BEFORE.test(text.slice(s, index))) continue;
        if (/^step$/i.test(noun) && /^\s+(?:by|up|in|out|back|forward|aside|away)\b/i.test(text.slice(end))) continue;
      }
      const group = nounGroup(kind, noun);
      const rest = `${material ? `${material} ` : ''}${noun}`;
      const quals = first ? [first, second] : [second ?? ''];
      for (const q of quals) {
        out.push({
          kind,
          label: q ? `${q} ${rest}` : rest,
          qualifier: (q ?? '').toLowerCase(),
          group,
          index,
          end,
          negated: false,
        });
      }
    }
  }
  out.sort((a, b) => a.index - b.index);
  // Negation: "do not wash the patio", "skip the steps", "the patio is fine", "not the driveway or the patio".
  for (let i = 0; i < out.length; i++) {
    const m = out[i];
    const [s, e] = sentenceBounds(text, m.index);
    const before = text.slice(s, m.index);
    const after = text.slice(m.end, e);
    if (NEG_BEFORE.test(before) || NEG_AFTER.test(after)) m.negated = true;
    const prev = out[i - 1];
    if (!m.negated && prev?.negated && prev.end <= m.index && /^\s*,?\s*(?:or|nor)\s+(?:the\s+|our\s+|my\s+)?$/i.test(text.slice(prev.end, m.index))) m.negated = true;
  }
  return out;
}

function surfaceName(m: Mention): string {
  const t = m.label.trim().replace(/\s+/g, ' ');
  const name = m.kind === 'stairs' ? t : t.replace(/s$/i, '');
  return name ? name.charAt(0).toUpperCase() + name.slice(1).toLowerCase() : SERVICE_META[m.kind].name;
}

function sameSurface(s: ParsedService, m: Mention): boolean {
  if (s.kind !== m.kind) return false;
  if (s.qualifier && m.qualifier) return s.qualifier === m.qualifier;
  return s.group === m.group;
}

// ---------- Sizes ----------

const NUM = '(\\d+(?:\\.\\d+)?)';
const AREA_NUM = '((?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?)';
const LEN_UNIT = "('|ft\\.?|feet|foot|m\\b|meters?|metres?)";
const APPROX = /\b(?:about|around|roughly|approx(?:imately|\.)?|maybe|probably|estimated?|guess|close\s+to|nearly|almost)\b|~/i;
const COMBINED = /\b(?:total|combined|together|altogether|in\s+all|all\s+in|both)\b/i;
const EXCLUDE_CUE = /\b(?:excluding|exclude|except(?:\s+for)?|minus|less|not\s+including|without|subtract(?:ing)?|take\s+out|taking\s+out|leave\s+out|leaving\s+out|but\s+not)\s+(?:(?:the|a|an|about|around|roughly|approx(?:imately)?\.?|maybe)\s+)*$/i;

const lenUnit = (u: string | undefined, fallback: LenUnit): LenUnit => (!u ? fallback : /^m/i.test(u) ? 'm' : 'ft');

function findMeasures(text: string, units: UnitSystem, blocked: Span[]): Measure[] {
  const out: Measure[] = [];
  const dflt: LenUnit = units === 'metric' ? 'm' : 'ft';
  const base = { a: '', b: '', aUnit: dflt, bUnit: dflt, longSide: null, value: '', areaUnit: (units === 'metric' ? 'sqm' : 'sqft') as AreaUnit };
  const push = (m: Omit<Measure, 'approximate' | 'combinedHint' | 'exclusion'>) => {
    if (out.some((o) => overlaps(o, m)) || blocked.some((b) => overlaps(b, m))) return;
    const [s, e] = sentenceBounds(text, m.index);
    const before = text.slice(Math.max(s, m.index - 24), m.index);
    out.push({ ...m, approximate: APPROX.test(before), combinedHint: COMBINED.test(text.slice(s, e)), exclusion: EXCLUDE_CUE.test(text.slice(s, m.index)) });
  };
  let m: RegExpExecArray | null;
  const FILL = '\\s*(?:,|and|by|x|\\u00D7)?\\s*(?:(?:about|maybe|around|roughly|approx(?:imately|\\.)?)\\s+)?';
  // "40 ft long and 4 ft wide" / "4 feet wide by 40 feet long"
  const longWide = new RegExp(`${NUM}\\s*${LEN_UNIT}?\\s*(long|wide|deep)${FILL}${NUM}\\s*${LEN_UNIT}?\\s*(long|wide|deep)`, 'gi');
  while ((m = longWide.exec(text))) {
    if (m[3].toLowerCase() === m[6].toLowerCase()) continue;
    const u1 = lenUnit(m[2] ?? m[5], dflt);
    const u2 = lenUnit(m[5] ?? m[2], dflt);
    const longSide = m[3].toLowerCase() === 'long' ? 'a' : m[6].toLowerCase() === 'long' ? 'b' : null;
    push({ ...base, type: 'rect', a: m[1], b: m[4], aUnit: u1, bUnit: u2, longSide, index: m.index, end: m.index + m[0].length, text: m[0] });
  }
  const rect = new RegExp(`${NUM}\\s*${LEN_UNIT}?\\s*(?:x|\\u00D7|by|\\*)\\s*${NUM}\\s*${LEN_UNIT}?`, 'gi');
  while ((m = rect.exec(text))) {
    const u1 = lenUnit(m[2] ?? m[4], dflt);
    const u2 = lenUnit(m[4] ?? m[2], dflt);
    push({ ...base, type: 'rect', a: m[1], b: m[3], aUnit: u1, bUnit: u2, index: m.index, end: m.index + m[0].length, text: m[0] });
  }
  const sqft = new RegExp(`${AREA_NUM}\\s*(?:sq\\.?\\s*(?:ft|feet|foot)\\.?|square\\s*(?:feet|foot|ft)|sqft|sf\\b|ft2|ft\\u00B2)`, 'gi');
  while ((m = sqft.exec(text))) {
    push({ ...base, type: 'area', value: m[1].replace(/,/g, ''), areaUnit: 'sqft', index: m.index, end: m.index + m[0].length, text: m[0] });
  }
  const sqm = new RegExp(`${AREA_NUM}\\s*(?:m2|m\\u00B2|sq\\.?\\s*m(?:eters?|etres?)?\\b|square\\s*met(?:er|re)s?|sqm\\b)`, 'gi');
  while ((m = sqm.exec(text))) {
    push({ ...base, type: 'area', value: m[1].replace(/,/g, ''), areaUnit: 'sqm', index: m.index, end: m.index + m[0].length, text: m[0] });
  }
  const linear = new RegExp(`${NUM}\\s*(?:${LEN_UNIT}\\s*long\\b|(?:linear|lineal)\\s+(ft|feet|foot|m|meters?|metres?)\\b|lf\\b)`, 'gi');
  while ((m = linear.exec(text))) {
    const u = lenUnit(m[2] ?? m[3], dflt);
    push({ ...base, type: 'length', a: m[1], aUnit: u, bUnit: u, longSide: 'a', index: m.index, end: m.index + m[0].length, text: m[0] });
  }
  const count = /(\d+)\s*(?:(?:front|back|rear|side|porch|concrete|brick|stone|outdoor|outside|entry|deck|patio|garage)\s+)?(?:stairs|steps|stair|step|stoops?)\b/gi;
  while ((m = count.exec(text))) {
    push({ ...base, type: 'count', value: m[1], index: m.index, end: m.index + m[0].length, text: m[0] });
  }
  // "steps 6", "stairs: 12"
  const countAfter = /\b(?:stairs|steps|stoops?)\s*(?:[:=-]\s*)?(\d+)\b(?!\s*(?:x|\u00D7|by|ft|feet|foot|'|m\b|met|sq|square|%|\.\d))/gi;
  while ((m = countAfter.exec(text))) {
    push({ ...base, type: 'count', value: m[1], index: m.index, end: m.index + m[0].length, text: m[0] });
  }
  const flight = /flights?\s+of\s+(\d+)\s*(?:stairs|steps)?/gi;
  while ((m = flight.exec(text))) {
    push({ ...base, type: 'count', value: m[1], index: m.index, end: m.index + m[0].length, text: m[0] });
  }
  return out.sort((a, b) => a.index - b.index);
}

const U = { ft: 'ft', m: 'm' } as const;

/** Short label for a size, in the units the request used. */
export function describeMeasure(m: Measure): string {
  if (m.type === 'rect') {
    return m.aUnit === m.bUnit ? `${m.a} \u00D7 ${m.b} ${U[m.aUnit]}` : `${m.a} ${U[m.aUnit]} \u00D7 ${m.b} ${U[m.bUnit]}`;
  }
  if (m.type === 'area') return `${number(Dec.parse(m.value))} ${m.areaUnit === 'sqm' ? 'm\u00B2' : 'sq ft'}`;
  if (m.type === 'length') return `${m.a} ${U[m.aUnit]} long`;
  return `${m.value} ${m.value === '1' ? 'step' : 'steps'}`;
}

function sameMeasure(a: Measure, b: Measure): boolean {
  return a.type === b.type && a.a === b.a && a.b === b.b && a.value === b.value && a.aUnit === b.aUnit && a.bUnit === b.bUnit && a.areaUnit === b.areaUnit;
}

function toLen(v: string, from: LenUnit, to: LenUnit): Dec | null {
  const d = Dec.parse(v);
  if (!d) return null;
  if (from === to) return d;
  return to === 'm' ? d.mul(M_PER_FT) : (d.div(M_PER_FT, 6) as Dec);
}

/** A size in a line's unit. Exact when no conversion is needed, otherwise rounded to 2 decimals. */
export function measureIn(m: Measure, unit: Unit): string | null {
  if (m.type === 'count') return unit === 'each' ? m.value : null;
  if (unit === 'ft' || unit === 'm') {
    if (m.type === 'area') return null;
    const side = m.type === 'length' || m.longSide === 'a' ? 'a' : m.longSide === 'b' ? 'b' : null;
    let len: Dec | null;
    if (side) len = toLen(side === 'a' ? m.a : m.b, side === 'a' ? m.aUnit : m.bUnit, unit);
    else {
      const a = toLen(m.a, m.aUnit, unit);
      const b = toLen(m.b, m.bUnit, unit);
      len = a && b ? (a.cmp(b) >= 0 ? a : b) : null;
    }
    return len ? len.round(2).toString() : null;
  }
  if (unit !== 'sqft' && unit !== 'sqm') return null;
  if (m.type === 'length') return null;
  const lineLen: LenUnit = unit === 'sqm' ? 'm' : 'ft';
  if (m.type === 'rect') {
    const a = toLen(m.a, m.aUnit, lineLen);
    const b = toLen(m.b, m.bUnit, lineLen);
    if (!a || !b) return null;
    const area = a.mul(b);
    return (m.aUnit === lineLen && m.bUnit === lineLen ? area : area.round(2)).toString();
  }
  const v = Dec.parse(m.value);
  if (!v) return null;
  if (m.areaUnit === unit) return v.toString();
  return (unit === 'sqm' ? v.mul(SQM_PER_SQFT).round(2) : (v.div(SQM_PER_SQFT, 2) as Dec)).toString();
}

// ---------- Money ----------

const BUDGET_WORDS = /\b(?:offer(?:ed|ing)?|budget|hoping|hope|willing|pay|spend|afford|keep\s+it|max(?:imum)?|up\s+to|no\s+more\s+than|under|less\s+than|can\s+do|have|thinking)\b/i;
const COMPETITOR_WORDS = /\b(?:quoted|quote\s+from|another\s+(?:company|guy|person)|someone\s+else|other\s+(?:company|guy)|charged|last\s+year)\b/i;
const PER_UNIT =
  /^\s*(?:\/\s*|per\s+|an?\s+|each\b)\s*(sq(?:uare)?\.?\s*(?:ft|feet|foot)\.?|sq\.?\s*m\b|sqm\b|square\s+met(?:er|re)s?|m2|m\u00B2|ft2|linear\s+(?:ft|foot|feet)|lf\b|foot|feet|ft\b|steps?\b|stairs?\b|hours?\b|hr\b|met(?:er|re)s?\b|m\b)?/i;
const FLAT_AFTER = /^\s*(?:dollars?|bucks)?\s*(?:flat(?:\s+(?:rate|price|fee))?|for\s+(?:the\s+)?(?:whole\s+)?(?:job|thing|lot|it|all))\b/i;
const FLAT_BEFORE = /\b(?:flat(?:\s+(?:rate|price|fee))?|price[d]?(?:\s+(?:at|is))?|charge|charging|quote[d]?(?:\s+(?:at|is))?)\s*(?:of|is|at|:)?\s*\$?\s*$/i;

interface MoneyToken extends Span {
  amount: string;
  per: { family: RateFamily; unit: Unit | null; label: string } | null;
  flat: boolean;
  dollar: boolean;
}

function perUnit(tail: string): MoneyToken['per'] {
  const m = tail.match(PER_UNIT);
  if (!m) return null;
  const u = (m[1] ?? '').toLowerCase().replace(/\s+/g, ' ');
  if (!u) return /^\s*each\b/i.test(tail) ? { family: 'each', unit: 'each', label: 'each' } : null;
  if (/^sq(?:uare)?\.?\s*(?:ft|feet|foot)|^ft2/.test(u)) return { family: 'area', unit: 'sqft', label: 'per sq ft' };
  if (/^sq\.?\s*m|^sqm|^square met|^m2|^m\u00B2/.test(u)) return { family: 'area', unit: 'sqm', label: 'per m\u00B2' };
  if (/^linear|^lf/.test(u)) return { family: 'linear', unit: 'ft', label: 'per linear ft' };
  if (/^(?:foot|feet|ft)/.test(u)) return { family: 'foot', unit: null, label: 'per foot' };
  if (/^step|^stair/.test(u)) return { family: 'each', unit: 'each', label: 'per step' };
  if (/^(?:hour|hr)/.test(u)) return { family: 'hour', unit: 'hour', label: 'per hour' };
  if (/^met|^m$/.test(u)) return { family: 'linear', unit: 'm', label: 'per metre' };
  return null;
}

function findMoney(text: string, mode: RequestMode, blocked: Span[]): MoneyToken[] {
  const out: MoneyToken[] = [];
  const add = (index: number, end: number, amount: string, dollar: boolean) => {
    const span = { index, end };
    if (out.some((o) => overlaps(o, span)) || blocked.some((b) => overlaps(b, span))) return;
    const tail = text.slice(end, end + 30);
    out.push({ index, end, amount, dollar, per: perUnit(tail), flat: FLAT_AFTER.test(tail) || FLAT_BEFORE.test(text.slice(Math.max(0, index - 30), index)) });
  };
  const money = /\$\s?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)|\b((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(?:dollars|bucks)\b|\b(\d+)\s*cents?\b/gi;
  let m: RegExpExecArray | null;
  while ((m = money.exec(text))) {
    const amount = m[3] ? Dec.raw(BigInt(m[3]), 2).toString() : (m[1] ?? m[2]).replace(/,/g, '');
    add(m.index, m.index + m[0].length, amount, true);
  }
  if (mode === 'operator') {
    // Bare numbers in the operator's own notes: "250 flat", "flat 250", ".15 a foot".
    const bare = /(?:^|[^\d.,$])((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)(?!\d|[.,]\d)/g;
    while ((m = bare.exec(text))) {
      const index = m.index + m[0].length - m[1].length;
      const end = index + m[1].length;
      const tail = text.slice(end, end + 30);
      const flat = FLAT_AFTER.test(tail) || FLAT_BEFORE.test(text.slice(Math.max(0, index - 30), index));
      const per = perUnit(tail);
      if (!flat && !(per && per.family !== 'each' && /^\s*(?:\/|per\b|an?\b)/i.test(tail))) continue;
      add(index, end, m[1].replace(/,/g, ''), false);
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

// ---------- Main ----------

export function parseRequest(raw: string, opts: ParseOptions = {}): ParsedRequest {
  const units = opts.units ?? 'imperial';
  const mode = opts.mode ?? 'customer';
  const src = new RequestText(raw);
  const text = src.text;
  const contact = findContact(src);
  const mentions = findMentions(text, contact.spans);
  const measures = findMeasures(text, units, contact.spans);
  const questions: ParsedQuestion[] = [];
  const who = mode === 'operator' ? 'Your notes' : 'The customer';

  // Surfaces: one per distinct surface, keeping the customer's own words as the name.
  const services: ParsedService[] = [];
  const surfaceOf = new Map<Mention, number>();
  for (const mention of mentions) {
    let idx = services.findIndex((s) => sameSurface(s, mention));
    if (idx < 0) {
      services.push({
        kind: mention.kind,
        name: surfaceName(mention),
        evidence: snippet(src, mention.index, mention.end),
        measure: null,
        exclusions: [],
        negated: false,
        flatPrice: null,
        rate: null,
        qualifier: mention.qualifier,
        group: mention.group,
      });
      idx = services.length - 1;
    } else if (!services[idx].qualifier && mention.qualifier) {
      services[idx].qualifier = mention.qualifier;
      services[idx].name = surfaceName(mention);
    }
    if (mention.negated) services[idx].negated = true;
    surfaceOf.set(mention, idx);
  }
  const lower = (i: number) => services[i].name.toLowerCase();

  const attach = (idx: number, meas: Measure) => {
    const svc = services[idx];
    if (meas.exclusion) {
      svc.exclusions.push(meas);
      return;
    }
    if (!svc.measure) {
      svc.measure = meas;
      return;
    }
    if (sameMeasure(svc.measure, meas)) return;
    questions.push({
      kind: 'extra_measure',
      prompt: `The request gives a second size for the ${lower(idx)}: ${describeMeasure(meas)}.`,
      evidence: snippet(src, meas.index, meas.end),
      serviceIdx: [idx],
      payload: { label: describeMeasure(meas) },
      measure: meas,
    });
  };

  const NO_JOIN = /\band\b|&|\+|\bplus\b|\balso\b|\bwith\b/i;
  const ADJ_GAP = /^\s*(?:of\s+)?(?:(?:the|a|an|my|our)\s+)?(?:(?!and\b|or\b|plus\b|with\b|to\b|for\b|also\b|then\b)[a-z]+\s+)?$/i;
  const ARTICLE = /\b(?:a|an|the|our|my|that|this)\s+(?:(?:about|around|roughly|approx(?:imately)?\.?|maybe|probably)\s+)?$/i;

  for (const meas of measures) {
    const evidence = snippet(src, meas.index, meas.end);
    if (meas.type === 'count') {
      const stairs = mentions.filter((x) => x.kind === 'stairs');
      const inside = stairs.find((x) => x.index >= meas.index && x.end <= meas.end + 1);
      const [s, e] = sentenceBounds(text, meas.index);
      const near = inside ?? stairs.filter((x) => x.index >= s && x.end <= e).sort((a, b) => Math.abs(a.index - meas.index) - Math.abs(b.index - meas.index))[0];
      let idx = near ? surfaceOf.get(near) ?? -1 : services.findIndex((x) => x.kind === 'stairs');
      if (idx < 0) {
        services.push({ kind: 'stairs', name: 'Steps', evidence, measure: null, exclusions: [], negated: false, flatPrice: null, rate: null, qualifier: '', group: 'stairs' });
        idx = services.length - 1;
      }
      attach(idx, meas);
      continue;
    }
    const [s, e] = sentenceBounds(text, meas.index);
    const areaMentions = mentions.filter((x) => x.kind !== 'stairs');
    if (!meas.combinedHint) {
      const before = areaMentions.filter((x) => x.end <= meas.index && x.index >= s).pop();
      const beforeOk = !!before && meas.index - before.end <= 30 && !NO_JOIN.test(text.slice(before.end, meas.index));
      const after = areaMentions.find((x) => x.index >= meas.end && x.end <= e);
      const afterOk = !!after && after.index - meas.end <= 20 && ADJ_GAP.test(text.slice(meas.end, after.index));
      if (after && afterOk && (!beforeOk || ARTICLE.test(text.slice(s, meas.index)))) {
        attach(surfaceOf.get(after) as number, meas);
        continue;
      }
      if (before && beforeOk) {
        attach(surfaceOf.get(before) as number, meas);
        continue;
      }
    }
    if (meas.exclusion) {
      // "Driveway 600 sq ft excluding 100 sq ft": the area taken away belongs to the surface sized just before it.
      const owner = services.findIndex((x) => x.measure && x.measure.index >= s && x.measure.end <= meas.index);
      if (owner >= 0) {
        attach(owner, meas);
        continue;
      }
    }
    let candidates = areaMentions.filter((x) => x.index >= s && x.end <= e);
    if (candidates.length === 0) {
      // "It's about 1,400 sq ft total." refers back to the previous sentence.
      const prev = areaMentions.filter((x) => x.end <= s);
      if (prev.length) {
        const [ps] = sentenceBounds(text, prev[prev.length - 1].index);
        candidates = prev.filter((x) => x.index >= ps);
      }
    }
    let idxs = Array.from(new Set(candidates.map((x) => surfaceOf.get(x) as number)));
    if (idxs.length === 0) {
      const all = services.map((x, i) => (x.kind !== 'stairs' && x.kind !== 'custom' ? i : -1)).filter((i) => i >= 0);
      if (all.length === 1) idxs = all;
    }
    if (idxs.length === 1) {
      attach(idxs[0], meas);
      continue;
    }
    if (meas.exclusion || meas.type === 'length') {
      // Nothing to price yet, but the operator sees it with the customer's words.
      const label = describeMeasure(meas);
      questions.push({ kind: 'missing_qty', prompt: meas.exclusion ? `Which surface should leave out ${label}?` : `Which surface is ${label}?`, evidence, serviceIdx: [], payload: { label } });
      continue;
    }
    if (idxs.length === 0) {
      questions.push({ kind: 'combined_area', prompt: `Which surface is ${describeMeasure(meas)}?`, evidence, serviceIdx: [], payload: {}, measure: meas });
      continue;
    }
    const names = idxs.map(lower);
    questions.push({
      kind: 'combined_area',
      prompt:
        names.length === 2
          ? `Does ${describeMeasure(meas)} include both the ${names[0]} and the ${names[1]}?`
          : `Does ${describeMeasure(meas)} cover the ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} together?`,
      evidence,
      serviceIdx: idxs,
      payload: {},
      measure: meas,
    });
  }

  // Money: a budget is never a price. Prices come only from the operator's own notes.
  let budget: ParsedRequest['budget'] = null;
  const usedSpans = [...contact.spans, ...measures];
  for (const tok of findMoney(text, mode, usedSpans)) {
    const [s, e] = sentenceBounds(text, tok.index);
    const before = text.slice(Math.max(s, tok.index - 60), tok.index);
    const evidence = snippet(src, tok.index, tok.end);
    const shown = `$${number(Dec.parse(tok.amount), 4)}`;
    const ask = (label?: string) =>
      questions.push({
        kind: 'amount_meaning',
        prompt: `${mode === 'operator' ? 'You noted' : 'The customer mentioned'} ${shown}${label ? ` ${label}` : ''}. What is it?`,
        evidence,
        serviceIdx: [],
        payload: label ? { amount: tok.amount, label } : { amount: tok.amount },
      });
    if (mode === 'operator' && (tok.per || tok.flat || tok.dollar) && !COMPETITOR_WORDS.test(before) && !BUDGET_WORDS.test(before)) {
      const target = targetSurface(tok, tok.per?.family === 'each' ? 'stairs' : tok.per ? 'area' : 'any', s, e);
      if (target >= 0 && tok.per) {
        services[target].rate = { amount: tok.amount, family: tok.per.family, unit: tok.per.unit, label: tok.per.label, evidence };
        continue;
      }
      // A bare "$250" right after a surface or its size is that surface's price; anything else needs "flat".
      const near = target >= 0 && (tok.flat || adjacentTo(target, tok));
      if (near && !services[target].flatPrice) {
        services[target].flatPrice = tok.amount;
        continue;
      }
      ask(tok.per?.label);
      continue;
    }
    if (tok.per) ask(tok.per.label);
    else if (COMPETITOR_WORDS.test(before)) ask();
    else if (!budget && BUDGET_WORDS.test(before)) budget = { amount: tok.amount, evidence };
    else ask();
  }

  function targetSurface(tok: Span, want: 'stairs' | 'area' | 'any', s: number, e: number): number {
    const fits = (k: ServiceKind) => (want === 'any' ? true : want === 'stairs' ? k === 'stairs' : k !== 'stairs');
    const inSentence = mentions.filter((x) => fits(x.kind) && x.index >= s && x.end <= e);
    const before = inSentence.filter((x) => x.end <= tok.index).pop();
    if (before) return surfaceOf.get(before) as number;
    const after = inSentence.find((x) => x.index >= tok.end);
    if (after) return surfaceOf.get(after) as number;
    const open = services.map((x, i) => (fits(x.kind) && !x.negated ? i : -1)).filter((i) => i >= 0);
    return open.length === 1 ? open[0] : -1;
  }

  function adjacentTo(idx: number, tok: Span): boolean {
    const anchors: Span[] = [...mentions.filter((x) => surfaceOf.get(x) === idx), ...(services[idx].measure ? [services[idx].measure as Measure] : [])];
    return anchors.some((a) => a.end <= tok.index && tok.index - a.end <= 14 && !NO_JOIN.test(text.slice(a.end, tok.index)));
  }

  for (const o of OTHER_SERVICES) {
    const m = text.match(o.re);
    if (m && m.index != null) {
      questions.push({ kind: 'other_service', prompt: `The request also mentions: ${o.label.toLowerCase()}.`, evidence: snippet(src, m.index, m.index + m[0].length), serviceIdx: [], payload: { label: o.label } });
    }
  }
  for (const c of CONDITIONS) {
    const m = text.match(c.re);
    if (m && m.index != null) {
      questions.push({ kind: 'condition', prompt: `${who === 'Your notes' ? 'Your notes mention' : 'The customer mentioned'} ${c.label.toLowerCase()}.`, evidence: snippet(src, m.index, m.index + m[0].length), serviceIdx: [], payload: { label: c.line } });
    }
  }

  services.forEach((svc, i) => {
    if (svc.negated) {
      questions.push({
        kind: 'scope',
        prompt: mode === 'operator' ? `Your notes say to leave out the ${lower(i)}.` : `The customer asked to leave out the ${lower(i)}.`,
        evidence: svc.evidence,
        serviceIdx: [i],
        payload: {},
      });
      return;
    }
    const covered = questions.some((q) => (q.kind === 'combined_area' || q.kind === 'extra_measure') && q.serviceIdx.includes(i));
    if (!svc.measure && !covered && !svc.flatPrice) {
      questions.push({
        kind: 'missing_qty',
        prompt: svc.kind === 'stairs' ? `How many steps for the ${lower(i)}?` : `How big is the ${lower(i)}?`,
        evidence: svc.evidence,
        serviceIdx: [i],
        payload: {},
      });
    }
  });

  return { text: raw, mode, units, services, questions, customer: { name: contact.name, phone: contact.phone, email: contact.email, address: contact.address }, budget };
}

const OTHER_SERVICES: { label: string; re: RegExp }[] = [
  { label: 'House wash', re: /\b(?:house\s+wash(?:ing)?|wash\s+(?:the|our|my)\s+house|siding|soft\s+wash(?:ing)?)\b/i },
  { label: 'Roof', re: /\broofs?\b/i },
  { label: 'Deck', re: /\b(?<!pool\s)decks?\b(?!\s+(?:steps?|stairs?))/i },
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

/**
 * Customer message or the operator's own notes? Used only for typed text until the operator picks;
 * pasted text is always a customer message. Defaults to customer, because notes mode turns amounts into prices.
 */
export function guessMode(text: string): RequestMode {
  const t = text.trim();
  if (!t || t.length > 160) return 'customer';
  if (/\b(?:hi|hello|hey|thanks|thank\s+you|please|could|can\s+you|would|we|our|my|me|I|I'm|us|you|your)\b/i.test(t)) return 'customer';
  const startsWithSurface = /^\s*(?:\d+\s+)?(?:front\s+|back\s+)?(?:drive\s?ways?|patios?|walk\s?ways?|side\s?walks?|steps|stairs|pool\s+deck)\b/i.test(t);
  const priceCue = /\bflat\b|\bcents?\b|\b(?:an?|per)\s+(?:foot|ft|step|sq)|\/\s*(?:sq|ft|step)|\bat\s+\$?\d/i.test(t);
  return startsWithSurface && priceCue ? 'operator' : 'customer';
}

// ---------- Draft ----------

function areaUnitFor(units: UnitSystem): Unit {
  return units === 'metric' ? 'sqm' : 'sqft';
}

function applyMeasure(line: Line, m: Measure, exclusions: Measure[]): void {
  if (m.type === 'count') {
    if (line.qtyType === 'each') line.qty = m.value;
    return;
  }
  if (line.qtyType === 'linear') {
    const len = measureIn(m, line.unit);
    if (len) line.qty = len;
    return;
  }
  if (line.qtyType !== 'area') return;
  const lineLen: LenUnit = line.unit === 'sqm' ? 'm' : 'ft';
  const parts: Part[] = [];
  if (m.type === 'rect' && m.aUnit === lineLen && m.bUnit === lineLen) {
    parts.push({ id: makeId('p'), shape: 'rect', a: m.a, b: m.b, subtract: false, label: '' });
  } else {
    const area = measureIn(m, line.unit);
    if (!area) return;
    const converted = m.type === 'rect' || m.areaUnit !== line.unit;
    if (!converted && exclusions.length === 0) {
      line.qty = area;
      return;
    }
    // Keep the customer's own size visible next to the converted number.
    parts.push({ id: makeId('p'), shape: 'value', a: area, b: '', subtract: false, label: converted ? describeMeasure(m) : '' });
  }
  for (const ex of exclusions) {
    const v = measureIn(ex, line.unit);
    if (v) parts.push({ id: makeId('p'), shape: 'value', a: v, b: '', subtract: true, label: `Left out: ${describeMeasure(ex)}` });
  }
  line.qtyMode = 'parts';
  line.parts = parts;
}

function rateFits(line: Line, family: RateFamily): boolean {
  if (line.qtyType === 'area') return family === 'area' || family === 'foot';
  if (line.qtyType === 'linear') return family === 'linear' || family === 'foot';
  if (line.qtyType === 'each') return family === 'each';
  if (line.qtyType === 'hours') return family === 'hour';
  return false;
}

function hasSize(line: Line): boolean {
  return line.qtyType === 'flat' || !!lineQuantity(line).qty;
}

/** Builds a draft from a parsed request. Customer-supplied values stay marked until the operator confirms them. */
export function draftFromRequest(parsed: ParsedRequest, settings: Settings): Draft {
  const draft = newDraft(settings, []);
  const qtySource: Source = parsed.mode === 'operator' ? 'operator' : 'customer';
  const lineIds: string[] = [];
  const extra: Question[] = [];
  for (const svc of parsed.services) {
    const line: Line = { ...newLine(svc.kind, settings, svc.name), qtySource };
    if (svc.negated) line.treatment = 'excluded';
    if (svc.measure) applyMeasure(line, svc.measure, svc.exclusions);
    // A service saved at a flat price keeps the operator's own size note as its detail.
    if (line.qtyType === 'flat' && svc.measure && parsed.mode === 'operator' && !line.detail) line.detail = describeMeasure(svc.measure);
    if (svc.rate) {
      const amount = Dec.parse(svc.rate.amount);
      if (amount && rateFits(line, svc.rate.family)) {
        const from = svc.rate.unit;
        const converted = from && from !== line.unit && (line.qtyType === 'area' || line.qtyType === 'linear') ? convertRate(amount, from, line.unit) : amount;
        line.rate = converted.toString();
        line.rateSource = 'entered';
      } else {
        extra.push({
          id: makeId('q'),
          kind: 'amount_meaning',
          prompt: `You noted $${number(amount, 4)} ${svc.rate.label}. What is it?`,
          evidence: svc.rate.evidence,
          lineIds: [line.id],
          resolved: false,
          answer: '',
          payload: { amount: svc.rate.amount, label: svc.rate.label, from: 'operator' },
        });
      }
    }
    if (svc.flatPrice) {
      const size = svc.measure ? describeMeasure(svc.measure) : '';
      line.qtyType = 'flat';
      line.unit = 'job';
      line.price = svc.flatPrice;
      line.detail = size;
    }
    draft.lines.push(line);
    lineIds.push(line.id);
  }
  draft.questions = parsed.questions.map((q) => {
    const ids = q.serviceIdx.map((i) => lineIds[i]).filter(Boolean);
    const payload: Question['payload'] = { ...q.payload };
    if (parsed.mode === 'operator') payload.from = 'operator';
    if (q.measure) {
      const target = draft.lines.find((l) => l.id === ids[0]);
      const unit: Unit = q.measure.type === 'count' ? 'each' : target?.qtyType === 'area' ? target.unit : areaUnitFor(settings.units);
      payload.area = measureIn(q.measure, unit) ?? '';
      payload.unit = unit;
    }
    return { id: makeId('q'), kind: q.kind, prompt: q.prompt, evidence: q.evidence, lineIds: ids, resolved: false, answer: '', payload };
  });
  draft.questions.push(...extra);
  // A size that does not fit how a service is priced (an area for a per-foot line) still needs a number.
  draft.lines.forEach((line, i) => {
    if (line.treatment === 'excluded' || hasSize(line)) return;
    if (draft.questions.some((q) => q.lineIds.includes(line.id) && (q.kind === 'missing_qty' || q.kind === 'combined_area' || q.kind === 'extra_measure'))) return;
    const svc = parsed.services[i];
    draft.questions.push({
      id: makeId('q'),
      kind: 'missing_qty',
      prompt:
        line.qtyType === 'each'
          ? `How many ${line.eachLabel || 'items'} for the ${line.name.toLowerCase()}?`
          : line.qtyType === 'linear'
            ? `How long is the ${line.name.toLowerCase()}?`
            : line.qtyType === 'hours'
              ? `How many hours for the ${line.name.toLowerCase()}?`
              : `How big is the ${line.name.toLowerCase()}?`,
      evidence: svc?.evidence ?? '',
      lineIds: [line.id],
      resolved: false,
      answer: '',
      payload: {},
    });
  });
  const c = parsed.customer;
  draft.customer = { name: c.name, phone: c.phone, email: c.email, address: c.address, source: parsed.mode === 'operator' ? 'operator' : 'customer' };
  if (parsed.budget) draft.budget = { state: 'known_value', amount: parsed.budget.amount, source: 'customer', evidence: parsed.budget.evidence };
  return draft;
}
