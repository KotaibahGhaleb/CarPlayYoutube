// Song → YouTube video ranking.
// Duration is supporting evidence. Title and artist decide the match.
// Arabic letters are kept; matching only removes tatweel, punctuation, and case.

export interface MatchQuery {
  title: string;
  artist: string;
  durationSec?: number;
}

export interface MatchCandidate {
  videoId: string;
  title: string;
  author: string;
  durationSec: number;
}

export interface RankedCandidate extends MatchCandidate {
  score: number;
  titlePoints: number;
  artistPoints: number;
  notes: string[];
  unwanted: string[];
}

export interface MatchDecision {
  confidence: "high" | "low";
  chosen: RankedCandidate | null;
  alternatives: RankedCandidate[];
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

type VersionId =
  | "cover"
  | "live"
  | "karaoke"
  | "remix"
  | "sped"
  | "slowed"
  | "instrumental"
  | "acoustic"
  | "extended"
  | "gimmick";

const VERSION_DEFS: {
  id: VersionId;
  re: RegExp;
  scope: "all" | "context";
  penalty: number;
}[] = [
  { id: "cover", re: /\bcovers?\b|نسخة\s+كفر|(?:^|\s)كفر(?:\s|$)/iu, scope: "context", penalty: 36 },
  { id: "live", re: /\blive\b|مباشر|(?:^|\s)لايف(?:\s|$)/iu, scope: "context", penalty: 28 },
  { id: "karaoke", re: /\bkaraoke\b|كاريوكي/iu, scope: "all", penalty: 40 },
  { id: "remix", re: /\bremix\b|\brmx\b|ريمكس/iu, scope: "all", penalty: 30 },
  { id: "sped", re: /\bsped\s*up\b|\bspeed\s*up\b|\bnightcore\b|\bspeedup\b/iu, scope: "all", penalty: 34 },
  { id: "slowed", re: /\bslowed\b|\breverb\b/iu, scope: "all", penalty: 34 },
  { id: "instrumental", re: /\binstrumental\b|\binst\b/iu, scope: "all", penalty: 34 },
  { id: "acoustic", re: /\bacoustic\b/iu, scope: "all", penalty: 16 },
  { id: "extended", re: /\bextended\b/iu, scope: "all", penalty: 12 },
  { id: "gimmick", re: /\b8d\b|\bbass\s*boost(?:ed)?\b/iu, scope: "all", penalty: 30 },
];

const NOISE =
  /\b(official(\s+music)?\s+(video|audio)|official\s+video|official\s+audio|lyrics?|lyric\s+video|visuali[sz]er|hd|hq|4k|mv|music\s+video|provided\s+to\s+youtube)\b/giu;

export function isVideoId(value: unknown): value is string {
  return typeof value === "string" && VIDEO_ID.test(value);
}

/** Case-fold Latin text without stripping Arabic letters or collapsing distinct words. */
export function normalizeForMatch(input: string): string {
  return input
    .normalize("NFC")
    .replace(/\u0640/g, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .toLowerCase()
    .replace(/[''`´]/g, "")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parts(raw: string): { head: string; context: string } {
  const brackets = (raw.match(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g) ?? []).join(" ");
  const split = raw.split(/\s[-–—|]\s/);
  const head = split[0] ?? raw;
  const tail = split.slice(1).join(" ");
  return { head, context: `${brackets} ${tail}`.trim() };
}

export function detectVersions(raw: string): Set<VersionId> {
  const found = new Set<VersionId>();
  const { context } = parts(raw);
  for (const def of VERSION_DEFS) {
    const hay = def.scope === "all" ? raw : context;
    if (def.re.test(hay)) found.add(def.id);
  }
  return found;
}

function coreTitle(raw: string): string {
  const { head } = parts(raw);
  let text = head.replace(NOISE, " ");
  for (const def of VERSION_DEFS) {
    if (def.scope === "all") text = text.replace(def.re, " ");
  }
  return normalizeForMatch(text);
}

function cleanAuthor(author: string): { name: string; topic: boolean; vevo: boolean } {
  const topic = /-\s*topic\s*$/i.test(author.trim());
  const vevo = /vevo\s*$/i.test(author.trim());
  const name = normalizeForMatch(
    author.replace(/\s*-\s*topic\s*$/i, "").replace(/\s*vevo\s*$/i, "")
  ).replace(/^the\s+/, "");
  return { name, topic, vevo };
}

function tokenSets(a: string, b: string): { inter: number; aSize: number; union: number } {
  const ta = a.split(" ").filter(Boolean);
  const tb = new Set(b.split(" ").filter(Boolean));
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = new Set([...ta, ...tb]).size;
  return { inter, aSize: ta.length, union };
}

function titlePoints(queryTitle: string, candidateTitle: string): number {
  const a = coreTitle(queryTitle);
  const b = coreTitle(candidateTitle);
  if (!a || !b) return 0;
  if (a === b) return 50;
  const { inter, aSize, union } = tokenSets(a, b);
  const jaccard = union ? inter / union : 0;
  const contain = aSize ? inter / aSize : 0;
  const sub = a.length > 1 && b.includes(a) ? 1 : 0;
  return Math.round(Math.max(jaccard, contain * 0.92, sub) * 50);
}

function artistPoints(queryArtist: string, author: string): number {
  const a = normalizeForMatch(queryArtist).replace(/^the\s+/, "");
  const b = cleanAuthor(author).name;
  if (!a || !b) return 0;
  if (a === b) return 30;
  const { inter, aSize } = tokenSets(a, b);
  const contain = aSize ? inter / aSize : 0;
  if (contain === 1) return 26;
  if (b.includes(a) && a.length > 2) return 24;
  return Math.round(contain * 18);
}

function durationPoints(target: number | undefined, actual: number): { points: number; distance: number } {
  if (!target || target <= 0 || !actual || actual <= 0) return { points: 0, distance: 9999 };
  const distance = Math.abs(target - actual);
  let points = 0;
  if (distance <= 2) points = 12;
  else if (distance <= 5) points = 8;
  else if (distance <= 10) points = 4;
  else if (distance <= 20) points = 0;
  else if (distance <= 45) points = -10;
  else points = -20;
  return { points, distance };
}

function rankOne(query: MatchQuery, candidate: MatchCandidate): RankedCandidate {
  const notes: string[] = [];
  const unwanted: string[] = [];
  const tp = titlePoints(query.title, candidate.title);
  const ap = artistPoints(query.artist, candidate.author);
  const author = cleanAuthor(candidate.author);
  let score = tp + ap;

  if (author.topic && ap >= 18) {
    score += 12;
    notes.push("Official");
  } else if (author.vevo && ap >= 18) {
    score += 8;
    notes.push("Official");
  } else if (ap >= 26) {
    notes.push("Artist match");
  }

  const requested = detectVersions(`${query.title} ${query.artist}`);
  const present = detectVersions(`${candidate.title} ${candidate.author}`);
  let versionDelta = 0;
  for (const def of VERSION_DEFS) {
    const has = present.has(def.id);
    const want = requested.has(def.id);
    if (has && want) {
      versionDelta += 6;
      notes.push(def.id);
    } else if (has && !want) {
      versionDelta -= def.penalty;
      unwanted.push(def.id);
    } else if (!has && want) {
      versionDelta -= 14;
    }
  }
  if (versionDelta < -48) versionDelta = -48;
  score += versionDelta;

  const dur = durationPoints(query.durationSec, candidate.durationSec);
  score += dur.points;
  if (dur.points >= 8) notes.push("Duration");

  return {
    ...candidate,
    score,
    titlePoints: tp,
    artistPoints: ap,
    notes,
    unwanted,
  };
}

export function decideMatch(
  candidates: MatchCandidate[],
  query: MatchQuery
): MatchDecision {
  const unique = new Map<string, MatchCandidate>();
  for (const c of candidates) {
    if (!isVideoId(c.videoId)) continue;
    const prev = unique.get(c.videoId);
    if (!prev) unique.set(c.videoId, { ...c, durationSec: c.durationSec || 0 });
    else {
      unique.set(c.videoId, {
        videoId: c.videoId,
        title: c.title.length > prev.title.length ? c.title : prev.title,
        author: c.author || prev.author,
        durationSec: prev.durationSec || c.durationSec || 0,
      });
    }
  }

  const ranked = [...unique.values()]
    .map((c) => rankOne(query, c))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const da = query.durationSec ? Math.abs((a.durationSec || 9999) - query.durationSec) : 0;
      const db = query.durationSec ? Math.abs((b.durationSec || 9999) - query.durationSec) : 0;
      if (da !== db) return da - db;
      return a.videoId.localeCompare(b.videoId);
    });

  const chosen = ranked[0] ?? null;
  return {
    confidence: confidenceOf(ranked),
    chosen,
    alternatives: ranked.slice(0, 6),
  };
}

function confidenceOf(ranked: RankedCandidate[]): "high" | "low" {
  const best = ranked[0];
  if (!best) return "low";
  if (best.titlePoints < 36) return "low";
  if (best.artistPoints < 15) return "low";
  if (best.unwanted.length) return "low";
  if (best.score < 55) return "low";
  const second = ranked[1];
  if (second && best.score - second.score < 10 && second.titlePoints >= 36) {
    const sameArtist = second.artistPoints >= 15 && best.artistPoints >= 15;
    if (!sameArtist) return "low";
  }
  return "high";
}

/** High-confidence pick used by both metadata lookup and playback. */
export function canonicalVideoId(decision: MatchDecision): string | null {
  if (decision.confidence !== "high" || !decision.chosen) return null;
  return decision.chosen.videoId;
}
