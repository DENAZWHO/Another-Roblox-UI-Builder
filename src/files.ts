import { useStore } from './store';
import { isRoot } from './model/schema';
import { deserialize, emptyDoc, insertFragment, serialize } from './model/doc';
import { parseRobloxFile } from './export/rbxmx';
import { insertionParent, batch } from './actions';
import type { Doc } from './model/types';
import { loadRefImages, pruneRefImages, putRefImage, refImageSrc } from './model/refImages';

const AUTOSAVE_KEY = 'rbx-ui-builder:doc:v1';

export function download(filename: string, text: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

function validDoc(d: any): d is Doc {
  return d && typeof d === 'object' && d.nodes && Array.isArray(d.rootIds) && d.device && Array.isArray(d.clips);
}

export function projectName() {
  const { doc } = useStore.getState();
  return doc.nodes[doc.rootIds[0]]?.name ?? 'ui';
}

/** Project file: the document plus the pictures of its reference images */
export function projectJson(doc: Doc): string {
  const refImages: Record<string, string> = {};
  for (const r of doc.references ?? []) {
    const src = refImageSrc(r.imageId);
    if (src) refImages[r.imageId] = src;
  }
  return serialize({ app: 'roblox-ui-builder', version: 1, doc, ...(Object.keys(refImages).length ? { refImages } : {}) });
}

export function saveProject() {
  const { doc } = useStore.getState();
  download(`${projectName()}.uibuilder.json`, projectJson(doc), 'application/json');
}

export async function openProject() {
  const f = await pickFile('.json,application/json');
  if (!f) return;
  try {
    const data = deserialize<any>(await f.text());
    const doc = data.doc ?? data;
    if (!validDoc(doc)) throw new Error('not a UI Builder project');
    for (const [id, src] of Object.entries((data.refImages ?? {}) as Record<string, string>)) putRefImage(src, id);
    useStore.getState().loadDoc(doc);
    useStore.getState().showToast(`Opened ${f.name}`);
  } catch (e) {
    useStore.getState().showToast(`Could not open file: ${(e as Error).message}`);
  }
}

export function newDocument() {
  if (!confirm('Start a new, empty document? Unsaved changes will be lost.')) return;
  useStore.getState().loadDoc(emptyDoc());
}

/** Roblox files the importer reads */
export const ROBLOX_FILE = /\.(rbxm|rbxmx|rbxl|rbxlx)$/i;

export async function importRbxmx() {
  const f = await pickFile('.rbxm,.rbxmx,.rbxl,.rbxlx,.xml');
  if (f) await importRobloxFile(f);
}

/** Import the GUIs from a .rbxm / .rbxmx model or a .rbxl / .rbxlx place */
export async function importRobloxFile(f: File) {
  try {
    const { fragment, skipped } = parseRobloxFile(new Uint8Array(await f.arrayBuffer()), f.name);
    if (!fragment.rootIds.length) throw new Error(/\.rbxlx?$/i.test(f.name) ? 'no ScreenGui, BillboardGui or SurfaceGui in this place' : 'no supported GUI instances found');
    const screens = fragment.rootIds.filter((r) => isRoot(fragment.nodes.find((n) => n.id === r)?.className));
    const others = fragment.rootIds.filter((r) => !screens.includes(r));
    const created: string[] = [];
    batch(() => {
      if (screens.length) {
        useStore.getState().update((d) => {
          created.push(...insertFragment(d as Doc, { nodes: fragment.nodes, rootIds: screens }, null));
        });
      }
      if (others.length) {
        const parent = insertionParent();
        useStore.getState().update((d) => {
          created.push(...insertFragment(d as Doc, { nodes: fragment.nodes, rootIds: others }, parent));
        });
      }
    });
    useStore.getState().select(created);
    const guis = fragment.rootIds.length;
    useStore.getState().showToast(`Imported ${guis} GUI${guis === 1 ? '' : 's'} from ${f.name}${skipped.length ? ` (skipped: ${skipped.join(', ')})` : ''}`);
  } catch (e) {
    useStore.getState().showToast(`Import failed: ${(e as Error).message}`);
  }
}

export function loadAutosave(): Doc | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const d = deserialize<Doc>(raw);
    return validDoc(d) ? d : null;
  } catch {
    return null;
  }
}

export function startAutosave() {
  let timer: number | undefined;
  let last = useStore.getState().doc;
  return useStore.subscribe((s) => {
    if (s.doc === last) return;
    last = s.doc;
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      try {
        localStorage.setItem(AUTOSAVE_KEY, serialize(useStore.getState().doc));
      } catch {
        /* storage full or unavailable (large preview images) */
      }
    }, 500);
  });
}

/** Load reference pictures as documents need them; forget ones nothing uses (once, at startup) */
export function startRefImages() {
  const ids = (d: Doc) => (d.references ?? []).map((r) => r.imageId);
  const initial = useStore.getState().doc;
  loadRefImages(ids(initial));
  pruneRefImages(new Set(ids(initial)));
  return useStore.subscribe((s, prev) => {
    if (s.doc.references !== prev.doc.references) loadRefImages(ids(s.doc));
  });
}
