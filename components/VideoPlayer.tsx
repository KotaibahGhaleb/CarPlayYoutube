"use client";

import { useEffect, useRef, useState } from "react";

// Plays a progressive stream when available, falls back to HLS (hls.js),
// then to the official YouTube embed via onFatal — the app never dead-ends.
export default function VideoPlayer({
  src,
  hls,
  poster,
  onFatal,
}: {
  src?: string;
  hls?: string;
  poster?: string;
  onFatal?: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [useHls, setUseHls] = useState(!src && !!hls);

  useEffect(() => {
    const v = ref.current;
    if (!v || !useHls) return;
    if (!hls) {
      onFatal?.();
      return;
    }
    if (v.canPlayType("application/vnd.apple.mpegurl")) {
      v.src = hls;
      v.play().catch(() => {});
      return;
    }
    let h: import("hls.js").default | null = null;
    let cancelled = false;
    import("hls.js").then(({ default: Hls }) => {
      if (cancelled || !Hls.isSupported()) {
        onFatal?.();
        return;
      }
      h = new Hls({ enableWorker: false });
      h.loadSource(hls);
      h.attachMedia(v);
      h.on(Hls.Events.MANIFEST_PARSED, () => v.play().catch(() => {}));
      h.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) onFatal?.();
      });
    });
    return () => {
      cancelled = true;
      h?.destroy();
    };
  }, [useHls, hls, onFatal]);

  if (useHls) {
    return (
      <video
        ref={ref}
        poster={poster}
        controls
        autoPlay
        playsInline
        className="h-full w-full bg-black"
        onError={() => onFatal?.()}
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
      onError={() => (hls ? setUseHls(true) : onFatal?.())}
    />
  );
}
