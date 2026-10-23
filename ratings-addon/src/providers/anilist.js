'use strict';

/**
 * providers/anilist.js — notas de AniList por su API GraphQL pública.
 *
 * Es la fuente más fiable para anime: sin key, sin scraping y con `idMal` en la
 * ficha, que permite cruzar con MyAnimeList (y viceversa). AniList puntúa 0-100.
 */

const { MEDIA_QUERY, listQuery, fallbackListQuery, parseAnilistMedia, parseAnilistList, anilistTitles } = require('../parsers/anilist');
const { looksLikeSameWork, filterCandidates } = require('../match');

const ENDPOINT = 'https://graphql.anilist.co';
const RATE_HINT = 'AniList admite ~90 peticiones/min';

async function graphql(query, variables, ctx) {
  const res = await ctx.http.request(
    ctx.cfg.anilistEndpoint || ENDPOINT,
    {
      method: 'POST',
      data: JSON.stringify({ query, variables }),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      parseJson: true,
      timeout: ctx.cfg.timeoutMs,
      retries: 0,
      maxBytes: 1024 * 1024,
    },
    { log: ctx.log }
  );
  if (!res.ok) {
    const error = new Error(`AniList: ${res.error || `http_${res.status}`}`);
    error.code = res.blocked ? 'blocked' : res.error === 'timeout' ? 'timeout' : res.status === 429 ? 'rate_limited' : 'unavailable';
    error.hint = RATE_HINT;
    throw error;
  }
  let payload = res.json;
  if (!payload) {
    try {
      payload = JSON.parse(res.body);
    } catch {
      const error = new Error('AniList: respuesta no-JSON');
      error.code = 'bad_json';
      throw error;
    }
  }
  if (payload.errors && payload.errors.length) {
    const error = new Error(`AniList: ${payload.errors[0].message || 'graphql error'}`.slice(0, 200));
    error.code = 'graphql_error';
    throw error;
  }
  return payload;
}

/** Títulos por los que merece la pena buscar en AniList. */
function searchTerms(work) {
  const out = [];
  for (const value of [work.title, work.originalTitle, work.anilistTitle, ...(Array.isArray(work.synonyms) ? work.synonyms : [])]) {
    const text = String(value || '').trim();
    if (!text) continue;
    if (!out.includes(text)) out.push(text);
  }
  return out.slice(0, 3);
}

function usable(parsed, work) {
  if (!parsed) return false;
  const candidate = { title: parsed.resolved.title, year: parsed.resolved.year };
  const media = parsed.media || {};
  const titles = anilistTitles(media);
  const ok =
    Boolean(work.ids && work.ids.anilist) ||
    titles.some((title) => looksLikeSameWork({ title, year: candidate.year }, work, { allowYearMismatch: true })) ||
    looksLikeSameWork(candidate, work, { allowYearMismatch: true });
  return ok;
}

const provider = {
  id: 'anilist',
  label: 'AniList',
  emoji: '🌸',
  animeOnly: true,

  async lookup(work, ctx) {
    const tried = [];

    const attempts = [];
    if (work.ids && work.ids.anilist) attempts.push([{ id: Number(String(work.ids.anilist).replace(/\D/g, '')) }, `id:${work.ids.anilist}`]);
    if (work.ids && work.ids.mal) attempts.push([{ idMal: Number(String(work.ids.mal).replace(/\D/g, '')) }, `idMal:${work.ids.mal}`]);
    for (const term of searchTerms(work)) attempts.push([{ search: term }, `search:${term}`]);

    for (const [variables, label] of attempts) {
      if (!variables.id && !variables.idMal && !variables.search) continue;
      tried.push(label);
      let payload = null;
      try {
        payload = await graphql(MEDIA_QUERY, variables, ctx);
      } catch (error) {
        if (error.code === 'rate_limited' || error.code === 'blocked') throw error;
        continue; // filtro/variable rechazada: a por el siguiente intento
      }
      const parsed = parseAnilistMedia(payload && payload.data && payload.data.Media);
      if (!parsed) continue;
      if (work.ids && (work.ids.anilist || work.ids.mal)) {
        return { metrics: parsed.metrics, resolved: { ...parsed.resolved, anilistSlug: null }, url: parsed.url, via: 'graphql' };
      }
      if (!usable(parsed, work)) continue;
      return { metrics: parsed.metrics, resolved: parsed.resolved, url: parsed.url, via: 'graphql' };
    }

    // última vía: buscador con lista y quedarse con el mejor candidato validado
    const term = searchTerms(work)[0];
    if (term) {
      tried.push(`page:${term}`);
      const query = listQuery(['sort', 'search']);
      let payload = null;
      try {
        payload = await graphql(query, { page: 1, perPage: 8, sort: ['SEARCH_MATCH', 'POPULARITY_DESC'], search: term }, ctx);
      } catch (error) {
        try {
          payload = await graphql(fallbackListQuery({ withSearch: true }), { page: 1, perPage: 8, sort: ['SEARCH_MATCH'], search: term }, ctx);
        } catch {
          void error;
        }
      }
      const items = parseAnilistList(payload, { limit: 8 });
      const best = filterCandidates(items, work, { min: 0.4 })[0];
      if (best) {
        const media = ((payload.data || {}).Page || {}).media || [];
        const match = media.find((entry) => String(entry.id) === String(best.anilistId));
        const parsed = parseAnilistMedia(match);
        if (parsed) return { metrics: parsed.metrics, resolved: parsed.resolved, url: parsed.url, via: 'graphql+search' };
      }
    }

    const error = new Error('AniList no encontró el título (o no publica nota)');
    error.code = 'not_found';
    error.attempts = tried;
    throw error;
  },

  /**
   * Listas de AniList. `list`: top | popular | trending | favorites | airing |
   * upcoming | season (temporada en curso).
   */
  async catalog({ type, list, limit = 50, search, minScore, skip }, ctx) {
    void type;
    const perPage = Math.min(Math.max(Number(limit) || 50, 5), 50);
    const page = Math.floor((Number(skip) || 0) / perPage) + 1;
    const sorts = {
      top: ['SCORE_DESC', 'POPULARITY_DESC'],
      popular: ['POPULARITY_DESC'],
      trending: ['TRENDING_DESC', 'POPULARITY_DESC'],
      favorites: ['FAVOURITES_DESC'],
      airing: ['POPULARITY_DESC'],
      upcoming: ['FAVOURITES_DESC'],
      season: ['SCORE_DESC'],
      recent: ['START_DATE_DESC', 'SCORE_DESC'],
    };
    const sort = sorts[list] || sorts.top;
    const variables = { page, perPage, sort };
    const args = ['sort'];
    if (search) {
      variables.search = search;
      variables.sort = ['SEARCH_MATCH', 'POPULARITY_DESC']; // en búsqueda manda el match
      args.push('search');
    }
    if (!search && list === 'airing') {
      variables.status = 'RELEASING';
      args.push('status');
    }
    if (!search && list === 'upcoming') {
      variables.status = 'NOT_YET_RELEASED';
      args.push('status');
    }
    if (!search && list === 'season') {
      const now = new Date();
      const month = now.getUTCMonth() + 1;
      variables.seasonYear = now.getUTCFullYear();
      variables.season = month <= 3 ? 'WINTER' : month <= 6 ? 'SPRING' : month <= 9 ? 'SUMMER' : 'FALL';
      args.push('season', 'seasonYear');
    }
    if (!search && Number(minScore) > 0) {
      variables.minScore = Math.round(Number(minScore) * 10);
      args.push('minScore');
    }

    let payload = null;
    let usedFallback = false;
    try {
      payload = await graphql(listQuery(args), variables, ctx);
    } catch (error) {
      if (error.code === 'rate_limited' || error.code === 'blocked') throw error;
      usedFallback = true;
      payload = await graphql(fallbackListQuery({ withSearch: Boolean(search) }), { page, perPage, sort, search: search || undefined }, ctx);
    }

    let items = parseAnilistList(payload, { limit: perPage });
    if (!usedFallback && minScore) items = items.filter((item) => Number(item.score) >= Number(minScore) * 10 - 0.5);
    if (!items.length) {
      const error = new Error('AniList devolvió la lista vacía');
      error.code = 'empty';
      throw error;
    }
    return items.slice(0, perPage);
  },
};

module.exports = provider;
module.exports.graphql = graphql;
module.exports.ENDPOINT = ENDPOINT;
