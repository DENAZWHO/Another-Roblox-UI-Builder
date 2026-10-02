import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, Download, Pause, Play, RotateCcw, Search, X } from 'lucide-react';
import { keyLabel, MOUSE_WORDS, SHORTCUT_GROUPS, type Shortcut } from './shortcuts';
import { useStore } from '../store';
import { generateLuau } from '../export/luau';
import { generateRbxmx } from '../export/rbxmx';
import { computeLayout } from '../model/layout';
import { UIRuntime, clickButtons, clipTrigger } from '../model/runtime';
import { applyPixelScale, pixelScaleFactor } from '../model/pixelScale';
import { TRIGGER_LABELS } from './labels';
import { DEVICES, isGuiObject, isWorldGui } from '../model/schema';
import { download, projectJson, projectName } from '../files';
import { pushToStudio, useSyncStatus } from '../sync';
import { DeviceCutouts, ScreenView, TopbarMock, type RenderCtx } from './render';
import { firstSelectable, navigate } from './GamepadPanel';
import { useFontEpoch } from './hooks';
import { Segmented, Toggle } from './fields';
import { MenuItem, useClickOutside } from './Toolbar';
import {
  convertUnits, copySelection, makeResponsive, savePrefabFromSelection, cutSelection, deleteSelection, duplicateSelection, groupSelection, pasteClipboard, reorder,
  toggleLocked, toggleVisible, ungroupSelection,
} from '../actions';
import { screensOf } from '../model/screens';

function Modal({ title, children, onClose, wide, footer }: { title: ReactNode; children: ReactNode; onClose: () => void; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`}>
        <div className="modal-head">
          <span>{title}</span>
          <button className="icon-btn" onClick={onClose}><X size={15} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

const close = () => useStore.setState({ dialog: null });

export function Dialogs() {
  const dialog = useStore((s) => s.dialog);
  if (dialog === 'export') return <ExportDialog />;
  if (dialog === 'preview') return <PreviewDialog />;
  if (dialog === 'shortcuts') return <ShortcutsDialog />;
  if (dialog === 'studio') return <StudioDialog />;
  return null;
}

// ---------------------------------------------------------------------------
// Export

function highlightLua(code: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(--[^\n]*)|("(?:[^"\\\n]|\\.)*")|\b(\d+(?:\.\d+)?)\b|\b(local|function|end|return|if|then|else|elseif|for|in|do|while|true|false|nil|and|or|not)\b|\b(Instance|UDim2|UDim|Vector2|Color3|Enum|Font|ColorSequence|ColorSequenceKeypoint|NumberSequence|NumberSequenceKeypoint|TweenInfo|Rect|game|task|math)\b/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(code))) {
    if (m.index > last) out.push(code.slice(last, m.index));
    const cls = m[1] ? 'c' : m[2] ? 's' : m[3] ? 'n' : m[4] ? 'k' : 'g';
    out.push(<span key={i++} className={`hl-${cls}`}>{m[0]}</span>);
    last = m.index + m[0].length;
  }
  out.push(code.slice(last));
  return out;
}

function ExportDialog() {
  const doc = useStore((s) => s.doc);
  const [tab, setTab] = useState<'luau' | 'rbxmx' | 'json'>('luau');
  const [style, setStyle] = useState<'localscript' | 'module'>('localscript');
  const [behavior, setBehavior] = useState(true);
  const [copied, setCopied] = useState(false);
  const hasBehavior =
    doc.scalePixels !== false || clickButtons(doc).length > 0 || doc.clips.some((c) => c.tweens.length) || Object.values(doc.nodes).some((n) => n.effects?.length || n.avatar || n.bind || n.adornee || n.toast || n.events?.length || n.boundingUI || n.nav);

  const code = useMemo(() => {
    if (tab === 'luau') return generateLuau(doc, { style, behavior });
    if (tab === 'rbxmx') return generateRbxmx(doc, { behaviorScript: behavior });
    return projectJson(doc);
  }, [tab, doc, style, behavior]);

  const name = projectName();
  const filename = tab === 'luau' ? `${name}.lua` : tab === 'rbxmx' ? `${name}.rbxmx` : `${name}.uibuilder.json`;
  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Modal
      title="Export"
      wide
      onClose={close}
      footer={
        <>
          <span className="muted">{code.split('\n').length} lines</span>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={copy}>{copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}</button>
          <button className="primary" onClick={() => download(filename, code)}><Download size={13} /> Download {filename}</button>
        </>
      }
    >
      <div className="export-top">
        <Segmented
          value={tab}
          options={[
            { value: 'luau', label: 'Luau script' },
            { value: 'rbxmx', label: 'Model file (.rbxmx)' },
            { value: 'json', label: 'Project (.json)' },
          ]}
          onChange={setTab}
        />
        {tab === 'luau' && <Segmented value={style} options={[{ value: 'localscript', label: 'LocalScript' }, { value: 'module', label: 'ModuleScript' }]} onChange={setStyle} />}
        {tab !== 'json' && hasBehavior && (
          <Toggle value={behavior} onChange={setBehavior} label={tab === 'rbxmx' ? 'Include behaviour LocalScript (animations, events, effects, avatars, pixel scaling)' : 'Include animations, events, effects & avatars'} />
        )}
        {tab !== 'json' && <ClickPrintsToggle />}
      </div>
      <p className="hint export-hint">
        {tab === 'luau' && style === 'localscript' && <>Paste into a <b>LocalScript</b> in <code>StarterPlayerScripts</code>. It builds the UI with <code>Instance.new</code> at runtime.</>}
        {tab === 'luau' && style === 'module' && <>Paste into a <b>ModuleScript</b>; call <code>require(module).create()</code> from a LocalScript. Returns every instance by name plus <code>ui.animations</code>.</>}
        {tab === 'rbxmx' && <>In Studio, right-click <b>StarterGui → Insert from File…</b> and pick the downloaded <code>.rbxmx</code>. The GUIs appear as real instances you can keep editing in Studio. A BillboardGui/SurfaceGui finds its part from the Adornee path you set (or move it into a part yourself).</>}
        {tab === 'json' && <>Editable project file — reopen it later with <b>Menu → Open project</b>.</>}
      </p>
      <pre className="code">{tab === 'luau' ? highlightLua(code) : code}</pre>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Studio plugin sync

/** Doc setting: generated scripts print when each button is clicked */
function ClickPrintsToggle() {
  const on = useStore((s) => s.doc.clickPrints !== false);
  const count = useStore((s) => Object.values(s.doc.nodes).filter((n) => n.className === 'TextButton' || n.className === 'ImageButton').length);
  return (
    <span title="Each TextButton / ImageButton gets MouseButton1Click:Connect(function() print(&quot;Name clicked&quot;) end) — a stub to put your own code in">
      <Toggle
        value={on}
        onChange={(v) => useStore.getState().update((d) => void (d.clickPrints = v))}
        label={`Connect buttons: print on MouseButton1Click${count ? ` (${count})` : ''}`}
      />
    </span>
  );
}

function StudioDialog() {
  const live = useStore((s) => s.liveSync);
  const sync = useSyncStatus();
  return (
    <Modal title="Sync with Roblox Studio" onClose={close}>
      <div className={`sync-status ${sync.connected ? 'ok' : sync.bridge ? 'wait' : 'off'}`}>
        <span className="dot" />
        {sync.connected ? 'Studio plugin connected' : sync.bridge ? 'Waiting for the Studio plugin…' : 'Bridge offline — start the app with npm run dev'}
        {sync.connected && sync.lastApplied > 0 && <span className="muted"> · Studio has v{sync.lastApplied} of {sync.version}</span>}
      </div>
      <ol className="steps">
        <li>
          Install the plugin once: run <code>npm run install-plugin</code> in the project folder, or{' '}
          <a href="/api/studio/plugin" download="UIBuilderSync.lua">download UIBuilderSync.lua</a> into your Studio <b>Plugins</b> folder
          (<code>%LOCALAPPDATA%\Roblox\Plugins</code> on Windows). Restart Studio.
        </li>
        <li>In Studio open the <b>Plugins</b> tab → <b>UI Builder</b> → <b>Live Sync</b>. Allow HTTP access to <code>localhost</code> when asked.</li>
        <li>Press <b>Send now</b>, or turn on live sync to push every change automatically.</li>
      </ol>
      <p className="hint">
        Synced GUIs go into <code>StarterGui</code> and are tagged with a <code>UIBuilderId</code> attribute; each sync replaces them (with a Studio undo waypoint).
        <b> Two-way:</b> when you change a property of a synced GUI in Studio (colours, gradients, sizes, text…), the plugin sends it back here, so the next sync keeps it.
        Adding or deleting instances in Studio isn't synced back — do that here.
      </p>
      <div className="sync-actions">
        <ClickPrintsToggle />
        <Toggle
          value={live}
          onChange={(v) => {
            useStore.setState({ liveSync: v });
            if (v) pushToStudio(true);
          }}
          label="Live sync (push on every change)"
        />
        <span style={{ flex: 1 }} />
        <button className="primary" onClick={() => pushToStudio()}>Send now</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Preview (play mode)

function PreviewDialog() {
  const doc = useStore((s) => s.doc);
  const epoch = useFontEpoch();
  const [device, setDevice] = useState(doc.device);
  // 'screen' or a world GUI id
  const [view, setView] = useState<string>('screen');
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [runKey, setRunKey] = useState(0);
  const [paused, setPaused] = useState(false);
  const [, setFrame] = useState(0);
  const runtime = useMemo(() => {
    const r = new UIRuntime(doc);
    r.start();
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, runKey]);
  const stageRef = useRef<HTMLDivElement>(null);
  const worldRoots = doc.rootIds.filter((id) => isWorldGui(doc.nodes[id].className));
  const viewRoot = view !== 'screen' && doc.nodes[view] ? view : null;
  const screens = screensOf(doc);

  // gamepad / keyboard navigation (arrows = D-pad, Enter = A)
  const [gpSel, setGpSel] = useState<string | null>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const dir = ({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' } as const)[e.key as 'ArrowUp'];
      const lay = layoutRef.current;
      const live = runtime.nodes();
      if (dir) {
        e.preventDefault();
        setGpSel((cur) => (cur && lay.rects[cur] ? navigate(live, lay, cur, dir) : firstSelectable(live, lay)));
      } else if (e.key === 'Enter' && gpSel) {
        e.preventDefault();
        runtime.event(gpSel, 'down');
        runtime.event(gpSel, 'up');
        runtime.event(gpSel, 'click');
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [runtime, gpSel]);

  useEffect(() => {
    const up = () => runtime.release();
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, [runtime]);

  useEffect(() => {
    const r = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', r);
    return () => window.removeEventListener('resize', r);
  }, []);

  const nodes = applyPixelScale(runtime.nodes(), doc.rootIds, pixelScaleFactor(doc, device));
  const layout = useMemo(() => {
    // native scrolling in preview: lay out with CanvasPosition at 0
    const flat: typeof nodes = {};
    for (const [id, n] of Object.entries(nodes)) flat[id] = n.className === 'ScrollingFrame' ? { ...n, props: { ...n.props, CanvasPosition: { x: 0, y: 0 } } } : n;
    return computeLayout(flat, doc.rootIds, device);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, doc.rootIds, device, epoch]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  useEffect(() => {
    if (paused) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      runtime.tick(Math.min(0.1, (now - last) / 1000), layoutRef.current);
      last = now;
      setFrame((f) => f + 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [runtime, paused]);

  const area = viewRoot ? layout.artboards[viewRoot] : { x: 0, y: 0, w: device.w, h: device.h };
  const scale = area ? Math.min((size.w - 80) / area.w, (size.h - 140) / area.h, viewRoot ? 3 : 1.5) : 1;
  const eventIds = useMemo(() => runtime.interactiveIds(), [runtime]);
  const ctx: RenderCtx = {
    nodes, layout, interactive: true, scales: runtime.scales, previewUser: doc.previewUser, eventIds, pixelScale: pixelScaleFactor(doc, device),
    onEvent: (id, ev) => runtime.event(id, ev),
  };
  const onMouse = (e: React.PointerEvent) => {
    const b = stageRef.current?.getBoundingClientRect();
    if (!b || !area) return;
    runtime.mouse = { x: area.x + (e.clientX - b.left) / scale, y: area.y + (e.clientY - b.top) / scale };
  };
  const manual = doc.clips.filter((c) => c.tweens.length);

  return (
    <div className="preview">
      <div className="preview-bar">
        <select
          value={view}
          onChange={(e) => {
            const v = e.target.value;
            if (v.startsWith('screen:')) {
              runtime.showScreen(v.slice(7));
              setView('screen');
            } else setView(v);
          }}
        >
          <option value="screen">Screen</option>
          {screens.length > 1 && screens.map((s) => <option key={s.id} value={'screen:' + s.id}>Show screen: {s.name}</option>)}
          {worldRoots.map((id) => <option key={id} value={id}>{doc.nodes[id].className}: {doc.nodes[id].name}</option>)}
        </select>
        {!viewRoot && (
          <select value={DEVICES.find((d) => d.name === device.name)?.name ?? ''} onChange={(e) => setDevice(DEVICES.find((d) => d.name === e.target.value) ?? doc.device)}>
            {!DEVICES.some((d) => d.name === device.name) && <option value="">{device.name} ({device.w}×{device.h})</option>}
            {DEVICES.map((d) => <option key={d.name} value={d.name}>{d.name} ({d.w}×{d.h})</option>)}
          </select>
        )}
        <button className="icon-btn" onClick={() => setPaused(!paused)} title={paused ? 'Resume' : 'Pause'}>{paused ? <Play size={14} /> : <Pause size={14} />}</button>
        <button className="icon-btn" onClick={() => setRunKey((k) => k + 1)} title="Restart (re-runs on-load animations)"><RotateCcw size={14} /></button>
        {runtime.toastTemplates().length > 0 && (
          <select value="" onChange={(e) => e.target.value && runtime.showToast(e.target.value)} title="Show a toast now">
            <option value="">Show toast…</option>
            {runtime.toastTemplates().map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        {manual.length > 0 && (
          <select value="" onChange={(e) => e.target.value && runtime.play(e.target.value)} title="Play an animation now">
            <option value="">Play animation…</option>
            {manual.map((c) => <option key={c.id} value={c.id}>{c.name} ({TRIGGER_LABELS[clipTrigger(c)]})</option>)}
          </select>
        )}
        <span style={{ flex: 1 }} />
        <span className="muted">Hover and click to test triggers & effects · arrows + Enter = gamepad · Esc to close</span>
        <button className="icon-btn" onClick={close}><X size={16} /></button>
      </div>
      <PreviewEscape />
      <div className="preview-stage">
        {area && (
          <div
            ref={stageRef}
            className={`preview-device ${viewRoot ? 'world' : ''}`}
            style={{ width: area.w * scale, height: area.h * scale }}
            onPointerMove={onMouse}
            onPointerLeave={() => (runtime.mouse = null)}
          >
            <div style={{ width: area.w, height: area.h, transform: `scale(${scale})`, transformOrigin: '0 0', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', left: -area.x, top: -area.y }}>
                {(viewRoot ? [viewRoot] : doc.rootIds.filter((id) => !isWorldGui(doc.nodes[id].className))).map((id) => <ScreenView key={id} id={id} ctx={ctx} />)}
              </div>
              {!viewRoot && doc.showTopbar && <TopbarMock device={device} />}
              {!viewRoot && <DeviceCutouts device={device} />}
              {gpSel && layout.rects[gpSel] && (
                <div className="gp-highlight" style={{ left: layout.rects[gpSel].x - area.x - 4, top: layout.rects[gpSel].y - area.y - 4, width: layout.rects[gpSel].w + 8, height: layout.rects[gpSel].h + 8 }} />
              )}
            </div>
          </div>
        )}
        {clickButtons(doc).length > 0 && <PreviewOutput lines={runtime.output} />}
      </div>
    </div>
  );
}

/** Studio-style Output window with what the generated scripts print */
function PreviewOutput({ lines }: { lines: { text: string; time: number }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const last = lines[lines.length - 1]?.time;
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [last]);
  const stamp = (t: number) => new Date(t).toLocaleTimeString([], { hour12: false }) + '.' + String(t % 1000).padStart(3, '0');
  return (
    <div className="preview-output">
      <div className="preview-output-title">Output</div>
      <div className="preview-output-lines" ref={ref}>
        {lines.length === 0 ? (
          <div className="muted">Click a button — its MouseButton1Click print shows up here.</div>
        ) : (
          lines.map((l, i) => (
            <div key={i}>
              <span className="muted">{stamp(l.time)}  </span>
              {l.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function PreviewEscape() {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  return null;
}

// ---------------------------------------------------------------------------

function ComboView({ combo }: { combo: string[] }) {
  return (
    <span className="combo">
      {combo.map((k, i) => {
        const hint = /^[a-z]/.test(k);
        return (
          <span key={i} className="combo-part">
            {i > 0 && !hint && <span className="plus">+</span>}
            {hint ? <span className="combo-hint">{k}</span> : MOUSE_WORDS.has(k) ? <span className="mouse">{k}</span> : <kbd>{keyLabel(k)}</kbd>}
          </span>
        );
      })}
    </span>
  );
}

function ShortcutsDialog() {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const matches = (sc: Shortcut, group: string) =>
    !q || sc.label.toLowerCase().includes(q) || group.toLowerCase().includes(q) || (sc.note ?? '').toLowerCase().includes(q) ||
    sc.combos.some((c) => c.map(keyLabel).join('+').toLowerCase().includes(q) || c.join('+').toLowerCase().includes(q));
  const groups = SHORTCUT_GROUPS.map((g) => ({ ...g, items: g.items.filter((sc) => matches(sc, g.title)) })).filter((g) => g.items.length);
  const total = SHORTCUT_GROUPS.reduce((n, g) => n + g.items.length, 0);
  return (
    <Modal title="Keyboard shortcuts & gestures" wide onClose={close}>
      <div className="sc-top">
        <div className="search sc-search">
          <Search size={13} />
          <input autoFocus placeholder={`Search ${total} shortcuts — try "zoom", "Ctrl+G" or "corner"`} value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && <button onClick={() => setQuery('')}><X size={12} /></button>}
        </div>
        <span className="muted">Open this anytime with <kbd>?</kbd> or <kbd>{keyLabel('Mod')}</kbd><span className="plus">+</span><kbd>/</kbd></span>
      </div>
      {groups.length === 0 && <div className="sc-empty">No shortcut matches "{query}".</div>}
      <div className="sc-grid">
        {groups.map((g) => (
          <section key={g.title} className="sc-group">
            <h3>{g.title}</h3>
            {g.items.map((sc) => (
              <div key={sc.label} className="sc-row">
                <div className="sc-label">
                  {sc.label}
                  {sc.note && <span className="sc-note">{sc.note}</span>}
                </div>
                <div className="sc-keys">
                  {sc.combos.map((c, i) => (
                    <span key={i} className="sc-alt">
                      {i > 0 && <span className="sc-or">or</span>}
                      <ComboView combo={c} />
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>
      <p className="hint sc-foot">
        Some browsers keep {keyLabel('Mod')}+D, {keyLabel('Mod')}+P or {keyLabel('Mod')}+E for themselves (bookmark, print, search). If one doesn't work, use the toolbar button or the right-click menu instead.
      </p>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

export function ContextMenu() {
  const menu = useStore((s) => s.menu);
  const selection = useStore((s) => s.selection);
  const doc = useStore((s) => s.doc);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => useStore.setState({ menu: null }), !!menu);
  if (!menu) return null;
  const gui = selection.filter((id) => doc.nodes[id] && isGuiObject(doc.nodes[id].className));
  const run = (fn: () => void) => () => {
    useStore.setState({ menu: null });
    fn();
  };
  const x = Math.min(menu.x, window.innerWidth - 230);
  const y = Math.min(menu.y, window.innerHeight - 420);
  const first = gui[0] ? doc.nodes[gui[0]] : null;
  return (
    <div className="menu context" ref={ref} style={{ left: x, top: y }}>
      <MenuItem label="Copy" shortcut="Ctrl+C" disabled={!selection.length} onClick={run(copySelection)} />
      <MenuItem label="Cut" shortcut="Ctrl+X" disabled={!selection.length} onClick={run(cutSelection)} />
      <MenuItem label="Paste" shortcut="Ctrl+V" onClick={run(pasteClipboard)} />
      <MenuItem label="Duplicate" shortcut="Ctrl+D" disabled={!selection.length} onClick={run(duplicateSelection)} />
      <MenuItem label="Delete" shortcut="Del" disabled={!selection.length} onClick={run(deleteSelection)} />
      <div className="menu-sep" />
      <MenuItem label="Group into Frame" shortcut="Ctrl+G" disabled={!gui.length} onClick={run(groupSelection)} />
      <MenuItem label="Ungroup" shortcut="Ctrl+Shift+G" disabled={!gui.length} onClick={run(ungroupSelection)} />
      <MenuItem label="Bring to front" shortcut="Ctrl+]" disabled={!gui.length} onClick={run(() => reorder('front'))} />
      <MenuItem label="Send to back" shortcut="Ctrl+[" disabled={!gui.length} onClick={run(() => reorder('back'))} />
      <div className="menu-sep" />
      <MenuItem label="Save as prefab" shortcut="Ctrl+Alt+K" disabled={!gui.length} onClick={run(() => savePrefabFromSelection())} />
      <MenuItem label="Make responsive" disabled={!gui.length} onClick={run(() => makeResponsive(gui))} />
      <MenuItem label="Convert to Scale" disabled={!gui.length} onClick={run(() => convertUnits(gui, 'scale'))} />
      <MenuItem label="Convert to Offset" disabled={!gui.length} onClick={run(() => convertUnits(gui, 'offset'))} />
      <div className="menu-sep" />
      <MenuItem label={first?.props.Visible === false ? 'Show' : 'Hide'} shortcut="Ctrl+Shift+H" disabled={!gui.length} onClick={run(() => gui.forEach(toggleVisible))} />
      <MenuItem label={first?.locked ? 'Unlock' : 'Lock'} shortcut="Ctrl+Shift+L" disabled={!gui.length} onClick={run(() => gui.forEach(toggleLocked))} />
    </div>
  );
}

export function Toast() {
  const toast = useStore((s) => s.toast);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!toast) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 2600);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast || !visible) return null;
  return <div className="toast">{toast.text}</div>;
}
