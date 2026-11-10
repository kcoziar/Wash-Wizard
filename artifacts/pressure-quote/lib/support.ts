import { Linking, Platform } from 'react-native';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { APP_NAME, SUPPORT_EMAIL } from '@/constants/legal';

/** App, build and device lines for a support email. Never customer data. */
export function buildLines(): string[] {
  const version = Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? 'unknown';
  const build = Application.nativeBuildVersion ?? 'development';
  return [`App version ${version} (build ${build})`, `${Platform.OS} ${String(Platform.Version)}`];
}

/** Opens a pre-filled support email. Returns false when no mail app could be opened. */
export async function emailSupport(opts: { subject?: string; lines?: string[] } = {}): Promise<boolean> {
  const subject = encodeURIComponent(opts.subject ?? `${APP_NAME} support`);
  const footer = [...buildLines(), ...(opts.lines ?? [])].join('\n');
  const body = encodeURIComponent(`\n\n\u2014\n${footer}`);
  try {
    await Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`);
    return true;
  } catch {
    return false;
  }
}
