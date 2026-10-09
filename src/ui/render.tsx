import { memo, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Backpack, Box, Ellipsis, Image as ImageIcon, MessageCircle, Users, Clapperboard } from 'lucide-react';
import { findChild, resolve, type LayoutResult } from '../model/layout';
import { baselineShift, fitTextSize, fontFamily, fontStyle, lineFactor, stripRichText } from '../model/fonts';
import { isGuiObject, isImage, isText, isWorldGui, throughFolders } from '../model/schema';
import type { UIEvent } from '../model/runtime';
import type { ColorKey, FontValue, GuiNode, NumberKey, PreviewUser, UDim2, Vec2, UDim, Device } from '../model/types';
import { imageSize, assetThumb, avatarThumb, subscribeThumbs } from './thumbs';
import { applyTextColors } from '../model/richColors';
import { pathData } from '../model/path';

export interface RenderCtx {
  nodes: Record<string, GuiNode>;
  layout: LayoutResult;
  /** Preview/play mode: live buttons, text boxes and native scrolling */
  interactive: boolean;
  editingTextId?: string | null;
  /** UIScale from effects (Preview) */
  scales?: Record<string, number>;
  /** Hover glow strength from effects (Preview) */
  glows?: Record<string, number>;
  /** Pixel-scale factor for this screen (the 100px TextScaled limit scales with it) */
  pixelScale?: number;
  /** Player shown for avatar images / name bindings */
  previewUser?: PreviewUser;
  /** ScreenGui.ZIndexBehavior = Global: every element is ordered by ZIndex across the whole tree */
  globalZ?: boolean;
  /** Preview: nodes that react to pointer events, and the handler */
  eventIds?: Set<string>;
  onEvent?: (id: string, ev: UIEvent) => void;
}

const DEFAULT_USER: PreviewUser = { id: 1, name: 'Roblox', displayName: 'Roblox' };

export function boundText(n: GuiNode, user: PreviewUser = DEFAULT_USER): string {
  if (n.bind === 'DisplayName') return user.displayName;
  if (n.bind === 'Name') return user.name;
  if (n.bind === 'UserId') return String(user.id);
  return n.props.Text ?? '';
}

// ---------------------------------------------------------------------------
// Colour helpers

export function hexToRgb(h: string): [number, number, number] {
  const v = parseInt((h || '#000000').slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
export const rgba = (hex: string, alpha: number) => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`;
};
const mul = (a: string, b: string): [number, number, number] => {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return [(x[0] * y[0]) / 255, (x[1] * y[1]) / 255, (x[2] * y[2]) / 255];
};

function sampleColor(keys: ColorKey[], t: number): string {
  const s = [...keys].sort((a, b) => a.t - b.t);
  if (t <= s[0].t) return s[0].c;
  for (let i = 1; i < s.length; i++) {
    if (t <= s[i].t) {
      const k = (t - s[i - 1].t) / Math.max(1e-6, s[i].t - s[i - 1].t);
      const a = hexToRgb(s[i - 1].c);
      const b = hexToRgb(s[i].c);
      return '#' + a.map((v, j) => Math.round(v + (b[j] - v) * k).toString(16).padStart(2, '0')).join('');
    }
  }
  return s[s.length - 1].c;
}
function sampleNumber(keys: NumberKey[], t: number): number {
  const s = [...keys].sort((a, b) => a.t - b.t);
  if (t <= s[0].t) return s[0].v;
  for (let i = 1; i < s.length; i++) {
    if (t <= s[i].t) {
      const k = (t - s[i - 1].t) / Math.max(1e-6, s[i].t - s[i - 1].t);
      return s[i - 1].v + (s[i].v - s[i - 1].v) * k;
    }
  }
  return s[s.length - 1].v;
}

/**
 * CSS gradient emulating a UIGradient applied on top of a base colour/transparency.
 * Type: Linear / Radial (circle) / Elliptical / Conical; Scale shrinks or stretches it about its centre;
 * TileMode repeats (or mirrors) it beyond its ends.
 */
export function gradientCss(g: GuiNode, baseColor: string, baseAlpha: number): string {
  const colors: ColorKey[] = g.props.Color;
  const trans: NumberKey[] = g.props.Transparency;
  const rot: number = g.props.Rotation ?? 0;
  const off: Vec2 = g.props.Offset ?? { x: 0, y: 0 };
  const type: string = g.props.Type ?? 'Linear';
  const scale: number = Math.max(0.01, g.props.Scale ?? 1);
  const tile: string = g.props.TileMode ?? 'Clamp';
  const rad = (rot * Math.PI) / 180;
  const ts = [...new Set([...colors.map((k) => k.t), ...trans.map((k) => k.t)])].sort((a, b) => a - b);
  const colorAt = (t: number) => {
    const [r, gg, b] = mul(baseColor, sampleColor(colors, t));
    const a = baseAlpha * (1 - sampleNumber(trans, t));
    return `rgba(${r.toFixed(0)},${gg.toFixed(0)},${b.toFixed(0)},${a.toFixed(3)})`;
  };
  // position of t along the gradient, in % (linear: of the box along the rotation; radial: of the radius; conical: of the turn)
  const linear = type === 'Linear';
  const shift = linear ? off.x * Math.cos(rad) + off.y * Math.sin(rad) : 0;
  const pos = (t: number) => (linear ? 0.5 + (t - 0.5) * scale + shift : t * scale) * 100;
  let stops = ts.map((t) => `${colorAt(t)} ${pos(t).toFixed(2)}%`);
  if (tile === 'Mirror') {
    // the gradient then the same backwards, repeated
    const len = pos(1) - pos(0);
    stops = [...stops, ...[...ts].reverse().map((t) => `${colorAt(t)} ${(pos(0) + 2 * len - (pos(t) - pos(0))).toFixed(2)}%`)];
  }
  const rep = tile === 'Clamp' ? '' : 'repeating-';
  const at = `${(50 + off.x * 100).toFixed(2)}% ${(50 + off.y * 100).toFixed(2)}%`;
  if (type === 'Radial') return `${rep}radial-gradient(circle closest-side at ${at}, ${stops.join(', ')})`;
  if (type === 'Elliptical') return `${rep}radial-gradient(ellipse closest-side at ${at}, ${stops.join(', ')})`;
  if (type === 'Conical') return `${rep}conic-gradient(from ${rot + 90}deg at ${at}, ${stops.join(', ')})`;
  return `${rep}linear-gradient(${rot + 90}deg, ${stops.join(', ')})`;
}

// ---------------------------------------------------------------------------
// Rich text (a safe subset of Roblox's markup)

const ENT: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&amp;': '&' };
const escapeHtml = (s: string) => s.replace(/&(lt|gt|quot|apos|amp);/g, (m) => ENT[m]).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function attr(tag: string, name: string) {
  const m = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag);
  return m?.[1];
}
function safeColor(c?: string) {
  if (!c) return undefined;
  if (/^#[0-9a-f]{3,8}$/i.test(c)) return c;
  const m = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(c);
  return m ? `rgb(${m[1]},${m[2]},${m[3]})` : undefined;
}

export function richTextHtml(text: string): string {
  let out = '';
  let last = 0;
  const re = /<[^>]*>/g;
  let m: RegExpExecArray | null;
  const stack: string[] = [];
  while ((m = re.exec(text))) {
    out += escapeHtml(text.slice(last, m.index));
    last = m.index + m[0].length;
    const tag = m[0];
    const name = /^<\/?\s*([a-z]+)/i.exec(tag)?.[1]?.toLowerCase() ?? '';
    const closing = tag.startsWith('</');
    // Roblox <b> means Bold (700); the HTML <b> would be "bolder" (e.g. SemiBold -> ExtraBold)
    if (name === 'b') {
      out += closing ? '</span>' : '<span style="font-weight:700">';
      continue;
    }
    const simple: Record<string, string> = { i: 'i', u: 'u', s: 's' };
    if (name === 'br') out += '<br/>';
    else if (simple[name]) out += closing ? `</${simple[name]}>` : `<${simple[name]}>`;
    else if (['font', 'uc', 'uppercase', 'sc', 'smallcaps', 'mark', 'stroke'].includes(name)) {
      if (closing) {
        if (stack.length) out += '</span>';
        stack.pop();
      } else {
        const st: string[] = [];
        if (name === 'font') {
          const c = safeColor(attr(tag, 'color'));
          const size = attr(tag, 'size');
          const face = attr(tag, 'face') ?? attr(tag, 'family');
          const weight = attr(tag, 'weight');
          const tr = attr(tag, 'transparency');
          if (c) st.push(`color:${c}`);
          if (size && /^\d+$/.test(size)) st.push(`font-size:${size}px`);
          if (face) st.push(`font-family:${fontFamily(face.replace(/[^A-Za-z0-9]/g, '')).css.replace(/"/g, "'")}`);
          if (weight) st.push(`font-weight:${/^\d+$/.test(weight) ? weight : weight.toLowerCase() === 'bold' ? 700 : 400}`);
          if (tr && /^[\d.]+$/.test(tr)) st.push(`opacity:${1 - parseFloat(tr)}`);
        } else if (name === 'uc' || name === 'uppercase') st.push('text-transform:uppercase');
        else if (name === 'sc' || name === 'smallcaps') st.push('font-variant:small-caps');
        else if (name === 'mark') {
          const c = safeColor(attr(tag, 'color')) ?? '#ffff00';
          st.push(`background:${c}`);
        }
        out += `<span style="${st.join(';')}">`;
        stack.push(name);
      }
    } else out += escapeHtml(tag);
  }
  out += escapeHtml(text.slice(last));
  out += '</span>'.repeat(stack.length);
  return out;
}

// ---------------------------------------------------------------------------

function useThumbs() {
  const [, force] = useState(0);
  useEffect(() => subscribeThumbs(() => force((x) => x + 1)), []);
}

interface NodeProps {
  id: string;
  origin: { x: number; y: number };
  ctx: RenderCtx;
}

function strokesOf(ctx: RenderCtx, n: GuiNode) {
  return n.children.map((c) => ctx.nodes[c]).filter((c) => c?.className === 'UIStroke' && c.props.Enabled !== false);
}

/** A UIGradient inside a UIStroke colours the stroke (Color × gradient) */
function strokeGradient(ctx: RenderCtx, s: GuiNode): GuiNode | undefined {
  const g = findChild(ctx.nodes, s.id, 'UIGradient');
  return g && g.props.Enabled !== false ? g : undefined;
}

/** One colour for a stroke that can't show a gradient (text outlines): the gradient's middle */
function strokeColor(ctx: RenderCtx, s: GuiNode, alpha: number): string {
  const g = strokeGradient(ctx, s);
  if (!g) return rgba(s.props.Color, alpha);
  const [r, gg, b] = mul(s.props.Color, sampleColor(g.props.Color, 0.5));
  return `rgba(${r}, ${gg}, ${b}, ${alpha})`;
}

export const NodeView = memo(function NodeView({ id, origin, ctx }: NodeProps) {
  useThumbs();
  const n = ctx.nodes[id];
  const r = ctx.layout.rects[id];
  if (!n || !r || !isGuiObject(n.className) || n.props.Visible === false) return null;
  const p = n.props;
  const w = r.w;
  const h = r.h;

  const cornerMod = findChild(ctx.nodes, id, 'UICorner');
  const gradMod = findChild(ctx.nodes, id, 'UIGradient');
  const grad = gradMod && gradMod.props.Enabled !== false ? gradMod : undefined;
  const strokes = strokesOf(ctx, n);
  const textual = isText(n.className);
  const borderStrokes = strokes.filter((s) => s.props.ApplyStrokeMode === 'Border' || !textual);
  const textStroke = textual ? strokes.find((s) => s.props.ApplyStrokeMode !== 'Border') : undefined;
  const corners = cornerRadii(cornerMod, w, h);
  const radius: number | string = corners.every((c) => c === corners[0]) ? corners[0] : corners.map((c) => `${c}px`).join(' ');
  const shadows = n.children.map((c) => ctx.nodes[c]).filter((c): c is GuiNode => c?.className === 'UIShadow' && c.props.Enabled !== false);

  const outer: CSSProperties = {
    position: 'absolute',
    left: r.x - origin.x,
    top: r.y - origin.y,
    width: w,
    height: h,
    // Sibling: the element (and everything inside it) sits at its ZIndex among its siblings.
    // Global: no stacking context here, so descendants compete by ZIndex with the whole ScreenGui (see below).
    zIndex: ctx.globalZ ? undefined : p.ZIndex,
    transform: p.Rotation ? `rotate(${p.Rotation}deg)` : undefined,
  };
  const scaleMod = n.children.map((c) => ctx.nodes[c]).find((c) => c?.className === 'UIScale');
  const effectScale = ctx.scales?.[id];
  const uiScale = scaleMod || effectScale !== undefined ? (scaleMod?.props.Scale ?? 1) * (effectScale ?? 1) : undefined;
  if (uiScale !== undefined) {
    // UIScale scales about the AnchorPoint; Rotation still turns about the centre
    const a: Vec2 = p.AnchorPoint;
    const cx = (0.5 - a.x) * w;
    const cy = (0.5 - a.y) * h;
    outer.transformOrigin = `${a.x * 100}% ${a.y * 100}%`;
    outer.transform = `scale(${uiScale})` + (p.Rotation ? ` translate(${cx}px, ${cy}px) rotate(${p.Rotation}deg) translate(${-cx}px, ${-cy}px)` : '');
  }
  if (n.className === 'CanvasGroup') outer.opacity = 1 - (p.GroupTransparency ?? 0);

  // background + border/stroke
  const bgAlpha = 1 - (p.BackgroundTransparency ?? 0);
  const bg: CSSProperties = { position: 'absolute', inset: 0, borderRadius: radius, pointerEvents: 'none' };
  if (bgAlpha > 0) {
    if (grad) bg.backgroundImage = gradientCss(grad, p.BackgroundColor3, bgAlpha);
    else bg.backgroundColor = rgba(p.BackgroundColor3, bgAlpha);
  }
  // strokes: the plain kind (outside, no offset, fixed thickness) as stacked box-shadows; the rest as their own rings
  const ringed = borderStrokes.filter((s) => (s.props.BorderStrokePosition ?? 'Outer') !== 'Outer' || resolveU(s.props.BorderOffset) !== 0 || s.props.StrokeSizingMode === 'ScaledSize' || strokeGradient(ctx, s));
  const plain = borderStrokes.filter((s) => !ringed.includes(s));
  const boxShadows: string[] = [];
  let spread = 0;
  for (const s of plain) {
    spread += s.props.Thickness;
    boxShadows.push(`0 0 0 ${spread}px ${rgba(s.props.Color, 1 - s.props.Transparency)}`);
  }
  if (!cornerMod && p.BorderSizePixel > 0 && bgAlpha > 0) {
    // BorderMode: outside the box (Outline), half in / half out (Middle) or inside it (Inset)
    const b = p.BorderSizePixel;
    const c = rgba(p.BorderColor3, bgAlpha);
    if (p.BorderMode === 'Inset') boxShadows.push(`inset 0 0 0 ${b}px ${c}`);
    else if (p.BorderMode === 'Middle') boxShadows.push(`0 0 0 ${spread + b / 2}px ${c}`, `inset 0 0 0 ${b / 2}px ${c}`);
    else boxShadows.push(`0 0 0 ${spread + b}px ${c}`);
  }
  if (boxShadows.length) bg.boxShadow = boxShadows.join(', ');
  const rings = ringed.map((s) => {
    const t = s.props.StrokeSizingMode === 'ScaledSize' ? s.props.Thickness * Math.min(w, h) : s.props.Thickness;
    const pos = s.props.BorderStrokePosition ?? 'Outer';
    const out = resolve(s.props.BorderOffset ?? { s: 0, o: 0 }, Math.min(w, h)) + (pos === 'Outer' ? t : pos === 'Center' ? t / 2 : 0);
    const sg = strokeGradient(ctx, s);
    if (sg) {
      // a gradient ring: the gradient fills the box, a mask keeps only the band t wide
      const band = 'linear-gradient(#000 0 0)';
      return (
        <div
          key={s.id}
          className="rb-stroke"
          style={{
            position: 'absolute', inset: -out, padding: t, boxSizing: 'border-box', pointerEvents: 'none',
            backgroundImage: gradientCss(sg, s.props.Color, 1 - s.props.Transparency),
            WebkitMask: `${band} content-box, ${band}`, WebkitMaskComposite: 'xor', maskComposite: 'exclude',
            borderRadius: corners.map((c) => `${c > 0 ? Math.max(0, c + out) : 0}px`).join(' '), zIndex: (s.props.ZIndex ?? 1) < 0 ? -1 : undefined,
          } as CSSProperties}
        />
      );
    }
    return (
      <div
        key={s.id}
        className="rb-stroke"
        style={{
          position: 'absolute', inset: -out, border: `${t}px solid ${rgba(s.props.Color, 1 - s.props.Transparency)}`, pointerEvents: 'none',
          borderRadius: corners.map((c) => `${c > 0 ? Math.max(0, c + out) : 0}px`).join(' '), zIndex: (s.props.ZIndex ?? 1) < 0 ? -1 : undefined,
        }}
      />
    );
  });

  // "Border glow on hover" (Preview): the outline it adds, faded in
  const glowFx = ctx.glows?.[id] ? n.effects?.find((e) => e.kind === 'hoverGlow') : undefined;
  if (glowFx) {
    const t = glowFx.amount;
    rings.push(
      <div
        key="hover-glow"
        className="rb-stroke"
        style={{
          position: 'absolute', inset: -t, border: `${t}px solid ${glowFx.color ?? '#ffffff'}`, opacity: ctx.glows![id], pointerEvents: 'none',
          borderRadius: corners.map((c) => `${c > 0 ? c + t : 0}px`).join(' '),
        }}
      />,
    );
  }

  // UIShadow: a blurred copy of the shape behind it (or inside it when Inset); Text mode shadows the letters
  const textShadows = textual ? shadows.filter((s) => s.props.Mode === 'Text') : [];
  const shapeShadows = shadows.filter((s) => !textShadows.includes(s));
  const shadowOf = (s: GuiNode) => {
    const sp = s.props;
    const ox = resolve(sp.Offset.x, w);
    const oy = resolve(sp.Offset.y, h);
    const sx = resolve(sp.Spread.x, w);
    const sy = resolve(sp.Spread.y, h);
    const blur = Math.max(0, resolve(sp.BlurRadius, Math.min(w, h)));
    const color = rgba(sp.Color, 1 - (sp.Transparency ?? 0));
    if (sp.Inset) {
      return (
        <div key={s.id} className="rb-shadow" style={{ position: 'absolute', inset: 0, borderRadius: radius, overflow: 'hidden', pointerEvents: 'none', boxShadow: `inset ${ox}px ${oy}px ${blur}px ${Math.max(sx, sy)}px ${color}` }} />
      );
    }
    const grow = (sx + sy) / 2;
    return (
      <div
        key={s.id}
        className="rb-shadow"
        style={{
          position: 'absolute', left: ox - sx, top: oy - sy, width: w + 2 * sx, height: h + 2 * sy, pointerEvents: 'none', background: color,
          borderRadius: corners.map((c) => `${c > 0 ? Math.max(0, c + grow) : 0}px`).join(' '), filter: blur > 0 ? `blur(${(blur / 2).toFixed(2)}px)` : undefined,
        }}
      />
    );
  };
  const shadowsBehind = shapeShadows.filter((s) => !s.props.Inset && (s.props.ZIndex ?? -1) < 0).map(shadowOf);
  const shadowsAbove = shapeShadows.filter((s) => s.props.Inset || (s.props.ZIndex ?? -1) >= 0).map(shadowOf);
  const textShadowCss = textShadows.length
    ? textShadows.map((s) => `${resolve(s.props.Offset.x, w)}px ${resolve(s.props.Offset.y, h)}px ${Math.max(0, resolve(s.props.BlurRadius, Math.min(w, h)))}px ${rgba(s.props.Color, 1 - (s.props.Transparency ?? 0))}`).join(', ')
    : undefined;

  const children = throughFolders(ctx.nodes, n.children);
  const paths = n.children.filter((c) => ctx.nodes[c]?.className === 'Path2D');
  const scrolling = n.className === 'ScrollingFrame';
  const clip = p.ClipsDescendants || scrolling || n.className === 'CanvasGroup';
  const content = ctx.layout.content[id] ?? r;

  let layer: ReactNode = null;
  if (textual) layer = <TextLayer n={n} ctx={ctx} box={{ x: content.x - r.x, y: content.y - r.y, w: content.w, h: content.h }} el={{ w, h }} grad={grad} stroke={textStroke} textShadow={textShadowCss} />;
  else if (isImage(n.className)) layer = <ImageLayer n={n} ctx={ctx} w={w} h={h} radius={radius} />;
  else if (n.className === 'VideoFrame')
    layer = (
      <div className="rb-placeholder" style={{ borderRadius: radius }}>
        <Clapperboard size={Math.min(48, Math.max(12, Math.min(w, h) * 0.3))} strokeWidth={1.25} />
        {p.Video && Math.min(w, h) > 60 && <span className="rb-placeholder-id">{String(p.Video).replace('rbxassetid://', '#')}</span>}
      </div>
    );
  else if (n.className === 'ViewportFrame')
    layer = (
      <div className="rb-placeholder" style={{ borderRadius: radius }}>
        <Box size={Math.min(48, Math.max(12, Math.min(w, h) * 0.3))} strokeWidth={1.25} />
      </div>
    );

  const canvas = scrolling ? ctx.layout.canvas[id] : undefined;
  const autoBtn = ctx.interactive && (n.className === 'TextButton' || n.className === 'ImageButton') && p.AutoButtonColor !== false && p.Interactable !== false;

  // Interactable = false: no input for it or anything inside it
  const blocked = ctx.interactive && p.Interactable === false;
  if (blocked) outer.pointerEvents = 'none';
  const ev = ctx.onEvent && ctx.eventIds?.has(id) && !blocked ? ctx.onEvent : null;
  const handlers = ev
    ? {
        onPointerEnter: () => ev(id, 'enter'),
        onPointerLeave: () => ev(id, 'leave'),
        onPointerDown: () => ev(id, 'down'),
        onPointerUp: () => ev(id, 'up'),
        onClick: () => ev(id, 'click'),
        onWheel: (e: React.WheelEvent) => ev(id, e.deltaY > 0 ? 'wheelDown' : 'wheelUp'),
      }
    : {};

  return (
    <div data-nid={id} className={autoBtn || ev ? 'rb-node rb-autobtn' : 'rb-node'} style={outer} {...handlers}>
      {ctx.globalZ ? (
        // Global ZIndex: only the element's own look is lifted to its ZIndex; its children are ordered on their own
        <div style={{ position: 'absolute', inset: 0, zIndex: p.ZIndex }}>
          {shadowsBehind}
          <div className="rb-bg" style={bg} />
          {rings}
          {shadowsAbove}
          {layer}
        </div>
      ) : (
        <>
          {shadowsBehind}
          <div className="rb-bg" style={bg} />
          {rings}
          {shadowsAbove}
          {layer}
        </>
      )}
      {(children.length > 0 || paths.length > 0) && (
        <div
          className={scrolling && ctx.interactive ? 'rb-children rb-scroll' : 'rb-children'}
          style={{
            position: 'absolute', inset: 0, overflow: clip ? (scrolling && ctx.interactive ? 'auto' : 'hidden') : 'visible',
            // Sibling ZIndex: children always draw above their parent, even with a lower (or negative) ZIndex
            zIndex: ctx.globalZ ? undefined : 0,
            borderRadius: n.className === 'CanvasGroup' ? radius : undefined,
            ['--sbw' as any]: `${p.ScrollBarThickness ?? 0}px`,
            ['--sbc' as any]: scrolling ? rgba(p.ScrollBarImageColor3, 1 - (p.ScrollBarImageTransparency ?? 0)) : undefined,
            overflowX: scrolling && ctx.interactive && p.ScrollingDirection === 'Y' ? 'hidden' : undefined,
            overflowY: scrolling && ctx.interactive && p.ScrollingDirection === 'X' ? 'hidden' : undefined,
          }}
        >
          {canvas && ctx.interactive && <div style={{ position: 'absolute', left: canvas.x - r.x + canvas.w, top: canvas.y - r.y + canvas.h, width: 1, height: 1 }} />}
          {children.map((c) => <NodeView key={c} id={c} origin={{ x: r.x, y: r.y }} ctx={ctx} />)}
          {paths.map((c) => <PathView key={c} id={c} box={r} ctx={ctx} />)}
        </div>
      )}
      {scrolling && !ctx.interactive && canvas && <FakeScrollbar n={n} w={w} h={h} canvas={canvas} origin={r} />}
    </div>
  );
});

function FakeScrollbar({ n, w, h, canvas, origin }: { n: GuiNode; w: number; h: number; canvas: { x: number; y: number; w: number; h: number }; origin: { x: number; y: number } }) {
  const t = n.props.ScrollBarThickness ?? 0;
  if (t <= 0) return null;
  const color = rgba(n.props.ScrollBarImageColor3, 1 - (n.props.ScrollBarImageTransparency ?? 0));
  const bars: ReactNode[] = [];
  if (canvas.h > h + 0.5 && n.props.ScrollingDirection !== 'X') {
    const th = (h * h) / canvas.h;
    const top = ((origin.y - canvas.y) / (canvas.h - h)) * (h - th);
    const side = n.props.VerticalScrollBarPosition === 'Left' ? { left: 0 } : { right: 0 };
    bars.push(<div key="v" style={{ position: 'absolute', ...side, top, width: t, height: th, background: color, pointerEvents: 'none', zIndex: 100000 }} />);
  }
  if (canvas.w > w + 0.5 && n.props.ScrollingDirection !== 'Y') {
    const tw = (w * w) / canvas.w;
    const left = ((origin.x - canvas.x) / (canvas.w - w)) * (w - tw);
    bars.push(<div key="h" style={{ position: 'absolute', bottom: 0, left, height: t, width: tw, background: color, pointerEvents: 'none', zIndex: 100000 }} />);
  }
  return <>{bars}</>;
}

function TextLayer({ n, ctx, box, el, grad, stroke, textShadow }: { n: GuiNode; ctx: RenderCtx; box: { x: number; y: number; w: number; h: number }; el: { w: number; h: number }; grad?: GuiNode; stroke?: GuiNode; textShadow?: string }) {
  const p = n.props;
  const font: FontValue = p.FontFace;
  const isBox = n.className === 'TextBox';
  const text = boundText(n, ctx.previewUser);
  const showPlaceholder = isBox && !text;
  const multiColor = !!n.textColors?.stops.length && !showPlaceholder;
  const raw: string = showPlaceholder ? p.PlaceholderText ?? '' : multiColor ? applyTextColors(text, n.textColors) : text;
  const lh = p.LineHeight ?? 1;
  let size = p.TextSize;
  const tsc = findChild(ctx.nodes, n.id, 'UITextSizeConstraint');
  if (p.TextScaled) {
    // Roblox caps TextScaled at 100px; with pixel scaling that cap scales with the screen like other pixel values
    const cap = Math.min(100, tsc?.props.MaxTextSize ?? 100 * (ctx.pixelScale ?? 1));
    size = fitTextSize(p.RichText || multiColor ? stripRichText(raw) : raw, font, box.w, box.h, lh, !!p.TextWrapped, tsc?.props.MinTextSize ?? 1, cap);
  } else if (tsc) size = Math.min(Math.max(size, tsc.props.MinTextSize), tsc.props.MaxTextSize);

  const color = showPlaceholder ? p.PlaceholderColor3 : p.TextColor3;
  const alpha = 1 - (p.TextTransparency ?? 0);
  const xa: string = p.TextXAlignment;
  const ya: string = p.TextYAlignment;

  // put the baseline where Roblox puts it (some fonts have browser metrics that differ from Roblox's)
  const shiftPx = baselineShift(font) * size;
  const wrap: CSSProperties = {
    position: 'absolute', left: box.x, top: box.y - shiftPx, width: box.w, height: box.h, display: 'flex', flexDirection: 'column',
    justifyContent: ya === 'Top' ? 'flex-start' : ya === 'Bottom' ? 'flex-end' : 'center',
    alignItems: xa === 'Left' ? 'flex-start' : xa === 'Right' ? 'flex-end' : 'center',
    pointerEvents: 'none',
  };
  const textStyle: CSSProperties = {
    ...fontStyle(font, size), lineHeight: lh * lineFactor(font), whiteSpace: p.TextWrapped ? 'pre-wrap' : 'pre',
    direction: p.TextDirection === 'RightToLeft' ? 'rtl' : p.TextDirection === 'LeftToRight' ? 'ltr' : undefined,
    textAlign: xa === 'Left' ? 'left' : xa === 'Right' ? 'right' : 'center',
    overflowWrap: p.TextWrapped ? 'break-word' : undefined, maxWidth: p.TextWrapped ? '100%' : undefined,
  };
  const fill: CSSProperties = { ...textStyle, position: 'relative' };
  // A UIGradient spans the WHOLE element box (not just the text line), so it's painted on a layer the size
  // of the element and clipped to the letters. Plain text: the layer is the text colour × gradient
  // (incl. its transparency). Rich text keeps per-span colours and the gradient multiplies over them.
  const richHtml = (p.RichText || multiColor) && !showPlaceholder;
  // 0.99: fully opaque text gets the browser's coloured (sub-pixel) smoothing on Windows, which fringes the
  // letters blue / orange against outlines; slightly translucent text is smoothed in grey, like Roblox
  fill.color = grad && !richHtml ? 'transparent' : rgba(color, Math.min(alpha, 0.99));
  // the text is laid out with padding (not absolute positioning): background-clip:text only reliably
  // includes in-flow, non-positioned descendants
  // Text that overflows its box still gets coloured (Roblox clamps the gradient past the edges). Along the
  // gradient the layer must keep the box's size (the colours are mapped onto it), but across a vertical or
  // horizontal gradient it can grow, so overflowing letters aren't cut off.
  const gRot = ((((grad?.props.Rotation ?? 0) % 180) + 180) % 180);
  const ex = grad && Math.abs(gRot - 90) < 0.5 ? el.w : 0;
  const ey = grad && (gRot < 0.5 || gRot > 179.5) ? el.h : 0;
  const gradLayer: CSSProperties | null = grad
    ? {
        position: 'absolute', left: -ex, top: -ey, width: el.w + 2 * ex, height: el.h + 2 * ey, boxSizing: 'border-box', pointerEvents: 'none',
        paddingLeft: box.x + ex, paddingTop: box.y - shiftPx + ey, paddingRight: el.w - box.x - box.w + ex, paddingBottom: el.h - box.y - box.h + shiftPx + ey,
        display: 'flex', flexDirection: 'column', justifyContent: wrap.justifyContent, alignItems: wrap.alignItems,
        backgroundImage: richHtml ? gradientCss(grad, '#ffffff', 1) : gradientCss(grad, color, alpha),
        WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
        mixBlendMode: richHtml ? 'multiply' : undefined,
      }
    : null;

  let strokeStyle: CSSProperties | null = null;
  if (stroke && stroke.props.Thickness > 0) {
    const sc = strokeColor(ctx, stroke, (1 - stroke.props.Transparency) * alpha);
    strokeStyle = { ...textStyle, position: 'absolute', inset: 0, color: sc, WebkitTextStroke: `${stroke.props.Thickness * 2}px ${sc}`, strokeLinejoin: 'round' } as CSSProperties;
    if (stroke.props.LineJoinMode === 'Miter') (strokeStyle as any).strokeLinejoin = 'miter';
  } else if ((p.TextStrokeTransparency ?? 1) < 1) {
    const sc = rgba(p.TextStrokeColor3, (1 - p.TextStrokeTransparency) * alpha);
    strokeStyle = { ...textStyle, position: 'absolute', inset: 0, color: sc, WebkitTextStroke: `2px ${sc}` };
  }

  if (ctx.editingTextId === n.id) return null;

  if (isBox && ctx.interactive) {
    return <PreviewTextBox n={n} style={{ ...textStyle, ...fill, color: rgba(p.TextColor3, alpha) }} box={box} />;
  }

  // MaxVisibleGraphemes hides the letters past N but keeps the layout (typewriter text)
  const maxG = Math.floor(p.MaxVisibleGraphemes ?? -1);
  const rich = (p.RichText || multiColor) && !showPlaceholder;
  const html = rich || maxG >= 0 ? { __html: maxG >= 0 ? limitGraphemes(rich ? richTextHtml(raw) : escapeText(raw), maxG) : richTextHtml(raw) } : null;
  // TextTruncate: "…" where it doesn't fit (one line, or the lines that fit when wrapped)
  const truncate = p.TextTruncate && p.TextTruncate !== 'None' && !p.TextScaled;
  const lineH = size * lh * lineFactor(font);
  // text-align on the block, so every wrapped line is aligned (and the stroke / shadow copies line up with it)
  const inner: CSSProperties = { position: 'relative', maxWidth: p.TextWrapped || truncate ? '100%' : undefined, textAlign: textStyle.textAlign };
  if (truncate && !p.TextWrapped) Object.assign(inner, { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'pre' });
  if (truncate && p.TextWrapped) Object.assign(inner, { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: Math.max(1, Math.floor((box.h + 0.5) / lineH)), overflow: 'hidden' });
  return (
    <>
      <div style={wrap}>
        <div style={inner}>
          {/* copies under the text: rich-text colours inside them must not override the stroke / shadow colour */}
          {textShadow && (html ? <span className="rb-text-under" style={{ ...textStyle, position: 'absolute', inset: 0, color: 'transparent', textShadow }} dangerouslySetInnerHTML={html} /> : <span style={{ ...textStyle, position: 'absolute', inset: 0, color: 'transparent', textShadow }}>{raw}</span>)}
          {strokeStyle && (html ? <span className="rb-text-under" style={strokeStyle} dangerouslySetInnerHTML={html} /> : <span style={strokeStyle}>{raw}</span>)}
          {html ? <span style={fill} dangerouslySetInnerHTML={html} /> : <span style={fill}>{raw}</span>}
        </div>
      </div>
      {gradLayer && (
        <div className="rb-grad-overlay" style={gradLayer}>
          <div style={inner}>
            {html ? <span style={textStyle} dangerouslySetInnerHTML={html} /> : <span style={textStyle}>{raw}</span>}
          </div>
        </div>
      )}
    </>
  );
}

function PreviewTextBox({ n, style, box }: { n: GuiNode; style: CSSProperties; box: { x: number; y: number; w: number; h: number } }) {
  const [value, setValue] = useState<string>(n.props.Text ?? '');
  const p = n.props;
  const common = {
    value,
    placeholder: p.PlaceholderText,
    onChange: (e: any) => setValue(e.target.value),
    onFocus: () => p.ClearTextOnFocus && setValue(''),
    readOnly: p.TextEditable === false,
    className: 'rb-textbox',
    style: {
      ...style, position: 'absolute' as const, left: box.x, top: box.y, width: box.w, height: box.h, background: 'transparent',
      border: 'none', outline: 'none', padding: 0, resize: 'none' as const, ['--ph' as any]: rgba(p.PlaceholderColor3, 1),
      pointerEvents: 'auto' as const,
    },
  };
  return p.MultiLine ? <textarea {...common} /> : <input {...common} />;
}

function ImageLayer({ n, ctx, w, h, radius }: { n: GuiNode; ctx: RenderCtx; w: number; h: number; radius: number | string }) {
  const p = n.props;
  const src = n.preview?.src || (n.avatar ? avatarThumb(ctx.previewUser?.id ?? 1, n.avatar.kind) : assetThumb(p.Image));
  if (!src) {
    if (ctx.interactive) return null;
    return (
      <div className="rb-placeholder" style={{ borderRadius: radius }}>
        <ImageIcon size={Math.min(40, Math.max(10, Math.min(w, h) * 0.3))} strokeWidth={1.25} />
        {p.Image && Math.min(w, h) > 60 && <span className="rb-placeholder-id">{String(p.Image).replace('rbxassetid://', '#')}</span>}
      </div>
    );
  }
  const st: CSSProperties = {
    position: 'absolute', inset: 0, borderRadius: radius, pointerEvents: 'none', opacity: 1 - (p.ImageTransparency ?? 0),
    backgroundImage: `url("${src}")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'center',
    imageRendering: p.ResampleMode === 'Pixelated' ? 'pixelated' : undefined,
  };
  // ImageRectOffset / ImageRectSize: show one part of the image (sprite sheets)
  const rs: Vec2 = p.ImageRectSize ?? { x: 0, y: 0 };
  const ro: Vec2 = p.ImageRectOffset ?? { x: 0, y: 0 };
  const natural = rs.x > 0 && rs.y > 0 ? (n.preview ? { w: n.preview.w, h: n.preview.h } : imageSize(src)) : undefined;
  const sprite = natural && p.ScaleType !== 'Tile' && p.ScaleType !== 'Slice';
  const mask: CSSProperties = {};
  switch (p.ScaleType) {
    case 'Fit':
      st.backgroundSize = 'contain';
      break;
    case 'Crop':
      st.backgroundSize = 'cover';
      break;
    case 'Tile': {
      const ts: UDim2 = p.TileSize;
      st.backgroundSize = `${resolve(ts.x, w)}px ${resolve(ts.y, h)}px`;
      st.backgroundRepeat = 'repeat';
      st.backgroundPosition = 'top left';
      break;
    }
    case 'Slice': {
      const sc = p.SliceCenter;
      // edges are in the real image's pixels
      const real = n.preview ? { w: n.preview.w, h: n.preview.h } : imageSize(src);
      const iw = real?.w;
      const ih = real?.h;
      if (iw && ih && sc.x1 >= sc.x0 && sc.y1 >= sc.y0 && (sc.x1 > 0 || sc.y1 > 0)) {
        const s = p.SliceScale ?? 1;
        // a centre that's a single point (e.g. 15,15,15,15): Roblox stretches that pixel row / column
        // across the middle; a zero-size slice would draw nothing and leave gaps
        const x1 = Math.min(iw, Math.max(sc.x1, sc.x0 + 1));
        const y1 = Math.min(ih, Math.max(sc.y1, sc.y0 + 1));
        const edges = [sc.y0, iw - x1, ih - y1, sc.x0].map((e) => Math.max(0, e));
        delete st.backgroundImage;
        st.borderStyle = 'solid';
        st.borderImageSource = `url("${src}")`;
        st.borderImageSlice = `${edges.join(' ')} fill`;
        // border-image-width (not border-width): the element keeps its size, and slices too big for it
        // are shrunk proportionally, like Roblox does
        st.borderWidth = 0;
        st.borderImageWidth = edges.map((e) => `${e * s}px`).join(' ');
        st.borderRadius = 0;
      } else st.backgroundSize = '100% 100%';
      break;
    }
    default:
      st.backgroundSize = '100% 100%';
  }
  if (sprite && natural) {
    const kx = w / rs.x;
    const ky = h / rs.y;
    st.backgroundSize = `${natural.w * kx}px ${natural.h * ky}px`;
    st.backgroundPosition = `${-ro.x * kx}px ${-ro.y * ky}px`;
  }
  for (const k of ['backgroundSize', 'backgroundRepeat', 'backgroundPosition'] as const) (mask as any)['mask' + k.slice(10)] = st[k];
  // ImageColor3 and a UIGradient both tint the image (multiplied over it, inside its shape)
  const gradMod = findChild(ctx.nodes, n.id, 'UIGradient');
  const imgGrad = gradMod && gradMod.props.Enabled !== false ? gradMod : undefined;
  const tint = (p.ImageColor3 ?? '#ffffff').toLowerCase() !== '#ffffff' || !!imgGrad;
  const tintStyle: CSSProperties = st.borderImageSource
    ? {
        ...st, borderImageSource: 'none', borderStyle: 'none',
        WebkitMaskBoxImageSource: st.borderImageSource as string, WebkitMaskBoxImageSlice: st.borderImageSlice as string, WebkitMaskBoxImageWidth: st.borderImageWidth as string,
      } as CSSProperties
    : { ...st, maskImage: `url("${src}")`, WebkitMaskImage: `url("${src}")`, ...mask };
  if (imgGrad) Object.assign(tintStyle, { backgroundImage: gradientCss(imgGrad, p.ImageColor3 ?? '#ffffff', 1), backgroundSize: '100% 100%', backgroundRepeat: 'no-repeat', backgroundPosition: '0 0' });
  else Object.assign(tintStyle, { backgroundImage: 'none', backgroundColor: p.ImageColor3 });
  // ImageButton: HoverImage / PressedImage replace the image while hovered / held (Preview)
  const alt = (content: string | undefined, cls: string) => {
    const s2 = ctx.interactive && content ? assetThumb(content) : undefined;
    return s2 ? <div className={cls} style={{ ...st, backgroundImage: `url("${s2}")` }} /> : null;
  };
  const hover = n.className === 'ImageButton' ? alt(p.HoverImage, 'rb-img-hover') : null;
  const pressed = n.className === 'ImageButton' ? alt(p.PressedImage, 'rb-img-pressed') : null;
  return (
    <>
      <div className={`rb-img-base${hover ? ' has-hover' : ''}${pressed ? ' has-pressed' : ''}`} style={st} />
      {hover}
      {pressed}
      {tint && (st.backgroundImage || st.borderImageSource) && <div style={{ ...tintStyle, mixBlendMode: 'multiply' }} />}
    </>
  );
}

/** Renders a root GUI. ScreenGuis sit on the device screen; world GUIs render as their own artboard. */
export function ScreenView({ id, ctx }: { id: string; ctx: RenderCtx }) {
  const n = ctx.nodes[id];
  const r = ctx.layout.rects[id];
  if (!n || !r) return null;
  const world = isWorldGui(n.className);
  if (n.props.Enabled === false && !world) return null;
  const kids = throughFolders(ctx.nodes, n.children);
  if (n.props.ZIndexBehavior === 'Global') ctx = { ...ctx, globalZ: true };
  const clip = n.className === 'SurfaceGui' || (world && n.props.ClipsDescendants);
  const safe = ctx.layout.clips?.[id];
  if (safe) {
    // ClipToDeviceSafeArea: content is cut off at the notch / home bar (stretched fullscreen backgrounds aren't)
    const free = kids.filter((c) => ctx.layout.unclipped?.has(c));
    const inside = kids.filter((c) => !ctx.layout.unclipped?.has(c));
    return (
      <div data-nid={id} className="rb-screen" style={{ position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h, zIndex: n.props.DisplayOrder ?? 0 }}>
        {free.map((c) => <NodeView key={c} id={c} origin={{ x: r.x, y: r.y }} ctx={ctx} />)}
        <div style={{ position: 'absolute', left: safe.x - r.x, top: safe.y - r.y, width: safe.w, height: safe.h, overflow: 'hidden', pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', left: r.x - safe.x, top: r.y - safe.y, pointerEvents: 'auto' }}>
            {inside.map((c) => <NodeView key={c} id={c} origin={{ x: r.x, y: r.y }} ctx={ctx} />)}
          </div>
        </div>
        {n.children.filter((c) => ctx.nodes[c]?.className === 'Path2D').map((c) => <PathView key={c} id={c} box={r} ctx={ctx} />)}
      </div>
    );
  }
  return (
    <div
      data-nid={id}
      className={world ? 'rb-screen rb-world' : 'rb-screen'}
      style={{
        position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h, zIndex: n.props.DisplayOrder ?? 0,
        overflow: clip ? 'hidden' : undefined, opacity: world && n.props.Enabled === false ? 0.35 : undefined,
      }}
    >
      {kids.map((c) => <NodeView key={c} id={c} origin={{ x: r.x, y: r.y }} ctx={ctx} />)}
      {n.children.filter((c) => ctx.nodes[c]?.className === 'Path2D').map((c) => <PathView key={c} id={c} box={r} ctx={ctx} />)}
    </div>
  );
}

/** A Path2D, drawn as SVG over its parent's box (the stroke is clickable in the editor) */
function PathView({ id, box, ctx }: { id: string; box: { x: number; y: number; w: number; h: number }; ctx: RenderCtx }) {
  const n = ctx.nodes[id];
  if (!n || n.props.Visible === false || !n.points?.length) return null;
  const p = n.props;
  const d = pathData(n.points, { x: 0, y: 0, w: box.w, h: box.h }, !!p.Closed);
  const stroke = rgba(p.Color3, 1 - (p.Transparency ?? 0));
  return (
    <svg className="rb-path" width={box.w} height={box.h} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none', zIndex: p.ZIndex }}>
      <path d={d} fill="none" stroke={stroke} strokeWidth={Math.max(0, p.Thickness ?? 1)} strokeLinecap="round" strokeLinejoin="round" />
      {!ctx.interactive && <path data-nid={id} d={d} fill="none" stroke="transparent" strokeWidth={Math.max(10, (p.Thickness ?? 1) + 8)} style={{ pointerEvents: 'stroke' }} />}
    </svg>
  );
}

/** Mock of Roblox's in-game top bar (the 58px GUI inset): menu + chat on the left, players + more on the right */
/** The device's camera notch and home bar (phones), drawn over the screen */
export function DeviceCutouts({ device }: { device: Device }) {
  const s = device.safe;
  if (!s) return null;
  const landscape = device.w > device.h;
  return (
    <div className="device-cutouts" title="Device safe area: the notch and home bar (ScreenInsets / ClipToDeviceSafeArea)">
      {s.l > 0 && <div className="cutout-zone" style={{ left: 0, top: 0, width: s.l, bottom: 0 }} />}
      {s.r > 0 && <div className="cutout-zone" style={{ right: 0, top: 0, width: s.r, bottom: 0 }} />}
      {s.t > 0 && <div className="cutout-zone" style={{ left: 0, top: 0, right: 0, height: s.t }} />}
      {s.b > 0 && <div className="cutout-zone" style={{ left: 0, bottom: 0, right: 0, height: s.b }} />}
      {landscape ? (
        <div className="cutout-notch" style={{ left: 0, top: device.h / 2 - 80, width: 30, height: 160, borderRadius: '0 18px 18px 0' }} />
      ) : (
        <div className="cutout-notch" style={{ top: 0, left: device.w / 2 - 80, width: 160, height: 30, borderRadius: '0 0 18px 18px' }} />
      )}
      {s.b > 0 && <div className="cutout-homebar" style={{ left: device.w / 2 - 67, bottom: 8, width: 134 }} />}
    </div>
  );
}

export function TopbarMock({ title, device }: { title?: string; device?: Device }) {
  const s = device?.safe;
  return (
    <div className="topbar-mock" title={title} style={s ? { left: s.l, top: s.t, right: s.r } : undefined}>
      <div className="tb-pill">
        <span className="tb-icon" title="Roblox menu">
          <svg viewBox="0 0 24 24" width="24" height="24">
            <g transform="rotate(15 12 12)">
              <rect x="3" y="3" width="18" height="18" rx="2.5" fill="#fff" />
              <rect x="9.6" y="9.6" width="4.8" height="4.8" fill="#18181c" />
            </g>
          </svg>
        </span>
        <span className="tb-divider" />
        <span className="tb-icon" title="Chat"><MessageCircle size={22} strokeWidth={2.2} /></span>
        <span className="tb-icon" title="Backpack"><Backpack size={21} strokeWidth={2.2} /></span>
      </div>
      <div className="tb-pill right">
        <span className="tb-icon" title="Players"><Users size={21} strokeWidth={2.2} /></span>
        <span className="tb-icon" title="More"><Ellipsis size={22} strokeWidth={2.6} /></span>
      </div>
    </div>
  );
}

/** UICorner radii in px [top-left, top-right, bottom-right, bottom-left]; per-corner radii override CornerRadius */
export function cornerRadii(corner: GuiNode | undefined, w: number, h: number): [number, number, number, number] {
  if (!corner) return [0, 0, 0, 0];
  const m = Math.min(w, h);
  const r = (u?: UDim) => (u ? Math.max(0, Math.min(resolve(u, m), m / 2)) : undefined);
  const all = r(corner.props.CornerRadius) ?? 0;
  const p = corner.props;
  return [r(p.TopLeftRadius) ?? all, r(p.TopRightRadius) ?? all, r(p.BottomRightRadius) ?? all, r(p.BottomLeftRadius) ?? all];
}

const resolveU = (u?: UDim) => (u ? u.s + u.o : 0);

const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Keep the first n letters (graphemes) of some HTML visible; the rest stay laid out but hidden */
function limitGraphemes(html: string, n: number): string {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const seg = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new (Intl as any).Segmenter(undefined, { granularity: 'grapheme' }) : null;
  const split = (t: string): string[] => (seg ? Array.from(seg.segment(t), (x: any) => x.segment as string) : Array.from(t));
  let left = n;
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const parts = split(child.textContent ?? '');
        if (left >= parts.length) {
          left -= parts.length;
          continue;
        }
        // split this text node where the visible letters run out
        const i = left;
        left = 0;
        const hidden = document.createElement('span');
        hidden.style.visibility = 'hidden';
        hidden.textContent = parts.slice(i).join('');
        child.textContent = parts.slice(0, i).join('');
        child.parentNode!.insertBefore(hidden, child.nextSibling);
      } else if (left <= 0 && child.nodeType === Node.ELEMENT_NODE) {
        (child as HTMLElement).style.visibility = 'hidden';
      } else walk(child);
    }
  };
  walk(tpl.content);
  return tpl.innerHTML;
}
