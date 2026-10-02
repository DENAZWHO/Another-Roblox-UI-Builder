// Uploading images to Roblox (Open Cloud). The dev server does the actual call with the API key it
// keeps on this computer (server/openCloud.ts); the browser only sends the picture.
import { useEffect, useState } from 'react';
import { useStore } from './store';

const H = { 'X-UI-Builder': '1' };

export interface UploadStatus {
  configured: boolean;
  keyHint?: string;
  creatorType?: 'user' | 'group';
  creatorId?: string;
  /** the dev server isn't running (e.g. a static build) */
  offline?: boolean;
}

export async function uploadStatus(): Promise<UploadStatus> {
  try {
    const r = await fetch('/api/opencloud/status', { headers: H });
    if (!r.ok) return { configured: false, offline: r.status === 404 };
    return await r.json();
  } catch {
    return { configured: false, offline: true };
  }
}

export function useUploadStatus(): [UploadStatus | null, () => void] {
  const [s, set] = useState<UploadStatus | null>(null);
  const refresh = () => void uploadStatus().then(set);
  useEffect(refresh, []);
  return [s, refresh];
}

export async function saveUploadConfig(c: { apiKey?: string; creatorType: 'user' | 'group'; creatorId: string }) {
  const r = await fetch('/api/opencloud/config', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(c) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
}

export async function forgetUploadConfig() {
  await fetch('/api/opencloud/config', { method: 'DELETE', headers: H });
}

const TYPES = ['image/png', 'image/jpeg', 'image/bmp', 'image/tga'];

/** Upload a picture; resolves with its asset id (rbxassetid://…) */
export async function uploadImage(file: Blob, name: string): Promise<{ assetId: string; moderation?: string }> {
  let blob = file;
  // anything else (webp, gif, svg…) is converted to PNG first
  if (!TYPES.includes(file.type)) blob = await toPng(file);
  const r = await fetch(`/api/opencloud/upload?name=${encodeURIComponent(name.replace(/\.[a-z0-9]+$/i, ''))}`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': blob.type },
    body: blob,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j;
}

async function toPng(file: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext('2d')!.drawImage(bmp, 0, 0);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not convert the image'))), 'image/png'));
}

/** Pick an image, show it right away, upload it, then set the elements' Image to the new asset */
export function pickAndUploadImage(ids: string[]) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/bmp,image/*';
  input.onchange = async () => {
    const f = input.files?.[0];
    if (!f) return;
    const s = useStore.getState();
    const status = await uploadStatus();
    if (!status.configured) {
      s.showToast(status.offline ? 'Uploading needs the dev server (npm run dev)' : 'Set up uploading first: add your Open Cloud API key');
      if (!status.offline) useStore.setState({ dialog: 'upload' });
      return;
    }
    // show the picture now (until Roblox's thumbnail is ready)
    const src = await new Promise<string>((res) => {
      const reader = new FileReader();
      reader.onload = () => res(reader.result as string);
      reader.readAsDataURL(f);
    });
    const size = await new Promise<{ w: number; h: number }>((res) => {
      const img = new Image();
      img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => res({ w: 0, h: 0 });
      img.src = src;
    });
    s.update((d) => ids.forEach((id) => d.nodes[id] && (d.nodes[id].preview = { src, ...size })));
    s.showToast(`Uploading ${f.name} to Roblox…`);
    try {
      const { assetId, moderation } = await uploadImage(f, f.name);
      useStore.getState().update((d) => ids.forEach((id) => d.nodes[id] && (d.nodes[id].props.Image = `rbxassetid://${assetId}`)));
      const pending = moderation && moderation !== 'MODERATION_STATE_APPROVED';
      useStore.getState().showToast(`Uploaded: rbxassetid://${assetId}${pending ? ' (waiting for Roblox moderation — it shows in game once approved)' : ''}`);
    } catch (e) {
      useStore.getState().showToast(`Upload failed: ${(e as Error).message}`);
    }
  };
  input.click();
}
