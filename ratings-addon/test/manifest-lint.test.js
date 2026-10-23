'use strict';

/**
 * test/manifest-lint.test.js — compatibilidad real con Stremio.
 *
 * Usa el linter oficial (`stremio-addon-linter`, el mismo que invoca el SDK).
 * Es un devDependency OPCIONAL: si no está instalado el test se salta.
 *   npm i -D stremio-addon-linter
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Runtime } = require('../src/app');
const { base64UrlEncode } = require('../src/util');

let linter = null;
try {
  linter = require('stremio-addon-linter');
} catch {
  linter = null;
}

const runtime = new Runtime({ RATINGS_MOCK: '1' });

async function manifestFor(token) {
  const path = token ? `/c/${token}/manifest.json` : '/manifest.json';
  const res = await runtime.handle({ method: 'GET', path, url: path, query: {}, headers: {} });
  return JSON.parse(res.body);
}

test('el manifiesto pasa el linter oficial de Stremio', { skip: linter ? false : 'instala stremio-addon-linter para esta prueba' }, async () => {
  const manifest = await manifestFor();
  const result = linter.lintManifest(manifest);
  assert.equal(result.valid, true, `errores: ${(result.errors || []).join(' | ')}`);
  assert.deepEqual((result.warnings || []).map((w) => w.message || w), [], 'sin avisos');
  assert.ok(JSON.stringify(manifest).length <= 8192, 'por debajo del límite de 8 KB del addonCollection');
});

test('el manifiesto configurado (/c/<token>) también pasa el linter', { skip: linter ? false : 'instala stremio-addon-linter' }, async () => {
  const token = base64UrlEncode({ sources: ['imdb', 'filmaffinity'], badge: 'imdb', panel: true });
  const manifest = await manifestFor(token);
  const result = linter.lintManifest(manifest);
  assert.equal(result.valid, true, (result.errors || []).join(' | '));
  assert.ok(manifest.catalogs.length < 18, 'menos fuentes -> menos catálogos');
});

test('formas de respuesta que espera Stremio (metas / meta)', async () => {
  const catalog = JSON.parse((await runtime.handle({ method: 'GET', path: '/catalog/movie/imdb-top.json', url: '/x', query: {}, headers: {} })).body);
  assert.ok(Array.isArray(catalog.metas));
  for (const meta of catalog.metas) {
    assert.ok(typeof meta.id === 'string' && meta.id.length > 2);
    assert.ok(['movie', 'series', 'anime'].includes(meta.type));
    assert.ok(typeof meta.name === 'string' && meta.name.length > 1);
    if (meta.imdbRating !== undefined) {
      assert.ok(typeof meta.imdbRating === 'string', 'imdbRating va como string ("8.4")');
      const value = Number(meta.imdbRating);
      assert.ok(value >= 0 && value <= 10, `fuera de escala: ${meta.imdbRating}`);
    }
  }

  const meta = JSON.parse((await runtime.handle({ method: 'GET', path: '/meta/series/tt0903747.json', url: '/x', query: {}, headers: {} })).body);
  assert.equal(typeof meta.meta, 'object');
  assert.equal(meta.meta.id, 'tt0903747', 'Stremio necesita el id exacto que pidió');
  assert.equal(meta.meta.type, 'series');
  assert.ok(meta.meta.description.length > 40);

  const notFound = JSON.parse((await runtime.handle({ method: 'GET', path: '/meta/movie/tt0000000.json', url: '/x', query: {}, headers: {} })).body);
  assert.equal(notFound.meta, null, 'meta:null en lugar de error duro');
});
