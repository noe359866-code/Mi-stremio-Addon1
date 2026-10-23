'use strict';

/**
 * providers/index.js — orquestador del scraping.
 *
 * 1. TMDB primero: resuelve título/año/tipo + imdb_id (es API oficial y barata).
 * 2. IMDb, Rotten Tomatoes, Metacritic y FilmAffinity en paralelo.
 * 3. Las fuentes que fallaron se reintentan UNA vez si en el camino apareció
 *    un id nuevo (p. ej. FilmAffinity enlaza a IMDb y nos da el tt… que faltaba).
 * Cada fuente devuelve su estado (`ok`, `error`, `ms`) para poder degradar sin
 * romper el addon cuando una web cambia o nos bloquea.
 */

const tmdb = require('./tmdb');
const imdb = require('./imdb');
const rottentomatoes = require('./rottentomatoes');
const metacritic = require('./metacritic');
const filmaffinity = require('./filmaffinity');

const ALL = { tmdb, imdb, rottentomatoes, metacritic, filmaffinity };
const SCRAPERS = ['imdb', 'rottentomatoes', 'metacritic', 'filmaffinity'];

function enabledProviders(cfg) {
  const wanted = cfg.sources && cfg.sources.length ? cfg.sources : Object.keys(ALL);
  return wanted.filter((id) => ALL[id]).map((id) => ALL[id]);
}

function isKeyMissing(error) {
  return error && (error.code === 'no_key' || /sin TMDB_API_KEY/.test(error.message || ''));
}

/**
 * @param {object} work  título/año/tipo/ids a resolver
 * @param {object} ctx   { cfg, http, caches, log }
 */
async function collectRatings(work, ctx) {
  const { cfg } = ctx;
  const enabled = enabledProviders(cfg);
  const enabledIds = new Set(enabled.map((p) => p.id));
  const statuses = [];
  const metrics = {};
  const resolved = {};
  const notes = {};

  const currentWork = { ...work, ids: { ...(work.ids || {}) } };

  const merge = (patch) => {
    if (!patch) return;
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === undefined || value === '') continue;
      resolved[key] = value;
      if (key === 'imdbId' && !currentWork.ids.imdb) currentWork.ids.imdb = value;
      if (key === 'tmdbId' && !currentWork.ids.tmdb) currentWork.ids.tmdb = value;
      if (key === 'rtSlug' && !currentWork.ids.rtSlug) currentWork.ids.rtSlug = value;
      if (key === 'mcSlug' && !currentWork.ids.mcSlug) currentWork.ids.mcSlug = value;
      if (key === 'faUrl' && !currentWork.ids.faUrl) currentWork.ids.faUrl = value;
      if ((key === 'title' || key === 'year' || key === 'poster') && !currentWork[key]) currentWork[key] = value;
    }
  };

  const setStatus = (status) => {
    const index = statuses.findIndex((entry) => entry.source === status.source);
    if (index >= 0) statuses[index] = status;
    else statuses.push(status);
  };

  const runOne = async (provider) => {
    const started = Date.now();
    try {
      const result = await provider.lookup(currentWork, ctx);
      const found = (result && result.metrics) || {};
      const usable = Object.entries(found).filter(([key, value]) => value && Number.isFinite(Number(value.value)) && Number(value.value) > 0);
      if (!usable.length) {
        setStatus({ source: provider.id, ok: false, error: 'sin datos', code: 'no_score', ms: Date.now() - started });
        return;
      }
      for (const [key, value] of usable) {
        const current = metrics[key];
        // gana la medición directa sobre la derivada de otra web (p. ej. el
        // Metascore que IMDb muestra en su ficha no manda tanto como Metacritic)
        if (!current || (current.derived && !value.derived)) metrics[key] = { ...value, source: provider.id };
      }
      if (result.resolved) merge(result.resolved);
      if (result.via) notes[provider.id] = result.via;
      if (result.consensus) notes[`${provider.id}_consensus`] = result.consensus;
      setStatus({ source: provider.id, ok: true, ms: Date.now() - started, via: result.via || 'scrape' });
    } catch (error) {
      setStatus({
        source: provider.id,
        ok: false,
        error: (error && error.message ? error.message : 'error').slice(0, 200),
        code: (error && error.code) || 'error',
        ms: Date.now() - started,
      });
    }
  };

  // 1) TMDB
  if (enabledIds.has('tmdb')) await runOne(tmdb);
  else if (!currentWork.ids.imdb && !currentWork.title) {
    // sin TMDB y sin título propio: nada que hacer
  }

  // 2) el resto en paralelo
  const parallel = enabled.filter((provider) => SCRAPERS.includes(provider.id));
  await Promise.all(parallel.map((provider) => runOne(provider)));

  // 3) reintenta las que fallaron si ahora tenemos ids nuevos
  const failedIds = statuses.filter((status) => !status.ok).map((status) => status.source);
  const gainedIds = Boolean(resolved.imdbId && !work.ids?.imdb) || Boolean(resolved.tmdbId && !work.ids?.tmdb);
  if (failedIds.length && gainedIds && ctx.cfg.retryOnNewId !== false) {
    const retry = enabled.filter((provider) => failedIds.includes(provider.id));
    await Promise.all(retry.map((provider) => runOne(provider)));
  }

  const okCount = statuses.filter((status) => status.ok).length;
  const failed = statuses.filter((status) => !status.ok);
  return {
    metrics,
    statuses: statuses.map((status) => ({ ...status, ok: Boolean(status.ok) })),
    resolved,
    notes,
    work: currentWork,
    coverage: { ok: okCount, total: statuses.length || enabled.length, missing: failed.map((f) => f.source) },
    allFailed: statuses.length > 0 && okCount === 0,
  };
}

/** Catálogo: reparte según el id del catálogo (`imdb:top250`, `tmdb:anime`…). */
async function collectCatalog({ type, provider: providerId, list, limit, search, minScore }, ctx) {
  const provider = ALL[providerId];
  if (!provider || !provider.catalog) throw new Error(`fuente de catálogo desconocida: ${providerId}`);
  const started = Date.now();
  try {
    const items = await provider.catalog({ type, list: list || 'top', limit: limit || 50, search, minScore }, ctx);
    return { items: (items || []).filter(Boolean), ms: Date.now() - started, provider: providerId };
  } catch (error) {
    if (isKeyMissing(error)) {
      const wrapped = new Error(`${providerId}: falta TMDB_API_KEY`);
      wrapped.code = 'no_key';
      throw wrapped;
    }
    throw error;
  }
}

module.exports = { ALL, SCRAPERS, collectRatings, collectCatalog, enabledProviders };
