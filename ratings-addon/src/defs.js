'use strict';

/**
 * defs.js — registro de fuentes y de métricas (puntuaciones) soportadas.
 * Cada métrica declara su escala nativa, su peso para la nota combinada y el
 * mínimo de votos para darle confianza total.
 */

const { clamp, round1 } = require('./util');

const SOURCES = {
  imdb: {
    id: 'imdb',
    label: 'IMDb',
    emoji: '⭐',
    homepage: 'https://www.imdb.com/',
    docs: 'Sin API pública: se scrapea la ficha (o se usa la API de OMDb si configuras OMDB_API_KEY).',
  },
  rottentomatoes: {
    id: 'rottentomatoes',
    label: 'Rotten Tomatoes',
    emoji: '🍅',
    homepage: 'https://www.rottentomatoes.com/',
    docs: 'Tomatometer + puntuación del público desde la ficha /m/ o /tv/.',
  },
  metacritic: {
    id: 'metacritic',
    label: 'Metacritic',
    emoji: '🎯',
    homepage: 'https://www.metacritic.com/',
    docs: 'Metascore + user score (usa el endpoint JSON público de backend.metacritic.com y cae al HTML).',
  },
  filmaffinity: {
    id: 'filmaffinity',
    label: 'FilmAffinity',
    emoji: '🎞️',
    homepage: 'https://www.filmaffinity.com/es/main.html',
    docs: 'Búsqueda propia + nota y votos de la ficha (es la fuente en español).',
  },
  tmdb: {
    id: 'tmdb',
    label: 'TMDB',
    emoji: '🎬',
    homepage: 'https://www.themoviedb.org/',
    docs: 'API oficial v3 (necesita TMDB_API_KEY). También resuelve títulos -> IDs de IMDb.',
  },
};

const METRICS = {
  imdb: { source: 'imdb', label: 'IMDb', emoji: '⭐', scale: 10, weight: 1.0, minVotes: 500, badge: true, unit: 'votos' },
  filmaffinity: { source: 'filmaffinity', label: 'FilmAffinity', emoji: '🎞️', scale: 10, weight: 0.7, minVotes: 250, unit: 'votos' },
  rt_tomatometer: { source: 'rottentomatoes', label: 'Tomatometer', emoji: '🍅', scale: 100, weight: 0.95, minVotes: 0, unit: 'críticas' },
  rt_audience: { source: 'rottentomatoes', label: 'Público RT', emoji: '🍿', scale: 100, weight: 0.45, minVotes: 0, unit: 'votos' },
  mc_metascore: { source: 'metacritic', label: 'Metascore', emoji: '🎯', scale: 100, weight: 0.9, minVotes: 0, unit: 'críticas' },
  mc_user: { source: 'metacritic', label: 'Usuarios Metacritic', emoji: '💻', scale: 10, weight: 0.45, minVotes: 0, unit: 'votos' },
  tmdb: { source: 'tmdb', label: 'TMDB', emoji: '🎬', scale: 10, weight: 0.55, minVotes: 250, unit: 'votos' },
};

const METRIC_ORDER = ['imdb', 'rt_tomatometer', 'mc_metascore', 'filmaffinity', 'tmdb', 'rt_audience', 'mc_user'];

/** Convierte {key: {value, votes}} a métricas normalizadas a 0-10. */
function normalizeMetrics(rawMetrics) {
  const out = {};
  for (const [key, input] of Object.entries(rawMetrics || {})) {
    const def = METRICS[key];
    if (!def || input === null || input === undefined) continue;
    const raw = typeof input === 'number' || typeof input === 'string' ? Number(input) : Number(input.value);
    if (!Number.isFinite(raw) || raw <= 0) continue;
    const value = round1(clamp((raw / (def.scale || 10)) * 10, 0, 10));
    if (!value) continue;
    out[key] = {
      key,
      source: def.source,
      label: def.label,
      emoji: def.emoji,
      raw,
      scale: def.scale,
      value,
      display: `${def.scale === 100 ? Math.round(raw) : (Math.round(raw * 10) / 10).toFixed(1)}${def.scale === 100 ? '%' : `/${def.scale}`}`,
      votes: Number.isFinite(Number(input && input.votes)) && input ? Number(input.votes) : null,
      text: (input && input.text) || null,
      derived: (input && input.derived) || null,
      url: (input && input.url) || null,
      rank: (input && input.rank) || null,
      unit: def.unit || 'votos',
      updatedAt: Date.now(),
    };
  }
  return out;
}

/**
 * Nota combinada: media ponderada con confianza por nº de votos
 * (fórmula tipo IMDb: w * votes/(votes+min)).
 */
function combine(metrics, options = {}) {
  const weights = options.weights || {};
  const minVotes = options.minVotes === undefined ? {} : options.minVotes;
  const enabled = options.metrics ? new Set(options.metrics) : null;
  let sum = 0;
  let weightSum = 0;
  const parts = [];
  for (const key of METRIC_ORDER) {
    const metric = metrics[key];
    if (!metric) continue;
    const def = METRICS[key];
    if (enabled && !enabled.has(key)) continue;
    if (weights[key] === 0) continue;
    const baseWeight = weights[key] === undefined ? def.weight : weights[key];
    const min = minVotes[key] === undefined ? def.minVotes : minVotes[key];
    let confidence = 1;
    if (min > 0) confidence = metric.votes ? clamp(metric.votes / (metric.votes + min), 0.05, 1) : 0.7;
    const weight = baseWeight * confidence;
    if (weight <= 0) continue;
    sum += metric.value * weight;
    weightSum += weight;
    parts.push({ key, weight: round1(weight * 100) / 100, value: metric.value });
  }
  if (!weightSum) return null;
  return { value: round1(sum / weightSum), used: parts };
}

function starsText(value, total = 5) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '☆☆☆☆☆';
  const filled = clamp(Math.round(num / (10 / total)), 0, total);
  return '★'.repeat(filled) + '☆'.repeat(total - filled);
}

module.exports = { SOURCES, METRICS, METRIC_ORDER, normalizeMetrics, combine, starsText };
