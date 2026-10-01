// Client side of the Roblox Studio bridge. The dev server (vite.config.ts) holds the
// latest payload; the Studio plugin (studio-plugin/UIBuilderSync.lua) polls for it.
import { useEffect, useState } from 'react';
import { useStore } from './store';
import { CLASS_PROPS, type PropDef } from './model/schema';
import { familyFromAssetUrl, fontAssetUrl, weightName } from './model/fonts';
import { hexRgb, normalizeAsset } from './export/luau';
import { rootScript } from './export/behavior';
import { designSize, pixelScaleOn } from './model/pixelScale';
import { exportedProps } from './model/richColors';
import type { Doc } from './model/types';

type Wire = [string, unknown];

const n = (v: number) => (v === Infinity ? 'inf' : v === -Infinity ? '-inf' : +(+v).toFixed(5));

function encode(def: PropDef, v: any): Wire {
  switch (def.type) {
    case 'UDim2':
      return ['UDim2', [n(v.x.s), Math.round(v.x.o), n(v.y.s), Math.round(v.y.o)]];
    case 'UDim':
      return ['UDim', [n(v.s), Math.round(v.o)]];
    case 'Vector2':
      return ['Vector2', [n(v.x), n(v.y)]];
    case 'Vector3':
      return ['Vector3', [n(v.x), n(v.y), n(v.z)]];
    case 'Color3':
      return ['Color3', hexRgb(v)];
    case 'enum':
      return ['enum', [def.enumType, v]];
    case 'Font':
      return ['Font', [fontAssetUrl(v.family), weightName(v.weight), v.style]];
    case 'ColorSequence':
      return ['ColorSequence', v.map((k: any) => [n(k.t), ...hexRgb(k.c)])];
    case 'NumberSequence':
      return ['NumberSequence', v.map((k: any) => [n(k.t), n(k.v)])];
    case 'Rect':
      return ['Rect', [v.x0, v.y0, v.x1, v.y1]];
    case 'Content':
      return ['string', normalizeAsset(v)];
    case 'float':
    case 'int':
      return ['number', n(v)];
    default:
      return [def.type === 'bool' ? 'bool' : 'string', v];
  }
}

interface WireNode {
  /** editor node id (the plugin tags instances with it so Studio edits can come back) */
  i: string;
  c: string;
  n: string;
  p: Record<string, Wire>;
  k: WireNode[];
}

export function buildWire(doc: Doc) {
  const node = (id: string): WireNode => {
    const x = doc.nodes[id];
    const p: Record<string, Wire> = {};
    const exported = exportedProps(x);
    for (const def of CLASS_PROPS[x.className]) {
      const v = exported[def.name];
      if (v === undefined || def.name === 'CanvasPosition') continue;
      p[def.name] = encode(def, v);
    }
    return { i: id, c: x.className, n: x.name, p, k: x.children.filter((c) => doc.nodes[c]).map(node) };
  };
  return {
    format: 2,
    roots: doc.rootIds.map((id) => ({
      id,
      tree: node(id),
      script: rootScript(doc, id),
      adornee: doc.nodes[id].adornee || null,
      design: doc.nodes[id].className === 'ScreenGui' && pixelScaleOn(doc) ? [designSize(doc).w, designSize(doc).h] : null,
    })),
  };
}

export async function pushToStudio(silent = false): Promise<boolean> {
  try {
    const res = await fetch('/api/studio/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildWire(useStore.getState().doc)),
    });
    if (!res.ok) throw new Error(String(res.status));
    if (!silent) useStore.getState().showToast('Sent to Studio');
    return true;
  } catch {
    if (!silent) useStore.getState().showToast('Studio bridge unavailable — run the app with "npm run dev"');
    return false;
  }
}

export interface SyncStatus {
  bridge: boolean;
  connected: boolean;
  version: number;
  lastApplied: number;
}

export function useSyncStatus(): SyncStatus {
  const [st, setSt] = useState<SyncStatus>({ bridge: false, connected: false, version: 0, lastApplied: 0 });
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch('/api/studio/status', { cache: 'no-store' });
        const j = await r.json();
        if (alive) setSt({ bridge: true, connected: !!j.connected, version: j.version, lastApplied: j.lastApplied });
      } catch {
        if (alive) setSt((s) => ({ ...s, bridge: false, connected: false }));
      }
    };
    poll();
    const t = setInterval(poll, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return st;
}

/** When live sync is on, push every document change (debounced) */
export function startLiveSync() {
  let timer: number | undefined;
  let lastDoc = useStore.getState().doc;
  let pending = false;
  return useStore.subscribe((s) => {
    if (s.doc !== lastDoc) {
      lastDoc = s.doc;
      if (applyingStudioEdits) return;
      pending = true;
    }
    if (!s.liveSync || !pending || s.gestureBase) return; // wait for drags to finish
    pending = false;
    clearTimeout(timer);
    timer = window.setTimeout(() => pushToStudio(true), 350);
  });
}

// ---------------------------------------------------------------------------
// Studio -> editor: property edits made in Studio come back into the document

let applyingStudioEdits = false;

const hex2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
const rgbHex = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;
const inf = (v: unknown) => (v === 'inf' ? Infinity : v === '-inf' ? -Infinity : Number(v));
const WEIGHTS: Record<string, number> = { Thin: 100, ExtraLight: 200, Light: 300, Regular: 400, Medium: 500, SemiBold: 600, Bold: 700, ExtraBold: 800, Heavy: 900 };

/** Inverse of encode(): a wire value from the plugin -> editor property value (null if it doesn't fit) */
export function decodeWire(def: PropDef, v: any): unknown {
  try {
    switch (def.type) {
      case 'UDim2':
        return { x: { s: +v[0], o: +v[1] }, y: { s: +v[2], o: +v[3] } };
      case 'UDim':
        return { s: +v[0], o: +v[1] };
      case 'Vector2':
        return { x: inf(v[0]), y: inf(v[1]) };
      case 'Vector3':
        return { x: +v[0], y: +v[1], z: +v[2] };
      case 'Color3':
        return rgbHex(v[0], v[1], v[2]);
      case 'enum':
        return String(v[1]);
      case 'Font':
        return { family: familyFromAssetUrl(String(v[0])), weight: WEIGHTS[v[1]] ?? 400, style: v[2] === 'Italic' ? 'Italic' : 'Normal' };
      case 'ColorSequence':
        return (v as number[][]).map((k) => ({ t: +(+k[0]).toFixed(4), c: rgbHex(k[1], k[2], k[3]) }));
      case 'NumberSequence':
        return (v as number[][]).map((k) => ({ t: +(+k[0]).toFixed(4), v: +(+k[1]).toFixed(4) }));
      case 'Rect':
        return { x0: +v[0], y0: +v[1], x1: +v[2], y1: +v[3] };
      case 'float':
      case 'int':
        return inf(v);
      case 'bool':
        return !!v;
      default:
        return v == null ? '' : String(v);
    }
  } catch {
    return null;
  }
}

interface StudioEdit {
  root: string;
  edits: { i: string; n?: string; p: Record<string, [string, unknown]> }[];
}

/** Apply edits sent by the Studio plugin. Returns the property names that changed. */
export function applyStudioEdits(batch: StudioEdit[]): string[] {
  const changed: string[] = [];
  const s = useStore.getState();
  applyingStudioEdits = true;
  try {
    s.update((d) => {
      for (const b of batch) {
        for (const e of b.edits) {
          const n = d.nodes[e.i];
          if (!n) continue;
          if (e.n && e.n !== n.name) {
            n.name = e.n;
            changed.push(`${e.n}.Name`);
          }
          for (const [prop, wire] of Object.entries(e.p ?? {})) {
            const def = CLASS_PROPS[n.className].find((x) => x.name === prop);
            if (!def) continue;
            // multi-colour text is baked into Text on export; editing it in Studio would duplicate the colours
            if (n.textColors && (prop === 'Text' || prop === 'RichText')) continue;
            const value = decodeWire(def, wire[1]);
            if (value === null || value === undefined) continue;
            if (JSON.stringify(value) === JSON.stringify(n.props[prop])) continue;
            n.props[prop] = value as never;
            changed.push(`${n.name}.${prop}`);
          }
        }
      }
    });
  } finally {
    applyingStudioEdits = false;
  }
  return changed;
}

/** Poll the bridge for edits made in Studio and apply them to the document */
export function startStudioEdits() {
  let since = -1;
  let busy = false;
  const poll = async () => {
    if (busy) return;
    busy = true;
    try {
      const r = await fetch(`/api/studio/edits?since=${since}`, { cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json();
      if (since >= 0 && j.edits?.length) {
        const changed = applyStudioEdits(j.edits as StudioEdit[]);
        if (changed.length) {
          const uniq = [...new Set(changed)];
          useStore.getState().showToast(`Studio edit applied: ${uniq.slice(0, 3).join(', ')}${uniq.length > 3 ? ` +${uniq.length - 3} more` : ''}`);
        }
      }
      since = j.seq ?? since;
    } catch {
      /* bridge offline */
    } finally {
      busy = false;
    }
  };
  poll();
  const t = window.setInterval(poll, 1000);
  return () => clearInterval(t);
}
