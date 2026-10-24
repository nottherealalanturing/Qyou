/**
 * Nigerian mobile numbers only at launch. Accepts `0803 123 4567`, `234 803…` and `+234803…` and
 * returns canonical E.164 (`+2348031234567`), or null. The first digit after the country code must
 * be 7, 8 or 9 (mobile ranges); landlines and foreign numbers are rejected.
 */
export function normalizeNigerianPhone(input: string): string | null {
  const compact = input.replace(/[\s().-]/g, '');
  let national: string | undefined;
  if (/^\+234\d{10}$/.test(compact)) national = compact.slice(4);
  else if (/^234\d{10}$/.test(compact)) national = compact.slice(3);
  else if (/^0\d{10}$/.test(compact)) national = compact.slice(1);
  if (!national || !/^[789]\d{9}$/.test(national)) return null;
  return `+234${national}`;
}

/** `+2348031234567` → `+234••••••4567`. For lists and anywhere the full number isn't needed. */
export function maskPhone(e164: string): string {
  return `${e164.slice(0, 4)}${'•'.repeat(Math.max(0, e164.length - 8))}${e164.slice(-4)}`;
}
