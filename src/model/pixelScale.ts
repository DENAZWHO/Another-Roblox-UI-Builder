// "Pixel scaling": Roblox draws UIStroke thickness, text size, UICorner radius, padding, etc. in
// pixels, so on a smaller screen they look relatively bigger than Scale-based sizes. When enabled,
// those values are multiplied by  min(screenW / designW, screenH / designH)  so the whole UI shrinks
// or grows like a picture of the design. The same rule runs in the editor, in the exported LocalScript
// (export/behavior.ts) and live in Studio edit mode (studio-plugin/UIBuilderSync.lua).
import { descendants } from './doc';
import { isText } from './schema';
import type { Device, Doc, GuiNode, UDim, UDim2 } from './types';

export const DEFAULT_DESIGN = { w: 1920, h: 1080 };

export const designSize = (doc: Doc) => doc.designSize ?? { w: doc.device.w, h: doc.device.h };
export const pixelScaleOn = (doc: Doc) => doc.scalePixels !== false;

export function pixelScaleFactor(doc: Doc, device: Device = doc.device): number {
  if (!pixelScaleOn(doc)) return 1;
  const d = designSize(doc);
  return Math.min(device.w / d.w, device.h / d.h);
}

const sU = (u: UDim, f: number): UDim => ({ s: u.s, o: u.o * f });
const sU2 = (u: UDim2, f: number): UDim2 => ({ x: sU(u.x, f), y: sU(u.y, f) });

/** The properties pixel scaling touches, scaled by f (same list as the Luau scaler) */
export function scaledPixelProps(n: GuiNode, f: number): Record<string, any> | null {
  const p = n.props;
  switch (n.className) {
    case 'UIStroke':
      return { Thickness: p.Thickness * f };
    case 'UITextSizeConstraint':
      return { MaxTextSize: Math.max(1, Math.round(p.MaxTextSize * f)), MinTextSize: Math.max(1, Math.round(p.MinTextSize * f)) };
    case 'UICorner':
      return { CornerRadius: sU(p.CornerRadius, f) };
    case 'UIPadding':
      return { PaddingTop: sU(p.PaddingTop, f), PaddingBottom: sU(p.PaddingBottom, f), PaddingLeft: sU(p.PaddingLeft, f), PaddingRight: sU(p.PaddingRight, f) };
    case 'UIListLayout':
      return { Padding: sU(p.Padding, f) };
    case 'UIGridLayout':
      return { CellSize: sU2(p.CellSize, f), CellPadding: sU2(p.CellPadding, f) };
    case 'ScrollingFrame':
      return { ScrollBarThickness: Math.max(0, Math.round(p.ScrollBarThickness * f)) };
    default:
      return isText(n.className) ? { TextSize: Math.min(100, Math.max(1, p.TextSize * f)) } : null;
  }
}

/** Nodes as Roblox would draw them on `device` (only ScreenGui content; world GUIs have fixed canvases) */
export function applyPixelScale(nodes: Record<string, GuiNode>, rootIds: string[], f: number): Record<string, GuiNode> {
  if (Math.abs(f - 1) < 1e-4) return nodes;
  const out = { ...nodes };
  for (const r of rootIds) {
    if (nodes[r]?.className !== 'ScreenGui') continue;
    for (const id of descendants(nodes, r)) {
      const ch = scaledPixelProps(nodes[id], f);
      if (ch) out[id] = { ...nodes[id], props: { ...nodes[id].props, ...ch } };
    }
  }
  return out;
}
