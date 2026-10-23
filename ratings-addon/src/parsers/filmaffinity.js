'use strict';

/**
 * parsers/filmaffinity.js — nota y votos de FilmAffinity (la fuente en español).
 *
 * FilmAffinity usa coma decimal y puntos de millar: "7,4 (98.123 votos)".
 * Además la ficha enlaza a IMDb, lo aprovechamos para cross-resolver IDs.
 */

const {
  parseScoreLoose,
  parseCountLoose,
  metaContent,
  firstMatch,
  yearFrom,
  decodeEntities,
  forEachMatch,
  extractJsonScripts,
  deepFindKey,
} = require('../util');

const RATING_PATTERNS = [
  /class="rating_b"[^>]*>\s*<b[^>]*>\s*(\d(?:[.,]\d{1,2})?)/i,
  /<b class="b mlarge">\s*(\d(?:[.,]\d{1,2})?)\s*</i,
  /id="rating"[\s\S]{0,400}?<b[^>]*>\s*(\d(?:[.,]\d{1,2})?)/i,
  /Rating:\s*<b[^>]*>\s*(\d(?:[.,]\d{1,2})?)/i,
  /class="mc-rating"[^>]*>\s*(\d(?:[.,]\d{1,2})?)/i,
  /"ratingValue"\s*:\s*"?(\d(?:[.,]\d{1,2})?)"?/i,
  /<b>\s*(\d(?:[.,]\d)?)\s*<\/b>\s*<span[^>]*>\s*10/i,
];

const VOTES_PATTERNS = [
  /class="ratingv"[\s\S]{0,160}?\(\s*([\d.]+)\s*votos/i,
  /\(\s*([\d.]+)\s*votos\s*\)/i,
  /([\d.]+)\s*valoraciones/i,
  /"votes"\s*:\s*"?([\d.]+)"?/i,
  /"voteCount"\s*:\s*"?(\d+)"?/i,
];

const TOP_PATTERNS = [
  /Top\s*(?:200|250)[\s\S]{0,200}?#\s*(\d{1,3})\b/i,
  /#\s*(\d{1,3})\s+en el Top\s*(?:200|250)/i,
  /comp-top(?:200|250)[\s\S]{0,220}?#(\d{1,3})/i,
  /"top250Rank"\s*:\s*(\d{1,3})/i,
];

function parseFilmaffinityPage(html, { url } = {}) {
  const out = { metrics: {}, title: null, year: null, poster: null, imdbId: null, faId: null, ok: false };
  if (!html || html.length < 200) return out;

  const ogTitle = metaContent(html, 'og:title');
  if (ogTitle) {
    const clean = decodeEntities(ogTitle).replace(/\s*[|–-]\s*FilmAffinity.*$/i, '').trim();
    out.title = clean;
    out.year = yearFrom(clean);
  } else {
    const h1 = html.match(/<h1[^>]*id="doctitle"[^>]*>\s*([\s\S]{0,180}?)<\/h1>/i);
    if (h1) {
      out.title = decodeEntities(h1[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
      out.year = yearFrom(out.title);
    }
  }
  out.poster = metaContent(html, 'og:image');

  const fromUrl = (url || '').match(/(?:film|tv|series|movie)(\d{5,10})\.html/i);
  if (fromUrl) out.faId = fromUrl[1];
  const canonical = html.match(/filmaffinity\.com\/[a-z]{2}\/(film|tv|tvseries|series)(\d{5,10})\.html/i);
  if (canonical) out.faId = canonical[2];

  const imdbMatch = html.match(/imdb\.com\/(?:title|es\/title)\/(tt\d{6,10})/i);
  if (imdbMatch) out.imdbId = imdbMatch[1];

  let rating = null;
  let votes = null;
  for (const blob of extractJsonScripts(html)) {
    if (!blob.data) continue;
    if (rating === null) rating = parseScoreLoose(deepFindKey(blob.data, ['ratingValue'], { maxDepth: 12 }));
    if (votes === null) votes = parseCountLoose(deepFindKey(blob.data, ['voteCount', 'votes'], { maxDepth: 12 }));
  }
  if (rating === null) rating = parseScoreLoose(firstMatch(html, RATING_PATTERNS));
  if (votes === null) votes = parseCountLoose(firstMatch(html, VOTES_PATTERNS));
  const rank = firstMatch(html, TOP_PATTERNS);

  if (rating !== null && rating > 0 && rating <= 10) {
    out.metrics.filmaffinity = {
      value: rating,
      votes,
      rank: rank ? Number(rank) : null,
      url: url || (out.faId ? `https://www.filmaffinity.com/es/film${out.faId}.html` : null),
    };
    out.ok = true;
  }
  return out;
}

/**
 * Resultados de `busca.php` / listas tipo `tdtop.php`.
 * Estructura típica: <a href="film123.html" class="gt hid esc search-res">Título <small>(2010)</small></a>
 *                  ... Rating: <b class="b">8,1</b> <span class="ratingv"><small>( 12.345 votos )</small></span>
 */
function parseFilmaffinityList(html) {
  const seen = new Set();
  const collected = forEachMatch(html, /href="([^"]*?(?:film|tvseries|tv|series)(\d{5,10})\.html)"[^>]*>([\s\S]{0,300}?)<\/a>/gi, 1500, (match, chunk) => {
    const href = match[1];
    const faId = match[2];
    const anchorHtml = match[3] || '';
    if (!faId || seen.has(faId)) return null;
    const titleFromAnchor = decodeEntities(anchorHtml.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    const year = yearFrom(titleFromAnchor) || yearFrom(chunk.slice(0, 700));
    const title = titleFromAnchor
      ? titleFromAnchor.replace(/\s*\((?:19|20)\d{2}\)\s*$/, '').trim()
      : firstMatch(chunk, [/class="[^"]*search-res[^"]*"[^>]*>([^<]{2,140})</i]);
    const ratingRaw = firstMatch(chunk, [/class="rating\d"[^>]*>\s*(\d[.,]\d{1,2})/i, /<b[^>]*>\s*(\d,\d{1,2})\s*</i, /Rating:\s*([\d,]+)/i]);
    const votesRaw = firstMatch(chunk, [/\(\s*([\d.]+)\s*votos/i, /class="ratingv"[\s\S]{0,120}?([\d.]+)\s*votos/i]);
    const poster = firstMatch(chunk, [/src="(https:\/\/[^"]*filmaffinity[^"]*\/(?:us|es)\/posters\/[^"]+)"/i, /src="(https:\/\/[^"]+\.jpg)"/i]);
    seen.add(faId);
    return {
      faId,
      href: /^https?:/.test(href) ? href : `https://www.filmaffinity.com/${href.replace(/^\/+/, '')}`,
      title: (title || '').replace(/<[^>]+>/g, '').trim() || `FilmAffinity ${faId}`,
      year: year ? Number(year) : null,
      score: ratingRaw ? parseScoreLoose(ratingRaw) : null,
      votes: votesRaw ? parseCountLoose(votesRaw) : null,
      poster: poster || null,
    };
  });
  return collected.filter(Boolean);
}

module.exports = { parseFilmaffinityPage, parseFilmaffinityList };
