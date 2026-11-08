/** Strip secrets and signed URLs before anything is logged or shown in dev tools. */
export function sanitizeError(input: unknown): string {
  let s = input instanceof Error ? input.message : String(input ?? "");
  s = s.replace(/https?:\/\/\S+/gi, "[url]");
  s = s.replace(/([?&](?:sig|signature|lsig|n|ip|expire|oauth_token|access_token|refresh_token)=)[^&\s]+/gi, "$1[redacted]");
  s = s.replace(/\bya29\.[A-Za-z0-9_\-]+/g, "[token]");
  s = s.replace(/(?:authorization|cookie|sapisidhash)[=:]\s*\S+/gi, "[redacted]");
  s = s.replace(/[A-Za-z0-9_\-]{40,}/g, "[redacted]");
  return s.slice(0, 240);
}
