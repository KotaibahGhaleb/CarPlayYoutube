import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acceptMediaBytes,
  classifyFailure,
  looksLikeMp4,
  openUpstream,
  proxyResponseHeaders,
  raceProviders,
  rangeStartByte,
} from "./streamProxy";

function mp4(extra = 32): Uint8Array {
  const bytes = new Uint8Array(8 + extra);
  bytes.set([0x66, 0x74, 0x79, 0x70], 4);
  return bytes;
}

test("range start and content-range headers are preserved", () => {
  assert.equal(rangeStartByte("bytes=0-"), 0);
  assert.equal(rangeStartByte("bytes=1024-2048"), 1024);
  const headers = proxyResponseHeaders({
    get(name: string) {
      const map: Record<string, string> = {
        "content-type": "audio/mp4",
        "content-range": "bytes 0-99/1000",
        "content-length": "100",
        "accept-ranges": "bytes",
        "set-cookie": "secret=1",
      };
      return map[name] ?? null;
    },
  });
  assert.equal(headers["content-range"], "bytes 0-99/1000");
  assert.equal(headers["accept-ranges"], "bytes");
  assert.equal(headers["cache-control"], "no-store");
  assert.equal(headers["set-cookie"], undefined);
});

test("an HTML body is not treated as audio", () => {
  const html = new TextEncoder().encode("<!doctype html><html></html>");
  assert.equal(acceptMediaBytes("audio", "text/html", html, null), false);
});

test("a mid-file range does not have to start with ftyp", () => {
  const chunk = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(acceptMediaBytes("audio", "audio/mp4", chunk, 4096), true);
  assert.equal(
    acceptMediaBytes("audio", "application/octet-stream", chunk, null),
    false
  );
  assert.equal(
    acceptMediaBytes("audio", "audio/mp4", new TextEncoder().encode("<html>nope"), null),
    false
  );
});

test("mp4 bytes promote an empty content type", () => {
  const prefix = mp4();
  assert.equal(looksLikeMp4(prefix), true);
  const headers = proxyResponseHeaders(
    { get: () => null },
    { kind: "audio", prefix }
  );
  assert.equal(headers["content-type"], "audio/mp4");
});

test("openUpstream keeps the first bytes and the rest of the body", async () => {
  const payload = mp4(20);
  const buffer = new ArrayBuffer(payload.byteLength);
  new Uint8Array(buffer).set(payload);
  const fetchImpl: typeof fetch = async () =>
    new Response(new Blob([buffer]), {
      status: 206,
      headers: {
        "content-type": "application/octet-stream",
        "content-range": "bytes 0-27/28",
        "accept-ranges": "bytes",
      },
    });
  const res = await openUpstream({
    url: "https://upstream.example/audio",
    range: "bytes=0-",
    kind: "audio",
    fetchImpl,
  });
  assert.ok(res);
  assert.equal(res!.status, 206);
  assert.equal(res!.headers.get("content-range"), "bytes 0-27/28");
  assert.equal(res!.headers.get("content-type"), "audio/mp4");
  const body = new Uint8Array(await res!.arrayBuffer());
  assert.deepEqual(body, payload);
  assert.equal(res!.headers.get("x-upstream-url"), null);
});

test("openUpstream rejects an error document", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(JSON.stringify({ error: "bot" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  const res = await openUpstream({
    url: "https://upstream.example/blocked",
    range: null,
    kind: "audio",
    fetchImpl,
  });
  assert.equal(res, null);
});

test("the losing provider is aborted and the winner is not", async () => {
  const signals: AbortSignal[] = [];
  const result = await raceProviders<string>([
    (signal) =>
      new Promise((resolve) => {
        signals[0] = signal;
        setTimeout(() => resolve("slow"), 50);
      }),
    (signal) => {
      signals[1] = signal;
      return Promise.resolve("fast");
    },
  ]);
  assert.equal(result, "fast");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(signals[0].aborted, true);
  assert.equal(signals[1].aborted, false);
});

test("failure classes do not mention account tier", () => {
  assert.equal(classifyFailure("Sign in to confirm you're not a bot"), "bot_check");
  assert.equal(classifyFailure("Video unavailable"), "video_unavailable");
  assert.equal(classifyFailure("The user aborted a request."), "upstream_unavailable");
  assert.doesNotMatch(classifyFailure("Sign in to confirm you're not a bot"), /premium/i);
});
