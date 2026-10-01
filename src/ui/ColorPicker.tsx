import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pipette, X } from 'lucide-react';
import { useStore } from '../store';
import { CLASS_PROPS } from '../model/schema';

// ---------------------------------------------------------------------------
// colour maths

export interface HSV { h: number; s: number; v: number }

export function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt((hex || '#000000').slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
export function rgbToHex(r: number, g: number, b: number) {
  const c = (x: number) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
export function hexToHsv(hex: string): HSV {
  const [r, g, b] = hexToRgb(hex).map((x) => x / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}
export function hsvToHex({ h, s, v }: HSV) {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return rgbToHex(f(5) * 255, f(3) * 255, f(1) * 255);
}

const PALETTE = ['#ffffff', '#000000', '#ff4d4f', '#ffb020', '#ffd23f', '#3ecf5a', '#00b8a9', '#4fb3ff', '#4f7cff', '#8c5aff', '#f24ea8', '#1f2233'];

/** Colours already used in the document, most frequent first */
function useDocumentColors() {
  const doc = useStore((s) => s.doc);
  return useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of Object.values(doc.nodes)) {
      for (const def of CLASS_PROPS[n.className]) {
        const v = n.props[def.name];
        if (def.type === 'Color3' && typeof v === 'string') counts.set(v.toLowerCase(), (counts.get(v.toLowerCase()) ?? 0) + 1);
        if (def.type === 'ColorSequence' && Array.isArray(v)) for (const k of v) counts.set(k.c.toLowerCase(), (counts.get(k.c.toLowerCase()) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, 18);
  }, [doc.nodes]);
}

// ---------------------------------------------------------------------------

/** Drag inside an element; reports 0..1 coordinates. Wraps the drag in one undo step. */
function useDrag(onMove: (x: number, y: number) => void) {
  return (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    const b = el.getBoundingClientRect();
    const report = (cx: number, cy: number) => onMove(Math.max(0, Math.min(1, (cx - b.left) / b.width)), Math.max(0, Math.min(1, (cy - b.top) / b.height)));
    useStore.getState().beginGesture();
    report(e.clientX, e.clientY);
    const move = (ev: PointerEvent) => report(ev.clientX, ev.clientY);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      useStore.getState().endGesture();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
}

interface PickerProps {
  value: string;
  onChange: (hex: string) => void;
  transparency?: number;
  onTransparency?: (t: number) => void;
  anchor: DOMRect;
  onClose: () => void;
}

export function ColorPicker({ value, onChange, transparency, onTransparency, anchor, onClose }: PickerProps) {
  const [hsv, setHsv] = useState<HSV>(() => hexToHsv(value));
  const last = useRef(value);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const docColors = useDocumentColors();

  // follow outside changes (undo, other selection) without losing hue on greys
  useEffect(() => {
    if (value.toLowerCase() !== last.current.toLowerCase()) {
      last.current = value;
      setHsv((cur) => {
        const n = hexToHsv(value);
        return n.s === 0 || n.v === 0 ? { ...n, h: cur.h } : n;
      });
    }
  }, [value]);

  useLayoutEffect(() => {
    const w = 240;
    const h = ref.current?.offsetHeight ?? 380;
    let left = anchor.left - w - 12;
    if (left < 8) left = Math.min(window.innerWidth - w - 8, anchor.right + 12);
    const top = Math.max(8, Math.min(window.innerHeight - h - 8, anchor.top - 40));
    setPos({ left, top });
  }, [anchor]);

  useEffect(() => {
    const down = (e: PointerEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // don't let the editor's Escape shortcut (deselect) fire too
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [onClose]);

  const emit = (next: HSV) => {
    setHsv(next);
    const hex = hsvToHex(next);
    last.current = hex;
    onChange(hex);
  };
  const setHex = (hex: string) => {
    last.current = hex;
    setHsv(hexToHsv(hex));
    onChange(hex);
  };

  const svDrag = useDrag((x, y) => emit({ ...hsv, s: x, v: 1 - y }));
  const hueDrag = useDrag((x) => emit({ ...hsv, h: Math.min(359.9, x * 360) }));
  const tDrag = useDrag((x) => onTransparency?.(+x.toFixed(2)));
  const [r, g, b] = hexToRgb(value);
  const pure = hsvToHex({ h: hsv.h, s: 1, v: 1 });

  const pickScreen = async () => {
    try {
      const res = await new (window as any).EyeDropper().open();
      setHex(res.sRGBHex.toLowerCase());
    } catch {
      /* cancelled */
    }
  };

  return createPortal(
    <div className="cp" ref={ref} style={pos} onPointerDown={(e) => e.stopPropagation()}>
      <div className="cp-head">
        <span>Color</span>
        <button className="icon-btn" onClick={onClose}><X size={13} /></button>
      </div>
      <div className="cp-sv" style={{ background: pure }} onPointerDown={svDrag}>
        <div className="cp-sv-white" />
        <div className="cp-sv-black" />
        <div className="cp-thumb" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: value }} />
      </div>
      <div className="cp-row">
        {'EyeDropper' in window && (
          <button className="icon-btn" title="Pick a colour from the screen" onClick={pickScreen}><Pipette size={14} /></button>
        )}
        <div className="cp-sliders">
          <div className="cp-hue" onPointerDown={hueDrag}>
            <div className="cp-knob" style={{ left: `${(hsv.h / 360) * 100}%`, background: pure }} />
          </div>
          {onTransparency && (
            <div className="cp-alpha" onPointerDown={tDrag} title="Transparency (left = opaque)">
              <div className="cp-alpha-fill" style={{ background: `linear-gradient(90deg, ${value}, transparent)` }} />
              <div className="cp-knob" style={{ left: `${(transparency ?? 0) * 100}%`, background: value }} />
            </div>
          )}
        </div>
      </div>
      <div className="cp-inputs">
        <label className="cp-field wide">
          <HexInput value={value} onCommit={setHex} />
          <span>Hex</span>
        </label>
        {(['R', 'G', 'B'] as const).map((k, i) => (
          <label className="cp-field" key={k}>
            <ChannelInput
              value={[r, g, b][i]}
              onCommit={(v) => {
                const c = [r, g, b];
                c[i] = v;
                setHex(rgbToHex(c[0], c[1], c[2]));
              }}
            />
            <span>{k}</span>
          </label>
        ))}
        {onTransparency && (
          <label className="cp-field">
            <ChannelInput value={Math.round((transparency ?? 0) * 100)} max={100} onCommit={(v) => onTransparency(v / 100)} />
            <span>T%</span>
          </label>
        )}
      </div>
      {docColors.length > 0 && (
        <>
          <div className="cp-label">In this document</div>
          <div className="cp-swatches">
            {docColors.map((c) => <button key={c} style={{ background: c }} title={c} onClick={() => setHex(c)} className={c === value.toLowerCase() ? 'on' : ''} />)}
          </div>
        </>
      )}
      <div className="cp-label">Palette</div>
      <div className="cp-swatches">
        {PALETTE.map((c) => <button key={c} style={{ background: c }} title={c} onClick={() => setHex(c)} className={c === value.toLowerCase() ? 'on' : ''} />)}
      </div>
    </div>,
    document.body,
  );
}

function HexInput({ value, onCommit }: { value: string; onCommit: (hex: string) => void }) {
  const [text, setText] = useState(value.slice(1).toUpperCase());
  useEffect(() => setText(value.slice(1).toUpperCase()), [value]);
  const commit = () => {
    let h = text.replace(/[^0-9a-f]/gi, '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (h.length === 6) onCommit('#' + h.toLowerCase());
    else setText(value.slice(1).toUpperCase());
  };
  return <input value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />;
}

function ChannelInput({ value, onCommit, max = 255 }: { value: number; onCommit: (v: number) => void; max?: number }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const v = parseInt(text, 10);
    if (!isNaN(v)) onCommit(Math.max(0, Math.min(max, v)));
    else setText(String(value));
  };
  return <input value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />;
}
