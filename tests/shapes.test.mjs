import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../js/shapes.js';

const one = (op, size = [32, 32, 32]) => build({ size, steps: [{ name: 't', ops: [op] }] });

test('box 3x3x3 = 27', () => {
  const g = one({ op: 'box', from: [0, 0, 0], to: [2, 2, 2], block: 'stone' });
  assert.equal(g.count(), 27);
});

test('ellipsoid dolu ve hollow', () => {
  const full = one({ op: 'ellipsoid', center: [10, 10, 10], radius: [3, 3, 3], block: 'stone' });
  assert.ok(full.count() >= 100 && full.count() <= 130, `count ${full.count()}`);
  const hollow = one({ op: 'ellipsoid', center: [10, 10, 10], radius: [3, 3, 3], block: 'stone', hollow: true });
  assert.ok(hollow.count() < full.count());
  assert.ok(hollow.count() > 0);
  assert.equal(hollow.get(10, 10, 10), null);
});

test('radius sayı olarak da kabul edilir', () => {
  const g = one({ op: 'ellipsoid', center: [10, 10, 10], radius: 3, block: 'stone' });
  assert.ok(g.count() >= 100);
});

test('cylinder y ekseni her katmanda aynı', () => {
  const g = one({ op: 'cylinder', base: [10, 0, 10], radius: 2, height: 5, axis: 'y', block: 'oak_log' });
  const n0 = g.layerCounts(0).get('oak_log');
  assert.ok(n0 > 0);
  for (let y = 0; y < 5; y++) assert.equal(g.layerCounts(y).get('oak_log'), n0);
  assert.equal(g.layerCounts(5).size, 0);
});

test('cylinder x ekseni', () => {
  const g = one({ op: 'cylinder', base: [0, 10, 10], radius: 1, height: 4, axis: 'x', block: 'stone' });
  assert.equal(g.get(3, 10, 10), 'stone');
  assert.equal(g.get(4, 10, 10), null);
});

test('cone tepeye daralır', () => {
  const g = one({ op: 'cone', base: [10, 0, 10], radius: 5, height: 8, block: 'stone' });
  const bottom = g.layerCounts(0).get('stone');
  const top = g.layerCounts(6).get('stone') || 0;
  assert.ok(top < bottom);
});

test('line r=0 → 11 blok', () => {
  const g = one({ op: 'line', from: [0, 0, 0], to: [10, 0, 0], radius: 0, block: 'stone' });
  assert.equal(g.count(), 11);
});

test('line çapraz kopuksuz', () => {
  const g = one({ op: 'line', from: [0, 0, 0], to: [5, 7, 3], radius: 0, block: 'stone' });
  assert.equal(g.get(0, 0, 0), 'stone');
  assert.equal(g.get(5, 7, 3), 'stone');
  assert.ok(g.count() >= 8);
});

test('air oyar ve sıra önemlidir', () => {
  const g = build({ size: [10, 10, 10], steps: [{ ops: [
    { op: 'box', from: [0, 0, 0], to: [4, 4, 4], block: 'stone' },
    { op: 'box', from: [1, 1, 1], to: [3, 3, 3], block: 'air' },
  ] }] });
  assert.equal(g.count(), 125 - 27);
});

test('blocks noktaları ve bilinmeyen blok stone olur', () => {
  const g = one({ op: 'blocks', points: [[1, 1, 1], [2, 2, 2]], block: 'unknown_thing' });
  assert.equal(g.get(1, 1, 1), 'stone');
  assert.equal(g.count(), 2);
});

test('negatif/ondalık/sınır dışı koordinat çökmez', () => {
  const g = one({ op: 'box', from: [-5.5, -2, -1], to: [100, 1.4, 2], block: 'dirt' }, [8, 8, 8]);
  assert.equal(g.count(), 8 * 2 * 3);
});

test('dev yarıçap hızlı biter', () => {
  const t = Date.now();
  const g = one({ op: 'ellipsoid', center: [10, 10, 10], radius: [1000, 1000, 1000], block: 'stone' }, [64, 64, 64]);
  assert.equal(g.count(), 64 * 64 * 64);
  assert.ok(Date.now() - t < 1000);
  const g2 = one({ op: 'scatter', center: [5, 5, 5], radius: 4, count: 1e9, block: 'stone' }, [16, 16, 16]);
  assert.ok(g2.count() > 0);
  assert.ok(Date.now() - t < 2000);
});

test('scatter deterministik', () => {
  const op = { op: 'scatter', center: [10, 10, 10], radius: 5, count: 40, block: 'oak_leaves', seed: 7 };
  const a = [], b = [];
  one(op).forEach((x, y, z) => a.push(`${x},${y},${z}`));
  one(op).forEach((x, y, z) => b.push(`${x},${y},${z}`));
  assert.deepEqual(a, b);
  assert.ok(a.length > 10);
});

test('bilinmeyen op ve eksik alanlar atlanır', () => {
  const g = build({ size: [8, 8, 8], steps: [{ ops: [{ op: 'teleport' }, { op: 'box' }, null] }] });
  assert.equal(g.count(), 0);
});

test('size yoksa 32³', () => {
  const g = build({ steps: [] });
  assert.equal(g.w, 32);
  assert.equal(g.h, 32);
});

test('scatter replace:true yalnızca var olan blokları boyar', () => {
  const g = build({ size: [20, 20, 20], steps: [{ ops: [
    { op: 'box', from: [0, 0, 0], to: [19, 0, 19], block: 'stone' },
    { op: 'scatter', center: [10, 0, 10], radius: [10, 3, 10], chance: 0.5, block: 'dirt', replace: true, seed: 2 },
  ] }] });
  assert.equal(g.count(), 400);
  assert.ok(g.layerCounts(0).get('dirt') > 0);
});

test('dev kalın çizgi donmaz (Codex #1)', () => {
  const t = Date.now();
  const g = one({ op: 'line', from: [-128, -128, -128], to: [128, 128, 128], radius: 32, block: 'stone' }, [64, 64, 64]);
  assert.ok(g.count() > 1000);
  assert.ok(Date.now() - t < 1500, `${Date.now() - t}ms`);
});

test('op sayısı sınırlı (Codex #1)', () => {
  const ops = Array.from({ length: 5000 }, (_, i) => ({ op: 'blocks', points: [[i % 64, 0, 0]], block: 'stone' }));
  const g = build({ size: [64, 4, 4], steps: [{ ops }] });
  assert.ok(g.count() <= 64);
  const t = Date.now();
  const big = Array.from({ length: 2000 }, () => ({ op: 'box', from: [0, 0, 0], to: [63, 63, 63], block: 'stone' }));
  build({ size: [64, 64, 64], steps: [{ ops: big }] });
  assert.ok(Date.now() - t < 3000, `${Date.now() - t}ms`);
});
