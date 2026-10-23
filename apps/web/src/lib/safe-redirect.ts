/**
 * Accepts only same-site relative paths for post-login redirects, so `?next=` cannot be used as
 * an open redirect (`//evil.example`, `https://…`, `/\evil`, javascript: etc. all fall back).
 */
export function safeNextPath(value: string | string[] | undefined, fallback = '/account'): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || candidate.length > 200) return fallback;
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\')) {
    return fallback;
  }
  // Control characters (incl. tabs/newlines that browsers strip) can smuggle a second slash.
  // oxlint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(candidate)) return fallback;
  return candidate;
}
