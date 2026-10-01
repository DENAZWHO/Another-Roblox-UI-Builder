import type { FontValue } from './types';

export interface FontFace { weight: number; style: 'Normal' | 'Italic' }

export interface FontFamily {
  /** Roblox family name (rbxasset://fonts/families/<id>.json) */
  id: string;
  label: string;
  /** CSS font-family stack used in the browser */
  css: string;
  /** Google Fonts css2 "family=" spec used when Studio's fonts aren't available */
  google?: string;
  /** Faces that really exist (known when Studio's fonts are loaded) */
  faces?: FontFace[];
  /** Line height as a multiple of the text size (from the font file) */
  lineHeight?: number;
  /** hhea ascender as a multiple of the text size (from the font file) */
  ascent?: number;
}

/** Look-alikes from Google Fonts, used when Roblox Studio isn't installed */
const GOOGLE_FAMILIES: FontFamily[] = [
  { id: 'BuilderSans', label: 'Builder Sans', css: '"Inter", sans-serif', google: 'Inter:ital,wght@0,100..900;1,100..900' },
  { id: 'Montserrat', label: 'Montserrat', css: '"Montserrat", sans-serif', google: 'Montserrat:ital,wght@0,100..900;1,100..900' },
  { id: 'SourceSansPro', label: 'Source Sans Pro', css: '"Source Sans 3", sans-serif', google: 'Source+Sans+3:ital,wght@0,200..900;1,200..900' },
  { id: 'Arimo', label: 'Arimo', css: '"Arimo", Arial, sans-serif', google: 'Arimo:ital,wght@0,400..700;1,400..700' },
  { id: 'LegacyArial', label: 'Arimo (Legacy)', css: '"Arimo", Arial, sans-serif' },
  { id: 'Roboto', label: 'Roboto', css: '"Roboto", sans-serif', google: 'Roboto:ital,wght@0,100..900;1,100..900' },
  { id: 'RobotoCondensed', label: 'Roboto Condensed', css: '"Roboto Condensed", sans-serif', google: 'Roboto+Condensed:ital,wght@0,100..900;1,100..900' },
  { id: 'RobotoMono', label: 'Roboto Mono', css: '"Roboto Mono", monospace', google: 'Roboto+Mono:ital,wght@0,100..700;1,100..700' },
  { id: 'FredokaOne', label: 'Fredoka One', css: '"Fredoka", sans-serif', google: 'Fredoka:wght@300..700' },
  { id: 'LuckiestGuy', label: 'Luckiest Guy', css: '"Luckiest Guy", cursive', google: 'Luckiest+Guy' },
  { id: 'Bangers', label: 'Bangers', css: '"Bangers", cursive', google: 'Bangers' },
  { id: 'Nunito', label: 'Nunito', css: '"Nunito", sans-serif', google: 'Nunito:ital,wght@0,200..1000;1,200..1000' },
  { id: 'Oswald', label: 'Oswald', css: '"Oswald", sans-serif', google: 'Oswald:wght@200..700' },
  { id: 'TitilliumWeb', label: 'Titillium Web', css: '"Titillium Web", sans-serif', google: 'Titillium+Web:ital,wght@0,200;0,300;0,400;0,600;0,700;0,900;1,400;1,700' },
  { id: 'Ubuntu', label: 'Ubuntu', css: '"Ubuntu", sans-serif', google: 'Ubuntu:ital,wght@0,300;0,400;0,500;0,700;1,400;1,700' },
  { id: 'JosefinSans', label: 'Josefin Sans', css: '"Josefin Sans", sans-serif', google: 'Josefin+Sans:ital,wght@0,100..700;1,100..700' },
  { id: 'Merriweather', label: 'Merriweather', css: '"Merriweather", serif', google: 'Merriweather:ital,wght@0,400;0,700;1,400;1,700' },
  { id: 'PressStart2P', label: 'Press Start 2P', css: '"Press Start 2P", monospace', google: 'Press+Start+2P' },
  { id: 'PermanentMarker', label: 'Permanent Marker', css: '"Permanent Marker", cursive', google: 'Permanent+Marker' },
  { id: 'Creepster', label: 'Creepster', css: '"Creepster", cursive', google: 'Creepster' },
  { id: 'DenkOne', label: 'Denk One', css: '"Denk One", sans-serif', google: 'Denk+One' },
  { id: 'Michroma', label: 'Michroma', css: '"Michroma", sans-serif', google: 'Michroma' },
  { id: 'Sarpanch', label: 'Sarpanch', css: '"Sarpanch", sans-serif', google: 'Sarpanch:wght@400;500;600;700;800;900' },
  { id: 'Jura', label: 'Jura', css: '"Jura", sans-serif', google: 'Jura:wght@300..700' },
  { id: 'Kalam', label: 'Kalam', css: '"Kalam", cursive', google: 'Kalam:wght@300;400;700' },
  { id: 'PatrickHand', label: 'Patrick Hand', css: '"Patrick Hand", cursive', google: 'Patrick+Hand' },
  { id: 'IndieFlower', label: 'Indie Flower', css: '"Indie Flower", cursive', google: 'Indie+Flower' },
  { id: 'AmaticSC', label: 'Amatic SC', css: '"Amatic SC", cursive', google: 'Amatic+SC:wght@400;700' },
  { id: 'SpecialElite', label: 'Special Elite', css: '"Special Elite", monospace', google: 'Special+Elite' },
  { id: 'Fondamento', label: 'Fondamento', css: '"Fondamento", serif', google: 'Fondamento' },
  { id: 'GrenzeGotisch', label: 'Grenze Gotisch', css: '"Grenze Gotisch", serif', google: 'Grenze+Gotisch:wght@100..900' },
  { id: 'Inconsolata', label: 'Inconsolata', css: '"Inconsolata", monospace', google: 'Inconsolata:wght@200..900' },
];

/** Old family ids that Roblox now renders with another family */
const ALIASES: Record<string, string> = { GothamSSm: 'Montserrat', Gotham: 'Montserrat', Arial: 'Arimo' };

/** Font list shown in the editor (live binding: replaced by Studio's own list once loaded) */
export let FONT_FAMILIES: FontFamily[] = GOOGLE_FAMILIES;
/** 'studio' when rendering with Roblox Studio's own font files */
export let fontSource: 'google' | 'studio' = 'google';

export const FONT_WEIGHTS: [number, string][] = [
  [100, 'Thin'], [200, 'ExtraLight'], [300, 'Light'], [400, 'Regular'], [500, 'Medium'],
  [600, 'SemiBold'], [700, 'Bold'], [800, 'ExtraBold'], [900, 'Heavy'],
];

export const weightName = (w: number) => FONT_WEIGHTS.find(([v]) => v === w)?.[1] ?? 'Regular';

export function fontFamily(id: string): FontFamily {
  return (
    FONT_FAMILIES.find((f) => f.id === id) ??
    FONT_FAMILIES.find((f) => f.id === ALIASES[id]) ??
    { id, label: id, css: 'Arial, sans-serif' }
  );
}

export function fontAssetUrl(id: string) {
  return `rbxasset://fonts/families/${id}.json`;
}

export function familyFromAssetUrl(url: string): string {
  const m = /families\/([^/.]+)\.json/i.exec(url);
  return m ? m[1] : 'BuilderSans';
}

/**
 * The face to draw: the closest existing weight (never synthetic bold). Italic always stays italic —
 * a real italic face when the family has one, otherwise the regular face slanted.
 */
export function nearestFace(f: FontValue): FontFace {
  const faces = fontFamily(f.family).faces;
  if (!faces?.length) return { weight: f.weight, style: f.style };
  const sameStyle = faces.filter((x) => x.style === f.style);
  const normal = faces.filter((x) => x.style === 'Normal');
  const pool = sameStyle.length ? sameStyle : normal.length ? normal : faces;
  const best = pool.reduce((b, x) => {
    const d = Math.abs(x.weight - f.weight);
    const bd = Math.abs(b.weight - f.weight);
    return d < bd || (d === bd && x.weight > b.weight) ? x : b;
  });
  return { weight: best.weight, style: f.style };
}

/** True when italic has to be drawn by slanting the regular face (the family has no italic face) */
export function slantedItalic(f: FontValue): boolean {
  const faces = fontFamily(f.family).faces;
  return f.style === 'Italic' && !!faces?.length && !faces.some((x) => x.style === 'Italic');
}

/** Same as cssFont but as separate style properties (safe to combine with lineHeight in React) */
export function fontStyle(f: FontValue, sizePx: number) {
  const face = nearestFace(f);
  return { fontFamily: fontFamily(f.family).css, fontWeight: face.weight, fontStyle: face.style === 'Italic' ? 'italic' : 'normal', fontSize: sizePx } as const;
}

const measuredLine = new Map<string, number>();
/**
 * How tall Roblox makes one line of text, as a multiple of TextSize (the font's ascender - descender).
 * From the font file when Studio's fonts are loaded, otherwise measured in the browser.
 */
export function lineFactor(f: FontValue): number {
  const fam = fontFamily(f.family);
  if (fam.lineHeight) return fam.lineHeight;
  const key = fam.css + fontEpoch;
  const hit = measuredLine.get(key);
  if (hit) return hit;
  const c = measureCtx();
  c.font = `400 100px ${fam.css}`;
  const m = c.measureText('Hg');
  const v = m.fontBoundingBoxAscent && m.fontBoundingBoxDescent ? (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent) / 100 : 1.2;
  measuredLine.set(key, v);
  return v;
}

const shiftCache = new Map<string, number>();
/**
 * How far (in em) the browser draws this font's text lower than Roblox does. Roblox positions the line
 * with the font's hhea ascender/descender; the browser may use other metrics (Chrome on Windows uses the
 * OS/2 "win" values). Fonts whose metrics agree give 0; Luckiest Guy gives ~0.16 em.
 */
export function baselineShift(f: FontValue): number {
  const fam = fontFamily(f.family);
  if (!fam.ascent || !fam.lineHeight) return 0;
  const face = nearestFace(f);
  const key = `${fam.css}|${face.weight}|${face.style}|${fontEpoch}`;
  const hit = shiftCache.get(key);
  if (hit !== undefined) return hit;
  const c = measureCtx();
  c.font = cssFont(f, 100);
  const m = c.measureText('Hg');
  if (!m.fontBoundingBoxAscent) return 0;
  const browserA = m.fontBoundingBoxAscent / 100;
  const browserD = m.fontBoundingBoxDescent / 100;
  const robloxA = fam.ascent;
  const robloxD = fam.lineHeight - fam.ascent;
  // both centre their ascent+descent in the line box, so the baseline offset is independent of line height
  const v = (browserA - browserD - (robloxA - robloxD)) / 2;
  shiftCache.set(key, v);
  return v;
}

export function cssFont(f: FontValue, sizePx: number) {
  const face = nearestFace(f);
  return `${face.style === 'Italic' ? 'italic ' : ''}${face.weight} ${sizePx}px ${fontFamily(f.family).css}`;
}

interface StudioFamily {
  id: string;
  name: string;
  lineHeight?: number | null;
  ascent?: number | null;
  faces: { name: string; weight: number; style: 'Normal' | 'Italic'; url: string }[];
}

function applyStudioFonts(families: StudioFamily[]) {
  const rules: string[] = [];
  const list: FontFamily[] = [];
  for (const fam of families) {
    const cssName = `RBX ${fam.id}`;
    for (const face of fam.faces) {
      rules.push(
        `@font-face{font-family:"${cssName}";src:url("${face.url}");font-weight:${face.weight};font-style:${face.style === 'Italic' ? 'italic' : 'normal'};font-display:swap}`,
      );
    }
    const fallback = GOOGLE_FAMILIES.find((g) => g.id === fam.id)?.css ?? 'sans-serif';
    list.push({ id: fam.id, label: fam.name, css: `"${cssName}", ${fallback}`, faces: fam.faces.map((x) => ({ weight: x.weight, style: x.style })), lineHeight: fam.lineHeight ?? undefined, ascent: fam.ascent ?? undefined });
  }
  const style = document.createElement('style');
  style.dataset.source = 'roblox-studio-fonts';
  style.textContent = rules.join('\n');
  document.head.appendChild(style);
  list.sort((a, b) => (a.id === 'BuilderSans' ? -1 : b.id === 'BuilderSans' ? 1 : a.label.localeCompare(b.label)));
  FONT_FAMILIES = list;
  fontSource = 'studio';
  notifyFonts();
}

function loadGoogleFonts() {
  // One <link> per family so a single unavailable axis can't break every font.
  for (const f of GOOGLE_FAMILIES) {
    if (!f.google) continue;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${f.google}&display=swap`;
    document.head.appendChild(link);
  }
}

let loaded = false;
/** Prefer Roblox Studio's own font files (served by the dev server); fall back to Google Fonts look-alikes */
export async function loadWebFonts() {
  if (loaded) return;
  loaded = true;
  // the editor chrome uses Inter
  const ui = document.createElement('link');
  ui.rel = 'stylesheet';
  ui.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap';
  document.head.appendChild(ui);
  try {
    const r = await fetch('/api/fonts/families', { cache: 'no-store' });
    const j = await r.json();
    if (j.available && j.families?.length) return applyStudioFonts(j.families);
  } catch {
    /* no dev server, or Studio isn't installed */
  }
  loadGoogleFonts();
}

// ---------------------------------------------------------------------------
// Text measurement for TextScaled

let ctx: CanvasRenderingContext2D | null = null;
function measureCtx() {
  if (!ctx) ctx = document.createElement('canvas').getContext('2d');
  return ctx!;
}

export function stripRichText(text: string) {
  return text.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function wrapLines(text: string, maxW: number, c: CanvasRenderingContext2D, wrap: boolean): { lines: number; width: number } {
  let lines = 0;
  let widest = 0;
  for (const para of text.split('\n')) {
    if (!wrap) {
      lines++;
      widest = Math.max(widest, c.measureText(para).width);
      continue;
    }
    const words = para.split(/(\s+)/);
    let line = '';
    let lineCount = 1;
    for (const word of words) {
      const test = line + word;
      const w = c.measureText(test).width;
      if (w > maxW && line.trim() !== '') {
        widest = Math.max(widest, c.measureText(line).width);
        line = word.trimStart();
        lineCount++;
      } else {
        line = test;
      }
    }
    widest = Math.max(widest, c.measureText(line).width);
    lines += lineCount;
  }
  return { lines, width: widest };
}

const fitCache = new Map<string, number>();

/** Largest integer text size that fits in w×h (Roblox TextScaled behaviour, capped at 100). */
export function fitTextSize(text: string, font: FontValue, w: number, h: number, lineHeight: number, wrap: boolean, min = 1, max = 100): number {
  const key = `${text}|${font.family}|${font.weight}|${font.style}|${Math.round(w)}|${Math.round(h)}|${lineHeight}|${wrap}|${min}|${max}|${fontEpoch}`;
  const hit = fitCache.get(key);
  if (hit !== undefined) return hit;
  const c = measureCtx();
  let lo = 1;
  let hi = Math.max(1, Math.min(max, 100));
  const fits = (size: number) => {
    c.font = cssFont(font, size);
    const r = wrapLines(text || ' ', w, c, wrap);
    return r.width <= w + 0.5 && r.lines * size * lineHeight * lineFactor(font) <= h + 0.5;
  };
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid - 1;
  }
  const result = Math.max(min, lo);
  if (fitCache.size > 5000) fitCache.clear();
  fitCache.set(key, result);
  return result;
}

/** Bumped when fonts load or the font list changes, so cached measurements are invalidated */
export let fontEpoch = 0;
const fontListeners = new Set<() => void>();
function notifyFonts() {
  fontEpoch++;
  fitCache.clear();
  fontListeners.forEach((cb) => cb());
}
let watching = false;
export function onFontsLoaded(cb: () => void) {
  fontListeners.add(cb);
  if (!watching) {
    watching = true;
    document.fonts?.addEventListener?.('loadingdone', notifyFonts);
    document.fonts?.ready.then(notifyFonts);
  }
  return () => void fontListeners.delete(cb);
}
