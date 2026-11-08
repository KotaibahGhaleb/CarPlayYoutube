import assert from "node:assert/strict";
import { test } from "node:test";
import {
  initialPlayback,
  isTruncatedPlayback,
  mediaSessionPlaybackState,
  reducePlayback,
  type PlaybackModel,
} from "./playbackMachine";

function playable(): PlaybackModel {
  return reducePlayback(
    { ...initialPlayback, intent: "play" },
    { type: "load", requestId: 1, videoId: "abcdefghijk" }
  );
}

test("a play action while already playing does not pause", () => {
  let state = playable();
  state = reducePlayback(state, {
    type: "use-engine",
    requestId: 1,
    engine: "audio",
  });
  state = reducePlayback(state, {
    type: "engine",
    requestId: 1,
    engine: "audio",
    event: "playing",
  });
  assert.equal(state.phase, "playing");
  const again = reducePlayback(state, { type: "user-play" });
  assert.equal(again.phase, "playing");
  assert.equal(again.intent, "play");
  assert.equal(again, state);
});

test("pause during resolve stays paused when playback later starts", () => {
  let state = playable();
  assert.equal(state.phase, "resolving");
  state = reducePlayback(state, { type: "user-pause" });
  assert.equal(state.phase, "paused");
  assert.equal(state.intent, "pause");
  state = reducePlayback(state, {
    type: "use-engine",
    requestId: 1,
    engine: "audio",
  });
  state = reducePlayback(state, {
    type: "engine",
    requestId: 1,
    engine: "audio",
    event: "playing",
  });
  assert.equal(state.phase, "paused");
  assert.equal(state.intent, "pause");
});

test("buffering is not reported as playing", () => {
  let state = playable();
  state = reducePlayback(state, {
    type: "use-engine",
    requestId: 1,
    engine: "audio",
  });
  state = reducePlayback(state, {
    type: "engine",
    requestId: 1,
    engine: "audio",
    event: "buffering",
  });
  assert.equal(state.phase, "buffering");
  assert.equal(mediaSessionPlaybackState(state.phase), "none");
  state = reducePlayback(state, {
    type: "engine",
    requestId: 1,
    engine: "audio",
    event: "playing",
  });
  assert.equal(state.phase, "playing");
  assert.equal(mediaSessionPlaybackState(state.phase), "playing");
});

test("stale errors and events from the previous track are ignored", () => {
  let state = playable();
  state = reducePlayback(state, {
    type: "use-engine",
    requestId: 1,
    engine: "audio",
  });
  state = reducePlayback(state, {
    type: "engine",
    requestId: 1,
    engine: "audio",
    event: "playing",
  });
  const next = reducePlayback(
    { ...state, intent: "play" },
    { type: "load", requestId: 2, videoId: "zzzxxxxxx11" }
  );
  const stale = reducePlayback(next, {
    type: "failed",
    requestId: 1,
    message: "old failure",
  });
  assert.equal(stale.phase, "resolving");
  assert.equal(stale.error, null);
  const staleEngine = reducePlayback(next, {
    type: "engine",
    requestId: 1,
    engine: "audio",
    event: "paused",
  });
  assert.equal(staleEngine.phase, "resolving");
});

test("iframe events do not move an audio-owned session", () => {
  let state = playable();
  state = reducePlayback(state, {
    type: "use-engine",
    requestId: 1,
    engine: "audio",
  });
  state = reducePlayback(state, {
    type: "engine",
    requestId: 1,
    engine: "audio",
    event: "playing",
  });
  const ignored = reducePlayback(state, {
    type: "engine",
    requestId: 1,
    engine: "iframe",
    event: "paused",
  });
  assert.equal(ignored.phase, "playing");
});

test("autoplay rejection asks for a gesture and does not loop", () => {
  let state = playable();
  state = reducePlayback(state, {
    type: "autoplay-blocked",
    requestId: 1,
  });
  assert.equal(state.needsGesture, true);
  assert.equal(state.phase, "paused");
  assert.equal(state.intent, "play");
  const second = reducePlayback(state, {
    type: "autoplay-blocked",
    requestId: 1,
  });
  assert.equal(second.needsGesture, true);
  assert.equal(second.phase, "paused");
});

test("explicit pause is idempotent", () => {
  const once = reducePlayback(playable(), { type: "user-pause" });
  const twice = reducePlayback(once, { type: "user-pause" });
  assert.equal(twice, once);
  assert.equal(twice.phase, "paused");
});

test("a one-second end of a full song is truncated", () => {
  assert.equal(isTruncatedPlayback(1, 200), true);
  assert.equal(isTruncatedPlayback(190, 200), false);
  assert.equal(isTruncatedPlayback(1, 0), false);
});
