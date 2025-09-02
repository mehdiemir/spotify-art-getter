import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import sharp from 'sharp';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static client
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '2mb' }));

// Simple in-memory token cache
let tokenCache = { accessToken: null, expiresAt: 0 };

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

async function getAccessToken() {
  if (
    tokenCache.accessToken &&
    tokenCache.expiresAt - 30 > nowSeconds() // small buffer
  ) {
    return tokenCache.accessToken;
  }

  const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET } = process.env;
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    throw new Error('Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET in .env');
  }

  const body = new URLSearchParams({ grant_type: 'client_credentials' }).toString();
  const basic = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');

  const resp = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Token request failed: ${resp.status} ${text}`);
  }
  const data = await resp.json();
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: nowSeconds() + (data.expires_in || 3600),
  };
  return tokenCache.accessToken;
}

// Parse Spotify URLs or URIs to { type, id }
function parseSpotifyLink(input) {
  if (!input) return null;
  const trimmed = input.trim();

  // spotify:track:ID or spotify:type:ID
  const uriMatch = trimmed.match(/^spotify:([a-z_]+):([A-Za-z0-9]+)$/i);
  if (uriMatch) {
    return { type: uriMatch[1].toLowerCase(), id: uriMatch[2] };
  }

  try {
    const url = new URL(trimmed);
    if (!/\.spotify\./.test(url.hostname)) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    // expected: /type/id
    if (parts.length >= 2) {
      const type = parts[0].toLowerCase();
      let id = parts[1];
      // Some URLs include extra slug-like segments (e.g., playlist name). Keep only the base ID.
      id = id.split('?')[0];
      return { type, id };
    }
  } catch (_) {
    // not a URL
  }
  return null;
}

async function fetchJSON(url, accessToken) {
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Spotify API error: ${r.status} ${txt}`);
  }
  return r.json();
}

async function getImagesFor(type, id) {
  const token = await getAccessToken();
  const base = 'https://api.spotify.com/v1';

  const only640 = (imgs) => (imgs || []).filter(
    (img) => Number(img?.width) === 640 && Number(img?.height) === 640
  );

  // Map input type to endpoint and image field
  switch (type) {
    case 'track': {
      const d = await fetchJSON(`${base}/tracks/${id}`, token);
      return {
        title: d.name,
        byline: d.artists?.map(a => a.name).join(', '),
        type: 'track',
        images: only640(d.album?.images),
      };
    }
    case 'album': {
      const d = await fetchJSON(`${base}/albums/${id}`, token);
      return {
        title: d.name,
        byline: d.artists?.map(a => a.name).join(', '),
        type: 'album',
        images: only640(d.images),
      };
    }
    case 'artist': {
      const d = await fetchJSON(`${base}/artists/${id}`, token);
      return {
        title: d.name,
        byline: 'Artist',
        type: 'artist',
        images: only640(d.images),
      };
    }
    case 'playlist': {
      const d = await fetchJSON(`${base}/playlists/${id}`, token);
      return {
        title: d.name,
        byline: d.owner?.display_name ? `By ${d.owner.display_name}` : 'Playlist',
        type: 'playlist',
        images: only640(d.images),
      };
    }
    case 'episode': {
      const d = await fetchJSON(`${base}/episodes/${id}`, token);
      return {
        title: d.name,
        byline: d.show?.name ? `From ${d.show.name}` : 'Episode',
        type: 'episode',
        images: only640(d.images),
      };
    }
    case 'show': {
      const d = await fetchJSON(`${base}/shows/${id}`, token);
      return {
        title: d.name,
        byline: 'Podcast',
        type: 'show',
        images: only640(d.images),
      };
    }
    default:
      throw new Error(`Unsupported type: ${type}`);
  }
}

app.get('/api/cover', async (req, res) => {
  try {
    const { url } = req.query;
    const parsed = parseSpotifyLink(String(url || ''));
    if (!parsed) {
      return res.status(400).json({ error: 'Invalid or unsupported Spotify link/URI.' });
    }
    const data = await getImagesFor(parsed.type, parsed.id);
    try {
      const sizes = (data.images || []).map(i => `${i.width}x${i.height}`).join(', ');
      console.log(`[cover] type=${data.type} id=${parsed.id} sizes=[${sizes}]`);
    } catch {}
    res.json({
      id: parsed.id,
      type: data.type,
      title: data.title,
      byline: data.byline,
      images: data.images, // [{url, width, height}]
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Enhance a single image via Cutout.pro and return the binary
app.post('/api/enhance', async (req, res) => {
  try {
    const { imageUrl, endpoint: endpointOverride, quality, progressive } = req.body || {};
    if (!imageUrl) return res.status(400).json({ error: 'Missing imageUrl' });
    const CUTOUT_API_KEY = process.env.CUTOUT_API_KEY;
    if (!CUTOUT_API_KEY) return res.status(400).json({ error: 'Missing CUTOUT_API_KEY in .env' });

    // 1) Download the source image
    const srcResp = await fetch(imageUrl);
    if (!srcResp.ok) {
      const txt = await srcResp.text().catch(() => '');
      return res.status(400).json({ error: `Failed to fetch source image (${srcResp.status})`, details: txt });
    }
    const arrayBuf = await srcResp.arrayBuffer();
    const contentTypeIn = srcResp.headers.get('content-type') || 'image/jpeg';

    // 2) Build multipart form with 'file'
    const endpoint = endpointOverride || process.env.CUTOUT_ENHANCE_ENDPOINT || 'https://www.cutout.pro/api/v1/photoEnhance';
    const form = new FormData();
    const ext = contentTypeIn.includes('png') ? 'png' : 'jpg';
    const file = new File([arrayBuf], `input.${ext}`, { type: contentTypeIn });
    form.append('file', file);

    // 3) Call Cutout.pro and stream binary back
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'APIKEY': CUTOUT_API_KEY },
      body: form,
    });

    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return res.status(502).json({ error: `Cutout.pro error: ${r.status}`, details: txt });
    }

    const buf = Buffer.from(await r.arrayBuffer());

    // Resize to exactly 3000x3000 (cover keeps aspect; square in our case)
    const q = Math.max(1, Math.min(100, Number(quality) || 95));
    const prog = Boolean(progressive);
    const resized = await sharp(buf)
      .resize(3000, 3000, { fit: 'cover' })
      .jpeg({ quality: q, progressive: prog, chromaSubsampling: '4:4:4' })
      .toBuffer();

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Length', String(resized.length));
    res.setHeader('Content-Disposition', `attachment; filename="enhanced_3000x3000_${Date.now()}.jpg"`);
    res.send(resized);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Enhance failed' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
