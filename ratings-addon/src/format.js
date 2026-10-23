'use strict';

/**
 * format.js — cómo se ven las puntuaciones dentro de Stremio.
 *
 * Stremio solo tiene un hueco numérico para notas (el badge `imdbRating` de las
 * fichas y tarjetas), así que ahí va la nota elegida en `badgeMetric` y el
 * desglose completo (las 5 fuentes) se pinta en la `description` + `links`.
 */

const { METRICS, normalizeMetrics, combine, starsText } = require('./defs');
const { round1, escapeHtml, clamp, stripYearSuffix } = require('./util');

/** 2580123 -> "2,5 M" (estilo español, compacto). */
function formatVotes(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  if (num >= 1e6) return `${(num / 1e6).toFixed(1).replace('.', ',')} M`;
  if (num >= 10000) return `${Math.round(num / 1000)} k`;
  if (num >= 1000) return `${(num / 1000).toFixed(1).replace('.', ',')} k`;
  return String(num);
}

function metricLabel(key) {
  const def = METRICS[key];
  if (!def) return key;
  return def.label;
}

function metricLine(key, metric, { emoji = true } = {}) {
  const def = METRICS[key] || {};
  const icon = emoji && def.emoji ? `${def.emoji} ` : '';
  const isPercent = def.scale === 100;
  const raw = isPercent ? String(Math.round(Number(metric.raw))) : (Math.round(Number(metric.raw) * 10) / 10).toFixed(1);
  const scaleText = isPercent ? '%' : `/${def.scale || 10}`;
  const votes = metric.votes ? ` · ${formatVotes(metric.votes)} ${metric.unit || (def.scale === 100 ? 'críticas' : 'votos')}` : '';
  const rank = metric.rank ? ` · #${metric.rank}` : '';
  const via = metric.derived ? ` (vía ${metric.derived})` : metric.text && String(metric.text).length <= 44 ? ` (${metric.text})` : '';
  return `${icon}${def.label || key} ${raw}${scaleText}${votes}${rank}${via}`;
}

/**
 * Panel de texto para la `description` de la ficha.
 * @returns {string[]}
 */
function buildPanel(metrics, options = {}) {
  const cfg = options.cfg || {};
  const order = cfg.metricOrder && cfg.metricOrder.length ? cfg.metricOrder : Object.keys(METRICS);
  const emoji = cfg.includePanelEmoji !== false;
  const lines = [];
  for (const key of order) {
    const metric = metrics[key];
    if (!metric) {
      if (cfg.showUnavailable && !options.quiet) {
        const def = METRICS[key];
        if (def) lines.push(`${emoji ? `${def.emoji} ` : ''}${def.label} — sin datos`);
      }
      continue;
    }
    lines.push(metricLine(key, metric, { emoji }));
  }
  return lines;
}

function verdictFor(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (num >= 8.5) return 'imprescindible';
  if (num >= 7.5) return 'muy buena';
  if (num >= 6.5) return 'correcta';
  if (num >= 5) return 'división de opiniones';
  if (num >= 3.5) return 'floja';
  return 'a evitar';
}

/**
 * Meta object de Stremio a partir del work resuelto + métricas ya normalizadas.
 */
function buildMeta({ work, rawMetrics, cfg, catalogId, note }) {
  const metrics = normalizeMetrics(rawMetrics);
  const combined = combine(metrics, { weights: cfg.weights, minVotes: cfg.minVotes });
  const badgeKey = cfg.badgeMetric && cfg.badgeMetric !== 'combined' ? cfg.badgeMetric : null;
  const badgeMetric = badgeKey ? metrics[badgeKey] : null;
  const badgeValue = badgeMetric ? badgeMetric.value : combined ? combined.value : null;

  const titleParts = [stripYearSuffix(work.title || work.originalTitle || work.ids?.imdb || 'Sin título')];
  if (work.year) titleParts.push(`(${work.year})`);
  const name = titleParts.join(' ');

  const lines = [];
  if (cfg.descriptionPrefix) lines.push(cfg.descriptionPrefix);
  if (cfg.showPanel) {
    lines.push('— PUNTUACIONES —');
    lines.push(...buildPanel(metrics, { cfg }));
    if (combined) {
      lines.push(`————— ${starsText(combined.value)} ${round1(combined.value)}/10 · ${verdictFor(combined.value)}`);
    }
    if (metrics.rt_tomatometer && metrics.rt_tomatometer.text) {
      lines.push(`🍅 Consenso: ${String(metrics.rt_tomatometer.text).slice(0, 260)}`);
    }
  }
  if (work.overview && !cfg.showPanel) lines.push(work.overview);
  else if (work.overview) lines.push('', work.overview);
  if (note) lines.push('', note);

  const meta = {
    id: (work.ids && work.ids.imdb) || (work.ids && work.ids.tmdb ? `tmdb:${work.ids.tmdb}` : work.id) || 'ratings:unknown',
    type: work.type === 'anime' ? 'anime' : work.type === 'series' ? 'series' : 'movie',
    name,
    genres: (work.genres || []).slice(0, 6),
    releaseInfo: work.year ? `${work.year}` : undefined,
    poster: work.poster || undefined,
    background: work.background || work.poster || undefined,
    description: lines.filter((line) => line !== '').join('\n').slice(0, 3000),
    imdbRating: badgeValue ? String(round1(badgeValue)).replace('.', '.') : undefined,
    runtime: work.runtime ? `${work.runtime} min` : undefined,
    links: [],
    behaviorHints: { isAdult: false },
  };
  if (catalogId) meta.catalogId = catalogId;

  if (cfg.showLinks) {
    const seen = new Set();
    for (const [key, metric] of Object.entries(metrics)) {
      if (!metric.url || seen.has(metric.url)) continue;
      seen.add(metric.url);
      meta.links.push({
        name: `${METRICS[key] ? METRICS[key].emoji : ''} ${metricLabel(key)} ${round1(metric.raw)}${METRICS[key] && METRICS[key].scale === 100 ? '%' : '/10'}`,
        category: 'Puntuaciones',
        url: metric.url,
      });
    }
    source0(work, meta);
  }
  return { meta, metrics, combined: combined ? { ...combined, verdict: verdictFor(combined.value) } : null };
}

function source0(work, meta) {
  if (work.ids && work.ids.imdb && !meta.links.some((link) => link.url.includes('imdb.com'))) {
    meta.links.push({ name: '⭐ Ficha en IMDb', category: 'Fuentes', url: `https://www.imdb.com/title/${work.ids.imdb}/` });
  }
  if (work.ids && work.ids.tmdb && !meta.links.some((link) => link.url.includes('themoviedb.org'))) {
    const mediaType = work.mediaType || (work.type === 'series' || work.type === 'anime' ? 'tv' : 'movie');
    meta.links.push({ name: '🎬 Ficha en TMDB', category: 'Fuentes', url: `https://www.themoviedb.org/${mediaType}/${work.ids.tmdb}` });
  }
  return meta;
}

/** Miniatura compacta para listados (JSON plano, página de configuración). */
function scoreSummary(metrics, combined) {
  return Object.entries(metrics).map(([key, metric]) => ({
    key,
    label: metricLabel(key),
    value: round1(metric.raw),
    scale: METRICS[key] ? METRICS[key].scale : 10,
    votes: metric.votes || null,
    url: metric.url || null,
  }));
}

/** Item de catálogo Stremio a partir de un item interno de lista. */
function buildCatalogItem(item, { cfg, type, metrics }) {
  const normalized = metrics ? normalizeMetrics(metrics) : null;
  const combined = normalized ? combine(normalized, { weights: cfg.weights, minVotes: cfg.minVotes }) : null;
  const baseScore = item.score10 !== undefined && item.score10 !== null ? item.score10 : item.score;
  const badgeValue = normalized
    ? cfg.badgeMetric && cfg.badgeMetric !== 'combined'
      ? normalized[cfg.badgeMetric]?.value ?? baseScore
      : combined
        ? combined.value
        : baseScore
    : baseScore;
  const lines = normalized ? buildPanel(normalized, { cfg, quiet: true }) : [];
  const name = item.year ? `${item.title} (${item.year})` : item.title;
  const catalog = {
    id: item.id || item.url || `raw:${Math.random().toString(36).slice(2)}`,
    type: type === 'anime' ? 'anime' : type === 'series' ? 'series' : 'movie',
    name,
    poster: item.poster || undefined,
    background: item.poster || undefined,
    description:
      lines.length > 0
        ? lines.join('\n')
        : [baseScore ? `${round1(baseScore)}/10` : null, item.votes ? `${formatVotes(item.votes)} votos` : null, item.overview || null]
            .filter(Boolean)
            .join(' · '),
    imdbRating: badgeValue !== null && badgeValue !== undefined ? String(round1(clamp(Number(badgeValue), 0, 10))).replace('.', '.') : undefined,
    releaseInfo: item.year ? `${item.year}` : undefined,
    behaviorHints: { isAdult: false },
  };
  if (item.rank) catalog.name = `${item.rank}. ${catalog.name}`;
  return catalog;
}

/** HTML de la tabla de puntuaciones (página de configuración). */
function panelHtml(metrics, combined) {
  const rows = Object.entries(metrics)
    .map(([key, metric]) => {
      const def = METRICS[key] || {};
      return `<tr>
        <td class="src"><span class="emo">${escapeHtml(def.emoji || '•')}</span> ${escapeHtml(def.label || key)}</td>
        <td class="val">${round1(metric.raw)}<small>${def.scale === 100 ? '/100' : '/10'}</small></td>
        <td class="bar"><i style="width:${clamp((metric.raw / (def.scale || 10)) * 100, 2, 100)}%"></i></td>
        <td class="votes">${metric.votes ? escapeHtml(formatVotes(metric.votes)) + ' votos' : '—'}</td>
        <td class="link">${metric.url ? `<a href="${escapeHtml(metric.url)}" target="_blank" rel="noreferrer noopener">abrir</a>` : '—'}</td>
      </tr>`;
    })
    .join('');
  const total = combined
    ? `<div class="combined"><span class="big">${round1(combined.value)}</span><span class="of">/10</span><span class="stars">${starsText(combined.value)}</span><span class="verdict">${escapeHtml(combined.verdict || '')}</span></div>`
    : '<div class="combined empty">Sin puntuaciones disponibles</div>';
  return `${total}<table class="scores">${rows || '<tr><td>Sin datos</td></tr>'}</table>`;
}

module.exports = { buildMeta, buildCatalogItem, buildPanel, metricLine, formatVotes, scoreSummary, panelHtml, verdictFor, normalizeMetrics, combine };
