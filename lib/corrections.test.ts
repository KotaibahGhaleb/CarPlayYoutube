import assert from "node:assert/strict";
import { test } from "node:test";
import {
  directVideoId,
  lookupCorrection,
  parseCorrections,
  rememberCorrection,
} from "./corrections";

test("old unversioned mappings are ignored", () => {
  const legacy = JSON.stringify({
    "adele|hello": { videoId: "wrongVideo1" },
  });
  const blob = parseCorrections(legacy);
  assert.deepEqual(blob.items, {});
  assert.equal(lookupCorrection(blob, "Adele", "Hello"), null);
});

test("a chosen video id is remembered for that song only", () => {
  let blob = parseCorrections(null);
  blob = rememberCorrection(blob, "فيروز", "يا طير", "fairuzTopic");
  assert.equal(lookupCorrection(blob, "فيروز", "يا طير"), "fairuzTopic");
  assert.equal(lookupCorrection(blob, "Fairuz", "Ya Teir"), null);
});

test("signed stream URLs are not persistable corrections", () => {
  const poisoned = JSON.stringify({
    version: 2,
    items: {
      "a|b": {
        videoId: "https://rr3---sn.googlevideo.com/videoplayback?expire=1&sig=abc",
        title: "B",
        artist: "A",
      },
    },
  });
  assert.equal(lookupCorrection(parseCorrections(poisoned), "A", "B"), null);
});

test("an existing YouTube id is used directly", () => {
  assert.equal(directVideoId({ youtubeId: "abcdefghijk" }), "abcdefghijk");
  assert.equal(directVideoId({ youtubeId: "not-an-id" }), null);
  assert.equal(directVideoId({}), null);
});
