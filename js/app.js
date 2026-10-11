// Sayfa akışı: arama → Gemini → hazır şema linkleri ya da katman görüntüleyici.

import { design, findSchematics, fallbackLinks, AiError, DEFAULT_MODEL } from './ai.js';
import { build } from './shapes.js';
import { LayerViewer } from './viewer.js';
import { toSchemGzip, toCommands, toMcfunction } from './export.js';
import { BLOCKS } from './blocks.js';
import { DEMO_DESIGN } from './demo.js';

const $ = (id) => document.getElementById(id);

// --- Ayar deposu (localStorage erişilemezse bellek içi) ---
const memory = {};
const store = {
  get(k) { try { return localStorage.getItem(k) ?? memory[k] ?? ''; } catch { return memory[k] ?? ''; } },
  set(k, v) { memory[k] = v; try { localStorage.setItem(k, v); } catch { /* yok say */ } },
  del(k) { delete memory[k]; try { localStorage.removeItem(k); } catch { /* yok say */ } },
};
const KEY = 'mcab.apiKey', MODEL = 'mcab.model';
const settings = () => ({ apiKey: store.get(KEY).trim(), model: store.get(MODEL).trim() || DEFAULT_MODEL });

// --- Ekranlar ---
function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
}

let toastTimer;
function toast(msg, isError = false) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('error', isError);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 6000 : 3000);
}

// --- Ayarlar diyaloğu ---
function openSettings(reason = '') {
  $('settingsReason').textContent = reason;
  $('apiKey').value = store.get(KEY);
  $('model').value = settings().model;
  $('settings').showModal();
}
$('openSettings').addEventListener('click', () => openSettings());
$('toggleKey').addEventListener('click', () => {
  const i = $('apiKey');
  i.type = i.type === 'password' ? 'text' : 'password';
  $('toggleKey').textContent = i.type === 'password' ? 'Göster' : 'Gizle';
});
$('clearKey').addEventListener('click', () => {
  store.del(KEY);
  $('apiKey').value = '';
  toast('Anahtar silindi');
});
$('settings').addEventListener('close', () => {
  if ($('settings').returnValue !== 'save') return;
  store.set(KEY, $('apiKey').value.trim());
  store.set(MODEL, $('model').value.trim() || DEFAULT_MODEL);
  toast('Ayarlar kaydedildi');
  if (pendingQuery && settings().apiKey) { const q = pendingQuery; pendingQuery = null; run(q); }
});

// --- Arama akışı ---
let requestId = 0;
let controller = null; // aktif isteğin AbortController'ı
let pendingQuery = null;
let loadingTimer;
let lastQuery = '';

const LOADING_STEPS = [
  'İsteğin analiz ediliyor…',
  'Hazır şema mı, özgün yapı mı karar veriliyor…',
  'Oranlar ve siluet düşünülüyor…',
  'Yapı katman katman tasarlanıyor…',
  'Gölgeler ve detaylar ekleniyor…',
];

function startLoading(q) {
  $('loadingQuery').textContent = `“${q}”`;
  let i = 0;
  $('loadingStep').textContent = LOADING_STEPS[0];
  clearInterval(loadingTimer);
  loadingTimer = setInterval(() => {
    i = Math.min(i + 1, LOADING_STEPS.length - 1);
    $('loadingStep').textContent = LOADING_STEPS[i];
  }, 3500);
  show('loading');
}

function errorMessage(e) {
  if (e instanceof AiError) return e.message;
  return 'Beklenmeyen bir hata oluştu. Tekrar dene.';
}

async function run(query, { forceCustom = false } = {}) {
  query = query.trim();
  if (!query) return;
  lastQuery = query;
  const s = settings();
  if (!s.apiKey) {
    pendingQuery = query;
    openSettings('Tasarım yapabilmem için ücretsiz bir Gemini API anahtarı gerekiyor.');
    return;
  }
  const id = cancelRequest();
  controller = new AbortController();
  const { signal } = controller;
  startLoading(query);
  try {
    const result = await design(query, { ...s, forceCustom, signal });
    if (id !== requestId) return;
    if (result.kind === 'existing') showExisting(result, id);
    else showBuild(result);
  } catch (e) {
    if (id !== requestId || e?.code === 'ABORTED') return;
    console.error(e);
    show('home');
    if (e instanceof AiError && (e.code === 'NO_KEY' || e.code === 'BAD_KEY')) {
      pendingQuery = query;
      openSettings(e.message);
    } else {
      toast(errorMessage(e), true);
    }
  } finally {
    if (id === requestId) clearInterval(loadingTimer);
  }
}

$('searchForm').addEventListener('submit', (e) => { e.preventDefault(); run($('query').value); });
$('chips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-q]');
  if (!b) return;
  $('query').value = b.dataset.q;
  run(b.dataset.q);
});
$('cancelBtn').addEventListener('click', goHome);
$('demoBtn').addEventListener('click', () => showBuild(DEMO_DESIGN));
document.querySelectorAll('[data-home]').forEach((b) => b.addEventListener('click', goHome));
// Süren isteği gerçekten iptal eder (fetch abort) ve yeni istek kimliği döndürür.
function cancelRequest() {
  controller?.abort();
  controller = null;
  clearInterval(loadingTimer);
  return ++requestId;
}
function goHome() { cancelRequest(); show('home'); $('query').focus(); }

// --- Hazır yapı ekranı ---
function linkItem({ title, uri }) {
  const li = document.createElement('li');
  const a = document.createElement('a');
  a.href = uri;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = title;
  li.append(a);
  return li;
}

async function showExisting(result, id) {
  $('exTitle').textContent = result.title || lastQuery;
  $('exSummary').textContent = result.summary || '';
  $('exFallback').replaceChildren(...fallbackLinks(result.searchTerms).map(linkItem));
  const list = $('exLinks');
  list.replaceChildren(...[0, 1, 2].map(() => Object.assign(document.createElement('li'), { className: 'skeleton' })));
  show('existing');
  try {
    const links = await findSchematics(result.searchTerms, { ...settings(), signal: controller?.signal });
    if (id !== requestId) return;
    if (links.length) list.replaceChildren(...links.map(linkItem));
    else list.replaceChildren(Object.assign(document.createElement('li'), { className: 'empty', textContent: 'Doğrudan bir sayfa bulunamadı; aşağıdaki aramaları dene.' }));
  } catch (e) {
    if (id !== requestId || e?.code === 'ABORTED') return;
    list.replaceChildren(Object.assign(document.createElement('li'), { className: 'empty', textContent: `Kaynaklar getirilemedi: ${errorMessage(e)}` }));
  }
}
$('forceCustomBtn').addEventListener('click', () => run(lastQuery, { forceCustom: true }));

// --- Görüntüleyici ekranı ---
let current = null; // { design, grid }
const viewer = new LayerViewer($('canvas'), {
  onHover: showTooltip,
  onLayerChange: syncLayerUi,
});

function slug(s) {
  return (s || 'yapi').toLowerCase()
    .replace(/[çÇ]/g, 'c').replace(/[ğĞ]/g, 'g').replace(/[ıİ]/g, 'i').replace(/[öÖ]/g, 'o').replace(/[şŞ]/g, 's').replace(/[üÜ]/g, 'u')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'yapi';
}

function showBuild(d) {
  const grid = build(d);
  const total = grid.count();
  if (total < 10) {
    show('home');
    toast('Yapay zeka neredeyse boş bir yapı üretti. Biraz farklı yazıp tekrar dene.', true);
    return;
  }
  current = { design: d, grid };
  $('bTitle').textContent = d.title || lastQuery || 'Yapı';
  $('bMeta').textContent = `${grid.w}×${grid.h}×${grid.d} · ${total.toLocaleString('tr-TR')} blok · ${grid.palette().length} blok türü`;
  $('bSummary').textContent = d.summary || '';
  $('stepsList').replaceChildren(...(d.steps || []).map((st) => {
    const li = document.createElement('li');
    const b = document.createElement('b'); b.textContent = st.name || 'Adım';
    const sp = document.createElement('span'); sp.textContent = st.note || '';
    li.append(b, sp);
    return li;
  }));
  const r = $('layerRange');
  r.max = grid.h;
  $('layerMax').textContent = `/ ${grid.h}`;
  show('builder');
  toggleSteps(window.innerWidth >= 1000);
  requestAnimationFrame(() => {
    viewer.setGrid(grid);
    syncLayerUi(0);
  });
}

function syncLayerUi(y) {
  if (!current) return;
  $('layerNum').textContent = y + 1;
  $('layerRange').value = y + 1;
  const counts = [...current.grid.layerCounts(y)].sort((a, b) => b[1] - a[1]);
  $('layerCount').textContent = counts.reduce((n, [, c]) => n + c, 0);
  $('legend').replaceChildren(...counts.map(([id, c]) => {
    const li = document.createElement('li');
    const sw = document.createElement('i'); sw.style.background = BLOCKS[id]?.color ?? '#888';
    const name = document.createElement('span'); name.textContent = BLOCKS[id]?.name ?? id;
    const n = document.createElement('b'); n.textContent = c;
    li.append(sw, name, n);
    return li;
  }));
}

let pointer = { x: 0, y: 0 };
$('canvas').addEventListener('pointermove', (e) => {
  const r = $('canvas').getBoundingClientRect();
  pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
  const t = $('tooltip');
  t.style.left = `${pointer.x}px`;
  t.style.top = `${pointer.y}px`;
});
function showTooltip(info) {
  const t = $('tooltip');
  if (!info) { t.hidden = true; return; }
  t.replaceChildren();
  t.append(info.name ?? 'Boş (hava)');
  const sm = document.createElement('small');
  sm.textContent = `x${info.x} y${info.y} z${info.z}`;
  t.append(sm);
  t.hidden = false;
}

$('layerUp').addEventListener('click', () => viewer.setLayer(viewer.layer + 1));
$('layerDown').addEventListener('click', () => viewer.setLayer(viewer.layer - 1));
$('layerRange').addEventListener('input', (e) => viewer.setLayer(Number(e.target.value) - 1));
$('fitBtn').addEventListener('click', () => viewer.fit());
$('zoomIn').addEventListener('click', () => viewer.zoomBy(1.3));
$('zoomOut').addEventListener('click', () => viewer.zoomBy(1 / 1.3));
$('ghostBtn').addEventListener('click', () => {
  const on = !$('ghostBtn').classList.contains('active');
  $('ghostBtn').classList.toggle('active', on);
  viewer.setGhost(on);
});
const toggleSteps = (open) => {
  $('stepsDrawer').hidden = !open;
  $('stepsBtn').classList.toggle('active', open);
};
$('stepsBtn').addEventListener('click', () => toggleSteps($('stepsDrawer').hidden));
$('closeSteps').addEventListener('click', () => toggleSteps(false));

document.addEventListener('keydown', (e) => {
  if ($('settings').open) return;
  const builderActive = $('builder').classList.contains('active');
  if (e.key === 'Escape' && !$('home').classList.contains('active')) { goHome(); return; }
  if (!builderActive || e.target.closest('input, textarea')) return;
  if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); viewer.setLayer(viewer.layer + 1); }
  if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); viewer.setLayer(viewer.layer - 1); }
});

// --- Dışa aktarma ---
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('dlSchem').addEventListener('click', async () => {
  if (!current) return;
  try {
    download(await toSchemGzip(current.grid), `${slug(current.design.title)}.schem`);
    toast('.schem indirildi — WorldEdit: //schem load, Litematica: schematics klasörüne koy.');
  } catch (e) {
    console.error(e);
    toast('.schem oluşturulamadı. Tarayıcın güncel olmayabilir.', true);
  }
});

$('dlFunction').addEventListener('click', () => {
  if (!current) return;
  const text = toMcfunction(current.grid, current.design.title);
  download(new Blob([text], { type: 'text/plain' }), `${slug(current.design.title)}.mcfunction`);
  toast('Komutlar .mcfunction olarak indirildi');
});

$('copyCmds').addEventListener('click', async () => {
  if (!current) return;
  const lines = toCommands(current.grid);
  try {
    await navigator.clipboard.writeText(lines.map((l) => `/${l}`).join('\n'));
    toast(`${lines.length} komut kopyalandı. Çok sayıda olduğu için .mcfunction ya da komut bloğu zinciri önerilir.`);
  } catch {
    toast('Panoya kopyalanamadı; .mcfunction indirmeyi dene.', true);
  }
});
