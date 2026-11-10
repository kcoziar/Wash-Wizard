/**
 * Checks for the production-readiness work: number entry, unit and basis switches, first-run setup,
 * rate from time, similar work, recaps, suggestions, backup reminders and the worth-it verdict.
 * Run: pnpm --filter @workspace/pressure-quote run test:code
 */
import { Dec } from '../lib/decimal';
import { CORE_KINDS, RATED_KINDS, defaultSettings, newDraft, newLine, shownKinds } from '../lib/defaults';
import { EXAMPLE_MESSAGE, exampleDraft, isExampleJob } from '../lib/example';
import { reportError, track } from '../lib/analytics';
import { TELEMETRY_URL, connectTelemetry } from '../lib/telemetry';
import { computeEconomics, hourlyCostCents, knownHourlyCosts, rateFromTime, suggestWorkMinutes } from '../lib/economics';
import { rateInput, sanitizeDecimal } from '../lib/format';
import { convertParts, sizeFromDimensions, switchLineBasis, switchLineUnit, toFlatPrice } from '../lib/lineEdit';
import { applyAnswers, type SetupAnswers } from '../lib/onboarding';
import { computeQuote, lineAmount } from '../lib/pricing';
import { recapNumbers } from '../lib/recap';
import { backupDue, markBackup, quotesCreated } from '../lib/reminders';
import { duplicateDraft, linesFromLastQuote, pastCustomers, similarDraft } from '../lib/resolve';
import { defaultMeta, normalizeDraft, normalizeMeta, normalizeSettings } from '../lib/storage';
import { partsTotal } from '../lib/geometry';
import type { Draft, Job, Line, Outcome, Part } from '../lib/types';

function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) out[k] = canon((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}
const show = (v: unknown) => (typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(canon(v)) ?? String(v));
const assert = {
  equal(actual: unknown, expected: unknown, message?: string) {
    if (!Object.is(actual, expected)) throw new Error(message ?? `Expected ${show(expected)}, got ${show(actual)}`);
  },
  deepEqual(actual: unknown, expected: unknown, message?: string) {
    if (JSON.stringify(canon(actual)) !== JSON.stringify(canon(expected))) throw new Error(message ?? `Expected ${show(expected)}, got ${show(actual)}`);
  },
  ok(value: unknown, message?: string) {
    if (!value) throw new Error(message ?? `Expected a truthy value, got ${show(value)}`);
  },
};

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`${name}\n    ${(e as Error).message.split('\n').join('\n    ')}`);
  }
}

const settings = defaultSettings();
let seq = 0;
const part = (shape: Part['shape'], a: string, b: string, subtract = false): Part => ({ id: `p${++seq}`, shape, a, b, subtract, label: '' });
const area = (qty: string, rate: string, extra: Partial<Line> = {}): Line => ({ ...newLine('driveway', settings), qty, rate, rateSource: 'entered', ...extra });
const cents = (l: Line) => lineAmount(l).amount;

// ---------- Typed and pasted numbers ----------
test('Comma decimals keep their meaning; ambiguous or negative input is rejected, never rewritten', () => {
  assert.equal(sanitizeDecimal('0,20'), '0.20');
  assert.equal(sanitizeDecimal('12,5'), '12.5');
  assert.equal(sanitizeDecimal('1,'), '1.');
  assert.equal(sanitizeDecimal('1,400'), '1400');
  assert.equal(sanitizeDecimal('$1,400.50'), '1400.50');
  assert.equal(sanitizeDecimal('1.400,50'), '1400.50');
  assert.equal(sanitizeDecimal(' 250 '), '250');
  assert.equal(sanitizeDecimal('.5'), '0.5');
  assert.equal(sanitizeDecimal('007'), '7');
  assert.equal(sanitizeDecimal(''), '');
  assert.equal(sanitizeDecimal('-50'), null);
  assert.equal(sanitizeDecimal('24x36'), null);
  assert.equal(sanitizeDecimal('1.2.3'), null);
  assert.equal(sanitizeDecimal('1,2,3'), null);
  assert.equal(sanitizeDecimal('0.12345', 4), null);
  assert.equal(sanitizeDecimal('0.12345', 6), '0.12345');
  assert.equal(sanitizeDecimal('90.5', 0), null);
  assert.equal(sanitizeDecimal('1234567890123'), null);
});

// ---------- Unit switches ----------
test('1,400 sq ft at $0.18 stays $252.00 in square meters and returns exactly', () => {
  const line = area('1400', '0.18');
  assert.equal(cents(line), 25200);
  const metric = switchLineUnit(line, 'sqm');
  assert.equal(metric.unit, 'sqm');
  assert.equal(cents(metric), 25200, `converted to ${metric.qty} m2 at ${metric.rate}`);
  const back = switchLineUnit(metric, 'sqft');
  assert.equal(back.qty, '1400');
  assert.equal(back.rate, '0.18');
  assert.equal(back.unitOrigin, undefined);
  assert.equal(cents(back), 25200);
});
test('A size edited after a unit switch is converted, not replaced by the old one', () => {
  const metric = { ...switchLineUnit(area('1400', '0.18'), 'sqm'), qty: '100' };
  const back = switchLineUnit(metric, 'sqft');
  assert.equal(back.unit, 'sqft');
  assert.ok(back.qty !== '1400', back.qty);
  assert.equal(Math.round(Number(back.qty)), 1076);
});
test('Measured shapes convert by side and by area, and the price holds both ways', () => {
  const line = area('', '0.25', { qtyMode: 'parts', parts: [part('rect', '24', '36'), part('value', '100', '', true)] });
  assert.equal(partsTotal(line.parts).total?.toString(), '764');
  assert.equal(cents(line), 19100);
  const metric = switchLineUnit(line, 'sqm');
  assert.equal(metric.parts[0].a, '7.3152');
  assert.equal(metric.parts[0].b, '10.9728');
  assert.equal(metric.parts[1].a, '9.2903');
  assert.equal(cents(metric), 19100);
  const back = switchLineUnit(metric, 'sqft');
  assert.deepEqual(back.parts.map((p) => [p.a, p.b]), [['24', '36'], ['100', '']]);
  assert.equal(cents(back), 19100);
});
test('Lengths convert too: 100 linear ft at $1.50 stays $150.00 in meters', () => {
  const fence: Line = { ...newLine('custom', settings, 'Fence'), qtyType: 'linear', unit: 'ft', qty: '100', rate: '1.50' };
  const m = switchLineUnit(fence, 'm');
  assert.equal(m.qty, '30.48');
  assert.equal(cents(m), 15000);
  assert.equal(switchLineUnit(m, 'ft').qty, '100');
});
test('The area tool keeps the surface when its unit changes', () => {
  const ft = [part('rect', '20', '30'), part('triangle', '10', '12')];
  const m = convertParts(ft, 'sqft', 'sqm');
  const ftArea = partsTotal(ft).total?.toNumber() ?? 0;
  const mArea = partsTotal(m).total?.toNumber() ?? 0;
  assert.equal(ftArea, 660);
  assert.ok(Math.abs(mArea / 0.09290304 - 660) < 0.01, String(mArea));
});

test('A pasted "24x36" becomes a measured rectangle; anything else is left alone', () => {
  const l = area('', '0.25');
  for (const t of ['24x36', '24 X 36', '24 \u00D7 36 ft', '24 by 36', '24*36']) {
    const m = sizeFromDimensions(l, t);
    assert.ok(m, t);
    assert.equal(m?.qtyMode, 'parts');
    assert.equal(cents(m as Line), 21600, t);
  }
  assert.equal(sizeFromDimensions(l, '24,5x10')?.parts[0].a, '24.5');
  assert.equal(sizeFromDimensions(l, '24x0'), null);
  assert.equal(sizeFromDimensions(l, '24x'), null);
  assert.equal(sizeFromDimensions(l, 'about 24x36 or so'), null);
  assert.equal(sizeFromDimensions({ ...l, qtyType: 'each', unit: 'each' }, '24x36'), null);
});

// ---------- Basis changes ----------
test('Changing how a line is priced starts blank, and switching back restores the size and rate', () => {
  const line = area('1400', '0.18');
  const count = switchLineBasis(line, 'each', 'imperial', null);
  assert.equal(count.qtyType, 'each');
  assert.equal(count.qty, '');
  assert.equal(count.rate, '');
  assert.equal(count.rateSource, 'none');
  assert.equal(cents(count), null);
  const back = switchLineBasis(count, 'area', 'imperial', null);
  assert.equal(back.qty, '1400');
  assert.equal(back.rate, '0.18');
  assert.equal(cents(back), 25200);
});
test('A saved rate for the new basis is used, like on a new line', () => {
  const saved = { ...settings.rates.stairs, rate: '5' };
  const line: Line = { ...newLine('stairs', settings), qtyType: 'area', unit: 'sqft', qty: '60', rate: '0.50' };
  const each = switchLineBasis(line, 'each', 'imperial', saved);
  assert.equal(each.rate, '5');
  assert.equal(each.rateSource, 'saved');
  assert.equal(each.unit, 'each');
});
test('"I already know the price" keeps the size as the detail and can be undone', () => {
  const line = area('1400', '');
  const flat = { ...toFlatPrice(line, '1,400 sq ft'), price: '275' };
  assert.equal(flat.qtyType, 'flat');
  assert.equal(flat.detail, '1,400 sq ft');
  assert.equal(cents(flat), 27500);
  const back = switchLineBasis(flat, 'area', 'imperial', null);
  assert.equal(back.qty, '1400');
  assert.equal(back.price, '275');
});
test('A saved flat price fills new lines', () => {
  const s = defaultSettings();
  s.rates.walkway = { ...s.rates.walkway, qtyType: 'flat', unit: 'job', rate: '150' };
  const l = newLine('walkway', s);
  assert.equal(l.qtyType, 'flat');
  assert.equal(l.price, '150');
  assert.equal(l.rate, '');
  assert.equal(l.rateSource, 'saved');
  assert.equal(cents(l), 15000);
});

// ---------- First-run setup ----------
const answers = (patch: Partial<SetupAnswers> = {}): SetupAnswers => ({
  rates: {
    driveway: { mode: 'rate', value: '0.20' },
    walkway: { mode: 'flat', value: '150' },
    patio: { mode: 'rate', value: '' },
    stairs: { mode: 'rate', value: '0' },
  },
  minimum: '150',
  target: '',
  name: '  Clean Co ',
  phone: '',
  ...patch,
});
test('Setup saves answered steps only and never a blank or zero', () => {
  const s = applyAnswers(settings, answers(), new Set());
  assert.equal(s.rates.driveway.rate, '0.20');
  assert.equal(s.rates.driveway.qtyType, 'area');
  assert.equal(s.rates.walkway.qtyType, 'flat');
  assert.equal(s.rates.walkway.unit, 'job');
  assert.equal(s.rates.walkway.rate, '150');
  assert.deepEqual(s.rates.patio, settings.rates.patio);
  assert.deepEqual(s.rates.stairs, settings.rates.stairs);
  assert.deepEqual(s.minimum, { state: 'known_value', amount: '150' });
  assert.equal(s.ownerTarget.state, 'unknown');
  assert.equal(s.business.name, 'Clean Co');
  assert.equal(s.business.phone, '');
});
test('Skipped setup steps save nothing', () => {
  const s = applyAnswers(settings, answers(), new Set([1, 2, 3]));
  assert.deepEqual(s, settings);
});
test('After setup the first quote prices itself once a size is entered', () => {
  const s = applyAnswers(settings, answers(), new Set());
  const d = newDraft(s, ['driveway', 'walkway']);
  d.lines[0].qty = '600';
  const calc = computeQuote(d);
  assert.ok(calc.complete);
  assert.equal(calc.linesTotal, 12000 + 15000);
});

// ---------- Rate from time ----------
test('Rate from time covers the cleaning time at the operator\u2019s own figure, rounded up', () => {
  assert.equal(rateFromTime(Dec.int(600), 90, 6000)?.toString(), '0.15');
  assert.equal(rateInput(rateFromTime(Dec.int(300), 60, 6000) as Dec), '0.20');
  const r = rateFromTime(Dec.int(7), 50, 5500) as Dec;
  assert.equal(r.toString(), '6.5477');
  assert.ok(Dec.int(7).mul(r).toCents('half_up') >= 4583);
  assert.equal(rateFromTime(Dec.int(0), 90, 6000), null);
  assert.equal(rateFromTime(Dec.int(600), 0, 6000), null);
  assert.equal(rateFromTime(Dec.int(600), 90, 0), null);
});
test('Only known per-hour costs count toward a built rate', () => {
  const d = newDraft(settings);
  d.costs.labor = { state: 'known_value', amount: '25', basis: 'hour', source: 'operator' };
  d.costs.equipment = { state: 'unknown', amount: '', basis: 'hour', source: 'operator' };
  d.costs.materials = { state: 'known_value', amount: '10', basis: 'visit', source: 'operator' };
  assert.equal(knownHourlyCosts(d), 2500);
});

// ---------- Similar work and duplicates ----------
test('Quote similar work keeps services and rates, clears the customer and sizes', () => {
  const src = newDraft(settings);
  src.customer = { name: 'Sarah Jones', phone: '555 123 4567', email: '', address: '1 Elm St', source: 'operator' };
  src.lines = [area('1400', '0.18'), { ...newLine('custom', settings, 'Gutter flush'), price: '250' }, { ...area('200', '0.18'), name: 'Patio', treatment: 'excluded' }];
  src.visit = { ...src.visit, mode: 'total', total: { state: 'known_value', minutes: '150', source: 'operator' } };
  const copy = similarDraft(src, settings);
  assert.deepEqual(copy.customer, { name: '', phone: '', email: '', address: '', source: 'operator' });
  assert.equal(copy.lines.length, 2);
  assert.equal(copy.lines[0].qty, '');
  assert.equal(copy.lines[0].rate, '0.18');
  assert.equal(copy.lines[1].price, '250');
  assert.deepEqual(copy.visit, newDraft(settings).visit);
  assert.ok(copy.lines[0].id !== src.lines[0].id);
});
test('Copies never carry another job\u2019s undo snapshots', () => {
  const src = newDraft(settings);
  src.lines = [switchLineBasis(area('1400', '0.18'), 'flat', 'imperial', null)];
  assert.ok(src.lines[0].basisOrigin);
  const copy = duplicateDraft(src);
  assert.equal(copy.lines[0].basisOrigin, undefined);
  const similar = similarDraft(src, settings);
  assert.equal(switchLineBasis(similar.lines[0], 'area', 'imperial', null).qty, '');
});

// ---------- Recap ----------
const outcome = (patch: Partial<Outcome>): Outcome => ({
  completedAt: 1_700_000_000_000,
  minutes: { state: 'unknown', minutes: '', source: 'operator' },
  workMinutes: { state: 'unknown', minutes: '', source: 'operator' },
  finalPrice: { state: 'unknown', amount: '' },
  costs: { state: 'unknown', amount: '' },
  changed: false,
  note: '',
  ...patch,
});
test('Recap compares estimate and actual on the same basis', () => {
  const econ = { revenue: 30000, minutes: 120, costs: null, revenuePerHour: 15000, availablePerHour: null };
  const before = recapNumbers(econ, outcome({ minutes: { state: 'known_value', minutes: '150', source: 'operator' } }));
  assert.equal(before.basis, 'before_costs');
  assert.equal(before.perHour, 12000);
  assert.equal(before.plannedPerHour, 15000);
  const after = recapNumbers(econ, outcome({ minutes: { state: 'known_value', minutes: '150', source: 'operator' }, costs: { state: 'known_value', amount: '50' } }));
  assert.equal(after.basis, 'after_costs');
  assert.equal(after.perHour, 10000);
  assert.equal(after.plannedPerHour, null, 'no after-costs plan to compare with');
  const price = recapNumbers(econ, outcome({ finalPrice: { state: 'known_value', amount: '320' } }));
  assert.equal(price.price, 32000);
  assert.equal(price.perHour, null);
});

// ---------- Cleaning-time suggestion ----------
function doneJob(id: string, sqft: string, workMinutes: string, extra: Line[] = []): Job {
  const d = newDraft(settings);
  d.lines = [area(sqft, '0.18'), ...extra];
  return {
    schema: 1,
    id,
    number: 1,
    createdAt: 0,
    updatedAt: 0,
    sample: false,
    status: 'completed',
    label: 'Driveway',
    draft: d,
    request: null,
    privateNotes: '',
    revisions: [],
    dirtySince: null,
    pendingFinalizationId: null,
    shares: [],
    outcome: outcome({ completedAt: 1_700_000_000_000 + Number(id.slice(1)), workMinutes: { state: 'known_value', minutes: workMinutes, source: 'operator' } }),
    useForSuggestions: true,
  };
}
test('Cleaning time is suggested from five recorded single-surface jobs, scaled to this size', () => {
  const jobs = [doneJob('j1', '500', '50'), doneJob('j2', '600', '60'), doneJob('j3', '800', '80'), doneJob('j4', '1000', '100'), doneJob('j5', '400', '40')];
  const d = newDraft(settings);
  d.lines = [area('1200', '0.18')];
  const s = suggestWorkMinutes(jobs, d, 'current');
  assert.equal(s?.workMinutes, 120);
  assert.equal(s?.count, 5);
  assert.equal(suggestWorkMinutes(jobs.slice(0, 4), d, 'current'), null);
  const mixed = [...jobs.slice(0, 4), doneJob('j6', '400', '40', [{ ...newLine('custom', settings, 'Gutters'), price: '100' }])];
  assert.equal(suggestWorkMinutes(mixed, d, 'current'), null, 'a two-service job is not comparable');
});

test('Earlier customers are suggested by any word of the name, newest first, once each', () => {
  const withCustomer = (id: string, name: string, address: string, at: number, sample = false): Job => {
    const j = doneJob(id, '500', '50');
    j.draft.customer = { name, address, phone: '555 000 0000', email: '', source: 'operator' };
    return { ...j, updatedAt: at, sample };
  };
  const jobs = [withCustomer('j1', 'Sarah Jones', '1 Elm St', 1), withCustomer('j2', 'Sarah Jones', '1 Elm St', 5), withCustomer('j3', 'Mike Sarandon', '9 Oak Ave', 3), withCustomer('j4', 'Sarah Sample', '', 9, true)];
  assert.deepEqual(pastCustomers(jobs, 'sar', 'current').map((m) => m.jobId), ['j2', 'j3']);
  assert.deepEqual(pastCustomers(jobs, 'jon', 'current').map((m) => m.name), ['Sarah Jones']);
  assert.deepEqual(pastCustomers(jobs, 's', 'current'), []);
  assert.deepEqual(pastCustomers(jobs, 'sarah', 'j2').map((m) => m.jobId), ['j1']);
  const lines = linesFromLastQuote(jobs[1]);
  assert.equal(lines[0].qty, '500');
  assert.ok(lines[0].id !== jobs[1].draft.lines[0].id);
});

// ---------- Backup reminders ----------
test('Backup card: after the 3rd quote, then every 25 quotes or 30 days with something new', () => {
  const day = 24 * 60 * 60 * 1000;
  const m0 = defaultMeta();
  assert.equal(backupDue(m0, 2, 0), false);
  assert.equal(backupDue(m0, 3, 0), true);
  const m1 = markBackup(m0, 3, 0, true);
  assert.equal(m1.lastBackupAt, 0);
  assert.equal(backupDue(m1, 4, day), false);
  assert.equal(backupDue(m1, 28, day), true);
  assert.equal(backupDue(m1, 4, 31 * day), true);
  assert.equal(backupDue(m1, 3, 31 * day), false, 'nothing new since the last backup');
  const dismissed = markBackup(m1, 4, 31 * day, false);
  assert.equal(dismissed.lastBackupAt, 0);
  assert.equal(quotesCreated([doneJob('j1', '500', '50')]), 0);
});

// ---------- Worth-it verdict and hourly costs ----------
test('Hourly costs round half up to the cent', () => {
  assert.equal(hourlyCostCents(2500, 90), 3750);
  assert.equal(hourlyCostCents(1999, 7), 233);
  assert.equal(hourlyCostCents(1, 30), 1);
  assert.equal(hourlyCostCents(0, 30), 0);
});
test('A price that exactly earns the target meets it; a cent less does not', () => {
  const run = (price: string) => {
    const d = newDraft(settings);
    d.lines = [{ ...newLine('custom', settings, 'Job'), price }];
    for (const k of Object.keys(d.costs) as (keyof Draft['costs'])[]) d.costs[k] = { state: 'known_zero', amount: '', basis: 'visit', source: 'operator' };
    d.visit = { ...d.visit, mode: 'total', total: { state: 'known_value', minutes: '100', source: 'operator' } };
    d.ownerTarget = { state: 'known_value', rate: '60', source: 'operator' };
    return computeEconomics(d, computeQuote(d), settings).verdict;
  };
  assert.equal(run('100'), 'meets');
  assert.equal(run('99.99'), 'below');
});

// ---------- Saved data ----------
test('New settings and meta fields survive a save and reload', () => {
  const s = applyAnswers(settings, answers(), new Set());
  s.customerNote = 'Text YES to book.';
  assert.deepEqual(normalizeSettings(JSON.parse(JSON.stringify(s))), s);
  const m = { ...defaultMeta(), onboarded: true, backupMarkQuotes: 4, backupMarkAt: 123, offerCardDismissed: true, lastFreeNoticeShown: true, endedCardDismissedAt: 456, captureDraft: 'driveway 20x30' };
  assert.deepEqual(normalizeMeta(JSON.parse(JSON.stringify(m))), m);
});
test('Setup asks about sales tax: no, a rate, or unanswered', () => {
  const no = applyAnswers(settings, { ...answers(), tax: { charge: 'no', rate: '' } }, new Set());
  assert.equal(no.tax.state, 'known_zero');
  const yes = applyAnswers(settings, { ...answers(), tax: { charge: 'yes', rate: '8.25' } }, new Set());
  assert.deepEqual([yes.tax.state, yes.tax.rate], ['known_value', '8.25']);
  // "Yes" with no rate typed, or no answer at all, leaves it unknown: the quote then says "Plus any applicable sales tax".
  assert.equal(applyAnswers(settings, { ...answers(), tax: { charge: 'yes', rate: '' } }, new Set()).tax.state, settings.tax.state);
  assert.equal(applyAnswers(settings, { ...answers(), tax: { charge: '', rate: '' } }, new Set()).tax.state, settings.tax.state);
  assert.equal(applyAnswers(settings, { ...answers(), tax: { charge: 'no', rate: '' } }, new Set([2])).tax.state, settings.tax.state);
});
test('Saved usual sizes survive a reload; anything malformed is dropped', () => {
  const s = { ...settings, savedSizes: { 'driveway:2car': { qty: '640', unit: 'sqft' as const } } };
  assert.deepEqual(normalizeSettings(JSON.parse(JSON.stringify(s))).savedSizes, s.savedSizes);
  const bad = { ...settings, savedSizes: { 'driveway:2car': { qty: '0', unit: 'sqft' }, 'roof:9car': { qty: '5', unit: 'sqft' }, 'driveway:3car': { qty: '900', unit: 'acres' } } };
  assert.deepEqual(normalizeSettings(JSON.parse(JSON.stringify(bad))).savedSizes, {});
  // Settings saved before this existed load with none.
  const old = JSON.parse(JSON.stringify(settings));
  delete old.savedSizes;
  assert.deepEqual(normalizeSettings(old).savedSizes, {});
});
test('Installs from before setup existed are not sent through setup', () => {
  const old = { ...defaultMeta() } as Partial<ReturnType<typeof defaultMeta>>;
  delete old.onboarded;
  assert.equal(normalizeMeta(old).onboarded, true);
  assert.equal(normalizeMeta({ ...defaultMeta(), onboarded: false }).onboarded, false);
});
test('Undo snapshots are not written into saved jobs', () => {
  const d = newDraft(settings);
  d.lines = [switchLineUnit(area('1400', '0.18'), 'sqm')];
  const back = normalizeDraft(JSON.parse(JSON.stringify(d)));
  assert.equal(back.lines[0].unitOrigin, undefined);
  assert.equal(back.lines[0].qty, d.lines[0].qty);
  assert.equal(cents(back.lines[0]), 25200);
});

// ---------- Services shown and the example message ----------
test('Home shows the services picked in setup first; the rest wait under More', () => {
  assert.deepEqual(shownKinds(settings).first, CORE_KINDS);
  assert.deepEqual(shownKinds(settings).more, RATED_KINDS.filter((k) => !CORE_KINDS.includes(k)));
  const picked = applyAnswers(settings, answers({ services: ['roof', 'house', 'driveway'] }), new Set());
  assert.deepEqual(shownKinds(picked).first, ['driveway', 'house', 'roof']);
  assert.equal(shownKinds(picked).more.length, RATED_KINDS.length - 3);
  assert.deepEqual(applyAnswers(settings, answers({ services: ['roof'] }), new Set([0])).services, CORE_KINDS, 'skipped step saves nothing');
  assert.deepEqual(normalizeSettings({ ...JSON.parse(JSON.stringify(settings)), services: ['nope'] }).services, CORE_KINDS);
});
test('The example message builds a complete sample quote without touching saved rates', () => {
  const before = JSON.stringify(settings);
  const d = exampleDraft(settings);
  assert.equal(JSON.stringify(settings), before);
  assert.equal(d.lines.length, 3);
  assert.equal(d.questions.filter((q) => !q.resolved).length, 0);
  assert.ok(d.lines.every((l) => l.rateSource === 'sample'));
  const calc = computeQuote(d);
  assert.ok(calc.complete);
  assert.equal(calc.total, 24352);
  assert.equal(d.budget.state, 'known_value', 'the $300 is a budget');
  assert.ok(isExampleJob({ sample: true, request: { text: EXAMPLE_MESSAGE } }));
  assert.ok(!isExampleJob({ sample: false, request: { text: EXAMPLE_MESSAGE } }), 'a real job is never the example');
  // Metric operators still get a priced example in the message's own feet.
  assert.equal(computeQuote(exampleDraft({ ...settings, units: 'metric' })).total, 24352);
});

test('Telemetry sends fixed names only, never an error message or customer text', () => {
  const sent: { url: string; body: string }[] = [];
  const post = async (url: string, body: string) => {
    sent.push({ url, body });
  };
  connectTelemetry({ appVersion: '1.0.0', platform: 'ios', enabled: true, post });
  track('paywall_viewed', 'limit');
  track('paste_used');
  reportError(new TypeError('Cannot read Dana Whitfield 418 Cedar Ridge Ln'), 'pdf');
  reportError('a string with 555-201-7788', 'share');
  assert.deepEqual(
    sent.map((x) => [x.url.replace(TELEMETRY_URL, ''), JSON.parse(x.body)]),
    [
      ['/events', { event: 'paywall_viewed', from: 'limit', appVersion: '1.0.0', platform: 'ios' }],
      ['/events', { event: 'paste_used', appVersion: '1.0.0', platform: 'ios' }],
      ['/crashes', { area: 'pdf', errorType: 'TypeError', appVersion: '1.0.0', platform: 'ios' }],
      ['/crashes', { area: 'share', errorType: 'string', appVersion: '1.0.0', platform: 'ios' }],
    ],
  );
  assert.ok(sent.every((x) => !/Dana|Cedar|555/.test(x.body)));
  sent.length = 0;
  connectTelemetry({ appVersion: '1.0.0', platform: 'ios', enabled: false, post });
  track('paste_used');
  reportError(new Error('x'), 'pdf');
  assert.equal(sent.length, 0, 'development builds send nothing');
});

if (failures.length) {
  console.error(`\n${failures.length} failed, ${passed} passed\n`);
  for (const f of failures) console.error(`  \u2717 ${f}\n`);
  throw new Error('Feature tests failed');
}
console.log(`All ${passed} feature tests passed.`);
