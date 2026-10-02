// Screens: separate pages of UI (main menu, shop, settings…), each drawn on its own artboard in the
// editor. Every ScreenGui belongs to one screen. In game all ScreenGuis share the display, so a screen
// that isn't visible at the start exports its ScreenGuis with Enabled = false, and the "Show screen"
// event action turns one screen on and the others off.
import type { Doc, GuiNode, Rect, Screen } from './types';

export const SCREEN_GAP = 240;
const DEFAULT: Screen = { id: 'main', name: 'Main', startVisible: true };

/** The document's screens (a single implicit "Main" screen until more are added) */
export const screensOf = (doc: Doc): Screen[] => (doc.screens?.length ? doc.screens : [DEFAULT]);

/** Screen a ScreenGui belongs to (the first screen when unset or gone) */
export function screenOfRoot(doc: Doc, rootId: string): Screen {
  const list = screensOf(doc);
  const id = doc.nodes[rootId]?.screen;
  return list.find((s) => s.id === id) ?? list[0];
}

export const screenStartsVisible = (doc: Doc, s: Screen) => s.startVisible ?? screensOf(doc)[0].id === s.id;

/** ScreenGuis of a screen, in document order */
export const screenRoots = (doc: Doc, screenId: string): string[] =>
  doc.rootIds.filter((r) => doc.nodes[r]?.className === 'ScreenGui' && screenOfRoot(doc, r).id === screenId);

/** Where a screen's artboard sits on the canvas (left to right) */
export function screenBox(doc: Doc, screenId: string): Rect {
  const i = Math.max(0, screensOf(doc).findIndex((s) => s.id === screenId));
  return { x: i * (doc.device.w + SCREEN_GAP), y: 0, w: doc.device.w, h: doc.device.h };
}

/** Canvas offset of every ScreenGui (for computeLayout) */
export function rootOrigins(doc: Doc): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  for (const r of doc.rootIds) {
    if (doc.nodes[r]?.className !== 'ScreenGui') continue;
    const b = screenBox(doc, screenOfRoot(doc, r).id);
    out[r] = { x: b.x, y: b.y };
  }
  return out;
}

/** Right edge of the last screen artboard (world GUIs go after it) */
export const screensRight = (doc: Doc) => screensOf(doc).length * (doc.device.w + SCREEN_GAP) - SCREEN_GAP;

/**
 * The document as the game starts: ScreenGuis on screens that aren't visible at the start are disabled.
 * Used by every exporter (Luau, .rbxmx, Studio sync).
 */
export function gameStartDoc(doc: Doc): Doc {
  if (!doc.screens || doc.screens.length < 2) return doc;
  let nodes: Record<string, GuiNode> | null = null;
  for (const r of doc.rootIds) {
    const n = doc.nodes[r];
    if (n?.className !== 'ScreenGui' || screenStartsVisible(doc, screenOfRoot(doc, r)) || n.props.Enabled === false) continue;
    nodes ??= { ...doc.nodes };
    nodes[r] = { ...n, props: { ...n.props, Enabled: false } };
  }
  return nodes ? { ...doc, nodes } : doc;
}
