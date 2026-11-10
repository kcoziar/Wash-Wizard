import { Dec } from './decimal';
import { carSizeKey, sizeKeyLabel } from './sizes';
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
  /** Where the fence or gutters this length belongs to starts ("150 ft of 6 ft privacy fence"). */
  ownerAt?: number;
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
  /** Operator notes only: "10% off", "minimum 150", "trip fee 25". */
  adjust: { discountPercent: string; minimum: string; trip: string };
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
/**
 * Spanish basics, read as their English equivalents so every rule below applies unchanged. The
 * customer's own words are kept for evidence through the same position mapping as number words.
 */
const SPANISH: [RegExp, string][] = [
  [/^pies\s+cuadrados$/i, 'sq ft'],
  [/^metros\s+cuadrados$/i, 'sq m'],
  [/^pies$/i, 'feet'],
  [/^metros$/i, 'meters'],
  [/^entradas?(?:\s+de\s+(?:carros?|coches?|autos?))?$/i, 'driveway'],
  [/^(?:banquetas?|aceras?|veredas?)$/i, 'sidewalk'],
  [/^(?:escalones|escal[oó]n|escaleras?|gradas)$/i, 'steps'],
  [/^(?:techos?)$/i, 'roof'],
  [/^(?:cercas?)$/i, 'fence'],
  [/^(?:canaletas?)$/i, 'gutters'],
  [/^(?:muchas\s+)?gracias$/i, 'thanks'],
  [/^por$/i, 'by'],
];
const SPANISH_RUN = /\b(?:pies\s+cuadrados|metros\s+cuadrados|pies|metros|entradas?(?:\s+de\s+(?:carros?|coches?|autos?))?|banquetas?|aceras?|veredas?|escalones|escal[oó]n|escaleras?|gradas|techos?|cercas?|canaletas?|(?:muchas\s+)?gracias|(?<=\d\s{0,2})por(?=\s{0,2}\d))(?![\p{L}])/giu;
const WORD_RUN = new RegExp(`${NUM_RUN.source}|${SPANISH_RUN.source}`, 'giu');

function convertWord(run: string): string {
  for (const [re, en] of SPANISH) if (re.test(run.replace(/\s+/g, ' '))) return en;
  return convertRun(run);
}

class RequestText {
  readonly orig: string;
  readonly text: string;
  private shifts: Shift[];

  constructor(raw: string) {
    this.orig = raw;
    const shifts: Shift[] = [];
    let text = '';
    let last = 0;
    WORD_RUN.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WORD_RUN.exec(raw))) {
      const digits = convertWord(m[0]);
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
  'monday tuesday wednesday thursday friday saturday sunday january february march april july august september october november december tomorrow today tonight weekend morning afternoon evening sir madam maam customer client hoping looking wondering just not interested available free home here thinking also please thanks thank hi hello hey the we our my can could would will at from and in on for to with driveway driveways patio patios walkway walkways sidewalk path steps stairs stoop deck pool front back side concrete asphalt brick stone pavers cement flat total about around approx maybe i so ok okay yes no sure great good sorry glad happy new call text email phone cell mobile address'.split(' '),
);

function ci(word: string): string {
  return word.replace(/[a-z]/g, (ch) => `[${ch.toUpperCase()}${ch}]`);
}
const SUFFIXES = 'street st avenue ave road rd drive dr lane ln court ct boulevard blvd way place pl circle cir terrace ter parkway pkwy highway hwy trail trl loop run crescent cres close alley pike point pt crossing xing ridge row path walk trace cove bend glen grove heights hollow commons square sq'.split(' ');
/** Sign-off words that only looked like a city after an address (", Thanks"). */
const CITY_STOP = new Set('thanks thank thx regards cheers best sincerely please hi hello hey call text email phone cell mobile let looking hoping'.split(' '));
const SUFFIX_CI = `(?:${SUFFIXES.map(ci).join('|')})`;
const SUFFIX_I = `(?:${SUFFIXES.join('|')})`;
const DIR = '(?:[NSEW]|NE|NW|SE|SW|North|South|East|West)\\.?';
const TAIL =
  "(?:\\s*,?\\s*(?:[Aa]pt|[Aa]partment|[Uu]nit|[Ss]uite|[Ss]te|#)\\.?\\s*[\\w-]+)?(?:\\s*,\\s*[A-Z][A-Za-z.'-]*(?:\\s+[A-Z][A-Za-z.'-]*){0,2})?(?:\\s*,\\s*[A-Z]{2}\\b)?(?:,?\\s+\\d{5}(?:-\\d{4})?\\b)?";
const ADDRESS_CAP = new RegExp(`\\b\\d{1,6}[A-Za-z]?\\s+(?:${DIR}\\s+)?(?:(?:[A-Z][A-Za-z'.-]*|\\d+(?:st|nd|rd|th))\\s+){1,4}?${SUFFIX_CI}\\b(?:\\s+${SUFFIX_CI}\\b)?\\.?${TAIL}`, 'g');
const ADDRESS_LOWER = new RegExp(`\\b\\d{1,6}\\s+(?:[a-z][a-z'.-]*\\s+){1,3}?${SUFFIX_I}\\b(?:\\s+${SUFFIX_I}\\b)?\\.?${TAIL}`, 'gi');
const ADDRESS_CUE = /\b(?:at|address(?:\s+is)?|located\s+at|live\s+at|lives\s+at|house\s+(?:is\s+)?at|home\s+(?:is\s+)?at|property\s+(?:is\s+)?at|on)\s*:?\s*$/i;
const ADDRESS_STOP = /\b(?:ft|feet|foot|sq|square|steps?|stairs?|x|by|minutes?|hours?|about|around|maybe|and|or|the|of|wide|long|total|driveway|patio|walkway|sidewalk|path|deck|fence|roof|gutters?|siding)\b/i;

/** Trims a trailing ", Thanks" that only looked like a city, then trailing punctuation. */
function addressSpan(m: RegExpExecArray): Span {
  let s = m[0];
  const city = s.match(/,\s*([A-Z][A-Za-z.'-]*)/);
  if (city?.index != null && CITY_STOP.has(city[1].toLowerCase())) s = s.slice(0, city.index);
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

/** "Mr. Robert Johnson" is Robert Johnson; a title alone is never a name. */
const TITLE = '(?:(?:Mr|Mrs|Ms|Miss|Mx|Dr)\\.?\\s+)?';
/** One name word: capitalised, with accents, apostrophes and inner capitals ("José", "McDonald", "O'Neil", "Mary-Jane"). */
const NAME_WORD = "[A-Z\\u00C0-\\u00DE][a-z\\u00DF-\\u00FF']+(?:-?[A-Z\\u00C0-\\u00DE][a-z\\u00DF-\\u00FF']+)*";

function cleanName(raw: string | undefined): string {
  if (!raw) return '';
  const words = raw.trim().split(/\s+/).filter((w) => !/^(?:mr|mrs|ms|miss|mx|dr)\.?$/i.test(w));
  if (!words[0] || NAME_STOP.has(words[0].toLowerCase())) return '';
  if (words[1] && NAME_STOP.has(words[1].toLowerCase())) return words[0];
  return words.slice(0, 2).join(' ');
}

function findName(text: string): string {
  const NAME = `${TITLE}(${NAME_WORD}(?:[ \\t]+${NAME_WORD})?)`;
  const patterns = [
    new RegExp(`(?:^|\\n)[ \\t]*(?:[Nn]ame|[Ff]rom|[Cc]ustomer|[Cc]lient|[Cc]ontact)[ \\t]*:[ \\t]*${NAME}`),
    new RegExp(`\\b(?:[Mm]y name is|[Tt]his is|I am|I'm|[Ii]t's|[Ii]t is)\\s+${NAME}`),
    // "hey its Mike," typed without the apostrophe; only before a comma or the end of a clause.
    new RegExp(`\\b(?:[Hh]ey|[Hh]i|[Hh]ello)[,!]?\\s+(?:it'?s|its|this\\s+is)\\s+${NAME}(?=\\s*(?:[,.!\\n-]|$|here\\b))`),
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

const LOC_ADJ = 'front|back|rear|side(?!\\s?walk)|upper|lower|top|bottom|north|south|east|west|left|right|main|second|other|entry|entrance|garden|pool|city|public|guest';
const STAIR_PLACE = 'patio|deck|garage|basement|driveway|porch';
const MATERIAL = 'concrete|asphalt|pavers?|brick|stone|flagstone|cement|tile|stamped|aggregate|gravel';

const AFTER_WASH = '(?<=\\b(?:wash|washed|washing|clean|cleaned|cleaning|rinse|rinsed)\\s+(?:off\\s+|down\\s+)?(?:the\\s+|our\\s+|my\\s+)?)';
const OTHER_SURFACE = '(?:the\\s+|our\\s+|my\\s+)?(?:roofs?|decks?|fenc|gutters?|patios?|drive\\s?ways?|walk\\s?ways?|siding)';

/** Order matters: an earlier kind claims the words first ("deck stairs" are stairs, a "pool deck" is a patio). */
const KIND_NOUNS: { kind: RatedKind; nouns: string; place: string; material?: string }[] = [
  { kind: 'stairs', nouns: 'stair\\s?ways?|stair\\s?cases?|stairs?|steps?|stoops?', place: `${LOC_ADJ}|${STAIR_PLACE}` },
  // Common typing slips ("drivway", "driveay") still name the driveway.
  { kind: 'driveway', nouns: "drive\\s?ways?|driv(?:e?wa|ea|ew)ys?|drivways?|driveway's", place: LOC_ADJ },
  { kind: 'patio', nouns: 'pool\\s+decks?|pool\\s+areas?|patios?|courtyards?|terraces?|lanais?|porch(?:es)?|garage\\s+floors?|pavers', place: LOC_ADJ },
  { kind: 'walkway', nouns: 'walk\\s?ways?|side\\s?walks?|sidwalks?|walk\\s?paths?|path\\s?ways?|paths?|walks?', place: LOC_ADJ },
  {
    kind: 'house',
    // "soft wash the roof" is a way of cleaning the roof, not a house wash.
    nouns: `house\\s?wash(?:ing|es)?|soft\\s?wash(?:ing)?(?!\\s+${OTHER_SURFACE})|siding|(?:house|home)\\s+exterior|exterior\\s+of\\s+(?:the|our|my)\\s+(?:house|home)|${AFTER_WASH}(?:house|home)`,
    place: LOC_ADJ,
    material: 'vinyl|stucco|brick|wood|hardie|fiber\\s?cement|aluminum|cedar',
  },
  { kind: 'roof', nouns: 'roofs?|roof\\s?tops?', place: LOC_ADJ, material: 'shingle|asphalt|tile|metal|clay|slate|cedar|shake' },
  { kind: 'deck', nouns: 'decks?', place: LOC_ADJ, material: 'wood(?:en)?|composite|trex|cedar|redwood|pressure[-\\s]treated' },
  { kind: 'fence', nouns: 'fence\\s?lines?|fenc(?:e|es|ing)', place: LOC_ADJ, material: 'wood(?:en)?|vinyl|cedar|privacy|picket|chain[-\\s]?link|metal|aluminum|composite|wrought\\s+iron' },
  { kind: 'gutters', nouns: 'gutters?', place: LOC_ADJ, material: 'aluminum|metal|vinyl|copper|seamless' },
];

/** Services measured along their length. */
const LINEAR_KINDS: RatedKind[] = ['fence', 'gutters'];
/** A home's floor area, its siding and its roof are different sizes, so an area given loosely is asked about. */
const HOME_KINDS: RatedKind[] = ['house', 'roof'];

function nounGroup(kind: RatedKind, noun: string): string {
  const n = noun.toLowerCase().replace(/\s+/g, '');
  if (kind === 'walkway') return /^sidewalk/.test(n) ? 'sidewalk' : 'walkway';
  if (kind === 'patio') {
    // A porch, a garage floor and loose pavers are their own surfaces, not a second patio.
    const own = n.match(/^(pool|porch|garage|pavers)/)?.[1];
    return own ? (own === 'pool' ? 'pooldeck' : own) : 'patio';
  }
  // "house wash" and "siding" in one message are one service.
  return kind;
}

const NEG_BEFORE =
  /\b(?:(?:do\s+not|don'?t|no\s+need\s+to|not|never|won'?t\s+need\s+to)\s+(?:need\s+(?:to\s+)?|want\s+(?:you\s+)?(?:to\s+)?|have\s+to\s+)?(?:(?:pressure|power)\s+)?(?:wash|clean|do|touch|include|worry\s+about|bother\s+with)?\s*|(?:skip|skipping|except(?:\s+for)?|excluding|exclude|without|minus|other\s+than|but\s+not|not\s+including|leave\s+out|leaving\s+out|leave\s+off|no)\s+)(?:the\s+|our\s+|my\s+|that\s+|any\s+)?$/i;
const NEG_AFTER = /^\s*(?:(?:is|are)\s+(?:fine|ok|okay|good|already\s+(?:clean|done)|not\s+needed|done\s+already)\b|(?:does(?:\s+not|n'?t)|do(?:\s+not|n'?t))\s+need\b|can\s+be\s+skipped\b)/i;
const PHANTOM_BEFORE = /\b(?:next|first|few|following|these|those|what|any|further|baby|simple|easy|small|take|taking|took|same|several|couple|more|extra|additional|necessary|proper)\s+$/i;

function findMentions(text: string, blocked: Span[]): Mention[] {
  const out: Mention[] = [];
  for (const { kind, nouns, place, material: mat } of KIND_NOUNS) {
    const re = new RegExp(`\\b(?:(${LOC_ADJ})\\s+(?:and|&|or|\\/)\\s+)?(?:(${place})\\s+)?(?:(${mat ?? MATERIAL})\\s+)?(${nouns})\\b`, 'gi');
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
        // "steps to book", "what steps are needed": the process, not a staircase.
        if (/^\s+(?:to|for)\s+(?:book|schedul|get\s+(?:started|on)|take|follow|start|proceed|move\s+forward|confirm|hire|sign|set\s+up)/i.test(text.slice(end))) continue;
        if (/^\s+(?:are\s+|is\s+)?(?:needed|required|involved)\b/i.test(text.slice(end))) continue;
      }
      // "steps up to the porch": the porch says where the steps are, it is not a surface to price.
      if (kind === 'patio' && /^porch/i.test(noun) && !second && /\b(?:stairs?|steps?|stoops?)\s+(?:(?:going|leading)\s+)?(?:up\s+)?(?:to|onto|into)\s+(?:the\s+|our\s+|my\s+)?(?:front\s+|back\s+)?$/i.test(text.slice(Math.max(0, index - 40), index))) continue;
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
  let t = m.label.trim().replace(/\s+/g, ' ');
  // "wash the house" names the service, not a surface called "House".
  if (m.kind === 'house' && /(?:^|\s)(?:house|home)$/i.test(t) && !m.qualifier) return SERVICE_META.house.name;
  if (m.kind === 'house' && /wash(?:ing|es)?$/i.test(t)) return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase().replace(/(?:ing|es)$/, '');
  if (m.kind === 'driveway') t = t.replace(/driv[\w']*(?:\s+way'?s?)?$/i, (w) => (/s$/i.test(w) && !/'s$/.test(w) ? 'driveways' : 'driveway'));
  const name = m.kind === 'stairs' || m.kind === 'gutters' || /pavers$/i.test(t) ? t : t.replace(/(?<=porch)es$|s$/i, '');
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

/** "1,400 sq ft total" or "both are about 600": only words next to the size make it a combined area, not "total cost?" elsewhere. */
function combinedNear(text: string, m: Span, s: number, e: number): boolean {
  return COMBINED.test(text.slice(Math.max(s, m.index - 30), m.index)) || /^\s*(?:sq\.?\s*ft\.?\s*|square\s+feet\s*)?(?:in\s+)?(?:total|combined|together|altogether|in\s+all|all\s+in|for\s+both|between\s+them)\b/i.test(text.slice(m.end, e));
}

const lenUnit = (u: string | undefined, fallback: LenUnit): LenUnit => (!u ? fallback : /^m/i.test(u) ? 'm' : 'ft');

function findMeasures(text: string, units: UnitSystem, blocked: Span[]): Measure[] {
  const out: Measure[] = [];
  const dflt: LenUnit = units === 'metric' ? 'm' : 'ft';
  const base = { a: '', b: '', aUnit: dflt, bUnit: dflt, longSide: null, value: '', areaUnit: (units === 'metric' ? 'sqm' : 'sqft') as AreaUnit };
  const push = (m: Omit<Measure, 'approximate' | 'combinedHint' | 'exclusion'>) => {
    if (out.some((o) => overlaps(o, m)) || blocked.some((b) => overlaps(b, m))) return;
    const [s, e] = sentenceBounds(text, m.index);
    const before = text.slice(Math.max(s, m.index - 24), m.index);
    out.push({ ...m, approximate: APPROX.test(before), combinedHint: combinedNear(text, m, s, e), exclusion: EXCLUDE_CUE.test(text.slice(s, m.index)) });
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
  // "front steps, 6 of them"
  const ofThem = /\b(?:stairs|steps|stoops?)\s*[,:-]?\s*(?:there\s+are\s+|about\s+|around\s+)?(\d+)\s+of\s+(?:them|those)\b/gi;
  while ((m = ofThem.exec(text))) {
    push({ ...base, type: 'count', value: m[1], index: m.index, end: m.index + m[0].length, text: m[0] });
  }
  const flight = /flights?\s+of\s+(\d+)\s*(?:stairs|steps)?/gi;
  while ((m = flight.exec(text))) {
    push({ ...base, type: 'count', value: m[1], index: m.index, end: m.index + m[0].length, text: m[0] });
  }
  return out.sort((a, b) => a.index - b.index);
}

/**
 * "150 ft of fence", "gutters are about 180 feet": a plain length is read only next to a fence or
 * gutters, and never when it describes height ("6 ft privacy fence", "6 ft tall").
 */
function findRuns(text: string, units: UnitSystem, mentions: Mention[], blocked: Span[]): Measure[] {
  const dflt: LenUnit = units === 'metric' ? 'm' : 'ft';
  const runs = mentions.filter((x) => LINEAR_KINDS.includes(x.kind));
  if (!runs.length) return [];
  const out: Measure[] = [];
  const re = new RegExp(`${AREA_NUM}\\s*(ft\\.?|feet|foot|m\\b|meters?|metres?)(?!\\s*(?:x|\\u00D7|by|\\*|long|wide|deep|tall|high|sq|square|\\d))`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const index = m.index;
    const end = index + m[0].length;
    if (blocked.some((b) => overlaps(b, { index, end }))) continue;
    const [s, e] = sentenceBounds(text, index);
    const after = text.slice(end, e);
    const of = /^\s+of\b/i.test(after);
    const tail = runs.find((x) => x.index >= end && x.end <= e && x.index - end <= 40);
    const head = runs.filter((x) => x.end <= index && x.index >= s && index - x.end <= 40).pop();
    if (!(of && tail) && !head) continue;
    const owner = of && tail ? tail : (head as Mention);
    const value = m[1].replace(/,/g, '');
    const aUnit = lenUnit(m[2], dflt);
    out.push({ type: 'length', a: value, b: '', aUnit, bUnit: aUnit, longSide: 'a', value: '', areaUnit: units === 'metric' ? 'sqm' : 'sqft', index, end, text: m[0], approximate: APPROX.test(text.slice(Math.max(s, index - 24), index)), combinedHint: combinedNear(text, { index, end }, s, e), exclusion: EXCLUDE_CUE.test(text.slice(s, index)), ownerAt: owner.index });
  }
  return out;
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
  /^\s*(?:\/\s*|per\s+|an?\s+|each\b)\s*(sq(?:uare)?\.?\s*(?:ft|feet|foot)\.?|sq\.?\s*m\b|sqm\b|square\s+met(?:er|re)s?|m2|m\u00B2|ft2|linear\s+(?:ft|foot|feet)|lf\b|foot|feet|ft\b|steps?\b|stairs?\b|hours?\b|hr\b|met(?:er|re)s?\b|m\b|sf\b|sq\b\.?|square\b)?/i;
const FLAT_AFTER = /^\s*(?:dollars?|bucks)?\s*(?:flat(?:\s+(?:rate|price|fee))?|for\s+(?:the\s+)?(?:whole\s+)?(?:job|thing|lot|it|all))\b/i;
const FLAT_BEFORE = /\b(?:flat(?:\s+(?:rate|price|fee))?|price[d]?(?:\s+(?:at|is))?|charge|charging|quote[d]?(?:\s+(?:at|is))?)\s*(?:of|is|at|:)?\s*\$?\s*$/i;

interface MoneyToken extends Span {
  amount: string;
  per: { family: RateFamily; unit: Unit | null; label: string } | null;
  flat: boolean;
  dollar: boolean;
  /** Written as cents ("22 cents"). */
  cents: boolean;
}

function perUnit(tail: string): MoneyToken['per'] {
  const m = tail.match(PER_UNIT);
  if (!m) return null;
  const u = (m[1] ?? '').toLowerCase().replace(/\s+/g, ' ');
  if (!u) return /^\s*each\b/i.test(tail) ? { family: 'each', unit: 'each', label: 'each' } : null;
  if (/^sq(?:uare)?\.?\s*(?:ft|feet|foot)|^ft2|^sf$|^sq\.?$|^square$/.test(u)) return { family: 'area', unit: 'sqft', label: 'per sq ft' };
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
  const add = (index: number, end: number, amount: string, dollar: boolean, cents = false, flatCue = false) => {
    const span = { index, end };
    if (out.some((o) => overlaps(o, span)) || blocked.some((b) => overlaps(b, span))) return;
    const tail = text.slice(end, end + 30);
    out.push({ index, end, amount, dollar, cents, per: perUnit(tail), flat: flatCue || FLAT_AFTER.test(tail) || FLAT_BEFORE.test(text.slice(Math.max(0, index - 30), index)) });
  };
  const money = /\$\s?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)|\b((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(?:dollars|bucks)\b|\b(\d+)\s*cents?\b/gi;
  let m: RegExpExecArray | null;
  while ((m = money.exec(text))) {
    const amount = m[3] ? Dec.raw(BigInt(m[3]), 2).toString() : (m[1] ?? m[2]).replace(/,/g, '');
    add(m.index, m.index + m[0].length, amount, true, !!m[3]);
  }
  if (mode === 'operator') {
    // Bare numbers in the operator's own notes: "250 flat", "flat 250", ".15 a foot".
    const bare = /(?:^|[^\d.,$])((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)(?!\d|[.,]\d)/g;
    while ((m = bare.exec(text))) {
      const index = m.index + m[0].length - m[1].length;
      const end = index + m[1].length;
      const tail = text.slice(end, end + 30);
      const lead = text.slice(Math.max(0, index - 12), index);
      const forJob = /\bfor\s*$/i.test(lead);
      const flat = forJob || FLAT_AFTER.test(tail) || FLAT_BEFORE.test(text.slice(Math.max(0, index - 30), index));
      const per = perUnit(tail);
      // "at .22", "@ 3 each", or a price written last ("driveway 20x40 250").
      const cue = /(?:\bat|@)\s*$/i.test(lead) || /^\s*(?:$|[,;\n]|\.(?:\s|$))/.test(tail);
      if (!flat && !cue && !(per && per.family !== 'each' && /^\s*(?:\/|per\b|an?\b)/i.test(tail))) continue;
      add(index, end, m[1].replace(/,/g, ''), cue && !flat, false, forJob);
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

/** Words that say a size is the home's floor area or a roof footprint, not a cleanable surface. */
const FOOTPRINT = /\b(?:footprint|pitch|floor\s*(?:area|space|plan)|living\s*(?:area|space)|heated|under\s+roof|\d{1,2}\s*\/\s*12)\b/i;
const FOREIGN_WORDS = "house|home|story|storey|stories|ranch|split[-\\s]level|colonial|bungalow|condo|townhouse|building|property|lot|yard|lawn|barn|shop|garage(?!\\s+floor)|parking\\s+lot|pad|slab|basement|attic|living\\s+(?:area|space)|footprint";
const FOREIGN_BEFORE = new RegExp(`\\b(?:${FOREIGN_WORDS})\\b[^,.;!?\\n]{0,4}(?:\\s+(?:is|are|was|of|about|around|roughly|approx(?:imately|\\.)?|maybe|probably|~|at|-|:))*\\s*$`, 'i');
const FOREIGN_AFTER = new RegExp(`^\\s*(?:\\w+\\s+){0,1}(?:${FOREIGN_WORDS})\\b`, 'i');

const SIDES = /\b(?:both|two|2|each|per)\s+sides?\b/i;
/** Marks the question about pricing the second side of a fence. */
export const SIDES_LABEL = 'both sides';

/** Below this, an amount with no unit is a rate, not the price of a line. */
const SMALL_PRICE = Dec.int(5);

// ---------- Main ----------

export function parseRequest(raw: string, opts: ParseOptions = {}): ParsedRequest {
  const units = opts.units ?? 'imperial';
  const mode = opts.mode ?? 'customer';
  const src = new RequestText(raw);
  const text = src.text;
  const contact = findContact(src);
  const mentions = findMentions(text, contact.spans);
  const measures = findMeasures(text, units, contact.spans);
  measures.push(...findRuns(text, units, mentions, [...contact.spans, ...measures]));
  measures.sort((a, b) => a.index - b.index);
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

  const isHome = (i: number) => HOME_KINDS.includes(services[i].kind as RatedKind);
  /** "roof is about 2,400 sq ft" or "3,000 sq ft of siding" says what the size is. Anything looser is asked. */
  const saysWhat = (m: Mention, meas: Measure) => {
    if (m.kind !== 'roof' && !/siding/i.test(m.label)) return false;
    // "Roof is 2000 sq ft footprint, 8/12 pitch": a footprint or floor area is not the surface to clean.
    const [ss, se] = sentenceBounds(text, meas.index);
    if (FOOTPRINT.test(text.slice(ss, se))) return false;
    if (m.end <= meas.index) return /^\s*(?:is|are|=|:|-)?\s*(?:about|around|roughly|approx(?:imately|\.)?|maybe|probably|~)?\s*$/i.test(text.slice(m.end, meas.index));
    return /^\s*(?:of\s+)?(?:the\s+|our\s+|my\s+)?$/i.test(text.slice(meas.end, m.index));
  };
  /** An area that could be the home, the siding or the roof: the operator says which, it is never assigned to both. */
  const askWhat = (meas: Measure, idxs: number[]) => {
    const [s, e] = sentenceBounds(text, meas.index);
    const near = mentions.filter((x) => x.index >= s && x.end <= e && !x.negated && x.kind !== 'stairs' && !LINEAR_KINDS.includes(x.kind)).map((x) => surfaceOf.get(x) as number);
    const pool = near.some(isHome) ? near : services.map((_, i) => i).filter((i) => isHome(i) && !services[i].negated);
    const options = Array.from(new Set([...idxs, ...pool])).filter((i) => !services[i].negated && !services[i].measure);
    questions.push({
      kind: 'size_meaning',
      prompt: `What does ${describeMeasure(meas)} describe?`,
      evidence: snippet(src, meas.index, meas.end),
      serviceIdx: options.sort((a, b) => a - b),
      payload: { label: describeMeasure(meas) },
      measure: meas,
    });
  };
  /** Attach, unless it is a loose area for a house wash or roof. */
  const place = (idx: number, meas: Measure, by?: Mention) => {
    if (isHome(idx) && !meas.exclusion && (meas.type === 'area' || meas.type === 'rect') && !(by && saysWhat(by, meas))) askWhat(meas, [idx]);
    else attach(idx, meas);
  };

  /** A size written next to a word for something that is not a surface on this quote ("house is 2400 sq ft"). */
  const foreignNear = (meas: Measure) => {
    const [ss] = sentenceBounds(text, meas.index);
    const before = text.slice(Math.max(ss, meas.index - 28), meas.index);
    const after = text.slice(meas.end, meas.end + 24);
    return FOREIGN_BEFORE.test(before) || FOREIGN_AFTER.test(after);
  };
  /** The size sits right against this surface word ("driveway is about 600", "600 sq ft driveway"). */
  const tight = (m: Mention, meas: Measure) =>
    m.end <= meas.index
      ? /^\s*(?:[:=-]|is|are|was|measures?|about|around|roughly|approx(?:imately|\.)?|maybe|probably|~|\s)*$/i.test(text.slice(m.end, meas.index))
      : ADJ_GAP.test(text.slice(meas.end, m.index)) && m.index - meas.end <= 20;
  const homeInSentence = (meas: Measure) => {
    const [ss, se] = sentenceBounds(text, meas.index);
    return mentions.some((x) => x.index >= ss && x.end <= se && !x.negated && HOME_KINDS.includes(x.kind));
  };
  const areaLike = (meas: Measure) => !meas.exclusion && (meas.type === 'area' || meas.type === 'rect');

  const NO_JOIN = /\band\b|&|\+|\bplus\b|\balso\b|\bwith\b/i;
  // "two walkways, one 3x30 and one 4x25": the second size after a first one is another surface of the same kind.
  // The text is normalised first, so "one" arrives as "1".
  const NEXT_ONE = /^\s*[,;]?\s*(?:and|&|plus)?\s*(?:(?:(?:the\s+)?other|another|(?:a|the)\s+second|second|2nd)(?:\s+(?:one|1))?|one|1)?\s*(?:is|at|about|around|roughly|maybe)?\s*$/i;
  const NEXT_WORD = /\b(?:one|1|other|another|second|2nd)\b/i;
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
    const runOwner = meas.ownerAt != null ? mentions.find((x) => x.index === meas.ownerAt) : undefined;
    if (runOwner) {
      attach(surfaceOf.get(runOwner) as number, meas);
      continue;
    }
    const before = areaMentions.filter((x) => x.end <= meas.index && x.index >= s).pop();
    const after = areaMentions.find((x) => x.index >= meas.end && x.end <= e);
    if (areaLike(meas)) {
      const tightTo = after && tight(after, meas) ? after : before && tight(before, meas) ? before : null;
      // "house is 2400 sq ft" with a driveway on the quote, or "house and driveway, about 2400 sq ft":
      // the operator says what the size is; it never lands on the driveway by position alone.
      if ((!tightTo && foreignNear(meas)) || (homeInSentence(meas) && !(tightTo && (HOME_KINDS.includes(tightTo.kind) ? saysWhat(tightTo, meas) : !foreignNear(meas))))) {
        const near = areaMentions.filter((x) => x.index >= s && x.end <= e && !x.negated).map((x) => surfaceOf.get(x) as number);
        const pool = near.length ? near : services.map((_, i) => i).filter((i) => services[i].kind !== 'stairs' && !LINEAR_KINDS.includes(services[i].kind as RatedKind));
        askWhat(meas, pool);
        continue;
      }
    }
    if (!meas.combinedHint) {
      const beforeOk = !!before && meas.index - before.end <= 30 && !NO_JOIN.test(text.slice(before.end, meas.index));
      const afterOk = !!after && after.index - meas.end <= 20 && ADJ_GAP.test(text.slice(meas.end, after.index));
      // "20x40 driveway, 10x10 patio": a size written just before a surface word belongs to it,
      // unless it plainly continues the surface before it ("the driveway is about 600").
      const beforeLoose = !!before && (/[,;]/.test(text.slice(before.end, meas.index)) || !!services[surfaceOf.get(before) as number].measure);
      if (after && afterOk && (!beforeOk || beforeLoose || ARTICLE.test(text.slice(s, meas.index)))) {
        place(surfaceOf.get(after) as number, meas, after);
        continue;
      }
      if (before && beforeOk) {
        place(surfaceOf.get(before) as number, meas, before);
        continue;
      }
    }
    const prev = measures.filter((x) => x.end <= meas.index && x.index >= s && !x.exclusion && x.type !== 'count').pop();
    const owner = prev ? services.findIndex((x) => x.measure === prev) : -1;
    if (prev && owner >= 0 && !meas.exclusion && meas.type === prev.type) {
      const gap = text.slice(prev.end, meas.index);
      const plural = mentions.some((x) => surfaceOf.get(x) === owner && /s$/i.test(x.label) && x.kind !== 'stairs' && x.kind !== 'gutters');
      if (NEXT_ONE.test(gap) && (NEXT_WORD.test(gap) || plural)) {
        const base = services[owner];
        services.push({ ...base, name: `${base.name} 2`, evidence: snippet(src, meas.index, meas.end), measure: meas, exclusions: [], flatPrice: null, rate: null, negated: false });
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
      place(idxs[0], meas);
      continue;
    }
    if (!meas.exclusion && meas.type !== 'length' && idxs.some(isHome)) {
      askWhat(meas, idxs);
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

  // Operator notes: "10% off", "minimum 150", "trip fee 25" set the quote's own adjustments.
  const adjust: ParsedRequest['adjust'] = { discountPercent: '', minimum: '', trip: '' };
  const adjustSpans: Span[] = [];
  if (mode === 'operator') {
    const grab = (re: RegExp, key: keyof ParsedRequest['adjust']) => {
      const m = text.match(re);
      if (!m || m.index == null) return;
      const v = Dec.parse((m[1] ?? m[2] ?? '').replace(/,/g, ''));
      if (!v || v.sign() <= 0 || (key === 'discountPercent' && v.cmp(Dec.int(100)) >= 0)) return;
      adjust[key] = v.toString();
      adjustSpans.push({ index: m.index, end: m.index + m[0].length });
    };
    grab(/\b(\d+(?:\.\d+)?)\s*%\s*(?:off|discount)\b|\bdiscount\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*%/i, 'discountPercent');
    grab(/\b(?:min(?:imum)?(?:\s+(?:charge|price|job))?)\s*(?:is|of|:|=)?\s*\$?\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)/i, 'minimum');
    grab(/\b(?:trip|travel)(?:\s+(?:fee|charge))?\s*(?:is|of|:|=)?\s*\$?\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)/i, 'trip');
  }

  // Money: a budget is never a price. Prices come only from the operator's own notes.
  let budget: ParsedRequest['budget'] = null;
  const usedSpans = [...contact.spans, ...measures, ...adjustSpans];
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
      // "driveway 1200 sf 22 cents": cents, or a few dollars, next to a surface is its rate, never the price of the whole line.
      if (!tok.per && !tok.flat && (tok.cents || (Dec.parse(tok.amount)?.cmp(SMALL_PRICE) ?? 1) < 0)) {
        const t = targetSurface(tok, 'any', s, e);
        if (t >= 0 && units === 'imperial' && !services[t].rate) {
          const stairs = services[t].kind === 'stairs';
          services[t].rate = stairs
            ? { amount: tok.amount, family: 'each', unit: 'each', label: 'per step', evidence }
            : { amount: tok.amount, family: 'foot', unit: null, label: LINEAR_KINDS.includes(services[t].kind as RatedKind) ? 'per foot' : 'per sq ft', evidence };
          continue;
        }
        ask();
        continue;
      }
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

  const others = new Set<string>();
  const mentionOther = (label: string, index: number, end: number) => {
    if (others.has(label.toLowerCase())) return;
    others.add(label.toLowerCase());
    questions.push({ kind: 'other_service', prompt: `The request also mentions: ${label.toLowerCase()}.`, evidence: snippet(src, index, end), serviceIdx: [], payload: { label } });
  };
  for (const o of OTHER_SERVICES) {
    const m = text.match(o.re);
    if (m && m.index != null && !contact.spans.some((b) => overlaps(b, { index: m.index as number, end: (m.index as number) + m[0].length }))) mentionOther(o.label, m.index, m.index + m[0].length);
  }
  // Nothing is dropped silently: "clean my shed" names something to price even when it is not a known surface.
  WASH_OBJECT.lastIndex = 0;
  let wm: RegExpExecArray | null;
  while ((wm = WASH_OBJECT.exec(text))) {
    const index = wm.index + wm[0].length - wm[1].length;
    const end = wm.index + wm[0].length;
    const word = wm[1].toLowerCase().replace(/\s+/g, ' ');
    if (WASH_SKIP.test(word.split(' ')[0])) continue;
    if (mentions.some((x) => overlaps(x, { index, end })) || contact.spans.some((b) => overlaps(b, { index, end }))) continue;
    if (OTHER_SERVICES.some((o) => o.re.test(word)) || CONDITIONS.some((c) => c.re.test(word))) continue;
    mentionOther(word.charAt(0).toUpperCase() + word.slice(1), index, end);
  }
  for (const c of CONDITIONS) {
    const m = text.match(c.re);
    if (m && m.index != null) {
      questions.push({ kind: 'condition', prompt: `${who === 'Your notes' ? 'Your notes mention' : 'The customer mentioned'} ${c.label.toLowerCase()}.`, evidence: snippet(src, m.index, m.index + m[0].length), serviceIdx: [], payload: { label: c.line } });
    }
  }

  // "both sides at $2 a foot per side": a fence length is one side. Whether the rate covers both is the operator's call.
  services.forEach((svc, i) => {
    if (svc.kind !== 'fence' || svc.negated || !svc.measure || svc.measure.type !== 'length') return;
    const m = svc.measure;
    const [ss, se] = sentenceBounds(text, m.index);
    const own = mentions.filter((x) => surfaceOf.get(x) === i).map((x) => sentenceBounds(text, x.index));
    const said = [[ss, se], ...own].some(([a, b]) => SIDES.test(text.slice(a, b)));
    if (!said) return;
    questions.push({
      kind: 'extra_measure',
      prompt: `${mode === 'operator' ? 'Your notes mention' : 'The customer asked for'} both sides of the ${lower(i)}. Is ${describeMeasure(m).replace(/ long$/, '')} one side?`,
      evidence: snippet(src, m.index, m.end),
      serviceIdx: [i],
      payload: { label: SIDES_LABEL },
      measure: m,
    });
  });

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
    const covered = questions.some((q) => (q.kind === 'combined_area' || q.kind === 'extra_measure' || q.kind === 'size_meaning') && q.serviceIdx.includes(i));
    if (!svc.measure && !covered && !svc.flatPrice) {
      // "2 car driveway": a size the operator can answer once and reuse.
      const sizeKey = svc.kind === 'driveway' ? carSizeKey(svc.evidence) : null;
      questions.push({
        kind: 'missing_qty',
        prompt: sizeKey
          ? `How big is your usual ${sizeKeyLabel(sizeKey)}?`
          : svc.kind === 'stairs'
            ? `How many steps for the ${lower(i)}?`
            : LINEAR_KINDS.includes(svc.kind as RatedKind)
              ? `How long is the ${lower(i)}?`
              : `How big is the ${lower(i)}?`,
        evidence: svc.evidence,
        serviceIdx: [i],
        payload: sizeKey ? { sizeKey } : {},
      });
    }
  });

  return { text: raw, mode, units, services, questions, customer: { name: contact.name, phone: contact.phone, email: contact.email, address: contact.address }, budget, adjust };
}

const OTHER_SERVICES: { label: string; re: RegExp }[] = [
  { label: 'Windows', re: /\bwindows?\b/i },
  { label: 'Curb', re: /\bcurb(?:s|ing)?\b/i },
  { label: 'Retaining wall', re: /\bretaining\s+walls?\b/i },
  { label: 'Shed', re: /\bsheds?\b/i },
  { label: 'Dock', re: /\b(?:boat\s+)?docks?\b/i },
  { label: 'Pergola', re: /\bpergolas?\b/i },
  { label: 'Gazebo', re: /\bgazebos?\b/i },
  { label: 'Outdoor furniture', re: /\b(?:patio|outdoor|lawn)\s+furniture\b/i },
  { label: 'Solar panels', re: /\bsolar\s+panels?\b/i },
  { label: 'Pool cage', re: /\b(?:pool|screen)\s+(?:cage|enclosure)s?\b/i },
  { label: 'Playset', re: /\b(?:playsets?|play\s+sets?|swing\s+sets?)\b/i },
];

/** "wash my X" / "clean off the X": X is something the operator should see, even if no surface word matched. */
const WASH_OBJECT =
  /\b(?:(?:pressure|power|soft)[\s-]?)?(?:wash|clean|rinse)(?:ed|ing)?\s+(?:off\s+|down\s+)?(?:the|my|our|a|an|his|her|their)\s+((?:[a-z]+\s+)?(?:wall|walls|floor|floors|lot|area|panels?|furniture|cage|enclosure|doors?|pad|slab|siding|bricks?|columns?|ramp|lift|tank)\b|[a-z]{3,}\b)/gi;
const WASH_SKIP = /^(?:whole|entire|rest|outside|inside|exterior|front|back|side|place|property|area|stuff|things?|everything|all|it|them|this|that|these|those|same|other|old|new|dirty|car|cars|truck|trucks|house|home|first|second|last|next|best|price|cost|job|work|quote|estimate)$/;

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
  const startsWithSurface = /^\s*(?:\d+\s+)?(?:front\s+|back\s+)?(?:drive\s?ways?|patios?|walk\s?ways?|side\s?walks?|steps|stairs|pool\s+deck|house\s?wash|roofs?|decks?|fence|gutters?)\b/i.test(t);
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
    if (!len) return;
    const left = exclusions.map((ex) => ({ ex, v: measureIn(ex, line.unit) })).filter((x): x is { ex: Measure; v: string } => !!x.v);
    if (left.length === 0) {
      line.qty = len;
      return;
    }
    // "150 ft excluding 20 ft": both stay visible and only the included length is priced.
    line.qtyMode = 'parts';
    line.parts = [
      { id: makeId('p'), shape: 'value', a: len, b: '', subtract: false, label: m.aUnit === (line.unit === 'm' ? 'm' : 'ft') ? '' : describeMeasure(m) },
      ...left.map(({ ex, v }) => ({ id: makeId('p'), shape: 'value' as const, a: v, b: '', subtract: true, label: `Left out: ${describeMeasure(ex)}` })),
    ];
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
        // "a foot" is per foot on a fence and per square foot on flatwork, whatever units the app is set to.
        const from: Unit | null = svc.rate.unit ?? (svc.rate.family === 'foot' ? (line.qtyType === 'linear' ? 'ft' : line.qtyType === 'area' ? 'sqft' : null) : null);
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
      const unit: Unit =
        q.measure.type === 'count' ? 'each' : target && (target.qtyType === 'area' || target.qtyType === 'linear') ? target.unit : q.measure.type === 'length' ? (settings.units === 'metric' ? 'm' : 'ft') : areaUnitFor(settings.units);
      payload.area = measureIn(q.measure, unit) ?? '';
      payload.unit = unit;
    }
    let prompt = q.prompt;
    const target = draft.lines.find((l) => l.id === ids[0]);
    if (q.kind === 'missing_qty' && payload.sizeKey) {
      // Only the operator's own saved size is offered, and only in the unit this line is priced in.
      const saved = settings.savedSizes?.[payload.sizeKey];
      if (!target || target.qtyType !== 'area') delete payload.sizeKey;
      else payload.unit = target.unit;
      if (target && payload.sizeKey && saved && saved.unit === target.unit) {
        payload.area = saved.qty;
        payload.unit = saved.unit;
        prompt = `Use your usual ${sizeKeyLabel(payload.sizeKey)} size?`;
      }
      if (!payload.sizeKey) prompt = `How big is the ${(target?.name ?? 'driveway').toLowerCase()}?`;
    }
    return { id: makeId('q'), kind: q.kind, prompt, evidence: q.evidence, lineIds: ids, resolved: false, answer: '', payload };
  });
  draft.questions.push(...extra);
  // A size that does not fit how a service is priced (an area for a per-foot line) still needs a number.
  draft.lines.forEach((line, i) => {
    if (line.treatment === 'excluded' || hasSize(line)) return;
    if (draft.questions.some((q) => q.lineIds.includes(line.id) && (q.kind === 'missing_qty' || q.kind === 'combined_area' || q.kind === 'extra_measure' || q.kind === 'size_meaning'))) return;
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
  const adj = parsed.adjust;
  if (adj?.discountPercent) draft.pricing.discount = { ...draft.pricing.discount, kind: 'percent', value: adj.discountPercent };
  if (adj?.minimum) draft.pricing.minimum = { state: 'known_value', amount: adj.minimum, source: 'operator' };
  if (adj?.trip) draft.pricing.trip = { ...draft.pricing.trip, state: 'known_value', amount: adj.trip, source: 'operator' };
  if (parsed.budget) draft.budget = { state: 'known_value', amount: parsed.budget.amount, source: 'customer', evidence: parsed.budget.evidence };
  return draft;
}
