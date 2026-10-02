import { create } from 'zustand';
import { produce, type Draft } from 'immer';
import type { Doc, GuiObjectClass } from './model/types';
import type { Units } from './model/doc';
import { finalizeComponents } from './model/components';
import { finalizeStyles } from './model/styles';

export type Tool = 'move' | 'hand' | 'pen' | GuiObjectClass;
export type Mode = 'design' | 'animate';
export type Dialog = null | 'export' | 'preview' | 'shortcuts' | 'studio' | 'upload';

interface UpdateOpts {
  /** Consecutive updates with the same key within 800ms merge into one undo step */
  coalesce?: string;
}

export interface State {
  doc: Doc;
  past: Doc[];
  future: Doc[];
  gestureBase: Doc | null;
  lastCoalesce: { key: string; time: number } | null;

  selection: string[];
  /** Selected reference image (references are selected separately from GUI objects) */
  refSelection: string | null;
  hoverId: string | null;
  tool: Tool;
  mode: Mode;
  units: Units;
  zoom: number;
  pan: { x: number; y: number };
  activeClipId: string;
  playhead: number;
  playing: boolean;
  selectedTweenId: string | null;
  collapsed: Record<string, boolean>;
  editingTextId: string | null;
  leftTab: 'layers' | 'insert' | 'styles';
  dialog: Dialog;
  toast: { text: string; id: number } | null;
  menu: { x: number; y: number } | null;
  clipArtboard: boolean;
  liveSync: boolean;

  update: (recipe: (d: Draft<Doc>) => void, opts?: UpdateOpts) => void;
  beginGesture: () => void;
  endGesture: () => void;
  undo: () => void;
  redo: () => void;
  loadDoc: (doc: Doc) => void;
  select: (ids: string[]) => void;
  set: (partial: Partial<State>) => void;
  showToast: (text: string) => void;
}

const HISTORY_LIMIT = 200;

export const useStore = create<State>()((set, get) => ({
  doc: null as unknown as Doc,
  past: [],
  future: [],
  gestureBase: null,
  lastCoalesce: null,
  selection: [],
  refSelection: null,
  hoverId: null,
  tool: 'move',
  mode: 'design',
  units: 'scale',
  zoom: 0.5,
  pan: { x: 40, y: 60 },
  activeClipId: '',
  playhead: 0,
  playing: false,
  selectedTweenId: null,
  collapsed: {},
  editingTextId: null,
  leftTab: 'layers',
  dialog: null,
  toast: null,
  menu: null,
  clipArtboard: true,
  liveSync: false,

  update: (recipe, opts) => {
    const s = get();
    const draftDone = produce(s.doc, recipe);
    // instances follow their main component, then linked properties follow their styles
    const next = finalizeStyles(s.doc, finalizeComponents(s.doc, draftDone));
    if (next === s.doc) return;
    if (s.gestureBase) {
      set({ doc: next });
      return;
    }
    const now = Date.now();
    const merge = opts?.coalesce && s.lastCoalesce && s.lastCoalesce.key === opts.coalesce && now - s.lastCoalesce.time < 800;
    set({
      doc: next,
      past: merge ? s.past : [...s.past.slice(-HISTORY_LIMIT), s.doc],
      future: [],
      lastCoalesce: opts?.coalesce ? { key: opts.coalesce, time: now } : null,
    });
  },

  beginGesture: () => {
    if (!get().gestureBase) set({ gestureBase: get().doc });
  },

  endGesture: () => {
    const { gestureBase, doc, past } = get();
    if (!gestureBase) return;
    if (gestureBase !== doc) set({ gestureBase: null, past: [...past.slice(-HISTORY_LIMIT), gestureBase], future: [], lastCoalesce: null });
    else set({ gestureBase: null });
  },

  undo: () => {
    const { past, doc, future } = get();
    if (!past.length) return;
    const prev = past[past.length - 1];
    set({ doc: prev, past: past.slice(0, -1), future: [doc, ...future], lastCoalesce: null });
    sanitize();
  },

  redo: () => {
    const { past, doc, future } = get();
    if (!future.length) return;
    set({ doc: future[0], past: [...past, doc], future: future.slice(1), lastCoalesce: null });
    sanitize();
  },

  loadDoc: (loaded) => {
    const doc = loaded.designSize ? loaded : { ...loaded, designSize: { w: loaded.device.w, h: loaded.device.h } };
    set({
      doc,
      past: [],
      future: [],
      selection: [],
      refSelection: null,
      activeClipId: doc.clips[0]?.id ?? '',
      playhead: 0,
      playing: false,
      selectedTweenId: null,
      editingTextId: null,
    });
  },

  select: (ids) => set({ selection: ids, editingTextId: null, refSelection: null }),
  set: (partial) => set(partial),
  showToast: (text) => set({ toast: { text, id: Date.now() } }),
}));

/** Drop references to nodes/tweens that no longer exist (after undo, delete, etc.) */
export function sanitize() {
  const s = useStore.getState();
  const selection = s.selection.filter((id) => s.doc.nodes[id]);
  const clip = s.doc.clips.find((c) => c.id === s.activeClipId) ?? s.doc.clips[0];
  const tweenOk = clip?.tweens.some((t) => t.id === s.selectedTweenId);
  useStore.setState({
    selection,
    refSelection: s.refSelection && s.doc.references?.some((r) => r.id === s.refSelection) ? s.refSelection : null,
    activeClipId: clip?.id ?? '',
    selectedTweenId: tweenOk ? s.selectedTweenId : null,
    hoverId: s.hoverId && s.doc.nodes[s.hoverId] ? s.hoverId : null,
    editingTextId: s.editingTextId && s.doc.nodes[s.editingTextId] ? s.editingTextId : null,
  });
}

export const getActiveClip = () => {
  const s = useStore.getState();
  return s.doc.clips.find((c) => c.id === s.activeClipId);
};
