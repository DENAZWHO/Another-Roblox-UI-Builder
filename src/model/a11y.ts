// Accessibility checks: buttons too small to tap, text too faint to read, text too small.
// Sizes are measured as Roblox lays the UI out on a small phone (the worst case for Scale-based UI)
// and on the document's own screen size.
import { computeLayout, findChild, type LayoutResult } from './layout';
import { applyPixelScale, pixelScaleFactor } from './pixelScale';
import { DEVICES, isGuiObject, isRoot, isText, isWorldGui } from './schema';
import { fitTextSize, stripRichText } from './fonts';
import type { Device, Doc, GuiNode } from './types';

export type CheckKind = 'tap' | 'contrast' | 'world' | 'textSize';
export type Severity = 'error' | 'warn';

export interface CheckIssue {
  /** `${kind}:${nodeId}` (also the key used to ignore it) */
  key: string;
  kind: CheckKind;
  id: string;
  severity: Severity;
  /** Short description of the problem, e.g. "30×24 px on Small phone" */
  message: string;
  /** Contrast issues: the measured ratio and what's needed */
  ratio?: number;
  needed?: number;
  /** Data the fix needs */
  fix?: { textColor?: string; strokeColor?: string; strokeThickness?: number; textSize?: number };
}

/** Smallest comfortable touch target (Apple: 44 pt, Google: 48 dp) */
export const MIN_TAP = 44;
const TAP_ERROR = 32;
/** Smallest readable text on a phone */
export const MIN_TEXT = 12;
const TEXT_ERROR = 9;

const SMALL_PHONE = DEVICES.find((d) => d.name === 'Small phone')!;
const INTERACTIVE = new Set(['TextButton', 'ImageButton', 'TextBox']);

// ---------------------------------------------------------------------------
// colour maths (WCAG 2)

type RGB = [number, number, number];

function hexToRgb(hex: string): RGB {
  const h = (hex ?? '#000000').replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const rgbToHex = (c: RGB) => '#' + c.map((x) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, '0')).join('');

function luminance([r, g, b]: RGB): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(a: RGB, b: RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const mix = (top: RGB, bottom: RGB, alpha: number): RGB => [0, 1, 2].map((i) => top[i] * alpha + bottom[i] * (1 - alpha)) as RGB;

/** The colours a node's UIGradient multiplies everything it draws by (white without one) */
function gradientStops(nodes: Record<string, GuiNode>, n: GuiNode): RGB[] {
  const g = findChild(nodes, n.id, 'UIGradient');
  if (!g || g.props.Enabled === false || !Array.isArray(g.props.Color)) return [[255, 255, 255]];
  return (g.props.Color as { c: string }[]).map((k) => hexToRgb(k.c));
}

const tint = (c: RGB, m: RGB): RGB => [(c[0] * m[0]) / 255, (c[1] * m[1]) / 255, (c[2] * m[2]) / 255];

/** The node's colour multiplied by its UIGradient's colours */
const tints = (nodes: Record<string, GuiNode>, n: GuiNode, base: string): RGB[] => gradientStops(nodes, n).map((m) => tint(hexToRgb(base), m));

/**
 * Lighten or darken `color` (keeping its hue) until it reaches `needed` everywhere.
 * Each case: the gradient tint `m` applied to the text, and the backgrounds behind it there.
 */
export function fixColor(color: RGB, cases: { m: RGB; bgs: RGB[] }[], needed: number): string | null {
  const passes = (c: RGB) => cases.every(({ m, bgs }) => bgs.every((b) => contrastRatio(tint(c, m), b) >= needed));
  // try lightening and darkening; keep the smaller change
  let best: { c: RGB; t: number } | null = null;
  for (const target of [[255, 255, 255], [0, 0, 0]] as RGB[]) {
    for (let t = 0.05; t <= 1.0001; t += 0.05) {
      const c = mix(target, color, t);
      if (!passes(c)) continue;
      if (!best || t < best.t) best = { c, t };
      break;
    }
  }
  return best ? rgbToHex(best.c) : null;
}

// ---------------------------------------------------------------------------
// what is drawn behind a point

/** GuiObjects of a ScreenGui in the order Roblox draws them. Hidden ones are included: panels shown later still get checked. */
function paintOrder(nodes: Record<string, GuiNode>, rootId: string): string[] {
  const root = nodes[rootId];
  const out: string[] = [];
  const global = root.props.ZIndexBehavior === 'Global';
  const visit = (id: string) => {
    const kids = nodes[id].children
      .map((c, i) => ({ n: nodes[c], i }))
      .filter(({ n }) => n && isGuiObject(n.className));
    if (!global) kids.sort((a, b) => (a.n.props.ZIndex ?? 1) - (b.n.props.ZIndex ?? 1) || a.i - b.i);
    for (const { n } of kids) {
      out.push(n.id);
      visit(n.id);
    }
  };
  visit(rootId);
  if (global) {
    const pos = new Map(out.map((id, i) => [id, i]));
    out.sort((a, b) => (nodes[a].props.ZIndex ?? 1) - (nodes[b].props.ZIndex ?? 1) || pos.get(a)! - pos.get(b)!);
  }
  return out;
}

interface Backdrop {
  /** Possible colours behind (several when a gradient is involved) */
  colors: RGB[];
  /** How much of the game world shows through (0 = fully covered) */
  world: number;
  /** An image is behind: its colours are unknown */
  image: boolean;
}

/** Composite everything drawn before `id` (not its own background) under its centre */
function backdrop(nodes: Record<string, GuiNode>, order: string[], layout: LayoutResult, id: string): Backdrop {
  const r = layout.rects[id];
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  let colors: RGB[] = [[0, 0, 0]];
  let world = 1;
  let image = false;
  const until = order.indexOf(id);
  for (let i = 0; i < until; i++) {
    const n = nodes[order[i]];
    const b = layout.rects[n.id];
    if (!b || cx < b.x || cx > b.x + b.w || cy < b.y || cy > b.y + b.h) continue;
    const p = n.props;
    const bgA = 1 - (p.BackgroundTransparency ?? 0);
    if (bgA > 0.01) {
      const layer = tints(nodes, n, p.BackgroundColor3);
      colors = layer.flatMap((top) => colors.map((c) => mix(top, c, bgA)));
      world *= 1 - bgA;
      if (bgA > 0.9) image = false;
    }
    if ((n.className === 'ImageLabel' || n.className === 'ImageButton') && p.Image && (p.ImageTransparency ?? 0) < 0.5) {
      image = true;
      world = 0;
    }
  }
  // keep the list small
  if (colors.length > 6) {
    const byL = [...colors].sort((a, b) => luminance(a) - luminance(b));
    colors = [byL[0], byL[byL.length - 1]];
  }
  return { colors, world, image };
}

// ---------------------------------------------------------------------------
// the checks

interface DeviceView {
  device: Device;
  nodes: Record<string, GuiNode>;
  layout: LayoutResult;
  scale: number;
}

function view(doc: Doc, device: Device): DeviceView {
  const scale = pixelScaleFactor(doc, device);
  const nodes = applyPixelScale(doc.nodes, doc.rootIds, scale);
  return { device, nodes, scale, layout: computeLayout(nodes, doc.rootIds, device) };
}

/** Rendered text size (TextScaled fitted to the box, UITextSizeConstraint applied) */
function textSizeOn(v: DeviceView, n: GuiNode): number {
  const p = n.props;
  const tsc = findChild(v.nodes, n.id, 'UITextSizeConstraint');
  const box = v.layout.content[n.id] ?? v.layout.rects[n.id];
  if (p.TextScaled && box) {
    const cap = Math.min(100, tsc?.props.MaxTextSize ?? 100 * v.scale);
    return fitTextSize(stripRichText(p.Text ?? ''), p.FontFace, box.w, box.h, p.LineHeight ?? 1, !!p.TextWrapped, tsc?.props.MinTextSize ?? 1, cap);
  }
  return tsc ? Math.min(Math.max(p.TextSize, tsc.props.MinTextSize), tsc.props.MaxTextSize) : p.TextSize;
}

/** Text has an outline that keeps it readable on any background */
function outline(nodes: Record<string, GuiNode>, n: GuiNode, text: RGB): boolean {
  const s = n.children.map((c) => nodes[c]).find((c) => c?.className === 'UIStroke' && c.props.Enabled !== false && c.props.ApplyStrokeMode !== 'Border');
  if (s && s.props.Thickness >= 1 && (s.props.Transparency ?? 0) <= 0.5 && contrastRatio(hexToRgb(s.props.Color), text) >= 3) return true;
  return (n.props.TextStrokeTransparency ?? 1) <= 0.5 && contrastRatio(hexToRgb(n.props.TextStrokeColor3), text) >= 3;
}

export function runChecks(doc: Doc): CheckIssue[] {
  const issues: CheckIssue[] = [];
  const screenRoots = doc.rootIds.filter((r) => isRoot(doc.nodes[r]?.className) && !isWorldGui(doc.nodes[r].className));
  if (!screenRoots.length) return issues;
  const phone = view(doc, SMALL_PHONE);
  const own = doc.device.w === SMALL_PHONE.w && doc.device.h === SMALL_PHONE.h ? phone : view(doc, doc.device);
  const views = own === phone ? [phone] : [phone, own];
  const fmt = (x: number) => String(Math.round(x));

  for (const rootId of screenRoots) {
    const order = paintOrder(phone.nodes, rootId);
    for (const id of order) {
      const n = phone.nodes[id];
      const p = n.props;

      // --- tap targets
      if (INTERACTIVE.has(n.className) && p.Interactable !== false) {
        let worst: { v: DeviceView; w: number; h: number } | null = null;
        for (const v of views) {
          const r = v.layout.rects[id];
          if (r && (!worst || Math.min(r.w, r.h) < Math.min(worst.w, worst.h))) worst = { v, w: r.w, h: r.h };
        }
        if (worst && Math.min(worst.w, worst.h) < MIN_TAP && Math.min(worst.w, worst.h) > 0) {
          issues.push({
            key: `tap:${id}`, kind: 'tap', id,
            severity: Math.min(worst.w, worst.h) < TAP_ERROR ? 'error' : 'warn',
            message: `${fmt(worst.w)}×${fmt(worst.h)} px on ${worst.v.device.name}`,
          });
        }
      }

      if (!isText(n.className)) continue;
      const raw = stripRichText(p.Text ?? '').trim();
      if (!raw && !n.bind) continue;
      if ((p.TextTransparency ?? 0) > 0.95) continue;

      // --- text size
      const size = textSizeOn(phone, n);
      if (size > 0 && size < MIN_TEXT) {
        issues.push({
          key: `textSize:${id}`, kind: 'textSize', id,
          severity: size < TEXT_ERROR ? 'error' : 'warn',
          message: `${fmt(size)} px on ${SMALL_PHONE.name}${phone.scale < 0.99 && !p.TextScaled ? ` (${doc.nodes[id].props.TextSize} px × ${phone.scale.toFixed(2)} pixel scaling)` : ''}`,
          fix: p.TextScaled ? undefined : { textSize: Math.ceil(MIN_TEXT / Math.max(0.01, phone.scale)) },
        });
      }

      // --- contrast: the text's gradient tints its text and its own background alike
      const stops = gradientStops(phone.nodes, n);
      const textColors = stops.map((m) => tint(hexToRgb(p.TextColor3), m));
      const bd = backdrop(phone.nodes, order, phone.layout, id);
      const selfA = 1 - (p.BackgroundTransparency ?? 0);
      const behind = (m: RGB): RGB[] => (selfA > 0.01 ? bd.colors.map((c) => mix(tint(hexToRgb(p.BackgroundColor3), m), c, selfA)) : bd.colors);
      const world = bd.world * (1 - selfA);
      const alpha = 1 - (p.TextTransparency ?? 0);
      const strong = textColors.every((t) => outline(phone.nodes, n, t));
      if (strong || (bd.image && selfA < 0.9)) continue;
      if (world > 0.6) {
        issues.push({
          key: `world:${id}`, kind: 'world', id, severity: 'warn',
          message: 'No background or outline behind this text',
          fix: { strokeColor: strokeFor(textColors), strokeThickness: strokeWidth(phone.scale) },
        });
        continue;
      }
      const large = size >= 24 || (size >= 18.5 && (p.FontFace?.weight ?? 400) >= 700);
      const needed = large ? 3 : 4.5;
      let ratio = Infinity;
      stops.forEach((m, k) => {
        for (const b of behind(m)) ratio = Math.min(ratio, contrastRatio(mix(textColors[k], b, alpha), b));
      });
      if (ratio < needed) {
        issues.push({
          key: `contrast:${id}`, kind: 'contrast', id,
          severity: ratio < 2 ? 'error' : 'warn',
          message: `${ratio.toFixed(1)} : 1 contrast — needs ${needed} : 1${large ? ' (large text)' : ''}`,
          ratio, needed,
          fix: contrastFix(alpha > 0.99 ? fixColor(hexToRgb(p.TextColor3), stops.map((m) => ({ m, bgs: behind(m) })), needed + 0.05) : null, textColors, phone.scale),
        });
      }
    }
  }
  return issues;
}

/** An outline colour that stands out from the text */
const strokeFor = (text: RGB[]) => (Math.max(...text.map(luminance)) > 0.4 ? '#000000' : '#ffffff');

/** Recolour the text when some colour passes; otherwise outline it */
const contrastFix = (color: string | null, text: RGB[], scale: number): CheckIssue['fix'] =>
  color ? { textColor: color } : { strokeColor: strokeFor(text), strokeThickness: strokeWidth(scale) };

/** Outline thickness that stays at least 1 px on the phone (pixel scaling shrinks it) */
const strokeWidth = (scale: number) => Math.max(2, Math.ceil(1 / Math.max(0.05, scale)));

export const CHECK_LABELS: Record<CheckKind, { title: string; help: string }> = {
  tap: { title: 'Too small to tap', help: `Buttons and text boxes should be at least ${MIN_TAP}×${MIN_TAP} px on phones so a thumb can hit them.` },
  contrast: { title: 'Hard to read', help: 'Text needs enough contrast with what is behind it: 4.5 : 1 for normal text, 3 : 1 for large text (WCAG AA).' },
  world: { title: 'Text over the game world', help: 'With nothing behind it, the text sits on the 3D scene and can vanish on bright or busy backgrounds. Give it an outline or a backing.' },
  textSize: { title: 'Text too small', help: `Text under ${MIN_TEXT} px is hard to read on a phone.` },
};
