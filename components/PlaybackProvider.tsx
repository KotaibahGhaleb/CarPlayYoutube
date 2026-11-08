"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  directVideoId,
  loadCorrections,
  lookupCorrection,
  rememberCorrection,
  saveCorrections,
} from "@/lib/corrections";
import { getLyrics, type LyricsResult } from "@/lib/lyrics";
import type { Song } from "@/lib/music";
import {
  initialPlayback,
  isTruncatedPlayback,
  mediaSessionPlaybackState,
  reducePlayback,
  type EngineName,
  type ModelEvent,
  type PlaybackModel,
} from "@/lib/playbackMachine";
import { sanitizeError } from "@/lib/sanitize";
import { useRemote, useRemoteCommands, type RemoteMode } from "./RemoteProvider";
import type { RemoteMsg } from "@/lib/remote";

type Alternative = {
  videoId: string;
  title: string;
  author: string;
  durationSec: number;
  notes?: string[];
};

type DebugRow = {
  t: number;
  event: string;
  phase: string;
  intent: string;
  engine: string;
  videoId: string | null;
  requestId: number;
  readyState?: number;
  error?: string;
};

interface PlaybackApi {
  queue: { songs: Song[]; index: number } | null;
  phase: PlaybackModel["phase"];
  intent: PlaybackModel["intent"];
  engine: EngineName;
  videoId: string | null;
  needsGesture: boolean;
  time: number;
  dur: number;
  lyrics: LyricsResult | null;
  error: string | null;
  choosing: boolean;
  alternatives: Alternative[];
  showNow: boolean;
  setShowNow: (open: boolean) => void;
  playAt: (songs: Song[], index: number) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (t: number) => void;
  chooseVersion: (videoId: string) => void;
  openVersions: () => void;
  retry: () => void;
}

const Ctx = createContext<PlaybackApi | null>(null);

export function usePlayback() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("Playback is not available");
  return ctx;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
let ytApiPromise: Promise<any> | null = null;
function loadYT(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  const w = window as any;
  if (w.YT?.Player) return Promise.resolve(w.YT);
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      ytApiPromise = null;
      reject(new Error("YouTube player script timed out"));
    }, 8000);
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timer);
      prev?.();
      if (w.YT?.Player) resolve(w.YT);
      else {
        ytApiPromise = null;
        reject(new Error("YouTube player script loaded without a player"));
      }
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    s.onerror = () => {
      window.clearTimeout(timer);
      ytApiPromise = null;
      reject(new Error("YouTube player script failed to load"));
    };
    document.head.appendChild(s);
  });
  return ytApiPromise;
}

function iframeError(code: number): string {
  if (code === 101 || code === 150) return "This video can't be embedded";
  if (code === 100) return "This video is unavailable";
  if (code === 5) return "The YouTube player hit a playback error";
  if (code === 2) return "The YouTube player rejected this video";
  return "The official player couldn't start this video";
}

export default function PlaybackProvider({ children }: { children: ReactNode }) {
  const remote = useRemote();
  const modeRef = useRef<RemoteMode>(remote.mode);
  modeRef.current = remote.mode;
  const sendRef = useRef(remote.send);
  sendRef.current = remote.send;

  const modelRef = useRef<PlaybackModel>(initialPlayback);
  const [model, setModel] = useState<PlaybackModel>(initialPlayback);
  const [queue, setQueue] = useState<{ songs: Song[]; index: number } | null>(null);
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [lyrics, setLyrics] = useState<LyricsResult | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [alternatives, setAlternatives] = useState<Alternative[]>([]);
  const altsRef = useRef<Alternative[]>([]);
  altsRef.current = alternatives;
  const [showNow, setShowNow] = useState(false);
  const [debug, setDebug] = useState<DebugRow[]>([]);

  const audioRef = useRef<HTMLAudioElement>(null);
  const ytHostRef = useRef<HTMLDivElement>(null);
  const ytRef = useRef<any>(null);
  const pollRef = useRef<number | null>(null);
  const reqRef = useRef(0);
  const attemptRef = useRef(0);
  const expectedRef = useRef(0);
  const suppressRef = useRef(false);
  const audioToken = useRef(0);
  const matchAbort = useRef<AbortController | null>(null);
  const dev = process.env.NODE_ENV !== "production";

  const log = useCallback(
    (event: string, error?: string) => {
      if (!dev) return;
      const m = modelRef.current;
      const row: DebugRow = {
        t: Date.now(),
        event,
        phase: m.phase,
        intent: m.intent,
        engine: m.engine,
        videoId: m.videoId,
        requestId: m.requestId,
        readyState: audioRef.current?.readyState,
        error: error ? sanitizeError(error) : undefined,
      };
      console.debug("[playback]", row);
      setDebug((d) => [...d.slice(-39), row]);
    },
    [dev]
  );

  const dispatch = useCallback(
    (event: ModelEvent) => {
      const next = reducePlayback(modelRef.current, event);
      modelRef.current = next;
      setModel(next);
      log(event.type === "engine" ? `engine:${event.event}` : event.type);
      return next;
    },
    [log]
  );

  const clearAudio = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    suppressRef.current = true;
    audioToken.current++;
    try {
      el.pause();
    } catch {
      /* element may already be idle */
    }
    el.removeAttribute("src");
    try {
      el.load();
    } catch {
      /* ignore */
    }
    window.setTimeout(() => {
      suppressRef.current = false;
    }, 0);
  }, []);

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const destroyIframe = useCallback(() => {
    stopPoll();
    const player = ytRef.current;
    ytRef.current = null;
    try {
      player?.destroy?.();
    } catch {
      /* already gone */
    }
    if (ytHostRef.current) ytHostRef.current.replaceChildren();
  }, [stopPoll]);

  const beginAudio = useCallback(
    (videoId: string, requestId: number, attempt: number) => {
      const el = audioRef.current;
      if (!el) return;
      if (modelRef.current.requestId !== requestId) return;
      if (modelRef.current.intent !== "play") return;
      destroyIframe();
      attemptRef.current = attempt;
      dispatch({ type: "use-engine", requestId, engine: "audio" });
      const token = ++audioToken.current;
      suppressRef.current = true;
      const fresh = attempt > 0 ? "&fresh=1" : "";
      el.src = `/api/stream?v=${encodeURIComponent(videoId)}&kind=audio&try=${attempt}${fresh}`;
      suppressRef.current = false;
      log("audio-src", `attempt ${attempt}`);
      void el
        .play()
        .then(() => {
          if (token !== audioToken.current || modelRef.current.requestId !== requestId) return;
          if (modelRef.current.intent !== "play") el.pause();
        })
        .catch((err: unknown) => {
          if (token !== audioToken.current || modelRef.current.requestId !== requestId) return;
          if (modelRef.current.intent !== "play") return;
          const name = err instanceof DOMException ? err.name : "";
          if (name === "AbortError") return;
          if (name === "NotAllowedError") {
            dispatch({ type: "autoplay-blocked", requestId });
            log("autoplay-blocked");
            return;
          }
          failRef.current(err instanceof Error ? err.message : "Playback failed");
        });
    },
    [destroyIframe, dispatch, log]
  );

  const failAudio = useCallback(
    (reason: string) => {
      const requestId = modelRef.current.requestId;
      const videoId = modelRef.current.videoId;
      if (!videoId) {
        dispatch({
          type: "failed",
          requestId,
          message: "Couldn't find an audio stream for this song",
        });
        return;
      }
      if (modelRef.current.intent !== "play") return;
      log("audio-failure", reason);
      if (attemptRef.current < 1) {
        beginAudio(videoId, requestId, attemptRef.current + 1);
        return;
      }
      clearAudio();
      dispatch({ type: "use-engine", requestId, engine: "iframe" });
      log("fallback-iframe", reason);
    },
    [beginAudio, clearAudio, dispatch, log]
  );
  const failRef = useRef(failAudio);
  failRef.current = failAudio;

  const playAtRef = useRef<(songs: Song[], index: number) => void>(() => {});
  const playRef = useRef<() => void>(() => {});
  const pauseRef = useRef<() => void>(() => {});
  const toggleRef = useRef<() => void>(() => {});
  const nextRef = useRef<() => void>(() => {});
  const prevRef = useRef<() => void>(() => {});
  const seekRef = useRef<(t: number) => void>(() => {});

  const playAt = useCallback(
    (list: Song[], index: number) => {
      const song = list[index];
      if (!song) return;
      if (modeRef.current === "remote") {
        sendRef.current({ t: "music-play", songs: list, index });
        return;
      }
      matchAbort.current?.abort();
      const ac = new AbortController();
      matchAbort.current = ac;
      const requestId = ++reqRef.current;
      attemptRef.current = 0;
      expectedRef.current = (song.durationMs ?? 0) / 1000;
      setQueue({ songs: list, index });
      setShowNow(true);
      setChoosing(false);
      setLyrics(null);
      setTime(0);
      setDur(0);
      dispatch({ type: "user-play" });
      dispatch({ type: "load", requestId, videoId: directVideoId(song) });
      clearAudio();
      destroyIframe();
      sendRef.current({
        t: "np",
        name: song.name,
        artist: song.artist,
        art: song.art ?? "",
        phase: "resolving",
        videoId: directVideoId(song),
      });

      const lyricsPromise = getLyrics({
        track: song.name,
        artist: song.artist,
        album: song.album,
        duration: (song.durationMs ?? 0) / 1000,
      });
      void lyricsPromise.then((l) => {
        if (reqRef.current === requestId) setLyrics(l);
      });

      void (async () => {
        const saved =
          directVideoId(song) ??
          lookupCorrection(loadCorrections(), song.artist, song.name);
        let videoId = saved;
        let alts: Alternative[] = [];
        if (!videoId) {
          try {
            const dur = song.durationMs ? Math.round(song.durationMs / 1000) : 0;
            const params = new URLSearchParams({
              title: song.name,
              artist: song.artist,
            });
            if (dur > 0) params.set("dur", String(dur));
            const res = await fetch(`/api/match?${params}`, { signal: ac.signal });
            const body = (await res.json()) as {
              videoId?: string | null;
              confidence?: string;
              chosen?: Alternative | null;
              alternatives?: Alternative[];
              error?: string;
            };
            if (reqRef.current !== requestId) return;
            if (!res.ok && !body.alternatives) {
              dispatch({
                type: "failed",
                requestId,
                message: body.error || "Couldn't find this song",
              });
              return;
            }
            alts = body.alternatives ?? [];
            setAlternatives(alts);
            if (body.confidence === "high" && body.videoId) {
              videoId = body.videoId;
              if (body.chosen?.durationSec) expectedRef.current = body.chosen.durationSec;
            } else {
              setChoosing(true);
              dispatch({ type: "user-pause" });
              log("choose-version", body.confidence ?? "low");
              return;
            }
          } catch (err) {
            if (ac.signal.aborted || reqRef.current !== requestId) return;
            dispatch({
              type: "failed",
              requestId,
              message: sanitizeError(err) || "Couldn't find this song",
            });
            return;
          }
        } else {
          setAlternatives([]);
        }
        if (!videoId || reqRef.current !== requestId) return;
        const songs = list.slice();
        songs[index] = { ...song, youtubeId: videoId };
        setQueue({ songs, index });
        dispatch({ type: "load", requestId, videoId });
        if (modelRef.current.intent !== "play") {
          log("resolved-while-paused", videoId);
          return;
        }
        beginAudio(videoId, requestId, 0);
      })();
    },
    [beginAudio, clearAudio, destroyIframe, dispatch, log]
  );
  playAtRef.current = playAt;

  const play = useCallback(() => {
    if (modeRef.current === "remote") {
      sendRef.current({ t: "ctl", a: "play" });
      return;
    }
    const before = modelRef.current;
    if (before.phase === "playing" && before.intent === "play") {
      const el = audioRef.current;
      const iframePlaying = before.engine === "iframe";
      if ((el && !el.paused && before.engine === "audio") || iframePlaying) return;
    }
    dispatch({ type: "user-play" });
    const m = modelRef.current;
    if (m.engine === "iframe" && ytRef.current?.playVideo) {
      try {
        ytRef.current.playVideo();
      } catch (err) {
        dispatch({
          type: "failed",
          requestId: m.requestId,
          message: sanitizeError(err),
        });
      }
      return;
    }
    const el = audioRef.current;
    if (el && m.videoId && el.src.includes(m.videoId) && el.paused) {
      void el
        .play()
        .then(() => {
          if (modelRef.current.intent !== "play") el.pause();
        })
        .catch((err: unknown) => {
          const name = err instanceof DOMException ? err.name : "";
          if (name === "NotAllowedError") {
            dispatch({ type: "autoplay-blocked", requestId: m.requestId });
          }
        });
      return;
    }
    if (m.videoId) {
      beginAudio(m.videoId, m.requestId, 0);
      return;
    }
    const q = queueRef.current;
    if (q) playAtRef.current(q.songs, q.index);
  }, [beginAudio, dispatch]);
  playRef.current = play;

  const pause = useCallback(() => {
    if (modeRef.current === "remote") {
      sendRef.current({ t: "ctl", a: "pause" });
      return;
    }
    dispatch({ type: "user-pause" });
    try {
      audioRef.current?.pause();
    } catch {
      /* ignore */
    }
    try {
      ytRef.current?.pauseVideo?.();
    } catch {
      /* ignore */
    }
  }, [dispatch]);
  pauseRef.current = pause;

  const next = useCallback(() => {
    if (modeRef.current === "remote") {
      sendRef.current({ t: "ctl", a: "next" });
      return;
    }
    const q = queueRef.current;
    if (!q?.songs.length) return;
    playAtRef.current(q.songs, (q.index + 1) % q.songs.length);
  }, []);
  nextRef.current = next;

  const prev = useCallback(() => {
    if (modeRef.current === "remote") {
      sendRef.current({ t: "ctl", a: "prev" });
      return;
    }
    const el = audioRef.current;
    const iframeTime = ytRef.current?.getCurrentTime?.() ?? 0;
    const t = modelRef.current.engine === "iframe" ? iframeTime : (el?.currentTime ?? 0);
    if (t > 3) {
      seekRef.current(0);
      return;
    }
    const q = queueRef.current;
    if (!q?.songs.length) return;
    playAtRef.current(q.songs, (q.index - 1 + q.songs.length) % q.songs.length);
  }, []);
  prevRef.current = prev;

  const toggle = useCallback(() => {
    if (modeRef.current === "remote") {
      const phase = remote.carState?.phase;
      const active = phase === "playing" || phase === "buffering";
      sendRef.current({ t: "ctl", a: active ? "pause" : "play" });
      return;
    }
    const phase = modelRef.current.phase;
    if (phase === "playing" || phase === "buffering") pauseRef.current();
    else playRef.current();
  }, [remote.carState?.phase]);
  toggleRef.current = toggle;

  const seek = useCallback((t: number) => {
    if (modeRef.current === "remote") {
      sendRef.current({ t: "ctl", a: "seek", v: t });
      return;
    }
    if (modelRef.current.engine === "iframe" && ytRef.current?.seekTo) {
      ytRef.current.seekTo(t, true);
    } else if (audioRef.current && audioRef.current.src) {
      audioRef.current.currentTime = t;
    }
    setTime(t);
  }, []);
  seekRef.current = seek;

  const chooseVersion = useCallback(
    (videoId: string) => {
      const q = queueRef.current;
      const song = q ? q.songs[q.index] : null;
      if (!q || !song) return;
      if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return;
      saveCorrections(
        rememberCorrection(loadCorrections(), song.artist, song.name, videoId)
      );
      const songs = q.songs.slice();
      songs[q.index] = { ...song, youtubeId: videoId };
      setQueue({ songs, index: q.index });
      setChoosing(false);
      matchAbort.current?.abort();
      const requestId = ++reqRef.current;
      attemptRef.current = 0;
      const alt = altsRef.current.find((a) => a.videoId === videoId);
      if (alt?.durationSec) expectedRef.current = alt.durationSec;
      dispatch({ type: "user-play" });
      dispatch({ type: "load", requestId, videoId });
      clearAudio();
      destroyIframe();
      beginAudio(videoId, requestId, 0);
    },
    [beginAudio, clearAudio, destroyIframe, dispatch]
  );

  const openVersions = useCallback(() => {
    const q = queueRef.current;
    const song = q ? q.songs[q.index] : null;
    setChoosing(true);
    setShowNow(true);
    if (!song || altsRef.current.length) return;
    const dur = song.durationMs ? Math.round(song.durationMs / 1000) : 0;
    const params = new URLSearchParams({ title: song.name, artist: song.artist });
    if (dur > 0) params.set("dur", String(dur));
    void fetch(`/api/match?${params}`)
      .then((r) => r.json())
      .then((body: { alternatives?: Alternative[] }) => {
        if (body.alternatives?.length) setAlternatives(body.alternatives);
      })
      .catch(() => {});
  }, []);

  const retry = useCallback(() => {
    const q = queueRef.current;
    if (!q) return;
    playAtRef.current(q.songs, q.index);
  }, []);

  useRemoteCommands(
    useCallback((m: RemoteMsg) => {
      if (modeRef.current !== "host") return;
      if (m.t === "music-play" && Array.isArray(m.songs)) {
        playAtRef.current(m.songs as Song[], Number(m.index) || 0);
      } else if (m.t === "ctl") {
        if (m.a === "play") playRef.current();
        else if (m.a === "pause") pauseRef.current();
        else if (m.a === "toggle") toggleRef.current();
        else if (m.a === "next") nextRef.current();
        else if (m.a === "prev") prevRef.current();
        else if (m.a === "seek" && typeof m.v === "number") seekRef.current(m.v);
      }
    }, [])
  );

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const alive = () =>
      modelRef.current.engine === "audio" && !suppressRef.current;
    const onPlaying = () => {
      if (!alive()) return;
      if (modelRef.current.intent !== "play") {
        el.pause();
        return;
      }
      dispatch({
        type: "engine",
        requestId: modelRef.current.requestId,
        engine: "audio",
        event: "playing",
      });
    };
    const onWaiting = () => {
      if (!alive()) return;
      dispatch({
        type: "engine",
        requestId: modelRef.current.requestId,
        engine: "audio",
        event: "buffering",
      });
    };
    const onPause = () => {
      if (!alive() || el.ended) return;
      dispatch({
        type: "engine",
        requestId: modelRef.current.requestId,
        engine: "audio",
        event: "paused",
      });
    };
    const onEnded = () => {
      if (modelRef.current.engine !== "audio") return;
      if (isTruncatedPlayback(el.currentTime, expectedRef.current)) {
        failRef.current("truncated");
        return;
      }
      dispatch({
        type: "engine",
        requestId: modelRef.current.requestId,
        engine: "audio",
        event: "ended",
      });
      nextRef.current();
    };
    const onError = () => {
      if (suppressRef.current || !el.getAttribute("src")) return;
      if (el.error?.code === 1) return;
      failRef.current(el.error?.message || "audio error");
    };
    const onTime = () => setTime(el.currentTime || 0);
    const onDur = () => setDur(Number.isFinite(el.duration) ? el.duration : 0);
    el.addEventListener("playing", onPlaying);
    el.addEventListener("waiting", onWaiting);
    el.addEventListener("stalled", onWaiting);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    el.addEventListener("error", onError);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("durationchange", onDur);
    el.addEventListener("loadedmetadata", onDur);
    return () => {
      el.removeEventListener("playing", onPlaying);
      el.removeEventListener("waiting", onWaiting);
      el.removeEventListener("stalled", onWaiting);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("error", onError);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("durationchange", onDur);
      el.removeEventListener("loadedmetadata", onDur);
    };
  }, [dispatch]);

  useEffect(() => {
    if (model.phase !== "buffering" || model.intent !== "play" || model.engine !== "audio") {
      return;
    }
    const requestId = model.requestId;
    const started = audioRef.current?.currentTime ?? 0;
    const timer = window.setTimeout(() => {
      if (modelRef.current.requestId !== requestId) return;
      if (modelRef.current.phase !== "buffering") return;
      const now = audioRef.current?.currentTime ?? 0;
      if (now <= started + 0.25) failRef.current("stalled");
    }, 12000);
    return () => window.clearTimeout(timer);
  }, [model.engine, model.intent, model.phase, model.requestId]);

  useEffect(() => {
    if (model.engine !== "iframe" || !model.videoId) return;
    const requestId = model.requestId;
    const videoId = model.videoId;
    let cancelled = false;
    let player: any = null;
    void (async () => {
      try {
        const YT = await loadYT();
        if (cancelled || reqRef.current !== requestId) return;
        const host = ytHostRef.current;
        if (!host) throw new Error("YouTube player container is missing");
        destroyIframe();
        const mount = document.createElement("div");
        mount.style.width = "100%";
        mount.style.height = "100%";
        host.appendChild(mount);
        player = new YT.Player(mount, {
          videoId,
          width: "100%",
          height: "100%",
          playerVars: {
            autoplay: modelRef.current.intent === "play" ? 1 : 0,
            rel: 0,
            playsinline: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: (e: any) => {
              if (cancelled || reqRef.current !== requestId) return;
              ytRef.current = e.target;
              if (modelRef.current.intent === "play") e.target.playVideo();
              else e.target.pauseVideo();
            },
            onStateChange: (e: any) => {
              if (cancelled || reqRef.current !== requestId) return;
              if (modelRef.current.engine !== "iframe") return;
              const st = YT.PlayerState;
              if (e.data === st.PLAYING) {
                if (modelRef.current.intent !== "play") {
                  e.target.pauseVideo();
                  return;
                }
                dispatch({
                  type: "engine",
                  requestId,
                  engine: "iframe",
                  event: "playing",
                });
                const duration = Number(e.target.getDuration?.() || 0);
                if (duration > 0) setDur(duration);
                stopPoll();
                pollRef.current = window.setInterval(() => {
                  if (reqRef.current !== requestId) return;
                  setTime(Number(e.target.getCurrentTime?.() || 0));
                }, 500);
              } else if (e.data === st.BUFFERING || e.data === st.CUED) {
                dispatch({
                  type: "engine",
                  requestId,
                  engine: "iframe",
                  event: "buffering",
                });
              } else if (e.data === st.PAUSED) {
                stopPoll();
                dispatch({
                  type: "engine",
                  requestId,
                  engine: "iframe",
                  event: "paused",
                });
              } else if (e.data === st.ENDED) {
                stopPoll();
                const current = Number(e.target.getCurrentTime?.() || 0);
                if (isTruncatedPlayback(current, expectedRef.current)) {
                  dispatch({
                    type: "failed",
                    requestId,
                    message: "Playback stopped before the song finished",
                  });
                  return;
                }
                dispatch({
                  type: "engine",
                  requestId,
                  engine: "iframe",
                  event: "ended",
                });
                nextRef.current();
              }
            },
            onError: (e: any) => {
              if (cancelled || reqRef.current !== requestId) return;
              dispatch({
                type: "failed",
                requestId,
                message: iframeError(Number(e.data)),
              });
            },
          },
        });
        ytRef.current = player;
      } catch (err) {
        if (cancelled || reqRef.current !== requestId) return;
        dispatch({
          type: "failed",
          requestId,
          message: sanitizeError(err) || "YouTube player failed to load",
        });
      }
    })();
    return () => {
      cancelled = true;
      stopPoll();
      try {
        player?.destroy?.();
      } catch {
        /* ignore */
      }
      if (ytRef.current === player) ytRef.current = null;
    };
  }, [destroyIframe, dispatch, model.engine, model.requestId, model.videoId, stopPoll]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    ms.setActionHandler("play", () => playRef.current());
    ms.setActionHandler("pause", () => pauseRef.current());
    ms.setActionHandler("nexttrack", () => nextRef.current());
    ms.setActionHandler("previoustrack", () => prevRef.current());
    return () => {
      ms.setActionHandler("play", null);
      ms.setActionHandler("pause", null);
      ms.setActionHandler("nexttrack", null);
      ms.setActionHandler("previoustrack", null);
    };
  }, []);

  const current = queue ? queue.songs[queue.index] : null;
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
    try {
      navigator.mediaSession.playbackState = mediaSessionPlaybackState(model.phase);
    } catch {
      /* some browsers throw if a session is not active yet */
    }
  }, [current, model.phase]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    if (!Number.isFinite(dur) || dur <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: dur,
        playbackRate: audioRef.current?.playbackRate || 1,
        position: Math.min(Math.max(time, 0), dur),
      });
    } catch {
      /* position can be rejected while duration is still settling */
    }
  }, [dur, time]);

  useEffect(() => {
    if (remote.mode !== "host" || !current) return;
    remote.send({
      t: "np",
      name: current.name,
      artist: current.artist,
      art: current.art ?? "",
      phase: model.phase,
      videoId: model.videoId,
    });
  }, [current, model.phase, model.videoId, remote]);

  useEffect(() => {
    return () => {
      matchAbort.current?.abort();
      stopPoll();
      destroyIframe();
    };
  }, [destroyIframe, stopPoll]);

  const api: PlaybackApi = {
    queue,
    phase: model.phase,
    intent: model.intent,
    engine: model.engine,
    videoId: model.videoId,
    needsGesture: model.needsGesture,
    time,
    dur,
    lyrics,
    error: model.error,
    choosing,
    alternatives,
    showNow,
    setShowNow,
    playAt,
    play,
    pause,
    toggle,
    next,
    prev,
    seek,
    chooseVersion,
    openVersions,
    retry,
  };

  return (
    <Ctx.Provider value={api}>
      {children}
      <audio
        ref={audioRef}
        playsInline
        preload="none"
        className="pointer-events-none absolute h-px w-px opacity-0"
      />
      <div
        ref={ytHostRef}
        className={
          model.engine === "iframe"
            ? "fixed right-2 top-24 z-40 h-24 w-40 overflow-hidden rounded-xl bg-black shadow-2xl sm:right-3 sm:top-16 sm:h-52 sm:w-80 sm:rounded-2xl"
            : "pointer-events-none absolute h-px w-px overflow-hidden"
        }
      />
      {dev && debug.length > 0 && (
        <pre className="pointer-events-none fixed bottom-16 left-2 z-[90] max-h-36 max-w-[22rem] overflow-hidden rounded-lg bg-black/80 p-2 text-[10px] leading-snug text-green-300 sm:bottom-2">
          {debug
            .slice(-6)
            .map(
              (row) =>
                `${row.event} ${row.phase}/${row.intent} ${row.engine} ${row.videoId ?? "-"} #${row.requestId} r${row.readyState ?? "-"} ${row.error ?? ""}`
            )
            .join("\n")}
        </pre>
      )}
    </Ctx.Provider>
  );
}
