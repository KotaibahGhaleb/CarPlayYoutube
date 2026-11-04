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

export async function getInnertubeStreams(videoId: string) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  let d: YTPlayerResponse;
  try {
    const res = await fetch(
      "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
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
          videoId,
        }),
      }
    );
    if (!res.ok) throw new Error(`YouTube HTTP ${res.status}`);
    d = await res.json();
  } finally {
    clearTimeout(t);
  }

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
