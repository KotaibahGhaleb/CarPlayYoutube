import { NextRequest, NextResponse } from "next/server";
import {
  accessKeyMatches,
  issueLibraryToken,
  verifyLibraryToken,
} from "@/lib/libraryGate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const COOKIE = "cpm_library";

function gateSecret(): string | null {
  const key = process.env.LIBRARY_GATE_KEY?.trim();
  return key && key.length >= 8 ? key : null;
}

function isLocal(req: NextRequest): boolean {
  const host = req.nextUrl.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function allowed(req: NextRequest): boolean {
  const key = gateSecret();
  if (!key) return isLocal(req);
  return verifyLibraryToken(key, req.cookies.get(COOKIE)?.value ?? "");
}

function locked() {
  return NextResponse.json({ error: "library_locked" }, { status: 401 });
}

function serviceBase(): string {
  return (process.env.YTMUSIC_SERVICE_URL?.trim() || "http://127.0.0.1:8787").replace(
    /\/$/,
    ""
  );
}

async function proxy(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  const key = process.env.YTMUSIC_SERVICE_KEY?.trim();
  if (key) headers.set("x-service-key", key);
  if (!headers.has("accept")) headers.set("accept", "application/json");
  try {
    const res = await fetch(`${serviceBase()}${path}`, {
      ...init,
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(25000),
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: {
        "content-type": res.headers.get("content-type") || "application/json",
        "cache-control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      {
        connected: false,
        service: false,
        error: "Library service is not running",
      },
      { status: 503 }
    );
  }
}

function cookie(res: NextResponse, token: string) {
  res.cookies.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
}

async function handle(req: NextRequest, parts: string[]) {
  const head = parts[0] ?? "";

  if (head === "session" && req.method === "POST") {
    const key = gateSecret();
    if (!key) {
      if (isLocal(req)) {
        return NextResponse.json({ ok: true, local: true });
      }
      return NextResponse.json(
        { error: "Set LIBRARY_GATE_KEY before exposing the library" },
        { status: 403 }
      );
    }
    let accessKey = "";
    try {
      const body = (await req.json()) as { accessKey?: string };
      accessKey = body.accessKey ?? "";
    } catch {
      accessKey = "";
    }
    if (!accessKeyMatches(key, accessKey)) {
      return NextResponse.json({ error: "Rejected" }, { status: 401 });
    }
    const res = NextResponse.json({ ok: true });
    cookie(res, issueLibraryToken(key));
    return res;
  }

  if (head === "session" && req.method === "DELETE") {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
    return res;
  }

  if (!allowed(req)) return locked();

  const query = req.nextUrl.search;
  if (head === "status" && req.method === "GET") return proxy("/status");
  if (head === "auth" && parts[1] === "start" && req.method === "POST") {
    return proxy("/auth/device/start", { method: "POST" });
  }
  if (head === "auth" && parts[1] === "poll" && req.method === "POST") {
    return proxy("/auth/device/poll", { method: "POST" });
  }
  if (head === "disconnect" && req.method === "POST") {
    return proxy("/disconnect", { method: "POST" });
  }
  if (head === "refresh" && req.method === "POST") {
    return proxy("/reload", { method: "POST" });
  }
  if (head === "playlists" && req.method === "GET") return proxy(`/playlists${query}`);
  if (head === "playlist" && req.method === "GET") return proxy(`/playlist${query}`);
  if (head === "liked" && req.method === "GET") return proxy(`/liked${query}`);
  if (head === "songs" && req.method === "GET") return proxy(`/library${query}`);
  if (head === "home" && req.method === "GET") return proxy(`/home${query}`);

  return NextResponse.json({ error: "Unknown library route" }, { status: 404 });
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> }
) {
  const { path } = await ctx.params;
  return handle(req, path ?? []);
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> }
) {
  const { path } = await ctx.params;
  return handle(req, path ?? []);
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> }
) {
  const { path } = await ctx.params;
  return handle(req, path ?? []);
}
