"use client";

import { useState } from "react";
import { useRemote } from "./RemoteProvider";

export default function RemotePanel({ onClose }: { onClose: () => void }) {
  const { mode, code, connected, carState, startHost, startRemote, stop } =
    useRemote();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  return (
    <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-sm rounded-3xl border border-neutral-800 bg-neutral-900 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">Remote Control</h2>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-neutral-500 hover:bg-neutral-800 hover:text-white"
          >
            ✕
          </button>
        </div>

        {mode === "off" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-neutral-400">
              Use this screen as the display, or control another screen from
              here.
            </p>
            <button
              onClick={startHost}
              className="h-14 rounded-2xl bg-neutral-800 text-base font-bold transition hover:bg-neutral-700 active:scale-95"
            >
              This is the CAR screen
              <span className="mt-0.5 block text-xs font-normal text-neutral-400">
                show a pairing code
              </span>
            </button>
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="6-digit code"
                inputMode="numeric"
                maxLength={6}
                className="h-14 min-w-0 flex-1 rounded-2xl border border-neutral-700 bg-neutral-950 px-4 text-center text-xl font-bold tracking-[0.4em] outline-none focus:border-blue-500"
              />
              <button
                disabled={input.trim().length !== 6 || busy}
                onClick={async () => {
                  setBusy(true);
                  setErr("");
                  try {
                    await startRemote(input);
                  } catch {
                    setErr("Couldn't connect — try again");
                  } finally {
                    setBusy(false);
                  }
                }}
                className="h-14 rounded-2xl bg-blue-600 px-5 text-base font-bold transition hover:bg-blue-500 active:scale-95 disabled:opacity-40"
              >
                {busy ? "…" : "Link"}
              </button>
            </div>
            {err && <p className="text-xs text-red-400">{err}</p>}
            <p className="text-center text-xs text-neutral-500">
              On your phone: open this site → Remote → enter the code
            </p>
          </div>
        )}

        {mode === "host" && (
          <div className="flex flex-col items-center gap-4">
            <p className="text-sm text-neutral-400">
              Enter this code on your phone
            </p>
            <p className="rounded-2xl bg-neutral-950 px-8 py-4 text-5xl font-black tracking-[0.3em] text-green-400">
              {code}
            </p>
            <p className="text-xs text-neutral-500">
              {connected ? "Remote connected ✓" : "Waiting for phone…"}
            </p>
            <button
              onClick={stop}
              className="h-12 w-full rounded-2xl bg-neutral-800 text-sm font-bold transition hover:bg-neutral-700 active:scale-95"
            >
              Unpair
            </button>
          </div>
        )}

        {mode === "remote" && (
          <div className="flex flex-col items-center gap-4">
            <p className="text-sm text-neutral-400">
              {connected
                ? "Controlling car screen"
                : "Connecting to car screen…"}
            </p>
            <p className="rounded-2xl bg-neutral-950 px-6 py-3 text-3xl font-black tracking-[0.3em] text-blue-400">
              {code}
            </p>
            {carState?.name != null && (
              <p className="w-full truncate rounded-xl bg-neutral-800 px-4 py-3 text-center text-sm">
                <span className="text-neutral-400">On car: </span>
                <span className="font-bold">
                  {String(carState.name)}
                  {carState.artist ? ` — ${String(carState.artist)}` : ""}
                </span>
              </p>
            )}
            <p className="text-center text-xs leading-relaxed text-neutral-500">
              Everything you tap here now plays on the car screen — search,
              songs, videos, controls.
            </p>
            <button
              onClick={stop}
              className="h-12 w-full rounded-2xl bg-neutral-800 text-sm font-bold transition hover:bg-neutral-700 active:scale-95"
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
