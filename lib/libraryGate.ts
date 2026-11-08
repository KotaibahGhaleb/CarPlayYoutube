import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_VERSION = "v1";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function sign(key: string, payload: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function issueLibraryToken(key: string, now = Date.now()): string {
  const exp = now + MAX_AGE_MS;
  const payload = `${TOKEN_VERSION}.${exp}`;
  return `${payload}.${sign(key, payload)}`;
}

export function verifyLibraryToken(
  key: string,
  token: string,
  now = Date.now()
): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [version, expRaw, mac] = parts;
  if (version !== TOKEN_VERSION) return false;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < now) return false;
  const payload = `${version}.${expRaw}`;
  return safeEqual(sign(key, payload), mac);
}

export function accessKeyMatches(expected: string, provided: string): boolean {
  return safeEqual(expected, provided);
}
