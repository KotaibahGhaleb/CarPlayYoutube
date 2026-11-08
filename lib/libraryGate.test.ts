import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accessKeyMatches,
  issueLibraryToken,
  verifyLibraryToken,
} from "./libraryGate";

test("a library session token verifies only for the same key", () => {
  const now = 1_700_000_000_000;
  const token = issueLibraryToken("owner-key-value", now);
  assert.equal(verifyLibraryToken("owner-key-value", token, now + 1000), true);
  assert.equal(verifyLibraryToken("other-key-value", token, now + 1000), false);
  assert.equal(verifyLibraryToken("owner-key-value", token + "x", now + 1000), false);
});

test("expired library sessions fail", () => {
  const now = 1_700_000_000_000;
  const token = issueLibraryToken("owner-key-value", now);
  assert.equal(
    verifyLibraryToken("owner-key-value", token, now + 40 * 24 * 60 * 60 * 1000),
    false
  );
});

test("access keys are compared without matching a prefix", () => {
  assert.equal(accessKeyMatches("correct-key", "correct-key"), true);
  assert.equal(accessKeyMatches("correct-key", "correct-key-extra"), false);
  assert.equal(accessKeyMatches("correct-key", "wrong-key!!"), false);
});
