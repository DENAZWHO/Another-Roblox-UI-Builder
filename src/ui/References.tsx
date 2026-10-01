// Reference images on the canvas, their list in the Layers panel and their properties.
import { useState, type CSSProperties } from 'react';
import { BringToFront, Eye, EyeOff, ImagePlus, Lock, LockOpen, Replace, SendToBack, Trash2 } from 'lucide-react';
import { useStore } from '../store';
import { useRefImage } from '../model/refImages';
import type { RefImage } from '../model/types';
import {
  addReference, fitReference, isImageFile, pickReferenceImages, removeReference, replaceReferenceImage, selectReference, updateReference,
} from '../references';
import { NumberField, Row, Segmented, Toggle } from './fields';

// ---------------------------------------------------------------------------
// Canvas

/** Images with this placement, in canvas coordinates (place inside the zoomed/panned world) */
export function RefLayer({ placement }: { placement: RefImage['placement'] }) {
  const refs = useStore((s) => s.doc.references);
  const list = refs?.filter((r) => r.placement === placement && !r.hidden);
  if (!list?.length) return null;
  return (
    <>
      {list.map((r) => <RefPicture key={r.id} r={r} />)}
    </>
  );
}

function RefPicture({ r }: { r: RefImage }) {
  const src = useRefImage(r.imageId);
  if (!src) return null;
  return <img className="ref-image" src={src} alt="" draggable={false} style={{ left: r.x, top: r.y, width: r.w, height: r.h, opacity: r.opacity }} />;
}

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/**
 * Move or resize a reference with the mouse. Corners keep the aspect ratio (Shift: free),
 * edges stretch. One undo step.
 */
export function dragReference(e: React.PointerEvent | PointerEvent, id: string, handle: 'move' | Handle) {
  const s = useStore.getState();
  const r0 = s.doc.references?.find((r) => r.id === id);
  if (!r0 || r0.locked) return;
  e.stopPropagation();
  e.preventDefault();
  const { zoom } = s;
  const sx = e.clientX;
  const sy = e.clientY;
  s.beginGesture();
  const move = (ev: PointerEvent) => {
    const dx = (ev.clientX - sx) / zoom;
    const dy = (ev.clientY - sy) / zoom;
    let { x, y, w, h } = r0;
    if (handle === 'move') {
      x += dx;
      y += dy;
    } else {
      if (handle.includes('e')) w = r0.w + dx;
      if (handle.includes('w')) w = r0.w - dx;
      if (handle.includes('s')) h = r0.h + dy;
      if (handle.includes('n')) h = r0.h - dy;
      w = Math.max(8, w);
      h = Math.max(8, h);
      if (handle.length === 2 && !ev.shiftKey) {
        const aspect = r0.w / r0.h;
        if (Math.abs(w / r0.w - 1) >= Math.abs(h / r0.h - 1)) h = w / aspect;
        else w = h * aspect;
      }
      if (handle.includes('w')) x = r0.x + r0.w - w;
      if (handle.includes('n')) y = r0.y + r0.h - h;
    }
    useStore.getState().update((d) => {
      const r = d.references?.find((q) => q.id === id);
      if (r) Object.assign(r, { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
    });
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    useStore.getState().endGesture();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

/** Selection box of the selected reference (inside the canvas overlay) */
export function RefSelectionBox() {
  const id = useStore((s) => s.refSelection);
  const r = useStore((s) => s.doc.references?.find((x) => x.id === s.refSelection));
  const zoom = useStore((s) => s.zoom);
  const pan = useStore((s) => s.pan);
  if (!id || !r || r.hidden) return null;
  const style: CSSProperties = { left: pan.x + r.x * zoom, top: pan.y + r.y * zoom, width: r.w * zoom, height: r.h * zoom };
  return (
    <div className={`ref-box ${r.locked ? 'locked' : ''}`} style={style} onPointerDown={(e) => dragReference(e, id, 'move')}>
      <span className="ref-badge">
        {r.locked && <Lock size={10} />} {r.name} · {Math.round(r.opacity * 100)}% · {r.placement === 'behind' ? 'behind UI' : 'over UI'}
      </span>
      {!r.locked && HANDLES.map((h) => <div key={h} className={`handle h-${h}`} onPointerDown={(e) => dragReference(e, id, h)} />)}
      <div className="size-badge">{r.w} × {r.h}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layers panel

const filesOf = (e: React.DragEvent) => Array.from(e.dataTransfer.files).filter(isImageFile);

export function ReferencesSection() {
  const refs = useStore((s) => s.doc.references) ?? [];
  const sel = useStore((s) => s.refSelection);
  const [over, setOver] = useState(false);
  return (
    <div
      className={`refs ${over ? 'drop' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={async (e) => {
        setOver(false);
        const files = filesOf(e);
        if (!files.length) return;
        e.preventDefault();
        for (const f of files) await addReference(f);
      }}
    >
      <div className="layer-section-title">
        <span>References</span>
        <span className="root-add">
          <button title="Add a reference image (or drop / paste one onto the canvas)" onClick={pickReferenceImages}><ImagePlus size={13} /></button>
        </span>
      </div>
      {refs.length === 0 ? (
        <div className="hint refs-empty">Add a mockup or a screenshot to build on: drop an image on the canvas, paste one (Ctrl+V) or press +. Only shown here — never exported.</div>
      ) : (
        <div className="refs-list">
          {[...refs].reverse().map((r) => (
            <div key={r.id} className={`layer ref-row ${sel === r.id ? 'selected' : ''} ${r.hidden ? 'dim' : ''}`} onClick={() => selectReference(r.id)}>
              <RefThumb r={r} />
              <RefName r={r} />
              <span className="layer-actions">
                <button
                  className="on"
                  title={r.placement === 'behind' ? 'Behind the UI — click to put it over the UI' : 'Over the UI — click to put it behind the UI'}
                  onClick={(e) => {
                    e.stopPropagation();
                    updateReference(r.id, { placement: r.placement === 'behind' ? 'over' : 'behind' });
                  }}
                >
                  {r.placement === 'behind' ? <SendToBack size={12} /> : <BringToFront size={12} />}
                </button>
                <button className={r.locked ? 'on' : ''} title={r.locked ? 'Unlock' : 'Lock (clicks go through to your UI)'} onClick={(e) => { e.stopPropagation(); updateReference(r.id, { locked: !r.locked }); }}>
                  {r.locked ? <Lock size={12} /> : <LockOpen size={12} />}
                </button>
                <button className={r.hidden ? 'on' : ''} title={r.hidden ? 'Show' : 'Hide (Shift+R: all)'} onClick={(e) => { e.stopPropagation(); updateReference(r.id, { hidden: !r.hidden }); }}>
                  {r.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RefThumb({ r }: { r: RefImage }) {
  const src = useRefImage(r.imageId);
  return <span className="ref-thumb">{src && <img src={src} alt="" draggable={false} />}</span>;
}

function RefName({ r }: { r: RefImage }) {
  const [editing, setEditing] = useState(false);
  if (editing)
    return (
      <input
        className="layer-rename"
        autoFocus
        defaultValue={r.name}
        onClick={(e) => e.stopPropagation()}
        onBlur={(e) => {
          const name = e.target.value.trim();
          if (name && name !== r.name) updateReference(r.id, { name });
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
    <span className="layer-name" onDoubleClick={(e) => (e.stopPropagation(), setEditing(true))}>
      {r.name}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Properties panel

export function ReferenceProps({ id }: { id: string }) {
  const r = useStore((s) => s.doc.references?.find((x) => x.id === id));
  const [keepAspect, setKeepAspect] = useState(true);
  if (!r) return null;
  const set = (patch: Partial<RefImage>, key?: string) => updateReference(id, patch, key);
  const aspect = r.natW / r.natH;
  const replace = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => input.files?.[0] && replaceReferenceImage(id, input.files[0]);
    input.click();
  };
  return (
    <>
      <section className="section">
        <div className="section-title">
          <span>Reference image</span>
          <span className="section-actions">
            <button className="btn tiny" title="Delete (Del)" onClick={() => removeReference(id)}><Trash2 size={11} /></button>
          </span>
        </div>
        <div className="section-body">
          <RefPreview r={r} />
          <Row label="Name">
            <input className="text" value={r.name} onChange={(e) => set({ name: e.target.value }, 'refname')} onKeyDown={(e) => e.stopPropagation()} />
          </Row>
          <Row label="Placement" title="Behind: a background to build your UI on. Over: on top, to trace or compare with your UI.">
            <Segmented
              value={r.placement}
              options={[
                { value: 'behind', label: 'Behind UI', title: 'A background under your UI' },
                { value: 'over', label: 'Over UI', title: 'On top of your UI, to trace or compare (clicks still reach the UI)' },
              ]}
              onChange={(placement) => set({ placement })}
            />
          </Row>
          <Row label="Opacity">
            <div className="pair ref-opacity">
              <input type="range" min={0} max={100} value={Math.round(r.opacity * 100)} onChange={(e) => set({ opacity: +e.target.value / 100 }, 'refopacity')} />
              <NumberField value={Math.round(r.opacity * 100)} min={0} max={100} suffix="%" onChange={(v) => set({ opacity: v / 100 })} />
            </div>
          </Row>
          <div className="ref-quick">
            {[25, 50, 75, 100].map((p) => (
              <button key={p} className={`btn tiny ${Math.round(r.opacity * 100) === p ? 'on' : ''}`} onClick={() => set({ opacity: p / 100 })}>{p}%</button>
            ))}
          </div>
          <Row label="">
            <div className="ref-toggles">
              <Toggle value={!r.hidden} onChange={(v) => set({ hidden: !v })} label="Visible" />
              <Toggle value={!!r.locked} onChange={(v) => set({ locked: v })} label="Locked" />
            </div>
          </Row>
        </div>
      </section>
      <section className="section">
        <div className="section-title">
          <span>Position & size</span>
        </div>
        <div className="section-body">
          <Row label="Position">
            <div className="pair">
              <NumberField label="X" value={r.x} onChange={(x) => set({ x })} />
              <NumberField label="Y" value={r.y} onChange={(y) => set({ y })} />
            </div>
          </Row>
          <Row label="Size">
            <div className="pair">
              <NumberField label="W" value={r.w} min={8} onChange={(w) => set(keepAspect ? { w, h: Math.round(w / aspect) } : { w })} />
              <NumberField label="H" value={r.h} min={8} onChange={(h) => set(keepAspect ? { h, w: Math.round(h * aspect) } : { h })} />
            </div>
          </Row>
          <Row label="">
            <Toggle value={keepAspect} onChange={setKeepAspect} label="Keep aspect ratio" />
          </Row>
          <div className="ref-fit">
            <button className="btn small" title="Whole image inside the screen" onClick={() => fitReference(id, 'contain')}>Fit screen</button>
            <button className="btn small" title="Cover the whole screen (crops the edges that stick out)" onClick={() => fitReference(id, 'cover')}>Fill screen</button>
            <button className="btn small" title={`1 image pixel = 1 screen pixel (${r.natW}×${r.natH})`} onClick={() => fitReference(id, 'natural')}>Actual size</button>
            <button className="btn small" title="Use a different picture here" onClick={replace}><Replace size={11} /> Replace</button>
          </div>
          <p className="hint">
            References are only shown in the editor — they're never exported or sent to Studio.
            {!r.locked && ' Lock it so clicks on it select your UI instead.'}
          </p>
        </div>
      </section>
    </>
  );
}

function RefPreview({ r }: { r: RefImage }) {
  const src = useRefImage(r.imageId);
  return <div className="ref-preview">{src ? <img src={src} alt="" draggable={false} /> : <span className="muted">Loading…</span>}</div>;
}
