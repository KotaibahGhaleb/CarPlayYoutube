import { NextRequest, NextResponse } from "next/server";
import { canonicalVideoId, type RankedCandidate } from "@/lib/match";
import { resolveTrack } from "@/lib/resolveSong";
import { sanitizeError } from "@/lib/sanitize";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

function pub(c: RankedCandidate) {
  return {
    videoId: c.videoId,
    title: c.title,
    author: c.author,
    durationSec: c.durationSec,
    notes: c.notes,
  };
}

// Same resolver the stream route uses. Low-confidence results do not pick a video.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const title = sp.get("title") || sp.get("q") || "";
  const artist = sp.get("artist") || "";
  const dur = Number(sp.get("dur"));
  if (!title.trim() && !artist.trim()) {
    return NextResponse.json({ error: "Missing title" }, { status: 400 });
  }
  try {
    const decision = await resolveTrack({
      title,
      artist,
      durationSec: dur > 0 ? dur : undefined,
    });
    return NextResponse.json({
      videoId: canonicalVideoId(decision),
      confidence: decision.confidence,
      chosen: decision.chosen ? pub(decision.chosen) : null,
      alternatives: decision.alternatives.map(pub),
    });
  } catch (e) {
    return NextResponse.json({ error: sanitizeError(e) }, { status: 502 });
  }
}
