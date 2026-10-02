import { fontAssetUrl, weightName } from '../model/fonts';
import { identifier } from '../model/doc';
import { CLASS_PROPS, isWorldGui, type PropDef } from '../model/schema';
import { adorneeExpr, behaviorLines, clickLines, pixelScalerLines } from './behavior';
import { designSize, pixelScaleOn } from '../model/pixelScale';
import { gameStartDoc } from '../model/screens';
import { exportedProps } from '../model/richColors';
import type { Doc, GuiNode, PathPoint, UDim2 } from '../model/types';

export const num = (n: number) => {
  if (n === Infinity) return 'math.huge';
  if (n === -Infinity) return '-math.huge';
  const v = +(+n).toFixed(4);
  return Object.is(v, -0) ? '0' : String(v);
};

export const hexRgb = (h: string): [number, number, number] => {
  const v = parseInt((h || '#000000').slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};

const luaString = (s: string) =>
  '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '').replace(/\t/g, '\\t') + '"';

export function normalizeAsset(v: string) {
  const s = (v ?? '').trim();
  if (!s) return '';
  if (/^\d+$/.test(s)) return `rbxassetid://${s}`;
  return s;
}

export function luaValue(def: PropDef, v: any): string {
  switch (def.type) {
    case 'UDim2': {
      if (v.x.s === 0 && v.y.s === 0) return `UDim2.fromOffset(${num(v.x.o)}, ${num(v.y.o)})`;
      if (v.x.o === 0 && v.y.o === 0) return `UDim2.fromScale(${num(v.x.s)}, ${num(v.y.s)})`;
      return `UDim2.new(${num(v.x.s)}, ${num(v.x.o)}, ${num(v.y.s)}, ${num(v.y.o)})`;
    }
    case 'UDim':
      return `UDim.new(${num(v.s)}, ${num(v.o)})`;
    case 'Vector2':
      return `Vector2.new(${num(v.x)}, ${num(v.y)})`;
    case 'Vector3':
      return `Vector3.new(${num(v.x)}, ${num(v.y)}, ${num(v.z)})`;
    case 'float':
    case 'int':
      return num(v);
    case 'bool':
      return v ? 'true' : 'false';
    case 'Color3':
      return `Color3.fromRGB(${hexRgb(v).join(', ')})`;
    case 'string':
      return luaString(String(v ?? ''));
    case 'Content':
      return luaString(normalizeAsset(v));
    case 'enum':
      return `Enum.${def.enumType}.${v}`;
    case 'Font':
      return `Font.new(${luaString(fontAssetUrl(v.family))}, Enum.FontWeight.${weightName(v.weight)}, Enum.FontStyle.${v.style})`;
    case 'ColorSequence':
      return `ColorSequence.new({${v.map((k: any) => `ColorSequenceKeypoint.new(${num(k.t)}, Color3.fromRGB(${hexRgb(k.c).join(', ')}))`).join(', ')}})`;
    case 'NumberSequence':
      return `NumberSequence.new({${v.map((k: any) => `NumberSequenceKeypoint.new(${num(k.t)}, ${num(k.v)})`).join(', ')}})`;
    case 'Rect':
      return `Rect.new(${num(v.x0)}, ${num(v.y0)}, ${num(v.x1)}, ${num(v.y1)})`;
  }
}

export function sameValue(a: any, b: any): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => sameValue(a[k], b[k]));
}

/** Properties worth writing for a node (differs from the Roblox default, or always emitted) */
export function emittedProps(node: GuiNode): [PropDef, any][] {
  const out: [PropDef, any][] = [];
  const props = exportedProps(node);
  for (const def of CLASS_PROPS[node.className]) {
    const v = props[def.name];
    if (v === undefined) continue;
    if (def.name === 'CanvasPosition') continue; // editor preview only
    if (def.always || !sameValue(v, def.default)) out.push([def, v]);
  }
  return out;
}

const LUA_RESERVED = new Set([
  'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'if', 'in', 'local', 'nil', 'not', 'or',
  'repeat', 'return', 'then', 'true', 'until', 'while', 'continue', 'type', 'typeof', 'game', 'workspace', 'script',
  'task', 'Instance', 'Enum', 'UDim', 'UDim2', 'Vector2', 'Color3', 'Font', 'Rect', 'TweenService', 'TweenInfo',
  'Players', 'playerGui', 'ui', 'Builder', 'animations', 'print', 'warn', 'math', 'string', 'table',
]);

export function makeVarNames(doc: Doc, ids: string[]): Map<string, string> {
  const used = new Set<string>();
  const names = new Map<string, string>();
  const walk = (id: string) => {
    const n = doc.nodes[id];
    let base = identifier(n.name);
    if (LUA_RESERVED.has(base)) base += '_';
    let v = base;
    let i = 2;
    while (used.has(v)) v = `${base}${i++}`;
    used.add(v);
    names.set(id, v);
    n.children.forEach(walk);
  };
  ids.forEach(walk);
  return names;
}

export interface LuauOptions {
  style: 'localscript' | 'module';
  /** Include animations, triggers, effects and player bindings */
  behavior: boolean;
}

/** Path2D control points as a Luau array of Path2DControlPoint */
export function pathPointsLua(points: PathPoint[]): string {
  const u2 = (u: UDim2) => `UDim2.new(${num(u.x.s)}, ${num(u.x.o)}, ${num(u.y.s)}, ${num(u.y.o)})`;
  return `{ ${points.map((pt) => `Path2DControlPoint.new(${u2(pt.p)}, ${u2(pt.l)}, ${u2(pt.r)})`).join(', ')} }`;
}

export function generateLuau(fullDoc: Doc, opts: LuauOptions): string {
  const doc = gameStartDoc(fullDoc);
  const vars = makeVarNames(doc, doc.rootIds);
  const module = opts.style === 'module';
  const I = module ? '\t' : '';
  const b = opts.behavior ? behaviorLines(doc, () => true, (id) => vars.get(id)!, I) : null;
  const services = new Set(['Players', ...(b?.services ?? [])]);
  const out: string[] = [];

  out.push('-- Generated with Roblox UI Builder');
  if (module) out.push('-- ModuleScript: require(this).create(parent?) builds the UI and returns a table of instances');
  else out.push('-- LocalScript: place in StarterPlayerScripts or StarterGui');
  out.push('');
  for (const svc of services) out.push(`local ${svc} = game:GetService("${svc}")`);
  out.push('');
  if (module) {
    out.push('local Builder = {}', '', 'function Builder.create(parent: Instance?)');
    out.push('\tlocal ui = {}');
    out.push('\tlocal playerGui = parent or Players.LocalPlayer:WaitForChild("PlayerGui")');
  } else {
    out.push('local playerGui = Players.LocalPlayer:WaitForChild("PlayerGui")');
  }

  const emit = (id: string, parentVar: string | null) => {
    const n = doc.nodes[id];
    const v = vars.get(id)!;
    out.push('');
    out.push(`${I}local ${v} = Instance.new("${n.className}")`);
    out.push(`${I}${v}.Name = ${luaString(n.name)}`);
    for (const [def, val] of emittedProps(n)) out.push(`${I}${v}.${def.name} = ${luaValue(def, val)}`);
    if (n.className === 'Path2D' && n.points?.length) out.push(`${I}${v}:SetControlPoints(${pathPointsLua(n.points)})`);
    for (const c of n.children) emit(c, v);
    if (parentVar) out.push(`${I}${v}.Parent = ${parentVar}`);
    if (module) out.push(`${I}ui.${v} = ${v}`);
  };
  for (const r of doc.rootIds) emit(r, null);

  out.push('');
  for (const r of doc.rootIds) {
    const n = doc.nodes[r];
    if (isWorldGui(n.className)) {
      // World GUIs live in PlayerGui (so buttons work) and are attached to a part
      const adornee = n.adornee ? adorneeExpr(n.adornee) : null;
      out.push(adornee ? `${I}${vars.get(r)}.Adornee = ${adornee}` : `${I}-- TODO: set ${vars.get(r)}.Adornee to the part this ${n.className} should appear on`);
    }
    out.push(`${I}${vars.get(r)}.Parent = playerGui`);
  }

  if (pixelScaleOn(doc)) {
    for (const r of doc.rootIds) if (doc.nodes[r].className === 'ScreenGui') out.push('', ...pixelScalerLines(vars.get(r)!, designSize(doc), I));
  }

  if (!b) {
    const clicks = clickLines(doc, () => true, (id) => vars.get(id)!, I);
    if (clicks.length) out.push('', ...clicks);
  }

  if (b && b.lines.length) {
    out.push('', ...b.lines);
    if (module && b.clipFns.size) {
      out.push(`${I}ui.animations = {`);
      for (const [clipId, fn] of b.clipFns) out.push(`${I}\t${identifier(doc.clips.find((c) => c.id === clipId)!.name)} = ${fn},`);
      out.push(`${I}}`);
    }
  }

  if (module) {
    out.push('', '\treturn ui', 'end', '', 'return Builder');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}
