// Full-size Roblox images for the editor (GET /rbx-image/<assetId>).
// Thumbnails are downscaled and padded to a square, so ImageRectOffset / ImageRectSize crops and
// SliceCenter 9-slices (given in the real image's pixels) can only be drawn right from the real file.
// Public images come from Roblox's asset delivery without a key; others are tried with the Open Cloud key
// saved for uploads (if any). Files are cached on disk.
import type { Plugin } from 'vite';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { load as loadKey } from './openCloud';

const LEGACY = 'https://assetdelivery.roblox.com/v1/assetId/';
const OPEN_CLOUD = 'https://apis.roblox.com/asset-delivery-api/v1/assetId/';

function imageType(b: Buffer): string | null {
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF') return 'image/webp';
  return null;
}

/** The CDN location of an asset's file */
async function locate(id: string): Promise<string> {
  let r = await fetch(LEGACY + id);
  if (r.ok) {
    const j = (await r.json()) as { location?: string };
    if (j.location) return j.location;
  }
  const key = loadKey()?.apiKey;
  if (key) {
    r = await fetch(OPEN_CLOUD + id, { headers: { 'x-api-key': key } });
    if (r.ok) {
      const j = (await r.json()) as { location?: string };
      if (j.location) return j.location;
    }
  }
  throw new Error(`asset ${id} is not available (HTTP ${r.status})`);
}

/** An image asset's file. A Decal id is followed to the image it shows. */
async function fetchImage(id: string, depth = 0): Promise<{ bytes: Buffer; type: string }> {
  const r = await fetch(await locate(id));
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const bytes = Buffer.from(await r.arrayBuffer());
  const type = imageType(bytes);
  if (type) return { bytes, type };
  // a Decal is a small model whose Texture points at the real image
  const m = /(?:rbxassetid:\/\/|[?&]id=)(\d+)/.exec(bytes.toString('latin1'));
  if (m && m[1] !== id && depth < 2) return fetchImage(m[1], depth + 1);
  throw new Error('not an image');
}

/** Roblox's own content folder (rbxasset://textures/... lives here), newest install first */
function contentDir(): string | null {
  const dirs: string[] = [];
  if (process.platform === 'win32') {
    const versions = join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Roblox', 'Versions');
    if (existsSync(versions)) {
      dirs.push(
        ...readdirSync(versions)
          .map((d) => join(versions, d, 'content'))
          .filter((d) => existsSync(join(d, 'textures')))
          .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs),
      );
    }
  } else dirs.push('/Applications/RobloxStudio.app/Contents/Resources/content', join(homedir(), 'Applications/RobloxStudio.app/Contents/Resources/content'));
  return dirs.find((d) => existsSync(d)) ?? null;
}

const CONTENT_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.bmp': 'image/bmp' };

export function assetImages(cacheDir: string): Plugin {
  let content: string | null | undefined;
  const pending = new Map<string, Promise<{ bytes: Buffer; type: string }>>();
  const failed = new Map<string, number>();
  return {
    name: 'asset-images',
    configureServer(server) {
      // rbxasset://textures/... (Roblox's built-in images) from the local Roblox install
      server.middlewares.use('/rbx-content', (req, res) => {
        content ??= contentDir();
        const rel = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)).replace(/^[\\/]+/, '');
        const file = content ? join(content, rel) : '';
        const type = CONTENT_TYPES[extname(rel).toLowerCase()];
        if (!content || !type || !file.startsWith(content + sep) || !existsSync(file)) {
          res.statusCode = 404;
          return res.end();
        }
        res.setHeader('Content-Type', type);
        res.setHeader('Cache-Control', 'max-age=86400');
        res.end(readFileSync(file));
      });

      server.middlewares.use('/rbx-image', (req, res) => {
        // only for the editor's own pages (keeps other sites from spending the key through this)
        const site = req.headers['sec-fetch-site'];
        const ref = req.headers.referer;
        if ((site && site !== 'same-origin') || (!site && ref && new URL(ref).host !== req.headers.host)) {
          res.statusCode = 403;
          return res.end();
        }
        const id = /^\/(\d{1,20})$/.exec(new URL(req.url ?? '/', 'http://x').pathname)?.[1];
        if (!id) {
          res.statusCode = 404;
          return res.end();
        }
        const send = (img: { bytes: Buffer; type: string }) => {
          res.setHeader('Content-Type', img.type);
          res.setHeader('Cache-Control', 'max-age=86400');
          res.end(img.bytes);
        };
        const file = join(cacheDir, id);
        if (existsSync(file)) {
          const bytes = readFileSync(file);
          const type = imageType(bytes);
          if (type) return send({ bytes, type });
        }
        // don't hammer Roblox for assets that just failed
        if (Date.now() - (failed.get(id) ?? 0) < 5 * 60_000) {
          res.statusCode = 404;
          return res.end();
        }
        let p = pending.get(id);
        if (!p) {
          p = fetchImage(id);
          pending.set(id, p);
          p.then(
            (img) => {
              mkdirSync(cacheDir, { recursive: true });
              writeFileSync(file, img.bytes);
            },
            () => failed.set(id, Date.now()),
          ).finally(() => pending.delete(id));
        }
        p.then(send, () => {
          res.statusCode = 404;
          res.end();
        });
      });
    },
  };
}
