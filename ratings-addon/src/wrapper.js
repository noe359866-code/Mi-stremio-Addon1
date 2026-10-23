'use strict';

/**
 * wrapper.js — reutiliza catálogos de addons ya existentes.
 *
 * Stremio no deja que un addon modifique la respuesta de otro. La única forma de
 * cambiar sus tarjetas es servir una versión envuelta y reemplazar el original.
 * Aquí se copian los manifiestos/catálogos upstream, se conservan ids y orden, y
 * se enriquecen los meta previews con badge nativo + URL de póster generado.
 */

const net = require('node:net');
const { resolveWork } = require('./resolve');
const { collectRatings } = require('./providers');
const { buildMeta, buildPanel } = require('./format');
const { base64UrlEncode, base64UrlDecode, yearFrom } = require('./util');

const MAX_UPSTREAMS = 6;
const JSON_MAX_BYTES = 16 * 1024 * 1024;

function isPrivateHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (host === '0.0.0.0' || host === '::' || host === '::1') return true;
  const family = net.isIP(host);
  if (family === 4) {
    const parts = host.split('.').map(Number);
    return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 || (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168);
  }
  if (family === 6) return /^(::1|f[cd]|fe[89ab])/i.test(host);
  return false;
}

function assertPublicHttpUrl(value) {
  const url = value instanceof URL ? value : new URL(String(value));
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('la URL debe usar http:// o https://');
  if (url.username || url.password) throw new Error('la URL no debe incluir usuario/contraseña');
  if (isPrivateHostname(url.hostname) && process.env.ALLOW_PRIVATE_UPSTREAMS !== '1') {
    throw new Error(`host local/privado no permitido: ${url.hostname}`);
  }
  return url;
}

/** Acepta manifest URL, URL base o stremio:// y devuelve una URL de manifiesto. */
function normalizeManifestUrl(input) {
  let raw = String(input || '').trim();
  if (!raw) throw new Error('URL de manifiesto vacía');
  if (/^stremio:\/\//i.test(raw)) raw = raw.replace(/^stremio:\/\//i, 'https://');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
  const url = assertPublicHttpUrl(raw);
  url.hash = '';
  if (url.pathname.endsWith('/')) url.pathname += 'manifest.json';
  else if (!/\/manifest\.json$/i.test(url.pathname)) {
    if (/\/manifest$/i.test(url.pathname)) url.pathname += '.json';
    else url.pathname = `${url.pathname.replace(/\/+$/, '')}/manifest.json`;
  }
  if (url.pathname.length > 1800 || url.toString().length > 3000) throw new Error('URL de manifiesto demasiado larga');
  return url.toString();
}

function normalizeUpstreams(values) {
  const list = Array.isArray(values) ? values : String(values || '').split(/[\n,;]+/);
  const out = [];
  const errors = [];
  for (const value of list.slice(0, MAX_UPSTREAMS)) {
    if (!String(value || '').trim()) continue;
    try {
      const normalized = normalizeManifestUrl(value);
      if (!out.includes(normalized)) out.push(normalized);
    } catch (error) {
      errors.push({ url: String(value).slice(0, 240), error: error.message });
    }
  }
  return { urls: out, errors };
}

function validManifest(value) {
  return Boolean(value && typeof value === 'object' && typeof value.id === 'string' && Array.isArray(value.resources));
}

async function loadUpstream(url, ctx) {
  const normalized = normalizeManifestUrl(url);
  return ctx.caches.upstream.wrap(`manifest:${normalized}`, async () => {
    const res = await ctx.http.getJson(normalized, {
      timeout: Math.min(ctx.cfg.timeoutMs || 4000, 5000),
      retries: 0,
      maxBytes: 4 * 1024 * 1024,
    }, { log: ctx.log });
    if (!res.ok || !validManifest(res.json)) {
      throw new Error(`manifiesto upstream inválido (${res.error || res.status || 'bad_json'}): ${normalized}`);
    }
    return { url: normalized, manifest: res.json };
  }, { ttlMs: 30 * 60 * 1000 }).then((entry) => entry.value);
}

async function loadUpstreams(ctx) {
  const normalized = normalizeUpstreams(ctx.cfg.upstreams);
  const settled = await Promise.allSettled(normalized.urls.map((url) => loadUpstream(url, ctx)));
  const upstreams = [];
  const errors = normalized.errors.slice();
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') upstreams.push(result.value);
    else errors.push({ url: normalized.urls[index], error: result.reason.message });
  });
  return { upstreams, errors };
}

function resourceEntries(manifest, name) {
  return (manifest.resources || []).filter((resource) => (typeof resource === 'string' ? resource : resource && resource.name) === name);
}

function resourceSupports(manifest, name, type, id = '') {
  return resourceEntries(manifest, name).some((resource) => {
    const declaration = typeof resource === 'string' ? {} : resource;
    const types = declaration.types || manifest.types || [];
    const prefixes = declaration.idPrefixes || manifest.idPrefixes || [];
    const typeOk = !types.length || types.includes(type);
    const prefixOk = !prefixes.length || prefixes.some((prefix) => String(id).startsWith(prefix));
    return typeOk && prefixOk;
  });
}

function manifestTypes(manifest) {
  const types = new Set(Array.isArray(manifest.types) ? manifest.types : []);
  for (const catalog of manifest.catalogs || []) if (catalog && catalog.type) types.add(catalog.type);
  for (const resource of manifest.resources || []) {
    if (resource && typeof resource === 'object') for (const type of resource.types || []) types.add(type);
  }
  return Array.from(types);
}

function configFields() {
  return [
    { key: 'nativeBadge', type: 'boolean', label: 'Nota ⭐ nativa en las tarjetas', default: true },
    { key: 'posterOverlay', type: 'boolean', label: 'Puntuaciones dibujadas sobre los pósters', default: true },
    {
      key: 'badge', type: 'select', label: 'Nota del badge de Stremio', default: 'combined',
      options: ['Combinada', 'IMDb', 'Rotten Tomatoes', 'Metacritic', 'FilmAffinity', 'TMDB'],
      optionsValues: ['combined', 'imdb', 'rt_tomatometer', 'mc_metascore', 'filmaffinity', 'tmdb'],
    },
  ];
}

async function wrappedManifest({ cfg, ctx, origin, basePath = '' }) {
  const { upstreams, errors } = await loadUpstreams(ctx);
  if (!upstreams.length) {
    const error = new Error(`no se pudo cargar ningún catálogo upstream: ${errors.map((entry) => entry.error).join(' | ') || 'configura UPSTREAM_MANIFEST_URLS'}`);
    error.code = 'bad_upstream';
    throw error;
  }

  const types = new Set();
  const idPrefixes = new Set();
  const metaTypes = new Set();
  const metaPrefixes = new Set();
  const catalogs = [];
  const catalogKeys = new Set();
  const names = [];
  let hasMeta = false;
  let metaAllIds = false;
  let allManifestIds = true;

  for (const upstream of upstreams) {
    const manifest = upstream.manifest;
    names.push(manifest.name || manifest.id);
    for (const type of manifestTypes(manifest)) types.add(type);
    if (Array.isArray(manifest.idPrefixes)) for (const prefix of manifest.idPrefixes) idPrefixes.add(prefix);
    else allManifestIds = false;

    for (const catalog of manifest.catalogs || []) {
      if (!catalog || !catalog.type || !catalog.id) continue;
      const key = `${catalog.type}/${catalog.id}`;
      // Dos addons pueden usar "movie/top": el primero manda y no duplicamos la fila.
      if (catalogKeys.has(key)) continue;
      catalogKeys.add(key);
      catalogs.push({ ...catalog });
      types.add(catalog.type);
    }

    for (const resource of resourceEntries(manifest, 'meta')) {
      hasMeta = true;
      const declaration = typeof resource === 'string' ? {} : resource;
      for (const type of declaration.types || manifest.types || []) metaTypes.add(type);
      const prefixes = declaration.idPrefixes || manifest.idPrefixes;
      if (!prefixes || !prefixes.length) metaAllIds = true;
      else for (const prefix of prefixes) metaPrefixes.add(prefix);
    }
  }

  if (!metaTypes.size) for (const type of types) metaTypes.add(type);
  const resources = [];
  if (catalogs.length) resources.push({ name: 'catalog', types: Array.from(types) });
  if (hasMeta) {
    const meta = { name: 'meta', types: Array.from(metaTypes.size ? metaTypes : types) };
    if (!metaAllIds && metaPrefixes.size) meta.idPrefixes = Array.from(metaPrefixes);
    resources.push(meta);
  }

  return {
    id: 'community.ratings.scraper',
    version: '2.0.0',
    name: cfg.addonName,
    description: `${cfg.addonDescription} Reemplaza: ${names.join(' · ')}. Sin catálogos top propios y sin streams.`,
    logo: `${origin}${basePath}/logo.svg`,
    background: `${origin}${basePath}/bg.svg`,
    contactLink: `${origin}${basePath}/api/health`,
    resources,
    types: Array.from(types.size ? types : ['movie', 'series']),
    ...(allManifestIds && idPrefixes.size ? { idPrefixes: Array.from(idPrefixes) } : {}),
    catalogs,
    config: configFields(),
    behaviorHints: { configurable: true, configurationRequired: false, adult: false },
  };
}

function upstreamResourceUrl(upstream, path, query = {}) {
  const manifest = new URL(upstream.url);
  const base = upstream.url.split('?')[0].replace(/manifest\.json$/i, '');
  const params = new URLSearchParams(manifest.search);
  for (const [key, value] of Object.entries(query || {})) {
    if (['cfg', 'config', 'debug'].includes(key) || value === undefined || value === null || value === '') continue;
    params.set(key, Array.isArray(value) ? value[value.length - 1] : String(value));
  }
  const search = params.toString();
  return `${base}${String(path).replace(/^\/+/, '')}${search ? `?${search}` : ''}`;
}

async function fetchUpstreamJson(upstream, path, query, ctx, { ttlMs = 5 * 60 * 1000 } = {}) {
  const url = upstreamResourceUrl(upstream, path, query);
  const key = `upstream:${url}`;
  const entry = await ctx.caches.upstream.wrap(key, async () => {
    const res = await ctx.http.getJson(url, {
      timeout: Math.min(ctx.cfg.timeoutMs || 4000, 5000),
      retries: 0,
      maxBytes: JSON_MAX_BYTES,
    }, { log: ctx.log });
    if (!res.ok || !res.json || typeof res.json !== 'object') {
      throw new Error(`${res.error || 'respuesta upstream inválida'} · ${upstream.manifest.name || upstream.manifest.id}`);
    }
    return res.json;
  }, { ttlMs });
  return entry.value;
}

function itemYear(meta) {
  return meta.year || yearFrom(meta.releaseInfo || meta.released || meta.name) || undefined;
}

function posterSource(meta) {
  if (meta.poster && /^https?:\/\//i.test(meta.poster)) return meta.poster;
  const id = meta.imdb_id || meta.id || '';
  if (/^tt\d{6,10}$/i.test(id)) return `https://images.metahub.space/poster/medium/${id}/img`;
  return '';
}

function posterUrlFor(meta, { cfg, origin, basePath = '' }) {
  if (!cfg.posterOverlay) return meta.poster;
  const src = posterSource(meta);
  if (!src || src.length > 1800) return meta.poster;
  try {
    assertPublicHttpUrl(src);
    const token = base64UrlEncode({
      v: 1,
      id: String(meta.id || meta.imdb_id || '').slice(0, 240),
      type: meta.type || 'movie',
      name: String(meta.name || '').slice(0, 240),
      year: itemYear(meta) || null,
      src,
    });
    return `${origin}${basePath}/poster/${token}.jpg`;
  } catch {
    return meta.poster;
  }
}

function ratingCacheKey(input, cfg) {
  return [
    'wrapped-rating-v2', cfg.sources.join(','), cfg.language, input.type || 'movie', input.id || '',
    String(input.title || '').slice(0, 160), input.year || '',
  ].join(':');
}

async function ratingsFor(item, cfg, ctx) {
  const input = {
    id: item.id || item.imdb_id || '',
    type: item.type || 'movie',
    title: item.name || item.title || '',
    year: itemYear(item),
  };
  const entry = await ctx.caches.ratings.wrap(ratingCacheKey(input, cfg), async () => {
    const work = await resolveWork(input, ctx);
    const collected = await collectRatings(work, ctx);
    return { work, collected };
  });
  const { work: resolvedWork, collected } = entry.value;
  const work = {
    ...resolvedWork,
    ...(collected.work || {}),
    ids: { ...(resolvedWork.ids || {}), ...((collected.work && collected.work.ids) || {}) },
  };
  const built = buildMeta({ work, rawMetrics: collected.metrics || {}, cfg });
  return { work, collected, built, cached: Boolean(entry.fromCache), stale: Boolean(entry.stale) };
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).catch(() => null),
    new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); }),
  ]).finally(() => clearTimeout(timer));
}

async function enrichCatalog(metas, options) {
  const { cfg, ctx } = options;
  const out = metas.map((meta) => ({ ...meta }));
  for (const meta of out) {
    const poster = posterUrlFor(meta, options);
    if (poster) meta.poster = poster;
  }
  if (!cfg.nativeBadge || cfg.catalogTimeBudgetMs <= 0) return out;

  const started = Date.now();
  const concurrency = Math.max(1, Math.min(12, cfg.catalogConcurrency || 6));
  for (let offset = 0; offset < out.length; offset += concurrency) {
    if (offset > 0 && Date.now() - started >= cfg.catalogTimeBudgetMs) break;
    const batch = out.slice(offset, offset + concurrency);
    await Promise.all(batch.map(async (meta) => {
      // Si ya trae IMDb y eso es exactamente lo elegido, no hace falta red.
      if (cfg.badgeMetric === 'imdb' && Number(meta.imdbRating) > 0) return;
      const remaining = Math.max(500, cfg.catalogTimeBudgetMs - (Date.now() - started));
      const timeout = Math.min(2800, remaining + 400);
      const rating = await withTimeout(ratingsFor(meta, cfg, ctx), timeout);
      const badge = rating && rating.built.meta.imdbRating;
      if (badge && Number(badge) >= 0 && Number(badge) <= 10) meta.imdbRating = String(badge);
    }));
  }
  return out;
}

function ratingDescription(rating, original, cfg, type) {
  if (!rating) return original;
  const lines = buildPanel(rating.built.metrics || {}, { cfg, type, quiet: true });
  if (rating.built.combined) lines.push(`⭐ Combinada ${rating.built.combined.value.toFixed(1)}/10`);
  if (!lines.length) return original;
  return `${original ? `${original}\n\n` : ''}— PUNTUACIONES —\n${lines.join('\n')}`.slice(0, 6000);
}

function mergeLinks(original, extra) {
  const out = [];
  const seen = new Set();
  for (const link of [...(original || []), ...(extra || [])]) {
    if (!link || !link.url) continue;
    const key = `${link.category || ''}:${link.name || ''}:${link.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(link);
  }
  return out;
}

async function enrichMeta(meta, options) {
  const { cfg, ctx } = options;
  const out = { ...meta };
  const poster = posterUrlFor(out, options);
  if (poster) out.poster = poster;
  if (!cfg.nativeBadge && !cfg.showPanel && !cfg.showLinks) return out;
  try {
    const rating = await ratingsFor(out, cfg, ctx);
    const badge = rating.built.meta.imdbRating;
    if (cfg.nativeBadge && badge) out.imdbRating = String(badge);
    if (cfg.showPanel) out.description = ratingDescription(rating, out.description || '', cfg, out.type);
    if (cfg.showLinks) out.links = mergeLinks(out.links, rating.built.meta.links);
  } catch (error) {
    ctx.log(`sin notas para ${out.id || out.name}: ${error.message}`);
  }
  return out;
}

async function handleCatalog({ path, type, id, query, cfg, ctx, origin, basePath }) {
  const { upstreams } = await loadUpstreams(ctx);
  const upstream = upstreams.find((entry) => (entry.manifest.catalogs || []).some((catalog) => catalog.type === type && catalog.id === id));
  if (!upstream) return null;
  try {
    const payload = await fetchUpstreamJson(upstream, path, query, ctx);
    const metas = Array.isArray(payload.metas) ? payload.metas.filter((meta) => meta && typeof meta === 'object') : [];
    const enriched = await enrichCatalog(metas, { cfg, ctx, origin, basePath });
    return { ...payload, metas: enriched };
  } catch (error) {
    return { metas: [], errors: [error.message] };
  }
}

async function handleMeta({ path, type, id, query, cfg, ctx, origin, basePath }) {
  const { upstreams } = await loadUpstreams(ctx);
  const candidates = upstreams.filter((entry) => resourceSupports(entry.manifest, 'meta', type, id));
  if (!candidates.length) return null;
  const errors = [];
  for (const upstream of candidates) {
    try {
      const payload = await fetchUpstreamJson(upstream, path, query, ctx, { ttlMs: 6 * 3600 * 1000 });
      if (!payload.meta) continue;
      const meta = await enrichMeta(payload.meta, { cfg, ctx, origin, basePath });
      return { ...payload, meta };
    } catch (error) {
      errors.push(error.message);
    }
  }
  return { meta: null, ...(errors.length ? { errors } : {}) };
}

async function handleAddonCatalog({ path, type, id, query, ctx }) {
  const { upstreams } = await loadUpstreams(ctx);
  const candidates = upstreams.filter((entry) => resourceEntries(entry.manifest, 'addon_catalog').length);
  if (!candidates.length) return null;
  for (const upstream of candidates) {
    try {
      return await fetchUpstreamJson(upstream, path, query, ctx, { ttlMs: 30 * 60 * 1000 });
    } catch {
      // prueba el siguiente upstream con el mismo recurso
    }
  }
  return { addons: [] };
}

function posterItemFromPath(path) {
  const match = String(path).match(/^\/poster\/([A-Za-z0-9_-]+)\.jpg$/);
  if (!match) return null;
  try {
    const value = JSON.parse(base64UrlDecode(match[1]));
    if (!value || typeof value !== 'object' || !value.src) return null;
    const source = assertPublicHttpUrl(value.src).toString();
    return {
      id: String(value.id || '').slice(0, 240),
      type: ['movie', 'series', 'anime'].includes(value.type) ? value.type : 'movie',
      name: String(value.name || '').slice(0, 240),
      year: value.year || undefined,
      poster: source,
      src: source,
    };
  } catch {
    return null;
  }
}

module.exports = {
  wrappedManifest,
  handleCatalog,
  handleMeta,
  handleAddonCatalog,
  enrichCatalog,
  enrichMeta,
  ratingsFor,
  posterUrlFor,
  posterItemFromPath,
  normalizeManifestUrl,
  normalizeUpstreams,
  assertPublicHttpUrl,
  isPrivateHostname,
  loadUpstreams,
  resourceSupports,
  upstreamResourceUrl,
};
