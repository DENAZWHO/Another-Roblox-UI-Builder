import type { AnimClip, EasingDirection, EasingStyle, GuiNode, Tween } from './types';

export const EASING_STYLES: EasingStyle[] = ['Linear', 'Sine', 'Quad', 'Cubic', 'Quart', 'Quint', 'Exponential', 'Circular', 'Back', 'Bounce', 'Elastic'];
export const EASING_DIRECTIONS: EasingDirection[] = ['In', 'Out', 'InOut'];

const c1 = 1.70158;
const c3 = c1 + 1;
const c4 = (2 * Math.PI) / 3;

function bounceOut(t: number) {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

const EASE_IN: Record<EasingStyle, (t: number) => number> = {
  Linear: (t) => t,
  Sine: (t) => 1 - Math.cos((t * Math.PI) / 2),
  Quad: (t) => t * t,
  Cubic: (t) => t ** 3,
  Quart: (t) => t ** 4,
  Quint: (t) => t ** 5,
  Exponential: (t) => (t === 0 ? 0 : 2 ** (10 * t - 10)),
  Circular: (t) => 1 - Math.sqrt(1 - t * t),
  Back: (t) => c3 * t ** 3 - c1 * t * t,
  Bounce: (t) => 1 - bounceOut(1 - t),
  Elastic: (t) => (t === 0 ? 0 : t === 1 ? 1 : -(2 ** (10 * t - 10)) * Math.sin((t * 10 - 10.75) * c4)),
};

export function ease(style: EasingStyle, dir: EasingDirection, t: number) {
  const f = EASE_IN[style] ?? EASE_IN.Linear;
  if (dir === 'In') return f(t);
  if (dir === 'Out') return 1 - f(1 - t);
  return t < 0.5 ? f(2 * t) / 2 : 1 - f(2 - 2 * t) / 2;
}

function hexToRgb(h: string): [number, number, number] {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function rgbToHex(r: number, g: number, b: number) {
  const c = (x: number) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function lerpValue(a: any, b: any, t: number): any {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * t;
  if (typeof a === 'string' && typeof b === 'string' && a.startsWith('#')) {
    const [r1, g1, b1] = hexToRgb(a);
    const [r2, g2, b2] = hexToRgb(b);
    return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
  }
  if (a && b && typeof a === 'object') {
    if ('x' in a && typeof a.x === 'object') {
      return {
        x: { s: a.x.s + (b.x.s - a.x.s) * t, o: a.x.o + (b.x.o - a.x.o) * t },
        y: { s: a.y.s + (b.y.s - a.y.s) * t, o: a.y.o + (b.y.o - a.y.o) * t },
      };
    }
    if ('x' in a) return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  return t < 1 ? a : b;
}

export const tweenEnd = (t: Tween) => t.start + t.duration;

export function clipLength(clip: AnimClip | undefined) {
  if (!clip) return 0;
  return clip.tweens.reduce((m, t) => Math.max(m, tweenEnd(t)), 0);
}

export type Overrides = Record<string, Record<string, any>>;

/** Evaluate an animation clip at time t. A newer tween on the same property takes over from the current value (Roblox TweenService semantics). */
export function evaluateClip(clip: AnimClip | undefined, nodes: Record<string, GuiNode>, time: number): Overrides {
  const out: Overrides = {};
  if (!clip) return out;
  const groups = new Map<string, Tween[]>();
  for (const tw of clip.tweens) {
    if (!nodes[tw.nodeId]) continue;
    const key = tw.nodeId + '\u0000' + tw.prop;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(tw);
  }
  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => a.start - b.start);
    const base = nodes[sorted[0].nodeId].props[sorted[0].prop];
    const froms: any[] = [];
    const valueAt = (t: number, upTo: number) => {
      let j = -1;
      for (let i = 0; i < upTo; i++) if (sorted[i].start <= t) j = i;
      if (j < 0) return base;
      const tw = sorted[j];
      const p = tw.duration <= 0 ? 1 : Math.min(1, Math.max(0, (t - tw.start) / tw.duration));
      return lerpValue(froms[j], tw.to, ease(tw.style, tw.direction, p));
    };
    sorted.forEach((tw, i) => (froms[i] = valueAt(tw.start, i)));
    const v = valueAt(time, sorted.length);
    if (v !== base) (out[sorted[0].nodeId] ??= {})[sorted[0].prop] = v;
  }
  return out;
}

export function applyOverrides(nodes: Record<string, GuiNode>, ov: Overrides): Record<string, GuiNode> {
  const keys = Object.keys(ov);
  if (!keys.length) return nodes;
  const out = { ...nodes };
  for (const id of keys) out[id] = { ...nodes[id], props: { ...nodes[id].props, ...ov[id] } };
  return out;
}
