"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { extractVideoId, searchYouTube } from "@/lib/piped";
import { getLyrics, type LyricsResult } from "@/lib/lyrics";
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
import { useRemote, useRemoteCommands } from "./RemoteProvider";
import NowPlaying from "./NowPlaying";

// YouTube IFrame API — last-resort playback path. When our stream extraction
// is completely blocked, the official player still works everywhere
// (may occasionally play an ad, but the app never dead-ends).
/* eslint-disable @typescript-eslint/no-explicit-any */
let ytApiPromise: Promise<any> | null = null;
function loadYT(): Promise<any> {
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve) => {
    const w = window as any;
    if (w.YT?.Player) return resolve(w.YT);
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(s);
    w.onYouTubeIframeAPIReady = () => resolve(w.YT);
  });
  return ytApiPromise;
}

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

export default function MusicTab() {
  const remote = useRemote();
  const [listTitle, setListTitle] = useState("Top Songs");
  const [songs, setSongs] = useState<Song[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [favs, setFavs] = useState<Song[]>([]);
  const [playlists, setPlaylists] = useState<SavedPlaylist[]>([]);
  const [plInput, setPlInput] = useState("");
  const [plError, setPlError] = useState("");

  // playback
  const [queue, setQueue] = useState<{ songs: Song[]; index: number } | null>(
    null
  );
  const [showNow, setShowNow] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [streamError, setStreamError] = useState("");
  const [lyrics, setLyrics] = useState<LyricsResult | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);

  const audioRef = useRef<HTMLAudioElement>(null);
  const reqRef = useRef(0);
  const retriedRef = useRef<string | null>(null);
  const videoIdRef = useRef("");
  const ytRef = useRef<any>(null);
  const pollRef = useRef<number | null>(null);
  const [useIframe, setUseIframe] = useState(false);

  const current = queue ? queue.songs[queue.index] : null;
  const queueRef = useRef(queue);
  queueRef.current = queue;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const playAtRef = useRef<any>(null);

  const stopIframe = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    try {
      ytRef.current?.destroy();
    } catch {}
    ytRef.current = null;
  }, []);

  useEffect(() => stopIframe, [stopIframe]);

  // ---- list loaders ----
  const showTop = useCallback(async () => {
    setLoadingList(true);
    setListError("");
    try {
      const s = await topSongs();
      setSongs(s);
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
    setFavs(getFavorites());
    setSongs(getFavorites());
    setListTitle("Favorites");
  }, []);

  useEffect(() => {
    setPlaylists(getSavedPlaylists());
    setFavs(getFavorites());
    showTop();
  }, [showTop]);

  async function openPlaylist(p: SavedPlaylist) {
    setLoadingList(true);
    setListError("");
    try {
      const { name, songs } = await getPlaylistSongs(p.id);
      setSongs(songs);
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
      const { name, songs } = await getPlaylistSongs(id);
      if (!songs.length) throw new Error("empty playlist");
      setPlaylists(addPlaylist(id, name));
      setSongs(songs);
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

  // ---- playback ----
  const playAt = useCallback(async (list: Song[], index: number) => {
    const song = list[index];
    if (!song) return;
    if (remote.mode === "remote") {
      remote.send({ t: "music-play", songs: list, index });
      return;
    }
    const req = ++reqRef.current;
    stopIframe();
    setUseIframe(false);
    setQueue({ songs: list, index });
    setShowNow(true);
    // tell the paired phone what's playing (no-op unless hosting)
    remote.send({
      t: "np",
      name: song.name,
      artist: song.artist,
      art: song.art,
    });
    setResolving(true);
    setStreamError("");
    setLyrics(null);
    setTime(0);

    const lyricsPromise = getLyrics({
      track: song.name,
      artist: song.artist,
      album: song.album,
      duration: (song.durationMs ?? 0) / 1000,
    });

    try {
      let videoId = song.youtubeId;
      if (!videoId) {
        const items = await searchYouTube(
          `${song.name} ${song.artist}`,
          "music_songs"
        );
        if (req !== reqRef.current) return;
        if (!items.length) throw new Error("no match");
        const target = (song.durationMs ?? 0) / 1000;
        videoId = extractVideoId(
          (target
            ? items.reduce((a, b) =>
                Math.abs(b.duration - target) < Math.abs(a.duration - target)
                  ? b
                  : a
              )
            : items[0]
          ).url
        );
      }
      // The proxy resolves + streams in one invocation — no signed URL
      // ever reaches the browser, so IP-binding can't break playback.
      const el = audioRef.current;
      if (req !== reqRef.current) return;
      videoIdRef.current = videoId;
      if (el) {
        el.src = `/api/stream?v=${videoId}&kind=audio`;
        await el.play().catch(() => {});
      }
    } catch (e) {
      if (req === reqRef.current)
        setStreamError(
          `Couldn't play this song${
            e instanceof Error ? ` — ${e.message}` : ""
          }`
        );
    } finally {
      if (req === reqRef.current) setResolving(false);
    }

    const l = await lyricsPromise;
    if (req === reqRef.current) setLyrics(l);
  }, [stopIframe, remote]);

  playAtRef.current = playAt;

  // Official YT player as last resort — when extraction is fully blocked
  const startIframeFallback = useCallback(async () => {
    const req = reqRef.current;
    setStreamError("");
    setResolving(false);
    setUseIframe(true);
    const YT = await loadYT();
    if (req !== reqRef.current) return;
    stopIframe();
    const wrap = document.getElementById("yt-holder-wrap");
    if (wrap) wrap.innerHTML = '<div id="yt-holder"></div>';
    ytRef.current = new YT.Player("yt-holder", {
      videoId: videoIdRef.current,
      playerVars: { autoplay: 1, controls: 0, disablekb: 1 },
      events: {
        onReady: (e: any) => e.target.playVideo(),
        onStateChange: (e: any) => {
          const st = YT.PlayerState;
          if (e.data === st.PLAYING) {
            setPlaying(true);
            setDur(e.target.getDuration() || 0);
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = window.setInterval(
              () => setTime(e.target.getCurrentTime() || 0),
              500
            );
          } else if (e.data === st.PAUSED) {
            setPlaying(false);
          } else if (e.data === st.ENDED) {
            setPlaying(false);
            const q = queueRef.current;
            if (q)
              playAtRef.current?.(
                q.songs,
                (q.index + 1) % q.songs.length
              );
          }
        },
      },
    });
  }, [stopIframe]);

  const next = useCallback(() => {
    if (remote.mode === "remote") {
      remote.send({ t: "ctl", a: "next" });
      return;
    }
    if (!queue) return;
    playAt(queue.songs, (queue.index + 1) % queue.songs.length);
  }, [queue, playAt, remote]);

  const prev = useCallback(() => {
    if (remote.mode === "remote") {
      remote.send({ t: "ctl", a: "prev" });
      return;
    }
    if (useIframe && ytRef.current) {
      const t = ytRef.current.getCurrentTime?.() ?? 0;
      if (t > 3) {
        ytRef.current.seekTo(0, true);
        return;
      }
    }
    const el = audioRef.current;
    if (el && el.currentTime > 3 && queue) {
      el.currentTime = 0;
      return;
    }
    if (!queue) return;
    playAt(
      queue.songs,
      (queue.index - 1 + queue.songs.length) % queue.songs.length
    );
  }, [queue, playAt, useIframe, remote]);

  const toggle = useCallback(() => {
    if (remote.mode === "remote") {
      remote.send({ t: "ctl", a: "toggle" });
      return;
    }
    if (useIframe && ytRef.current) {
      if (ytRef.current.getPlayerState?.() === 1) ytRef.current.pauseVideo();
      else ytRef.current.playVideo();
      return;
    }
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  }, [useIframe, remote]);

  const seek = useCallback(
    (t: number) => {
      if (remote.mode === "remote") {
        remote.send({ t: "ctl", a: "seek", v: t });
        return;
      }
      if (useIframe && ytRef.current) ytRef.current.seekTo(t, true);
      else if (audioRef.current) audioRef.current.currentTime = t;
      setTime(t);
    },
    [useIframe, remote]
  );

  // car screen: execute commands coming from the paired phone
  useRemoteCommands((m) => {
    if (m.t === "music-play" && Array.isArray(m.songs)) {
      void playAt(m.songs as Song[], Number(m.index) || 0);
    } else if (m.t === "ctl") {
      const el = audioRef.current;
      if (m.a === "toggle") {
        if (useIframe && ytRef.current) {
          if (ytRef.current.getPlayerState?.() === 1)
            ytRef.current.pauseVideo();
          else ytRef.current.playVideo();
        } else if (el) {
          if (el.paused) el.play().catch(() => {});
          else el.pause();
        }
      } else if (m.a === "seek" && typeof m.v === "number") {
        if (useIframe && ytRef.current) ytRef.current.seekTo(m.v, true);
        else if (el) el.currentTime = m.v;
      }
      // next/prev go through the refs (they may still be mid-render here)
      else if (m.a === "next" || m.a === "prev") {
        const q = queueRef.current;
        if (!q) return;
        if (m.a === "prev" && el && el.currentTime > 3) {
          el.currentTime = 0;
          return;
        }
        playAtRef.current?.(
          q.songs,
          m.a === "next"
            ? (q.index + 1) % q.songs.length
            : (q.index - 1 + q.songs.length) % q.songs.length
        );
      }
    }
  });

  // media session — car/lock-screen controls
  useEffect(() => {
    if (!("mediaSession" in navigator) || !current) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.name,
      artist: current.artist,
      album: current.album ?? "",
      artwork: current.art
        ? [{ src: current.art, sizes: "600x600", type: "image/jpeg" }]
        : [],
    });
    navigator.mediaSession.setActionHandler("play", toggle);
    navigator.mediaSession.setActionHandler("pause", toggle);
    navigator.mediaSession.setActionHandler("nexttrack", next);
    navigator.mediaSession.setActionHandler("previoustrack", prev);
  }, [current, toggle, next, prev]);

  // ---- render ----
  return (
    <div className="relative flex h-full">
      {/* sidebar */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-neutral-800 md:w-72">
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <button
            onClick={showTop}
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
              <span className="block truncate text-sm font-bold">
                Favorites
              </span>
              <span className="text-xs text-neutral-500">
                {favs.length} songs
              </span>
            </span>
          </button>

          {playlists.length > 0 && (
            <p className="mb-1 mt-4 px-2 text-xs font-bold uppercase tracking-wider text-neutral-500">
              Your playlists
            </p>
          )}
          {playlists.map((p) => (
            <div key={p.id} className="group mb-1 flex items-center">
              <button
                onClick={() => openPlaylist(p)}
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

        {/* playlist import */}
        <form
          onSubmit={onImport}
          className="shrink-0 border-t border-neutral-800 p-3"
        >
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

      {/* main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <form onSubmit={onSearch} className="flex shrink-0 gap-3 p-4 pb-2">
          <input
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Search songs…"
            className="h-12 min-w-0 flex-1 rounded-2xl border border-neutral-800 bg-neutral-900 px-5 outline-none placeholder:text-neutral-500 focus:border-green-600"
          />
        </form>
        <p className="shrink-0 px-5 pb-1 text-xs font-bold uppercase tracking-wider text-neutral-500">
          {listTitle}
        </p>
        {listError && (
          <p className="shrink-0 px-5 pb-1 text-sm text-red-400">{listError}</p>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {loadingList ? (
            <p className="p-4 text-neutral-500">Loading…</p>
          ) : songs.length === 0 ? (
            <p className="p-4 text-neutral-600">
              {listTitle === "Favorites"
                ? "No favorites yet — tap ♥ on any song"
                : "Nothing here"}
            </p>
          ) : (
            songs.map((s, i) => {
              const isCurrent = current?.id === s.id;
              const isFav = favs.some((f) => f.id === s.id);
              return (
                <div
                  key={`${s.id}-${i}`}
                  className={`flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition ${
                    isCurrent ? "bg-neutral-900" : "hover:bg-neutral-900/70"
                  }`}
                >
                  <button
                    onClick={() => playAt(songs, i)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left active:scale-95"
                  >
                    {s.art ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={s.art}
                        alt=""
                        className="h-12 w-12 shrink-0 rounded-lg object-cover"
                      />
                    ) : (
                      <span className="h-12 w-12 shrink-0 rounded-lg bg-neutral-800" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-sm font-semibold ${
                          isCurrent ? "text-green-400" : ""
                        }`}
                      >
                        {s.name}
                      </span>
                      <span className="block truncate text-xs text-neutral-400">
                        {s.artist}
                      </span>
                    </span>
                    {isCurrent && playing && (
                      <span className="flex items-end gap-0.5 pr-1">
                        {[0, 1, 2].map((j) => (
                          <span
                            key={j}
                            className="eq-bar inline-block w-0.5 rounded-full bg-green-500"
                            style={{
                              height: `${8 + j * 4}px`,
                              animationDelay: `${j * 0.2}s`,
                            }}
                          />
                        ))}
                      </span>
                    )}
                    <span className="shrink-0 text-xs tabular-nums text-neutral-500">
                      {fmtDur(s.durationMs)}
                    </span>
                  </button>
                  <button
                    onClick={() => setFavs(toggleFavorite(s))}
                    className="shrink-0 rounded-full p-2 hover:bg-neutral-800"
                    aria-label="Favorite"
                  >
                    <Heart filled={isFav} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* mini player bar */}
      {current && !showNow && (
        <button
          onClick={() => setShowNow(true)}
          className="absolute bottom-3 left-1/2 z-40 flex w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 items-center gap-3 rounded-2xl border border-neutral-700 bg-neutral-900/95 p-2.5 text-left shadow-xl backdrop-blur"
        >
          {current.art && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={current.art}
              alt=""
              className="h-11 w-11 rounded-lg object-cover"
            />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold">
              {current.name}
            </span>
            <span className="block truncate text-xs text-neutral-400">
              {current.artist}
            </span>
          </span>
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              toggle();
            }}
            onKeyDown={(e) => e.key === "Enter" && toggle()}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-black"
          >
            {playing ? (
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="ml-0.5 h-5 w-5 fill-current">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </span>
        </button>
      )}

      {/* remote control bar — phone mirroring mode */}
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
            onClick={prev}
            className="flex h-11 w-11 items-center justify-center rounded-full text-neutral-300 hover:bg-neutral-800"
            aria-label="Previous"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
              <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
            </svg>
          </button>
          <button
            onClick={toggle}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-black"
            aria-label="Play/pause"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
              <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
            </svg>
          </button>
          <button
            onClick={next}
            className="flex h-11 w-11 items-center justify-center rounded-full text-neutral-300 hover:bg-neutral-800"
            aria-label="Next"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
              <path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z" />
            </svg>
          </button>
        </div>
      )}

      {/* full now-playing */}
      {showNow && current && (
        <NowPlaying
          track={current}
          playing={playing}
          time={time}
          dur={dur}
          lyrics={lyrics}
          resolving={resolving}
          streamError={streamError}
          onToggle={toggle}
          onNext={next}
          onPrev={prev}
          onSeek={seek}
          onClose={() => setShowNow(false)}
        />
      )}

      {/* hidden YT iframe — last-resort playback path */}
      <div
        id="yt-holder-wrap"
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 h-px w-px overflow-hidden opacity-0"
      >
        <div id="yt-holder" />
      </div>

      <audio
        ref={audioRef}
        className="hidden"
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
        onDurationChange={(e) => setDur(e.currentTarget.duration)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={next}
        onError={() => {
          // Signed stream URLs can expire/rate-limit — regenerate once,
          // then fall back to the official embedded player
          const q = queueRef.current;
          if (q && retriedRef.current !== q.songs[q.index]?.id) {
            retriedRef.current = q.songs[q.index].id;
            playAtRef.current?.(q.songs, q.index);
          } else if (videoIdRef.current) {
            startIframeFallback();
          } else {
            setStreamError("Playback failed — try another song");
          }
        }}
      />
    </div>
  );
}
