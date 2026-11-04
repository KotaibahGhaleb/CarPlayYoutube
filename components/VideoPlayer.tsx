"use client";

import { useEffect, useRef, useState } from "react";

// Plays a progressive stream when available, falls back to HLS (hls.js).
export default function VideoPlayer({
  src,
  hls,
  poster,
}: {
  src?: string;
  hls?: string;
  poster?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [useHls, setUseHls] = useState(!src && !!hls);

  useEffect(() => {
    const v = ref.current;
    if (!v || !useHls || !hls) return;
    if (v.canPlayType("application/vnd.apple.mpegurl")) {
      v.src = hls;
      v.play().catch(() => {});
      return;
    }
    let h: import("hls.js").default | null = null;
    let cancelled = false;
    import("hls.js").then(({ default: Hls }) => {
      if (cancelled || !Hls.isSupported()) return;
      h = new Hls({ enableWorker: false });
      h.loadSource(hls);
      h.attachMedia(v);
      h.on(Hls.Events.MANIFEST_PARSED, () => v.play().catch(() => {}));
    });
    return () => {
      cancelled = true;
      h?.destroy();
    };
  }, [useHls, hls]);

  if (useHls && hls) {
    return (
      <video
        ref={ref}
        poster={poster}
        controls
        autoPlay
        playsInline
        className="h-full w-full bg-black"
      />
    );
  }

  return (
    <video
      ref={ref}
      src={src}
      poster={poster}
      controls
      autoPlay
      playsInline
      className="h-full w-full bg-black"
      onError={() => hls && setUseHls(true)}
    />
  );
}
