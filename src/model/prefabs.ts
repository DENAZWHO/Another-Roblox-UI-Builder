// Custom prefabs: reusable copies of elements the user saved. Stored in the browser (shared by all
// projects) and exportable as .uiprefab.json files to share.
import { deserialize, serialize, uid, type Fragment } from './doc';

export interface Prefab {
  id: string;
  name: string;
  /** when it was saved / last updated */
  updated: number;
  /** pixel size of the whole prefab when it was saved (top-level elements are stored in offsets) */
  size: { w: number; h: number };
  fragment: Fragment;
}

const KEY = 'rbx-ui-builder:prefabs:v1';
let list: Prefab[] = load();
const listeners = new Set<() => void>();

function load(): Prefab[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? deserialize<Prefab[]>(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((p) => p?.fragment?.nodes?.length) : [];
  } catch {
    return [];
  }
}

/** Persist; returns false if the browser refused (usually storage full because of big preview images) */
function commit(next: Prefab[]): boolean {
  try {
    localStorage.setItem(KEY, serialize(next));
  } catch {
    return false;
  }
  list = next;
  listeners.forEach((l) => l());
  return true;
}

export const prefabs = () => list;
export function subscribePrefabs(cb: () => void) {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

export function addPrefab(name: string, fragment: Fragment, size: Prefab['size']): Prefab | null {
  const p: Prefab = { id: uid(), name, updated: Date.now(), size, fragment };
  return commit([p, ...list]) ? p : null;
}

export function updatePrefab(id: string, patch: Partial<Omit<Prefab, 'id'>>): boolean {
  return commit(list.map((p) => (p.id === id ? { ...p, ...patch, updated: Date.now() } : p)));
}

export function removePrefab(id: string) {
  commit(list.filter((p) => p.id !== id));
}

export function exportPrefabsText(ids?: string[]) {
  const chosen = ids ? list.filter((p) => ids.includes(p.id)) : list;
  return serialize({ app: 'roblox-ui-builder', kind: 'prefabs', version: 1, prefabs: chosen });
}

/** Add prefabs from an exported file. Returns how many were added. */
export function importPrefabsText(text: string): number {
  const data = deserialize<any>(text);
  const incoming: Prefab[] = (Array.isArray(data) ? data : data?.prefabs ?? []).filter((p: Prefab) => p?.fragment?.nodes?.length && p.name);
  if (!incoming.length) throw new Error('no prefabs in this file');
  const fresh = incoming.map((p) => ({ ...p, id: uid(), updated: Date.now() }));
  if (!commit([...fresh, ...list])) throw new Error('browser storage is full');
  return fresh.length;
}
