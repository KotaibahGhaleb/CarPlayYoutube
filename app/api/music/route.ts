import { NextRequest, NextResponse } from "next/server";

// Music catalog proxy — iTunes Search + Apple Music charts.
// Free, no keys, no accounts. Server-side so no CORS surprises.

export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action");

  try {
    if (action === "search") {
      const q = req.nextUrl.searchParams.get("q") ?? "";
      if (!q.trim())
        return NextResponse.json({ error: "Missing q" }, { status: 400 });
      const res = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(
          q
        )}&media=music&entity=song&limit=25&country=US`
      );
      const d = await res.json();
      const songs = (d.results ?? []).map(
        (r: {
          trackId: number;
          trackName: string;
          artistName: string;
          collectionName?: string;
          artworkUrl100?: string;
          trackTimeMillis?: number;
        }) => ({
          id: String(r.trackId),
          name: r.trackName,
          artist: r.artistName,
          album: r.collectionName,
          art: r.artworkUrl100?.replace("100x100bb", "600x600bb"),
          durationMs: r.trackTimeMillis,
        })
      );
      return NextResponse.json(songs);
    }

    if (action === "top") {
      const urls = [
        "https://rss.marketingtools.apple.com/api/v2/us/music/most-played/100/songs.json",
        "https://rss.applemarketingtools.com/api/v2/us/music/most-played/50/songs.json",
      ];
      interface ChartItem {
        id: string;
        name: string;
        artistName: string;
        artworkUrl100?: string;
      }
      let d: { feed?: { results?: ChartItem[] } } | null = null;
      for (const u of urls) {
        try {
          const res = await fetch(u);
          if (res.ok) {
            d = await res.json();
            break;
          }
        } catch {
          // try next endpoint
        }
      }
      if (!d) throw new Error("Charts unavailable");
      const songs = (d.feed?.results ?? []).map(
        (r) => ({
          id: String(r.id),
          name: r.name,
          artist: r.artistName,
          art: r.artworkUrl100?.replace("100x100bb", "600x600bb"),
        })
      );
      return NextResponse.json(songs);
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Upstream failed" },
      { status: 502 }
    );
  }
}
