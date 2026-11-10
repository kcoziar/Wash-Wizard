/**
 * The hosted privacy policy, terms of use and support pages, rendered from the same text the app
 * shows (constants/legal.ts). `pnpm run legal:pages` writes them to server/pages/, and the
 * published site serves them at /privacy, /terms and /support. A test fails if they drift.
 */
import colors from '../constants/colors';
import {
  APP_NAME,
  APPLE_EULA_URL,
  COMPANY,
  LEGAL_UPDATED,
  MANAGE_SUBSCRIPTIONS_URL,
  PRIVACY,
  PUBLISHER_SUPPORT_URL,
  SUPPORT_EMAIL,
  SUPPORT_FAQ,
  TERMS,
  type LegalSection,
} from '../constants/legal';

export type LegalPage = 'privacy' | 'terms' | 'support' | 'index';
/** Served pages. "index" is the plain product page at the site root. */
export const LEGAL_PAGES: LegalPage[] = ['privacy', 'terms', 'support', 'index'];

const c = colors.light;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Escapes text, then turns the support email and bare web addresses into links. */
function linkify(s: string): string {
  return esc(s)
    .replace(new RegExp(SUPPORT_EMAIL.replace(/\./g, '\\.'), 'g'), `<a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>`)
    .replace(/\b((?:revenuecat\.com|reportaproblem\.apple\.com)(?:\/[a-z]+)?)/g, '<a href="https://$1">$1</a>');
}

const sections = (list: LegalSection[]) => list.map((s) => `<section><h2>${esc(s.title)}</h2><p>${linkify(s.body)}</p></section>`).join('\n');

const NAV: { page: LegalPage; label: string }[] = [
  { page: 'support', label: 'Support' },
  { page: 'privacy', label: 'Privacy' },
  { page: 'terms', label: 'Terms' },
];

function shell(page: LegalPage, title: string, lede: string, body: string): string {
  const nav = NAV.map((n) => (n.page === page ? `<span aria-current="page">${n.label}</span>` : `<a href="/${n.page}">${n.label}</a>`)).join('');
  const brand = page === 'index' ? esc(APP_NAME) : `<a href="/">${esc(APP_NAME)}</a>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | ${esc(APP_NAME)}</title>
<meta name="description" content="${esc(lede)}">
<style>
*{box-sizing:border-box}
body{margin:0;background:${c.background};color:${c.foreground};font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;-webkit-font-smoothing:antialiased}
header{background:${c.hero};color:${c.heroForeground};padding:28px 20px 30px;border-bottom:4px solid ${c.accent}}
.wrap{max-width:720px;margin:0 auto}
.app a{color:inherit;text-decoration:none}
.app{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:${c.heroMuted};margin:0 0 6px}
h1{font-size:30px;line-height:1.15;margin:0 0 8px}
.lede{margin:0;color:${c.heroMuted}}
nav{display:flex;gap:18px;margin-top:18px;font-size:15px}
nav a{color:${c.heroForeground}}
nav span{color:${c.accent};font-weight:600}
main{padding:24px 20px 48px}
.card{background:${c.card};border:1px solid ${c.border};border-radius:${colors.radius}px;padding:22px 22px 8px;margin-bottom:18px}
h2{font-size:18px;margin:0 0 6px}
section{margin-bottom:20px}
p{margin:0}
a{color:inherit;text-decoration-thickness:1px;text-underline-offset:3px}
.updated{font-size:14px;color:${c.mutedForeground};margin:0 0 16px}
.contact{font-size:18px;font-weight:600}
footer{font-size:14px;color:${c.mutedForeground};padding:0 20px 40px}
</style>
</head>
<body>
<header><div class="wrap">
<p class="app">${brand}</p>
<h1>${esc(title)}</h1>
<p class="lede">${esc(lede)}</p>
<nav aria-label="Pages">${nav}</nav>
</div></header>
<main><div class="wrap">
${body}
</div></main>
<footer><div class="wrap">&copy; ${esc(COMPANY)}. <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></div></footer>
</body>
</html>
`;
}

export function renderLegalPage(page: LegalPage): string {
  if (page === 'index') {
    const feature = (title: string, body: string) => `<section><h2>${esc(title)}</h2><p>${esc(body)}</p></section>`;
    return shell(
      page,
      'Quotes from customer texts',
      'An iPhone app for pressure washing operators.',
      `<div class="card">
${feature('Paste the message, get the quote', 'Paste the text a customer sent you. The app picks out the services, sizes, name and address, and asks you about anything it cannot be sure of. It never guesses a size or turns a budget into a price.')}
${feature('Your own prices', 'Your rates per square foot, per linear foot, per step, by the hour or a flat price. Minimum charge, trip fee, discount, tax and deposit.')}
${feature('Send it', 'Share a clean PDF quote or text it from Messages, then mark it Sent, Accepted or Declined.')}
${feature('Your data stays with you', 'No account. Jobs and customer details stay on your iPhone.')}
${feature('Price', 'Three complete quotes free. Pro is $9.99 a month or $59.99 a year, billed by Apple. Cancel any time in your Apple account.')}
</div>`,
    );
  }
  if (page === 'privacy') {
    return shell(page, 'Privacy policy', 'Your jobs and customers stay on your iPhone.', `<p class="updated">Updated ${esc(LEGAL_UPDATED)}</p>\n<div class="card">\n${sections(PRIVACY)}\n</div>`);
  }
  if (page === 'terms') {
    const eula = `<section><h2>Apple\u2019s license agreement</h2><p>Read Apple\u2019s <a href="${APPLE_EULA_URL}">Standard Licensed Application End User License Agreement</a>.</p></section>`;
    return shell(page, 'Terms of use', 'The terms for using the app and the Pro subscription.', `<p class="updated">Updated ${esc(LEGAL_UPDATED)}</p>\n<div class="card">\n${sections(TERMS)}\n${eula}\n</div>`);
  }
  const contact = `<div class="card">
<section><h2>Contact us</h2><p class="contact"><a href="mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`${APP_NAME} support`)}">${SUPPORT_EMAIL}</a></p></section>
<section><p>A real person reads every message. Tell us what you were doing and which iPhone and iOS version you use. Please leave out your customers\u2019 details. Emailing from the app (Settings \u203A Support) adds the app version and your purchase ID for you.</p></section>
</div>`;
  const faq = `<div class="card">\n${SUPPORT_FAQ.map((f) => `<section><h2>${esc(f.q)}</h2><p>${linkify(f.a)}</p></section>`).join('\n')}\n</div>`;
  const more = `<div class="card">
<section><h2>Subscriptions</h2><p>Pro is billed by Apple. <a href="${MANAGE_SUBSCRIPTIONS_URL}">Manage or cancel your subscription</a> from your Apple account.</p></section>
<section><h2>More from ${esc(COMPANY)}</h2><p>Privacy requests, business inquiries and our other apps: <a href="${PUBLISHER_SUPPORT_URL}">kozipublishing.com/support</a>.</p></section>
</div>`;
  return shell(page, 'Support', 'Help with quotes, backups and Pro.', `${contact}\n${faq}\n${more}`);
}
