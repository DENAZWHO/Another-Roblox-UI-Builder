import { useMemo, useState, type ReactNode } from 'react';
import {
  AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd, AlignHorizontalJustifyStart, AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd, AlignVerticalJustifyStart, ChevronDown, ChevronRight, Diamond, Plus, TextAlignCenter, TextAlignEnd,
  Smartphone, TextAlignStart, Trash, Upload, X,
} from 'lucide-react';
import { useStore } from '../store';
import {
  ANIMATABLE_PROPS, CLASS_PROPS, DEVICES, ENUMS, MODIFIER_CLASSES, isGuiObject, isImage, isModifier, isText, modifierAllowed, propDef,
  type PropDef, isRoot, isWorldGui,
} from '../model/schema';
import { FONT_FAMILIES, FONT_WEIGHTS, fontFamily, nearestFace, slantedItalic, weightName } from '../model/fonts';
import { EASING_DIRECTIONS, EASING_STYLES, ease } from '../model/animation';
import type { ColorKey, GuiNode, ModifierClass, NumberKey, Tween } from '../model/types';
import { addModifier, addTween, align, convertUnits, deleteTween, fixedSizeReason, makeResponsive, moveInside, overlapIssues, setProp, updateTween } from '../actions';
import { AvatarRows, BindRow, ClipSettings, CornerRow, EffectsSection, PreviewUserRow, ResponsiveCheck, ToastSection, WorldSection } from './BehaviorPanels';
import { removeNode } from '../model/doc';
import { ColorField, NumberField, RichTextField, Row, Segmented, SelectField, TextField, Toggle, UDim2Field, UDimField, Vec2Field } from './fields';
import { ClassIcon } from './icons';
import { RichColorEditor } from './RichColorEditor';
import { ReferenceProps } from './References';
import { useEffectiveNodes, useFontEpoch } from './hooks';
import { computeLayout } from '../model/layout';
import type { Doc } from '../model/types';

export function PropertiesPanel() {
  const selection = useStore((s) => s.selection);
  const mode = useStore((s) => s.mode);
  const tweenId = useStore((s) => s.selectedTweenId);
  const doc = useStore((s) => s.doc);
  const nodes = useEffectiveNodes();
  const sel = selection.filter((id) => nodes[id]);
  const refSel = useStore((s) => s.refSelection);
  const tween = mode === 'animate' && tweenId ? doc.clips.flatMap((c) => c.tweens).find((t) => t.id === tweenId) : undefined;

  return (
    <aside className="panel right">
      <div className="tabs">
        <button className="on">{mode === 'animate' ? 'Animate' : 'Design'}</button>
      </div>
      <div className="props-scroll">
        {mode === 'animate' && <ClipSettings />}
        {tween && <TweenInspector tween={tween} />}
        {refSel && !sel.length ? <ReferenceProps id={refSel} /> : !sel.length ? <DocumentProps /> : <SelectionProps ids={sel} nodes={nodes} />}
      </div>
    </aside>
  );
}

function Section({ title, children, actions, collapsible = false }: { title: ReactNode; children: ReactNode; actions?: ReactNode; collapsible?: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="section">
      <div className="section-title" onClick={() => collapsible && setOpen(!open)}>
        <span>
          {collapsible && (open ? <ChevronDown size={11} /> : <ChevronRight size={11} />)}
          {title}
        </span>
        <span className="section-actions" onClick={(e) => e.stopPropagation()}>{actions}</span>
      </div>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

// ---------------------------------------------------------------------------

function DocumentProps() {
  const doc = useStore((s) => s.doc);
  const clip = useStore((s) => s.clipArtboard);
  const units = useStore((s) => s.units);
  const update = useStore((s) => s.update);
  const preset = DEVICES.find((d) => d.w === doc.device.w && d.h === doc.device.h && d.name === doc.device.name);
  return (
    <>
      <Section title="Responsiveness">
        <ResponsiveCheck />
      </Section>
      <Section title="Screen">
        <Row label="Device">
          <SelectField
            value={preset?.name ?? 'Custom'}
            options={[...DEVICES.map((d) => [d.name, `${d.name} (${d.w}×${d.h})`] as [string, string]), ['Custom', 'Custom']]}
            onChange={(v) => {
              const d = DEVICES.find((x) => x.name === v);
              update((dd) => {
                dd.device = d ? { ...d } : { ...dd.device, name: 'Custom' };
              });
            }}
          />
        </Row>
        <Row label="Size">
          <div className="pair">
            <NumberField label="W" value={doc.device.w} min={100} max={8000} onChange={(w) => update((d) => void (d.device = { ...d.device, w, name: 'Custom' }))} />
            <NumberField label="H" value={doc.device.h} min={100} max={8000} onChange={(h) => update((d) => void (d.device = { ...d.device, h, name: 'Custom' }))} />
          </div>
        </Row>
        <Row label="" title="Swap width and height">
          <button className="btn small" onClick={() => update((d) => void (d.device = { name: 'Custom', w: d.device.h, h: d.device.w }))}>Rotate device</button>
        </Row>
        <Row label="Top bar"><Toggle value={doc.showTopbar} onChange={(v) => update((d) => void (d.showTopbar = v))} label="Show Roblox top bar" /></Row>
        <Row label="Clip"><Toggle value={clip} onChange={(v) => useStore.setState({ clipArtboard: v })} label="Clip content to screen" /></Row>
      </Section>
      <Section title="Editing">
        <Row label="Units" title="Which UDim component canvas edits write to">
          <Segmented value={units} options={[{ value: 'scale', label: 'Scale' }, { value: 'offset', label: 'Offset' }]} onChange={(v) => useStore.setState({ units: v })} />
        </Row>
        <p className="hint">
          <b>Scale</b> keeps your UI proportional on every device (recommended). <b>Offset</b> uses fixed pixels. Mixed values like <code>{'{1, -20}'}</code> are preserved.
        </p>
      </Section>
      <Section title="Player preview">
        <PreviewUserRow />
        <p className="hint">Avatar images and player-name text show this user in the editor. In game they show whoever is playing.</p>
      </Section>
      <Section title="Tips">
        <ul className="tips">
          <li>Pick a tool (F, T, B, I…) and drag on the canvas to draw.</li>
          <li>Click selects at the current depth, double-click drills in, Ctrl-click selects the deepest.</li>
          <li>Hold Shift to keep proportions, Alt to resize from the centre, Ctrl to disable snapping.</li>
          <li>Switch to Animate mode to keyframe tweens, then export Luau or sync to Studio.</li>
          <li>Things look too big in Studio? Select them and press <b>Make responsive</b>.</li>
        </ul>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------

function SelectionProps({ ids, nodes }: { ids: string[]; nodes: Record<string, GuiNode> }) {
  const primary = nodes[ids[0]];
  const cls = primary.className;
  const same = ids.filter((id) => nodes[id].className === cls);
  const multi = ids.length > 1;

  return (
    <>
      <div className="sel-header">
        <ClassIcon cls={cls} size={14} />
        {multi ? <span>{ids.length} selected</span> : <NameInput node={primary} />}
        <span className="sel-class">{multi && same.length !== ids.length ? 'Mixed' : cls}</span>
      </div>
      {isWorldGui(cls) && !multi && <WorldSection node={primary} />}
      {cls === 'ScreenGui' && !multi && (
        <Section title="Responsiveness">
          <ResponsiveCheck />
        </Section>
      )}
      {isRoot(cls) && <GenericProps ids={same} node={primary} />}
      {isModifier(cls) && <ModifierCard node={primary} ids={same} standalone />}
      {isGuiObject(cls) && <GuiObjectProps ids={ids} node={primary} nodes={nodes} />}
    </>
  );
}

function NameInput({ node }: { node: GuiNode }) {
  const update = useStore((s) => s.update);
  return (
    <TextField
      value={node.name}
      onChange={(v) => update((d) => void (d.nodes[node.id].name = v), { coalesce: 'name:' + node.id })}
    />
  );
}

function GenericProps({ ids, node, only }: { ids: string[]; node: GuiNode; only?: string[] }) {
  const defs = CLASS_PROPS[node.className].filter((d) => !only || only.includes(d.name));
  return (
    <Section title="Properties">
      {defs.map((d) => (
        <Row key={d.name} label={d.name} title={d.name} stack={d.type === 'ColorSequence' || d.type === 'NumberSequence'}>
          <PropEditor def={d} value={node.props[d.name]} onChange={(v) => setProp(ids, d.name, v)} />
        </Row>
      ))}
    </Section>
  );
}

export function PropEditor({ def, value, onChange }: { def: PropDef; value: any; onChange: (v: any) => void }) {
  switch (def.type) {
    case 'UDim2':
      return <UDim2Field value={value} onChange={onChange} />;
    case 'UDim':
      return <UDimField value={value} onChange={onChange} />;
    case 'Vector2':
      return <Vec2Field value={value} onChange={onChange} step={def.step ?? 1} />;
    case 'Vector3':
      return (
        <div className="pair vec3">
          {(['x', 'y', 'z'] as const).map((k) => (
            <NumberField key={k} label={k.toUpperCase()} value={value[k]} step={def.step ?? 1} onChange={(v) => onChange({ ...value, [k]: v })} />
          ))}
        </div>
      );
    case 'float':
    case 'int':
      return <NumberField value={value} onChange={(v) => onChange(def.type === 'int' ? Math.round(v) : v)} step={def.step ?? 1} min={def.min} max={def.max} precision={def.type === 'int' ? 0 : 3} label="" />;
    case 'bool':
      return <Toggle value={value} onChange={onChange} />;
    case 'Color3':
      return <ColorField value={value} onChange={onChange} />;
    case 'string':
      return <TextField value={value} onChange={onChange} multiline={def.multiline} />;
    case 'Content':
      return <TextField value={value} onChange={onChange} placeholder="rbxassetid://" />;
    case 'enum':
      return <SelectField value={value} options={Object.keys(ENUMS[def.enumType!])} onChange={onChange} />;
    case 'Font':
      return <FontEditor value={value} onChange={onChange} />;
    case 'ColorSequence':
      return <ColorSequenceEditor value={value} onChange={onChange} />;
    case 'NumberSequence':
      return <NumberSequenceEditor value={value} onChange={onChange} />;
    case 'Rect':
      return (
        <div className="udim2">
          <Vec2Field value={{ x: value.x0, y: value.y0 }} labels={['X0', 'Y0']} onChange={(v) => onChange({ ...value, x0: v.x, y0: v.y })} />
          <Vec2Field value={{ x: value.x1, y: value.y1 }} labels={['X1', 'Y1']} onChange={(v) => onChange({ ...value, x1: v.x, y1: v.y })} />
        </div>
      );
  }
}

function FontEditor({ value, onChange }: { value: any; onChange: (v: any) => void }) {
  useFontEpoch(); // re-render when Studio's font list arrives
  const fam = fontFamily(value.family);
  const known = FONT_FAMILIES.some((f) => f.id === value.family);
  // with Studio's fonts, only offer weights that exist for this style (Roblox never fakes bold)
  // weights that exist for this style (italic falls back to the regular weights when there's no italic face)
  const styleFaces = fam.faces?.filter((f) => f.style === value.style).length ? fam.faces.filter((f) => f.style === value.style) : fam.faces?.filter((f) => f.style === 'Normal');
  const weights = styleFaces ? FONT_WEIGHTS.filter(([w]) => styleFaces.some((f) => f.weight === w) || w === value.weight) : FONT_WEIGHTS;
  const drawn = nearestFace(value);
  const substituted = fam.faces && drawn.weight !== value.weight;
  const slanted = slantedItalic(value);
  return (
    <div className="font-editor">
      <select className="select" value={value.family} onChange={(e) => onChange({ ...value, family: e.target.value })}>
        {!known && <option value={value.family}>{value.family} → {fam.label}</option>}
        {FONT_FAMILIES.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </select>
      <div className="pair">
        <select className="select" value={value.weight} onChange={(e) => onChange({ ...value, weight: +e.target.value })}>
          {weights.map(([w, n]) => (
            <option key={w} value={w}>
              {n}
            </option>
          ))}
        </select>
        <Segmented value={value.style} options={[{ value: 'Normal', label: 'Aa' }, { value: 'Italic', label: <i>Aa</i> as any, title: 'Italic' }]} onChange={(v) => onChange({ ...value, style: v })} />
      </div>
      {substituted && (
        <div className="font-note">
          No {weightName(value.weight)} face — Roblox draws {weightName(drawn.weight)}
        </div>
      )}
      {slanted && <div className="hint font-slant">{fam.label} has no italic face, so italic is the regular face slanted.</div>}
    </div>
  );
}

function ColorSequenceEditor({ value, onChange }: { value: ColorKey[]; onChange: (v: ColorKey[]) => void }) {
  const sorted = [...value].sort((a, b) => a.t - b.t);
  const css = `linear-gradient(90deg, ${sorted.map((k) => `${k.c} ${k.t * 100}%`).join(', ')})`;
  return (
    <div className="seq">
      <div className="seq-bar" style={{ background: css }} />
      {value.map((k, i) => (
        <div className="seq-row" key={i}>
          <NumberField label="t" value={k.t} step={0.05} min={0} max={1} precision={3} onChange={(t) => onChange(value.map((x, j) => (j === i ? { ...x, t } : x)))} />
          <ColorField value={k.c} onChange={(c) => onChange(value.map((x, j) => (j === i ? { ...x, c } : x)))} />
          <button className="icon-btn" disabled={value.length <= 2} onClick={() => onChange(value.filter((_, j) => j !== i))} title="Remove stop"><X size={12} /></button>
        </div>
      ))}
      <button className="btn small" onClick={() => onChange([...value, { t: 0.5, c: '#ffffff' }])}><Plus size={12} /> Stop</button>
    </div>
  );
}

function NumberSequenceEditor({ value, onChange }: { value: NumberKey[]; onChange: (v: NumberKey[]) => void }) {
  const sorted = [...value].sort((a, b) => a.t - b.t);
  const css = `linear-gradient(90deg, ${sorted.map((k) => `rgba(255,255,255,${1 - k.v}) ${k.t * 100}%`).join(', ')}), repeating-conic-gradient(#555 0 25%, #333 0 50%) 0 0 / 10px 10px`;
  return (
    <div className="seq">
      <div className="seq-bar" style={{ background: css }} />
      {value.map((k, i) => (
        <div className="seq-row" key={i}>
          <NumberField label="t" value={k.t} step={0.05} min={0} max={1} precision={3} onChange={(t) => onChange(value.map((x, j) => (j === i ? { ...x, t } : x)))} />
          <NumberField label="T" value={k.v} step={0.05} min={0} max={1} precision={3} onChange={(v) => onChange(value.map((x, j) => (j === i ? { ...x, v } : x)))} />
          <button className="icon-btn" disabled={value.length <= 2} onClick={() => onChange(value.filter((_, j) => j !== i))} title="Remove point"><X size={12} /></button>
        </div>
      ))}
      <button className="btn small" onClick={() => onChange([...value, { t: 0.5, v: 0 }])}><Plus size={12} /> Point</button>
    </div>
  );
}

// ---------------------------------------------------------------------------

function AnchorPicker({ value, onChange }: { value: { x: number; y: number }; onChange: (v: { x: number; y: number }) => void }) {
  const pts = [0, 0.5, 1];
  return (
    <div className="anchor-picker" title="AnchorPoint">
      {pts.map((y) =>
        pts.map((x) => (
          <button key={`${x}-${y}`} className={value.x === x && value.y === y ? 'on' : ''} onClick={() => onChange({ x, y })}>
            <span />
          </button>
        )),
      )}
    </div>
  );
}

function GuiObjectProps({ ids, node, nodes }: { ids: string[]; node: GuiNode; nodes: Record<string, GuiNode> }) {
  const doc = useStore((s) => s.doc);
  const mode = useStore((s) => s.mode);
  const p = node.props;
  const cls = node.className;
  const set = (name: string) => (v: any) => setProp(ids.filter((id) => propDef(nodes[id].className, name)), name, v);
  const layout = useMemo(() => computeLayout(nodes, doc.rootIds, doc.device), [nodes, doc.rootIds, doc.device]);
  const laidOut = layout.laidOut.has(node.id);
  const parentLayout = node.parentId ? nodes[node.parentId].children.map((c) => nodes[c]).find((c) => c?.className === 'UIListLayout' || c?.className === 'UIGridLayout') : undefined;
  const abs = layout.rects[node.id];
  const anim = (name: string) => (mode === 'animate' && ANIMATABLE_PROPS.includes(name) ? <Diamond size={9} className="anim-diamond" /> : null);
  const L = (name: string, text = name) => <>{text}{anim(name)}</>;
  const modifiers = node.children.map((c) => doc.nodes[c]).filter((c) => c && isModifier(c.className));

  return (
    <>
      <div className="align-bar">
        {([
          ['left', AlignHorizontalJustifyStart], ['hcenter', AlignHorizontalJustifyCenter], ['right', AlignHorizontalJustifyEnd],
          ['top', AlignVerticalJustifyStart], ['vcenter', AlignVerticalJustifyCenter], ['bottom', AlignVerticalJustifyEnd],
        ] as const).map(([k, I]) => (
          <button key={k} title={`Align ${k}${ids.length === 1 ? ' (in parent)' : ''}`} onClick={() => align(k)} disabled={laidOut}>
            <I size={14} />
          </button>
        ))}
      </div>

      <Section
        title="Layout"
        actions={
          <span className="unit-convert">
            <button className="btn tiny" title="Convert Position & Size to Scale (keeps the current look)" onClick={() => convertUnits(ids, 'scale')}>→ Scale</button>
            <button className="btn tiny" title="Convert Position & Size to Offset (keeps the current look)" onClick={() => convertUnits(ids, 'offset')}>→ Offset</button>
          </span>
        }
      >
        {fixedSizeReason(node, nodes) && (
          <div className="note">Uses a {fixedSizeReason(node, nodes)} — it will look bigger on smaller screens (e.g. Studio).</div>
        )}
        {(() => {
          const issue = ids.length === 1 ? overlapIssues(doc).find((o) => o.id === node.id) : undefined;
          return issue ? (
            <div className="note overlap-note">
              Sits on <b>{doc.nodes[issue.into].name}</b> but isn't inside it — on other screen shapes they'll drift apart.
              <button className="btn tiny" onClick={() => moveInside([issue])}>Move inside {doc.nodes[issue.into].name}</button>
            </div>
          ) : null;
        })()}
        <button
          className="btn small responsive-btn"
          title="Convert this element and everything inside it to Scale, make fixed-size text scale with it (capped at its current size) and lock its aspect ratio — so it looks the same on every screen size, including Studio's viewport"
          onClick={() => makeResponsive(ids)}
        >
          <Smartphone size={12} /> Make responsive
        </button>
        {laidOut && parentLayout && <div className="note">Position is controlled by the parent's {parentLayout.className}.</div>}
        <Row label={L('Position')}>
          <div className={laidOut ? 'disabled' : ''}>
            <UDim2Field value={p.Position} onChange={set('Position')} />
          </div>
        </Row>
        <Row label={L('Size')}>
          <UDim2Field value={p.Size} onChange={set('Size')} />
        </Row>
        {abs && (
          <Row label="">
            <span className="abs-info">Absolute {Math.round(abs.w)} × {Math.round(abs.h)} at ({Math.round(abs.x)}, {Math.round(abs.y)})</span>
          </Row>
        )}
        <Row label="AnchorPoint">
          <div className="anchor-row">
            <AnchorPicker value={p.AnchorPoint} onChange={set('AnchorPoint')} />
            <Vec2Field value={p.AnchorPoint} onChange={set('AnchorPoint')} step={0.05} />
          </div>
        </Row>
        <Row label={L('Rotation')}>
          <NumberField label="°" value={p.Rotation} onChange={set('Rotation')} step={1} precision={1} />
        </Row>
        <Row label="ZIndex / Order">
          <div className="pair">
            <NumberField label="Z" title="ZIndex" value={p.ZIndex} onChange={(v) => set('ZIndex')(Math.round(v))} precision={0} />
            <NumberField label="LO" title="LayoutOrder" value={p.LayoutOrder} onChange={(v) => set('LayoutOrder')(Math.round(v))} precision={0} />
          </div>
        </Row>
        <Row label="Flags">
          <div className="flags">
            <Toggle value={p.Visible} onChange={set('Visible')} label="Visible" />
            <Toggle value={p.ClipsDescendants} onChange={set('ClipsDescendants')} label="Clips" />
          </div>
        </Row>
      </Section>

      <Section title="Background">
        <Row label={L('BackgroundColor3', 'Color')}>
          <ColorField value={p.BackgroundColor3} onChange={set('BackgroundColor3')} transparency={p.BackgroundTransparency} onTransparency={set('BackgroundTransparency')} />
        </Row>
        <Row label="Border">
          <div className="pair border-pair">
            <NumberField label="px" title="BorderSizePixel" value={p.BorderSizePixel} min={0} precision={0} onChange={(v) => set('BorderSizePixel')(Math.round(v))} />
            <ColorField value={p.BorderColor3} onChange={set('BorderColor3')} />
          </div>
        </Row>
        <CornerRow ids={ids} node={node} nodes={nodes} />
      </Section>

      {isText(cls) && (
        <Section title="Text">
          <Row label="Text" stack>
            <RichTextField value={p.Text} onChange={set('Text')} richText={!!p.RichText} onRichText={set('RichText')} />
          </Row>
          <BindRow ids={ids} node={node} />
          {cls === 'TextBox' && (
            <>
              <Row label="Placeholder"><TextField value={p.PlaceholderText} onChange={set('PlaceholderText')} /></Row>
              <Row label="Placeholder color"><ColorField value={p.PlaceholderColor3} onChange={set('PlaceholderColor3')} /></Row>
            </>
          )}
          <Row label="Font"><FontEditor value={p.FontFace} onChange={set('FontFace')} /></Row>
          <Row label="Size">
            <div className="pair">
              <NumberField label="px" value={p.TextSize} min={1} max={100} precision={0} onChange={(v) => set('TextSize')(Math.round(v))} />
              <Toggle value={p.TextScaled} onChange={set('TextScaled')} label="Scaled" />
            </div>
          </Row>
          {p.RichText || node.textColors ? (
            <Row label={L('TextColor3', 'Color')} stack>
              <RichColorEditor ids={ids} node={node} />
            </Row>
          ) : (
            <Row label={L('TextColor3', 'Color')} title="Turn on RichText for multi-colour text">
              <ColorField value={p.TextColor3} onChange={set('TextColor3')} transparency={p.TextTransparency} onTransparency={set('TextTransparency')} />
            </Row>
          )}
          <Row label="Align">
            <div className="pair">
              <Segmented
                value={p.TextXAlignment}
                options={[
                  { value: 'Left', icon: <TextAlignStart size={13} /> },
                  { value: 'Center', icon: <TextAlignCenter size={13} /> },
                  { value: 'Right', icon: <TextAlignEnd size={13} /> },
                ]}
                onChange={set('TextXAlignment')}
              />
              <Segmented
                value={p.TextYAlignment}
                options={[
                  { value: 'Top', icon: <AlignVerticalJustifyStart size={13} /> },
                  { value: 'Center', icon: <AlignVerticalJustifyCenter size={13} /> },
                  { value: 'Bottom', icon: <AlignVerticalJustifyEnd size={13} /> },
                ]}
                onChange={set('TextYAlignment')}
              />
            </div>
          </Row>
          <Row label="Options">
            <div className="flags">
              <Toggle value={p.TextWrapped} onChange={set('TextWrapped')} label="Wrapped" />
              <Toggle value={p.RichText} onChange={set('RichText')} label="RichText" />
            </div>
          </Row>
          <Row label="LineHeight"><NumberField value={p.LineHeight} step={0.1} min={0.5} max={3} precision={2} onChange={set('LineHeight')} label="" /></Row>
          <Row label="Text stroke" title="Legacy TextStroke (UIStroke is recommended)">
            <ColorField value={p.TextStrokeColor3} onChange={set('TextStrokeColor3')} transparency={p.TextStrokeTransparency} onTransparency={set('TextStrokeTransparency')} />
          </Row>
          {cls === 'TextBox' && (
            <Row label="Behaviour">
              <div className="flags">
                <Toggle value={p.ClearTextOnFocus} onChange={set('ClearTextOnFocus')} label="Clear on focus" />
                <Toggle value={p.MultiLine} onChange={set('MultiLine')} label="MultiLine" />
                <Toggle value={p.TextEditable} onChange={set('TextEditable')} label="Editable" />
              </div>
            </Row>
          )}
          {cls === 'TextButton' && <Row label="Button"><Toggle value={p.AutoButtonColor} onChange={set('AutoButtonColor')} label="AutoButtonColor" /></Row>}
        </Section>
      )}

      {isImage(cls) && <ImageSection ids={ids} node={node} set={set} />}

      {cls === 'ScrollingFrame' && <GenericProps ids={ids} node={node} only={['CanvasSize', 'CanvasPosition', 'AutomaticCanvasSize', 'ScrollingDirection', 'ScrollBarThickness', 'ScrollBarImageColor3', 'ScrollBarImageTransparency', 'ScrollingEnabled']} />}
      {cls === 'CanvasGroup' && <GenericProps ids={ids} node={node} only={['GroupTransparency', 'GroupColor3']} />}
      {cls === 'ViewportFrame' && <GenericProps ids={ids} node={node} only={['Ambient', 'LightColor', 'ImageColor3', 'ImageTransparency']} />}

      <EffectsSection ids={ids} node={node} />
      {ids.length === 1 && <ToastSection node={node} />}

      <Section title="Modifiers" actions={<AddModifierMenu ids={ids} />}>
        {modifiers.length === 0 && <div className="hint">Add UICorner, UIStroke, UIGradient, layouts and constraints.</div>}
        {modifiers.map((m) => (
          <ModifierCard key={m.id} node={m} ids={[m.id]} />
        ))}
      </Section>

      {mode === 'animate' && ids.length === 1 && <NodeTweens node={node} />}
    </>
  );
}

function ImageSection({ ids, node, set }: { ids: string[]; node: GuiNode; set: (n: string) => (v: any) => void }) {
  const p = node.props;
  const update = useStore((s) => s.update);
  const upload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () =>
          update((d) => {
            for (const id of ids) d.nodes[id].preview = { src: reader.result as string, w: img.naturalWidth, h: img.naturalHeight };
          });
        img.src = reader.result as string;
      };
      reader.readAsDataURL(f);
    };
    input.click();
  };
  return (
    <Section title="Image">
      <AvatarRows ids={ids} node={node} />
      <Row label="Image" title="Roblox asset id (rbxassetid://123 or just 123)">
        <TextField value={p.Image} onChange={set('Image')} placeholder="rbxassetid://" />
      </Row>
      <Row label="Preview" title="Local image used for previewing only (not exported). Upload the same image to Roblox and paste its asset id above.">
        <div className="pair">
          <button className="btn small" onClick={upload}><Upload size={12} /> Local file</button>
          {node.preview && <button className="btn small" onClick={() => update((d) => ids.forEach((id) => delete d.nodes[id].preview))}><X size={12} /> Clear</button>}
        </div>
      </Row>
      <Row label="Tint"><ColorField value={p.ImageColor3} onChange={set('ImageColor3')} transparency={p.ImageTransparency} onTransparency={set('ImageTransparency')} /></Row>
      <Row label="ScaleType"><SelectField value={p.ScaleType} options={Object.keys(ENUMS.ScaleType)} onChange={set('ScaleType')} /></Row>
      {p.ScaleType === 'Slice' && (
        <>
          <Row label="SliceCenter"><PropEditor def={propDef(node.className, 'SliceCenter')!} value={p.SliceCenter} onChange={set('SliceCenter')} /></Row>
          <Row label="SliceScale"><NumberField value={p.SliceScale} step={0.1} min={0.01} onChange={set('SliceScale')} label="" /></Row>
        </>
      )}
      {p.ScaleType === 'Tile' && <Row label="TileSize"><UDim2Field value={p.TileSize} onChange={set('TileSize')} /></Row>}
      {node.className === 'ImageButton' && <Row label="Button"><Toggle value={p.AutoButtonColor} onChange={set('AutoButtonColor')} label="AutoButtonColor" /></Row>}
    </Section>
  );
}

function AddModifierMenu({ ids }: { ids: string[] }) {
  const doc = useStore((s) => s.doc);
  const options = MODIFIER_CLASSES.filter((m) => ids.some((id) => modifierAllowed(m as ModifierClass, doc.nodes[id].className)));
  return (
    <select
      className="add-mod"
      value=""
      title="Add modifier"
      onChange={(e) => {
        if (e.target.value) addModifier(ids, e.target.value as ModifierClass);
      }}
    >
      <option value="">+ Add</option>
      {options.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
    </select>
  );
}

function ModifierCard({ node, ids, standalone }: { node: GuiNode; ids: string[]; standalone?: boolean }) {
  const [open, setOpen] = useState(true);
  const update = useStore((s) => s.update);
  const enabled = node.props.Enabled !== false;
  const defs = CLASS_PROPS[node.className].filter((d) => d.name !== 'Enabled');
  const body = (
    <div className="mod-body">
      {defs.map((d) => (
        <Row key={d.name} label={d.name} title={d.name} stack={d.type === 'ColorSequence' || d.type === 'NumberSequence'}>
          <PropEditor def={d} value={node.props[d.name]} onChange={(v) => setProp(ids, d.name, v)} />
        </Row>
      ))}
    </div>
  );
  if (standalone) return <Section title="Properties">{body}</Section>;
  return (
    <div className={`mod-card ${enabled ? '' : 'off'}`}>
      <div className="mod-head" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <ClassIcon cls={node.className} size={13} />
        <span className="mod-name" onClick={(e) => { e.stopPropagation(); useStore.getState().select([node.id]); }} title="Select modifier">{node.className}</span>
        <span className="mod-actions" onClick={(e) => e.stopPropagation()}>
          {'Enabled' in node.props && <Toggle value={enabled} onChange={(v) => setProp(ids, 'Enabled', v)} />}
          <button className="icon-btn" title="Remove" onClick={() => update((d) => removeNode(d as Doc, node.id))}><Trash size={12} /></button>
        </span>
      </div>
      {open && body}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Animation

function NodeTweens({ node }: { node: GuiNode }) {
  const doc = useStore((s) => s.doc);
  const clipId = useStore((s) => s.activeClipId);
  const selectedTween = useStore((s) => s.selectedTweenId);
  const clip = doc.clips.find((c) => c.id === clipId);
  const tweens = (clip?.tweens ?? []).filter((t) => t.nodeId === node.id).sort((a, b) => a.start - b.start);
  const props = ANIMATABLE_PROPS.filter((p) => propDef(node.className, p));
  return (
    <Section title={`Tweens in "${clip?.name ?? ''}"`} actions={
      <select className="add-mod" value="" onChange={(e) => e.target.value && addTween(node.id, e.target.value)}>
        <option value="">+ Tween</option>
        {props.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
    }>
      {!tweens.length && <div className="hint">Move the playhead and change a property (or drag on the canvas) to record a tween.</div>}
      {tweens.map((t) => (
        <div key={t.id} className={`tween-row ${t.id === selectedTween ? 'on' : ''}`} onClick={() => useStore.setState({ selectedTweenId: t.id, playhead: t.start + t.duration })}>
          <Diamond size={10} />
          <span className="tween-prop">{t.prop}</span>
          <span className="tween-time">{t.start.toFixed(2)}s → {(t.start + t.duration).toFixed(2)}s</span>
          <span className="tween-ease">{t.style}/{t.direction}</span>
        </div>
      ))}
    </Section>
  );
}

function EaseCurve({ tween }: { tween: Tween }) {
  const pts: string[] = [];
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    pts.push(`${(t * 100).toFixed(1)},${(80 - ease(tween.style, tween.direction, t) * 60).toFixed(1)}`);
  }
  return (
    <svg className="ease-curve" viewBox="-4 -4 108 98" preserveAspectRatio="none">
      <line x1="0" y1="80" x2="100" y2="80" />
      <line x1="0" y1="20" x2="100" y2="20" />
      <polyline points={pts.join(' ')} />
    </svg>
  );
}

function TweenInspector({ tween }: { tween: Tween }) {
  const doc = useStore((s) => s.doc);
  const node = doc.nodes[tween.nodeId];
  if (!node) return null;
  const def = propDef(node.className, tween.prop)!;
  return (
    <Section title={<>Tween · <b>{node.name}.{tween.prop}</b></>} actions={<button className="icon-btn" title="Delete tween" onClick={() => deleteTween(tween.id)}><Trash size={12} /></button>}>
      <Row label="Timing">
        <div className="pair">
          <NumberField label="Start" value={tween.start} step={0.05} min={0} precision={2} suffix="s" onChange={(v) => updateTween(tween.id, { start: v })} />
          <NumberField label="Dur" value={tween.duration} step={0.05} min={0} precision={2} suffix="s" onChange={(v) => updateTween(tween.id, { duration: v })} />
        </div>
      </Row>
      <Row label="Easing">
        <SelectField value={tween.style} options={EASING_STYLES} onChange={(v) => updateTween(tween.id, { style: v as Tween['style'] })} />
      </Row>
      <Row label="Direction">
        <Segmented value={tween.direction} options={EASING_DIRECTIONS.map((d) => ({ value: d, label: d }))} onChange={(v) => updateTween(tween.id, { direction: v })} />
      </Row>
      <Row label="">
        <EaseCurve tween={tween} />
      </Row>
      <Row label="Target">
        <PropEditor def={def} value={tween.to} onChange={(v) => updateTween(tween.id, { to: v })} />
      </Row>
    </Section>
  );
}
