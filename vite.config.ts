import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { robloxFonts } from './server/robloxFonts';
import { openCloud } from './server/openCloud';

/**
 * Local bridge for the Roblox Studio plugin (studio-plugin/UIBuilderSync.lua).
 * The editor POSTs the current UI tree; the plugin polls for new versions.
 */
function studioSync(): Plugin {
  let version = 0;
  let payload: string | null = null;
  let lastPoll = 0;
  let lastApplied = 0;
  // Studio -> editor: property edits made to synced GUIs in Studio
  let editSeq = 0;
  const edits: { seq: number; data: unknown }[] = [];

  return {
    name: 'studio-sync',
    configureServer(server) {
      server.middlewares.use('/api/studio', (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const send = (status: number, body?: unknown, type = 'application/json') => {
          res.statusCode = status;
          res.setHeader('Content-Type', type);
          res.setHeader('Cache-Control', 'no-store');
          res.end(body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body));
        };

        if (req.method === 'POST' && url.pathname === '/push') {
          let data = '';
          req.on('data', (c) => (data += c));
          req.on('end', () => {
            try {
              JSON.parse(data);
            } catch {
              return send(400, { error: 'invalid JSON' });
            }
            version++;
            payload = data;
            send(200, { version });
          });
          return;
        }
        if (req.method === 'GET' && url.pathname === '/pull') {
          lastPoll = Date.now();
          const since = Number(url.searchParams.get('since') ?? 0);
          if (!payload || version <= since) return send(204);
          return send(200, `{"version":${version},"data":${payload}}`);
        }
        if (req.method === 'POST' && url.pathname === '/ack') {
          lastApplied = Number(url.searchParams.get('version') ?? 0);
          lastPoll = Date.now();
          return send(200, { ok: true });
        }
        if (req.method === 'POST' && url.pathname === '/edits') {
          let data = '';
          req.on('data', (c) => (data += c));
          req.on('end', () => {
            try {
              edits.push({ seq: ++editSeq, data: JSON.parse(data) });
              if (edits.length > 200) edits.splice(0, edits.length - 200);
              send(200, { seq: editSeq });
            } catch {
              send(400, { error: 'invalid JSON' });
            }
          });
          return;
        }
        if (req.method === 'GET' && url.pathname === '/edits') {
          const since = Number(url.searchParams.get('since') ?? -1);
          // since=-1: just report the current position (the editor starts listening from "now")
          if (since < 0) return send(200, { seq: editSeq, edits: [] });
          return send(200, { seq: editSeq, edits: edits.filter((e) => e.seq > since).map((e) => e.data) });
        }
        if (req.method === 'GET' && url.pathname === '/status') {
          return send(200, { connected: Date.now() - lastPoll < 4000, version, lastApplied });
        }
        if (req.method === 'GET' && url.pathname === '/plugin') {
          const src = readFileSync(resolve(fileURLToPath(new URL('.', import.meta.url)), 'studio-plugin/UIBuilderSync.lua'), 'utf8');
          res.setHeader('Content-Disposition', 'attachment; filename="UIBuilderSync.lua"');
          return send(200, src, 'text/plain; charset=utf-8');
        }
        send(404, { error: 'not found' });
      });
    },
  };
}

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react(), studioSync(), openCloud(), robloxFonts(resolve(root, 'node_modules/.cache/rbx-fonts'))],
  server: {
    port: 5173,
    proxy: {
      // Roblox's thumbnail API has no CORS headers, so asset previews go through the dev server
      '/rbx-thumbs': { target: 'https://thumbnails.roblox.com', changeOrigin: true, rewrite: (p) => p.replace(/^\/rbx-thumbs/, '') },
      '/rbxcdn': { target: 'https://tr.rbxcdn.com', changeOrigin: true, rewrite: (p) => p.replace(/^\/rbxcdn/, '') },
      '/rbx-users': { target: 'https://users.roblox.com', changeOrigin: true, rewrite: (p) => p.replace(/^\/rbx-users/, '') },
    },
  },
});
