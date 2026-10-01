import type { Draft } from 'immer';
import { useStore, getActiveClip, sanitize } from './store';
import { computeLayout, type LayoutResult } from './model/layout';
import { applyOverrides, evaluateClip, tweenEnd } from './model/animation';
import {
  attach, createNode, descendants, detach, extractFragment, insertFragment, pathTo, rectToProps, removeNode,
  topLevelOnly, uid, unionRect, type Fragment, type Units,
} from './model/doc';
import {
  ANIMATABLE_PROPS, CONTAINER_CLASSES, hasProp, isGuiObject, isModifier, isRoot, isText, isWorldGui, modifierAllowed, SINGLETON_MODIFIERS,
} from './model/schema';
import type { AnimClip, ClassName, Doc, Effect, EffectKind, GuiNode, ModifierClass, Rect, RootClass, TriggerKind, Tween, UDim } from './model/types';
import { EFFECTS } from './model/effects';
import { applyPixelScale, designSize, pixelScaleFactor } from './model/pixelScale';
import { addPrefab, updatePrefab, type Prefab } from './model/prefabs';
import { buildFragment, rootStarter } from './model/presets';

const S = () => useStore.getState();

/** Run several updates as a single undo step */
export function batch<T>(fn: () => T): T {
  const nested = !!S().gestureBase;
  if (!nested) S().beginGesture();
  try {
    return fn();
  } finally {
    if (!nested) S().endGesture();
  }
}

// ---------------------------------------------------------------------------
// Effective (animated) state

export function effectiveNodes(doc = S().doc): Record<string, GuiNode> {
  const s = S();
  if (s.mode !== 'animate') return doc.nodes;
  const clip = doc.clips.find((c) => c.id === s.activeClipId);
  return applyOverrides(doc.nodes, evaluateClip(clip, doc.nodes, s.playhead));
}

export function layoutNow(): LayoutResult {
  const { doc } = S();
  return computeLayout(applyPixelScale(effectiveNodes(doc), doc.rootIds, pixelScaleFactor(doc)), doc.rootIds, doc.device);
}

// ---------------------------------------------------------------------------
// Property editing

function upsertKeyframe(d: Draft<Doc>, clipId: string, nodeId: string, prop: string, value: any, time: number): string | null {
  const clip = d.clips.find((c) => c.id === clipId);
  if (!clip) return null;
  const mine = clip.tweens.filter((t) => t.nodeId === nodeId && t.prop === prop);
  const ending = mine.find((t) => Math.abs(tweenEnd(t) - time) < 0.02);
  if (ending) {
    ending.to = structuredClone(value);
    return ending.id;
  }
  const inside = mine.find((t) => t.start < time && tweenEnd(t) > time);
  if (inside) {
    inside.duration = +(time - inside.start).toFixed(3);
    inside.to = structuredClone(value);
    return inside.id;
  }
  const prevEnd = mine.reduce((m, t) => (tweenEnd(t) <= time ? Math.max(m, tweenEnd(t)) : m), 0);
  const tw: Tween = {
    id: uid(),
    nodeId,
    prop,
    to: structuredClone(value),
    start: +prevEnd.toFixed(3),
    duration: +Math.max(0.05, time - prevEnd).toFixed(3),
    style: 'Quad',
    direction: 'Out',
  };
  clip.tweens.push(tw);
  return tw.id;
}

/** Set a property on nodes. In Animate mode, animatable properties are keyframed at the playhead instead. */
export function setProp(ids: string[], prop: string, value: any, coalesce = true) {
  setProps(ids.map((id) => ({ id, props: { [prop]: value } })), coalesce ? `prop:${prop}:${ids.join(',')}` : undefined);
}

export function setProps(changes: { id: string; props: Record<string, any> }[], coalesce?: string) {
  const s = S();
  const animating = s.mode === 'animate' && s.playhead > 0.001;
  let newTween: string | null = null;
  s.update((d) => {
    for (const { id, props } of changes) {
      const n = d.nodes[id];
      if (!n) continue;
      for (const [k, v] of Object.entries(props)) {
        if (!hasProp(n.className, k)) continue;
        if (animating && ANIMATABLE_PROPS.includes(k)) {
          const t = upsertKeyframe(d, s.activeClipId, id, k, v, s.playhead);
          if (t) newTween = t;
        } else {
          n.props[k] = structuredClone(v);
        }
      }
    }
  }, { coalesce });
  if (newTween) useStore.setState({ selectedTweenId: newTween });
}

export function rename(id: string, name: string) {
  S().update((d) => {
    if (d.nodes[id]) d.nodes[id].name = name.trim() || d.nodes[id].className;
  });
}

export function toggleVisible(id: string) {
  const n = S().doc.nodes[id];
  if (!n) return;
  S().update((d) => {
    const m = d.nodes[id];
    if (isRoot(m.className) || isModifier(m.className)) m.props.Enabled = m.props.Enabled === false;
    else m.props.Visible = m.props.Visible === false;
  });
}

export function toggleLocked(id: string) {
  S().update((d) => {
    if (d.nodes[id]) d.nodes[id].locked = !d.nodes[id].locked;
  });
}

// ---------------------------------------------------------------------------
// Inserting

/**
 * Where new elements go: inside a selected container, next to a selected element, or in the first ScreenGui.
 * `into`: inserting from the Insert panel goes inside whatever single element is selected (any GuiObject can hold children).
 */
export function insertionParent(opts: { into?: boolean } = {}): string {
  const { selection, doc } = S();
  if (selection.length === 1) {
    const n = doc.nodes[selection[0]];
    if (isRoot(n.className) || CONTAINER_CLASSES.includes(n.className)) return n.id;
    if (opts.into && isGuiObject(n.className)) return n.id;
    if (isModifier(n.className)) return n.parentId!;
    if (n.parentId) return n.parentId;
  }
  if (selection.length) {
    const p = doc.nodes[selection[0]]?.parentId;
    if (p) return p;
  }
  return doc.rootIds[0];
}

/** Insert a GUI object. `rect` is an absolute screen rect; otherwise it is centred in the parent. */
export function insertNode(className: ClassName, opts: { parentId?: string; rect?: Rect; select?: boolean } = {}): string {
  const s = S();
  const parentId = opts.parentId ?? insertionParent();
  const node = createNode(className);
  const lay = layoutNow();
  const content = lay.content[parentId] ?? lay.rects[parentId];
  if (content) {
    const [dw, dh] = [node.props.Size.x.o, node.props.Size.y.o];
    const rect = opts.rect ?? { x: content.x + (content.w - dw) / 2, y: content.y + (content.h - dh) / 2, w: dw, h: dh };
    Object.assign(node.props, rectToProps({ ...node.props, Position: { x: { s: 0, o: 0 }, y: { s: 0, o: 0 } } }, rect, content, s.units, true));
  }
  node.name = className;
  // In Scale mode new text scales with its box (capped at its size) so it isn't huge on small screens
  const capText = s.units === 'scale' && isText(className);
  if (capText) node.props.TextScaled = true;
  s.update((d) => {
    d.nodes[node.id] = node as Draft<GuiNode>;
    attach(d, node.id, parentId);
    if (capText) {
      const cap = createNode('UITextSizeConstraint', { MaxTextSize: Math.round(node.props.TextSize) });
      d.nodes[cap.id] = cap as Draft<GuiNode>;
      attach(d, cap.id, node.id, 0);
    }
  });
  if (opts.select !== false) s.select([node.id]);
  return node.id;
}

/** Add a new root GUI. World GUIs get their own artboard (right of the others) and some starter content. */
export function insertRoot(cls: RootClass) {
  const lay = layoutNow();
  const { doc } = S();
  const right = Math.max(doc.device.w + 40, ...Object.values(lay.artboards).map((r) => r.x + r.w));
  const frag = buildFragment([rootStarter(cls)]);
  let id = '';
  S().update((d) => {
    [id] = insertFragment(d as Doc, frag, null);
    if (isWorldGui(cls)) d.nodes[id].artboard = { x: Math.round(right + 120), y: 0 };
  });
  S().select([id]);
  return id;
}

export function insertScreenGui() {
  return insertRoot('ScreenGui');
}

/** Set UICorner radius on elements, creating the UICorner if needed */
export function setCornerRadius(ids: string[], radius: UDim) {
  batch(() => {
    const { doc } = S();
    const missing = ids.filter((id) => isGuiObject(doc.nodes[id]?.className) && !doc.nodes[id].children.some((c) => doc.nodes[c].className === 'UICorner'));
    if (missing.length) addModifier(missing, 'UICorner');
    const corners = ids.flatMap((id) => S().doc.nodes[id]?.children.filter((c) => S().doc.nodes[c].className === 'UICorner') ?? []);
    S().update((d) => {
      for (const c of corners) d.nodes[c].props.CornerRadius = { ...radius };
    }, { coalesce: 'corner:' + ids.join() });
  });
}

// ---------------------------------------------------------------------------
// Effects

export function addEffect(ids: string[], kind: EffectKind) {
  const info = EFFECTS[kind];
  S().update((d) => {
    for (const id of ids) {
      const n = d.nodes[id];
      if (!n || !isGuiObject(n.className)) continue;
      n.effects = (n.effects ?? []).filter((e) => e.kind !== kind);
      n.effects.push({ id: uid(), kind, amount: info.amount.default, speed: info.speed?.default ?? 1 });
    }
  });
}

export function updateEffect(nodeId: string, effectId: string, patch: Partial<Effect>) {
  S().update((d) => {
    const e = d.nodes[nodeId]?.effects?.find((x) => x.id === effectId);
    if (e) Object.assign(e, patch);
  }, { coalesce: 'fx:' + effectId + Object.keys(patch).join() });
}

export function removeEffect(nodeId: string, effectId: string) {
  S().update((d) => {
    const n = d.nodes[nodeId];
    if (n?.effects) n.effects = n.effects.filter((e) => e.id !== effectId);
  });
}

/** Patch editor/behaviour fields stored directly on nodes (avatar, bind, adornee, artboard…) */
export function patchNodes(ids: string[], patch: Partial<GuiNode>, coalesce?: string) {
  S().update((d) => {
    for (const id of ids) {
      const n = d.nodes[id];
      if (!n) continue;
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete (n as any)[k];
        else (n as any)[k] = structuredClone(v);
      }
    }
  }, coalesce ? { coalesce } : undefined);
}

export function addModifier(targetIds: string[], cls: ModifierClass): string[] {
  const s = S();
  const created: string[] = [];
  s.update((d) => {
    for (const id of targetIds) {
      const p = d.nodes[id];
      if (!p || !modifierAllowed(cls, p.className)) continue;
      if (SINGLETON_MODIFIERS.includes(cls) && p.children.some((c) => d.nodes[c].className === cls)) continue;
      if (cls === 'UIListLayout' || cls === 'UIGridLayout') {
        const other = cls === 'UIListLayout' ? 'UIGridLayout' : 'UIListLayout';
        const existing = p.children.find((c) => d.nodes[c].className === other);
        if (existing) removeNode(d as Doc, existing);
      }
      const m = createNode(cls);
      d.nodes[m.id] = m as Draft<GuiNode>;
      attach(d, m.id, id, 0);
      created.push(m.id);
    }
  });
  return created;
}

export function insertFragmentAt(frag: Fragment, parentId: string, center = true): string[] {
  return batch(() => insertFragmentInner(frag, parentId, center));
}

function insertFragmentInner(frag: Fragment, parentId: string, center: boolean): string[] {
  const s = S();
  let roots: string[] = [];
  s.update((d) => {
    roots = insertFragment(d as Doc, frag, parentId);
  });
  const toastRoot = roots.length === 1 && S().doc.nodes[roots[0]]?.toast;
  if (toastRoot && isRoot(S().doc.nodes[parentId]?.className)) {
    S().update((d) => {
      d.nodes[roots[0]].props.Position = { x: { s: 1, o: -24 }, y: { s: 0, o: 90 } };
    });
  } else if (center && roots.length === 1 && isGuiObject(S().doc.nodes[roots[0]].className)) {
    const lay = layoutNow();
    const r = lay.rects[roots[0]];
    const c = lay.content[parentId];
    if (r && c && !lay.laidOut.has(roots[0])) {
      const props = rectToProps(S().doc.nodes[roots[0]].props, { ...r, x: c.x + (c.w - r.w) / 2, y: c.y + (c.h - r.h) / 2 }, c, s.units, false);
      S().update((d) => {
        d.nodes[roots[0]].props.Position = props.Position;
      });
    }
  }
  if (S().units === 'scale') {
    const gui = roots.filter((r) => isGuiObject(S().doc.nodes[r]?.className));
    if (gui.length) makeResponsive(gui);
  }
  s.select(roots);
  return roots;
}

// ---------------------------------------------------------------------------
// Geometry edits (move / resize / rotate), used by canvas gestures & nudging

/** Place nodes at absolute rects (keeps Scale/Offset per the current units preference). */
export function placeNodes(rects: { id: string; rect: Rect }[], lay: LayoutResult) {
  const s = S();
  const nodes = effectiveNodes();
  const changes = rects.map(({ id, rect }) => {
    const n = nodes[id];
    const content = lay.content[n.parentId!] ?? lay.rects[n.parentId!];
    const p = rectToProps(n.props, rect, content, s.units);
    const props: Record<string, any> = {};
    if (!sameUDim2(p.Size, n.props.Size)) props.Size = p.Size;
    if (!lay.laidOut.has(id) && !sameUDim2(p.Position, n.props.Position)) props.Position = p.Position;
    return { id, props };
  });
  setProps(changes.filter((c) => Object.keys(c.props).length));
}

const sameUDim2 = (a: any, b: any) => a.x.s === b.x.s && a.x.o === b.x.o && a.y.s === b.y.s && a.y.o === b.y.o;

export function nudge(dx: number, dy: number) {
  const s = S();
  const ids = s.selection.filter((id) => isGuiObject(s.doc.nodes[id]?.className) && !s.doc.nodes[id].locked);
  if (!ids.length) return;
  const lay = layoutNow();
  const stacked = ids.filter((id) => lay.laidOut.has(id));
  if (stacked.length) {
    const layout = stackLayout(s.doc.nodes[stacked[0]].parentId);
    const vertical = layout?.className === 'UIListLayout' ? layout.props.FillDirection !== 'Horizontal' : layout?.props.FillDirection === 'Vertical';
    const step = vertical ? Math.sign(dy) : Math.sign(dx);
    if (step) stepInStack(stacked, step);
  }
  placeNodes(ids.filter((id) => !lay.laidOut.has(id)).map((id) => ({ id, rect: { ...lay.rects[id], x: lay.rects[id].x + dx, y: lay.rects[id].y + dy } })), lay);
}

export function convertUnits(ids: string[], units: Units) {
  const lay = layoutNow();
  const nodes = S().doc.nodes;
  S().update((d) => {
    for (const id of ids) {
      const n = nodes[id];
      if (!n || !isGuiObject(n.className)) continue;
      const content = lay.content[n.parentId!];
      const p = rectToProps(n.props, lay.rects[id], content, units, true);
      d.nodes[id].props.Size = p.Size;
      if (!lay.laidOut.has(id)) d.nodes[id].props.Position = p.Position;
    }
  });
}

export type AlignKind = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
export function align(kind: AlignKind) {
  const s = S();
  const ids = s.selection.filter((id) => isGuiObject(s.doc.nodes[id]?.className));
  if (!ids.length) return;
  const lay = layoutNow();
  const bounds = ids.length === 1 ? lay.content[s.doc.nodes[ids[0]].parentId!] : unionRect(ids.map((id) => lay.rects[id]));
  placeNodes(
    ids.map((id) => {
      const r = { ...lay.rects[id] };
      if (kind === 'left') r.x = bounds.x;
      if (kind === 'hcenter') r.x = bounds.x + (bounds.w - r.w) / 2;
      if (kind === 'right') r.x = bounds.x + bounds.w - r.w;
      if (kind === 'top') r.y = bounds.y;
      if (kind === 'vcenter') r.y = bounds.y + (bounds.h - r.h) / 2;
      if (kind === 'bottom') r.y = bounds.y + bounds.h - r.h;
      return { id, rect: r };
    }),
    lay,
  );
}

// ---------------------------------------------------------------------------
// Structure edits

export function deleteSelection() {
  const s = S();
  let ids = topLevelOnly(s.doc.nodes, s.selection);
  // never delete the last ScreenGui
  const roots = ids.filter((id) => s.doc.rootIds.includes(id));
  if (roots.length && roots.length >= s.doc.rootIds.length) ids = ids.filter((id) => id !== s.doc.rootIds[0]);
  if (!ids.length) return;
  const parent = s.doc.nodes[ids[0]].parentId;
  s.update((d) => ids.forEach((id) => removeNode(d as Doc, id)));
  s.select(parent && s.doc.nodes[parent] && !s.doc.rootIds.includes(parent) ? [parent] : []);
  sanitize();
}

let clipboard: Fragment | null = null;

export function copySelection() {
  const s = S();
  const ids = topLevelOnly(s.doc.nodes, s.selection).filter((id) => !s.doc.rootIds.includes(id));
  if (!ids.length) return false;
  clipboard = extractFragment(s.doc.nodes, ids);
  s.showToast(`Copied ${ids.length} item${ids.length > 1 ? 's' : ''}`);
  return true;
}

export function cutSelection() {
  if (copySelection()) deleteSelection();
}

export function pasteClipboard() {
  if (!clipboard) return;
  const s = S();
  let parent = insertionParent();
  // Pasting while the original is selected puts the copy beside it rather than inside it
  if (s.selection.length === 1 && clipboard.rootIds.includes(s.selection[0])) parent = s.doc.nodes[s.selection[0]].parentId!;
  const allMods = clipboard.rootIds.every((r) => isModifier(clipboard!.nodes.find((n) => n.id === r)!.className));
  if (allMods && s.selection.length === 1 && isGuiObject(s.doc.nodes[s.selection[0]].className)) parent = s.selection[0];
  let roots: string[] = [];
  s.update((d) => {
    roots = insertFragment(d as Doc, clipboard!, parent);
  });
  s.select(roots);
}

export function duplicateSelection() {
  const s = S();
  const ids = topLevelOnly(s.doc.nodes, s.selection).filter((id) => !isRoot(s.doc.nodes[id]?.className));
  if (!ids.length) return;
  // copy from the committed state (immer drafts can't be structured-cloned)
  const frags = ids.map((id) => ({ id, frag: extractFragment(s.doc.nodes, [id]) }));
  const created: string[] = [];
  s.update((d) => {
    for (const { id, frag } of frags) {
      const n = d.nodes[id];
      const idx = d.nodes[n.parentId!].children.indexOf(id);
      const [root] = insertFragment(d as Doc, frag, n.parentId!, idx + 1);
      const copy = d.nodes[root];
      if (isGuiObject(copy.className)) {
        copy.props.Position.x.o += 10;
        copy.props.Position.y.o += 10;
      }
      created.push(root);
    }
  });
  s.select(created);
}

/**
 * Convert elements (and everything inside them) to Scale so they keep their proportions on every screen:
 * Position/Size/padding/layout spacing become Scale, fixed-size text becomes TextScaled (capped at its
 * designed size) and each top-level element gets a UIAspectRatioConstraint so it keeps its shape.
 */
export function makeResponsive(ids: string[]) {
  batch(() => {
    const lay = layoutNow();
    const nodes = S().doc.nodes;
    const roots = topLevelOnly(nodes, ids).filter((id) => isGuiObject(nodes[id]?.className));
    if (!roots.length) return;
    const all = roots.flatMap((r) => [r, ...descendants(nodes, r)]);
    const needAspect = roots.filter((r) => !lay.laidOut.has(r) && !nodes[r].children.some((c) => nodes[c].className === 'UIAspectRatioConstraint'));
    const needTextCap = all.filter((id) => isText(nodes[id].className) && !nodes[id].props.TextScaled && !nodes[id].children.some((c) => nodes[c].className === 'UITextSizeConstraint'));
    const aspectIds = addModifier(needAspect, 'UIAspectRatioConstraint');
    const capIds = addModifier(needTextCap, 'UITextSizeConstraint');
    S().update((d) => {
      for (const id of all) {
        const n = d.nodes[id];
        const src = nodes[id];
        if (!n || !src) continue;
        const parent = src.parentId!;
        const content = lay.content[parent];
        if (isGuiObject(src.className) && content && lay.rects[id]) {
          const p = rectToProps(src.props, lay.rects[id], content, 'scale', true);
          n.props.Size = p.Size;
          if (!lay.laidOut.has(id)) n.props.Position = p.Position;
          if (isText(src.className) && !src.props.TextScaled) n.props.TextScaled = true;
        }
        const own = lay.rects[parent];
        const box = lay.content[parent] ?? own;
        if (!box) continue;
        const toScale = (u: UDim, len: number) => (u.o && len > 0 ? { s: +(u.s + u.o / len).toFixed(4), o: 0 } : u);
        if (src.className === 'UIPadding' && own) {
          n.props.PaddingLeft = toScale(src.props.PaddingLeft, own.w);
          n.props.PaddingRight = toScale(src.props.PaddingRight, own.w);
          n.props.PaddingTop = toScale(src.props.PaddingTop, own.h);
          n.props.PaddingBottom = toScale(src.props.PaddingBottom, own.h);
        }
        if (src.className === 'UIListLayout') n.props.Padding = toScale(src.props.Padding, src.props.FillDirection === 'Vertical' ? box.h : box.w);
        if (src.className === 'UIGridLayout') {
          n.props.CellSize = { x: toScale(src.props.CellSize.x, box.w), y: toScale(src.props.CellSize.y, box.h) };
          n.props.CellPadding = { x: toScale(src.props.CellPadding.x, box.w), y: toScale(src.props.CellPadding.y, box.h) };
        }
      }
      needAspect.forEach((r, i) => {
        const rect = lay.rects[r];
        const m = aspectIds[i] && d.nodes[aspectIds[i]];
        if (m && rect) m.props.AspectRatio = +(rect.w / Math.max(1, rect.h)).toFixed(4);
      });
      needTextCap.forEach((t, i) => {
        const m = capIds[i] && d.nodes[capIds[i]];
        if (m) m.props.MaxTextSize = Math.round(nodes[t].props.TextSize);
      });
    });
  });
  S().showToast('Converted to Scale — it now keeps its proportions on every screen size');
}

/** Move nodes into a new parent at an index, keeping their on-screen rect. */
export function moveNodes(ids: string[], parentId: string, index: number) {
  batch(() => moveNodesInner(ids, parentId, index));
}

function moveNodesInner(ids: string[], parentId: string, index: number) {
  const s = S();
  ids = topLevelOnly(s.doc.nodes, ids).filter((id) => id !== parentId && !pathTo(s.doc.nodes, parentId).includes(id));
  if (!ids.length) return;
  const before = layoutNow();
  s.update((d) => {
    let i = index;
    for (const id of ids) {
      const n = d.nodes[id];
      if (isModifier(n.className) && !modifierAllowed(n.className as ModifierClass, d.nodes[parentId].className)) continue;
      if (!isModifier(n.className) && !(isGuiObject(d.nodes[parentId].className) || isRoot(d.nodes[parentId].className))) continue;
      const oldParent = n.parentId;
      const oldIdx = oldParent ? d.nodes[oldParent].children.indexOf(id) : -1;
      detach(d as Doc, id);
      if (oldParent === parentId && oldIdx < i) i--;
      attach(d as Doc, id, parentId, i++);
    }
  });
  // keep on-screen placement
  const after = computeLayout(S().doc.nodes, S().doc.rootIds, S().doc.device);
  S().update((d) => {
    for (const id of ids) {
      const n = d.nodes[id];
      if (!isGuiObject(n.className) || !before.rects[id]) continue;
      const content = after.content[n.parentId!];
      if (!content) continue;
      const p = rectToProps(n.props, before.rects[id], content, s.units);
      // a UIListLayout/UIGridLayout decides the position, but the size is still the element's own
      if (!after.laidOut.has(id)) n.props.Position = p.Position;
      n.props.Size = p.Size;
    }
  });
}

export function groupSelection() {
  const s = S();
  const ids = topLevelOnly(s.doc.nodes, s.selection).filter((id) => isGuiObject(s.doc.nodes[id].className));
  if (!ids.length) return;
  const parentId = s.doc.nodes[ids[0]].parentId!;
  const same = ids.filter((id) => s.doc.nodes[id].parentId === parentId);
  const lay = layoutNow();
  const bounds = unionRect(same.map((id) => lay.rects[id]));
  const frame = createNode('Frame', { BackgroundTransparency: 1 }, 'Group');
  const content = lay.content[parentId];
  Object.assign(frame.props, rectToProps(frame.props, bounds, content, s.units, true));
  const firstIdx = Math.min(...same.map((id) => s.doc.nodes[parentId].children.indexOf(id)));
  s.update((d) => {
    d.nodes[frame.id] = frame as Draft<GuiNode>;
    attach(d as Doc, frame.id, parentId, firstIdx);
    for (const id of same) {
      detach(d as Doc, id);
      attach(d as Doc, id, frame.id);
      const p = rectToProps(d.nodes[id].props, lay.rects[id], bounds, s.units);
      d.nodes[id].props.Position = p.Position;
      d.nodes[id].props.Size = p.Size;
    }
  });
  s.select([frame.id]);
}

export function ungroupSelection() {
  const s = S();
  const groups = s.selection.filter((id) => isGuiObject(s.doc.nodes[id]?.className) && s.doc.nodes[id].parentId);
  if (!groups.length) return;
  const lay = layoutNow();
  const freed: string[] = [];
  s.update((d) => {
    for (const g of groups) {
      const gn = d.nodes[g];
      const parentId = gn.parentId!;
      const idx = d.nodes[parentId].children.indexOf(g);
      const kids = gn.children.filter((c) => isGuiObject(d.nodes[c].className));
      const content = lay.content[parentId];
      kids.forEach((k, i) => {
        detach(d as Doc, k);
        attach(d as Doc, k, parentId, idx + 1 + i);
        const p = rectToProps(d.nodes[k].props, lay.rects[k], content, s.units);
        d.nodes[k].props.Position = p.Position;
        d.nodes[k].props.Size = p.Size;
        freed.push(k);
      });
      removeNode(d as Doc, g);
    }
  });
  s.select(freed);
}

/** Reorder among siblings. In the layers list, "forward" means drawn later (higher up in the list). */
export function reorder(dir: 'forward' | 'backward' | 'front' | 'back') {
  const s = S();
  const ids = s.selection.filter((id) => s.doc.nodes[id]?.parentId);
  if (!ids.length) return;
  s.update((d) => {
    for (const id of ids) {
      const arr = d.nodes[d.nodes[id].parentId!].children;
      const i = arr.indexOf(id);
      arr.splice(i, 1);
      const j = dir === 'front' ? arr.length : dir === 'back' ? 0 : dir === 'forward' ? Math.min(arr.length, i + 1) : Math.max(0, i - 1);
      arr.splice(j, 0, id);
    }
  });
}

export function selectAll() {
  const s = S();
  const first = s.selection[0] ? s.doc.nodes[s.selection[0]] : null;
  const parent = first?.parentId ?? s.doc.rootIds[0];
  s.select(s.doc.nodes[parent].children.filter((c) => isGuiObject(s.doc.nodes[c].className)));
}

// ---------------------------------------------------------------------------
// Animation clips

export function updateClip(id: string, patch: Partial<AnimClip>) {
  S().update((d) => {
    const c = d.clips.find((x) => x.id === id);
    if (!c) return;
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete (c as any)[k];
      else (c as any)[k] = v;
    }
  });
}

/** Make a clip that tweens the same properties back to their designed values (e.g. hover-out for a hover-in clip) */
export function addReverseClip(clipId: string) {
  const s = S();
  const src = s.doc.clips.find((c) => c.id === clipId);
  if (!src) return;
  const seen = new Set<string>();
  const tweens: Tween[] = [];
  const dur = Math.max(0.1, ...src.tweens.map((t) => t.duration));
  for (const t of src.tweens) {
    const k = t.nodeId + '.' + t.prop;
    if (seen.has(k) || !s.doc.nodes[t.nodeId]) continue;
    seen.add(k);
    tweens.push({ ...t, id: uid(), start: 0, duration: +Math.min(dur, 0.3).toFixed(2), to: structuredClone(s.doc.nodes[t.nodeId].props[t.prop]) });
  }
  const opposite: Partial<Record<TriggerKind, TriggerKind>> = { hoverEnter: 'hoverLeave', hoverLeave: 'hoverEnter', pressDown: 'pressUp', pressUp: 'pressDown' };
  const clip: AnimClip = {
    id: uid(),
    name: src.name.replace(/(In|Enter|Down)$/, '') + (src.trigger === 'hoverEnter' ? 'Out' : 'Back'),
    tweens,
    trigger: opposite[src.trigger ?? 'manual'] ?? 'manual',
    triggerNodeId: src.triggerNodeId,
    from: 'current',
  };
  s.update((d) => {
    d.clips.push(clip);
  });
  useStore.setState({ activeClipId: clip.id, playhead: 0, selectedTweenId: null });
}

export function updateTween(id: string, patch: Partial<Tween>, coalesce = true) {
  S().update((d) => {
    for (const c of d.clips) {
      const t = c.tweens.find((x) => x.id === id);
      if (t) Object.assign(t, structuredClone(patch));
    }
  }, coalesce ? { coalesce: 'tween:' + id + Object.keys(patch).join() } : undefined);
}

export function deleteTween(id: string) {
  S().update((d) => {
    for (const c of d.clips) c.tweens = c.tweens.filter((t) => t.id !== id);
  });
  useStore.setState({ selectedTweenId: null });
}

export function addTween(nodeId: string, prop: string) {
  const s = S();
  const node = s.doc.nodes[nodeId];
  const clip = getActiveClip();
  if (!node || !clip) return;
  const mine = clip.tweens.filter((t) => t.nodeId === nodeId && t.prop === prop);
  const start = Math.max(s.playhead, ...mine.map(tweenEnd), 0);
  const tw: Tween = { id: uid(), nodeId, prop, to: structuredClone(node.props[prop]), start: +start.toFixed(3), duration: 0.5, style: 'Quad', direction: 'Out' };
  s.update((d) => {
    d.clips.find((c) => c.id === clip.id)?.tweens.push(tw);
  });
  useStore.setState({ selectedTweenId: tw.id, playhead: tw.start + tw.duration });
}

export function addClip() {
  const clip: AnimClip = { id: uid(), name: `Animation${S().doc.clips.length + 1}`, tweens: [], trigger: 'manual' };
  S().update((d) => {
    d.clips.push(clip);
  });
  useStore.setState({ activeClipId: clip.id, playhead: 0, selectedTweenId: null });
}

export function renameClip(id: string, name: string) {
  S().update((d) => {
    const c = d.clips.find((x) => x.id === id);
    if (c) c.name = name.replace(/[^A-Za-z0-9_]/g, '') || 'Animation';
  });
}

export function deleteClip(id: string) {
  const s = S();
  if (s.doc.clips.length <= 1) {
    s.update((d) => {
      d.clips[0].tweens = [];
    });
    return;
  }
  s.update((d) => {
    d.clips = d.clips.filter((c) => c.id !== id);
  });
  sanitize();
}

// ---------------------------------------------------------------------------
// Responsiveness check

/** Why an element won't keep its proportions on other screen sizes, or null if it's fine */
export function fixedSizeReason(n: GuiNode, nodes: Record<string, GuiNode>): string | null {
  if (!isGuiObject(n.className)) return null;
  const size = n.props.Size;
  const fixedW = size.x.s === 0 && size.x.o !== 0;
  const fixedH = size.y.s === 0 && size.y.o !== 0;
  if (fixedW || fixedH) return `fixed ${fixedW && fixedH ? 'size' : fixedW ? 'width' : 'height'} in pixels`;
  if (isText(n.className) && !n.props.TextScaled && !n.bind) return `fixed text size (${n.props.TextSize}px)`;
  void nodes;
  return null;
}

/** Elements inside ScreenGuis that use fixed pixel sizes (BillboardGui/SurfaceGui have fixed canvases, so they're skipped) */
export function responsiveIssues(doc = S().doc): string[] {
  const out: string[] = [];
  for (const r of doc.rootIds) {
    if (doc.nodes[r]?.className !== 'ScreenGui') continue;
    for (const id of descendants(doc.nodes, r)) if (fixedSizeReason(doc.nodes[id], doc.nodes)) out.push(id);
  }
  return out;
}

/** Make every fixed-size element in the ScreenGuis responsive (by converting the top-level element that contains it) */
export function makeAllResponsive() {
  const { doc } = S();
  const tops = new Set<string>();
  for (const id of responsiveIssues(doc)) {
    const path = pathTo(doc.nodes, id);
    tops.add(path[1] ?? id);
  }
  if (!tops.size) return;
  makeResponsive([...tops]);
}

// ---------------------------------------------------------------------------
// Overlap check: an element sitting on top of a card/frame without being inside it

export interface OverlapIssue {
  id: string;
  /** container it visually sits inside */
  into: string;
}

const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x - 1 && inner.y >= outer.y - 1 && inner.x + inner.w <= outer.x + outer.w + 1 && inner.y + inner.h <= outer.y + outer.h + 1;

/**
 * Elements that sit inside a Frame/CanvasGroup/ScrollingFrame on screen but aren't its children.
 * They're positioned against different parents, so on other screen shapes they drift apart
 * (e.g. a button placed on a card with a locked aspect ratio).
 */
export function overlapIssues(doc = S().doc): OverlapIssue[] {
  const lay = computeLayout(doc.nodes, doc.rootIds, doc.device);
  const out: OverlapIssue[] = [];
  for (const r of doc.rootIds) {
    if (doc.nodes[r]?.className !== 'ScreenGui') continue;
    const all = descendants(doc.nodes, r).filter((id) => isGuiObject(doc.nodes[id].className) && doc.nodes[id].props.Visible !== false);
    const containers = all.filter((id) => CONTAINER_CLASSES.includes(doc.nodes[id].className) && !doc.nodes[id].locked);
    for (const id of all) {
      const n = doc.nodes[id];
      const rect = lay.rects[id];
      if (!rect || lay.laidOut.has(id) || n.toast) continue;
      const parentArea = lay.content[n.parentId!] ?? lay.rects[n.parentId!];
      const ancestors = pathTo(doc.nodes, id);
      let best: string | null = null;
      for (const c of containers) {
        if (c === id || ancestors.includes(c) || pathTo(doc.nodes, c).includes(id)) continue;
        const cr = lay.rects[c];
        if (!cr || !contains(cr, rect)) continue;
        // full-screen backdrops (most of the parent's area) aren't cards
        if (parentArea && cr.w * cr.h >= 0.6 * parentArea.w * parentArea.h) continue;
        if (!best || cr.w * cr.h < lay.rects[best].w * lay.rects[best].h) best = c;
      }
      if (best) out.push({ id, into: best });
    }
  }
  // moving a parent fixes its children too
  const ids = new Set(out.map((o) => o.id));
  return out.filter((o) => !pathTo(doc.nodes, o.id).slice(0, -1).some((a) => ids.has(a)));
}

/**
 * Move elements into a frame, keeping them where they are on screen. If the frame stacks its children
 * (UIListLayout), they're slotted into the stack where they visually sit, and if the stack then
 * overflows, the biggest other item is shrunk to make room.
 */
export function moveIntoFrame(ids: string[], into: string, dropRects?: Record<string, Rect>) {
  batch(() => {
    const doc0 = S().doc;
    const target = doc0.nodes[into];
    if (!target) return;
    const list = target.children.map((c) => doc0.nodes[c]).find((c) => c?.className === 'UIListLayout');
    const lay0 = layoutNow();
    // where the elements are (or were dropped) on screen
    if (dropRects) for (const [id, r] of Object.entries(dropRects)) lay0.rects[id] = r;
    if (list) {
      const vertical = list.props.FillDirection !== 'Horizontal';
      const centre = (id: string) => {
        const r = lay0.rects[id];
        return r ? (vertical ? r.y + r.h / 2 : r.x + r.w / 2) : 0;
      };
      const kids = target.children.filter((c) => isGuiObject(doc0.nodes[c]?.className) && !ids.includes(c));
      const order = [...kids].sort((a, b) => (doc0.nodes[a].props.LayoutOrder ?? 0) - (doc0.nodes[b].props.LayoutOrder ?? 0));
      for (const id of [...ids].sort((a, b) => centre(a) - centre(b))) {
        let at = order.findIndex((k) => centre(id) < centre(k));
        if (at < 0) at = order.length;
        order.splice(at, 0, id);
      }
      S().update((d) => order.forEach((id, i) => void (d.nodes[id].props.LayoutOrder = i + 1)));
    }
    moveNodes(ids, into, target.children.length);
    if (dropRects) {
      // put them where they were dropped (unless the new parent stacks its children)
      const lay = layoutNow();
      placeNodes(ids.filter((id) => dropRects[id] && !lay.laidOut.has(id)).map((id) => ({ id, rect: dropRects[id] })), lay);
    }
    if (list) {
      makeRoomInList(into, ids);
      matchCrossAlignment(into, ids, lay0);
    }
  });
}

// ---------------------------------------------------------------------------
// Stacks (UIListLayout / UIGridLayout): their children are moved by reordering

export function stackLayout(parentId: string | null | undefined): GuiNode | undefined {
  const { doc } = S();
  if (!parentId || !doc.nodes[parentId]) return undefined;
  return doc.nodes[parentId].children.map((c) => doc.nodes[c]).find((c) => c?.className === 'UIListLayout' || c?.className === 'UIGridLayout');
}

/** Children of a stacking frame in the order they're shown */
export function stackOrder(parentId: string): string[] {
  const { doc } = S();
  const kids = doc.nodes[parentId].children.filter((c) => isGuiObject(doc.nodes[c]?.className) && doc.nodes[c].props.Visible !== false);
  const index = new Map(kids.map((k, i) => [k, i]));
  const byName = stackLayout(parentId)?.props.SortOrder === 'Name';
  return [...kids].sort((a, b) =>
    byName
      ? doc.nodes[a].name.localeCompare(doc.nodes[b].name) || index.get(a)! - index.get(b)!
      : (doc.nodes[a].props.LayoutOrder ?? 0) - (doc.nodes[b].props.LayoutOrder ?? 0) || index.get(a)! - index.get(b)!,
  );
}

/** Put elements at `index` among their stack siblings (index counts the other siblings) */
export function reorderInStack(ids: string[], index: number) {
  const { doc } = S();
  const parentId = doc.nodes[ids[0]]?.parentId;
  const layout = stackLayout(parentId);
  if (!parentId || !layout) return;
  const order = stackOrder(parentId).filter((id) => !ids.includes(id));
  const moving = stackOrder(parentId).filter((id) => ids.includes(id));
  order.splice(Math.max(0, Math.min(index, order.length)), 0, ...moving);
  S().update((d) => {
    order.forEach((id, i) => void (d.nodes[id].props.LayoutOrder = i + 1));
    // a Name-sorted stack ignores LayoutOrder
    if (d.nodes[layout.id].props.SortOrder !== 'LayoutOrder') d.nodes[layout.id].props.SortOrder = 'LayoutOrder';
  });
}

/** The slot (index among the stack's other children) that a canvas point falls into */
export function stackDropIndex(parentId: string, pt: { x: number; y: number }, lay: LayoutResult = layoutNow(), exclude: string[] = []): number {
  const stack = stackLayout(parentId);
  if (!stack) return 0;
  const siblings = stackOrder(parentId).filter((id) => !exclude.includes(id) && lay.rects[id]);
  const vertical = stack.className === 'UIListLayout' ? stack.props.FillDirection !== 'Horizontal' : stack.props.FillDirection === 'Vertical';
  const pos = (r: Rect) => (vertical ? r.y + r.h / 2 : r.x + r.w / 2);
  const p = vertical ? pt.y : pt.x;
  if (stack.className === 'UIGridLayout') {
    // nearest cell, before or after it along the fill direction
    let best = -1;
    let bestD = Infinity;
    siblings.forEach((id, i) => {
      const r = lay.rects[id];
      const d = Math.hypot(r.x + r.w / 2 - pt.x, r.y + r.h / 2 - pt.y);
      if (d < bestD) [best, bestD] = [i, d];
    });
    return best < 0 ? 0 : best + (p > pos(lay.rects[siblings[best]]) ? 1 : 0);
  }
  return siblings.filter((id) => pos(lay.rects[id]) < p).length;
}

/** Move stacked elements one place earlier (-1) or later (+1) */
export function stepInStack(ids: string[], delta: number) {
  const { doc } = S();
  const parentId = doc.nodes[ids[0]]?.parentId;
  if (!parentId || !stackLayout(parentId)) return;
  const all = stackOrder(parentId);
  const first = Math.min(...ids.map((id) => all.indexOf(id)).filter((i) => i >= 0));
  reorderInStack(ids, first + delta);
}

/**
 * A UIListLayout aligns every item the same way across the stack. If the other items span the full
 * width (vertical list) they don't care, so set the alignment to where the moved element was sitting.
 */
function matchCrossAlignment(into: string, moved: string[], before: LayoutResult) {
  const lay = layoutNow();
  const doc = S().doc;
  const list = doc.nodes[into].children.map((c) => doc.nodes[c]).find((c) => c?.className === 'UIListLayout');
  const content = lay.content[into];
  if (!list || !content) return;
  const vertical = list.props.FillDirection !== 'Horizontal';
  const others = doc.nodes[into].children.filter((c) => isGuiObject(doc.nodes[c]?.className) && !moved.includes(c) && lay.rects[c]);
  const crossLen = vertical ? content.w : content.h;
  if (!others.every((c) => Math.abs((vertical ? lay.rects[c].w : lay.rects[c].h) - crossLen) < 1.5)) return;
  const r = before.rects[moved[0]];
  if (!r) return;
  const startGap = vertical ? r.x - content.x : r.y - content.y;
  const endGap = vertical ? content.x + content.w - r.x - r.w : content.y + content.h - r.y - r.h;
  const align = Math.abs(startGap - endGap) < 4 ? 'Center' : startGap < endGap ? (vertical ? 'Left' : 'Top') : vertical ? 'Right' : 'Bottom';
  const prop = vertical ? 'HorizontalAlignment' : 'VerticalAlignment';
  if (list.props[prop] !== align) S().update((d) => void (d.nodes[list.id].props[prop] = align));
}

function makeRoomInList(into: string, moved: string[]) {
  const lay = layoutNow();
  const doc = S().doc;
  const list = doc.nodes[into].children.map((c) => doc.nodes[c]).find((c) => c?.className === 'UIListLayout');
  const content = lay.content[into];
  if (!list || !content) return;
  const vertical = list.props.FillDirection !== 'Horizontal';
  const len = vertical ? content.h : content.w;
  const kids = doc.nodes[into].children.filter((c) => isGuiObject(doc.nodes[c]?.className) && doc.nodes[c].props.Visible !== false && lay.rects[c]);
  const main = (id: string) => (vertical ? lay.rects[id].h : lay.rects[id].w);
  const pad = list.props.Padding.s * len + list.props.Padding.o;
  const overflow = kids.reduce((t, k) => t + main(k), 0) + pad * Math.max(0, kids.length - 1) - len;
  if (overflow <= 0.5) return;
  const victim = kids.filter((k) => !moved.includes(k)).sort((a, b) => main(b) - main(a)).find((k) => main(k) - overflow >= 12);
  if (!victim) return;
  const axis = vertical ? 'y' : 'x';
  S().update((d) => {
    const u = d.nodes[victim].props.Size[axis];
    d.nodes[victim].props.Size[axis] = u.s !== 0 ? { s: +(u.s - overflow / len).toFixed(4), o: u.o } : { s: 0, o: Math.round(u.o - overflow) };
  });
  S().showToast(`Made room in ${doc.nodes[into].name}: ${doc.nodes[victim].name} is now ${Math.round(overflow)}px ${vertical ? 'shorter' : 'narrower'}`);
}

/** Put elements inside the frames they sit on (keeps them where they are on screen) */
export function moveInside(issues: OverlapIssue[]) {
  if (!issues.length) return;
  batch(() => {
    for (const { id, into } of issues) if (S().doc.nodes[id] && S().doc.nodes[into]) moveIntoFrame([id], into);
  });
  const { doc } = S();
  if (!S().toast || Date.now() - S().toast!.id > 500) S().showToast(`Moved inside: ${issues.map((i) => `${doc.nodes[i.id]?.name} → ${doc.nodes[i.into]?.name}`).join(', ')}`);
  S().select(issues.map((i) => i.id).filter((id) => S().doc.nodes[id]));
}

// ---------------------------------------------------------------------------
// Custom prefabs

/** Copy of the selected elements as a prefab: top-level elements get pixel sizes/positions relative to their combined box */
export function prefabFromSelection(): { fragment: Fragment; size: { w: number; h: number }; name: string } | null {
  const { doc, selection } = S();
  const ids = topLevelOnly(doc.nodes, selection).filter((id) => isGuiObject(doc.nodes[id]?.className));
  if (!ids.length) return null;
  // measure at the design resolution so prefabs keep their designed size
  const design = designSize(doc);
  const lay = computeLayout(doc.nodes, doc.rootIds, { name: 'design', w: design.w, h: design.h });
  const rects = ids.map((id) => lay.rects[id]).filter(Boolean);
  if (!rects.length) return null;
  const box = unionRect(rects);
  const fragment = extractFragment(doc.nodes, ids);
  const inside = new Set(fragment.nodes.map((n) => n.id));
  for (const id of ids) {
    const n = fragment.nodes.find((x) => x.id === id)!;
    const r = lay.rects[id];
    const a = n.props.AnchorPoint ?? { x: 0, y: 0 };
    n.parentId = null;
    n.props.Size = { x: { s: 0, o: Math.round(r.w) }, y: { s: 0, o: Math.round(r.h) } };
    n.props.Position = { x: { s: 0, o: Math.round(r.x - box.x + a.x * r.w) }, y: { s: 0, o: Math.round(r.y - box.y + a.y * r.h) } };
  }
  // links to elements outside the prefab can't come along
  for (const n of fragment.nodes) if (n.toast?.triggerNodeId && !inside.has(n.toast.triggerNodeId)) n.toast = { ...n.toast, triggerNodeId: undefined };
  const name = ids.length === 1 ? doc.nodes[ids[0]].name : `${doc.nodes[ids[0]].name} +${ids.length - 1}`;
  return { fragment, size: { w: Math.round(box.w), h: Math.round(box.h) }, name };
}

export function savePrefabFromSelection(name?: string) {
  const p = prefabFromSelection();
  if (!p) return S().showToast('Select one or more elements to save as a prefab');
  const saved = addPrefab((name ?? p.name).trim() || p.name, p.fragment, p.size);
  S().showToast(saved ? `Saved prefab "${saved.name}" — find it in Insert → My prefabs` : 'Could not save: browser storage is full (large preview images?)');
  if (saved) useStore.setState({ leftTab: 'insert' });
}

export function updatePrefabFromSelection(id: string) {
  const p = prefabFromSelection();
  if (!p) return S().showToast('Select the elements to save into this prefab');
  S().showToast(updatePrefab(id, { fragment: p.fragment, size: p.size }) ? 'Prefab updated' : 'Could not save: browser storage is full');
}

/** Insert a prefab (centred in the target, or centred on a canvas point) */
export function insertPrefab(prefab: Prefab, opts: { parentId?: string; at?: { x: number; y: number } } = {}) {
  return insertFragmentAtPoint(structuredClone(prefab.fragment), opts);
}

/** Insert a built-in component (from the Insert panel) — inside the selected element, or centred on a drop point */
export function insertComponent(preset: { build: () => Fragment }, opts: { parentId?: string; at?: { x: number; y: number } } = {}) {
  return insertFragmentAtPoint(preset.build(), opts);
}

/** Insert a fragment centred in its parent, or centred on a canvas point when dropped there */
export function insertFragmentAtPoint(fragment: Fragment, opts: { parentId?: string; at?: { x: number; y: number } } = {}) {
  return batch(() => {
    const parentId = opts.parentId ?? insertionParent({ into: true });
    const roots = insertFragmentAt(fragment, parentId, !opts.at);
    if (opts.at) {
      const lay = layoutNow();
      const rects = roots.map((r) => lay.rects[r]).filter(Boolean);
      if (rects.length) {
        const u = unionRect(rects);
        const dx = opts.at.x - (u.x + u.w / 2);
        const dy = opts.at.y - (u.y + u.h / 2);
        placeNodes(roots.filter((r) => lay.rects[r] && !lay.laidOut.has(r)).map((r) => ({ id: r, rect: { ...lay.rects[r], x: lay.rects[r].x + dx, y: lay.rects[r].y + dy } })), lay);
      }
    } else if (roots.length > 1) {
      // several elements: centre the group in the parent
      const lay = layoutNow();
      const c = lay.content[parentId];
      const rects = roots.map((r) => lay.rects[r]).filter(Boolean);
      if (c && rects.length) {
        const u = unionRect(rects);
        const dx = c.x + (c.w - u.w) / 2 - u.x;
        const dy = c.y + (c.h - u.h) / 2 - u.y;
        placeNodes(roots.filter((r) => !lay.laidOut.has(r)).map((r) => ({ id: r, rect: { ...lay.rects[r], x: lay.rects[r].x + dx, y: lay.rects[r].y + dy } })), lay);
      }
    }
    S().select(roots);
    return roots;
  });
}
