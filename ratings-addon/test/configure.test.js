'use strict';

/**
 * test/configure.test.js — la página de configuración se genera y su JS inline
 * compila (evita la regresión de escapes dentro de la plantilla) y los controles
 * que usa el cliente existen en el HTML.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { Runtime } = require('../src/app');
const { configureHtml } = require('../src/configure');
const { load } = require('../src/config');
const { base64UrlEncode } = require('../src/util');

const runtime = new Runtime({ RATINGS_MOCK: '1' });

function inlineScripts(html) {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
}

test('el JS embebido de /configure.html compila', async () => {
  const html = (await runtime.handle({ method: 'GET', path: '/configure.html', url: '/configure.html', query: {}, headers: {} })).body;
  const scripts = inlineScripts(html);
  assert.ok(scripts.length >= 1, 'hay guion inline');
  // si un escape se tuerce en la plantilla, aquí salta SyntaxError
  for (const script of scripts) new vm.Script(script);
  assert.ok(html.indexOf('bare(') > 0, 'el helper de enlaces stremio:// presente');
});

test('todos los selectores que usa el cliente existen en el HTML', async () => {
  const html = (await runtime.handle({ method: 'GET', path: '/configure.html', url: '/configure.html', query: {}, headers: {} })).body;
  const used = new Set([...inlineScripts(html).join('\n').matchAll(/[$(]\('#([a-zA-Z0-9_-]+)'\)/g)].map((match) => match[1]));
  const missing = [...used].filter((id) => !new RegExp(`id="${id}"`).test(html));
  assert.deepEqual(missing, [], `faltan ids en el HTML: ${missing.join(', ')}`);
  for (const attr of ['data-src', 'data-title']) assert.match(html, new RegExp(attr), `el cliente espera [${attr}]`);
});

test('la página respeta la configuración y muestra los catálogos envueltos', async () => {
  const cfg = { ...load({ RATINGS_MOCK: '1' }), sources: ['imdb', 'tmdb'] };
  const wrappedCatalogs = [{ type: 'movie', id: 'top', name: 'Popular' }, { type: 'series', id: 'top', name: 'Popular' }];
  const html = configureHtml({ cfg, origin: 'http://x:7000', basePath: '/c/abc', catalogs: wrappedCatalogs });
  assert.match(html, /modo demo/);
  assert.match(html, /id="badge"/);
  const checked = [...html.matchAll(/data-src="([a-z]+)" (checked)?/g)].filter((match) => match[2]);
  assert.deepEqual(checked.map((match) => match[1]).sort(), ['imdb', 'tmdb']);
  assert.ok(!/"tmdb" checked[\s\S]*"filmaffinity" checked/.test(html), 'las fuentes apagadas no salen marcadas');
  const [, catalogsJson] = html.match(/window\.__CATALOGS__ = (\[.*?\]);/s);
  const catalogs = JSON.parse(catalogsJson);
  assert.deepEqual(catalogs, wrappedCatalogs, 'las fuentes no añaden ni quitan filas upstream');
  assert.match(html, /id="upstreams"/);
  assert.match(html, /id="nativeBadge"/);
  assert.match(html, /id="posterOverlay"/);
});

test('el logo y el fondo son SVG servibles y el favicon también', async () => {
  for (const path of ['/logo.svg', '/bg.svg', '/favicon.ico']) {
    const res = await runtime.handle({ method: 'GET', path, url: path, query: {}, headers: {} });
    assert.equal(res.status, 200, path);
    assert.match(res.headers['Content-Type'], /svg/);
    assert.match(res.body, /^<svg/);
  }
});

test('ruta desconocida bajo un prefijo de config sigue dando 404 útil', async () => {
  const token = base64UrlEncode({ sources: ['imdb'] });
  const res = await runtime.handle({ method: 'GET', path: `/c/${token}/no-existe`, url: '/no-existe', query: {}, headers: {} });
  assert.equal(res.status, 404);
  assert.match(res.body, /ruta no encontrada/);
});
