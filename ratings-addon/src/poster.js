'use strict';

/** Genera un JPEG 2:3 con las puntuaciones impresas sobre el póster original. */

const sharp = require('sharp');
const { ratingsFor, assertPublicHttpUrl } = require('./wrapper');

const WIDTH = 500;
const HEIGHT = 750;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const POSTER_METRICS = [
  { key: 'imdb', label: 'IMDb', color: '#f5c518', ink: '#171300', scale: 10 },
  { key: 'rt_tomatometer', label: 'RT', color: '#e6372c', ink: '#ffffff', scale: 100 },
  { key: 'mc_metascore', label: 'MC', color: '#007da5', ink: '#ffffff', scale: 100 },
  { key: 'filmaffinity', label: 'FA', color: '#2b7de9', ink: '#ffffff', scale: 10 },
  { key: 'tmdb', label: 'TMDB', color: '#01b4e4', ink: '#06202a', scale: 10 },
  { key: 'anilist', label: 'AL', color: '#3db4f2', ink: '#08202e', scale: 100 },
  { key: 'mal', label: 'MAL', color: '#2e51a2', ink: '#ffffff', scale: 10 },
  { key: 'rt_audience', label: 'RT PÚB.', color: '#8f1fbf', ink: '#ffffff', scale: 100 },
  { key: 'mc_user', label: 'MC PÚB.', color: '#556070', ink: '#ffffff', scale: 10 },
];

function xml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function metricText(def, metric) {
  const raw = Number(metric.raw);
  if (!Number.isFinite(raw)) return '';
  if (def.scale === 100) return `${Math.round(raw)}%`;
  return `${(Math.round(raw * 10) / 10).toFixed(1)}`;
}

function badgesFor(metrics = {}) {
  return POSTER_METRICS
    .filter((def) => metrics[def.key] && Number.isFinite(Number(metrics[def.key].raw)) && Number(metrics[def.key].raw) > 0)
    .slice(0, 6)
    .map((def) => ({ ...def, value: metricText(def, metrics[def.key]) }))
    .filter((def) => def.value);
}

function overlaySvg(metrics) {
  const badges = badgesFor(metrics);
  if (!badges.length) return null;
  const columns = 3;
  const rows = Math.ceil(badges.length / columns);
  const margin = 14;
  const gap = 8;
  const badgeWidth = Math.floor((WIDTH - margin * 2 - gap * (columns - 1)) / columns);
  const badgeHeight = 54;
  const panelHeight = rows * (badgeHeight + gap) + margin * 1.5;
  const top = HEIGHT - panelHeight;
  const parts = [
    `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">`,
    '<defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#070a12" stop-opacity="0"/><stop offset="0.22" stop-color="#070a12" stop-opacity="0.92"/><stop offset="1" stop-color="#070a12" stop-opacity="0.98"/></linearGradient></defs>',
    `<rect x="0" y="${top - 34}" width="${WIDTH}" height="${panelHeight + 34}" fill="url(#fade)"/>`,
  ];

  badges.forEach((badge, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const itemsInLastRow = index >= (rows - 1) * columns ? badges.length - (rows - 1) * columns : columns;
    const rowWidth = itemsInLastRow * badgeWidth + (itemsInLastRow - 1) * gap;
    const rowOffset = (WIDTH - rowWidth) / 2;
    const x = Math.round(rowOffset + column * (badgeWidth + gap));
    const y = Math.round(top + 8 + row * (badgeHeight + gap));
    parts.push(
      `<rect x="${x}" y="${y}" width="${badgeWidth}" height="${badgeHeight}" rx="10" fill="${badge.color}"/>`,
      `<text x="${x + 11}" y="${y + 20}" font-family="DejaVu Sans,Arial,sans-serif" font-size="13" font-weight="700" fill="${badge.ink}" opacity="0.88">${xml(badge.label)}</text>`,
      `<text x="${x + 11}" y="${y + 46}" font-family="DejaVu Sans,Arial,sans-serif" font-size="25" font-weight="800" fill="${badge.ink}">${xml(badge.value)}</text>`,
    );
  });
  parts.push('</svg>');
  return Buffer.from(parts.join(''));
}

async function generatePoster(item, { cfg, ctx }) {
  const source = assertPublicHttpUrl(item.src || item.poster).toString();
  const imagePromise = ctx.http.request(source, {
    raw: true,
    timeout: Math.min(cfg.timeoutMs || 4000, 5000),
    retries: 0,
    maxBytes: MAX_IMAGE_BYTES,
    headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8' },
  }, { log: ctx.log });
  const ratingPromise = ratingsFor({ ...item, poster: source }, cfg, ctx).catch(() => null);
  const [image, rating] = await Promise.all([imagePromise, ratingPromise]);
  if (!image.ok || !image.body) throw new Error(`no se pudo descargar el póster original (${image.error || image.status || 'red'})`);
  const input = Buffer.isBuffer(image.body) ? image.body : Buffer.from(image.body);
  if (input.length > MAX_IMAGE_BYTES) throw new Error('el póster original supera el tamaño máximo');
  const metrics = rating && rating.built ? rating.built.metrics : {};
  const overlay = overlaySvg(metrics || {});
  if (!overlay) return { body: input, contentType: image.contentType || 'image/jpeg', generated: false };

  try {
    const body = await sharp(input, { limitInputPixels: 40_000_000, failOn: 'error' })
      .rotate()
      .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'centre', withoutEnlargement: false })
      .composite([{ input: overlay, top: 0, left: 0 }])
      .jpeg({ quality: 82, mozjpeg: true, chromaSubsampling: '4:2:0' })
      .toBuffer();
    return { body, contentType: 'image/jpeg', generated: true };
  } catch (error) {
    ctx.log(`no se pudo componer el póster: ${error.message}`);
    return { body: input, contentType: image.contentType || 'image/jpeg', generated: false };
  }
}

function posterCacheKey(item, cfg) {
  return ['poster-v2', cfg.sources.join(','), cfg.language, item.type, item.id, item.name, item.year || '', item.src || item.poster].join(':');
}

module.exports = { generatePoster, overlaySvg, badgesFor, posterCacheKey, WIDTH, HEIGHT, MAX_IMAGE_BYTES };
