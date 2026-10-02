// Saved projects: every design lives in IndexedDB, the open one is saved as you work.
// The localStorage autosave (files.ts) still holds the open document for a fast start.
import { useSyncExternalStore } from 'react';
import { useStore } from './store';
import { idb } from './model/idb';
import { deserialize, emptyDoc, serialize, uid } from './model/doc';
import { pruneRefImages, refImageData } from './model/refImages';
import type { Doc } from './model/types';
import { download } from './files';
import { zoomToFit } from './ui/viewport';

interface ProjectRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** serialized Doc */
  doc: string;
}

export interface ProjectInfo {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  doc: Doc;
}

const CURRENT_KEY = 'rbx-ui-builder:project';
const SAVE_DELAY = 800;

const getRecord = (id: string) => idb<ProjectRecord | undefined>('projects', 'readonly', (s) => s.get(id));
const putRecord = (r: ProjectRecord) => idb('projects', 'readwrite', (s) => s.put(r, r.id));
const allRecords = () => idb<ProjectRecord[]>('projects', 'readonly', (s) => s.getAll());

// ---------------------------------------------------------------------------
// the list (for the Projects window)

let list: ProjectInfo[] = [];
let loaded = false;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

export function useProjects(): { projects: ProjectInfo[]; loaded: boolean } {
  const projects = useSyncExternalStore(subscribe, () => list);
  return { projects, loaded };
}

function parse(r: ProjectRecord): ProjectInfo | null {
  try {
    return { id: r.id, name: r.name, createdAt: r.createdAt, updatedAt: r.updatedAt, doc: deserialize<Doc>(r.doc) };
  } catch {
    return null;
  }
}

export async function refreshProjects() {
  try {
    const records = await allRecords();
    list = records
      .map(parse)
      .filter((p): p is ProjectInfo => !!p)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    list = [];
  }
  loaded = true;
  listeners.forEach((l) => l());
}

// ---------------------------------------------------------------------------
// saving the open project

const S = () => useStore.getState();
let dirty = false;
let timer: number | undefined;
/** Loading another project: not an edit */
let quiet = false;

function remember(p: { id: string; name: string; createdAt: number } | null) {
  useStore.setState({ project: p });
  try {
    if (p) localStorage.setItem(CURRENT_KEY, p.id);
    else localStorage.removeItem(CURRENT_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** Write the open project now (if anything changed) */
export async function flushProject() {
  clearTimeout(timer);
  const p = S().project;
  if (!p || !dirty) return;
  dirty = false;
  try {
    await putRecord({ id: p.id, name: p.name, createdAt: p.createdAt, updatedAt: Date.now(), doc: serialize(S().doc) });
  } catch {
    dirty = true;
  }
}

function scheduleSave() {
  dirty = true;
  clearTimeout(timer);
  timer = window.setTimeout(() => flushProject().then(refreshProjects), SAVE_DELAY);
}

/** The name a new project gets from its document */
function nameFromDoc(doc: Doc, fallback = 'Untitled'): string {
  const first = doc.nodes[doc.rootIds[0]]?.name;
  return first && first !== 'ScreenGui' ? first : fallback;
}

/** Show a document in the editor */
function show(doc: Doc) {
  quiet = true;
  S().loadDoc(doc);
  quiet = false;
  requestAnimationFrame(() => zoomToFit());
}

// ---------------------------------------------------------------------------
// actions

/** Make a project (an empty one by default) and open it */
export async function createProject(doc: Doc = emptyDoc(), name?: string): Promise<string> {
  await flushProject();
  const now = Date.now();
  const rec: ProjectRecord = { id: uid(), name: name ?? uniqueName(nameFromDoc(doc)), createdAt: now, updatedAt: now, doc: serialize(doc) };
  try {
    await putRecord(rec);
  } catch {
    S().showToast('Could not save the project (browser storage unavailable)');
  }
  show(doc);
  remember({ id: rec.id, name: rec.name, createdAt: rec.createdAt });
  dirty = false;
  await refreshProjects();
  return rec.id;
}

export async function openProjectById(id: string) {
  if (S().project?.id === id) return;
  await flushProject();
  const rec = await getRecord(id);
  const p = rec && parse(rec);
  if (!p) {
    S().showToast('Could not open that project');
    return;
  }
  show(p.doc);
  remember({ id: p.id, name: p.name, createdAt: p.createdAt });
  dirty = false;
}

export async function renameProject(id: string, name: string) {
  name = name.trim();
  if (!name) return;
  const cur = S().project;
  if (cur?.id === id) {
    remember({ ...cur, name });
    dirty = true;
    await flushProject();
  } else {
    const rec = await getRecord(id);
    if (rec) await putRecord({ ...rec, name });
  }
  await refreshProjects();
}

export async function duplicateProject(id: string) {
  if (S().project?.id === id) await flushProject();
  const rec = await getRecord(id);
  if (!rec) return;
  const now = Date.now();
  await putRecord({ ...rec, id: uid(), name: uniqueName(`${rec.name} copy`), createdAt: now, updatedAt: now });
  await refreshProjects();
}

export async function deleteProject(id: string) {
  await idb('projects', 'readwrite', (s) => s.delete(id));
  if (S().project?.id === id) {
    dirty = false;
    clearTimeout(timer);
    await refreshProjects();
    const next = list[0];
    if (next) {
      remember(null);
      await openProjectById(next.id);
    } else await createProject();
  }
  await refreshProjects();
}

/** Download a project as a .uibuilder.json file (with its reference images) */
export async function exportProject(id: string) {
  const open = S().project?.id === id;
  const p = open ? { name: S().project!.name, doc: S().doc } : list.find((x) => x.id === id);
  if (!p) return;
  const refImages: Record<string, string> = {};
  for (const r of p.doc.references ?? []) {
    const src = await refImageData(r.imageId);
    if (src) refImages[r.imageId] = src;
  }
  const json = serialize({ app: 'roblox-ui-builder', version: 1, doc: p.doc, ...(Object.keys(refImages).length ? { refImages } : {}) });
  download(`${p.name.replace(/[\\/:*?"<>|]/g, '_')}.uibuilder.json`, json, 'application/json');
}

/** "Name", or "Name 2", "Name 3"… when taken */
function uniqueName(base: string): string {
  const taken = new Set(list.map((p) => p.name));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

// ---------------------------------------------------------------------------
// startup

/**
 * Find (or make) the open project, then save it as it changes.
 * `fromAutosave`: the editor started with the autosaved document (otherwise the project's saved copy is loaded).
 */
export async function startProjects(fromAutosave: boolean) {
  let currentId: string | null = null;
  try {
    currentId = localStorage.getItem(CURRENT_KEY);
  } catch {
    /* storage unavailable */
  }
  try {
    await refreshProjects();
    const rec = currentId ? await getRecord(currentId) : undefined;
    if (rec) {
      remember({ id: rec.id, name: rec.name, createdAt: rec.createdAt });
      if (!fromAutosave) {
        const p = parse(rec);
        if (p) show(p.doc);
      }
    } else {
      // first run with projects: the current work becomes the first project
      const doc = S().doc;
      const now = Date.now();
      const created: ProjectRecord = { id: uid(), name: uniqueName(nameFromDoc(doc, 'My first project')), createdAt: now, updatedAt: now, doc: serialize(doc) };
      await putRecord(created);
      remember({ id: created.id, name: created.name, createdAt: now });
      await refreshProjects();
    }
  } catch {
    // IndexedDB unavailable: the editor keeps working on the autosaved document only
    loaded = true;
    listeners.forEach((l) => l());
    return;
  }

  // reference pictures no project uses any more
  const keep = new Set<string>();
  for (const p of list) for (const r of p.doc.references ?? []) keep.add(r.imageId);
  for (const r of S().doc.references ?? []) keep.add(r.imageId);
  pruneRefImages(keep);

  useStore.subscribe((s, prev) => {
    if (s.doc !== prev.doc && s.project && !quiet) scheduleSave();
  });
  window.addEventListener('pagehide', () => void flushProject());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && void flushProject());
}
