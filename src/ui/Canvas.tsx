import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useStore } from '../store';
import { computeLayout, type LayoutResult } from '../model/layout';
import { pathTo, rectsIntersect, topLevelOnly, unionRect } from '../model/doc';
import { CONTAINER_CLASSES, isGuiObject, isModifier, isRoot, isText, isWorldGui } from '../model/schema';
import { useEffectiveNodes, useFontEpoch } from './hooks';
import { applyPixelScale, pixelScaleFactor } from '../model/pixelScale';
import type { GuiNode, Rect } from '../model/types';
import { insertNode, moveIntoFrame, patchNodes, reorderInStack, stackOrder, placeNodes, setCornerRadius, setProp, setProps } from '../actions';
import { DeviceCutouts, ScreenView, TopbarMock, type RenderCtx } from './render';
import { RefLayer, RefSelectionBox, dragReference } from './References';
import { QuickBar } from './QuickBar';
import { PathEditor, penDown, startPathMove } from './PathTool';
import { referenceAt, selectReference } from '../references';
import { viewport, zoomAt, zoomToFit } from './viewport';
import { rootOrigins, screenBox, screenOfRoot, screenRoots, screenStartsVisible, screensOf } from '../model/screens';

type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
interface Line { x1: number; y1: number; x2: number; y2: number }

type Gesture =
  | { kind: 'pan'; sx: number; sy: number; px: number; py: number }
  | { kind: 'marquee'; x0: number; y0: number; additive: boolean; base: string[] }
  | { kind: 'move'; sx: number; sy: number; ids: string[]; rects: Record<string, Rect>; union: Rect; lay: LayoutResult; moved: boolean; targets: Rect[]; dropInto?: string | null }
  | { kind: 'resize'; handle: Handle; sx: number; sy: number; ids: string[]; rects: Record<string, Rect>; union: Rect; lay: LayoutResult; rot: number; targets: Rect[] }
  | { kind: 'rotate'; id: string; cx: number; cy: number; a0: number; r0: number }
  | { kind: 'create'; cls: GuiNode['className']; parentId: string; sx: number; sy: number; id: string | null }
  | { kind: 'radius'; id: string; corner: 'nw' | 'ne' | 'se' | 'sw'; rect: Rect; rot: number }
  | { kind: 'stack'; sx: number; sy: number; ids: string[]; parentId: string; rects: Record<string, Rect>; moved: boolean; insertAt: number | null; dropInto: string | null; ghosts: Record<string, Rect> }
  | { kind: 'artboard'; id: string; sx: number; sy: number; x0: number; y0: number; moved: boolean };

const SNAP_PX = 6;

export function Canvas() {
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  const hoverId = useStore((s) => s.hoverId);
  const tool = useStore((s) => s.tool);
  const zoom = useStore((s) => s.zoom);
  const pan = useStore((s) => s.pan);
  const mode = useStore((s) => s.mode);
  const playhead = useStore((s) => s.playhead);
  const editingTextId = useStore((s) => s.editingTextId);
  const clipArtboard = useStore((s) => s.clipArtboard);
  const epoch = useFontEpoch();

  const animated = useEffectiveNodes();
  const nodes = useMemo(() => applyPixelScale(animated, doc.rootIds, pixelScaleFactor(doc)), [animated, doc]);
  const layout = useMemo(() => computeLayout(nodes, doc.rootIds, doc.device, rootOrigins(doc)), [nodes, doc, epoch]);
  const ctx: RenderCtx = { nodes, layout, interactive: false, editingTextId, previewUser: doc.previewUser, pixelScale: pixelScaleFactor(doc) };

  const ref = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [guides, setGuides] = useState<Line[]>([]);
  // Figma-style: the frame a moved element will be dropped into (if it's a different parent)
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  // dragging stacked elements: where they follow the mouse, and where they'd slot into the stack
  const [stackGhosts, setStackGhosts] = useState<Rect[]>([]);
  const [insertLine, setInsertLine] = useState<Line | null>(null);

  /** Deepest frame (or the ScreenGui) under the pointer that isn't one of the moving elements */
  const frameUnderPointer = (clientX: number, clientY: number, moving: string[]): string | null => {
    for (const el of document.elementsFromPoint(clientX, clientY)) {
      const id = (el as HTMLElement).closest?.('[data-nid]')?.getAttribute('data-nid');
      if (!id || !nodes[id]) continue;
      const path = pathTo(nodes, id);
      if (moving.some((m) => path.includes(m))) continue;
      // walk up to the nearest frame (or root) that can hold children
      const screen = layout.rects[path[0]];
      for (let i = path.length - 1; i >= 0; i--) {
        const n = nodes[path[i]];
        if (n.locked) continue;
        if (isRoot(n.className)) return n.id;
        if (!CONTAINER_CLASSES.includes(n.className)) continue;
        // full-screen backdrops (e.g. a Background frame) aren't drop targets unless the element is already in them
        const r = layout.rects[n.id];
        const backdrop = screen && r && r.w * r.h >= 0.6 * screen.w * screen.h;
        if (backdrop && !moving.some((m) => pathTo(nodes, m).includes(n.id))) continue;
        return n.id;
      }
    }
    return null;
  };
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [space, setSpace] = useState(false);
  const [panning, setPanning] = useState(false);
  const [radiusBadge, setRadiusBadge] = useState<string | null>(null);

  const cornerRadiusPx = (id: string) => {
    const c = nodes[id]?.children.map((k) => nodes[k]).find((k) => k?.className === 'UICorner');
    const r = layout.rects[id];
    if (!c || !r) return 0;
    const m = Math.min(r.w, r.h);
    return Math.min(c.props.CornerRadius.s * m + c.props.CornerRadius.o, m / 2);
  };

  // keep viewport size for zoom helpers
  useLayoutEffect(() => {
    const el = ref.current!;
    let first = true;
    const measure = () => {
      viewport.w = el.clientWidth;
      viewport.h = el.clientHeight;
      if (first && viewport.w > 0) {
        first = false;
        zoomToFit();
      }
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  // space-to-pan
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping()) {
        e.preventDefault();
        setSpace(true);
      }
    };
    const up = (e: KeyboardEvent) => e.code === 'Space' && setSpace(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // wheel: pan, ctrl/pinch: zoom
  useEffect(() => {
    const el = ref.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = useStore.getState();
      const b = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(s.zoom * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025) * (e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 50 ? 4 : 1)), e.clientX - b.left, e.clientY - b.top);
      } else {
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
        const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
        useStore.setState({ pan: { x: s.pan.x - dx, y: s.pan.y - dy } });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const toWorld = (cx: number, cy: number) => {
    const b = ref.current!.getBoundingClientRect();
    const { pan: p, zoom: z } = useStore.getState();
    return { x: (cx - b.left - p.x) / z, y: (cy - b.top - p.y) / z };
  };
  const toScreen = (r: Rect): Rect => ({ x: pan.x + r.x * zoom, y: pan.y + r.y * zoom, w: r.w * zoom, h: r.h * zoom });

  // ---- hit testing -------------------------------------------------------
  const hitPath = (target: EventTarget | null): string[] => {
    const el = (target as HTMLElement | null)?.closest?.('[data-nid]') as HTMLElement | null;
    if (!el) return [];
    const full = pathTo(nodes, el.dataset.nid!);
    const lockedAt = full.findIndex((id) => nodes[id]?.locked);
    return lockedAt >= 0 ? full.slice(0, lockedAt) : full;
  };

  /** Figma-style: click selects at the depth of the current selection; ctrl/cmd-click selects the deepest */
  const resolveTarget = (full: string[], deep: boolean): string | null => {
    if (full.length < 2) return null;
    if (deep) return full[full.length - 1];
    let best = -1;
    for (const s of useStore.getState().selection) {
      const n = nodes[s];
      if (!n?.parentId) continue;
      const i = full.indexOf(n.parentId);
      if (i >= 0 && i + 1 < full.length) best = Math.max(best, i + 1);
      const j = full.indexOf(s);
      if (j >= 1) best = Math.max(best, j);
    }
    return full[best >= 1 ? best : 1];
  };

  const snapTargets = (ids: string[], lay: LayoutResult): Rect[] => {
    const parentId = nodes[ids[0]]?.parentId;
    if (!parentId) return [];
    const moving = new Set(ids);
    const out: Rect[] = [];
    const pc = lay.content[parentId];
    if (pc) out.push(pc);
    if (lay.rects[parentId]) out.push(lay.rects[parentId]);
    for (const c of nodes[parentId].children) {
      if (moving.has(c) || !isGuiObject(nodes[c].className) || nodes[c].props.Visible === false) continue;
      if (lay.rects[c]) out.push(lay.rects[c]);
    }
    return out;
  };

  /** Snap moving edges (xs / ys) to targets. Returns correction + guide lines. */
  const snap = (xs: number[], ys: number[], targets: Rect[], moving: Rect) => {
    const th = SNAP_PX / useStore.getState().zoom;
    let bx: { d: number; v: number } | null = null;
    let by: { d: number; v: number } | null = null;
    for (const t of targets) {
      for (const tv of [t.x, t.x + t.w / 2, t.x + t.w]) for (const mv of xs) {
        const d = tv - mv;
        if (Math.abs(d) < th && (!bx || Math.abs(d) < Math.abs(bx.d))) bx = { d, v: tv };
      }
      for (const tv of [t.y, t.y + t.h / 2, t.y + t.h]) for (const mv of ys) {
        const d = tv - mv;
        if (Math.abs(d) < th && (!by || Math.abs(d) < Math.abs(by.d))) by = { d, v: tv };
      }
    }
    const lines: Line[] = [];
    const m = { ...moving, x: moving.x + (bx?.d ?? 0), y: moving.y + (by?.d ?? 0) };
    if (bx) {
      const rel = targets.filter((t) => [t.x, t.x + t.w / 2, t.x + t.w].some((v) => Math.abs(v - bx!.v) < 0.01));
      const ys2 = rel.flatMap((t) => [t.y, t.y + t.h]).concat([m.y, m.y + m.h]);
      lines.push({ x1: bx.v, x2: bx.v, y1: Math.min(...ys2), y2: Math.max(...ys2) });
    }
    if (by) {
      const rel = targets.filter((t) => [t.y, t.y + t.h / 2, t.y + t.h].some((v) => Math.abs(v - by!.v) < 0.01));
      const xs2 = rel.flatMap((t) => [t.x, t.x + t.w]).concat([m.x, m.x + m.w]);
      lines.push({ y1: by.v, y2: by.v, x1: Math.min(...xs2), x2: Math.max(...xs2) });
    }
    return { dx: bx?.d ?? 0, dy: by?.d ?? 0, lines };
  };

  // ---- gestures ----------------------------------------------------------
  const startWindowGesture = () => {
    const move = (e: PointerEvent) => onGestureMove(e);
    const up = (e: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      onGestureEnd(e);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const s = useStore.getState();
    if (s.menu) useStore.setState({ menu: null });
    if (e.button === 2) return;
    if (s.editingTextId) return;
    const w = toWorld(e.clientX, e.clientY);

    if (e.button === 1 || space || tool === 'hand') {
      e.preventDefault();
      gesture.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, px: s.pan.x, py: s.pan.y };
      setPanning(true);
      startWindowGesture();
      return;
    }
    if (e.button !== 0) return;
    (document.activeElement as HTMLElement | null)?.blur?.();

    const full = hitPath(e.target);

    if (tool === 'pen') {
      penDown(e, w, full);
      return;
    }
    if (tool !== 'move') {
      // drawing a new element: parent is the deepest container under the cursor
      let parentId = full[0] ?? doc.rootIds.find((r) => doc.nodes[r].className === 'ScreenGui') ?? doc.rootIds[0];
      for (const id of full) if (CONTAINER_CLASSES.includes(nodes[id].className)) parentId = id;
      gesture.current = { kind: 'create', cls: tool, parentId, sx: w.x, sy: w.y, id: null };
      s.beginGesture();
      startWindowGesture();
      return;
    }

    const target = resolveTarget(full, e.ctrlKey || e.metaKey);
    // a Path2D: select it, and dragging its line moves it
    if (target && nodes[target]?.className === 'Path2D') {
      if (!e.shiftKey) s.select([target]);
      startPathMove(e, target);
      return;
    }
    // nothing of the UI here: a reference image can be picked up and moved
    const refHit = !target && !e.shiftKey ? referenceAt(w.x, w.y) : null;
    if (refHit) {
      selectReference(refHit);
      dragReference(e, refHit, 'move');
      return;
    }
    if (!target) {
      gesture.current = { kind: 'marquee', x0: w.x, y0: w.y, additive: e.shiftKey, base: e.shiftKey ? s.selection : [] };
      if (!e.shiftKey) s.select([]);
      startWindowGesture();
      return;
    }
    let sel = s.selection;
    if (e.shiftKey) {
      sel = sel.includes(target) ? sel.filter((x) => x !== target) : [...sel, target];
      s.select(sel);
      if (!sel.includes(target)) return;
    } else if (!sel.includes(target)) {
      sel = [target];
      s.select(sel);
    }
    // elements in a UIListLayout/UIGridLayout can't be placed freely: drag to reorder them, or out of the frame
    if (layout.laidOut.has(target)) {
      const parentId = nodes[target].parentId!;
      const ids = topLevelOnly(nodes, sel).filter((id) => nodes[id]?.parentId === parentId && layout.laidOut.has(id));
      const rects: Record<string, Rect> = {};
      ids.forEach((id) => (rects[id] = layout.rects[id]));
      gesture.current = { kind: 'stack', sx: w.x, sy: w.y, ids, parentId, rects, moved: false, insertAt: null, dropInto: null, ghosts: rects };
      startWindowGesture();
      return;
    }
    const ids = topLevelOnly(nodes, sel).filter((id) => isGuiObject(nodes[id]?.className) && !layout.laidOut.has(id));
    if (!ids.length) return;
    const rects: Record<string, Rect> = {};
    ids.forEach((id) => (rects[id] = layout.rects[id]));
    gesture.current = { kind: 'move', sx: w.x, sy: w.y, ids, rects, union: unionRect(Object.values(rects)), lay: layout, moved: false, targets: snapTargets(ids, layout) };
    startWindowGesture();
  };

  const startResize = (e: React.PointerEvent, handle: Handle) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const s = useStore.getState();
    const ids = topLevelOnly(nodes, s.selection).filter((id) => isGuiObject(nodes[id]?.className));
    if (!ids.length) return;
    const w = toWorld(e.clientX, e.clientY);
    const rects: Record<string, Rect> = {};
    ids.forEach((id) => (rects[id] = layout.rects[id]));
    const rot = ids.length === 1 ? nodes[ids[0]].props.Rotation || 0 : 0;
    s.beginGesture();
    gesture.current = { kind: 'resize', handle, sx: w.x, sy: w.y, ids, rects, union: unionRect(Object.values(rects)), lay: layout, rot, targets: rot ? [] : snapTargets(ids, layout) };
    startWindowGesture();
  };

  /** Drag a corner dot toward the middle to round the corners (creates a UICorner if needed) */
  const startRadius = (e: React.PointerEvent, corner: 'nw' | 'ne' | 'se' | 'sw') => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const s = useStore.getState();
    const id = s.selection[0];
    s.beginGesture();
    gesture.current = { kind: 'radius', id, corner, rect: layout.rects[id], rot: nodes[id].props.Rotation || 0 };
    startWindowGesture();
  };

  /** Drag a world GUI's label to move its artboard; click selects it */
  const startArtboard = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const s = useStore.getState();
    s.select([id]);
    const r = layout.artboards[id];
    if (!r) return;
    gesture.current = { kind: 'artboard', id, sx: e.clientX, sy: e.clientY, x0: r.x, y0: r.y, moved: false };
    startWindowGesture();
  };

  const startRotate = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const s = useStore.getState();
    const id = s.selection[0];
    const r = layout.rects[id];
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const w = toWorld(e.clientX, e.clientY);
    s.beginGesture();
    gesture.current = { kind: 'rotate', id, cx, cy, a0: Math.atan2(w.y - cy, w.x - cx), r0: nodes[id].props.Rotation || 0 };
    startWindowGesture();
  };

  const onGestureMove = (e: PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const s = useStore.getState();
    if (g.kind === 'pan') {
      useStore.setState({ pan: { x: g.px + e.clientX - g.sx, y: g.py + e.clientY - g.sy } });
      return;
    }
    const w = toWorld(e.clientX, e.clientY);

    if (g.kind === 'marquee') {
      const r = { x: Math.min(g.x0, w.x), y: Math.min(g.y0, w.y), w: Math.abs(w.x - g.x0), h: Math.abs(w.y - g.y0) };
      setMarquee(r);
      const hits = Object.values(nodes).filter((n) => {
        if (!isGuiObject(n.className) || n.props.Visible === false) return false;
        if (pathTo(nodes, n.id).some((a) => nodes[a].locked)) return false;
        const lr = layout.rects[n.id];
        return lr && rectsIntersect(lr, r);
      }).map((n) => n.id);
      s.select([...new Set([...g.base, ...topLevelOnly(nodes, hits)])]);
      return;
    }

    if (g.kind === 'move') {
      let dx = w.x - g.sx;
      let dy = w.y - g.sy;
      if (!g.moved) {
        if (Math.hypot(dx, dy) * s.zoom < 3) return;
        g.moved = true;
        s.beginGesture();
      }
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      const u = { ...g.union, x: g.union.x + dx, y: g.union.y + dy };
      const sn = e.ctrlKey || e.metaKey ? { dx: 0, dy: 0, lines: [] } : snap([u.x, u.x + u.w / 2, u.x + u.w], [u.y, u.y + u.h / 2, u.y + u.h], g.targets, u);
      dx += sn.dx;
      dy += sn.dy;
      setGuides(sn.lines);
      placeNodes(g.ids.map((id) => ({ id, rect: { ...g.rects[id], x: g.rects[id].x + dx, y: g.rects[id].y + dy } })), g.lay);
      // dropping on another frame moves the elements inside it (like Figma)
      const over = frameUnderPointer(e.clientX, e.clientY, g.ids);
      const parent = nodes[g.ids[0]]?.parentId;
      g.dropInto = over && over !== parent && g.ids.every((id) => nodes[id]?.parentId === parent) ? over : null;
      if (g.dropInto !== dropTarget) setDropTarget(g.dropInto);
      return;
    }

    if (g.kind === 'stack') {
      const dx = w.x - g.sx;
      const dy = w.y - g.sy;
      if (!g.moved) {
        if (Math.hypot(dx, dy) * s.zoom < 3) return;
        g.moved = true;
      }
      g.ghosts = Object.fromEntries(Object.entries(g.rects).map(([id, r]) => [id, { ...r, x: r.x + dx, y: r.y + dy }]));
      setStackGhosts(Object.values(g.ghosts));
      let over = frameUnderPointer(e.clientX, e.clientY, g.ids);
      // hovering a sibling in the same stack means "reorder here", not "go inside that sibling"
      if (over && nodes[over]?.parentId === g.parentId) over = g.parentId;
      if (over && over !== g.parentId) {
        // leaving the stack: drop into another frame / the screen
        g.dropInto = over;
        g.insertAt = null;
        setInsertLine(null);
        if (dropTarget !== over) setDropTarget(over);
        return;
      }
      g.dropInto = null;
      if (dropTarget) setDropTarget(null);
      // slot inside the stack: count the siblings before the pointer
      const stack = nodes[g.parentId].children.map((c) => nodes[c]).find((c) => c?.className === 'UIListLayout' || c?.className === 'UIGridLayout');
      const siblings = stackOrder(g.parentId).filter((id) => !g.ids.includes(id) && layout.rects[id]);
      const content = layout.content[g.parentId];
      if (!stack || !content) return;
      const vertical = stack.className === 'UIListLayout' ? stack.props.FillDirection !== 'Horizontal' : stack.props.FillDirection === 'Vertical';
      const pos = (r: Rect) => (vertical ? r.y + r.h / 2 : r.x + r.w / 2);
      let index: number;
      if (stack.className === 'UIGridLayout') {
        // nearest cell, before or after it along the fill direction
        let best = -1;
        let bestD = Infinity;
        siblings.forEach((id, i) => {
          const r = layout.rects[id];
          const d = Math.hypot(r.x + r.w / 2 - w.x, r.y + r.h / 2 - w.y);
          if (d < bestD) [best, bestD] = [i, d];
        });
        index = best < 0 ? 0 : best + ((vertical ? w.y : w.x) > pos(layout.rects[siblings[best]]) ? 1 : 0);
      } else {
        index = siblings.filter((id) => pos(layout.rects[id]) < (vertical ? w.y : w.x)).length;
      }
      g.insertAt = index;
      // insertion line between the neighbours
      const prev = siblings[index - 1] ? layout.rects[siblings[index - 1]] : null;
      const next = siblings[index] ? layout.rects[siblings[index]] : null;
      if (stack.className === 'UIGridLayout') {
        const ref = next ?? prev;
        if (!ref) return setInsertLine(null);
        const x = next ? ref.x - 3 : ref.x + ref.w + 3;
        setInsertLine({ x1: x, x2: x, y1: ref.y, y2: ref.y + ref.h });
      } else if (vertical) {
        const y = prev && next ? (prev.y + prev.h + next.y) / 2 : prev ? prev.y + prev.h + 3 : next ? next.y - 3 : content.y;
        setInsertLine({ x1: content.x, x2: content.x + content.w, y1: y, y2: y });
      } else {
        const x = prev && next ? (prev.x + prev.w + next.x) / 2 : prev ? prev.x + prev.w + 3 : next ? next.x - 3 : content.x;
        setInsertLine({ x1: x, x2: x, y1: content.y, y2: content.y + content.h });
      }
      return;
    }

    if (g.kind === 'resize') {
      let dx = w.x - g.sx;
      let dy = w.y - g.sy;
      if (g.rot) {
        const a = (-g.rot * Math.PI) / 180;
        [dx, dy] = [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];
      }
      const U = g.union;
      let x0 = U.x, y0 = U.y, x1 = U.x + U.w, y1 = U.y + U.h;
      const h = g.handle;
      if (h.includes('w')) x0 += dx;
      if (h.includes('e')) x1 += dx;
      if (h.includes('n')) y0 += dy;
      if (h.includes('s')) y1 += dy;
      if (e.altKey) {
        if (h.includes('w')) x1 -= dx;
        if (h.includes('e')) x0 -= dx;
        if (h.includes('n')) y1 -= dy;
        if (h.includes('s')) y0 -= dy;
      }
      // snap moving edges
      if (!g.rot && !(e.ctrlKey || e.metaKey)) {
        const xs = [h.includes('w') ? x0 : null, h.includes('e') ? x1 : null].filter((v): v is number => v !== null);
        const ys = [h.includes('n') ? y0 : null, h.includes('s') ? y1 : null].filter((v): v is number => v !== null);
        const sn = snap(xs, ys, g.targets, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
        if (h.includes('w')) x0 += sn.dx;
        else if (h.includes('e')) x1 += sn.dx;
        if (h.includes('n')) y0 += sn.dy;
        else if (h.includes('s')) y1 += sn.dy;
        setGuides(sn.lines);
      }
      if (e.shiftKey && U.w > 0 && U.h > 0) {
        const ratio = U.w / U.h;
        const nw = x1 - x0;
        const nh = y1 - y0;
        if (h.length === 2) {
          if (Math.abs(nw / U.w) > Math.abs(nh / U.h)) {
            const th = nw / ratio;
            if (h.includes('n')) y0 = y1 - th;
            else y1 = y0 + th;
          } else {
            const tw = nh * ratio;
            if (h.includes('w')) x0 = x1 - tw;
            else x1 = x0 + tw;
          }
        } else if (h === 'e' || h === 'w') {
          const th = nw / ratio;
          const cy = (y0 + y1) / 2;
          y0 = cy - th / 2;
          y1 = cy + th / 2;
        } else {
          const tw = nh * ratio;
          const cx = (x0 + x1) / 2;
          x0 = cx - tw / 2;
          x1 = cx + tw / 2;
        }
      }
      if (x1 - x0 < 1) (h.includes('w') ? (x0 = x1 - 1) : (x1 = x0 + 1));
      if (y1 - y0 < 1) (h.includes('n') ? (y0 = y1 - 1) : (y1 = y0 + 1));
      let N = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      if (g.rot) {
        // keep the rotated box's opposite side fixed in screen space
        const a = (g.rot * Math.PI) / 180;
        const lcx = N.x + N.w / 2 - (U.x + U.w / 2);
        const lcy = N.y + N.h / 2 - (U.y + U.h / 2);
        const wcx = U.x + U.w / 2 + lcx * Math.cos(a) - lcy * Math.sin(a);
        const wcy = U.y + U.h / 2 + lcx * Math.sin(a) + lcy * Math.cos(a);
        N = { x: wcx - N.w / 2, y: wcy - N.h / 2, w: N.w, h: N.h };
      }
      const sx = N.w / Math.max(U.w, 0.0001);
      const sy = N.h / Math.max(U.h, 0.0001);
      placeNodes(
        g.ids.map((id) => {
          const r = g.rects[id];
          return { id, rect: { x: N.x + (r.x - U.x) * sx, y: N.y + (r.y - U.y) * sy, w: r.w * sx, h: r.h * sy } };
        }),
        g.lay,
      );
      return;
    }

    if (g.kind === 'radius') {
      const r = g.rect;
      // pointer in the element's local (unrotated) frame, measured from the dragged corner
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      const a = (-g.rot * Math.PI) / 180;
      const lx = (w.x - cx) * Math.cos(a) - (w.y - cy) * Math.sin(a) + r.w / 2;
      const ly = (w.x - cx) * Math.sin(a) + (w.y - cy) * Math.cos(a) + r.h / 2;
      const inX = g.corner.includes('w') ? lx : r.w - lx;
      const inY = g.corner.includes('n') ? ly : r.h - ly;
      const max = Math.min(r.w, r.h) / 2;
      let radius = Math.max(0, Math.min(max, (inX + inY) / 2));
      if (e.shiftKey) radius = Math.round(radius / 4) * 4;
      const pill = radius >= max - 1;
      setCornerRadius([g.id], pill ? { s: 0.5, o: 0 } : { s: 0, o: Math.round(radius) });
      setRadiusBadge(pill ? 'Full round (scale 0.5)' : `Corner radius ${Math.round(radius)}`);
      return;
    }

    if (g.kind === 'artboard') {
      const dx = (e.clientX - g.sx) / s.zoom;
      const dy = (e.clientY - g.sy) / s.zoom;
      if (!g.moved) {
        if (Math.hypot(dx, dy) * s.zoom < 3) return;
        g.moved = true;
        s.beginGesture();
      }
      patchNodes([g.id], { artboard: { x: Math.round(g.x0 + dx), y: Math.round(g.y0 + dy) } });
      return;
    }

    if (g.kind === 'rotate') {
      const a = Math.atan2(w.y - g.cy, w.x - g.cx);
      let rot = g.r0 + ((a - g.a0) * 180) / Math.PI;
      rot = ((((rot + 180) % 360) + 360) % 360) - 180;
      rot = e.shiftKey ? Math.round(rot / 15) * 15 : Math.round(rot * 10) / 10;
      setProp([g.id], 'Rotation', rot, false);
      return;
    }

    if (g.kind === 'create') {
      let dx = w.x - g.sx;
      let dy = w.y - g.sy;
      if (!g.id && Math.hypot(dx, dy) * s.zoom < 3) return;
      if (e.shiftKey) {
        const m = Math.max(Math.abs(dx), Math.abs(dy));
        dx = Math.sign(dx || 1) * m;
        dy = Math.sign(dy || 1) * m;
      }
      const rect = { x: Math.min(g.sx, g.sx + dx), y: Math.min(g.sy, g.sy + dy), w: Math.max(1, Math.abs(dx)), h: Math.max(1, Math.abs(dy)) };
      if (!g.id) g.id = insertNode(g.cls, { parentId: g.parentId, rect: { ...rect, x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) } });
      else placeNodes([{ id: g.id, rect }], computeLayout(useStore.getState().doc.nodes, doc.rootIds, doc.device, rootOrigins(useStore.getState().doc)));
    }
  };

  const onGestureEnd = (e: PointerEvent) => {
    const g = gesture.current;
    gesture.current = null;
    setDropTarget(null);
    setStackGhosts([]);
    setInsertLine(null);
    if (g?.kind === 'stack' && g.moved) {
      const st = useStore.getState();
      st.beginGesture();
      if (g.dropInto && st.doc.nodes[g.dropInto]) moveIntoFrame(g.ids, g.dropInto, g.ghosts);
      else if (g.insertAt !== null) reorderInStack(g.ids, g.insertAt);
      st.endGesture();
    }
    if (g?.kind === 'move' && g.moved && g.dropInto) {
      const target = useStore.getState().doc.nodes[g.dropInto];
      if (target) moveIntoFrame(g.ids, target.id);
    }
    setGuides([]);
    setMarquee(null);
    setPanning(false);
    const s = useStore.getState();
    if (!g) return;
    if (g.kind === 'create') {
      if (!g.id) {
        const w = toWorld(e.clientX, e.clientY);
        const id = insertNode(g.cls, { parentId: g.parentId });
        const lay = computeLayout(useStore.getState().doc.nodes, doc.rootIds, doc.device, rootOrigins(useStore.getState().doc));
        const r = lay.rects[id];
        if (r && !lay.laidOut.has(id)) placeNodes([{ id, rect: { ...r, x: Math.round(w.x - r.w / 2), y: Math.round(w.y - r.h / 2) } }], lay);
      }
      s.endGesture();
      if (!e.shiftKey) useStore.setState({ tool: 'move' });
      return;
    }
    setRadiusBadge(null);
    if (g.kind === 'move' || g.kind === 'resize' || g.kind === 'rotate' || g.kind === 'radius' || g.kind === 'artboard') s.endGesture();
  };

  // ---- hover & double click ---------------------------------------------
  const onPointerMove = (e: React.PointerEvent) => {
    if (gesture.current) return;
    const full = hitPath(e.target);
    const t = tool === 'move' ? resolveTarget(full, e.ctrlKey || e.metaKey) : null;
    if (t !== useStore.getState().hoverId) useStore.setState({ hoverId: t });
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const full = hitPath(e.target);
    if (full.length < 2) return;
    const s = useStore.getState();
    const cur = s.selection.length === 1 ? full.indexOf(s.selection[0]) : -1;
    if (cur >= 1 && cur < full.length - 1) {
      s.select([full[cur + 1]]);
      return;
    }
    const id = cur >= 1 ? full[cur] : full[1];
    if (isText(nodes[id].className) && cur === full.length - 1) {
      useStore.setState({ editingTextId: id, selection: [id] });
    } else s.select([id]);
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const s = useStore.getState();
    const full = hitPath(e.target);
    const t = resolveTarget(full, e.ctrlKey || e.metaKey);
    if (t && !s.selection.includes(t)) s.select([t]);
    useStore.setState({ menu: { x: e.clientX, y: e.clientY } });
  };

  // ---- overlay -----------------------------------------------------------
  const boxStyle = (id: string): CSSProperties | null => {
    const r = layout.rects[id];
    if (!r) return null;
    const sr = toScreen(r);
    const rot = nodes[id]?.props.Rotation || 0;
    return { left: sr.x, top: sr.y, width: sr.w, height: sr.h, transform: rot ? `rotate(${rot}deg)` : undefined };
  };

  const selGui = selection.filter((id) => nodes[id] && isGuiObject(nodes[id].className));
  const selScreens = selection.filter((id) => nodes[id]?.className === 'ScreenGui');
  const selWorld = selection.filter((id) => nodes[id] && isWorldGui(nodes[id].className));
  const worldRoots = doc.rootIds.filter((id) => nodes[id] && isWorldGui(nodes[id].className));
  const screens = screensOf(doc);
  const selModParents = selection.filter((id) => nodes[id] && isModifier(nodes[id].className)).map((id) => nodes[id].parentId!);
  const single = selGui.length === 1 ? selGui[0] : null;
  const unionSel = selGui.length > 1 ? toScreen(unionRect(selGui.map((id) => layout.rects[id]).filter(Boolean))) : null;
  const recording = mode === 'animate' && playhead > 0.001;

  const handles = (movable: boolean) =>
    (['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as Handle[]).map((h) => (
      <div key={h} className={`handle h-${h}`} onPointerDown={(e) => startResize(e, h)} style={{ display: movable ? undefined : 'none' }} />
    ));

  const cursor = panning ? 'grabbing' : space || tool === 'hand' ? 'grab' : tool !== 'move' ? 'crosshair' : 'default';

  return (
    <div
      ref={ref}
      className={`canvas ${recording ? 'recording' : ''}`}
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerLeave={() => useStore.setState({ hoverId: null })}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      <div className="world" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
        {/* references behind the UI: outside the screen here, inside it below (over the artboard's checkerboard) */}
        <RefLayer placement="behind" />
        {screens.map((sc) => {
          const b = screenBox(doc, sc.id);
          return (
            <div key={sc.id} className="artboard" style={{ position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h, overflow: clipArtboard ? 'hidden' : 'visible' }}>
              {/* contents use canvas coordinates */}
              <div style={{ position: 'absolute', left: -b.x, top: -b.y }}>
                <RefLayer placement="behind" />
                {screenRoots(doc, sc.id).map((id) => <ScreenView key={id} id={id} ctx={ctx} />)}
              </div>
              {doc.showTopbar && <TopbarMock device={doc.device} title="Roblox top bar (58px inset). Toggle it in the Document panel." />}
              <DeviceCutouts device={doc.device} />
            </div>
          );
        })}
        {worldRoots.map((id) => <ScreenView key={id} id={id} ctx={ctx} />)}
        <RefLayer placement="over" />
      </div>

      <div className="overlay">
        {screens.map((sc) => {
          const b = screenBox(doc, sc.id);
          const roots = screenRoots(doc, sc.id);
          const on = selection.some((id) => roots.includes(pathTo(nodes, id)[0]));
          return (
            <div
              key={sc.id}
              className={`artboard-label screen ${on ? 'on' : ''}`}
              style={{ left: pan.x + b.x * zoom, top: pan.y + b.y * zoom - 22 }}
              title="Click to select this screen"
              onPointerDown={(e) => {
                e.stopPropagation();
                if (roots[0]) useStore.getState().select([roots[0]]);
              }}
            >
              {screens.length > 1 && <b>{sc.name}</b>}
              {screens.length > 1 && (screenStartsVisible(doc, sc) ? ' · shown at start' : ' · hidden at start')} {screens.length > 1 ? '· ' : ''}
              {doc.device.name} · {doc.device.w}×{doc.device.h}
            </div>
          );
        })}
        {worldRoots.map((id) => {
          const r = layout.artboards[id];
          if (!r) return null;
          const n = nodes[id];
          return (
            <div key={id} className={`artboard-label world ${selection.includes(id) ? 'on' : ''}`} style={{ left: pan.x + r.x * zoom, top: pan.y + r.y * zoom - 22 }} onPointerDown={(e) => startArtboard(e, id)} title="Drag to move · click to select">
              {n.className} · {n.name} · {Math.round(r.w)}×{Math.round(r.h)}
            </div>
          );
        })}
        {selWorld.map((id) => layout.artboards[id] && <div key={'w' + id} className="sel-box screen" style={toRectStyle(toScreen(layout.artboards[id]))} />)}
        {selScreens.map((id) => <div key={'s' + id} className="sel-box screen" style={toRectStyle(toScreen(screenBox(doc, screenOfRoot(doc, id).id)))} />)}
        {selModParents.map((id) => boxStyle(id) && <div key={'m' + id} className="sel-box modparent" style={boxStyle(id)!} />)}
        {hoverId && !selection.includes(hoverId) && boxStyle(hoverId) && <div className="hover-box" style={boxStyle(hoverId)!} />}
        {single && nodes[single].parentId && !isRoot(nodes[nodes[single].parentId!]?.className) && layout.content[nodes[single].parentId!] && (
          <div className="parent-box" style={{ ...toRectStyle(toScreen(layout.content[nodes[single].parentId!])) }} />
        )}
        {selGui.map((id) => {
          const st = boxStyle(id);
          if (!st) return null;
          const isSingle = id === single;
          const laid = layout.laidOut.has(id);
          const locked = !!nodes[id].locked;
          const r = layout.rects[id];
          const a = nodes[id].props.AnchorPoint;
          return (
            <div key={id} className={`sel-box ${isSingle ? 'single' : 'multi'}`} style={st}>
              {isSingle && !locked && handles(true)}
              {isSingle && !locked && (['nw', 'ne', 'se', 'sw'] as const).map((c) => <div key={c} className={`rot-zone r-${c}`} onPointerDown={startRotate} />)}
              {isSingle && !locked && mode === 'design' && r.w * zoom >= 28 && r.h * zoom >= 28 && (() => {
                const inset = Math.max(9, Math.min(cornerRadiusPx(id) * zoom, (Math.min(r.w, r.h) * zoom) / 2 - 2));
                return (['nw', 'ne', 'se', 'sw'] as const).map((c) => (
                  <div
                    key={'r' + c}
                    className="radius-handle"
                    title="Drag toward the middle to round the corners (Shift snaps to 4px)"
                    style={{ [c.includes('n') ? 'top' : 'bottom']: inset - 4, [c.includes('w') ? 'left' : 'right']: inset - 4 } as CSSProperties}
                    onPointerDown={(e) => startRadius(e, c)}
                  />
                ));
              })()}
              {isSingle && <div className="anchor-dot" style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%` }} title="AnchorPoint" />}
              {isSingle && (
                <div className="size-badge">
                  {Math.round(r.w)} × {Math.round(r.h)}
                  {laid && <span className="badge-note"> · auto layout</span>}
                </div>
              )}
            </div>
          );
        })}
        {unionSel && (
          <div className="sel-box single union" style={toRectStyle(unionSel)}>
            {handles(true)}
            <div className="size-badge">{Math.round(unionSel.w / zoom)} × {Math.round(unionSel.h / zoom)}</div>
          </div>
        )}
        <svg className="guides" width="100%" height="100%">
          {guides.map((l, i) => (
            <line key={i} x1={pan.x + l.x1 * zoom} y1={pan.y + l.y1 * zoom} x2={pan.x + l.x2 * zoom} y2={pan.y + l.y2 * zoom} />
          ))}
        </svg>
        {marquee && <div className="marquee" style={toRectStyle(toScreen(marquee))} />}
        {stackGhosts.map((r, i) => <div key={'g' + i} className="stack-ghost" style={toRectStyle(toScreen(r))} />)}
        {insertLine && (
          <div
            className="insert-line"
            style={
              insertLine.y1 === insertLine.y2
                ? { left: pan.x + insertLine.x1 * zoom, top: pan.y + insertLine.y1 * zoom - 1.5, width: (insertLine.x2 - insertLine.x1) * zoom, height: 3 }
                : { left: pan.x + insertLine.x1 * zoom - 1.5, top: pan.y + insertLine.y1 * zoom, width: 3, height: (insertLine.y2 - insertLine.y1) * zoom }
            }
          />
        )}
        {dropTarget && layout.rects[dropTarget] && (
          <div className="drop-target" style={isRoot(nodes[dropTarget]?.className) && !isWorldGui(nodes[dropTarget].className) ? toRectStyle(toScreen(screenBox(doc, screenOfRoot(doc, dropTarget).id))) : toRectStyle(toScreen(layout.rects[dropTarget]))}>
            <span>Move into {nodes[dropTarget]?.name}</span>
          </div>
        )}
        <RefSelectionBox />
        {selection.length === 1 && nodes[selection[0]]?.className === 'Path2D' && <PathEditor id={selection[0]} />}
        {single && layout.rects[single] ? <QuickBar rect={toScreen(layout.rects[single])} /> : unionSel && <QuickBar rect={unionSel} />}
        {radiusBadge && <div className="rec-badge radius">{radiusBadge}</div>}
        {recording && <div className="rec-badge">● Recording keyframes at {playhead.toFixed(2)}s — edits create tweens</div>}
      </div>
      {editingTextId && nodes[editingTextId] && layout.rects[editingTextId] && (
        <InlineTextEditor id={editingTextId} node={nodes[editingTextId]} rect={toScreen(layout.content[editingTextId] ?? layout.rects[editingTextId])} zoom={zoom} />
      )}
    </div>
  );
}

const toRectStyle = (r: Rect): CSSProperties => ({ left: r.x, top: r.y, width: r.w, height: r.h });

function isTyping() {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

function InlineTextEditor({ id, node, rect, zoom }: { id: string; node: GuiNode; rect: Rect; zoom: number }) {
  const [text, setText] = useState<string>(node.props.Text ?? '');
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const done = (commit: boolean) => {
    if (commit && text !== node.props.Text) setProps([{ id, props: { Text: text } }]);
    useStore.setState({ editingTextId: null });
  };
  const p = node.props;
  const size = p.TextScaled ? Math.min(rect.h / zoom, 48) : p.TextSize;
  return (
    <textarea
      ref={ref}
      className="inline-text"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => done(true)}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') done(false);
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          done(true);
        }
      }}
      style={{
        left: rect.x, top: rect.y, width: Math.max(rect.w, 40), height: Math.max(rect.h, 20),
        fontSize: size * zoom, color: p.TextColor3, textAlign: p.TextXAlignment === 'Left' ? 'left' : p.TextXAlignment === 'Right' ? 'right' : 'center',
      }}
    />
  );
}
