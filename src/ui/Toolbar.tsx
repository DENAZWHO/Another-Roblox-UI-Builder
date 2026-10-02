import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Code, Hand, Keyboard, MousePointer2, PenTool, Pipette, Play, Redo2, Undo2, Cable, Menu, UserRound } from 'lucide-react';
import { pickColorForSelection } from './QuickBar';
import { insertFragmentAt, insertionParent } from '../actions';
import { PRESETS } from '../model/presets';
import { useStore, type Tool } from '../store';
import type { GuiObjectClass } from '../model/types';
import { ClassIcon } from './icons';
import { zoomAt, zoomToFit, zoomToSelection } from './viewport';
import { importRbxmx, newDocument, openProject, saveProject } from '../files';
import { useSyncStatus } from '../sync';

const TOOL_GROUPS: { key: string; tools: { cls: GuiObjectClass; key: string }[] }[] = [
  { key: 'frame', tools: [{ cls: 'Frame', key: 'F' }, { cls: 'ScrollingFrame', key: 'S' }, { cls: 'CanvasGroup', key: 'G' }, { cls: 'ViewportFrame', key: '' }, { cls: 'VideoFrame', key: '' }] },
  { key: 'text', tools: [{ cls: 'TextLabel', key: 'T' }, { cls: 'TextButton', key: 'B' }, { cls: 'TextBox', key: 'X' }] },
  { key: 'image', tools: [{ cls: 'ImageLabel', key: 'I' }, { cls: 'ImageButton', key: 'U' }] },
];

export function useClickOutside(ref: React.RefObject<HTMLElement | null>, onOut: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const h = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOut();
    };
    window.addEventListener('pointerdown', h, true);
    return () => window.removeEventListener('pointerdown', h, true);
  }, [active, onOut, ref]);
}

function Dropdown({ button, children, align = 'left', className }: { button: (open: boolean, toggle: () => void) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right'; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);
  return (
    <div className={`dropdown ${className ?? ''}`} ref={ref}>
      {button(open, () => setOpen(!open))}
      {open && <div className={`menu ${align}`}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

export function MenuItem({ label, shortcut, onClick, disabled }: { label: ReactNode; shortcut?: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button className="menu-item" disabled={disabled} onClick={onClick}>
      <span>{label}</span>
      {shortcut && <span className="shortcut">{shortcut}</span>}
    </button>
  );
}

function ToolGroup({ group }: { group: (typeof TOOL_GROUPS)[number] }) {
  const tool = useStore((s) => s.tool);
  const [last, setLast] = useState(group.tools[0].cls);
  const active = group.tools.find((t) => t.cls === tool);
  useEffect(() => {
    if (active) setLast(active.cls);
  }, [active]);
  const current = active?.cls ?? last;
  const info = group.tools.find((t) => t.cls === current)!;
  return (
    <Dropdown
      className="tool-group"
      button={(_open, toggle) => (
        <div className={`tool ${active ? 'on' : ''}`}>
          <button title={`${current}${info.key ? ` (${info.key})` : ''}`} onClick={() => useStore.setState({ tool: current })}>
            <ClassIcon cls={current} size={16} />
          </button>
          <button className="caret" onClick={toggle}><ChevronDown size={10} /></button>
        </div>
      )}
    >
      {(close) => (
        <>
          {group.tools.map((t) => (
            <MenuItem
              key={t.cls}
              label={<span className="menu-with-icon"><ClassIcon cls={t.cls} size={14} /> {t.cls}</span>}
              shortcut={t.key}
              onClick={() => {
                useStore.setState({ tool: t.cls });
                close();
              }}
            />
          ))}
          {group.key === 'image' && (
            <>
              <div className="menu-sep" />
              <MenuItem
                label={<span className="menu-with-icon"><UserRound size={14} /> Player avatar</span>}
                onClick={() => {
                  close();
                  insertFragmentAt(PRESETS.find((p) => p.id === 'avatar')!.build(), insertionParent());
                }}
              />
              <MenuItem
                label={<span className="menu-with-icon"><UserRound size={14} /> Player card</span>}
                onClick={() => {
                  close();
                  insertFragmentAt(PRESETS.find((p) => p.id === 'playercard')!.build(), insertionParent());
                }}
              />
            </>
          )}
        </>
      )}
    </Dropdown>
  );
}

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  const mode = useStore((s) => s.mode);
  const zoom = useStore((s) => s.zoom);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const liveSync = useStore((s) => s.liveSync);
  const sync = useSyncStatus();
  const setTool = (t: Tool) => useStore.setState({ tool: t });

  return (
    <header className="toolbar">
      <div className="tb-left">
        <Dropdown
          button={(_o, toggle) => (
            <button className="logo" onClick={toggle} title="Menu">
              <Menu size={16} />
              <span className="logo-text">UI Builder</span>
            </button>
          )}
        >
          {(close) => (
            <>
              <MenuItem label="New document" onClick={() => { close(); newDocument(); }} />
              <MenuItem label="Open project…" shortcut="Ctrl+O" onClick={() => { close(); openProject(); }} />
              <MenuItem label="Save project" shortcut="Ctrl+S" onClick={() => { close(); saveProject(); }} />
              <div className="menu-sep" />
              <MenuItem label="Import .rbxmx…" onClick={() => { close(); importRbxmx(); }} />
              <MenuItem label="Export…" shortcut="Ctrl+E" onClick={() => { close(); useStore.setState({ dialog: 'export' }); }} />
              <MenuItem label="Studio plugin sync…" onClick={() => { close(); useStore.setState({ dialog: 'studio' }); }} />
              <div className="menu-sep" />
              <MenuItem label="Keyboard shortcuts" shortcut="?" onClick={() => { close(); useStore.setState({ dialog: 'shortcuts' }); }} />
            </>
          )}
        </Dropdown>
        <div className="tools">
          <div className={`tool ${tool === 'move' ? 'on' : ''}`}>
            <button title="Move (V)" onClick={() => setTool('move')}><MousePointer2 size={16} /></button>
          </div>
          <div className={`tool ${tool === 'hand' ? 'on' : ''}`}>
            <button title="Hand (H) — or hold Space" onClick={() => setTool('hand')}><Hand size={16} /></button>
          </div>
          <div className={`tool ${tool === 'pen' ? 'on' : ''}`}>
            <button title="Pen (P) — draw a Path2D: click for corners, drag for curves, click the first point to close, Enter to finish" onClick={() => setTool('pen')}><PenTool size={16} /></button>
          </div>
          <div className="tool">
            <button title="Pick colour (C) — from anywhere on the screen, e.g. a reference image. Applies to the selected element." onClick={() => pickColorForSelection()}><Pipette size={16} /></button>
          </div>
          <span className="tb-sep" />
          {TOOL_GROUPS.map((g) => <ToolGroup key={g.key} group={g} />)}
          <span className="tb-sep" />
          <button className="icon-btn" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={() => useStore.getState().undo()}><Undo2 size={15} /></button>
          <button className="icon-btn" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={() => useStore.getState().redo()}><Redo2 size={15} /></button>
        </div>
      </div>

      <div className="tb-center">
        <div className="mode-switch">
          <button className={mode === 'design' ? 'on' : ''} onClick={() => useStore.setState({ mode: 'design', playing: false, selectedTweenId: null })}>Design</button>
          <button className={mode === 'animate' ? 'on' : ''} onClick={() => useStore.setState({ mode: 'animate' })}>Animate</button>
        </div>
      </div>

      <div className="tb-right">
        <Dropdown
          align="right"
          button={(_o, toggle) => (
            <button className="zoom-btn" onClick={toggle}>{Math.round(zoom * 100)}% <ChevronDown size={10} /></button>
          )}
        >
          {(close) => (
            <>
              <MenuItem label="Zoom in" shortcut="Ctrl +" onClick={() => { zoomAt(zoom * 1.25); close(); }} />
              <MenuItem label="Zoom out" shortcut="Ctrl −" onClick={() => { zoomAt(zoom / 1.25); close(); }} />
              <MenuItem label="Zoom to fit" shortcut="Shift+1" onClick={() => { zoomToFit(); close(); }} />
              <MenuItem label="Zoom to selection" shortcut="Shift+2" onClick={() => { zoomToSelection(); close(); }} />
              <MenuItem label="Zoom to 100%" shortcut="Shift+0" onClick={() => { zoomAt(1); close(); }} />
            </>
          )}
        </Dropdown>
        <button className="icon-btn" title="Keyboard shortcuts (?)" onClick={() => useStore.setState({ dialog: 'shortcuts' })}><Keyboard size={15} /></button>
        <button
          className={`sync-btn ${sync.connected ? 'connected' : ''} ${liveSync ? 'live' : ''}`}
          title={sync.connected ? 'Studio plugin connected' : sync.bridge ? 'Studio plugin not connected' : 'Studio bridge offline (run npm run dev)'}
          onClick={() => useStore.setState({ dialog: 'studio' })}
        >
          <Cable size={14} />
          <span className="dot" />
          {liveSync ? 'Live' : 'Studio'}
        </button>
        <button className="icon-btn" title="Preview (Ctrl+P)" onClick={() => useStore.setState({ dialog: 'preview' })}><Play size={15} /></button>
        <button className="primary" onClick={() => useStore.setState({ dialog: 'export' })}><Code size={14} /> Export</button>
      </div>
    </header>
  );
}
