import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { applyOverrides, evaluateClip } from '../model/animation';
import { fontEpoch, onFontsLoaded } from '../model/fonts';

/** Nodes with the active animation applied at the playhead (Animate mode only) */
export function useEffectiveNodes() {
  const doc = useStore((s) => s.doc);
  const mode = useStore((s) => s.mode);
  const playhead = useStore((s) => s.playhead);
  const clipId = useStore((s) => s.activeClipId);
  return useMemo(() => {
    if (mode !== 'animate') return doc.nodes;
    const clip = doc.clips.find((c) => c.id === clipId);
    return applyOverrides(doc.nodes, evaluateClip(clip, doc.nodes, playhead));
  }, [doc, mode, playhead, clipId]);
}

/** Changes whenever web fonts finish loading, so text measurements refresh */
export function useFontEpoch() {
  const [epoch, setEpoch] = useState(fontEpoch);
  useEffect(() => onFontsLoaded(() => setEpoch((e) => e + 1)), []);
  return epoch;
}
