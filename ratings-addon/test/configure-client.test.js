'use strict';

/**
 * test/configure-client.test.js — el JavaScript de la página de configuración,
 * ejecutado de verdad (vm + DOM de juguete) contra el runtime del addon.
 * Cubre lo que el navegador haría: construir la URL del manifiesto, llamar a
 * /api/ratings, pintar la tabla de notas y avisar si Stremio no responde.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { Runtime } = require('../src/app');
const { SOURCES } = require('../src/defs');

const runtime = new Runtime({ RATINGS_MOCK: '1' });

function inlineScript(html) {
  const matches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  return matches.map((match) => match[1]).join('\n;\n');
}

function makeElement(id) {
  return {
    id,
    value: id === '#minScore' ? '0' : id === '#ttl' ? '24' : id === '#lang' ? 'es-ES' : id === '#badge' ? 'combined' : id === '#stype' ? 'movie' : '',
    checked: true,
    textContent: '',
    innerHTML: '',
    href: '',
    dataset: {},
    style: {},
    onclick: null,
    onchange: null,
    addEventListener() {},
  };
}

async function bootClient({ sources = Object.keys(SOURCES) } = {}) {
  const html = (await runtime.handle({ method: 'GET', path: '/configure.html', url: '/configure.html', query: {}, headers: {} })).body;
  const script = inlineScript(html);
  const elements = new Map();
  const posted = [];
  const opened = [];
  const fetchCalls = [];
  const serviceMessages = [];

  const element = (selector) => {
    const id = selector.startsWith('#') ? selector : null;
    if (!id) return makeElement(selector);
    if (!elements.has(id)) elements.set(id, makeElement(id));
    return elements.get(id);
  };

  const context = {
    console,
    setTimeout,
    Promise,
    JSON,
    Math,
    Number,
    String,
    Array,
    Object,
    RegExp,
    Error,
    encodeURIComponent,
    decodeURIComponent,
    btoa: (input) => Buffer.from(input, 'binary').toString('base64'),
    atob: (input) => Buffer.from(input, 'base64').toString('binary'),
    document: {
      querySelector: (selector) => element(selector),
      querySelectorAll: (selector) => {
        if (selector === 'input[data-src]:checked') return sources.map((id) => ({ dataset: { src: id }, checked: true }));
        return [];
      },
      addEventListener: (event, callback) => {
        if (event === 'DOMContentLoaded') context.__ready = callback;
      },
    },
    location: { origin: 'http://localhost:7000', protocol: 'http:', href: '' },
    navigator: {},
    window: {
      __BASE__: '',
      __CATALOGS__: [],
      __METRICS__: {},
      postMessage: (message, target) => {
        posted.push(message);
        serviceMessages.push(target);
      },
      open: (url) => opened.push(url),
    },
    fetch: async (url) => {
      fetchCalls.push(url);
      const clean = String(url).replace('http://localhost:7000', '');
      const [path, search = ''] = clean.split('?');
      const result = await runtime.handle({
        method: 'GET',
        path,
        url: clean,
        query: Object.fromEntries(new URLSearchParams(search).entries()),
        headers: { host: 'localhost:7000' },
      });
      return {
        ok: result.status < 400,
        status: result.status,
        json: async () => JSON.parse(result.body),
        text: async () => result.body,
      };
    },
  };
  context.window.document = context.document;
  context.window.location = context.location;
  context.globalThis = context;

  vm.createContext(context);
  vm.runInContext(script, context, { filename: 'configure-client.js' });
  if (context.__ready) context.__ready();
  // dejar terminar los microtasks de los fetch encadenados
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve));

  return { context, elements, posted, opened, fetchCalls, serviceMessages };
}

test('el cliente construye la URL del manifiesto con la config elegida', async () => {
  const { context, elements } = await bootClient({ sources: ['imdb', 'filmaffinity'] });
  const url = context.manifestUrl();
  assert.match(url, /^http:\/\/localhost:7000\/c\/[A-Za-z0-9_\-]+\/manifest\.json$/);
  const token = url.match(/\/c\/([^/]+)\/manifest/)[1];
  const decoded = JSON.parse(Buffer.from(token.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  assert.deepEqual(decoded.sources.sort(), ['filmaffinity', 'imdb']);
  assert.equal(decoded.badge, 'combined');
  assert.equal(elements.get('#murl').textContent, url, 'la URL se muestra en la página');
});

test('buscar un título llama a /api/ratings y pinta las 5 fuentes', async () => {
  const { context, elements, fetchCalls } = await bootClient();
  elements.get('#q').value = 'Inception';
  context.searchRatings();
  for (let i = 0; i < 12; i++) await new Promise((resolve) => setImmediate(resolve));

  assert.ok(fetchCalls.some((url) => url.includes('/api/ratings?title=Inception')), fetchCalls.join(' | '));
  const out = elements.get('#out').innerHTML;
  for (const label of ['IMDb', 'FilmAffinity', 'Tomatometer', 'Metascore', 'TMDB']) {
    assert.match(out, new RegExp(label), `falta ${label} en la tabla`);
  }
  assert.match(out, /class="combined"/);
  assert.match(out, />8\.4</, 'la nota combinada en grande');
  assert.match(out, /Así lo ve Stremio/, 'previsualización del texto de la ficha');
  assert.match(out, /inception|Inception/, 'el nombre resuelto');
});

test('las fuentes marcadas en el formulario viajan en la query cfg', async () => {
  const { context, elements, fetchCalls } = await bootClient({ sources: ['imdb'] });
  elements.get('#q').value = 'Shawshank';
  context.searchRatings();
  for (let i = 0; i < 12; i++) await new Promise((resolve) => setImmediate(resolve));
  const url = fetchCalls.find((entry) => entry.includes('/api/ratings'));
  assert.match(url, /cfg=[A-Za-z0-9_\-]+/);
  const token = url.match(/cfg=([^&]+)/)[1];
  const decoded = JSON.parse(Buffer.from(token.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  assert.deepEqual(decoded.sources, ['imdb']);
  const out = elements.get('#out').innerHTML;
  assert.match(out, /IMDb/);
  assert.ok(!/FilmAffinity \d/.test(out), 'una fuente apagada no sale con nota');
});

test('Instalar en Stremio postea add-addon al servicio local con el manifiesto', async () => {
  const { context, posted, serviceMessages } = await bootClient();
  context.installToStremio();
  for (let i = 0; i < 12; i++) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(posted.length, 1, 'un solo postMessage');
  assert.equal(posted[0].type, 'add-addon');
  assert.match(posted[0].transportUrl, /\/manifest\.json$/);
  assert.equal(posted[0].manifest.resources.length, 2, 'lleva el manifiesto parseado');
  assert.deepEqual(serviceMessages, ['http://127.0.0.1:11470/service'], 'en http usa el servicio de escritorio');
});

test('estado de salud y catálogos: la página consulta /api/health y /api/chart', async () => {
  const { elements, fetchCalls, context } = await bootClient();
  assert.ok(fetchCalls.some((url) => url.includes('/api/health')));
  assert.match(elements.get('#health').innerHTML, /MODO DEMO/);
  assert.match(elements.get('#health').innerHTML, /TMDB/);
  context.loadCatalog('movie', 'imdb-top');
  for (let i = 0; i < 12; i++) await new Promise((resolve) => setImmediate(resolve));
  const out = elements.get('#cat-out').innerHTML;
  assert.match(out, /Shawshank/, 'la lista se pinta con sus nombres');
  assert.match(out, /badge/, 'cada tarjeta con su ⭐');
});

test('si una fuente está caída, el cliente lo muestra en vez de callarse', async () => {
  const { context, elements } = await bootClient();
  const rendered = context.renderScores({
    scores: { imdb: { value: 8.8, scale: 10, votes: 2580123 } },
    combined: { value: 8.8, verdict: 'imprescindible' },
    sources: [
      { source: 'imdb', ok: true, ms: 12 },
      { source: 'metacritic', ok: false, error: 'blocked' },
    ],
  });
  assert.match(rendered, /metacritic ✕ blocked/);
  assert.match(rendered, /2,6 M votos/);
  void elements;
});
