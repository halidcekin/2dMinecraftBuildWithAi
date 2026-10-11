import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VoxelGrid } from '../js/voxel.js';
import { readNbt } from '../js/nbt.js';
import { toSchemBytes, toSchemGzip, toCommands } from '../js/export.js';

function decodeVarints(bytes) {
  const out = [];
  let v = 0, shift = 0;
  for (const b of bytes) {
    v |= (b & 0x7f) << shift;
    if (b & 0x80) { shift += 7; continue; }
    out.push(v); v = 0; shift = 0;
  }
  return out;
}

test('schem yapısı geri okunur', () => {
  const g = new VoxelGrid(3, 2, 4);
  g.set(0, 0, 0, 'stone');
  g.set(2, 1, 3, 'oak_log');
  const { name, value: s } = readNbt(toSchemBytes(g));
  assert.equal(name, 'Schematic');
  assert.equal(s.Version, 2);
  assert.equal(s.DataVersion, 3465);
  assert.equal(s.Width, 3);
  assert.equal(s.Height, 2);
  assert.equal(s.Length, 4);
  assert.deepEqual([...s.Offset], [0, 0, 0]);
  assert.equal(s.Palette['minecraft:air'], 0);
  assert.equal(s.PaletteMax, 3);
  const data = decodeVarints(s.BlockData);
  assert.equal(data.length, 3 * 2 * 4);
  assert.equal(data[0], s.Palette['minecraft:stone']);
  assert.equal(data[2 + 3 * 3 + 1 * 3 * 4], s.Palette['minecraft:oak_log']);
  assert.equal(data.filter((d) => d === 0).length, 22);
});

test('128+ palet indeksi varint ile kodlanır', () => {
  const g = new VoxelGrid(64, 1, 4);
  for (let i = 0; i < 200; i++) g.set(i % 64, 0, Math.floor(i / 64), 'b' + i);
  const { value: s } = readNbt(toSchemBytes(g));
  const data = decodeVarints(s.BlockData);
  assert.equal(data.length, 64 * 4);
  assert.equal(data[199], s.Palette['minecraft:b199']);
  assert.ok(s.Palette['minecraft:b199'] >= 128);
});

test('gzip çıktısı gzip başlığıyla başlar', async () => {
  const g = new VoxelGrid(2, 2, 2);
  g.set(0, 0, 0, 'stone');
  const blob = await toSchemGzip(g);
  const b = new Uint8Array(await blob.arrayBuffer());
  assert.equal(b[0], 0x1f);
  assert.equal(b[1], 0x8b);
});

test('komutlar: koşu birleştirme', () => {
  const g = new VoxelGrid(8, 2, 2);
  for (let x = 1; x <= 5; x++) g.set(x, 0, 0, 'stone');
  g.set(7, 1, 1, 'glass');
  assert.deepEqual(toCommands(g), [
    'fill ~1 ~0 ~0 ~5 ~0 ~0 minecraft:stone',
    'setblock ~7 ~1 ~1 minecraft:glass',
  ]);
});

test('boş grid', () => {
  const g = new VoxelGrid(4, 4, 4);
  assert.deepEqual(toCommands(g), []);
  const { value: s } = readNbt(toSchemBytes(g));
  assert.equal(s.PaletteMax, 1);
});
