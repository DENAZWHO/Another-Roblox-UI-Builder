import type { Plugin } from 'vite';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

/**
 * Serves Roblox Studio's own font files so the editor renders text exactly like Studio.
 *
 *   GET /api/fonts/families      -> every family from content/fonts/families/*.json
 *   GET /api/fonts/file/<name>   -> a font file shipped with Studio (rbxasset://fonts/...)
 *   GET /api/fonts/asset/<id>    -> a cloud font face (rbxassetid://...), downloaded once and cached
 *
 * Set ROBLOX_FONTS_DIR to point at a ".../content/fonts" folder if auto-detection fails.
 */

interface Face { name: string; weight: number; style: 'normal' | 'italic'; assetId: string }

function candidateDirs(): string[] {
  const out: string[] = [];
  if (process.env.ROBLOX_FONTS_DIR) out.push(process.env.ROBLOX_FONTS_DIR);
  if (process.platform === 'win32') {
    const versions = join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Roblox', 'Versions');
    if (existsSync(versions)) {
      const dirs = readdirSync(versions)
        .map((d) => join(versions, d, 'content', 'fonts'))
        .filter((d) => existsSync(join(d, 'families')))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs); // newest install first
      out.push(...dirs);
    }
  } else {
    out.push('/Applications/RobloxStudio.app/Contents/Resources/content/fonts', join(homedir(), 'Applications/RobloxStudio.app/Contents/Resources/content/fonts'));
  }
  return out;
}

function findFontsDir(): string | null {
  return candidateDirs().find((d) => existsSync(join(d, 'families'))) ?? null;
}

/**
 * Line height as a multiple of the font size, from the font's hhea table ((ascender - descender) / unitsPerEm).
 * Roblox lays a line of text out this tall, so TextScaled fits this height (not 1 × TextSize) into the box.
 */
function lineHeightOf(buf: Buffer): number | null {
  return verticalMetrics(buf)?.lineHeight ?? null;
}

/** hhea ascender and (ascender - descender), both as multiples of the font size */
function verticalMetrics(buf: Buffer): { ascent: number; lineHeight: number } | null {
  try {
    const n = buf.readUInt16BE(4);
    const tables: Record<string, number> = {};
    for (let i = 0; i < n; i++) tables[buf.toString('latin1', 12 + 16 * i, 16 + 16 * i)] = buf.readUInt32BE(12 + 16 * i + 8);
    if (tables.head === undefined || tables.hhea === undefined) return null;
    const upem = buf.readUInt16BE(tables.head + 18);
    const asc = buf.readInt16BE(tables.hhea + 4);
    const desc = buf.readInt16BE(tables.hhea + 6);
    return upem ? { ascent: +(asc / upem).toFixed(4), lineHeight: +((asc - desc) / upem).toFixed(4) } : null;
  } catch {
    return null;
  }
}

const fontType = (buf: Buffer) => (buf.subarray(0, 4).toString('latin1') === 'OTTO' ? 'font/otf' : buf.subarray(0, 4).toString('latin1') === 'wOFF' ? 'font/woff' : 'font/ttf');

export function robloxFonts(cacheDir: string): Plugin {
  let dir: string | null = null;
  let families: unknown = null;

  const load = () => {
    dir = findFontsDir();
    if (!dir) return { available: false, families: [] };
    const famDir = join(dir, 'families');
    const list = readdirSync(famDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          const j = JSON.parse(readFileSync(join(famDir, f), 'utf8')) as { name: string; faces: Face[] };
          // metrics are the same across a family's faces; read them from the first file on disk
          let lineHeight: number | null = null;
          let ascent: number | null = null;
          for (const face of j.faces) {
            const local = /^rbxasset:\/\/fonts\/(.+)$/.exec(face.assetId);
            if (local && existsSync(join(dir!, local[1]))) {
              const vm = verticalMetrics(readFileSync(join(dir!, local[1])));
              if (vm) {
                lineHeight = vm.lineHeight;
                ascent = vm.ascent;
                break;
              }
            }
          }
          return {
            id: f.replace(/\.json$/, ''),
            name: j.name,
            lineHeight,
            ascent,
            faces: j.faces.map((face) => {
              const local = /^rbxasset:\/\/fonts\/(.+)$/.exec(face.assetId);
              const cloud = /^rbxassetid:\/\/(\d+)$/.exec(face.assetId);
              const url = local && existsSync(join(dir!, local[1])) ? `/api/fonts/file/${encodeURIComponent(basename(local[1]))}` : cloud ? `/api/fonts/asset/${cloud[1]}` : null;
              return { name: face.name, weight: face.weight, style: face.style === 'italic' ? 'Italic' : 'Normal', url };
            }).filter((face) => face.url),
          };
        } catch {
          return null;
        }
      })
      .filter((f) => f && f.faces.length && !/Fallback/i.test(f.id));
    return { available: true, source: dir, families: list };
  };

  return {
    name: 'roblox-fonts',
    configureServer(server) {
      server.middlewares.use('/api/fonts', async (req, res) => {
        const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
        const fail = (status: number, msg: string) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: msg }));
        };
        const sendFont = (buf: Buffer) => {
          res.setHeader('Content-Type', fontType(buf));
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          res.end(buf);
        };

        if (path === '/families') {
          families ??= load();
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          return res.end(JSON.stringify(families));
        }

        const file = /^\/file\/([^/\\]+)$/.exec(path);
        if (file) {
          if (!dir) load();
          const p = dir ? resolve(dir, basename(file[1])) : null;
          if (!p || !existsSync(p)) return fail(404, 'font not found');
          return sendFont(readFileSync(p));
        }

        const asset = /^\/asset\/(\d+)$/.exec(path);
        if (asset) {
          const cached = join(cacheDir, asset[1]);
          if (existsSync(cached)) return sendFont(readFileSync(cached));
          try {
            const r = await fetch(`https://assetdelivery.roblox.com/v1/asset/?id=${asset[1]}`);
            if (!r.ok) return fail(502, `assetdelivery returned ${r.status}`);
            let buf = Buffer.from(await r.arrayBuffer());
            if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
            mkdirSync(cacheDir, { recursive: true });
            writeFileSync(cached, buf);
            return sendFont(buf);
          } catch (e) {
            return fail(502, String(e));
          }
        }
        fail(404, 'not found');
      });
    },
  };
}
