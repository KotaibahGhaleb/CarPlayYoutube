import { NextRequest, NextResponse } from "next/server";
import { pipedFetch } from "@/lib/pipedCore";
import { getInvidiousStreams } from "@/lib/invidiousCore";
import { getInnertubeStreams, searchInnertube } from "@/lib/innertubeCore";

export const maxDuration = 300;

// Media proxy — two modes:
//   /api/stream?v=VIDEO_ID&kind=audio|video  → resolve a fresh stream URL
//     and pipe it within the SAME request (signed URLs are IP-bound, so
//     resolving + fetching in one invocation keeps the signature valid)
//   /api/stream?url=ENCODED_URL             → plain passthrough (thumbnails)

const ALLOWED_HOST =
  /(^|\.)googlevideo\.com$|(^|\.)ggpht\.com$|(^|\.)ytimg\.com$|(^|\.)googleusercontent\.com$|pipedproxy|(^|\.)piped\.|pipedapi|invidious|(^|\.)iv\.|odycdn\.com$|videoplayback/i;

interface StreamSet {
  audioStreams?: { url: string; mimeType?: string; bitrate?: number }[];
  videoStreams?: {
    url: string;
    quality?: string;
    mimeType?: string;
    videoOnly?: boolean;
  }[];
}

// Top-N candidate URLs per provider — if the best-quality URL is IP-bound
// or bot-checked, the next format may still pipe fine.
function pickUrls(
  s: StreamSet,
  kind: "audio" | "video",
  n = 3
): string[] {
  if (kind === "audio") {
    const m4a = (s.audioStreams ?? []).filter((x) =>
      /mp4|m4a|aac/i.test(x.mimeType ?? "")
    );
    const pool = m4a.length ? m4a : (s.audioStreams ?? []);
    return pool
      .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))
      .slice(0, n)
      .map((x) => x.url);
  }
  const progressive = (s.videoStreams ?? []).filter(
    (x) => x.videoOnly === false && /^\d+p$/.test(x.quality ?? "")
  );
  const pool = progressive.length
    ? progressive
    : (s.videoStreams ?? []).filter((x) => x.videoOnly === false);
  const res = (x: { quality?: string }) => parseInt(x.quality ?? "") || 0;
  const under = pool.filter((x) => res(x) <= 1080);
  return (under.length ? under : pool)
    .sort((a, b) => res(b) - res(a))
    .slice(0, n)
    .map((x) => x.url);
}

// Resolve each provider CONCURRENTLY — the first URL that actually delivers
// bytes wins. Innertube usually answers in <1s; if it's bot-blocked, Piped/
// Invidious racing in parallel still beats waiting for them sequentially.
// (Piped/Invidious URLs may be bound to THEIR IPs — the probe weeds those out.)
async function resolveOne(
  videoId: string,
  kind: "audio" | "video",
  src: string,
  resolveFn: () => Promise<StreamSet>
): Promise<{ urls: string[]; src: string }> {
  const d = await resolveFn();
  const urls = pickUrls(d, kind, 3);
  if (!urls.length) throw new Error(`${src}: no usable stream`);
  return { urls, src };
}

// Per-warm-instance cache of WORKING upstream URLs — skips resolution + probe
// entirely on repeats (signed URLs live ~6h; we keep them 5 min to be safe)
const urlCache = new Map<string, { url: string; exp: number }>();
function cachedUrl(videoId: string, kind: string): string | null {
  const c = urlCache.get(`${videoId}:${kind}`);
  return c && c.exp > Date.now() ? c.url : null;
}
function cacheUrl(videoId: string, kind: string, url: string) {
  if (urlCache.size > 200) urlCache.clear();
  urlCache.set(`${videoId}:${kind}`, { url, exp: Date.now() + 5 * 60 * 1000 });
}

// Song-title → videoId, entirely server-side. Races direct YouTube search
// against Piped; picks the candidate whose duration is closest to iTunes'.
interface SearchItem {
  url?: string;
  duration?: number;
}
async function resolveVideoId(
  q: string,
  target: number
): Promise<string | null> {
  let items: SearchItem[] = [];
  try {
    const data = await Promise.any([
      searchInnertube(q),
      pipedFetch<SearchItem[] | { items?: SearchItem[] }>(
        `/search?q=${encodeURIComponent(q)}&filter=music_songs`,
        6000,
        (x) => {
          const arr = Array.isArray(x) ? x : x?.items;
          return Array.isArray(arr) && arr.length > 0;
        }
      ),
    ]);
    items = Array.isArray(data) ? data : (data?.items ?? []);
  } catch {
    return null;
  }
  const vids = items
    .map((i) => ({
      id: i.url?.match(/[?&]v=([\w-]{11})/)?.[1] ?? "",
      d: i.duration ?? 0,
    }))
    .filter((i) => i.id);
  if (!vids.length) return null;
  if (target > 0)
    vids.sort((a, b) => Math.abs(a.d - target) - Math.abs(b.d - target));
  return vids[0].id;
}

async function pipeUpstream(url: string, range: string | null) {
  const headers: Record<string, string> = {};
  if (range) headers.range = range;

  let upstream: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      upstream = await fetch(url, {
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(30000),
      });
      if (upstream.ok || upstream.status === 206) break;
      upstream = null;
      break; // definite rejection — don't retry this URL
    } catch {
      upstream = null;
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  if (!upstream || (!upstream.ok && upstream.status !== 206)) {
    return null;
  }

  const pass = [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "etag",
    "last-modified",
  ];
  const resHeaders: Record<string, string> = { "cache-control": "no-store" };
  for (const h of pass) {
    const v = upstream.headers.get(h);
    if (v) resHeaders[h] = v;
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: resHeaders,
  });
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const range = req.headers.get("range");

  // Resolve videoId: ?v=ID directly, or ?q=song+artist&dur=seconds — the
  // whole song→stream pipeline in ONE server invocation (kills a client
  // round-trip and its whole failure surface).
  let videoId = sp.get("v");
  if (!videoId && sp.get("q")) {
    videoId = await resolveVideoId(
      sp.get("q")!,
      Number(sp.get("dur")) || 0
    );
  }

  if (videoId && sp.get("meta") === "1") {
    return NextResponse.json({ videoId });
  }

  // Mode 1: resolve + stream in one invocation. Cache hits skip everything;
  // misses race all providers concurrently and probe each URL as it lands —
  // the first one that yields bytes wins.
  if (videoId) {
    if (!/^[A-Za-z0-9_-]{6,15}$/.test(videoId)) {
      return NextResponse.json({ error: "Invalid video id" }, { status: 400 });
    }
    const kind = sp.get("kind") === "video" ? "video" : "audio";

    const hit = cachedUrl(videoId, kind);
    if (hit) {
      const res = await pipeUpstream(hit, range);
      if (res) return res;
      urlCache.delete(`${videoId}:${kind}`);
    }

    try {
      // Hard budget: rather fail in ~12s and let the client fall back to the
      // official player than leave the user staring at a spinner for 20s+
      const timeout = new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("resolution timeout")), 12000)
      );
      const res = await Promise.race([
        Promise.any(
          [
            () =>
              resolveOne(videoId, kind, "innertube", () =>
                getInnertubeStreams(videoId)
              ),
            () =>
              resolveOne(videoId, kind, "piped", () =>
                pipedFetch<StreamSet>(
                  `/streams/${videoId}`,
                  7000,
                  (x) =>
                    !!x &&
                    ((x.audioStreams?.length ?? 0) > 0 ||
                      (x.videoStreams?.length ?? 0) > 0)
                )
              ),
            () =>
              resolveOne(videoId, kind, "invidious", () =>
                getInvidiousStreams(videoId)
              ),
          ].map(async (job) => {
            const { urls, src } = await job();
            // try each candidate URL — a blocked format doesn't sink the
            // whole provider
            for (const url of urls) {
              const r = await pipeUpstream(url, range);
              if (r) {
                cacheUrl(videoId, kind, url);
                return r;
              }
            }
            throw new Error(`${src}: all candidate URLs failed`);
          })
        ),
        timeout,
      ]);
      return res;
    } catch {
      return NextResponse.json(
        { error: "No playable stream found" },
        { status: 502 }
      );
    }
  }

  // Mode 2: passthrough proxy (thumbnails etc.)
  const url = sp.get("url");
  if (!url || !/^https:\/\//i.test(url)) {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }
  if (!ALLOWED_HOST.test(host)) {
    return NextResponse.json({ error: "Host not allowed" }, { status: 403 });
  }
  const res = await pipeUpstream(url, range);
  return (
    res ??
    NextResponse.json({ error: "Upstream failed" }, { status: 502 })
  );
}
