// Bloxelizer tarzı 2D katman görüntüleyici: üstten görünüş (x → sağ, z → aşağı).

import { BLOCKS } from './blocks.js';
import { mulberry32 } from './shapes.js';

const TEX = 16;

function hashStr(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function makeTexture(id) {
  const b = BLOCKS[id] ?? { color: '#888888' };
  const [r, g, bl] = hexToRgb(b.color);
  const c = document.createElement('canvas');
  c.width = c.height = TEX;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(TEX, TEX);
  const rand = mulberry32(hashStr(id));
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      let k = 1 + (rand() - 0.5) * 0.18; // temel gürültü
      let a = 255;
      switch (b.pattern) {
        case 'log': { const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)); k *= d > 6 ? 0.7 : (Math.floor(d) % 2 ? 0.92 : 1.08); break; }
        case 'planks': k *= y % 4 === 3 ? 0.72 : (x === ((y >> 2) * 5) % 16 ? 0.8 : 1); break;
        case 'bricks': { const off = (y >> 2) % 2 ? 4 : 0; if (y % 4 === 3 || (x + off) % 8 === 7) k = 1.45; break; }
        case 'cobble': k *= rand() < 0.22 ? 0.72 : 1.05; break;
        case 'leaves': if (rand() < 0.16) k *= 0.45; else k *= 0.9 + rand() * 0.25; break;
        case 'glass': { const edge = x === 0 || y === 0 || x === 15 || y === 15; a = edge ? 230 : 90; k = edge ? 1.1 : 1; if (!edge && x === y + 3 && x < 11) a = 170; break; }
        case 'ore': k *= rand() < 0.15 ? 1.45 : 0.95; break;
        default: break;
      }
      const i = (y * TEX + x) * 4;
      img.data[i] = Math.min(255, r * k);
      img.data[i + 1] = Math.min(255, g * k);
      img.data[i + 2] = Math.min(255, bl * k);
      img.data[i + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export class LayerViewer {
  constructor(canvas, { onHover = () => {}, onLayerChange = () => {} } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onHover = onHover;
    this.onLayerChange = onLayerChange;
    this.grid = null;
    this.layer = 0;
    this.ghost = true;
    this.scale = 16;
    this.ox = 0; this.oy = 0;
    this.hover = null;
    this.textures = new Map();
    this.#bind();
    new ResizeObserver(() => this.#resize()).observe(canvas);
  }

  setGrid(grid) {
    this.grid = grid;
    this.layer = 0;
    this.fit();
  }

  setLayer(y) {
    if (!this.grid) return;
    const next = Math.max(0, Math.min(this.grid.h - 1, Math.round(y)));
    if (next === this.layer) return;
    this.layer = next;
    this.onLayerChange(next);
    this.#emitHover();
    this.draw();
  }

  setGhost(on) { this.ghost = on; this.draw(); }

  fit() {
    if (!this.grid) return;
    const { width, height } = this.#cssSize();
    const pad = 48;
    this.scale = Math.max(2, Math.min(48, Math.min((width - pad) / this.grid.w, (height - pad) / this.grid.d)));
    this.ox = (width - this.grid.w * this.scale) / 2;
    this.oy = (height - this.grid.d * this.scale) / 2;
    this.draw();
  }

  #cssSize() {
    const r = this.canvas.getBoundingClientRect();
    return { width: r.width || 800, height: r.height || 600 };
  }

  #resize() {
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = this.#cssSize();
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.grid && !this.fitted) { this.fitted = true; this.fit(); } else this.draw();
  }

  #tex(id) {
    let t = this.textures.get(id);
    if (!t) { t = makeTexture(id); this.textures.set(id, t); }
    return t;
  }

  #toBlock(px, py) {
    return [Math.floor((px - this.ox) / this.scale), Math.floor((py - this.oy) / this.scale)];
  }

  #emitHover() {
    if (!this.hover || !this.grid) return this.onHover(null);
    const [x, z] = this.hover;
    const id = this.grid.get(x, this.layer, z);
    if (x < 0 || z < 0 || x >= this.grid.w || z >= this.grid.d) return this.onHover(null);
    this.onHover({ x, y: this.layer, z, id, name: id ? BLOCKS[id]?.name ?? id : null });
  }

  #bind() {
    const c = this.canvas;
    let drag = null;
    c.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, ox: this.ox, oy: this.oy };
      c.setPointerCapture(e.pointerId);
      c.classList.add('dragging');
    });
    c.addEventListener('pointerup', (e) => { drag = null; c.releasePointerCapture?.(e.pointerId); c.classList.remove('dragging'); });
    c.addEventListener('pointermove', (e) => {
      const r = c.getBoundingClientRect();
      if (drag) {
        this.ox = drag.ox + e.clientX - drag.x;
        this.oy = drag.oy + e.clientY - drag.y;
      }
      this.hover = this.#toBlock(e.clientX - r.left, e.clientY - r.top);
      this.#emitHover();
      this.draw();
    });
    c.addEventListener('pointerleave', () => { this.hover = null; this.onHover(null); this.draw(); });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.shiftKey) { this.setLayer(this.layer + (e.deltaY < 0 || e.deltaX < 0 ? 1 : -1)); return; }
      const r = c.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      const next = Math.max(2, Math.min(96, this.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      this.ox = px - ((px - this.ox) * next) / this.scale;
      this.oy = py - ((py - this.oy) * next) / this.scale;
      this.scale = next;
      this.draw();
    }, { passive: false });
  }

  draw() {
    const { ctx, grid } = this;
    const { width, height } = this.#cssSize();
    const css = getComputedStyle(this.canvas);
    const bg = css.getPropertyValue('--canvas-bg').trim() || '#161a21';
    const line = css.getPropertyValue('--canvas-grid').trim() || '#262c36';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
    if (!grid) return;
    const s = this.scale;

    // Arka plan ızgarası
    if (s >= 6) {
      ctx.strokeStyle = line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const sx = ((this.ox % s) + s) % s, sy = ((this.oy % s) + s) % s;
      for (let x = sx; x < width; x += s) { ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, height); }
      for (let y = sy; y < height; y += s) { ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(width, Math.round(y) + 0.5); }
      ctx.stroke();
    }

    ctx.imageSmoothingEnabled = false;
    const drawLayer = (y, alpha) => {
      ctx.globalAlpha = alpha;
      for (let z = 0; z < grid.d; z++) {
        for (let x = 0; x < grid.w; x++) {
          const id = grid.get(x, y, z);
          if (!id) continue;
          ctx.drawImage(this.#tex(id), Math.floor(this.ox + x * s), Math.floor(this.oy + z * s), Math.ceil(s), Math.ceil(s));
        }
      }
      ctx.globalAlpha = 1;
    };
    if (this.ghost && this.layer > 0) drawLayer(this.layer - 1, 0.22);
    drawLayer(this.layer, 1);

    // Blok ızgarası (yapı üstünde)
    if (s >= 10) {
      ctx.strokeStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      for (let x = 0; x <= grid.w; x++) { const px = Math.round(this.ox + x * s) + 0.5; ctx.moveTo(px, this.oy); ctx.lineTo(px, this.oy + grid.d * s); }
      for (let z = 0; z <= grid.d; z++) { const py = Math.round(this.oy + z * s) + 0.5; ctx.moveTo(this.ox, py); ctx.lineTo(this.ox + grid.w * s, py); }
      ctx.stroke();
    }

    // Chunk çizgileri (16 blok)
    ctx.strokeStyle = '#e5322d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 16; x < grid.w; x += 16) { const px = Math.round(this.ox + x * s); ctx.moveTo(px, this.oy); ctx.lineTo(px, this.oy + grid.d * s); }
    for (let z = 16; z < grid.d; z += 16) { const py = Math.round(this.oy + z * s); ctx.moveTo(this.ox, py); ctx.lineTo(this.ox + grid.w * s, py); }
    ctx.stroke();

    // Yapı çerçevesi
    ctx.strokeStyle = css.getPropertyValue('--canvas-frame').trim() || '#e8eaed';
    ctx.lineWidth = 2;
    ctx.strokeRect(Math.round(this.ox) - 1, Math.round(this.oy) - 1, grid.w * s + 2, grid.d * s + 2);

    // Hover vurgusu
    if (this.hover) {
      const [x, z] = this.hover;
      if (x >= 0 && z >= 0 && x < grid.w && z < grid.d) {
        ctx.strokeStyle = '#ffd34d';
        ctx.lineWidth = 2;
        ctx.strokeRect(this.ox + x * s + 1, this.oy + z * s + 1, s - 2, s - 2);
      }
    }
  }
}
