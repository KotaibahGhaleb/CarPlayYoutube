"use client";

import { FormEvent, useEffect, useState } from "react";

type Status = {
  connected?: boolean;
  service?: boolean;
  method?: string | null;
  accountName?: string;
  error?: string;
};

export default function AccountPanel({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [locked, setLocked] = useState(false);
  const [accessKey, setAccessKey] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<{
    userCode: string;
    verificationUrl: string;
    interval: number;
  } | null>(null);

  async function refreshStatus() {
    const res = await fetch("/api/library/status");
    if (res.status === 401) {
      setLocked(true);
      setStatus(null);
      return;
    }
    const body = (await res.json()) as Status;
    setLocked(false);
    setStatus(body);
  }

  useEffect(() => {
    void refreshStatus().catch(() =>
      setStatus({ connected: false, service: false, error: "Couldn't reach the app" })
    );
  }, []);

  useEffect(() => {
    if (!pending) return;
    let stop = false;
    const tick = async () => {
      const res = await fetch("/api/library/auth/poll", { method: "POST" });
      const body = (await res.json()) as { status?: string; message?: string };
      if (stop) return;
      if (body.status === "connected") {
        setPending(null);
        setMessage("");
        await refreshStatus();
        onChanged();
      } else if (body.status === "expired" || body.status === "error") {
        setPending(null);
        setMessage(body.message || "Sign-in didn't finish. Try again.");
      }
    };
    const id = window.setInterval(tick, Math.max(5, pending.interval) * 1000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [onChanged, pending]);

  async function unlock(e: FormEvent) {
    e.preventDefault();
    setMessage("");
    const res = await fetch("/api/library/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessKey }),
    });
    if (!res.ok) {
      setMessage("That access key was rejected.");
      return;
    }
    setAccessKey("");
    await refreshStatus();
  }

  async function connect() {
    setMessage("");
    const res = await fetch("/api/library/auth/start", { method: "POST" });
    const body = (await res.json()) as {
      userCode?: string;
      verificationUrl?: string;
      interval?: number;
      error?: string;
    };
    if (!res.ok || !body.userCode || !body.verificationUrl) {
      setMessage(body.error || "Couldn't start device sign-in.");
      return;
    }
    setPending({
      userCode: body.userCode,
      verificationUrl: body.verificationUrl,
      interval: body.interval || 5,
    });
  }

  async function disconnect() {
    await fetch("/api/library/disconnect", { method: "POST" });
    setPending(null);
    await refreshStatus();
    onChanged();
  }

  async function refreshLibrary() {
    await fetch("/api/library/refresh", { method: "POST" });
    await refreshStatus();
    onChanged();
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="max-h-[90%] w-full max-w-md overflow-y-auto rounded-3xl border border-neutral-800 bg-neutral-900 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">YouTube Music</h2>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-neutral-500 hover:bg-neutral-800 hover:text-white"
          >
            ✕
          </button>
        </div>

        <p className="mb-4 text-sm leading-relaxed text-neutral-400">
          This connects the YouTube Music library on the server. It uses
          Google&apos;s device sign-in for TV-style apps, which is what the
          YouTube Music client requires. It is not the normal website Google
          popup, and a YouTube Data API login alone does not include your
          Music home feed.
        </p>

        {locked ? (
          <form onSubmit={unlock} className="flex flex-col gap-3">
            <p className="text-sm text-neutral-300">
              Enter the server access key. It stays in an httpOnly cookie and
              is not your Google password.
            </p>
            <input
              type="password"
              value={accessKey}
              onChange={(e) => setAccessKey(e.target.value)}
              placeholder="Access key"
              className="h-12 rounded-2xl border border-neutral-700 bg-neutral-950 px-4 outline-none focus:border-green-600"
            />
            <button className="h-12 rounded-2xl bg-white font-bold text-black">
              Unlock library
            </button>
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              {status?.service === false
                ? "The library service is not running."
                : status?.connected
                  ? `Connected${status.accountName ? ` as ${status.accountName}` : ""} (${status.method || "account"})`
                  : "Not connected"}
            </p>
            {status?.error && (
              <p className="text-sm text-red-400">{status.error}</p>
            )}
            {pending && (
              <div className="rounded-2xl bg-neutral-950 p-4 text-sm">
                <p>
                  Open{" "}
                  <a
                    className="text-green-400 underline"
                    href={pending.verificationUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {pending.verificationUrl.replace(/^https:\/\//, "")}
                  </a>{" "}
                  and enter
                </p>
                <p className="mt-2 text-center text-2xl font-bold tracking-[0.3em]">
                  {pending.userCode}
                </p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => void connect()}
                className="h-12 rounded-2xl bg-white font-bold text-black"
              >
                {status?.connected ? "Reconnect" : "Connect"}
              </button>
              <button
                onClick={() => void refreshLibrary()}
                className="h-12 rounded-2xl bg-neutral-800 font-bold"
              >
                Refresh
              </button>
              <button
                onClick={() => void disconnect()}
                className="col-span-2 h-12 rounded-2xl bg-neutral-800 font-bold text-red-300"
              >
                Disconnect
              </button>
            </div>
            <p className="text-xs leading-relaxed text-neutral-500">
              If device sign-in connects but library calls fail, use the
              browser-session steps in the README on this machine. Don&apos;t
              paste cookies into chat. Imported playlists here are read-only.
            </p>
          </div>
        )}
        {message && <p className="mt-3 text-sm text-red-400">{message}</p>}
      </div>
    </div>
  );
}
