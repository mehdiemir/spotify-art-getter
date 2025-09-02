**Spotify Cover Downloader**

- **What it does:** Paste any Spotify link or URI (track, album, artist, playlist, show, episode) and download its cover art in available sizes from the official Spotify Web API.
- **How it works:** A small Express server uses Client Credentials to call Spotify endpoints and returns image URLs to the browser. No user login required.

**Prerequisites**
- Node.js 18+ (uses built‑in `fetch`)
- A Spotify Developer App (Client ID/Secret)

**Setup**
- Copy `.env.example` to `.env` and fill values:
  - `SPOTIFY_CLIENT_ID=your_client_id`
  - `SPOTIFY_CLIENT_SECRET=your_client_secret`
  - `PORT=3000` (optional)
  - `CUTOUT_API_KEY=your_cutout_pro_api_key` (optional, for Enhance)
- Install deps and run:
  - `npm install`
  - `npm run dev`
  - Open `http://localhost:3000`

**Usage**
- Paste a Spotify link like:
  - `https://open.spotify.com/track/3AJwUDP919kvQ9QcozQPxg`
  - `https://open.spotify.com/album/1ATL5GLyefJaxhQzSPVrLX`
  - `https://open.spotify.com/artist/66CXWjxzNUsdJxJ2JdwvnR`
  - `https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M`
  - `spotify:track:3AJwUDP919kvQ9QcozQPxg`
- Click Fetch. Thumbnails appear with buttons to open or download.

**Endpoints**
- `GET /api/cover?url=<spotify_link_or_uri>` → `{ id, type, title, byline, images: [{url,width,height}] }`
- `POST /api/enhance` `{ imageUrl, scale? }` → enhanced image binary as attachment. Requires `CUTOUT_API_KEY`.
 - `POST /api/enhance` `{ imageUrl, scale? }` → enhanced image (JPEG, 3000×3000). Requires `CUTOUT_API_KEY`.

**Notes**
- Images are returned exactly as provided by Spotify. Availability and sizes vary by item type and asset.
- The server caches the access token in memory for efficiency.
- This project is unaffiliated with Spotify; artwork belongs to their owners.
- Cutout.pro: You may need to adjust the enhance endpoint via `CUTOUT_ENHANCE_ENDPOINT` in `.env` depending on your plan. Default is `https://www.cutout.pro/api/v1/ai-enhancer` and uses `image_url` + `scale` parameters with `APIKEY` header.
 - Enhance output: JPEG 3000×3000 at a high default quality.
