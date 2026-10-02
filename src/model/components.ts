// Linked components (like Figma): a main component and instances that follow it.
//  - main: any GUI element marked `component`
//  - instance: a copy whose root has `instanceOf` = main id; every node in it has `src` = the main node it mirrors
//  - editing an instance records overrides (per node, per property) that later syncs keep
//  - after every edit, instances are brought in line with their main (props, children, order)
import { current, isDraft, produce, type Draft } from 'immer';
import { uid } from './doc';
import type { Doc, GuiNode } from './types';

/** An instance root always keeps its own placement */
export const INSTANCE_LOCAL = new Set(['Position', 'AnchorPoint', 'LayoutOrder', 'ZIndex', 'Rotation']);

const same = (a: any, b: any): boolean => {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => same(a[k], b[k]));
};

const subtree = (nodes: Record<string, GuiNode>, id: string): string[] => {
  const out: string[] = [];
  const walk = (i: string) => {
    if (!nodes[i]) return;
    out.push(i);
    nodes[i].children.forEach(walk);
  };
  walk(id);
  return out;
};

export const isMain = (n?: GuiNode) => !!n?.component;
export const instancesOf = (doc: Doc, mainId: string) => Object.values(doc.nodes).filter((n) => n.instanceOf === mainId);
/** The instance root a node belongs to (itself, or an ancestor) */
export function instanceRootOf(doc: Doc, id: string): GuiNode | undefined {
  for (let cur: string | null = id; cur; cur = doc.nodes[cur]?.parentId ?? null) if (doc.nodes[cur]?.instanceOf) return doc.nodes[cur];
  return undefined;
}

/**
 * Runs after every document edit (inside the same undo step):
 * 1. property edits inside instances become overrides;
 * 2. instances whose main is gone are detached;
 * 3. every instance is synced with its main.
 */
export function finalizeComponents(prev: Doc, next: Doc): Doc {
  if (prev === next) return next;
  const roots = Object.values(next.nodes).filter((n) => n.instanceOf);
  if (!roots.length) return next;
  return produce(next, (d) => {
    for (const root of roots) {
      const r = d.nodes[root.id];
      if (!r) continue;
      const main = d.nodes[r.instanceOf!];
      // 2. main deleted (or no longer a component): the instance becomes a plain copy
      if (!main || !main.component) {
        for (const id of subtree(d.nodes as Record<string, GuiNode>, r.id)) {
          const n = d.nodes[id];
          delete n.instanceOf;
          delete n.src;
          delete n.overrides;
        }
        continue;
      }
      // 1. edits since the last state, on nodes of this instance, are overrides
      for (const id of subtree(next.nodes, r.id)) {
        const before = prev.nodes[id];
        const now = next.nodes[id];
        if (!before || before === now || before.props === now.props || !now.src) continue;
        for (const k of new Set([...Object.keys(before.props), ...Object.keys(now.props)])) {
          if (id === r.id && INSTANCE_LOCAL.has(k)) continue;
          if (!same(before.props[k], now.props[k])) {
            const n = d.nodes[id];
            if (!n.overrides?.includes(k)) n.overrides = [...(n.overrides ?? []), k];
          }
        }
      }
      // 3. follow the main
      syncNode(d, r.id, main.id, true);
    }
  });
}

/** Make instance node `id` mirror main node `mainId` (keeping overrides), children included */
/** A plain (non-draft) snapshot, safe to clone */
const plain = <T,>(x: T): T => (isDraft(x) ? (current(x as any) as T) : x);

function syncNode(d: Draft<Doc>, id: string, mainId: string, isRoot: boolean) {
  const n = d.nodes[id];
  if (!n || !d.nodes[mainId]) return;
  const m = plain(d.nodes[mainId]) as GuiNode;
  n.src = mainId;
  if (!isRoot && n.name !== m.name) n.name = m.name;
  const keep = new Set(n.overrides ?? []);
  for (const k of Object.keys(m.props)) {
    if ((isRoot && INSTANCE_LOCAL.has(k)) || keep.has(k)) continue;
    if (!same(n.props[k], m.props[k])) n.props[k] = structuredClone(m.props[k]);
  }
  // style links follow the main's, except for properties this instance overrides
  const refs: Record<string, string> = {};
  for (const [k, v] of Object.entries(m.styleRefs ?? {})) if (!keep.has(k) && !(isRoot && INSTANCE_LOCAL.has(k))) refs[k] = v;
  for (const [k, v] of Object.entries(n.styleRefs ?? {})) if (keep.has(k)) refs[k] = v;
  if (!same(refs, n.styleRefs ?? {})) {
    if (Object.keys(refs).length) n.styleRefs = refs;
    else delete n.styleRefs;
  }
  // behaviour that isn't per-property follows the main too (unless it's the instance root's own)
  for (const k of ['effects', 'avatar', 'bind', 'textColors', 'points', 'preview'] as const) {
    if (!same((n as any)[k], (m as any)[k])) (n as any)[k] = structuredClone((m as any)[k]);
  }
  // children: in the main's order; missing ones are copied in; ones the main no longer has are removed;
  // children added to the instance itself (no src) stay at the end
  const bySrc = new Map<string, string>();
  for (const c of n.children) if (d.nodes[c]?.src) bySrc.set(d.nodes[c].src!, c);
  const order: string[] = [];
  for (const mc of m.children) {
    let c = bySrc.get(mc);
    if (!c) c = copyIn(d, mc, id);
    else bySrc.delete(mc);
    order.push(c);
    syncNode(d, c, mc, false);
  }
  for (const gone of bySrc.values()) removeTree(d, gone);
  const extras = n.children.filter((c) => d.nodes[c] && !d.nodes[c].src);
  const children = [...order, ...extras];
  if (!same(children, n.children)) n.children = children;
}

/** Copy a main subtree into an instance (fresh ids, src set) */
function copyIn(d: Draft<Doc>, mainId: string, parentId: string): string {
  const m = plain(d.nodes[mainId]) as GuiNode;
  const id = uid();
  const copy: GuiNode = { ...structuredClone(m), id, parentId, children: [], src: mainId };
  delete copy.component;
  delete copy.instanceOf;
  delete copy.overrides;
  d.nodes[id] = copy as Draft<GuiNode>;
  for (const mc of m.children) d.nodes[id].children.push(copyIn(d, mc, id));
  return id;
}

function removeTree(d: Draft<Doc>, id: string) {
  const n = d.nodes[id];
  if (!n) return;
  for (const c of [...n.children]) removeTree(d, c);
  delete d.nodes[id];
}
