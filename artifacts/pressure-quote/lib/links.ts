import { router } from 'expo-router';
import { SUPPORT_URL, isPlaceholderUrl } from '@/constants/legal';

/** Opens the privacy policy or terms built into the app (works offline; the screen links to the hosted copy). */
export function openLegal(doc: 'privacy' | 'terms') {
  router.push({ pathname: '/settings/legal', params: { doc } });
}

/** The in-app support screen: email with diagnostics, the FAQ, and the hosted page once it exists. */
export function openSupport() {
  router.push('/settings/support');
}

export const HAS_SUPPORT_PAGE = !isPlaceholderUrl(SUPPORT_URL);
export const SUPPORT_PAGE = SUPPORT_URL;
