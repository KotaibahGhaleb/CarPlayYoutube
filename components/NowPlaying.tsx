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
  const activeIdx = lyrics?.synced
    ? activeLineIndex(lyrics.synced, time)
    : -1;
  const lineRefs = useRef<(HTMLParagraphElement | null)[]>([]);

  useEffect(() => {
    lineRefs.current[activeIdx]?.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
  }, [activeIdx]);

  const progress = dur > 0 ? Math.min(time / dur, 1) : 0;

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-neutral-950/95 backdrop-blur-2xl">
      {/* top bar: back + mini art + eq */}
      <div className="flex shrink-0 items-center gap-4 px-4 py-3 md:px-8">
        <button
          onClick={onClose}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-xl active:scale-90"
          aria-label="Back"
        >
          ⌄
        </button>
        {track.art ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={track.art}
            alt=""
            className="h-14 w-14 shrink-0 rounded-xl object-cover shadow-lg shadow-black/50 md:h-16 md:w-16"
          />
        ) : (
          <div className="h-14 w-14 shrink-0 rounded-xl bg-neutral-800 md:h-16 md:w-16" />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-bold md:text-xl">
            {track.name}
          </h2>
          <p className="truncate text-sm text-neutral-400 md:text-base">
            {track.artist}
          </p>
        </div>
        <div
          className={`flex shrink-0 items-end gap-1 ${playing ? "" : "eq-paused"}`}
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
      </div>

      {/* karaoke lyrics — full width, active line centered Apple-Music style */}
      <div className="relative min-h-0 flex-1">
        <div className="lyrics-fade scrollbar-hide h-full overflow-y-auto py-[30vh]">
          {resolving ? (
            <p className="px-6 text-center text-xl font-semibold text-neutral-500">
              Finding song…
            </p>
          ) : streamError ? (
            <p className="px-6 text-center text-xl font-semibold text-red-400">
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
                  className={`lyric-line mx-auto max-w-3xl cursor-pointer px-6 py-3 text-center font-bold transition-all md:px-10 ${
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
            <p className="mx-auto max-w-xl whitespace-pre-line px-6 text-center text-base leading-relaxed text-neutral-400 md:text-lg">
              {lyrics.plain}
            </p>
          ) : (
            <p className="px-6 text-center text-xl font-semibold text-neutral-600">
              No lyrics found
            </p>
          )}
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
