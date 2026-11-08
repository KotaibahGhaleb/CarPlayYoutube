// Authoritative playback model. User intent is separate from what the
// element is actually doing. Events from an older request or the inactive
// engine are ignored.

export type Phase =
  | "idle"
  | "resolving"
  | "buffering"
  | "playing"
  | "paused"
  | "ended"
  | "error";

export type Intent = "play" | "pause";
export type EngineName = "none" | "audio" | "iframe";

export interface PlaybackModel {
  phase: Phase;
  intent: Intent;
  engine: EngineName;
  requestId: number;
  videoId: string | null;
  needsGesture: boolean;
  error: string | null;
}

export type ModelEvent =
  | { type: "load"; requestId: number; videoId: string | null }
  | { type: "user-play" }
  | { type: "user-pause" }
  | { type: "use-engine"; requestId: number; engine: EngineName }
  | {
      type: "engine";
      requestId: number;
      engine: EngineName;
      event: "buffering" | "playing" | "paused" | "ended";
    }
  | { type: "autoplay-blocked"; requestId: number }
  | { type: "failed"; requestId: number; message: string };

export const initialPlayback: PlaybackModel = {
  phase: "idle",
  intent: "pause",
  engine: "none",
  requestId: 0,
  videoId: null,
  needsGesture: false,
  error: null,
};

export function reducePlayback(
  state: PlaybackModel,
  event: ModelEvent
): PlaybackModel {
  switch (event.type) {
    case "load":
      return {
        ...state,
        requestId: event.requestId,
        videoId: event.videoId,
        engine: "none",
        phase: state.intent === "pause" ? "paused" : "resolving",
        needsGesture: false,
        error: null,
      };
    case "user-play":
      if (state.phase === "playing" && state.intent === "play") return state;
      return {
        ...state,
        intent: "play",
        needsGesture: false,
        error: state.phase === "error" ? state.error : null,
      };
    case "user-pause":
      if (state.intent === "pause" && (state.phase === "paused" || state.phase === "idle")) {
        return state;
      }
      return {
        ...state,
        intent: "pause",
        phase: state.phase === "idle" ? "idle" : "paused",
        needsGesture: false,
      };
    case "use-engine":
      if (event.requestId !== state.requestId) return state;
      return { ...state, engine: event.engine, videoId: state.videoId };
    case "engine": {
      if (event.requestId !== state.requestId) return state;
      if (event.engine !== state.engine) return state;
      if (event.event === "buffering") {
        if (state.intent !== "play") return { ...state, phase: "paused" };
        if (state.phase === "playing") return { ...state, phase: "buffering" };
        return { ...state, phase: "buffering", error: null };
      }
      if (event.event === "playing") {
        if (state.intent !== "play") return { ...state, phase: "paused" };
        return {
          ...state,
          phase: "playing",
          needsGesture: false,
          error: null,
        };
      }
      if (event.event === "paused") {
        if (state.phase === "ended") return state;
        return { ...state, phase: "paused" };
      }
      return { ...state, phase: "ended", intent: "pause" };
    }
    case "autoplay-blocked":
      if (event.requestId !== state.requestId) return state;
      return {
        ...state,
        phase: "paused",
        needsGesture: true,
        error: null,
      };
    case "failed":
      if (event.requestId !== state.requestId) return state;
      if (state.intent === "pause" && state.phase === "paused") return state;
      return {
        ...state,
        phase: "error",
        error: event.message,
        needsGesture: false,
      };
    default:
      return state;
  }
}

/** A stream that ends almost immediately is not a finished song. */
export function isTruncatedPlayback(
  currentTime: number,
  expectedSec: number
): boolean {
  if (!(expectedSec > 20)) return false;
  if (!Number.isFinite(currentTime) || currentTime < 0) return false;
  return currentTime < Math.min(8, expectedSec * 0.25);
}

export function mediaSessionPlaybackState(
  phase: Phase
): "none" | "paused" | "playing" {
  if (phase === "playing") return "playing";
  if (phase === "paused" || phase === "ended") return "paused";
  return "none";
}
