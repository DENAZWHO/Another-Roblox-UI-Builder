// Pixel data of reference images. Kept in IndexedDB (not in the document) so big screenshots
// don't overflow the localStorage autosave; the document only stores an image id.
import { useSyncExternalStore } from 'react';
import { uid } from './doc';
import { idb } from './idb';

const cache = new Map<string, string>();
const requested = new Set<string>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

const tx = <T,>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>) => idb<T>('refImages', mode, run);

/** Data URL of an image (undefined while loading / missing) */
export const refImageSrc = (id: string) => cache.get(id);

export function useRefImage(id: string): string | undefined {
  return useSyncExternalStore(subscribe, () => cache.get(id));
}

/** Make sure these images are loaded from IndexedDB */
export function loadRefImages(ids: string[]) {
  for (const id of ids) {
    if (cache.has(id) || requested.has(id)) continue;
    requested.add(id);
    tx<string | undefined>('readonly', (s) => s.get(id))
      .then((url) => {
        if (url) {
          cache.set(id, url);
          emit();
        }
      })
      .catch(() => {});
  }
}

/** An image's data URL, read from IndexedDB if it isn't loaded */
export async function refImageData(id: string): Promise<string | undefined> {
  if (cache.has(id)) return cache.get(id);
  try {
    return await tx<string | undefined>('readonly', (s) => s.get(id));
  } catch {
    return undefined;
  }
}

/** Store an image (data URL); returns its id */
export function putRefImage(dataUrl: string, id = uid()): string {
  cache.set(id, dataUrl);
  emit();
  tx('readwrite', (s) => s.put(dataUrl, id)).catch(() => {});
  return id;
}

/** Forget images no document uses any more */
export async function pruneRefImages(keep: Set<string>) {
  try {
    const keys = await tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys());
    for (const k of keys) if (!keep.has(String(k))) await tx('readwrite', (s) => s.delete(k));
  } catch {
    /* IndexedDB unavailable */
  }
}

const MAX_SIDE = 2560;

/** Read an image file, downscaled to at most 2560px, as a compact data URL plus its original size */
export async function readImageFile(file: Blob): Promise<{ dataUrl: string; w: number; h: number }> {
  const bmp = await createImageBitmap(file);
  const w = bmp.width;
  const h = bmp.height;
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * k));
  canvas.height = Math.max(1, Math.round(h * k));
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  let dataUrl = canvas.toDataURL('image/webp', 0.9);
  if (!dataUrl.startsWith('data:image/webp')) dataUrl = canvas.toDataURL('image/png');
  return { dataUrl, w, h };
}
