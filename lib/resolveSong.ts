import { searchInnertube } from "./innertubeCore";
import {
  decideMatch,
  type MatchCandidate,
  type MatchDecision,
  type MatchQuery,
} from "./match";
import { pipedFetch } from "./pipedCore";

// One resolver for metadata prefetch and playback. Both callers wait for the
// providers they can reach, then rank. The first response does not win.

interface RawHit {
  url?: string;
  title?: string;
  uploaderName?: string;
  author?: string;
  duration?: number;
}

function fromHit(hit: RawHit): MatchCandidate | null {
  const id = hit.url?.match(/[?&]v=([A-Za-z0-9_-]{11})/)?.[1];
  if (!id) return null;
  return {
    videoId: id,
    title: hit.title ?? "",
    author: hit.uploaderName ?? hit.author ?? "",
    durationSec: Number(hit.duration) || 0,
  };
}

async function searchPiped(
  query: string,
  signal: AbortSignal
): Promise<MatchCandidate[]> {
  const data = await pipedFetch<RawHit[] | { items?: RawHit[] }>(
    `/search?q=${encodeURIComponent(query)}&filter=music_songs`,
    6000,
    (x) => {
      const arr = Array.isArray(x) ? x : x?.items;
      return Array.isArray(arr) && arr.length > 0;
    },
    signal
  );
  const arr = Array.isArray(data) ? data : (data.items ?? []);
  return arr.map(fromHit).filter((x): x is MatchCandidate => !!x);
}

export async function gatherCandidates(
  query: MatchQuery,
  signal?: AbortSignal
): Promise<MatchCandidate[]> {
  const text = `${query.title} ${query.artist}`.replace(/\s+/g, " ").trim();
  if (!text) return [];
  const timeout = AbortSignal.timeout(7000);
  const merged = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const [direct, piped] = await Promise.allSettled([
    searchInnertube(text, merged),
    searchPiped(text, merged),
  ]);
  const hits: MatchCandidate[] = [];
  if (direct.status === "fulfilled") {
    for (const item of direct.value) {
      const c = fromHit(item);
      if (c) hits.push(c);
    }
  }
  if (piped.status === "fulfilled") hits.push(...piped.value);
  return hits;
}

export async function resolveTrack(
  query: MatchQuery,
  signal?: AbortSignal
): Promise<MatchDecision> {
  const candidates = await gatherCandidates(query, signal);
  return decideMatch(candidates, query);
}
