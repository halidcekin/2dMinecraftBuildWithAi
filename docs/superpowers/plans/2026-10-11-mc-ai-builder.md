# MC AI Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tek arama çubuklu, Gemini destekli, özgün Minecraft yapılarını katman katman gösteren ve hazır yapıları şema sitelerine yönlendiren statik site.

**Architecture:** Saf ES modülleri. Saf mantık (`shapes`, `voxel`, `nbt`, `export`, `blocks`) DOM'suz ve Node'da test edilir; `ai`, `viewer`, `app` tarayıcı katmanıdır. AI yalnızca şekil komutları JSON'u üretir, voxel'e çeviri yereldir.

**Tech Stack:** HTML/CSS/vanilla JS (ES2022 modules), Canvas 2D, `CompressionStream('gzip')`, Gemini REST `v1beta generateContent`, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-11-mc-ai-builder-design.md`

## Global Constraints
- Derleme adımı yok; GitHub Pages `main` / root'tan servis.
- Maksimum boyut 64×64×64; taşan bloklar kırpılır.
- API anahtarı yalnızca `localStorage['mcab.apiKey']`; model `localStorage['mcab.model']`, varsayılan `gemini-2.5-flash`.
- Arayüz metinleri Türkçe.
- Gemini isteği: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`, başlık `x-goog-api-key`.

## Review Focus
1. AI koordinatları sınır dışı / negatif / ondalık verirse → kırpılır ve yuvarlanır, çökme yok (shapes testi).
2. Bilinmeyen blok id'si → `stone`'a düşer (blocks testi).
3. Gemini yanıtı ```json çitli veya fazladan metinli gelirse → ayıklanıp parse edilir (ai `extractJson` testi).
4. Boş yapı (0 blok) → .schem/komut üretimi hata vermez, UI "boş sonuç" uyarısı verir (export testi).
5. Çok büyük `radius`/`count` → döngüler size ile sınırlı kalır, tarayıcı donmaz (shapes testi: radius 1000 hızlı biter).

---

### Task 1: Blok paleti + VoxelGrid

**Files:** Create `js/blocks.js`, `js/voxel.js`, `package.json` (`{"type":"module","scripts":{"test":"node --test tests/"}}`), Test `tests/voxel.test.mjs`

**Interfaces — Produces:**
- `BLOCKS: Record<string,{name:string,color:string,pattern?:'log'|'leaves'|'glass'|'planks'|'ore'}>` (~70 blok, `air` hariç)
- `resolveBlock(id:string): string` — `minecraft:` önekini atar, küçük harfe çevirir, bilinmiyorsa `'stone'`.
- `class VoxelGrid { constructor(w,h,d); w,h,d; set(x,y,z,id); get(x,y,z):string|null; count():number; layerCounts(y):Map<string,number>; palette():string[]; forEach(cb(x,y,z,id)) }` — `set` sınır dışını yok sayar, koordinatları `Math.round`'lar, `id==='air'` siler; `w,h,d` en fazla 64'e kırpılır.

- [ ] Test: `set` sınır dışı yok sayılır; `air` siler; `layerCounts(0)` doğru; `new VoxelGrid(100,5,5).w===64`; `resolveBlock('minecraft:OAK_LOG')==='oak_log'`, `resolveBlock('xyz')==='stone'`.
- [ ] `npm test` → FAIL; uygula; PASS; commit `feat: blok paleti ve VoxelGrid`.

### Task 2: Şekil komutları → voxel

**Files:** Create `js/shapes.js`, Test `tests/shapes.test.mjs`

**Interfaces — Consumes:** Task 1. **Produces:** `build(design): VoxelGrid` — `design.size` ([w,h,d], yoksa 32³) ile grid kurar, `design.steps[].ops[]` sırayla uygular; op bloğu `resolveBlock` ile; bilinmeyen op atlanır.

Op'lar spec'teki gibi: `box, ellipsoid, cylinder(axis), cone, line(radius), blocks, scatter(seed)`. `hollow:true` → yalnızca kabuk (`thickness` vars. 1). Döngüler daima grid sınırlarıyla kesişen kutuda döner (Review Focus 5). `scatter` deterministik PRNG (mulberry32, seed vars. 1), elipsoid içinde rastgele nokta.

- [ ] Testler: `box [0,0,0]-[2,2,2]` → 27; `ellipsoid r=3` dolu sayısı 100..130 arası (yaklaşık 4/3πr³≈113), `hollow` sayısı dolu sayısından az ve merkez boş; `cylinder r=2 h=5 axis y` → her katmanda aynı sayı; `cone` üst katman alt katmandan az; `line` [0,0,0]→[10,0,0] r=0 → 11 blok; `block:'air'` oyar; negatif/ondalık koordinat çökmez; `ellipsoid radius 1000` < 1 sn biter ve grid dolar; `scatter` aynı seed → aynı sonuç.
- [ ] FAIL → uygula → PASS → commit `feat: şekil komutlarını voxel'e çeviren motor`.

### Task 3: NBT + .schem + komut dışa aktarma

**Files:** Create `js/nbt.js`, `js/export.js`, Test `tests/export.test.mjs`

**Interfaces — Produces:**
- `nbt.js`: `writeNbt(rootName, value): Uint8Array` — değerler tipli etiketlerle: `{type:'int'|'short'|'byte'|'string'|'byteArray'|'intArray'|'compound'|'list', value}`; big-endian. Test için `readNbt(bytes)` da yazılır (aynı dosya).
- `export.js`:
  - `toSchemBytes(grid): Uint8Array` (sıkıştırılmamış NBT) — Sponge v2: kök `Schematic` {Version int 2, DataVersion int 3465, Width/Height/Length short, Offset intArray [0,0,0], PaletteMax int, Palette compound {"minecraft:air":0, "minecraft:<id>":n}, BlockData byteArray (varint, indeks = x + z*W + y*W*L)}.
  - `async toSchemGzip(grid): Promise<Blob>` — `CompressionStream('gzip')`.
  - `toCommands(grid): string[]` — her (y,z) satırında X boyunca aynı blok koşuları; uzunluk>1 → `fill ~x1 ~y ~z ~x2 ~y ~z minecraft:id`, 1 → `setblock`. Önek `/` yok (mcfunction uyumlu); UI kopyalarken ekler.

- [ ] Testler: 2 blokluk grid → `readNbt(toSchemBytes(g))` Width/Palette/BlockData doğru; 200+ palet indeksli varint (≥128) doğru kodlanır; satırda 5 aynı blok → tek `fill`; boş grid → `toCommands` `[]` ve `toSchemBytes` hata vermez.
- [ ] FAIL → uygula → PASS → commit `feat: .schem ve komut dışa aktarma`.

### Task 4: Gemini istemcisi + prompt

**Files:** Create `js/prompt.js`, `js/ai.js`, Test `tests/ai.test.mjs`

**Interfaces — Produces:**
- `prompt.js`: `SYSTEM_PROMPT:string` (TR/EN karışık talimat: sınıflandırma kuralı, op listesi, koordinat sistemi, max 64, blok id listesi `Object.keys(BLOCKS)`, zengin detay ve tanınabilirlik vurgusu, 15-60 op), `RESPONSE_SCHEMA` (Gemini `responseSchema` OpenAPI alt kümesi).
- `ai.js`:
  - `extractJson(text): object` — çit/ön-arka metni temizler, ilk `{`..son `}` parse.
  - `validateDesign(obj): string|null` — hata mesajı veya null (`kind` ∈ existing/custom; custom ise `steps` dizi).
  - `async design(query, {apiKey, model, forceCustom, fetchImpl=fetch}): Promise<object>` — JSON modlu çağrı; doğrulama başarısızsa hata metniyle bir kez yeniden dener.
  - `async findSchematics(terms, {apiKey, model, fetchImpl}): Promise<{title,uri}[]>` — `tools:[{google_search:{}}]`, `groundingMetadata.groundingChunks[].web`.
  - `fallbackLinks(terms): {title,uri}[]` — Google `site:bloxelizer.com/schematics`, Planet Minecraft `?keywords=`.
  - `class AiError extends Error { code: 'NO_KEY'|'BAD_KEY'|'QUOTA'|'NETWORK'|'BAD_RESPONSE' }` — HTTP 400/403→BAD_KEY, 429→QUOTA.

- [ ] Testler (sahte `fetchImpl`): çitli JSON parse; ilk yanıt bozuk ikinci geçerli → başarılı ve 2 çağrı; 429 → `AiError` code `QUOTA`; anahtar yok → `NO_KEY`; `fallbackLinks('black castle')` iki link, URL-encode'lu.
- [ ] FAIL → uygula → PASS → commit `feat: Gemini istemcisi`.

### Task 5: Katman görüntüleyici

**Files:** Create `js/viewer.js`

**Interfaces — Consumes:** VoxelGrid, BLOCKS. **Produces:** `class LayerViewer { constructor(canvas, {onHover(info|null)}); setGrid(grid); setLayer(y); layer; setGhost(bool); fit(); }` — tuval DPR-uyumlu; prosedürel 16×16 doku önbelleği (`pattern`'e göre); ızgara çizgileri, 16'lık kırmızı chunk çizgileri, siyah sınır çerçevesi; tekerlek zoom (imleç merkezli), sürükle pan; hover → `{x,y,z,id,name}`.

- [ ] Doğrulama: Task 6'daki demo yapıyla tarayıcıda görsel kontrol (Bloxelizer ekran görüntüsüne benzer).
- [ ] Commit `feat: 2D katman görüntüleyici`.

### Task 6: Sayfa, tema, akış, README

**Files:** Create `index.html`, `css/style.css`, `js/app.js`, `js/demo.js`, `README.md`, `.nojekyll`

`demo.js`: `DEMO_DESIGN` — elle yazılmış "dev üzüm salkımı" tasarımı; Ayarlar'da anahtar yokken "Demo yapıyı gör" düğmesi bunu yükler (anahtarsız ziyaretçi siteyi deneyebilir).

Ekranlar: (1) Hero: logo, başlık, tek arama çubuğu, örnek çipler ("Dev ceviz ağacı", "Dev üzüm", "Siyah küçük kale"); (2) Yükleniyor durumu (adım metinleri); (3) Sonuç-existing: link kartları + "Yine de AI ile tasarla"; (4) Sonuç-custom: tam ekran görüntüleyici, sağda Y paneli (büyük sayı, `/ H`, ↑↓, dikey slider), sol araç çubuğu (yeni arama, ghost, sığdır), sol alt katman sayımı, alt panel adımlar + dışa aktarma düğmeleri; (5) Ayarlar diyaloğu. Klavye ↑/↓ katman, Esc ana sayfa. Hatalar `AiError.code`'a göre TR mesaj + toast.

- [ ] Yerel sunucu (`npx serve` veya `python -m http.server`) ile tarayıcıda: demo yükle, katman değiştir, hover, .schem indir, komut kopyala; mobil genişlikte düzen bozulmuyor.
- [ ] `npm test` hepsi PASS.
- [ ] Commit `feat: arayüz ve uygulama akışı`.

### Task 7: Gerçek Gemini ile uçtan uca + yayın rehberi

- [ ] Kullanıcının anahtarıyla (kullanıcı kendi girer) "dev ceviz ağacı" ve "siyah küçük kale" denenir; prompt gerekirse iyileştirilir.
- [ ] README: GitHub'a push ve Pages açma adımları. Push kullanıcı onayıyla.
