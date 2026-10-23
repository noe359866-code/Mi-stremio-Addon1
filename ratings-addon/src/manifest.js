'use strict';

/**
 * manifest.js — manifiesto del addon de Stremio.
 *
 * Recursos:
 *   - catalog: las listas top de cada fuente (con la nota en el badge)
 *   - meta:    la ficha con el desglose de las 5 puntuaciones
 * No hay `stream`: este addon es 100 % metadatos/puntuaciones.
 */

const { CATALOGS, catalogsFor } = require('./catalog');
const { SOURCES } = require('./defs');

const VERSION = '1.0.0';
const TYPES = ['movie', 'series', 'anime'];
const ID_PREFIXES = ['tt', 'tmdb:', 'imdb:', 'rt:', 'mc:', 'fa:'];

function manifestFor({ cfg, origin, basePath = '' }) {
  const catalogs = catalogsFor(cfg).map((catalog) => ({
    type: catalog.type,
    id: catalog.id,
    name: catalog.name,
    extra: [
      { name: 'search', isRequired: false },
      { name: 'skip', isRequired: false },
    ],
  }));

  const manifest = {
    id: 'community.ratings.scraper',
    version: VERSION,
    name: cfg.addonName,
    description: buildDescription(cfg),
    logo: `${origin}${basePath}/logo.svg`,
    background: `${origin}${basePath}/bg.svg`,
    // El SDK usa `contactEmail` y el protocolo documenta `contactLink`: mandamos los dos.
    contactLink: `${origin}${basePath}/api/health`,
    contactEmail: `${origin}${basePath}/api/health`,
    resources: [
      { name: 'catalog', types: TYPES },
      {
        name: 'meta',
        types: TYPES,
        idPrefixes: ID_PREFIXES,
      },
    ],
    types: TYPES,
    idPrefixes: ID_PREFIXES,
    catalogs,
    config: [
      {
        key: 'sources',
        type: 'select',
        label: 'Fuentes a scrapear',
        default: 'all',
        options: ['all', 'imdb', 'imdb+tmdb', 'rt+mc', 'fa'],
        optionsValues: ['all', 'imdb,tmdb', 'imdb,rottentomatoes,metacritic', 'imdb,filmaffinity'],
        description: 'Selecciona de qué webs se sacan las notas.',
      },
      {
        key: 'badge',
        type: 'select',
        label: 'Nota del badge (⭐ en Stremio)',
        default: 'combined',
        options: ['Combinada', 'IMDb', 'Rotten Tomatoes', 'Metacritic', 'FilmAffinity', 'TMDB'],
        optionsValues: ['combined', 'imdb', 'rt_tomatometer', 'mc_metascore', 'filmaffinity', 'tmdb'],
      },
      { key: 'panel', type: 'boolean', label: 'Mostrar desglose en la descripción', default: true },
      { key: 'unavailable', type: 'boolean', label: 'Marcar las fuentes sin datos', default: true },
      { key: 'links', type: 'boolean', label: 'Enlaces a cada ficha', default: true },
      { key: 'minScore', type: 'number', label: 'Nota mínima en los catálogos (0-10)', default: 0 },
      { key: 'ttl', type: 'number', label: 'Cache (horas)', default: 24 },
    ],
    behaviorHints: { configurable: true, adult: false },
  };
  return manifest;
}

function buildDescription(cfg) {
  const sources = (cfg.sources || Object.keys(SOURCES))
    .map((id) => SOURCES[id]?.label || id)
    .join(' · ');
  return `Puntuaciones de ${sources}. Películas, series y anime: badge con la nota y ficha con el desglose (crítica + público + votos). Sin streams.`;
}

/** SVG del logo: estrella con el % de Tomatometer pintado alrededor. */
function logoSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#ff5c39"/><stop offset="0.55" stop-color="#f5c518"/><stop offset="1" stop-color="#12b886"/>
</linearGradient></defs>
<rect width="128" height="128" rx="26" fill="#0f1220"/>
<circle cx="64" cy="64" r="44" fill="none" stroke="url(#g)" stroke-width="7" stroke-dasharray="220 60" stroke-linecap="round" transform="rotate(-90 64 64)"/>
<path d="M64 30l9.9 21.1 23.1 3-17 16 4.3 23L64 81.6 43.7 93.1l4.3-23-17-16 23.1-3z" fill="url(#g)"/>
<text x="64" y="118" font-family="system-ui,Segoe UI,Roboto,sans-serif" font-size="17" font-weight="700" fill="#e8ecf8" text-anchor="middle">8.4/10</text>
</svg>`;
}

function backgroundSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720">
<defs><radialGradient id="b" cx="0.2" cy="0.1" r="1.1">
<stop offset="0" stop-color="#243056"/><stop offset="0.5" stop-color="#141a2c"/><stop offset="1" stop-color="#0a0d17"/>
</radialGradient></defs>
<rect width="1280" height="720" fill="url(#b)"/>
<g fill="#f5c518" opacity="0.13">
<circle cx="1020" cy="150" r="120"/><circle cx="220" cy="560" r="180"/>
</g>
<g font-family="system-ui,Segoe UI,Roboto,sans-serif" fill="#e8ecf8">
<text x="80" y="330" font-size="72" font-weight="800" opacity="0.9">PUNTUACIONES</text>
<text x="80" y="392" font-size="30" opacity="0.72">IMDb · Rotten Tomatoes · Metacritic · FilmAffinity · TMDB</text>
</g></svg>`;
}

module.exports = { manifestFor, buildDescription, logoSvg, backgroundSvg, VERSION, TYPES, ID_PREFIXES, CATALOGS };
