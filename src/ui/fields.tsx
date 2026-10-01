import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../store';
import { ColorPicker } from './ColorPicker';
import type { UDim, UDim2, Vec2 } from '../model/types';

const fmt = (v: number, precision: number) => {
  if (v === Infinity) return '∞';
  if (v === -Infinity) return '-∞';
  return String(+(+v).toFixed(precision));
};

function evalExpr(text: string): number | null {
  const t = text.trim().replace(/,/g, '.');
  if (t === '∞' || /^inf/i.test(t)) return Infinity;
  if (!/^[-+*/().\d\s]+$/.test(t)) return null;
  try {
    const v = Function(`"use strict";return (${t})`)();
    return typeof v === 'number' && isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

interface NumberFieldProps {
  label?: ReactNode;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  precision?: number;
  title?: string;
  suffix?: string;
  className?: string;
}

/** Figma-style number input: drag the label to scrub, type expressions like 100/2 */
export function NumberField({ label, value, onChange, step = 1, min = -Infinity, max = Infinity, precision = 3, title, suffix, className }: NumberFieldProps) {
  const [text, setText] = useState(fmt(value, precision));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(fmt(value, precision));
  }, [value, focused, precision]);

  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const commit = () => {
    const v = evalExpr(text);
    if (v !== null && v !== value) onChange(clamp(v));
    else setText(fmt(value, precision));
  };

  const onScrub = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const start = value === Infinity ? 0 : value;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    useStore.getState().beginGesture();
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const mult = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
      const v = clamp(+(start + Math.round(dx / 2) * step * mult).toFixed(6));
      onChange(v);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      useStore.getState().endGesture();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  return (
    <label className={`nf ${className ?? ''}`} title={title}>
      {label !== undefined && (
        <span className="nf-label" onPointerDown={onScrub}>
          {label}
        </span>
      )}
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => {
          setFocused(true);
          e.target.select();
        }}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setText(fmt(value, precision));
            setFocused(false);
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            const v = clamp(+((value === Infinity ? 0 : value) + d).toFixed(6));
            onChange(v);
            setText(fmt(v, precision));
          }
        }}
      />
      {suffix && <span className="nf-suffix">{suffix}</span>}
    </label>
  );
}

export function UDimField({ value, onChange, labels = ['S', 'O'] }: { value: UDim; onChange: (v: UDim) => void; labels?: [string, string] }) {
  return (
    <div className="pair">
      <NumberField label={labels[0]} title="Scale" value={value.s} step={0.01} precision={4} onChange={(s) => onChange({ ...value, s })} />
      <NumberField label={labels[1]} title="Offset (px)" value={value.o} step={1} onChange={(o) => onChange({ ...value, o })} />
    </div>
  );
}

export function UDim2Field({ value, onChange }: { value: UDim2; onChange: (v: UDim2) => void }) {
  return (
    <div className="udim2">
      <div className="udim2-row">
        <span className="axis">X</span>
        <UDimField value={value.x} onChange={(x) => onChange({ ...value, x })} />
      </div>
      <div className="udim2-row">
        <span className="axis">Y</span>
        <UDimField value={value.y} onChange={(y) => onChange({ ...value, y })} />
      </div>
    </div>
  );
}

export function Vec2Field({ value, onChange, step = 1, labels = ['X', 'Y'] }: { value: Vec2; onChange: (v: Vec2) => void; step?: number; labels?: [string, string] }) {
  return (
    <div className="pair">
      <NumberField label={labels[0]} value={value.x} step={step} onChange={(x) => onChange({ ...value, x })} />
      <NumberField label={labels[1]} value={value.y} step={step} onChange={(y) => onChange({ ...value, y })} />
    </div>
  );
}

export function ColorField({ value, onChange, transparency, onTransparency }: { value: string; onChange: (v: string) => void; transparency?: number; onTransparency?: (v: number) => void }) {
  const [hex, setHex] = useState(value.slice(1).toUpperCase());
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  useEffect(() => setHex(value.slice(1).toUpperCase()), [value]);
  const commit = () => {
    let h = hex.replace(/[^0-9a-f]/gi, '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (h.length === 6) onChange('#' + h.toLowerCase());
    else setHex(value.slice(1).toUpperCase());
  };
  return (
    <div className="colorfield">
      <button
        className={`swatch ${anchor ? 'open' : ''}`}
        style={{ ['--c' as any]: value, ['--a' as any]: transparency === undefined ? 1 : 1 - transparency }}
        onClick={(e) => setAnchor(anchor ? null : (e.currentTarget as HTMLElement).getBoundingClientRect())}
        title="Pick colour"
      />
      {anchor && (
        <ColorPicker value={value} onChange={onChange} transparency={transparency} onTransparency={onTransparency} anchor={anchor} onClose={() => setAnchor(null)} />
      )}
      <input className="hex" value={hex} onChange={(e) => setHex(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      {onTransparency && (
        <NumberField className="nf-t" label="T" title="Transparency (0 = opaque, 1 = invisible)" value={transparency ?? 0} step={0.05} min={0} max={1} precision={2} onChange={onTransparency} />
      )}
    </div>
  );
}

const RICH_SIZES = [12, 14, 18, 24, 32, 48, 64];

/**
 * Text editor with a Roblox RichText toolbar. Buttons wrap the selected text in tags
 * (<b>, <i>, <u>, <s>, <font color/size>, <uc>, <stroke>); turning formatting on also enables RichText.
 */
export function RichTextField({ value, onChange, richText, onRichText }: { value: string; onChange: (v: string) => void; richText: boolean; onRichText: (v: boolean) => void }) {
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  const [colorAnchor, setColorAnchor] = useState<DOMRect | null>(null);
  const [color, setColor] = useState('#ffd23f');
  const ta = useRef<HTMLTextAreaElement>(null);
  const sel = useRef<[number, number]>([0, 0]);
  useEffect(() => {
    if (!focused) setText(value);
  }, [value, focused]);

  const remember = () => {
    const el = ta.current;
    if (el) sel.current = [el.selectionStart, el.selectionEnd];
  };
  const apply = (next: string, selStart: number, selEnd: number) => {
    setText(next);
    onChange(next);
    if (!richText) onRichText(true);
    requestAnimationFrame(() => {
      const el = ta.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(selStart, selEnd);
      sel.current = [selStart, selEnd];
    });
  };
  const wrap = (open: string, close: string) => {
    let [a, b] = sel.current;
    if (a === b) {
      // nothing selected: format the whole text
      a = 0;
      b = text.length;
    }
    const inner = text.slice(a, b);
    // toggle off when the selection is already wrapped in exactly this tag
    if (inner.startsWith(open) && inner.endsWith(close)) {
      const unwrapped = inner.slice(open.length, inner.length - close.length);
      return apply(text.slice(0, a) + unwrapped + text.slice(b), a, a + unwrapped.length);
    }
    apply(text.slice(0, a) + open + inner + close + text.slice(b), a, b + open.length + close.length);
  };
  const clear = () => {
    let [a, b] = sel.current;
    if (a === b) [a, b] = [0, text.length];
    const plain = text.slice(a, b).replace(/<[^>]+>/g, '');
    apply(text.slice(0, a) + plain + text.slice(b), a, a + plain.length);
  };
  const keep = (e: React.MouseEvent) => e.preventDefault(); // keep the textarea selection while clicking the toolbar

  return (
    <div className="rte">
      <div className="rte-bar">
        <button onMouseDown={keep} onClick={() => wrap('<b>', '</b>')} title="Bold"><b>B</b></button>
        <button onMouseDown={keep} onClick={() => wrap('<i>', '</i>')} title="Italic"><i>I</i></button>
        <button onMouseDown={keep} onClick={() => wrap('<u>', '</u>')} title="Underline"><u>U</u></button>
        <button onMouseDown={keep} onClick={() => wrap('<s>', '</s>')} title="Strikethrough"><s>S</s></button>
        <span className="rte-sep" />
        <button onMouseDown={keep} onClick={() => wrap(`<font color="${color}">`, '</font>')} title="Text colour" className="rte-color">
          A<span style={{ background: color }} />
        </button>
        <button onMouseDown={keep} onClick={(e) => setColorAnchor(colorAnchor ? null : (e.currentTarget as HTMLElement).getBoundingClientRect())} title="Choose colour" className="rte-caret">▾</button>
        {colorAnchor && (
          <ColorPicker
            value={color}
            onChange={(c) => setColor(c)}
            anchor={colorAnchor}
            onClose={() => setColorAnchor(null)}
          />
        )}
        <select
          className="rte-size"
          value=""
          onMouseDown={remember}
          onChange={(e) => e.target.value && wrap(`<font size="${e.target.value}">`, '</font>')}
          title="Text size"
        >
          <option value="">Size</option>
          {RICH_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <button onMouseDown={keep} onClick={() => wrap('<uc>', '</uc>')} title="UPPERCASE">Aa</button>
        <button onMouseDown={keep} onClick={() => wrap('<stroke color="#000000" thickness="2">', '</stroke>')} title="Outline">◎</button>
        <span className="rte-sep" />
        <button onMouseDown={keep} onClick={clear} title="Remove formatting">⌫</button>
      </div>
      <textarea
        ref={ta}
        className="textarea rte-text"
        rows={Math.min(6, Math.max(2, text.split('\n').length))}
        value={text}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          remember();
          setFocused(false);
        }}
        onSelect={remember}
        onKeyUp={remember}
        onMouseUp={remember}
        onChange={(e) => {
          setText(e.target.value);
          onChange(e.target.value);
        }}
      />
      {!richText && /<[a-z]/i.test(text) && (
        <button className="btn tiny" onClick={() => onRichText(true)}>Tags won't render — enable RichText</button>
      )}
    </div>
  );
}

export function SelectField({ value, options, onChange }: { value: string; options: (string | [string, string])[]; onChange: (v: string) => void }) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => {
        const [v, l] = Array.isArray(o) ? o : [o, o];
        return (
          <option key={v} value={v}>
            {l}
          </option>
        );
      })}
    </select>
  );
}

export function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-box" />
      {label && <span>{label}</span>}
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; icon?: ReactNode; label?: string; title?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'on' : ''} title={o.title ?? o.value} onClick={() => onChange(o.value)}>
          {o.icon ?? o.label ?? o.value}
        </button>
      ))}
    </div>
  );
}

export function TextField({ value, onChange, multiline, placeholder }: { value: string; onChange: (v: string) => void; multiline?: boolean; placeholder?: string }) {
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value);
  }, [value, focused]);
  const props = {
    value: text,
    placeholder,
    onFocus: () => setFocused(true),
    onChange: (e: any) => {
      setText(e.target.value);
      onChange(e.target.value);
    },
    onBlur: () => setFocused(false),
  };
  return multiline ? <textarea className="textarea" rows={Math.min(6, Math.max(2, text.split('\n').length))} {...props} /> : <input className="text" {...props} />;
}

export function Row({ label, children, title, stack }: { label: ReactNode; children: ReactNode; title?: string; stack?: boolean }) {
  return (
    <div className={stack ? 'row stack' : 'row'} title={title}>
      <div className="row-label">{label}</div>
      <div className="row-body">{children}</div>
    </div>
  );
}
