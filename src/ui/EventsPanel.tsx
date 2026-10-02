// "Events" section: when this element is clicked / hovered / … run these actions.
import { ArrowDown, ArrowUp, Trash, X, Zap } from 'lucide-react';
import { useStore } from '../store';
import { uid } from '../model/doc';
import { isGuiObject, propDef } from '../model/schema';
import { EASING_DIRECTIONS, EASING_STYLES } from '../model/animation';
import { ACTION_KINDS, EVENT_TRIGGERS, PAGE_ACTIONS, TARGETED, actionTarget, defaultAction, eventProps, pageLayoutOf, targetOptions } from '../model/events';
import type { Doc, EventAction, EventActionKind, EventHandler, EventTrigger, GuiNode, Tween } from '../model/types';
import { NumberField, Row, Segmented, SelectField, TextField, Toggle } from './fields';
import { PropEditor } from './PropertiesPanel';
import { screensOf } from '../model/screens';

/** Edit one element's events as one undo step (typing in a field merges into one step) */
function editEvents(nodeId: string, fn: (events: EventHandler[]) => void, coalesce?: string) {
  useStore.getState().update(
    (d) => {
      const n = d.nodes[nodeId];
      if (!n) return;
      const list = (n.events ??= []);
      fn(list as EventHandler[]);
      if (!list.length) delete n.events;
    },
    coalesce ? { coalesce: coalesce + nodeId } : undefined,
  );
}

function editAction(nodeId: string, handlerId: string, actionId: string, patch: Partial<EventAction>, coalesce?: string) {
  editEvents(nodeId, (evs) => {
    const a = evs.find((h) => h.id === handlerId)?.actions.find((x) => x.id === actionId);
    if (a) Object.assign(a, patch);
  }, coalesce && `${coalesce}:${actionId}`);
}

export function EventsSection({ node }: { node: GuiNode }) {
  const doc = useStore((s) => s.doc);
  const events = node.events ?? [];
  const used = new Set(events.map((h) => h.on));
  return (
    <section className="section">
      <div className="section-title">
        <span>Events</span>
        <span className="section-actions">
          <select
            className="add-mod"
            value=""
            title="Add an event"
            onChange={(e) => {
              const on = e.target.value as EventTrigger;
              if (!on) return;
              const first = defaultAction(on === 'load' ? 'print' : 'toggle', node, doc, uid());
              if (on === 'load') first.text = `${node.name} loaded`;
              editEvents(node.id, (evs) => void evs.push({ id: uid(), on, actions: [first] }));
            }}
          >
            <option value="">+ Add</option>
            {EVENT_TRIGGERS.map((t) => <option key={t.value} value={t.value} disabled={used.has(t.value)}>{t.label}</option>)}
          </select>
        </span>
      </div>
      <div className="section-body">
        {!events.length && (
          <div className="hint">
            Make it do something: when it's clicked or hovered, show or hide a frame, play an animation, tween a property, show a toast… Try it in Preview; it's exported as real scripts.
          </div>
        )}
        {events.map((h) => <HandlerCard key={h.id} node={node} handler={h} doc={doc} used={used} />)}
      </div>
    </section>
  );
}

function HandlerCard({ node, handler: h, doc, used }: { node: GuiNode; handler: EventHandler; doc: Doc; used: Set<EventTrigger> }) {
  return (
    <div className="mod-card event-card">
      <div className="mod-head">
        <Zap size={12} className="event-zap" />
        <select
          className="event-trigger"
          value={h.on}
          onChange={(e) => editEvents(node.id, (evs) => void (evs.find((x) => x.id === h.id)!.on = e.target.value as EventTrigger))}
        >
          {EVENT_TRIGGERS.map((t) => <option key={t.value} value={t.value} disabled={t.value !== h.on && used.has(t.value)}>{t.label}</option>)}
        </select>
        <span className="mod-actions">
          <button className="icon-btn" title="Remove this event" onClick={() => editEvents(node.id, (evs) => void evs.splice(evs.findIndex((x) => x.id === h.id), 1))}>
            <Trash size={12} />
          </button>
        </span>
      </div>
      <div className="mod-body">
        {h.actions.map((a, i) => (
          <ActionRow key={a.id} node={node} handler={h} action={a} index={i} doc={doc} />
        ))}
        <select
          className="add-mod event-add"
          value=""
          onChange={(e) => {
            const kind = e.target.value as EventActionKind;
            if (kind) editEvents(node.id, (evs) => void evs.find((x) => x.id === h.id)!.actions.push(defaultAction(kind, node, doc, uid())));
          }}
        >
          <option value="">+ Then…</option>
          {ACTION_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
      </div>
    </div>
  );
}

function ActionRow({ node, handler: h, action: a, index, doc }: { node: GuiNode; handler: EventHandler; action: EventAction; index: number; doc: Doc }) {
  const set = (patch: Partial<EventAction>, coalesce?: string) => editAction(node.id, h.id, a.id, patch, coalesce);
  const move = (d: number) =>
    editEvents(node.id, (evs) => {
      const list = evs.find((x) => x.id === h.id)!.actions;
      const j = index + d;
      if (j < 0 || j >= list.length) return;
      [list[index], list[j]] = [list[j], list[index]];
    });
  const target = actionTarget(node, a, doc);
  const targets = targetOptions(doc);
  const info = ACTION_KINDS.find((k) => k.value === a.kind)!;

  // changing the target keeps the property when the new target has it
  const setTarget = (id: string) => {
    const t = id ? doc.nodes[id] : node;
    const patch: Partial<EventAction> = { target: id || undefined };
    if ((a.kind === 'tween' || a.kind === 'set') && t && a.prop && !eventProps(t.className, a.kind).includes(a.prop)) {
      patch.prop = eventProps(t.className, a.kind)[0];
      patch.value = patch.prop ? t.props[patch.prop] : undefined;
    }
    set(patch);
  };

  return (
    <div className="event-action">
      <div className="event-action-head">
        <span className="event-num">{index + 1}</span>
        <select
          className="event-kind"
          value={a.kind}
          title={info.hint}
          onChange={(e) => {
            const fresh = defaultAction(e.target.value as EventActionKind, target ?? node, doc, a.id);
            set({ ...fresh, target: a.target });
          }}
        >
          {ACTION_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
        <span className="event-action-btns">
          <button className="icon-btn" title="Move up" disabled={index === 0} onClick={() => move(-1)}><ArrowUp size={11} /></button>
          <button className="icon-btn" title="Move down" disabled={index === h.actions.length - 1} onClick={() => move(1)}><ArrowDown size={11} /></button>
          <button className="icon-btn" title="Remove" onClick={() => editEvents(node.id, (evs) => void evs.find((x) => x.id === h.id)!.actions.splice(index, 1))}><X size={11} /></button>
        </span>
      </div>

      {TARGETED.includes(a.kind) && (
        <Row label="Element">
          <select className="event-select" value={a.target ?? ''} onChange={(e) => setTarget(e.target.value)}>
            <option value="">This element ({node.name})</option>
            {targets.filter((t) => t.id !== node.id).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            {a.target && !doc.nodes[a.target] && <option value={a.target}>(deleted element)</option>}
          </select>
        </Row>
      )}

      {a.kind === 'play' && (
        doc.clips.some((c) => c.tweens.length) ? (
          <Row label="Animation">
            <SelectField value={a.clipId ?? ''} options={[['', 'Choose…'], ...doc.clips.filter((c) => c.tweens.length).map((c) => [c.id, c.name] as [string, string])]} onChange={(v) => set({ clipId: v || undefined })} />
          </Row>
        ) : (
          <div className="hint">No animations yet — make one in Animate mode (Alt+A).</div>
        )
      )}

      {(a.kind === 'tween' || a.kind === 'set') && target && (
        <>
          <Row label="Property">
            <SelectField
              value={a.prop ?? ''}
              options={eventProps(target.className, a.kind)}
              onChange={(prop) => set({ prop, value: structuredClone(target.props[prop]) })}
            />
          </Row>
          {a.prop && propDef(target.className, a.prop) && (
            <Row label="To">
              <PropEditor def={propDef(target.className, a.prop)!} value={a.value ?? target.props[a.prop]} onChange={(value) => set({ value }, 'value')} />
            </Row>
          )}
          {a.kind === 'tween' && (
            <>
              <Row label="Time">
                <NumberField value={a.duration ?? 0.3} min={0} step={0.05} precision={2} suffix="s" onChange={(duration) => set({ duration }, 'dur')} />
              </Row>
              <Row label="Easing">
                <div className="pair">
                  <SelectField value={a.style ?? 'Quad'} options={EASING_STYLES} onChange={(v) => set({ style: v as Tween['style'] })} />
                  <Segmented value={a.direction ?? 'Out'} options={EASING_DIRECTIONS.map((d) => ({ value: d, label: d }))} onChange={(direction) => set({ direction })} />
                </div>
              </Row>
            </>
          )}
        </>
      )}

      {a.kind === 'toast' && (() => {
        const toasts = Object.values(doc.nodes).filter((n) => n.toast && n.parentId);
        if (!toasts.length) return <div className="hint">No toast templates yet — insert a "Toast notification" component, or mark a frame as a toast in its Toast section.</div>;
        return (
          <>
            <Row label="Toast">
              <SelectField value={a.toastId ?? ''} options={[['', 'Choose…'], ...toasts.map((t) => [t.id, t.name] as [string, string])]} onChange={(v) => set({ toastId: v || undefined })} />
            </Row>
            <Row label="Title"><TextField value={a.title ?? ''} onChange={(title) => set({ title }, 'title')} /></Row>
            <Row label="Message"><TextField value={a.message ?? ''} onChange={(message) => set({ message }, 'msg')} /></Row>
          </>
        );
      })()}

      {a.kind === 'print' && (
        <Row label="Text"><TextField value={a.text ?? ''} onChange={(text) => set({ text }, 'text')} /></Row>
      )}

      {PAGE_ACTIONS.includes(a.kind) && (() => {
        const layout = pageLayoutOf(doc, target?.id);
        if (!layout) return <div className="hint">Pick a frame that has a UIPageLayout (drag one from Modifiers onto the frame holding the pages).</div>;
        if (a.kind !== 'jumpPage') return null;
        const count = target!.children.filter((c) => doc.nodes[c] && isGuiObject(doc.nodes[c].className) && doc.nodes[c].props.Visible !== false).length;
        return (
          <Row label="Page">
            <NumberField value={(a.page ?? 0) + 1} min={1} max={Math.max(1, count)} step={1} precision={0} suffix={` of ${count}`} onChange={(v) => set({ page: Math.round(v) - 1 })} />
          </Row>
        );
      })()}

      {a.kind === 'showScreen' && (
        (doc.screens?.length ?? 0) < 2 ? (
          <div className="hint">Add another screen first: + next to Screens in Layers.</div>
        ) : (
          <>
            <Row label="Screen">
              <SelectField value={a.screenId ?? ''} options={[['', 'Choose…'], ...screensOf(doc).map((s) => [s.id, s.name] as [string, string])]} onChange={(v) => set({ screenId: v || undefined })} />
            </Row>
            <Row label="">
              <Toggle value={!a.keepOthers} onChange={(v) => set({ keepOthers: !v })} label="Hide the other screens" />
            </Row>
          </>
        )
      )}

      {a.kind === 'wait' && (
        <Row label="Seconds">
          <NumberField value={a.seconds ?? 0.5} min={0} step={0.1} precision={2} suffix="s" onChange={(seconds) => set({ seconds }, 'sec')} />
        </Row>
      )}
    </div>
  );
}
