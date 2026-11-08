import { NextRequest, NextResponse } from "next/server";
import { getInnertubeStreams } from "@/lib/innertubeCore";
import { getInvidiousStreams } from "@/lib/invidiousCore";
import { canonicalVideoId, type MatchDecision, type RankedCandidate } from "@/lib/match";
import { pipedFetch } from "@/lib/pipedCore";
import { resolveTrack } from "@/lib/resolveSong";
import { sanitizeError } from "@/lib/sanitize";
import {
  classifyFailure,
  openUpstream,
  proxyResponseHeaders,
  raceProviders,
  type StreamKind,
} from "@/lib/streamProxy";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Connecting a YouTube Music account does not make these extracted URLs reliable.
// Signed googlevideo URLs stay on the server; they are never logged or returned.

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

function pickUrls(s: StreamSet, kind: StreamKind, n = 3): string[] {
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

const urlCache = new Map<string, { url: string; exp: number }>();
function cachedUrl(videoId: string, kind: string): string | null {
  const c = urlCache.get(`${videoId}:${kind}`);
  return c && c.exp > Date.now() ? c.url : null;
}
function cacheUrl(videoId: string, kind: string, url: string) {
  if (urlCache.size > 200) urlCache.clear();
  urlCache.set(`${videoId}:${kind}`, { url, exp: Date.now() + 5 * 60 * 1000 });
}

function pub(c: RankedCandidate) {
  return {
    videoId: c.videoId,
    title: c.title,
    author: c.author,
    durationSec: c.durationSec,
    notes: c.notes,
  };
}

async function decideQuery(sp: URLSearchParams): Promise<MatchDecision> {
  const dur = Number(sp.get("dur"));
  return resolveTrack({
    title: sp.get("title") || sp.get("q") || "",
    artist: sp.get("artist") || "",
    durationSec: dur > 0 ? dur : undefined,
  });
}

async function loadProvider(
  videoId: string,
  kind: StreamKind,
  range: string | null,
  signal: AbortSignal,
  src: string,
  load: (signal: AbortSignal) => Promise<StreamSet>
): Promise<Response> {
  const data = await load(signal);
  const urls = pickUrls(data, kind, 3);
  if (!urls.length) throw new Error(`${src}: no usable stream`);
  for (const url of urls) {
    if (signal.aborted) throw new Error("aborted");
    const res = await openUpstream({ url, range, kind, signal });
    if (res) {
      cacheUrl(videoId, kind, url);
      return res;
    }
  }
  throw new Error(`${src}: all candidate URLs failed`);
}

function failureResponse(err: unknown) {
  const message =
    err instanceof AggregateError
      ? err.errors
          .map((e) => (e instanceof Error ? e.message : String(e)))
          .join("; ")
      : err instanceof Error
        ? err.message
        : "No playable stream found";
  return NextResponse.json(
    {
      error: "No playable stream found",
      code: classifyFailure(message),
      detail: sanitizeError(message),
    },
    { status: 502 }
  );
}

async function streamById(
  videoId: string,
  kind: StreamKind,
  range: string | null,
  fresh: boolean
) {
  if (!fresh) {
    const hit = cachedUrl(videoId, kind);
    if (hit) {
      const cached = await openUpstream({ url: hit, range, kind });
      if (cached) return cached;
      urlCache.delete(`${videoId}:${kind}`);
    }
  }

  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), 12000);
  try {
    // Losers are aborted. The deadline is cleared once a body is actually
    // open so it cannot cut the winning stream off after the first bytes.
    const res = await raceProviders<Response>([
      (signal) =>
        loadProvider(
          videoId,
          kind,
          range,
          AbortSignal.any([signal, deadline.signal]),
          "innertube",
          (s) => getInnertubeStreams(videoId, s)
        ),
      (signal) =>
        loadProvider(
          videoId,
          kind,
          range,
          AbortSignal.any([signal, deadline.signal]),
          "piped",
          (s) =>
            pipedFetch<StreamSet>(
              `/streams/${videoId}`,
              7000,
              (x) =>
                !!x &&
                ((x.audioStreams?.length ?? 0) > 0 ||
                  (x.videoStreams?.length ?? 0) > 0),
              s
            )
        ),
      (signal) =>
        loadProvider(
          videoId,
          kind,
          range,
          AbortSignal.any([signal, deadline.signal]),
          "invidious",
          (s) => getInvidiousStreams(videoId, s)
        ),
    ]);
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    return failureResponse(err);
  }
}

async function pipePassthrough(url: string, range: string | null) {
  const headers: Record<string, string> = {};
  if (range) headers.range = range;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const upstream = await fetch(url, {
      headers,
      redirect: "follow",
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!upstream.ok && upstream.status !== 206) return null;
    return new Response(upstream.body, {
      status: upstream.status,
      headers: proxyResponseHeaders(upstream.headers),
    });
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const range = req.headers.get("range");
  const meta = sp.get("meta") === "1";
  const fresh = sp.get("fresh") === "1";

  let videoId = sp.get("v");
  let decision: MatchDecision | null = null;
  if (!videoId && (sp.get("q") || sp.get("title"))) {
    try {
      decision = await decideQuery(sp);
    } catch (e) {
      return NextResponse.json({ error: sanitizeError(e) }, { status: 502 });
    }
    videoId = canonicalVideoId(decision);
  }

  if (meta) {
    return NextResponse.json({
      videoId: videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId) ? videoId : null,
      confidence: decision?.confidence ?? (videoId ? "high" : "low"),
      alternatives: decision?.alternatives.map(pub) ?? [],
    });
  }

  if ((sp.get("q") || sp.get("title")) && !sp.get("v") && !videoId) {
    return NextResponse.json(
      {
        error: "low_confidence",
        videoId: null,
        confidence: decision?.confidence ?? "low",
        alternatives: decision?.alternatives.map(pub) ?? [],
      },
      { status: 409 }
    );
  }

  if (videoId) {
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
      return NextResponse.json({ error: "Invalid video id" }, { status: 400 });
    }
    const kind: StreamKind = sp.get("kind") === "video" ? "video" : "audio";
    return streamById(videoId, kind, range, fresh);
  }

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
  const res = await pipePassthrough(url, range);
  return res ?? NextResponse.json({ error: "Upstream failed" }, { status: 502 });
}
