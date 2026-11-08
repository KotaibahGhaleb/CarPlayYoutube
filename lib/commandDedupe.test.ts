import assert from "node:assert/strict";
import { test } from "node:test";
import { rememberCommand } from "./commandDedupe";

test("a duplicated remote command is ignored", () => {
  const seen = new Set<string>();
  assert.equal(rememberCommand(seen, "cmd-1"), true);
  assert.equal(rememberCommand(seen, "cmd-1"), false);
  assert.equal(rememberCommand(seen, "cmd-2"), true);
});

test("commands without an id still run", () => {
  assert.equal(rememberCommand(new Set(), ""), true);
});
