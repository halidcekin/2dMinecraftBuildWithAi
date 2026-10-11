# MC AI Builder — Tasarım (Spec)

Tarih: 2026-10-11

## Amaç
GitHub Pages'te yayınlanan, tek bir arama çubuğundan oluşan bir yapay zeka sitesi. Kullanıcı Minecraft'ta yapmak istediği yapıyı yazar:
- **Hazır bulunabilir yapı** (ör. "siyah küçük kale", "ortaçağ evi") → gerçek şema sayfalarına (Bloxelizer, Planet Minecraft vb.) linkler gösterilir.
- **Özgün yapı** (ör. "dev ceviz ağacı", "dev üzüm") → yapay zeka yapıyı kendisi tasarlar; Bloxelizer "2D build guide" benzeri **katman katman** blok ızgarası gösterilir ve dışa aktarılabilir.

Başarı ölçütü: "dev ceviz" yazınca birkaç saniyede tanınabilir bir yapı oluşur, her Y katmanında hangi bloğun nereye konacağı görülür, `.schem` dosyası WorldEdit/Litematica'da açılır, `/fill`-`/setblock` komutları çalışır.

## Kısıtlar
- Statik site (GitHub Pages), derleme adımı yok: saf HTML/CSS/ES modülleri.
- Yapay zeka: **Google Gemini**, BYOK. Her ziyaretçi kendi API anahtarını Ayarlar'a girer; anahtar sadece kendi tarayıcısında (localStorage) saklanır, istek tarayıcıdan doğrudan Google'a gider. Repoda anahtar yok.
- Maksimum yapı boyutu 64×64×64 (taşan bloklar kırpılır).
- Arayüz dili Türkçe.

## Mimari
```
index.html            tek sayfa: arama ekranı + sonuç ekranı + ayarlar diyaloğu
css/style.css         koyu, profesyonel tema
js/app.js             UI akışı (arama → AI → sonuç), durum yönetimi
js/ai.js              Gemini istemcisi: classify+design çağrısı, arama (grounding) çağrısı, JSON doğrulama/yeniden deneme
js/prompt.js          sistem talimatı ve JSON şeması
js/blocks.js          blok paleti: id → {ad (TR), renk}, prosedürel doku üretimi
js/shapes.js          şekil komutları → Voxel ızgarası (saf, DOM'suz, test edilebilir)
js/voxel.js           VoxelGrid sınıfı (Uint16Array, palet, sınırlar, katman sayımı)
js/viewer.js          2D katman görüntüleyici (canvas): ızgara, chunk çizgileri, zoom/pan, hover tooltip, Y kaydırıcı
js/export.js          Sponge .schem (NBT + gzip) ve /fill-/setblock komut üretimi (saf, test edilebilir)
js/nbt.js             minimal NBT yazıcı
tests/*.test.mjs      node --test ile birim testleri
```

## Veri akışı
1. Kullanıcı arar → `ai.design(query)` Gemini'ye JSON şemalı istek atar (`responseMimeType: application/json`).
2. Yanıt `kind` alanına göre:
   - `"existing"` → `ai.findSchematics(searchTerms)` ikinci çağrı, `google_search` aracı açık; `groundingMetadata.groundingChunks` içindeki web linkleri (başlık + uri) listelenir. Her zaman yedek linkler de eklenir: Google `site:bloxelizer.com/schematics <terim>`, Planet Minecraft `planetminecraft.com/projects/?keywords=<terim>`. Kullanıcı yine de "Yine de AI ile tasarla" diyebilir (zorla custom).
   - `"custom"` → `shapes.build(design)` → `VoxelGrid` → `viewer` + export.
3. Bozuk/şemaya uymayan JSON → hata mesajı eklenerek bir kez yeniden denenir.

## AI çıktı formatı (custom)
```json
{
  "kind": "custom",
  "title": "Dev Ceviz",
  "summary": "Kısa açıklama (TR)",
  "size": [40, 36, 40],
  "steps": [
    { "name": "Kabuk", "note": "Önce dış kabuğu ör", "ops": [
      { "op": "ellipsoid", "center": [20,18,20], "radius": [16,15,17], "block": "brown_terracotta", "hollow": true }
    ]}
  ]
}
```
Koordinatlar: x,z yatay, y yukarı, 0 tabandan; `size` sınırları içinde.

Desteklenen `op`'lar (hepsi `block` alır; `"air"` oyma demektir; opsiyonel `hollow`, `thickness`):
- `box` {from, to}
- `ellipsoid` {center, radius:[rx,ry,rz]} (küre için eşit yarıçap)
- `cylinder` {base, radius, height, axis:"y"|"x"|"z"}
- `cone` {base, radius, height} (y ekseninde, tepeye doğru daralır)
- `line` {from, to, radius} (dallar, saplar; kalın çizgi)
- `blocks` {points:[[x,y,z],...]} (detay noktaları)
- `scatter` {center, radius, count, block, seed} (yaprak/doku serpiştirme, deterministik)

Op'lar sırayla uygulanır; sonra gelen öncekinin üstüne yazar.

Hazır yapı için: `{ "kind":"existing", "title":..., "summary":..., "searchTerms":"english search terms" }`.

## Blok paleti
~70 yaygın blok (ahşaplar, kütükler, yapraklar, yün/beton/terracotta renkleri, taş türleri, cam, vb.), her biri Minecraft id'si, Türkçe ad ve temsilî renk. Görüntüleyici her blok için 16×16 prosedürel doku (renk + deterministik gürültü, kütük/yaprak/cam için desen) üretir. Bilinmeyen id → en yakın varsayılan (`stone`) ve konsol uyarısı.

## Sonuç ekranı (Bloxelizer benzeri)
- Canvas ızgara: blok dokuları, ince ızgara çizgileri, 16'lık **kırmızı chunk çizgileri**, yapı sınır çerçevesi.
- Sağda dikey Y kaydırıcısı, büyük katman numarası "9 / 36", ↑/↓ düğmeleri, klavye ↑/↓ ve fare tekeri+Shift.
- Altında yarı saydam bir önceki katman ("ghost") gösterimi açılıp kapanabilir.
- Sol altta "Bu katmanda: N blok" ve katmanın blok dağılımı (küçük renk listesi).
- Hover: blok adı + koordinat. Zoom (tekerlek) ve pan (sürükle).
- Yapım adımları (AI `steps` adları/notları) kısa liste.
- Dışa aktar: **.schem indir**, **komutları kopyala** (/fill satır birleştirme + /setblock), **.mcfunction indir**. Komutlar `~ ~ ~` göreli.

## Hata yönetimi
- Anahtar yok → Ayarlar diyaloğu açılır, "ücretsiz anahtar al" rehberi (aistudio.google.com/apikey).
- 400/403 → "Anahtar geçersiz"; 429 → "Kota doldu, biraz bekle"; ağ hatası → tekrar dene düğmesi.
- Boş/çok küçük sonuç (< 10 blok) → yeniden dene önerisi.

## Ayarlar
API anahtarı (gizli alan, göster/gizle), model adı (varsayılan `gemini-2.5-flash`, değiştirilebilir), anahtarı sil.

## Test
- `node --test`: `shapes` (her op'un blok sayısı/sınırları, hollow, air oyma, kırpma), `voxel` (katman sayımı), `nbt`/`export` (.schem gzip+NBT yapısı geri okunarak doğrulanır, /fill birleştirme doğruluğu).
- Tarayıcıda manuel: sahte (mock) AI yanıtıyla görüntüleyici, ardından gerçek Gemini anahtarıyla "dev ceviz".

## Yayın
GitHub reposu → Settings → Pages → `main` / root. README'de kurulum ve kullanım.

## Kapsam dışı (YAGNI)
3D önizleme, malzeme listesi/stack hesabı, kullanıcı hesabı, sunucu/proxy.
