// Floating bar above the selected element: its colours and transparency at a glance, plus the colour picker (eyedropper).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Pipette } from 'lucide-react';
import { useStore } from '../store';
import { isGuiObject, isImage, isText } from '../model/schema';
import type { GuiNode, Rect } from '../model/types';
import { setProp, setProps } from '../actions';
import { ColorPicker } from './ColorPicker';
import { NumberField } from './fields';
import { useEffectiveNodes } from './hooks';
import { eyedrop, useCanEyedrop } from './eyedropper';

// ---------------------------------------------------------------------------
// Colour picker (eyedropper): any pixel on the screen, reference images included

type ColorProp = 'BackgroundColor3' | 'TextColor3' | 'ImageColor3';

/** The colour a pick changes: the fill, or the text / image colour when the element has no visible fill */
export function mainColorProp(n: GuiNode): ColorProp {
  const noFill = (n.props.BackgroundTransparency ?? 0) >= 1;
  if (noFill && isText(n.className)) return 'TextColor3';
  if (noFill && isImage(n.className)) return 'ImageColor3';
  return 'BackgroundColor3';
}

const PROP_LABEL: Record<ColorProp, string> = { BackgroundColor3: 'fill', TextColor3: 'text colour', ImageColor3: 'image tint' };

/** Pick a colour from the screen and apply it to the selection (or copy it when nothing is selected) */
export async function pickColorForSelection(prop?: ColorProp) {
  const hex = await eyedrop();
  if (!hex) return;
  const s = useStore.getState();
  const ids = s.selection.filter((id) => isGuiObject(s.doc.nodes[id]?.className));
  if (!ids.length) {
    navigator.clipboard?.writeText(hex.toUpperCase()).catch(() => {});
    s.showToast(`Picked ${hex.toUpperCase()} — copied (select an element to apply picks to it)`);
    return;
  }
  const changes = ids.map((id) => {
    const n = s.doc.nodes[id];
    const p = prop && (prop !== 'TextColor3' || isText(n.className)) && (prop !== 'ImageColor3' || isImage(n.className)) ? prop : mainColorProp(n);
    return { id, props: { [p]: hex } as Record<string, any>, p };
  });
  setProps(changes);
  const n0 = s.doc.nodes[ids[0]];
  s.showToast(`${hex.toUpperCase()} → ${ids.length > 1 ? `${ids.length} elements` : `${n0.name}'s ${PROP_LABEL[changes[0].p]}`}`);
}

// ---------------------------------------------------------------------------
// The bar

interface Chip {
  key: string;
  label: string;
  title: string;
  ids: string[];
  color: string;
  colorProp: string;
  t: number;
  tProp: string;
}

function chipsFor(sel: GuiNode[], nodes: Record<string, GuiNode>): Chip[] {
  const out: Chip[] = [];
  const add = (key: string, label: string, title: string, list: GuiNode[], colorProp: string, tProp: string) => {
    if (!list.length) return;
    out.push({ key, label, title, ids: list.map((n) => n.id), color: list[0].props[colorProp] ?? '#ffffff', colorProp, t: list[0].props[tProp] ?? 0, tProp });
  };
  add('fill', 'Fill', 'BackgroundColor3 · BackgroundTransparency', sel, 'BackgroundColor3', 'BackgroundTransparency');
  add('text', 'Text', 'TextColor3 · TextTransparency', sel.filter((n) => isText(n.className)), 'TextColor3', 'TextTransparency');
  add('image', 'Image', 'ImageColor3 · ImageTransparency', sel.filter((n) => isImage(n.className)), 'ImageColor3', 'ImageTransparency');
  add('group', 'Group', 'CanvasGroup GroupColor3 · GroupTransparency (the whole group)', sel.filter((n) => n.className === 'CanvasGroup'), 'GroupColor3', 'GroupTransparency');
  const strokes = sel.flatMap((n) => n.children.map((c) => nodes[c]).filter((c) => c?.className === 'UIStroke'));
  add('stroke', 'Stroke', 'UIStroke Color · Transparency', strokes, 'Color', 'Transparency');
  return out;
}

/** `rect`: the selection in canvas-overlay pixels */
export function QuickBar({ rect }: { rect: Rect }) {
  const selection = useStore((s) => s.selection);
  const editing = useStore((s) => s.editingTextId);
  const nodes = useEffectiveNodes();
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0, cw: 0 });
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<{ key: string; anchor: DOMRect } | null>(null);
  const canPick = useCanEyedrop();

  // out of the way while dragging on the canvas
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('.canvas') && !t.closest('.quickbar')) setBusy(true);
    };
    const up = () => setBusy(false);
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
    };
  }, []);

  const sel = selection.map((id) => nodes[id]).filter((n): n is GuiNode => !!n && isGuiObject(n.className));
  const chips = chipsFor(sel, nodes);
  const sig = chips.map((c) => c.key).join();

  useLayoutEffect(() => {
    const el = ref.current;
    if (el) setSize({ w: el.offsetWidth, h: el.offsetHeight, cw: (el.parentElement?.clientWidth ?? 0) });
  }, [sig, rect.w]);

  if (!sel.length || editing || !chips.length) return null;
  const gap = 12;
  let top = rect.y - size.h - gap;
  if (top < 8) top = rect.y + rect.h + 34; // below the size badge
  const left = Math.max(8, Math.min(size.cw - size.w - 8, rect.x + rect.w / 2 - size.w / 2));
  const chip = open && chips.find((c) => c.key === open.key);

  return (
    <div
      ref={ref}
      className={`quickbar ${busy ? 'busy' : ''}`}
      style={{ left, top }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      {chips.map((c) => (
        <div key={c.key} className="qb-chip" title={c.title}>
          <span className="qb-label">{c.label}</span>
          <button
            className={`swatch ${open?.key === c.key ? 'open' : ''}`}
            style={{ ['--c' as any]: c.color, ['--a' as any]: 1 - c.t }}
            title={`${c.label} colour ${c.color.toUpperCase()} — click to edit`}
            onClick={(e) => setOpen(open?.key === c.key ? null : { key: c.key, anchor: (e.currentTarget as HTMLElement).getBoundingClientRect() })}
          />
          <NumberField
            className="qb-t"
            label="T"
            title={`${c.tProp} (0% = solid, 100% = invisible) — drag the T to scrub`}
            value={Math.round(c.t * 100)}
            min={0}
            max={100}
            suffix="%"
            onChange={(v) => setProp(c.ids, c.tProp, Math.round(v) / 100)}
          />
        </div>
      ))}
      {canPick && (
        <button className="qb-btn" title="Pick a colour from the screen for this element (C)" onClick={() => pickColorForSelection()}>
          <Pipette size={14} />
        </button>
      )}
      {chip && open && (
        <ColorPicker
          value={chip.color}
          onChange={(hex) => setProp(chip.ids, chip.colorProp, hex)}
          transparency={chip.t}
          onTransparency={(t) => setProp(chip.ids, chip.tProp, t)}
          anchor={open.anchor}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
