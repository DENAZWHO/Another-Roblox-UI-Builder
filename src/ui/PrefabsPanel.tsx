import { memo, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Download, Plus, RefreshCw, Trash, Upload } from 'lucide-react';
import { useStore } from '../store';
import { computeLayout } from '../model/layout';
import { defaultProps, isGuiObject } from '../model/schema';
import { exportPrefabsText, importPrefabsText, prefabs, removePrefab, subscribePrefabs, updatePrefab, type Prefab } from '../model/prefabs';
import type { GuiNode } from '../model/types';
import { insertPrefab, savePrefabFromSelection, updatePrefabFromSelection } from '../actions';
import { download } from '../files';
import { ScreenView, type RenderCtx } from './render';
import { useFontEpoch } from './hooks';
import { startDragPreview } from './DragPreview';

export const PREFAB_DRAG_TYPE = 'application/x-rbx-prefab';
const THUMB_W = 104;
const THUMB_H = 64;

export const usePrefabs = () => useSyncExternalStore(subscribePrefabs, prefabs);

/** Renders the prefab with the real renderer, scaled to fit the card */
const PrefabThumb = memo(function PrefabThumb({ prefab }: { prefab: Prefab }) {
  const epoch = useFontEpoch();
  const previewUser = useStore((s) => s.doc.previewUser);
  const view = useMemo(() => {
    const rootId = '__prefab_root__';
    const nodes: Record<string, GuiNode> = {
      [rootId]: { id: rootId, className: 'ScreenGui', name: '', parentId: null, children: [...prefab.fragment.rootIds], props: { ...defaultProps('ScreenGui'), IgnoreGuiInset: true, Enabled: true } },
    };
    for (const n of prefab.fragment.nodes) nodes[n.id] = { ...n, parentId: n.parentId ?? rootId };
    const device = { name: 'prefab', w: Math.max(1, prefab.size.w), h: Math.max(1, prefab.size.h) };
    return { rootId, nodes, layout: computeLayout(nodes, [rootId], device), device };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefab, epoch]);
  const k = Math.min(THUMB_W / view.device.w, THUMB_H / view.device.h, 1);
  const ctx: RenderCtx = { nodes: view.nodes, layout: view.layout, interactive: false, previewUser };
  return (
    <div className="prefab-thumb">
      <div style={{ width: view.device.w, height: view.device.h, transform: `scale(${k})`, transformOrigin: '0 0', position: 'absolute', left: (THUMB_W - view.device.w * k) / 2, top: (THUMB_H - view.device.h * k) / 2 }}>
        <ScreenView id={view.rootId} ctx={ctx} />
      </div>
    </div>
  );
});

function PrefabCard({ prefab }: { prefab: Prefab }) {
  const [renaming, setRenaming] = useState(false);
  const hasSelection = useStore((s) => s.selection.some((id) => isGuiObject(s.doc.nodes[id]?.className)));
  return (
    <div
      className="prefab-card"
      draggable={!renaming}
      title={`${prefab.name} — click to insert, or drag onto the canvas`}
      onDragStart={(e) => {
        e.dataTransfer.setData(PREFAB_DRAG_TYPE, prefab.id);
        e.dataTransfer.effectAllowed = 'copy';
        startDragPreview(e, prefab.name, () => structuredClone(prefab.fragment));
      }}
      onClick={() => !renaming && insertPrefab(prefab)}
    >
      <PrefabThumb prefab={prefab} />
      {renaming ? (
        <input
          className="prefab-rename"
          autoFocus
          defaultValue={prefab.name}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => {
            const name = e.target.value.trim();
            if (name && name !== prefab.name) updatePrefab(prefab.id, { name });
            setRenaming(false);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setRenaming(false);
          }}
        />
      ) : (
        <span
          className="prefab-name"
          onDoubleClick={(e) => {
            e.stopPropagation();
            setRenaming(true);
          }}
        >
          {prefab.name}
        </span>
      )}
      <span className="prefab-actions" onClick={(e) => e.stopPropagation()}>
        <button title="Replace with the current selection" disabled={!hasSelection} onClick={() => confirm(`Replace "${prefab.name}" with the selected elements?`) && updatePrefabFromSelection(prefab.id)}>
          <RefreshCw size={11} />
        </button>
        <button title="Export to a file (to share)" onClick={() => download(`${prefab.name.replace(/[^\w-]+/g, '_')}.uiprefab.json`, exportPrefabsText([prefab.id]), 'application/json')}>
          <Download size={11} />
        </button>
        <button title="Delete prefab" onClick={() => confirm(`Delete the prefab "${prefab.name}"?`) && removePrefab(prefab.id)}>
          <Trash size={11} />
        </button>
      </span>
    </div>
  );
}

export function PrefabsSection({ intoLabel }: { intoLabel?: ReactNode }) {
  const list = usePrefabs();
  const selection = useStore((s) => s.selection);
  const doc = useStore((s) => s.doc);
  const sel = selection.filter((id) => isGuiObject(doc.nodes[id]?.className));
  const [name, setName] = useState('');
  const defaultName = sel.length ? doc.nodes[sel[0]].name + (sel.length > 1 ? ` +${sel.length - 1}` : '') : '';

  const importFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const n = importPrefabsText(await f.text());
        useStore.getState().showToast(`Imported ${n} prefab${n > 1 ? 's' : ''}`);
      } catch (e) {
        useStore.getState().showToast(`Import failed: ${(e as Error).message}`);
      }
    };
    input.click();
  };

  return (
    <>
      <div className="insert-title prefab-title">
        <span>My prefabs {intoLabel}</span>
        <span className="prefab-tools">
          <button title="Import prefabs from a file" onClick={importFile}><Upload size={12} /></button>
          {list.length > 0 && (
            <button title="Export all prefabs" onClick={() => download('prefabs.uiprefab.json', exportPrefabsText(), 'application/json')}><Download size={12} /></button>
          )}
        </span>
      </div>
      <div className="prefab-save">
        <input
          className="text"
          placeholder={sel.length ? defaultName : 'Select elements to save…'}
          value={name}
          disabled={!sel.length}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && sel.length) {
              savePrefabFromSelection(name || defaultName);
              setName('');
            }
          }}
        />
        <button
          className="btn small"
          disabled={!sel.length}
          title="Save the selected elements as a reusable prefab (Ctrl+Alt+K)"
          onClick={() => {
            savePrefabFromSelection(name || defaultName);
            setName('');
          }}
        >
          <Plus size={12} /> Save
        </button>
      </div>
      {list.length === 0 ? (
        <div className="hint prefab-empty">Design something, select it and press Save — it shows up here for every project. Click a prefab to insert it, drag it onto the canvas, double-click its name to rename.</div>
      ) : (
        <div className="prefab-grid">
          {list.map((p) => <PrefabCard key={p.id} prefab={p} />)}
        </div>
      )}
    </>
  );
}
