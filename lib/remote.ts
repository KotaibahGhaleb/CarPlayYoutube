"use client";

// Remote-control transport over public MQTT (broker.emqx.io, WSS).
// No accounts — the car screen shows a pairing code, the phone types it,
// and every tap on the phone mirrors to the car screen.

import mqtt, { type MqttClient } from "mqtt";

const BROKER = "wss://broker.emqx.io:8084/mqtt";

let client: MqttClient | null = null;
let connectPromise: Promise<MqttClient> | null = null;

export type RemoteMsg = { t: string } & Record<string, unknown>;

export function makeCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function cmdTopic(code: string) {
  return `carplay-media/${code}/cmd`;
}
function stateTopic(code: string) {
  return `carplay-media/${code}/state`;
}

function connect(): Promise<MqttClient> {
  if (client?.connected) return Promise.resolve(client);
  if (connectPromise) return connectPromise;
  connectPromise = new Promise((resolve, reject) => {
    const c = mqtt.connect(BROKER, {
      clientId: `cpm-${Math.random().toString(36).slice(2, 10)}`,
      keepalive: 30,
      reconnectPeriod: 2000,
      connectTimeout: 10000,
      clean: true,
    });
    c.once("connect", () => {
      client = c;
      resolve(c);
    });
    c.once("error", (e) => {
      connectPromise = null;
      reject(e);
    });
  });
  return connectPromise;
}

// phone -> car commands
export async function sendCmd(code: string, msg: RemoteMsg) {
  const c = await connect();
  c.publish(cmdTopic(code), JSON.stringify(msg), { qos: 0 });
}

// car -> phone state (now playing info)
export async function sendState(code: string, msg: RemoteMsg) {
  const c = await connect();
  c.publish(stateTopic(code), JSON.stringify(msg), { qos: 0 });
}

export async function listen(
  code: string,
  kind: "cmd" | "state",
  cb: (msg: RemoteMsg) => void
): Promise<() => void> {
  const c = await connect();
  const topic = kind === "cmd" ? cmdTopic(code) : stateTopic(code);
  const handler = (t: string, payload: Buffer) => {
    if (t !== topic) return;
    try {
      cb(JSON.parse(payload.toString()));
    } catch {}
  };
  c.subscribe(topic, { qos: 0 });
  c.on("message", handler);
  return () => {
    c.unsubscribe(topic);
    c.off("message", handler);
  };
}
