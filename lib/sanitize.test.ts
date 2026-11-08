import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizeError } from "./sanitize";

test("signed URLs and tokens are removed from diagnostics", () => {
  const raw =
    "upstream https://rr1.googlevideo.com/videoplayback?expire=99&sig=abcDEF123&n=secret failed ya29.a0AfH6tokenvalue";
  const clean = sanitizeError(new Error(raw));
  assert.equal(clean.includes("googlevideo"), false);
  assert.equal(clean.includes("sig="), false);
  assert.equal(clean.includes("ya29"), false);
  assert.match(clean, /\[url\]/);
});
