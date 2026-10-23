'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeMetrics, combine, starsText, METRICS } = require('../src/defs');
const { buildPanel, buildMeta, formatVotes, metricLine } = require('../src/format');

test('normalizeMetrics lleva todo a escala 0-10 y descarta basura', () => {
  const metrics = normalizeMetrics({
    imdb: { value: 8.2, votes: 1000 },
    rt_tomatometer: { value: 95 },
    mc_metascore: { value: '74' },
    filmaffinity: { value: 0 }, // inválida
    tmdb: { value: 12 }, // fuera de escala -> se recorta a 10
    inexistente: { value: 5 },
  });
  assert.equal(metrics.imdb.value, 8.2);
  assert.equal(metrics.imdb.display, '8.2/10');
  assert.equal(metrics.rt_tomatometer.value, 9.5, '95% -> 9.5');
  assert.equal(metrics.mc_metascore.value, 7.4, '74/100 -> 7.4');
  assert.equal(metrics.filmaffinity, undefined);
  assert.equal(metrics.tmdb.value, 10);
  assert.equal(metrics.inexistente, undefined);
});

test('combine es una media ponderada donde IMDb manda más que TMDB', () => {
  const metrics = normalizeMetrics({ imdb: { value: 9, votes: 100000 }, tmdb: { value: 5, votes: 100000 } });
  const result = combine(metrics, {});
  assert.ok(result.value > 7 && result.value < 9, `esperado ~8, got ${result.value}`);
  assert.deepEqual(result.used.map((entry) => entry.key).sort(), ['imdb', 'tmdb']);
});

test('combine amortigua fuentes con pocos votos (confianza)', () => {
  const many = normalizeMetrics({ imdb: { value: 9.5, votes: 900000 }, filmaffinity: { value: 2, votes: 400000 } });
  const few = normalizeMetrics({ imdb: { value: 9.5, votes: 900000 }, filmaffinity: { value: 2, votes: 4 } });
  const manyScore = combine(many, {}).value;
  const fewScore = combine(few, {}).value;
  assert.ok(fewScore > manyScore, `pocos votos debe pesar menos: ${fewScore} vs ${manyScore}`);
  assert.ok(fewScore >= 9, `${fewScore}`);
});

test('combine respeta pesos a 0 y el filtro de métricas', () => {
  const metrics = normalizeMetrics({ imdb: { value: 8, votes: 100000 }, rt_tomatometer: { value: 40 } });
  assert.equal(combine(metrics, { weights: { rt_tomatometer: 0 } }).value, 8);
  assert.equal(combine(metrics, { metrics: ['imdb'] }).value, 8);
  assert.equal(combine({}, {}), null, 'sin métricas no hay nota combinada');
});

test('buildPanel pinta una línea por fuente y marca las que faltan', () => {
  const metrics = normalizeMetrics({
    imdb: { value: 8.8, votes: 2500000, rank: 13 },
    rt_tomatometer: { value: 87, votes: 392 },
  });
  const lines = buildPanel(metrics, { cfg: { includePanelEmoji: true, showUnavailable: true, metricOrder: Object.keys(METRICS) } });
  assert.match(lines[0], /⭐ IMDb 8\.8\/10 · 2,5 M votos · #13/);
  assert.ok(lines.some((line) => /🎞️ FilmAffinity — sin datos/.test(line)), lines.join('|'));
  const quiet = buildPanel(metrics, { cfg: { includePanelEmoji: false, showUnavailable: false, metricOrder: Object.keys(METRICS) } });
  assert.equal(quiet.length, 2);
  assert.ok(!/sin datos/.test(quiet.join(' ')));
});

test('formatVotes y metricLine con unidades distintas por fuente', () => {
  assert.equal(formatVotes(2500000), '2,5 M');
  assert.equal(formatVotes(512340), '512 k');
  assert.equal(formatVotes(900), '900');
  assert.equal(formatVotes(null), null);
  assert.equal(metricLine('mc_metascore', { raw: 81, votes: 42, unit: 'críticas' }), '🎯 Metascore 81% · 42 críticas');
  assert.match(metricLine('imdb', { raw: 8.4, votes: 100, derived: 'tmdb' }), /\(vía tmdb\)/);
});

test('buildMeta produce una ficha válida de Stremio con badge y desglose', () => {
  const work = {
    type: 'series',
    title: 'Breaking Bad (2008)',
    year: 2008,
    poster: 'https://image.tmdb.org/p.jpg',
    genres: ['Drama'],
    ids: { imdb: 'tt0903747', tmdb: '1396' },
  };
  const raw = { imdb: { value: 9.5, votes: 2000000 }, rt_tomatometer: { value: 96 }, filmaffinity: { value: 8.9, votes: 200000 } };
  const { meta, combined } = buildMeta({ work, rawMetrics: raw, cfg: { badgeMetric: 'combined', showPanel: true, showUnavailable: false, showLinks: true, includePanelEmoji: true, weights: {}, minVotes: {} } });
  assert.equal(meta.id, 'tt0903747');
  assert.equal(meta.type, 'series');
  assert.equal(meta.name, 'Breaking Bad (2008)', 'no duplica el año');
  assert.equal(typeof meta.imdbRating, 'string');
  assert.ok(Number(meta.imdbRating) > 9 && Number(meta.imdbRating) <= 10, meta.imdbRating);
  assert.match(meta.description, /— PUNTUACIONES —/);
  assert.match(meta.description, /🍅 Tomatometer 96%/);
  assert.equal(meta.links.length, 2, 'sin urls de las fuentes, quedan los enlaces fijos (IMDb + TMDB)');
  assert.match(meta.links[0].url, /imdb\.com\/title\/tt0903747/);
  assert.match(meta.links[1].url, /themoviedb\.org\/tv\/1396/);
  assert.equal(meta.behaviorHints.isAdult, false);
  assert.equal(combined.used.length, 3);
});

test('buildMeta permite forzar IMDb como badge y recortar a 3000 caracteres', () => {
  const { meta } = buildMeta({
    work: { type: 'movie', title: 'X', ids: { imdb: 'tt0000001' } },
    rawMetrics: { imdb: { value: 7.7, votes: 5000 }, rt_tomatometer: { value: 99 } },
    cfg: { badgeMetric: 'imdb', showPanel: true, showUnavailable: true, showLinks: false, includePanelEmoji: true, weights: {}, minVotes: {}, metricOrder: ['imdb'] },
  });
  assert.equal(meta.imdbRating, '7.7');
  assert.ok(meta.description.length <= 3000);
});

test('starsText dibuja 5 estrellas', () => {
  assert.equal(starsText(9.3), '★★★★★');
  assert.equal(starsText(8.4), '★★★★☆');
  assert.equal(starsText(2), '★☆☆☆☆');
  assert.equal(starsText(null), '☆☆☆☆☆');
});
