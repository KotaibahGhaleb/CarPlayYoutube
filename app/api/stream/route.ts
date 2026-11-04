import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;

// Media proxy — the browser only ever talks to our origin, so nothing in
// the network path (corp proxies, DNS filters) can block googlevideo /
// pipedproxy / CDN hosts. Range headers are forwarded for seeking.

const ALLOWED_HOST =
  /(^|\.)googlevideo\.com$|(^|\.)ggpht\.com$|(^|\.)ytimg\.com$|(^|\.)googleusercontent\.com$|pipedproxy|(^|\.)piped\.|pipedapi|invidious|(^|\.)iv\.|odycdn\.com$|videoplayback/i;

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url || !/^https:\/\//i.test(url)) {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }
  if (!ALLOWED_HOST.test(host)) {
    return NextResponse.json({ error: "Host not allowed" }, { status: 403 });
  }

  const headers: Record<string, string> = {};
  const range = req.headers.get("range");
  if (range) headers.range = range;

  // Retry on 403/429 — signed URLs can fail transiently (shared egress IPs,
  // rate limits); a fresh attempt often goes through.
  let upstream: Response | null = null;
  let fetchErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      upstream = await fetch(url, {
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(30000),
      });
      if (
        upstream.ok ||
        upstream.status === 206 ||
        (upstream.status !== 403 && upstream.status !== 429)
      )
        break;
      upstream = null;
      await new Promise((r) => setTimeout(r, 400));
    } catch (e) {
      fetchErr = e;
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  if (!upstream) {
    return NextResponse.json(
      {
        error:
          fetchErr instanceof Error ? fetchErr.message : "Upstream failed",
      },
      { status: 502 }
    );
  }

  if (!upstream.ok && upstream.status !== 206) {
    return NextResponse.json(
      { error: `Upstream ${upstream.status}` },
      { status: 502 }
    );
  }

  const pass = [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "etag",
    "last-modified",
  ];
  const resHeaders: Record<string, string> = { "cache-control": "no-store" };
  for (const h of pass) {
    const v = upstream.headers.get(h);
    if (v) resHeaders[h] = v;
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: resHeaders,
  });
}
