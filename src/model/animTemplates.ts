// Ready-made animations: one click makes a clip (normal tweens you can edit on the timeline).
// A tween with duration 0 is a jump to a starting value ("start transparent, then fade in").
import { isGuiObject, isImage, isText } from './schema';
import type { AnimClip, Doc, EasingDirection, EasingStyle, GuiNode, Rect, TriggerKind, Tween, UDim2 } from './types';

export type TemplateGroup = 'Entrance' | 'Exit' | 'Attention';

/** A tween before it gets an id; nodeId 'scale' means the element's UIScale */
type T = Omit<Tween, 'id' | 'nodeId'> & { nodeId: string };

export interface TemplateCtx {
  node: GuiNode;
  doc: Doc;
  /** element and its parent's content box, at design size */
  rect: Rect;
  parent: Rect;
  /** UIScale child id ('' until created; templates that use it set needsScale) */
  scaleId: string;
}

export interface AnimTemplate {
  id: string;
  name: string;
  group: TemplateGroup;
  description: string;
  /** default trigger: entrances play on load, exits are played from events, attention plays on click */
  trigger: TriggerKind;
  loop?: boolean;
  loopDelay?: number;
  needsScale?: boolean;
  /** Only offered for these elements */
  appliesTo?: (n: GuiNode) => boolean;
  build: (c: TemplateCtx) => T[];
}

/** Letters (graphemes) in an element's text, as MaxVisibleGraphemes counts them */
function graphemeCount(text: string): number {
  const plain = text.replace(/<[^>]+>/g, '');
  const seg = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new (Intl as any).Segmenter(undefined, { granularity: 'grapheme' }) : null;
  return seg ? Array.from(seg.segment(plain)).length : Array.from(plain).length;
}

const tw = (nodeId: string, prop: string, to: any, start: number, duration: number, style: EasingStyle = 'Quad', direction: EasingDirection = 'Out'): T =>
  ({ nodeId, prop, to, start, duration, style, direction });

const shift = (p: UDim2, dxs: number, dxo: number, dys: number, dyo: number): UDim2 => ({
  x: { s: +(p.x.s + dxs).toFixed(4), o: p.x.o + dxo },
  y: { s: +(p.y.s + dys).toFixed(4), o: p.y.o + dyo },
});

/** The transparency properties that make an element (and everything in it) visible, with their design values */
function fadeProps(c: TemplateCtx): { nodeId: string; prop: string; value: number }[] {
  const { node, doc } = c;
  if (node.className === 'CanvasGroup') return [{ nodeId: node.id, prop: 'GroupTransparency', value: node.props.GroupTransparency ?? 0 }];
  const out: { nodeId: string; prop: string; value: number }[] = [];
  const walk = (id: string) => {
    const n = doc.nodes[id];
    if (!n) return;
    const add = (prop: string) => {
      const v = n.props[prop];
      if (typeof v === 'number' && v < 1) out.push({ nodeId: id, prop, value: v });
    };
    if (isGuiObject(n.className)) {
      add('BackgroundTransparency');
      if (isText(n.className)) {
        add('TextTransparency');
        add('TextStrokeTransparency');
      }
      if (isImage(n.className)) add('ImageTransparency');
    }
    if (n.className === 'UIStroke') add('Transparency');
    n.children.forEach(walk);
  };
  walk(node.id);
  return out;
}

const fadeIn = (c: TemplateCtx, d = 0.35, start = 0): T[] =>
  fadeProps(c).flatMap((f) => [tw(f.nodeId, f.prop, 1, start, 0), tw(f.nodeId, f.prop, f.value, start, d, 'Quad', 'Out')]);
const fadeOut = (c: TemplateCtx, d = 0.3, start = 0): T[] => fadeProps(c).map((f) => tw(f.nodeId, f.prop, 1, start, d, 'Quad', 'In'));

/** Shift that takes the element just past a screen edge, in parent Scale (so it still works on other screens) */
function offscreen(c: TemplateCtx, side: 'left' | 'right' | 'top' | 'bottom', screen: { w: number; h: number }): [number, number] {
  const { rect: r, parent: p } = c;
  const m = 12;
  if (side === 'left') return [-(r.x + r.w + m) / p.w, 0];
  if (side === 'right') return [(screen.w - r.x + m) / p.w, 0];
  if (side === 'top') return [0, -(r.y + r.h + m) / p.h];
  return [0, (screen.h - r.y + m) / p.h];
}

const slideIn = (side: 'left' | 'right' | 'top' | 'bottom') => (c: TemplateCtx): T[] => {
  const pos: UDim2 = c.node.props.Position;
  const [sx, sy] = offscreen(c, side, c.doc.device);
  return [tw(c.node.id, 'Position', shift(pos, sx, 0, sy, 0), 0, 0), tw(c.node.id, 'Position', pos, 0, 0.5, 'Quart', 'Out')];
};
const slideOut = (side: 'left' | 'right' | 'top' | 'bottom') => (c: TemplateCtx): T[] => {
  const pos: UDim2 = c.node.props.Position;
  const [sx, sy] = offscreen(c, side, c.doc.device);
  return [tw(c.node.id, 'Position', shift(pos, sx, 0, sy, 0), 0, 0.4, 'Quart', 'In')];
};

export const ANIM_TEMPLATES: AnimTemplate[] = [
  // --- entrances
  { id: 'fadeIn', name: 'Fade in', group: 'Entrance', trigger: 'load', description: 'From invisible to visible', build: (c) => fadeIn(c) },
  {
    id: 'riseIn', name: 'Fade in up', group: 'Entrance', trigger: 'load', description: 'Fades in while rising a little',
    build: (c) => {
      const pos: UDim2 = c.node.props.Position;
      return [...fadeIn(c, 0.4), tw(c.node.id, 'Position', shift(pos, 0, 0, 0, 30), 0, 0), tw(c.node.id, 'Position', pos, 0, 0.45, 'Quart', 'Out')];
    },
  },
  {
    id: 'popIn', name: 'Pop in', group: 'Entrance', trigger: 'load', needsScale: true, description: 'Grows from nothing with a little overshoot (UIScale)',
    build: (c) => [tw(c.scaleId, 'Scale', 0, 0, 0), tw(c.scaleId, 'Scale', 1, 0, 0.4, 'Back', 'Out')],
  },
  {
    id: 'zoomIn', name: 'Zoom in', group: 'Entrance', trigger: 'load', needsScale: true, description: 'Shrinks into place while fading in',
    build: (c) => [...fadeIn(c, 0.3), tw(c.scaleId, 'Scale', 1.25, 0, 0), tw(c.scaleId, 'Scale', 1, 0, 0.35, 'Quad', 'Out')],
  },
  { id: 'slideInLeft', name: 'Slide in from left', group: 'Entrance', trigger: 'load', description: 'Comes in from the left edge of the screen', build: slideIn('left') },
  { id: 'slideInRight', name: 'Slide in from right', group: 'Entrance', trigger: 'load', description: 'Comes in from the right edge of the screen', build: slideIn('right') },
  { id: 'slideInTop', name: 'Slide in from top', group: 'Entrance', trigger: 'load', description: 'Comes down from the top of the screen', build: slideIn('top') },
  { id: 'slideInBottom', name: 'Slide in from bottom', group: 'Entrance', trigger: 'load', description: 'Comes up from the bottom of the screen', build: slideIn('bottom') },
  {
    id: 'dropIn', name: 'Drop in', group: 'Entrance', trigger: 'load', description: 'Falls from the top and bounces',
    build: (c) => {
      const pos: UDim2 = c.node.props.Position;
      const [, sy] = offscreen(c, 'top', c.doc.device);
      return [tw(c.node.id, 'Position', shift(pos, 0, 0, sy, 0), 0, 0), tw(c.node.id, 'Position', pos, 0, 0.7, 'Bounce', 'Out')];
    },
  },

  {
    id: 'typewriter', name: 'Typewriter', group: 'Entrance', trigger: 'load', appliesTo: (n) => isText(n.className),
    description: 'Types the text out letter by letter (MaxVisibleGraphemes)',
    build: (c) => {
      const count = graphemeCount(c.node.props.Text ?? '');
      const d = Math.max(0.3, count * 0.035);
      return [tw(c.node.id, 'MaxVisibleGraphemes', 0, 0, 0), tw(c.node.id, 'MaxVisibleGraphemes', count, 0, d, 'Linear', 'InOut'), tw(c.node.id, 'MaxVisibleGraphemes', -1, d, 0)];
    },
  },

  // --- exits
  { id: 'fadeOut', name: 'Fade out', group: 'Exit', trigger: 'manual', description: 'From visible to invisible', build: (c) => fadeOut(c) },
  {
    id: 'popOut', name: 'Pop out', group: 'Exit', trigger: 'manual', needsScale: true, description: 'Shrinks away (UIScale)',
    build: (c) => [tw(c.scaleId, 'Scale', 0, 0, 0.3, 'Back', 'In')],
  },
  { id: 'slideOutLeft', name: 'Slide out to left', group: 'Exit', trigger: 'manual', description: 'Leaves past the left edge', build: slideOut('left') },
  { id: 'slideOutRight', name: 'Slide out to right', group: 'Exit', trigger: 'manual', description: 'Leaves past the right edge', build: slideOut('right') },
  { id: 'slideOutBottom', name: 'Slide out to bottom', group: 'Exit', trigger: 'manual', description: 'Drops off the bottom', build: slideOut('bottom') },

  // --- attention
  {
    id: 'pulse', name: 'Pulse', group: 'Attention', trigger: 'load', loop: true, loopDelay: 0.6, needsScale: true, description: 'Gently grows and shrinks, over and over (UIScale)',
    build: (c) => [tw(c.scaleId, 'Scale', 1.08, 0, 0.35, 'Sine', 'InOut'), tw(c.scaleId, 'Scale', 1, 0.35, 0.35, 'Sine', 'InOut')],
  },
  {
    id: 'bounce', name: 'Bounce', group: 'Attention', trigger: 'click', description: 'Hops up and lands with a bounce',
    build: (c) => {
      const pos: UDim2 = c.node.props.Position;
      return [tw(c.node.id, 'Position', shift(pos, 0, 0, 0, -24), 0, 0.15, 'Quad', 'Out'), tw(c.node.id, 'Position', pos, 0.15, 0.5, 'Bounce', 'Out')];
    },
  },
  {
    id: 'shake', name: 'Shake', group: 'Attention', trigger: 'click', description: 'Quick side-to-side shake (e.g. wrong code)',
    build: (c) => {
      const pos: UDim2 = c.node.props.Position;
      const xs = [-10, 10, -8, 8, -4, 0];
      return xs.map((dx, i) => tw(c.node.id, 'Position', shift(pos, 0, dx, 0, 0), i * 0.05, 0.05, 'Sine', 'InOut'));
    },
  },
  {
    id: 'wiggle', name: 'Wiggle', group: 'Attention', trigger: 'hoverEnter', description: 'Tilts back and forth',
    build: (c) => {
      const r0 = c.node.props.Rotation ?? 0;
      const rs = [-8, 8, -5, 5, 0];
      return rs.map((d, i) => tw(c.node.id, 'Rotation', r0 + d, i * 0.07, 0.07, 'Sine', 'InOut'));
    },
  },
  {
    id: 'spin', name: 'Spin', group: 'Attention', trigger: 'load', loop: true, loopDelay: 0, description: 'Turns around forever (loading icons)',
    build: (c) => [tw(c.node.id, 'Rotation', (c.node.props.Rotation ?? 0) + 360, 0, 1.2, 'Linear', 'InOut')],
  },
  {
    id: 'flash', name: 'Flash', group: 'Attention', trigger: 'click', description: 'Blinks twice',
    build: (c) => {
      const f = fadeProps(c);
      return [0, 0.3].flatMap((t) => [...f.map((x) => tw(x.nodeId, x.prop, 1, t, 0.15, 'Sine', 'InOut')), ...f.map((x) => tw(x.nodeId, x.prop, x.value, t + 0.15, 0.15, 'Sine', 'InOut'))]);
    },
  },
];

export const TEMPLATE_GROUPS: TemplateGroup[] = ['Entrance', 'Exit', 'Attention'];

/** Clips that animate this element (or its UIScale / children) */
export function clipsFor(doc: Doc, nodeId: string): AnimClip[] {
  const inside = (id: string) => {
    for (let cur: string | null = id; cur; cur = doc.nodes[cur]?.parentId ?? null) if (cur === nodeId) return true;
    return false;
  };
  return doc.clips.filter((c) => c.tweens.some((t) => inside(t.nodeId)));
}

