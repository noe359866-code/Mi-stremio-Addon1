'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseScoreLoose,
  parseCountLoose,
  foldText,
  titleSimilarity,
  slugifyUnderscore,
  slugifyDash,
  dropLeadingArticle,
  yearFrom,
  extractJsonScripts,
  deepFindKey,
  deepCollectKey,
  metaContent,
  firstMatch,
  mergeGaps,
  stripYearSuffix,
  base64UrlEncode,
  base64UrlDecode,
} = require('../src/util');

test('parseScoreLoose entiende coma decimal española y porcentajes', () => {
  assert.equal(parseScoreLoose('7,4'), 7.4);
  assert.equal(parseScoreLoose('8.8'), 8.8);
  assert.equal(parseScoreLoose('96%'), 96);
  assert.equal(parseScoreLoose('100'), 100);
  assert.equal(parseScoreLoose('Rating 8,1/10'), 8.1);
  assert.equal(parseScoreLoose(null), null);
  assert.equal(parseScoreLoose('sin datos'), null);
});

test('parseCountLoose entiende miles en español y sufijos K/M', () => {
  assert.equal(parseCountLoose('98.123'), 98123);
  assert.equal(parseCountLoose('1.234.567'), 1234567);
  assert.equal(parseCountLoose('2.4M'), 2400000);
  assert.equal(parseCountLoose('312K'), 312000);
  assert.equal(parseCountLoose('5.4K'), 5400);
  assert.equal(parseCountLoose('1,234,567'), 1234567);
  assert.equal(parseCountLoose(4567), 4567);
  assert.equal(parseCountLoose(''), null);
});

test('foldText normaliza acentos, comillas y puntuación', () => {
  assert.equal(foldText('El Señor de los Anillos: "La Comunidad"'), 'el senor de los anillos la comunidad');
  assert.equal(foldText('AMÉLIE &amp; Amélie'), 'amelie amelie');
});

test('titleSimilarity detecta títulos equivalentes', () => {
  assert.equal(titleSimilarity('Inception', 'Inception'), 1);
  assert.ok(titleSimilarity('The Shawshank Redemption', 'Shawshank Redemption') > 0.6);
  assert.equal(titleSimilarity('Inception', 'Shrek'), 0);
  assert.equal(titleSimilarity('', 'x'), 0);
});

test('slugs: RT con guion bajo, Metacritic con guiones, y variante sin artículo', () => {
  assert.equal(slugifyUnderscore('The Spider-Man: No Way Home!'), 'the_spider_man_no_way_home');
  assert.equal(slugifyDash('El laberinto del fauno'), 'el-laberinto-del-fauno');
  assert.equal(dropLeadingArticle(slugifyUnderscore('Los Vengadores'), '_'), 'vengadores');
  assert.equal(dropLeadingArticle('the_godfather', '_'), 'godfather');
  assert.equal(dropLeadingArticle('el-laberinto-del-fauno', '-'), 'laberinto-del-fauno');
  assert.equal(dropLeadingArticle('inception', '_'), '', 'un solo término no se recorta');
});

test('yearFrom saca años de texto sucio', () => {
  assert.equal(yearFrom('Inception (2010) - IMDb'), 2010);
  assert.equal(yearFrom('2008–2013'), 2008);
  assert.equal(yearFrom('sin año'), null);
});

test('extractJsonScripts lee ld+json, prs.init-data y asignaciones window.*', () => {
  const html = `<html><head>
  <script type="application/ld+json">{"@type":"Movie","name":"X","aggregateRating":{"ratingValue":"7.7"}}</script>
  </head><body>
  <script type="application/prs.init-data+json">{"contentInfo":{"criticsScore":88}}</script>
  <script>window.__INITIAL_DATA__ = {"deep":{"audienceScore":75}};</script>
  <script>var noise = 1; // no es json</script>
  </body></html>`;
  const blobs = extractJsonScripts(html);
  assert.equal(blobs.length, 3, `blobs: ${JSON.stringify(blobs.map((b) => b.label))}`);
  assert.equal(deepFindKey(blobs[0].data, ['ratingValue']), '7.7');
  assert.equal(deepFindKey(blobs[1].data, ['criticsScore']), 88);
  assert.equal(deepFindKey(blobs[2].data, ['audienceScore']), 75);
});

test('deepCollectKey reúne todas las coincidencias', () => {
  const data = { a: [{ url: '/m/uno' }], b: { c: { url: '/m/dos' } }, d: { url: '/tv/tres' } };
  assert.deepEqual(deepCollectKey(data, 'url').sort(), ['/m/dos', '/m/uno', '/tv/tres'].sort());
});

test('metaContent soporta los dos órdenes de atributos', () => {
  const html = `<meta property="og:title" content="Dune (2021)" /><meta content="8.1" name="score" />`;
  assert.equal(metaContent(html, 'og:title'), 'Dune (2021)');
  assert.equal(metaContent(html, 'score'), '8.1');
  assert.equal(metaContent(html, 'no-existe'), null);
});

test('firstMatch prueba los patrones en orden', () => {
  assert.equal(firstMatch('abc', [/zzz(\d)/, /abc(\d)/, /b(\d)/]), null);
  assert.equal(firstMatch('abc7', [/zzz(\d)/, /abc(\d)/]), '7');
});

test('mergeGaps sólo rellena huecos y stripYearSuffix limpia', () => {
  assert.deepEqual(mergeGaps({ title: 'A', year: null, poster: '' }, { title: 'B', year: 2000, poster: 'p', extra: 1 }), {
    title: 'A',
    year: 2000,
    poster: 'p',
    extra: 1,
  });
  assert.equal(stripYearSuffix('Origen (2010)'), 'Origen');
  assert.equal(stripYearSuffix('[1994] Cadena perpetua'), '[1994] Cadena perpetua');
});

test('el token de configuración viaja en base64url', () => {
  const cfg = { sources: ['imdb', 'tmdb'], badge: 'imdb', min: 7.5 };
  const token = base64UrlEncode(cfg);
  assert.ok(!/[+/=]/.test(token), 'sin caracteres no-URL');
  assert.deepEqual(JSON.parse(base64UrlDecode(token)), cfg);
});
