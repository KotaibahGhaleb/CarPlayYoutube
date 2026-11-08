import { isVideoId, normalizeForMatch } from "./match";

// User corrections replace a bad automatic match. Version 2 drops anything
// saved by the old duration-only picker. Signed stream URLs are never stored.

export const CORRECTION_VERSION = 2;
const STORAGE_KEY = "yt_match_v2";

export interface Correction {
  videoId: string;
  title: string;
  artist: string;
}

export interface CorrectionBlob {
  version: number;
  items: Record<string, Correction>;
}

export function correctionStorageKey(artist: string, title: string): string {
  return `${normalizeForMatch(artist)}|${normalizeForMatch(title)}`;
}

export function emptyCorrections(): CorrectionBlob {
  return { version: CORRECTION_VERSION, items: {} };
}

export function parseCorrections(raw: string | null): CorrectionBlob {
  if (!raw) return emptyCorrections();
  try {
    const data = JSON.parse(raw) as Partial<CorrectionBlob> | Correction[] | null;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return emptyCorrections();
    }
    if (data.version !== CORRECTION_VERSION || !data.items || typeof data.items !== "object") {
      return emptyCorrections();
    }
    const items: Record<string, Correction> = {};
    for (const [key, value] of Object.entries(data.items)) {
      if (!value || typeof value !== "object") continue;
      const videoId = (value as Correction).videoId;
      if (!isVideoId(videoId)) continue;
      if (/https?:|googlevideo|signature|expire=/i.test(JSON.stringify(value))) continue;
      items[key] = {
        videoId,
        title: String((value as Correction).title ?? ""),
        artist: String((value as Correction).artist ?? ""),
      };
    }
    return { version: CORRECTION_VERSION, items };
  } catch {
    return emptyCorrections();
  }
}

export function rememberCorrection(
  blob: CorrectionBlob,
  artist: string,
  title: string,
  videoId: string
): CorrectionBlob {
  if (!isVideoId(videoId)) return blob;
  const key = correctionStorageKey(artist, title);
  return {
    version: CORRECTION_VERSION,
    items: {
      ...blob.items,
      [key]: { videoId, title, artist },
    },
  };
}

export function lookupCorrection(
  blob: CorrectionBlob,
  artist: string,
  title: string
): string | null {
  if (blob.version !== CORRECTION_VERSION) return null;
  const hit = blob.items[correctionStorageKey(artist, title)];
  return hit && isVideoId(hit.videoId) ? hit.videoId : null;
}

export function loadCorrections(): CorrectionBlob {
  try {
    return parseCorrections(localStorage.getItem(STORAGE_KEY));
  } catch {
    return emptyCorrections();
  }
}

export function saveCorrections(blob: CorrectionBlob) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  } catch {
    // private mode / full storage — the in-memory choice still applies
  }
}

export function directVideoId(song: { youtubeId?: string }): string | null {
  return isVideoId(song.youtubeId) ? song.youtubeId : null;
}
