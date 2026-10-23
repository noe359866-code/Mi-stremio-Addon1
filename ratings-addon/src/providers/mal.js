'use strict';

/**
 * providers/mal.js — nota de MyAnimeList.
 *
 * MAL no tiene API pública anónima, así que hay tres vías en este orden:
 *   1. API oficial v2 si definiste MAL_CLIENT_ID (una sola header, sin OAuth para leer)
 *   2. Jikan (api.jikan.moe), espejo no oficial sin key — el camino cómodo
 *   3. HTML de la ficha, por si ambos fallan
 * Todas devuelven la misma métrica (`mal`, 0-10 con votos y puesto en el ranking).
 */

const { parseMalAnime, parseMalList, parseMalHtml, malUrl } = require('../parsers/mal');
const { looksLikeSameWork, filterCandidates } = require('../match');

const JIKAN_BASE = 'https://api.jikan.moe/v4';
const MAL_BASE = 'https://api.myanimelist.net/v2';
const OFFICIAL_FIELDS = 'rank,popularity,mean,num_scoring_users,num_listed_users,alternative_titles,start_date,end_date,genres,media_type,images,synopsis,year,status,rating,authors,name';

const HTML_HEADERS = { Referer: 'https://myanimelist.net/', Accept: 'text/html,application/xhtml+xml' };

function hasOfficial(ctx) {
  return Boolean(ctx.cfg.malClientId);
}

async function jikan(path, query, ctx) {
  const res = await ctx.http.getJson(`${ctx.cfg.jikanBaseUrl || JIKAN_BASE}${path}`, { query, timeout: ctx.cfg.timeoutMs, retries: 0 }, { log: ctx.log });
  if (!res.ok) {
    const error = new Error(`MyAnimeList (Jikan): ${res.error || `http_${res.status}`}`);
    error.code = res.blocked || res.status === 429 ? 'rate_limited' : res.status === 404 ? 'not_found' : 'unavailable';
    error.hint = 'Jikan limita a ~3 peticiones/s y 60/min; si abusa, baja PER_HOST_MS o usa MAL_CLIENT_ID';
    throw error;
  }
  return res.json || safeParse(res.body);
}

async function official(path, query, ctx) {
  const res = await ctx.http.getJson(`${MAL_BASE}${path}`, {
    query: { ...query, fields: OFFICIAL_FIELDS },
    headers: { 'X-MAL-CLIENT-ID': ctx.cfg.malClientId, Accept: 'application/json' },
    timeout: ctx.cfg.timeoutMs,
    retries: 0,
  }, { log: ctx.log });
  if (!res.ok) {
    const error = new Error(`MyAnimeList (API oficial): ${res.error || `http_${res.status}`}`);
    error.code = res.status === 401 || res.status === 403 ? 'bad_key' : res.status === 404 ? 'not_found' : 'unavailable';
    throw error;
  }
  return res.json || safeParse(res.body);
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** `data` de Jikan ya viene plano; el de la API oficial también (con otros nombres). */
function entryOf(payload) {
  if (!payload) return null;
  if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) return payload.data;
  return payload;
}

async function fetchById(id, ctx) {
  const numeric = String(id).replace(/\D/g, '');
  if (!numeric) return null;
  if (hasOfficial(ctx)) {
    try {
      const payload = await official(`/anime/${numeric}`, {}, ctx);
      const parsed = parseMalAnime(entryOf(payload), { id: numeric });
      if (parsed) return { ...parsed, via: 'api' };
    } catch (error) {
      if (error.code !== 'not_found') throw error;
    }
  }
  try {
    const payload = await jikan(`/anime/${numeric}`, { sfw: 'true' }, ctx);
    const parsed = parseMalAnime(entryOf(payload), { id: numeric });
    if (parsed) return { ...parsed, via: 'jikan' };
  } catch (error) {
    if (error.code === 'not_found') return null;
    throw error;
  }
  // HTML de la ficha como red de seguridad
  const html = await ctx.http.request(malUrl(numeric), { headers: HTML_HEADERS, timeout: ctx.cfg.timeoutMs, retries: 0 }, { log: ctx.log });
  if (html.ok) {
    const parsed = parseMalHtml(html.body, { url: malUrl(numeric) });
    if (Object.keys(parsed.metrics).length) return { metrics: parsed.metrics, resolved: parsed.resolved, url: parsed.url, via: 'html' };
  }
  return null;
}

async function searchList(term, ctx, { limit = 8 } = {}) {
  if (hasOfficial(ctx)) {
    try {
      const payload = await official('/anime', { q: term, limit, nsfw: 'false' }, ctx);
      const items = parseMalList(payload, { limit });
      if (items.length) return items;
    } catch {
      /* seguimos con Jikan */
    }
  }
  const payload = await jikan('/anime', { q: term, limit, sfw: 'true' }, ctx);
  return parseMalList(payload, { limit });
}

const provider = {
  id: 'mal',
  label: 'MyAnimeList',
  emoji: '🎌',
  animeOnly: true,

  async lookup(work, ctx) {
    const tried = [];

    if (work.ids && work.ids.mal) {
      tried.push(`id:${work.ids.mal}`);
      const found = await fetchById(work.ids.mal, ctx);
      if (found && Object.keys(found.metrics).length) return found;
    }

    for (const term of [work.title, work.originalTitle].filter(Boolean).slice(0, 2)) {
      tried.push(`search:${term}`);
      let items = [];
      try {
        items = await searchList(term, ctx);
      } catch (error) {
        if (error.code === 'rate_limited') throw error;
        continue;
      }
      const best = filterCandidates(items, work, { min: 0.4 })[0];
      if (!best) continue;
      const found = await fetchById(best.malId, ctx);
      if (found && Object.keys(found.metrics).length) {
        return { ...found, resolved: { ...found.resolved, malId: best.malId } };
      }
      // si el detalle falla, la propia lista ya trae score: lo usamos tal cual
      if (best.score) {
        return {
          metrics: {
            mal: {
              value: Number(best.score),
              votes: (best.extra && best.extra.scoredBy) || null,
              rank: best.rank || null,
              url: best.url,
              text: 'vía búsqueda',
            },
          },
          resolved: { malId: best.malId, malUrl: best.url, title: best.title, year: best.year, poster: best.poster },
          url: best.url,
          via: 'search',
        };
      }
    }

    const error = new Error('MyAnimeList no encontró el título (o no tiene nota)');
    error.code = 'not_found';
    error.attempts = tried;
    throw error;
  },

  /** `list`: top | popular | favorite | airing | upcoming | season */
  async catalog({ list, limit = 50, search, minScore, skip }, ctx) {
    const size = Math.min(Math.max(Number(limit) || 50, 5), 100);
    const offset = Number(skip) || 0;

    if (search) {
      const items = await searchList(search, ctx, { limit: Math.min(size, 25) });
      const filtered = filterCandidates(items, { title: search, type: 'anime' }, { min: 0.3 });
      const out = (filtered.length ? filtered : items).slice(0, size);
      if (minScore) return out.filter((item) => Number(item.score || 0) >= Number(minScore));
      return out;
    }

    // Jikan: sin `filter` = top por score; el resto son los filtros documentados.
    const filters = { top: '', popular: 'bypopularity', favorite: 'favorite', airing: 'airing', upcoming: 'upcoming', season: 'season_now', recent: 'airing' };
    const filter = filters[list] === undefined ? '' : filters[list];
    const perPage = 25; // Jikan no pasa de 25 por página
    const firstPage = Math.floor(offset / perPage) + 1;
    const pages = Math.min(4, Math.ceil(Math.min(size, 100) / perPage) + (firstPage - 1));

    const collected = [];
    const seen = new Set();
    let lastError = null;
    for (let page = firstPage; page <= firstPage + pages - 1 && collected.length < size + offset; page++) {
      try {
        const payload =
          filter === 'season_now'
            ? await jikan('/seasons/now', { sfw: 'true' }, ctx)
            : await jikan('/top/anime', { filter: filter || undefined, page: String(page), limit: String(perPage), sfw: 'true' }, ctx);
        for (const item of parseMalList(payload, { limit: perPage })) {
          if (seen.has(item.malId)) continue;
          seen.add(item.malId);
          collected.push(item);
        }
      } catch (error) {
        lastError = error;
        if (error.code === 'rate_limited') break;
        break;
      }
    }
    if (!collected.length) {
      const error = lastError || new Error('MyAnimeList devolvió la lista vacía');
      if (!error.code) error.code = 'empty';
      throw error;
    }
    let items = collected.slice(offset, offset + size);
    if (minScore) items = items.filter((item) => Number(item.score || 0) >= Number(minScore));
    return items;
  },
};

module.exports = provider;
module.exports.JIKAN_BASE = JIKAN_BASE;
module.exports.MAL_BASE = MAL_BASE;
module.exports.fetchById = fetchById;
module.exports.searchList = searchList;
