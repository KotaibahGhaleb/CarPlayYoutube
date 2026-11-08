import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("metadata lookup and playback share one resolver", () => {
  const match = readFileSync(new URL("../app/api/match/route.ts", import.meta.url), "utf8");
  const stream = readFileSync(new URL("../app/api/stream/route.ts", import.meta.url), "utf8");
  assert.match(match, /resolveTrack/);
  assert.match(stream, /resolveTrack/);
  assert.doesNotMatch(stream, /Promise\.any\(\s*\[\s*searchInnertube/);
  assert.doesNotMatch(match, /meta=1/);
});
