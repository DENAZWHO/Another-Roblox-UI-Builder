// Reference images: pictures placed on the canvas to design against. Editor only.
import { useStore } from './store';
import { uid } from './model/doc';
import { putRefImage, readImageFile } from './model/refImages';
import type { RefImage } from './model/types';

const S = () => useStore.getState();

export const references = () => S().doc.references ?? [];
export const getReference = (id: string | null | undefined) => (id ? references().find((r) => r.id === id) : undefined);

export function selectReference(id: string | null) {
  useStore.setState({ refSelection: id, selection: [], editingTextId: null });
}

/** Rect that fits (contain) or fills (cover) an image of this size into the screen */
function screenRect(natW: number, natH: number, mode: 'contain' | 'cover') {
  const { w, h } = S().doc.device;
  const k = mode === 'contain' ? Math.min(w / natW, h / natH) : Math.max(w / natW, h / natH);
  const rw = natW * k;
  const rh = natH * k;
  return { x: Math.round((w - rw) / 2), y: Math.round((h - rh) / 2), w: Math.round(rw), h: Math.round(rh) };
}

export const isImageFile = (f: File | null | undefined): f is File => !!f && f.type.startsWith('image/');

/**
 * Add an image as a reference. Without a point it's fitted to the screen as a background;
 * dropped on the canvas it's centred on the drop point (shrunk to fit the screen if bigger).
 */
export async function addReference(file: Blob, opts: { name?: string; at?: { x: number; y: number } } = {}) {
  let img: Awaited<ReturnType<typeof readImageFile>>;
  try {
    img = await readImageFile(file);
  } catch {
    S().showToast("Couldn't read that image");
    return null;
  }
  const imageId = putRefImage(img.dataUrl);
  const { device } = S().doc;
  let rect = screenRect(img.w, img.h, 'contain');
  if (opts.at) {
    const k = Math.min(1, device.w / img.w, device.h / img.h);
    const w = Math.round(img.w * k);
    const h = Math.round(img.h * k);
    rect = { x: Math.round(opts.at.x - w / 2), y: Math.round(opts.at.y - h / 2), w, h };
  }
  const n = references().length + 1;
  const ref: RefImage = {
    id: uid(),
    name: (opts.name || (file instanceof File ? file.name : '') || `Reference ${n}`).replace(/\.[a-z0-9]+$/i, ''),
    imageId,
    ...rect,
    natW: img.w,
    natH: img.h,
    opacity: 0.5,
    placement: 'behind',
  };
  S().update((d) => {
    (d.references ??= []).push(ref);
  });
  selectReference(ref.id);
  S().showToast(`Added reference "${ref.name}" — only shown in the editor`);
  return ref.id;
}

/** Swap a reference's picture, keeping its place (height follows the new aspect ratio) */
export async function replaceReferenceImage(id: string, file: Blob) {
  const img = await readImageFile(file).catch(() => null);
  if (!img) return S().showToast("Couldn't read that image");
  const imageId = putRefImage(img.dataUrl);
  S().update((d) => {
    const r = d.references?.find((x) => x.id === id);
    if (!r) return;
    Object.assign(r, { imageId, natW: img.w, natH: img.h, h: Math.round((r.w * img.h) / img.w) });
  });
}

export function updateReference(id: string, patch: Partial<RefImage>, coalesce?: string) {
  S().update(
    (d) => {
      const r = d.references?.find((x) => x.id === id);
      if (r) Object.assign(r, patch);
    },
    coalesce ? { coalesce: coalesce + id } : undefined,
  );
}

export function removeReference(id: string) {
  S().update((d) => {
    d.references = d.references?.filter((r) => r.id !== id);
  });
  if (S().refSelection === id) useStore.setState({ refSelection: null });
}

/** contain: whole image on the screen · cover: fill the screen · natural: 1 image pixel = 1 screen pixel */
export function fitReference(id: string, mode: 'contain' | 'cover' | 'natural') {
  const r = getReference(id);
  if (!r) return;
  if (mode === 'natural') updateReference(id, { w: r.natW, h: r.natH, x: Math.round(r.x + (r.w - r.natW) / 2), y: Math.round(r.y + (r.h - r.natH) / 2) });
  else updateReference(id, screenRect(r.natW, r.natH, mode));
}

/** Topmost visible, unlocked reference under a canvas point */
export function referenceAt(x: number, y: number): string | null {
  const list = references().filter((r) => !r.hidden && !r.locked && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
  const over = list.filter((r) => r.placement === 'over');
  const pick = (over.length ? over : list).at(-1);
  return pick?.id ?? null;
}

export function toggleAllReferences() {
  const list = references();
  if (!list.length) return;
  const show = list.every((r) => r.hidden);
  S().update((d) => d.references?.forEach((r) => void (r.hidden = !show)));
  S().showToast(show ? 'References shown' : 'References hidden');
}

/** Open a file picker and add the chosen images */
export function pickReferenceImages() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.onchange = async () => {
    for (const f of Array.from(input.files ?? [])) await addReference(f);
  };
  input.click();
}
