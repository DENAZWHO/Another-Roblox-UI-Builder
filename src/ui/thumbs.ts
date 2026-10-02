// Resolves rbxassetid:// images to preview URLs via the dev-server proxy (see vite.config.ts).

const cache = new Map<string, string | null | 'pending'>();
const subs = new Set<() => void>();

export function subscribeThumbs(cb: () => void) {
  subs.add(cb);
  return () => void subs.delete(cb);
}

const notify = () => subs.forEach((s) => s());

export function assetId(content: string | undefined): string | null {
  const s = (content ?? '').trim();
  const m = /^(?:rbxassetid:\/\/)?(\d+)$/.exec(s) ?? /[?&]id=(\d+)/.exec(s);
  return m ? m[1] : null;
}

async function fetchThumb(id: string, attempt = 0) {
  try {
    const r = await fetch(`/rbx-thumbs/v1/assets?assetIds=${id}&size=420x420&format=Png`);
    const j = await r.json();
    const d = j.data?.[0];
    if (d?.state === 'Completed' && d.imageUrl) cache.set(id, await unpad(String(d.imageUrl).replace('https://tr.rbxcdn.com', '/rbxcdn')));
    else if (d?.state === 'Pending' && attempt < 5) {
      setTimeout(() => fetchThumb(id, attempt + 1), 1500);
      return;
    } else cache.set(id, null);
  } catch {
    cache.set(id, null);
  }
  notify();
}

/**
 * Thumbnails letterbox the image into a square (transparent bars above and below a wide image, or at
 * the sides of a tall one). Cut those bars off so the picture has its real proportions: stretching,
 * 9-slicing and fitting then behave like the real image. Images with their own transparent margins
 * all round are left alone.
 */
async function unpad(url: string): Promise<string> {
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(img, 0, 0);
    const a = g.getImageData(0, 0, W, H).data;
    const rowEmpty = (y: number) => {
      for (let x = 0; x < W; x++) if (a[(y * W + x) * 4 + 3] > 8) return false;
      return true;
    };
    const colEmpty = (x: number) => {
      for (let y = 0; y < H; y++) if (a[(y * W + x) * 4 + 3] > 8) return false;
      return true;
    };
    let top = 0;
    while (top < H - 1 && rowEmpty(top)) top++;
    let bottom = H - 1;
    while (bottom > top && rowEmpty(bottom)) bottom--;
    let left = 0;
    while (left < W - 1 && colEmpty(left)) left++;
    let right = W - 1;
    while (right > left && colEmpty(right)) right--;
    const bars = (a0: number, a1: number) => a0 > 2 && Math.abs(a0 - a1) <= 2;
    const box = { x: 0, y: 0, w: W, h: H };
    // only one axis is padded, evenly, and the other is filled edge to edge
    if (bars(top, H - 1 - bottom) && left === 0 && right === W - 1) Object.assign(box, { y: top, h: bottom - top + 1 });
    else if (bars(left, W - 1 - right) && top === 0 && bottom === H - 1) Object.assign(box, { x: left, w: right - left + 1 });
    else return url;
    const out = document.createElement('canvas');
    out.width = box.w;
    out.height = box.h;
    out.getContext('2d')!.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
    const blob = await new Promise<Blob | null>((r) => out.toBlob(r, 'image/png'));
    if (!blob) return url;
    const cropped = URL.createObjectURL(blob);
    sizes.set(cropped, { w: box.w, h: box.h });
    return cropped;
  } catch {
    return url;
  }
}

/**
 * The full-size image through the dev server (so sprite-sheet crops and 9-slices line up);
 * Roblox's thumbnail (downscaled, padded to a square) when that isn't available.
 */
function fetchImage(key: string, src: string, fallback: () => void) {
  const img = new Image();
  img.onload = () => {
    sizes.set(src, { w: img.naturalWidth, h: img.naturalHeight });
    cache.set(key, src);
    notify();
  };
  img.onerror = fallback;
  img.src = src;
}

export function assetThumb(content: string | undefined): string | undefined {
  // Roblox's built-in images (rbxasset://textures/...) come from the local Roblox install
  const builtin = /^rbxasset:\/\/(.+)$/i.exec((content ?? '').trim())?.[1];
  const id = builtin ? `rbxasset:${builtin}` : assetId(content);
  if (!id) return undefined;
  const c = cache.get(id);
  if (c === undefined) {
    cache.set(id, 'pending');
    const failed = () => {
      cache.set(id, null);
      notify();
    };
    if (builtin) fetchImage(id, `/rbx-content/${builtin.split('/').map(encodeURIComponent).join('/')}`, failed);
    else fetchImage(id, `/rbx-image/${id}`, () => fetchThumb(id));
    return undefined;
  }
  return c && c !== 'pending' ? c : undefined;
}

const AVATAR_ENDPOINT: Record<string, string> = { HeadShot: 'avatar-headshot', AvatarBust: 'avatar-bust', AvatarThumbnail: 'avatar' };

async function fetchAvatar(key: string, userId: number, kind: string, attempt = 0) {
  try {
    const r = await fetch(`/rbx-thumbs/v1/users/${AVATAR_ENDPOINT[kind] ?? 'avatar-headshot'}?userIds=${userId}&size=420x420&format=Png`);
    const d = (await r.json()).data?.[0];
    if (d?.state === 'Completed' && d.imageUrl) cache.set(key, String(d.imageUrl).replace('https://tr.rbxcdn.com', '/rbxcdn'));
    else if (d?.state === 'Pending' && attempt < 5) {
      setTimeout(() => fetchAvatar(key, userId, kind, attempt + 1), 1500);
      return;
    } else cache.set(key, null);
  } catch {
    cache.set(key, null);
  }
  notify();
}

/** Preview image of a user's avatar (what GetUserThumbnailAsync returns in game) */
export function avatarThumb(userId: number, kind: string): string | undefined {
  const key = `avatar:${userId}:${kind}`;
  const c = cache.get(key);
  if (c === undefined) {
    cache.set(key, 'pending');
    fetchAvatar(key, userId, kind);
    return undefined;
  }
  return c && c !== 'pending' ? c : undefined;
}

/** Resolve a Roblox username to { id, name, displayName } (through the dev-server proxy) */
export async function lookupUser(username: string): Promise<{ id: number; name: string; displayName: string } | null> {
  if (!username) return null;
  try {
    const r = await fetch('/rbx-users/v1/usernames/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames: [username], excludeBannedUsers: false }),
    });
    const u = (await r.json()).data?.[0];
    return u ? { id: u.id, name: u.name, displayName: u.displayName } : null;
  } catch {
    return null;
  }
}

const sizes = new Map<string, { w: number; h: number } | null>();
/** Natural size of an image (undefined until it has loaded; re-renders subscribers when it has) */
export function imageSize(src: string): { w: number; h: number } | undefined {
  if (!sizes.has(src)) {
    sizes.set(src, null);
    const img = new Image();
    img.onload = () => {
      sizes.set(src, { w: img.naturalWidth, h: img.naturalHeight });
      notify();
    };
    img.src = src;
  }
  return sizes.get(src) ?? undefined;
}
