/**
 * Writes the hosted privacy, terms and support pages from constants/legal.ts.
 * Run after changing any legal or support text: pnpm --filter @workspace/pressure-quote run legal:pages
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEGAL_PAGES, renderLegalPage } from '../lib/legalPages.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const page of LEGAL_PAGES) {
  writeFileSync(join(root, 'server', 'pages', `${page}.html`), renderLegalPage(page));
  console.log(`Wrote server/pages/${page}.html`);
}
