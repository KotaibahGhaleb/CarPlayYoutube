"use client";

// Client-side Piped API surface — all calls go through our own /api/piped
// proxy so browser CORS blocks can't shrink the usable instance pool.

export interface PipedSearchItem {
  url: string; // "/watch?v=XXXX"
  title: string;
  thumbnail: string;
  uploaderName: string;
  uploaderVerified?: boolean;
  duration: number; // seconds
  views?: number;
}

export interface PipedStream {
  url: string;
  format: string;
  quality: string;
  mimeType: string;
  bitrate?: number;
  videoOnly?: boolean;
  codec?: string;
}

export interface PipedStreamsResponse {
  title: string;
  uploader: string;
  thumbnailUrl: string;
  duration: number;
  audioStreams: PipedStream[];
  videoStreams: PipedStream[];
  hls?: string;
  dash?: string;
  relatedStreams: PipedSearchItem[];
}

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`/api/piped?path=${encodeURIComponent(path)}`);
  if (!res.ok) {
    let msg = `Gateway error ${res.status}`;
    try {
      const b = await res.json();
      if (b?.error) msg = String(b.error);
    } catch {}
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export function extractVideoId(url: string): string {
  const m = url.match(/[?&]v=([^&]+)/);
  return m ? m[1] : url.replace(/^\//, "");
}

// Route any remote media/image URL through our own origin so the browser
// never talks to googlevideo/pipedproxy hosts directly.
export function mediaUrl(url?: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("/")) return url;
  return `/api/stream?url=${encodeURIComponent(url)}`;
}

export async function searchYouTube(
  query: string,
  filter: "videos" | "music_songs" = "videos"
): Promise<PipedSearchItem[]> {
  const data = await apiFetch<unknown>(
    `/search?q=${encodeURIComponent(query)}&filter=${filter}`
  );
  const items = Array.isArray(data)
    ? data
    : (data as { items?: unknown[] })?.items ?? [];
  return (items as PipedSearchItem[]).filter(
    (i) => i && typeof i.url === "string" && i.url.includes("watch?v=")
  );
}

export async function getStreams(
  videoId: string
): Promise<PipedStreamsResponse> {
  return apiFetch<PipedStreamsResponse>(`/streams/${videoId}`);
}

export function bestAudioStream(streams: PipedStream[]): PipedStream | null {
  if (!streams?.length) return null;
  // Prefer m4a (works in Safari/car browsers), then highest bitrate
  const m4a = streams.filter((s) => /mp4|m4a|aac/i.test(s.mimeType ?? ""));
  const pool = m4a.length ? m4a : streams;
  return pool.reduce((a, b) => ((b.bitrate ?? 0) > (a.bitrate ?? 0) ? b : a));
}

export function bestVideoStream(streams: PipedStream[]): PipedStream | null {
  if (!streams?.length) return null;
  // Progressive streams carry audio+video together — simplest to play
  const progressive = streams.filter((s) => s.videoOnly === false);
  const pool = (progressive.length ? progressive : streams).filter((s) =>
    /mp4|webm/i.test(s.mimeType ?? "")
  );
  if (!pool.length) return null;
  const res = (s: PipedStream) => parseInt(s.quality) || 0;
  // Cap at 1080p — plenty for a car screen, kinder to bandwidth
  const underCap = pool.filter((s) => res(s) <= 1080);
  return (underCap.length ? underCap : pool).reduce((a, b) =>
    res(b) > res(a) ? b : a
  );
}
