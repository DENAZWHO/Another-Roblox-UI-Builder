import { useLayoutEffect, useRef, useState } from 'react';
import { Plus, Trash } from 'lucide-react';
import { useStore } from '../store';
import { colorAt, TEXT_COLOR_PRESETS, visibleChars } from '../model/richColors';
import { fontFamily, nearestFace } from '../model/fonts';
import { uid } from '../model/doc';
import type { ColorStop, GuiNode, TextColors } from '../model/types';
import { patchNodes, setProp } from '../actions';
import { ColorField, Segmented } from './fields';
import { boundText } from './render';

type Mode = 'solid' | TextColors['mode'];
type Stop = ColorStop & { key: string };

const CELL = 15; // min px per character in the strip

/**
 * Text colour editor for RichText labels: one solid colour, hard-edged colour segments, or a gradient
 * that blends letter by letter. Drag the handles above the letters to move where colours start/end.
 */
export function RichColorEditor({ ids, node }: { ids: string[]; node: GuiNode }) {
  const p = node.props;
  const tc = node.textColors;
  const mode: Mode = tc?.mode ?? 'solid';
  const user = useStore((s) => s.doc.previewUser);
  const chars = visibleChars(boundText(node, user) || ' ');
  const n = chars.length;
  const stripRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(240);
  const [selected, setSelected] = useState(0);
  // stable keys for handles while dragging (stops are re-sorted on every change)
  const keys = useRef<string[]>([]);
  const stops: Stop[] = (tc?.stops ?? []).map((s, i) => ({ ...s, key: (keys.current[i] ??= uid()) }));

  useLayoutEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode]);

  const inner = Math.max(width, n * CELL);
  const save = (next: TextColors | undefined, coalesce?: string) => patchNodes(ids, { textColors: next }, coalesce);
  const setStops = (list: Stop[], coalesce?: string) => {
    const sorted = [...list].sort((a, b) => a.at - b.at);
    keys.current = sorted.map((s) => s.key);
    save({ mode: mode as TextColors['mode'], stops: sorted.map(({ at, color }) => ({ at, color })) }, coalesce);
    return sorted;
  };

  const doc = useStore((s) => s.doc);
  // Roblox multiplies a UIGradient over every letter's colour, so per-letter colours can't show as picked while one is on
  const gradient = node.children.map((c) => doc.nodes[c]).find((c) => c?.className === 'UIGradient' && c.props.Enabled !== false);
  const gradientOnlyTintsText = (p.BackgroundTransparency ?? 0) >= 1;

  /** Turn off a UIGradient that only affects the text, so the picked colours show exactly (in Roblox too) */
  const releaseGradient = () => {
    if (!gradient || !gradientOnlyTintsText) return;
    setProp([gradient.id], 'Enabled', false, false);
    useStore.getState().showToast('Turned off the UIGradient so your text colours show exactly (Ctrl+Z to undo)');
  };

  /** A left-to-right UIGradient becomes the starting text gradient (multiplied by the text colour, as Roblox draws it) */
  const stopsFromGradient = (): ColorStop[] | null => {
    if (!gradient) return null;
    const rot = (((gradient.props.Rotation ?? 0) % 360) + 360) % 360;
    const horizontal = rot < 30 || rot > 330 || Math.abs(rot - 180) < 30;
    if (!horizontal) return null;
    const flip = Math.abs(rot - 180) < 30;
    const mul = (a: string, b: string) => {
      const x = parseInt(a.slice(1), 16);
      const y = parseInt(b.slice(1), 16);
      return '#' + [16, 8, 0].map((sh) => Math.round((((x >> sh) & 255) * ((y >> sh) & 255)) / 255).toString(16).padStart(2, '0')).join('');
    };
    return (gradient.props.Color as { t: number; c: string }[])
      .map((k) => ({ at: flip ? 1 - k.t : k.t, color: mul(p.TextColor3, k.c) }))
      .sort((a, b) => a.at - b.at);
  };

  const switchMode = (m: Mode) => {
    if (m === 'solid') {
      keys.current = [];
      return save(undefined);
    }
    if (!p.RichText) setProp(ids, 'RichText', true, false);
    if (tc) return save({ ...tc, mode: m });
    keys.current = [];
    const fromGradient = m === 'gradient' && gradientOnlyTintsText ? stopsFromGradient() : null;
    save(
      fromGradient
        ? { mode: m, stops: fromGradient }
        : m === 'segments'
          ? { mode: m, stops: [{ at: 0, color: p.TextColor3 }, { at: Math.max(1, Math.round(n / 2)) / Math.max(1, n), color: '#ffd23f' }] }
          : { mode: m, stops: [{ at: 0, color: p.TextColor3 }, { at: 1, color: '#4fb3ff' }] },
    );
    releaseGradient();
    setSelected(1);
  };

  /** Segment boundaries sit between characters */
  function snap(at: number) {
    if (mode !== 'segments' && tc?.mode !== 'segments') return Math.max(0, Math.min(1, at));
    return Math.max(1, Math.min(n - 1, Math.round(at * n))) / Math.max(1, n);
  }

  const posToAt = (clientX: number) => {
    const el = stripRef.current!;
    const b = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - b.left + el.scrollLeft) / inner));
  };

  const dragStop = (e: React.PointerEvent, index: number) => {
    e.stopPropagation();
    e.preventDefault();
    setSelected(index);
    // the first segment always starts at the first letter
    if (mode === 'segments' && index === 0) return;
    const key = stops[index].key;
    const startY = e.clientY;
    useStore.getState().beginGesture();
    let list = stops;
    let removed = false;
    const move = (ev: PointerEvent) => {
      // drag a handle well away from the strip to delete it
      const away = Math.abs(ev.clientY - startY) > 50 && list.length > 2;
      if (away !== removed) {
        removed = away;
        (e.target as HTMLElement).style.opacity = away ? '0.3' : '';
      }
      const at = snap(posToAt(ev.clientX));
      list = setStops(list.map((s) => (s.key === key ? { ...s, at } : s)));
      setSelected(list.findIndex((s) => s.key === key));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (removed) {
        list = setStops(list.filter((s) => s.key !== key));
        setSelected(0);
      }
      useStore.getState().endGesture();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const addStopAt = (at: number) => {
    const a = snap(at);
    if (mode === 'segments' && stops.some((s) => Math.abs(s.at - a) < 1e-6)) return;
    const color = mode === 'gradient' ? colorAt(tc!, Math.round(a * (n - 1)), n) : nextColor(stops.map((s) => s.color));
    const key = uid();
    const list = setStops([...stops, { at: a, color, key }]);
    setSelected(list.findIndex((s) => s.key === key));
  };

  const sel = stops[Math.min(selected, stops.length - 1)];
  const face = nearestFace(p.FontFace);

  return (
    <div className="rce">
      <Segmented
        value={mode}
        options={[
          { value: 'solid', label: 'Solid' },
          { value: 'segments', label: 'Segments', title: 'Different colours for different parts of the text' },
          { value: 'gradient', label: 'Gradient', title: 'Colours blend letter by letter' },
        ]}
        onChange={switchMode}
      />
      {mode === 'solid' ? (
        <ColorField value={p.TextColor3} onChange={(v) => setProp(ids, 'TextColor3', v)} transparency={p.TextTransparency} onTransparency={(v) => setProp(ids, 'TextTransparency', v)} />
      ) : (
        <>
          {gradient && (
            <div className="note rce-grad-note">
              <span>
                <b>These colours are being tinted.</b> This text also has a <b>UIGradient</b>, and Roblox multiplies it over every letter — so
                white shows up as the gradient's colour and other colours get darker. That's what Studio shows too.
              </span>
              <span className="rce-grad-swatches">
                {stops.slice(0, 4).map((s) => (
                  <span key={s.key} title="picked → shown">
                    <i style={{ background: s.color }} />→<i style={{ background: tintPreview(s.color, gradient.props.Color) }} />
                  </span>
                ))}
              </span>
              <button className="btn tiny" onClick={() => setProp([gradient.id], 'Enabled', false, false)}>
                Turn off UIGradient — show my colours exactly
              </button>
              {!gradientOnlyTintsText && <span className="muted">(It also colours the background — turning it off removes that too.)</span>}
            </div>
          )}
          <div className="rce-strip" ref={stripRef} onPointerDown={(e) => addStopAt(posToAt(e.clientX))} title="Click to add a colour stop">
            <div className="rce-inner" style={{ width: inner }}>
              <div className="rce-handles">
                {stops.map((s, i) => (
                  <div
                    key={s.key}
                    className={`rce-handle ${i === selected ? 'on' : ''} ${mode === 'segments' && i === 0 ? 'fixed' : ''}`}
                    style={{ left: s.at * inner }}
                    onPointerDown={(e) => dragStop(e, i)}
                    title={mode === 'segments' && i === 0 ? 'First colour' : 'Drag to move · drag down to remove'}
                  >
                    <span style={{ background: s.color }} />
                  </div>
                ))}
              </div>
              <div className="rce-letters" style={{ fontFamily: fontFamily(p.FontFace.family).css, fontWeight: face.weight, fontStyle: face.style === 'Italic' ? 'italic' : 'normal' }}>
                {chars.map((c, i) => (
                  <span key={i} style={{ color: colorAt(tc!, i, n), width: inner / n }}>
                    {c === ' ' ? ' ' : c === '\n' ? '↵' : c}
                  </span>
                ))}
              </div>
              {mode === 'gradient' && (
                <div className="rce-bar" style={{ background: `linear-gradient(90deg, ${stops.map((s) => `${s.color} ${s.at * 100}%`).join(', ')})` }} />
              )}
              {mode === 'segments' && (
                <div className="rce-bar">
                  {stops.map((s, i) => (
                    <div key={s.key} style={{ left: s.at * inner, width: ((stops[i + 1]?.at ?? 1) - s.at) * inner, background: s.color }} />
                  ))}
                </div>
              )}
            </div>
          </div>
          {sel && (
            <div className="rce-stop">
              <span className="muted">{mode === 'segments' ? `From letter ${Math.round(sel.at * n) + 1}` : `At ${Math.round(sel.at * 100)}%`}</span>
              <ColorField
                value={sel.color}
                onChange={(color) => setStops(stops.map((s) => (s.key === sel.key ? { ...s, color } : s)), 'stopcolor:' + sel.key)}
              />
              <button className="icon-btn" title="Add colour stop" onClick={() => addStopAt(stops.length > 1 ? (sel.at + (stops[selected + 1]?.at ?? 1)) / 2 : 0.5)}>
                <Plus size={13} />
              </button>
              <button
                className="icon-btn"
                title="Remove this colour"
                disabled={stops.length <= 2 || (mode === 'segments' && selected === 0)}
                onClick={() => {
                  setStops(stops.filter((s) => s.key !== sel.key));
                  setSelected(0);
                }}
              >
                <Trash size={12} />
              </button>
            </div>
          )}
          <div className="rce-presets">
            {TEXT_COLOR_PRESETS.map((pr) => (
              <button
                key={pr.name}
                title={pr.name}
                onClick={() => {
                  keys.current = [];
                  if (!p.RichText) setProp(ids, 'RichText', true, false);
                  save(structuredClone(pr.tc));
                  releaseGradient();
                }}
                style={{
                  background:
                    pr.tc.mode === 'gradient'
                      ? `linear-gradient(90deg, ${pr.tc.stops.map((s) => `${s.color} ${s.at * 100}%`).join(', ')})`
                      : `linear-gradient(90deg, ${pr.tc.stops[0].color} 50%, ${pr.tc.stops[1].color} 50%)`,
                }}
              />
            ))}
          </div>
          <p className="hint">Click the letters to add a colour, drag the handles to move where colours start, drag a handle down to remove it. Exported as RichText &lt;font color&gt; tags.</p>
        </>
      )}
    </div>
  );
}

const NEXT = ['#ffd23f', '#4fb3ff', '#ff4d4f', '#3ecf5a', '#b366ff', '#ff8a3d', '#ffffff'];
function nextColor(used: string[]) {
  return NEXT.find((c) => !used.map((u) => u.toLowerCase()).includes(c)) ?? NEXT[used.length % NEXT.length];
}

/** What a picked colour roughly turns into under a UIGradient (multiplied by the gradient's first colour) */
function tintPreview(color: string, keys: { t: number; c: string }[]) {
  const g = keys?.[0]?.c ?? '#ffffff';
  const x = parseInt(color.slice(1), 16);
  const y = parseInt(g.slice(1), 16);
  return '#' + [16, 8, 0].map((sh) => Math.round((((x >> sh) & 255) * ((y >> sh) & 255)) / 255).toString(16).padStart(2, '0')).join('');
}
