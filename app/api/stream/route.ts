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

async function resolveStreamUrl(
  videoId: string,
  kind: "audio" | "video"
): Promise<string> {
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
    if (u) return u;
  } catch {}
  try {
    const d = await getInvidiousStreams(videoId);
    const u = pickUrl(d, kind);
    if (u) return u;
  } catch {}
  const d = await getInnertubeStreams(videoId);
  const u = pickUrl(d, kind);
  if (!u) throw new Error("No playable stream found");
  return u;
}

async function pipeUpstream(url: string, range: string | null) {
  const headers: Record<string, string> = {};
  if (range) headers.range = range;

  let upstream: Response | null = null;
  let fetchErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      upstream = await fetch(url, {
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(30000),
      });
      if (
        upstream.ok ||
        upstream.status === 206 ||
        (upstream.status !== 403 && upstream.status !== 429)
      )
        break;
      upstream = null;
      await new Promise((r) => setTimeout(r, 400));
    } catch (e) {
      fetchErr = e;
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  if (!upstream) {
    return NextResponse.json(
      { error: fetchErr instanceof Error ? fetchErr.message : "Upstream failed" },
      { status: 502 }
    );
  }
  if (!upstream.ok && upstream.status !== 206) {
    return NextResponse.json(
      { error: `Upstream ${upstream.status}` },
      { status: 502 }
    );
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

  // Mode 1: resolve + stream in one invocation
  if (videoId) {
    if (!/^[A-Za-z0-9_-]{6,15}$/.test(videoId)) {
      return NextResponse.json({ error: "Invalid video id" }, { status: 400 });
    }
    const kind = sp.get("kind") === "video" ? "video" : "audio";
    let url: string;
    try {
      url = await resolveStreamUrl(videoId, kind);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Resolve failed" },
        { status: 502 }
      );
    }
    return pipeUpstream(url, range);
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
  return pipeUpstream(url, range);
}
