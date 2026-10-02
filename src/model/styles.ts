// Shared styles (like Figma): named colours and text styles that elements link to.
// A linked property follows its style; editing the property directly unlinks it.
// Exports just see the resulting values (Roblox has no styles).
import { produce } from 'immer';
import { hasProp } from './schema';
import type { ColorStyle, Doc, GuiNode, TextStyle } from './types';

/** The text properties a text style sets */
export const TEXT_STYLE_PROPS = ['FontFace', 'TextSize', 'LineHeight'] as const;
/** styleRefs key for a node's text style */
export const TEXT_REF = '__text';

const same = (a: any, b: any): boolean => {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => same(a[k], b[k]));
};

export const colorStyles = (doc: Doc): ColorStyle[] => doc.styles?.colors ?? [];
export const textStyles = (doc: Doc): TextStyle[] => doc.styles?.texts ?? [];

/** The values a text style puts on an element */
export const textStyleProps = (s: TextStyle): Record<string, any> => ({ FontFace: s.font, TextSize: s.size, LineHeight: s.lineHeight ?? 1 });

/** Elements (and properties) using a style */
export function styleUsers(doc: Doc, styleId: string): { id: string; prop: string }[] {
  const out: { id: string; prop: string }[] = [];
  for (const n of Object.values(doc.nodes)) for (const [prop, sid] of Object.entries(n.styleRefs ?? {})) if (sid === styleId) out.push({ id: n.id, prop });
  return out;
}

/**
 * Runs after every document edit (same undo step):
 * - a property edited directly (while its style didn't change) is unlinked from the style;
 * - every linked property gets its style's current value; links to deleted styles are dropped.
 */
export function finalizeStyles(prev: Doc, next: Doc): Doc {
  if (prev === next) return next;
  const linked = Object.values(next.nodes).filter((n) => n.styleRefs && Object.keys(n.styleRefs).length);
  if (!linked.length) return next;
  const colors = new Map(colorStyles(next).map((s) => [s.id, s]));
  const texts = new Map(textStyles(next).map((s) => [s.id, s]));
  const prevColors = new Map(colorStyles(prev).map((s) => [s.id, s]));
  const prevTexts = new Map(textStyles(prev).map((s) => [s.id, s]));
  return produce(next, (d) => {
    for (const n0 of linked) {
      const n = d.nodes[n0.id] as GuiNode;
      const before = prev.nodes[n0.id];
      const refs = { ...n.styleRefs! };
      for (const [prop, sid] of Object.entries(refs)) {
        const wasLinked = before?.styleRefs?.[prop] === sid;
        if (prop === TEXT_REF) {
          const style = texts.get(sid);
          if (!style) {
            delete refs[prop];
            continue;
          }
          const edited = wasLinked && prevTexts.get(sid) === style && TEXT_STYLE_PROPS.some((k) => !same(before!.props[k], n0.props[k]));
          if (edited) {
            delete refs[prop];
            continue;
          }
          for (const [k, v] of Object.entries(textStyleProps(style))) if (hasProp(n.className, k) && !same(n.props[k], v)) n.props[k] = structuredClone(v);
          continue;
        }
        const style = colors.get(sid);
        if (!style || !hasProp(n.className, prop)) {
          delete refs[prop];
          continue;
        }
        const edited = wasLinked && prevColors.get(sid) === style && !same(before!.props[prop], n0.props[prop]);
        if (edited) {
          delete refs[prop];
          continue;
        }
        if (n.props[prop] !== style.color) n.props[prop] = style.color;
      }
      if (!same(refs, n.styleRefs)) {
        if (Object.keys(refs).length) n.styleRefs = refs;
        else delete n.styleRefs;
      }
    }
  });
}
