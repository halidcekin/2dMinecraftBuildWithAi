// Minimal NBT (big-endian) yazıcı/okuyucu. Yazarken değerler tipli verilir:
// { type: 'byte'|'short'|'int'|'string'|'byteArray'|'intArray'|'compound'|'list', value, elemType? }

const TAG = { end: 0, byte: 1, short: 2, int: 3, long: 4, float: 5, double: 6, byteArray: 7, string: 8, list: 9, compound: 10, intArray: 11 };

class Writer {
  constructor() { this.buf = new Uint8Array(1024); this.view = new DataView(this.buf.buffer); this.len = 0; }
  ensure(n) {
    if (this.len + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next; this.view = new DataView(next.buffer);
  }
  u8(v) { this.ensure(1); this.view.setInt8(this.len, v); this.len += 1; }
  i16(v) { this.ensure(2); this.view.setInt16(this.len, v); this.len += 2; }
  i32(v) { this.ensure(4); this.view.setInt32(this.len, v); this.len += 4; }
  bytes(arr) { this.ensure(arr.length); this.buf.set(arr, this.len); this.len += arr.length; }
  str(s) { const b = new TextEncoder().encode(s); this.ensure(2); this.view.setUint16(this.len, b.length); this.len += 2; this.bytes(b); }
  result() { return this.buf.slice(0, this.len); }
}

function writePayload(w, tag) {
  const { type, value } = tag;
  switch (type) {
    case 'byte': return w.u8(value);
    case 'short': return w.i16(value);
    case 'int': return w.i32(value);
    case 'string': return w.str(value);
    case 'byteArray': w.i32(value.length); return w.bytes(value instanceof Uint8Array ? value : Uint8Array.from(value));
    case 'intArray': w.i32(value.length); for (const v of value) w.i32(v); return;
    case 'list':
      w.u8(TAG[tag.elemType ?? 'end']); w.i32(value.length);
      for (const v of value) writePayload(w, { type: tag.elemType, value: v });
      return;
    case 'compound':
      for (const [k, child] of Object.entries(value)) { w.u8(TAG[child.type]); w.str(k); writePayload(w, child); }
      return w.u8(TAG.end);
    default: throw new Error(`Desteklenmeyen NBT tipi: ${type}`);
  }
}

export function writeNbt(rootName, compound) {
  const w = new Writer();
  w.u8(TAG.compound);
  w.str(rootName);
  writePayload(w, { type: 'compound', value: compound });
  return w.result();
}

export function readNbt(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 0;
  const str = () => { const n = view.getUint16(p); p += 2; const s = new TextDecoder().decode(bytes.subarray(p, p + n)); p += n; return s; };
  const payload = (t) => {
    switch (t) {
      case 1: return view.getInt8(p++);
      case 2: { const v = view.getInt16(p); p += 2; return v; }
      case 3: { const v = view.getInt32(p); p += 4; return v; }
      case 4: { const v = view.getBigInt64(p); p += 8; return v; }
      case 5: { const v = view.getFloat32(p); p += 4; return v; }
      case 6: { const v = view.getFloat64(p); p += 8; return v; }
      case 7: { const n = view.getInt32(p); p += 4; const v = bytes.slice(p, p + n); p += n; return v; }
      case 8: return str();
      case 9: { const et = view.getInt8(p++); const n = view.getInt32(p); p += 4; return Array.from({ length: n }, () => payload(et)); }
      case 10: { const o = {}; for (;;) { const ct = view.getInt8(p++); if (ct === 0) return o; const k = str(); o[k] = payload(ct); } }
      case 11: { const n = view.getInt32(p); p += 4; const a = []; for (let i = 0; i < n; i++) { a.push(view.getInt32(p)); p += 4; } return a; }
      default: throw new Error(`Bilinmeyen NBT etiketi: ${t}`);
    }
  };
  const t = view.getInt8(p++);
  const name = str();
  return { name, value: payload(t) };
}
