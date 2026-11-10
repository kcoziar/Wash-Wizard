/**
 * The operator's own usual sizes. A message such as "2 car driveway" carries no number; the
 * operator answers once ("How big is your usual 2-car driveway?") and the answer is offered in one
 * tap after that. No size is ever shipped with the app.
 */

/** "driveway:2car". Only the driveway car-count sizes exist today. */
export const SIZE_KEY = /^driveway:[1-4]car$/;

const WORD_COUNT: Record<string, number> = { one: 1, single: 1, two: 2, double: 2, three: 3, triple: 3, four: 4 };

/**
 * The car-count size named in the customer's words for a driveway: "2 car", "two-car garage",
 * "double driveway". Null when no count is named.
 */
export function carSizeKey(words: string): string | null {
  const t = words.toLowerCase();
  const m =
    /\b([1-4]|one|two|three|four|single|double|triple)\s*-?\s*(?:car|cars|vehicle|stall)\b/.exec(t) ??
    /\b(single|double|triple)\s*-?\s*(?:wide\s+)?(?:drive\s?way|garage)\b/.exec(t);
  if (!m) return null;
  const n = /^\d$/.test(m[1]) ? Number(m[1]) : WORD_COUNT[m[1]];
  return n >= 1 && n <= 4 ? `driveway:${n}car` : null;
}

/** "2-car driveway" */
export function sizeKeyLabel(key: string): string {
  const m = /^driveway:(\d)car$/.exec(key);
  return m ? `${m[1]}-car driveway` : 'usual size';
}
