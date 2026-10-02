// "Animations" section: add a ready-made animation to the element, see the ones that move it, preview them.
import { Play, Repeat, Trash } from 'lucide-react';
import { useStore } from '../store';
import { ANIM_TEMPLATES, TEMPLATE_GROUPS, clipsFor } from '../model/animTemplates';
import { clipTrigger } from '../model/runtime';
import type { GuiNode, TriggerKind } from '../model/types';
import { addTemplateClip, deleteClip, previewClip, updateClip } from '../actions';
import { TRIGGER_LABELS } from './labels';

const POINTER: TriggerKind[] = ['click', 'hoverEnter', 'hoverLeave', 'pressDown', 'pressUp'];

export function AnimationsSection({ node }: { node: GuiNode }) {
  const doc = useStore((s) => s.doc);
  const clips = clipsFor(doc, node.id);
  return (
    <section className="section">
      <div className="section-title">
        <span>Animations</span>
        <span className="section-actions">
          <select
            className="add-mod anim-add"
            value=""
            title="Add a ready-made animation"
            onChange={(e) => {
              const t = ANIM_TEMPLATES.find((x) => x.id === e.target.value);
              if (!t) return;
              const id = addTemplateClip(node.id, t.id);
              if (!id) return;
              const how = t.trigger === 'manual' ? 'play it from an event (Play animation)' : `it plays ${TRIGGER_LABELS[t.trigger].toLowerCase()}`;
              useStore.getState().showToast(`Added "${doc.nodes[node.id].name} ${t.name}" — ${how}. Press ▶ to watch it.`);
            }}
          >
            <option value="">+ Add</option>
            {TEMPLATE_GROUPS.map((g) => (
              <optgroup key={g} label={g}>
                {ANIM_TEMPLATES.filter((t) => t.group === g && (!t.appliesTo || t.appliesTo(node))).map((t) => <option key={t.id} value={t.id} title={t.description}>{t.name}</option>)}
              </optgroup>
            ))}
          </select>
        </span>
      </div>
      <div className="section-body">
        {!clips.length && <div className="hint">Fade in, slide in, pop, bounce, shake… pick one from + Add. It becomes a normal animation you can tweak on the timeline (Alt+A).</div>}
        {clips.map((c) => {
          const trig = clipTrigger(c);
          return (
            <div key={c.id} className="anim-row">
              <button className="icon-btn" title="Play it on the canvas" onClick={() => previewClip(c.id)}><Play size={12} /></button>
              <span className="anim-name" title="Open in Animate mode" onClick={() => useStore.setState({ mode: 'animate', activeClipId: c.id, playhead: 0, playing: false })}>
                {c.name}
              </span>
              <select
                className="anim-trigger"
                value={trig}
                title="When it plays"
                onChange={(e) => {
                  const t = e.target.value as TriggerKind;
                  updateClip(c.id, { trigger: t, triggerNodeId: POINTER.includes(t) ? (c.triggerNodeId ?? node.id) : c.triggerNodeId });
                }}
              >
                {(Object.keys(TRIGGER_LABELS) as TriggerKind[]).map((t) => <option key={t} value={t}>{TRIGGER_LABELS[t]}</option>)}
              </select>
              <button className={`icon-btn ${c.loop ? 'on' : ''}`} title={c.loop ? 'Looping — click to play once' : 'Play once — click to loop'} onClick={() => updateClip(c.id, { loop: !c.loop })}>
                <Repeat size={12} />
              </button>
              <button className="icon-btn" title="Delete this animation" onClick={() => deleteClip(c.id)}><Trash size={12} /></button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
