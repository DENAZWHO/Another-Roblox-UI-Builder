// EyeDropper for browsers without one (Firefox, Safari): snapshots the page with html-to-image
// (the browser draws it, so gradients, blend modes and gradient text come out right) and lets you
// pick a pixel with a magnifier. Same API as the native one: new EyeDropper().open({ signal }).
//
// The canvas is snapshotted first (~0.1s) so picking starts right away; the rest of the page
// (panels) follows in the background.
import { toCanvas } from 'html-to-image';

const LOUPE_PX = 15; // pixels shown across
const ZOOM = 9;
const LOUPE = LOUPE_PX * ZOOM;
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const hex = (d: Uint8ClampedArray) => '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('');

interface Snap {
  ctx: CanvasRenderingContext2D;
  rect: { left: number; top: number; width: number; height: number };
  scale: number;
}

let busy = false;

export class SnapshotEyeDropper {
  open(opts: { signal?: AbortSignal } = {}): Promise<{ sRGBHex: string }> {
    if (busy) return Promise.reject(new DOMException('An eyedropper is already open', 'InvalidStateError'));
    busy = true;
    return new Promise((resolve, reject) => {
      const overlay = document.createElement('div');
      overlay.className = 'eyedrop-overlay';
      const loupe = document.createElement('canvas');
      loupe.className = 'eyedrop-loupe';
      loupe.width = LOUPE;
      loupe.height = LOUPE;
      const label = document.createElement('div');
      label.className = 'eyedrop-label';
      label.textContent = 'Preparing…';
      overlay.append(loupe, label);
      document.body.appendChild(overlay);

      // first match wins: the canvas, then the whole page
      const snaps: Snap[] = [];
      let last: { x: number; y: number } | null = null;

      const finish = (result: string | null) => {
        busy = false;
        overlay.remove();
        window.removeEventListener('pointermove', move, true);
        opts.signal?.removeEventListener('abort', abort);
        if (result) resolve({ sRGBHex: result });
        else reject(new DOMException('The user cancelled the selection', 'AbortError'));
      };
      const abort = () => finish(null);
      opts.signal?.addEventListener('abort', abort);
      if (opts.signal?.aborted) return abort();

      const snapAt = (x: number, y: number) =>
        snaps.find((s) => x >= s.rect.left && x < s.rect.left + s.rect.width && y >= s.rect.top && y < s.rect.top + s.rect.height);
      const sample = (x: number, y: number) => {
        const s = snapAt(x, y);
        return s ? hex(s.ctx.getImageData(Math.floor((x - s.rect.left) * s.scale), Math.floor((y - s.rect.top) * s.scale), 1, 1).data) : null;
      };

      const draw = () => {
        if (!last) return;
        const { x, y } = last;
        const s = snapAt(x, y);
        const g = loupe.getContext('2d')!;
        g.imageSmoothingEnabled = false;
        g.clearRect(0, 0, LOUPE, LOUPE);
        const half = Math.floor(LOUPE_PX / 2);
        if (s) {
          // one screen pixel per loupe cell
          const sx = Math.floor((x - half - s.rect.left) * s.scale);
          const sy = Math.floor((y - half - s.rect.top) * s.scale);
          g.drawImage(s.ctx.canvas, sx, sy, LOUPE_PX * s.scale, LOUPE_PX * s.scale, 0, 0, LOUPE, LOUPE);
        }
        g.strokeStyle = 'rgba(0,0,0,0.6)';
        g.lineWidth = 3;
        g.strokeRect(half * ZOOM, half * ZOOM, ZOOM, ZOOM);
        g.strokeStyle = '#fff';
        g.lineWidth = 1;
        g.strokeRect(half * ZOOM + 0.5, half * ZOOM + 0.5, ZOOM - 1, ZOOM - 1);
        const c = sample(x, y);
        label.textContent = c ? c.toUpperCase() : 'Loading…';
        label.style.setProperty('--c', c ?? 'transparent');
        overlay.classList.toggle('waiting', !c);
        // keep the loupe on screen, beside the cursor
        const lx = x + 18 + LOUPE > innerWidth ? x - 18 - LOUPE : x + 18;
        const ly = Math.min(innerHeight - LOUPE - 30, Math.max(4, y - LOUPE / 2));
        loupe.style.transform = label.style.transform = `translate(${lx}px, ${ly}px)`;
        loupe.style.visibility = label.style.visibility = 'visible';
      };
      const move = (e: PointerEvent) => {
        last = { x: e.clientX, y: e.clientY };
        if (snaps.length) draw();
      };
      window.addEventListener('pointermove', move, true);

      overlay.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.button !== 0) return finish(null); // right / middle click cancels
        const c = sample(e.clientX, e.clientY);
        if (c) finish(c);
      });
      overlay.addEventListener('contextmenu', (e) => e.preventDefault());

      const pixelRatio = window.devicePixelRatio || 1;
      const shoot = async (el: HTMLElement, skip?: HTMLElement | null) => {
        const r = el.getBoundingClientRect();
        const canvas = await toCanvas(el, {
          pixelRatio,
          width: r.width,
          height: r.height,
          skipFonts: true,
          imagePlaceholder: BLANK,
          backgroundColor: el === document.body ? getComputedStyle(document.body).backgroundColor : undefined,
          filter: (n) => n !== overlay && n !== skip,
        });
        if (!busy) return; // cancelled meanwhile
        snaps.push({ ctx: canvas.getContext('2d', { willReadFrequently: true })!, rect: { left: r.left, top: r.top, width: r.width, height: r.height }, scale: canvas.width / r.width });
        overlay.classList.add('ready');
        if (snaps.length === 1) label.textContent = '';
        draw();
      };

      // let the overlay paint first; then the canvas (fast), then everything else
      const canvasEl = document.querySelector('.canvas') as HTMLElement | null;
      requestAnimationFrame(async () => {
        try {
          if (canvasEl) await shoot(canvasEl);
          if (busy) await shoot(document.body, canvasEl);
        } catch {
          if (!snaps.length) finish(null);
        }
      });
    });
  }
}

/** Provide window.EyeDropper where the browser has none */
export function installSnapshotEyedropper() {
  if (!('EyeDropper' in window)) Object.defineProperty(window, 'EyeDropper', { value: SnapshotEyeDropper, configurable: true });
}
