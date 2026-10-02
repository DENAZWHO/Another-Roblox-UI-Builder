// Gamepad / keyboard navigation: which elements can be selected, where each direction goes, selection
// groups. Tried out in Preview with the arrow keys and Enter (like a controller's D-pad and A button).
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useStore } from '../store';
import { isGuiObject } from '../model/schema';
import { targetOptions } from '../model/events';
import type { GuiNode, Rect } from '../model/types';
import type { LayoutResult } from '../model/layout';
import { setProp } from '../actions';
import { NumberField, Row, SelectField, Toggle } from './fields';

type Dir = 'up' | 'down' | 'left' | 'right';
const DIRS: Dir[] = ['up', 'down', 'left', 'right'];
const CAP: Record<Dir, string> = { up: 'Up', down: 'Down', left: 'Left', right: 'Right' };

export function GamepadSection({ ids, node }: { ids: string[]; node: GuiNode }) {
  const doc = useStore((s) => s.doc);
  const [open, setOpen] = useState(!!node.props.Selectable || !!node.nav || !!node.props.SelectionGroup);
  const p = node.props;
  const options: [string, string][] = [['', 'Automatic (nearest)'], ...targetOptions(doc).filter((o) => o.id !== node.id).map((o) => [o.id, o.label] as [string, string])];
  const setNav = (k: keyof NonNullable<GuiNode['nav']>, v: string) =>
    useStore.getState().update((d) => {
      for (const id of ids) {
        const n = d.nodes[id];
        if (!n) continue;
        const nav = { ...(n.nav ?? {}) };
        if (v) nav[k] = v;
        else delete nav[k];
        if (Object.keys(nav).length) n.nav = nav;
        else delete n.nav;
      }
    });
  return (
    <section className="section">
      <div className="section-title" style={{ cursor: 'pointer' }} onClick={() => setOpen(!open)}>
        <span>{open ? <ChevronDown size={11} /> : <ChevronRight size={11} />} Gamepad</span>
        <span className="muted" style={{ fontWeight: 400 }}>{p.Selectable ? 'selectable' : ''}</span>
      </div>
      {open && (
        <div className="section-body">
          <Row label="">
            <div className="flags">
              <Toggle value={!!p.Selectable} onChange={(v) => setProp(ids, 'Selectable', v)} label="Selectable" />
              <Toggle value={p.Interactable !== false} onChange={(v) => setProp(ids, 'Interactable', v)} label="Interactable" />
            </div>
          </Row>
          {p.Selectable && (
            <>
              <Row label="Order" title="SelectionOrder: lower is picked first when navigation starts">
                <NumberField value={p.SelectionOrder ?? 0} precision={0} onChange={(v) => setProp(ids, 'SelectionOrder', Math.round(v))} label="" />
              </Row>
              {DIRS.map((d) => (
                <Row key={d} label={`Next ${d}`} title={`NextSelection${CAP[d]}`}>
                  <SelectField value={node.nav?.[d] ?? ''} options={options} onChange={(v) => setNav(d, v)} />
                </Row>
              ))}
              <Row label="Highlight" title="SelectionImageObject: an element drawn over it while it's selected (default: Roblox's outline)">
                <SelectField value={node.nav?.image ?? ''} options={[['', 'Roblox default'], ...options.slice(1)]} onChange={(v) => setNav('image', v)} />
              </Row>
            </>
          )}
          <Row label="">
            <Toggle value={!!p.SelectionGroup} onChange={(v) => setProp(ids, 'SelectionGroup', v)} label="Selection group (keeps navigation inside first)" />
          </Row>
          {p.SelectionGroup &&
            DIRS.map((d) => (
              <Row key={d} label={`Leave ${d}`} title={`SelectionBehavior${CAP[d]}: Escape lets navigation leave the group that way, Stop keeps it inside`}>
                <SelectField value={p[`SelectionBehavior${CAP[d]}`] ?? 'Escape'} options={[['Escape', 'Escape (can leave)'], ['Stop', 'Stop (stays inside)']]} onChange={(v) => setProp(ids, `SelectionBehavior${CAP[d]}`, v)} />
              </Row>
            ))}
          <div className="hint">Try it in Preview: arrow keys move the selection, Enter presses it.</div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Navigation (Preview)

function isShown(nodes: Record<string, GuiNode>, id: string) {
  for (let cur: string | null = id; cur; cur = nodes[cur]?.parentId ?? null) {
    const n = nodes[cur];
    if (!n) return false;
    if (isGuiObject(n.className) && (n.props.Visible === false || n.props.Interactable === false)) return false;
    if (n.className === 'ScreenGui' && n.props.Enabled === false) return false;
  }
  return true;
}

/** Elements a gamepad can land on right now */
export function selectables(nodes: Record<string, GuiNode>, layout: LayoutResult): string[] {
  return Object.values(nodes)
    .filter((n) => isGuiObject(n.className) && n.props.Selectable && layout.rects[n.id] && isShown(nodes, n.id))
    .map((n) => n.id);
}

/** Where navigation starts: the lowest SelectionOrder, then top-left */
export function firstSelectable(nodes: Record<string, GuiNode>, layout: LayoutResult): string | null {
  const list = selectables(nodes, layout);
  list.sort((a, b) => (nodes[a].props.SelectionOrder ?? 0) - (nodes[b].props.SelectionOrder ?? 0) || layout.rects[a].y - layout.rects[b].y || layout.rects[a].x - layout.rects[b].x);
  return list[0] ?? null;
}

const center = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** The next element in a direction (NextSelection… first, then the nearest one that way; selection groups first) */
export function navigate(nodes: Record<string, GuiNode>, layout: LayoutResult, from: string, dir: Dir): string {
  const all = selectables(nodes, layout);
  const forced = nodes[from]?.nav?.[dir];
  if (forced && all.includes(forced)) return forced;
  const c0 = center(layout.rects[from]);
  const pick = (cands: string[]) => {
    let best: string | null = null;
    let bestScore = Infinity;
    for (const id of cands) {
      if (id === from) continue;
      const c = center(layout.rects[id]);
      const dx = c.x - c0.x;
      const dy = c.y - c0.y;
      const main = dir === 'left' ? -dx : dir === 'right' ? dx : dir === 'up' ? -dy : dy;
      const side = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
      if (main <= 1) continue;
      const score = main + side * 2;
      if (score < bestScore) [best, bestScore] = [id, score];
    }
    return best;
  };
  // the nearest selection group around it: look inside first; Stop keeps navigation there
  for (let g = nodes[from]?.parentId ?? null; g; g = nodes[g]?.parentId ?? null) {
    const gn = nodes[g];
    if (!gn?.props.SelectionGroup) continue;
    const inside = all.filter((id) => {
      for (let cur: string | null = id; cur; cur = nodes[cur]?.parentId ?? null) if (cur === g) return true;
      return false;
    });
    const hit = pick(inside);
    if (hit) return hit;
    if (gn.props[`SelectionBehavior${CAP[dir]}`] === 'Stop') return from;
  }
  return pick(all) ?? from;
}
