import { familyFromAssetUrl, fontAssetUrl } from '../model/fonts';
import { createNode, type Fragment } from '../model/doc';
import { CLASS_PROPS, ENUMS, type PropDef } from '../model/schema';
import type { ClassName, Doc, GuiNode } from '../model/types';
import { hexRgb, normalizeAsset } from './luau';
import { rootScript } from './behavior';
import { exportedProps } from '../model/richColors';
import { gameStartDoc } from '../model/screens';
import { isBinaryRoblox, parseBinary, type BinInstance } from './rbxbin';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f = (n: number) => (n === Infinity ? 'INF' : n === -Infinity ? '-INF' : String(+(+n).toFixed(6)));
const c01 = (h: string) => hexRgb(h).map((v) => f(v / 255));

function propXml(def: PropDef, v: any): string {
  const n = def.name;
  switch (def.type) {
    case 'UDim2':
      return `<UDim2 name="${n}"><XS>${f(v.x.s)}</XS><XO>${Math.round(v.x.o)}</XO><YS>${f(v.y.s)}</YS><YO>${Math.round(v.y.o)}</YO></UDim2>`;
    case 'UDim':
      return `<UDim name="${n}"><S>${f(v.s)}</S><O>${Math.round(v.o)}</O></UDim>`;
    case 'Vector2':
      return `<Vector2 name="${n}"><X>${f(v.x)}</X><Y>${f(v.y)}</Y></Vector2>`;
    case 'Vector3':
      return `<Vector3 name="${n}"><X>${f(v.x)}</X><Y>${f(v.y)}</Y><Z>${f(v.z)}</Z></Vector3>`;
    case 'float':
      return `<float name="${n}">${f(v)}</float>`;
    case 'int':
      return `<int name="${n}">${Math.round(v)}</int>`;
    case 'bool':
      return `<bool name="${n}">${v ? 'true' : 'false'}</bool>`;
    case 'Color3': {
      const [r, g, b] = c01(v);
      return `<Color3 name="${n}"><R>${r}</R><G>${g}</G><B>${b}</B></Color3>`;
    }
    case 'string':
      return `<string name="${n}">${esc(String(v ?? ''))}</string>`;
    case 'Content': {
      const url = normalizeAsset(v);
      return url ? `<Content name="${n}"><url>${esc(url)}</url></Content>` : `<Content name="${n}"><null></null></Content>`;
    }
    case 'enum':
      return `<token name="${n}">${ENUMS[def.enumType!][v] ?? 0}</token>`;
    case 'Font':
      return `<Font name="${n}"><Family><url>${fontAssetUrl(v.family)}</url></Family><Weight>${v.weight}</Weight><Style>${v.style}</Style></Font>`;
    case 'ColorSequence':
      return `<ColorSequence name="${n}">${v.map((k: any) => `${f(k.t)} ${c01(k.c).join(' ')} 0 `).join('')}</ColorSequence>`;
    case 'NumberSequence':
      return `<NumberSequence name="${n}">${v.map((k: any) => `${f(k.t)} ${f(k.v)} 0 `).join('')}</NumberSequence>`;
    case 'Rect':
      return `<Rect2D name="${n}"><min><X>${f(v.x0)}</X><Y>${f(v.y0)}</Y></min><max><X>${f(v.x1)}</X><Y>${f(v.y1)}</Y></max></Rect2D>`;
  }
}

export interface RbxmxOptions {
  /** Embed a LocalScript running animations, triggers and effects (inside each root GUI) */
  behaviorScript: boolean;
}

export function generateRbxmx(fullDoc: Doc, opts: RbxmxOptions): string {
  const doc = gameStartDoc(fullDoc);
  let ref = 0;
  const out: string[] = [
    '<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">',
    '\t<Meta name="ExplicitAutoJoints">true</Meta>',
  ];
  const item = (n: GuiNode, depth: number, extra?: string) => {
    const t = '\t'.repeat(depth);
    out.push(`${t}<Item class="${n.className}" referent="RBX${(ref++).toString(16).toUpperCase().padStart(8, '0')}">`);
    out.push(`${t}\t<Properties>`);
    out.push(`${t}\t\t<string name="Name">${esc(n.name)}</string>`);
    const props = exportedProps(n);
    for (const def of CLASS_PROPS[n.className]) {
      const v = props[def.name];
      if (v === undefined) continue;
      out.push(`${t}\t\t${propXml(def, v)}`);
    }
    out.push(`${t}\t</Properties>`);
    for (const c of n.children) item(doc.nodes[c], depth + 1);
    if (extra) out.push(extra);
    out.push(`${t}</Item>`);
  };
  for (const r of doc.rootIds) {
    let extra: string | undefined;
    if (opts.behaviorScript) {
      const src = rootScript(doc, r);
      if (src) {
        extra = [
          `\t\t<Item class="LocalScript" referent="RBX${(ref++).toString(16).toUpperCase().padStart(8, '0')}">`,
          '\t\t\t<Properties>',
          '\t\t\t\t<string name="Name">UIBehavior</string>',
          `\t\t\t\t<ProtectedString name="Source"><![CDATA[${src.replace(/]]>/g, ']]]]><![CDATA[>')}]]></ProtectedString>`,
          '\t\t\t</Properties>',
          '\t\t</Item>',
        ].join('\n');
      }
    }
    item(doc.nodes[r], 1, extra);
  }
  out.push('</roblox>');
  return out.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Import

const LEGACY_FONTS: Record<number, [string, number, 'Normal' | 'Italic']> = {
  0: ['LegacyArial', 400, 'Normal'], 1: ['Arimo', 400, 'Normal'], 2: ['Arimo', 700, 'Normal'],
  3: ['SourceSansPro', 400, 'Normal'], 4: ['SourceSansPro', 700, 'Normal'], 5: ['SourceSansPro', 300, 'Normal'],
  6: ['SourceSansPro', 400, 'Italic'], 16: ['SourceSansPro', 600, 'Normal'], 17: ['Montserrat', 400, 'Normal'],
  18: ['Montserrat', 500, 'Normal'], 19: ['Montserrat', 700, 'Normal'], 20: ['Montserrat', 900, 'Normal'],
  21: ['AmaticSC', 400, 'Normal'], 22: ['Bangers', 400, 'Normal'], 23: ['Creepster', 400, 'Normal'],
  24: ['DenkOne', 400, 'Normal'], 25: ['Fondamento', 400, 'Normal'], 26: ['FredokaOne', 400, 'Normal'],
  27: ['GrenzeGotisch', 400, 'Normal'], 28: ['IndieFlower', 400, 'Normal'], 29: ['JosefinSans', 400, 'Normal'],
  30: ['Jura', 400, 'Normal'], 31: ['Kalam', 400, 'Normal'], 32: ['LuckiestGuy', 400, 'Normal'],
  33: ['Merriweather', 400, 'Normal'], 34: ['Michroma', 400, 'Normal'], 35: ['Nunito', 400, 'Normal'],
  36: ['Oswald', 400, 'Normal'], 37: ['PatrickHand', 400, 'Normal'], 38: ['PermanentMarker', 400, 'Normal'],
  39: ['Roboto', 400, 'Normal'], 40: ['RobotoCondensed', 400, 'Normal'], 41: ['RobotoMono', 400, 'Normal'],
  42: ['Sarpanch', 400, 'Normal'], 43: ['SpecialElite', 400, 'Normal'], 44: ['TitilliumWeb', 400, 'Normal'],
  45: ['Ubuntu', 400, 'Normal'],
};

const numOf = (el: Element | null | undefined, tag: string) => {
  const t = el?.getElementsByTagName(tag)[0]?.textContent?.trim() ?? '0';
  if (/^-?inf/i.test(t)) return t.startsWith('-') ? -Infinity : Infinity;
  return parseFloat(t) || 0;
};

const toHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');

function readProp(def: PropDef, el: Element): any {
  const text = el.textContent?.trim() ?? '';
  switch (def.type) {
    case 'UDim2':
      return { x: { s: numOf(el, 'XS'), o: numOf(el, 'XO') }, y: { s: numOf(el, 'YS'), o: numOf(el, 'YO') } };
    case 'UDim':
      return { s: numOf(el, 'S'), o: numOf(el, 'O') };
    case 'Vector2':
      return { x: numOf(el, 'X'), y: numOf(el, 'Y') };
    case 'Vector3':
      return { x: numOf(el, 'X'), y: numOf(el, 'Y'), z: numOf(el, 'Z') };
    case 'float':
    case 'int':
      return /^-?inf/i.test(text) ? Infinity : parseFloat(text) || 0;
    case 'bool':
      return text === 'true';
    case 'Color3':
      if (el.tagName === 'Color3uint8') {
        const v = parseInt(text, 10) >>> 0;
        return toHex(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
      }
      return toHex(numOf(el, 'R'), numOf(el, 'G'), numOf(el, 'B'));
    case 'string':
      return el.textContent ?? '';
    case 'Content':
      return el.getElementsByTagName('url')[0]?.textContent?.trim() ?? '';
    case 'enum': {
      const map = ENUMS[def.enumType!];
      const v = parseInt(text, 10);
      return Object.keys(map).find((k) => map[k] === v) ?? def.default;
    }
    case 'Font':
      return {
        family: familyFromAssetUrl(el.getElementsByTagName('url')[0]?.textContent ?? ''),
        weight: numOf(el, 'Weight') || 400,
        style: el.getElementsByTagName('Style')[0]?.textContent?.trim() === 'Italic' ? 'Italic' : 'Normal',
      };
    case 'ColorSequence': {
      const p = text.split(/\s+/).map(Number);
      const keys = [];
      for (let i = 0; i + 4 < p.length + 1; i += 5) keys.push({ t: p[i], c: toHex(p[i + 1], p[i + 2], p[i + 3]) });
      return keys.length >= 2 ? keys : def.default;
    }
    case 'NumberSequence': {
      const p = text.split(/\s+/).map(Number);
      const keys = [];
      for (let i = 0; i + 2 < p.length + 1; i += 3) keys.push({ t: p[i], v: p[i + 1] });
      return keys.length >= 2 ? keys : def.default;
    }
    case 'Rect': {
      const mn = el.getElementsByTagName('min')[0];
      const mx = el.getElementsByTagName('max')[0];
      return { x0: numOf(mn, 'X'), y0: numOf(mn, 'Y'), x1: numOf(mx, 'X'), y1: numOf(mx, 'Y') };
    }
  }
}

// ---------------------------------------------------------------------------
// Import: .rbxmx / .rbxlx (XML) and .rbxm / .rbxl (binary) through one converter

/** An instance read from a file, before conversion */
interface RawInst {
  className: string;
  name: string;
  props: Record<string, { el: Element } | { type: number; value: any }>;
  children: RawInst[];
}

function xmlToRaw(el: Element): RawInst {
  const props: RawInst['props'] = {};
  const propsEl = Array.from(el.children).find((c) => c.tagName === 'Properties');
  for (const p of Array.from(propsEl?.children ?? [])) props[p.getAttribute('name') ?? ''] = { el: p };
  const nameEl = props.Name && 'el' in props.Name ? props.Name.el : null;
  return {
    className: el.getAttribute('class') ?? '',
    name: nameEl?.textContent ?? el.getAttribute('class') ?? '',
    props,
    children: Array.from(el.children).filter((c) => c.tagName === 'Item').map(xmlToRaw),
  };
}

function binToRaw(b: BinInstance): RawInst {
  const props: RawInst['props'] = {};
  for (const [k, [type, value]] of Object.entries(b.props)) props[k] = { type, value };
  return { className: b.className, name: typeof b.props.Name?.[1] === 'string' ? b.props.Name[1] : b.className, props, children: b.children.map(binToRaw) };
}

/** A binary property value in the editor's format (undefined: keep the default) */
function readBinProp(def: PropDef, type: number, v: any): any {
  switch (def.type) {
    case 'UDim2':
      return type === 0x07 ? v : undefined;
    case 'UDim':
      return type === 0x06 ? v : undefined;
    case 'Vector2':
      return type === 0x0d ? v : undefined;
    case 'Vector3':
      return type === 0x0e ? v : undefined;
    case 'float':
    case 'int':
      return typeof v === 'number' ? v : undefined;
    case 'bool':
      return typeof v === 'boolean' ? v : undefined;
    case 'string':
    case 'Content':
      return typeof v === 'string' ? v : undefined;
    case 'Color3':
      return type === 0x0c || type === 0x1a ? toHex(v.r, v.g, v.b) : undefined;
    case 'enum': {
      if (type !== 0x12) return undefined;
      const map = ENUMS[def.enumType!] ?? {};
      return Object.keys(map).find((k) => map[k] === v);
    }
    case 'Font':
      return type === 0x20 ? { family: familyFromAssetUrl(v.family), weight: v.weight || 400, style: v.style } : undefined;
    case 'ColorSequence':
      return type === 0x16 && v.length >= 2 ? v.map((k: any) => ({ t: k.t, c: toHex(k.r, k.g, k.b) })) : undefined;
    case 'NumberSequence':
      return type === 0x15 && v.length >= 2 ? v.map((k: any) => ({ t: k.t, v: k.v })) : undefined;
    case 'Rect':
      return type === 0x18 ? v : undefined;
  }
  return undefined;
}

const LAYER_COLLECTORS = new Set(['ScreenGui', 'BillboardGui', 'SurfaceGui']);

/**
 * Turn file instances into a fragment.
 * Models: every supported instance found (looking inside folders and other containers).
 * Places: only ScreenGuis / BillboardGuis / SurfaceGuis (world GUIs on a part get it as their Adornee).
 * Unsupported instances inside a GUI (scripts…) are skipped and reported.
 */
function rawToFragment(top: RawInst[], place: boolean): { fragment: Fragment; skipped: string[] } {
  const nodes: GuiNode[] = [];
  const skipped = new Set<string>();

  const readInst = (raw: RawInst, parentId: string | null): string | null => {
    const cls = raw.className as ClassName;
    if (!CLASS_PROPS[cls]) {
      skipped.add(cls);
      return null;
    }
    const node = createNode(cls);
    node.parentId = parentId;
    node.name = raw.name || cls;
    let hasFontFace = false;
    let legacyFont: number | null = null;
    for (const [name, p] of Object.entries(raw.props)) {
      if (name === 'Font') {
        if ('el' in p && p.el.tagName === 'token') legacyFont = parseInt(p.el.textContent ?? '0', 10);
        if ('type' in p && p.type === 0x12) legacyFont = p.value;
      }
      const def = CLASS_PROPS[cls].find((d) => d.name === name);
      if (!def) continue;
      try {
        const v = 'el' in p ? readProp(def, p.el) : readBinProp(def, p.type, p.value);
        if (v === undefined) continue;
        node.props[name] = v;
        if (name === 'FontFace') hasFontFace = true;
      } catch {
        /* keep default */
      }
    }
    if (!hasFontFace && legacyFont !== null && LEGACY_FONTS[legacyFont] && 'FontFace' in node.props) {
      const [family, weight, style] = LEGACY_FONTS[legacyFont];
      node.props.FontFace = { family, weight, style };
    }
    nodes.push(node);
    for (const c of raw.children) {
      const cid = readInst(c, node.id);
      if (cid) node.children.push(cid);
    }
    return node.id;
  };

  const rootIds: string[] = [];
  // look through containers (services, folders, models, parts) for what to import
  const find = (raw: RawInst, path: string[]) => {
    const wanted = place ? LAYER_COLLECTORS.has(raw.className) : !!CLASS_PROPS[raw.className as ClassName];
    if (wanted) {
      const id = readInst(raw, null);
      if (!id) return;
      rootIds.push(id);
      // a world GUI sitting on a part is attached to it
      const n = nodes.find((x) => x.id === id)!;
      if ((n.className === 'BillboardGui' || n.className === 'SurfaceGui') && path.length >= 2 && path[0] === 'Workspace') n.adornee = path.join('.');
      return;
    }
    for (const c of raw.children) find(c, [...path, raw.name]);
  };
  for (const r of top) find(r, []);
  return { fragment: { nodes, rootIds }, skipped: [...skipped] };
}

/** Parse a .rbxmx / .rbxlx (XML) file into a fragment */
export function parseRbxmx(xml: string, place = false): { fragment: Fragment; skipped: string[] } {
  const dom = new DOMParser().parseFromString(xml, 'application/xml');
  if (dom.getElementsByTagName('parsererror').length) throw new Error('Not a valid Roblox XML file');
  const top = Array.from(dom.documentElement.children).filter((c) => c.tagName === 'Item').map(xmlToRaw);
  return rawToFragment(top, place);
}

/** Parse a .rbxm / .rbxl (binary) file into a fragment */
export function parseRbxBinary(bytes: Uint8Array, place = false): { fragment: Fragment; skipped: string[] } {
  return rawToFragment(parseBinary(bytes).map(binToRaw), place);
}

/** Any Roblox model / place file */
export function parseRobloxFile(bytes: Uint8Array, fileName: string): { fragment: Fragment; skipped: string[] } {
  const place = /\.rbxlx?$/i.test(fileName);
  if (isBinaryRoblox(bytes)) return parseRbxBinary(bytes, place);
  return parseRbxmx(new TextDecoder().decode(bytes), place);
}
