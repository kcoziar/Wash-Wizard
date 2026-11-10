/**
 * Real-world message corpus: the kind of texts operators paste in. Each case lists what a careful
 * person would read from it. Prints the pass rate; any miss fails the suite.
 * Run: pnpm --filter @workspace/pressure-quote run test:code
 */
import { defaultSettings } from '../lib/defaults';
import { lineQuantity } from '../lib/geometry';
import { draftFromRequest, parseRequest, type RequestMode } from '../lib/parser';
import type { Draft } from '../lib/types';

type Case = {
  text: string;
  mode?: RequestMode;
  /** Every line on the draft, in order, as "kind" or "kind=qty" when a size is expected. */
  lines: string[];
  name?: string;
  phone?: string;
  /** Question kinds that must be asked. */
  asks?: string[];
  /** Operator mode: the price or rate on the first line. */
  price?: string;
  rate?: string;
};

const CASES: Case[] = [
  // Plain requests with sizes
  { text: 'Hi, can I get a quote to pressure wash my driveway? Its about 600 sq ft. Thanks, Jim', lines: ['driveway=600'], name: 'Jim' },
  { text: 'Driveway is 20x40 and the patio is 15 by 20. 555-310-2211', lines: ['driveway=800', 'patio=300'], phone: '555-310-2211' },
  { text: 'Need my back patio cleaned, roughly 12 x 16', lines: ['patio=192'] },
  { text: 'How much for 1,200 square feet of driveway?', lines: ['driveway=1200'] },
  { text: 'Looking to get the front walkway done, 4 ft wide and 40 ft long', lines: ['walkway=160'] },
  { text: 'Could you do the sidewalk out front? About 3x50', lines: ['walkway=150'] },
  { text: 'Pool deck about 800 sq ft, pretty green', lines: ['patio=800'] },
  { text: 'twenty by forty driveway please', lines: ['driveway=800'] },
  { text: 'Our deck is 12x20 and needs a wash before we stain it', lines: ['deck=240'] },
  { text: 'Wood fence along the back, about 120 feet. Can you clean it?', lines: ['fence=120'] },
  { text: 'House wash for a 2,000 sq ft rancher, vinyl siding', lines: ['house'], asks: ['size_meaning'] },
  { text: 'Need gutters cleaned on a one story house, about 150 linear feet', lines: ['gutters=150'] },
  { text: 'Can you soft wash our roof? It has black streaks', lines: ['roof'], asks: ['missing_qty'] },
  // Stairs and counts
  { text: 'Front steps, 6 of them, and the driveway 24x36', lines: ['stairs=6', 'driveway=864'] },
  { text: 'Driveway plus 3 steps up to the porch', lines: ['driveway', 'stairs=3'], asks: ['missing_qty'] },
  { text: 'What are the next steps to book a driveway cleaning?', lines: ['driveway'], asks: ['missing_qty'] },
  // No sizes: questions, never invented numbers
  { text: 'Hi! Wondering what you charge for a driveway and patio. Thanks!', lines: ['driveway', 'patio'], asks: ['missing_qty'] },
  { text: 'Can you clean my 2 car driveway?', lines: ['driveway'], asks: ['missing_qty'] },
  { text: 'Double driveway and a small walkway', lines: ['driveway', 'walkway'], asks: ['missing_qty'] },
  { text: 'Just the fence please, both sides', lines: ['fence'], asks: ['missing_qty'] },
  // Combined and ambiguous areas
  { text: 'Driveway and walkway together about 1,000 sq ft', lines: ['driveway', 'walkway'], asks: ['combined_area'] },
  { text: 'About 900 square feet total', lines: [], asks: ['combined_area'] },
  // Exclusions and negation
  { text: 'Driveway 30x40 but not the patio', lines: ['driveway=1200', 'patio'], asks: ['scope'] },
  { text: 'Patio 20x20 minus the 4x4 hot tub pad', lines: ['patio=384'] },
  { text: "Please skip the steps, just do the driveway 600 sq ft", lines: ['stairs', 'driveway=600'], asks: ['scope'] },
  // Budgets are never prices
  { text: 'Driveway 20x30, hoping to keep it under $200', lines: ['driveway=600'] },
  { text: 'Patio 400 sq ft. My budget is 150', lines: ['patio=400'] },
  // Contact details
  { text: 'This is Sarah Jones, 512 Maple Ave. Driveway 25x40. Call 555-201-3344', lines: ['driveway=1000'], name: 'Sarah Jones', phone: '555-201-3344' },
  { text: 'Hey its Mike, need the patio washed 16x20. mike.p@example.com', lines: ['patio=320'], name: 'Mike' },
  { text: 'Driveway 600 sq ft. Thanks, Jose', lines: ['driveway=600'], name: 'Jose' },
  // Typing slips and casual text
  { text: 'drivway 20x40 pls', lines: ['driveway=800'] },
  { text: 'need driveway done asap its like 25 by 50', lines: ['driveway=1250'] },
  { text: 'patio + walkway, patio 15x15, walkway 3x30', lines: ['patio=225', 'walkway=90'] },
  // Other services
  { text: 'Driveway 20x40 and can you also do the windows?', lines: ['driveway=800'], asks: ['other_service'] },
  { text: 'Need the curb and the retaining wall washed', lines: [], asks: ['other_service'] },
  // Metric and mixed units
  { text: 'Patio 5m x 6m', lines: ['patio=322.92'] },
  // Spanish basics
  { text: 'Hola, la entrada de 20 por 40 pies y 5 escalones. Gracias, Maria 555-201-3344', lines: ['driveway=800', 'stairs=5'], name: 'Maria', phone: '555-201-3344' },
  { text: 'Cuanto por lavar el patio de 300 pies cuadrados?', lines: ['patio=300'] },
  { text: 'Necesito lavar la banqueta, 3 por 30 pies', lines: ['walkway=90'] },
  // Operator notes
  { text: 'driveway 20x40 at .22', mode: 'operator', lines: ['driveway=800'], rate: '0.22' },
  { text: 'patio 300 sq ft 250 flat', mode: 'operator', lines: ['patio'], price: '250' },
  { text: 'driveway 24x36 @ 0.18, 10% off', mode: 'operator', lines: ['driveway=864'], rate: '0.18' },
  { text: 'fence 120 ft at 1.50', mode: 'operator', lines: ['fence=120'], rate: '1.50' },
  { text: 'steps 8 at 6 each', mode: 'operator', lines: ['stairs=8'], rate: '6' },
  { text: 'house wash for 350', mode: 'operator', lines: ['house'], price: '350' },
];

const settings = defaultSettings();

function lineSummary(d: Draft): string[] {
  return d.lines.map((l) => {
    const q = l.qtyType === 'flat' ? null : lineQuantity(l).qty;
    return q && !q.isZero() ? `${l.kind}=${q.round(2).toString()}` : l.kind;
  });
}

let passed = 0;
const misses: string[] = [];
for (const c of CASES) {
  const parsed = parseRequest(c.text, { units: 'imperial', mode: c.mode ?? 'customer' });
  const draft = draftFromRequest(parsed, settings);
  const got = lineSummary(draft);
  const problems: string[] = [];
  const want = c.lines.map((w) => (w.includes('=') ? w : `${w}`));
  const gotCmp = got.map((g, i) => (want[i] && !want[i].includes('=') ? g.split('=')[0] : g));
  if (JSON.stringify(gotCmp) !== JSON.stringify(want)) problems.push(`lines ${JSON.stringify(got)} (want ${JSON.stringify(want)})`);
  if (c.name !== undefined && parsed.customer.name !== c.name) problems.push(`name "${parsed.customer.name}" (want "${c.name}")`);
  if (c.phone !== undefined && parsed.customer.phone !== c.phone) problems.push(`phone "${parsed.customer.phone}"`);
  for (const k of c.asks ?? []) if (!draft.questions.some((q) => q.kind === k)) problems.push(`no ${k} question (asked: ${draft.questions.map((q) => q.kind).join(', ') || 'none'})`);
  if (c.price !== undefined && draft.lines[0]?.price !== c.price) problems.push(`price "${draft.lines[0]?.price}"`);
  if (c.rate !== undefined && Number(draft.lines[0]?.rate) !== Number(c.rate)) problems.push(`rate "${draft.lines[0]?.rate}"`);
  if (problems.length) misses.push(`${c.text}\n    ${problems.join('\n    ')}`);
  else passed++;
}

const pct = Math.round((passed / CASES.length) * 1000) / 10;
if (misses.length) {
  console.error(`Message corpus: ${passed} of ${CASES.length} read correctly (${pct}%).\n`);
  for (const m of misses) console.error(`  \u2717 ${m}\n`);
  throw new Error('Message corpus has misses');
}
console.log(`Message corpus: all ${CASES.length} messages read correctly (${pct}%).`);
