import { memo, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Backpack, Box, Ellipsis, Image as ImageIcon, MessageCircle, Users } from 'lucide-react';
import { findChild, resolve, type LayoutResult } from '../model/layout';
import { baselineShift, fitTextSize, fontFamily, fontStyle, lineFactor, stripRichText } from '../model/fonts';
import { isGuiObject, isImage, isText, isWorldGui } from '../model/schema';
import type { UIEvent } from '../model/runtime';
import type { ColorKey, FontValue, GuiNode, NumberKey, PreviewUser, UDim2, Vec2 } from '../model/types';
import { assetThumb, avatarThumb, subscribeThumbs } from './thumbs';
import { applyTextColors } from '../model/richColors';

export interface RenderCtx {
  nodes: Record<string, GuiNode>;
  layout: LayoutResult;
  /** Preview/play mode: live buttons, text boxes and native scrolling */
  interactive: boolean;
  editingTextId?: string | null;
  /** UIScale from effects (Preview) */
  scales?: Record<string, number>;
  /** Pixel-scale factor for this screen (the 100px TextScaled limit scales with it) */
  pixelScale?: number;
  /** Player shown for avatar images / name bindings */
  previewUser?: PreviewUser;
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

/** CSS linear-gradient emulating a UIGradient applied on top of a base colour/transparency */
export function gradientCss(g: GuiNode, baseColor: string, baseAlpha: number): string {
  const colors: ColorKey[] = g.props.Color;
  const trans: NumberKey[] = g.props.Transparency;
  const rot: number = g.props.Rotation ?? 0;
  const off: Vec2 = g.props.Offset ?? { x: 0, y: 0 };
  const rad = (rot * Math.PI) / 180;
  const shift = off.x * Math.cos(rad) + off.y * Math.sin(rad);
  const ts = [...new Set([...colors.map((k) => k.t), ...trans.map((k) => k.t)])].sort((a, b) => a - b);
  const stops = ts.map((t) => {
    const [r, gg, b] = mul(baseColor, sampleColor(colors, t));
    const a = baseAlpha * (1 - sampleNumber(trans, t));
    return `rgba(${r.toFixed(0)},${gg.toFixed(0)},${b.toFixed(0)},${a.toFixed(3)}) ${((t + shift) * 100).toFixed(2)}%`;
  });
  return `linear-gradient(${rot + 90}deg, ${stops.join(', ')})`;
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
  const radius = cornerMod ? Math.max(0, Math.min(resolve(cornerMod.props.CornerRadius, Math.min(w, h)), Math.min(w, h) / 2)) : 0;

  const outer: CSSProperties = {
    position: 'absolute',
    left: r.x - origin.x,
    top: r.y - origin.y,
    width: w,
    height: h,
    zIndex: p.ZIndex,
    transform: p.Rotation ? `rotate(${p.Rotation}deg)` : undefined,
  };
  const uiScale = ctx.scales?.[id];
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
  const shadows: string[] = [];
  let spread = 0;
  for (const s of borderStrokes) {
    spread += s.props.Thickness;
    shadows.push(`0 0 0 ${spread}px ${rgba(s.props.Color, 1 - s.props.Transparency)}`);
  }
  if (!cornerMod && p.BorderSizePixel > 0 && bgAlpha > 0) shadows.push(`0 0 0 ${spread + p.BorderSizePixel}px ${rgba(p.BorderColor3, bgAlpha)}`);
  if (shadows.length) bg.boxShadow = shadows.join(', ');

  const children = n.children.filter((c) => ctx.nodes[c] && isGuiObject(ctx.nodes[c].className));
  const scrolling = n.className === 'ScrollingFrame';
  const clip = p.ClipsDescendants || scrolling || n.className === 'CanvasGroup';
  const content = ctx.layout.content[id] ?? r;

  let layer: ReactNode = null;
  if (textual) layer = <TextLayer n={n} ctx={ctx} box={{ x: content.x - r.x, y: content.y - r.y, w: content.w, h: content.h }} el={{ w, h }} grad={grad} stroke={textStroke} />;
  else if (isImage(n.className)) layer = <ImageLayer n={n} ctx={ctx} w={w} h={h} radius={radius} />;
  else if (n.className === 'ViewportFrame')
    layer = (
      <div className="rb-placeholder" style={{ borderRadius: radius }}>
        <Box size={Math.min(48, Math.max(12, Math.min(w, h) * 0.3))} strokeWidth={1.25} />
      </div>
    );

  const canvas = scrolling ? ctx.layout.canvas[id] : undefined;
  const autoBtn = ctx.interactive && (n.className === 'TextButton' || n.className === 'ImageButton') && p.AutoButtonColor !== false;

  const ev = ctx.onEvent && ctx.eventIds?.has(id) ? ctx.onEvent : null;
  const handlers = ev
    ? {
        onPointerEnter: () => ev(id, 'enter'),
        onPointerLeave: () => ev(id, 'leave'),
        onPointerDown: () => ev(id, 'down'),
        onPointerUp: () => ev(id, 'up'),
        onClick: () => ev(id, 'click'),
      }
    : {};

  return (
    <div data-nid={id} className={autoBtn || ev ? 'rb-node rb-autobtn' : 'rb-node'} style={outer} {...handlers}>
      <div className="rb-bg" style={bg} />
      {layer}
      {children.length > 0 && (
        <div
          className={scrolling && ctx.interactive ? 'rb-children rb-scroll' : 'rb-children'}
          style={{
            position: 'absolute', inset: 0, overflow: clip ? (scrolling && ctx.interactive ? 'auto' : 'hidden') : 'visible',
            borderRadius: n.className === 'CanvasGroup' ? radius : undefined,
            ['--sbw' as any]: `${p.ScrollBarThickness ?? 0}px`,
            ['--sbc' as any]: scrolling ? rgba(p.ScrollBarImageColor3, 1 - (p.ScrollBarImageTransparency ?? 0)) : undefined,
            overflowX: scrolling && ctx.interactive && p.ScrollingDirection === 'Y' ? 'hidden' : undefined,
            overflowY: scrolling && ctx.interactive && p.ScrollingDirection === 'X' ? 'hidden' : undefined,
          }}
        >
          {canvas && ctx.interactive && <div style={{ position: 'absolute', left: canvas.x - r.x + canvas.w, top: canvas.y - r.y + canvas.h, width: 1, height: 1 }} />}
          {children.map((c) => <NodeView key={c} id={c} origin={{ x: r.x, y: r.y }} ctx={ctx} />)}
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
    bars.push(<div key="v" style={{ position: 'absolute', right: 0, top, width: t, height: th, background: color, pointerEvents: 'none', zIndex: 100000 }} />);
  }
  if (canvas.w > w + 0.5 && n.props.ScrollingDirection !== 'Y') {
    const tw = (w * w) / canvas.w;
    const left = ((origin.x - canvas.x) / (canvas.w - w)) * (w - tw);
    bars.push(<div key="h" style={{ position: 'absolute', bottom: 0, left, height: t, width: tw, background: color, pointerEvents: 'none', zIndex: 100000 }} />);
  }
  return <>{bars}</>;
}

function TextLayer({ n, ctx, box, el, grad, stroke }: { n: GuiNode; ctx: RenderCtx; box: { x: number; y: number; w: number; h: number }; el: { w: number; h: number }; grad?: GuiNode; stroke?: GuiNode }) {
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
    textAlign: xa === 'Left' ? 'left' : xa === 'Right' ? 'right' : 'center',
    overflowWrap: p.TextWrapped ? 'break-word' : undefined, maxWidth: p.TextWrapped ? '100%' : undefined,
  };
  const fill: CSSProperties = { ...textStyle, position: 'relative' };
  // A UIGradient spans the WHOLE element box (not just the text line), so it's painted on a layer the size
  // of the element and clipped to the letters. Plain text: the layer is the text colour × gradient
  // (incl. its transparency). Rich text keeps per-span colours and the gradient multiplies over them.
  const richHtml = (p.RichText || multiColor) && !showPlaceholder;
  fill.color = grad && !richHtml ? 'transparent' : rgba(color, alpha);
  // the text is laid out with padding (not absolute positioning): background-clip:text only reliably
  // includes in-flow, non-positioned descendants
  const gradLayer: CSSProperties | null = grad
    ? {
        position: 'absolute', left: 0, top: 0, width: el.w, height: el.h, boxSizing: 'border-box', pointerEvents: 'none',
        paddingLeft: box.x, paddingTop: box.y - shiftPx, paddingRight: el.w - box.x - box.w, paddingBottom: el.h - box.y - box.h + shiftPx,
        display: 'flex', flexDirection: 'column', justifyContent: wrap.justifyContent, alignItems: wrap.alignItems,
        backgroundImage: richHtml ? gradientCss(grad, '#ffffff', 1) : gradientCss(grad, color, alpha),
        WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
        mixBlendMode: richHtml ? 'multiply' : undefined,
      }
    : null;

  let strokeStyle: CSSProperties | null = null;
  if (stroke && stroke.props.Thickness > 0) {
    const sc = rgba(stroke.props.Color, (1 - stroke.props.Transparency) * alpha);
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

  const html = (p.RichText || multiColor) && !showPlaceholder ? { __html: richTextHtml(raw) } : null;
  const inner = { position: 'relative' as const, maxWidth: p.TextWrapped ? '100%' : undefined };
  return (
    <>
      <div style={wrap}>
        <div style={inner}>
          {strokeStyle && (html ? <span style={strokeStyle} dangerouslySetInnerHTML={html} /> : <span style={strokeStyle}>{raw}</span>)}
          {html ? <span style={fill} dangerouslySetInnerHTML={html} /> : <span style={fill}>{raw}</span>}
        </div>
      </div>
      {gradLayer && (
        <div className="rb-grad-overlay" style={gradLayer}>
          <div style={{ maxWidth: inner.maxWidth }}>
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

function ImageLayer({ n, ctx, w, h, radius }: { n: GuiNode; ctx: RenderCtx; w: number; h: number; radius: number }) {
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
  };
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
      const iw = n.preview?.w;
      const ih = n.preview?.h;
      if (iw && ih && sc.x1 > sc.x0 && sc.y1 > sc.y0) {
        const s = p.SliceScale ?? 1;
        const edges = [sc.y0, iw - sc.x1, ih - sc.y1, sc.x0];
        delete st.backgroundImage;
        st.borderStyle = 'solid';
        st.borderImageSource = `url("${src}")`;
        st.borderImageSlice = `${edges.join(' ')} fill`;
        st.borderWidth = edges.map((e) => `${e * s}px`).join(' ');
        st.borderRadius = 0;
      } else st.backgroundSize = '100% 100%';
      break;
    }
    default:
      st.backgroundSize = '100% 100%';
  }
  for (const k of ['backgroundSize', 'backgroundRepeat', 'backgroundPosition'] as const) (mask as any)['mask' + k.slice(10)] = st[k];
  const tint = (p.ImageColor3 ?? '#ffffff').toLowerCase() !== '#ffffff';
  return (
    <>
      <div style={st} />
      {tint && st.backgroundImage && (
        <div style={{ ...st, backgroundImage: 'none', backgroundColor: p.ImageColor3, mixBlendMode: 'multiply', maskImage: `url("${src}")`, WebkitMaskImage: `url("${src}")`, ...mask }} />
      )}
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
  const kids = n.children.filter((c) => ctx.nodes[c] && isGuiObject(ctx.nodes[c].className));
  const clip = n.className === 'SurfaceGui' || (world && n.props.ClipsDescendants);
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
    </div>
  );
}

/** Mock of Roblox's in-game top bar (the 58px GUI inset): menu + chat on the left, players + more on the right */
export function TopbarMock({ title }: { title?: string }) {
  return (
    <div className="topbar-mock" title={title}>
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
