import { NextRequest, NextResponse } from "next/server";
import { pipedFetch } from "@/lib/pipedCore";
import { getInvidiousStreams } from "@/lib/invidiousCore";
import { getInnertubeStreams } from "@/lib/innertubeCore";

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

function pickUrl(s: StreamSet, kind: "audio" | "video"): string | null {
  if (kind === "audio") {
    const m4a = (s.audioStreams ?? []).filter((x) =>
      /mp4|m4a|aac/i.test(x.mimeType ?? "")
    );
    const pool = m4a.length ? m4a : (s.audioStreams ?? []);
    return pool.length
      ? pool.reduce((a, b) => ((b.bitrate ?? 0) > (a.bitrate ?? 0) ? b : a))
          .url
      : null;
  }
  const progressive = (s.videoStreams ?? []).filter(
    (x) => x.videoOnly === false && /^\d+p$/.test(x.quality ?? "")
  );
  const pool = progressive.length
    ? progressive
    : (s.videoStreams ?? []).filter((x) => x.videoOnly === false);
  if (!pool.length) return null;
  const res = (x: { quality?: string }) => parseInt(x.quality ?? "") || 0;
  const under = pool.filter((x) => res(x) <= 1080);
  return (under.length ? under : pool).reduce((a, b) =>
    res(b) > res(a) ? b : a
  ).url;
}

// Candidate providers. Innertube first: its URLs are IP-bound, and since we
// resolve + fetch in the same invocation the binding stays valid. Piped/
// Invidious may hand out direct googlevideo URLs bound to THEIR IPs — those
// get weeded out when we actually try fetching them.
async function* streamCandidates(videoId: string, kind: "audio" | "video") {
  try {
    const d = await getInnertubeStreams(videoId);
    const u = pickUrl(d, kind);
    if (u) yield { url: u, src: "innertube" };
  } catch {}
  try {
    const d = await pipedFetch<StreamSet>(
      `/streams/${videoId}`,
      7000,
      (x) =>
        !!x &&
        ((x.audioStreams?.length ?? 0) > 0 ||
          (x.videoStreams?.length ?? 0) > 0)
    );
    const u = pickUrl(d, kind);
    if (u) yield { url: u, src: "piped" };
  } catch {}
  try {
    const d = await getInvidiousStreams(videoId);
    const u = pickUrl(d, kind);
    if (u) yield { url: u, src: "invidious" };
  } catch {}
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
  const videoId = sp.get("v");
  const range = req.headers.get("range");

  // Mode 1: resolve + stream in one invocation. Try each provider's URL
  // until one actually delivers bytes — signed URLs bound to a foreign IP
  // fail the probe and get skipped automatically.
  if (videoId) {
    if (!/^[A-Za-z0-9_-]{6,15}$/.test(videoId)) {
      return NextResponse.json({ error: "Invalid video id" }, { status: 400 });
    }
    const kind = sp.get("kind") === "video" ? "video" : "audio";
    for await (const { url, src } of streamCandidates(videoId, kind)) {
      const res = await pipeUpstream(url, range);
      if (res) return res;
      console.warn(`[stream] ${src} candidate failed for ${videoId}`);
    }
    return NextResponse.json(
      { error: "No playable stream found" },
      { status: 502 }
    );
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
