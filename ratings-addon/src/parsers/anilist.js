'use strict';

/**
 * parsers/anilist.js — de la respuesta GraphQL de AniList a métricas del addon.
 *
 * AniList tiene API pública gratuita (POST https://graphql.anilist.co, sin key),
 * así que esta fuente no depende de que un HTML no cambie. Sus notas van de 0 a 100
 * (media de las puntuaciones de los usuarios, que escriben sobre 10).
 */

const { yearFrom, clamp, round1, stripTitleNoise } = require('../util');

const ANILIST_FIELDS = `
  id
  idMal
  isAdult
  type
  format
  status
  season
  seasonYear
  source
  episodes
  duration
  title { romaji english native userPreferred }
  coverImage { extraLarge large medium color }
  bannerImage
  averageScore
  meanScore
  popularity
  trending
  favourites
  genres
  synonyms
  description(asHtml: false)
  studios(isMain: true) { nodes { name } }
  nextAiringEpisode { episode airingAt timeUntilAiring }
  stats { scoreRooms }
  externalLinks { url site }
  relations { edges { relationType version node { id type format title { romaji english } } } }
`.trim();

/** Consulta de una ficha (por id de AniList, id de MAL o búsqueda por título). */
const MEDIA_QUERY = `query ($search: String, $id: Int, $idMal: Int) {
  Media(search: $search, id: $id, idMal: $idMal, type: ANIME) { ${ANILIST_FIELDS} }
}`;

/**
 * Consulta de listas/búsquedas con varios resultados. Solo se declaran las
 * variables que luego se usan (GraphQL rechaza las variables sin usar), por eso
 * la tabla define a la vez la declaración y el argumento de `Page.media`.
 */
const LIST_ARGS = {
  sort: { declaration: '$sort: [MediaSort]', media: 'sort: $sort' },
  search: { declaration: '$search: String', media: 'search: $search' },
  season: { declaration: '$season: MediaSeason', media: 'season: $season' },
  seasonYear: { declaration: '$seasonYear: Int', media: 'seasonYear: $seasonYear' },
  status: { declaration: '$status: MediaStatus', media: 'status: $status' },
  format: { declaration: '$formatIn: [MediaFormat]', media: 'format_in: $formatIn' },
  minScore: { declaration: '$minScore: Int', media: 'averageScore_greater: $minScore' },
  country: { declaration: '$countryOfOrigin: String', media: 'countryOfOrigin: $countryOfOrigin' },
};

/** @param {string[]} args claves de LIST_ARGS (se ignoran las desconocidas) */
function listQuery(args = []) {
  const used = Object.keys(LIST_ARGS).filter((name) => args.includes(name));
  const declarations = ['$page: Int', '$perPage: Int', ...used.map((name) => LIST_ARGS[name].declaration)];
  const mediaArgs = [...used.map((name) => LIST_ARGS[name].media), 'type: ANIME', 'isAdult: false'];
  return `query (${declarations.join(', ')}) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { total currentPage lastPage hasNextPage perPage }
    media(${mediaArgs.join(', ')}) { ${ANILIST_FIELDS} }
  }
}`;
}

/** El mismo guion con el mínimo de variables: por si AniList rechaza un filtro. */
function fallbackListQuery({ withSearch = false } = {}) {
  const vars = ['$page: Int', '$perPage: Int', '$sort: [MediaSort]'];
  const inner = ['sort: $sort', 'type: ANIME', 'isAdult: false'];
  if (withSearch) {
    vars.push('$search: String');
    inner.unshift('search: $search');
  }
  return `query (${vars.join(', ')}) {
  Page(page: $page, perPage: $perPage) { media(${inner.join(', ')}) { ${ANILIST_FIELDS} } }
}`;
}

function cleanTitle(value) {
  if (!value) return null;
  const text = stripTitleNoise(String(value).replace(/<[^>]*>/g, ' ')).trim();
  return text || null;
}

function yearOf(media) {
  const fromSeasonYear = Number(media.seasonYear);
  if (Number.isFinite(fromSeasonYear) && fromSeasonYear > 1900) return fromSeasonYear;
  const next = media.nextAiringEpisode && media.nextAiringEpisode.airingAt ? Number(media.nextAiringEpisode.airingAt) : 0;
  if (next) return new Date(next * 1000).getUTCFullYear();
  return yearFrom(media.endDate && (media.endDate.year ? String(media.endDate.year) : '')) || null;
}

/** `anime` | `movie` según AniList (el addon solo sirve series/pelis, y aquí anime). */
function typeFor(media) {
  const format = String(media.format || '').toUpperCase();
  if (format === 'MOVIE' || format === 'MUSIC') return 'movie';
  return 'series';
}

function posterFor(media) {
  const cover = media.coverImage || {};
  return cover.extraLarge || cover.large || cover.medium || null;
}

function overviewFor(media) {
  const text = cleanTitle(media.description);
  if (!text) return null;
  return text.replace(/\n+/g, ' ').slice(0, 1800);
}

/**
 * @param {object} media  Media de la respuesta GraphQL
 * @returns {{media:object, metrics:object, resolved:object, url:string, candidates:object[]}}
 */
function parseAnilistMedia(media) {
  if (!media || typeof media !== 'object') return null;
  const average = Number.isFinite(Number(media.averageScore)) ? Number(media.averageScore) : null;
  const mean = Number.isFinite(Number(media.meanScore)) ? Number(media.meanScore) : null;
  const score = average || mean;
  if (!score) return null;
  const url = `https://anilist.co/anime/${media.id}`;
  const votes = Number.isFinite(Number(media.stats && media.stats.scoreRooms))
    ? Number(media.stats.scoreRooms)
    : Number.isFinite(Number(media.popularity))
      ? Number(media.popularity)
      : null;
  const metrics = {
    anilist: {
      value: clamp(round1(score), 0, 100), // escala nativa 0-100
      votes: votes || null,
      url,
      text: mean && average && mean !== average ? `media ${mean}` : null,
    },
  };
  const title = media.title || {};
  const resolved = {
    anilistId: media.id ? String(media.id) : null,
    malId: media.idMal ? String(media.idMal) : null,
    anilistUrl: url,
    title: cleanTitle(title.romaji) || cleanTitle(title.english) || null,
    originalTitle: cleanTitle(title.native) || cleanTitle(title.romaji) || null,
    year: yearOf(media),
    poster: posterFor(media),
    background: media.bannerImage || posterFor(media),
    overview: overviewFor(media),
    genres: Array.isArray(media.genres) ? media.genres.slice(0, 6) : undefined,
    type: typeFor(media),
    mediaType: String(media.format || '').toLowerCase() || null,
    animeType: 'anime',
  };
  return { media, metrics, resolved, url };
}

/** `Page.media` -> items de catálogo (nota 0-100 como la publica AniList). */
function parseAnilistList(json, { limit = 50 } = {}) {
  const media = (json && json.data && json.data.Page && json.data.Page.media) || (json && json.Media) || [];
  const out = [];
  const seen = new Set();
  for (const entry of Array.isArray(media) ? media : [media]) {
    const parsed = parseAnilistMedia(entry);
    if (!parsed) continue;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    const title = entry.title || {};
    out.push({
      id: `anilist:${entry.id}`,
      anilistId: String(entry.id),
      malId: entry.idMal ? String(entry.idMal) : null,
      imdbId: null,
      title: cleanTitle(title.romaji) || cleanTitle(title.english) || `AniList ${entry.id}`,
      year: yearOf(entry),
      score: entry.averageScore || entry.meanScore || null,
      poster: posterFor(entry),
      url: parsed.url,
      source: 'anilist',
      type: typeFor(entry),
      tags: Array.isArray(entry.genres) ? entry.genres.slice(0, 4) : [],
      extra: {
        format: entry.format || null,
        status: entry.status || null,
        season: entry.season || null,
        favourites: Number(entry.favourites) || null,
        popularity: Number(entry.popularity) || null,
        episodes: Number(entry.episodes) || null,
      },
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** Título preferido de AniList para comparar con el nuestro. */
function anilistTitles(media) {
  const title = (media && media.title) || {};
  return [title.romaji, title.english, title.native, ...(Array.isArray(media.synonyms) ? media.synonyms : [])]
    .map(cleanTitle)
    .filter(Boolean);
}

module.exports = {
  MEDIA_QUERY,
  ANILIST_FIELDS,
  listQuery,
  fallbackListQuery,
  parseAnilistMedia,
  parseAnilistList,
  anilistTitles,
  typeFor,
  yearOf,
};
