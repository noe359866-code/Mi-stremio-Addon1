'use strict';

/**
 * app.js — router sin framework: `runtime.handle({method, path, query})`.
 * Lo consumen el servidor de Node, la función de Netlify y el handler de Vercel,
 * así que la lógica HTTP vive en un solo sitio.
 *
 * Rutas Stremio:   /manifest.json · /catalog/{type}/{id}.json · /meta/{type}/{id}.json
 * Rutas extra:     /configure.html · /api/* · /logo.svg · /bg.svg
 * Prefijo opcional /c/{base64}/ con la config elegida por el usuario.
 */

const { load, applyUserConfig } = require('./config');
const { TTLCache } = require('./cache');
const realHttp = require('./http');
const { createMockHttp } = require('./mock');
const { resolveWork } = require('./resolve');
const { collectRatings } = require('./providers');
const { getCatalog, findCatalog } = require('./catalog');
const { logoSvg, backgroundSvg, VERSION } = require('./manifest');
const { configureHtml, indexHtml } = require('./configure');
const { buildMeta } = require('./format');
const { SOURCES } = require('./defs');
const { base64UrlDecode, safeJson, round1, mergeGaps, splitPath, parseQuery } = require('./util');
const { wrappedManifest, handleCatalog: wrappedCatalog, handleMeta: wrappedMeta, handleAddonCatalog, posterItemFromPath } = require('./wrapper');
const { generatePoster, posterCacheKey } = require('./poster');

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Cache-Control': 'public, max-age=60, stale-while-revalidate=3600',
};

class Runtime {
  constructor(env = process.env) {
    this.baseCfg = load(env);
    this.mock = Boolean(this.baseCfg.mock);
    this.http = this.mock ? createMockHttp() : realHttp;
    this.caches = {
      ratings: new TTLCache({ name: 'ratings', max: 3000, ttlMs: this.baseCfg.ttlRatingsMs }),
      charts: new TTLCache({ name: 'charts', max: 600, ttlMs: this.baseCfg.ttlChartsMs }),
      tmdb: new TTLCache({ name: 'tmdb', max: 3000, ttlMs: this.baseCfg.ttlTmdbMs }),
      upstream: new TTLCache({ name: 'upstream', max: 600, ttlMs: 30 * 60 * 1000 }),
      images: new TTLCache({ name: 'images', max: 250, ttlMs: this.baseCfg.ttlRatingsMs }),
    };
    this.throttle = this.mock ? null : new realHttp.DomainThrottle({ perHostMs: this.baseCfg.perHostMs });
    this.startedAt = Date.now();
    this.requests = 0;
    this.log = this.baseCfg.verbose ? (...args) => console.log('[ratings]', ...args) : () => {};
  }

  ctxFor(cfg) {
    return { cfg, http: this.http, caches: this.caches, log: this.log, politeness: this.throttle || undefined };
  }

  /**
   * @param {{method:string,url:string,path:string,query:object,headers:object}} request
   */
  async handle(request) {
    this.requests += 1;
    const method = (request.method || 'GET').toUpperCase();
    if (method === 'OPTIONS') {
      return respond(204, '', { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,OPTIONS', 'Access-Control-Allow-Headers': '*' });
    }
    if (method !== 'GET' && method !== 'HEAD') return json(405, { error: 'solo GET' });

    let path = request.path || splitPath(request.url) || '/';
    path = path.replace(/\/{2,}/g, '/'); // "//x" no es un path válido, pero puede llegar de un proxy
    let cfg = this.baseCfg;
    let basePath = '';

    // Formas de pasar la configuración (todas generadas por esta propia app o por
    // el UI de configuración nativa de Stremio a partir de manifest.config):
    //   /c/<base64url(json)>/manifest.json                       <- nuestro /configure.html
    //   /<encodeURIComponent(json)>/manifest.json               <- formato del SDK oficial
    //   <prefijo-funcion>/c/<token>/...                          <- si va tras /.netlify/functions/ratings
    //   ?cfg=<token> | ?config=<json>                            <- prueba rápida
    // El prefijo se conserva en basePath para que logo/enlaces del manifiesto resuelvan.
    const segments = path.split('/').filter(Boolean);
    let consumed = 0;
    let token = null;
    if (segments[0] === 'c' && segments.length > 1) {
      token = segments[1];
      consumed = 2;
    } else if (segments.length > 1 && /^({|%7b)/i.test(segments[0])) {
      token = segments[0];
      consumed = 1;
    }
    if (token !== null) {
      const decoded = decodeConfigToken(token);
      if (decoded) {
        cfg = applyUserConfig(this.baseCfg, decoded);
        basePath = '/' + segments.slice(0, consumed).join('/');
        path = (consumed < segments.length ? '/' + segments.slice(consumed).join('/') : '/');
      } else {
        consumed = 0;
      }
    }
    if (!consumed && request.query) {
      const fromQuery = request.query.cfg || request.query.config;
      const decoded = fromQuery ? decodeConfigToken(String(fromQuery)) : null;
      if (decoded) cfg = applyUserConfig(this.baseCfg, decoded);
    }

    const query = { ...parseQuery(request.url), ...(request.query || {}) };
    // PUBLIC_URL manda sobre lo que digan las headers (detrás de un proxy suelen mentir)
    const origin = cfg.publicUrl ? deriveOrigin(request, cfg) : request.origin || deriveOrigin(request, cfg);
    const ctx = this.ctxFor(cfg);

    try {
      return await this.route({ path, query, cfg, ctx, origin, basePath });
    } catch (error) {
      this.log(`error en ${path}: ${error.message}`);
      const status = error.code === 'bad_request' ? 400 : error.code === 'not_found' ? 404 : 502;
      if (/^\/(catalog|meta)\//.test(path)) {
        // Stremio prefiere una respuesta vacía antes que un error duro
        return json(200, path.startsWith('/catalog') ? { metas: [], errors: [error.message] } : { meta: null, errors: [error.message] });
      }
      return json(status, { error: error.message, code: error.code || 'error', attempts: error.attempts });
    }
  }

  async route({ path, query, cfg, ctx, origin, basePath }) {
    if (path === '/' || path === '/index.html') return html(200, indexHtml({ cfg, origin, basePath }));
    if (path === '/configure' || path === '/configure.html') {
      let catalogs = [];
      try {
        catalogs = (await wrappedManifest({ cfg, ctx, origin, basePath })).catalogs;
      } catch (error) {
        this.log(`config sin upstream: ${error.message}`);
      }
      return html(200, configureHtml({ cfg, origin, basePath, catalogs }));
    }
    if (path === '/logo.svg') return respond(200, logoSvg(), { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
    if (path === '/bg.svg') return respond(200, backgroundSvg(), { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
    if (path === '/favicon.ico') return respond(200, logoSvg(), { 'Content-Type': 'image/svg+xml; charset=utf-8' });
    if (path === '/manifest.json') return json(200, await wrappedManifest({ cfg, ctx, origin, basePath }));

    const posterItem = posterItemFromPath(path);
    if (posterItem) {
      try {
        const entry = await this.caches.images.wrap(posterCacheKey(posterItem, cfg), () => generatePoster(posterItem, { cfg, ctx }));
        const image = entry.value;
        return respond(200, image.body, {
          'Content-Type': image.contentType,
          'Content-Length': String(image.body.length),
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800, stale-if-error=2592000',
          'X-Rating-Poster': image.generated ? 'generated' : 'original',
        });
      } catch (error) {
        // La imagen original es mejor que un póster roto si una fuente o sharp falla.
        return respond(302, '', { Location: posterItem.src, 'Cache-Control': 'no-cache' });
      }
    }

    if (path === '/api/health') {
      return json(200, {
        ok: true,
        version: VERSION,
        mock: this.mock,
        uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
        requests: this.requests,
        sources: cfg.sources,
        wrapper: { upstreams: cfg.upstreams, nativeBadge: cfg.nativeBadge, posterOverlay: cfg.posterOverlay, ownCatalogs: false },
        keys: { tmdb: Boolean(cfg.tmdbApiKey || cfg.tmdbToken), omdb: Boolean(cfg.omdbApiKey), metacritic: Boolean(cfg.metacriticApiKey) },
        caches: Object.fromEntries(Object.entries(this.caches).map(([key, cache]) => [key, cache.stats()])),
      });
    }
    if (path === '/api/sources') {
      return json(200, {
        sources: cfg.sources.map((id) => ({ id, ...SOURCES[id], enabled: true })),
        all: Object.keys(SOURCES).map((id) => ({ id, ...SOURCES[id] })),
        weights: cfg.weights,
        badge: cfg.badgeMetric,
      });
    }
    if (path === '/api/catalogs') {
      const manifest = await wrappedManifest({ cfg, ctx, origin, basePath });
      return json(200, { catalogs: manifest.catalogs, ownCatalogs: false });
    }

    let match = path.match(/^\/catalog\/([^/]+)\/([^/]+?)(?:\.json)?(?:$|\/)/);
    if (match) {
      const [, type, id] = match;
      const wrapped = await wrappedCatalog({ path, type, id, query, cfg, ctx, origin, basePath });
      if (wrapped) return json(200, wrapped);

      // Rutas legacy de las primeras versiones: siguen respondiendo si alguien las
      // tenía guardadas, pero YA NO se anuncian en manifest.json.
      const extras = parseExtras(path.slice(match[0].length));
      const result = await getCatalog({
        type,
        id,
        search: query.search || extras.search || query.q || undefined,
        skip: Number(extras.skip !== undefined ? extras.skip : (query.skip || 0)),
        limit: Number(query.limit || cfg.catalogLimit),
        genre: extras.genre && extras.genre !== 'none' ? extras.genre : undefined,
        cfg,
        ctx,
      });
      const payload = { metas: result.metas };
      if (query.debug === '1' || cfg.verbose) payload.diagnostics = result.diagnostics;
      return jsonCached(200, payload, cfg.cacheTtlHours);
    }

    match = path.match(/^\/meta\/([^/]+)\/(.+?)(?:\.json)?$/);
    if (match) {
      const [, type, rawId] = match;
      if (rawId === 'search' || rawId.startsWith('search/')) return json(200, { metas: [] });
      const wrapped = await wrappedMeta({ path, type, id: rawId, query, cfg, ctx, origin, basePath });
      if (wrapped) {
        if (query.debug === '1' || cfg.verbose) wrapped.diagnostics = { wrapped: true, upstream: true };
        return jsonCached(200, wrapped, cfg.cacheTtlHours);
      }
      const { metas, diagnostics } = await this.resolveMeta({ type, id: rawId, cfg, ctx, origin, basePath });
      const payload = { meta: metas[0] || null };
      if (diagnostics && (query.debug === '1' || cfg.verbose)) payload.diagnostics = diagnostics;
      if (!payload.meta) payload.meta = null;
      return jsonCached(200, payload, cfg.cacheTtlHours);
    }

    match = path.match(/^\/addon_catalog\/([^/]+)\/(.+?)(?:\.json)?$/);
    if (match) {
      const [, type, rawId] = match;
      const wrapped = await handleAddonCatalog({ path, type, id: rawId, query, ctx });
      if (wrapped) return json(200, wrapped);
      return json(200, { addons: [] });
    }

    if (path === '/api/ratings' || path.startsWith('/api/ratings/')) {
      const idFromPath = path.length > '/api/ratings'.length ? decodeURIComponent(path.slice('/api/ratings/'.length)) : '';
      const input = {
        id: idFromPath || query.id || query.imdb_id || '',
        type: query.type || 'movie',
        title: query.title || query.q || '',
        year: query.year,
        url: query.url,
      };
      const started = Date.now();
      const work = await resolveWork(input, ctx);
      const cacheKey = `rate:${cfg.sources.join(',')}:${cfg.badgeMetric}:${work.ids.imdb || work.ids.tmdb || work.title}:${work.year || ''}:${work.type}`;
      let cached = null;
      try {
        cached = await this.caches.ratings.wrap(cacheKey, async () => {
          const collected = await collectRatings(work, ctx);
          if (!Object.keys(collected.metrics).length) {
            const error = new Error('ninguna fuente devolvió puntuación');
            error.code = 'not_found';
            error.statuses = collected.statuses;
            error.resolved = collected.resolved;
            throw error;
          }
          return collected;
        });
      } catch (error) {
        return json(502, {
          error: error.message,
          code: error.code || 'scrape_failed',
          work: { title: work.title, year: work.year, type: work.type, ids: work.ids },
          hint: 'Revisa /api/health y añade TMDB_API_KEY / OMDB_API_KEY, o arranca en modo demo (RATINGS_MOCK=1).',
        });
      }
      const collected = cached.value;
      const enrichedWork = applyResolved(work, collected.resolved);
      const { meta, combined, metrics } = buildMeta({ work: enrichedWork, rawMetrics: collected.metrics, cfg });
      return json(200, {
        ok: true,
        mock: this.mock,
        ms: Date.now() - started,
        cached: Boolean(cached.fromCache),
        stale: Boolean(cached.stale),
        query: { title: enrichedWork.title, originalTitle: enrichedWork.originalTitle, year: enrichedWork.year, type: enrichedWork.type, ids: enrichedWork.ids, resolvedVia: enrichedWork.resolvedVia },
        scores: Object.fromEntries(
          Object.entries(metrics).map(([key, value]) => [
            key,
            { value: round1(value.raw), scale: value.scale, votes: value.votes, text: value.text, url: value.url, rank: value.rank },
          ])
        ),
        combined: combined ? { value: combined.value, verdict: combined.verdict, used: combined.used } : null,
        sources: collected.statuses.filter((status) => !status.skipped),
        skipped: collected.statuses.filter((status) => status.skipped).map((status) => status.source),
        stremio: { id: meta.id, type: meta.type, name: meta.name, imdbRating: meta.imdbRating, description: meta.description },
        stremioId: meta.id,
        manifestPath: `${basePath || ''}/manifest.json`,
      });
    }

    if (path === '/api/search') {
      const search = String(query.q || query.title || '');
      if (!search) return json(400, { error: 'falta ?q=' });
      const { searchWork } = require('./providers/tmdb');
      const kinds = query.type ? [query.type] : ['movie', 'series'];
      const results = await Promise.all(
        kinds.map(async (type) => {
          try {
            const found = await searchWork({ title: search, year: query.year, type }, ctx);
            return found ? [{ ...found, type: found.mediaType === 'movie' ? 'movie' : 'series', score: found.voteAverage }] : [];
          } catch {
            return [];
          }
        })
      );
      return json(200, { query: search, results: results.flat().filter(Boolean) });
    }

    if (path === '/api/chart') {
      const type = query.type || 'movie';
      const id = query.id;
      if (!id) return json(400, { error: 'falta ?id= de catálogo' });
      const wrapped = await wrappedCatalog({ path: `/catalog/${type}/${id}.json`, type, id, query, cfg, ctx, origin, basePath });
      if (wrapped) return json(200, { type, id, metas: wrapped.metas || [], errors: wrapped.errors, diagnostics: { wrapped: true } });
      const result = await getCatalog({ type, id, cfg, ctx, search: query.search, limit: Number(query.limit || 30) });
      return json(200, { type, id, ...result });
    }

    const error = new Error(`ruta no encontrada: ${path}`);
    error.code = 'not_found';
    error.routes = ['/manifest.json', '/configure.html', '/catalog/{type}/{id}.json', '/meta/{type}/{id}.json', '/api/ratings', '/api/health'];
    return json(404, { error: error.message, routes: error.routes, wrapper: { ownCatalogs: false, upstreams: cfg.upstreams } });
  }

  /** Ficha completa: resolver + scrapear (con caché) + dar forma a meta de Stremio. */
  async resolveMeta({ type, id, cfg, ctx, origin, basePath }) {
    const work = await resolveWork({ id, type }, ctx);
    const cacheKey = `rate:${cfg.sources.join(',')}:${cfg.badgeMetric}:${cfg.showPanel ? 'p' : ''}${cfg.showUnavailable ? 'u' : ''}${cfg.showLinks ? 'l' : ''}:${work.ids.imdb || work.ids.tmdb || work.ids.rtSlug || work.ids.mcSlug || work.ids.faUrl || work.title}:${work.year || ''}:${work.type}`;
    let payload;
    try {
      payload = await this.caches.ratings.wrap(cacheKey, async () => {
        const collected = await collectRatings(work, ctx);
        if (!Object.keys(collected.metrics).length) {
          const error = new Error('sin puntuaciones');
          error.code = 'not_found';
          error.collected = collected;
          throw error;
        }
        return collected;
      });
    } catch (error) {
      const collected = error.collected;
      if (!collected) return { metas: [], diagnostics: { error: error.message, code: error.code } };
      // sin métricas sólo devolvemos una ficha "vacía" si al menos sabemos
      // cómo se llama el contenido; si no, mejor meta:null (y Stremio usa Cinemeta)
      const enriched = applyResolved(work, collected.resolved);
      const label = (enriched.title || enriched.originalTitle || '').trim();
      if (!label || label === id) {
        return { metas: [], diagnostics: { error: 'sin datos para ' + id, statuses: collected.statuses } };
      }
      const built = buildMeta({ work: enriched, rawMetrics: {}, cfg });
      return { metas: [{ ...built.meta, id, type }], diagnostics: { statuses: collected.statuses, empty: true } };
    }
    const collected = payload.value;
    const enrichedWork = applyResolved(work, collected.resolved);
    const built = buildMeta({ work: enrichedWork, rawMetrics: collected.metrics, cfg, catalogId: undefined });
    const meta = { ...built.meta, id, type };
    if (!meta.name || meta.name === id) meta.name = work.title || enrichedWork.title || id;
    return {
      metas: [meta],
      diagnostics: {
        sources: collected.statuses.filter((status) => !status.skipped),
        skipped: collected.statuses.filter((status) => status.skipped).map((status) => status.source),
        coverage: collected.coverage,
        combined: built.combined ? built.combined.value : null,
        cached: Boolean(payload.fromCache),
        stale: Boolean(payload.stale),
        origin,
        basePath,
      },
    };
  }
}

/** Aplica los datos que los scrapers descubrieron (año, póster, ids) sin pisar lo conocido. */
function applyResolved(work, resolved = {}) {
  const merged = mergeGaps(work, mapResolved(resolved));
  merged.ids = mergeGaps({ ...(work.ids || {}) }, {
    imdb: resolved.imdbId || null,
    tmdb: resolved.tmdbId ? String(resolved.tmdbId) : null,
    rtSlug: resolved.rtSlug || null,
    mcSlug: resolved.mcSlug || null,
    faId: resolved.faId || null,
    faUrl: resolved.faUrl || null,
    anilist: resolved.anilistId || null,
    mal: resolved.malId || null,
  });
  if (resolved.mediaType && !merged.mediaType) merged.mediaType = resolved.mediaType;
  return merged;
}

/** Los scrapers descubren datos (año, póster, título): sólo rellenan huecos. */
/** `req.url` puede empezar con `//` (protocol-relative): nada de usar new URL() a ciegas. */
function mapResolved(resolved = {}) {
  const out = {};
  if (resolved.title) out.title = resolved.title;
  if (resolved.originalTitle) out.originalTitle = resolved.originalTitle;
  if (resolved.year) out.year = resolved.year;
  if (resolved.poster) out.poster = resolved.poster;
  if (resolved.background) out.background = resolved.background;
  if (resolved.overview) out.overview = resolved.overview;
  if (resolved.genres) out.genres = resolved.genres;
  return out;
}

/** Decodifica el token de configuración: JSON crudo (formato del SDK) o base64url. */
function decodeConfigToken(token) {
  if (!token) return null;
  const raw = String(token);
  const candidates = [];
  try { candidates.push(JSON.parse(decodeURIComponent(raw))); } catch (error) { void error; }
  try { candidates.push(JSON.parse(Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))); } catch (error) { void error; }
  return candidates.find((value) => value && typeof value === 'object' && !Array.isArray(value)) || null;
}

function safeDecode(value) {
  try { return decodeURIComponent(String(value)); } catch { return String(value); }
}

/**
 * Stremio manda los extras del catálogo como segmento de ruta:
 * /catalog/movie/top/extra=1&search=foo.json  |  /catalog/movie/top/60.json (skip)
 */
function parseExtras(tail) {
  const out = {};
  if (!tail) return out;
  for (const part of tail.replace(/\.json$/, '').split('/')) {
    const decoded = safeDecode(part);
    if (!decoded) continue;
    if (/^\d+$/.test(decoded)) { out.skip = decoded; continue; }
    for (const pair of decoded.split('&')) {
      const index = pair.indexOf('=');
      if (index > 0) out[pair.slice(0, index).trim()] = safeDecode(pair.slice(index + 1));
    }
  }
  return out;
}

function deriveOrigin(request, cfg) {
  if (cfg.publicUrl) return cfg.publicUrl.replace(/\/$/, '');
  const host = (request.headers && (request.headers['x-forwarded-host'] || request.headers.host)) || 'localhost:7000';
  const proto = (request.headers && (request.headers['x-forwarded-proto'] || request.headers['x-forwarded-protocol'])) || (/^(localhost|127\.)/.test(String(host).split(':')[0]) ? 'http' : 'https');
  return `${proto}://${host}`;
}

function respond(status, body, headers = {}) {
  return { statusCode: status, status, headers, body: body === undefined ? '' : body };
}
function jsonCached(status, payload, ttlHours = 24) {
  const maxAge = Math.max(60, Math.round(Number(ttlHours) * 3600 || 86400));
  return respond(status, JSON.stringify(payload), {
    ...JSON_HEADERS,
    'Cache-Control': `public, max-age=${Math.min(maxAge, 86400)}, stale-while-revalidate=86400, stale-if-error=604800`,
  });
}

function json(status, payload) {
  return respond(status, JSON.stringify(payload, null, 0), JSON_HEADERS);
}
function html(status, body) {
  return respond(status, body, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
}

module.exports = { Runtime, respond, json, html, findCatalog, splitPath, parseQuery };
