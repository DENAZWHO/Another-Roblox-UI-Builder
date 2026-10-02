import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useStore } from '../store';
import { computeLayout, type LayoutResult } from '../model/layout';
import { createNode, insertFragment, pathTo, unionRect, type Fragment } from '../model/doc';
import { CONTAINER_CLASSES, SINGLETON_MODIFIERS, defaultProps, isRoot, isWorldGui, modifierAllowed } from '../model/schema';
import { applyPixelScale, pixelScaleFactor } from '../model/pixelScale';
import type { ClassName, Doc, GuiNode, ModifierClass } from '../model/types';
import { effectiveNodes, layoutNow, stackDropIndex, stackLayout, stackOrder } from '../actions';
import { ScreenView, type RenderCtx } from './render';
import { useFontEpoch } from './hooks';
import { ClassIcon } from './icons';
import { rootOrigins, screenBox, screenOfRoot } from '../model/screens';

// ---------------------------------------------------------------------------
// What's being dragged from the Insert panel (element, component or prefab)

interface FragmentPayload {
  label: string;
  fragment: Fragment;
  modifier?: undefined;
}
interface ModifierPayload {
  label: string;
  modifier: ModifierClass;
  fragment?: undefined;
}
type DragPayload = FragmentPayload | ModifierPayload;

let current: DragPayload | null = null;
const listeners = new Set<() => void>();
const setCurrent = (p: DragPayload | null) => {
  current = p;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

// a blank drag image, so only our live preview follows the mouse
const BLANK = new Image();
BLANK.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** Call from onDragStart of an Insert panel item: shows a live preview of `build()` while dragging */
export function startDragPreview(e: React.DragEvent, label: string, build: () => Fragment) {
  try {
    setCurrent({ label, fragment: build() });
    e.dataTransfer.setDragImage(BLANK, 0, 0);
  } catch {
    setCurrent(null);
  }
}

/** Call from onDragStart of a modifier in the Insert panel: highlights the element it would go on */
export function startModifierDrag(e: React.DragEvent, cls: ModifierClass) {
  setCurrent({ label: cls, modifier: cls });
  try {
    e.dataTransfer.setDragImage(BLANK, 0, 0);
  } catch {
    /* keep the default drag image */
  }
}

/**
 * The element a modifier dropped on the canvas goes on: the deepest one under the pointer that can have it.
 * When none can, the element under the pointer (so the drop can say why it can't go there).
 */
export function canvasModifierTarget(clientX: number, clientY: number, cls: ModifierClass): string | null {
  const s = useStore.getState();
  const el = (document.elementFromPoint(clientX, clientY) as HTMLElement | null)?.closest('[data-nid]') as HTMLElement | null;
  const path = el ? pathTo(s.doc.nodes, el.dataset.nid!) : [];
  for (let i = path.length - 1; i >= 0; i--) {
    const n = s.doc.nodes[path[i]];
    if (n && !n.locked && modifierAllowed(cls, n.className)) return n.id;
  }
  return path[path.length - 1] ?? null;
}

/** Why a modifier can't go on an element, or null when it can */
export function modifierProblem(cls: ModifierClass, n: GuiNode, nodes: Record<string, GuiNode>): string | null {
  if (!modifierAllowed(cls, n.className)) return cls === 'UITextSizeConstraint' ? `${cls} only goes on text (${n.name} is a ${n.className})` : `${cls} can't go on a ${n.className}`;
  if (SINGLETON_MODIFIERS.includes(cls) && n.children.some((c) => nodes[c]?.className === cls)) return `${n.name} already has a ${cls}`;
  return null;
}

/** A single new element, as `insertNode` would create it */
export const elementFragment = (cls: ClassName): Fragment => {
  const n = createNode(cls);
  return { nodes: [n], rootIds: [n.id] };
};

/** The frame something dropped on the canvas goes into: the deepest frame under the pointer, skipping full-screen backdrops */
export function canvasDropParent(clientX: number, clientY: number, lay: LayoutResult = layoutNow()): string {
  const s = useStore.getState();
  const el = (document.elementFromPoint(clientX, clientY) as HTMLElement | null)?.closest('[data-nid]') as HTMLElement | null;
  const path = el ? pathTo(s.doc.nodes, el.dataset.nid!) : [];
  let parentId = path[0] ?? s.doc.rootIds[0];
  const screen = lay.rects[path[0]];
  for (const id of path) {
    const r = lay.rects[id];
    const backdrop = screen && r && r.w * r.h >= 0.6 * screen.w * screen.h;
    if (CONTAINER_CLASSES.includes(s.doc.nodes[id].className) && !s.doc.nodes[id].locked && !backdrop) parentId = id;
  }
  return parentId;
}

/** Lay a fragment out inside a stand-in ScreenGui of the given size (pixel-scaled like the document) */
function layoutFragment(fragment: Fragment, w: number, h: number, f: number) {
  const rootId = '__drag_root__';
  let nodes: Record<string, GuiNode> = {
    [rootId]: { id: rootId, className: 'ScreenGui', name: '', parentId: null, children: [...fragment.rootIds], props: { ...defaultProps('ScreenGui'), IgnoreGuiInset: true, Enabled: true } },
  };
  for (const n of fragment.nodes) nodes[n.id] = fragment.rootIds.includes(n.id) ? { ...n, parentId: rootId } : n;
  nodes = applyPixelScale(nodes, [rootId], f);
  const layout = computeLayout(nodes, [rootId], { name: 'drag', w: Math.max(1, w), h: Math.max(1, h) });
  const rects = fragment.rootIds.map((id) => layout.rects[id]).filter(Boolean);
  const bounds = rects.length ? unionRect(rects) : { x: 0, y: 0, w: 1, h: 1 };
  bounds.w = Math.max(1, bounds.w);
  bounds.h = Math.max(1, bounds.h);
  return { rootId, nodes, layout, bounds };
}

/** The document as it would be with the fragment slotted into a stack (UIListLayout / UIGridLayout) at `slot` */
function simulateStackDrop(fragment: Fragment, parentId: string, slot: number) {
  const doc = useStore.getState().doc;
  const base = effectiveNodes(doc);
  const sim: Doc = { ...doc, nodes: { ...base, [parentId]: { ...base[parentId], children: [...base[parentId].children] } }, rootIds: [...doc.rootIds] };
  const roots = insertFragment(sim, fragment, parentId);
  // same as reorderInStack after the drop
  const order = stackOrder(parentId);
  order.splice(Math.max(0, Math.min(slot, order.length)), 0, ...roots);
  order.forEach((id, i) => (sim.nodes[id] = { ...sim.nodes[id], props: { ...sim.nodes[id].props, LayoutOrder: i + 1 } }));
  const stack = stackLayout(parentId);
  if (stack && stack.props.SortOrder !== 'LayoutOrder') sim.nodes[stack.id] = { ...stack, props: { ...stack.props, SortOrder: 'LayoutOrder' } };
  const nodes = applyPixelScale(sim.nodes, doc.rootIds, pixelScaleFactor(doc));
  const layout = computeLayout(nodes, doc.rootIds, doc.device, rootOrigins(doc));
  const rects = roots.map((id) => layout.rects[id]).filter(Boolean);
  return { nodes, layout, rootId: pathTo(nodes, parentId)[0], bounds: rects.length ? unionRect(rects) : null };
}

const CHIP_W = 140;
const CHIP_H = 90;

/** Follows the mouse while dragging from the Insert panel: real size over the canvas, a thumbnail elsewhere */
export function DragPreview() {
  const payload = useSyncExternalStore(subscribe, () => current);
  const [pt, setPt] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!payload) return;
    const move = (e: DragEvent) => setPt((p) => (p && p.x === e.clientX && p.y === e.clientY ? p : { x: e.clientX, y: e.clientY }));
    const end = () => {
      setCurrent(null);
      setPt(null);
    };
    window.addEventListener('dragover', move, true);
    window.addEventListener('drop', end, true);
    window.addEventListener('dragend', end, true);
    return () => {
      window.removeEventListener('dragover', move, true);
      window.removeEventListener('drop', end, true);
      window.removeEventListener('dragend', end, true);
    };
  }, [payload]);

  if (!payload || !pt) return null;
  return payload.modifier ? <ModifierPreviewAt cls={payload.modifier} pt={pt} /> : <PreviewAt payload={payload} pt={pt} />;
}

/** Dragging a modifier: outline the element it would be added to */
function ModifierPreviewAt({ cls, pt }: { cls: ModifierClass; pt: { x: number; y: number } }) {
  const doc = useStore((s) => s.doc);
  const zoom = useStore((s) => s.zoom);
  const pan = useStore((s) => s.pan);
  const docLayout = useMemo(() => layoutNow(), [doc]);
  const wrapEl = document.querySelector('.canvas-wrap') as HTMLElement | null;
  const under = document.elementFromPoint(pt.x, pt.y);
  const overCanvas = !!wrapEl && !!under && wrapEl.contains(under);
  const targetId = overCanvas ? canvasModifierTarget(pt.x, pt.y, cls) : null;
  const r = targetId ? (isRoot(doc.nodes[targetId].className) && !isWorldGui(doc.nodes[targetId].className) ? screenBox(doc, screenOfRoot(doc, targetId).id) : docLayout.rects[targetId]) : null;
  const problem = targetId ? modifierProblem(cls, doc.nodes[targetId], doc.nodes) : null;
  if (overCanvas && wrapEl) {
    const b = wrapEl.getBoundingClientRect();
    return (
      <div className="drag-preview-layer" style={{ left: b.left, top: b.top, width: b.width, height: b.height }}>
        {r && (
          <div className={`drop-target ${problem ? 'blocked' : ''}`} style={{ position: 'absolute', left: pan.x + r.x * zoom, top: pan.y + r.y * zoom, width: r.w * zoom, height: r.h * zoom }}>
            <span>{problem ?? `Add ${cls} to ${doc.nodes[targetId!].name}`}</span>
          </div>
        )}
        <div className="drag-chip mod" style={{ position: 'fixed', left: pt.x + 14, top: pt.y + 14 }}>
          <span className="drag-chip-row"><ClassIcon cls={cls} size={14} /> {cls}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="drag-chip mod" style={{ left: pt.x + 14, top: pt.y + 14 }}>
      <span className="drag-chip-row"><ClassIcon cls={cls} size={14} /> {cls}</span>
    </div>
  );
}

function PreviewAt({ payload, pt }: { payload: FragmentPayload; pt: { x: number; y: number } }) {
  const doc = useStore((s) => s.doc);
  const zoom = useStore((s) => s.zoom);
  const pan = useStore((s) => s.pan);
  const epoch = useFontEpoch();
  const f = pixelScaleFactor(doc);
  // the document doesn't change during a drag: lay it out once
  const docLayout = useMemo(() => layoutNow(), [doc]);

  const wrapEl = document.querySelector('.canvas-wrap') as HTMLElement | null;
  const under = document.elementFromPoint(pt.x, pt.y);
  const overCanvas = !!wrapEl && !!under && wrapEl.contains(under);
  const parentId = overCanvas ? canvasDropParent(pt.x, pt.y, docLayout) : null;
  const target = parentId ? (docLayout.content[parentId] ?? docLayout.rects[parentId]) : null;

  // over the canvas: laid out in the frame it would land in; elsewhere: at the design size
  const w = target?.w ?? doc.device.w;
  const h = target?.h ?? doc.device.h;
  const view = useMemo(() => layoutFragment(payload.fragment, w, h, f), [payload, w, h, f, epoch]);
  const ctx: RenderCtx = { nodes: view.nodes, layout: view.layout, interactive: false, previewUser: doc.previewUser, pixelScale: f };
  const u = view.bounds;

  const b = wrapEl?.getBoundingClientRect();
  const wx = b ? (pt.x - b.left - pan.x) / zoom : 0;
  const wy = b ? (pt.y - b.top - pan.y) / zoom : 0;
  // over a stack: the siblings make room where it would slot in
  const slot = parentId && stackLayout(parentId) ? stackDropIndex(parentId, { x: wx, y: wy }, docLayout) : null;
  const sim = useMemo(
    () => (parentId && slot !== null ? simulateStackDrop(payload.fragment, parentId, slot) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [payload, parentId, slot, doc, epoch],
  );
  // the simulated screen replaces the real one while it's shown (kept hit-testable for finding the drop frame)
  const hideId = sim?.rootId;
  useEffect(() => {
    const el = hideId ? (document.querySelector(`.canvas-wrap .rb-screen[data-nid="${hideId}"]`) as HTMLElement | null) : null;
    if (!el) return;
    const prev = el.style.opacity;
    el.style.opacity = '0';
    return () => void (el.style.opacity = prev);
  }, [hideId]);

  if (overCanvas && wrapEl && b && parentId && target) {
    const frame = docLayout.rects[parentId];
    const label = frame && (
      <div className="drop-target" style={{ position: 'absolute', left: pan.x + frame.x * zoom, top: pan.y + frame.y * zoom, width: frame.w * zoom, height: frame.h * zoom }}>
        <span>Insert into {doc.nodes[parentId]?.name}</span>
      </div>
    );
    if (sim?.rootId && sim.bounds) {
      const s = sim.bounds;
      return (
        <div className="drag-preview-layer" style={{ left: b.left, top: b.top, width: b.width, height: b.height }}>
          <div className="drag-preview sim" style={{ left: pan.x, top: pan.y, transform: `scale(${zoom})` }}>
            <ScreenView id={sim.rootId} ctx={{ nodes: sim.nodes, layout: sim.layout, interactive: false, previewUser: doc.previewUser, pixelScale: f }} />
          </div>
          {label}
          <div className="drag-preview-outline" style={{ left: pan.x + s.x * zoom, top: pan.y + s.y * zoom, width: s.w * zoom, height: s.h * zoom }} />
        </div>
      );
    }
    // same placement as the drop: the union of the new elements centred on the pointer
    const ox = Math.round(wx - u.w / 2) - u.x;
    const oy = Math.round(wy - u.h / 2) - u.y;
    return (
      <div className="drag-preview-layer" style={{ left: b.left, top: b.top, width: b.width, height: b.height }}>
        {label}
        <div className="drag-preview" style={{ left: pan.x + ox * zoom, top: pan.y + oy * zoom, width: w, height: h, transform: `scale(${zoom})` }}>
          <ScreenView id={view.rootId} ctx={ctx} />
        </div>
        <div className="drag-preview-outline" style={{ left: pan.x + (ox + u.x) * zoom, top: pan.y + (oy + u.y) * zoom, width: u.w * zoom, height: u.h * zoom }} />
      </div>
    );
  }

  // a thumbnail card next to the cursor (over the panels)
  const k = Math.min(CHIP_W / u.w, CHIP_H / u.h, 1);
  return (
    <div className="drag-chip" style={{ left: pt.x + 14, top: pt.y + 14 }}>
      <div className="drag-chip-thumb" style={{ width: Math.max(40, u.w * k), height: Math.max(24, u.h * k) }}>
        <div style={{ position: 'absolute', width: w, height: h, left: -u.x * k, top: -u.y * k, transform: `scale(${k})`, transformOrigin: '0 0' }}>
          <ScreenView id={view.rootId} ctx={ctx} />
        </div>
      </div>
      <span>{payload.label}</span>
    </div>
  );
}
