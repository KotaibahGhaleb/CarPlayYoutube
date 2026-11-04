"use client";

// Synced lyrics via LRCLIB (free, open CORS).

export interface LyricLine {
  time: number; // seconds
  text: string;
}

export interface LyricsResult {
  synced: LyricLine[] | null;
  plain: string | null;
}

export function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of lrc.split("\n")) {
    const m = raw.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/);
    if (!m) continue;
    const time = parseInt(m[1]) * 60 + parseFloat(m[2]);
    lines.push({ time, text: m[3].trim() });
  }
  return lines.sort((a, b) => a.time - b.time);
}

export async function getLyrics(args: {
  track: string;
  artist: string;
  album?: string;
  duration?: number; // seconds
}): Promise<LyricsResult> {
  const params = new URLSearchParams({
    track_name: args.track,
    artist_name: args.artist,
  });
  if (args.album) params.set("album_name", args.album);
  if (args.duration) params.set("duration", String(Math.round(args.duration)));

  try {
    const res = await fetch(`https://lrclib.net/api/get?${params}`);
    if (res.ok) {
      const data = await res.json();
      const synced = data.syncedLyrics ? parseLrc(data.syncedLyrics) : null;
      return { synced, plain: data.plainLyrics ?? null };
    }
  } catch {}

  // Fallback: fuzzy search, take first hit that has any lyrics
  try {
    const res = await fetch(
      `https://lrclib.net/api/search?track_name=${encodeURIComponent(
        args.track
      )}&artist_name=${encodeURIComponent(args.artist)}`
    );
    if (!res.ok) return { synced: null, plain: null };
    const hits = (await res.json()) as Array<{
      syncedLyrics?: string;
      plainLyrics?: string;
    }>;
    const withSync = hits.find((h) => h.syncedLyrics);
    if (withSync)
      return { synced: parseLrc(withSync.syncedLyrics!), plain: withSync.plainLyrics ?? null };
    const withPlain = hits.find((h) => h.plainLyrics);
    return { synced: null, plain: withPlain?.plainLyrics ?? null };
  } catch {
    return { synced: null, plain: null };
  }
}

export function activeLineIndex(lines: LyricLine[], t: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}
