// Uploads images to Roblox with Open Cloud (Assets API) on behalf of the editor.
// The API key never reaches the browser: it's kept in a file in the user's home folder
// (~/.roblox-ui-builder/opencloud.json, outside the project) and used only here.
import type { Plugin } from 'vite';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface Config {
  apiKey: string;
  creatorType: 'user' | 'group';
  creatorId: string;
}

const DIR = join(homedir(), '.roblox-ui-builder');
const FILE = join(DIR, 'opencloud.json');
const API = 'https://apis.roblox.com/assets/v1';
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/bmp', 'image/tga']);

function load(): Config | null {
  try {
    const c = JSON.parse(readFileSync(FILE, 'utf8'));
    return c.apiKey && c.creatorId ? c : null;
  } catch {
    return null;
  }
}

function save(c: Config) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(c, null, 2), { mode: 0o600 });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Roblox's error message, or the HTTP status */
async function errorOf(r: Response): Promise<string> {
  const text = await r.text().catch(() => '');
  try {
    const j = JSON.parse(text);
    return j.message || j.errors?.[0]?.message || j.error || `HTTP ${r.status}`;
  } catch {
    return text.slice(0, 200) || `HTTP ${r.status}`;
  }
}

export async function upload(c: Config, bytes: Buffer, type: string, name: string): Promise<{ assetId: string; moderation?: string }> {
  const form = new FormData();
  form.append(
    'request',
    JSON.stringify({
      assetType: 'Image',
      displayName: name.slice(0, 50) || 'UI image',
      description: 'Uploaded from Roblox UI Builder',
      creationContext: { creator: c.creatorType === 'group' ? { groupId: c.creatorId } : { userId: c.creatorId } },
    }),
  );
  form.append('fileContent', new Blob([bytes], { type }), `${name || 'image'}.${type.split('/')[1]}`);
  const r = await fetch(`${API}/assets`, { method: 'POST', headers: { 'x-api-key': c.apiKey }, body: form });
  if (!r.ok) throw new Error(await errorOf(r));
  let op = (await r.json()) as { path?: string; done?: boolean; response?: any; error?: any };
  // the upload is processed in the background: poll the operation until it's done
  for (let i = 0; i < 30 && !op.done; i++) {
    await sleep(i < 5 ? 600 : 1500);
    const id = op.path?.split('/').pop();
    if (!id) break;
    const p = await fetch(`${API}/operations/${id}`, { headers: { 'x-api-key': c.apiKey } });
    if (!p.ok) throw new Error(await errorOf(p));
    op = await p.json();
  }
  if (op.error) throw new Error(op.error.message || 'Upload failed');
  const assetId = op.response?.assetId;
  if (!assetId) throw new Error('Roblox is still processing the upload — check Creator Dashboard in a minute');
  return { assetId: String(assetId), moderation: op.response?.moderationResult?.moderationState };
}

export function openCloud(): Plugin {
  return {
    name: 'open-cloud',
    configureServer(server) {
      server.middlewares.use('/api/opencloud', (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(body));
        };
        // only the editor itself may use this (a custom header forces a CORS preflight, which is never allowed;
        // the Origin, when sent, must be this server)
        const host = req.headers.host ?? '';
        const origin = req.headers.origin;
        if (req.headers['x-ui-builder'] !== '1' || (origin && new URL(origin).host !== host)) return send(403, { error: 'forbidden' });

        const url = new URL(req.url ?? '/', 'http://localhost');
        const body = () =>
          new Promise<Buffer>((resolve, reject) => {
            const chunks: Buffer[] = [];
            let size = 0;
            req.on('data', (c: Buffer) => {
              size += c.length;
              if (size > 20 * 1024 * 1024) req.destroy();
              else chunks.push(c);
            });
            req.on('end', () => resolve(Buffer.concat(chunks)));
            req.on('error', reject);
          });

        if (req.method === 'GET' && url.pathname === '/status') {
          const c = load();
          return send(200, c ? { configured: true, keyHint: '…' + c.apiKey.slice(-4), creatorType: c.creatorType, creatorId: c.creatorId } : { configured: false });
        }

        if (req.method === 'POST' && url.pathname === '/config') {
          body()
            .then((b) => {
              const j = JSON.parse(b.toString('utf8'));
              const prev = load();
              const apiKey = String(j.apiKey || prev?.apiKey || '').trim();
              const creatorType = j.creatorType === 'group' ? 'group' : 'user';
              const creatorId = String(j.creatorId ?? '').replace(/\D/g, '');
              if (!apiKey || !creatorId) return send(400, { error: 'An API key and a user or group id are needed' });
              save({ apiKey, creatorType, creatorId });
              send(200, { ok: true });
            })
            .catch(() => send(400, { error: 'invalid request' }));
          return;
        }

        if (req.method === 'DELETE' && url.pathname === '/config') {
          rmSync(FILE, { force: true });
          return send(200, { ok: true });
        }

        if (req.method === 'POST' && url.pathname === '/upload') {
          const c = load();
          if (!c) return send(400, { error: 'Set up uploading first (API key and creator)' });
          const type = String(req.headers['content-type'] ?? '').split(';')[0];
          if (!IMAGE_TYPES.has(type)) return send(400, { error: 'PNG, JPEG, BMP or TGA images only' });
          const name = (url.searchParams.get('name') ?? 'image').replace(/[^\w .-]/g, '').slice(0, 50);
          body()
            .then((bytes) => upload(c, bytes, type, name))
            .then((r) => send(200, r))
            .catch((e) => send(502, { error: String(e?.message ?? e) }));
          return;
        }

        send(404, { error: 'not found' });
      });
    },
  };
}
