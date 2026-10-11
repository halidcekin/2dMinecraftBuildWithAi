# Blokçu AI — Minecraft Yapı Tasarlayıcı

Tek bir arama çubuğu. Minecraft'ta yapmak istediğin yapıyı yaz:

- **Hazır bulunabilecek bir yapıysa** (ör. "siyah küçük kale"), yapay zeka Google'da arayıp Bloxelizer, Planet Minecraft gibi sitelerdeki şema sayfalarını listeler.
- **Özgün bir yapıysa** (ör. "dev ceviz ağacı", "dev üzüm"), yapay zeka yapıyı kendisi tasarlar. Sonuç Bloxelizer'daki gibi **katman katman** gösterilir: hangi Y katmanında hangi blok nereye konacak, blok sayıları, 16'lık chunk çizgileri.
- Tasarım **.schem** (WorldEdit / Litematica), **.mcfunction** veya kopyalanabilir `/fill` / `/setblock` komutları olarak dışa aktarılır.

## Yapay zeka anahtarı

Site Google **Gemini** ile çalışır. Her ziyaretçi kendi ücretsiz anahtarını sağ üstteki ⚙ Ayarlar'a girer:

1. <https://aistudio.google.com/apikey> → **Create API key**
2. Anahtarı Ayarlar'a yapıştır → **Kaydet**

Anahtar yalnızca ziyaretçinin tarayıcısında (localStorage) saklanır ve doğrudan Google'a gider. Repoda ya da sunucuda anahtar yoktur; kimse başkasının kotasını kullanmaz.

Anahtarı olmayanlar ana sayfadaki **"Örnek yapıyı incele"** ile demo yapıyı görebilir.

## GitHub Pages'te yayınlama

1. GitHub'da yeni bir repo oluştur (ör. `blokcu-ai`).
2. Bu klasörü push et:
   ```bash
   git remote add origin https://github.com/<kullanici-adin>/blokcu-ai.git
   git push -u origin main
   ```
3. Repo → **Settings → Pages → Build and deployment → Source: Deploy from a branch**, Branch: `main`, klasör: `/ (root)` → **Save**.
4. Birkaç dakika sonra site `https://<kullanici-adin>.github.io/blokcu-ai/` adresinde yayında olur.

Derleme adımı yoktur; dosyalar olduğu gibi servis edilir.

## Yerelde çalıştırma ve test

```bash
npx serve .
npm test
```

## Yapı

| Dosya | Görev |
|---|---|
| `js/ai.js`, `js/prompt.js` | Gemini istemcisi ve tasarım talimatı |
| `js/shapes.js` | Yapay zekanın şekil komutlarını (küre, silindir, koni, dal…) bloklara çevirir |
| `js/voxel.js`, `js/blocks.js` | Blok ızgarası ve blok paleti |
| `js/viewer.js` | 2D katman görüntüleyici |
| `js/export.js`, `js/nbt.js` | .schem ve komut dışa aktarma |
| `js/app.js` | Sayfa akışı |

Minecraft, Mojang Studios'un ticari markasıdır. Bu proje resmi değildir.
