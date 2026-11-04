"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  listen,
  makeCode,
  sendCmd,
  sendState,
  type RemoteMsg,
} from "@/lib/remote";

export type RemoteMode = "off" | "host" | "remote";

interface RemoteCtx {
  mode: RemoteMode;
  code: string;
  connected: boolean;
  carState: RemoteMsg | null;
  startHost: () => void;
  startRemote: (code: string) => Promise<void>;
  stop: () => void;
  send: (msg: RemoteMsg) => void;
}

const Ctx = createContext<RemoteCtx>({
  mode: "off",
  code: "",
  connected: false,
  carState: null,
  startHost: () => {},
  startRemote: async () => {},
  stop: () => {},
  send: () => {},
});

export function useRemote() {
  return useContext(Ctx);
}

// Host-side: register a handler for incoming phone commands.
const SubsCtx = createContext<Set<(m: RemoteMsg) => void>>(new Set());
export function useRemoteCommands(fn: (m: RemoteMsg) => void) {
  const subs = useContext(SubsCtx);
  useEffect(() => {
    subs.add(fn);
    return () => {
      subs.delete(fn);
    };
  }, [fn, subs]);
}

const HOST_KEY = "remote_host_code";
const PEER_KEY = "remote_peer_code";

export default function RemoteProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [mode, setMode] = useState<RemoteMode>("off");
  const [code, setCode] = useState("");
  const [connected, setConnected] = useState(false);
  const [carState, setCarState] = useState<RemoteMsg | null>(null);
  const subs = useRef(new Set<(m: RemoteMsg) => void>());
  const unlisten = useRef<(() => void) | null>(null);
  const modeRef = useRef<RemoteMode>("off");
  modeRef.current = mode;

  const teardown = useCallback(() => {
    unlisten.current?.();
    unlisten.current = null;
    setConnected(false);
  }, []);

  const startHost = useCallback(() => {
    teardown();
    const c = makeCode();
    setCode(c);
    setMode("host");
    modeRef.current = "host";
    try {
      localStorage.setItem(HOST_KEY, c);
      localStorage.removeItem(PEER_KEY);
    } catch {}
    listen(c, "cmd", (msg) => {
      setConnected(true);
      subs.current.forEach((fn) => fn(msg));
    })
      .then((u) => {
        unlisten.current = u;
      })
      .catch(() => {});
  }, [teardown]);

  const startRemote = useCallback(
    async (peer: string) => {
      teardown();
      const c = peer.trim();
      setCode(c);
      setMode("remote");
      modeRef.current = "remote";
      try {
        localStorage.setItem(PEER_KEY, c);
        localStorage.removeItem(HOST_KEY);
      } catch {}
      // listen for car's now-playing state
      try {
        unlisten.current = await listen(c, "state", (msg) => {
          setConnected(true);
          setCarState(msg);
        });
      } catch {}
      // prove the channel works both ways
      await sendCmd(c, { t: "hello" });
      setConnected(true);
    },
    [teardown]
  );

  const stop = useCallback(() => {
    teardown();
    setMode("off");
    modeRef.current = "off";
    setCode("");
    setCarState(null);
    try {
      localStorage.removeItem(HOST_KEY);
      localStorage.removeItem(PEER_KEY);
    } catch {}
  }, [teardown]);

  const send = useCallback(
    (msg: RemoteMsg) => {
      if (modeRef.current === "remote" && code)
        sendCmd(code, msg).catch(() => setConnected(false));
      else if (modeRef.current === "host" && code && msg.t === "np")
        sendState(code, msg).catch(() => {});
    },
    [code]
  );

  // resume a previous pairing on reload (car screen stays paired)
  useEffect(() => {
    try {
      const host = localStorage.getItem(HOST_KEY);
      const peer = localStorage.getItem(PEER_KEY);
      if (host) {
        setCode(host);
        setMode("host");
        modeRef.current = "host";
        listen(host, "cmd", (msg) => {
          setConnected(true);
          subs.current.forEach((fn) => fn(msg));
        })
          .then((u) => {
            unlisten.current = u;
          })
          .catch(() => {});
      } else if (peer) {
        setCode(peer);
        setMode("remote");
        modeRef.current = "remote";
        listen(peer, "state", (msg) => {
          setConnected(true);
          setCarState(msg);
        })
          .then((u) => {
            unlisten.current = u;
          })
          .catch(() => {});
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SubsCtx.Provider value={subs.current}>
      <Ctx.Provider
        value={{
          mode,
          code,
          connected,
          carState,
          startHost,
          startRemote,
          stop,
          send,
        }}
      >
        {children}
      </Ctx.Provider>
    </SubsCtx.Provider>
  );
}
