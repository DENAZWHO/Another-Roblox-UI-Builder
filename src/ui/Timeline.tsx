import { useEffect, useRef, useState } from 'react';
import { isRoot } from '../model/schema';
import { Pause, Play, Plus, Repeat, SkipBack, Trash } from 'lucide-react';
import { useStore } from '../store';
import { clipLength, tweenEnd } from '../model/animation';
import { descendants } from '../model/doc';
import type { Tween } from '../model/types';
import { addClip, deleteClip, renameClip, updateTween } from '../actions';
import { ClassIcon } from './icons';

const SNAP = 0.05;
const snapT = (t: number, fine: boolean) => (fine ? Math.round(t * 1000) / 1000 : Math.round(t / SNAP) * SNAP);

export function Timeline() {
  const doc = useStore((s) => s.doc);
  const clipId = useStore((s) => s.activeClipId);
  const playhead = useStore((s) => s.playhead);
  const playing = useStore((s) => s.playing);
  const selectedTween = useStore((s) => s.selectedTweenId);
  const selection = useStore((s) => s.selection);
  const [pps, setPps] = useState(160);
  const [loop, setLoop] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const clip = doc.clips.find((c) => c.id === clipId) ?? doc.clips[0];
  const len = clipLength(clip);
  const total = Math.max(3, Math.ceil(len + 1));
  const tracksRef = useRef<HTMLDivElement>(null);

  // playback loop
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const s = useStore.getState();
      let t = s.playhead + (now - last) / 1000;
      last = now;
      const end = clipLength(s.doc.clips.find((c) => c.id === s.activeClipId));
      if (t >= end) {
        if (loop && end > 0) t = 0;
        else {
          useStore.setState({ playhead: end, playing: false });
          return;
        }
      }
      useStore.setState({ playhead: t });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, loop]);

  const togglePlay = () => {
    const s = useStore.getState();
    if (!s.playing && s.playhead >= len - 0.001) useStore.setState({ playhead: 0 });
    useStore.setState({ playing: !s.playing, selectedTweenId: s.playing ? s.selectedTweenId : null });
  };

  // rows: nodes in tree order that have tweens, plus the selected node
  const order: string[] = [];
  for (const r of doc.rootIds) order.push(r, ...descendants(doc.nodes, r));
  const withTweens = new Set(clip?.tweens.map((t) => t.nodeId));
  selection.forEach((id) => doc.nodes[id] && !isRoot(doc.nodes[id].className) && withTweens.add(id));
  const rows = order.filter((id) => withTweens.has(id));

  const scrubFrom = (e: React.PointerEvent) => {
    const el = tracksRef.current!;
    const set = (cx: number) => {
      const b = el.getBoundingClientRect();
      const t = Math.max(0, (cx - b.left + el.scrollLeft) / pps);
      useStore.setState({ playhead: e.altKey ? t : snapT(t, false), playing: false });
    };
    set(e.clientX);
    const move = (ev: PointerEvent) => set(ev.clientX);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const dragBar = (e: React.PointerEvent, tw: Tween, part: 'body' | 'start' | 'end') => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const s = useStore.getState();
    useStore.setState({ selectedTweenId: tw.id, selection: [tw.nodeId], playing: false });
    const sx = e.clientX;
    const { start, duration } = tw;
    let moved = false;
    s.beginGesture();
    const move = (ev: PointerEvent) => {
      const dt = (ev.clientX - sx) / pps;
      if (!moved && Math.abs(ev.clientX - sx) < 3) return;
      moved = true;
      const fine = ev.altKey;
      if (part === 'body') updateTween(tw.id, { start: Math.max(0, snapT(start + dt, fine)) }, false);
      if (part === 'end') updateTween(tw.id, { duration: Math.max(0.05, snapT(duration + dt, fine)) }, false);
      if (part === 'start') {
        const ns = Math.min(start + duration - 0.05, Math.max(0, snapT(start + dt, fine)));
        updateTween(tw.id, { start: ns, duration: +(start + duration - ns).toFixed(3) }, false);
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      useStore.getState().endGesture();
      const cur = useStore.getState().doc.clips.flatMap((c) => c.tweens).find((t) => t.id === tw.id);
      if (cur) useStore.setState({ playhead: tweenEnd(cur) });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const ticks: number[] = [];
  const step = pps >= 120 ? 0.1 : pps >= 50 ? 0.25 : 0.5;
  for (let t = 0; t <= total + 1e-6; t += step) ticks.push(+t.toFixed(2));

  return (
    <div className="timeline">
      <div className="tl-header">
        <div className="tl-clip">
          {renaming ? (
            <input
              autoFocus
              defaultValue={clip?.name}
              onBlur={(e) => {
                renameClip(clip.id, e.target.value);
                setRenaming(false);
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
            />
          ) : (
            <select value={clip?.id} onChange={(e) => useStore.setState({ activeClipId: e.target.value, playhead: 0, selectedTweenId: null })} onDoubleClick={() => setRenaming(true)} title="Double-click to rename">
              {doc.clips.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          <button className="icon-btn" title="Rename animation" onClick={() => setRenaming(true)}>✎</button>
          <button className="icon-btn" title="New animation" onClick={addClip}><Plus size={13} /></button>
          <button className="icon-btn" title="Delete animation" onClick={() => clip && deleteClip(clip.id)}><Trash size={12} /></button>
        </div>
        <div className="tl-transport">
          <button className="icon-btn" title="Back to start" onClick={() => useStore.setState({ playhead: 0, playing: false })}><SkipBack size={14} /></button>
          <button className="icon-btn play" title="Play / pause" onClick={togglePlay}>{playing ? <Pause size={14} /> : <Play size={14} />}</button>
          <button className={`icon-btn ${loop ? 'on' : ''}`} title="Loop" onClick={() => setLoop(!loop)}><Repeat size={13} /></button>
          <span className="tl-time">{playhead.toFixed(2)}s <span className="muted">/ {len.toFixed(2)}s</span></span>
        </div>
        <div className="tl-zoom">
          <input type="range" min={40} max={400} value={pps} onChange={(e) => setPps(+e.target.value)} title="Timeline zoom" />
        </div>
      </div>
      <div className="tl-body">
        <div className="tl-names">
          <div className="tl-ruler-spacer" />
          {rows.map((id) => {
            const n = doc.nodes[id];
            const props = [...new Set(clip.tweens.filter((t) => t.nodeId === id).map((t) => t.prop))];
            return (
              <div key={id}>
                <div className={`tl-name node ${selection.includes(id) ? 'on' : ''}`} onClick={() => useStore.getState().select([id])}>
                  <ClassIcon cls={n.className} size={12} /> {n.name}
                </div>
                {props.map((p) => (
                  <div key={p} className="tl-name prop">{p}</div>
                ))}
                {!props.length && <div className="tl-name prop muted">Change a property at t &gt; 0 to add a tween</div>}
              </div>
            );
          })}
          {!rows.length && <div className="tl-empty">Select an element, move the playhead, then move/resize it or change a colour or transparency to record tweens.</div>}
        </div>
        <div className="tl-tracks" ref={tracksRef}>
          <div className="tl-inner" style={{ width: total * pps + 40 }}>
            <div className="tl-ruler" onPointerDown={scrubFrom}>
              {ticks.map((t) => {
                const major = Math.abs(t - Math.round(t * 2) / 2) < 1e-6;
                return (
                  <div key={t} className={`tick ${major ? 'major' : ''}`} style={{ left: t * pps }}>
                    {major && <span>{t}s</span>}
                  </div>
                );
              })}
            </div>
            {rows.map((id) => {
              const props = [...new Set(clip.tweens.filter((t) => t.nodeId === id).map((t) => t.prop))];
              return (
                <div key={id}>
                  <div className="tl-track node" onPointerDown={scrubFrom} />
                  {props.map((p) => (
                    <div key={p} className="tl-track" onPointerDown={scrubFrom}>
                      {clip.tweens.filter((t) => t.nodeId === id && t.prop === p).map((t) => (
                        <div
                          key={t.id}
                          className={`tl-bar ${t.id === selectedTween ? 'on' : ''}`}
                          style={{ left: t.start * pps, width: Math.max(6, t.duration * pps) }}
                          onPointerDown={(e) => dragBar(e, t, 'body')}
                          title={`${t.prop}: ${t.start.toFixed(2)}s → ${tweenEnd(t).toFixed(2)}s (${t.style} ${t.direction})`}
                        >
                          <div className="tl-grip l" onPointerDown={(e) => dragBar(e, t, 'start')} />
                          <span className="tl-bar-label">{t.style}</span>
                          <div className="tl-grip r" onPointerDown={(e) => dragBar(e, t, 'end')} />
                          <div className="tl-key" />
                        </div>
                      ))}
                    </div>
                  ))}
                  {!props.length && <div className="tl-track" onPointerDown={scrubFrom} />}
                </div>
              );
            })}
            <div className="tl-playhead" style={{ left: playhead * pps }} />
          </div>
        </div>
      </div>
    </div>
  );
}
