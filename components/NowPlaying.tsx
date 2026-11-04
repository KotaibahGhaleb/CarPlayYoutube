"use client";

import { useEffect, useRef, useState } from "react";
import { activeLineIndex, type LyricsResult } from "@/lib/lyrics";

export interface PlayingTrack {
  name: string;
  artist: string;
  art?: string;
}

function fmt(s: number) {
  if (!isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  return `${m}:${Math.floor(s % 60)
    .toString()
    .padStart(2, "0")}`;
}

export default function NowPlaying({
  track,
  playing,
  time,
  dur,
  lyrics,
  resolving,
  streamError,
  onToggle,
  onNext,
  onPrev,
  onSeek,
  onClose,
}: {
  track: PlayingTrack;
  playing: boolean;
  time: number;
  dur: number;
  lyrics: LyricsResult | null;
  resolving: boolean;
  streamError: string;
  onToggle: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSeek: (t: number) => void;
  onClose: () => void;
}) {
  const activeIdx = lyrics?.synced
    ? activeLineIndex(lyrics.synced, time)
    : -1;
  const lineRefs = useRef<(HTMLParagraphElement | null)[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const [isFs, setIsFs] = useState(false);
  const [secs, setSecs] = useState(0);

  // elapsed counter while resolving — shows the user progress is happening
  useEffect(() => {
    if (!resolving) {
      setSecs(0);
      return;
    }
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [resolving]);

  useEffect(() => {
    lineRefs.current[activeIdx]?.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
  }, [activeIdx]);

  useEffect(() => {
    const onFs = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const toggleFs = () => {
    if (document.fullscreenElement)
      document.exitFullscreen().catch(() => {});
    else rootRef.current?.requestFullscreen?.().catch(() => {});
  };

  const progress = dur > 0 ? Math.min(time / dur, 1) : 0;

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 z-50 flex flex-col bg-neutral-950"
    >
      {/* top bar: back + eq + fullscreen */}
      <div className="flex shrink-0 items-center justify-between px-4 py-3 md:px-8">
        <button
          onClick={onClose}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-neutral-900 text-xl active:scale-90"
          aria-label="Back"
        >
          ⌄
        </button>
        <div className="flex items-center gap-4">
          <div
            className={`flex items-end gap-1 ${playing ? "" : "eq-paused"}`}
          >
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className="eq-bar inline-block w-1 rounded-full bg-green-500"
                style={{
                  height: `${10 + i * 5}px`,
                  animationDelay: `${i * 0.15}s`,
                }}
              />
            ))}
          </div>
          <button
            onClick={toggleFs}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-neutral-900 active:scale-90"
            aria-label="Fullscreen"
          >
            {isFs ? (
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                <path d="M5 16h3v3h2v-5H5v2Zm3-8H5v2h5V5H8v3Zm6 11h2v-3h3v-2h-5v5Zm2-11V5h-2v5h5V8h-3Z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                <path d="M7 14H5v5h5v-2H7v-3Zm-2-4h2V7h3V5H5v5Zm12 7h-3v2h5v-5h-2v3ZM14 5v2h3v3h2V5h-5Z" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* main: big art (left) + karaoke lyrics (right) */}
      <div className="flex min-h-0 flex-1 items-stretch gap-8 px-6 md:gap-12 md:px-12">
        {/* album art column — big on car screens, hidden on phones */}
        <div className="hidden w-64 shrink-0 flex-col justify-center gap-5 pl-4 sm:flex lg:w-80 lg:pl-10">
          {track.art ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={track.art}
              alt=""
              className="aspect-square w-full rounded-3xl object-cover shadow-2xl shadow-black/60"
            />
          ) : (
            <div className="aspect-square w-full rounded-3xl bg-neutral-800" />
          )}
          <div>
            <h2 className="line-clamp-2 text-2xl font-bold">{track.name}</h2>
            <p className="mt-1 truncate text-lg text-neutral-400">
              {track.artist}
            </p>
          </div>
        </div>

        {/* lyrics column — full height karaoke */}
        <div className="relative min-w-0 flex-1">
          {/* compact track row for phones (no art column) */}
          <div className="flex items-center gap-3 pb-2 sm:hidden">
            {track.art && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={track.art}
                alt=""
                className="h-12 w-12 rounded-lg object-cover"
              />
            )}
            <div className="min-w-0">
              <h2 className="truncate text-base font-bold">{track.name}</h2>
              <p className="truncate text-sm text-neutral-400">
                {track.artist}
              </p>
            </div>
          </div>
          <div className="lyrics-fade scrollbar-hide absolute inset-0 overflow-y-auto py-[25vh] sm:inset-y-0">
            {resolving ? (
              <div className="px-4 text-center">
                <p className="text-xl font-semibold text-neutral-500">
                  Finding song…
                </p>
                {secs >= 2 && (
                  <p className="mt-2 text-sm tabular-nums text-neutral-600">
                    {secs}s
                  </p>
                )}
              </div>
            ) : streamError ? (
              <p className="px-4 text-center text-xl font-semibold text-red-400">
                {streamError}
              </p>
            ) : lyrics?.synced?.length ? (
              lyrics.synced.map((l, i) => {
                const dist = Math.abs(i - activeIdx);
                return (
                  <p
                    key={i}
                    ref={(el) => {
                      lineRefs.current[i] = el;
                    }}
                    onClick={() => onSeek(l.time + 0.01)}
                    className={`lyric-line mx-auto max-w-3xl cursor-pointer px-4 py-3 text-center font-bold md:px-8 ${
                      i === activeIdx
                        ? "scale-[1.03] text-2xl text-white md:text-4xl"
                        : dist === 1
                          ? "text-base text-neutral-400 md:text-2xl"
                          : "text-sm text-neutral-600 blur-[0.5px] md:text-xl"
                    }`}
                  >
                    {l.text || "♪"}
                  </p>
                );
              })
            ) : lyrics?.plain ? (
              <p className="mx-auto max-w-xl whitespace-pre-line px-4 text-center text-base leading-relaxed text-neutral-400 md:text-lg">
                {lyrics.plain}
              </p>
            ) : (
              <p className="px-4 text-center text-xl font-semibold text-neutral-600">
                No lyrics found
              </p>
            )}
          </div>
        </div>
      </div>

      {/* controls — fixed at bottom */}
      <div className="shrink-0 px-5 pb-5 pt-1 md:px-10">
        <div
          className="group relative h-9 cursor-pointer"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            onSeek(((e.clientX - r.left) / r.width) * dur);
          }}
        >
          <div className="absolute top-1/2 h-1.5 w-full -translate-y-1/2 overflow-hidden rounded-full bg-neutral-800 transition-all group-hover:h-2.5">
            <div
              className="h-full rounded-full bg-white"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        </div>
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <span className="w-14 text-xs tabular-nums text-neutral-500">
            {fmt(time)}
          </span>
          <div className="flex items-center gap-6">
            <button
              onClick={onPrev}
              className="rounded-full p-3 text-neutral-300 transition hover:bg-neutral-900 active:scale-90"
              aria-label="Previous"
            >
              <svg viewBox="0 0 24 24" className="h-9 w-9 fill-current">
                <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
              </svg>
            </button>
            <button
              onClick={onToggle}
              className="flex h-20 w-20 items-center justify-center rounded-full bg-white text-black transition active:scale-90"
              aria-label="Play/Pause"
            >
              {playing ? (
                <svg viewBox="0 0 24 24" className="h-9 w-9 fill-current">
                  <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="ml-1 h-9 w-9 fill-current">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>
            <button
              onClick={onNext}
              className="rounded-full p-3 text-neutral-300 transition hover:bg-neutral-900 active:scale-90"
              aria-label="Next"
            >
              <svg viewBox="0 0 24 24" className="h-9 w-9 fill-current">
                <path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z" />
              </svg>
            </button>
          </div>
          <span className="w-14 text-right text-xs tabular-nums text-neutral-500">
            {fmt(dur)}
          </span>
        </div>
      </div>
    </div>
  );
}
