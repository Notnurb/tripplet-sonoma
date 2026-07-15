# vidapi

A dead-simple media downloader. Paste a link, get a direct download button. No ads, no trackers, no popups, no accounts, no paywalls.

Supports YouTube, TikTok, Twitter/X, Instagram, and Reddit.

## How it works

- `frontend/` — SvelteKit app. One page: a text box and, once you submit a link, a list of quality/format buttons.
- `backend/` — Express API that shells out to [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) to resolve metadata and fetch media, then streams the file straight back to the browser as a download. Nothing is stored permanently — files land in a temp directory and are deleted the moment the response finishes.

## Requirements

- Node.js 20+
- [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) on your `PATH` — `brew install yt-dlp` (or `pipx install yt-dlp`)
- `ffmpeg` on your `PATH` — `brew install ffmpeg` (needed to merge separate video/audio streams and extract MP3 audio)

## Setup

```bash
cd backend
npm install
cp .env.example .env   # adjust FRONTEND_ORIGIN/PORT if needed
npm run dev             # http://localhost:8787

cd ../frontend
npm install
cp .env.example .env   # adjust PUBLIC API base if needed
npm run dev             # http://localhost:5173
```

Open http://localhost:5173, paste a link, download.

## Notes

- The backend only accepts URLs from an allow-list of supported platforms (see `backend/src/lib/validate-url.ts`) — this keeps `yt-dlp` (which supports thousands of sites) scoped to what the product actually advertises, and limits abuse surface.
- Rate limiting is applied per-IP on `/api`.
- This tool is meant for saving public content you already have the right to save. Respecting the source platform's terms of service is on the person using it — this app doesn't attempt to bypass private accounts, DRM, or paywalled content.
