import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VoxelGrid } from '../js/voxel.js';
import { BLOCKS, resolveBlock } from '../js/blocks.js';

test('set sınır dışını yok sayar', () => {
  const g = new VoxelGrid(4, 4, 4);
  g.set(-1, 0, 0, 'stone');
  g.set(4, 0, 0, 'stone');
  g.set(0, 9, 0, 'stone');
  assert.equal(g.count(), 0);
});

test('set/get ve ondalık koordinat yuvarlanır', () => {
  const g = new VoxelGrid(4, 4, 4);
  g.set(1.4, 2.6, 0, 'oak_log');
  assert.equal(g.get(1, 3, 0), 'oak_log');
  assert.equal(g.get(0, 0, 0), null);
});

test('air siler', () => {
  const g = new VoxelGrid(4, 4, 4);
  g.set(1, 1, 1, 'stone');
  g.set(1, 1, 1, 'air');
  assert.equal(g.count(), 0);
  assert.equal(g.get(1, 1, 1), null);
});

test('layerCounts katman sayımı', () => {
  const g = new VoxelGrid(4, 4, 4);
  g.set(0, 0, 0, 'stone');
  g.set(1, 0, 0, 'stone');
  g.set(2, 0, 0, 'dirt');
  g.set(0, 1, 0, 'dirt');
  const c = g.layerCounts(0);
  assert.equal(c.get('stone'), 2);
  assert.equal(c.get('dirt'), 1);
  assert.equal(g.count(), 4);
  assert.deepEqual(g.palette().sort(), ['dirt', 'stone']);
});

test('boyut 64 ile sınırlı', () => {
  const g = new VoxelGrid(100, 5, 5);
  assert.equal(g.w, 64);
  assert.equal(g.h, 5);
});

test('forEach tüm blokları gezer', () => {
  const g = new VoxelGrid(3, 3, 3);
  g.set(2, 1, 0, 'glass');
  const seen = [];
  g.forEach((x, y, z, id) => seen.push([x, y, z, id]));
  assert.deepEqual(seen, [[2, 1, 0, 'glass']]);
});

test('resolveBlock', () => {
  assert.equal(resolveBlock('minecraft:OAK_LOG'), 'oak_log');
  assert.equal(resolveBlock('xyz'), 'stone');
  assert.equal(resolveBlock('air'), 'air');
  assert.ok(Object.keys(BLOCKS).length >= 60);
  for (const [id, b] of Object.entries(BLOCKS)) {
    assert.match(b.color, /^#[0-9a-f]{6}$/i, id);
    assert.ok(b.name, id);
  }
});
