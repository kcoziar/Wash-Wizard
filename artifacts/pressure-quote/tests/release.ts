/**
 * Release gate. Fails while anything that must be supplied before submission is still a placeholder.
 * Run: pnpm --filter @workspace/pressure-quote run test
 */
import { PRIVACY_URL, SUPPORT_URL, TERMS_URL, isPlaceholderUrl } from '../constants/legal';
import { pickRevenueCatKey } from '../lib/rcKey';

const missing: string[] = [];
if (isPlaceholderUrl(PRIVACY_URL)) missing.push(`PRIVACY_URL is still a placeholder (${PRIVACY_URL})`);
if (isPlaceholderUrl(TERMS_URL)) missing.push(`TERMS_URL is still a placeholder (${TERMS_URL})`);
if (isPlaceholderUrl(SUPPORT_URL)) missing.push(`SUPPORT_URL is still a placeholder (${SUPPORT_URL})`);

// The App Store build must carry the Apple key, or nobody can buy Pro. Test Store keys only work in Expo Go.
// Set RELEASE_SKIP_RC_KEY=1 only for local test runs where the key is not available.
const iosKey = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY;
if (!process.env.RELEASE_SKIP_RC_KEY) {
  const rc = pickRevenueCatKey({ testStore: false, os: 'ios', iosKey });
  if (!rc.ok) missing.push(`EXPO_PUBLIC_REVENUECAT_IOS_API_KEY: ${rc.message} It must start with appl_.`);
}

if (missing.length) {
  console.error('\nRelease check failed. Set the hosted pages in constants/legal.ts before submitting:');
  for (const m of missing) console.error(`  \u2717 ${m}`);
  throw new Error('Release check failed');
}
console.log('Release check passed: hosted privacy, terms and support pages are set, and the iOS RevenueCat key is an Apple key.');
