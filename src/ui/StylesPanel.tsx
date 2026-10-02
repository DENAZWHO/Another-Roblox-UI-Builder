// Shared styles UI: the Styles tab, the style button next to colour fields, and the text style picker.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Palette, Plus, Trash2, Unlink, Wand2 } from 'lucide-react';
import { useStore } from '../store';
import { colorStyles, styleUsers, textStyles, TEXT_REF } from '../model/styles';
import { FONT_FAMILIES, FONT_WEIGHTS, fontStyle } from '../model/fonts';
import { isGuiObject, isText } from '../model/schema';
import type { ColorStyle, TextStyle } from '../model/types';
import { colorName, createColorStyle, createTextStyle, deleteStyle, linkStyle, stylesFromDocument, updateColorStyle, updateTextStyle } from '../actions';
import { ColorPicker } from './ColorPicker';
import { NumberField, Row, SelectField } from './fields';

// ---------------------------------------------------------------------------
// a small popover menu

function Popover({ anchor, onClose, children }: { anchor: DOMRect; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.bottom + 4 });
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 200;
    const w = ref.current?.offsetWidth ?? 220;
    setPos({ left: Math.min(window.innerWidth - w - 8, anchor.left), top: anchor.bottom + 4 + h > window.innerHeight ? Math.max(8, anchor.top - h - 4) : anchor.bottom + 4 });
  }, [anchor]);
  useEffect(() => {
    const down = (e: PointerEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
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
  return createPortal(
    <div className="style-menu" ref={ref} style={pos} onPointerDown={(e) => e.stopPropagation()}>
      {children}
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// next to a colour field

/** Shows the linked colour style (or a button to pick / create one) for a colour property */
export function ColorStyleButton({ ids, prop, value }: { ids: string[]; prop: string; value: string }) {
  const doc = useStore((s) => s.doc);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const styles = colorStyles(doc);
  const refs = ids.map((id) => doc.nodes[id]?.styleRefs?.[prop]);
  const linked = refs[0] && refs.every((r) => r === refs[0]) ? styles.find((s) => s.id === refs[0]) : undefined;
  const close = () => setAnchor(null);
  return (
    <>
      <button
        className={`style-btn ${linked ? 'on' : ''}`}
        title={linked ? `Linked to the "${linked.name}" style — click to change` : 'Use a colour style'}
        onClick={(e) => setAnchor(anchor ? null : (e.currentTarget as HTMLElement).getBoundingClientRect())}
      >
        {linked ? <span className="style-name">{linked.name}</span> : <Palette size={12} />}
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={close}>
          <div className="style-menu-title">Colour styles</div>
          {styles.length === 0 && <div className="hint">None yet.</div>}
          {styles.map((s) => (
            <button key={s.id} className={`style-menu-item ${linked?.id === s.id ? 'on' : ''}`} onClick={() => (linkStyle(ids, prop, s.id), close())}>
              <span className="style-swatch" style={{ background: s.color }} />
              <span className="style-menu-name">{s.name}</span>
              <span className="muted">{s.color.toUpperCase()}</span>
            </button>
          ))}
          <div className="style-menu-sep" />
          {linked && (
            <button className="style-menu-item" onClick={() => (linkStyle(ids, prop, null), close())}>
              <Unlink size={12} /> <span className="style-menu-name">Unlink (keep {linked.color.toUpperCase()})</span>
            </button>
          )}
          <button
            className="style-menu-item"
            onClick={() => {
              const name = colorName(value, styles.length);
              createColorStyle(value, name, { ids, prop });
              useStore.getState().showToast(`Made the "${name}" style — rename it in the Styles tab`);
              close();
            }}
          >
            <Plus size={12} /> <span className="style-menu-name">New style from {value.toUpperCase()}</span>
          </button>
        </Popover>
      )}
    </>
  );
}

/** Text style picker for text elements */
export function TextStyleRow({ ids }: { ids: string[] }) {
  const doc = useStore((s) => s.doc);
  const styles = textStyles(doc);
  const refs = ids.map((id) => doc.nodes[id]?.styleRefs?.[TEXT_REF]);
  const current = refs[0] && refs.every((r) => r === refs[0]) ? refs[0] : '';
  return (
    <Row label="Text style" title="A shared font + size + line height; change the style to update every text using it">
      <SelectField
        value={current}
        options={[['', 'None'], ...styles.map((s) => [s.id, `${s.name} · ${s.size}px`] as [string, string]), ['__new', '+ New style from this text']]}
        onChange={(v) => {
          if (v === '__new') {
            const id = createTextStyle(ids[0]);
            if (ids.length > 1) linkStyle(ids, TEXT_REF, id);
          } else linkStyle(ids, TEXT_REF, v || null);
        }}
      />
    </Row>
  );
}

// ---------------------------------------------------------------------------
// the Styles tab

export function StylesTab() {
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  const colors = colorStyles(doc);
  const texts = textStyles(doc);
  const first = doc.nodes[selection[0]];
  const firstText = selection.map((id) => doc.nodes[id]).find((n) => n && isText(n.className));
  return (
    <div className="styles-tab">
      <div className="insert-title styles-title">
        <span>Colour styles</span>
        <span className="prefab-tools">
          <button title="Turn this document's most used colours into styles (and link them)" onClick={() => {
            const n = stylesFromDocument();
            useStore.getState().showToast(n ? `Made ${n} colour style${n === 1 ? '' : 's'} from the document and linked ${n === 1 ? 'it' : 'them'}` : 'No repeated colours left to turn into styles');
          }}><Wand2 size={12} /></button>
          <button title="New colour style (from the selected element's fill)" onClick={() => createColorStyle(first && isGuiObject(first.className) ? first.props.BackgroundColor3 : '#ffffff')}><Plus size={12} /></button>
        </span>
      </div>
      {colors.length === 0 ? (
        <div className="hint styles-empty">Name your colours once and use them everywhere: change a style and every element using it updates. Press the wand to make styles from the colours already in this design.</div>
      ) : (
        <div className="styles-list">{colors.map((s) => <ColorStyleRow key={s.id} s={s} />)}</div>
      )}

      <div className="insert-title styles-title">
        <span>Text styles</span>
        <span className="prefab-tools">
          <button title={firstText ? `New text style from "${firstText.name}"` : 'New text style'} onClick={() => createTextStyle(firstText?.id ?? null)}><Plus size={12} /></button>
        </span>
      </div>
      {texts.length === 0 ? (
        <div className="hint styles-empty">A text style is a font, size and line height. Select a text element and press +, or pick "New style from this text" in its Text section.</div>
      ) : (
        <div className="styles-list">{texts.map((s) => <TextStyleItem key={s.id} s={s} />)}</div>
      )}
    </div>
  );
}

function UsersButton({ styleId }: { styleId: string }) {
  const doc = useStore((s) => s.doc);
  const users = styleUsers(doc, styleId);
  const ids = [...new Set(users.map((u) => u.id))];
  return (
    <button className="style-users" title={ids.length ? 'Select the elements using it' : 'Not used yet'} disabled={!ids.length} onClick={() => useStore.getState().select(ids)}>
      {ids.length}
    </button>
  );
}

function NameInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      className="style-row-name"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => (text.trim() && text !== value ? onChange(text.trim()) : setText(value))}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function ColorStyleRow({ s }: { s: ColorStyle }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  return (
    <div className="style-row">
      <button className="style-swatch big" style={{ background: s.color }} title="Edit the colour" onClick={(e) => setAnchor(anchor ? null : (e.currentTarget as HTMLElement).getBoundingClientRect())} />
      {anchor && <ColorPicker value={s.color} onChange={(c) => updateColorStyle(s.id, { color: c }, 'stylecolor')} anchor={anchor} onClose={() => setAnchor(null)} />}
      <NameInput value={s.name} onChange={(name) => updateColorStyle(s.id, { name })} />
      <span className="muted style-hex">{s.color.toUpperCase()}</span>
      <UsersButton styleId={s.id} />
      <button className="icon-btn" title="Delete (elements keep the colour)" onClick={() => deleteStyle(s.id)}><Trash2 size={12} /></button>
    </div>
  );
}

function TextStyleItem({ s }: { s: TextStyle }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="style-text">
      <div className="style-row">
        <button className="style-aa" title="Edit" style={fontStyle(s.font, 15)} onClick={() => setOpen(!open)}>Ag</button>
        <NameInput value={s.name} onChange={(name) => updateTextStyle(s.id, { name })} />
        <span className="muted style-hex">{s.size}px</span>
        <UsersButton styleId={s.id} />
        <button className="icon-btn" title="Delete (texts keep their font)" onClick={() => deleteStyle(s.id)}><Trash2 size={12} /></button>
      </div>
      {open && (
        <div className="style-text-edit">
          <Row label="Font">
            <SelectField value={s.font.family} options={FONT_FAMILIES.map((f) => [f.id, f.label] as [string, string])} onChange={(family) => updateTextStyle(s.id, { font: { ...s.font, family } })} />
          </Row>
          <Row label="Weight">
            <SelectField value={String(s.font.weight)} options={FONT_WEIGHTS.map(([w, n]) => [String(w), n] as [string, string])} onChange={(w) => updateTextStyle(s.id, { font: { ...s.font, weight: Number(w) } })} />
          </Row>
          <Row label="Size">
            <NumberField value={s.size} min={1} max={100} precision={0} onChange={(size) => updateTextStyle(s.id, { size: Math.round(size) }, 'textsize')} label="" suffix="px" />
          </Row>
          <Row label="Line height">
            <NumberField value={s.lineHeight ?? 1} min={0.5} max={3} step={0.1} precision={2} onChange={(lineHeight) => updateTextStyle(s.id, { lineHeight }, 'textlh')} label="" />
          </Row>
        </div>
      )}
    </div>
  );
}
