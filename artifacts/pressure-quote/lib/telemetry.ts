import { setAnalyticsSink, setCrashSink, type CrashArea, type FunnelEvent, type PaywallFrom } from './analytics';

/**
 * Sends the anonymous funnel events and scrubbed crash reports to the app's own server.
 *
 * What leaves the phone: the event name (or the app area and the error's class name, such as
 * "TypeError"), the paywall source, the app version and the platform. Never an error message,
 * stack, device or user identifier, or anything about a customer. Requests are fire-and-forget:
 * a failure is dropped silently and never retried or queued.
 */
export const TELEMETRY_URL = 'https://wash-wizard.replit.app/api/telemetry';

type Post = (url: string, body: string) => Promise<unknown>;

export type TelemetryOptions = {
  appVersion: string;
  platform: 'ios' | 'android' | 'web';
  /** Development builds send nothing. */
  enabled: boolean;
  post?: Post;
};

const VERSION = /^[0-9]{1,3}\.[0-9]{1,3}(\.[0-9]{1,3})?$/;

/** The error's class name only, letters only. A message or stack is never read. */
export function errorType(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  const clean = String(name).replace(/[^A-Za-z]/g, '').slice(0, 40);
  return clean || 'Unknown';
}

export function eventBody(event: FunnelEvent, from: PaywallFrom | undefined, o: Pick<TelemetryOptions, 'appVersion' | 'platform'>) {
  return { event, ...(event === 'paywall_viewed' ? { from: from ?? 'other' } : {}), appVersion: o.appVersion, platform: o.platform };
}

export function crashBody(error: unknown, area: CrashArea, o: Pick<TelemetryOptions, 'appVersion' | 'platform'>) {
  return { area, errorType: errorType(error), appVersion: o.appVersion, platform: o.platform };
}

const defaultPost: Post = (url, body) => {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 8000) : null;
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: ctrl?.signal }).finally(() => {
    if (timer) clearTimeout(timer);
  });
};

export function connectTelemetry(o: TelemetryOptions) {
  if (!o.enabled || !VERSION.test(o.appVersion)) {
    setAnalyticsSink(null);
    setCrashSink(null);
    return;
  }
  const post = o.post ?? defaultPost;
  const send = (path: string, body: object) => {
    post(`${TELEMETRY_URL}/${path}`, JSON.stringify(body)).catch(() => undefined);
  };
  setAnalyticsSink((event, from) => send('events', eventBody(event, from, o)));
  setCrashSink((error, area) => send('crashes', crashBody(error, area, o)));
}
