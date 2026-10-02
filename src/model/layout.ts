import { isGuiObject, isText, isWorldGui, TOPBAR_INSET } from './schema';
import { measureText, stripRichText } from './fonts';
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
  /** ScreenGuis clipped to the device's safe area (ClipToDeviceSafeArea): the clip rect */
  clips: Record<string, Rect>;
  /** Fullscreen elements stretched over the screen cut-outs (SafeAreaCompatibility): not clipped */
  unclipped: Set<string>;
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

/** Width kept free on each side of the top bar (its buttons) for TopbarSafeInsets */
const TOPBAR_SIDE = 112;

/** ScreenInsets in effect (IgnoreGuiInset turns CoreUISafeInsets into DeviceSafeInsets, like in Roblox) */
export function screenInsets(node: GuiNode): string {
  const mode: string = node.props.ScreenInsets ?? 'CoreUISafeInsets';
  return node.props.IgnoreGuiInset && mode === 'CoreUISafeInsets' ? 'DeviceSafeInsets' : mode;
}

/** The device's safe area (inside the notch / home bar) */
export function safeArea(device: Device): Rect {
  const s = device.safe ?? { l: 0, t: 0, r: 0, b: 0 };
  return { x: s.l, y: s.t, w: device.w - s.l - s.r, h: device.h - s.t - s.b };
}

/** The area a ScreenGui's contents are laid out in (ScreenInsets) */
export function screenRect(node: GuiNode, device: Device): Rect {
  const safe = safeArea(device);
  switch (screenInsets(node)) {
    case 'None':
      return { x: 0, y: 0, w: device.w, h: device.h };
    case 'DeviceSafeInsets':
      return safe;
    case 'TopbarSafeInsets':
      return { x: safe.x + TOPBAR_SIDE, y: safe.y, w: Math.max(0, safe.w - 2 * TOPBAR_SIDE), h: TOPBAR_INSET };
    default:
      // CoreUISafeInsets: below the top bar, inside the safe area
      return { x: safe.x, y: safe.y + TOPBAR_INSET, w: safe.w, h: Math.max(0, safe.h - TOPBAR_INSET) };
  }
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

/**
 * @param origins canvas offset of each ScreenGui (screens side by side in the editor); unset = all at 0,0 like in game
 */
export function computeLayout(nodes: Record<string, GuiNode>, rootIds: string[], device: Device, origins?: Record<string, { x: number; y: number }>): LayoutResult {
  const res: LayoutResult = { rects: {}, content: {}, canvas: {}, laidOut: new Set(), artboards: {}, clips: {}, unclipped: new Set() };
  const tableCells = new Set<string>();

  const layoutChildren = (pid: string, canvasOverride?: Vec2) => {
    const parent = nodes[pid];
    const R = res.rects[pid];
    let base = R;
    if (parent.className === 'ScrollingFrame') {
      const pp = parent.props;
      const cs: UDim2 = pp.CanvasSize;
      const cp: Vec2 = pp.CanvasPosition ?? { x: 0, y: 0 };
      // Vertical/HorizontalScrollBarInset: the canvas leaves room for the scroll bar (always, or when it shows)
      const t = pp.ScrollBarThickness ?? 0;
      const dir: string = pp.ScrollingDirection ?? 'XY';
      const scrollsY = dir !== 'X' && (canvasOverride?.y ?? resolve(cs.y, R.h)) > R.h + 0.5;
      const scrollsX = dir !== 'Y' && (canvasOverride?.x ?? resolve(cs.x, R.w)) > R.w + 0.5;
      const insetX = pp.VerticalScrollBarInset === 'Always' || (pp.VerticalScrollBarInset === 'ScrollBar' && scrollsY) ? t : 0;
      const insetY = pp.HorizontalScrollBarInset === 'Always' || (pp.HorizontalScrollBarInset === 'ScrollBar' && scrollsX) ? t : 0;
      const vw = R.w - insetX;
      const vh = R.h - insetY;
      const cw = canvasOverride?.x ?? Math.max(resolve(cs.x, vw), vw);
      const ch = canvasOverride?.y ?? Math.max(resolve(cs.y, vh), vh);
      const left = pp.VerticalScrollBarPosition === 'Left' ? insetX : 0;
      base = { x: R.x - cp.x + left, y: R.y - cp.y, w: cw, h: ch };
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

    // cells of a UITableLayout were placed by the table (their row's own layout leaves them alone)
    const kids = parent.children.filter((c) => nodes[c] && isGuiObject(nodes[c].className) && !tableCells.has(c));
    const list = findChild(nodes, pid, 'UIListLayout');
    const grid = list ? undefined : findChild(nodes, pid, 'UIGridLayout');
    const pages = list || grid ? undefined : findChild(nodes, pid, 'UIPageLayout');
    const table = list || grid || pages ? undefined : findChild(nodes, pid, 'UITableLayout');

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
      const n = nodes[id];
      const s: UDim2 = n.props.Size;
      // SizeConstraint: which side of the parent the Scale parts are measured against
      const sc: string = n.props.SizeConstraint ?? 'RelativeXY';
      let w = resolve(s.x, sc === 'RelativeYY' ? C.h : C.w);
      let h = resolve(s.y, sc === 'RelativeXX' ? C.w : C.h);
      const auto: string = n.props.AutomaticSize ?? 'None';
      if (auto !== 'None') [w, h] = autoGrow(id, w, h, auto);
      return constrain(nodes, id, w, h);
    };

    if (list) {
      const visible = sortChildren(nodes, kids.filter((k) => nodes[k].props.Visible !== false), list.props.SortOrder);
      layoutList(nodes, list, visible, visible.map(sizeOf), C, res);
      for (const k of kids) if (!res.rects[k]) place(k, ...sizeOf(k));
    } else if (pages) {
      const visible = sortChildren(nodes, kids.filter((k) => nodes[k].props.Visible !== false), pages.props.SortOrder);
      layoutPages(pages, visible, visible.map(sizeOf), C, res);
      for (const k of kids) if (!res.rects[k]) place(k, ...sizeOf(k));
    } else if (table) {
      const visible = sortChildren(nodes, kids.filter((k) => nodes[k].props.Visible !== false), table.props.SortOrder);
      layoutTable(nodes, table, visible, C, res, tableCells);
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

  /**
   * AutomaticSize: grow the element (never shrink it) to fit its text and children, on the X and/or Y axis.
   * Children are laid out once at the element's own size to measure them.
   */
  const autoGrow = (id: string, w: number, h: number, auto: string): [number, number] => {
    const n = nodes[id];
    const pad = findChild(nodes, id, 'UIPadding');
    const pl = pad ? resolve(pad.props.PaddingLeft, w) : 0;
    const pr = pad ? resolve(pad.props.PaddingRight, w) : 0;
    const pt = pad ? resolve(pad.props.PaddingTop, h) : 0;
    const pb = pad ? resolve(pad.props.PaddingBottom, h) : 0;
    let needW = 0;
    let needH = 0;
    const p = n.props;
    if (isText(n.className) && !p.TextScaled && p.Text) {
      const text = p.RichText ? stripRichText(p.Text) : p.Text;
      // grows sideways: one line per paragraph; only taller: wrap at the current width
      const wrapAt = auto === 'Y' && p.TextWrapped ? Math.max(1, w - pl - pr) : null;
      const m = measureText(text, p.FontFace, p.TextSize, p.LineHeight ?? 1, wrapAt);
      needW = m.w + pl + pr;
      needH = m.h + pt + pb;
    }
    const kids = n.children.filter((c) => nodes[c] && isGuiObject(nodes[c].className) && nodes[c].props.Visible !== false);
    if (kids.length) {
      const saved = res.rects[id];
      res.rects[id] = { x: 0, y: 0, w, h };
      layoutChildren(id);
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const k of kids) {
        const r = res.rects[k];
        if (!r) continue;
        minX = Math.min(minX, r.x);
        minY = Math.min(minY, r.y);
        maxX = Math.max(maxX, r.x + r.w);
        maxY = Math.max(maxY, r.y + r.h);
      }
      if (maxX > -Infinity) {
        needW = Math.max(needW, maxX - Math.min(minX, pl) + pr);
        needH = Math.max(needH, maxY - Math.min(minY, pt) + pb);
      }
      if (saved) res.rects[id] = saved;
      else delete res.rects[id];
    }
    return [auto.includes('X') ? Math.max(w, needW) : w, auto.includes('Y') ? Math.max(h, needH) : h];
  };

  // world GUIs without a saved position line up to the right of the screens
  let autoX = Math.max(0, ...Object.values(origins ?? {}).map((o) => o.x)) + device.w + 160;
  for (const rid of rootIds) {
    const root = nodes[rid];
    if (!root) continue;
    if (isWorldGui(root.className)) {
      const { w, h } = worldGuiSize(root);
      const pos = root.artboard ?? { x: autoX, y: 0 };
      if (!root.artboard) autoX += w + 120;
      res.artboards[rid] = res.rects[rid] = { x: pos.x, y: pos.y, w, h };
    } else {
      const r = screenRect(root, device);
      const o = origins?.[rid] ?? { x: 0, y: 0 };
      res.rects[rid] = { ...r, x: r.x + o.x, y: r.y + o.y };
    }
    layoutChildren(rid);
    if (root.className === 'ScreenGui' && device.safe) {
      const o = origins?.[rid] ?? { x: 0, y: 0 };
      const s = safeArea(device);
      const safe = { ...s, x: s.x + o.x, y: s.y + o.y };
      const mode = screenInsets(root);
      // ClipToDeviceSafeArea (ignored with ScreenInsets None)
      if (root.props.ClipToDeviceSafeArea !== false && mode !== 'None') res.clips[rid] = safe;
      // SafeAreaCompatibility: a fullscreen element (covering the safe area) is stretched over the cut-outs
      if ((root.props.SafeAreaCompatibility ?? 'FullscreenExtension') === 'FullscreenExtension') {
        for (const k of root.children) {
          const kr = res.rects[k];
          if (!kr || !isGuiObject(nodes[k]?.className) || nodes[k].props.Visible === false) continue;
          const covers = kr.x <= safe.x + 0.5 && kr.y <= safe.y + 0.5 && kr.x + kr.w >= safe.x + safe.w - 0.5 && kr.y + kr.h >= safe.y + safe.h - 0.5;
          if (!covers) continue;
          res.rects[k] = { x: o.x, y: o.y, w: device.w, h: device.h };
          res.unclipped.add(k);
          layoutChildren(k);
        }
      }
    }
  }
  return res;
}

// ---------------------------------------------------------------------------
// UIListLayout with flex (HorizontalFlex / VerticalFlex / Wraps / ItemLineAlignment + UIFlexItem)

const START = new Set(['Left', 'Top']);
const END = new Set(['Right', 'Bottom']);

function layoutList(nodes: Record<string, GuiNode>, list: GuiNode, ids: string[], sizes: [number, number][], C: Rect, res: LayoutResult) {
  const lp = list.props;
  const vertical = lp.FillDirection === 'Vertical';
  const pad = resolve(lp.Padding, vertical ? C.h : C.w);
  const mainLen = vertical ? C.h : C.w;
  const crossLen = vertical ? C.w : C.h;
  const mainFlex: string = (vertical ? lp.VerticalFlex : lp.HorizontalFlex) ?? 'None';
  const crossFlex: string = (vertical ? lp.HorizontalFlex : lp.VerticalFlex) ?? 'None';
  const mainAlign: string = vertical ? lp.VerticalAlignment : lp.HorizontalAlignment;
  const crossAlign: string = vertical ? lp.HorizontalAlignment : lp.VerticalAlignment;
  const items = ids.map((id, i) => {
    const flex = findChild(nodes, id, 'UIFlexItem');
    const [w, h] = sizes[i];
    let mode: string = flex?.props.FlexMode ?? 'None';
    if (mode === 'None' && mainFlex === 'Fill') mode = 'Fill';
    const grow = mode === 'Grow' || mode === 'Fill' ? 1 : mode === 'Custom' ? (flex?.props.GrowRatio ?? 0) : 0;
    const shrink = mode === 'Shrink' || mode === 'Fill' ? 1 : mode === 'Custom' ? (flex?.props.ShrinkRatio ?? 0) : 0;
    const own: string = flex?.props.ItemLineAlignment ?? 'Automatic';
    return { id, main: vertical ? h : w, cross: vertical ? w : h, grow, shrink, align: own !== 'Automatic' ? own : (lp.ItemLineAlignment ?? 'Automatic') };
  });

  // lines (one, unless Wraps and the items don't fit)
  const lines: (typeof items)[] = [];
  let line: typeof items = [];
  let used = 0;
  for (const it of items) {
    if (lp.Wraps && line.length && used + pad + it.main > mainLen + 0.01) {
      lines.push(line);
      line = [];
      used = 0;
    }
    used += (line.length ? pad : 0) + it.main;
    line.push(it);
  }
  if (line.length) lines.push(line);

  // cross size of each line: the whole box for a single line, else the tallest item
  const single = lines.length <= 1 && !lp.Wraps;
  const lineCross = lines.map((l) => (single ? crossLen : Math.max(0, ...l.map((it) => it.cross))));
  const totalCross = lineCross.reduce((a, b) => a + b, 0) + pad * Math.max(0, lines.length - 1);
  let crossStart = 0;
  let crossGap = pad;
  if (!single) {
    const free = crossLen - totalCross;
    const n = lines.length;
    if (crossFlex === 'Fill' && free > 0) lineCross.forEach((_, i) => (lineCross[i] += free / n));
    else if (crossFlex === 'SpaceBetween' && n > 1) crossGap = pad + Math.max(0, free) / (n - 1);
    else if (crossFlex === 'SpaceAround') [crossGap, crossStart] = [pad + Math.max(0, free) / n, Math.max(0, free) / n / 2];
    else if (crossFlex === 'SpaceEvenly') [crossGap, crossStart] = [pad + Math.max(0, free) / (n + 1), Math.max(0, free) / (n + 1)];
    else crossStart = crossAlign === 'Center' ? free / 2 : END.has(crossAlign) ? free : 0;
  }

  let crossPos = (vertical ? C.x : C.y) + crossStart;
  lines.forEach((l, li) => {
    const sizesMain = l.map((it) => it.main);
    let free = mainLen - sizesMain.reduce((a, b) => a + b, 0) - pad * Math.max(0, l.length - 1);
    // grow / shrink by ratio
    const g = l.reduce((a, it) => a + it.grow, 0);
    const s = l.reduce((a, it) => a + it.shrink, 0);
    if (free > 0 && g > 0) {
      l.forEach((it, i) => (sizesMain[i] += (free * it.grow) / g));
      free = 0;
    } else if (free < 0 && s > 0) {
      l.forEach((it, i) => (sizesMain[i] = Math.max(0, sizesMain[i] + (free * it.shrink) / s)));
      free = 0;
    }
    let start = 0;
    let gap = pad;
    const n = l.length;
    if (mainFlex === 'SpaceBetween' && n > 1 && free > 0) gap = pad + free / (n - 1);
    else if (mainFlex === 'SpaceAround' && free > 0) [gap, start] = [pad + free / n, free / n / 2];
    else if (mainFlex === 'SpaceEvenly' && free > 0) [gap, start] = [pad + free / (n + 1), free / (n + 1)];
    else start = mainAlign === 'Center' ? free / 2 : END.has(mainAlign) ? free : 0;
    let cursor = (vertical ? C.y : C.x) + start;
    const lc = lineCross[li];
    l.forEach((it, i) => {
      const align = it.align === 'Automatic' ? (crossAlign === 'Center' ? 'Center' : END.has(crossAlign) ? 'End' : START.has(crossAlign) ? 'Start' : 'Start') : it.align;
      const crossSize = align === 'Stretch' ? lc : it.cross;
      const c = crossPos + (align === 'Center' ? (lc - crossSize) / 2 : align === 'End' ? lc - crossSize : 0);
      const m = sizesMain[i];
      res.rects[it.id] = vertical ? { x: c, y: cursor, w: crossSize, h: m } : { x: cursor, y: c, w: m, h: crossSize };
      res.laidOut.add(it.id);
      cursor += m + gap;
    });
    crossPos += lc + crossGap;
  });
}

// ---------------------------------------------------------------------------
// UIPageLayout: pages side by side along FillDirection, scrolled so the current page sits in place

function layoutPages(pages: GuiNode, ids: string[], sizes: [number, number][], C: Rect, res: LayoutResult) {
  const p = pages.props;
  const vertical = p.FillDirection === 'Vertical';
  const pad = resolve(p.Padding, vertical ? C.h : C.w);
  // __page: Preview's (animated, fractional) page; page: the one picked in the editor
  const n = ids.length;
  const cur = Math.max(0, Math.min(n - 1, (p.__page as number | undefined) ?? pages.page ?? 0));
  const starts: number[] = [];
  let acc = 0;
  ids.forEach((_, i) => {
    starts.push(acc);
    acc += (vertical ? sizes[i][1] : sizes[i][0]) + pad;
  });
  const i0 = Math.floor(cur);
  const frac = cur - i0;
  const startOf = (i: number) => starts[Math.min(n - 1, i)] ?? 0;
  const scroll = startOf(i0) + (startOf(i0 + 1) - startOf(i0)) * frac;
  const curSize = sizes[Math.min(n - 1, Math.round(cur))] ?? [0, 0];
  const mainLen = vertical ? C.h : C.w;
  const crossLen = vertical ? C.w : C.h;
  const mainAlign: string = vertical ? p.VerticalAlignment : p.HorizontalAlignment;
  const crossAlign: string = vertical ? p.HorizontalAlignment : p.VerticalAlignment;
  const curMain = vertical ? curSize[1] : curSize[0];
  const origin = (vertical ? C.y : C.x) + (mainAlign === 'Center' ? (mainLen - curMain) / 2 : END.has(mainAlign) ? mainLen - curMain : 0) - scroll;
  ids.forEach((id, i) => {
    const [w, h] = sizes[i];
    const cs = vertical ? w : h;
    const c = (vertical ? C.x : C.y) + (crossAlign === 'Center' ? (crossLen - cs) / 2 : END.has(crossAlign) ? crossLen - cs : 0);
    const m = origin + starts[i];
    res.rects[id] = vertical ? { x: c, y: m, w, h } : { x: m, y: c, w, h };
    res.laidOut.add(id);
  });
}

// ---------------------------------------------------------------------------
// UITableLayout: children are rows (RowMajor) or columns (ColumnMajor); their children are the cells

function layoutTable(nodes: Record<string, GuiNode>, table: GuiNode, lines: string[], C: Rect, res: LayoutResult, cells: Set<string>) {
  const p = table.props;
  const rowMajor = p.MajorAxis !== 'ColumnMajor';
  const padX = resolve(p.Padding.x, C.w);
  const padY = resolve(p.Padding.y, C.h);
  const grid = lines.map((l) => sortChildren(nodes, nodes[l].children.filter((c) => nodes[c] && isGuiObject(nodes[c].className) && nodes[c].props.Visible !== false), p.SortOrder));
  const sizeIn = (id: string): [number, number] => {
    const s: UDim2 = nodes[id].props.Size;
    return constrain(nodes, id, resolve(s.x, C.w), resolve(s.y, C.h));
  };
  const nRows = rowMajor ? lines.length : Math.max(0, ...grid.map((g) => g.length));
  const nCols = rowMajor ? Math.max(0, ...grid.map((g) => g.length)) : lines.length;
  const colW = new Array(nCols).fill(0);
  const rowH = new Array(nRows).fill(0);
  grid.forEach((g, li) =>
    g.forEach((cell, ci) => {
      const [w, h] = sizeIn(cell);
      const r = rowMajor ? li : ci;
      const c = rowMajor ? ci : li;
      colW[c] = Math.max(colW[c], w);
      rowH[r] = Math.max(rowH[r], h);
    }),
  );
  // lines with no cells keep their own size along the major axis
  lines.forEach((l, li) => {
    if (grid[li].length) return;
    const [w, h] = sizeIn(l);
    if (rowMajor) rowH[li] = Math.max(rowH[li] ?? 0, h);
    else colW[li] = Math.max(colW[li] ?? 0, w);
  });
  const sum = (a: number[], gap: number) => a.reduce((x, y) => x + y, 0) + gap * Math.max(0, a.length - 1);
  if (p.FillEmptySpaceColumns && nCols) {
    const extra = C.w - sum(colW, padX);
    if (extra > 0) colW.forEach((_, i) => (colW[i] += extra / nCols));
  }
  if (p.FillEmptySpaceRows && nRows) {
    const extra = C.h - sum(rowH, padY);
    if (extra > 0) rowH.forEach((_, i) => (rowH[i] += extra / nRows));
  }
  const tw = sum(colW, padX);
  const th = sum(rowH, padY);
  const ha: string = p.HorizontalAlignment;
  const va: string = p.VerticalAlignment;
  const x0 = C.x + (ha === 'Center' ? (C.w - tw) / 2 : ha === 'Right' ? C.w - tw : 0);
  const y0 = C.y + (va === 'Center' ? (C.h - th) / 2 : va === 'Bottom' ? C.h - th : 0);
  const colX = colW.map((_, i) => x0 + colW.slice(0, i).reduce((a, b) => a + b + padX, 0));
  const rowY = rowH.map((_, i) => y0 + rowH.slice(0, i).reduce((a, b) => a + b + padY, 0));
  lines.forEach((l, li) => {
    res.rects[l] = rowMajor ? { x: x0, y: rowY[li] ?? y0, w: tw, h: rowH[li] ?? 0 } : { x: colX[li] ?? x0, y: y0, w: colW[li] ?? 0, h: th };
    res.laidOut.add(l);
    grid[li].forEach((cell, ci) => {
      const r = rowMajor ? li : ci;
      const c = rowMajor ? ci : li;
      res.rects[cell] = { x: colX[c], y: rowY[r], w: colW[c], h: rowH[r] };
      res.laidOut.add(cell);
      cells.add(cell);
    });
  });
}
