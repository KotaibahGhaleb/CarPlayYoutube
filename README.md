# CarPlay Media

A car-screen web app for YouTube and music:

- **YouTube** — search and watch. Streams resolve through Piped, Invidious, and direct YouTube (Innertube), proxied by `/api/piped` and `/api/stream`.
- **Music** — iTunes search and charts, synced lyrics (LRCLIB), favorites, and public/unlisted YouTube playlist import. Audio is matched to one YouTube video and played through the proxy, with the official YouTube player as a visible fallback.
- **Your library** — optional YouTube Music connection for your playlists, liked songs, library songs, and home recommendations. Read-only.

## Run locally

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

```bash
npm test
npm run typecheck
npm run build
```

## Playback

One player owns playback. Its phases are idle, resolving, buffering, playing, paused, ended, and error. Pressing play stores the intent to play; the UI shows "playing" only after the element is actually playing. Pause stays paused if a search or buffer finishes later. Autoplay rejection shows **Tap to play** once — the app does not keep calling `play()`.

Song search and playback use the same match (`/api/match` and `/api/stream` both call `resolveTrack`). A low-confidence result asks you to **Choose version** instead of starting an unrelated video. That choice is stored locally as a video id (`yt_match_v2`), not as a stream URL.

In development, a small on-screen log shows playback events, engine, video id, request id, intent, and media readiness. Signed stream URLs are not logged.

Connecting YouTube Music does **not** make extracted audio reliable. Proxy playback still depends on YouTube, Piped, and Invidious.

## YouTube Music library

The official YouTube Data API can list some playlist resources for the signed-in channel. It does not provide YouTube Music's liked songs, library songs, or home recommendations. Those come from [ytmusicapi](https://ytmusicapi.readthedocs.io/), an unofficial client that can break when YouTube changes. This repo runs that client in a separate Python process. Nothing in that process rates songs, edits the library, or writes watch history.

### 1. Install and start the service

```bash
pip install -r services/ytmusic/requirements.txt
python services/ytmusic/server.py
```

It listens on `127.0.0.1:8787` unless `YTMUSIC_BIND` / `YTMUSIC_PORT` say otherwise. Auth is stored in `YTMUSIC_AUTH_PATH` (default `.secrets/ytmusic-auth.json`). That file is gitignored. Do not commit it.

### 2. Protect it

On your own machine, localhost is enough. If the Next.js server is reachable by anyone else, set both:

```bash
LIBRARY_GATE_KEY=replace-with-a-long-random-string
YTMUSIC_SERVICE_KEY=replace-with-another-long-random-string
```

`LIBRARY_GATE_KEY` is checked by Next.js. The browser only receives an httpOnly session cookie after you type that key in the YouTube Music panel. `YTMUSIC_SERVICE_KEY` is sent from Next.js to the Python process and is not a `NEXT_PUBLIC_` variable. See `.env.example`.

Put the Python variables in the environment of `server.py`, and the Next variables in `.env.local`.

Vercel (or any host that only runs Next.js) cannot serve this library by itself. Run the Python service on a machine the Next.js server can reach, and set `YTMUSIC_SERVICE_URL`.

### 3. Sign in

In the app, open **YouTube Music**. The button starts Google's **device** sign-in (the "TVs and Limited Input devices" OAuth client). It is not the normal website Google popup. Create that client in Google Cloud, enable the YouTube Data API, and set:

```bash
YTMUSIC_CLIENT_ID=your-tv-client-id.apps.googleusercontent.com
YTMUSIC_CLIENT_SECRET=your-tv-client-secret
```

The page shows a code and a link. The refresh token stays in the auth file. Disconnect deletes that file and revokes the token when Google's revoke endpoint accepts it.

ytmusicapi's own docs describe this device flow as the OAuth setup. Some YouTube Music internal calls have rejected OAuth bearer tokens and still accept a copied browser session. If Connect succeeds but library requests fail, use the browser session below. Do not paste cookies into chat or commit them.

### Browser session (fallback)

1. In Firefox, open <https://music.youtube.com> while logged in.
2. DevTools → Network → filter `browse` → an authenticated POST → copy request headers into a local file, for example `headers.txt`.
3. Run:

```bash
python services/ytmusic/setup_browser.py headers.txt
```

4. Restart `server.py` and press **Refresh** in the app.

`headers.txt` is gitignored. Delete it after the auth file is written. Browser sessions expire when that YouTube Music session ends; use **Reconnect** or repeat this setup.

### What the library UI calls

| App section | Service |
| --- | --- |
| My playlists | `get_library_playlists` |
| Liked Songs | `get_liked_songs` |
| Library Songs | `get_library_songs` (likes are not included; that is the upstream behavior) |
| For You | `get_home`, section titles kept |

Tracks keep their YouTube video id. Lists page with **Load more**. Empty lists stay empty — charts are not substituted. A dead service or expired session is shown as an error.

## Deploy the player

```bash
npx vercel
```

No environment variables are required for search, charts, lyrics, favorites, or public playlist import. Library variables are only needed if you also run the Python service somewhere `YTMUSIC_SERVICE_URL` can reach.

## Notes

- YouTube playback depends on public Piped/Invidious instances and on YouTube's own response. Datacenter networks are often bot-checked. The app retries a transient audio failure once, then shows the official player at a visible size.
- Lyrics come from LRCLIB. Some songs have none.
- Landscape touch layout, local favorites, and paired-phone controls (public MQTT) are unchanged. Phone commands are explicit play/pause and are ignored if the same command id arrives twice.
