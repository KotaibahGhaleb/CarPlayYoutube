# CarPlay Media

A car-screen-friendly web app — no accounts, no keys, no Premium needed:

- **YouTube** — search and watch ad-free. Streams resolve through three
  fallback layers: public Piped instances → Invidious → direct YouTube
  (Innertube), all proxied server-side via `/api/piped`
- **Music** — song search via iTunes, Top-50 chart, synced lyrics (LRCLIB),
  audio played through YouTube. Paste a YouTube/YouTube Music playlist link
  to import it; ♥ saves favorites locally.

## Run locally

```bash
npm install
npm run dev
```

Open <http://localhost:3000> (or `http://127.0.0.1:3000`).

## Deploy to Vercel

```bash
npx vercel
```

or push to GitHub and import the repo in Vercel. No environment variables needed.

## Notes

- YouTube playback depends on public Piped/Invidious instances, which get
  bot-blocked periodically — the app retries across instances and falls back
  to direct YouTube extraction automatically.
- Lyrics come from LRCLIB's free synced-lyrics database; rare tracks may not
  have lyrics.
- Designed for landscape touch screens: large targets, dark theme, Media
  Session controls (steering-wheel / lock-screen buttons work).
