// Path2D on the canvas: the Pen tool (click = corner, drag = curve, click the first point = close,
// Enter / Esc = done) and editing a selected path (drag points and handles, double-click a point for
// smooth / sharp, drag the line to move it, Delete removes the selected point, arrows nudge).
import { useSyncExternalStore } from 'react';
import { useStore } from '../store';
import { attach, createNode, pathTo } from '../model/doc';
import { isGuiObject, isRoot } from '../model/schema';
import { ZERO2, anchorsOf, pathData, toUDim2, toggledSmooth, usesScale } from '../model/path';
import { screenRoots } from '../model/screens';
import type { GuiNode, PathPoint, Rect, UDim, UDim2, Vec2 } from '../model/types';
import { activeScreenId, layoutNow } from '../actions';
import { Row } from './fields';

const S = () => useStore.getState();

// ---------------------------------------------------------------------------
// state: the path being drawn, the selected point

let penPathId: string | null = null;
let selected: { pathId: string; index: number } | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
const selectPoint = (v: typeof selected) => {
  selected = v;
  emit();
};
export const useSelectedPoint = () => useSyncExternalStore(subscribe, () => selected);

/** The box a path's points are relative to: its parent's rect */
function boxOf(path: GuiNode): Rect | null {
  return path.parentId ? (layoutNow().rects[path.parentId] ?? null) : null;
}

function setPoints(id: string, fn: (pts: PathPoint[], node: GuiNode) => void) {
  S().update((d) => {
    const n = d.nodes[id] as GuiNode | undefined;
    if (!n) return;
    n.points ??= [];
    fn(n.points, n);
  });
}

const addU = (u: UDim, px: number, len: number): UDim => (u.s !== 0 ? { s: +(u.s + px / Math.max(1, len)).toFixed(5), o: u.o } : { s: 0, o: Math.round((u.o + px) * 100) / 100 });
const shiftU2 = (u: UDim2, dx: number, dy: number, box: Rect): UDim2 => ({ x: addU(u.x, dx, box.w), y: addU(u.y, dy, box.h) });
const neg = (u: UDim2): UDim2 => ({ x: { s: -u.x.s, o: -u.x.o }, y: { s: -u.y.s, o: -u.y.o } });

/** Follow the pointer until it's released, as one undo step */
function drag(e: React.PointerEvent | PointerEvent, onMove: (dx: number, dy: number, ev: PointerEvent) => void, onUp?: (moved: boolean) => void) {
  const { zoom } = S();
  const sx = e.clientX;
  const sy = e.clientY;
  let moved = false;
  S().beginGesture();
  const move = (ev: PointerEvent) => {
    const dx = (ev.clientX - sx) / zoom;
    const dy = (ev.clientY - sy) / zoom;
    if (!moved && Math.hypot(dx, dy) * zoom < 3) return;
    moved = true;
    onMove(dx, dy, ev);
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    onUp?.(moved);
    S().endGesture();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

// ---------------------------------------------------------------------------
// Pen tool

/** Done drawing: a path with fewer than 2 points is removed */
export function finishPen() {
  const id = penPathId;
  penPathId = null;
  const n = id ? S().doc.nodes[id] : undefined;
  if (n && (n.points?.length ?? 0) < 2) {
    S().update((d) => {
      const p = d.nodes[n.parentId!];
      if (p) p.children = p.children.filter((c) => c !== n.id);
      delete d.nodes[n.id];
    });
    S().select([]);
  }
  if (S().tool === 'pen') useStore.setState({ tool: 'move' });
  emit();
}

/** Pointer down on the canvas with the Pen tool. `w`: canvas point, `full`: ids under the pointer (root first) */
export function penDown(e: React.PointerEvent, w: Vec2, full: string[]) {
  e.preventDefault();
  const s = S();
  const doc = s.doc;
  let id = penPathId && doc.nodes[penPathId] && s.selection[0] === penPathId ? penPathId : null;
  s.beginGesture();
  let index = 0;
  let anchor = w;
  if (id) {
    const node = doc.nodes[id];
    const box = boxOf(node);
    if (!box) return s.endGesture();
    const a = anchorsOf(node.points ?? [], box);
    // clicking the first point closes the shape
    if (a.length >= 2 && Math.hypot(a[0].p.x - w.x, a[0].p.y - w.y) * s.zoom < 10) {
      setPoints(id, (_, n) => void (n.props.Closed = true));
      s.endGesture();
      return finishPen();
    }
    const scale = node.points?.length ? usesScale(node.points[0]) : s.units === 'scale';
    index = node.points?.length ?? 0;
    setPoints(id, (pts) => void pts.push({ p: toUDim2({ x: w.x - box.x, y: w.y - box.y }, box, scale), l: ZERO2, r: ZERO2 }));
  } else {
    // new path in the deepest element (or screen) under the pointer
    const parent = [...full].reverse().find((x) => doc.nodes[x] && !doc.nodes[x].locked && (isGuiObject(doc.nodes[x].className) || isRoot(doc.nodes[x].className)))
      ?? screenRoots(doc, activeScreenId())[0] ?? doc.rootIds[0];
    const box = layoutNow().rects[parent];
    if (!box) return s.endGesture();
    const n = createNode('Path2D', {}, 'Path');
    n.points = [{ p: toUDim2({ x: w.x - box.x, y: w.y - box.y }, box, s.units === 'scale'), l: ZERO2, r: ZERO2 }];
    s.update((d) => {
      d.nodes[n.id] = n as GuiNode;
      attach(d as any, n.id, parent);
    });
    id = n.id;
    penPathId = id;
    s.select([id]);
  }
  anchor = w;
  selectPoint({ pathId: id, index });
  const pathId = id;
  // drag out the handles (a curve): outgoing follows the pointer, incoming mirrors it
  const { zoom } = s;
  const move = (ev: PointerEvent) => {
    const node = S().doc.nodes[pathId];
    const box = boxOf(node);
    if (!box) return;
    const cur = { x: anchor.x + (ev.clientX - e.clientX) / zoom, y: anchor.y + (ev.clientY - e.clientY) / zoom };
    if (Math.hypot(cur.x - anchor.x, cur.y - anchor.y) * zoom < 3) return;
    const scale = usesScale(node.points![index]);
    const r = toUDim2({ x: cur.x - anchor.x, y: cur.y - anchor.y }, box, scale);
    setPoints(pathId, (pts) => {
      if (!pts[index]) return;
      pts[index].r = r;
      pts[index].l = neg(r);
    });
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    S().endGesture();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

// leaving the Pen tool finishes the path
let lastTool = useStore.getState().tool;
useStore.subscribe((st) => {
  if (st.tool !== lastTool) {
    const was = lastTool;
    lastTool = st.tool;
    if (was === 'pen' && penPathId) finishPen();
  }
  if (selected && (!st.doc.nodes[selected.pathId] || !st.selection.includes(selected.pathId))) selectPoint(null);
});

/** Move a whole path (dragging its line) */
export function startPathMove(e: React.PointerEvent, id: string) {
  e.stopPropagation();
  const node = S().doc.nodes[id];
  const box = boxOf(node);
  if (!box || !node.points) return;
  const start = structuredClone(node.points);
  drag(e, (dx, dy) => setPoints(id, (pts) => start.forEach((pt, i) => pts[i] && (pts[i].p = shiftU2(pt.p, dx, dy, box)))));
}

/** Keys for paths; returns true when handled */
export function pathKeyDown(e: KeyboardEvent): boolean {
  const s = S();
  const k = e.key;
  if (s.tool === 'pen' && (k === 'Enter' || k === 'Escape')) {
    e.preventDefault();
    finishPen();
    return true;
  }
  const id = s.selection.length === 1 && s.doc.nodes[s.selection[0]]?.className === 'Path2D' ? s.selection[0] : null;
  if (!id) return false;
  const node = s.doc.nodes[id];
  const sel = selected?.pathId === id ? selected.index : null;
  if ((k === 'Delete' || k === 'Backspace') && sel !== null) {
    e.preventDefault();
    if ((node.points?.length ?? 0) <= 2) return false; // deletes the whole path instead
    setPoints(id, (pts) => void pts.splice(sel, 1));
    selectPoint(null);
    return true;
  }
  if (k.startsWith('Arrow')) {
    e.preventDefault();
    const box = boxOf(node);
    if (!box) return true;
    const d = e.shiftKey ? 10 : 1;
    const dx = k === 'ArrowLeft' ? -d : k === 'ArrowRight' ? d : 0;
    const dy = k === 'ArrowUp' ? -d : k === 'ArrowDown' ? d : 0;
    S().update((dd) => {
      const pts = dd.nodes[id].points ?? [];
      pts.forEach((pt, i) => {
        if (sel === null || sel === i) pt.p = shiftU2(pt.p, dx, dy, box);
      });
    }, { coalesce: 'pathnudge' + id });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Editing overlay (inside the canvas overlay, screen coordinates)

export function PathEditor({ id }: { id: string }) {
  const node = useStore((s) => s.doc.nodes[id]);
  const zoom = useStore((s) => s.zoom);
  const pan = useStore((s) => s.pan);
  const tool = useStore((s) => s.tool);
  const sel = useSelectedPoint();
  useStore((s) => s.doc); // re-render (and re-measure the parent) on any change
  if (!node?.points || !node.parentId) return null;
  const box = layoutNow().rects[node.parentId];
  if (!box) return null;
  const sc = (v: Vec2) => ({ x: pan.x + v.x * zoom, y: pan.y + v.y * zoom });
  const a = anchorsOf(node.points, box);
  const d = pathData(node.points, { x: pan.x + box.x * zoom, y: pan.y + box.y * zoom, w: box.w * zoom, h: box.h * zoom }, !!node.props.Closed);
  const selIndex = sel?.pathId === id ? sel.index : null;

  const dragPoint = (e: React.PointerEvent, i: number) => {
    e.stopPropagation();
    if (tool === 'pen' && i === 0 && a.length >= 2 && penPathId === id) {
      setPoints(id, (_, n) => void (n.props.Closed = true));
      return finishPen();
    }
    selectPoint({ pathId: id, index: i });
    const start = structuredClone(node.points![i]);
    drag(e, (dx, dy) => setPoints(id, (pts) => pts[i] && (pts[i].p = shiftU2(start.p, dx, dy, box))));
  };
  const dragHandle = (e: React.PointerEvent, i: number, side: 'l' | 'r') => {
    e.stopPropagation();
    const start = structuredClone(node.points![i]);
    const other = side === 'l' ? 'r' : 'l';
    drag(e, (dx, dy, ev) =>
      setPoints(id, (pts) => {
        const pt = pts[i];
        if (!pt) return;
        pt[side] = shiftU2(start[side], dx, dy, box);
        // mirrored like a smooth point, unless Alt breaks the handles apart
        if (!ev.altKey) pt[other] = neg(pt[side]);
      }),
    );
  };

  return (
    <div className="path-editor">
      <svg className="path-editor-lines" width="100%" height="100%">
        <path d={d} className="path-outline" />
        <path d={d} className="path-hit" onPointerDown={(e) => tool !== 'pen' && startPathMove(e, id)} />
        {selIndex !== null && a[selIndex] && (['l', 'r'] as const).map((side) => {
          const p = sc(a[selIndex].p);
          const h = sc(a[selIndex][side]);
          return <line key={side} x1={p.x} y1={p.y} x2={h.x} y2={h.y} className="path-handle-line" />;
        })}
      </svg>
      {a.map((pt, i) => {
        const p = sc(pt.p);
        return (
          <div
            key={i}
            className={`path-anchor ${selIndex === i ? 'on' : ''} ${i === 0 && tool === 'pen' && penPathId === id && a.length >= 2 ? 'closer' : ''}`}
            style={{ left: p.x, top: p.y }}
            title={i === 0 && tool === 'pen' ? 'Click to close the shape' : 'Drag to move · double-click: smooth / sharp · Delete removes it'}
            onPointerDown={(e) => dragPoint(e, i)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              const next = toggledSmooth(node.points!, i, box, !!node.props.Closed);
              setPoints(id, (pts) => pts[i] && Object.assign(pts[i], next));
            }}
          />
        );
      })}
      {selIndex !== null && a[selIndex] && (['l', 'r'] as const).map((side) => {
        const h = sc(a[selIndex][side]);
        const same = Math.hypot(a[selIndex][side].x - a[selIndex].p.x, a[selIndex][side].y - a[selIndex].p.y) < 0.5;
        if (same) return null;
        return <div key={side} className="path-handle" style={{ left: h.x, top: h.y }} title="Drag to bend (Alt: move this side only)" onPointerDown={(e) => dragHandle(e, selIndex, side)} />;
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Properties panel

export function PathSection({ node }: { node: GuiNode }) {
  const pts = node.points ?? [];
  const scale = pts.length ? usesScale(pts[0]) : false;
  const box = node.parentId ? layoutNow().rects[node.parentId] : null;
  const convert = (toScale: boolean) => {
    if (!box) return;
    const a = anchorsOf(pts, box);
    S().update((d) => {
      d.nodes[node.id].points = a.map((x) => ({
        p: toUDim2({ x: x.p.x - box.x, y: x.p.y - box.y }, box, toScale),
        l: toUDim2({ x: x.l.x - x.p.x, y: x.l.y - x.p.y }, box, toScale),
        r: toUDim2({ x: x.r.x - x.p.x, y: x.r.y - x.p.y }, box, toScale),
      }));
    });
  };
  const allSmooth = (smooth: boolean) => {
    if (!box) return;
    S().update((d) => {
      const list = d.nodes[node.id].points ?? [];
      const source = structuredClone(list).map((p) => ({ ...p, l: ZERO2, r: ZERO2 }));
      list.forEach((pt, i) => Object.assign(pt, smooth ? toggledSmooth(source, i, box, !!node.props.Closed) : { l: ZERO2, r: ZERO2 }));
    });
  };
  return (
    <section className="section">
      <div className="section-title"><span>Points</span></div>
      <div className="section-body">
        <div className="hint">
          {pts.length} point{pts.length === 1 ? '' : 's'}, relative to {pathTo(S().doc.nodes, node.id).length > 1 ? S().doc.nodes[node.parentId!]?.name : 'the screen'}.
          Draw more with the Pen tool (P) while it's selected · drag points and handles · double-click a point for smooth / sharp · Delete removes the selected point.
        </div>
        <Row label="Units">
          <div className="ref-fit">
            <button className={`btn small ${scale ? '' : 'on'}`} onClick={() => convert(false)} title="Fixed pixels">Offset</button>
            <button className={`btn small ${scale ? 'on' : ''}`} onClick={() => convert(true)} title="Stretch with the parent">Scale</button>
          </div>
        </Row>
        <Row label="Corners">
          <div className="ref-fit">
            <button className="btn small" onClick={() => allSmooth(true)}>Smooth all</button>
            <button className="btn small" onClick={() => allSmooth(false)}>Sharp all</button>
          </div>
        </Row>
      </div>
    </section>
  );
}
