// Play-mode simulation used by Preview. Mirrors the Luau generated in export/behavior.ts:
// clips are TweenService calls fired by triggers, effects run every frame.
import { applyOverrides, clipLength, ease, lerpValue, type Overrides } from './animation';
import type { LayoutResult } from './layout';
import { pathTo } from './doc';
import type { AnimClip, Doc, EventAction, EventTrigger, GuiNode, ToastEnter, TriggerKind, Tween, UDim2, Vec2 } from './types';
import { hasEvent } from './events';
import { isGuiObject } from './schema';
import { gameStartDoc, screenOfRoot } from './screens';

export type UIEvent = 'click' | 'enter' | 'leave' | 'down' | 'up' | 'wheelUp' | 'wheelDown';
const EVENT_TRIGGER: Partial<Record<UIEvent, TriggerKind>> = { click: 'click', enter: 'hoverEnter', leave: 'hoverLeave', down: 'pressDown', up: 'pressUp' };

/** Where a clip starts from when its `from` setting is unset */
export const defaultFrom = (clip: AnimClip): 'design' | 'current' =>
  clip.trigger === 'hoverEnter' || clip.trigger === 'hoverLeave' || clip.trigger === 'pressDown' || clip.trigger === 'pressUp' ? 'current' : 'design';

export const clipTrigger = (clip: AnimClip): TriggerKind => clip.trigger ?? 'load';

interface Active { nodeId: string; prop: string; from: any; tween: Tween; at: number }
interface ToastInst { id: string; templateId: string; born: number; leaving: boolean }
interface ScaleAnim { from: number; to: number; at: number; dur: number }

/** Where a toast starts (and leaves to), as a direction in pixels-per-size; shared with the Luau output */
export const TOAST_SLIDE: Partial<Record<ToastEnter, [number, number]>> = { slideRight: [1, 0], slideLeft: [-1, 0], slideDown: [0, -1], slideUp: [0, 1] };
export const TOAST_GAP = 8;
interface FxState { hovered: boolean; pressed: boolean; scale: number; glow: number; look?: number; tilt: number; follow: Vec2; off: Vec2 }

/** Constant used by mouse-follow falloff and tilt, shared with the Luau output */
export const MOUSE_RANGE = 300;

const CLICK_BUTTONS = ['TextButton', 'ImageButton'];

/** Buttons that get a MouseButton1Click print (not ones inside toast templates, which are cloned at runtime) */
export function clickButtons(doc: Doc, nodes: GuiNode[] = Object.values(doc.nodes)): GuiNode[] {
  if (doc.clickPrints === false) return [];
  const inToast = (id: string) => pathTo(doc.nodes, id).some((a) => doc.nodes[a]?.toast);
  return nodes.filter((n) => CLICK_BUTTONS.includes(n.className) && !inToast(n.id) && !hasEvent(n, 'click'));
}

/** "Play clicked", or "Card/Buy clicked" when several buttons share a name */
export function clickMessage(doc: Doc, n: GuiNode): string {
  const twins = Object.values(doc.nodes).filter((m) => m.name === n.name && CLICK_BUTTONS.includes(m.className)).length > 1;
  const parent = n.parentId ? doc.nodes[n.parentId] : null;
  return `${twins && parent ? parent.name + '/' : ''}${n.name} clicked`;
}

export class UIRuntime {
  time = 0;
  mouse: Vec2 | null = null;
  /** UIScale values from effects (rendered as a scale about the AnchorPoint) */
  scales: Record<string, number> = {};
  /** Hover glow strength (0–1) per element */
  glows: Record<string, number> = {};
  private values: Overrides = {};
  private fxValues: Overrides = {};
  private active = new Map<string, Active>();
  private scheduled: { at: number; clipId: string; tween: Tween }[] = [];
  private loops = new Map<string, number>();
  private fx: Record<string, FxState> = {};
  private doc: Doc;
  /** cloned toast subtrees (not in the document) */
  private extra: Record<string, GuiNode> = {};
  private toasts: ToastInst[] = [];
  private toastSeq = 0;
  private toastScale: Record<string, ScaleAnim> = {};
  private lastLayout: LayoutResult | null = null;
  /** an element being dragged by its UIDragDetector */
  private drag: { id: string; det: GuiNode; mouse: Vec2; pos: UDim2; rot: number; angle?: number; turned: number } | null = null;
  private timers: { at: number; run: () => void }[] = [];

  constructor(doc: Doc) {
    this.doc = doc;
  }

  start() {
    // toast templates are hidden in game until shown
    for (const n of Object.values(this.doc.nodes)) if (n.toast) (this.values[n.id] ??= {}).Visible = false;
    // screens that aren't visible at the start
    const start = gameStartDoc(this.doc);
    for (const r of this.doc.rootIds) if (start.nodes[r] !== this.doc.nodes[r]) (this.values[r] ??= {}).Enabled = false;
    for (const c of this.doc.clips) if (clipTrigger(c) === 'load') this.play(c.id);
    for (const n of Object.values(this.doc.nodes)) this.fire(n.id, 'load');
  }

  /** Run an element's event handlers for a trigger */
  private fire(nodeId: string, on: EventTrigger) {
    const n = this.doc.nodes[nodeId];
    for (const h of n?.events ?? []) if (h.on === on) this.runActions(nodeId, h.actions, 0);
  }

  /** Actions in order; Wait schedules the rest */
  private runActions(ownerId: string, actions: EventAction[], from: number) {
    for (let i = from; i < actions.length; i++) {
      const a = actions[i];
      if (a.kind === 'wait') {
        this.after(Math.max(0, a.seconds ?? 0), () => this.runActions(ownerId, actions, i + 1));
        return;
      }
      this.runAction(ownerId, a);
    }
  }

  private runAction(ownerId: string, a: EventAction) {
    const target = a.target ?? ownerId;
    const set = (prop: string, v: any) => {
      (this.values[target] ??= {})[prop] = v;
      this.active.delete(target + '.' + prop);
    };
    switch (a.kind) {
      case 'show': return set('Visible', true);
      case 'hide': return set('Visible', false);
      case 'toggle': return set('Visible', this.current(target, 'Visible') === false);
      case 'play': return a.clipId && this.play(a.clipId);
      case 'set': return a.prop && set(a.prop, a.value);
      case 'tween': return a.prop && this.tweenNow(target, a.prop, a.value, a.duration ?? 0.3, a.style ?? 'Quad', a.direction ?? 'Out');
      case 'toast': return a.toastId && this.showToast(a.toastId, a.title, a.message);
      case 'print': return this.log(a.text ?? '');
      case 'nextPage': return this.turnPage(target, 1);
      case 'prevPage': return this.turnPage(target, -1);
      case 'jumpPage': return this.turnPage(target, 0, a.page ?? 0);
      case 'showScreen': return a.screenId && this.showScreen(a.screenId, !a.keepOthers);
    }
  }

  /** Turn a screen's ScreenGuis on (and the other screens' off) */
  showScreen(screenId: string, hideOthers = true) {
    for (const r of this.doc.rootIds) {
      if (this.doc.nodes[r]?.className !== 'ScreenGui') continue;
      const mine = screenOfRoot(this.doc, r).id === screenId;
      if (mine) (this.values[r] ??= {}).Enabled = this.doc.nodes[r].props.Enabled !== false;
      else if (hideOthers) (this.values[r] ??= {}).Enabled = false;
    }
  }

  /** UIPageLayout: Next (+1) / Previous (-1) / JumpToIndex, animated with its TweenTime and easing */
  private turnPage(frameId: string, step: number, to?: number) {
    const frame = this.doc.nodes[frameId];
    const layout = frame?.children.map((c) => this.doc.nodes[c]).find((c) => c?.className === 'UIPageLayout');
    if (!layout) return;
    const count = frame.children.filter((c) => this.doc.nodes[c] && isGuiObject(this.doc.nodes[c].className) && this.current(c, 'Visible') !== false).length;
    if (!count) return;
    const target = this.pageTarget[layout.id] ?? layout.page ?? 0;
    let next = to ?? target + step;
    if (layout.props.Circular) next = ((next % count) + count) % count;
    next = Math.max(0, Math.min(count - 1, next));
    this.pageTarget[layout.id] = next;
    if (this.current(layout.id, '__page') === undefined) (this.values[layout.id] ??= {}).__page = layout.page ?? 0;
    if (layout.props.Animated === false) (this.values[layout.id] ??= {}).__page = next;
    else this.tweenNow(layout.id, '__page', next, layout.props.TweenTime ?? 1, layout.props.EasingStyle ?? 'Back', layout.props.EasingDirection ?? 'Out');
  }
  private pageTarget: Record<string, number> = {};

  private log(text: string) {
    this.output = [...this.output.slice(-49), { text, time: Date.now() }];
  }

  private node(id: string): GuiNode | undefined {
    return this.doc.nodes[id] ?? this.extra[id];
  }

  private current(nodeId: string, prop: string) {
    return this.values[nodeId]?.[prop] ?? this.node(nodeId)?.props[prop];
  }

  /** Start a tween right now from the current value (TweenService:Create(...):Play()) */
  private tweenNow(nodeId: string, prop: string, to: any, duration: number, style: Tween['style'], direction: Tween['direction']) {
    const tween: Tween = { id: '', nodeId, prop, to, start: 0, duration, style, direction };
    this.active.set(nodeId + '.' + prop, { nodeId, prop, from: this.current(nodeId, prop), tween, at: this.time });
  }

  private after(seconds: number, run: () => void) {
    this.timers.push({ at: this.time + seconds, run });
  }

  /** Toast templates in the document */
  toastTemplates(): GuiNode[] {
    return Object.values(this.doc.nodes).filter((n) => n.toast && n.parentId);
  }

  /** Clone a toast template, fill in Title/Message, animate it in, stack older toasts, then animate out */
  showToast(templateId: string, title?: string, message?: string, seconds?: number) {
    const tpl = this.doc.nodes[templateId];
    if (!tpl?.toast || !tpl.parentId) return;
    const cfg = tpl.toast;
    const suffix = '~t' + ++this.toastSeq;
    const cloneIds: string[] = [];
    const cloneTree = (id: string, parentId: string): string => {
      const src = this.doc.nodes[id];
      const cid = id + suffix;
      this.extra[cid] = { ...src, id: cid, parentId, toast: undefined, children: src.children.filter((c) => this.doc.nodes[c]).map((c) => cloneTree(c, cid)) };
      cloneIds.push(cid);
      return cid;
    };
    const root = cloneTree(templateId, tpl.parentId);
    const ov = (this.values[root] ??= {});
    ov.Visible = true;
    for (const cid of cloneIds) {
      const n = this.extra[cid];
      if (n.name === 'Title' && title !== undefined && 'Text' in n.props) (this.values[cid] ??= {}).Text = title;
      if (n.name === 'Message' && message !== undefined && 'Text' in n.props) (this.values[cid] ??= {}).Text = message;
    }
    const r = this.lastLayout?.rects[templateId];
    const w = r?.w ?? 300;
    const h = r?.h ?? 80;
    const basePos: UDim2 = tpl.props.Position;
    const shifted = (dx: number, dy: number): UDim2 => ({ x: { s: basePos.x.s, o: basePos.x.o + dx }, y: { s: basePos.y.s, o: basePos.y.o + dy } });
    const dir = TOAST_SLIDE[cfg.enter];
    const away = dir ? shifted(dir[0] * (w + 40), dir[1] * (h + 40)) : basePos;
    ov.Position = away;
    if (tpl.className === 'CanvasGroup' && (cfg.enter === 'fade' || cfg.enter === 'pop' || dir)) ov.GroupTransparency = 1;
    if (cfg.enter === 'pop') this.toastScale[root] = { from: 0.6, to: 1, at: this.time, dur: 0.35 };
    this.tweenNow(root, 'Position', basePos, 0.35, 'Back', 'Out');
    if (tpl.className === 'CanvasGroup') this.tweenNow(root, 'GroupTransparency', tpl.props.GroupTransparency ?? 0, 0.25, 'Quad', 'Out');
    this.toasts.push({ id: root, templateId, born: this.time, leaving: false });
    this.restack(templateId, root);
    this.after(seconds ?? cfg.duration, () => {
      const t = this.toasts.find((x) => x.id === root);
      if (!t) return;
      t.leaving = true;
      const cur = this.current(root, 'Position') as UDim2;
      if (dir) this.tweenNow(root, 'Position', { x: { s: cur.x.s, o: cur.x.o + dir[0] * (w + 40) }, y: { s: cur.y.s, o: cur.y.o + dir[1] * (h + 40) } }, 0.25, 'Quad', 'In');
      if (tpl.className === 'CanvasGroup') this.tweenNow(root, 'GroupTransparency', 1, 0.25, 'Quad', 'In');
      if (cfg.enter === 'pop') this.toastScale[root] = { from: 1, to: 0.6, at: this.time, dur: 0.25 };
      this.after(0.26, () => {
        this.toasts = this.toasts.filter((x) => x.id !== root);
        for (const cid of cloneIds) {
          delete this.extra[cid];
          delete this.values[cid];
          this.active.delete(cid + '.Position');
          this.active.delete(cid + '.GroupTransparency');
        }
        delete this.toastScale[root];
        this.restack(templateId);
      });
    });
  }

  /** Newest toast sits at the template's position; older ones move away from the anchor edge */
  private restack(templateId: string, skip?: string) {
    const tpl = this.doc.nodes[templateId];
    const basePos: UDim2 = tpl.props.Position;
    const fromBottom = (tpl.props.AnchorPoint?.y ?? 0) >= 0.5;
    const h = this.lastLayout?.rects[templateId]?.h ?? 80;
    let offset = 0;
    const list = this.toasts.filter((t) => t.templateId === templateId);
    for (let i = list.length - 1; i >= 0; i--) {
      const t = list[i];
      if (t.id !== skip && !t.leaving) {
        const y = fromBottom ? -offset : offset;
        this.tweenNow(t.id, 'Position', { x: basePos.x, y: { s: basePos.y.s, o: basePos.y.o + y } }, 0.25, 'Quad', 'Out');
      }
      offset += h + TOAST_GAP;
    }
  }

  play(clipId: string) {
    const clip = this.doc.clips.find((c) => c.id === clipId);
    if (!clip || !clip.tweens.length) return;
    this.scheduled = this.scheduled.filter((s) => s.clipId !== clipId);
    if ((clip.from ?? defaultFrom(clip)) === 'design') {
      for (const tw of clip.tweens) {
        const n = this.doc.nodes[tw.nodeId];
        if (!n) continue;
        (this.values[tw.nodeId] ??= {})[tw.prop] = n.props[tw.prop];
        this.active.delete(tw.nodeId + '.' + tw.prop);
      }
    }
    for (const tween of clip.tweens) this.scheduled.push({ at: this.time + tween.start, clipId, tween });
    if (clip.loop) this.loops.set(clipId, this.time + Math.max(0.05, clipLength(clip) + (clip.loopDelay ?? 0)));
    else this.loops.delete(clipId);
  }

  /** What the generated scripts would print (button clicks), newest last */
  output: { text: string; time: number }[] = [];

  /** Nodes whose pointer events matter (triggers, hover/press effects and button clicks) */
  interactiveIds(): Set<string> {
    const out = new Set<string>();
    for (const n of clickButtons(this.doc)) out.add(n.id);
    for (const c of this.doc.clips) if (c.triggerNodeId && clipTrigger(c) !== 'load' && clipTrigger(c) !== 'manual') out.add(c.triggerNodeId);
    for (const n of Object.values(this.doc.nodes)) if (n.effects?.some((e) => e.kind === 'hoverScale' || e.kind === 'pressScale' || e.kind === 'hoverGlow')) out.add(n.id);
    for (const n of Object.values(this.doc.nodes)) if (n.toast?.triggerNodeId) out.add(n.toast.triggerNodeId);
    for (const n of Object.values(this.doc.nodes)) if (n.events?.some((h) => h.on !== 'load' && h.actions.length)) out.add(n.id);
    for (const n of Object.values(this.doc.nodes)) if (this.detector(n.id)) out.add(n.id);
    for (const n of Object.values(this.doc.nodes)) if (n.className === 'UIPageLayout' && n.parentId) out.add(n.parentId);
    return out;
  }

  /** The element's enabled UIDragDetector, if it has one */
  private detector(id: string): GuiNode | undefined {
    const n = this.doc.nodes[id];
    return n?.children.map((c) => this.doc.nodes[c]).find((c) => c?.className === 'UIDragDetector' && c.props.Enabled !== false && c.props.DragStyle !== 'Scriptable');
  }

  /** Mouse button released anywhere: stop dragging */
  release() {
    this.drag = null;
  }

  /** Move / turn the dragged element to follow the mouse (UIDragDetector semantics) */
  private updateDrag() {
    const d = this.drag;
    const lay = this.lastLayout;
    if (!d || !this.mouse || !lay) return;
    const n = this.doc.nodes[d.id];
    const r = lay.rects[d.id];
    const parent = lay.content[n.parentId!] ?? lay.rects[n.parentId!];
    if (!r || !parent) return;
    const p = d.det.props;
    if (p.DragStyle === 'Rotate') {
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      // add up small steps so turning past the left side doesn't jump by 360
      const a = (Math.atan2(this.mouse.y - cy, this.mouse.x - cx) * 180) / Math.PI;
      const last = d.angle ?? (Math.atan2(d.mouse.y - cy, d.mouse.x - cx) * 180) / Math.PI;
      d.turned += ((((a - last) % 360) + 540) % 360) - 180;
      d.angle = a;
      let deg = d.turned;
      if (p.MaxDragAngle > p.MinDragAngle) deg = Math.min(p.MaxDragAngle, Math.max(p.MinDragAngle, deg));
      (this.values[d.id] ??= {}).Rotation = d.rot + deg;
      return;
    }
    let dx = this.mouse.x - d.mouse.x;
    let dy = this.mouse.y - d.mouse.y;
    if (p.DragStyle === 'TranslateLine') {
      const ax: Vec2 = p.DragAxis ?? { x: 1, y: 0 };
      const len = Math.hypot(ax.x, ax.y) || 1;
      const t = (dx * ax.x + dy * ax.y) / len;
      dx = (ax.x / len) * t;
      dy = (ax.y / len) * t;
    }
    // Min/MaxDragTranslation limit how far it can go from where the drag started (when Max > Min)
    const mn: UDim2 = p.MinDragTranslation;
    const mx: UDim2 = p.MaxDragTranslation;
    const lim = (v: number, a: number, b: number) => (b > a ? Math.min(b, Math.max(a, v)) : v);
    dx = lim(dx, mn.x.s * parent.w + mn.x.o, mx.x.s * parent.w + mx.x.o);
    dy = lim(dy, mn.y.s * parent.h + mn.y.o, mx.y.s * parent.h + mx.y.o);
    // BoundingUI: keep the element (or just the grab point) inside another element
    const bound = d.det.boundingUI ? lay.rects[d.det.boundingUI] : undefined;
    if (bound) {
      const start = { x: r.x - this.offsetFromStart(d, parent).x, y: r.y - this.offsetFromStart(d, parent).y };
      if (p.BoundingBehavior === 'HitPoint') {
        dx = Math.min(bound.x + bound.w, Math.max(bound.x, d.mouse.x + dx)) - d.mouse.x;
        dy = Math.min(bound.y + bound.h, Math.max(bound.y, d.mouse.y + dy)) - d.mouse.y;
      } else {
        dx = Math.min(bound.x + bound.w - r.w, Math.max(bound.x, start.x + dx)) - start.x;
        dy = Math.min(bound.y + bound.h - r.h, Math.max(bound.y, start.y + dy)) - start.y;
      }
    }
    const scale = p.ResponseStyle === 'Scale' || p.ResponseStyle === 'CustomScale';
    (this.values[d.id] ??= {}).Position = scale
      ? { x: { s: d.pos.x.s + dx / parent.w, o: d.pos.x.o }, y: { s: d.pos.y.s + dy / parent.h, o: d.pos.y.o } }
      : { x: { s: d.pos.x.s, o: d.pos.x.o + dx }, y: { s: d.pos.y.s, o: d.pos.y.o + dy } };
  }

  /** How far (in pixels) the dragged element has already moved from where the drag started */
  private offsetFromStart(d: NonNullable<UIRuntime['drag']>, parent: { w: number; h: number }): Vec2 {
    const cur = this.current(d.id, 'Position') as UDim2;
    return { x: (cur.x.s - d.pos.x.s) * parent.w + cur.x.o - d.pos.x.o, y: (cur.y.s - d.pos.y.s) * parent.h + cur.y.o - d.pos.y.o };
  }

  event(nodeId: string, ev: UIEvent) {
    if (ev === 'wheelUp' || ev === 'wheelDown') {
      const layout = this.doc.nodes[nodeId]?.children.map((c) => this.doc.nodes[c]).find((c) => c?.className === 'UIPageLayout');
      if (layout && layout.props.ScrollWheelInputEnabled !== false) this.turnPage(nodeId, ev === 'wheelDown' ? 1 : -1);
      return;
    }
    if (ev === 'down' && this.mouse && !this.drag) {
      const det = this.detector(nodeId);
      if (det) this.drag = { id: nodeId, det, mouse: { ...this.mouse }, pos: structuredClone(this.current(nodeId, 'Position')), rot: this.current(nodeId, 'Rotation') ?? 0, turned: 0 };
    }
    if (ev === 'up') this.release();
    const st = this.fx[nodeId];
    if (st) {
      if (ev === 'enter') st.hovered = true;
      if (ev === 'leave') st.hovered = st.pressed = false;
      if (ev === 'down') st.pressed = true;
      if (ev === 'up') st.pressed = false;
    }
    const trig = EVENT_TRIGGER[ev];
    for (const c of this.doc.clips) if (clipTrigger(c) === trig && c.triggerNodeId === nodeId) this.play(c.id);
    if (ev === 'click') for (const n of Object.values(this.doc.nodes)) if (n.toast?.triggerNodeId === nodeId) this.showToast(n.id);
    if (ev === 'click' && clickButtons(this.doc).some((n) => n.id === nodeId)) this.log(clickMessage(this.doc, this.doc.nodes[nodeId]));
    this.fire(nodeId, trig as EventTrigger);
  }

  tick(dt: number, layout: LayoutResult) {
    this.time += dt;
    this.lastLayout = layout;
    this.updateDrag();
    const dueTimers = this.timers.filter((t) => t.at <= this.time);
    if (dueTimers.length) {
      this.timers = this.timers.filter((t) => t.at > this.time);
      dueTimers.forEach((t) => t.run());
    }
    for (const [id, next] of [...this.loops]) if (this.time >= next) this.play(id);

    const due = this.scheduled.filter((s) => s.at <= this.time).sort((a, b) => a.at - b.at);
    if (due.length) {
      this.scheduled = this.scheduled.filter((s) => s.at > this.time);
      for (const s of due) {
        const key = s.tween.nodeId + '.' + s.tween.prop;
        if (s.tween.duration <= 0) {
          // a jump (e.g. "start transparent" before a fade in): applies before tweens starting at the same moment read it
          (this.values[s.tween.nodeId] ??= {})[s.tween.prop] = s.tween.to;
          this.active.delete(key);
          continue;
        }
        this.active.set(key, { nodeId: s.tween.nodeId, prop: s.tween.prop, from: this.current(s.tween.nodeId, s.tween.prop), tween: s.tween, at: s.at });
      }
    }
    for (const [key, a] of this.active) {
      const p = a.tween.duration <= 0 ? 1 : Math.min(1, (this.time - a.at) / a.tween.duration);
      (this.values[a.nodeId] ??= {})[a.prop] = lerpValue(a.from, a.tween.to, ease(a.tween.style, a.tween.direction, p));
      if (p >= 1) this.active.delete(key);
    }
    this.runEffects(dt, layout);
    for (const [id, a] of Object.entries(this.toastScale)) {
      const p = Math.min(1, (this.time - a.at) / a.dur);
      const v = a.from + (a.to - a.from) * ease('Back', 'Out', p);
      this.scales[id] = (this.scales[id] ?? 1) * v;
    }
  }

  private runEffects(dt: number, layout: LayoutResult) {
    this.fxValues = {};
    this.scales = {};
    this.glows = {};
    const t = this.time;
    for (const n of Object.values(this.doc.nodes)) {
      if (!n.effects?.length) continue;
      const r = layout.rects[n.id];
      if (!r) continue;
      const st = (this.fx[n.id] ??= { hovered: false, pressed: false, scale: 1, glow: 0, tilt: 0, follow: { x: 0, y: 0 }, off: { x: 0, y: 0 } });
      // measure from the un-shifted position (the rect includes last frame's offset)
      const cx = r.x + r.w / 2 - st.off.x;
      const cy = r.y + r.h / 2 - st.off.y;
      const m = this.mouse;
      const baseRot: number = this.current(n.id, 'Rotation') ?? 0;
      let rotation: number | null = null;
      let spin = 0;
      let offX = 0;
      let offY = 0;
      let targetScale = 1;
      let scaleSpeed = 12;
      let pulse = 1;
      for (const e of n.effects) {
        const k = 1 - Math.exp(-Math.max(0.1, e.speed) * dt);
        switch (e.kind) {
          case 'lookAtMouse':
            if (m) {
              const target = (Math.atan2(m.y - cy, m.x - cx) * 180) / Math.PI + e.amount;
              const cur = st.look ?? baseRot;
              const diff = ((((target - cur + 180) % 360) + 360) % 360) - 180;
              st.look = cur + diff * k;
            }
            rotation = st.look ?? baseRot;
            break;
          case 'tiltToMouse': {
            const target = m ? Math.max(-1, Math.min(1, (m.x - cx) / MOUSE_RANGE)) * e.amount * (e.invert ? -1 : 1) : 0;
            st.tilt += (target - st.tilt) * k;
            rotation = (rotation ?? baseRot) + st.tilt;
            break;
          }
          case 'followMouse': {
            let tx = 0;
            let ty = 0;
            if (m) {
              const dx = m.x - cx;
              const dy = m.y - cy;
              const len = Math.hypot(dx, dy);
              if (len > 0.001) {
                const f = (e.amount * Math.min(1, len / MOUSE_RANGE) * (e.invert ? -1 : 1)) / len;
                tx = dx * f;
                ty = dy * f;
              }
            }
            st.follow.x += (tx - st.follow.x) * k;
            st.follow.y += (ty - st.follow.y) * k;
            offX += st.follow.x;
            offY += st.follow.y;
            break;
          }
          case 'float':
            offY += Math.sin((t * Math.PI * 2) / Math.max(0.05, e.speed)) * e.amount;
            break;
          case 'spin':
            spin += e.amount * t;
            break;
          case 'pulse':
            pulse *= 1 + e.amount * Math.sin((t * Math.PI * 2) / Math.max(0.05, e.speed));
            break;
          case 'hoverScale':
            if (st.hovered) targetScale *= e.amount;
            scaleSpeed = 4 / Math.max(0.01, e.speed);
            break;
          case 'pressScale':
            if (st.pressed) targetScale *= e.amount;
            break;
          case 'hoverGlow':
            st.glow += ((st.hovered ? 1 : 0) - st.glow) * (1 - Math.exp((-4 / Math.max(0.01, e.speed)) * dt));
            if (st.glow > 0.002) this.glows[n.id] = st.glow;
            break;
        }
      }
      st.scale += (targetScale - st.scale) * (1 - Math.exp(-scaleSpeed * dt));
      st.off = { x: offX, y: offY };
      const ov: Record<string, any> = {};
      if (rotation !== null || spin) ov.Rotation = (rotation ?? baseRot) + spin;
      if (offX || offY) {
        const base: UDim2 = this.current(n.id, 'Position');
        ov.Position = { x: { s: base.x.s, o: base.x.o + offX }, y: { s: base.y.s, o: base.y.o + offY } };
      }
      if (Object.keys(ov).length) this.fxValues[n.id] = ov;
      const sc = st.scale * pulse;
      if (Math.abs(sc - 1) > 0.0001) this.scales[n.id] = sc;
    }
  }

  nodes(): Record<string, GuiNode> {
    const merged: Overrides = { ...this.values };
    for (const [id, ov] of Object.entries(this.fxValues)) merged[id] = { ...(merged[id] ?? {}), ...ov };
    let all = this.doc.nodes;
    const extraIds = Object.keys(this.extra);
    if (extraIds.length) {
      // insert toast clones right after their template
      all = { ...this.doc.nodes, ...this.extra };
      for (const t of this.toasts) {
        const tpl = this.doc.nodes[t.templateId];
        const parent = all[tpl.parentId!];
        if (!parent || parent.children.includes(t.id)) continue;
        const kids = [...parent.children];
        kids.splice(kids.indexOf(t.templateId) + 1, 0, t.id);
        all[parent.id] = { ...parent, children: kids };
      }
    }
    return applyOverrides(all, merged);
  }
}
