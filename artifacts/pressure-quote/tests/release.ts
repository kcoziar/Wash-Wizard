/**
 * Release gate. Fails while anything that must be supplied before submission is still a placeholder.
 * Run: pnpm --filter @workspace/pressure-quote run test
 */
import { PRIVACY_URL, SUPPORT_URL, TERMS_URL, isPlaceholderUrl } from '../constants/legal';

const missing: string[] = [];
if (isPlaceholderUrl(PRIVACY_URL)) missing.push(`PRIVACY_URL is still a placeholder (${PRIVACY_URL})`);
if (isPlaceholderUrl(TERMS_URL)) missing.push(`TERMS_URL is still a placeholder (${TERMS_URL})`);
if (isPlaceholderUrl(SUPPORT_URL)) missing.push(`SUPPORT_URL is still a placeholder (${SUPPORT_URL})`);

if (missing.length) {
  console.error('\nRelease check failed. Set the hosted pages in constants/legal.ts before submitting:');
  for (const m of missing) console.error(`  \u2717 ${m}`);
  throw new Error('Release check failed');
}
console.log('Release check passed: hosted privacy, terms and support pages are set.');
