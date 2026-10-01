// Picking a colour from the screen. Chrome/Edge have a native EyeDropper; elsewhere (Firefox, Safari)
// snapshotEyedropper.ts provides one that snapshots the page and shows a magnifier.
import { useSyncExternalStore } from 'react';
import { useStore } from '../store';

let picking = false;
let ready = typeof window !== 'undefined' && 'EyeDropper' in window;
const listeners = new Set<() => void>();

/** Load the fallback only where it's needed (it brings a page renderer along) */
export function loadEyedropper() {
  if (ready) return;
  import('./snapshotEyedropper')
    .then((m) => {
      m.installSnapshotEyedropper();
      ready = 'EyeDropper' in window;
      listeners.forEach((l) => l());
    })
    .catch(() => {});
}

export const canEyedrop = () => ready;
export const useCanEyedrop = () => useSyncExternalStore((l) => (listeners.add(l), () => void listeners.delete(l)), () => ready);

/** True while the eyedropper is open: editor shortcuts and click-outside handlers should stand back */
export const isEyedropping = () => picking;

/** Pick a colour from the screen; null when cancelled */
export async function eyedrop(): Promise<string | null> {
  if (!ready) {
    useStore.getState().showToast('The colour picker is still loading — try again in a moment');
    loadEyedropper();
    return null;
  }
  picking = true;
  // Esc cancels (the native picker does this itself)
  const abort = new AbortController();
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    abort.abort();
  };
  window.addEventListener('keydown', onKey, true);
  try {
    const res = await new (window as any).EyeDropper().open({ signal: abort.signal });
    return String(res.sRGBHex).toLowerCase();
  } catch {
    return null; // cancelled
  } finally {
    window.removeEventListener('keydown', onKey, true);
    // let the Esc / click that ended the pick pass before shortcuts come back
    setTimeout(() => (picking = false), 0);
  }
}
