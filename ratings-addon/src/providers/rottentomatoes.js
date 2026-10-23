'use strict';

/**
 * providers/rottentomatoes.js — Tomatometer y puntuación del público.
 *
 * Estrategia (de más barata a más lenta):
 *   1. slug deducido del título  ->  /m/<slug> o /tv/<slug>
 *   2. API interna de búsqueda   ->  /api/search/... (varias versiones)
 *   3. HTML de /search?search=   ->  primer enlace /m|/tv coincidente
 * Opcionalmente se apoya en OMDb (rt_tomatometer) si RT está bloqueado.
 */

const { parseRtPage, parseRtSearchJson, parseRtHtmlList, rankCandidates } = require('../parsers/rottentomatoes');
const { slugifyUnderscore, slugifyDash, foldText, dropLeadingArticle } = require('../util');
const { filterCandidates } = require('../match');

const HEADERS = { Referer: 'https://www.rottentomatoes.com/', Accept: 'text/html,application/xhtml+xml' };

function slugCandidates(work) {
  const base = [];
  if (work.ids && work.ids.rtSlug) base.push(work.ids.rtSlug);
  for (const name of [work.title, work.originalTitle, work.releaseTitle].filter(Boolean)) {
    base.push(slugifyUnderscore(name));
    base.push(dropLeadingArticle(slugifyUnderscore(name), '_'));
    base.push(slugifyDash(name));
    if (work.year) {
      base.push(`${slugifyUnderscore(name)}_${work.year}`);
      base.push(`${slugifyDash(name)}-${work.year}`);
    }
  }
  const seen = new Set();
  return base.filter((slug) => slug && slug.length > 2 && foldText(slug).length > 2 && !seen.has(slug) && seen.add(slug));
}

function kindsFor(type) {
  return type === 'series' || type === 'anime' ? ['tv', 'm'] : ['m', 'tv'];
}

async function fetchPage(kind, slug, ctx) {
  const url = `https://www.rottentomatoes.com/${kind}/${slug}`;
  const res = await ctx.http.request(url, { headers: HEADERS, timeout: ctx.cfg.timeoutMs, retries: 0 }, { log: ctx.log });
  if (!res.ok) return { res, parsed: null };
  const parsed = parseRtPage(res.body);
  if (Object.keys(parsed.metrics).length) return { res, parsed };
  return { res, parsed: null };
}

async function searchRt(work, ctx) {
  const query = `${work.title}${work.year ? ` ${work.year}` : ''}`;
  const attempts = [
    {
      label: 'api-search-v2-1',
      run: () =>
        ctx.http.getJson(
          'https://www.rottentomatoes.com/api/search/v2-1/pre-filter/all',
          { query: { q: query, page: 1, limit: 20, sort: '_score.' }, headers: { Accept: 'application/json' }, timeout: ctx.cfg.timeoutMs },
          { log: ctx.log }
        ),
    },
    {
      label: 'api-search-v1-2',
      run: () =>
        ctx.http.getJson(
          'https://www.rottentomatoes.com/api/search/v1-2/pre-filter/all',
          { query: { q: query, page: 1, limit: 20 }, headers: { Accept: 'application/json' }, timeout: ctx.cfg.timeoutMs },
          { log: ctx.log }
        ),
    },
    {
      label: 'api-private-search',
      run: () =>
        ctx.http.getJson(
          'https://www.rottentomatoes.com/api/private/v2.0/search',
          { query: { q: query, page: 1, limit: 20 }, headers: { Accept: 'application/json' }, timeout: ctx.cfg.timeoutMs },
          { log: ctx.log }
        ),
    },
    {
      label: 'html-search',
      run: () => ctx.http.request('https://www.rottentomatoes.com/search', { query: { search: query }, headers: HEADERS, timeout: ctx.cfg.timeoutMs }, { log: ctx.log }),
    },
  ];

  for (const attempt of attempts) {
    const res = await attempt.run();
    if (!res.ok) continue;
    let candidates = [];
    if (res.json) candidates = parseRtSearchJson(res.json, { title: work.title, year: work.year });
    else if (res.body) candidates = parseRtHtmlList(res.body);
    candidates = filterCandidates(rankCandidates(candidates.filter(Boolean), { title: work.title, year: work.year }), work);
    const best = candidates.find((candidate) => candidate.rtSlug);
    if (best) {
      return {
        rtSlug: best.rtSlug,
        title: best.title,
        year: best.year,
        type: best.type || (String(best.url || '').includes('/tv/') ? 'series' : 'movie'),
        url: best.url || `https://www.rottentomatoes.com/${best.type === 'series' ? 'tv' : 'm'}/${best.rtSlug}`,
        score: best.score,
        via: attempt.label,
      };
    }
  }
  return null;
}

const provider = {
  id: 'rottentomatoes',
  label: 'Rotten Tomatoes',
  emoji: '🍅',

  async lookup(work, ctx) {
    const tried = [];
    for (const slug of slugCandidates(work).slice(0, 4)) {
      for (const kind of kindsFor(work.type)) {
        tried.push(`/${kind}/${slug}`);
        const { res, parsed } = await fetchPage(kind, slug, ctx);
        if (parsed) {
          return {
            metrics: parsed.metrics,
            url: parsed.url || `https://www.rottentomatoes.com/${kind}/${slug}`,
            consensus: parsed.consensus || null,
            resolved: { rtSlug: slug, type: parsed.type },
            via: 'page',
          };
        }
        if (res && res.status === 404) continue; // siguiente candidato
      }
    }

    const found = await searchRt(work, ctx);
    if (found) {
      const fetched = found.rtSlug ? await fetchPage(found.type === 'series' ? 'tv' : 'm', found.rtSlug, ctx) : { parsed: null };
      if (fetched.parsed) {
        return {
          metrics: fetched.parsed.metrics,
          url: fetched.parsed.url || found.url,
          consensus: fetched.parsed.consensus || null,
          resolved: { rtSlug: found.rtSlug },
          via: found.via,
        };
      }
      if (found.score) {
        return { metrics: { rt_tomatometer: { value: found.score, url: found.url, text: 'resultados de búsqueda' } }, url: found.url, resolved: { rtSlug: found.rtSlug }, via: found.via };
      }
    }

    const error = new Error('Rotten Tomatoes sin respuesta (posible muro anti-bot o título no encontrado)');
    error.code = 'not_found';
    error.attempts = tried;
    throw error;
  },

  async catalog({ type, list, limit = 40, minScore = 0, search }, ctx) {
    const isSeries = type === 'series' || type === 'anime';
    if (search) {
      const found = await searchRt({ title: search, year: null, type: isSeries ? 'series' : 'movie' }, ctx);
      if (found) {
        return [
          {
            id: `rt:${found.rtSlug}`,
            title: found.title || search,
            year: found.year || null,
            score: found.score || null,
            url: found.url,
            source: 'rottentomatoes',
          },
        ];
      }
      const htmlRes = await ctx.http.request('https://www.rottentomatoes.com/search', { query: { search }, headers: HEADERS, timeout: ctx.cfg.timeoutMs }, { log: ctx.log });
      if (!htmlRes.ok) throw new Error('Rotten Tomatoes buscador caído');
      return parseRtHtmlList(htmlRes.body)
        .filter((item) => (isSeries ? item.type === 'series' : item.type === 'movie'))
        .slice(0, limit)
        .map((item) => ({ id: `rt:${item.rtSlug}`, title: item.title, year: item.year, score: item.score, url: item.url, source: 'rottentomatoes' }));
    }
    const endpoints = {
      top: `https://www.rottentomatoes.com/api/private/v2.0/browse/${isSeries ? 'top-tv' : 'top-movies'}?limit=${Math.min(limit, 60)}&score_min=${minScore || 80}&score_max=100`,
      box: 'https://www.rottentomatoes.com/api/private/v2.0/browse/movies?sort=boxoffice_gross_live&limit=40',
      popular: `https://www.rottentomatoes.com/api/private/v2.0/browse/${isSeries ? 'tv' : 'movies'}?sort=popularity&limit=${Math.min(limit, 60)}`,
    };
    const target = endpoints[list] || endpoints.top;
    const res = await ctx.http.getJson(target, { headers: { Accept: 'application/json' }, timeout: ctx.cfg.timeoutMs }, { log: ctx.log });
    if (res.ok && res.json) {
      const candidates = parseRtSearchJson(res.json, {}).filter((item) => (isSeries ? item.type === 'series' : item.type === 'movie'));
      if (candidates.length) {
        return candidates.slice(0, limit).map((item) => ({
          id: `rt:${item.rtSlug}`,
          title: item.title,
          year: item.year,
          score: item.score,
          poster: null,
          url: `https://www.rottentomatoes.com/${item.type === 'series' ? 'tv' : 'm'}/${item.rtSlug}`,
          source: 'rottentomatoes',
        }));
      }
    }
    // fallback HTML: /browse/movies_top_rated/
    const html = await ctx.http.request(`https://www.rottentomatoes.com/browse/${type === 'series' || type === 'anime' ? 'tv_series_top_rated' : 'movies_top_rated'}/`, { headers: HEADERS, timeout: ctx.cfg.timeoutMs }, { log: ctx.log });
    if (!html.ok) {
      const error = new Error('Rotten Tomatoes listas caídas');
      error.code = 'unavailable';
      throw error;
    }
    return parseRtHtmlList(html.body)
      .filter((item) => (isSeries ? item.type === 'series' : item.type === 'movie'))
      .slice(0, limit)
      .map((item) => ({
        id: `rt:${item.rtSlug}`,
        title: item.title,
        year: item.year,
        score: item.score,
        url: item.url,
        source: 'rottentomatoes',
      }));
  },
};

module.exports = provider;
module.exports.slugCandidates = slugCandidates;
