// Reader for Roblox's binary model / place format (.rbxm / .rbxl).
// Layout: a 32-byte header, then chunks (META, SSTR, INST, PROP, PRNT, END), each optionally LZ4 or
// Zstandard compressed. Values in PROP chunks use Roblox's encodings: byte-interleaved big-endian
// integers with zigzag sign, "rotated" floats, and delta-coded referents.
import { decompress as zstd } from 'fzstd';

export interface BinInstance {
  className: string;
  /** property name -> [type id, decoded value] */
  props: Record<string, [number, any]>;
  children: BinInstance[];
}

const MAGIC = '<roblox!';
const utf8 = new TextDecoder();

/** Is this a binary Roblox file? */
export function isBinaryRoblox(bytes: Uint8Array): boolean {
  return bytes.length > 14 && String.fromCharCode(...bytes.subarray(0, 8)) === MAGIC && bytes[8] === 0x89;
}

/** LZ4 block decompression */
function lz4(src: Uint8Array, outLen: number): Uint8Array {
  const out = new Uint8Array(outLen);
  let i = 0;
  let o = 0;
  while (i < src.length) {
    const token = src[i++];
    let lit = token >> 4;
    if (lit === 15) {
      let b: number;
      do {
        b = src[i++];
        lit += b;
      } while (b === 255);
    }
    out.set(src.subarray(i, i + lit), o);
    i += lit;
    o += lit;
    if (i >= src.length) break;
    const off = src[i] | (src[i + 1] << 8);
    i += 2;
    let len = token & 15;
    if (len === 15) {
      let b: number;
      do {
        b = src[i++];
        len += b;
      } while (b === 255);
    }
    len += 4;
    let from = o - off;
    for (let k = 0; k < len; k++) out[o++] = out[from++];
  }
  return out;
}

class Reader {
  pos = 0;
  bytes: Uint8Array;
  view: DataView;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  u8() {
    return this.bytes[this.pos++];
  }
  u16() {
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  u32() {
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  i32() {
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }
  f32() {
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }
  f64() {
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }
  bytesN(n: number) {
    const b = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return b;
  }
  string() {
    return utf8.decode(this.bytesN(this.u32()));
  }
  /** n values of `size` bytes stored byte-interleaved; returns each value's big-endian bytes */
  private interleaved(n: number, size: number): Uint8Array[] {
    const raw = this.bytesN(n * size);
    const out: Uint8Array[] = [];
    for (let i = 0; i < n; i++) {
      const v = new Uint8Array(size);
      for (let b = 0; b < size; b++) v[b] = raw[b * n + i];
      out.push(v);
    }
    return out;
  }
  uints(n: number): number[] {
    return this.interleaved(n, 4).map((b) => ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0);
  }
  ints(n: number): number[] {
    return this.uints(n).map((u) => (u >>> 1) ^ -(u & 1));
  }
  floats(n: number): number[] {
    const dv = new DataView(new ArrayBuffer(4));
    return this.uints(n).map((u) => {
      dv.setUint32(0, ((u >>> 1) | (u << 31)) >>> 0);
      return dv.getFloat32(0);
    });
  }
  /** Referents: zigzag ints, each relative to the previous one */
  refs(n: number): number[] {
    const d = this.ints(n);
    let acc = 0;
    return d.map((x) => (acc += x));
  }
  int64s(n: number): number[] {
    return this.interleaved(n, 8).map((b) => {
      let v = 0n;
      for (const x of b) v = (v << 8n) | BigInt(x);
      return Number((v >> 1n) ^ -(v & 1n));
    });
  }
}

/** Values of one property for n instances; null for types we don't use */
function readValues(r: Reader, type: number, n: number, shared: string[]): any[] | null {
  const zip = <T,>(...cols: T[][]) => cols[0].map((_, i) => cols.map((c) => c[i]));
  switch (type) {
    case 0x01: // String (also Content ids)
      return Array.from({ length: n }, () => r.string());
    case 0x02: // Bool
      return Array.from(r.bytesN(n), (b) => b !== 0);
    case 0x03: // Int32
      return r.ints(n);
    case 0x04: // Float32
      return r.floats(n);
    case 0x05: // Float64
      return Array.from({ length: n }, () => r.f64());
    case 0x06: {
      // UDim
      const s = r.floats(n);
      const o = r.ints(n);
      return s.map((x, i) => ({ s: x, o: o[i] }));
    }
    case 0x07: {
      // UDim2
      const sx = r.floats(n);
      const sy = r.floats(n);
      const ox = r.ints(n);
      const oy = r.ints(n);
      return sx.map((_, i) => ({ x: { s: sx[i], o: ox[i] }, y: { s: sy[i], o: oy[i] } }));
    }
    case 0x0b: // BrickColor
    case 0x12: // Enum
      return r.uints(n);
    case 0x0c: // Color3 (floats)
      return zip(r.floats(n), r.floats(n), r.floats(n)).map(([cr, cg, cb]) => ({ r: cr, g: cg, b: cb }));
    case 0x0d: // Vector2
      return zip(r.floats(n), r.floats(n)).map(([x, y]) => ({ x, y }));
    case 0x0e: // Vector3
      return zip(r.floats(n), r.floats(n), r.floats(n)).map(([x, y, z]) => ({ x, y, z }));
    case 0x13: // Referent
      return r.refs(n);
    case 0x15: // NumberSequence
      return Array.from({ length: n }, () => Array.from({ length: r.u32() }, () => ({ t: r.f32(), v: r.f32(), e: r.f32() })));
    case 0x16: // ColorSequence
      return Array.from({ length: n }, () => Array.from({ length: r.u32() }, () => ({ t: r.f32(), r: r.f32(), g: r.f32(), b: r.f32(), e: r.f32() })));
    case 0x17: // NumberRange
      return Array.from({ length: n }, () => ({ min: r.f32(), max: r.f32() }));
    case 0x18: {
      // Rect
      const x0 = r.floats(n);
      const y0 = r.floats(n);
      const x1 = r.floats(n);
      const y1 = r.floats(n);
      return x0.map((_, i) => ({ x0: x0[i], y0: y0[i], x1: x1[i], y1: y1[i] }));
    }
    case 0x1a: {
      // Color3uint8
      const cr = Array.from(r.bytesN(n));
      const cg = Array.from(r.bytesN(n));
      const cb = Array.from(r.bytesN(n));
      return cr.map((_, i) => ({ r: cr[i] / 255, g: cg[i] / 255, b: cb[i] / 255 }));
    }
    case 0x1b: // Int64
      return r.int64s(n);
    case 0x1c: // SharedString
      return r.uints(n).map((i) => shared[i] ?? '');
    case 0x20: // Font
      return Array.from({ length: n }, () => {
        const family = r.string();
        const weight = r.u16();
        const style = r.u8();
        r.string(); // cached face id
        return { family, weight, style: style === 1 ? 'Italic' : 'Normal' };
      });
    default:
      return null;
  }
}

/** Parse a .rbxm / .rbxl file into its top-level instances */
export function parseBinary(bytes: Uint8Array): BinInstance[] {
  if (!isBinaryRoblox(bytes)) throw new Error('Not a binary Roblox file');
  const head = new Reader(bytes);
  head.pos = 32; // magic, signature, version, class count, instance count, reserved
  const classes = new Map<number, { name: string; refs: number[] }>();
  const insts = new Map<number, BinInstance>();
  const shared: string[] = [];
  const roots: BinInstance[] = [];
  while (head.pos + 16 <= bytes.length) {
    const name = String.fromCharCode(...head.bytesN(4));
    const compressed = head.u32();
    const size = head.u32();
    head.pos += 4;
    let data: Uint8Array;
    if (compressed === 0) data = head.bytesN(size);
    else {
      const raw = head.bytesN(compressed);
      data = raw[0] === 0x28 && raw[1] === 0xb5 && raw[2] === 0x2f && raw[3] === 0xfd ? zstd(raw) : lz4(raw, size);
    }
    const r = new Reader(data);
    if (name === 'END\0') break;
    if (name === 'SSTR') {
      r.u32();
      const count = r.u32();
      for (let i = 0; i < count; i++) {
        r.bytesN(16);
        shared.push(r.string());
      }
    } else if (name === 'INST') {
      const id = r.i32();
      const className = r.string();
      r.u8(); // object format (services carry an extra marker byte per instance)
      const n = r.u32();
      const refs = r.refs(n);
      classes.set(id, { name: className, refs });
      for (const ref of refs) insts.set(ref, { className, props: {}, children: [] });
    } else if (name === 'PROP') {
      const cls = classes.get(r.i32());
      const prop = r.string();
      const type = r.u8();
      if (!cls) continue;
      let values: any[] | null = null;
      try {
        values = readValues(r, type, cls.refs.length, shared);
      } catch {
        values = null;
      }
      if (!values) continue;
      cls.refs.forEach((ref, i) => {
        const inst = insts.get(ref);
        if (inst) inst.props[prop] = [type, values![i]];
      });
    } else if (name === 'PRNT') {
      r.u8();
      const n = r.u32();
      const kids = r.refs(n);
      const parents = r.refs(n);
      kids.forEach((k, i) => {
        const child = insts.get(k);
        if (!child) return;
        const parent = parents[i] >= 0 ? insts.get(parents[i]) : undefined;
        if (parent) parent.children.push(child);
        else roots.push(child);
      });
    }
  }
  return roots;
}
