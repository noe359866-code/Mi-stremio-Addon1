'use strict';

/**
 * parsers/rottentomatoes.js — Tomatometer (% crítica) y puntuación del público.
 *
 * RT mete sus datos en un <script type="application/prs.init-data+json"> con
 * JSON gigante, además del HTML visible (y del markup viejo `tMeterScore`).
 * Se prueban las tres vías para sobrevivir a sus rediseños.
 */

const {
  extractJsonScripts,
  deepFindKey,
  deepCollectKey,
  parseScoreLoose,
  parseCountLoose,
  metaContent,
  firstMatch,
  yearFrom,
  decodeEntities,
  forEachMatch,
} = require('../util');

const CRITIC_PATTERNS = [
  /"criticsScore"\s*:\s*"?(\d{1,3})"?/i,
  /"tomatometer(?:Score)?"\s*:\s*"?(\d{1,3})"?/i,
  /"criticScore"\s*:\s*"?(\d{1,3})"?/i,
  /"score"\s*:\s*(\d{1,3})\s*,\s*"scoreText"/i,
  /data-qa="critics-score[^"]*"[^>]*>[\s\S]{0,120}?(\d{1,3})\s*%/i,
  /class="tMeterScore">\s*(\d{1,3})\s*%/i,
  /"criticsRating"\s*:\s*"[^"]*"\s*,\s*"score"\s*:\s*(\d{1,3})/i,
];

const AUDIENCE_PATTERNS = [
  /"audienceScore"\s*:\s*"?(\d{1,3})"?/i,
  /"verifiedAudienceScore"\s*:\s*"?(\d{1,3})"?/i,
  /"userScore"\s*:\s*"?(\d{1,3})"?/i,
  /"audienceVerifiedRating"\s*:[\s\S]{0,80}?"score"\s*:\s*(\d{1,3})/i,
  /data-qa="audience-score[^"]*"[^>]*>[\s\S]{0,140}?(\d{1,3})\s*%/i,
  /class="audience-score[^"]*"[^>]*>\s*(\d{1,3})/i,
  /([\d]{1,3})%\s*audience/i,
];

const CONSENSUS_PATTERNS = [
  /"criticsConsensus"\s*:\s*\{\s*"consensus"\s*:\s*"((?:[^"\\]|\\.)*)"/i,
  /data-qa="critics-consensus"[^>]*>[\s\S]{0,80}?<span[^>]*>([^<]{10,400})</i,
  /class="meters-critics-consensus"[\s\S]{0,300}?"([^"]{10,400})"/i,
];

const REVIEW_COUNT_PATTERNS = [
  /"criticsCount"\s*:\s*"?(\d[\d.,]*)"?/i,
  /"score"\s*:\s*\d{1,3}\s*,\s*"count"\s*:\s*"?(\d[\d.,]*)"?/i,
  /\(\s*(\d[\d.,]*)\s*(?:Critics|reviews)\s*\)/i,
  /(\d[\d.,]*)\s+Critics\s+Reviews/i,
];

const AUDIENCE_COUNT_PATTERNS = [
  /"audienceScoreCount"\s*:\s*"?(\d[\d.,]*)"?/i,
  /"ratingsCount"\s*:\s*"?(\d[\d.,]*)"?/i,
  /\(\s*(\d[\d.,]*[KMkm]?)\s*(?:Verified Ratings|Verified Ratings|ratings)\s*\)/i,
  /([\d.,]+[KMkm]?)\s+Verified Ratings/i,
  /([\d.,]+[KMkm]?)\s+Audience Ratings/i,
];

function parseRtPage(html) {
  const out = { metrics: {}, title: null, year: null, type: null, poster: null, rtSlug: null, ok: false };
  if (!html || html.length < 300) return out;

  const selfUrl = metaContent(html, 'og:url') || (html.match(/rel="canonical" href="([^"]+)"/i) || [])[1];
  if (selfUrl) {
    const slugMatch = selfUrl.match(/\/(m|tv)\/([a-z0-9_\-]+)/i);
    if (slugMatch) {
      out.type = slugMatch[1].toLowerCase() === 'tv' ? 'series' : 'movie';
      out.rtSlug = slugMatch[2];
      out.url = selfUrl;
    }
  }
  const ogTitle = metaContent(html, 'og:title');
  if (ogTitle) {
    out.title = decodeEntities(ogTitle).replace(/\s*[-–]\s*Rotten Tomatoes.*$/i, '').trim();
    out.year = yearFrom(out.title);
    if (!out.type) out.type = /\bTV\b|Series/i.test(ogTitle) ? 'series' : 'movie';
  }
  out.poster = metaContent(html, 'og:image');

  let critics = null;
  let audience = null;
  let criticCount = null;
  let audienceCount = null;
  let consensus = null;

  for (const blob of extractJsonScripts(html)) {
    if (!blob.data) continue;
    const c = deepFindKey(blob.data, ['criticsScore', 'tomatometerScore', 'criticScore'], { maxDepth: 18 });
    if (critics === null && c !== undefined) critics = c;
    const a = deepFindKey(blob.data, ['audienceScore', 'verifiedAudienceScore', 'userScore'], { maxDepth: 18 });
    if (audience === null && a !== undefined) audience = a;
    const cc = deepFindKey(blob.data, ['criticsCount', 'scoreCount', 'totalReviews'], { maxDepth: 18 });
    if (criticCount === null && cc !== undefined) criticCount = cc;
    const ac = deepFindKey(blob.data, ['audienceScoreCount', 'ratingsCount'], { maxDepth: 18 });
    if (audienceCount === null && ac !== undefined) audienceCount = ac;
    if (!consensus) {
      const found = deepFindKey(blob.data, ['consensus'], { maxDepth: 18 });
      if (typeof found === 'string' && found.length > 10) consensus = found;
    }
    if (!out.title) {
      const name = deepFindKey(blob.data, ['contentTitle', 'title', 'name'], { maxDepth: 6 });
      if (typeof name === 'string' && name.length > 1) out.title = name;
    }
  }

  // JSON-LD (algunas variantes publican aggregateRating en escala 0-10)
  if (critics === null) {
    for (const blob of extractJsonScripts(html)) {
      if (!blob.data || blob.type !== 'script' || !/ld\+json/i.test(blob.label || '')) continue;
      const rating = deepFindKey(blob.data, ['ratingValue'], { maxDepth: 10 });
      const parsed = parseScoreLoose(rating);
      if (parsed !== null) {
        critics = parsed <= 10 ? Math.round(parsed * 10) : parsed;
        break;
      }
    }
  }

  if (critics === null) critics = firstMatch(html, CRITIC_PATTERNS);
  if (audience === null) audience = firstMatch(html, AUDIENCE_PATTERNS);
  if (criticCount === null) criticCount = firstMatch(html, REVIEW_COUNT_PATTERNS);
  if (audienceCount === null) audienceCount = firstMatch(html, AUDIENCE_COUNT_PATTERNS);
  if (!consensus) consensus = firstMatch(html, CONSENSUS_PATTERNS);

  const criticValue = parseScoreLoose(critics);
  const audienceValue = parseScoreLoose(audience);

  if (criticValue !== null && criticValue >= 0 && criticValue <= 100) {
    out.metrics.rt_tomatometer = {
      value: criticValue,
      votes: parseCountLoose(criticCount),
      text: consensus ? decodeEntities(consensus.replace(/\\'/g, "'").replace(/\\u2019/g, "'")) : null,
      url: out.url || (out.rtSlug ? `https://www.rottentomatoes.com/${out.type === 'series' ? 'tv' : 'm'}/${out.rtSlug}` : null),
    };
    out.ok = true;
  }
  if (audienceValue !== null && audienceValue >= 0 && audienceValue <= 100) {
    out.metrics.rt_audience = { value: audienceValue, votes: parseCountLoose(audienceCount), url: out.metrics.rt_tomatometer ? out.metrics.rt_tomatometer.url : null };
    out.ok = true;
  }
  if (out.metrics.rt_tomatometer && consensus) out.consensus = decodeEntities(consensus);
  return out;
}

/**
 * JSON de la API de búsqueda interna de RT (varias versiones de endpoint).
 * Devuelve candidatos ordenados con su slug, título, año y nota (si viene).
 */
function parseRtSearchJson(json, { title, year } = {}) {
  if (!json) return [];
  const raw = [];
  const arrays = [];
  for (const key of ['movies', 'tvShows', 'tv_shows', 'results', 'data']) {
    const value = json[key];
    if (Array.isArray(value)) arrays.push(...value);
  }
  if (!arrays.length && Array.isArray(json)) arrays.push(...json);
  if (!arrays.length) {
    // estructura genérica: buscamos cualquier objeto con url de /m/ o /tv/
    for (const node of deepCollectKey(json, 'url')) {
      if (typeof node === 'string' && /^\/(m|tv)\//.test(node)) arrays.push({ url: node });
    }
    const inner = json && json.hits ? json.hits : null;
    if (Array.isArray(inner)) arrays.push(...inner);
  }

  for (const entry of arrays) {
    if (!entry || typeof entry !== 'object') continue;
    const href = entry.url || entry.contentUrl || entry.content_url || entry.link || '';
    const slugMatch = String(href).match(/\/(m|tv)\/([a-z0-9_\-]+)/i);
    if (!slugMatch) continue;
    const candidate = {
      type: slugMatch[1].toLowerCase() === 'tv' ? 'series' : 'movie',
      rtSlug: slugMatch[2],
      title: decodeEntities(entry.title || entry.name || entry.originalTitle || slugMatch[2].replace(/_/g, ' ')),
      year: yearFrom(entry.year || entry.releaseYear || entry.premiereDate || href),
      score: parseScoreLoose(entry.criticScore ?? entry.criticsScore ?? entry.score ?? entry.tomatometer),
      runtime: entry.runtime || null,
    };
    raw.push(candidate);
  }

  return rankCandidates(raw, { title, year });
}

/** Simplemente ordena por coincidencia de título (+año). */
function rankCandidates(list, { title, year } = {}) {
  const { titleSimilarity } = require('../util');
  return list
    .map((item) => {
      let score = 0;
      const similarity = Math.max(titleSimilarity(item.title, title), titleSimilarity(item.rtSlug?.replace(/[_-]/g, ' '), title));
      score += similarity * 2;
      if (year && item.year === year) score += 1;
      else if (year && item.year && Math.abs(item.year - year) > 1) score -= 0.7;
      if (item.score !== null && item.score !== undefined) score += 0.15;
      return { item, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item);
}

/** HTML de /search?search=... o de /browse/... -> slugs detectados. */
function parseRtHtmlList(html) {
  const seen = new Set();
  return forEachMatch(html, /href="(\/(?:m|tv)\/[a-z0-9_\-]+)"/i, 1500, (match, chunk) => {
    const href = match[1];
    if (!href || seen.has(href)) return null;
    const slug = href.match(/\/(?:m|tv)\/([a-z0-9_\-]+)/i);
    if (!slug) return null;
    const title = firstMatch(chunk, [
      /class="[^"]*(?:result__title|article__title|media-object-section__title)[^"]*"[^>]*>[\s\S]{0,120}?>([^<]{2,140})</i,
      /alt="([^"]{2,140})"/i,
      /title="([^"]{2,140})"[^>]*>/i,
    ]);
    const score = firstMatch(chunk, [/class="tMeterScore">\s*(\d{1,3})\s*%/i, /"criticsScore"\s*:\s*"?(\d{1,3})"?/i, /(\d{1,3})%/]);
    seen.add(href);
    return {
      type: href.startsWith('/tv') ? 'series' : 'movie',
      rtSlug: slug[1],
      url: `https://www.rottentomatoes.com${href}`,
      title: title ? decodeEntities(title).trim() : slug[1].replace(/_/g, ' '),
      year: yearFrom(chunk.slice(0, 900)),
      score: score ? Number(score) : null,
    };
  }).filter(Boolean);
}

module.exports = { parseRtPage, parseRtSearchJson, parseRtHtmlList, rankCandidates };
