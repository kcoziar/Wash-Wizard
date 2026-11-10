/**
 * Checks the published site before submitting to App Review: the privacy, terms and support pages
 * must load and match the text built into the app, and the telemetry endpoint must be live.
 * Run after publishing: pnpm --filter @workspace/pressure-quote run check:live
 */
import { PRIVACY_URL, SUPPORT_URL, TERMS_URL } from '../constants/legal.ts';
import { renderLegalPage } from '../lib/legalPages.ts';
import { TELEMETRY_URL } from '../lib/telemetry.ts';

const pages = [
  ['privacy', PRIVACY_URL],
  ['terms', TERMS_URL],
  ['support', SUPPORT_URL],
];
let failed = 0;
const fail = (msg) => {
  failed++;
  console.error(`FAIL ${msg}`);
};

for (const [page, url] of pages) {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    const body = await res.text();
    if (res.status !== 200) fail(`${url} returned ${res.status}`);
    else if (body.trim() !== renderLegalPage(page).trim()) fail(`${url} is live but differs from the app's text. Run legal:pages and publish again.`);
    else console.log(`OK   ${url}`);
  } catch (e) {
    fail(`${url} could not be reached: ${e.message}`);
  }
}

// An empty body is refused without storing anything, which proves the endpoint is deployed.
try {
  const res = await fetch(`${TELEMETRY_URL}/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  if (res.status !== 400) fail(`${TELEMETRY_URL}/events returned ${res.status}, expected 400 for an empty event`);
  else console.log(`OK   ${TELEMETRY_URL}/events`);
} catch (e) {
  fail(`${TELEMETRY_URL}/events could not be reached: ${e.message}`);
}

if (failed) {
  console.error(`\n${failed} live check(s) failed.`);
  process.exit(1);
}
console.log('\nAll live pages match the app.');
