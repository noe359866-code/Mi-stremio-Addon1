'use strict';

/**
 * parsers/mal.js — notas de MyAnimeList desde las tres vías que tenemos:
 *
 *   1. API oficial v2 (necesita MAL_CLIENT_ID; campos `mean`, `rank`, …)
 *   2. Jikan (api.jikan.moe), espejo no oficial y sin key: `score`, `rank`, …
 *   3. HTML de la ficha (último recurso): el número está en `score-label` y en
 *      el `og:description`
 *
 * Los tres formatos se aplaman al mismo resultado, así que si mañana Jikan se
 * cae solo hay que cambiar la URL base.
 */

const { forEachMatch, parseScoreLoose, parseCountLoose, yearFrom, decodeEntities, stripTitleNoise, clamp, round1, firstMatch } = require('../util');

function numberOrNull(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function malUrl(id) {
  return id ? `https://myanimelist.net/anime/${id}` : null;
}

function cleanText(value) {
  if (!value) return null;
  const text = stripTitleNoise(decodeEntities(String(value).replace(/<[^>]*>/g, ' '))).replace(/\s+/g, ' ').trim();
  return text || null;
}

/** `media_type` (oficial) | `type` (Jikan) -> tipo del addon. */
function typeFor(entry) {
  const raw = String(entry.media_type || entry.type || '').toLowerCase();
  if (/movie|film/.test(raw)) return 'movie';
  if (/music|pv/.test(raw)) return 'series';
  if (/tv|ova|special|ona|cm/.test(raw)) return 'series';
  return 'series';
}

function yearOf(entry) {
  const explicit = numberOrNull(entry.year) || numberOrNull(entry.start_year);
  if (explicit && explicit > 1900) return explicit;
  const aired = entry.aired || entry.start_date || '';
  return yearFrom(typeof aired === 'string' ? aired : (aired.prop && aired.prop.from && aired.prop.from.date) || String(aired)) || null;
}

function posterOf(entry) {
  const images = entry.images || entry.main_picture || {};
  const large = images.jpg && (images.jpg.large_image_url || images.jpg.image_url);
  return large || images.large || (entry.image && (entry.image.jpg && entry.image.jpg.large_image_url)) || null;
}

function titleOf(entry) {
  const alternatives = entry.alternative_titles || {};
  const titles = [entry.title_english, entry.title, entry.title_japanese, alternatives.english, alternatives.synonyms && (Array.isArray(alternatives.synonyms) ? alternatives.synonyms[0] : alternatives.synonyms)]
    .map(cleanText)
    .filter(Boolean);
  return { title: titles[0] || null, alt: titles.slice(1) };
}

/**
 * Acepta el JSON de Jikan v4 y el de la API oficial v2 (campos distintos).
 * @returns {{metrics:object, resolved:object, url:string, candidates:string[]}|null}
 */
function parseMalAnime(json, { id } = {}) {
  const entry = json && json.data && !json.score ? json.data : json;
  if (!entry || typeof entry !== 'object') return null;
  const score = numberOrNull(entry.score) ?? numberOrNull(entry.mean);
  if (!score || score <= 0) return null;
  const malId = numberOrNull(entry.mal_id) || numberOrNull(entry.id) || (id ? Number(id) : null);
  const votes = numberOrNull(entry.scored_by) ?? numberOrNull(entry.num_scoring_users) ?? null;
  const rank = numberOrNull(entry.rank) ?? null;
  const { title, alt } = titleOf(entry);
  const metrics = {
    mal: {
      value: clamp(round1(score), 0, 10), // MAL ya puntúa sobre 10
      votes,
      rank: rank && rank > 0 ? rank : null,
      url: malUrl(malId),
      text: entry.popularity ? `popularidad #${entry.popularity}` : null,
    },
  };
  const aired = entry.aired || {};
  const resolved = {
    malId: malId ? String(malId) : null,
    malUrl: malUrl(malId),
    title,
    originalTitle: cleanText(entry.title_japanese) || title,
    year: yearOf(entry),
    poster: posterOf(entry),
    overview: cleanText(entry.synopsis) ? String(entry.synopsis).replace(/\s+/g, ' ').slice(0, 1800) : null,
    genres: Array.isArray(entry.genres) ? entry.genres.map((genre) => genre && genre.name).filter(Boolean).slice(0, 6) : undefined,
    type: typeFor(entry),
    mediaType: String(entry.media_type || entry.type || '').toLowerCase() || null,
    animeType: 'anime',
    episodes: numberOrNull(entry.episodes),
    members: numberOrNull(entry.members) ?? numberOrNull(entry.num_members),
    favorites: numberOrNull(entry.favorites) ?? numberOrNull(entry.num_listed_users),
    airing: entry.airing === true,
    seasonStart: typeof aired.from === 'string' ? aired.from.slice(0, 10) : null,
  };
  return { metrics, resolved, url: resolved.malUrl, candidates: [title, entry.title, entry.title_english, entry.title_japanese, ...(Array.isArray(alt) ? alt : [alt])].filter(Boolean) };
}

/** Listas de Jikan (`/top/anime`, `/anime?q=`) y de la API oficial (`/anime?…`) a items del addon. */
function parseMalList(json, { limit = 50 } = {}) {
  const raw = json && Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : (json && json.data && json.data.anime) || [];
  const out = [];
  const seen = new Set();
  for (const node of Array.isArray(raw) ? raw : [node0(raw)]) {
    if (!node || typeof node !== 'object') continue;
    const entry = node.entry || node; // el `rank` de /top/anime envuelve la entrada en `entry`
    const malId = numberOrNull(entry.mal_id) || numberOrNull(entry.id);
    if (!malId || seen.has(malId)) continue;
    seen.add(malId);
    const score = numberOrNull(entry.score) ?? numberOrNull(entry.mean);
    const { title } = titleOf(entry);
    out.push({
      id: `mal:${malId}`,
      malId: String(malId),
      title: title || `MAL ${malId}`,
      year: yearOf(entry),
      score: score && score > 0 ? score : null,
      rank: numberOrNull(node.rank), // puesto en ESTA lista (el ranking global va en la métrica)
      poster: posterOf(entry),
      url: malUrl(malId),
      source: 'mal',
      type: typeFor(entry),
      tags: Array.isArray(entry.genres) ? entry.genres.map((genre) => genre.name || genre).filter(Boolean).slice(0, 4) : [],
      extra: {
        scoredBy: numberOrNull(entry.scored_by) ?? numberOrNull(entry.num_scoring_users),
        members: numberOrNull(entry.members),
        favorites: numberOrNull(entry.favorites),
        type: entry.type || entry.media_type || null,
      },
    });
    if (out.length >= limit) break;
  }
  return out;
}

function node0(value) {
  return value && typeof value === 'object' ? value : null;
}

/**
 * Ficha HTML de MAL (último recurso). Marcadores históricos y actuales, todos
 * opcionales: si mañana cambian el markup simplemente no encontraremos nota.
 */
function parseMalHtml(html, { url } = {}) {
  const text = String(html || '');
  const metrics = {};
  const idMatch = String(url || '').match(/myanimelist\.net\/anime\/(\d+)/);
  const malId = idMatch ? idMatch[1] : firstMatch(text, [/property="og:url" content="https:\/\/myanimelist\.net\/anime\/(\d+)/]);

  // Marcadores históricos y actuales de la nota: todos opcionales.
  const score = parseScoreLoose(
    firstMatch(text, [
      /score-label[^>]*>\s*(?:★\s*)?([0-9]+\.[0-9]+)/i,
      /"score"\s*:\s*"?([0-9]+\.[0-9]+)/,
      /has a score of\s+([0-9.]+)/i,
      /scored\s+([0-9.]+)\s+with popularity rank/i,
    ]) || ''
  );
  const votes = parseCountLoose(firstMatch(text, [/\(([\d,.]+)\s*users\)/i, /([\d,.]+[KM]?)\s*(?:users|members)/i]) || '');
  // "Ranked #8 on MyAnimeList" (puesto) y "popularity rank #12" (popularidad)
  const rank = firstMatch(text, [/Ranked\s+#?(\d+)/i, /popularity\s+rank\s*#?(\d+)/i]);

  if (!score || score <= 0) return { metrics, resolved: null, url: url || null };
  metrics.mal = {
    value: clamp(round1(score), 0, 10),
    votes: votes || null,
    rank: rank && Number(rank) > 0 ? Number(rank) : null,
    url: url || malUrl(malId),
    text: 'vía HTML',
  };

  const title = cleanText(
    firstMatch(text, [/<meta property="og:title" content="([^"]+)"/, /<h1[^>]*class="title-name"[^>]*>([^<]+)</, /<title>([^|<]+)/]) || ''
  );
  const image = firstMatch(text, [/<meta property="og:image" content="([^"]+)"/]);
  const yearText = firstMatch(text, [/(?:Aired|Start Season|Premiered)[^0-9]{0,40}(?:19|20)\d{2}/]) || '';

  return {
    metrics,
    url: url || malUrl(malId),
    resolved: {
      malId: malId || null,
      malUrl: malUrl(malId),
      title: title ? title.replace(/\s*\(\d{4}\)\s*$/, '') : null,
      year: yearFrom(yearText),
      poster: image || null,
      type: 'series',
      animeType: 'anime',
    },
  };
}

/** Candidatos de búsqueda desde una lista de resultados de MAL/Jikan. */
function malSearchItems(json) {
  return parseMalList(json, { limit: 20 });
}

module.exports = {
  parseMalAnime,
  parseMalList,
  parseMalHtml,
  malSearchItems,
  malUrl,
  typeFor,
  yearOf,
  titleOf,
};
