'use strict';

/**
 * config.js — configuración del addon.
 *
 * Tres capas, de menos a más prioritarias:
 *   defaults  <  variables de entorno  <  config por URL (/c/<base64>/…)
 * La capa por URL es la que genera la propia página de instalación de Stremio,
 * así que cada usuario puede elegir fuentes, pesos y formato sin tocar código.
 */

const path = require('path');

const ALL_SOURCES = ['imdb', 'rottentomatoes', 'metacritic', 'filmaffinity', 'tmdb', 'anilist', 'mal'];
const CINEMETA_MANIFEST = 'https://v3-cinemeta.strem.io/manifest.json';

function upstreamList(value, fallback = [CINEMETA_MANIFEST]) {
  const list = Array.isArray(value) ? value : String(value || '').split(/[\n,;]+/);
  const clean = list.map((item) => String(item).trim()).filter(Boolean).slice(0, 6);
  return clean.length ? Array.from(new Set(clean)) : fallback.slice();
}

/**
 * OJO: esta key de TMDB viene del proyecto previo del repo (está pública en
 * GitHub). Funciona, pero para tu despliegue pon la tuya en TMDB_API_KEY.
 */
const FALLBACK_TMDB_KEY = 'dc8ef9b5bb60a28f4156168ae01b7291';

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return /^(1|true|yes|si|sí|on)$/i.test(String(value));
}

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envConfig(env = process.env) {
  const sources = (env.RATINGS_SOURCES || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => ALL_SOURCES.includes(item));
  return {
    // clave/identidad
    addonName: env.ADDON_NAME || 'Puntuaciones en tus pósters',
    addonDescription:
      env.ADDON_DESCRIPTION ||
      'Mejora los catálogos que ya usas: nota nativa de Stremio y pósters con IMDb, Rotten Tomatoes, Metacritic, FilmAffinity y TMDB.',

    // Catálogos existentes que se envuelven. No se publican listas propias.
    upstreams: upstreamList(env.UPSTREAM_MANIFEST_URLS || env.UPSTREAM_MANIFEST_URL),
    nativeBadge: bool(env.WRAP_NATIVE_BADGE, true),
    posterOverlay: bool(env.WRAP_POSTER_OVERLAY, true),
    catalogTimeBudgetMs: num(env.WRAP_CATALOG_TIME_BUDGET_MS, 4000),
    catalogConcurrency: Math.max(1, Math.min(12, num(env.WRAP_CATALOG_CONCURRENCY, 6))),

    // fuentes
    sources: sources.length ? sources : ALL_SOURCES.slice(),
    weights: {
      imdb: num(env.WEIGHT_IMDB, 1.0),
      rt_tomatometer: num(env.WEIGHT_RT, 0.95),
      mc_metascore: num(env.WEIGHT_METACRITIC, 0.9),
      filmaffinity: num(env.WEIGHT_FILMAFFINITY, 0.7),
      tmdb: num(env.WEIGHT_TMDB, 0.55),
      rt_audience: num(env.WEIGHT_RT_AUDIENCE, 0.45),
      mc_user: num(env.WEIGHT_MC_USER, 0.45),
    },
    minVotes: {
      imdb: num(env.MIN_VOTES_IMDB, 500),
      tmdb: num(env.MIN_VOTES_TMDB, 250),
      filmaffinity: num(env.MIN_VOTES_FA, 250),
    },

    // claves de APIs
    tmdbApiKey: env.TMDB_API_KEY || (env.TMDB_API_KEY === '' ? '' : FALLBACK_TMDB_KEY),
    tmdbToken: env.TMDB_API_TOKEN || env.TMDB_BEARER_TOKEN || '',
    omdbApiKey: env.OMDB_API_KEY || '',
    metacriticApiKey: env.METACRITIC_API_KEY || '',
    // anime: MAL_CLIENT_ID activa la API oficial de MyAnimeList (si no, se usa Jikan)
    malClientId: env.MAL_CLIENT_ID || env.MAL_CLIENT_KEY || '',
    jikanBaseUrl: env.JIKAN_BASE_URL || '',
    anilistEndpoint: env.ANILIST_GRAPHQL_URL || '',
    metacriticVersion: env.METACRITIC_API_VERSION || '4.2',

    // salida en Stremio
    badgeMetric: env.BADGE_METRIC || 'combined', // combined | imdb | rt_tomatometer | mc_metascore | filmaffinity | tmdb
    showPanel: bool(env.SHOW_PANEL, true),
    showUnavailable: bool(env.SHOW_UNAVAILABLE, true),
    showLinks: bool(env.SHOW_LINKS, true),
    includePanelEmoji: bool(env.SHOW_EMOJI, true),
    descriptionPrefix: env.DESCRIPTION_PREFIX || '',
    language: env.RATINGS_LANGUAGE || 'es-ES',

    // filtros de catálogo
    minScore: num(env.MIN_SCORE, 0),
    maxScore: num(env.MAX_SCORE, 10),
    catalogLimit: num(env.CATALOG_LIMIT, 50),
    includeAdult: bool(env.INCLUDE_ADULT, false),
    enrichSearch: bool(env.ENRICH_SEARCH, false),

    // red / caché
    cacheTtlHours: num(env.CACHE_TTL_HOURS, 24),
    chartTtlHours: num(env.CHART_TTL_HOURS, 6),
    timeoutMs: num(env.FETCH_TIMEOUT_MS, 9000),
    retries: num(env.FETCH_RETRIES, 1),
    perHostMs: num(env.PER_HOST_MS, 700),
    retryOnNewId: bool(env.RETRY_ON_NEW_ID, true),
    verbose: bool(env.LOG_VERBOSE, false),

    // comportamiento
    mock: bool(env.RATINGS_MOCK, false),
    publicUrl: env.PUBLIC_URL || '',
    env,
  };
}

function applyUserConfig(cfg, userConfig = {}) {
  const out = { ...cfg, weights: { ...cfg.weights }, minVotes: { ...cfg.minVotes }, sources: cfg.sources.slice() };
  // `sources` puede venir como array (nuestra página) o como string 'imdb,tmdb' / 'all'
  // (la UI nativa de Stremio construye el prefijo de config con los values del manifest).
  if (typeof userConfig.sources === 'string') {
    const list = userConfig.sources.trim().toLowerCase();
    out.sources = !list || list === 'all' ? ALL_SOURCES.slice() : list.split(/[\s,;]+/).filter((id) => ALL_SOURCES.includes(id));
    if (!out.sources.length) out.sources = ALL_SOURCES.slice();
  } else if (Array.isArray(userConfig.sources) && userConfig.sources.length) {
    out.sources = userConfig.sources.filter((id) => ALL_SOURCES.includes(id));
    if (!out.sources.length) out.sources = ALL_SOURCES.slice();
  }
  if (userConfig.badge) out.badgeMetric = userConfig.badge;
  if (userConfig.panel !== undefined) out.showPanel = bool(userConfig.panel, true);
  if (userConfig.showPanel !== undefined) out.showPanel = bool(userConfig.showPanel, true);
  if (userConfig.unavailable !== undefined) out.showUnavailable = bool(userConfig.unavailable, true);
  if (userConfig.showUnavailable !== undefined) out.showUnavailable = bool(userConfig.showUnavailable, true);
  if (userConfig.links !== undefined) out.showLinks = bool(userConfig.links, true);
  if (userConfig.showLinks !== undefined) out.showLinks = bool(userConfig.showLinks, true);
  if (userConfig.minScore !== undefined) out.minScore = num(userConfig.minScore, 0);
  if (userConfig.maxScore !== undefined) out.maxScore = num(userConfig.maxScore, 10);
  if (userConfig.limit !== undefined) out.catalogLimit = num(userConfig.limit, 50);
  if (userConfig.ttl !== undefined) out.cacheTtlHours = num(userConfig.ttl, 24);
  if (userConfig.lang) out.language = String(userConfig.lang);
  if (userConfig.language) out.language = String(userConfig.language);
  if (userConfig.upstreams !== undefined) {
    const requested = upstreamList(userConfig.upstreams, []);
    if (requested.length) out.upstreams = requested;
  }
  if (userConfig.nativeBadge !== undefined) out.nativeBadge = bool(userConfig.nativeBadge, true);
  if (userConfig.posterOverlay !== undefined) out.posterOverlay = bool(userConfig.posterOverlay, true);
  if (userConfig.catalogTimeBudgetMs !== undefined) out.catalogTimeBudgetMs = Math.max(0, Math.min(7000, num(userConfig.catalogTimeBudgetMs, out.catalogTimeBudgetMs)));
  if (userConfig.weights && typeof userConfig.weights === 'object') {
    for (const [key, value] of Object.entries(userConfig.weights)) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) out.weights[key] = parsed;
    }
  }
  out.userConfig = userConfig;
  return out;
}

/** Claves derivadas usadas por los módulos de red. */
function derived(cfg) {
  const ttlMs = Math.max(60, cfg.cacheTtlHours) * 3600 * 1000;
  return {
    ttlRatingsMs: ttlMs,
    ttlTmdbMs: Math.min(ttlMs, Math.max(30, cfg.cacheTtlHours) * 3600 * 1000),
    ttlChartsMs: Math.max(15, cfg.chartTtlHours) * 3600 * 1000,
    root: path.resolve(__dirname, '..'),
  };
}

/** Config lista para usar: env + claves derivadas (TTLs en ms, rutas). */
function load(env = process.env) {
  const base = envConfig(env);
  return { ...base, ...derived(base) };
}

module.exports = { load, envConfig, applyUserConfig, derived, ALL_SOURCES, CINEMETA_MANIFEST, upstreamList, FALLBACK_TMDB_KEY, bool, num };
