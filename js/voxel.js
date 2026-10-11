// Sabit boyutlu voxel ızgarası. Hücreler palet indeksi tutar (0 = boş).

export const MAX_SIZE = 64;

const clampSize = (n) => Math.max(1, Math.min(MAX_SIZE, Math.round(Number(n) || 1)));

export class VoxelGrid {
  constructor(w, h, d) {
    this.w = clampSize(w);
    this.h = clampSize(h);
    this.d = clampSize(d);
    this.cells = new Uint16Array(this.w * this.h * this.d);
    this.ids = [null]; // indeks → blok id
    this.index = new Map(); // blok id → indeks
  }

  #offset(x, y, z) {
    x = Math.round(x); y = Math.round(y); z = Math.round(z);
    if (!(x >= 0 && y >= 0 && z >= 0 && x < this.w && y < this.h && z < this.d)) return -1;
    return x + z * this.w + y * this.w * this.d;
  }

  set(x, y, z, id) {
    const o = this.#offset(x, y, z);
    if (o < 0) return;
    if (!id || id === 'air') { this.cells[o] = 0; return; }
    let i = this.index.get(id);
    if (i === undefined) {
      i = this.ids.length;
      this.ids.push(id);
      this.index.set(id, i);
    }
    this.cells[o] = i;
  }

  get(x, y, z) {
    const o = this.#offset(x, y, z);
    return o < 0 ? null : this.ids[this.cells[o]];
  }

  count() {
    let n = 0;
    for (const c of this.cells) if (c) n++;
    return n;
  }

  layerCounts(y) {
    const out = new Map();
    const size = this.w * this.d;
    const start = y * size;
    if (y < 0 || y >= this.h) return out;
    for (let o = start; o < start + size; o++) {
      const c = this.cells[o];
      if (c) out.set(this.ids[c], (out.get(this.ids[c]) || 0) + 1);
    }
    return out;
  }

  palette() {
    const used = new Set();
    for (const c of this.cells) if (c) used.add(this.ids[c]);
    return [...used];
  }

  forEach(cb) {
    const { w, d } = this;
    for (let o = 0; o < this.cells.length; o++) {
      const c = this.cells[o];
      if (!c) continue;
      const x = o % w;
      const z = Math.floor(o / w) % d;
      const y = Math.floor(o / (w * d));
      cb(x, y, z, this.ids[c]);
    }
  }
}
