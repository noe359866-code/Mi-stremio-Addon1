'use strict';

/**
 * providers/tmdb.js — TMDB (API oficial v3/v4).
 *
 * TMDB hace dos papeles:
 *   1) fuente de puntuación (vote_average / vote_count, y el rating de IMDb
 *      que expone en /rating),
 *   2) RESOLVER: convierte el id de Stremio (tt… o tmdb:…) en título, año,
 *      tipo, póster y `external_ids` (imdb_id) que necesitan las demás fuentes.
 */

const BASE = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p';

const GENRES = {
  movie: { animation: 16 },
  tv: { animation: 16 },
};

function authHeaders(ctx) {
  const { cfg } = ctx;
  if (cfg.tmdbToken) return { Authorization: `Bearer ${cfg.tmdbToken}` };
  return {};
}

function withAuth(url, ctx, params = {}) {
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    parsed.searchParams.set(key, String(value));
  }
  if (!ctx.cfg.tmdbToken && ctx.cfg.tmdbApiKey) parsed.searchParams.set('api_key', ctx.cfg.tmdbApiKey);
  return parsed.toString();
}

async function api(path, ctx, { params = {}, cacheTtl, raw = false } = {}) {
  const { cfg, http, caches, log } = ctx;
  if (!cfg.tmdbApiKey && !cfg.tmdbToken) {
    const error = new Error('sin TMDB_API_KEY');
    error.code = 'no_key';
    throw error;
  }
  const url = withAuth(`${BASE}${path}`, ctx, { language: cfg.language, ...params });
  const cacheKey = `tmdb:${url}`;
  const run = async () => {
    const res = await http.getJson(url, { headers: authHeaders(ctx), timeout: cfg.timeoutMs }, { log, cache: caches.http });
    if (!res.ok) {
      const error = new Error(res.error || `tmdb_http_${res.status}`);
      error.status = res.status;
      error.blocked = res.blocked;
      throw error;
    }
    return res.json;
  };
  const result = await caches.tmdb.wrap(cacheKey, run, { ttlMs: cacheTtl || cfg.ttlTmdbMs });
  return raw ? result.value : result.value;
}

function mediaTypeFor(type) {
  if (type === 'movie') return 'movie';
  return 'tv'; // series y anime (el anime de Stremio es tv + género animación + jp)
}

function mapTmdbItem(item, mediaType) {
  if (!item) return null;
  const date = mediaType === 'movie' ? item.release_date : item.first_air_date;
  return {
    tmdbId: item.id,
    mediaType,
    type: mediaType === 'movie' ? 'movie' : 'series',
    title: item.title || item.name || null,
    originalTitle: item.original_title || item.original_name || null,
    year: date ? Number(String(date).slice(0, 4)) : null,
    overview: item.overview || null,
    poster: item.poster_path ? `${IMAGE_BASE}/w500${item.poster_path}` : null,
    background: item.backdrop_path ? `${IMAGE_BASE}/w1280${item.backdrop_path}` : null,
    voteAverage: item.vote_average,
    voteCount: item.vote_count,
    genres: (item.genres || []).map((g) => g.name),
    imdbId: item.external_ids?.imdb_id || item.imdb_id || null,
    runtime: item.runtime || (item.episode_run_time && item.episode_run_time[0]) || null,
    trailer: null,
  };
}

/** Búsqueda por título (+año) en movie y tv, devolviendo el mejor candidato. */
async function searchWork({ title, year, type }, ctx) {
  const mediaType = mediaTypeFor(type);
  const params = { query: title, include_adult: 'false', page: 1 };
  if (year) {
    if (mediaType === 'movie') params.year = year;
    else params.first_air_date_year = year;
  }
  const json = await api(`/search/${mediaType}`, ctx, { params, cacheTtl: 6 * 3600 * 1000 });
  const results = (json && json.results) || [];
  const { bestTitleSimilarity } = require('../match');
  const scored = results
    .slice(0, 20)
    .map((item) => {
      const name = item.title || item.name || '';
      const original = item.original_title || item.original_name || '';
      const similarity = bestTitleSimilarity(name, [title, original]);
      const itemYear = Number(String(mediaType === 'movie' ? item.release_date || '' : item.first_air_date || '').slice(0, 4)) || null;
      const yearBonus = year && itemYear === year ? 0.6 : year && itemYear && Math.abs(itemYear - year) > 1 ? -0.5 : 0;
      return { item, similarity, year: itemYear, score: similarity + yearBonus + Math.min(0.35, (item.vote_count || 0) / 20000) };
    })
    .sort((a, b) => b.score - a.score);
  // nunca devolver ratings de un título mal emparejado: si la similitud no es
  // decente (o no cuadra el año), mejor no hay match
  const best = scored.find(
    (entry) => entry.similarity >= 0.55 || (entry.similarity >= 0.4 && year && entry.year === year) || (year && entry.year === year && entry.similarity >= 0.34)
  );
  if (!best) return null;
  const mapped = mapTmdbItem(best.item, mediaType);
  mapped.matchScore = Math.round(best.score * 100) / 100;
  return mapped;
}

/** Ficha completa con external_ids (para sacar imdb_id) y ratings. */
async function details(tmdbId, mediaType, ctx) {
  const json = await api(`/${mediaType}/${tmdbId}`, ctx, {
    params: { append_to_response: 'external_ids,ratings' },
    cacheTtl: 12 * 3600 * 1000,
  });
  const mapped = mapTmdbItem(json, mediaType);
  if (mapped) {
    if (json.ratings && (json.ratings.imdb_rating || json.ratings.aggregate_rating)) {
      mapped.imdbRatingFromTmdb = json.ratings.imdb_rating?.value ?? json.ratings.aggregate_rating?.value ?? null;
      mapped.imdbVotesFromTmdb = json.ratings.imdb_rating?.vote_count ?? null;
    }
    if (json.number_of_seasons) mapped.seasons = json.number_of_seasons;
    if (json.last_air_date) mapped.lastAirYear = Number(String(json.last_air_date).slice(0, 4));
  }
  return mapped;
}

/** find/<imdbId> -> ficha TMDB (el camino habitual en Stremio, que usa IDs tt). */
async function findByImdb(imdbId, ctx) {
  const json = await api(`/find/${imdbId}`, ctx, { params: { external_source: 'imdb_id' }, cacheTtl: 12 * 3600 * 1000 });
  const movie = json && json.movie_results && json.movie_results[0];
  const tv = json && json.tv_results && json.tv_results[0];
  if (movie) return mapTmdbItem(movie, 'movie');
  if (tv) return mapTmdbItem(tv, 'tv');
  return null;
}

/** Catálogos "top" fiables (orden por vote_average con mínimo de votos). */
async function discover({ mediaType, sort = 'vote_average.desc', voteCountGte = 400, withGenres, withOriginalLanguage, limit = 40, page = 1, search }, ctx) {
  if (search) return searchWork({ title: search, type: mediaType === 'movie' ? 'movie' : 'series' }, ctx).then((best) => (best ? [best] : []));
  const params = {
    sort_by: sort,
    'vote_count.gte': voteCountGte,
    include_adult: ctx.cfg.includeAdult ? 'true' : 'false',
    page,
  };
  if (withGenres) params.with_genres = withGenres;
  if (withOriginalLanguage) params.with_original_language = withOriginalLanguage;
  const json = await api(`/discover/${mediaType}`, ctx, { params: { ...params, with_original_language: withOriginalLanguage, with_genres: params.with_genres }, cacheTtl: 6 * 3600 * 1000 });
  const results = ((json && json.results) || []).slice(0, limit).map((item) => mapTmdbItem(item, mediaType));
  return results.filter(Boolean);
}

const provider = {
  id: 'tmdb',
  label: 'TMDB',
  requiresKey: true,

  async lookup(work, ctx) {
    let base = work;
    if (!base.tmdbId && work.ids && work.ids.imdb) {
      const found = await findByImdb(work.ids.imdb, ctx);
      if (found) base = { ...base, ...found, ids: { ...(base.ids || {}), tmdb: found.tmdbId } };
    }
    if (!base.tmdbId) {
      const found = await searchWork({ title: work.title, year: work.year, type: work.type }, ctx);
      if (found) base = { ...base, ...found, ids: { ...(base.ids || {}), tmdb: found.tmdbId } };
    }
    if (!base.tmdbId) return { metrics: {}, note: 'título no encontrado en TMDB' };

    let full = base;
    if (!base.imdbId || base.voteAverage === undefined) {
      const detailed = await details(base.tmdbId, base.mediaType || mediaTypeFor(base.type), ctx);
      if (detailed) full = { ...base, ...detailed };
    }
    const metrics = {};
    const voteAverage = full.voteAverage ?? (full.vote_average !== undefined ? Number(full.vote_average) : null);
    const voteCount = full.voteCount ?? (full.vote_count !== undefined ? Number(full.vote_count) : null);
    if (Number.isFinite(voteAverage) && voteAverage > 0) {
      metrics.tmdb = { value: voteAverage, votes: voteCount, url: `https://www.themoviedb.org/${full.mediaType || mediaTypeFor(full.type)}/${full.tmdbId}` };
    }
    if (full.imdbRatingFromTmdb) {
      metrics.imdb = { value: Number(full.imdbRatingFromTmdb), votes: full.imdbVotesFromTmdb ? Number(full.imdbVotesFromTmdb) : null, url: 'https://www.imdb.com/', derived: 'tmdb' };
    }
    return {
      metrics,
      resolved: {
        tmdbId: full.tmdbId,
        imdbId: full.imdbId || null,
        title: full.title,
        originalTitle: full.originalTitle,
        year: full.year,
        poster: full.poster,
        background: full.background,
        overview: full.overview,
        genres: full.genres,
        mediaType: full.mediaType,
      },
    };
  },

  async catalog({ type, list, limit, search, page }, ctx) {
    const mediaType = mediaTypeFor(type);
    const opts = { mediaType, limit: limit || 50, page: page || 1, search };
    if (list === 'top') Object.assign(opts, { sort: 'vote_average.desc', voteCountGte: 500 });
    else if (list === 'anime') Object.assign(opts, { sort: 'vote_average.desc', voteCountGte: 300, withGenres: String(GENRES[movieOrTv(mediaType)].animation), withOriginalLanguage: 'ja' });
    else if (list === 'anime-all') Object.assign(opts, { sort: 'vote_average.desc', voteCountGte: 200, withGenres: String(GENRES[movieOrTv(mediaType)].animation) });
    else if (list === 'popular') Object.assign(opts, { sort: 'popularity.desc', voteCountGte: 50 });
    else if (list === 'low-rated') Object.assign(opts, { sort: 'vote_average.asc', voteCountGte: 800 });
    else if (list === 'documentary') Object.assign(opts, { sort: 'vote_average.desc', voteCountGte: 300, withGenres: '99' });
    else if (list === 'spanish') Object.assign(opts, { sort: 'vote_average.desc', voteCountGte: 100, withOriginalLanguage: 'es' });
    let items = await discover(opts, ctx);
    if (type === 'anime') {
      // en TMDB las películas de anime están en discover/movie: mezclamos ambas
      const otherType = mediaType === 'movie' ? 'tv' : 'movie';
      try {
        const extra = await discover({ ...opts, mediaType: otherType }, ctx);
        items = [...items, ...extra].sort((a, b) => Number(b.voteAverage) - Number(a.voteAverage));
      } catch {
        /* si el otro lado falla, seguimos con lo que tengamos */
      }
    }
    return items.map((item) => ({
      id: item.tmdbId ? `tmdb:${item.tmdbId}` : item.imdbId ? `imdb:${item.imdbId}` : null,
      imdbId: item.imdbId,
      tmdbId: item.tmdbId,
      title: item.title,
      year: item.year,
      score: item.voteAverage,
      votes: item.voteCount,
      poster: item.poster,
      overview: item.overview,
      url: `https://www.themoviedb.org/${item.mediaType || mediaType}/${item.tmdbId}`,
      source: 'tmdb',
    }));
  },
};

function movieOrTv(mediaType) {
  return mediaType === 'movie' ? 'movie' : 'tv';
}

module.exports = provider;
module.exports.BASE = BASE;
module.exports.mediaTypeFor = mediaTypeFor;
module.exports.mapTmdbItem = mapTmdbItem;
module.exports.searchWork = searchWork;
module.exports.details = details;
module.exports.findByImdb = findByImdb;
module.exports.discover = discover;
module.exports.api = api;
