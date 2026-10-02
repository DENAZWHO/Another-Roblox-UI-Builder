// Events: "when this element is clicked / hovered / … do these actions". Shared by the editor,
// Preview (model/runtime.ts) and the exported Luau (export/behavior.ts).
import { ANIMATABLE_PROPS, hasProp, isGuiObject } from './schema';
import type { Doc, EventAction, EventActionKind, EventTrigger, GuiNode } from './types';
import { pathTo } from './doc';

export const EVENT_TRIGGERS: { value: EventTrigger; label: string }[] = [
  { value: 'click', label: 'When clicked' },
  { value: 'hoverEnter', label: 'When hovered' },
  { value: 'hoverLeave', label: 'When hover ends' },
  { value: 'pressDown', label: 'When pressed' },
  { value: 'pressUp', label: 'When released' },
  { value: 'load', label: 'When the GUI loads' },
];

export const ACTION_KINDS: { value: EventActionKind; label: string; hint: string }[] = [
  { value: 'show', label: 'Show', hint: 'Visible = true' },
  { value: 'hide', label: 'Hide', hint: 'Visible = false' },
  { value: 'toggle', label: 'Toggle', hint: 'Show it if hidden, hide it if shown' },
  { value: 'play', label: 'Play animation', hint: 'Play one of your animation clips' },
  { value: 'tween', label: 'Tween property', hint: 'Animate a property to a value (TweenService)' },
  { value: 'set', label: 'Set property', hint: 'Change a property instantly' },
  { value: 'toast', label: 'Show toast', hint: 'Pop up a toast notification' },
  { value: 'print', label: 'Print', hint: 'print() to the Output window' },
  { value: 'wait', label: 'Wait', hint: 'Pause before the next actions (task.wait)' },
  { value: 'nextPage', label: 'Next page', hint: 'UIPageLayout:Next() on a frame with pages' },
  { value: 'prevPage', label: 'Previous page', hint: 'UIPageLayout:Previous()' },
  { value: 'jumpPage', label: 'Go to page', hint: 'UIPageLayout:JumpToIndex(page)' },
  { value: 'showScreen', label: 'Show screen', hint: "Turn a screen's ScreenGuis on (and the other screens off)" },
];

export const triggerLabel = (t: EventTrigger) => EVENT_TRIGGERS.find((x) => x.value === t)?.label ?? t;
export const actionLabel = (k: EventActionKind) => ACTION_KINDS.find((x) => x.value === k)?.label ?? k;

/** Actions that work on an element */
export const TARGETED: EventActionKind[] = ['show', 'hide', 'toggle', 'tween', 'set', 'nextPage', 'prevPage', 'jumpPage'];
export const PAGE_ACTIONS: EventActionKind[] = ['nextPage', 'prevPage', 'jumpPage'];

/** The UIPageLayout of an element, if it has one */
export const pageLayoutOf = (doc: Doc, id: string | undefined) =>
  id ? doc.nodes[id]?.children.map((c) => doc.nodes[c]).find((c) => c?.className === 'UIPageLayout') : undefined;

/** Properties an action can change on an element of this class (tween: only ones TweenService can animate) */
export function eventProps(className: GuiNode['className'], kind: 'tween' | 'set'): string[] {
  const extra = kind === 'set' ? ['Visible', 'Text', 'Image', 'ZIndex', 'LayoutOrder'] : [];
  return [...ANIMATABLE_PROPS, ...extra].filter((p) => hasProp(className, p));
}

/** The element an action works on (its own element when no target is set) */
export const actionTarget = (owner: GuiNode, a: EventAction, doc: Doc): GuiNode | undefined =>
  a.target ? doc.nodes[a.target] : owner;

/** A sensible new action of this kind */
export function defaultAction(kind: EventActionKind, owner: GuiNode, doc: Doc, id: string): EventAction {
  const a: EventAction = { id, kind };
  if (kind === 'tween' || kind === 'set') {
    a.prop = kind === 'tween' ? (hasProp(owner.className, 'BackgroundTransparency') ? 'BackgroundTransparency' : 'Position') : 'Visible';
    a.value = owner.props[a.prop];
    if (kind === 'tween') Object.assign(a, { duration: 0.3, style: 'Quad', direction: 'Out' });
  }
  if (kind === 'play') a.clipId = doc.clips.find((c) => c.tweens.length)?.id;
  if (kind === 'toast') {
    const t = Object.values(doc.nodes).find((n) => n.toast && n.parentId);
    a.toastId = t?.id;
    a.title = 'Hello!';
    a.message = 'Something happened';
  }
  if (kind === 'print') a.text = `${owner.name} clicked`;
  if (kind === 'wait') a.seconds = 0.5;
  if (kind === 'showScreen') a.screenId = (doc.screens ?? []).find((s) => s.id !== (doc.nodes[pathTo(doc.nodes, owner.id)[0]]?.screen ?? doc.screens?.[0]?.id))?.id ?? doc.screens?.[0]?.id;
  if (PAGE_ACTIONS.includes(kind)) {
    // the frame with pages: this element if it has them, else the first one in the document
    if (!pageLayoutOf(doc, owner.id)) a.target = Object.values(doc.nodes).find((n) => pageLayoutOf(doc, n.id))?.id;
    if (kind === 'jumpPage') a.page = 0;
  }
  return a;
}

/** Elements with events of a given trigger (for wiring pointer events) */
export const hasEvent = (n: GuiNode, on?: EventTrigger) => !!n.events?.some((h) => h.actions.length && (!on || h.on === on));

/** Elements an action can target: every GUI object, as an indented list */
export function targetOptions(doc: Doc): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  const walk = (id: string, depth: number) => {
    const n = doc.nodes[id];
    if (!n) return;
    if (isGuiObject(n.className)) out.push({ id, label: '  '.repeat(depth) + n.name });
    n.children.forEach((c) => walk(c, depth + (isGuiObject(n.className) ? 1 : 0)));
  };
  doc.rootIds.forEach((r) => walk(r, 0));
  return out;
}
