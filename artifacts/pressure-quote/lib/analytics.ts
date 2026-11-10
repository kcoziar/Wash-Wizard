/**
 * Anonymous funnel counts and crash reports.
 *
 * Only an event name and, for the paywall, where it was opened from are passed on. Never names,
 * addresses, phone numbers, prices or message text. Release builds connect the app's own server at
 * startup (see telemetry.ts); any change to what is sent must also change the privacy policy and the
 * App Privacy answers in App Store Connect.
 */
export type FunnelEvent =
  | 'setup_finished'
  | 'setup_skipped'
  | 'quote_created_1'
  | 'quote_created_2'
  | 'quote_created_3'
  | 'paste_used'
  | 'text_send_used'
  | 'paywall_viewed'
  | 'purchase'
  | 'restore';

export type PaywallFrom = 'first' | 'limit' | 'last-free' | 'settings' | 'home' | 'card' | 'other';

type AnalyticsSink = (event: FunnelEvent, from?: PaywallFrom) => void;
type CrashSink = (error: unknown, where: CrashArea) => void;
export type CrashArea = 'render' | 'pdf' | 'share' | 'storage' | 'purchase';

let analyticsSink: AnalyticsSink | null = null;
let crashSink: CrashSink | null = null;

export function setAnalyticsSink(sink: AnalyticsSink | null) {
  analyticsSink = sink;
}

export function setCrashSink(sink: CrashSink | null) {
  crashSink = sink;
}

export function paywallFrom(v: string | undefined): PaywallFrom {
  return v === 'first' || v === 'limit' || v === 'last-free' || v === 'settings' || v === 'home' || v === 'card' ? v : 'other';
}

export function track(event: FunnelEvent, from?: PaywallFrom) {
  try {
    analyticsSink?.(event, from);
  } catch {
    // Measurement never interrupts the operator.
  }
}

/** The quote-count events are the first three non-sample quotes only. */
export function trackQuoteCreated(createdCount: number) {
  if (createdCount === 1) track('quote_created_1');
  else if (createdCount === 2) track('quote_created_2');
  else if (createdCount === 3) track('quote_created_3');
}

export function reportError(error: unknown, where: CrashArea) {
  try {
    crashSink?.(error, where);
  } catch {
    // Reporting never interrupts the operator.
  }
}
