'use strict';

/**
 * resolve.js — de un id de Stremio (o una búsqueda de texto) a un `work`.
 *
 * work = {
 *   type: 'movie'|'series'|'anime',
 *   title, originalTitle, year, poster,
 *   ids: { imdb, tmdb, rtSlug, mcSlug, faId, faUrl }
 * }
 *
 * Stremio manda casi siempre `tt0000000`; con TMDB eso se convierte en título
 * original + año, que es lo que necesitan los scrapers de RT/Metacritic/FilmAffinity
 * para buscar bien. Si no hay TMDB_API_KEY, se arranca desde la propia ficha de
 * IMDb (og:title) para no quedarse sin título.
 */

const { parseImdbPage } = require('./parsers/imdb');
const { yearFrom, stripTitleNoise } = require('./util');

function normalizeType(type, hint = {}) {
  const raw = String(type || '').toLowerCase();
  if (raw === 'anime') return 'anime';
  if (raw === 'movie' || raw === 'films' || raw === 'film') return 'movie';
  if (raw === 'series' || raw === 'tv' || raw === 'show') return 'series';
  if (hint.mediaType === 'movie' || hint.type === 'movie') return 'movie';
  if (hint.isSeries || hint.mediaType === 'tv') return 'series';
  return 'movie';
}

/** `tt1375606`, `imdb:tt1375606`, `tmdb:27205`, `rt:inception`, `fa:596263`, `mc:inception` */
function parseId(rawId) {
  if (!rawId) return {};
  const id = String(rawId).replace(/\.json$/, '').trim();
  let match = id.match(/^(?:imdb:)?(tt\d{6,10})$/i);
  if (match) return { imdb: match[1].toLowerCase().startsWith('tt') ? match[1] : `tt${match[1]}` };
  match = id.match(/^tmdb:(\d+)$/i);
  if (match) return { tmdb: match[1] };
  match = id.match(/^rt:(?:m\/|tv\/)?([a-z0-9_\-]+)$/i);
  if (match) return { rtSlug: match[1] };
  match = id.match(/^mc:(?:movie\/|tv\/)?([a-z0-9\-]+)$/i);
  if (match) return { mcSlug: match[1] };
  match = id.match(/^fa:(\d+)$/i);
  if (match) return { faId: match[1] };
  match = id.match(/^https?:\/\/(?:www\.)?(?:imdb\.com\/(?:[a-z]{2}\/)?title|rottentomatoes\.com|metacritic\.com|filmaffinity\.com)\/.*$/i);
  if (match) return { url: id };
  return {};
}

function idsFromUrl(url) {
  const ids = {};
  const imdb = String(url).match(/(tt\d{6,10})/i);
  if (imdb) ids.imdb = imdb[1];
  const rt = String(url).match(/rottentomatoes\.com\/(m|tv)\/([a-z0-9_\-]+)/i);
  if (rt) {
    ids.rtSlug = rt[2];
    if (rt[1].toLowerCase() === 'tv') ids.__type = 'series';
  }
  const mc = String(url).match(/metacritic\.com\/(movie|tv)\/([a-z0-9\-]+)/i);
  if (mc) {
    ids.mcSlug = mc[2];
    if (mc[1].toLowerCase() === 'tv') ids.__type = 'series';
  }
  const fa = String(url).match(/filmaffinity\.com\/[a-z]{2}\/((?:film|tv|tvseries)\d+)\.html/i);
  if (fa) ids.faUrl = `https://www.filmaffinity.com/es/${fa[1]}.html`;
  return ids;
}

/** Título+año desde un texto tipo "Inception (2010)" o "Origen (2010)". */
function splitTitleYear(text) {
  if (!text) return { title: null, year: null };
  const raw = stripTitleNoise(decodeURIComponent(String(text)));
  const year = yearFrom(raw.slice(-12));
  const title = raw.replace(/\s*[\[(](?:19|20)\d{2}[\])]\s*$/, '').trim();
  return { title: title || raw, year };
}

/**
 * @param {{id?:string,type?:string,title?:string,year?:number|string,url?:string}} input
 * @param {{cfg:object,http:object,log:Function,caches:object}} ctx
 */
async function resolveWork(input, ctx) {
  const fromId = input.id ? parseId(input.id) : {};
  const fromUrl = input.url ? idsFromUrl(input.url) : {};
  const textHint = input.title ? splitTitleYear(input.title) : { title: null, year: null };

  const work = {
    type: normalizeType(input.type, { mediaType: fromUrl.__type ? 'tv' : undefined }),
    title: textHint.title || null,
    originalTitle: null,
    year: input.year ? Number(input.year) || null : textHint.year,
    poster: null,
    ids: { imdb: fromId.imdb || fromUrl.imdb || null, tmdb: fromId.tmdb || null, rtSlug: fromId.rtSlug || fromUrl.rtSlug || null, mcSlug: fromId.mcSlug || fromUrl.mcSlug || null, faId: fromId.faId || null, faUrl: fromUrl.faUrl || null },
    resolvedVia: [],
  };
  if (fromUrl.__type && work.type === 'movie') work.type = 'series';
  if (!work.title && work.ids.rtSlug) work.title = work.ids.rtSlug.replace(/[_-]+/g, ' ');
  if (!work.title && work.ids.mcSlug) work.title = work.ids.mcSlug.replace(/[-]+/g, ' ');

  const hasKey = Boolean(ctx.cfg.tmdbApiKey || ctx.cfg.tmdbToken);

  // --- vía TMDB (la buena): título original, año, póster, imdb_id
  try {
    const { findByImdb, details, searchWork } = require('./providers/tmdb');
    let mapped = null;
    if (work.ids.imdb) mapped = await findByImdb(work.ids.imdb, ctx);
    if (!mapped && work.ids.tmdb) {
      const mediaType = work.type === 'movie' ? 'movie' : 'tv';
      mapped = await details(work.ids.tmdb, mediaType, ctx);
    }
    if (!mapped && work.title) {
      mapped = await searchWork({ title: work.title, year: work.year, type: work.type }, ctx);
    }
    if (mapped) {
      if (mapped.mediaType === 'movie' && !input.type) work.type = 'movie';
      else if (mapped.mediaType === 'tv' && !input.type && work.type !== 'anime') work.type = 'series';
      work.tmdbId = mapped.tmdbId;
      work.mediaType = mapped.mediaType;
      work.title = mapped.title || work.title;
      work.originalTitle = mapped.originalTitle || null;
      work.year = work.year || mapped.year;
      work.poster = mapped.poster || null;
      work.background = mapped.background || null;
      work.overview = mapped.overview || null;
      work.genres = mapped.genres || [];
      work.runtime = mapped.runtime || null;
      if (!work.ids.imdb && mapped.imdbId) work.ids.imdb = mapped.imdbId;
      if (!work.ids.tmdb && mapped.tmdbId) work.ids.tmdb = String(mapped.tmdbId);
      work.resolvedVia.push('tmdb');
      // TMDB ya trae su propia nota: la guardamos para no repetir la llamada
      if (Number.isFinite(mapped.voteAverage) && mapped.voteAverage > 0) {
        work.tmdbPreview = { value: mapped.voteAverage, votes: mapped.voteCount, url: `https://www.themoviedb.org/${mapped.mediaType}/${mapped.tmdbId}` };
        if (mapped.imdbRatingFromTmdb) work.tmdbImdbPreview = { value: mapped.imdbRatingFromTmdb, votes: mapped.imdbVotesFromTmdb || null };
      }
    }
  } catch (error) {
    if (error.code !== 'no_key' && ctx.cfg.verbose) ctx.log(`resolve tmdb: ${error.message}`);
    if (!hasKey) work.resolvedVia.push('tmdb:sin-key');
  }

  // --- sin TMDB: arranque desde IMDb para tener título/año
  if (!work.title && work.ids.imdb) {
    try {
      const res = await ctx.http.request(`https://www.imdb.com/title/${work.ids.imdb}/`, { timeout: ctx.cfg.timeoutMs, retries: 0 }, { log: ctx.log });
      if (res.ok) {
        const parsed = parseImdbPage(res.body, { imdbId: work.ids.imdb });
        work.title = parsed.title || work.title;
        work.year = work.year || parsed.year;
        work.poster = work.poster || parsed.poster;
        if (parsed.ok) work.imdbPreview = parsed.metrics.imdb;
        work.resolvedVia.push('imdb');
      }
    } catch (error) {
      if (ctx.cfg.verbose) ctx.log(`resolve imdb: ${error.message}`);
    }
  }

  // --- última red: si sólo tenemos título, los scrapers pueden funcionar igual
  if (!work.title && !work.ids.imdb && !work.ids.tmdb && !work.ids.rtSlug && !work.ids.mcSlug && !work.ids.faUrl) {
    const error = new Error('no se puede resolver el contenido: manda id (tt…, tmdb:123) o ?title=…');
    error.code = 'bad_request';
    throw error;
  }
  return work;
}

/** id canónico que devolvemos a Stremio (prefiere tt…, que es el que entiende Cinemeta). */
function stremioIdFor(work, fallbackId) {
  if (work.ids && work.ids.imdb) return work.ids.imdb;
  if (work.ids && work.ids.tmdb) return `tmdb:${work.ids.tmdb}`;
  return fallbackId;
}

module.exports = { resolveWork, parseId, normalizeType, splitTitleYear, stremioIdFor, idsFromUrl };
