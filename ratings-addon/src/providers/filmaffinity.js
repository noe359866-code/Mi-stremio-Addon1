'use strict';

/**
 * providers/filmaffinity.js — nota y votos de FilmAffinity (fuente en español).
 *
 * FilmAffinity no tiene API: se busca el título y se abre la ficha encontrada.
 * Las listas (Top 200, por país/género) vienen de `tdtop.php`.
 */

const { parseFilmaffinityPage, parseFilmaffinityList } = require('../parsers/filmaffinity');
const { titleSimilarity, foldText } = require('../util');
const { looksLikeSameWork } = require('../match');

const HEADERS = { Referer: 'https://www.filmaffinity.com/es/search.php' };

function searchUrls(work) {
  const phrase = `${work.title || ''}${work.originalTitle && foldText(work.originalTitle) !== foldText(work.title || '') ? ` ${work.originalTitle}` : ''}`.trim();
  const query = `${(phrase || '').trim()}${work.year ? ` ${work.year}` : ''}`.trim();
  return [
    `https://www.filmaffinity.com/es/search.php?stext=${encodeURIComponent(query)}&scr=1`,
    `https://www.filmaffinity.com/es/search.php?stext=${encodeURIComponent(work.title || '')}`,
    `https://www.filmaffinity.com/es/busca.php?scrH=0&titq=${encodeURIComponent(query)}`,
  ];
}

function pickBest(candidates, work) {
  let best = null;
  let bestScore = -1;
  for (const candidate of candidates) {
    if (!candidate.title) continue;
    let score = Math.max(titleSimilarity(candidate.title, work.title), titleSimilarity(candidate.title, work.originalTitle || work.title));
    if (work.year && candidate.year) score += candidate.year === work.year ? 0.5 : -0.6;
    if (candidate.score) score += 0.1;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return bestScore >= 0.55 ? best : best && bestScore >= 0.3 ? best : null;
}

const provider = {
  id: 'filmaffinity',
  label: 'FilmAffinity',
  emoji: '🎞️',

  async lookup(work, ctx) {
    let target = work.ids && work.ids.faUrl ? work.ids.faUrl : null;
    let candidate = null;
    if (!target && work.ids && work.ids.faId) target = `https://www.filmaffinity.com/es/film${work.ids.faId}.html`;

    if (!target && !work.title) {
      const error = new Error('FilmAffinity necesita un título para buscar (sin id ni título no hay forma de acertar)');
      error.code = 'bad_request';
      throw error;
    }

    if (!target) {
      for (const url of searchUrls(work)) {
        const res = await ctx.http.request(url, { headers: HEADERS, timeout: ctx.cfg.timeoutMs, retries: 0 }, { log: ctx.log });
        if (!res.ok) continue;
        const candidates = parseFilmaffinityList(res.body);
        if (!candidates.length) continue;
        candidate = pickBest(candidates, work);
        if (candidate) {
          target = candidate.href;
          break;
        }
        // si la búsqueda devolvió resultados pero ninguno convence, sólo usamos
        // el primero cuando la validación de título/año lo avala
        const first = candidates[0];
        if (first && looksLikeSameWork(first, work)) {
          candidate = first;
          target = first.href;
        }
      }
    }

    if (!target) {
      const error = new Error('FilmAffinity: título no encontrado en su buscador');
      error.code = 'not_found';
      throw error;
    }

    const res = await ctx.http.request(target, { headers: HEADERS, timeout: ctx.cfg.timeoutMs, retries: ctx.cfg.retries }, { log: ctx.log });
    if (!res.ok) {
      const error = new Error(`FilmAffinity ficha caída (${res.error || res.status})`);
      error.code = res.blocked ? 'blocked' : 'unavailable';
      throw error;
    }
    const parsed = parseFilmaffinityPage(res.body, { url: target });
    if (!parsed.ok) {
      const error = new Error('FilmAffinity: la ficha no trae puntuación (¿serie sin rating?)');
      error.code = 'no_score';
      throw error;
    }
    return {
      metrics: parsed.metrics,
      url: target,
      resolved: {
        faId: parsed.faId || (candidate && candidate.faId) || null,
        faUrl: target,
        imdbId: parsed.imdbId || null,
        title: parsed.title,
        year: parsed.year,
        poster: parsed.poster,
      },
      via: candidate ? 'search+page' : 'page',
    };
  },

  async catalog({ type, list, limit = 50, search }, ctx) {
    if (search) {
      const url = `https://www.filmaffinity.com/es/search.php?stext=${encodeURIComponent(search)}`;
      const res = await ctx.http.request(url, { headers: HEADERS, timeout: ctx.cfg.timeoutMs }, { log: ctx.log });
      if (!res.ok) throw new Error('FilmAffinity buscador caído');
      return parseFilmaffinityList(res.body).slice(0, limit).map((item) => ({
        id: `fa:${item.faId}`,
        title: item.title,
        year: item.year,
        score: item.score,
        votes: item.votes,
        poster: item.poster,
        url: item.href,
        source: 'filmaffinity',
      }));
    }
    const params = new URLSearchParams({
      start: '0',
      orderby: list === 'popular' ? 'popularity' : 'rating',
      st: 'y',
      'type-id': type === 'movie' ? 'pelicula' : 'serie',
      count: String(Math.min(limit, 100)),
    });
    if (list === 'anime') params.set('country', 'JP');
    if (list === 'spanish') params.set('country', 'ES');
    const url = `https://www.filmaffinity.com/es/tdtop.php?${params.toString()}`;
    const res = await ctx.http.request(url, { headers: HEADERS, timeout: ctx.cfg.timeoutMs }, { log: ctx.log });
    if (!res.ok) {
      const error = new Error('FilmAffinity listas caídas');
      error.code = 'unavailable';
      throw error;
    }
    return parseFilmaffinityList(res.body)
      .slice(0, limit)
      .map((item, index) => ({
        id: `fa:${item.faId}`,
        title: item.title,
        year: item.year,
        score: item.score,
        votes: item.votes,
        rank: list === 'top' || !list ? index + 1 : null,
        poster: item.poster,
        url: item.href,
        source: 'filmaffinity',
      }));
  },
};

module.exports = provider;
module.exports.searchUrls = searchUrls;
