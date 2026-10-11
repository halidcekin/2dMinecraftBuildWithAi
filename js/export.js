// VoxelGrid → Sponge Schematic v2 (.schem) ve göreli /fill-/setblock komutları.

import { writeNbt } from './nbt.js';

const DATA_VERSION = 3465; // Minecraft 1.20.1

export function toSchemBytes(grid) {
  const { w, h, d } = grid;
  const palette = { 'minecraft:air': { type: 'int', value: 0 } };
  const indexOf = new Map([[null, 0]]);
  for (const id of grid.palette()) {
    indexOf.set(id, indexOf.size);
    palette[`minecraft:${id}`] = { type: 'int', value: indexOf.get(id) };
  }

  const data = [];
  for (let y = 0; y < h; y++) {
    for (let z = 0; z < d; z++) {
      for (let x = 0; x < w; x++) {
        let v = indexOf.get(grid.get(x, y, z));
        while (v >= 0x80) { data.push((v & 0x7f) | 0x80); v >>>= 7; }
        data.push(v);
      }
    }
  }

  return writeNbt('Schematic', {
    Version: { type: 'int', value: 2 },
    DataVersion: { type: 'int', value: DATA_VERSION },
    Width: { type: 'short', value: w },
    Height: { type: 'short', value: h },
    Length: { type: 'short', value: d },
    Offset: { type: 'intArray', value: [0, 0, 0] },
    PaletteMax: { type: 'int', value: indexOf.size },
    Palette: { type: 'compound', value: palette },
    BlockData: { type: 'byteArray', value: Uint8Array.from(data) },
  });
}

export async function toSchemGzip(grid) {
  const stream = new Blob([toSchemBytes(grid)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}

export function toCommands(grid) {
  const out = [];
  for (let y = 0; y < grid.h; y++) {
    for (let z = 0; z < grid.d; z++) {
      let x = 0;
      while (x < grid.w) {
        const id = grid.get(x, y, z);
        if (!id) { x++; continue; }
        let end = x;
        while (end + 1 < grid.w && grid.get(end + 1, y, z) === id) end++;
        out.push(end > x
          ? `fill ~${x} ~${y} ~${z} ~${end} ~${y} ~${z} minecraft:${id}`
          : `setblock ~${x} ~${y} ~${z} minecraft:${id}`);
        x = end + 1;
      }
    }
  }
  return out;
}
