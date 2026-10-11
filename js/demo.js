// Anahtarı olmayan ziyaretçiler için elle hazırlanmış örnek tasarım: dev üzüm salkımı.
// AI'nin üreteceği formatın aynısıdır.

function grapes() {
  const ops = [];
  const cx = 20, cz = 20;
  // Yukarıdan aşağı daralan halkalar halinde taneler
  const rings = [
    { y: 34, r: 11, n: 8 }, { y: 29, r: 10, n: 8 }, { y: 24, r: 8, n: 7 },
    { y: 19, r: 6, n: 6 }, { y: 14, r: 4, n: 5 }, { y: 9, r: 2, n: 3 },
  ];
  rings.forEach(({ y, r, n }, i) => {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + i * 0.6;
      ops.push({ op: 'ellipsoid', center: [Math.round(cx + Math.cos(a) * r), y, Math.round(cz + Math.sin(a) * r)], radius: [4, 4, 4], block: 'purple_concrete', hollow: true });
    }
    ops.push({ op: 'ellipsoid', center: [cx, y, cz], radius: [4, 4, 4], block: 'purple_concrete', hollow: true });
  });
  ops.push({ op: 'ellipsoid', center: [cx, 4, cz], radius: [4, 4, 4], block: 'purple_concrete', hollow: true });
  return ops;
}

export const DEMO_DESIGN = {
  kind: 'custom',
  title: 'Dev Üzüm Salkımı',
  summary: 'Yaklaşık 45 blok yüksekliğinde, mor taneleri, kahverengi sapı ve geniş asma yaprağıyla dev bir üzüm salkımı. Taneler içi boş kürelerdir, böylece daha az blok harcanır.',
  size: [41, 48, 41],
  steps: [
    { name: 'Taneler', note: 'Alttan başla; her tane 9 blok çaplı içi boş bir küre.', ops: grapes() },
    { name: 'Gölgeler ve parlaklık', note: 'Tanelerin üstüne açık, altına koyu tonlar serpiştir.', ops: [
      { op: 'scatter', center: [20, 30, 20], radius: [16, 9, 16], replace: true, chance: 0.25, block: 'magenta_concrete', seed: 3 },
      { op: 'scatter', center: [20, 10, 20], radius: [9, 10, 9], replace: true, chance: 0.35, block: 'purple_terracotta', seed: 5 },
      { op: 'scatter', center: [20, 38, 20], radius: [16, 3, 16], replace: true, chance: 0.3, block: 'purple_wool', seed: 9 },
    ] },
    { name: 'Sap', note: 'Kalın kahverengi sap salkımın ortasından yukarı çıkar ve hafifçe kıvrılır.', ops: [
      { op: 'line', from: [20, 30, 20], to: [20, 41, 20], radius: 1.5, block: 'spruce_log' },
      { op: 'line', from: [20, 41, 20], to: [24, 45, 18], radius: 1, block: 'spruce_log' },
      { op: 'line', from: [20, 38, 20], to: [12, 42, 22], radius: 0.6, block: 'dark_oak_log' },
    ] },
    { name: 'Asma yaprağı', note: 'Sapın yanına basık, geniş bir yaprak ve damarları.', ops: [
      { op: 'ellipsoid', center: [11, 43, 22], radius: [8, 1, 6], block: 'green_concrete' },
      { op: 'ellipsoid', center: [6, 43, 18], radius: [4, 1, 3], block: 'green_concrete' },
      { op: 'ellipsoid', center: [8, 43, 27], radius: [4, 1, 3], block: 'green_concrete' },
      { op: 'line', from: [16, 44, 22], to: [5, 44, 22], radius: 0, block: 'lime_concrete' },
      { op: 'line', from: [12, 44, 22], to: [7, 44, 17], radius: 0, block: 'lime_concrete' },
      { op: 'line', from: [12, 44, 22], to: [8, 44, 27], radius: 0, block: 'lime_concrete' },
    ] },
    { name: 'Kıvrık dal', note: 'Asma filizi ile son dokunuş.', ops: [
      { op: 'blocks', points: [[26, 45, 18], [27, 46, 18], [28, 46, 19], [28, 47, 20], [27, 47, 21]], block: 'lime_concrete' },
    ] },
  ],
};
