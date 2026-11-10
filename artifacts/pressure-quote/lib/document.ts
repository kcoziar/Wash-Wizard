import { centsToInput, date, money } from './format';
import { isSafeLogo } from './logo';
import type { Calc } from './pricing';
import type { Draft, QuoteDoc, Settings } from './types';

/**
 * Builds the customer-facing quote from an explicit allowlist. Costs, time,
 * owner pay, margin, budget, private notes and the original request are never
 * copied into this model, so they cannot reach the PDF, text, file name or share title.
 */
export function buildQuoteDoc(args: {
  draft: Draft;
  calc: Calc;
  business: Settings['business'];
  reference: string;
  issuedAt: number;
  sample: boolean;
}): QuoteDoc {
  const { draft, calc, business, reference, issuedAt, sample } = args;
  const days = parseInt(draft.validDays, 10);
  const taxRate = calc.tax.rate ? `${calc.tax.rate.toString()}%` : '';
  return {
    v: 1,
    sample,
    reference,
    issuedAt,
    validUntil: Number.isFinite(days) && days > 0 ? issuedAt + days * 86_400_000 : null,
    business: {
      name: business.name.trim(),
      phone: business.phone.trim(),
      email: business.email.trim(),
      logo: isSafeLogo(business.logo) ? business.logo : null,
    },
    customer: { name: draft.customer.name.trim(), address: draft.customer.address.trim() },
    lines: calc.lines.map((l) => ({
      name: l.name,
      detail: l.detail,
      qty: l.qtyLabel,
      amount: l.amount,
      included: l.treatment === 'free',
    })),
    excluded: calc.excluded.map((e) => e.name),
    subtotal: calc.linesTotal,
    minimumAdjustment: calc.minimum.adjustment,
    discount: calc.discount.applied > 0 ? { label: calc.discount.label, amount: calc.discount.applied } : null,
    tax: calc.tax.rate && calc.tax.amount > 0 ? { label: `${calc.tax.label} (${taxRate})`, amount: calc.tax.amount } : null,
    total: calc.total,
    deposit: calc.deposit && calc.deposit.amount > 0 ? { ...calc.deposit } : null,
    notes: draft.customerNote.trim(),
    terms: draft.terms.trim(),
  };
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const nl2br = (s: string) => escapeHtml(s).replace(/\n/g, '<br/>');

export function quoteTitle(doc: QuoteDoc): string {
  return `Quote ${doc.reference}`;
}

export function quoteFileName(doc: QuoteDoc): string {
  const ref = doc.reference.replace(/[^A-Za-z0-9-]/g, '');
  return `Quote ${ref}${doc.sample ? ' SAMPLE' : ''}.pdf`;
}

function listJoin(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** The short text that goes with a quote sent from Messages. Uses only the customer document. */
export function quoteSmsMessage(doc: QuoteDoc): string {
  const first = doc.customer.name.trim().split(/\s+/)[0] ?? '';
  const names = Array.from(new Set(doc.lines.map((l) => l.name.trim().toLowerCase()).filter(Boolean)));
  const services = names.length > 4 ? `${names.slice(0, 3).join(', ')} and more` : listJoin(names);
  const greeting = first ? `Hi ${first}, here's` : "Hi, here's";
  const scope = services ? ` for ${services}` : '';
  const sign = doc.business.name.trim() ? ` - ${doc.business.name.trim()}` : '';
  return `${greeting} your quote${scope}: ${money(doc.total)}. Reply YES to book.${sign}`;
}

export function renderQuoteHtml(doc: QuoteDoc): string {
  const b = doc.business;
  const rows = doc.lines
    .map(
      (l) => `<tr>
        <td><div class="svc">${escapeHtml(l.name)}</div>${l.detail ? `<div class="muted small">${nl2br(l.detail)}</div>` : ''}</td>
        <td class="qty">${escapeHtml(l.qty)}</td>
        <td class="amt">${l.included ? '<span class="incl">Included</span>' : escapeHtml(money(l.amount))}</td>
      </tr>`,
    )
    .join('');
  const totals: string[] = [];
  totals.push(`<div class="row"><span>Services</span><span>${escapeHtml(money(doc.subtotal))}</span></div>`);
  if (doc.minimumAdjustment > 0) totals.push(`<div class="row"><span>Job minimum adjustment</span><span>${escapeHtml(money(doc.minimumAdjustment))}</span></div>`);
  if (doc.discount) totals.push(`<div class="row"><span>${escapeHtml(doc.discount.label)}</span><span>${escapeHtml(money(-doc.discount.amount))}</span></div>`);
  if (doc.tax) totals.push(`<div class="row"><span>${escapeHtml(doc.tax.label)}</span><span>${escapeHtml(money(doc.tax.amount))}</span></div>`);
  totals.push(`<div class="row grand"><span>Total</span><span>${escapeHtml(money(doc.total))}</span></div>`);
  if (doc.deposit) {
    totals.push(`<div class="row dep"><span>Deposit due to book</span><span>${escapeHtml(money(doc.deposit.amount))}</span></div>`);
    totals.push(`<div class="row"><span>Balance on completion</span><span>${escapeHtml(money(doc.deposit.balance))}</span></div>`);
  }
  const contact = [b.phone, b.email].filter(Boolean).map(escapeHtml).join(' &nbsp;&middot;&nbsp; ');
  // Checked again here: a stored or imported document is never trusted to carry markup.
  const logo = isSafeLogo(b.logo) ? `<img class="logo" src="${b.logo}" alt="" />` : '';
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
  @page { margin: 0; }
  html, body { background: #FFFFFF; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #16181B; font-size: 12px; line-height: 1.45; margin: 0; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 18px; border-bottom: 3px solid #16181B; }
  .brand { display: flex; align-items: center; gap: 12px; }
  .logo { width: 52px; height: 52px; border-radius: 10px; object-fit: cover; }
  .biz { font-size: 19px; font-weight: 700; letter-spacing: -0.2px; }
  .muted { color: #5C6166; }
  .small { font-size: 11px; }
  .label { font-size: 9px; letter-spacing: 1.4px; text-transform: uppercase; color: #5C6166; font-weight: 600; }
  .title { text-align: right; }
  .title h1 { font-size: 28px; margin: 0; letter-spacing: -0.6px; font-weight: 800; }
  .bar { display: inline-block; width: 34px; height: 4px; background: #8FB31A; border-radius: 2px; margin-bottom: 6px; }
  .meta { display: flex; justify-content: space-between; margin-top: 18px; gap: 24px; }
  .meta .block { flex: 1; }
  .meta .value { font-size: 13px; font-weight: 600; margin-top: 3px; }
  table { width: 100%; border-collapse: collapse; margin-top: 22px; }
  th { text-align: left; font-size: 9px; letter-spacing: 1.2px; text-transform: uppercase; color: #5C6166; border-bottom: 1px solid #CFCBC2; padding: 0 0 7px 0; font-weight: 600; }
  th.amt, td.amt { text-align: right; }
  td { padding: 11px 0; border-bottom: 1px solid #E7E3DB; vertical-align: top; }
  td.qty { color: #5C6166; white-space: nowrap; padding-right: 16px; }
  td.amt { white-space: nowrap; font-variant-numeric: tabular-nums; font-weight: 600; }
  .svc { font-weight: 600; font-size: 13px; }
  .incl { font-weight: 600; color: #4E6B0E; }
  .excl { margin-top: 14px; padding: 10px 12px; background: #F4F2ED; border-radius: 8px; }
  .totals { margin-left: auto; width: 58%; margin-top: 16px; }
  .totals .row { display: flex; justify-content: space-between; padding: 4px 0; font-variant-numeric: tabular-nums; }
  .totals .grand { border-top: 2px solid #16181B; margin-top: 8px; padding-top: 10px; font-size: 18px; font-weight: 800; }
  .totals .dep { margin-top: 8px; font-weight: 600; }
  .section { margin-top: 26px; }
  .section p { margin: 6px 0 0 0; }
  .foot { margin-top: 30px; padding-top: 12px; border-top: 1px solid #E7E3DB; display: flex; justify-content: space-between; }
  .sample { position: fixed; top: 38%; left: -10%; right: -10%; text-align: center; font-size: 70px; font-weight: 900; color: rgba(22,24,27,0.07); transform: rotate(-22deg); letter-spacing: 6px; }
</style></head><body>
${doc.sample ? '<div class="sample">SAMPLE QUOTE</div>' : ''}
<div class="top">
  <div class="brand">${logo}<div><div class="biz">${escapeHtml(b.name || 'Your quote')}</div>${contact ? `<div class="muted small">${contact}</div>` : ''}</div></div>
  <div class="title"><div class="bar"></div><h1>Quote</h1><div class="muted">${escapeHtml(doc.reference)}</div></div>
</div>
<div class="meta">
  <div class="block"><div class="label">Prepared for</div><div class="value">${escapeHtml(doc.customer.name || 'Customer')}</div>${doc.customer.address ? `<div class="muted">${escapeHtml(doc.customer.address)}</div>` : ''}</div>
  <div class="block"><div class="label">Date</div><div class="value">${escapeHtml(date(doc.issuedAt))}</div></div>
  <div class="block"><div class="label">Valid until</div><div class="value">${escapeHtml(doc.validUntil ? date(doc.validUntil) : 'On request')}</div></div>
</div>
<table><thead><tr><th>Service</th><th>Area / qty</th><th class="amt">Amount</th></tr></thead><tbody>${rows}</tbody></table>
${doc.excluded.length ? `<div class="excl"><span class="label">Not included</span><div>${doc.excluded.map(escapeHtml).join(', ')}</div></div>` : ''}
<div class="totals">${totals.join('')}</div>
${doc.notes ? `<div class="section"><div class="label">Notes</div><p>${nl2br(doc.notes)}</p></div>` : ''}
${doc.terms ? `<div class="section"><div class="label">Terms</div><p class="muted">${nl2br(doc.terms)}</p></div>` : ''}
<div class="foot"><span class="muted small">${escapeHtml(b.name)}</span><span class="muted small">${escapeHtml(doc.reference)}</span></div>
</body></html>`;
}

export function renderQuoteText(doc: QuoteDoc): string {
  const out: string[] = [];
  const b = doc.business;
  if (doc.sample) out.push('SAMPLE QUOTE - not a real quote', '');
  out.push(`Quote ${doc.reference}${b.name ? ` from ${b.name}` : ''}`);
  if (doc.customer.name || doc.customer.address) out.push(`Prepared for: ${[doc.customer.name, doc.customer.address].filter(Boolean).join(', ')}`);
  out.push(`Date: ${date(doc.issuedAt)}${doc.validUntil ? ` - valid until ${date(doc.validUntil)}` : ''}`, '');
  for (const l of doc.lines) {
    out.push(`${l.name}${l.qty ? ` (${l.qty})` : ''}: ${l.included ? 'Included' : money(l.amount)}`);
    if (l.detail) out.push(`  ${l.detail}`);
  }
  if (doc.excluded.length) out.push(`Not included: ${doc.excluded.join(', ')}`);
  out.push('', `Services: ${money(doc.subtotal)}`);
  if (doc.minimumAdjustment > 0) out.push(`Job minimum adjustment: ${money(doc.minimumAdjustment)}`);
  if (doc.discount) out.push(`${doc.discount.label}: ${money(-doc.discount.amount)}`);
  if (doc.tax) out.push(`${doc.tax.label}: ${money(doc.tax.amount)}`);
  out.push(`Total: ${money(doc.total)}`);
  if (doc.deposit) out.push(`Deposit due to book: ${money(doc.deposit.amount)}`, `Balance on completion: ${money(doc.deposit.balance)}`);
  if (doc.notes) out.push('', doc.notes);
  if (doc.terms) out.push('', `Terms: ${doc.terms}`);
  const contact = [b.name, b.phone, b.email].filter(Boolean).join(' - ');
  if (contact) out.push('', contact);
  return out.join('\n');
}

export function docTotalInput(doc: QuoteDoc): string {
  return centsToInput(doc.total);
}
