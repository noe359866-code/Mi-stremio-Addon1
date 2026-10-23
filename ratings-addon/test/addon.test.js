'use strict';

/**
 * test/addon.test.js — prueba de punta a punta del addon en modo demo.
 * El modo demo sirve HTML/JSON generado con el markup real de IMDb, RT,
 * Metacritic, FilmAffinity y TMDB, así que se ejercitan los parsers, la
 * resolución de títulos, la caché y el formato de Stremio sin tocar la red.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Runtime } = require('../src/app');
const { base64UrlEncode } = require('../src/util');

const runtime = new Runtime({ RATINGS_MOCK: '1', CACHE_TTL_HOURS: '24', LOG_VERBOSE: '0' });

const call = (path, query = {}) => runtime.handle({ method: 'GET', path, url: path, query, headers: { host: 'localhost:7000' } });
const jsonOf = async (path, query) => JSON.parse((await call(path, query)).body);

test.beforeEach(() => {
  for (const cache of Object.values(runtime.caches)) cache.clear();
});

test('manifest.json: recursos, tipos, catálogos y config de Stremio', async () => {
  const manifest = await jsonOf('/manifest.json');
  assert.equal(manifest.id, 'community.ratings.scraper');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(manifest.types.sort(), ['anime', 'movie', 'series']);
  assert.ok(manifest.idPrefixes.includes('tt'), 'Stremio nos llamará con ids tt…');
  const resources = manifest.resources.map((resource) => resource.name).sort();
  assert.deepEqual(resources, ['catalog', 'meta'], 'solo metadatos: nada de streams');
  const metaResource = manifest.resources.find((resource) => resource.name === 'meta');
  assert.ok(metaResource.types.includes('movie') && metaResource.types.includes('series') && metaResource.types.includes('anime'));

  assert.ok(manifest.catalogs.length >= 15);
  for (const catalog of manifest.catalogs) {
    assert.ok(['movie', 'series', 'anime'].includes(catalog.type), catalog.type);
    assert.ok(/^[a-z0-9-]+$/.test(catalog.id), `id de catálogo inválido: ${catalog.id}`);
    assert.ok(catalog.name.length > 3);
    assert.ok(catalog.extra.some((extra) => extra.name === 'search'), 'los catálogos deben permitir búsqueda');
  }
  assert.ok(manifest.logo.endsWith('/logo.svg'));
  assert.equal(manifest.behaviorHints.configurable, true);
  assert.ok(manifest.config.some((entry) => entry.key === 'badge'));
});

test('rutas de assets y páginas', async () => {
  const logo = await call('/logo.svg');
  assert.equal(logo.status, 200);
  assert.match(logo.headers['Content-Type'], /image\/svg/);
  assert.match(logo.body, /<svg/);
  const configure = await call('/configure.html');
  assert.equal(configure.status, 200);
  assert.match(configure.body, /Fuentes a scrapear/);
  assert.match(configure.body, /manifest\.json/);
  const index = await call('/');
  assert.match(index.body, /configure\.html/);
  const health = await jsonOf('/api/health');
  assert.equal(health.ok, true);
  assert.equal(health.mock, true);
  assert.equal(health.sources.length, 5);
});

test('/api/health y 404 con rutas útiles', async () => {
  const missing = await call('/nada');
  assert.equal(missing.status, 404);
  const body = JSON.parse(missing.body);
  assert.match(body.error, /ruta no encontrada/);
  assert.ok(body.routes.length >= 3);
});

test('catálogo IMDb Top 250: ids, badge de nota y póster', async () => {
  const data = await jsonOf('/catalog/movie/imdb-top.json', { debug: '1' });
  assert.ok(data.metas.length >= 3, `metas=${data.metas.length}`);
  const first = data.metas[0];
  assert.match(first.id, /^imdb:tt\d{6,10}$/);
  assert.ok(Number(first.imdbRating) > 7 && Number(first.imdbRating) <= 10, first.imdbRating);
  assert.match(first.name, /The Shawshank Redemption \(1994\)/);
  assert.match(first.poster, /^https:\/\//);
  assert.equal(first.type, 'movie');
  assert.equal(data.diagnostics.provider, 'imdb');
});

test('las notas de 0-100 (RT/Metacritic) se normalizan al badge de Stremio', async () => {
  const rt = await jsonOf('/catalog/movie/rt-top.json');
  const inception = rt.metas.find((meta) => /Inception/.test(meta.name));
  assert.ok(inception, 'inception en la lista');
  assert.equal(inception.imdbRating, '8.7', '93% -> 9.3, 87% -> 8.7');

  const mc = await jsonOf('/catalog/movie/mc-top.json');
  const dune = mc.metas[0];
  assert.ok(Number(dune.imdbRating) <= 10, dune.imdbRating);
});

test('catálogo de anime excluye series que no son anime', async () => {
  const data = await jsonOf('/catalog/anime/tmdb-top.json');
  assert.ok(data.metas.length >= 1);
  assert.ok(!data.metas.some((meta) => /Breaking Bad/.test(meta.name)), JSON.stringify(data.metas.map((m) => m.name)));
  assert.ok(data.metas.every((meta) => meta.type === 'anime'));
});

test('búsqueda dentro de un catálogo (extra.search de Stremio)', async () => {
  const data = await jsonOf('/catalog/movie/imdb-top.json', { search: 'shawshank' });
  assert.equal(data.metas.length, 1);
  assert.match(data.metas[0].name, /Shawshank/);
});

test('catálogo vacío/degradado no rompe: devuelve metas:[] con error informativo', async () => {
  const data = await jsonOf('/catalog/movie/catalogo-inexistente.json');
  assert.deepEqual(data.metas, []);
  assert.match(data.errors[0], /catálogo desconocido/);
});

test('/meta/tt… : ficha con las 5 fuentes, badge, enlaces y descripción', async () => {
  const data = await jsonOf('/meta/movie/tt1375606.json');
  const meta = data.meta;
  assert.ok(meta, 'meta presente');
  assert.equal(meta.id, 'tt1375606', 'el id devuelto es el que pidió Stremio');
  assert.equal(meta.type, 'movie');
  assert.match(meta.name, /Inception/);
  assert.equal(typeof meta.imdbRating, 'string');
  const description = meta.description;
  for (const label of ['IMDb', 'FilmAffinity', 'Tomatometer', 'Metascore', 'TMDB']) {
    assert.match(description, new RegExp(label), `falta ${label} en la descripción`);
  }
  assert.match(description, /PUNTUACIONES/);
  assert.match(description, /·/);
  assert.ok(meta.links.length >= 4, 'un enlace por fuente con url');
  assert.ok(meta.links.every((link) => link.category === 'Puntuaciones' || link.category === 'Fuentes'));
  assert.ok(meta.poster.includes('image.tmdb.org'), 'póster desde TMDB');
  assert.ok(meta.description.length <= 3000);
});

test('/meta funciona con ids alternativos (tmdb:, rt:, fa:) y con series', async () => {
  const byTmdb = await jsonOf('/meta/movie/tmdb:27205.json');
  assert.match(byTmdb.meta.name, /Inception/);
  const bySlug = await jsonOf('/meta/movie/rt:inception.json');
  assert.match(bySlug.meta.name, /Inception/);
  const serie = await jsonOf('/meta/series/tt0903747.json');
  assert.equal(serie.meta.type, 'series');
  assert.match(serie.meta.description, /IMDb 9\.5/);
  const anime = await jsonOf('/meta/anime/tt12343534.json');
  assert.equal(anime.meta.type, 'anime');
  assert.match(anime.meta.description, /Tomatometer 100%/);
});

test('config por URL (/c/<base64>): activa fuentes, cambia el badge y recorta catálogos', async () => {
  const token = base64UrlEncode({ sources: ['imdb'], badge: 'imdb', panel: true, unavailable: false });
  const manifest = await jsonOf(`/c/${token}/manifest.json`);
  assert.deepEqual(
    manifest.catalogs.map((catalog) => `${catalog.type}/${catalog.id}`).sort(),
    ['anime/imdb-top', 'movie/imdb-top', 'series/imdb-top']
  );
  const meta = await jsonOf(`/c/${token}/meta/movie/tt1375606.json`);
  assert.equal(meta.meta.imdbRating, '8.8', 'badge = IMDb puro');
  assert.ok(!/FilmAffinity/.test(meta.meta.description), 'las fuentes apagadas no aparecen');
  assert.match(meta.meta.description, /IMDb 8\.8/);

  const combinedToken = base64UrlEncode({ badge: 'combined', minScore: 9 });
  const filtered = await jsonOf(`/c/${combinedToken}/catalog/movie/imdb-top.json`);
  assert.ok(filtered.metas.every((meta) => Number(meta.imdbRating) >= 9), JSON.stringify(filtered.metas.map((m) => m.imdbRating)));
});

test('/api/ratings: cada fuente reporta su estado y hay nota combinada', async () => {
  const data = await jsonOf('/api/ratings', { title: 'Parasite', type: 'movie' });
  assert.equal(data.ok, true);
  assert.equal(Object.keys(data.scores).length, 7, JSON.stringify(Object.keys(data.scores)));
  assert.deepEqual(
    data.scores.rt_tomatometer,
    {
      value: 99,
      scale: 100,
      votes: 570,
      text: 'Una sátira de clases con giros imposibles: Bong Joon-ho en estado puro.',
      url: 'https://www.rottentomatoes.com/m/parasite',
      rank: null,
    },
    'RT trae nota, nº de críticas, el consenso y la ficha enlazada'
  );
  assert.equal(data.scores.imdb.votes, 890123);
  assert.equal(data.scores.mc_metascore.value, 96);
  assert.ok(data.combined.value > 8 && data.combined.value < 10);
  assert.equal(data.sources.length, 5);
  assert.ok(data.sources.every((source) => source.ok === true), JSON.stringify(data.sources));
  assert.equal(data.query.ids.imdb, 'tt6751668', 'TMDB resuelve el imdb_id desde el título');
});

test('/api/ratings responde error claro si nada cuadra', async () => {
  const data = await jsonOf('/api/ratings', { title: 'pelicula que no existe en ningun sitio 1899', type: 'movie' });
  assert.equal(data.ok, undefined);
  assert.match(data.error, /ninguna fuente|no se puede resolver/);
  assert.ok(data.hint);
});

test('/api/ratings por id directo y con url de ficha (deep link de IMDb/RT/FA)', async () => {
  const byId = await jsonOf('/api/ratings/tt0068646');
  assert.match(byId.stremio.name, /Shawshank/);
  const byRtUrl = await jsonOf('/api/ratings', { url: 'https://www.rottentomatoes.com/m/jujutsu_kaisen', type: 'series' });
  assert.ok(byRtUrl.ok, JSON.stringify(byRtUrl).slice(0, 200));
});

test('la caché evita repetir scraping y el segundo hit es instantáneo', async () => {
  const first = await jsonOf('/api/ratings', { title: 'Inception', type: 'movie' });
  const cacheEntries = runtime.caches.ratings.stats().entries;
  assert.ok(cacheEntries >= 1);
  const second = await jsonOf('/api/ratings', { title: 'Inception', type: 'movie' });
  assert.equal(second.cached, true, 'la segunda vez sale de caché');
  assert.equal(second.ms < first.ms + 50, true, `${second.ms} vs ${first.ms}`);
  assert.deepEqual(second.scores, first.scores);
});

test('fuentes desconectadas: el addon sigue respondiendo con lo que haya', async () => {
  const token = base64UrlEncode({ sources: ['rottentomatoes'] });
  const data = await jsonOf(`/c/${token}/api/ratings`, { title: 'Inception', type: 'movie' });
  assert.deepEqual(Object.keys(data.scores).sort(), ['rt_audience', 'rt_tomatometer']);
  const meta = await jsonOf(`/c/${token}/meta/movie/tt1375606.json`);
  assert.match(meta.meta.description, /Tomatometer 87%/);
  assert.ok(!/IMDb 8\.8/.test(meta.meta.description));
});

test('POST no permitido y OPTIONS con CORS', async () => {
  const post = await runtime.handle({ method: 'POST', path: '/manifest.json', url: '/manifest.json', query: {}, headers: {} });
  assert.equal(post.status, 405);
  const options = await runtime.handle({ method: 'OPTIONS', path: '/manifest.json', url: '/manifest.json', query: {}, headers: {} });
  assert.equal(options.status, 204);
  assert.equal(options.headers['Access-Control-Allow-Origin'], '*');
});
