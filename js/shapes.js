// AI'nin ürettiği şekil komutlarını (design JSON) VoxelGrid'e çevirir.
// Her op önce ızgarayla kesişen sınır kutusuna kırpılır; böylece dev
// yarıçaplar ya da sınır dışı koordinatlar döngüleri büyütmez.

import { VoxelGrid, MAX_SIZE } from './voxel.js';
import { resolveBlock } from './blocks.js';

const LIMIT = MAX_SIZE * 2;
const MAX_SCATTER = 20000;
export const MAX_OPS = 400;
const WORK_BUDGET = 25_000_000; // toplam taranan hücre sınırı (tarayıcı donmasın)

let work = 0; // build() sırasında taranan hücre sayısı

const num = (v, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(-LIMIT, Math.min(LIMIT, n)) : def;
};
const vec = (v) => (Array.isArray(v) && v.length >= 3 ? [num(v[0]), num(v[1]), num(v[2])] : null);
const radius3 = (r) => {
  if (Array.isArray(r)) return [num(r[0], 1), num(r[1] ?? r[0], 1), num(r[2] ?? r[0], 1)].map((n) => Math.max(0, n));
  const n = Math.max(0, num(r, 1));
  return [n, n, n];
};

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Sınır kutusundaki her noktada inside() doğruysa bloğu koyar.
// hollow: yalnızca dışarıya `thickness` adım içinde komşusu olan noktalar.
function fillRegion(grid, min, max, inside, block, hollow, thickness) {
  const x0 = Math.max(0, Math.floor(min[0])), x1 = Math.min(grid.w - 1, Math.ceil(max[0]));
  const y0 = Math.max(0, Math.floor(min[1])), y1 = Math.min(grid.h - 1, Math.ceil(max[1]));
  const z0 = Math.max(0, Math.floor(min[2])), z1 = Math.min(grid.d - 1, Math.ceil(max[2]));
  const t = Math.max(1, Math.min(8, Math.round(num(thickness, 1))));
  if (x1 < x0 || y1 < y0 || z1 < z0) return;
  const volume = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1);
  if (work + volume * (hollow ? 4 : 1) > WORK_BUDGET) return;
  work += volume * (hollow ? 4 : 1);
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        if (!inside(x, y, z)) continue;
        if (hollow && !nearOutside(inside, x, y, z, t)) continue;
        grid.set(x, y, z, block);
      }
    }
  }
}

function nearOutside(inside, x, y, z, t) {
  for (let k = 1; k <= t; k++) {
    if (!inside(x + k, y, z) || !inside(x - k, y, z) ||
        !inside(x, y + k, z) || !inside(x, y - k, z) ||
        !inside(x, y, z + k) || !inside(x, y, z - k)) return true;
  }
  return false;
}

const OPS = {
  box(g, op, block) {
    const a = vec(op.from), b = vec(op.to);
    if (!a || !b) return;
    const lo = a.map((v, i) => Math.round(Math.min(v, b[i])));
    const hi = a.map((v, i) => Math.round(Math.max(v, b[i])));
    const inside = (x, y, z) => x >= lo[0] && x <= hi[0] && y >= lo[1] && y <= hi[1] && z >= lo[2] && z <= hi[2];
    fillRegion(g, lo, hi, inside, block, op.hollow, op.thickness);
  },

  ellipsoid(g, op, block) {
    const c = vec(op.center);
    if (!c) return;
    const r = radius3(op.radius).map((n) => Math.max(0.5, n));
    const inside = (x, y, z) => {
      const dx = (x - c[0]) / r[0], dy = (y - c[1]) / r[1], dz = (z - c[2]) / r[2];
      return dx * dx + dy * dy + dz * dz <= 1;
    };
    fillRegion(g, c.map((v, i) => v - r[i]), c.map((v, i) => v + r[i]), inside, block, op.hollow, op.thickness);
  },

  cylinder(g, op, block) {
    const b = vec(op.base);
    if (!b) return;
    const r = Math.max(0, num(op.radius, 1));
    const h = Math.max(1, Math.round(num(op.height, 1)));
    const axis = ['x', 'y', 'z'].includes(op.axis) ? op.axis : 'y';
    const ai = { x: 0, y: 1, z: 2 }[axis];
    const [u, v] = [0, 1, 2].filter((i) => i !== ai);
    const r2 = r * r + r;
    const inside = (x, y, z) => {
      const p = [x, y, z];
      const along = p[ai] - Math.round(b[ai]);
      if (along < 0 || along >= h) return false;
      const du = p[u] - b[u], dv = p[v] - b[v];
      return du * du + dv * dv <= r2;
    };
    const min = b.map((val, i) => (i === ai ? val : val - r - 1));
    const max = b.map((val, i) => (i === ai ? val + h - 1 : val + r + 1));
    fillRegion(g, min, max, inside, block, op.hollow, op.thickness);
  },

  cone(g, op, block) {
    const b = vec(op.base);
    if (!b) return;
    const r = Math.max(0, num(op.radius, 1));
    const h = Math.max(1, Math.round(num(op.height, 1)));
    const by = Math.round(b[1]);
    const inside = (x, y, z) => {
      const i = y - by;
      if (i < 0 || i >= h) return false;
      const ri = r * (1 - i / h);
      const dx = x - b[0], dz = z - b[2];
      return dx * dx + dz * dz <= ri * ri + ri * 0.5;
    };
    fillRegion(g, [b[0] - r - 1, by, b[2] - r - 1], [b[0] + r + 1, by + h - 1, b[2] + r + 1], inside, block, op.hollow, op.thickness);
  },

  line(g, op, block) {
    const a = vec(op.from), b = vec(op.to);
    if (!a || !b) return;
    const r = Math.max(0, Math.min(MAX_SIZE / 2, num(op.radius, 0)));
    const steps = Math.max(1, Math.ceil(Math.max(...a.map((v, i) => Math.abs(b[i] - v)))));
    if (r === 0) {
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        g.set(...a.map((v, i) => Math.round(v + (b[i] - v) * t)), block);
      }
      return;
    }
    // Kalın çizgi: sınır kutusundaki her hücrenin doğru parçasına uzaklığı
    const ab = b.map((v, i) => v - a[i]);
    const len2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2] || 1;
    const lim = r * r + r;
    const inside = (x, y, z) => {
      const ap = [x - a[0], y - a[1], z - a[2]];
      const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / len2));
      const dx = ap[0] - ab[0] * t, dy = ap[1] - ab[1] * t, dz = ap[2] - ab[2] * t;
      return dx * dx + dy * dy + dz * dz <= lim;
    };
    const lo = a.map((v, i) => Math.min(v, b[i]) - r - 1);
    const hi = a.map((v, i) => Math.max(v, b[i]) + r + 1);
    fillRegion(g, lo, hi, inside, block, false);
  },

  blocks(g, op, block) {
    if (!Array.isArray(op.points)) return;
    for (const pt of op.points.slice(0, MAX_SCATTER)) {
      const p = vec(pt);
      if (p) g.set(p[0], p[1], p[2], block);
    }
  },

  scatter(g, op, block) {
    const c = vec(op.center);
    if (!c) return;
    const r = radius3(op.radius);
    if (op.replace) {
      // Doku boyama: elips içindeki var olan blokları `chance` olasılığıyla değiştir.
      const rand = mulberry32(Math.round(Number(op.seed) || 1));
      const chance = Math.max(0, Math.min(1, Number(op.chance ?? 0.3) || 0));
      const rr = r.map((n) => Math.max(0.5, n));
      const inside = (x, y, z) => {
        const dx = (x - c[0]) / rr[0], dy = (y - c[1]) / rr[1], dz = (z - c[2]) / rr[2];
        return dx * dx + dy * dy + dz * dz <= 1 && g.get(x, y, z) !== null && rand() < chance;
      };
      fillRegion(g, c.map((v, i) => v - rr[i]), c.map((v, i) => v + rr[i]), inside, block, false);
      return;
    }
    const count = Math.max(0, Math.min(MAX_SCATTER, Math.round(Number(op.count) || 10)));
    const rand = mulberry32(Math.round(Number(op.seed) || 1));
    let placed = 0;
    for (let tries = 0; placed < count && tries < count * 4; tries++) {
      const d = [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1];
      if (d[0] * d[0] + d[1] * d[1] + d[2] * d[2] > 1) continue;
      g.set(c[0] + d[0] * r[0], c[1] + d[1] * r[1], c[2] + d[2] * r[2], block);
      placed++;
    }
  },
};

export const OP_NAMES = Object.keys(OPS);

export function build(design) {
  const size = Array.isArray(design?.size) ? design.size : [32, 32, 32];
  const grid = new VoxelGrid(size[0] ?? 32, size[1] ?? 32, size[2] ?? 32);
  work = 0;
  let opCount = 0;
  for (const step of Array.isArray(design?.steps) ? design.steps : []) {
    for (const op of Array.isArray(step?.ops) ? step.ops : []) {
      const fn = op && OPS[op.op];
      if (!fn) continue;
      if (++opCount > MAX_OPS) return grid;
      fn(grid, op, resolveBlock(op.block));
    }
  }
  return grid;
}
