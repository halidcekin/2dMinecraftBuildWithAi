import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJson, validateDesign, design, findSchematics, fallbackLinks, AiError } from '../js/ai.js';

const reply = (text, extra = {}) => ({
  ok: true, status: 200,
  json: async () => ({ candidates: [{ content: { parts: [{ text }] }, ...extra }] }),
});
const fail = (status) => ({ ok: false, status, json: async () => ({ error: { message: 'x' } }) });
const opts = (fetchImpl) => ({ apiKey: 'k', model: 'gemini-test', fetchImpl });

const CUSTOM = { kind: 'custom', title: 'Dev Ceviz', summary: 's', size: [10, 10, 10], steps: [{ name: 'a', ops: [] }] };

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
