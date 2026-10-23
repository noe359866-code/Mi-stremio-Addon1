'use strict';

/**
 * catalog.js — listas de "lo mejor según…" que aparecen en Discover de Stremio.
 * Cada catálogo declara qué fuente lo genera; los items llevan la nota en el
 * badge (campo imdbRating) y el desglose en la descripción.
 */

const { collectCatalog, collectRatings } = require('./providers');
const { buildCatalogItem } = require('./format');
const { round1, clamp } = require('./util');

/** id de catálogo -> {provider, list}. El `id` va en la URL de Stremio. */
const CATALOGS = [
  { type: 'movie', id: 'imdb-top', name: '⭐ IMDb · Top 250', provider: 'imdb', list: 'top250', icon: '⭐' },
  { type: 'movie', id: 'rt-top', name: '🍅 Rotten Tomatoes · Top crítica', provider: 'rottentomatoes', list: 'top', icon: '🍅' },
  { type: 'movie', id: 'mc-top', name: '🎯 Metacritic · Metascore', provider: 'metacritic', list: 'top', icon: '🎯' },
  { type: 'movie', id: 'fa-top', name: '🎞️ FilmAffinity · Top 200', provider: 'filmaffinity', list: 'top', icon: '🎞️' },
  { type: 'movie', id: 'tmdb-top', name: '🎬 TMDB · Más valoradas', provider: 'tmdb', list: 'top', icon: '🎬' },
  { type: 'movie', id: 'tmdb-es', name: '🇪🇸 TMDB · Top en español', provider: 'tmdb', list: 'spanish', icon: '🇪🇸' },
  { type: 'movie', id: 'tmdb-doc', name: '📹 TMDB · Documentales', provider: 'tmdb', list: 'documentary', icon: '📹' },
  { type: 'movie', id: 'tmdb-bad', name: '💀 TMDB · Las peor puntuadas', provider: 'tmdb', list: 'low-rated', icon: '💀' },
  { type: 'series', id: 'imdb-top', name: '⭐ IMDb · Top 250 series', provider: 'imdb', list: 'toptv', icon: '⭐' },
  { type: 'series', id: 'rt-top', name: '🍅 Rotten Tomatoes · Top series', provider: 'rottentomatoes', list: 'top', icon: '🍅' },
  { type: 'series', id: 'mc-top', name: '🎯 Metacritic · Top series', provider: 'metacritic', list: 'top', icon: '🎯' },
  { type: 'series', id: 'fa-top', name: '🎞️ FilmAffinity · Top series', provider: 'filmaffinity', list: 'top', icon: '🎞️' },
  { type: 'series', id: 'tmdb-top', name: '🎬 TMDB · Series más valoradas', provider: 'tmdb', list: 'top', icon: '🎬' },
  { type: 'series', id: 'tmdb-es', name: '🇪🇸 TMDB · Series en español', provider: 'tmdb', list: 'spanish', icon: '🇪🇸' },
  { type: 'anime', id: 'tmdb-top', name: '🌸 Anime · Top TMDB (sub/jp)', provider: 'tmdb', list: 'anime', icon: '🌸' },
  { type: 'anime', id: 'tmdb-all', name: '🌸 Anime · Top (sin idioma)', provider: 'tmdb', list: 'anime-all', icon: '🌸' },
  { type: 'anime', id: 'imdb-top', name: '🌸 Anime · Top IMDb', provider: 'imdb', list: 'anime', icon: '⭐' },
  { type: 'anime', id: 'fa-top', name: '🌸 Anime · Top FilmAffinity', provider: 'filmaffinity', list: 'anime', icon: '🎞️' },
];

function findCatalog(type, id) {
  return CATALOGS.find((catalog) => catalog.type === type && catalog.id === id) || null;
}

function catalogsFor(cfg) {
  const enabled = new Set(cfg.sources || []);
  return CATALOGS.filter((catalog) => enabled.size === 0 || enabled.has(catalog.provider));
}

/** Cada fuente publica en escalas distintas: todo a 0-10 para filtrar/ordenar. */
function scoreToTen(item) {
  if (item.score === null || item.score === undefined) return null;
  const raw = Number(item.score);
  if (!Number.isFinite(raw)) return null;
  if (item.source === 'rottentomatoes' || item.source === 'metacritic') return clamp(round1(raw / 10), 0, 10);
  return clamp(round1(raw), 0, 10);
}

async function getCatalog({ type, id, search, skip, limit, cfg, ctx }) {
  const definition = findCatalog(type, id);
  if (!definition) {
    const error = new Error(`catálogo desconocido: ${type}/${id}`);
    error.code = 'not_found';
    error.valid = CATALOGS.filter((catalog) => catalog.type === type).map((catalog) => catalog.id);
    throw error;
  }
  const size = clamp(Number(limit || cfg.catalogLimit || 50), 5, 100);
  const offset = clamp(Number(skip || 0), 0, 1000);
  const cacheKey = `chart:${type}:${definition.provider}:${definition.list}:${search || ''}:${offset}:${size}:${cfg.includeAdult ? 'a' : 'n'}`;

  const fetchItems = async () => {
    const result = await collectCatalog(
      { type, provider: definition.provider, list: definition.list, limit: size + offset, search: search || undefined, minScore: definition.provider === 'rottentomatoes' ? Math.round(clamp(cfg.minScore, 0, 10) * 10) : undefined },
      ctx
    );
    return { items: result.items, ms: result.ms };
  };

  let payload;
  try {
    payload = await ctx.caches.charts.wrap(cacheKey, fetchItems, { ttlMs: cfg.ttlChartsMs });
  } catch (error) {
    const wrapped = new Error(error.message || 'catálogo no disponible');
    wrapped.code = error.code || 'unavailable';
    wrapped.provider = definition.provider;
    throw wrapped;
  }

  let items = (payload.value?.items || []).slice(offset, offset + size);
  const diagnostics = {
    provider: definition.provider,
    list: definition.list,
    returned: items.length,
    ms: payload.value?.ms ?? null,
    fromCache: Boolean(payload.fromCache),
    stale: Boolean(payload.stale),
  };

  // filtro por nota mínima/máxima configurada (0-10)
  if (cfg.minScore > 0 || cfg.maxScore < 10) {
    items = items.filter((item) => {
      const score = scoreToTen(item);
      if (score === null) return true;
      return score >= clamp(cfg.minScore, 0, 10) && score <= clamp(cfg.maxScore, 0, 10);
    });
  }

  // normalizamos la nota de cada fuente a 0-10 antes de dar forma al item
  items = items.map((item) => {
    const score10 = scoreToTen(item);
    return score10 === null ? item : { ...item, score10 };
  });

  let metas = [];
  if (cfg.enrichSearch && search) {
    // en búsquedas sí mere la pena ir a por las 5 fuentes (son pocos resultados)
    const enriched = await Promise.all(
      items.slice(0, 8).map(async (item) => {
        try {
          const { resolveWork } = require('./resolve');
          const input = { title: item.title, year: item.year, type, url: item.url };
          if (item.imdbId) input.id = item.imdbId;
          else if (item.id && /^tmdb:\d+$/.test(item.id)) input.id = item.id;
          else if (item.id && /^fa:\d+$/.test(item.id)) input.id = item.id;
          const work = await resolveWork(input, ctx);
          const ratings = await collectRatings(work, ctx);
          return { item, metrics: ratings.metrics };
        } catch {
          return { item, metrics: null };
        }
      })
    );
    metas = enriched.map((entry) => buildCatalogItem(entry.item, { cfg, type, metrics: entry.metrics || undefined }));
  } else {
    metas = items.map((item) => buildCatalogItem(item, { cfg, type }));
  }

  return { metas: metas.filter((meta) => meta && meta.name), diagnostics, items };
}

module.exports = { CATALOGS, findCatalog, catalogsFor, getCatalog, scoreToTen };
