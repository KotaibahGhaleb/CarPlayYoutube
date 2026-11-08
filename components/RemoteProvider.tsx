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
import { rememberCommand } from "@/lib/commandDedupe";
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

const SubsCtx = createContext<Set<(m: RemoteMsg) => void>>(new Set());
export function useRemoteCommands(fn: (m: RemoteMsg) => void) {
  const subs = useContext(SubsCtx);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    const wrapped = (m: RemoteMsg) => fnRef.current(m);
    subs.add(wrapped);
    return () => {
      subs.delete(wrapped);
    };
  }, [subs]);
}

const HOST_KEY = "remote_host_code";
const PEER_KEY = "remote_peer_code";

function withId(msg: RemoteMsg): RemoteMsg {
  if (typeof msg.id === "string" && msg.id) return msg;
  return {
    ...msg,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  };
}

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
  const genRef = useRef(0);
  const seenIds = useRef(new Set<string>());
  const modeRef = useRef<RemoteMode>("off");
  modeRef.current = mode;
  const codeRef = useRef("");
  codeRef.current = code;

  const teardown = useCallback(() => {
    genRef.current += 1;
    unlisten.current?.();
    unlisten.current = null;
    setConnected(false);
  }, []);

  const onCmd = useCallback((msg: RemoteMsg) => {
    const id = typeof msg.id === "string" ? msg.id : "";
    if (!rememberCommand(seenIds.current, id)) return;
    setConnected(true);
    subs.current.forEach((fn) => fn(msg));
  }, []);

  const onState = useCallback((msg: RemoteMsg) => {
    setConnected(true);
    setCarState(msg);
  }, []);

  const attach = useCallback(
    (pairing: string, kind: "cmd" | "state") => {
      const gen = ++genRef.current;
      unlisten.current?.();
      unlisten.current = null;
      const handler = kind === "cmd" ? onCmd : onState;
      listen(pairing, kind, handler)
        .then((stop) => {
          if (gen !== genRef.current) {
            stop();
            return;
          }
          unlisten.current = stop;
        })
        .catch(() => {});
    },
    [onCmd, onState]
  );

  const startHost = useCallback(() => {
    teardown();
    const c = makeCode();
    setCode(c);
    setMode("host");
    modeRef.current = "host";
    codeRef.current = c;
    try {
      localStorage.setItem(HOST_KEY, c);
      localStorage.removeItem(PEER_KEY);
    } catch {
      /* private mode */
    }
    attach(c, "cmd");
  }, [attach, teardown]);

  const startRemote = useCallback(
    async (peer: string) => {
      teardown();
      const c = peer.trim();
      setCode(c);
      setMode("remote");
      modeRef.current = "remote";
      codeRef.current = c;
      try {
        localStorage.setItem(PEER_KEY, c);
        localStorage.removeItem(HOST_KEY);
      } catch {
        /* private mode */
      }
      attach(c, "state");
      await sendCmd(c, withId({ t: "hello" }));
      setConnected(true);
    },
    [attach, teardown]
  );

  const stop = useCallback(() => {
    teardown();
    setMode("off");
    modeRef.current = "off";
    setCode("");
    codeRef.current = "";
    setCarState(null);
    try {
      localStorage.removeItem(HOST_KEY);
      localStorage.removeItem(PEER_KEY);
    } catch {
      /* private mode */
    }
  }, [teardown]);

  const send = useCallback((msg: RemoteMsg) => {
    const current = codeRef.current;
    const stamped = withId(msg);
    if (modeRef.current === "remote" && current)
      sendCmd(current, stamped).catch(() => setConnected(false));
    else if (modeRef.current === "host" && current && stamped.t === "np")
      sendState(current, stamped).catch(() => {});
  }, []);

  useEffect(() => {
    try {
      const host = localStorage.getItem(HOST_KEY);
      const peer = localStorage.getItem(PEER_KEY);
      if (host) {
        setCode(host);
        codeRef.current = host;
        setMode("host");
        modeRef.current = "host";
        attach(host, "cmd");
      } else if (peer) {
        setCode(peer);
        codeRef.current = peer;
        setMode("remote");
        modeRef.current = "remote";
        attach(peer, "state");
      }
    } catch {
      /* private mode */
    }
    return () => {
      genRef.current += 1;
      unlisten.current?.();
      unlisten.current = null;
    };
  }, [attach]);

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
