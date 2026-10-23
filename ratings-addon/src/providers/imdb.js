'use strict';

/**
 * providers/imdb.js — puntuación de IMDb.
 *
 * IMDb no tiene API pública y protege con anti-bot, así que:
 *   1. ficha `https://www.imdb.com/title/tt…/`  (datos embebidos en JSON)
 *   2. subpágina `/rating/` (más ligera, a veces menos protegida)
 *   3. OMDb (api de terceros con key gratuita) como respaldo opcional
 */

const { parseImdbPage, parseImdbList, parseOmdb } = require('../parsers/imdb');
const { filterCandidates } = require('../match');
const { slugifyDash } = require('../util');

const IMDB_HEADERS = { Referer: 'https://www.imdb.com/', Accept: 'text/html,application/xhtml+xml' };

async function fetchImdbHtml(path, ctx) {
  const url = `https://www.imdb.com${path}`;
  const res = await ctx.http.request(url, { headers: IMDB_HEADERS, timeout: ctx.cfg.timeoutMs, retries: ctx.cfg.retries }, { log: ctx.log });
  return res;
}

async function omdbLookup(work, ctx) {
  const key = ctx.cfg.omdbApiKey;
  if (!key) return null;
  const params = work.ids.imdb ? { i: work.ids.imdb } : { t: work.title, y: work.year || '' };
  const res = await ctx.http.getJson('https://www.omdbapi.com/', { query: { ...params, type: work.type === 'series' ? 'series' : undefined, plot: 'short' }, headers: { Accept: 'application/json' } , timeout: ctx.cfg.timeoutMs }, { log: ctx.log });
  if (!res.ok || !res.json) return null;
  const parsed = parseOmdb(res.json);
  if (!parsed.found) return null;
  return parsed;
}

const provider = {
  id: 'imdb',
  label: 'IMDb',
  emoji: '⭐',

  async lookup(work, ctx) {
    const attempts = [];
    if (work.ids.imdb) {
      for (const path of [`/title/${work.ids.imdb}/`, `/title/${work.ids.imdb}/rating/`]) {
        attempts.push(path);
        const res = await fetchImdbHtml(path, ctx);
        if (res.ok && res.body) {
          const parsed = parseImdbPage(res.body, { imdbId: work.ids.imdb });
          if (parsed.ok) {
            return {
              metrics: parsed.metrics,
              url: `https://www.imdb.com/title/${work.ids.imdb}/`,
              resolved: { imdbId: work.ids.imdb, title: work.title || parsed.title, year: work.year || parsed.year, poster: work.poster || parsed.poster },
              via: 'html',
            };
          }
        } else if (res.status === 404) {
          break;
        }
      }
    }

    // Sin id de IMDb: intentamos resolver por slug adivinado (título-año)
    if (!work.ids.imdb && work.title) {
      const guess = `/find/?q=${encodeURIComponent(`${work.title}${work.year ? ` ${work.year}` : ''}`)}`;
      attempts.push(guess);
      const res = await fetchImdbHtml(guess, ctx);
      if (res.ok && res.body) {
        const items = filterCandidates(parseImdbList(res.body), work, { min: 0.5 });
        const best = items[0];
        if (best && best.imdbId) {
          const found = await provider.lookup({ ...work, ids: { ...work.ids, imdb: best.imdbId } }, ctx);
          if (found && found.metrics && Object.keys(found.metrics).length) return found;
        }
      }
    }

    if (ctx.cfg.omdbApiKey) {
      attempts.push('omdbapi');
      const parsed = await omdbLookup(work, ctx);
      if (parsed && Object.keys(parsed.metrics).length) {
        return {
          metrics: parsed.metrics,
          url: parsed.imdbId ? `https://www.imdb.com/title/${parsed.imdbId}/` : 'https://www.imdb.com/',
          resolved: { imdbId: parsed.imdbId, title: parsed.title, year: parsed.year, poster: parsed.poster, type: parsed.type },
          via: 'omdb',
        };
      }
    }

    const error = new Error('IMDb sin respuesta (bloqueo anti-bot o id desconocido)');
    error.attempts = attempts;
    error.code = 'blocked';
    throw error;
  },

  async catalog({ type, list, limit = 50, search }, ctx) {
    if (search) {
      const res = await fetchImdbHtml(`/find/?q=${encodeURIComponent(search)}`, ctx);
      if (!res.ok) {
        const error = new Error(`IMDb búsqueda caída (${res.error || res.status})`);
        error.code = res.blocked ? 'blocked' : 'unavailable';
        throw error;
      }
      return parseImdbList(res.body)
        .filter((item) => item.title)
        .slice(0, limit)
        .map((item) => ({
          id: `imdb:${item.imdbId}`,
          imdbId: item.imdbId,
          title: item.title,
          year: item.year,
          score: item.score,
          votes: item.votes,
          poster: item.poster,
          url: item.url,
          source: 'imdb',
        }));
    }
    const paths = {
      top250: type === 'series' || type === 'anime' ? '/chart/toptv/' : '/chart/top/',
      toptv: '/chart/toptv/',
      bottom: '/chart/bottom/',
      anime: `/search/title/?title_type=${type === 'anime' ? 'tv_series,tv_mini_series' : 'tv_series'}&genres=animation&countries=JP&sort=user_rating,desc&count=${Math.min(limit, 100)}`,
      popular: `/search/title/?title_type=${type === 'movie' ? 'movie' : 'tv_series'}&user_rating=7.0,10.0&num_votes=50000,&sort=num_votes,desc&count=${Math.min(limit, 100)}`,
      topmovies: '/chart/top-english-movies/',
    };
    const path = paths[list] || paths.top250;
    const res = await fetchImdbHtml(path, ctx);
    if (!res.ok) {
      const error = new Error(`IMDb lista caída (${res.error || res.status})`);
      error.code = res.blocked ? 'blocked' : 'unavailable';
      throw error;
    }
    const items = parseImdbList(res.body).slice(0, limit);
    return items.map((item, index) => ({
      id: `imdb:${item.imdbId}`,
      imdbId: item.imdbId,
      title: item.title,
      year: item.year,
      score: item.score,
      votes: item.votes,
      rank: list === 'top250' ? index + 1 : null,
      poster: item.poster,
      url: item.url,
      source: 'imdb',
    }));
  },
};

provider.slugHint = (work) => slugifyDash(work.title || '');

module.exports = provider;
