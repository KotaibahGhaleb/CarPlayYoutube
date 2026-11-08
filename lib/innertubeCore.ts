// Direct YouTube Innertube API fallback — talks to YouTube the same way the
// official Android app does. No third-party instance involved, so it keeps
// working even when the whole Piped/Invidious pool is bot-blocked.
// (Works best from residential IPs; datacenter IPs may get flagged.)

interface YTFormat {
  url?: string;
  signatureCipher?: string;
  mimeType?: string;
  qualityLabel?: string;
  quality?: string;
  bitrate?: number;
  audioQuality?: string;
}

interface YTPlayerResponse {
  playabilityStatus?: { status?: string; reason?: string };
  videoDetails?: {
    title?: string;
    author?: string;
    lengthSeconds?: string;
    thumbnail?: { thumbnails?: { url: string }[] };
  };
  streamingData?: {
    formats?: YTFormat[];
    adaptiveFormats?: YTFormat[];
  };
}

const CLIENT = {
  clientName: "ANDROID",
  clientVersion: "20.10.38",
  androidSdkVersion: 30,
  ua: "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip",
};

// Client identities tried in order — YouTube bot-checks different clients
// independently, and the embedded/VR clients often slip through restrictions
// that flag ANDROID (esp. commercial music videos from datacenter IPs).
const PLAYER_CLIENTS = [
  {
    client: {
      clientName: "ANDROID",
      clientVersion: "20.10.38",
      androidSdkVersion: 30,
    },
    ua: CLIENT.ua,
  },
  {
    client: {
      clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
      clientVersion: "2.0",
      clientScreen: "EMBED",
    },
    ua: "Mozilla/5.0 (PlayStation; PlayStation 5/2.26) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0 Safari/605.1.15",
    thirdParty: { embedUrl: "https://www.youtube.com/" },
  },
  {
    client: {
      clientName: "ANDROID_VR",
      clientVersion: "1.57.29",
      deviceMake: "Oculus",
      deviceModel: "Quest 3",
      androidSdkVersion: 32,
    },
    ua: "com.google.android.apps.youtube.vr.oculus/1.57.29 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
  },
];

async function playerCall(
  videoId: string,
  signal?: AbortSignal
): Promise<YTPlayerResponse> {
  let lastErr: unknown = null;
  for (const c of PLAYER_CLIENTS) {
    if (signal?.aborted) throw new Error("aborted");
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const onAbort = () => ctrl.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const res = await fetch(
        "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
        {
          method: "POST",
          signal: ctrl.signal,
          headers: {
            "Content-Type": "application/json",
            "User-Agent": c.ua,
          },
          body: JSON.stringify({
            context: {
              client: { ...c.client, hl: "en", gl: "US" },
              ...("thirdParty" in c ? { thirdParty: c.thirdParty } : {}),
            },
            videoId,
          }),
        }
      );
      if (!res.ok) throw new Error(`YouTube HTTP ${res.status}`);
      const d = (await res.json()) as YTPlayerResponse;
      const sd = d.streamingData;
      if (sd && (sd.formats?.length || sd.adaptiveFormats?.length)) return d;
      lastErr = new Error(
        d.playabilityStatus?.reason ??
          d.playabilityStatus?.status ??
          "no streams"
      );
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(t);
      signal?.removeEventListener("abort", onAbort);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("YouTube failed");
}

export async function getInnertubeStreams(
  videoId: string,
  signal?: AbortSignal
) {
  const d = await playerCall(videoId, signal);

  const sd = d.streamingData;
  if (!sd || (!sd.formats?.length && !sd.adaptiveFormats?.length)) {
    const reason =
      d.playabilityStatus?.reason ?? d.playabilityStatus?.status;
    throw new Error(reason ?? "YouTube returned no streams");
  }

  const usable = (f: YTFormat) => !!f.url; // signatureCipher formats skipped

  const audioStreams = (sd.adaptiveFormats ?? [])
    .filter((f) => f.mimeType?.startsWith("audio/") && usable(f))
    .map((f) => ({
      url: f.url!,
      format: "M4A",
      quality: f.audioQuality ?? `${Math.round((f.bitrate ?? 0) / 1000)} kbps`,
      mimeType: f.mimeType!.split(";")[0],
      bitrate: f.bitrate ?? 0,
    }));

  const videoStreams = [
    ...(sd.formats ?? [])
      .filter(usable)
      .map((f) => ({
        url: f.url!,
        format: "MP4",
        quality: f.qualityLabel ?? f.quality ?? "",
        mimeType: f.mimeType?.split(";")[0] ?? "video/mp4",
        videoOnly: false,
      })),
    ...(sd.adaptiveFormats ?? [])
      .filter((f) => f.mimeType?.startsWith("video/") && usable(f))
      .map((f) => ({
        url: f.url!,
        format: "MP4",
        quality: f.qualityLabel ?? "",
        mimeType: f.mimeType?.split(";")[0] ?? "video/mp4",
        videoOnly: true,
      })),
  ];

  if (!audioStreams.length && !videoStreams.length)
    throw new Error("YouTube returned only ciphered streams");

  const thumbs = d.videoDetails?.thumbnail?.thumbnails ?? [];
  return {
    title: d.videoDetails?.title ?? "",
    uploader: d.videoDetails?.author ?? "",
    thumbnailUrl: thumbs[thumbs.length - 1]?.url ?? "",
    duration: Number(d.videoDetails?.lengthSeconds ?? 0),
    audioStreams,
    videoStreams,
    relatedStreams: [],
  };
}

// Direct YouTube search — no third-party instance, ~500ms, races Piped
// searches in the API route so song lookup doesn't wait on dead instances.
interface YTSearchItem {
  videoRenderer?: {
    videoId?: string;
    title?: { runs?: { text?: string }[] };
    ownerText?: { runs?: { text?: string }[] };
    lengthText?: { simpleText?: string };
    thumbnail?: { thumbnails?: { url?: string }[] };
  };
}

function parseDur(t?: string): number {
  if (!t) return 0;
  const p = t.split(":").map(Number);
  return p.reduce((acc, n) => acc * 60 + n, 0);
}

export async function searchInnertube(query: string, signal?: AbortSignal) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    if (signal?.aborted) throw new Error("aborted");
    const res = await fetch(
      "https://www.youtube.com/youtubei/v1/search?prettyPrint=false",
      {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "Content-Type": "application/json",
          "User-Agent": CLIENT.ua,
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: CLIENT.clientName,
              clientVersion: CLIENT.clientVersion,
              androidSdkVersion: CLIENT.androidSdkVersion,
              hl: "en",
              gl: "US",
            },
          },
          query,
        }),
      }
    );
    if (!res.ok) throw new Error(`YouTube HTTP ${res.status}`);
    const d = (await res.json()) as {
      contents?: {
        sectionListRenderer?: {
          contents?: { itemSectionRenderer?: { contents?: YTSearchItem[] } }[];
        };
      };
    };

    const out = [];
    const sections = d.contents?.sectionListRenderer?.contents ?? [];
    for (const s of sections) {
      for (const c of s?.itemSectionRenderer?.contents ?? []) {
        const v = c.videoRenderer;
        if (!v?.videoId) continue;
        const thumbs = v.thumbnail?.thumbnails ?? [];
        out.push({
          type: "stream",
          url: `/watch?v=${v.videoId}`,
          title: v.title?.runs?.[0]?.text ?? "",
          uploaderName: v.ownerText?.runs?.[0]?.text ?? "",
          thumbnail: thumbs[thumbs.length - 1]?.url ?? "",
          duration: parseDur(v.lengthText?.simpleText),
        });
      }
    }
    if (!out.length) throw new Error("YouTube search returned no results");
    return out;
  } finally {
    clearTimeout(t);
    signal?.removeEventListener("abort", onAbort);
  }
}
