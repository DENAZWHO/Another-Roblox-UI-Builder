// Multi-colour text: colour stops along the visible characters of a TextLabel/TextButton/TextBox.
// Stored on the node (node.textColors) and turned into Roblox RichText <font color> tags when
// rendering and exporting, so the user's Text stays clean and editable.
import { isText } from './schema';
import type { GuiNode, TextColors } from './types';

type Token = { tag: boolean; s: string };

/** Split rich text into tags and visible characters (entities like &lt; count as one character) */
export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  const re = /<[^>]*>|&(?:lt|gt|amp|quot|apos);/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const pushChars = (s: string) => {
    for (const ch of Array.from(s)) out.push({ tag: false, s: ch });
  };
  while ((m = re.exec(text))) {
    pushChars(text.slice(last, m.index));
    out.push({ tag: m[0].startsWith('<'), s: m[0] });
    last = m.index + m[0].length;
  }
  pushChars(text.slice(last));
  return out;
}

const ENT: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&apos;': "'" };

/** Visible characters of (rich) text, in order */
export function visibleChars(text: string): string[] {
  return tokenize(text).filter((t) => !t.tag).map((t) => ENT[t.s] ?? t.s);
}

function mix(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (sh: number) => Math.round(((pa >> sh) & 255) + (((pb >> sh) & 255) - ((pa >> sh) & 255)) * t);
  return '#' + [ch(16), ch(8), ch(0)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** Colour of visible character i out of n */
export function colorAt(tc: TextColors, i: number, n: number): string {
  const stops = [...tc.stops].sort((a, b) => a.at - b.at);
  if (!stops.length) return '#ffffff';
  if (tc.mode === 'segments') {
    const p = (i + 0.5) / Math.max(1, n);
    let c = stops[0].color;
    for (const s of stops) if (s.at <= p) c = s.color;
    return c;
  }
  const p = n > 1 ? i / (n - 1) : 0;
  if (p <= stops[0].at) return stops[0].color;
  for (let k = 1; k < stops.length; k++) {
    if (p <= stops[k].at) {
      const a = stops[k - 1];
      const b = stops[k];
      return mix(a.color, b.color, (p - a.at) / Math.max(1e-6, b.at - a.at));
    }
  }
  return stops[stops.length - 1].color;
}

/**
 * Wrap runs of same-coloured characters in <font color> tags. Runs are closed and reopened around
 * existing tags so the result always nests correctly (Roblox rejects overlapping tags).
 */
export function applyTextColors(text: string, tc: TextColors | undefined): string {
  if (!tc || !tc.stops.length) return text;
  const tokens = tokenize(text);
  const n = tokens.filter((t) => !t.tag).length;
  let out = '';
  let open: string | null = null;
  let i = 0;
  for (const t of tokens) {
    if (t.tag) {
      if (open) out += '</font>';
      open = null;
      out += t.s;
      continue;
    }
    const c = colorAt(tc, i++, n);
    if (c !== open) {
      if (open) out += '</font>';
      out += `<font color="${c}">`;
      open = c;
    }
    out += t.s;
  }
  if (open) out += '</font>';
  return out;
}

/** Properties as they should be exported to Roblox (multi-colour text baked into Text) */
export function exportedProps(node: GuiNode): Record<string, any> {
  if (!isText(node.className) || !node.textColors?.stops.length) return node.props;
  return { ...node.props, Text: applyTextColors(node.props.Text ?? '', node.textColors), RichText: true };
}

export const TEXT_COLOR_PRESETS: { name: string; tc: TextColors }[] = [
  { name: 'Rainbow', tc: { mode: 'gradient', stops: [{ at: 0, color: '#ff4d4f' }, { at: 0.2, color: '#ffb020' }, { at: 0.4, color: '#ffe14d' }, { at: 0.6, color: '#3ecf5a' }, { at: 0.8, color: '#4fb3ff' }, { at: 1, color: '#b366ff' }] } },
  { name: 'Fire', tc: { mode: 'gradient', stops: [{ at: 0, color: '#ffe14d' }, { at: 0.5, color: '#ff8a3d' }, { at: 1, color: '#e0262b' }] } },
  { name: 'Ice', tc: { mode: 'gradient', stops: [{ at: 0, color: '#ffffff' }, { at: 1, color: '#4fb3ff' }] } },
  { name: 'Gold', tc: { mode: 'gradient', stops: [{ at: 0, color: '#fff3b0' }, { at: 0.5, color: '#ffc83d' }, { at: 1, color: '#c98a00' }] } },
  { name: 'Two-tone', tc: { mode: 'segments', stops: [{ at: 0, color: '#ffffff' }, { at: 0.5, color: '#ffd23f' }] } },
];
