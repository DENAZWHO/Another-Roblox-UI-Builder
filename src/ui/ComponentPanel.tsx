// The banner at the top of the properties panel for main components and their instances.
import { useStore } from '../store';
import { instanceRootOf, instancesOf } from '../model/components';
import type { GuiNode } from '../model/types';
import { detachInstance, insertInstance, removeComponent, resetOverrides } from '../actions';
import { zoomToSelection } from './viewport';

/** Select (and show) the main component of an instance */
export function goToMain(id: string) {
  const s = useStore.getState();
  const root = instanceRootOf(s.doc, id);
  const node = s.doc.nodes[id];
  // the matching node inside the main, or the main itself
  const target = node?.src && s.doc.nodes[node.src] ? node.src : root?.instanceOf;
  if (!target) return;
  s.select([target]);
  requestAnimationFrame(() => zoomToSelection());
}

export function ComponentBanner({ node }: { node: GuiNode }) {
  const doc = useStore((s) => s.doc);
  if (node.component) {
    const insts = instancesOf(doc, node.id);
    return (
      <div className="comp-banner">
        <div className="comp-banner-title"><span className="comp-badge main">◆</span> Main component</div>
        <div className="hint">
          {insts.length ? `${insts.length === 1 ? '1 instance follows' : `${insts.length} instances follow`} it — changes here update ${insts.length === 1 ? 'it' : 'them all'}.` : 'No instances yet. Duplicate it (Ctrl+D) or insert it from Insert → Components.'}
        </div>
        <div className="comp-banner-actions">
          <button className="btn small" onClick={() => insertInstance(node.id)}>Insert instance</button>
          {insts.length > 0 && <button className="btn small" onClick={() => useStore.getState().select(insts.map((i) => i.id))}>Select instances</button>}
          <button className="btn small" title="Stop being a component (instances become plain copies)" onClick={() => removeComponent(node.id)}>Unmake</button>
        </div>
      </div>
    );
  }
  const root = instanceRootOf(doc, node.id);
  if (!root) return null;
  const main = doc.nodes[root.instanceOf!];
  const overrides = (() => {
    let n = 0;
    const walk = (id: string) => {
      const x = doc.nodes[id];
      if (!x) return;
      n += x.overrides?.length ?? 0;
      x.children.forEach(walk);
    };
    walk(root.id);
    return n;
  })();
  return (
    <div className="comp-banner">
      <div className="comp-banner-title">
        <span className="comp-badge">◇</span> {root.id === node.id ? 'Instance' : `Part of instance "${root.name}"`} of {main?.name ?? '?'}
      </div>
      <div className="hint">
        {node.overrides?.length ? `Changed here: ${node.overrides.join(', ')}. ` : ''}
        Edits made here are kept; everything else follows the main component.
      </div>
      <div className="comp-banner-actions">
        <button className="btn small" onClick={() => goToMain(node.id)}>Go to main</button>
        {overrides > 0 && <button className="btn small" title="Look like the main component again" onClick={() => resetOverrides(root.id)}>Reset {overrides} override{overrides === 1 ? '' : 's'}</button>}
        <button className="btn small" title="Make it a plain copy that no longer follows the main" onClick={() => detachInstance(root.id)}>Detach</button>
      </div>
    </div>
  );
}
