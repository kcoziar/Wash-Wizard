/**
 * Checks the published site before submitting to App Review: the privacy, terms and support pages
 * must load and match the text built into the app, and the telemetry endpoint must be live.
 * Run after publishing: pnpm --filter @workspace/pressure-quote run check:live
 */
import { PRIVACY_URL, SITE_URL, SUPPORT_URL, TERMS_URL } from '../constants/legal.ts';
import { renderLegalPage } from '../lib/legalPages.ts';
import { TELEMETRY_URL } from '../lib/telemetry.ts';

const pages = [
  ['index', `${SITE_URL}/`],
  ['privacy', PRIVACY_URL],
  ['terms', TERMS_URL],
  ['support', SUPPORT_URL],
];
/** What a reader sees: tags, styles and spacing removed, so a proxy's markup changes never count as a difference. */
const visible = (html) =>
  html
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

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
    else if (visible(body) !== visible(renderLegalPage(page))) fail(`${url} is live but differs from the app's text. Run legal:pages and publish again.`);
    else console.log(`OK   ${url}`);
  } catch (e) {
    fail(`${url} could not be reached: ${e.message}`);
  }
}

// The public site must not hand the app to Expo Go.
try {
  const res = await fetch(`${SITE_URL}/manifest`, { headers: { 'expo-platform': 'ios' } });
  const type = res.headers.get('content-type') ?? '';
  if (res.status === 200 && type.includes('json')) fail(`${SITE_URL} still serves the Expo Go manifest. Publish again.`);
  else console.log(`OK   ${SITE_URL} does not serve the app bundle`);
} catch (e) {
  fail(`${SITE_URL} could not be reached: ${e.message}`);
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
