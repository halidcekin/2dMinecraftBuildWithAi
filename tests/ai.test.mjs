import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJson, validateDesign, design, findSchematics, fallbackLinks, AiError } from '../js/ai.js';

const reply = (text, extra = {}) => ({
  ok: true, status: 200,
  json: async () => ({ candidates: [{ content: { parts: [{ text }] }, ...extra }] }),
});
const fail = (status) => ({ ok: false, status, json: async () => ({ error: { message: 'x' } }) });
const opts = (fetchImpl) => ({ apiKey: 'k', model: 'gemini-test', fetchImpl });

const CUSTOM = { kind: 'custom', title: 'Dev Ceviz', summary: 's', size: [10, 10, 10], steps: [{ name: 'a', ops: [{ op: 'box', from: [0, 0, 0], to: [1, 1, 1], block: 'stone' }] }] };

test('extractJson çitli ve ön metinli yanıt', () => {
  assert.deepEqual(extractJson('Tamam:\n```json\n{"a":1}\n```\nbitti'), { a: 1 });
  assert.deepEqual(extractJson('{"a":{"b":2}}'), { a: { b: 2 } });
  assert.throws(() => extractJson('json yok'));
});

test('validateDesign', () => {
  assert.equal(validateDesign(CUSTOM), null);
  assert.equal(validateDesign({ kind: 'existing', title: 't', searchTerms: 'castle' }), null);
  assert.ok(validateDesign({ kind: 'custom', title: 't' }));
  assert.ok(validateDesign({ kind: 'nope' }));
  assert.ok(validateDesign(null));
});

test('design: bozuk yanıttan sonra yeniden dener', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return calls.length === 1 ? reply('bozuk {') : reply(JSON.stringify(CUSTOM));
  };
  const out = await design('dev ceviz', opts(fetchImpl));
  assert.equal(out.title, 'Dev Ceviz');
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /models\/gemini-test:generateContent$/);
  assert.equal(calls[0].init.headers['x-goog-api-key'], 'k');
  const body = JSON.parse(calls[1].init.body);
  assert.equal(body.contents.length, 3);
});

test('design: iki kez bozuksa BAD_RESPONSE', async () => {
  await assert.rejects(design('x', opts(async () => reply('yok'))), (e) => e instanceof AiError && e.code === 'BAD_RESPONSE');
});

test('design: forceCustom mesaja eklenir', async () => {
  let body;
  await design('kale', { ...opts(async (u, i) => { body = JSON.parse(i.body); return reply(JSON.stringify(CUSTOM)); }), forceCustom: true });
  assert.match(body.contents[0].parts[0].text, /custom/);
});

test('hata kodları', async () => {
  await assert.rejects(design('x', opts(async () => fail(429))), (e) => e.code === 'QUOTA');
  await assert.rejects(design('x', opts(async () => fail(403))), (e) => e.code === 'BAD_KEY');
  await assert.rejects(design('x', opts(async () => fail(400))), (e) => e.code === 'BAD_KEY');
  await assert.rejects(design('x', opts(async () => { throw new TypeError('net'); })), (e) => e.code === 'NETWORK');
  await assert.rejects(design('x', { model: 'm', fetchImpl: async () => reply('{}') }), (e) => e.code === 'NO_KEY');
});

test('findSchematics grounding linkleri', async () => {
  let body;
  const fetchImpl = async (u, i) => {
    body = JSON.parse(i.body);
    return reply('metin', { groundingMetadata: { groundingChunks: [
      { web: { uri: 'https://a.example/1', title: 'bloxelizer.com' } },
      { web: { uri: 'https://a.example/1', title: 'bloxelizer.com' } },
      { web: { uri: 'https://b.example/2', title: 'planetminecraft.com' } },
    ] } });
  };
  const links = await findSchematics('black castle', opts(fetchImpl));
  assert.deepEqual(body.tools, [{ google_search: {} }]);
  assert.equal(links.length, 2);
  assert.deepEqual(links[0], { title: 'bloxelizer.com', uri: 'https://a.example/1' });
});

test('fallbackLinks', () => {
  const l = fallbackLinks('black castle');
  assert.equal(l.length, 2);
  assert.ok(l[0].uri.includes('site%3Abloxelizer.com%2Fschematics%20black%20castle') || l[0].uri.includes('site%3Abloxelizer.com%2Fschematics+black+castle'));
  assert.ok(l[1].uri.startsWith('https://www.planetminecraft.com/projects/?keywords=black'));
});

test('findSchematics yalnızca http(s) linklerini kabul eder (Codex #3)', async () => {
  const fetchImpl = async () => reply('x', { groundingMetadata: { groundingChunks: [
    { web: { uri: 'javascript:alert(1)', title: 'kötü' } },
    { web: { uri: 'data:text/html,hi', title: 'kötü2' } },
    { web: { uri: 'https://ok.example/a', title: 'iyi' } },
  ] } });
  const links = await findSchematics('x', opts(fetchImpl));
  assert.deepEqual(links.map((l) => l.uri), ['https://ok.example/a']);
});

test('design iptal edilebilir (Codex #2)', async () => {
  const ac = new AbortController();
  let calls = 0;
  const fetchImpl = async (url, init) => {
    calls++;
    ac.abort();
    assert.equal(init.signal.aborted, true); // kullanıcı iptali fetch'e ulaşır
    throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  };
  await assert.rejects(design('x', { ...opts(fetchImpl), signal: ac.signal }), (e) => e.code === 'ABORTED');
  assert.equal(calls, 1);
});

test('validateDesign sıkı (Codex #6)', () => {
  const base = { kind: 'custom', title: 't', size: [10, 10, 10], steps: [{ name: 'a', ops: [{ op: 'box', from: [0, 0, 0], to: [1, 1, 1], block: 'stone' }] }] };
  assert.equal(validateDesign(base), null);
  assert.ok(validateDesign({ ...base, size: ['a', 10, 10] }));
  assert.ok(validateDesign({ ...base, size: [0, 10, 10] }));
  assert.ok(validateDesign({ ...base, steps: [] }));
  assert.ok(validateDesign({ ...base, steps: [{ name: 'a', ops: [{ op: 'teleport' }] }] }));
  assert.ok(validateDesign({ ...base, steps: [{ name: 'a' }] }));
});

test('model kalkmışsa (404) güncel flash modeline geçer', async () => {
  const urls = [];
  const fetchImpl = async (url, init) => {
    urls.push(url);
    if (url.includes('gemini-2.5-flash:generateContent')) return fail(404);
    if (url.endsWith('/models?pageSize=1000')) return { ok: true, status: 200, json: async () => ({ models: [
      { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.0-flash-lite', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.0-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.0-pro', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
    ] }) };
    return reply(JSON.stringify(CUSTOM));
  };
  let picked;
  const out = await design('x', { apiKey: 'k', model: 'gemini-2.5-flash', fetchImpl, onModelChange: (m) => { picked = m; } });
  assert.equal(out.title, 'Dev Ceviz');
  assert.equal(picked, 'gemini-3.0-flash');
  assert.ok(urls.at(-1).includes('gemini-3.0-flash:generateContent'));
});

test('503 yoğunlukta tekrar dener, olmazsa başka modele geçer', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url.endsWith('/models?pageSize=1000')) return { ok: true, status: 200, json: async () => ({ models: [
      { name: 'models/gemini-3.0-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.0-flash-lite', supportedGenerationMethods: ['generateContent'] },
    ] }) };
    if (url.includes('gemini-3.0-flash:generateContent')) return fail(503);
    return reply(JSON.stringify(CUSTOM));
  };
  let picked;
  const out = await design('x', { apiKey: 'k', model: 'gemini-3.0-flash', fetchImpl, sleep: async () => {}, onModelChange: (m) => { picked = m; } });
  assert.equal(out.title, 'Dev Ceviz');
  assert.equal(urls.filter((u) => u.includes('gemini-3.0-flash:generateContent')).length, 3);
  assert.equal(picked, undefined); // geçici geçiş ayarlara yazılmaz
  assert.ok(urls.at(-1).includes('gemini-3.0-flash-lite:generateContent'));
});

test('yanıt gelmezse zaman aşımı → başka modele geçer ve durum bildirir', async () => {
  const urls = [], statuses = [];
  const fetchImpl = (url, init) => {
    urls.push(url);
    if (url.endsWith('/models?pageSize=1000')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ models: [
      { name: 'models/gemini-3.0-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.0-flash-lite', supportedGenerationMethods: ['generateContent'] },
    ] }) });
    if (url.includes('gemini-3.0-flash:')) return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' }))));
    return Promise.resolve(reply(JSON.stringify(CUSTOM)));
  };
  const out = await design('x', { apiKey: 'k', model: 'gemini-3.0-flash', fetchImpl, timeoutMs: 30, sleep: async () => {}, onStatus: (s) => statuses.push(s) });
  assert.equal(out.title, 'Dev Ceviz');
  assert.ok(urls.at(-1).includes('flash-lite'));
  assert.ok(statuses.some((s) => /gemini-3.0-flash-lite/.test(s)));
});

test('kullanıcı iptali zaman aşımından ayrılır', async () => {
  const ac = new AbortController();
  const fetchImpl = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' }))));
  setTimeout(() => ac.abort(), 10);
  await assert.rejects(design('x', { ...opts(fetchImpl), signal: ac.signal, timeoutMs: 5000 }), (e) => e.code === 'ABORTED');
});
