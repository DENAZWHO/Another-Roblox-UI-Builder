import { isGuiObject, isWorldGui, TOPBAR_INSET } from './schema';
import type { ClassName, Device, GuiNode, Rect, UDim, UDim2, Vec2 } from './types';

export interface LayoutResult {
  /** Absolute (unrotated) rect of every ScreenGui / GuiObject, in screen pixels */
  rects: Record<string, Rect>;
  /** Rect that children of a node are positioned against (after UIPadding / scrolling canvas) */
  content: Record<string, Rect>;
  /** Absolute canvas rect of ScrollingFrames */
  canvas: Record<string, Rect>;
  /** Nodes whose position is controlled by a UIListLayout / UIGridLayout */
  laidOut: Set<string>;
  /** BillboardGui / SurfaceGui artboards (canvas coordinates) */
  artboards: Record<string, Rect>;
}

export const DEFAULT_PREVIEW_PPS = 50;

/** Pixel size a world GUI is designed at (its artboard size) */
export function worldGuiSize(node: GuiNode): { w: number; h: number } {
  const p = node.props;
  if (node.className === 'BillboardGui') {
    const pps = node.previewPPS ?? DEFAULT_PREVIEW_PPS;
    const s: UDim2 = p.Size;
    return { w: Math.max(1, s.x.s * pps + s.x.o), h: Math.max(1, s.y.s * pps + s.y.o) };
  }
  if (p.SizingMode === 'PixelsPerStud') {
    const studs = node.previewStuds ?? { x: 8, y: 6 };
    return { w: Math.max(1, studs.x * p.PixelsPerStud), h: Math.max(1, studs.y * p.PixelsPerStud) };
  }
  return { w: Math.max(1, p.CanvasSize.x), h: Math.max(1, p.CanvasSize.y) };
}

export const resolve = (u: UDim, len: number) => u.s * len + u.o;

export function findChild(nodes: Record<string, GuiNode>, id: string, cls: ClassName): GuiNode | undefined {
  const n = nodes[id];
  if (!n) return undefined;
  for (const c of n.children) if (nodes[c]?.className === cls) return nodes[c];
  return undefined;
}

export function screenRect(node: GuiNode, device: Device): Rect {
  if (node.props.IgnoreGuiInset) return { x: 0, y: 0, w: device.w, h: device.h };
  return { x: 0, y: TOPBAR_INSET, w: device.w, h: device.h - TOPBAR_INSET };
}

function constrain(nodes: Record<string, GuiNode>, id: string, w: number, h: number): [number, number] {
  const sc = findChild(nodes, id, 'UISizeConstraint');
  if (sc) {
    const mn: Vec2 = sc.props.MinSize;
    const mx: Vec2 = sc.props.MaxSize;
    w = Math.min(Math.max(w, mn.x), mx.x ?? Infinity);
    h = Math.min(Math.max(h, mn.y), mx.y ?? Infinity);
  }
  const ar = findChild(nodes, id, 'UIAspectRatioConstraint');
  if (ar) {
    const r = Math.max(0.0001, ar.props.AspectRatio);
    if (ar.props.AspectType === 'ScaleWithParentSize') {
      if (ar.props.DominantAxis === 'Height') w = h * r;
      else h = w / r;
    } else if (w / Math.max(h, 0.0001) > r) w = h * r;
    else h = w / r;
  }
  return [w, h];
}

function sortChildren(nodes: Record<string, GuiNode>, ids: string[], order: string) {
  const idx = new Map(ids.map((id, i) => [id, i]));
  const arr = [...ids];
  if (order === 'Name') arr.sort((a, b) => nodes[a].name.localeCompare(nodes[b].name) || idx.get(a)! - idx.get(b)!);
  else if (order === 'LayoutOrder') arr.sort((a, b) => (nodes[a].props.LayoutOrder ?? 0) - (nodes[b].props.LayoutOrder ?? 0) || idx.get(a)! - idx.get(b)!);
  return arr;
}

export function computeLayout(nodes: Record<string, GuiNode>, rootIds: string[], device: Device): LayoutResult {
  const res: LayoutResult = { rects: {}, content: {}, canvas: {}, laidOut: new Set(), artboards: {} };

  const layoutChildren = (pid: string, canvasOverride?: Vec2) => {
    const parent = nodes[pid];
    const R = res.rects[pid];
    let base = R;
    if (parent.className === 'ScrollingFrame') {
      const cs: UDim2 = parent.props.CanvasSize;
      const cp: Vec2 = parent.props.CanvasPosition ?? { x: 0, y: 0 };
      const cw = canvasOverride?.x ?? Math.max(resolve(cs.x, R.w), R.w);
      const ch = canvasOverride?.y ?? Math.max(resolve(cs.y, R.h), R.h);
      base = { x: R.x - cp.x, y: R.y - cp.y, w: cw, h: ch };
      res.canvas[pid] = base;
    }
    let C = base;
    const pad = findChild(nodes, pid, 'UIPadding');
    if (pad) {
      const l = resolve(pad.props.PaddingLeft, base.w);
      const r = resolve(pad.props.PaddingRight, base.w);
      const t = resolve(pad.props.PaddingTop, base.h);
      const b = resolve(pad.props.PaddingBottom, base.h);
      C = { x: base.x + l, y: base.y + t, w: base.w - l - r, h: base.h - t - b };
    }
    res.content[pid] = C;

    const kids = parent.children.filter((c) => nodes[c] && isGuiObject(nodes[c].className));
    const list = findChild(nodes, pid, 'UIListLayout');
    const grid = list ? undefined : findChild(nodes, pid, 'UIGridLayout');

    // default positioning
    const place = (id: string, w: number, h: number) => {
      const n = nodes[id];
      const pos: UDim2 = n.props.Position;
      const a: Vec2 = n.props.AnchorPoint;
      res.rects[id] = {
        x: C.x + resolve(pos.x, C.w) - a.x * w,
        y: C.y + resolve(pos.y, C.h) - a.y * h,
        w, h,
      };
    };
    const sizeOf = (id: string): [number, number] => {
      const s: UDim2 = nodes[id].props.Size;
      return constrain(nodes, id, resolve(s.x, C.w), resolve(s.y, C.h));
    };

    if (list) {
      const vertical = list.props.FillDirection === 'Vertical';
      const padPx = resolve(list.props.Padding, vertical ? C.h : C.w);
      const visible = sortChildren(nodes, kids.filter((k) => nodes[k].props.Visible !== false), list.props.SortOrder);
      const sizes = visible.map(sizeOf);
      const total = sizes.reduce((acc, [w, h]) => acc + (vertical ? h : w), 0) + padPx * Math.max(0, visible.length - 1);
      const mainAlign = vertical ? list.props.VerticalAlignment : list.props.HorizontalAlignment;
      const mainLen = vertical ? C.h : C.w;
      let cursor = (vertical ? C.y : C.x) + (mainAlign === 'Center' ? (mainLen - total) / 2 : mainAlign === 'Bottom' || mainAlign === 'Right' ? mainLen - total : 0);
      visible.forEach((id, i) => {
        const [w, h] = sizes[i];
        const crossAlign = vertical ? list.props.HorizontalAlignment : list.props.VerticalAlignment;
        const crossLen = vertical ? C.w : C.h;
        const crossSize = vertical ? w : h;
        const cross = (vertical ? C.x : C.y) + (crossAlign === 'Center' ? (crossLen - crossSize) / 2 : crossAlign === 'Right' || crossAlign === 'Bottom' ? crossLen - crossSize : 0);
        res.rects[id] = vertical ? { x: cross, y: cursor, w, h } : { x: cursor, y: cross, w, h };
        cursor += (vertical ? h : w) + padPx;
        res.laidOut.add(id);
      });
      for (const k of kids) if (!res.rects[k]) place(k, ...sizeOf(k));
    } else if (grid) {
      const cell: UDim2 = grid.props.CellSize;
      const cpad: UDim2 = grid.props.CellPadding;
      const cw = resolve(cell.x, C.w);
      const ch = resolve(cell.y, C.h);
      const px = resolve(cpad.x, C.w);
      const py = resolve(cpad.y, C.h);
      const horizontal = grid.props.FillDirection !== 'Vertical';
      const maxCells = grid.props.FillDirectionMaxCells ?? 0;
      const visible = sortChildren(nodes, kids.filter((k) => nodes[k].props.Visible !== false), grid.props.SortOrder);
      const n = visible.length;
      let per = horizontal ? Math.floor((C.w + px) / Math.max(1, cw + px)) : Math.floor((C.h + py) / Math.max(1, ch + py));
      per = Math.max(1, per);
      if (maxCells > 0) per = Math.min(per, maxCells);
      const lines = Math.ceil(n / per);
      const cols = horizontal ? Math.min(n, per) : lines;
      const rows = horizontal ? lines : Math.min(n, per);
      const blockW = cols * cw + Math.max(0, cols - 1) * px;
      const blockH = rows * ch + Math.max(0, rows - 1) * py;
      const ha = grid.props.HorizontalAlignment;
      const va = grid.props.VerticalAlignment;
      const bx = C.x + (ha === 'Center' ? (C.w - blockW) / 2 : ha === 'Right' ? C.w - blockW : 0);
      const by = C.y + (va === 'Center' ? (C.h - blockH) / 2 : va === 'Bottom' ? C.h - blockH : 0);
      const sc: string = grid.props.StartCorner ?? 'TopLeft';
      visible.forEach((id, i) => {
        let col = horizontal ? i % per : Math.floor(i / per);
        let row = horizontal ? Math.floor(i / per) : i % per;
        if (sc.endsWith('Right')) col = cols - 1 - col;
        if (sc.startsWith('Bottom')) row = rows - 1 - row;
        res.rects[id] = { x: bx + col * (cw + px), y: by + row * (ch + py), w: cw, h: ch };
        res.laidOut.add(id);
      });
      for (const k of kids) if (!res.rects[k]) place(k, ...sizeOf(k));
    } else {
      for (const k of kids) place(k, ...sizeOf(k));
    }

    for (const k of kids) layoutChildren(k);

    // AutomaticCanvasSize: grow the canvas to fit content, then lay out once more
    if (parent.className === 'ScrollingFrame' && !canvasOverride && parent.props.AutomaticCanvasSize && parent.props.AutomaticCanvasSize !== 'None') {
      const mode: string = parent.props.AutomaticCanvasSize;
      let maxX = 0;
      let maxY = 0;
      for (const k of kids) {
        if (nodes[k].props.Visible === false) continue;
        const r = res.rects[k];
        maxX = Math.max(maxX, r.x + r.w - base.x);
        maxY = Math.max(maxY, r.y + r.h - base.y);
      }
      if (pad) {
        maxX += resolve(pad.props.PaddingRight, base.w);
        maxY += resolve(pad.props.PaddingBottom, base.h);
      }
      const cs: UDim2 = parent.props.CanvasSize;
      const next = {
        x: mode.includes('X') ? Math.max(R.w, maxX, resolve(cs.x, R.w)) : base.w,
        y: mode.includes('Y') ? Math.max(R.h, maxY, resolve(cs.y, R.h)) : base.h,
      };
      if (Math.abs(next.x - base.w) > 0.5 || Math.abs(next.y - base.h) > 0.5) layoutChildren(pid, next);
    }
  };

  // world GUIs without a saved position line up to the right of the screen
  let autoX = device.w + 160;
  for (const rid of rootIds) {
    const root = nodes[rid];
    if (!root) continue;
    if (isWorldGui(root.className)) {
      const { w, h } = worldGuiSize(root);
      const pos = root.artboard ?? { x: autoX, y: 0 };
      if (!root.artboard) autoX += w + 120;
      res.artboards[rid] = res.rects[rid] = { x: pos.x, y: pos.y, w, h };
    } else {
      res.rects[rid] = screenRect(root, device);
    }
    layoutChildren(rid);
  }
  return res;
}
