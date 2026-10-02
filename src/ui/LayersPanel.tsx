import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Eye, EyeOff, Lock, LockOpen, Monitor, Plus, Search, Trash2, X, Zap } from 'lucide-react';
import { triggerLabel } from '../model/events';
import { useStore } from '../store';
import { isGuiObject, isModifier, GUI_OBJECT_CLASSES, MODIFIER_CLASSES, modifierAllowed, isRoot, isWorldGui } from '../model/schema';
import { pathTo, extractFragment } from '../model/doc';
import type { GuiNode, GuiObjectClass, ModifierClass, Screen } from '../model/types';
import { addModifier, insertionParent, insertNode, insertRoot, moveNodes, rename, toggleLocked, toggleVisible, batch, insertComponent, insertPrefab, layoutNow, placeNodes, reorderInStack, stackDropIndex, stackLayout, addScreen, deleteScreen, moveRootToScreen, renameScreen, setScreenStart, insertInstance } from '../actions';
import { ClassIcon } from './icons';
import { PRESETS } from '../model/presets';
import { zoomToScreen, zoomToSelection } from './viewport';
import { screenRoots, screenStartsVisible, screensOf } from '../model/screens';
import { PREFAB_DRAG_TYPE, PrefabsSection } from './PrefabsPanel';
import { prefabs } from '../model/prefabs';
import { elementFragment, modifierProblem, startDragPreview, startModifierDrag } from './DragPreview';
import { ReferencesSection } from './References';
import { StylesTab } from './StylesPanel';
import { ChecksTab, useCheckIssues } from './ChecksPanel';

function ChecksBadge() {
  const issues = useCheckIssues();
  if (!issues.length) return null;
  const errors = issues.some((i) => i.severity === 'error');
  return <span className={`tab-badge ${errors ? 'error' : 'warn'}`}>{issues.length}</span>;
}

export function LeftPanel() {
  const tab = useStore((s) => s.leftTab);
  return (
    <aside className="panel left">
      <div className="tabs">
        <button className={tab === 'layers' ? 'on' : ''} onClick={() => useStore.setState({ leftTab: 'layers' })}>Layers</button>
        <button className={tab === 'insert' ? 'on' : ''} onClick={() => useStore.setState({ leftTab: 'insert' })}>Insert</button>
        <button className={tab === 'styles' ? 'on' : ''} onClick={() => useStore.setState({ leftTab: 'styles' })}>Styles</button>
        <button className={tab === 'checks' ? 'on' : ''} title="Accessibility checks: tap targets, contrast, text size" onClick={() => useStore.setState({ leftTab: 'checks' })}>
          Checks<ChecksBadge />
        </button>
      </div>
      {tab === 'layers' ? <Layers /> : tab === 'insert' ? <InsertPanel /> : tab === 'styles' ? <StylesTab /> : <ChecksTab />}
    </aside>
  );
}

/** Children in display order: modifiers first, then GUI objects front-to-back (Figma order) */
function displayChildren(nodes: Record<string, GuiNode>, id: string) {
  const kids = nodes[id]?.children.filter((c) => nodes[c]) ?? [];
  return [...kids.filter((c) => isModifier(nodes[c].className)), ...kids.filter((c) => !isModifier(nodes[c].className)).reverse()];
}

type DropZone = { id: string; zone: 'above' | 'below' | 'inside' } | null;

function Layers() {
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  const collapsed = useStore((s) => s.collapsed);
  const [filter, setFilter] = useState('');
  const [drop, setDrop] = useState<DropZone>(null);
  const dragIds = useRef<string[]>([]);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const isOpen = (id: string) => (collapsed[id] !== undefined ? !collapsed[id] : isRoot(doc.nodes[id]?.className));

  // expand ancestors of the selection and scroll it into view
  useEffect(() => {
    const open: Record<string, boolean> = {};
    for (const id of selection) for (const a of pathTo(doc.nodes, id).slice(0, -1)) if (!isOpen(a)) open[a] = false;
    if (Object.keys(open).length) useStore.setState({ collapsed: { ...useStore.getState().collapsed, ...open } });
    const last = selection[selection.length - 1];
    requestAnimationFrame(() => rowRefs.current[last]?.scrollIntoView({ block: 'nearest' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  const matches = useMemo(() => {
    if (!filter.trim()) return null;
    const q = filter.toLowerCase();
    const set = new Set<string>();
    for (const n of Object.values(doc.nodes)) {
      if (n.name.toLowerCase().includes(q) || n.className.toLowerCase().includes(q)) pathTo(doc.nodes, n.id).forEach((a) => set.add(a));
    }
    return set;
  }, [filter, doc.nodes]);

  const onRowClick = (e: React.MouseEvent, id: string) => {
    const s = useStore.getState();
    if (e.shiftKey || e.ctrlKey || e.metaKey) s.select(s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id]);
    else s.select([id]);
    if (s.mode === 'animate') useStore.setState({ selectedTweenId: null });
  };

  const onDragOver = (e: React.DragEvent, n: GuiNode) => {
    if (!dragIds.current.length) {
      if (!isInsertDrag(e) || !(isRoot(n.className) || isGuiObject(n.className))) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      if (!drop || drop.id !== n.id || drop.zone !== 'inside') setDrop({ id: n.id, zone: 'inside' });
      return;
    }
    e.preventDefault();
    const b = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = (e.clientY - b.top) / b.height;
    const canInside = isRoot(n.className) || isGuiObject(n.className);
    let zone: 'above' | 'below' | 'inside' = y < 0.3 ? 'above' : y > 0.7 ? 'below' : 'inside';
    if (!canInside && zone === 'inside') zone = y < 0.5 ? 'above' : 'below';
    if (isRoot(n.className)) zone = 'inside';
    if (dragIds.current.includes(n.id) || dragIds.current.some((d) => pathTo(doc.nodes, n.id).includes(d))) {
      setDrop(null);
      return;
    }
    if (!drop || drop.id !== n.id || drop.zone !== zone) setDrop({ id: n.id, zone });
  };

  const onDrop = (e: React.DragEvent) => {
    const d = drop;
    setDrop(null);
    if (d && !dragIds.current.length && isInsertDrag(e)) {
      e.preventDefault();
      insertDropped(e.dataTransfer, d.id);
      return;
    }
    if (!d || !dragIds.current.length) return;
    const t = doc.nodes[d.id];
    if (d.zone === 'inside') {
      moveNodes(dragIds.current, t.id, t.children.length);
    } else {
      const parent = t.parentId!;
      const i = doc.nodes[parent].children.indexOf(t.id);
      const reversed = !isModifier(t.className);
      const idx = d.zone === 'above' ? (reversed ? i + 1 : i) : reversed ? i : i + 1;
      // dropping modifiers between GUI rows (or vice versa) just reparents
      moveNodes([...dragIds.current].reverse(), parent, idx);
    }
    dragIds.current = [];
  };

  const renderRow = (id: string, depth: number): React.ReactNode => {
    const n = doc.nodes[id];
    if (!n || (matches && !matches.has(id))) return null;
    const kids = displayChildren(doc.nodes, id);
    const open = matches ? true : isOpen(id);
    const selected = selection.includes(id);
    const hidden = isRoot(n.className) || isModifier(n.className) ? n.props.Enabled === false : n.props.Visible === false;
    const dz = drop?.id === id ? drop.zone : null;
    return (
      <div key={id}>
        <div
          ref={(el) => {
            rowRefs.current[id] = el;
          }}
          className={`layer ${selected ? 'selected' : ''} ${hidden ? 'dim' : ''} ${dz ? 'drop-' + dz : ''} ${isModifier(n.className) ? 'mod' : ''}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={(e) => onRowClick(e, id)}
          onMouseEnter={() => useStore.setState({ hoverId: isGuiObject(n.className) ? id : null })}
          onMouseLeave={() => useStore.setState({ hoverId: null })}
          draggable={!isRoot(n.className)}
          onDragStart={(e) => {
            const sel = useStore.getState().selection;
            dragIds.current = sel.includes(id) ? sel.filter((s) => !isRoot(doc.nodes[s]?.className)) : [id];
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', n.name);
          }}
          onDragOver={(e) => onDragOver(e, n)}
          onDragLeave={() => setDrop(null)}
          onDrop={onDrop}
          onDragEnd={() => {
            dragIds.current = [];
            setDrop(null);
          }}
        >
          <span
            className="chev"
            onClick={(e) => {
              e.stopPropagation();
              useStore.setState({ collapsed: { ...useStore.getState().collapsed, [id]: open } });
            }}
          >
            {kids.length > 0 ? open ? <ChevronDown size={12} /> : <ChevronRight size={12} /> : null}
          </span>
          <ClassIcon cls={n.className} size={13} />
          {n.component && <span className="comp-badge main" title="Main component — its instances follow it">◆</span>}
          {n.instanceOf && <span className="comp-badge" title={`Instance of ${doc.nodes[n.instanceOf]?.name ?? 'a component'}${n.overrides?.length ? ' (with overrides)' : ''}`}>◇</span>}
          <LayerName node={n} />
          {n.events?.some((h) => h.actions.length) && (
            <span className="layer-event" title={`Events: ${n.events.map((h) => triggerLabel(h.on).replace(/^When /, '')).join(', ')}`}><Zap size={11} /></span>
          )}
          <span className="layer-actions">
            {!isRoot(n.className) && !isModifier(n.className) && (
              <button className={n.locked ? 'on' : ''} title={n.locked ? 'Unlock' : 'Lock'} onClick={(e) => { e.stopPropagation(); toggleLocked(id); }}>
                {n.locked ? <Lock size={12} /> : <LockOpen size={12} />}
              </button>
            )}
            <button className={hidden ? 'on' : ''} title={hidden ? 'Show' : 'Hide'} onClick={(e) => { e.stopPropagation(); toggleVisible(id); }}>
              {hidden ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
          </span>
        </div>
        {open && kids.map((k) => renderRow(k, depth + 1))}
      </div>
    );
  };

  return (
    <div className="layers">
      <div className="search">
        <Search size={12} />
        <input placeholder="Filter layers" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {filter && <button onClick={() => setFilter('')}><X size={12} /></button>}
      </div>
      <div className="layer-section-title">
        <span>Screens</span>
        <span className="root-add">
          <button title="New screen (a page of UI on its own artboard: shop, settings…)" onClick={() => { const id = addScreen(); requestAnimationFrame(() => zoomToScreen(id)); }}><Plus size={13} /></button>
          <button title="New BillboardGui (floats above a part)" onClick={() => { insertRoot('BillboardGui'); requestAnimationFrame(() => zoomToSelection()); }}><ClassIcon cls="BillboardGui" size={13} /></button>
          <button title="New SurfaceGui (drawn on a part's face)" onClick={() => { insertRoot('SurfaceGui'); requestAnimationFrame(() => zoomToSelection()); }}><ClassIcon cls="SurfaceGui" size={13} /></button>
        </span>
      </div>
      <div className="layer-list" onClick={(e) => e.target === e.currentTarget && useStore.getState().select([])}>
        {screensOf(doc).map((sc) => (
          <div key={sc.id}>
            <ScreenHeader screen={sc} />
            {screenRoots(doc, sc.id).map((r) => renderRow(r, 0))}
          </div>
        ))}
        {doc.rootIds.some((r) => isWorldGui(doc.nodes[r]?.className)) && <div className="layer-group-title">In the world</div>}
        {doc.rootIds.filter((r) => isWorldGui(doc.nodes[r]?.className)).map((r) => renderRow(r, 0))}
      </div>
      <ReferencesSection />
    </div>
  );
}

function LayerName({ node }: { node: GuiNode }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(node.name);
  if (editing)
    return (
      <input
        className="layer-rename"
        autoFocus
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onBlur={() => {
          rename(node.id, val);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setEditing(false);
        }}
      />
    );
  return (
    <span
      className="layer-name"
      onDoubleClick={(e) => {
        e.stopPropagation();
        setVal(node.name);
        setEditing(true);
      }}
    >
      {node.name}
      {node.name !== node.className && <span className="layer-class">{node.className}</span>}
    </span>
  );
}

// ---------------------------------------------------------------------------

const ELEMENT_INFO: Record<string, string> = {
  Frame: 'Container',
  ScrollingFrame: 'Scrollable container',
  CanvasGroup: 'Group with transparency',
  TextLabel: 'Static text',
  TextButton: 'Clickable text',
  TextBox: 'Text input',
  ImageLabel: 'Image',
  ImageButton: 'Clickable image',
  ViewportFrame: '3D viewport',
  VideoFrame: 'Video',
};

export const INSERT_DRAG_TYPE = 'application/x-rbx-insert';
export const COMPONENT_DRAG_TYPE = 'application/x-rbx-component';
export const MODIFIER_DRAG_TYPE = 'application/x-rbx-modifier';

/** Something dragged from the Insert panel (element, component or prefab)? */
export const isInsertDrag = (e: React.DragEvent) =>
  [INSERT_DRAG_TYPE, COMPONENT_DRAG_TYPE, PREFAB_DRAG_TYPE, MODIFIER_DRAG_TYPE].some((t) => e.dataTransfer.types.includes(t));

/** Is a modifier being dragged? */
export const isModifierDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(MODIFIER_DRAG_TYPE);

/** Add a dragged modifier to an element (says why when it can't) */
export function addDroppedModifier(cls: ModifierClass, targetId: string | null) {
  const s = useStore.getState();
  const t = targetId ? s.doc.nodes[targetId] : undefined;
  if (!t) return s.showToast(`Drop ${cls} onto an element`);
  const problem = modifierProblem(cls, t, s.doc.nodes);
  if (problem) return s.showToast(problem);
  const [id] = addModifier([t.id], cls);
  if (!id) return;
  s.select([t.id]);
  s.showToast(`Added ${cls} to ${t.name}`);
}

/** Insert whatever was dragged from the Insert panel into `parentId` (optionally centred on a canvas point) */
export function insertDropped(data: DataTransfer, parentId: string, at?: { x: number; y: number }) {
  const mod = data.getData(MODIFIER_DRAG_TYPE) as ModifierClass;
  if (mod) return addDroppedModifier(mod, parentId);
  const cls = data.getData(INSERT_DRAG_TYPE) as GuiObjectClass;
  const componentId = data.getData(COMPONENT_DRAG_TYPE);
  const prefabId = data.getData(PREFAB_DRAG_TYPE);
  batch(() => {
    // dropped on a stack (UIListLayout / UIGridLayout): slot in where the pointer is, like the preview showed
    const slot = at && stackLayout(parentId) ? stackDropIndex(parentId, at) : null;
    let roots: string[] = [];
    if (componentId?.startsWith('doc:')) {
      roots = insertInstance(componentId.slice(4), { parentId, at });
    } else if (componentId) {
      const p = PRESETS.find((x) => x.id === componentId);
      if (p) roots = insertComponent(p, { parentId, at });
    } else if (prefabId) {
      const p = prefabs().find((x) => x.id === prefabId);
      if (p) roots = insertPrefab(p, { parentId, at });
    } else if (cls) {
      const id = insertNode(cls, { parentId });
      roots = [id];
      const lay = layoutNow();
      const r = lay.rects[id];
      if (at && r && !lay.laidOut.has(id)) placeNodes([{ id, rect: { ...r, x: Math.round(at.x - r.w / 2), y: Math.round(at.y - r.h / 2) } }], lay);
    }
    if (slot !== null && roots.length) {
      reorderInStack(roots, slot);
      useStore.getState().select(roots);
    }
  });
}

function InsertPanel() {
  const selection = useStore((s) => s.selection);
  const doc = useStore((s) => s.doc);
  const targets = selection.filter((id) => doc.nodes[id] && (isGuiObject(doc.nodes[id].className) || isRoot(doc.nodes[id].className)));
  const into = doc.nodes[insertionParent({ into: true })];
  const intoLabel = into ? <span className="muted insert-into" title="New elements, components and prefabs go inside this (select something in Layers to change it)">→ {into.name}</span> : null;
  return (
    <div className="insert">
      <PrefabsSection intoLabel={intoLabel} />
      <div className="insert-title">Elements {intoLabel}</div>
      <div className="insert-grid">
        {GUI_OBJECT_CLASSES.map((c) => (
          <button
            key={c}
            className="insert-item"
            title={`${c} — click to insert, or drag onto the canvas`}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(INSERT_DRAG_TYPE, c);
              e.dataTransfer.effectAllowed = 'copy';
              startDragPreview(e, c, () => elementFragment(c));
            }}
            onClick={() => insertNode(c, { parentId: insertionParent({ into: true }) })}
          >
            <ClassIcon cls={c} size={18} />
            <span className="insert-name">{c}</span>
            <span className="insert-desc">{ELEMENT_INFO[c]}</span>
          </button>
        ))}
      </div>
      <div className="insert-title">
        Modifiers <span className="muted">{targets.length ? `→ ${targets.length === 1 ? doc.nodes[targets[0]].name : targets.length + ' items'}` : '(select an element)'}</span>
      </div>
      <div className="insert-list">
        {MODIFIER_CLASSES.map((m) => {
          const ok = targets.some((t) => modifierAllowed(m as ModifierClass, doc.nodes[t].className));
          return (
            <button
              key={m}
              className={`insert-row ${ok ? '' : 'soft-disabled'}`}
              title={ok ? `Add ${m} to the selection — or drag it onto an element` : `Drag ${m} onto an element (or select one first)`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(MODIFIER_DRAG_TYPE, m);
                e.dataTransfer.effectAllowed = 'copy';
                startModifierDrag(e, m as ModifierClass);
              }}
              onClick={() => (ok ? addModifier(targets, m) : useStore.getState().showToast(`Select an element first, or drag ${m} onto one`))}
            >
              <ClassIcon cls={m} size={14} />
              {m}
            </button>
          );
        })}
      </div>
      <div className="insert-title">Components {intoLabel}</div>
      <DocComponents />
      <div className="insert-list">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            className="insert-row preset"
            title={`${p.name} — click to insert, or drag onto the canvas or a layer`}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(COMPONENT_DRAG_TYPE, p.id);
              e.dataTransfer.effectAllowed = 'copy';
              startDragPreview(e, p.name, p.build);
            }}
            onClick={() => insertComponent(p)}
          >
            <span className="preset-name">{p.name}</span>
            <span className="insert-desc">{p.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** A screen's row in Layers: name (double-click to rename), start toggle, add a ScreenGui, delete */
function ScreenHeader({ screen }: { screen: Screen }) {
  const doc = useStore((s) => s.doc);
  const [editing, setEditing] = useState(false);
  const many = screensOf(doc).length > 1;
  const start = screenStartsVisible(doc, screen);
  const roots = screenRoots(doc, screen.id);
  return (
    <div
      className="screen-header"
      title="Click to show this screen on the canvas"
      onClick={() => {
        if (roots[0]) useStore.getState().select([roots[0]]);
        zoomToScreen(screen.id);
      }}
    >
      <Monitor size={12} />
      {editing ? (
        <input
          className="layer-rename"
          autoFocus
          defaultValue={screen.name}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => {
            renameScreen(screen.id, e.target.value);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <span className="screen-name" onDoubleClick={(e) => (e.stopPropagation(), setEditing(true))}>{screen.name}</span>
      )}
      <span className="screen-actions" onClick={(e) => e.stopPropagation()}>
        {many && (
          <button className={start ? 'on' : ''} title={start ? 'Shown when the game starts — click to start hidden' : 'Hidden when the game starts — click to show it at the start'} onClick={() => setScreenStart(screen.id, !start)}>
            {start ? <Eye size={12} /> : <EyeOff size={12} />}
          </button>
        )}
        <button title="New ScreenGui on this screen" onClick={() => { useStore.getState().select(roots.slice(0, 1)); if (!roots.length) moveToNewRoot(screen.id); else insertRoot('ScreenGui'); }}><Plus size={12} /></button>
        {many && (
          <button title="Delete this screen and its GUIs" onClick={() => confirm(`Delete the screen "${screen.name}"${roots.length ? ` and its ${roots.length} ScreenGui${roots.length > 1 ? 's' : ''}` : ''}?`) && deleteScreen(screen.id)}>
            <Trash2 size={12} />
          </button>
        )}
      </span>
    </div>
  );
}

/** A ScreenGui for an empty screen */
function moveToNewRoot(screenId: string) {
  const id = insertRoot('ScreenGui');
  moveRootToScreen(id, screenId);
}

/** Main components in this document: click to insert an instance, or drag it in */
function DocComponents() {
  const doc = useStore((s) => s.doc);
  const mains = Object.values(doc.nodes).filter((n) => n.component);
  if (!mains.length) return <div className="hint doc-comp-hint">Right-click an element → Make component to reuse it here; its copies stay linked.</div>;
  return (
    <div className="insert-list doc-comps">
      {mains.map((m) => {
        const count = Object.values(doc.nodes).filter((n) => n.instanceOf === m.id).length;
        return (
          <button
            key={m.id}
            className="insert-row preset"
            title={`${m.name} — click to insert an instance, or drag it onto the canvas or a layer`}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(COMPONENT_DRAG_TYPE, 'doc:' + m.id);
              e.dataTransfer.effectAllowed = 'copy';
              startDragPreview(e, m.name, () => extractFragment(useStore.getState().doc.nodes, [m.id]));
            }}
            onClick={() => insertInstance(m.id)}
          >
            <span className="preset-name"><span className="comp-badge main">◆</span> {m.name}</span>
            <span className="insert-desc">{count} instance{count === 1 ? '' : 's'} · this document</span>
          </button>
        );
      })}
    </div>
  );
}
