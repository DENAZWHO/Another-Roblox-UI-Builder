import { useEffect } from 'react';
import { useStore, type Tool } from '../store';
import { Toolbar } from './Toolbar';
import { LeftPanel, insertDropped, isInsertDrag } from './LayersPanel';
import { Canvas } from './Canvas';
import { PropertiesPanel } from './PropertiesPanel';
import { Timeline } from './Timeline';
import { ContextMenu, Dialogs, Toast } from './Dialogs';
import { zoomAt, zoomToFit, zoomToSelection } from './viewport';
import {
  copySelection, savePrefabFromSelection, cutSelection, deleteSelection, layoutNow, duplicateSelection, groupSelection, nudge, pasteClipboard,
  reorder, selectAll, toggleLocked, toggleVisible, ungroupSelection,
} from '../actions';
import { openProject, saveProject } from '../files';
import { pathTo } from '../model/doc';
import { CONTAINER_CLASSES, isGuiObject, isRoot } from '../model/schema';
import { clipLength } from '../model/animation';

const TOOL_KEYS: Record<string, Tool> = {
  v: 'move', h: 'hand', f: 'Frame', r: 'Frame', s: 'ScrollingFrame', g: 'CanvasGroup', t: 'TextLabel',
  b: 'TextButton', x: 'TextBox', i: 'ImageLabel', u: 'ImageButton',
};

function isTyping() {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

function onKeyDown(e: KeyboardEvent) {
  const s = useStore.getState();
  if (s.dialog || isTyping() || s.editingTextId) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  const done = () => e.preventDefault();

  if (mod && k === 'z') return done(), e.shiftKey ? s.redo() : s.undo();
  if (mod && k === 'y') return done(), s.redo();
  if (mod && k === 'c') return done(), copySelection();
  if (mod && k === 'x') return done(), cutSelection();
  if (mod && k === 'v') return done(), pasteClipboard();
  if (mod && k === 'd') return done(), duplicateSelection();
  if (mod && e.altKey && e.code === 'KeyK') return done(), savePrefabFromSelection();
  if (mod && k === 'g') return done(), e.shiftKey ? ungroupSelection() : groupSelection();
  if (mod && k === 'a') return done(), selectAll();
  if (mod && k === 's') return done(), saveProject();
  if (mod && k === 'o') return done(), openProject();
  if (mod && k === 'e') return done(), useStore.setState({ dialog: 'export' });
  if (mod && k === 'p') return done(), useStore.setState({ dialog: 'preview' });
  if (mod && e.shiftKey && k === 'h') return done(), s.selection.forEach(toggleVisible);
  if (mod && e.shiftKey && k === 'l') return done(), s.selection.forEach(toggleLocked);
  if (mod && (k === '=' || k === '+')) return done(), zoomAt(s.zoom * 1.25);
  if (mod && k === '-') return done(), zoomAt(s.zoom / 1.25);
  if (mod && k === '0') return done(), zoomAt(1);
  if (mod && k === ']') return done(), reorder('front');
  if (mod && k === '[') return done(), reorder('back');
  if (mod && (k === '/' || e.code === 'Slash')) return done(), useStore.setState({ dialog: 'shortcuts' });
  if (mod) return;

  if (e.altKey && e.code === 'KeyA') return done(), useStore.setState({ mode: s.mode === 'design' ? 'animate' : 'design', playing: false });
  if (e.shiftKey && e.code === 'Digit1') return done(), zoomToFit();
  if (e.shiftKey && e.code === 'Digit2') return done(), zoomToSelection();
  if (e.shiftKey && e.code === 'Digit0') return done(), zoomAt(1);
  if (e.key === '?') return done(), useStore.setState({ dialog: 'shortcuts' });

  if (k === 'delete' || k === 'backspace') return done(), deleteSelection();
  if (k.startsWith('arrow')) {
    done();
    const d = e.shiftKey ? 10 : 1;
    return nudge(k === 'arrowleft' ? -d : k === 'arrowright' ? d : 0, k === 'arrowup' ? -d : k === 'arrowdown' ? d : 0);
  }
  if (k === ']') return done(), reorder('forward');
  if (k === '[') return done(), reorder('backward');
  if (k === 'enter') {
    done();
    const id = s.selection[0];
    if (!id) return;
    if (e.shiftKey) {
      const p = s.doc.nodes[id]?.parentId;
      if (p) s.select([p]);
    } else {
      const kids = s.doc.nodes[id].children.filter((c) => isGuiObject(s.doc.nodes[c].className));
      if (kids.length) s.select(kids);
    }
    return;
  }
  if (k === 'escape') {
    if (s.tool !== 'move') return useStore.setState({ tool: 'move' });
    const p = s.selection[0] ? s.doc.nodes[s.selection[0]]?.parentId : null;
    return s.select(p && !isRoot(s.doc.nodes[p].className) ? [p] : []);
  }
  if (k === 'k' && s.mode === 'animate') {
    const clip = s.doc.clips.find((c) => c.id === s.activeClipId);
    if (!s.playing && s.playhead >= clipLength(clip) - 0.001) useStore.setState({ playhead: 0 });
    return useStore.setState({ playing: !s.playing });
  }
  if (!e.altKey && TOOL_KEYS[k]) return useStore.setState({ tool: TOOL_KEYS[k] });
}

export function App() {
  const mode = useStore((s) => s.mode);
  const dialog = useStore((s) => s.dialog);

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // drag an element or a prefab from the Insert panel onto the canvas
  const onDrop = (e: React.DragEvent) => {
    if (!isInsertDrag(e)) return;
    e.preventDefault();
    const s = useStore.getState();
    const b = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const wx = (e.clientX - b.left - s.pan.x) / s.zoom;
    const wy = (e.clientY - b.top - s.pan.y) / s.zoom;
    const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest('[data-nid]') as HTMLElement | null;
    const path = el ? pathTo(s.doc.nodes, el.dataset.nid!) : [];
    let parentId = path[0] ?? s.doc.rootIds[0];
    // drop into the deepest frame under the pointer, skipping full-screen backdrops (e.g. a Background frame)
    const lay0 = layoutNow();
    const screen = lay0.rects[path[0]];
    for (const id of path) {
      const r = lay0.rects[id];
      const backdrop = screen && r && r.w * r.h >= 0.6 * screen.w * screen.h;
      if (CONTAINER_CLASSES.includes(s.doc.nodes[id].className) && !s.doc.nodes[id].locked && !backdrop) parentId = id;
    }
    insertDropped(e.dataTransfer, parentId, { x: wx, y: wy });
  };

  return (
    <div className={`app mode-${mode}`}>
      <Toolbar />
      <div className="main">
        <LeftPanel />
        <div className="center">
          <div
            className="canvas-wrap"
            onDragOver={(e) => {
              if (isInsertDrag(e)) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
              }
            }}
            onDrop={onDrop}
          >
            <Canvas />
          </div>
          {mode === 'animate' && <Timeline />}
        </div>
        <PropertiesPanel />
      </div>
      {dialog && <Dialogs />}
      <ContextMenu />
      <Toast />
    </div>
  );
}
