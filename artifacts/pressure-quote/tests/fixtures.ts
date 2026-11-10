/**
 * Frozen USD_V1 fixtures (foundation section 15) plus property checks.
 * Run: pnpm --filter @workspace/pressure-quote run test
 */
import { Dec } from '../lib/decimal';
import { partsTotal, sqftToSqm } from '../lib/geometry';
import { allocate, computeQuote } from '../lib/pricing';
import { computeEconomics, marginOf, priceForMargin, priceForMarkup, supportedMinutes } from '../lib/economics';
import { defaultSettings, newDraft, newLine, sampleDraft } from '../lib/defaults';
import { draftFromRequest, parseRequest } from '../lib/parser';
import { confirmQuantities, jobIssues, resolveQuestion } from '../lib/resolve';
import { buildQuoteDoc, quoteFileName, quoteTitle, renderQuoteHtml, renderQuoteText } from '../lib/document';
import { decideAccess } from '../lib/access';
import { money, quoteReference } from '../lib/format';
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
  assert.ok(p.questions.some((q) => q.kind === 'other_service' && q.payload.label === 'Deck'));
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
  const doc = buildQuoteDoc({ draft: d, calc: c, business: { name: 'Clean Co', phone: '555-111-2222', email: 'hi@clean.co', logo: null }, reference: 'Q-0042', issuedAt: Date.now(), sample: true });
  const outputs = [renderQuoteHtml(doc), renderQuoteText(doc), quoteFileName(doc), quoteTitle(doc), JSON.stringify(doc)];
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
