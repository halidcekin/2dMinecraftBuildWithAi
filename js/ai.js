// Gemini REST istemcisi. Anahtar çağırandan gelir; bu modül saklamaz.

import { SYSTEM_PROMPT } from './prompt.js';
import { OP_NAMES, MAX_OPS } from './shapes.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
export const DEFAULT_MODEL = 'gemini-2.5-flash';

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
    if (res.status === 429) throw new AiError('QUOTA', 'Gemini kotası doldu. Biraz bekleyip tekrar dene.');
    if (res.status === 400 || res.status === 401 || res.status === 403) throw new AiError('BAD_KEY', `Anahtar ya da model geçersiz. ${detail}`.trim());
    throw new AiError('NETWORK', `Gemini hatası (${res.status}). ${detail}`.trim());
  }
  const data = await res.json();
  const cand = data?.candidates?.[0];
  const text = (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  return { text, cand };
}

export async function design(query, { apiKey, model, forceCustom = false, signal, fetchImpl } = {}) {
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
    const { text } = await call(body(), { apiKey, model, signal, fetchImpl });
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

export async function findSchematics(terms, { apiKey, model, signal, fetchImpl } = {}) {
  const { cand } = await call({
    contents: [{ role: 'user', parts: [{ text: `Find downloadable Minecraft schematics / build tutorials for: "${terms}". Prefer bloxelizer.com, planetminecraft.com, minecraft-schematics.com, grabcraft.com. List the best pages.` }] }],
    tools: [{ google_search: {} }],
  }, { apiKey, model, signal, fetchImpl });
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
