import { NextRequest, NextResponse } from "next/server";
import { pipedFetch } from "@/lib/pipedCore";
import { getInvidiousStreams } from "@/lib/invidiousCore";
import { getInnertubeStreams } from "@/lib/innertubeCore";

export const maxDuration = 60;

// GET /api/piped?path=/search?q=...&filter=videos
// Proxies Piped API calls server-side — bypasses browser CORS blocks and
// lets us use every healthy instance, not just CORS-enabled ones.
export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path");
  if (
    !path ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("://")
  ) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  const isStreams = path.startsWith("/streams/");
  const validate = isStreams
    ? (d: unknown) => {
        const s = d as {
          videoStreams?: unknown[];
          audioStreams?: unknown[];
          hls?: string;
        };
        return (
          !!s &&
          ((s.videoStreams?.length ?? 0) > 0 ||
            (s.audioStreams?.length ?? 0) > 0 ||
            !!s.hls)
        );
      }
    : undefined;

  try {
    const data = await pipedFetch(path, 7000, validate);
    return NextResponse.json(data);
  } catch (e) {
    // Piped pool exhausted — for /streams, fall back to Invidious, then
    // direct YouTube Innertube (different IPs/block lists at each layer)
    if (isStreams) {
      const videoId = path.split("/")[2];
      if (videoId) {
        try {
          const data = await getInvidiousStreams(videoId);
          return NextResponse.json(data);
        } catch {
          try {
            const data = await getInnertubeStreams(videoId);
            return NextResponse.json(data);
          } catch {
            // fall through to the original Piped error below
          }
        }
      }
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Upstream failed" },
      { status: 502 }
    );
  }
}
