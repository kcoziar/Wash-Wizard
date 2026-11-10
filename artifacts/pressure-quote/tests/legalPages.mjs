/**
 * The hosted pages must match the text built into the app, and the server must route to them.
 * Run: pnpm --filter @workspace/pressure-quote run test:code
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEGAL_PAGES, renderLegalPage } from '../lib/legalPages.ts';
import { PRIVACY_URL, SUPPORT_URL, TERMS_URL, SITE_URL } from '../constants/legal.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fail = (m) => {
  console.error(`\u2717 ${m}`);
  process.exitCode = 1;
};
for (const page of LEGAL_PAGES) {
  const file = join(root, 'server', 'pages', `${page}.html`);
  let saved = '';
  try {
    saved = readFileSync(file, 'utf8');
  } catch {
    fail(`server/pages/${page}.html is missing. Run: pnpm run legal:pages`);
    continue;
  }
  if (saved !== renderLegalPage(page)) fail(`server/pages/${page}.html is out of date with constants/legal.ts. Run: pnpm run legal:pages`);
}
for (const [name, url, page] of [['PRIVACY_URL', PRIVACY_URL, 'privacy'], ['TERMS_URL', TERMS_URL, 'terms'], ['SUPPORT_URL', SUPPORT_URL, 'support']]) {
  if (url !== `${SITE_URL}/${page}`) fail(`${name} should be ${SITE_URL}/${page} to match the served page`);
}
const serve = readFileSync(join(root, 'server', 'serve.js'), 'utf8');
if (!serve.includes("'pages'")) fail('server/serve.js does not serve server/pages');
if (!process.exitCode) console.log('Legal pages match the app text.');
