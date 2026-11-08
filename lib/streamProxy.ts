// Stream-proxy helpers. Signed upstream URLs never belong in headers we
// build, logs, or error strings.

export type StreamKind = "audio" | "video";

const PASS_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
];

export function rangeStartByte(range: string | null): number | null {
  if (!range) return null;
  const m = range.match(/bytes=(\d*)-/i);
  if (!m) return null;
  if (m[1] === "") return 0;
  return Number(m[1]);
}

export function looksLikeErrorDocument(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 80);
  let text = "";
  for (let i = 0; i < n; i++) text += String.fromCharCode(bytes[i]);
  const s = text.trimStart().toLowerCase();
  return (
    s.startsWith("<!doctype") ||
    s.startsWith("<html") ||
    s.startsWith("<?xml") ||
    s.startsWith("{") ||
    s.startsWith("[")
  );
}

export function looksLikeMp4(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  return (
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  );
}

export function looksLikeWebm(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  );
}

export function looksLikeMedia(bytes: Uint8Array): boolean {
  if (looksLikeMp4(bytes) || looksLikeWebm(bytes)) return true;
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    return true;
  }
  if (bytes.length >= 4 && bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) {
    return true;
  }
  return false;
}

function typeFamily(contentType: string): string {
  return contentType.split(";")[0]?.trim().toLowerCase() ?? "";
}

export function typeOk(kind: StreamKind, contentType: string): boolean {
  const t = typeFamily(contentType);
  if (!t) return false;
  if (kind === "audio") {
    return (
      t.startsWith("audio/") ||
      t === "video/mp4" ||
      t === "video/webm" ||
      t === "application/octet-stream"
    );
  }
  return t.startsWith("video/") || t === "application/octet-stream";
}

export function acceptMediaBytes(
  kind: StreamKind,
  contentType: string,
  bytes: Uint8Array,
  rangeStart: number | null
): boolean {
  if (!bytes.length || looksLikeErrorDocument(bytes)) return false;
  const ranged = rangeStart !== null && rangeStart > 0;
  if (ranged) return typeOk(kind, contentType) || contentType.trim() === "";
  if (looksLikeMedia(bytes)) return true;
  const t = typeFamily(contentType);
  if (t === "application/octet-stream" || !t) return false;
  return typeOk(kind, contentType);
}

export function proxyResponseHeaders(
  src: { get(name: string): string | null },
  opts?: { kind?: StreamKind; prefix?: Uint8Array }
): Record<string, string> {
  const out: Record<string, string> = { "cache-control": "no-store" };
  for (const h of PASS_HEADERS) {
    const v = src.get(h);
    if (!v) continue;
    if (/https?:\/\//i.test(v)) continue;
    out[h] = v;
  }
  const prefix = opts?.prefix;
  const current = typeFamily(out["content-type"] ?? "");
  if (prefix && opts?.kind === "audio" && (!current || current === "application/octet-stream")) {
    if (looksLikeMp4(prefix)) out["content-type"] = "audio/mp4";
    else if (looksLikeWebm(prefix)) out["content-type"] = "audio/webm";
  }
  if (prefix && opts?.kind === "video" && (!current || current === "application/octet-stream")) {
    if (looksLikeMp4(prefix)) out["content-type"] = "video/mp4";
    else if (looksLikeWebm(prefix)) out["content-type"] = "video/webm";
  }
  return out;
}

export function classifyFailure(message: string): string {
  const m = message.toLowerCase();
  if (/login required|sign in|not a bot|confirm you/.test(m)) return "bot_check";
  if (/embedding|embed disabled|not embeddable/.test(m)) return "embed_restricted";
  if (/unavailable|private video|video unavailable|removed|copyright/.test(m)) {
    return "video_unavailable";
  }
  if (/timeout|abort|network|fetch failed|econn|unreachable/.test(m)) {
    return "upstream_unavailable";
  }
  return "stream_failed";
}

export async function raceProviders<T>(
  jobs: Array<(signal: AbortSignal) => Promise<T>>
): Promise<T> {
  const controllers = jobs.map(() => new AbortController());
  let winner = -1;
  try {
    return await Promise.any(
      jobs.map((job, i) =>
        job(controllers[i].signal).then((value) => {
          if (winner === -1) winner = i;
          return value;
        })
      )
    );
  } finally {
    controllers.forEach((c, i) => {
      if (i !== winner) c.abort();
    });
  }
}

export async function openUpstream(args: {
  url: string;
  range: string | null;
  kind: StreamKind;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<Response | null> {
  const doFetch = args.fetchImpl ?? fetch;
  const headers: Record<string, string> = {};
  if (args.range) headers.range = args.range;
  let upstream: Response;
  try {
    upstream = await doFetch(args.url, {
      headers,
      redirect: "follow",
      signal: args.signal,
    });
  } catch {
    return null;
  }
  if (!(upstream.ok || upstream.status === 206) || !upstream.body) return null;
  const reader = upstream.body.getReader();
  let prefix: Uint8Array;
  try {
    const first = await reader.read();
    if (first.done || !first.value?.byteLength) {
      await reader.cancel().catch(() => {});
      return null;
    }
    prefix = first.value;
  } catch {
    await reader.cancel().catch(() => {});
    return null;
  }
  const contentType = upstream.headers.get("content-type") ?? "";
  if (
    !acceptMediaBytes(args.kind, contentType, prefix, rangeStartByte(args.range))
  ) {
    await reader.cancel().catch(() => {});
    return null;
  }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(prefix);
    },
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) controller.close();
        else controller.enqueue(chunk.value);
      } catch (err) {
        controller.error(err);
      }
    },
    cancel() {
      return reader.cancel();
    },
  });
  return new Response(stream, {
    status: upstream.status,
    headers: proxyResponseHeaders(upstream.headers, {
      kind: args.kind,
      prefix,
    }),
  });
}
