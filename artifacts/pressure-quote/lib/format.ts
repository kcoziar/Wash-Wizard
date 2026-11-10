import { Dec } from './decimal';
import type { Unit } from './types';

export function makeId(prefix = ''): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function group(intDigits: string): string {
  return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Formats integer cents as US dollars, e.g. 142220 -> "$1,422.20". */
export function money(cents: number, opts: { plusSign?: boolean; noCents?: boolean } = {}): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  const body = opts.noCents && rem === 0 ? `$${group(String(dollars))}` : `$${group(String(dollars))}.${String(rem).padStart(2, '0')}`;
  if (negative) return `\u2212${body}`;
  if (opts.plusSign && cents > 0) return `+${body}`;
  return body;
}

/** Formats a rate that may carry more than two decimals, e.g. "$0.105". */
export function moneyRate(text: string): string {
  const d = Dec.parse(text);
  if (!d) return '';
  const fixed = d.s < 2 ? d.round(2) : d;
  const str = fixed.toString();
  const [ip, fp = ''] = str.replace('-', '').split('.');
  const frac = fp.padEnd(2, '0');
  return `${d.sign() < 0 ? '\u2212' : ''}$${group(ip)}.${frac}`;
}

export function centsToInput(cents: number): string {
  const abs = Math.abs(cents);
  const s = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return (cents < 0 ? '-' : '') + s.replace(/\.00$/, '');
}

export function number(d: Dec | null, maxDecimals = 2): string {
  if (!d) return '';
  const r = d.s > maxDecimals ? d.round(maxDecimals) : d;
  const str = r.toString();
  const negative = str.startsWith('-');
  const [ip, fp] = str.replace('-', '').split('.');
  return (negative ? '\u2212' : '') + group(ip) + (fp ? `.${fp}` : '');
}

export function unitLabel(unit: Unit, eachLabel = ''): string {
  switch (unit) {
    case 'sqft':
      return 'sq ft';
    case 'sqm':
      return 'm\u00B2';
    case 'ft':
      return 'linear ft';
    case 'm':
      return 'linear m';
    case 'each':
      return eachLabel || 'each';
    case 'hour':
      return 'hours';
    case 'job':
      return 'flat';
  }
}

export function perUnitLabel(unit: Unit, eachLabel = ''): string {
  switch (unit) {
    case 'sqft':
      return '/ sq ft';
    case 'sqm':
      return '/ m\u00B2';
    case 'ft':
      return '/ ft';
    case 'm':
      return '/ m';
    case 'each':
      return `/ ${singular(eachLabel || 'each')}`;
    case 'hour':
      return '/ hour';
    case 'job':
      return '';
  }
}

function singular(label: string): string {
  if (label === 'each') return 'each';
  if (/ies$/.test(label)) return label.replace(/ies$/, 'y');
  if (/s$/.test(label)) return label.replace(/s$/, '');
  return label;
}

export function qtyText(d: Dec | null, unit: Unit, eachLabel = ''): string {
  if (!d) return '';
  return `${number(d, 2)} ${unitLabel(unit, eachLabel)}`;
}

/** 280 -> "4 h 40 min" */
export function duration(minutes: number | null): string {
  if (minutes == null || !isFinite(minutes)) return '';
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} min`;
  if (r === 0) return `${h} h`;
  return `${h} h ${r} min`;
}

export function percent(ratio: number | null, digits = 1): string {
  if (ratio == null || !isFinite(ratio)) return '';
  return `${(ratio * 100).toFixed(digits).replace(/\.0+$/, '')}%`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function date(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function shortDate(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    const h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${((h + 11) % 12) + 1}:${m} ${h < 12 ? 'AM' : 'PM'}`;
  }
  if (d.getFullYear() === now.getFullYear()) return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return date(ms);
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Keeps only digits and a single decimal point while typing. */
export function sanitizeDecimal(text: string, maxDecimals = 4): string {
  let t = text.replace(/[^0-9.]/g, '');
  const i = t.indexOf('.');
  if (i >= 0) t = t.slice(0, i + 1) + t.slice(i + 1).replace(/\./g, '').slice(0, maxDecimals);
  if (t.length > 1 && t.startsWith('0') && t[1] !== '.') t = t.replace(/^0+/, '') || '0';
  return t.slice(0, 12);
}

export function quoteReference(jobNumber: number, revisionNumber: number): string {
  const base = `Q-${String(jobNumber).padStart(4, '0')}`;
  return revisionNumber > 1 ? `${base}-R${revisionNumber}` : base;
}
