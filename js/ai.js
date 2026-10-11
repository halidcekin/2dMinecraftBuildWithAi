// Gemini REST istemcisi. Anahtar çağırandan gelir; bu modül saklamaz.

import { SYSTEM_PROMPT } from './prompt.js';
import { OP_NAMES, MAX_OPS } from './shapes.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
export const DEFAULT_MODEL = 'gemini-flash-latest';

export class AiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // NO_KEY | BAD_KEY | QUOTA | NETWORK | BAD_RESPONSE | ABORTED
  }
}

export function extractJson(text) {
  const s = String(text ?? '').replace(/```(?:json)?/gi, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('Yanıtta JSON bulunamadı');
  return JSON.parse(s.slice(a, b + 1));
}

export function validateDesign(o) {
  if (!o || typeof o !== 'object') return 'Yanıt bir JSON nesnesi değil';
  if (o.kind === 'existing') return typeof o.searchTerms === 'string' && o.searchTerms ? null : 'searchTerms eksik';
  if (o.kind !== 'custom') return 'kind "existing" ya da "custom" olmalı';
  if (!Array.isArray(o.size) || o.size.length !== 3 || !o.size.every((n) => Number.isFinite(n) && n >= 1 && n <= 64)) {
    return 'size [W,H,D] olmalı ve her biri 1..64 arası sayı olmalı';
  }
  if (!Array.isArray(o.steps) || o.steps.length === 0) return 'steps boş olmayan bir dizi olmalı';
  let count = 0;
  for (const st of o.steps) {
    if (!st || !Array.isArray(st.ops)) return 'her adımın ops dizisi olmalı';
    for (const op of st.ops) {
      if (!op || !OP_NAMES.includes(op.op)) return `bilinmeyen op: ${op?.op}`;
      count++;
    }
  }
  if (count === 0) return 'hiç op yok';
  if (count > MAX_OPS) return `en fazla ${MAX_OPS} op kullan`;
  return null;
}

async function call(body, { apiKey, model, signal, fetchImpl = fetch }) {
  if (!apiKey) throw new AiError('NO_KEY', 'Gemini API anahtarı girilmemiş');
  let res;
  try {
    res = await fetchImpl(`${BASE}${encodeURIComponent(model || DEFAULT_MODEL)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (signal?.aborted || e?.name === 'AbortError') throw new AiError('ABORTED', 'İstek iptal edildi');
    throw new AiError('NETWORK', 'Gemini\'ye bağlanılamadı');
  }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message ?? ''; } catch { /* boş */ }
    if (res.status === 404) throw new AiError('MODEL_GONE', `Model bulunamadı. ${detail}`.trim());
    if (res.status === 500 || res.status === 503) throw new AiError('OVERLOADED', 'Gemini şu an çok yoğun. Biraz sonra tekrar dene.');
    if (res.status === 429) throw new AiError('QUOTA', 'Gemini kotası doldu. Biraz bekleyip tekrar dene.');
    if (res.status === 400 || res.status === 401 || res.status === 403) throw new AiError('BAD_KEY', `Anahtar ya da model geçersiz. ${detail}`.trim());
    throw new AiError('NETWORK', `Gemini hatası (${res.status}). ${detail}`.trim());
  }
  const data = await res.json();
  const cand = data?.candidates?.[0];
  const text = (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  return { text, cand };
}

const version = (name) => (name.match(/gemini-(\d+(?:\.\d+)?)/) || [0, '0'])[1] * 1;

// Kullanılabilir modellerden en yeni kararlı "flash" modelini seçer.
export async function pickModel({ apiKey, signal, fetchImpl = fetch }, exclude = []) {
  let res;
  try {
    res = await fetchImpl(`${BASE.slice(0, -1)}?pageSize=1000`, { headers: { 'x-goog-api-key': apiKey }, signal });
  } catch {
    throw new AiError('NETWORK', 'Model listesi alınamadı');
  }
  if (!res.ok) throw new AiError('BAD_KEY', 'Model listesi alınamadı; anahtarı kontrol et.');
  const names = ((await res.json())?.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => String(m.name).replace(/^models\//, ''))
    .filter((n) => n.startsWith('gemini-') && !exclude.includes(n));
  const byVersion = (a, b) => version(b) - version(a);
  const plain = names.filter((n) => /^gemini-[\d.]+-flash$/.test(n)).sort(byVersion);
  const flash = names.filter((n) => n.includes('flash') && !/lite|image|tts|audio|live/.test(n)).sort(byVersion);
  const lite = names.filter((n) => n.includes('flash') && !/image|tts|audio|live/.test(n)).sort(byVersion);
  const pick = plain[0] ?? flash[0] ?? lite[0] ?? names.sort(byVersion)[0];
  if (!pick) throw new AiError('BAD_KEY', 'Bu anahtarla kullanılabilir Gemini modeli bulunamadı.');
  return pick;
}

const RETRY_DELAYS = [2000, 5000];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 404: model kaldırılmış → güncel modele geç. 500/503: yoğunluk → bekleyip tekrar dene,
// yine olmazsa başka bir modele geç. opts.model güncellenir ve onModelChange ile bildirilir.
async function callModel(body, opts) {
  const sleep = opts.sleep ?? wait;
  let overloaded = 0;
  const tried = [];
  for (;;) {
    try {
      return await call(body, opts);
    } catch (e) {
      if (e.code === 'OVERLOADED' && overloaded < RETRY_DELAYS.length) {
        await sleep(RETRY_DELAYS[overloaded++]);
        if (opts.signal?.aborted) throw new AiError('ABORTED', 'İstek iptal edildi');
        continue;
      }
      if ((e.code !== 'MODEL_GONE' && e.code !== 'OVERLOADED') || tried.length >= 2) throw e;
      tried.push(opts.model);
      opts.model = await pickModel(opts, tried);
      if (e.code === 'MODEL_GONE') opts.onModelChange?.(opts.model); // yoğunluk geçişi kalıcı değil
      overloaded = 0;
    }
  }
}

export async function design(query, { apiKey, model, forceCustom = false, signal, fetchImpl, onModelChange, sleep } = {}) {
  const opts = { apiKey, model, signal, fetchImpl, onModelChange, sleep };
  const userText = forceCustom
    ? `${query}\n\n(Bu yapıyı mutlaka kendin tasarla: kind "custom" döndür.)`
    : query;
  const contents = [{ role: 'user', parts: [{ text: userText }] }];
  const body = () => ({
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents,
    generationConfig: { responseMimeType: 'application/json', temperature: 0.7 },
  });

  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) throw new AiError('ABORTED', 'İstek iptal edildi');
    const { text } = await callModel(body(), opts);
    try {
      const obj = extractJson(text);
      const err = validateDesign(obj);
      if (!err) {
        if (forceCustom && obj.kind !== 'custom') throw new Error('kind "custom" olmalı');
        return obj;
      }
      throw new Error(err);
    } catch (e) {
      lastError = e.message;
      contents.push({ role: 'model', parts: [{ text: text || '(boş)' }] });
      contents.push({ role: 'user', parts: [{ text: `Yanıtın geçersizdi: ${lastError}. Kurallara uyan TEK bir geçerli JSON nesnesi döndür.` }] });
    }
  }
  throw new AiError('BAD_RESPONSE', `Yapay zeka geçerli bir tasarım üretemedi (${lastError}). Tekrar dene.`);
}

const isWebUrl = (u) => {
  try { return ['https:', 'http:'].includes(new URL(u).protocol); } catch { return false; }
};

export async function findSchematics(terms, { apiKey, model, signal, fetchImpl, onModelChange } = {}) {
  const { cand } = await callModel({
    contents: [{ role: 'user', parts: [{ text: `Find downloadable Minecraft schematics / build tutorials for: "${terms}". Prefer bloxelizer.com, planetminecraft.com, minecraft-schematics.com, grabcraft.com. List the best pages.` }] }],
    tools: [{ google_search: {} }],
  }, { apiKey, model, signal, fetchImpl, onModelChange });
  const seen = new Set();
  const links = [];
  for (const ch of cand?.groundingMetadata?.groundingChunks ?? []) {
    const web = ch?.web;
    if (!web?.uri || seen.has(web.uri) || !isWebUrl(web.uri)) continue;
    seen.add(web.uri);
    links.push({ title: web.title || web.uri, uri: web.uri });
  }
  return links.slice(0, 8);
}

export function fallbackLinks(terms) {
  return [
    { title: 'Bloxelizer şemalarında ara (Google)', uri: `https://www.google.com/search?q=${encodeURIComponent(`site:bloxelizer.com/schematics ${terms}`)}` },
    { title: 'Planet Minecraft\'ta ara', uri: `https://www.planetminecraft.com/projects/?keywords=${encodeURIComponent(terms)}` },
  ];
}
