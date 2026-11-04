"use client";

import { FormEvent, useState } from "react";
import {
  extractVideoId,
  getStreams,
  mediaUrl,
  searchYouTube,
  type PipedSearchItem,
  type PipedStreamsResponse,
} from "@/lib/piped";
import VideoPlayer from "./VideoPlayer";

function fmtDur(s: number) {
  if (!s || s < 0) return "";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function ResultCard({
  item,
  onPlay,
}: {
  item: PipedSearchItem;
  onPlay: (i: PipedSearchItem) => void;
}) {
  return (
    <button
      onClick={() => onPlay(item)}
      className="group flex flex-col gap-2 rounded-2xl bg-neutral-900 p-2 text-left transition hover:bg-neutral-800 active:scale-95"
    >
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-neutral-800">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={mediaUrl(item.thumbnail)}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
        />
        {item.duration > 0 && (
          <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/80 px-1.5 py-0.5 text-xs font-semibold">
            {fmtDur(item.duration)}
          </span>
        )}
      </div>
      <div className="px-1 pb-1">
        <p className="line-clamp-2 text-sm font-semibold leading-snug">
          {item.title}
        </p>
        <p className="mt-0.5 truncate text-xs text-neutral-400">
          {item.uploaderName}
        </p>
      </div>
    </button>
  );
}

export default function YouTubeTab() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PipedSearchItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState<{
    id: string;
    data: PipedStreamsResponse;
  } | null>(null);
  const [loadingStream, setLoadingStream] = useState(false);
  const [embedFallback, setEmbedFallback] = useState(false);

  async function onSearch(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setError("");
    try {
      setResults(await searchYouTube(query.trim(), "videos"));
    } catch {
      setError("Search failed — all YouTube gateways are unreachable. Retry.");
    } finally {
      setSearching(false);
    }
  }

  async function play(item: PipedSearchItem) {
    const id = extractVideoId(item.url);
    setLoadingStream(true);
    setError("");
    setEmbedFallback(false);
    try {
      const data = await getStreams(id);
      setPlaying({ id, data });
    } catch (e) {
      setError(
        `Couldn't load this video${
          e instanceof Error ? ` — ${e.message}` : ""
        }. Tap it again to retry.`
      );
    } finally {
      setLoadingStream(false);
    }
  }

  if (playing) {
    return (
      <div className="flex h-full flex-col lg:flex-row">
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1 bg-black">
            {embedFallback ? (
              <iframe
                key={`${playing.id}-embed`}
                src={`https://www.youtube-nocookie.com/embed/${playing.id}?autoplay=1&rel=0`}
                allow="autoplay; encrypted-media; fullscreen"
                allowFullScreen
                className="h-full w-full border-0"
              />
            ) : (
              <VideoPlayer
                key={playing.id}
                src={`/api/stream?v=${playing.id}&kind=video`}
                hls={playing.data.hls}
                poster={mediaUrl(playing.data.thumbnailUrl)}
                onFatal={() => setEmbedFallback(true)}
              />
            )}
            <button
              onClick={() => setPlaying(null)}
              className="absolute left-3 top-3 rounded-full bg-black/70 px-4 py-2 text-sm font-bold backdrop-blur active:scale-95"
            >
              ← Back
            </button>
          </div>
          <div className="shrink-0 px-5 py-3">
            <h2 className="line-clamp-2 text-lg font-bold">
              {playing.data.title}
            </h2>
            <p className="text-sm text-neutral-400">{playing.data.uploader}</p>
          </div>
        </div>
        <div className="w-full shrink-0 overflow-y-auto border-t border-neutral-800 p-3 lg:w-80 lg:border-l lg:border-t-0">
          <p className="mb-2 px-1 text-xs font-bold uppercase tracking-wider text-neutral-500">
            Up next
          </p>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
            {playing.data.relatedStreams
              ?.filter((i) => i.url?.includes("watch?v="))
              .slice(0, 20)
              .map((item) => (
                <ResultCard
                  key={item.url}
                  item={item}
                  onPlay={(i) => play(i)}
                />
              ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <form onSubmit={onSearch} className="flex shrink-0 gap-3 p-4">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search YouTube…"
          className="h-14 min-w-0 flex-1 rounded-2xl border border-neutral-800 bg-neutral-900 px-5 text-lg outline-none placeholder:text-neutral-500 focus:border-red-600"
        />
        <button
          type="submit"
          disabled={searching}
          className="h-14 shrink-0 rounded-2xl bg-red-600 px-7 text-lg font-bold transition hover:bg-red-500 active:scale-95 disabled:opacity-50"
        >
          {searching ? "…" : "Search"}
        </button>
      </form>

      {error && (
        <p className="shrink-0 px-5 pb-2 text-sm text-red-400">{error}</p>
      )}
      {loadingStream && (
        <p className="shrink-0 px-5 pb-2 text-sm text-neutral-400">
          Loading stream…
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {results.length === 0 && !searching && !error && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-neutral-600">
            <svg viewBox="0 0 24 24" className="h-20 w-20 fill-current">
              <path d="M21.6 7.2a2.8 2.8 0 0 0-2-2C17.9 4.8 12 4.8 12 4.8s-5.9 0-7.6.4a2.8 2.8 0 0 0-2 2A29 29 0 0 0 2 12a29 29 0 0 0 .4 4.8 2.8 2.8 0 0 0 2 2c1.7.4 7.6.4 7.6.4s5.9 0 7.6-.4a2.8 2.8 0 0 0 2-2A29 29 0 0 0 22 12a29 29 0 0 0-.4-4.8ZM10 15.2V8.8L15.5 12Z" />
            </svg>
            <p className="text-lg font-semibold">
              Search anything — plays ad-free
            </p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {results.map((item) => (
            <ResultCard key={item.url} item={item} onPlay={play} />
          ))}
        </div>
      </div>
    </div>
  );
}
