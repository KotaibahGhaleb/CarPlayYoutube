"use client";

import { useState } from "react";
import YouTubeTab from "@/components/YouTubeTab";
import MusicTab from "@/components/MusicTab";

function YouTubeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className}>
      <path d="M21.6 7.2a2.8 2.8 0 0 0-2-2C17.9 4.8 12 4.8 12 4.8s-5.9 0-7.6.4a2.8 2.8 0 0 0-2 2A29 29 0 0 0 2 12a29 29 0 0 0 .4 4.8 2.8 2.8 0 0 0 2 2c1.7.4 7.6.4 7.6.4s5.9 0 7.6-.4a2.8 2.8 0 0 0 2-2A29 29 0 0 0 22 12a29 29 0 0 0-.4-4.8ZM10 15.2V8.8L15.5 12Z" />
    </svg>
  );
}

function MusicIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className}>
      <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6Z" />
    </svg>
  );
}

export default function Home() {
  const [tab, setTab] = useState<"yt" | "music">("yt");

  return (
    <div className="flex h-dvh">
      {/* CarPlay-style dock */}
      <nav className="flex w-20 shrink-0 flex-col items-center gap-3 border-r border-neutral-800 bg-neutral-950 py-4 md:w-24">
        <button
          onClick={() => setTab("yt")}
          className={`flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-2xl transition active:scale-90 md:h-20 md:w-20 ${
            tab === "yt"
              ? "bg-red-600/20 text-red-500"
              : "text-neutral-500 hover:bg-neutral-900"
          }`}
        >
          <YouTubeIcon className="h-7 w-7 fill-current md:h-8 md:w-8" />
          <span className="text-[10px] font-bold">YouTube</span>
        </button>
        <button
          onClick={() => setTab("music")}
          className={`flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-2xl transition active:scale-90 md:h-20 md:w-20 ${
            tab === "music"
              ? "bg-green-600/20 text-green-500"
              : "text-neutral-500 hover:bg-neutral-900"
          }`}
        >
          <MusicIcon className="h-7 w-7 fill-current md:h-8 md:w-8" />
          <span className="text-[10px] font-bold">Music</span>
        </button>
      </nav>

      <main className="relative min-w-0 flex-1">
        <div className={tab === "yt" ? "h-full" : "hidden"}>
          <YouTubeTab />
        </div>
        <div className={tab === "music" ? "h-full" : "hidden"}>
          <MusicTab />
        </div>
      </main>
    </div>
  );
}
