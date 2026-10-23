'use strict';

/**
 * parsers/imdb.js — extrae la puntuación de IMDb desde el HTML de la ficha
 * (`/title/ttXXXX/` o `/title/ttXXXX/rating/`).
 *
 * IMDb no tiene API pública y su HTML es una app React: la nota vive en varios
 * sitios a la vez (JSON-LD, estado embebido, badge visible). Probamos en ese
 * orden y devolvemos lo primero que sea plausible.
 */

const {
  extractJsonScripts,
  deepFindKey,
  deepFind,
  parseScoreLoose,
  parseCountLoose,
  yearFrom,
  metaContent,
  firstMatch,
  decodeEntities,
  stripYearSuffix,
} = require('../util');

const RATING_PATTERNS = [
  /"ratingValue"\s*:\s*"?(\d+[.,]\d+)/i,
  /"ratedValue"\s*:\s*"?(\d+[.,]\d+)/i,
  /"stars"\s*:\s*"?(\d+[.,]\d+)/i,
  /class="ipc-rating-star--rating"[^>]*>\s*<b>\s*(\d+[.,]\d+)/i,
  /(\d+[.,]\d)\s*\/\s*10\s*(?:<|&lt;)/i,
  /aria-label="[^"]*?(\d+[.,]\d)\s*(?:out of|de)\s*10/i,
  /<span[^>]*>\s*(\d+[.,]\d)\s*<[^>]*>\s*\/\s*10/i,
  /Rating\s*:?\s*<b[^>]*>\s*(\d+[.,]\d)/i,
];

const VOTES_PATTERNS = [
  /"voteCount"\s*:\s*"?(\d[\d.,]*)"?/i,
  /"numVotes"\s*:\s*"?(\d[\d.,]*)"?/i,
  /class="ipc-rating-star--vote-count"[^>]*>\s*\(?\s*([\d.,]+[KMkm]?)/i,
  /class="number-of-votes[^"]*"[^>]*>\s*([\d.,]+)\s+votes/i,
  />\s*([\d.,]+[KMkm]?)\s+votes\s*</i,
  /\(\s*([\d.,]+[KMkm]?)\s*\)\s*(?:votes|valoraciones)/i,
];

const TOP250_PATTERNS = [
  /"topRated"\s*:\s*\{[^{}]{0,120}?"rank"\s*:\s*(\d{1,3})/i,
  />\s*#(\d{1,3})\s+in\s+Top\s+250/i,
  /#(\d{1,3})\s+in\s+Top\s+(?:250|Rated)/i,
  /"rank"\s*:\s*(\d{1,3})\s*,\s*"[^"]*"\s*:\s*"#?(\d{1,3})/i,
];

const METASCORE_PATTERNS = [
  /"metascoreScore"\s*:\s*"?(\d{1,3})"?/i,
  /"metascore"\s*:\s*\{[^{}]{0,160}?"text"\s*:\s*"?(\d{1,3})/i,
  /Metascore[\s\S]{0,120}?(\d{1,3})\s*(?:<span|<\/|\bcritics\b)/i,
];

/** @returns {{metrics:object, imdbId:?string, title:?string, year:?number, poster:?string, ok:boolean}} */
function parseImdbPage(html, { imdbId } = {}) {
  const result = { metrics: {}, imdbId: imdbId || null, title: null, year: null, poster: null, ok: false };
  if (!html || html.length < 200) return result;

  const canonical = html.match(/imdb\.com\/(?:title|name)\/(tt\d{6,10})/) || html.match(/rel="canonical"[^>]*\/title\/(tt\d{6,10})/);
  if (canonical) result.imdbId = canonical[1];
  if (!result.imdbId) {
    const ogUrl = metaContent(html, 'og:url');
    const ogMatch = ogUrl && ogUrl.match(/tt\d{6,10}/);
    if (ogMatch) result.imdbId = ogMatch[0];
  }

  const ogTitle = metaContent(html, 'og:title');
  if (ogTitle) {
    result.title = decodeEntities(ogTitle.replace(/\s*[–-]\s*IMDb\s*$/i, ''));
    result.year = yearFrom(ogTitle);
  } else {
    const h1 = html.match(/<h1[^>]*id="titleHeading"[^>]*>[\s\S]{0,200}?>([^<]+)</);
    if (h1) result.title = decodeEntities(h1[1]);
  }
  result.poster = metaContent(html, 'og:image');

  const blobs = extractJsonScripts(html);
  let ratingValue = null;
  let votes = null;

  for (const blob of blobs) {
    if (!blob.data) continue;
    if (ratingValue === null) {
      ratingValue = deepFindKey(blob.data, ['ratingValue', 'voteAverage', 'averageRating'], { maxDepth: 16 });
    }
    if (votes === null) {
      votes = deepFindKey(blob.data, ['voteCount', 'numVotes', 'votes'], { maxDepth: 16 });
    }
    if (!result.top250) {
      const topRated = deepFind(
        blob.data,
        (node, key) => (String(key).toLowerCase() === 'toprated' && node && typeof node === 'object' ? node : undefined),
        { maxDepth: 16 }
      );
      if (topRated && (topRated.rank || topRated.position)) result.top250 = Number(topRated.rank || topRated.position) || null;
    }
    if (!result.metascoreFromImdb) {
      const metascore = deepFindKey(blob.data, ['metascoreScore'], { maxDepth: 16 });
      if (metascore !== undefined) result.metascoreFromImdb = parseScoreLoose(metascore);
    }
  }

  if (ratingValue === null || !Number.isFinite(Number(ratingValue))) {
    ratingValue = parseScoreLoose(firstMatch(html, RATING_PATTERNS));
  } else {
    ratingValue = parseScoreLoose(ratingValue);
  }

  if (votes === null || !Number.isFinite(Number(votes))) {
    votes = parseCountLoose(firstMatch(html, VOTES_PATTERNS));
  } else {
    votes = parseCountLoose(votes);
  }

  if (!result.top250) {
    const rank = firstMatch(html, TOP250_PATTERNS);
    if (rank) result.top250 = Number(rank) || null;
  }

  if (!result.metascoreFromImdb) {
    const mc = firstMatch(html, METASCORE_PATTERNS);
    if (mc) result.metascoreFromImdb = Number(mc) || null;
  }

  if (!result.title) {
    const titleMatch = html.match(/<title>\s*([^<(]{2,120})\s*\((\d{4})\)/);
    if (titleMatch) {
      result.title = decodeEntities(titleMatch[1].trim());
      result.year = result.year || Number(titleMatch[2]);
    }
  }

  // sanity check: la nota de IMDb siempre está entre 1 y 10
  if (ratingValue !== null && ratingValue >= 0.5 && ratingValue <= 10) {
    result.metrics.imdb = { value: ratingValue, votes, url: result.imdbId ? `https://www.imdb.com/title/${result.imdbId}/` : null };
    if (result.top250) result.metrics.imdb.rank = result.top250;
    result.ok = true;
  }
  if (result.metascoreFromImdb && result.metascoreFromImdb >= 1 && result.metascoreFromImdb <= 100) {
    result.metrics.mc_metascore = {
      value: result.metascoreFromImdb,
      derived: 'imdb',
      url: 'https://www.metacritic.com/',
    };
  }
  if (result.top250) result.rank = result.top250;
  return result;
}

/** Resultados / listas de IMDb (Top 250, chart toptv, search) -> items con nota. */
function parseImdbList(html) {
  const { forEachMatch } = require('../util');
  const seen = new Set();
  const collected = forEachMatch(html, /(?:data-title-id="|href="\/title\/)(tt\d{6,10})/i, 2600, (match, chunk) => {
    const id = match[1] || (chunk.match(/tt\d{6,10}/) || [])[0];
    if (!id || seen.has(id)) return null;
    const title =
      firstMatch(chunk, [
        /ipc-title__text"[^>]*>\s*(?:\d+\.\s*)?([^<]{2,160})</i,
        /lister-item-header[\s\S]{0,240}?<a[^>]*>([^<]{2,160})<\/a>/i,
        /<a[^>]+href="\/title\/tt\d{6,10}\/?"[^>]*title="([^"]{2,160})"/i,
        /alt="([^"]{2,120})"/i,
      ]);
    const yearRaw = firstMatch(chunk, [/\((19\d{2}|20\d{2})\)/, /"releaseYear"\s*:\s*(\d{4})/]);
    const rating = firstMatch(chunk, [
      /"ratingValue"\s*:\s*"?(\d+[.,]\d+)/i,
      /ipc-rating-star--imdb[\s\S]{0,220}?(\d+[.,]\d)/i,
      /class="ipc-rating-star--rating"[^>]*>\s*<b>\s*(\d+[.,]\d+)/i,
      /class="rating-rate"[^>]*>\s*(\d+[.,]\d)/i,
      /(\d+[.,]\d)\/10/,
    ]);
    const votesRaw = firstMatch(chunk, [
      /"voteCount"\s*:\s*(\d+)/,
      /class="ipc-rating-star--vote-count"[^>]*>\s*\(?\s*([\d.,]+[KMkm]?)\s*\)?/i,
      /([\d.,]+[KMkm]?)\s+votes/i,
    ]);
    const poster = firstMatch(chunk, [/src="(https:\/\/m\.media-amazon\.com\/[^"]+?\.jpg)"/i, /"imageUrl"\s*:\s*"(https:[^"]+)"/]);
    if (!title && !rating) return null;
    seen.add(id);
    return {
      id: `imdb:${id}`,
      imdbId: id,
      title: title ? stripYearSuffix(decodeEntities(title).replace(/^\d+\.\s*/, '')).trim() : id,
      year: yearRaw ? Number(yearRaw) : null,
      score: rating ? parseScoreLoose(rating) : null,
      votes: votesRaw ? parseCountLoose(votesRaw) : null,
      poster: poster ? poster.replace(/_V1_.*$/, '_V1_SY1000_CR0,0,674,1000_AL_.jpg') : null,
      url: `https://www.imdb.com/title/${id}/`,
    };
  });
  return collected.filter(Boolean);
}

/**
 * Respuesta de la API de OMDb (imdbapi.org) — fallback opcional y muy fiable.
 * `omdb.Ratings` incluye IMDb, Rotten Tomatoes y Metacritic de golpe.
 */
function parseOmdb(omdbJson) {
  const out = { metrics: {}, found: false };
  if (!omdbJson || omdbJson.Response === 'False' || (!omdbJson.Title && !omdbJson.imdbID)) return out;
  out.found = true;
  out.title = omdbJson.Title || null;
  out.originalTitle = omdbJson.Title || null;
  out.year = yearFrom(omdbJson.Year);
  out.imdbId = omdbJson.imdbID || null;
  out.poster = omdbJson.Poster && /^https?:/.test(omdbJson.Poster) ? omdbJson.Poster : null;
  out.type = /series/i.test(omdbJson.Type || '') ? 'series' : 'movie';
  if (omdbJson.imdbRating) {
    out.metrics.imdb = {
      value: parseScoreLoose(omdbJson.imdbRating),
      votes: parseCountLoose(omdbJson.imdbVotes),
      url: out.imdbId ? `https://www.imdb.com/title/${out.imdbId}/` : null,
    };
  }
  for (const entry of omdbJson.Ratings || []) {
    const value = parseScoreLoose(entry.Value);
    if (value === null) continue;
    if (/rotten\s*tomatoes/i.test(entry.Source)) out.metrics.rt_tomatometer = { value, derived: 'omdb' };
    if (/metacritic/i.test(entry.Source)) out.metrics.mc_metascore = { value, derived: 'omdb' };
    if (/internet\s*movie\s*database/i.test(entry.Source) && !out.metrics.imdb) out.metrics.imdb = { value, derived: 'omdb' };
  }
  return out;
}

module.exports = { parseImdbPage, parseImdbList, parseOmdb };
