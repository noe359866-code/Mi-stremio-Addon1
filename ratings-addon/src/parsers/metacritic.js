'use strict';

/**
 * parsers/metacritic.js — Metascore (crítica) y User Score.
 *
 * Metacritic sirve sus datos desde dos sitios:
 *   1) El endpoint JSON interno `backend.metacritic.com/.../component/score/...`
 *   2) El HTML de la ficha, donde hay blobs JSON + atributos data-metric.
 * Ambos se soportan.
 */

const {
  extractJsonScripts,
  deepFindKey,
  deepFind,
  parseScoreLoose,
  parseCountLoose,
  metaContent,
  firstMatch,
  yearFrom,
  decodeEntities,
  forEachMatch,
} = require('../util');

const METASCORE_PATTERNS = [
  /"metascore"\s*:\s*"?(\d{1,3})"?/i,
  /"metaScore"\s*:\s*\{[^{}]{0,120}?"score"\s*:\s*(\d{1,3})/i,
  /data-metric="metascore[^"]*"[^>]*>\s*(\d{1,3})/i,
  /Metascore[\s\S]{0,180}?(\d{1,3})(?:\s*<|\s*\/\s*100)/i,
  /"criticScoreSummary"[\s\S]{0,120}?"score"\s*:\s*(\d{1,3})/i,
  /class="metascore"[^>]*>\s*(\d{1,3})/i,
];

const USERSCORE_PATTERNS = [
  /"userscore"\s*:\s*\{[^{}]{0,200}?"value"\s*:\s*(\d+[.,]\d)/i,
  /"userscore"\s*:\s*"?(\d+[.,]\d)"?/i,
  /"userScore"\s*:\s*"?(\d+[.,]\d)"?/i,
  /data-metric="userscore[^"]*"[^>]*>\s*(\d+[.,]\d)/i,
  /User [Ss]core[\s\S]{0,180}?(\d[.,]\d)(?:\s*<|\s*\/\s*10)/i,
];

const USER_COUNT_PATTERNS = [
  /"userscore"\s*:\s*\{[^{}]{0,300}?"voteCount"\s*:\s*"?(\d[\d.,]*)"?/i,
  /\(\s*(\d[\d.,]*[KMkm]?)\s*user ratings\s*\)/i,
  /([\d.,]+[KMkm]?)\s*User Ratings/i,
];

/** Lee la respuesta del API interno de Metacritic (formato {data:{metrics}}). */
function parseMetacriticApi(json) {
  const out = { metrics: {}, ok: false };
  if (!json || typeof json !== 'object') return out;
  const metrics = deepFindKey(json, ['metrics'], { maxDepth: 6, allowObject: true }) || json;

  const metascoreNode = deepFind(
    metrics,
    (node, key) => (String(key).toLowerCase() === 'metascore' && node && typeof node === 'object' ? node : undefined),
    { maxDepth: 8 }
  );
  const userNode = deepFind(metrics, (node, key) => (String(key).toLowerCase() === 'userscore' && node && typeof node === 'object' ? node : undefined), {
    maxDepth: 8,
  });

  const meta = parseScoreLoose(metascoreNode ? (metascoreNode.value ?? metascoreNode.score ?? metascoreNode) : undefined);
  const user = parseScoreLoose(userNode ? (userNode.value ?? userNode.score ?? userNode) : undefined);
  const criticCount = metascoreNode ? parseCountLoose(metascoreNode.count ?? metascoreNode.totalReviews) : null;
  const userCount = userNode ? parseCountLoose(userNode.voteCount ?? userNode.count) : null;

  if (meta !== null && meta >= 0 && meta <= 100) {
    out.metrics.mc_metascore = { value: meta, votes: criticCount };
    out.ok = true;
  }
  if (user !== null && user >= 0 && user <= 10) {
    out.metrics.mc_user = { value: user, votes: userCount };
    out.ok = true;
  }
  return out;
}

function parseMetacriticPage(html, { url } = {}) {
  const out = { metrics: {}, title: null, year: null, poster: null, mcSlug: null, ok: false };
  if (!html || html.length < 300) return out;

  const selfUrl = url || metaContent(html, 'og:url') || (html.match(/rel="canonical" href="([^"]+)"/i) || [])[1];
  if (selfUrl) {
    const slugMatch = selfUrl.match(/\/(movie|tv)\/([a-z0-9\-]+)/i);
    if (slugMatch) {
      out.type = slugMatch[1].toLowerCase() === 'tv' ? 'series' : 'movie';
      out.mcSlug = slugMatch[2];
      out.url = selfUrl;
    }
  }
  const ogTitle = metaContent(html, 'og:title');
  if (ogTitle) {
    out.title = decodeEntities(ogTitle).replace(/\s*[–-]\s*Metacritic.*$/i, '').trim();
    out.year = yearFrom(out.title);
  }
  out.poster = metaContent(html, 'og:image');

  let metascore = null;
  let userScore = null;
  let criticCount = null;
  let userCount = null;

  for (const blob of extractJsonScripts(html)) {
    if (!blob.data) continue;
    const api = parseMetacriticApi(blob.data);
    if (api.metrics.mc_metascore) {
      metascore = metascore ?? api.metrics.mc_metascore.value;
      criticCount = criticCount ?? api.metrics.mc_metascore.votes;
    }
    if (api.metrics.mc_user) {
      userScore = userScore ?? api.metrics.mc_user.value;
      userCount = userCount ?? api.metrics.mc_user.votes;
    }
    if (metascore === null) {
      const value = deepFindKey(blob.data, ['metascore', 'metaScore'], { maxDepth: 16 });
      if (value !== undefined) metascore = parseScoreLoose(value);
    }
  }

  if (metascore === null) metascore = parseScoreLoose(firstMatch(html, METASCORE_PATTERNS));
  if (userScore === null) userScore = parseScoreLoose(firstMatch(html, USERSCORE_PATTERNS));
  if (criticCount === null) criticCount = parseCountLoose(firstMatch(html, [/"totalReviews"\s*:\s*(\d+)/i, /\(\s*(\d{1,4})\s*Critics?\)/i]));
  if (userCount === null) userCount = parseCountLoose(firstMatch(html, USER_COUNT_PATTERNS));

  // JSON-LD: algunas fichas publican aggregateRating en escala 0-100
  if (metascore === null) {
    for (const blob of extractJsonScripts(html)) {
      if (!blob.data || !/ld\+json/i.test(blob.label || '')) continue;
      const value = parseScoreLoose(deepFindKey(blob.data, ['ratingValue'], { maxDepth: 10 }));
      const best = parseScoreLoose(deepFindKey(blob.data, ['bestRating'], { maxDepth: 10 }));
      if (value === null) continue;
      metascore = best && best <= 10 ? Math.round(value * 10) : value;
      break;
    }
  }

  if (metascore !== null && metascore >= 0 && metascore <= 100) {
    out.metrics.mc_metascore = { value: metascore, votes: criticCount, url: out.url };
    out.ok = true;
  }
  if (userScore !== null && userScore >= 0 && userScore <= 10) {
    out.metrics.mc_user = { value: userScore, votes: userCount, url: out.url };
    out.ok = true;
  }
  return out;
}

/** Listas / resultados de búsqueda de metacritic.com -> slugs con nota. */
function parseMetacriticList(html) {
  const seen = new Set();
  return forEachMatch(html, /href="(\/(?:movie|tv)\/[a-z0-9\-]+)\/?"/i, 1400, (match, chunk) => {
    const href = match[1];
    if (!href || seen.has(href)) return null;
    const slug = href.match(/\/(?:movie|tv)\/([a-z0-9\-]+)/i);
    if (!slug) return null;
    if (/^(aliases|cast|reviews|credits|company|news)$/.test(slug[1])) return null;
    const title = firstMatch(chunk, [
      /class="[^"]*(?:component-title|c-media-object__title|c-discrete-listing-media-hybrid__title)[^"]*"[\s\S]{0,220}?>([^<]{2,140})</i,
      /alt="([^"]{2,140})"/i,
      /title="([^"]{2,140})"/i,
    ]);
    const score = firstMatch(chunk, [/data-metric="metascore[^"]*"[^>]*>\s*(\d{1,3})/i, /"metascore"\s*:\s*"?(\d{1,3})"?/i]);
    seen.add(href);
    return {
      type: href.startsWith('/tv') ? 'series' : 'movie',
      mcSlug: slug[1],
      url: `https://www.metacritic.com${href}`,
      title: title ? decodeEntities(title).trim() : slug[1].replace(/-/g, ' '),
      year: yearFrom(chunk.slice(0, 900)),
      score: score ? Number(score) : null,
    };
  }).filter(Boolean);
}

module.exports = { parseMetacriticApi, parseMetacriticPage, parseMetacriticList };
