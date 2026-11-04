"use client";

import { useState } from "react";
import YouTubeTab from "@/components/YouTubeTab";
import MusicTab from "@/components/MusicTab";
import RemoteProvider, {
  useRemote,
  useRemoteCommands,
} from "@/components/RemoteProvider";
import RemotePanel from "@/components/RemotePanel";

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

function RemoteIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className}>
      <path d="M15 9H9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2Zm-3 8.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3ZM7.05 6.05l1.41 1.41a5 5 0 0 1 7.08 0l1.41-1.41a7 7 0 0 0-9.9 0Zm2.83 2.83 1.41 1.41a1 1 0 0 1 1.42 0l1.41-1.41a3 3 0 0 0-4.24 0Z" />
    </svg>
  );
}

function Shell() {
  const [tab, setTab] = useState<"yt" | "music">("yt");
  const [showRemote, setShowRemote] = useState(false);
  const remote = useRemote();

  // Car screen (host) executes commands coming from the phone
  useRemoteCommands((m) => {
    if (m.t === "tab" && (m.tab === "yt" || m.tab === "music"))
      setTab(m.tab);
  });

  const switchTab = (t: "yt" | "music") => {
    setTab(t);
    if (remote.mode === "remote") remote.send({ t: "tab", tab: t });
  };

  return (
    <div className="flex h-dvh flex-col md:flex-row">
      {/* CarPlay-style dock — side rail on wide screens, bottom bar on phones */}
      <nav className="order-2 flex shrink-0 flex-row items-center justify-around gap-1 border-t border-neutral-800 bg-neutral-950 px-2 pb-[env(safe-area-inset-bottom)] pt-1.5 md:order-none md:w-24 md:flex-col md:justify-start md:gap-3 md:border-r md:border-t-0 md:px-0 md:py-4">
        <button
          onClick={() => switchTab("yt")}
          className={`flex h-14 w-20 flex-col items-center justify-center gap-0.5 rounded-2xl transition active:scale-90 md:h-20 md:w-20 md:gap-1 ${
            tab === "yt"
              ? "bg-red-600/20 text-red-500"
              : "text-neutral-500 hover:bg-neutral-900"
          }`}
        >
          <YouTubeIcon className="h-7 w-7 fill-current md:h-8 md:w-8" />
          <span className="text-[10px] font-bold">YouTube</span>
        </button>
        <button
          onClick={() => switchTab("music")}
          className={`flex h-14 w-20 flex-col items-center justify-center gap-0.5 rounded-2xl transition active:scale-90 md:h-20 md:w-20 md:gap-1 ${
            tab === "music"
              ? "bg-green-600/20 text-green-500"
              : "text-neutral-500 hover:bg-neutral-900"
          }`}
        >
          <MusicIcon className="h-7 w-7 fill-current md:h-8 md:w-8" />
          <span className="text-[10px] font-bold">Music</span>
        </button>
        <div className="hidden md:mt-auto md:block" />
        <button
          onClick={() => setShowRemote(true)}
          className={`flex h-14 w-20 flex-col items-center justify-center gap-0.5 rounded-2xl transition active:scale-90 md:h-20 md:w-20 md:gap-1 ${
            remote.mode !== "off"
              ? "bg-blue-600/20 text-blue-400"
              : "text-neutral-500 hover:bg-neutral-900"
          }`}
        >
          <RemoteIcon className="h-7 w-7 fill-current md:h-8 md:w-8" />
          <span className="text-[10px] font-bold">Remote</span>
        </button>
      </nav>

      <main className="relative order-1 min-h-0 min-w-0 flex-1 md:order-none">
        {/* remote-connected banner on phone */}
        {remote.mode === "remote" && (
          <div className="pointer-events-none absolute left-1/2 top-2 z-30 -translate-x-1/2 rounded-full bg-blue-600/90 px-4 py-1.5 text-xs font-bold shadow-lg">
            Controlling car {remote.code}
          </div>
        )}
        <div className={tab === "yt" ? "h-full" : "hidden"}>
          <YouTubeTab />
        </div>
        <div className={tab === "music" ? "h-full" : "hidden"}>
          <MusicTab />
        </div>
        {showRemote && <RemotePanel onClose={() => setShowRemote(false)} />}
      </main>
    </div>
  );
}

export default function Home() {
  return (
    <RemoteProvider>
      <Shell />
    </RemoteProvider>
  );
}
