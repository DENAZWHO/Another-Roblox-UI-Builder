// Copies the Studio sync plugin into Roblox Studio's local plugins folder.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'studio-plugin', 'UIBuilderSync.lua');
const dir =
  process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Roblox', 'Plugins')
    : join(homedir(), 'Documents', 'Roblox', 'Plugins');

if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
const dest = join(dir, 'UIBuilderSync.lua');
copyFileSync(src, dest);
console.log(`Installed plugin to ${dest}\nRestart Roblox Studio, then use Plugins → UI Builder → Live Sync.`);
