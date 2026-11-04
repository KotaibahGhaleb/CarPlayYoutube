// Invidious fallback — a different YouTube frontend ecosystem with its own
// instance pool and IPs. Used when Piped instances are bot-blocked/down.

const FALLBACK_INSTANCES = [
  "https://yewtu.be",
  "https://inv.nadeko.net",
  "https://invidious.nerdvpn.de",
  "https://iv.melmac.space",
  "https://invidious.f5.si",
  "https://inv.tux.pizza",
  "https://iv.datura.network",
  "https://invidious.jing.rocks",
];

const INSTANCES_LIST_URL = "https://api.invidious.io/instances.json";

let cachedInstances: string[] | null = null;
let cacheTime = 0;
let lastGood: string | null = null;

async function fetchJson<T>(url: string, timeoutMs: number): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "carplay-media/1.0" },
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const b = await res.json();
        if (typeof b?.error === "string")
          msg = b.error.split("\n")[0].slice(0, 200);
      } catch {}
      throw new Error(msg);
    }
    const body = (await res.json()) as T;
    const err = (body as { error?: unknown })?.error;
    if (typeof err === "string" && err)
      throw new Error(err.split("\n")[0].slice(0, 200));
    return body;
  } finally {
    clearTimeout(t);
  }
}

async function getInstances(): Promise<string[]> {
  if (cachedInstances && Date.now() - cacheTime < 10 * 60 * 1000)
    return cachedInstances;

  let remote: string[] = [];
  try {
    const data = await fetchJson<
      Array<[string, { api?: boolean; uri?: string }]>
    >(INSTANCES_LIST_URL, 5000);
    remote = (Array.isArray(data) ? data : [])
      .filter((i) => Array.isArray(i) && i[1]?.api === true && i[1]?.uri)
      .map((i) => i[1].uri as string);
  } catch {
    // fall back to hardcoded list
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

async function invFetch<T>(path: string, timeoutMs = 7000): Promise<T> {
  const instances = (await getInstances()).slice(0, 12);
  const BATCH = 4;
  let lastError: unknown = null;

  for (let i = 0; i < instances.length; i += BATCH) {
    const batch = instances.slice(i, i + BATCH);
    try {
      const { base, data } = await Promise.any(
        batch.map(async (base) => ({
          base,
          data: await fetchJson<T>(base + path, timeoutMs),
        }))
      );
      lastGood = base.replace(/\/+$/, "");
      return data;
    } catch (e) {
      lastError = e instanceof AggregateError ? e.errors[0] : e;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("All Invidious instances are unreachable");
}

// ---- Invidious response types (subset) ----
interface InvFormat {
  url: string;
  type?: string;
  qualityLabel?: string;
  quality?: string;
  container?: string;
  bitrate?: string;
}
interface InvVideo {
  title: string;
  author: string;
  lengthSeconds: number;
  videoThumbnails?: { quality: string; url: string }[];
  formatStreams?: InvFormat[];
  adaptiveFormats?: InvFormat[];
  recommendedVideos?: {
    videoId: string;
    title: string;
    author: string;
    lengthSeconds: number;
    videoThumbnails?: { quality: string; url: string }[];
  }[];
}

function thumb(
  thumbs?: { quality: string; url: string }[],
  pref = "mqdefault"
): string {
  return (
    thumbs?.find((t) => t.quality === pref)?.url ?? thumbs?.[0]?.url ?? ""
  );
}

// Transform Invidious /api/v1/videos/{id} into the Piped streams shape the
// rest of the app already understands.
export async function getInvidiousStreams(videoId: string) {
  const v = await invFetch<InvVideo>(`/api/v1/videos/${videoId}`);

  const audioStreams = (v.adaptiveFormats ?? [])
    .filter((f) => f.type?.startsWith("audio/"))
    .map((f) => ({
      url: f.url,
      format: (f.container ?? "").toUpperCase(),
      quality: `${Math.round(Number(f.bitrate ?? 0) / 1000)} kbps`,
      mimeType: f.type?.split(";")[0] ?? "audio/mp4",
      bitrate: Number(f.bitrate ?? 0),
    }));

  const videoStreams = [
    // progressive (audio+video)
    ...(v.formatStreams ?? [])
      .filter((f) => f.url)
      .map((f) => ({
        url: f.url,
        format: (f.container ?? "MP4").toUpperCase(),
        quality: f.qualityLabel ?? f.quality ?? "",
        mimeType: f.type?.split(";")[0] ?? "video/mp4",
        videoOnly: false,
      })),
    // video-only
    ...(v.adaptiveFormats ?? [])
      .filter((f) => f.type?.startsWith("video/") && f.url)
      .map((f) => ({
        url: f.url,
        format: (f.container ?? "MP4").toUpperCase(),
        quality: f.qualityLabel ?? "",
        mimeType: f.type?.split(";")[0] ?? "video/mp4",
        videoOnly: true,
      })),
  ];

  const relatedStreams = (v.recommendedVideos ?? [])
    .slice(0, 20)
    .map((r) => ({
      url: `/watch?v=${r.videoId}`,
      title: r.title,
      thumbnail: thumb(r.videoThumbnails, "medium"),
      uploaderName: r.author,
      duration: r.lengthSeconds ?? 0,
    }));

  return {
    title: v.title,
    uploader: v.author,
    thumbnailUrl: thumb(v.videoThumbnails, "maxres") || thumb(v.videoThumbnails),
    duration: v.lengthSeconds ?? 0,
    audioStreams,
    videoStreams,
    relatedStreams,
  };
}
