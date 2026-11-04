"use client";

// Music catalog — no accounts needed.
// Search/charts via iTunes (proxied server-side), playlists via YouTube
// playlist links (resolved through the Piped proxy), favorites in localStorage.

import { mediaUrl } from "./piped";

export interface Song {
  id: string;
  name: string;
  artist: string;
  album?: string;
  art?: string;
  durationMs?: number;
  youtubeId?: string; // set when the song comes from a YouTube playlist
}

export interface SavedPlaylist {
  id: string;
  name: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    let msg = `Error ${res.status}`;
    try {
      const b = await res.json();
      if (b?.error) msg = String(b.error);
    } catch {}
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export function searchSongs(q: string): Promise<Song[]> {
  return fetchJson(`/api/music?action=search&q=${encodeURIComponent(q)}`);
}

export function topSongs(): Promise<Song[]> {
  return fetchJson("/api/music?action=top");
}

// ---- favorites (localStorage) ----

const FAV_KEY = "fav_songs";

export function getFavorites(): Song[] {
  try {
    return JSON.parse(localStorage.getItem(FAV_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function toggleFavorite(song: Song): Song[] {
  const favs = getFavorites();
  const idx = favs.findIndex((s) => s.id === song.id);
  if (idx >= 0) favs.splice(idx, 1);
  else favs.unshift(song);
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(favs.slice(0, 500)));
  } catch {}
  return favs;
}

// ---- imported YouTube playlists (localStorage) ----

const PL_KEY = "yt_playlists";

export function getSavedPlaylists(): SavedPlaylist[] {
  try {
    return JSON.parse(localStorage.getItem(PL_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function playlistIdFromUrl(input: string): string | null {
  const m = input.match(/[?&]list=([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  const bare = input.trim();
  if (/^[A-Za-z0-9_-]{10,}$/.test(bare)) return bare;
  return null;
}

export function addPlaylist(id: string, name: string): SavedPlaylist[] {
  const list = getSavedPlaylists().filter((p) => p.id !== id);
  list.unshift({ id, name });
  try {
    localStorage.setItem(PL_KEY, JSON.stringify(list.slice(0, 20)));
  } catch {}
  return list;
}

export function removePlaylist(id: string): SavedPlaylist[] {
  const list = getSavedPlaylists().filter((p) => p.id !== id);
  try {
    localStorage.setItem(PL_KEY, JSON.stringify(list));
  } catch {}
  return list;
}

function cleanArtist(name: string): string {
  return name
    .replace(/\s*-\s*Topic$/i, "")
    .replace(/\s*VEVO$/i, "")
    .replace(/\s*-\s*Official.*$/i, "")
    .trim();
}

interface PipedPlaylistItem {
  url: string;
  title: string;
  thumbnail?: string;
  uploaderName?: string;
  duration?: number;
}

export async function getPlaylistSongs(
  id: string
): Promise<{ name: string; songs: Song[] }> {
  const data = await fetchJson<{
    name?: string;
    relatedStreams?: PipedPlaylistItem[];
    videos?: PipedPlaylistItem[];
  }>(`/api/piped?path=${encodeURIComponent(`/playlists/${id}`)}`);

  const items = data.relatedStreams ?? data.videos ?? [];
  const songs = items
    .filter((i) => i?.url?.includes("watch?v="))
    .map((i) => ({
      id: i.url,
      name: i.title,
      artist: cleanArtist(i.uploaderName ?? ""),
      art: mediaUrl(i.thumbnail),
      durationMs: (i.duration ?? 0) * 1000,
      youtubeId: i.url.match(/[?&]v=([^&]+)/)?.[1],
    }));
  return { name: data.name ?? "Playlist", songs };
}
