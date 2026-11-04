"use client";

import { useEffect, useRef } from "react";
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
  const art = track.art;
  const activeIdx = lyrics?.synced
    ? activeLineIndex(lyrics.synced, time)
    : -1;
  const scrollRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLParagraphElement | null)[]>([]);

  useEffect(() => {
    lineRefs.current[activeIdx]?.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
  }, [activeIdx]);

  const progress = dur > 0 ? Math.min(time / dur, 1) : 0;

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-neutral-950">
      {/* top bar */}
      <div className="flex shrink-0 items-center justify-between px-5 py-3">
        <button
          onClick={onClose}
          className="rounded-full bg-neutral-900 px-5 py-2.5 text-sm font-bold active:scale-95"
        >
          ⌄ Back
        </button>
        <div className={`flex items-end gap-1 ${playing ? "" : "eq-paused"}`}>
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
      </div>

      {/* main: art + lyrics */}
      <div className="flex min-h-0 flex-1 items-center gap-6 px-6 md:gap-10 md:px-10">
        <div className="hidden w-56 shrink-0 flex-col gap-4 sm:flex md:w-72">
          {art ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={art}
              alt=""
              className="aspect-square w-full rounded-3xl object-cover shadow-2xl shadow-black"
            />
          ) : (
            <div className="aspect-square w-full rounded-3xl bg-neutral-800" />
          )}
          <div>
            <h2 className="line-clamp-2 text-xl font-bold md:text-2xl">
              {track.name}
            </h2>
            <p className="truncate text-base text-neutral-400 md:text-lg">
              {track.artist}
            </p>
          </div>
        </div>

        {/* lyrics */}
        <div
          ref={scrollRef}
          className="scrollbar-hide min-h-0 flex-1 overflow-y-auto py-[30vh] text-center"
        >
          {resolving ? (
            <p className="text-xl font-semibold text-neutral-500">
              Finding song…
            </p>
          ) : streamError ? (
            <p className="text-xl font-semibold text-red-400">{streamError}</p>
          ) : lyrics?.synced?.length ? (
            lyrics.synced.map((l, i) => (
              <p
                key={i}
                ref={(el) => {
                  lineRefs.current[i] = el;
                }}
                onClick={() => onSeek(l.time + 0.01)}
                className={`lyric-line mx-auto max-w-3xl cursor-pointer px-4 py-2.5 font-bold ${
                  i === activeIdx
                    ? "scale-105 text-2xl text-white md:text-4xl"
                    : i < activeIdx
                      ? "text-base text-neutral-600 md:text-xl"
                      : "text-base text-neutral-500 md:text-xl"
                }`}
              >
                {l.text || "♪"}
              </p>
            ))
          ) : lyrics?.plain ? (
            <p className="mx-auto max-w-xl whitespace-pre-line text-base leading-relaxed text-neutral-400 md:text-lg">
              {lyrics.plain}
            </p>
          ) : (
            <p className="text-xl font-semibold text-neutral-600">
              No lyrics found
            </p>
          )}
        </div>
      </div>

      {/* controls */}
      <div className="shrink-0 px-6 pb-5 pt-2 md:px-10">
        <div
          className="group relative h-8 cursor-pointer"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            onSeek(((e.clientX - r.left) / r.width) * dur);
          }}
        >
          <div className="absolute top-1/2 h-2 w-full -translate-y-1/2 rounded-full bg-neutral-800">
            <div
              className="h-full rounded-full bg-green-500"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="w-14 text-sm tabular-nums text-neutral-400">
            {fmt(time)}
          </span>
          <div className="flex items-center gap-5">
            <button
              onClick={onPrev}
              className="rounded-full p-3 text-neutral-300 transition hover:bg-neutral-900 active:scale-90"
              aria-label="Previous"
            >
              <svg viewBox="0 0 24 24" className="h-8 w-8 fill-current">
                <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
              </svg>
            </button>
            <button
              onClick={onToggle}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-black transition active:scale-90"
              aria-label="Play/Pause"
            >
              {playing ? (
                <svg viewBox="0 0 24 24" className="h-8 w-8 fill-current">
                  <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="ml-1 h-8 w-8 fill-current">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>
            <button
              onClick={onNext}
              className="rounded-full p-3 text-neutral-300 transition hover:bg-neutral-900 active:scale-90"
              aria-label="Next"
            >
              <svg viewBox="0 0 24 24" className="h-8 w-8 fill-current">
                <path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z" />
              </svg>
            </button>
          </div>
          <span className="w-14 text-right text-sm tabular-nums text-neutral-400">
            {fmt(dur)}
          </span>
        </div>
      </div>
    </div>
  );
}
