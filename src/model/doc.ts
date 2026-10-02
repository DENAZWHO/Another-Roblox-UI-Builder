import { defaultProps, isGuiObject } from './schema';
import type { ClassName, Doc, GuiNode, Rect, UDim, UDim2, Vec2 } from './types';

export const uid = () => Math.random().toString(36).slice(2, 10);

export type Units = 'scale' | 'offset';

export function createNode(className: ClassName, props: Record<string, any> = {}, name?: string): GuiNode {
  return {
    id: uid(),
    className,
    name: name ?? className,
    parentId: null,
    children: [],
    props: { ...defaultProps(className), ...structuredClone(props) },
  };
}

export function emptyDoc(): Doc {
  const sg = createNode('ScreenGui');
  return {
    nodes: { [sg.id]: sg },
    rootIds: [sg.id],
    device: { name: 'Desktop 1080p', w: 1920, h: 1080 },
    designSize: { w: 1920, h: 1080 },
    showTopbar: true,
    clips: [{ id: uid(), name: 'Intro', tweens: [] }],
  };
}

export function isAncestor(nodes: Record<string, GuiNode>, maybeAncestor: string, id: string): boolean {
  let cur = nodes[id]?.parentId;
  while (cur) {
    if (cur === maybeAncestor) return true;
    cur = nodes[cur]?.parentId ?? null;
  }
  return false;
}

/** Path from the ScreenGui down to the node (inclusive) */
export function pathTo(nodes: Record<string, GuiNode>, id: string): string[] {
  const out: string[] = [];
  let cur: string | null = id;
  while (cur && nodes[cur]) {
    out.unshift(cur);
    cur = nodes[cur].parentId;
  }
  return out;
}

export function rootOf(nodes: Record<string, GuiNode>, id: string): string {
  return pathTo(nodes, id)[0];
}

export function descendants(nodes: Record<string, GuiNode>, id: string): string[] {
  const out: string[] = [];
  const walk = (i: string) => {
    for (const c of nodes[i]?.children ?? []) {
      out.push(c);
      walk(c);
    }
  };
  walk(id);
  return out;
}

/** Remove ids whose ancestor is also in the list */
export function topLevelOnly(nodes: Record<string, GuiNode>, ids: string[]): string[] {
  const set = new Set(ids);
  return ids.filter((id) => !pathTo(nodes, id).slice(0, -1).some((a) => set.has(a)));
}

// ---------------------------------------------------------------------------
// Tree mutation (operate on an immer draft)

export function detach(doc: Doc, id: string) {
  const n = doc.nodes[id];
  if (n.parentId) {
    const p = doc.nodes[n.parentId];
    p.children = p.children.filter((c) => c !== id);
  } else {
    doc.rootIds = doc.rootIds.filter((r) => r !== id);
  }
  n.parentId = null;
}

export function attach(doc: Doc, id: string, parentId: string | null, index?: number) {
  const n = doc.nodes[id];
  n.parentId = parentId;
  const arr = parentId ? doc.nodes[parentId].children : doc.rootIds;
  const i = index === undefined ? arr.length : Math.max(0, Math.min(index, arr.length));
  arr.splice(i, 0, id);
}

export function removeNode(doc: Doc, id: string) {
  if (!doc.nodes[id]) return;
  const all = [id, ...descendants(doc.nodes, id)];
  detach(doc, id);
  for (const i of all) delete doc.nodes[i];
  const gone = new Set(all);
  for (const clip of doc.clips) clip.tweens = clip.tweens.filter((t) => !gone.has(t.nodeId));
}

export interface Fragment {
  nodes: GuiNode[];
  rootIds: string[];
}

/** Deep-copy subtrees into a standalone fragment (ids preserved) */
export function extractFragment(nodes: Record<string, GuiNode>, ids: string[]): Fragment {
  const out: GuiNode[] = [];
  const walk = (i: string) => {
    out.push(structuredClone(nodes[i]));
    nodes[i].children.forEach(walk);
  };
  ids.forEach(walk);
  return { nodes: out, rootIds: [...ids] };
}

/** Insert a fragment with fresh ids. Returns the new root ids. */
export function insertFragment(doc: Doc, frag: Fragment, parentId: string | null, index?: number): string[] {
  const map = new Map<string, string>();
  const byId = new Map(frag.nodes.map((n) => [n.id, n]));
  const reachable: GuiNode[] = [];
  const walk = (id: string) => {
    const n = byId.get(id);
    if (!n || map.has(id)) return;
    map.set(id, uid());
    reachable.push(n);
    n.children.forEach(walk);
  };
  frag.rootIds.forEach(walk);
  for (const n of reachable) {
    const copy: GuiNode = structuredClone(n);
    copy.id = map.get(n.id)!;
    copy.children = n.children.filter((c) => map.has(c)).map((c) => map.get(c)!);
    copy.parentId = n.parentId && map.has(n.parentId) ? map.get(n.parentId)! : null;
    // references to elements inside the copy follow the copy; references to anything else are kept
    if (copy.toast?.triggerNodeId && map.has(copy.toast.triggerNodeId)) copy.toast.triggerNodeId = map.get(copy.toast.triggerNodeId);
    if (copy.boundingUI && map.has(copy.boundingUI)) copy.boundingUI = map.get(copy.boundingUI);
    if (copy.nav) for (const k of Object.keys(copy.nav) as (keyof NonNullable<GuiNode['nav']>)[]) if (copy.nav[k] && map.has(copy.nav[k]!)) copy.nav[k] = map.get(copy.nav[k]!);
    copy.events?.forEach((h) => h.actions.forEach((a) => {
      if (a.target && map.has(a.target)) a.target = map.get(a.target);
      if (a.toastId && map.has(a.toastId)) a.toastId = map.get(a.toastId);
    }));
    doc.nodes[copy.id] = copy;
  }
  const roots = frag.rootIds.map((r) => map.get(r)!);
  roots.forEach((r, i) => attach(doc, r, parentId, index === undefined ? undefined : index + i));
  return roots;
}

// ---------------------------------------------------------------------------
// Geometry <-> UDim2

const r4 = (v: number) => Math.round(v * 10000) / 10000;

export function solveAxis(cur: UDim, target: number, len: number, units: Units, force = false): UDim {
  const curAbs = cur.s * len + cur.o;
  if (!force && Math.abs(curAbs - target) < 0.01) return cur;
  const mixed = !force && cur.s !== 0 && cur.o !== 0;
  if (units === 'scale' && len > 0) {
    if (mixed) return { s: r4((target - cur.o) / len), o: cur.o };
    return { s: r4(target / len), o: 0 };
  }
  if (mixed) return { s: cur.s, o: Math.round(target - cur.s * len) };
  return { s: 0, o: Math.round(target) };
}

/** Compute Position/Size that place a node at an absolute rect inside its parent's content rect. */
export function rectToProps(props: Record<string, any>, rect: Rect, content: Rect, units: Units, force = false): { Position: UDim2; Size: UDim2 } {
  const pos: UDim2 = props.Position;
  const size: UDim2 = props.Size;
  const a: Vec2 = props.AnchorPoint ?? { x: 0, y: 0 };
  // SizeConstraint: RelativeXX measures both Scale parts against the parent's width, RelativeYY against its height
  const sc: string = props.SizeConstraint ?? 'RelativeXY';
  const Size = {
    x: solveAxis(size.x, rect.w, sc === 'RelativeYY' ? content.h : content.w, units, force),
    y: solveAxis(size.y, rect.h, sc === 'RelativeXX' ? content.w : content.h, units, force),
  };
  const Position = {
    x: solveAxis(pos.x, rect.x + a.x * rect.w - content.x, content.w, units, force),
    y: solveAxis(pos.y, rect.y + a.y * rect.h - content.y, content.h, units, force),
  };
  return { Position, Size };
}

export function unionRect(rects: Rect[]): Rect {
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export const rectsIntersect = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export function guiChildren(nodes: Record<string, GuiNode>, id: string) {
  return (nodes[id]?.children ?? []).filter((c) => nodes[c] && isGuiObject(nodes[c].className));
}

// ---------------------------------------------------------------------------
// Serialization (Infinity-safe)

export function serialize(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (v === Infinity ? '__inf' : v === -Infinity ? '__-inf' : v));
}

export function deserialize<T>(text: string): T {
  return JSON.parse(text, (_k, v) => (v === '__inf' ? Infinity : v === '__-inf' ? -Infinity : v));
}

/** Var-name friendly identifier */
export function identifier(name: string) {
  let s = name.replace(/[^A-Za-z0-9_]/g, '');
  if (!s || /^[0-9]/.test(s)) s = '_' + s;
  return s;
}
