'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { Runtime } = require('../src/app');
const { base64UrlEncode, base64UrlDecode } = require('../src/util');
const { normalizeManifestUrl, upstreamResourceUrl, posterItemFromPath } = require('../src/wrapper');
const { toLambdaResponse } = require('../src/serverless');

const CINEMETA = 'https://v3-cinemeta.strem.io/manifest.json';
const CUSTOM = 'https://custom.addon.test/manifest.json';
const runtime = new Runtime({ RATINGS_MOCK: '1' });

function call(path, query = {}) {
  return runtime.handle({ method: 'GET', path, url: path, query, headers: { host: 'localhost:7000', 'x-forwarded-proto': 'http' } });
}
async function jsonOf(path, query) {
  const res = await call(path, query);
  return { ...res, data: JSON.parse(res.body) };
}
function token(config) {
  return base64UrlEncode(config);
}

test.beforeEach(() => {
  for (const cache of Object.values(runtime.caches)) cache.clear();
});

test('manifiesto: publica los catálogos de Cinemeta y ninguna lista top propia', async () => {
  const { data: manifest } = await jsonOf('/manifest.json');
  assert.deepEqual(manifest.catalogs.map((catalog) => `${catalog.type}/${catalog.id}`), ['movie/top', 'series/top']);
  assert.ok(!manifest.catalogs.some((catalog) => /imdb-top|rt-top|mc-top|tmdb-top|fa-top/.test(catalog.id)));
  assert.deepEqual(manifest.types.sort(), ['movie', 'series']);
  assert.deepEqual(manifest.resources.map((resource) => resource.name).sort(), ['catalog', 'meta']);
  assert.ok(manifest.config.some((entry) => entry.key === 'nativeBadge'));
  assert.ok(manifest.config.some((entry) => entry.key === 'posterOverlay'));
  assert.match(manifest.description, /Sin catálogos top propios/);
});

test('varios upstreams: conserva Cinemeta + el catálogo de otro addon sin duplicar', async () => {
  const cfg = token({ upstreams: [CINEMETA, CUSTOM, CUSTOM] });
  const { data: manifest } = await jsonOf(`/c/${cfg}/manifest.json`);
  assert.deepEqual(manifest.catalogs.map((catalog) => `${catalog.type}/${catalog.id}`), ['movie/top', 'series/top', 'movie/custom-list']);
  assert.equal(manifest.catalogs[2].name, 'Mis películas');

  const { data: catalog } = await jsonOf(`/c/${cfg}/catalog/movie/custom-list.json`);
  assert.equal(catalog.metas.length, 1);
  assert.equal(catalog.metas[0].id, 'custom:inception', 'el ID del otro addon no se cambia');
  assert.equal(catalog.metas[0].name, 'Inception');
  assert.equal(catalog.metas[0].imdbRating, '8.4', 'resuelve por título aunque el ID no sea tt/tmdb');
});

test('catálogo envuelto: conserva orden/contenido, badge combinado y póster propio', async () => {
  const { data: catalog } = await jsonOf('/catalog/movie/top.json');
  assert.ok(catalog.metas.length >= 3);
  assert.equal(catalog.metas[0].id, 'tt1375606');
  assert.equal(catalog.metas[0].name, 'Inception');
  assert.equal(catalog.metas[0].imdbRating, '8.4');
  assert.match(catalog.metas[0].poster, /^http:\/\/localhost:7000\/poster\/[A-Za-z0-9_-]+\.jpg$/);
  assert.match(catalog.metas[0].description, /Sinopsis upstream/, 'no reemplaza la sinopsis del catálogo original');

  const posterToken = catalog.metas[0].poster.match(/\/poster\/([A-Za-z0-9_-]+)\.jpg/)[1];
  const item = JSON.parse(base64UrlDecode(posterToken));
  assert.equal(item.id, 'tt1375606');
  assert.equal(item.src, `https://images.metahub.space/poster/small/tt1375606/img`);
});

test('las dos mejoras se pueden activar por separado', async () => {
  const noNative = token({ nativeBadge: false, posterOverlay: true });
  const first = await jsonOf(`/c/${noNative}/catalog/movie/top.json`);
  assert.equal(first.data.metas[0].imdbRating, '8.8', 'se conserva el badge IMDb upstream');
  assert.match(first.data.metas[0].poster, /\/poster\//);

  const noPoster = token({ nativeBadge: true, posterOverlay: false });
  const second = await jsonOf(`/c/${noPoster}/catalog/movie/top.json`);
  assert.equal(second.data.metas[0].imdbRating, '8.4');
  assert.equal(second.data.metas[0].poster, 'https://images.metahub.space/poster/small/tt1375606/img');
});

test('la URL de póster conserva el prefijo de configuración', async () => {
  const cfg = token({ sources: ['imdb'], badge: 'imdb', upstreams: [CINEMETA] });
  const { data: catalog } = await jsonOf(`/c/${cfg}/catalog/movie/top.json`);
  assert.equal(catalog.metas[0].imdbRating, '8.8');
  assert.match(catalog.metas[0].poster, new RegExp(`^http://localhost:7000/c/${cfg}/poster/`));
});

test('póster: genera JPEG 500x750 con notas y lo cachea', async () => {
  const { data: catalog } = await jsonOf('/catalog/movie/top.json');
  const url = new URL(catalog.metas[0].poster);
  const response = await call(url.pathname);
  assert.equal(response.status, 200);
  assert.equal(response.headers['Content-Type'], 'image/jpeg');
  assert.equal(response.headers['X-Rating-Poster'], 'generated');
  assert.ok(Buffer.isBuffer(response.body));
  const image = await sharp(response.body).metadata();
  assert.equal(image.format, 'jpeg');
  assert.equal(image.width, 500);
  assert.equal(image.height, 750);
  assert.ok(response.body.length < 100000, `póster demasiado grande: ${response.body.length}`);

  const again = await call(url.pathname);
  assert.equal(again.status, 200);
  assert.ok(again.body.equals(response.body));
});

test('ficha envuelta: mantiene metadatos upstream y añade panel, badge, enlaces y póster', async () => {
  const { data } = await jsonOf('/meta/movie/tt1375606.json');
  assert.equal(data.meta.id, 'tt1375606');
  assert.equal(data.meta.name, 'Inception');
  assert.equal(data.meta.imdbRating, '8.4');
  assert.match(data.meta.description, /Sinopsis upstream de Inception/);
  assert.match(data.meta.description, /PUNTUACIONES/);
  assert.match(data.meta.description, /FilmAffinity/);
  assert.ok(data.meta.links.some((link) => link.category === 'share'), 'no pierde los enlaces originales');
  assert.ok(data.meta.links.some((link) => link.category === 'Puntuaciones'));
  assert.match(data.meta.poster, /\/poster\//);
});

test('ids no soportados por Cinemeta siguen usando el resolvedor propio', async () => {
  const tmdb = await jsonOf('/meta/movie/tmdb:27205.json');
  assert.match(tmdb.data.meta.name, /Inception/);
  const anime = await jsonOf('/meta/anime/anilist:21495.json');
  assert.match(anime.data.meta.name, /Your Name|Kimi no Na wa/);
});

test('normaliza URLs y rechaza SSRF local', () => {
  assert.equal(normalizeManifestUrl('stremio://v3-cinemeta.strem.io/manifest.json'), CINEMETA);
  assert.equal(normalizeManifestUrl('https://custom.addon.test'), CUSTOM);
  assert.throws(() => normalizeManifestUrl('http://127.0.0.1:7000/manifest.json'), /privado/);
  assert.throws(() => normalizeManifestUrl('http://192.168.1.10/manifest.json'), /privado/);
  assert.throws(() => normalizeManifestUrl('file:///etc/passwd'), /https?:\/\//);
});

test('la URL upstream conserva extras, configuración y query propia', () => {
  const upstream = { url: 'https://custom.addon.test/CONFIG/manifest.json?key=abc' };
  const url = upstreamResourceUrl(upstream, '/catalog/movie/top/search%3Dinception.json', { skip: 20, cfg: 'nuestro', debug: '1' });
  assert.equal(url, 'https://custom.addon.test/CONFIG/catalog/movie/top/search%3Dinception.json?key=abc&skip=20');
});

test('token de póster inválido no produce una petición saliente', () => {
  assert.equal(posterItemFromPath('/poster/no-es-json.jpg'), null);
  assert.equal(posterItemFromPath('/poster/' + base64UrlEncode({ src: 'http://127.0.0.1/private.jpg' }) + '.jpg'), null);
});

test('un upstream caída devuelve error claro en vez de publicar listas propias', async () => {
  const rt = new Runtime({ RATINGS_MOCK: '1', UPSTREAM_MANIFEST_URLS: 'https://unknown.invalid/manifest.json' });
  const res = await rt.handle({ method: 'GET', path: '/manifest.json', url: '/manifest.json', query: {}, headers: {} });
  assert.equal(res.status, 502);
  const body = JSON.parse(res.body);
  assert.match(body.error, /no se pudo cargar ningún catálogo upstream/);
});

test('serverless codifica imágenes binarias en base64', () => {
  const result = toLambdaResponse({ status: 200, headers: { 'Content-Type': 'image/jpeg' }, body: Buffer.from([1, 2, 3, 255]) });
  assert.equal(result.isBase64Encoded, true);
  assert.deepEqual(Buffer.from(result.body, 'base64'), Buffer.from([1, 2, 3, 255]));
  assert.equal(result.headers['Content-Type'], 'image/jpeg');
});
