// Gemini teşhis aracı: anahtarı ekrana yazmadan modelleri listeler ve gerçek bir tasarım isteğinin süresini ölçer.
// Kullanım (PowerShell):  $env:GEMINI_API_KEY="anahtarın"; node tools/gemini-check.mjs "bir gecekondu evi"
import { design, pickModel, DEFAULT_MODEL } from '../js/ai.js';
import { build } from '../js/shapes.js';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('GEMINI_API_KEY ortam değişkeni yok.');
  process.exit(1);
}
const query = process.argv[2] || 'bir gecekondu evi';
const t0 = Date.now();
const sec = () => `${((Date.now() - t0) / 1000).toFixed(1)} sn`;

try {
  console.log('Önerilen model:', await pickModel({ apiKey }));
} catch (e) {
  console.log('Model listesi hatası:', e.code, e.message);
}

console.log(`İstek: "${query}" (başlangıç modeli ${DEFAULT_MODEL})`);
try {
  const d = await design(query, {
    apiKey,
    model: DEFAULT_MODEL,
    onStatus: (m) => console.log(`[${sec()}] ${m}`),
    onModelChange: (m) => console.log(`[${sec()}] model değişti: ${m}`),
  });
  console.log(`[${sec()}] Yanıt geldi: kind=${d.kind}, başlık="${d.title}"`);
  if (d.kind === 'custom') {
    const g = build(d);
    const ops = d.steps.reduce((n, s) => n + s.ops.length, 0);
    console.log(`Boyut ${g.w}x${g.h}x${g.d}, ${g.count()} blok, ${d.steps.length} adım, ${ops} op`);
  }
} catch (e) {
  console.log(`[${sec()}] HATA: ${e.code} — ${e.message}`);
}
