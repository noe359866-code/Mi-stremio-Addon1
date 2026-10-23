'use strict';

/**
 * providers/metacritic.js — Metascore y User score.
 *
 * Primero intenta el endpoint JSON interno que usa la propia web
 * (`backend.metacritic.com/.../component/score/...`), que es mucho más ligero
 * que el HTML; si falla, scrapea la ficha y, si aún así no hay nada, busca.
 */

const { parseMetacriticPage, parseMetacriticApi, parseMetacriticList } = require('../parsers/metacritic');
const { slugifyDash, dropLeadingArticle } = require('../util');
const { filterCandidates } = require('../match');

// Clave pública embebida en la web de Metacritic (rotable con METACRITIC_API_KEY).
const PUBLIC_API_KEY = '1MOZgmNFxvmljaQR1X9KAij9Mo4xAY3u';
const HEADERS = { Referer: 'https://www.metacritic.com/', Accept: 'text/html,application/xhtml+xml' };

function slugCandidates(work) {
  const base = [];
  if (work.ids && work.ids.mcSlug) base.push(work.ids.mcSlug);
  for (const name of [work.title, work.originalTitle].filter(Boolean)) {
    base.push(slugifyDash(name));
    base.push(dropLeadingArticle(slugifyDash(name), '-'));
    if (work.year) base.push(`${slugifyDash(name)}-${work.year}`);
  }
  const seen = new Set();
  return base.map((slug) => (slug || '').toLowerCase()).filter((slug) => slug && slug.length > 2 && !seen.has(slug) && seen.add(slug));
}

function kindsFor(type) {
  return type === 'series' || type === 'anime' ? ['tv', 'movie'] : ['movie', 'tv'];
}

function backendUrl(kind, slug, component, ctx) {
  const params = new URLSearchParams({
    apiKey: ctx.cfg.metacriticApiKey || PUBLIC_API_KEY,
    format: 'json',
    version: ctx.cfg.metacriticVersion || '4.2',
    country: 'us',
    language: (ctx.cfg.language || 'es').slice(0, 2),
  });
  return `https://backend.metacritic.com/review/${kind}/${slug}/component/score/${component}/?${params.toString()}`;
}

async function tryApi(kind, slug, ctx) {
  const [metaRes, userRes] = await Promise.all([
    ctx.http.getJson(backendUrl(kind, slug, 'metascore', ctx), { headers: { Accept: 'application/json' }, timeout: ctx.cfg.timeoutMs, retries: 0 }, { log: ctx.log }),
    ctx.http.getJson(backendUrl(kind, slug, 'userscore', ctx), { headers: { Accept: 'application/json' }, timeout: ctx.cfg.timeoutMs, retries: 0 }, { log: ctx.log }),
  ]);
  const metrics = {};
  if (metaRes.ok && metaRes.json) Object.assign(metrics, parseMetacriticApi(metaRes.json).metrics);
  if (userRes.ok && userRes.json) {
    const userMetrics = parseMetacriticApi(userRes.json).metrics;
    if (userMetrics.mc_user) metrics.mc_user = userMetrics.mc_user;
    if (!metrics.mc_metascore && userMetrics.mc_metascore) metrics.mc_metascore = userMetrics.mc_metascore;
  }
  if (!Object.keys(metrics).length) return null;
  for (const value of Object.values(metrics)) if (value) value.url = `https://www.metacritic.com/${kind}/${slug}/`;
  return { metrics, via: 'api' };
}

async function tryHtml(kind, slug, ctx) {
  const url = `https://www.metacritic.com/${kind}/${slug}/`;
  const res = await ctx.http.request(url, { headers: HEADERS, timeout: ctx.cfg.timeoutMs, retries: 0 }, { log: ctx.log });
  if (!res.ok) return { ok: false, status: res.status, error: res.error };
  const parsed = parseMetacriticPage(res.body, { url });
  if (!Object.keys(parsed.metrics).length) return { ok: false, status: res.status, error: 'no_score' };
  return { ok: true, parsed };
}

const provider = {
  id: 'metacritic',
  label: 'Metacritic',
  emoji: '🎯',

  async lookup(work, ctx) {
    const tried = [];
    for (const slug of slugCandidates(work).slice(0, 3)) {
      for (const kind of kindsFor(work.type)) {
        tried.push(`/${kind}/${slug}`);
        const apiResult = await tryApi(kind, slug, ctx);
        if (apiResult) return { ...apiResult, url: `https://www.metacritic.com/${kind}/${slug}/`, resolved: { mcSlug: slug } };
        const htmlResult = await tryHtml(kind, slug, ctx);
        if (htmlResult.ok) {
          return {
            metrics: htmlResult.parsed.metrics,
            url: htmlResult.parsed.url || `https://www.metacritic.com/${kind}/${slug}/`,
            resolved: { mcSlug: slug },
            via: 'html',
          };
        }
        if (htmlResult.status === 404) continue;
      }
    }

    // última vía: buscador de Metacritic
    const search = await ctx.http.request('https://www.metacritic.com/search/' + encodeURIComponent(work.title || ''), { query: { filterType: 'all' }, headers: HEADERS, timeout: ctx.cfg.timeoutMs }, { log: ctx.log });
    if (search.ok && search.body) {
      const candidates = filterCandidates(parseMetacriticList(search.body), work);
      for (const candidate of candidates.slice(0, 2)) {
        if (!candidate.mcSlug) continue;
        const kind = candidate.type === 'series' ? 'tv' : 'movie';
        const apiResult = await tryApi(kind, candidate.mcSlug, ctx);
        if (apiResult) return { ...apiResult, url: candidate.url, resolved: { mcSlug: candidate.mcSlug } };
        const htmlResult = await tryHtml(kind, candidate.mcSlug, ctx);
        if (htmlResult.ok) return { metrics: htmlResult.parsed.metrics, url: candidate.url, resolved: { mcSlug: candidate.mcSlug }, via: 'search+html' };
      }
    }

    const error = new Error('Metacritic sin respuesta (bloqueo o slug no encontrado)');
    error.code = 'blocked';
    error.attempts = tried;
    throw error;
  },

  async catalog({ type, list, limit = 40, minScore = 60, search }, ctx) {
    const kind = type === 'series' || type === 'anime' ? 'tv' : 'movie';
    if (search) {
      const htmlRes = await ctx.http.request(`https://www.metacritic.com/search/${encodeURIComponent(search)}/`, { query: { filterType: kind === 'tv' ? 'tv_series' : 'movie' }, headers: HEADERS, timeout: ctx.cfg.timeoutMs }, { log: ctx.log });
      if (!htmlRes.ok) throw new Error('Metacritic buscador caído');
      const { filterCandidates } = require('../match');
      return filterCandidates(parseMetacriticList(htmlRes.body), { title: search, type }, { min: 0.35 })
        .slice(0, limit)
        .map((item) => ({ id: `mc:${item.mcSlug}`, title: item.title, year: item.year, score: item.score, url: item.url, source: 'metacritic' }));
    }
    const params = new URLSearchParams({
      apiKey: ctx.cfg.metacriticApiKey || PUBLIC_API_KEY,
      format: 'json',
      version: ctx.cfg.metacriticVersion || '4.2',
      offset: '0',
      limit: String(Math.min(limit, 100)),
      sort: list === 'popular' ? 'user_score.desc' : 'metascore.desc',
      filter: list === 'recent' ? 'released_last_5_years' : 'all',
      scoreRange: String(minScore || 0),
    });
    const browse = `https://backend.metacritic.com/review/${kind}/score/metascore/browse/title/?${params.toString()}`;
    const res = await ctx.http.getJson(browse, { headers: { Accept: 'application/json' }, timeout: ctx.cfg.timeoutMs }, { log: ctx.log });
    if (res.ok && res.json) {
      const items = extractBrowseItems(res.json);
      if (items.length) return items.slice(0, limit);
    }
    const html = await ctx.http.request(
      `https://www.metacritic.com/browse/${kind === 'tv' ? 'tv' : 'movies'}/score/metascore/`,
      { query: { filter: 'all', sort: 'desc' }, headers: HEADERS, timeout: ctx.cfg.timeoutMs },
      { log: ctx.log }
    );
    if (!html.ok) {
      const error = new Error('Metacritic listas caídas');
      error.code = 'unavailable';
      throw error;
    }
    return parseMetacriticList(html.body)
      .slice(0, limit)
      .map((item) => ({
        id: `mc:${item.mcSlug}`,
        title: item.title,
        year: item.year,
        score: item.score,
        url: item.url,
        source: 'metacritic',
      }));
  },
};

/** El browse de Metacritic devuelve {data:{items:[...]}} o {data:{title:{items:[]}}}; lo aplanamos. */
function extractBrowseItems(json) {
  const { deepCollectKey } = require('../util');
  const nodes = deepCollectKey(json, 'items').flat(2).filter((node) => node && typeof node === 'object');
  const seen = new Set();
  const out = [];
  for (const node of nodes) {
    const name = node.name || node.title || (node.headline && node.headline.name) || null;
    const url = node.url || node.link || null;
    const slugMatch = String(url || name || '').match(/\/(movie|tv)\/([a-z0-9\-]+)/i);
    if (!name || !slugMatch) continue;
    const slug = slugMatch[2];
    if (seen.has(slug)) continue;
    seen.add(slug);
    const metrics = node.metrics || node.score || {};
    out.push({
      id: `mc:${slug}`,
      title: name,
      year: node.publicationDate || node.year ? Number(String(node.publicationDate || node.year).slice(0, 4)) : null,
      score: metrics.metascore ? Number(metrics.metascore.value ?? metrics.metascore) : null,
      poster: node.image && (node.image.url || node.image) ? (typeof node.image === 'string' ? node.image : node.image.url) : null,
      url: url || `https://www.metacritic.com/${slugMatch[1]}/${slug}/`,
      source: 'metacritic',
    });
  }
  return out;
}

module.exports = provider;
module.exports.slugCandidates = slugCandidates;
module.exports.backendUrl = backendUrl;
module.exports.PUBLIC_API_KEY = PUBLIC_API_KEY;