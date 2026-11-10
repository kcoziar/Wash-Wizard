/** The only logo form the app accepts anywhere: an inline PNG or JPEG data URI of bounded size. */
export const MAX_LOGO_CHARS = 2_500_000;

const PREFIX = /^data:image\/(png|jpeg|jpg);base64,/;

function isBase64Body(s: string, start: number): boolean {
  let end = s.length;
  let pad = 0;
  while (end > start && s.charCodeAt(end - 1) === 61 && pad < 2) {
    end--;
    pad++;
  }
  if (end <= start) return false;
  for (let i = start; i < end; i++) {
    const c = s.charCodeAt(i);
    const ok = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 47;
    if (!ok) return false;
  }
  return true;
}

export function isSafeLogo(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > MAX_LOGO_CHARS) return false;
  const m = PREFIX.exec(v);
  return !!m && isBase64Body(v, m[0].length);
}
