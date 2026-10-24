/**
 * Guards against recording identity numbers where only outcomes belong. National ID (NIN) and bank
 * verification (BVN) numbers are 11 digits, cards 13–19, phone numbers 10–13: any run of 9+ digits
 * (ignoring spaces, dots and hyphens between them) is treated as a likely identifier and refused.
 * Reference codes should therefore keep digit runs short (e.g. `VID-2026-1042`).
 */
export function looksLikeIdentifier(text: string): boolean {
  return /\d{9,}/.test(text.replace(/[\s.-]/g, ''));
}
