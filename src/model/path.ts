// Path2D: a line / curve drawn in its parent's space. Each control point has a position and two
// tangent handles (UDim2s, relative to the parent's size); segments are cubic Béziers between points.
import type { PathPoint, Rect, UDim, UDim2, Vec2 } from './types';

const res = (u: UDim, len: number) => u.s * len + u.o;
export const ZERO2: UDim2 = { x: { s: 0, o: 0 }, y: { s: 0, o: 0 } };

/** A point's absolute position and its handles' absolute positions, inside the parent box */
export function anchorsOf(points: PathPoint[], box: Rect): { p: Vec2; l: Vec2; r: Vec2 }[] {
  return points.map((pt) => {
    const p = { x: box.x + res(pt.p.x, box.w), y: box.y + res(pt.p.y, box.h) };
    return {
      p,
      l: { x: p.x + res(pt.l.x, box.w), y: p.y + res(pt.l.y, box.h) },
      r: { x: p.x + res(pt.r.x, box.w), y: p.y + res(pt.r.y, box.h) },
    };
  });
}

/** SVG path data (absolute coordinates, offset by `origin`) */
export function pathData(points: PathPoint[], box: Rect, closed: boolean, origin: Vec2 = { x: 0, y: 0 }): string {
  const a = anchorsOf(points, box);
  if (!a.length) return '';
  const f = (v: Vec2) => `${(v.x - origin.x).toFixed(2)} ${(v.y - origin.y).toFixed(2)}`;
  let d = `M ${f(a[0].p)}`;
  const seg = (i: number, j: number) => ` C ${f(a[i].r)} ${f(a[j].l)} ${f(a[j].p)}`;
  for (let i = 0; i + 1 < a.length; i++) d += seg(i, i + 1);
  if (closed && a.length > 2) d += seg(a.length - 1, 0) + ' Z';
  return d;
}

/** A pixel offset as a UDim, in scale or offset like `like` (or as asked) */
export function toUDim(px: number, len: number, scale: boolean): UDim {
  return scale ? { s: +(px / Math.max(1, len)).toFixed(5), o: 0 } : { s: 0, o: Math.round(px * 100) / 100 };
}
export const toUDim2 = (v: Vec2, box: Rect, scale: boolean): UDim2 => ({ x: toUDim(v.x, box.w, scale), y: toUDim(v.y, box.h, scale) });
/** Does this point use Scale (so it stretches with the parent)? */
export const usesScale = (pt: PathPoint) => pt.p.x.s !== 0 || pt.p.y.s !== 0;

/** Smooth handles for point i (pointing along its neighbours), or none when it's already smooth */
export function toggledSmooth(points: PathPoint[], i: number, box: Rect, closed: boolean): Pick<PathPoint, 'l' | 'r'> {
  const pt = points[i];
  const isSharp = [pt.l, pt.r].every((u) => u.x.s === 0 && u.x.o === 0 && u.y.s === 0 && u.y.o === 0);
  if (!isSharp) return { l: ZERO2, r: ZERO2 };
  const a = anchorsOf(points, box);
  const n = a.length;
  const prev = a[i - 1] ?? (closed ? a[n - 1] : a[i]);
  const next = a[i + 1] ?? (closed ? a[0] : a[i]);
  const dx = (next.p.x - prev.p.x) / 4;
  const dy = (next.p.y - prev.p.y) / 4;
  const scale = usesScale(pt);
  return { r: toUDim2({ x: dx, y: dy }, box, scale), l: toUDim2({ x: -dx, y: -dy }, box, scale) };
}
