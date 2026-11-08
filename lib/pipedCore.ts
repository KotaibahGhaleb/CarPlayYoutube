// Shared Piped failover logic — runs server-side (API route) so CORS
// restrictions don't shrink the usable instance pool.

const FALLBACK_INSTANCES = [
  "https://api.piped.private.coffee",
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.reallyaweso.me",
  "https://pipedapi.adminforge.de",
  "https://pipedapi.in.projectsegfau.lt",
  "https://pipedapi.leptons.xyz",
  "https://api.piped.yt",
  "https://pipedapi.ducks.party",
  "https://pipedapi.drgns.space",
  "https://pipedapi.nosebs.ru",
  "https://pipedapi.r4fo.com",
  "https://pipedapi.darkness.services",
];

const INSTANCES_LIST_URL = "https://piped.video/api/v1/instances";

let cachedInstances: string[] | null = null;
let cacheTime = 0;
let lastGood: string | null = null;

async function fetchJson<T>(
  url: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    if (signal?.aborted) throw new Error("aborted");
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "carplay-media/1.0" },
    });
    if (!res.ok) {
      // Piped puts the real reason in the error body even on 4xx/5xx
      let msg = `HTTP ${res.status}`;
      try {
        const b = await res.json();
        if (typeof b?.error === "string")
          msg = b.error.split("\n")[0].slice(0, 200);
      } catch {}
      throw new Error(msg);
    }
    const body = (await res.json()) as T;
    // Piped returns {"error": "..."} bodies — surface the real reason
    const err = (body as { error?: unknown })?.error;
    if (typeof err === "string" && err)
      throw new Error(err.split("\n")[0].slice(0, 200));
    return body;
  } finally {
    clearTimeout(t);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function getInstances(): Promise<string[]> {
  if (cachedInstances && Date.now() - cacheTime < 10 * 60 * 1000)
    return cachedInstances;

  let remote: string[] = [];
  try {
    const data = await fetchJson<Array<{ api_url?: string }>>(
      INSTANCES_LIST_URL,
      5000
    );
    remote = (Array.isArray(data) ? data : [])
      .map((i) => i?.api_url)
      .filter((u): u is string => typeof u === "string");
  } catch {
    // remote list unavailable — fall back to hardcoded list
  }

  const seen = new Set<string>();
  const merged = [...FALLBACK_INSTANCES, ...remote].filter((u) => {
    const n = u.replace(/\/+$/, "");
    if (seen.has(n)) return false;
    seen.add(n);
    return true;
  });

  if (lastGood) {
    const idx = merged.findIndex((u) => u.replace(/\/+$/, "") === lastGood);
    if (idx > 0) merged.unshift(merged.splice(idx, 1)[0]);
  }

  cachedInstances = merged;
  cacheTime = Date.now();
  return merged;
}

// Race ALL instances in parallel — first valid response wins. Sequential
// batches meant a single success could take ~20s; all-parallel caps the
// worst case at one timeout.
export async function pipedFetch<T>(
  path: string,
  timeoutMs = 7000,
  validate?: (d: T) => boolean,
  signal?: AbortSignal
): Promise<T> {
  const instances = (await getInstances()).slice(0, 16);
  let lastError: unknown = null;
  let descriptive: Error | null = null;
  const isGeneric = (m: string) =>
    /fetch failed|bad payload|abort/i.test(m);

  try {
    const { base, data } = await Promise.any(
      instances.map(async (base) => {
        const data = await fetchJson<T>(base + path, timeoutMs, signal);
        // Some instances return HTTP 200 with an error body — treat as failure
        if (validate && !validate(data)) throw new Error("bad payload");
        return { base, data };
      })
    );
    lastGood = base.replace(/\/+$/, "");
    return data;
  } catch (e) {
    const errs = e instanceof AggregateError ? e.errors : [e];
    lastError = errs[0];
    const d = errs.find(
      (x): x is Error => x instanceof Error && !isGeneric(x.message)
    );
    if (d) descriptive = d;
  }
  throw descriptive ?? (lastError instanceof Error
    ? lastError
    : new Error("All Piped instances are unreachable"));
}
