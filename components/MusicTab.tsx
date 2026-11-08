"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import AccountPanel from "./AccountPanel";
import { usePlayback } from "./PlaybackProvider";
import { useRemote } from "./RemoteProvider";
import NowPlaying from "./NowPlaying";
import {
  addPlaylist,
  getFavorites,
  getPlaylistSongs,
  getSavedPlaylists,
  playlistIdFromUrl,
  removePlaylist,
  searchSongs,
  toggleFavorite,
  topSongs,
  type SavedPlaylist,
  type Song,
} from "@/lib/music";
import type { HomeSection, LibraryPlaylist } from "@/lib/libraryTypes";

function fmtDur(ms?: number) {
  if (!ms) return "";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

function Heart({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-5 w-5 ${
        filled ? "fill-green-500" : "fill-none stroke-neutral-500 stroke-2"
      }`}
    >
      <path d="M12 21s-7.5-4.9-9.9-9.2C.4 8.6 2.3 5 5.7 5c2 0 3.4 1.1 4.3 2.6h4c.9-1.5 2.3-2.6 4.3-2.6 3.4 0 5.3 3.6 3.6 6.8C19.5 16.1 12 21 12 21Z" />
    </svg>
  );
}

function PlayIcon({ playing }: { playing: boolean }) {
  return playing ? (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
      <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" className="ml-0.5 h-5 w-5 fill-current">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

export default function MusicTab() {
  const remote = useRemote();
  const player = usePlayback();
  const [listTitle, setListTitle] = useState("Top Songs");
  const [songs, setSongs] = useState<Song[]>([]);
  const [home, setHome] = useState<HomeSection[] | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [favs, setFavs] = useState<Song[]>([]);
  const [playlists, setPlaylists] = useState<SavedPlaylist[]>([]);
  const [accountPlaylists, setAccountPlaylists] = useState<LibraryPlaylist[]>([]);
  const [accountOpen, setAccountOpen] = useState(false);
  const [libraryTick, setLibraryTick] = useState(0);
  const [plInput, setPlInput] = useState("");
  const [plError, setPlError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [morePath, setMorePath] = useState("");

  const current = player.queue ? player.queue.songs[player.queue.index] : null;
  const playing = player.phase === "playing";
  const carPhase = String(remote.carState?.phase ?? "");
  const carActive = carPhase === "playing" || carPhase === "buffering";

  const showTop = useCallback(async () => {
    setLoadingList(true);
    setListError("");
    setHome(null);
    setHasMore(false);
    setMorePath("");
    try {
      setSongs(await topSongs());
      setListTitle("Top Songs");
    } catch (e) {
      setListError(
        `Couldn't load charts${e instanceof Error ? ` — ${e.message}` : ""}`
      );
    } finally {
      setLoadingList(false);
    }
  }, []);

  const showFavs = useCallback(() => {
    const items = getFavorites();
    setFavs(items);
    setSongs(items);
    setHome(null);
    setHasMore(false);
    setMorePath("");
    setListTitle("Favorites");
    setListError("");
  }, []);

  useEffect(() => {
    setPlaylists(getSavedPlaylists());
    setFavs(getFavorites());
    void showTop();
  }, [showTop]);

  useEffect(() => {
    let cancel = false;
    void (async () => {
      const res = await fetch("/api/library/status");
      if (cancel || !res.ok) {
        if (!cancel) setAccountPlaylists([]);
        return;
      }
      const status = (await res.json()) as { connected?: boolean };
      if (!status.connected) {
        setAccountPlaylists([]);
        return;
      }
      const lists = await fetch("/api/library/playlists?limit=25&offset=0");
      const body = (await lists.json()) as { items?: LibraryPlaylist[] };
      if (!cancel && lists.ok) setAccountPlaylists(body.items ?? []);
    })().catch(() => {
      if (!cancel) setAccountPlaylists([]);
    });
    return () => {
      cancel = true;
    };
  }, [libraryTick]);

  async function openPlaylist(p: SavedPlaylist) {
    setLoadingList(true);
    setListError("");
    setHome(null);
    setHasMore(false);
    setMorePath("");
    try {
      const { name, songs: rows } = await getPlaylistSongs(p.id);
      setSongs(rows);
      setListTitle(name);
    } catch (e) {
      setListError(
        `Couldn't load playlist${e instanceof Error ? ` — ${e.message}` : ""}`
      );
    } finally {
      setLoadingList(false);
    }
  }

  async function onImport(e: FormEvent) {
    e.preventDefault();
    const id = playlistIdFromUrl(plInput);
    if (!id) {
      setPlError("Paste a YouTube playlist link");
      return;
    }
    setPlError("");
    setLoadingList(true);
    try {
      const { name, songs: rows } = await getPlaylistSongs(id);
      if (!rows.length) throw new Error("empty playlist");
      setPlaylists(addPlaylist(id, name));
      setSongs(rows);
      setHome(null);
      setListTitle(name);
      setPlInput("");
    } catch {
      setPlError("Couldn't read that playlist — is it public/unlisted?");
    } finally {
      setLoadingList(false);
    }
  }

  async function onSearch(e: FormEvent) {
    e.preventDefault();
    if (!searchQ.trim()) return;
    setLoadingList(true);
    setListError("");
    setHome(null);
    setHasMore(false);
    setMorePath("");
    try {
      setSongs(await searchSongs(searchQ.trim()));
      setListTitle(`Results for "${searchQ.trim()}"`);
    } catch (e) {
      setListError(
        `Search failed${e instanceof Error ? ` — ${e.message}` : ""}`
      );
    } finally {
      setLoadingList(false);
    }
  }

  async function loadAccount(path: string, title: string, append: boolean) {
    setLoadingList(true);
    setListError("");
    setHome(null);
    const offset = append ? songs.length : 0;
    const join = path.includes("?") ? "&" : "?";
    try {
      const res = await fetch(`${path}${join}limit=25&offset=${offset}`);
      if (res.status === 401) {
        setAccountOpen(true);
        setListError("Unlock your library to see this list.");
        return;
      }
      const body = (await res.json()) as {
        items?: Song[];
        hasMore?: boolean;
        error?: string;
        message?: string;
        name?: string;
      };
      if (!res.ok) {
        setListError(body.message || body.error || "Couldn't load your library");
        if (!append) setSongs([]);
        return;
      }
      const items = body.items ?? [];
      setSongs(append ? [...songs, ...items] : items);
      setListTitle(body.name || title);
      setHasMore(!!body.hasMore);
      setMorePath(path);
    } catch (e) {
      setListError(
        e instanceof Error ? e.message : "Couldn't load your library"
      );
    } finally {
      setLoadingList(false);
    }
  }

  async function showHomeFeed() {
    setLoadingList(true);
    setListError("");
    setSongs([]);
    setHasMore(false);
    setMorePath("");
    try {
      const res = await fetch("/api/library/home?limit=8");
      if (res.status === 401) {
        setAccountOpen(true);
        setListError("Unlock your library to see recommendations.");
        setHome(null);
        return;
      }
      const body = (await res.json()) as {
        sections?: HomeSection[];
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        setHome(null);
        setListError(body.message || body.error || "Couldn't load recommendations");
        return;
      }
      setHome(body.sections ?? []);
      setListTitle("For You");
    } catch (e) {
      setHome(null);
      setListError(e instanceof Error ? e.message : "Couldn't load recommendations");
    } finally {
      setLoadingList(false);
    }
  }

  function playSong(list: Song[], index: number) {
    const song = list[index];
    if (song?.available === false) {
      setListError("That track is unavailable in your library.");
      return;
    }
    player.playAt(list, index);
  }

  const libraryButtons = (
    <>
      <button
        onClick={() => setAccountOpen(true)}
        className="mb-1 flex w-full items-center gap-3 rounded-xl p-2.5 text-left hover:bg-neutral-900 active:scale-95"
      >
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-red-600 text-xl">
          ▷
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-bold">YouTube Music</span>
          <span className="text-xs text-neutral-500">
            {accountPlaylists.length ? "Connected" : "Connect account"}
          </span>
        </span>
      </button>
      {accountPlaylists.length > 0 && (
        <>
          <button
            onClick={() => void loadAccount("/api/library/liked", "Liked Songs", false)}
            className="mb-1 flex w-full items-center gap-3 rounded-xl p-2.5 text-left hover:bg-neutral-900 active:scale-95"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-neutral-800 text-lg">
              ♥
            </span>
            <span className="block truncate text-sm font-semibold">Liked Songs</span>
          </button>
          <button
            onClick={() => void loadAccount("/api/library/songs", "Library Songs", false)}
            className="mb-1 flex w-full items-center gap-3 rounded-xl p-2.5 text-left hover:bg-neutral-900 active:scale-95"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-neutral-800 text-lg">
              ♪
            </span>
            <span className="block truncate text-sm font-semibold">Library Songs</span>
          </button>
          <button
            onClick={() => void showHomeFeed()}
            className="mb-1 flex w-full items-center gap-3 rounded-xl p-2.5 text-left hover:bg-neutral-900 active:scale-95"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-neutral-800 text-lg">
              ✶
            </span>
            <span className="block truncate text-sm font-semibold">For You</span>
          </button>
        </>
      )}
    </>
  );

  return (
    <div className="relative flex h-full">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-neutral-800 md:flex md:w-72">
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <button
            onClick={() => void showTop()}
            className="mb-1 flex w-full items-center gap-3 rounded-xl p-2.5 text-left hover:bg-neutral-900 active:scale-95"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-red-500 text-xl">
              ♫
            </span>
            <span className="block truncate text-sm font-bold">Top Songs</span>
          </button>
          <button
            onClick={showFavs}
            className="mb-1 flex w-full items-center gap-3 rounded-xl p-2.5 text-left hover:bg-neutral-900 active:scale-95"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-400 text-xl">
              ♥
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold">Favorites</span>
              <span className="text-xs text-neutral-500">{favs.length} songs</span>
            </span>
          </button>
          {libraryButtons}
          {accountPlaylists.length > 0 && (
            <p className="mb-1 mt-4 px-2 text-xs font-bold uppercase tracking-wider text-neutral-500">
              My playlists
            </p>
          )}
          {accountPlaylists.map((p) => (
            <button
              key={p.id}
              onClick={() =>
                void loadAccount(
                  `/api/library/playlist?id=${encodeURIComponent(p.id)}`,
                  p.name,
                  false
                )
              }
              className="mb-1 flex w-full items-center gap-3 rounded-xl p-2.5 text-left hover:bg-neutral-900 active:scale-95"
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-neutral-800 text-lg">
                ▶
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{p.name}</span>
                {p.count && (
                  <span className="text-xs text-neutral-500">{p.count} songs</span>
                )}
              </span>
            </button>
          ))}
          {playlists.length > 0 && (
            <p className="mb-1 mt-4 px-2 text-xs font-bold uppercase tracking-wider text-neutral-500">
              Imported
            </p>
          )}
          {playlists.map((p) => (
            <div key={p.id} className="group mb-1 flex items-center">
              <button
                onClick={() => void openPlaylist(p)}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-2.5 text-left hover:bg-neutral-900 active:scale-95"
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-neutral-800 text-lg">
                  ▶
                </span>
                <span className="block min-w-0 truncate text-sm font-semibold">
                  {p.name}
                </span>
              </button>
              <button
                onClick={() => setPlaylists(removePlaylist(p.id))}
                className="shrink-0 rounded-full p-2 text-neutral-600 opacity-0 transition group-hover:opacity-100 hover:text-red-400"
                aria-label="Remove playlist"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <form onSubmit={onImport} className="shrink-0 border-t border-neutral-800 p-3">
          <input
            value={plInput}
            onChange={(e) => setPlInput(e.target.value)}
            placeholder="Paste YouTube playlist link…"
            className="h-11 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 text-xs outline-none placeholder:text-neutral-600 focus:border-green-600"
          />
          {plError && (
            <p className="mt-1.5 text-xs leading-snug text-red-400">{plError}</p>
          )}
        </form>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <form onSubmit={onSearch} className="flex shrink-0 gap-3 p-3 pb-2 md:p-4 md:pb-2">
          <input
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Search songs…"
            className="h-12 min-w-0 flex-1 rounded-2xl border border-neutral-800 bg-neutral-900 px-5 outline-none placeholder:text-neutral-500 focus:border-green-600"
          />
        </form>
        <div className="scrollbar-hide flex shrink-0 gap-2 overflow-x-auto px-3 pb-2 md:hidden">
          <button
            onClick={() => void showTop()}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-neutral-800 px-4 py-2 text-xs font-bold active:scale-95"
          >
            ♫ Top
          </button>
          <button
            onClick={showFavs}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-neutral-800 px-4 py-2 text-xs font-bold active:scale-95"
          >
            ♥ Favs
          </button>
          <button
            onClick={() => setAccountOpen(true)}
            className="flex shrink-0 items-center rounded-full bg-neutral-800 px-4 py-2 text-xs font-bold active:scale-95"
          >
            YouTube Music
          </button>
          <button
            onClick={() => void loadAccount("/api/library/liked", "Liked Songs", false)}
            className="flex shrink-0 items-center rounded-full bg-neutral-800 px-4 py-2 text-xs font-bold active:scale-95"
          >
            Liked
          </button>
          <button
            onClick={() => void loadAccount("/api/library/songs", "Library Songs", false)}
            className="flex shrink-0 items-center rounded-full bg-neutral-800 px-4 py-2 text-xs font-bold active:scale-95"
          >
            Library
          </button>
          <button
            onClick={() => void showHomeFeed()}
            className="flex shrink-0 items-center rounded-full bg-neutral-800 px-4 py-2 text-xs font-bold active:scale-95"
          >
            For You
          </button>
          {playlists.map((p) => (
            <button
              key={p.id}
              onClick={() => void openPlaylist(p)}
              className="flex shrink-0 items-center rounded-full bg-neutral-800 px-4 py-2 text-xs font-bold active:scale-95"
            >
              {p.name}
            </button>
          ))}
        </div>
        <p className="shrink-0 px-5 pb-1 text-xs font-bold uppercase tracking-wider text-neutral-500">
          {listTitle}
        </p>
        {listError && (
          <p className="shrink-0 px-5 pb-1 text-sm text-red-400">{listError}</p>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {loadingList && songs.length === 0 && !home ? (
            <p className="p-4 text-neutral-500">Loading…</p>
          ) : home ? (
            home.length === 0 ? (
              <p className="p-4 text-neutral-600">No recommendations returned</p>
            ) : (
              home.map((section) => (
                <section key={section.title} className="mb-4">
                  <p className="px-2 py-2 text-sm font-bold">{section.title}</p>
                  {section.items.length === 0 ? (
                    <p className="px-2 text-xs text-neutral-600">Nothing playable in this section</p>
                  ) : (
                    section.items.map((item) =>
                      item.kind === "playlist" ? (
                        <button
                          key={item.id}
                          onClick={() =>
                            void loadAccount(
                              `/api/library/playlist?id=${encodeURIComponent(item.id)}`,
                              item.name,
                              false
                            )
                          }
                          className="flex w-full items-center gap-3 rounded-xl p-2.5 text-left hover:bg-neutral-900"
                        >
                          <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-neutral-800">
                            ▶
                          </span>
                          <span className="truncate text-sm font-semibold">{item.name}</span>
                        </button>
                      ) : (
                        <SongRow
                          key={item.song.youtubeId || item.song.id}
                          song={item.song}
                          current={current?.id === item.song.id}
                          playing={playing && current?.id === item.song.id}
                          fav={favs.some((f) => f.id === item.song.id)}
                          onPlay={() => {
                            const queue = section.items.flatMap((entry) =>
                              entry.kind === "song" ? [entry.song] : []
                            );
                            const index = queue.findIndex((s) => s.id === item.song.id);
                            playSong(queue, Math.max(0, index));
                          }}
                          onFav={() => setFavs(toggleFavorite(item.song))}
                        />
                      )
                    )
                  )}
                </section>
              ))
            )
          ) : songs.length === 0 ? (
            <p className="p-4 text-neutral-600">
              {listTitle === "Favorites"
                ? "No favorites yet — tap ♥ on any song"
                : "Nothing here"}
            </p>
          ) : (
            <>
              {songs.map((s, i) => (
                <SongRow
                  key={`${s.id}-${i}`}
                  song={s}
                  current={current?.id === s.id}
                  playing={playing && current?.id === s.id}
                  fav={favs.some((f) => f.id === s.id)}
                  onPlay={() => playSong(songs, i)}
                  onFav={() => setFavs(toggleFavorite(s))}
                />
              ))}
              {hasMore && (
                <button
                  onClick={() => void loadAccount(morePath, listTitle, true)}
                  disabled={loadingList}
                  className="mx-auto mt-2 block rounded-full bg-neutral-800 px-5 py-2 text-sm font-bold disabled:opacity-50"
                >
                  {loadingList ? "Loading…" : "Load more"}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {current && !player.showNow && (
        <button
          onClick={() => player.setShowNow(true)}
          className="absolute bottom-3 left-1/2 z-40 flex w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 items-center gap-3 rounded-2xl border border-neutral-700 bg-neutral-900/95 p-2.5 text-left shadow-xl backdrop-blur"
        >
          {current.art && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={current.art} alt="" className="h-11 w-11 rounded-lg object-cover" />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold">{current.name}</span>
            <span className="block truncate text-xs text-neutral-400">{current.artist}</span>
          </span>
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              player.toggle();
            }}
            onKeyDown={(e) => e.key === "Enter" && player.toggle()}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-black"
          >
            <PlayIcon playing={playing} />
          </span>
        </button>
      )}

      {remote.mode === "remote" && remote.carState?.name != null && (
        <div className="absolute bottom-3 left-1/2 z-40 flex w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 items-center gap-3 rounded-2xl border border-blue-900 bg-neutral-900/95 p-2.5 shadow-xl backdrop-blur">
          {typeof remote.carState.art === "string" && remote.carState.art && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={remote.carState.art}
              alt=""
              className="h-11 w-11 rounded-lg object-cover"
            />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold">
              {String(remote.carState.name)}
            </span>
            <span className="block truncate text-xs text-neutral-400">
              {String(remote.carState.artist ?? "")} · on car
            </span>
          </span>
          <button
            onClick={player.prev}
            className="flex h-11 w-11 items-center justify-center rounded-full text-neutral-300 hover:bg-neutral-800"
            aria-label="Previous"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
              <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
            </svg>
          </button>
          <button
            onClick={player.toggle}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-black"
            aria-label={carActive ? "Pause" : "Play"}
          >
            <PlayIcon playing={carActive} />
          </button>
          <button
            onClick={player.next}
            className="flex h-11 w-11 items-center justify-center rounded-full text-neutral-300 hover:bg-neutral-800"
            aria-label="Next"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
              <path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z" />
            </svg>
          </button>
        </div>
      )}

      {player.showNow && current && (
        <NowPlaying
          track={current}
          playing={playing}
          buffering={player.phase === "buffering"}
          time={player.time}
          dur={player.dur}
          lyrics={player.lyrics}
          resolving={player.phase === "resolving"}
          streamError={player.phase === "error" ? player.error || "Playback failed" : ""}
          needsGesture={player.needsGesture}
          choosing={player.choosing}
          alternatives={player.alternatives}
          engineLabel={player.engine === "iframe" ? "Official player" : ""}
          onToggle={player.toggle}
          onNext={player.next}
          onPrev={player.prev}
          onSeek={player.seek}
          onClose={() => player.setShowNow(false)}
          onChoose={player.chooseVersion}
          onOpenVersions={player.openVersions}
          onRetry={player.retry}
        />
      )}

      {accountOpen && (
        <AccountPanel
          onClose={() => setAccountOpen(false)}
          onChanged={() => setLibraryTick((n) => n + 1)}
        />
      )}
    </div>
  );
}

function SongRow({
  song,
  current,
  playing,
  fav,
  onPlay,
  onFav,
}: {
  song: Song;
  current: boolean;
  playing: boolean;
  fav: boolean;
  onPlay: () => void;
  onFav: () => void;
}) {
  const unavailable = song.available === false;
  return (
    <div
      className={`flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition ${
        current ? "bg-neutral-900" : "hover:bg-neutral-900/70"
      } ${unavailable ? "opacity-50" : ""}`}
    >
      <button
        onClick={onPlay}
        disabled={unavailable}
        className="flex min-w-0 flex-1 items-center gap-3 text-left active:scale-95 disabled:active:scale-100"
      >
        {song.art ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={song.art} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
        ) : (
          <span className="h-12 w-12 shrink-0 rounded-lg bg-neutral-800" />
        )}
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm font-semibold ${current ? "text-green-400" : ""}`}>
            {song.name}
          </span>
          <span className="block truncate text-xs text-neutral-400">
            {song.artist}
            {unavailable ? " · Unavailable" : ""}
          </span>
        </span>
        {current && playing && (
          <span className="flex items-end gap-0.5 pr-1">
            {[0, 1, 2].map((j) => (
              <span
                key={j}
                className="eq-bar inline-block w-0.5 rounded-full bg-green-500"
                style={{ height: `${8 + j * 4}px`, animationDelay: `${j * 0.2}s` }}
              />
            ))}
          </span>
        )}
        <span className="shrink-0 text-xs tabular-nums text-neutral-500">
          {fmtDur(song.durationMs)}
        </span>
      </button>
      <button
        onClick={onFav}
        className="shrink-0 rounded-full p-2 hover:bg-neutral-800"
        aria-label="Favorite"
      >
        <Heart filled={fav} />
      </button>
    </div>
  );
}
