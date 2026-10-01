import { useStore } from '../store';
import { layoutNow } from '../actions';
import { unionRect } from '../model/doc';
import type { Rect } from '../model/types';

export const viewport = { w: 1200, h: 800 };

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 16;

export function zoomAt(z: number, sx = viewport.w / 2, sy = viewport.h / 2) {
  const { zoom, pan } = useStore.getState();
  const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
  const wx = (sx - pan.x) / zoom;
  const wy = (sy - pan.y) / zoom;
  useStore.setState({ zoom: nz, pan: { x: sx - wx * nz, y: sy - wy * nz } });
}

export function zoomToRect(r: Rect, padding = 60, maxZoom = 1) {
  const z = Math.min(maxZoom, (viewport.w - padding * 2) / Math.max(1, r.w), (viewport.h - padding * 2) / Math.max(1, r.h));
  const nz = Math.max(MIN_ZOOM, z);
  useStore.setState({ zoom: nz, pan: { x: viewport.w / 2 - (r.x + r.w / 2) * nz, y: viewport.h / 2 - (r.y + r.h / 2) * nz } });
}

/** Fit the device screen plus every BillboardGui / SurfaceGui artboard */
export function zoomToFit() {
  const { device } = useStore.getState().doc;
  const boards = Object.values(layoutNow().artboards);
  zoomToRect(unionRect([{ x: 0, y: 0, w: device.w, h: device.h }, ...boards.map((r) => ({ ...r, y: r.y - 30 }))]), 48, 2);
}

export function zoomToSelection() {
  const s = useStore.getState();
  const lay = layoutNow();
  const rects = s.selection.map((id) => lay.rects[id]).filter(Boolean);
  if (!rects.length) return zoomToFit();
  zoomToRect(unionRect(rects), 80, 4);
}
