/**
 * Exact decimal arithmetic on BigInt.
 * Money and quantities never pass through binary floating point before the
 * single rounding step defined by the money policy.
 */
export type RoundMode = 'half_up' | 'up' | 'down';

const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const TEN = BigInt(10);

function pow10(n: number): bigint {
  let r = ONE;
  for (let i = 0; i < n; i++) r *= TEN;
  return r;
}

/** Integer division with explicit rounding. half_up = half away from zero. up = away from zero. */
export function divRound(num: bigint, den: bigint, mode: RoundMode): bigint {
  if (den === ZERO) throw new Error('Division by zero');
  const negative = (num < ZERO) !== (den < ZERO);
  const a = num < ZERO ? -num : num;
  const b = den < ZERO ? -den : den;
  let q = a / b;
  const r = a % b;
  if (r !== ZERO) {
    if (mode === 'up') q += ONE;
    else if (mode === 'half_up' && r * TWO >= b) q += ONE;
  }
  return negative ? -q : q;
}

export class Dec {
  readonly n: bigint;
  readonly s: number;

  private constructor(n: bigint, s: number) {
    this.n = n;
    this.s = s;
  }

  static raw(n: bigint, s: number): Dec {
    return new Dec(n, s);
  }

  static int(v: number | bigint): Dec {
    return new Dec(typeof v === 'bigint' ? v : BigInt(Math.trunc(v)), 0);
  }

  static cents(c: number): Dec {
    return new Dec(BigInt(Math.round(c)), 2);
  }

  static zero(): Dec {
    return new Dec(ZERO, 0);
  }

  /** Parses user text such as "1,400", "$0.105", "20.5". Returns null when it is not a plain decimal. */
  static parse(input: string | null | undefined): Dec | null {
    if (input == null) return null;
    const t = String(input).trim().replace(/[,\s$]/g, '');
    if (t === '' || t === '-' || t === '.' || t === '-.') return null;
    if (!/^-?\d*(\.\d*)?$/.test(t)) return null;
    const negative = t.startsWith('-');
    const body = negative ? t.slice(1) : t;
    const [ip, fp = ''] = body.split('.');
    const digits = (ip || '0') + fp;
    const n = BigInt(digits);
    return new Dec(negative ? -n : n, fp.length);
  }

  private align(o: Dec): [bigint, bigint, number] {
    const s = Math.max(this.s, o.s);
    return [this.n * pow10(s - this.s), o.n * pow10(s - o.s), s];
  }

  add(o: Dec): Dec {
    const [a, b, s] = this.align(o);
    return new Dec(a + b, s);
  }

  sub(o: Dec): Dec {
    const [a, b, s] = this.align(o);
    return new Dec(a - b, s);
  }

  mul(o: Dec): Dec {
    return new Dec(this.n * o.n, this.s + o.s);
  }

  /** Exact division by a power of ten (e.g. percent -> ratio is shift(2)). */
  shift(k: number): Dec {
    return new Dec(this.n, this.s + k);
  }

  /** Exact halving (triangles). */
  half(): Dec {
    return new Dec(this.n * BigInt(5), this.s + 1);
  }

  neg(): Dec {
    return new Dec(-this.n, this.s);
  }

  cmp(o: Dec): number {
    const [a, b] = this.align(o);
    return a < b ? -1 : a > b ? 1 : 0;
  }

  sign(): number {
    return this.n < ZERO ? -1 : this.n > ZERO ? 1 : 0;
  }

  isZero(): boolean {
    return this.n === ZERO;
  }

  round(scale: number, mode: RoundMode = 'half_up'): Dec {
    if (scale >= this.s) return new Dec(this.n * pow10(scale - this.s), scale);
    return new Dec(divRound(this.n, pow10(this.s - scale), mode), scale);
  }

  /** Division rounded to `scale` decimal places. Returns null for a zero denominator. */
  div(o: Dec, scale: number, mode: RoundMode = 'half_up'): Dec | null {
    if (o.n === ZERO) return null;
    const num = this.n * pow10(o.s + scale);
    const den = o.n * pow10(this.s);
    return new Dec(divRound(num, den, mode), scale);
  }

  /** Rounds to whole cents and returns an integer number of cents. */
  toCents(mode: RoundMode = 'half_up'): number {
    return Number(this.round(2, mode).n);
  }

  /** Lossy conversion for display, ratios and charts only. */
  toNumber(): number {
    return Number(this.n) / Math.pow(10, this.s);
  }

  /** Canonical string without trailing zeros. */
  toString(): string {
    const negative = this.n < ZERO;
    let digits = (negative ? -this.n : this.n).toString();
    if (this.s > 0) {
      digits = digits.padStart(this.s + 1, '0');
      let ip = digits.slice(0, digits.length - this.s);
      let fp = digits.slice(digits.length - this.s).replace(/0+$/, '');
      if (ip === '') ip = '0';
      digits = fp ? `${ip}.${fp}` : ip;
    }
    return (negative && digits !== '0' ? '-' : '') + digits;
  }
}

/** Parses a non-negative decimal. Returns null for blank, invalid or negative input. */
export function parseNonNeg(input: string | null | undefined): Dec | null {
  const d = Dec.parse(input);
  if (!d || d.sign() < 0) return null;
  return d;
}

/** Parses money text into integer cents. Rejects more than 2 decimals or negatives. */
export function parseMoneyCents(input: string | null | undefined): number | null {
  const d = parseNonNeg(input);
  if (!d) return null;
  if (d.s > 2 && !d.round(2).sub(d).isZero()) return null;
  return d.toCents();
}
