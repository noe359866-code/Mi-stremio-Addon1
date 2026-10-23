'use strict';

/**
 * util.js — helpers puros (sin dependencias externas).
 * Todo lo de aquí es determinista y testeable: normalización de textos,
 * lectura de números en formato español ("7,4" / "98.123"), extracción de
 * bloques JSON embebidos en HTML y búsqueda profunda de claves.
 */

const HTML_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  bdquo: '„',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201c',
  rdquo: '\u201d',
  middot: '·',
  bull: '•',
  deg: '°',
  euro: '€',
  trade: '™',
  copy: '©',
  reg: '®',
  times: '×',
  fract12: '½',
};

/** Convierte entidades HTML (&amp;, &#39;, &#x2019;) a texto plano. */
function decodeEntities(input) {
  if (!input) return '';
  return String(input)
    .replace(/&#x([0-9a-fA-F]{1,6});/g, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d{1,6});/g, (_, dec) => safeCodePoint(Number(dec)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]{1,10});/g, (match, name) => {
      const key = name.toLowerCase();
      return Object.prototype.hasOwnProperty.call(HTML_ENTITIES, key) ? HTML_ENTITIES[key] : match;
    })
    .replace(/<[^>]{0,200}>/g, ' ');
}

function safeCodePoint(code) {
  try {
    if (!code || code > 0x10ffff) return '';
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/** Elimina acentos/ puntuación para comparar títulos entre fuentes. */
function foldText(input) {
  if (!input) return '';
  return decodeEntities(input)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['`´]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Coeficiente de Dice sobre tokens: 0 = nada que ver, 1 = idéntico. */
function titleSimilarity(a, b) {
  const left = foldText(a).split(' ').filter(Boolean);
  const right = foldText(b).split(' ').filter(Boolean);
  if (!left.length || !right.length) return 0;
  if (left.join(' ') === right.join(' ')) return 1;
  const setA = new Set(left);
  const setB = new Set(right);
  let overlap = 0;
  for (const token of setA) if (setB.has(token)) overlap += 1;
  return (2 * overlap) / (setA.size + setB.size);
}

const LEADING_ARTICLES = ['the', 'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'le', 'les', 'il', 'a'];

/**
 * Slug estilo Rotten Tomatoes: minúsculas, guiones bajos y sin artículo inicial
 * ("Spider-Man: No Way Home" -> spider_man_no_way_home).
 */
function slugifyUnderscore(title) {
  return foldText(title).split(' ').filter(Boolean).join('_');
}

/** Slug estilo Metacritic: con guiones medios. */
function slugifyDash(title) {
  return foldText(title).split(' ').filter(Boolean).join('-');
}

/** Variante sin artículo inicial: algunas webs lo descartan al generar el slug. */
function dropLeadingArticle(slug, sep = '_') {
  const words = String(slug || '').split(sep).filter(Boolean);
  if (words.length > 1 && LEADING_ARTICLES.includes(words[0].toLowerCase())) return words.slice(1).join(sep);
  return '';
}

/** quita sufijos ": Season 3", "(2019)" etc. para buscar slugs. */
function stripTitleNoise(title) {
  return decodeEntities(title || '')
    .replace(/\s*\((?:19|20)\d{2}\)\s*$/, '')
    .replace(/\s*:\s*(?:season|temporada)\s*\d+.*$/i, '')
    .replace(/\s*\[\d{4}\]\s*$/, '')
    .trim();
}

/** "7,4" | "7.4" | "8,1/10" -> número o null. */
function parseScoreLoose(input) {
  if (input === null || input === undefined) return null;
  const raw = String(input).replace(/\s/g, '');
  const match = raw.match(/(\d{1,3})(?:[.,](\d{1,2}))?/);
  if (!match) return null;
  const decimals = match[2] !== undefined ? match[2].length === 1 ? match[2] : match[2].slice(0, 2) : '';
  const value = Number(`${match[1]}${decimals ? `.${decimals}` : ''}`);
  if (!Number.isFinite(value)) return null;
  return value;
}

/** "98.123" | "1,234,567" | "5.4K" | "1.2M" -> cantidad entera o null. */
function parseCountLoose(input) {
  if (input === null || input === undefined) return null;
  const raw = String(input).replace(/\s/g, '').replace(/[^\d.,KMBkmb]/g, '');
  if (!raw) return null;
  const suffix = (raw.match(/([KMBkmb])$/) || [])[1];
  const digits = raw.replace(/[^\d]/g, '');
  let value = Number(digits);
  if (!Number.isFinite(value)) return null;
  if (suffix) {
    const mult = { k: 1e3, K: 1e3, m: 1e6, M: 1e6, b: 1e9, B: 1e9 }[suffix];
    // "1.2M" llega como 12 -> multiplicamos por el factor /10^(decimales quitados)
    const decimalsRemoved = (raw.match(/[.,]/g) || []).length;
    value = (decimalsRemoved > 0 ? value / Math.pow(10, decimalsRemoved) : value) * mult;
  }
  return Math.round(value);
}

/** Acepta "1997", "(1997)", "2019–2023", "2010 - " -> año o null. */
function yearFrom(input) {
  if (!input) return null;
  const match = String(input).match(/(19[0-9]{2}|20[0-9]{2})/);
  return match ? Number(match[1]) : null;
}

/** Pasa una nota a escala 0-10. */
function scaleToTen(value, fromScale = 10) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const scale = Number(fromScale) || 10;
  const out = (num / scale) * 10;
  if (!Number.isFinite(out)) return null;
  return clamp(Math.round(out * 100) / 100, 0, 10);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round1(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 10) / 10;
}

/**
 * Devuelve todos los bloques JSON embebidos en <script ...>...</script>
 * (ld+json, prs.init-data+json, __NEXT_DATA__, window.X = {...}).
 * Cada elemento: { type, label, data } — `data` es null si no se pudo parsear.
 */
function extractJsonScripts(html) {
  if (!html) return [];
  const out = [];
  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  let guard = 0;
  while ((match = scriptRe.exec(html)) && guard++ < 400) {
    const attrs = match[1] || '';
    const body = (match[2] || '').trim();
    if (!body || body.length < 12) continue;
    const typeMatch = attrs.match(/type\s*=\s*["']([^"']+)["']/i);
    const type = typeMatch ? typeMatch[1].toLowerCase() : '';
    const idMatch = attrs.match(/id\s*=\s*["']([^"']+)["']/i);
    const label = [type, idMatch && idMatch[1]].filter(Boolean).join(':');
    const isJsonType = /json/i.test(type);
    if (isJsonType) {
      const parsed = safeJson(body);
      if (parsed !== null) out.push({ type: 'script', label, data: parsed });
      continue;
    }
    // Asignaciones tipo window.__INITIAL_DATA__ = {...};  (RT usa esto)
    const assignRe = /=\s*(\{[\s\S]*\}|\[[\s\S]*\])\s*;?\s*$/;
    const assign = body.match(assignRe);
    if (assign) {
      const parsed = safeJson(assign[1]);
      if (parsed !== null) out.push({ type: 'assign', label: label || 'assign', data: parsed });
    }
  }
  return out;
}

function safeJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // último intento: recortar hasta la última llave balanceada
    const start = text.search(/[[{]/);
    if (start < 0) return null;
    const open = text[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === open) depth += 1;
      else if (ch === close) {
        depth -= 1;
        if (depth === 0) {
          try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
        }
      }
    }
    return null;
  }
}

/**
 * Recorre un objeto JSON invocando visit(value, key, parents).
 * Devuelve el primer valor "aceptado" (no undefined) — útil para localizar
 * ratingValue/voteCount sin conocer la ruta exacta del JSON de cada web.
 */
function deepFind(root, visit, options = {}) {
  const maxDepth = options.maxDepth || 14;
  const stack = [{ node: root, key: null, parents: [], depth: 0 }];
  const seen = new Set();
  let guard = 0;
  while (stack.length && guard++ < (options.maxNodes || 40000)) {
    const { node, key, parents, depth } = stack.pop();
    if (node === null || node === undefined) continue;
    if (typeof node === 'object') {
      if (seen.has(node)) continue;
      seen.add(node);
      const result = visit(node, key, parents, depth);
      if (result !== undefined) return result;
      if (depth >= maxDepth) continue;
      if (Array.isArray(node)) {
        for (let i = node.length - 1; i >= 0; i--) {
          stack.push({ node: node[i], key: i, parents: parents.concat(key === null ? [] : [key]), depth: depth + 1 });
        }
      } else {
        for (const childKey of Object.keys(node)) {
          stack.push({
            node: node[childKey],
            key: childKey,
            parents: parents.concat(key === null ? [] : [key]),
            depth: depth + 1,
          });
        }
      }
    }
  }
  return undefined;
}

/** Busca el primer valor escalar bajo una lista de nombres de clave. */
function deepFindKey(root, keys, options = {}) {
  const wanted = new Set((Array.isArray(keys) ? keys : [keys]).map((k) => String(k).toLowerCase()));
  return deepFindValueByKey(root, wanted, options);
}

function deepFindValueByKey(root, wantedLower, options = {}) {
  const maxDepth = options.maxDepth || 14;
  const stack = [{ node: root, depth: 0 }];
  const seen = new Set();
  let guard = 0;
  while (stack.length && guard++ < (options.maxNodes || 40000)) {
    const { node, depth } = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (seen.has(node)) continue;
    seen.add(node);
    if (!Array.isArray(node)) {
      for (const key of Object.keys(node)) {
        if (wantedLower.has(key.toLowerCase())) {
          const value = node[key];
          if (value !== null && value !== undefined && (typeof value !== 'object' || options.allowObject)) {
            return value;
          }
          if (options.allowObject) return value;
        }
      }
    }
    if (depth >= maxDepth) continue;
    for (const key of Object.keys(node)) stack.push({ node: node[key], depth: depth + 1 });
  }
  return undefined;
}

/** Reúne TODAS las coincidencias de una clave (para listas/arrays). */
function deepCollectKey(root, keyName, options = {}) {
  const wanted = String(keyName).toLowerCase();
  const maxDepth = options.maxDepth || 14;
  const out = [];
  const stack = [{ node: root, depth: 0 }];
  const seen = new Set();
  let guard = 0;
  while (stack.length && guard++ < (options.maxNodes || 40000)) {
    const { node, depth } = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (seen.has(node)) continue;
    seen.add(node);
    if (!Array.isArray(node)) {
      for (const key of Object.keys(node)) {
        if (key.toLowerCase() === wanted) out.push(node[key]);
      }
    }
    if (depth >= maxDepth) continue;
    for (const key of Object.keys(node)) stack.push({ node: node[key], depth: depth + 1 });
  }
  return out;
}

function uniq(values) {
  return Array.from(new Set(values.filter((v) => v !== null && v !== undefined && v !== '')));
}

function escapeHtml(input) {
  return String(input === null || input === undefined ? '' : input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function base64UrlEncode(obj) {
  const json = typeof obj === 'string' ? obj : JSON.stringify(obj);
  return Buffer.from(json, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(b64, 'base64').toString('utf8');
}

/**
 * Recorre coincidencias de una regex y entrega, para cada una, una "ventana"
 * del HTML alrededor del match. Es la forma barata y robusta de parsear listas
 * (carteles de Top 250, resultados de búsqueda) sin dependencias de parsing.
 */
function forEachMatch(html, regex, windowSize, handler) {
  if (!html) return [];
  const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);
  const out = [];
  let match;
  let guard = 0;
  while ((match = re.exec(html)) && guard++ < 500) {
    const start = match.index;
    const chunk = html.slice(start, start + (windowSize || 1200));
    const result = handler(match, chunk, start);
    if (result) out.push(result);
    if (re.lastIndex <= start) re.lastIndex = start + 1; // evitar loop infinito
  }
  return out;
}

/** Primer capture de alguna de las regex dadas (en orden). */
function firstMatch(text, patterns, group = 1) {
  if (!text) return null;
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[group] !== undefined) return match[group];
  }
  return null;
}

/** Extrae el content de <meta property|name="...">. */
function metaContent(html, prop) {
  if (!html) return null;
  const escaped = String(prop).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*?content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]*?content=["']([^"']*)["'][^>]*?(?:property|name)=["']${escaped}["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']{1,400})["'][^>]*?${escaped}`, 'i'),
  ];
  for (const re of patterns) {
    const match = html.match(re);
    if (match) {
      const value = match[2] !== undefined && match[1] ? match[2] : match[1];
      return decodeEntities(value);
    }
  }
  return null;
}

/** Texto visible de un bloque (sin tags), recortado. */
function visibleText(html, max = 200) {
  const text = decodeEntities(html)
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? text.slice(0, max) : text;
}

/** Copia de `patch` sobre `base` sólo donde `base` esté vacío. */
function mergeGaps(base, patch = {}) {
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === '') continue;
    const current = out[key];
    const empty = current === null || current === undefined || current === '' || (Array.isArray(current) && !current.length);
    if (empty) out[key] = value;
  }
  return out;
}

/** Quita " (2010)" del final: los títulos de las fichas suelen venir con año. */
function stripYearSuffix(title) {
  return String(title || '').replace(/\s*[\[(](?:19|20)\d{2}[\])]\s*$/, '').trim();
}

function truncate(text, max = 120) {
  return text && text.length > max ? `${text.slice(0, max)}…` : text;
}

module.exports = {
  mergeGaps,
  stripYearSuffix,
  forEachMatch,
  firstMatch,
  metaContent,
  visibleText,
  truncate,
  decodeEntities,
  foldText,
  titleSimilarity,
  slugifyUnderscore,
  slugifyDash,
  dropLeadingArticle,
  stripTitleNoise,
  parseScoreLoose,
  parseCountLoose,
  yearFrom,
  scaleToTen,
  clamp,
  round1,
  extractJsonScripts,
  safeJson,
  deepFind,
  deepFindKey,
  deepCollectKey,
  uniq,
  escapeHtml,
  base64UrlEncode,
  base64UrlDecode,
};
