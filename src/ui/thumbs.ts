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
    if (d?.state === 'Completed' && d.imageUrl) cache.set(id, String(d.imageUrl).replace('https://tr.rbxcdn.com', '/rbxcdn'));
    else if (d?.state === 'Pending' && attempt < 5) {
      setTimeout(() => fetchThumb(id, attempt + 1), 1500);
      return;
    } else cache.set(id, null);
  } catch {
    cache.set(id, null);
  }
  notify();
}

export function assetThumb(content: string | undefined): string | undefined {
  const id = assetId(content);
  if (!id) return undefined;
  const c = cache.get(id);
  if (c === undefined) {
    cache.set(id, 'pending');
    fetchThumb(id);
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
