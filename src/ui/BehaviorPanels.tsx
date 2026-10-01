import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Repeat, Trash, X } from 'lucide-react';
import { useStore } from '../store';
import { EFFECTS, EFFECT_KINDS } from '../model/effects';
import { DEFAULT_PREVIEW_PPS, findChild } from '../model/layout';
import { isGuiObject } from '../model/schema';
import { clipTrigger, defaultFrom } from '../model/runtime';
import { pathTo } from '../model/doc';
import type { AnimClip, AvatarKind, EffectKind, GuiNode, PreviewUser, TextBinding, ToastEnter, TriggerKind } from '../model/types';
import { addEffect, addReverseClip, makeAllResponsive, moveInside, overlapIssues, patchNodes, removeEffect, renameClip, responsiveIssues, setCornerRadius, updateClip, updateEffect } from '../actions';
import { NumberField, Row, Segmented, SelectField, TextField, Toggle, Vec2Field } from './fields';
import { TRIGGER_LABELS } from './labels';
import { lookupUser } from './thumbs';

function Section({ title, children, actions }: { title: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="section">
      <div className="section-title">
        <span>{title}</span>
        <span className="section-actions">{actions}</span>
      </div>
      <div className="section-body">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Animation clip settings (Animate mode)

const POINTER_TRIGGERS: TriggerKind[] = ['click', 'hoverEnter', 'hoverLeave', 'pressDown', 'pressUp'];

export function ClipSettings() {
  const doc = useStore((s) => s.doc);
  const clipId = useStore((s) => s.activeClipId);
  const selection = useStore((s) => s.selection);
  const clip = doc.clips.find((c) => c.id === clipId);
  if (!clip) return null;
  const trigger = clipTrigger(clip);
  const needsTarget = POINTER_TRIGGERS.includes(trigger);
  const target = clip.triggerNodeId ? doc.nodes[clip.triggerNodeId] : undefined;
  const sel = selection.find((id) => isGuiObject(doc.nodes[id]?.className));
  const from = clip.from ?? defaultFrom(clip);
  const guiNodes = Object.values(doc.nodes).filter((n) => isGuiObject(n.className));
  const label = (n: GuiNode) => pathTo(doc.nodes, n.id).slice(1).map((id) => doc.nodes[id].name).join(' › ');

  const setTrigger = (t: TriggerKind) => {
    const patch: Partial<AnimClip> = { trigger: t };
    // pointer triggers default to the selected element
    if (POINTER_TRIGGERS.includes(t) && !clip.triggerNodeId && sel) patch.triggerNodeId = sel;
    updateClip(clip.id, patch);
  };

  return (
    <Section title={<>Animation · <b>{clip.name}</b></>}>
      <Row label="Name">
        <TextField value={clip.name} onChange={(v) => renameClip(clip.id, v)} />
      </Row>
      <Row label="Plays">
        <SelectField value={trigger} options={(Object.keys(TRIGGER_LABELS) as TriggerKind[]).map((k) => [k, TRIGGER_LABELS[k]] as [string, string])} onChange={(v) => setTrigger(v as TriggerKind)} />
      </Row>
      {needsTarget && (
        <Row label="Element">
          <div className="trigger-target">
            <select className="select" value={clip.triggerNodeId ?? ''} onChange={(e) => updateClip(clip.id, { triggerNodeId: e.target.value || undefined })}>
              <option value="">Choose element…</option>
              {guiNodes.map((n) => <option key={n.id} value={n.id}>{label(n)}</option>)}
            </select>
            {sel && sel !== clip.triggerNodeId && (
              <button className="btn tiny" title="Use the selected element" onClick={() => updateClip(clip.id, { triggerNodeId: sel })}>Use selected</button>
            )}
          </div>
          {!target && <div className="font-note">Pick which element's {TRIGGER_LABELS[trigger].replace('On ', '')} starts this animation.</div>}
        </Row>
      )}
      <Row label="Loop">
        <div className="pair">
          <Toggle value={!!clip.loop} onChange={(v) => updateClip(clip.id, { loop: v || undefined })} label="Repeat" />
          {clip.loop && <NumberField label="wait" title="Pause between repeats" value={clip.loopDelay ?? 0} min={0} step={0.1} precision={2} suffix="s" onChange={(v) => updateClip(clip.id, { loopDelay: v })} />}
        </div>
      </Row>
      <Row label="Starts from" title="Design: snaps animated properties back to their designed values first. Current: tweens from wherever they are (best for hover in/out).">
        <Segmented value={from} options={[{ value: 'design', label: 'Design values' }, { value: 'current', label: 'Current values' }]} onChange={(v) => updateClip(clip.id, { from: v })} />
      </Row>
      {(trigger === 'hoverEnter' || trigger === 'pressDown') && clip.tweens.length > 0 && (
        <Row label="">
          <button className="btn small" onClick={() => addReverseClip(clip.id)}>
            <Repeat size={12} /> Add matching {trigger === 'hoverEnter' ? 'hover-out' : 'release'} animation
          </button>
        </Row>
      )}
      <p className="hint">
        {trigger === 'load' && 'Plays as soon as the UI loads.'}
        {trigger === 'manual' && <>Exported as <code>play{clip.name}()</code> for you to call from your own scripts.</>}
        {needsTarget && target && <>Exports as <code>{target.name}.{trigger === 'click' ? (target.className.endsWith('Button') ? 'Activated' : 'InputBegan') : trigger === 'hoverEnter' ? 'MouseEnter' : trigger === 'hoverLeave' ? 'MouseLeave' : trigger === 'pressDown' ? 'MouseButton1Down' : 'MouseButton1Up'}</code> → play. Try it in Preview.</>}
      </p>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Effects

export function EffectsSection({ ids, node }: { ids: string[]; node: GuiNode }) {
  const doc = useStore((s) => s.doc);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const effects = node.effects ?? [];
  const tweened = new Set(doc.clips.flatMap((c) => c.tweens.filter((t) => t.nodeId === node.id).map((t) => t.prop)));
  return (
    <Section
      title="Effects"
      actions={
        <select className="add-mod" value="" title="Add effect" onChange={(e) => e.target.value && addEffect(ids, e.target.value as EffectKind)}>
          <option value="">+ Add</option>
          {EFFECT_KINDS.map((k) => <option key={k} value={k} disabled={effects.some((x) => x.kind === k)}>{EFFECTS[k].label}</option>)}
        </select>
      }
    >
      {!effects.length && <div className="hint">Look at mouse, hover grow, float, spin… They run in Preview and in the exported scripts.</div>}
      {effects.map((e) => {
        const info = EFFECTS[e.kind];
        const isOpen = open[e.id] !== false;
        const conflict = info.overrides && info.overrides !== 'UIScale' && tweened.has(info.overrides);
        return (
          <div className="mod-card" key={e.id}>
            <div className="mod-head" onClick={() => setOpen({ ...open, [e.id]: !isOpen })}>
              {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              <span className="fx-dot" />
              <span className="mod-name">{info.label}</span>
              <span className="mod-actions" onClick={(ev) => ev.stopPropagation()}>
                <button className="icon-btn" title="Remove" onClick={() => removeEffect(node.id, e.id)}><Trash size={12} /></button>
              </span>
            </div>
            {isOpen && (
              <div className="mod-body">
                <div className="hint">{info.description}</div>
                <Row label={info.amount.label}>
                  <NumberField value={e.amount} step={info.amount.step} min={info.amount.min} max={info.amount.max} precision={3} suffix={info.amount.suffix} onChange={(v) => updateEffect(node.id, e.id, { amount: v })} label="" />
                </Row>
                {info.speed && (
                  <Row label={info.speed.label}>
                    <NumberField value={e.speed} step={info.speed.step} min={info.speed.min} precision={2} suffix={info.speed.suffix} onChange={(v) => updateEffect(node.id, e.id, { speed: v })} label="" />
                  </Row>
                )}
                {info.invert && (
                  <Row label="">
                    <Toggle value={!!e.invert} onChange={(v) => updateEffect(node.id, e.id, { invert: v })} label="Invert direction" />
                  </Row>
                )}
                {conflict && <div className="font-note">This effect sets {info.overrides} every frame, so it overrides tweens of {info.overrides} on this element.</div>}
              </div>
            )}
          </div>
        );
      })}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Corners, player data, world placement

export function CornerRow({ ids, node, nodes }: { ids: string[]; node: GuiNode; nodes: Record<string, GuiNode> }) {
  const corner = findChild(nodes, node.id, 'UICorner');
  const r = corner?.props.CornerRadius;
  const full = r && r.s >= 0.5;
  return (
    <Row label="Corners" title="UICorner radius — or drag the dots inside the selection's corners on the canvas">
      <div className="pair corner-row">
        <NumberField label="◜" title="CornerRadius offset (px)" value={full ? 0 : r?.o ?? 0} min={0} precision={0} onChange={(v) => setCornerRadius(ids, { s: 0, o: Math.round(v) })} />
        <button className={`btn small ${full ? 'on' : ''}`} title="Fully rounded (CornerRadius 0.5 scale)" onClick={() => setCornerRadius(ids, { s: 0.5, o: 0 })}>Round</button>
      </div>
    </Row>
  );
}

export function BindRow({ ids, node }: { ids: string[]; node: GuiNode }) {
  return (
    <Row label="Player text" title="Replace the text at runtime with the local player's name">
      <SelectField
        value={node.bind ?? ''}
        options={[['', 'None (use Text)'], ['DisplayName', 'Display name'], ['Name', 'Username'], ['UserId', 'User ID']]}
        onChange={(v) => patchNodes(ids, { bind: (v || undefined) as TextBinding | undefined })}
      />
    </Row>
  );
}

export function AvatarRows({ ids, node }: { ids: string[]; node: GuiNode }) {
  const a = node.avatar;
  return (
    <>
      <Row label="Player avatar" title="Shows the local player's avatar (Players:GetUserThumbnailAsync) at runtime">
        <SelectField
          value={a?.kind ?? ''}
          options={[['', 'Off (use Image)'], ['HeadShot', 'Headshot'], ['AvatarBust', 'Bust'], ['AvatarThumbnail', 'Full body']]}
          onChange={(v) => patchNodes(ids, { avatar: v ? { kind: v as AvatarKind, size: a?.size ?? 420 } : undefined })}
        />
      </Row>
      {a && (
        <>
          <Row label="Resolution">
            <SelectField value={String(a.size)} options={['48', '60', '100', '150', '180', '352', '420'].map((s) => [s, `${s}×${s}`] as [string, string])} onChange={(v) => patchNodes(ids, { avatar: { ...a, size: +v as any } })} />
          </Row>
          <PreviewUserRow />
        </>
      )}
    </>
  );
}

export function PreviewUserRow() {
  const user = useStore((s) => s.doc.previewUser);
  const [name, setName] = useState(user?.name ?? 'Roblox');
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const load = async () => {
    setState('loading');
    const u: PreviewUser | null = await lookupUser(name.trim());
    if (!u) return setState('error');
    setState('idle');
    useStore.getState().update((d) => void (d.previewUser = u));
  };
  return (
    <Row label="Preview as" title="Which Roblox user the editor shows for avatars and player names (in game it's always the local player)">
      <div className="pair">
        <input className="text" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} placeholder="Username" />
        <button className="btn small" onClick={load} disabled={state === 'loading'}>{state === 'loading' ? '…' : 'Load'}</button>
      </div>
      {state === 'error' && <div className="font-note">User not found (needs the dev server)</div>}
      {user && state !== 'error' && <div className="abs-info">{user.displayName} (@{user.name}) · id {user.id}</div>}
    </Row>
  );
}

export function WorldSection({ node }: { node: GuiNode }) {
  const billboard = node.className === 'BillboardGui';
  return (
    <Section title="World placement">
      <Row label="Adornee" title="Path of the part this GUI attaches to. Used by Studio sync and the exported scripts.">
        <div className="adornee">
          <TextField value={node.adornee ?? ''} onChange={(v) => patchNodes([node.id], { adornee: v.trim() || undefined }, 'adornee:' + node.id)} placeholder="Workspace.Shop.Sign" />
          {node.adornee && <button className="icon-btn" title="Clear" onClick={() => patchNodes([node.id], { adornee: undefined })}><X size={12} /></button>}
        </div>
      </Row>
      {billboard ? (
        <Row label="Preview zoom" title="Pixels per stud used to draw the artboard (in game this depends on camera distance). Size's Scale part is in studs, Offset in pixels.">
          <NumberField label="px/stud" value={node.previewPPS ?? DEFAULT_PREVIEW_PPS} min={5} max={400} precision={0} onChange={(v) => patchNodes([node.id], { previewPPS: Math.round(v) }, 'pps:' + node.id)} />
        </Row>
      ) : (
        node.props.SizingMode === 'PixelsPerStud' && (
          <Row label="Face size" title="Size of the part face in studs, used to size the artboard">
            <Vec2Field value={node.previewStuds ?? { x: 8, y: 6 }} labels={['W', 'H']} step={0.5} onChange={(v) => patchNodes([node.id], { previewStuds: v }, 'studs:' + node.id)} />
          </Row>
        )
      )}
      <p className="hint">
        {billboard
          ? 'Floats above its Adornee and always faces the camera. Size Scale = studs, Offset = pixels.'
          : "Drawn on one face of its Adornee. Buttons only work when the GUI is in PlayerGui — the exported LocalScript does that for you."}
      </p>
    </Section>
  );
}

/** Warns about fixed-size elements (they look bigger on small screens like Studio's viewport) with a one-click fix */
function PixelScaling() {
  const doc = useStore((s) => s.doc);
  const update = useStore((s) => s.update);
  const on = doc.scalePixels !== false;
  const design = doc.designSize ?? { w: doc.device.w, h: doc.device.h };
  const f = Math.min(doc.device.w / design.w, doc.device.h / design.h);
  return (
    <div className="pixel-scaling">
      <Toggle value={on} onChange={(v) => update((d) => void (d.scalePixels = v))} label="Scale strokes, text, corners & padding with the screen" />
      <div className="hint">
        Roblox draws these in pixels, so on smaller screens (Studio, phones) they look too big next to Scale-sized elements. With this on they shrink
        and grow with the screen, in the editor, in the exported script and live in Studio (via the plugin).
      </div>
      {on && (
        <Row label="Designed at" title="Resolution your pixel values were designed for">
          <div className="pair">
            <NumberField label="W" value={design.w} min={100} precision={0} onChange={(w) => update((d) => void (d.designSize = { ...design, w: Math.round(w) }))} />
            <NumberField label="H" value={design.h} min={100} precision={0} onChange={(h) => update((d) => void (d.designSize = { ...design, h: Math.round(h) }))} />
          </div>
          {Math.abs(f - 1) > 0.001 && (
            <div className="abs-info">
              Previewing at {Math.round(f * 100)}% pixel scale ·{' '}
              <button className="link" onClick={() => update((d) => void (d.designSize = { w: d.device.w, h: d.device.h }))}>design at {doc.device.w}×{doc.device.h} instead</button>
            </div>
          )}
        </Row>
      )}
    </div>
  );
}

/** Elements sitting on a card/frame without being inside it drift apart on other screen shapes */
function OverlapCheck() {
  const doc = useStore((s) => s.doc);
  const issues = overlapIssues(doc);
  if (!issues.length) return null;
  return (
    <div className="resp-warn">
      <div>
        <b>
          {issues.length} element{issues.length > 1 ? 's sit' : ' sits'} on top of a frame without being inside it
        </b>
        . They're positioned against different parents, so on screens with another shape (Studio's viewport, phones) they slide apart.
      </div>
      <ul className="overlap-list">
        {issues.slice(0, 6).map((i) => (
          <li key={i.id}>
            <span>
              <b>{doc.nodes[i.id].name}</b> on <b>{doc.nodes[i.into].name}</b>
            </span>
            <button className="btn tiny" onClick={() => moveInside([i])}>Move inside</button>
          </li>
        ))}
      </ul>
      {issues.length > 1 && <button className="primary" onClick={() => moveInside(issues)}>Move all inside their frames</button>}
    </div>
  );
}

export function ResponsiveCheck() {
  const doc = useStore((s) => s.doc);
  const issues = responsiveIssues(doc);
  if (!issues.length)
    return (
      <>
        <div className="resp-ok">✓ All sizes scale with the screen</div>
        <OverlapCheck />
        <PixelScaling />
      </>
    );
  const names = issues.slice(0, 4).map((id) => doc.nodes[id].name);
  return (
    <div className="resp-warn">
      <div>
        <b>{issues.length} element{issues.length > 1 ? 's use' : ' uses'} fixed pixel sizes</b> ({names.join(', ')}
        {issues.length > 4 ? '…' : ''}). They stay the same number of pixels on every screen, so they look much bigger on small or high-DPI
        screens — like Studio's viewport or phones.
      </div>
      <button className="primary" onClick={makeAllResponsive}>Make everything responsive</button>
      <div className="hint">
        Converts them to Scale, makes text scale (never above its current size) and locks each component's aspect ratio. Looks the same here at{' '}
        {doc.device.w}×{doc.device.h}.
      </div>
      <OverlapCheck />
      <PixelScaling />
    </div>
  );
}

const TOAST_ENTERS: [ToastEnter, string][] = [
  ['slideRight', 'Slide in from the right'],
  ['slideLeft', 'Slide in from the left'],
  ['slideDown', 'Slide down from the top'],
  ['slideUp', 'Slide up from the bottom'],
  ['fade', 'Fade in'],
  ['pop', 'Pop in'],
];

/** Turn an element into a toast template: hidden in game, cloned + animated each time a toast is shown */
export function ToastSection({ node }: { node: GuiNode }) {
  const doc = useStore((s) => s.doc);
  const cfg = node.toast;
  const set = (patch: Partial<NonNullable<GuiNode['toast']>> | null) =>
    patchNodes([node.id], { toast: patch === null ? undefined : { duration: 3, enter: 'slideRight', ...cfg, ...patch } });
  const root = pathTo(doc.nodes, node.id)[0];
  const event = 'Show' + node.name.replace(/[^A-Za-z0-9_]/g, '');
  const hasTitle = Object.values(doc.nodes).some((n) => n.name === 'Title' && pathTo(doc.nodes, n.id).includes(node.id));
  const hasMessage = Object.values(doc.nodes).some((n) => n.name === 'Message' && pathTo(doc.nodes, n.id).includes(node.id));
  const guiNodes = Object.values(doc.nodes).filter((n) => isGuiObject(n.className) && n.id !== node.id && !pathTo(doc.nodes, n.id).includes(node.id));
  const label = (n: GuiNode) => pathTo(doc.nodes, n.id).slice(1).map((id) => doc.nodes[id].name).join(' › ');
  return (
    <Section title="Toast" actions={<Toggle value={!!cfg} onChange={(v) => set(v ? {} : null)} />}>
      {!cfg ? (
        <div className="hint">Use this element as a toast notification: hidden in game, then shown (copied) whenever you call it — slides in, waits, slides out.</div>
      ) : (
        <>
          <Row label="Animation">
            <SelectField value={cfg.enter} options={TOAST_ENTERS} onChange={(v) => set({ enter: v as ToastEnter })} />
          </Row>
          <Row label="On screen">
            <NumberField value={cfg.duration} min={0.5} step={0.5} precision={1} suffix="s" onChange={(v) => set({ duration: v })} label="" />
          </Row>
          <Row label="Show on click" title="Optional: show this toast when an element is clicked">
            <select className="select" value={cfg.triggerNodeId ?? ''} onChange={(e) => set({ triggerNodeId: e.target.value || undefined })}>
              <option value="">Nothing (call from scripts)</option>
              {guiNodes.map((n) => <option key={n.id} value={n.id}>{label(n)}</option>)}
            </select>
          </Row>
          {(!hasTitle || !hasMessage) && (
            <div className="font-note">
              Name text labels inside it <b>Title</b> and <b>Message</b> so scripts can fill them in{hasTitle || hasMessage ? ` (missing: ${!hasTitle ? 'Title' : 'Message'})` : ''}.
            </div>
          )}
          {cfg.enter === 'fade' && node.className !== 'CanvasGroup' && <div className="font-note">Fading needs a CanvasGroup — this {node.className} will just appear.</div>}
          <div className="toast-usage">
            <div className="muted">Show it from a LocalScript:</div>
            <code>{`playerGui.${doc.nodes[root]?.name ?? 'ScreenGui'}:WaitForChild("${event}"):Fire("Quest complete!", "You earned 50 coins")`}</code>
            <div className="muted">From the server: add a RemoteEvent named <b>UIBuilderToast</b> to ReplicatedStorage, then</div>
            <code>{'remote:FireClient(player, "Title", "Message")'}</code>
          </div>
          <Row label="">
            <button className="btn small" onClick={() => useStore.setState({ dialog: 'preview' })}>Test it in Preview</button>
          </Row>
        </>
      )}
    </Section>
  );
}
