import { RATED_KINDS } from './defaults';
import type { Job, Meta, Settings } from './types';

const DAY = 24 * 60 * 60 * 1000;
export const BACKUP_FIRST_AT = 3;
export const BACKUP_EVERY_QUOTES = 25;
export const BACKUP_EVERY_DAYS = 30;

/** Real quotes created on this iPhone (samples never count). */
export function quotesCreated(jobs: Job[]): number {
  return jobs.reduce((n, j) => n + (j.sample ? 0 : j.revisions.length > 0 ? 1 : 0), 0);
}

/**
 * The Home backup card: after the 3rd quote, then every 25 quotes or 30 days,
 * and only when there is something new since the last backup or dismissal.
 */
export function backupDue(meta: Meta, created: number, now: number): boolean {
  if (created < BACKUP_FIRST_AT) return false;
  if (meta.backupMarkAt == null) return true;
  if (created <= meta.backupMarkQuotes) return false;
  return created - meta.backupMarkQuotes >= BACKUP_EVERY_QUOTES || now - meta.backupMarkAt >= BACKUP_EVERY_DAYS * DAY;
}

/** Answered or dismissed: start counting again from here. */
export function markBackup(meta: Meta, created: number, now: number, saved: boolean): Meta {
  return { ...meta, backupMarkQuotes: created, backupMarkAt: now, lastBackupAt: saved ? now : meta.lastBackupAt };
}

/** Nothing set up yet, so a restored backup's settings should come along by default. */
export function settingsUntouched(s: Settings): boolean {
  return !s.business.name.trim() && !s.business.logo && RATED_KINDS.every((k) => !s.rates[k].rate.trim());
}
