/**
 * Frozen USD_V1 fixtures (foundation section 15) plus property checks.
 * Run: pnpm --filter @workspace/pressure-quote run test
 */
import { Dec } from '../lib/decimal';
import { partsTotal, sqftToSqm } from '../lib/geometry';
import { allocate, computeQuote } from '../lib/pricing';
import { computeEconomics, marginOf, priceForMargin, priceForMarkup, supportedMinutes } from '../lib/economics';
import { defaultSettings, newDraft, newLine, sampleDraft } from '../lib/defaults';
import { draftFromRequest, guessMode, parseRequest } from '../lib/parser';
import { confirmQuantities, jobIssues, reconcileQuestions, resolveQuestion } from '../lib/resolve';
import { buildQuoteDoc, quoteFileName, quoteSmsMessage, quoteTitle, renderQuoteHtml, renderQuoteText } from '../lib/document';
import { decideAccess, isNewVisit } from '../lib/access';
import { money, quoteReference, smsAddress } from '../lib/format';
import type { Draft, Line, Part } from '../lib/types';

/** Minimal strict assertions so the tests typecheck without Node type definitions. */
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) out[k] = canon((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}
const show = (v: unknown) => (typeof v === 'string' ? JSON.stringify(v) : typeof v === 'bigint' ? `${v}n` : JSON.stringify(canon(v)) ?? String(v));
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
const part = (shape: Part['shape'], a: string, b: string, subtract = false): Part => ({ id: Math.random().toString(36), shape, a, b, subtract, label: '' });

function flat(name: string, price: string, extra: Partial<Line> = {}): Line {
  return { ...newLine('custom', settings, name), price, ...extra };
}
function areaLine(name: string, qty: string, rate: string, extra: Partial<Line> = {}): Line {
  return { ...newLine('driveway', settings, name), qty, rate, ...extra };
}
function draftWith(lines: Line[], mut?: (d: Draft) => void): Draft {
  const d = newDraft(settings, []);
  d.lines = lines;
  d.pricing.minimum = { state: 'not_applicable', amount: '', source: 'operator' };
  d.pricing.trip = { state: 'not_applicable', amount: '', taxable: false, discountable: false, source: 'operator' };
  mut?.(d);
  return d;
}

// ---------- Geometry ----------
test('Rectangle 20 x 30 = 600 sq ft', () => {
  assert.equal(partsTotal([part('rect', '20', '30')]).total?.toString(), '600');
});
test('Triangle base 20, height 30 = 300 sq ft', () => {
  assert.equal(partsTotal([part('triangle', '20', '30')]).total?.toString(), '300');
});
test('600 sq ft less 100 sq ft exclusion = 500 sq ft', () => {
  assert.equal(partsTotal([part('rect', '20', '30'), part('value', '100', '', true)]).total?.toString(), '500');
});
test('Exclusion larger than area is an error, not zero', () => {
  const r = partsTotal([part('rect', '10', '10'), part('value', '150', '', true)]);
  assert.equal(r.total, null);
  assert.ok(r.issue);
});
test('1 sq ft = 0.09290304 sq m exactly', () => {
  assert.equal(sqftToSqm(Dec.int(1)).toString(), '0.09290304');
});

// ---------- Margin / markup ----------
test('$200 cost, 40% minimum margin -> $333.34, achieved margin recomputed', () => {
  const p = priceForMargin(20000, '40');
  assert.equal(p, 33334);
  const m = marginOf(p as number, 20000) as number;
  assert.ok(m >= 0.4 && m < 0.4001, `margin ${m}`);
});
test('$200 cost, 40% markup -> $280, 28.57% margin', () => {
  assert.equal(priceForMarkup(20000, '40'), 28000);
  assert.equal((marginOf(28000, 20000) as number).toFixed(4), '0.2857');
});
test('10% discount on $333.33 -> $33.33 discount, $300.00 subtotal, margin 33.33%', () => {
  const c = computeQuote(draftWith([flat('Job', '333.33')], (d) => (d.pricing.discount = { kind: 'percent', value: '10', label: 'Discount', includeMinimum: false })));
  assert.equal(c.discount.applied, 3333);
  assert.equal(c.subtotal, 30000);
  assert.equal((marginOf(c.subtotal, 20000) as number).toFixed(4), '0.3333');
});

// ---------- Owner economics ----------
function econDraft(price: string, mut: (d: Draft) => void): ReturnType<typeof computeEconomics> {
  const d = draftWith([flat('Job', price)]);
  for (const k of Object.keys(d.costs) as (keyof Draft['costs'])[]) d.costs[k] = { state: 'known_zero', amount: '', basis: 'visit', source: 'operator' };
  mut(d);
  return computeEconomics(d, computeQuote(d), settings);
}
test('$400 price, $120 fixed cost, 4 owner hours -> $70/hour', () => {
  const e = econDraft('400', (d) => {
    d.visit = { ...d.visit, mode: 'total', total: { state: 'known_value', minutes: '240', source: 'operator' } };
    d.costs.materials = { state: 'known_value', amount: '80', basis: 'visit', source: 'operator' };
    d.costs.overhead = { state: 'known_value', amount: '40', basis: 'visit', source: 'operator' };
  });
  assert.equal(e.availablePerHour, 7000);
});
test('Same at 5 hours -> $56/hour', () => {
  const e = econDraft('400', (d) => {
    d.visit = { ...d.visit, mode: 'total', total: { state: 'known_value', minutes: '300', source: 'operator' } };
    d.costs.materials = { state: 'known_value', amount: '120', basis: 'visit', source: 'operator' };
  });
  assert.equal(e.availablePerHour, 5600);
});
test('$400, $120 fixed, $60 target -> 4 h 40 min supported', () => {
  assert.equal(supportedMinutes(40000, 12000, 6000, 0), 280);
});
test('$400, $100 fixed, $60 target, $15/h variable -> 4 h supported', () => {
  assert.equal(supportedMinutes(40000, 10000, 6000, 1500), 240);
  const e = econDraft('400', (d) => {
    d.visit = { ...d.visit, mode: 'total', total: { state: 'known_value', minutes: '240', source: 'operator' } };
    d.costs.materials = { state: 'known_value', amount: '100', basis: 'visit', source: 'operator' };
    d.costs.equipment = { state: 'known_value', amount: '15', basis: 'hour', source: 'operator' };
    d.ownerTarget = { state: 'known_value', rate: '60', source: 'operator' };
  });
  assert.equal(e.supportedMinutes, 240);
  assert.equal(e.verdict, 'meets');
});
test('Negative numerator supports zero time, never negative hours', () => {
  assert.equal(supportedMinutes(5000, 9000, 6000, 0), 0);
  assert.equal(supportedMinutes(5000, 1000, 0, 0), null);
});
test('Unknown material cost -> revenue/hour only, no profit claim', () => {
  const e = econDraft('400', (d) => {
    d.visit = { ...d.visit, mode: 'total', total: { state: 'known_value', minutes: '240', source: 'operator' } };
    d.costs.materials = { state: 'unknown', amount: '', basis: 'visit', source: 'operator' };
    d.ownerTarget = { state: 'known_value', rate: '60', source: 'operator' };
  });
  assert.equal(e.revenuePerHour, 10000);
  assert.equal(e.available, null);
  assert.equal(e.availablePerHour, null);
  assert.equal(e.margin, null);
  assert.equal(e.supportedMinutes, null);
  assert.deepEqual(e.missingCosts, ['materials']);
});
test('Known zero cost is a complete cost; zero time leaves ratios undefined; cost above price is negative', () => {
  const zero = econDraft('400', (d) => {
    d.visit = { ...d.visit, mode: 'total', total: { state: 'known_value', minutes: '0', source: 'operator' } };
  });
  assert.equal(zero.costs, 0);
  assert.equal(zero.revenuePerHour, null);
  assert.equal(zero.availablePerHour, null);
  const neg = econDraft('100', (d) => {
    d.visit = { ...d.visit, mode: 'total', total: { state: 'known_value', minutes: '60', source: 'operator' } };
    d.costs.materials = { state: 'known_value', amount: '150', basis: 'visit', source: 'operator' };
  });
  assert.equal(neg.available, -5000);
  const free = econDraft('0', (d) => {
    d.visit = { ...d.visit, mode: 'total', total: { state: 'known_value', minutes: '60', source: 'operator' } };
    d.ownerTarget = { state: 'known_value', rate: '60', source: 'operator' };
  });
  assert.equal(free.margin, null);
});
test('Visit parts: blank time is missing, not zero', () => {
  const d = draftWith([flat('Job', '300')]);
  d.visit.mode = 'parts';
  const e = computeEconomics(d, computeQuote(d), settings);
  assert.equal(e.minutes, null);
  assert.ok(e.missingTime.length > 0);
});

// ---------- Selling price ----------
test('$300 price, two surfaces sharing one $50 setup -> one setup, not $100', () => {
  const c = computeQuote(
    draftWith([flat('Driveway', '150'), flat('Patio', '100')], (d) => {
      d.pricing.trip = { state: 'known_value', amount: '50', taxable: false, discountable: false, source: 'operator' };
    }),
  );
  assert.equal(c.lines.filter((l) => l.kind === 'trip').length, 1);
  assert.equal(c.subtotal, 30000);
});
test('Two lines qty 1 at $0.105 -> $0.11 each, $0.22', () => {
  const c = computeQuote(draftWith([areaLine('A', '1', '0.105'), areaLine('B', '1', '0.105')]));
  assert.deepEqual(c.lines.map((l) => l.amount), [11, 11]);
  assert.equal(c.subtotal, 22);
});
test('$100 taxable + $50 non-taxable, 10% discount, 8% tax -> $142.20; 25% deposit $35.55', () => {
  const c = computeQuote(
    draftWith([flat('A', '100', { id: 'a', taxable: true }), flat('B', '50', { id: 'b', taxable: false })], (d) => {
      d.pricing.discount = { kind: 'percent', value: '10', label: 'Discount', includeMinimum: false };
      d.pricing.tax = { state: 'known_value', rate: '8', label: 'Sales tax', source: 'operator' };
      d.pricing.deposit = { kind: 'percent', value: '25' };
    }),
  );
  assert.deepEqual(c.lines.map((l) => l.net), [9000, 4500]);
  assert.equal(c.tax.amount, 720);
  assert.equal(c.total, 14220);
  assert.equal(c.deposit?.amount, 3555);
  assert.equal(c.deposit?.balance, 10665);
  assert.equal(c.subtotal, 13500, 'revenue excludes tax');
});
test('Three equal $33.33 lines, $10 discount -> $3.34/$3.33/$3.33 by stable id', () => {
  const c = computeQuote(
    draftWith([flat('C', '33.33', { id: 'c' }), flat('A', '33.33', { id: 'a' }), flat('B', '33.33', { id: 'b' })], (d) => {
      d.pricing.discount = { kind: 'fixed', value: '10', label: 'Discount', includeMinimum: false };
    }),
  );
  const byId = Object.fromEntries(c.lines.map((l) => [l.id, l.discount]));
  assert.deepEqual(byId, { a: 334, b: 333, c: 333 });
  assert.equal(c.discount.applied, 1000);
});
test('$175 subtotal, $150 minimum, $30 discount: unset blocks, keep -> $25 / $150, override -> $145', () => {
  const base = (decision: Draft['pricing']['minimumDecision']) =>
    computeQuote(
      draftWith([flat('Job', '175')], (d) => {
        d.pricing.minimum = { state: 'known_value', amount: '150', source: 'operator' };
        d.pricing.discount = { kind: 'fixed', value: '30', label: 'Discount', includeMinimum: false };
        d.pricing.minimumDecision = decision;
      }),
    );
  const unset = base('unset');
  assert.ok(unset.discount.conflict);
  assert.ok(unset.blocking.some((b) => b.key === 'minimum-decision'));
  const keep = base('keep');
  assert.equal(keep.discount.applied, 2500);
  assert.equal(keep.subtotal, 15000);
  assert.ok(keep.complete);
  const override = base('override');
  assert.equal(override.discount.applied, 3000);
  assert.equal(override.subtotal, 14500);
});
test('Minimum applied once as a visible adjustment', () => {
  const c = computeQuote(
    draftWith([flat('A', '40'), flat('B', '30')], (d) => (d.pricing.minimum = { state: 'known_value', amount: '150', source: 'operator' })),
  );
  assert.equal(c.minimum.adjustment, 8000);
  assert.equal(c.subtotal, 15000);
});
test('Discount beyond eligible subtotal is rejected; 100% discount gives zero revenue', () => {
  const over = computeQuote(draftWith([flat('A', '50')], (d) => (d.pricing.discount = { kind: 'fixed', value: '60', label: 'Discount', includeMinimum: false })));
  assert.ok(over.discount.invalid);
  assert.ok(!over.complete);
  const full = computeQuote(draftWith([flat('A', '50')], (d) => (d.pricing.discount = { kind: 'percent', value: '100', label: 'Discount', includeMinimum: false })));
  assert.equal(full.subtotal, 0);
});
test('Impossible tax and deposit are rejected', () => {
  const tax = computeQuote(draftWith([flat('A', '50')], (d) => (d.pricing.tax = { state: 'known_value', rate: '150', label: 'Tax', source: 'operator' })));
  assert.ok(tax.blocking.some((b) => b.key === 'tax'));
  const dep = computeQuote(draftWith([flat('A', '50')], (d) => (d.pricing.deposit = { kind: 'fixed', value: '60' })));
  assert.ok(dep.blocking.some((b) => b.key === 'deposit'));
});
test('Free lines show Included and add nothing; excluded lines are listed only', () => {
  const c = computeQuote(draftWith([flat('A', '100'), flat('Steps', '', { treatment: 'free' }), flat('Oil', '', { treatment: 'excluded' })]));
  assert.equal(c.total, 10000);
  assert.equal(c.excluded[0].name, 'Oil');
  assert.ok(c.complete);
});
test('Missing rate or quantity blocks; blank is never zero', () => {
  const c = computeQuote(draftWith([areaLine('Drive', '', '0.2'), areaLine('Walk', '100', '')]));
  assert.equal(c.blocking.filter((b) => b.lineId).length, 2);
});

// ---------- Properties ----------
test('Allocation always sums exactly and never exceeds a line', () => {
  let seed = 7;
  const rnd = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  for (let i = 0; i < 2000; i++) {
    const items = Array.from({ length: 1 + rnd(6) }, (_, k) => ({ id: `l${k}`, amount: rnd(50000) }));
    const sum = items.reduce((s, x) => s + x.amount, 0);
    const total = sum === 0 ? 0 : rnd(sum + 1);
    const a = allocate(total, items);
    const got = Array.from(a.values()).reduce((s, x) => s + x, 0);
    assert.equal(got, sum === 0 ? 0 : total);
    for (const it of items) assert.ok((a.get(it.id) ?? 0) <= it.amount);
  }
});
test('Total equals sum of line nets plus line taxes', () => {
  const c = computeQuote(
    draftWith([areaLine('A', '1234.5', '0.137'), areaLine('B', '77', '0.333', { taxable: false }), flat('C', '19.99')], (d) => {
      d.pricing.discount = { kind: 'percent', value: '12.5', label: 'Discount', includeMinimum: false };
      d.pricing.tax = { state: 'known_value', rate: '7.25', label: 'Tax', source: 'operator' };
    }),
  );
  assert.equal(c.total, c.lines.reduce((s, l) => s + l.net + l.tax, 0));
});

// ---------- Request reading ----------
const dana = "Hi, this is Dana. Can you quote our driveway and front path? It's about 1,400 square feet total. Stairs included too. We were hoping to keep it around $400. 512 Maple Ave. 555-201-3344";
test('Combined 1,400 sq ft stays 1,400 until allocation is confirmed, never 2,800', () => {
  const p = parseRequest(dana);
  const draft = draftFromRequest(p, settings);
  const q = draft.questions.find((x) => x.kind === 'combined_area');
  assert.ok(q, 'combined question');
  assert.equal(q?.payload.area, '1400');
  assert.equal(q?.lineIds.length, 2);
  for (const l of draft.lines) assert.equal(l.qty, '', `${l.name} must not get the full area`);
  const combined = resolveQuestion(draft, q!.id, { kind: 'combine' }, settings);
  assert.ok(combined.ok);
  if (combined.ok) {
    const areaLines = combined.draft.lines.filter((l) => l.kind !== 'stairs');
    assert.equal(areaLines.length, 1);
    assert.equal(areaLines[0].qty, '1400');
  }
  const split = resolveQuestion(draft, q!.id, { kind: 'split', first: '1000' }, settings);
  assert.ok(split.ok);
  if (split.ok) assert.deepEqual(split.draft.lines.filter((l) => l.kind !== 'stairs').map((l) => l.qty), ['1000', '400']);
  assert.equal(resolveQuestion(draft, q!.id, { kind: 'split', first: '1500' }, settings).ok, false);
});
test('A customer budget is never a price', () => {
  const p = parseRequest(dana);
  assert.equal(p.budget?.amount, '400');
  const d = draftFromRequest(p, settings);
  assert.equal(d.budget.state, 'known_value');
  assert.ok(d.lines.every((l) => l.price === ''));
});
test('Request contact, stairs question and services', () => {
  const p = parseRequest(dana);
  assert.equal(p.customer.name, 'Dana');
  assert.equal(p.customer.phone, '555-201-3344');
  assert.equal(p.customer.address, '512 Maple Ave');
  assert.deepEqual(p.services.map((s) => s.kind), ['driveway', 'walkway', 'stairs']);
  assert.ok(p.questions.some((q) => q.kind === 'missing_qty' && q.serviceIdx[0] === 2));
});
test('Dimensions attach to the surface named before them', () => {
  const p = parseRequest('Driveway 24 x 50 and sidewalk 4x60, plus 3 steps. Some oil stains. Also the deck.');
  const d = draftFromRequest(p, settings);
  const drive = d.lines.find((l) => l.kind === 'driveway');
  const walk = d.lines.find((l) => l.kind === 'walkway');
  assert.equal(drive?.parts[0]?.a, '24');
  assert.equal(drive?.parts[0]?.b, '50');
  assert.equal(walk?.parts[0]?.a, '4');
  assert.equal(d.lines.find((l) => l.kind === 'stairs')?.qty, '3');
  assert.ok(p.questions.some((q) => q.kind === 'condition'));
  // A deck is a built-in service now: its own line, waiting for a size.
  const deck = d.lines.find((l) => l.kind === 'deck');
  assert.ok(deck && !deck.qty && deck.parts.length === 0, 'deck line without a size');
  assert.ok(!p.questions.some((q) => q.kind === 'other_service' && q.payload.label === 'Deck'));
  assert.ok(jobIssues(d, computeQuote(d)).some((i) => i.key === 'confirm'), 'customer sizes need confirmation');
  const confirmed = confirmQuantities(d);
  assert.ok(confirmed.lines.every((l) => l.qtySource !== 'customer'));
});
test('"40 ft long and 4 ft wide" is read as a rectangle', () => {
  const p = parseRequest('The front walkway, maybe 40 ft long and 4 ft wide. Patio is 12 feet wide by 15 feet long.');
  const d = draftFromRequest(p, settings);
  const walk = d.lines.find((l) => l.kind === 'walkway');
  const patio = d.lines.find((l) => l.kind === 'patio');
  assert.deepEqual([walk?.parts[0]?.a, walk?.parts[0]?.b], ['40', '4']);
  assert.deepEqual([patio?.parts[0]?.a, patio?.parts[0]?.b], ['12', '15']);
  assert.equal(walk?.qtySource, 'customer');
});
test('Area with no named surface becomes a question, not an invented service', () => {
  const p = parseRequest('Can you clean about 900 sq ft?');
  assert.equal(p.services.length, 0);
  assert.ok(p.questions.some((q) => q.kind === 'combined_area' && q.serviceIdx.length === 0));
});
test('Pool deck is a patio surface, not a wood deck', () => {
  const p = parseRequest('Pool deck is 20 by 30');
  assert.deepEqual(p.services.map((s) => s.kind), ['patio']);
  assert.ok(!p.questions.some((q) => q.kind === 'other_service'));
});
test('Malicious markup in a request is escaped in output', () => {
  const p = parseRequest('Driveway 10x10 <script>alert(1)</script> this is <b>Eve</b>');
  const d = draftFromRequest(p, settings);
  d.customer.name = '<img src=x onerror=alert(1)>';
  d.lines[0].rate = '1';
  const c = computeQuote(confirmQuantities(d));
  const doc = buildQuoteDoc({ draft: d, calc: c, business: { name: 'A&B <Wash>', phone: '', email: '', logo: 'data:image/png;base64,AAA" onerror="x' }, reference: 'Q-0001', issuedAt: Date.now(), sample: false });
  const html = renderQuoteHtml(doc);
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('onerror="x'));
  assert.ok(html.includes('A&amp;B &lt;Wash&gt;'));
});

// What switching to metric in Settings does to blank saved rates: the units change with it.
const metricSettings: typeof settings = {
  ...settings,
  units: 'metric',
  rates: Object.fromEntries(
    Object.entries(settings.rates).map(([k, r]) => [k, { ...r, unit: r.unit === 'sqft' ? 'sqm' : r.unit === 'ft' ? 'm' : r.unit }]),
  ) as typeof settings.rates,
};
const qtys = (d: Draft) => d.lines.map((l) => `${l.name}=${l.qty || l.parts.map((p) => `${p.subtract ? '-' : ''}${p.shape === 'rect' ? `${p.a}x${p.b}` : p.a}`).join('')}`);

test('Metric sizes are kept exact in a metric account and converted (with the original shown) otherwise', () => {
  const text = 'The patio is 5 x 4 m and the driveway is 50 m2';
  const metric = draftFromRequest(parseRequest(text, { units: 'metric' }), metricSettings);
  assert.deepEqual(qtys(metric), ['Patio=5x4', 'Driveway=50']);
  assert.ok(metric.lines.every((l) => l.unit === 'sqm'));
  const imperial = draftFromRequest(parseRequest(text), settings);
  const patio = imperial.lines[0];
  assert.equal(patio.parts[0].a, '215.28');
  assert.equal(patio.parts[0].label, '5 \u00D7 4 m');
  assert.equal(imperial.lines[1].parts[0].a, '538.2');
});
test('Mixed units in one size are converted side by side', () => {
  const d = draftFromRequest(parseRequest('Driveway 10 ft x 5 m'), settings);
  assert.equal(d.lines[0].parts[0].a, '164.04');
  assert.equal(d.lines[0].parts[0].label, '10 ft \u00D7 5 m');
});
test('An exclusion is subtracted visibly, and a "do not wash" surface is listed as not included', () => {
  const p = parseRequest('Driveway is 600 sq ft excluding 100 sq ft for the planter. Do not wash the patio.');
  const d = draftFromRequest(p, settings);
  const drive = d.lines[0];
  assert.deepEqual(drive.parts.map((x) => [x.a, x.subtract]), [['600', false], ['100', true]]);
  assert.equal(drive.parts[1].label, 'Left out: 100 sq ft');
  assert.equal(d.lines[1].treatment, 'excluded');
  const scope = d.questions.find((q) => q.kind === 'scope');
  assert.ok(scope, 'scope question');
  assert.ok(!d.questions.some((q) => q.kind === 'missing_qty'), 'an excluded surface never asks for a size');
  const priced = resolveQuestion(d, scope!.id, { kind: 'include' }, settings);
  assert.ok(priced.ok && priced.draft.lines[1].treatment === 'priced');
  const removed = resolveQuestion(d, scope!.id, { kind: 'remove' }, settings);
  assert.ok(removed.ok && removed.draft.lines.length === 1);
  const kept = resolveQuestion(d, scope!.id, { kind: 'keep_excluded' }, settings);
  assert.ok(kept.ok && kept.draft.lines[1].treatment === 'excluded');
  const sub = draftFromRequest(parseRequest('Driveway 20x40 but leave out the 4x4 pad by the garage'), settings);
  assert.deepEqual(qtys(sub), ['Driveway=20x40-16']);
});
test('Negated lists: "not the driveway or the steps"', () => {
  const p = parseRequest('The patio and walkway, not the driveway or the steps please');
  assert.deepEqual(p.services.map((s) => [s.kind, s.negated]), [['patio', false], ['walkway', false], ['driveway', true], ['stairs', true]]);
});
test('Two patios and front and back steps stay separate lines', () => {
  const patios = draftFromRequest(parseRequest('Front patio 200 sq ft. Back patio 300 sq ft.'), settings);
  assert.deepEqual(qtys(patios), ['Front patio=200', 'Back patio=300']);
  const steps = draftFromRequest(parseRequest('Can you do the front and back steps? 6 front steps and 4 back steps.'), settings);
  assert.deepEqual(qtys(steps), ['Front steps=6', 'Back steps=4']);
  const walks = draftFromRequest(parseRequest('Front walkway 4x30 and the city sidewalk 5x60. Thanks, Mike'), settings);
  assert.deepEqual(qtys(walks), ['Front walkway=4x30', 'City sidewalk=5x60']);
});
test('A size before the surface attaches to it; the next one asks', () => {
  const both = draftFromRequest(parseRequest('I have a 600 sq ft driveway and a 200 sq ft patio'), settings);
  assert.deepEqual(qtys(both), ['Driveway=600', 'Patio=200']);
  assert.equal(both.questions.length, 0);
  const d = draftFromRequest(parseRequest('We need a quote on a 600 sq ft driveway and the patio.'), settings);
  assert.deepEqual(qtys(d), ['Driveway=600', 'Patio=']);
  const q = d.questions.find((x) => x.kind === 'missing_qty');
  assert.equal(q?.lineIds[0], d.lines[1].id);
});
test('"Next steps" is not a stairs service', () => {
  const p = parseRequest('What are the next steps? The driveway is 20 by 40.');
  assert.deepEqual(p.services.map((s) => s.kind), ['driveway']);
});
test('Addresses and names are read without swallowing nearby words', () => {
  const cases: [string, string, string][] = [
    ['Hi! This is Dana Whitfield at 418 Cedar Ridge Ln. Driveway 24 x 36.', 'Dana Whitfield', '418 Cedar Ridge Ln'],
    ['I live at 1234 N Main St, Denver, CO 80202. Driveway 20x20.', '', '1234 N Main St, Denver, CO 80202'],
    ['Please quote 123 Fox Run Rd. Driveway 30x30', '', '123 Fox Run Rd'],
    ['Driveway 20x40 at 512 Maple Ave, Thanks!', '', '512 Maple Ave'],
    ['Driveway at 512 maple ave is 20x40', '', '512 maple ave'],
    ['Driveway around 1200 sq ft. Call me at 555 201 3344. Thanks! Jenny', 'Jenny', ''],
    ['Need my driveway done - Sarah 555-123-4567', 'Sarah', ''],
    ['Hey there, it\'s Rob. We have a concrete driveway.', 'Rob', ''],
    ['Driveway is 24 by 50 feet', '', ''],
    ["We're at 123 Oak St, Lehi, UT 84043", '', '123 Oak St, Lehi, UT 84043'],
    ['1420 N Maple Ave, Provo UT 84604', '', '1420 N Maple Ave, Provo UT 84604'],
    ['55 W Center St. Apt 4, Orem', '', '55 W Center St. Apt 4, Orem'],
    ['we usually have 3 cars in the drive', '', ''],
    ["I'm free after 5 at 12 Elm Street", '', '12 Elm Street'],
    ['Budget is around $400 - Sarah 555-123-4567', 'Sarah', ''],
    ['Thanks, Mike', 'Mike', ''],
  ];
  for (const [text, name, address] of cases) {
    const p = parseRequest(text);
    assert.equal(p.customer.name, name, `name in: ${text}`);
    assert.equal(p.customer.address, address, `address in: ${text}`);
  }
});
test('A per-unit amount is a question, never a budget or a price', () => {
  const p = parseRequest('Another company charged $0.15/sq ft for the driveway, 20x40.');
  assert.equal(p.budget, null);
  const q = p.questions.find((x) => x.kind === 'amount_meaning');
  assert.equal(q?.payload.label, 'per sq ft');
  const d = draftFromRequest(p, settings);
  assert.ok(d.lines.every((l) => l.price === '' && l.rateSource !== 'entered'));
});
test('Operator notes: "250 flat" is a price and "15 cents a foot" is a rate; customer mode never prices', () => {
  const flat = draftFromRequest(parseRequest('driveway twenty by forty, two fifty flat', { mode: 'operator' }), settings);
  assert.equal(flat.lines[0].qtyType, 'flat');
  assert.equal(flat.lines[0].price, '250');
  assert.equal(flat.lines[0].detail, '20 \u00D7 40 ft');
  const rates = draftFromRequest(parseRequest('patio 300 sq ft at 15 cents a foot. steps 6 at $5 a step', { mode: 'operator' }), settings);
  assert.deepEqual(rates.lines.map((l) => [l.qty, l.rate, l.rateSource, l.qtySource]), [['300', '0.15', 'entered', 'operator'], ['6', '5', 'entered', 'operator']]);
  assert.equal(rates.questions.length, 0);
  const customer = draftFromRequest(parseRequest('driveway 20 by 40, 250 flat'), settings);
  assert.ok(customer.lines.every((l) => l.price === '' && l.qtyType !== 'flat'));
  assert.equal(guessMode('driveway 20 by 40, 250 flat'), 'operator');
  assert.equal(guessMode('Hi, can you do my driveway for 250 flat?'), 'customer');
  assert.equal(guessMode('Driveway 20x40, $300?'), 'customer');
});
test('Number words are read as numbers, with the customer\'s own words kept as evidence', () => {
  const p = parseRequest('My budget is two hundred dollars for the driveway which is twelve hundred square feet');
  assert.equal(p.budget?.amount, '200');
  assert.equal(p.services[0].measure?.value, '1200');
  assert.ok(p.budget?.evidence.includes('two hundred dollars'));
});
test('A second size for one surface asks, and can replace or add a line', () => {
  const d = draftFromRequest(parseRequest('Driveway 24x50, also the driveway is about 1200 sq ft'), settings);
  const q = d.questions.find((x) => x.kind === 'extra_measure');
  assert.ok(q, 'extra measure question');
  assert.equal(q?.payload.area, '1200');
  const replaced = resolveQuestion(d, q!.id, { kind: 'replace' }, settings);
  assert.ok(replaced.ok && replaced.draft.lines[0].qty === '1200' && replaced.draft.lines[0].parts.length === 0);
  const second = resolveQuestion(d, q!.id, { kind: 'second' }, settings);
  assert.ok(second.ok && second.draft.lines.length === 2 && second.draft.lines[1].name === 'Driveway 2' && second.draft.lines[1].qty === '1200');
});
test('Combined area in sq ft is converted for a metric line', () => {
  const p = parseRequest("Can you quote our driveway and front path? It's about 1,400 square feet total.");
  const d = draftFromRequest(p, metricSettings);
  const q = d.questions.find((x) => x.kind === 'combined_area')!;
  assert.equal(q.payload.unit, 'sqm');
  assert.equal(q.payload.area, '130.06');
  const r = resolveQuestion(d, q.id, { kind: 'combine' }, metricSettings);
  assert.ok(r.ok && r.draft.lines[0].qty === '130.06');
});
test('Answered-by-editing questions close on their own; a length with no surface still asks', () => {
  const d = draftFromRequest(parseRequest('We need the patio and the walkway done.'), settings);
  assert.equal(d.questions.filter((q) => !q.resolved).length, 2);
  const sized = { ...d, lines: d.lines.map((l, i) => (i === 0 ? { ...l, qty: '200' } : l)) };
  const r1 = reconcileQuestions(sized);
  assert.equal(r1.questions.filter((q) => !q.resolved).length, 1);
  const removed = { ...r1, lines: r1.lines.slice(0, 1) };
  assert.equal(reconcileQuestions(removed).questions.filter((q) => !q.resolved).length, 0);
  assert.equal(reconcileQuestions(removed).questions[1].answer, 'Removed from the quote');
  const loose = parseRequest('About 100 linear feet of edging near the driveway and the patio');
  assert.ok(loose.questions.some((q) => q.kind === 'missing_qty' && q.serviceIdx.length === 0 && q.payload.label === '100 ft long'));
});

// ---------- Customer output privacy ----------
test('Customer output excludes every private sentinel in every format', () => {
  const d = sampleDraft(settings);
  d.costs.materials = { state: 'known_value', amount: '913.57', basis: 'visit', source: 'operator' };
  d.ownerTarget = { state: 'known_value', rate: '87.65', source: 'operator' };
  d.budget = { state: 'known_value', amount: '4321', source: 'customer', evidence: 'SENTINEL-BUDGET-EVIDENCE' };
  d.visit.parts.travel = { state: 'known_value', minutes: '777', source: 'operator' };
  d.customer.phone = '555-000-9999';
  d.customer.email = 'secret-customer@example.com';
  const c = computeQuote(d);
  const doc = buildQuoteDoc({ draft: d, calc: c, business: { name: 'Clean Co', phone: '555-111-2222', email: 'hi@clean.co', logo: null }, reference: 'Q-0042', issuedAt: 1_700_000_000_000, sample: true });
  const outputs = [renderQuoteHtml(doc), renderQuoteText(doc), quoteFileName(doc), quoteTitle(doc), quoteSmsMessage(doc), JSON.stringify(doc)];
  for (const sentinel of ['913.57', '87.65', '4,321', '4321', 'SENTINEL', '777', '555-000-9999', 'secret-customer', 'Sample customer note']) {
    for (const o of outputs) assert.ok(!o.includes(sentinel), `leaked ${sentinel}`);
  }
  assert.ok(quoteFileName(doc).includes('SAMPLE'));
  assert.ok(renderQuoteHtml(doc).includes('SAMPLE QUOTE'));
});
test('A frozen revision document is unchanged by later rate, tax and branding changes', () => {
  const d = sampleDraft(settings);
  const doc = buildQuoteDoc({ draft: d, calc: computeQuote(d), business: { name: 'Old Name', phone: '', email: '', logo: null }, reference: 'Q-0001', issuedAt: 1_700_000_000_000, sample: false });
  const frozen = JSON.stringify(doc);
  const html1 = renderQuoteHtml(JSON.parse(frozen));
  d.lines[0].rate = '0.99';
  d.pricing.tax = { state: 'known_value', rate: '9', label: 'Tax', source: 'operator' };
  const html2 = renderQuoteHtml(JSON.parse(frozen));
  assert.equal(html1, html2);
  assert.ok(html1.includes('Old Name'));
});
test('Sample quote totals', () => {
  const c = computeQuote(sampleDraft(settings));
  // 864 x 0.18 = 155.52, 120 x 0.25 = 30, 6 x 8 = 48
  assert.deepEqual(c.lines.map((l) => l.amount), [15552, 3000, 4800, 0]);
  assert.equal(c.total, 23352);
  assert.ok(c.complete, c.blocking.map((b) => b.text).join(', '));
});

// ---------- Access ----------
test('Access policy follows the ownership matrix', () => {
  assert.equal(decideAccess({ hasRevision: true, sample: false, status: 'none', freeUsed: 3 }).kind, 'revision');
  assert.equal(decideAccess({ hasRevision: false, sample: true, status: 'none', freeUsed: 3 }).kind, 'sample');
  assert.equal(decideAccess({ hasRevision: false, sample: false, status: 'active', freeUsed: 0 }).kind, 'pro');
  assert.deepEqual(decideAccess({ hasRevision: false, sample: false, status: 'expired', freeUsed: 1 }), { kind: 'free', remaining: 2 });
  assert.deepEqual(decideAccess({ hasRevision: false, sample: false, status: 'pending', freeUsed: 3 }), { kind: 'blocked', reason: 'pending' });
  assert.deepEqual(decideAccess({ hasRevision: false, sample: false, status: 'checking', freeUsed: 3 }), { kind: 'blocked', reason: 'checking' });
  assert.deepEqual(decideAccess({ hasRevision: false, sample: false, status: 'expired', freeUsed: 3 }), { kind: 'blocked', reason: 'exhausted' });
  // Offline with no free quotes left is never presented as "buy again".
  assert.deepEqual(decideAccess({ hasRevision: false, sample: false, status: 'unreachable', freeUsed: 3 }), { kind: 'blocked', reason: 'unreachable' });
  assert.deepEqual(decideAccess({ hasRevision: false, sample: false, status: 'unreachable', freeUsed: 1 }), { kind: 'free', remaining: 2 });
  // A still-valid cached verification and a billing grace period are Pro.
  assert.equal(decideAccess({ hasRevision: false, sample: false, status: 'cached', freeUsed: 3 }).kind, 'pro');
  assert.equal(decideAccess({ hasRevision: false, sample: false, status: 'grace', freeUsed: 3 }).kind, 'pro');
  // A "revision" for a different customer at a different address is a new visit, unless Pro.
  assert.equal(decideAccess({ hasRevision: true, newVisit: true, sample: false, status: 'none', freeUsed: 0 }).kind, 'new_visit');
  assert.equal(decideAccess({ hasRevision: true, newVisit: true, sample: false, status: 'active', freeUsed: 3 }).kind, 'revision');
  assert.equal(decideAccess({ hasRevision: true, newVisit: false, sample: false, status: 'none', freeUsed: 3 }).kind, 'revision');
});
test('A new visit needs both a different customer and a different address', () => {
  const was = { name: 'Sarah Jones', address: '12 Oak St' };
  assert.equal(isNewVisit(was, { name: 'Sarah Jones', address: '12 Oak Street, Unit 2' }), false);
  assert.equal(isNewVisit(was, { name: 'Sara Jones', address: '12 Oak St' }), false);
  assert.equal(isNewVisit(was, { name: 'Mike Patel', address: '90 Pine Ave' }), true);
  assert.equal(isNewVisit(was, { name: '', address: '90 Pine Ave' }), false);
  assert.equal(isNewVisit(null, { name: 'Mike Patel', address: '90 Pine Ave' }), false);
});
test('Text message for a quote uses only the customer document', () => {
  const d = sampleDraft(settings);
  d.customer.name = 'Sarah Jones';
  const doc = buildQuoteDoc({ draft: d, calc: computeQuote(d), business: { name: 'Clean Co', phone: '', email: '', logo: null }, reference: 'Q-0007', issuedAt: 1_700_000_000_000, sample: false });
  const msg = quoteSmsMessage(doc);
  assert.ok(msg.startsWith('Hi Sarah, here'), msg);
  assert.ok(msg.includes(money(doc.total)), msg);
  assert.ok(msg.endsWith('Reply YES to book. - Clean Co'), msg);
  assert.equal(smsAddress(' (555) 123-4567 '), '5551234567');
  assert.equal(smsAddress('+1 555 123 4567'), '+15551234567');
  assert.equal(smsAddress('call me'), null);
  assert.equal(smsAddress('12345'), null);
});

// ---------- Built-in services beyond flatwork ----------
const NEW_KINDS = [
  { kind: 'house', name: 'House wash', unit: 'sqft', qty: '2400', rate: '0.15', cents: 36000 },
  { kind: 'roof', name: 'Roof', unit: 'sqft', qty: '2000', rate: '0.35', cents: 70000 },
  { kind: 'deck', name: 'Deck', unit: 'sqft', qty: '192', rate: '0.75', cents: 14400 },
  { kind: 'fence', name: 'Fence', unit: 'ft', qty: '150', rate: '1.25', cents: 18750 },
  { kind: 'gutters', name: 'Gutters', unit: 'ft', qty: '160', rate: '1.10', cents: 17600 },
] as const;
for (const k of NEW_KINDS) {
  test(`${k.name}: blank by default, priced from the operator's rate, flat price allowed, on the quote`, () => {
    assert.equal(settings.rates[k.kind].rate, '', 'no suggested rate');
    const blank = newLine(k.kind, settings);
    assert.equal(blank.unit, k.unit);
    assert.equal(blank.rate, '');
    const d = newDraft(settings);
    d.lines = [{ ...newLine(k.kind, settings), qty: k.qty, rate: k.rate }];
    const calc = computeQuote(d);
    assert.equal(calc.lines[0].amount, k.cents);
    const doc = buildQuoteDoc({ draft: d, calc, business: { name: 'Clean Co', phone: '', email: '', logo: null }, reference: 'Q-0009', issuedAt: 1_700_000_000_000, sample: false });
    assert.ok(doc.lines.some((l) => l.name === k.name && l.amount === k.cents), 'line on the quote');
    assert.ok(renderQuoteText(doc).includes(k.name));
    const flat = newDraft(settings);
    flat.lines = [{ ...newLine(k.kind, settings), qtyType: 'flat', qty: '', price: '425' }];
    assert.equal(computeQuote(flat).lines[0].amount, 42500);
  });
}
test('"House wash and roof, 2 story about 2400 sq ft" asks what the size describes', () => {
  const p = parseRequest('Need house wash and roof cleaned, 2 story about 2400 sq ft');
  const d = draftFromRequest(p, settings);
  const house = d.lines.find((l) => l.kind === 'house');
  const roof = d.lines.find((l) => l.kind === 'roof');
  assert.ok(house && roof, 'both services');
  assert.ok(!house!.qty && !roof!.qty && !house!.parts.length && !roof!.parts.length, 'neither is sized');
  const q = d.questions.find((x) => x.kind === 'size_meaning');
  assert.ok(q && q.prompt === 'What does 2,400 sq ft describe?', q?.prompt);
  assert.ok(q!.lineIds.includes(house!.id) && q!.lineIds.includes(roof!.id));
  assert.ok(!computeQuote(d).complete);
  // Use it for one line only.
  const used = resolveQuestion(d, q!.id, { kind: 'use_for', lineId: roof!.id }, settings);
  assert.ok(used.ok);
  if (used.ok) {
    assert.equal(used.draft.lines.find((l) => l.kind === 'roof')?.qty, '2400');
    assert.equal(used.draft.lines.find((l) => l.kind === 'house')?.qty, '');
  }
  // Or keep it as the home's size: a private note, no line sized.
  const noted = resolveQuestion(d, q!.id, { kind: 'note' }, settings);
  assert.ok(noted.ok && noted.privateNote?.includes('2,400 sq ft'), noted.ok ? noted.privateNote : 'failed');
  if (noted.ok) assert.ok(noted.draft.lines.every((l) => !l.qty));
});
test('A size said to be the roof or the siding is used for it', () => {
  const roof = draftFromRequest(parseRequest('Soft wash the roof please, roof is about 2000 sq ft'), settings);
  assert.equal(roof.lines.length, 1, 'soft wash of a roof is not a house wash');
  assert.equal(roof.lines[0].kind, 'roof');
  assert.equal(roof.lines[0].qty, '2000');
  const siding = draftFromRequest(parseRequest('House wash, siding is around 3000 sq ft'), settings);
  assert.equal(siding.lines.length, 1);
  assert.equal(siding.lines[0].qty, '3000');
});
test('A loose size with only a house wash is still asked, never assumed', () => {
  const d = draftFromRequest(parseRequest('Can you wash the house? It is about 2400 sq ft.'), settings);
  assert.equal(d.lines.length, 1);
  assert.equal(d.lines[0].kind, 'house');
  assert.equal(d.lines[0].qty, '');
  assert.ok(d.questions.some((q) => q.kind === 'size_meaning'));
});
test('Fence and gutters read lengths, not heights', () => {
  const d = draftFromRequest(parseRequest('Can you clean about 150 ft of 6 ft privacy fence and the gutters, around 180 feet'), settings);
  const fence = d.lines.find((l) => l.kind === 'fence');
  const gutters = d.lines.find((l) => l.kind === 'gutters');
  assert.equal(fence?.qty, '150');
  assert.equal(fence?.unit, 'ft');
  assert.equal(gutters?.qty, '180');
  assert.equal(d.questions.filter((q) => !q.resolved).length, 0, JSON.stringify(d.questions.map((q) => q.prompt)));
});
test('Deck stairs stay stairs and a pool deck stays a patio', () => {
  const d = draftFromRequest(parseRequest('We need our deck stairs and deck cleaned, and the wood deck 12x16. Pool deck too.'), settings);
  assert.ok(d.lines.some((l) => l.kind === 'stairs'));
  assert.ok(d.lines.some((l) => l.kind === 'patio' && /pool deck/i.test(l.name)));
  const deck = d.lines.filter((l) => l.kind === 'deck');
  assert.ok(deck.length >= 1);
  assert.ok(deck.some((l) => l.parts[0]?.a === '12' && l.parts[0]?.b === '16'));
});
test('"two walkways, one 3x30 and one 4x25" makes Walkway 2', () => {
  const d = draftFromRequest(parseRequest('driveway (20x40) and two walkways, one 3x30 and one 4x25'), settings);
  assert.equal(d.lines.length, 3);
  assert.equal(d.lines[0].parts[0]?.a, '20');
  const w1 = d.lines.find((l) => l.name === 'Walkway');
  const w2 = d.lines.find((l) => l.name === 'Walkway 2');
  assert.ok(w1 && w2, d.lines.map((l) => l.name).join(', '));
  assert.equal(`${w1!.parts[0]?.a}x${w1!.parts[0]?.b}`, '3x30');
  assert.equal(`${w2!.parts[0]?.a}x${w2!.parts[0]?.b}`, '4x25');
  assert.equal(w2!.kind, 'walkway');
  assert.equal(d.questions.filter((q) => q.kind === 'combined_area').length, 0);
  const plain = draftFromRequest(parseRequest('Two walkways, 3x30 and 4x25'), settings);
  assert.equal(plain.lines.filter((l) => l.kind === 'walkway').length, 2);
  // One driveway with two sizes is still asked about, not split into two driveways.
  const one = draftFromRequest(parseRequest('Driveway is 20x40 and 10x12'), settings);
  assert.equal(one.lines.filter((l) => l.kind === 'driveway').length, 1);
});
test('Operator notes for the new services set the rate', () => {
  assert.equal(guessMode('roof 2400 sq ft at 30 cents a foot'), 'operator');
  const d = draftFromRequest(parseRequest('roof 2400 sq ft at 30 cents a foot', { mode: 'operator' }), settings);
  assert.equal(d.lines[0].kind, 'roof');
  assert.equal(d.lines[0].qty, '2400');
  assert.equal(computeQuote(d).lines[0].amount, 72000);
  const f = draftFromRequest(parseRequest('fence 150 linear ft at 1.25 a foot', { mode: 'operator' }), settings);
  assert.equal(computeQuote(f).lines[0].amount, 18750);
});

test('Formatting', () => {
  assert.equal(money(142220), '$1,422.20');
  assert.equal(money(-3333), '\u2212$33.33');
  assert.equal(quoteReference(7, 1), 'Q-0007');
  assert.equal(quoteReference(7, 2), 'Q-0007-R2');
});

if (failures.length) {
  console.error(`\n${failures.length} failed, ${passed} passed\n`);
  for (const f of failures) console.error(`  \u2717 ${f}\n`);
  throw new Error('Fixture tests failed');
}
console.log(`All ${passed} fixture tests passed (USD_V1).`);
