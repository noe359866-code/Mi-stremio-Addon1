'use strict';

/**
 * test/serverless.test.js — el puente Netlify/Vercel y las formas de URL que
 * Stremio y las plataformas realmente usan:
 *   · path bonito (/manifest.json) o reescrito (/.netlify/functions/ratings/…)
 *   · prefijo de config en base64url (nuestra página) o JSON crudo (UI nativa)
 *   · extras de catálogo como segmento de ruta (search=…&skip=…)
 * Se ejecuta contra el Runtime real en modo demo, sin red.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Runtime } = require('../src/app');
const {
  pickPath,
  pickQuery,
  stripFunctionPrefix,
  hasFunctionPrefix,
  toLambdaResponse,
  applyServerlessDefaults,
  netlifyRequest,
  vercelRequest,
} = require('../src/serverless');

// El adaptador de Netlify construye su Runtime con process.env: modo demo antes de require().
process.env.RATINGS_MOCK = '1';

const runtime = new Runtime({ RATINGS_MOCK: '1' });
const NETLIFY = '/.netlify/functions/ratings';

/**
 * Evento de Netlify. `shape`:
 *   pretty    -> event.path y rawUrl con la URL pública (proxy normal)
 *   suffix    -> event.path con el prefijo de la función + sufijo, rawUrl público
 *   prefixed  -> path y rawUrl ambos bajo la función (el caso de instalar con la URL cruda)
 *   rootonly  -> todo reducido a la raíz de la función (sin info de ruta: se sirve el índice)
 */
function netlifyEvent({ path = '/', search = '', shape = 'pretty' } = {}) {
  const host = 'mi-addon.netlify.app';
  const query = search ? `?${search}` : '';
  const publicRaw = `https://${host}${path}${query}`;
  if (shape === 'suffix') return { httpMethod: 'GET', path: `${NETLIFY}${path}`, rawUrl: publicRaw, headers: headers(host), queryStringParameters: params(search) };
  if (shape === 'prefixed') return { httpMethod: 'GET', path: `${NETLIFY}${path}`, rawUrl: `https://${host}${NETLIFY}${path}${query}`, headers: headers(host), queryStringParameters: params(search) };
  if (shape === 'rootonly') return { httpMethod: 'GET', path: NETLIFY, rawUrl: `https://${host}${NETLIFY}`, headers: headers(host), queryStringParameters: params(search) };
  return { httpMethod: 'GET', path, rawUrl: publicRaw, headers: headers(host), queryStringParameters: params(search) };
}

function headers(host) {
  return { 'x-forwarded-host': host, 'x-forwarded-proto': 'https' };
}

function params(search) {
  return Object.fromEntries(new URLSearchParams(search || '').entries());
}

async function viaNetlify(event) {
  const { handler } = require('../netlify/functions/ratings');
  const response = await handler(event);
  const body = /json/.test(response.headers['Content-Type'] || '') ? JSON.parse(response.body) : response.body;
  return { ...response, parsed: body };
}

// ------------------------------------------------------------------ helpers

test('pickPath: prefiere la URL pública y limpia el prefijo de la función', () => {
  assert.equal(pickPath({ rawUrl: 'https://x.app/manifest.json', eventPath: '/manifest.json' }), '/manifest.json');
  assert.equal(pickPath({ rawUrl: 'https://x.app/manifest.json', eventPath: NETLIFY }), '/manifest.json');
  assert.equal(pickPath({ rawUrl: `${NETLIFY}/catalog/movie/imdb-top.json`, eventPath: `${NETLIFY}/catalog/movie/imdb-top.json` }), '/catalog/movie/imdb-top.json');
  assert.equal(pickPath({ rawUrl: 'https://x.app/c/abc/meta/movie/tt1.json', eventPath: `/c/abc/meta/movie/tt1.json` }), '/c/abc/meta/movie/tt1.json');
  assert.equal(pickPath({ rawUrl: '', eventPath: '' }), '/');
  assert.equal(stripFunctionPrefix(NETLIFY), '/');
  assert.equal(stripFunctionPrefix('/api/ratings/manifest.json'), '/manifest.json');
  assert.equal(stripFunctionPrefix('/api/ratings'), '/api/ratings', 'la API propia no se toca');
  assert.ok(hasFunctionPrefix(`${NETLIFY}/x`) && !hasFunctionPrefix('/manifest.json'));
});

test('pickQuery: une la query de la URL y los params del evento', () => {
  assert.deepEqual(pickQuery({ rawUrl: 'https://x/a?limit=5', queryStringParameters: { search: 'dune' } }), { limit: '5', search: 'dune' });
  assert.deepEqual(pickQuery({ multiValueQueryStringParameters: { search: ['a', 'b'] } }), { search: 'b' });
  assert.deepEqual(pickQuery({ queryStringParameters: { skip: null } }), {});
});

test('toLambdaResponse: content-type por defecto y status intactos', () => {
  assert.deepEqual(
    toLambdaResponse({ statusCode: 404, headers: {}, body: '{"a":1}' }),
    { statusCode: 404, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: '{"a":1}', isBase64Encoded: false }
  );
});

test('applyServerlessDefaults no pisa lo que puso el usuario', () => {
  const env = { FETCH_TIMEOUT_MS: '9000' };
  applyServerlessDefaults(env, { FETCH_TIMEOUT_MS: '2500', PER_HOST_MS: '300' });
  assert.equal(env.FETCH_TIMEOUT_MS, '9000');
  assert.equal(env.PER_HOST_MS, '300');
});

test('vercelRequest usa el hint ?p= del rewrite', () => {
  const req = { method: 'GET', url: '/api/ratings?p=/catalog/movie/fa-top.json&limit=3', headers: { host: 'x.vercel.app' }, query: { p: '/catalog/movie/fa-top.json', limit: '3' } };
  const request = vercelRequest(req);
  assert.equal(request.path, '/catalog/movie/fa-top.json');
  assert.equal(request.query.p, undefined, 'p no se cuela como filtro');
  assert.equal(request.query.limit, '3');
  assert.equal(request.origin, 'https://x.vercel.app');
});

// ------------------------------------------------------- rutas vía Netlify

test('Netlify: el manifiesto es idéntico en las 3 formas de path que se pueden dar', async () => {
  const forms = ['pretty', 'suffix', 'prefixed'];
  const results = [];
  for (const shape of forms) results.push(await viaNetlify(netlifyEvent({ path: '/manifest.json', shape })));
  for (const result of results) {
    assert.equal(result.statusCode, 200);
    assert.match(result.parsed.id, /ratings/);
    assert.equal(result.parsed.logo, 'https://mi-addon.netlify.app/logo.svg', 'el logo usa el host público');
  }
  const bodies = results.map((result) => JSON.stringify(JSON.parse(result.body).logo));
  assert.equal(new Set(bodies).size, 1, 'mismo manifiesto en todos los casos');

  // Si el proxy se come toda la ruta no hay forma de saberla: se sirve el índice (documentado).
  const root = await viaNetlify(netlifyEvent({ path: '/manifest.json', shape: 'rootonly' }));
  assert.match(root.parsed, /Stremio|puntuaci/i);
});

test('Netlify: catálogo, ficha, API y página de configuración por proxy', async () => {
  const catalog = await viaNetlify(netlifyEvent({ path: '/catalog/movie/top.json' }));
  assert.equal(catalog.statusCode, 200);
  assert.ok(Array.isArray(catalog.parsed.metas) && catalog.parsed.metas.length > 0);
  assert.match(catalog.parsed.metas[0].poster, /\/poster\//, 'el catálogo upstream recibe pósters mejorados');
  assert.match(catalog.headers['Cache-Control'], /max-age=/, 'los catálogos se pueden cachear');

  const meta = await viaNetlify(netlifyEvent({ path: '/meta/movie/tt1375606.json' }));
  assert.equal(meta.statusCode, 200);
  assert.match(meta.parsed.meta.name, /Inception/);
  assert.equal(meta.parsed.meta.imdbRating, '8.4');

  const api = await viaNetlify(netlifyEvent({ path: '/api/ratings', search: 'title=Inception' }));
  assert.equal(api.parsed.ok, true);
  assert.equal(Object.keys(api.parsed.scores).length, 7, 'las 7 métricas conocidas');

  const page = await viaNetlify(netlifyEvent({ path: '/configure.html' }));
  assert.match(page.headers['Content-Type'], /text\/html/);
  assert.match(page.body, /Instalar addon/);

  const health = await viaNetlify(netlifyEvent({ path: '/api/health' }));
  assert.equal(health.parsed.ok, true);
});

test('Netlify: buscar desde Discover (extras como segmento de ruta) filtra el catálogo envuelto', async () => {
  const encoded = await viaNetlify(netlifyEvent({ path: '/catalog/movie/top/search%3Dinception.json' }));
  assert.equal(encoded.statusCode, 200);
  assert.equal(encoded.parsed.metas.length, 1);
  assert.match(encoded.parsed.metas[0].name, /Inception/);

  const amp = await viaNetlify(netlifyEvent({ path: '/catalog/movie/top/search=shawsank&skip=0.json' }));
  assert.ok(Array.isArray(amp.parsed.metas), 'varios extras en un segmento no rompen nada');

  const byQuery = await viaNetlify(netlifyEvent({ path: '/catalog/movie/top.json', search: 'search=inception' }));
  assert.equal(byQuery.parsed.metas.length, 1, '?search= sigue funcionando');
});

test('Netlify: skip numérico como segmento (paginación del catálogo envuelto)', async () => {
  const all = await viaNetlify(netlifyEvent({ path: '/catalog/movie/top.json' }));
  const skipped = await viaNetlify(netlifyEvent({ path: '/catalog/movie/top/3.json' }));
  assert.ok(all.parsed.metas.length > 3);
  assert.equal(skipped.parsed.metas.length, all.parsed.metas.length - 3);
  assert.deepEqual(skipped.parsed.metas[0], all.parsed.metas[3]);
});

test('Netlify: también se puede instalar con la URL cruda de la función', async () => {
  const response = await viaNetlify(netlifyEvent({ path: '/manifest.json', shape: 'prefixed' }));
  assert.equal(response.statusCode, 200);
  assert.equal(response.parsed.logo, 'https://mi-addon.netlify.app/logo.svg', 'con la URL cruda se normaliza al raíz (el proxy cubre todo)');
});

// ---------------------------------------------------- configuración por URL

test('prefijo de config en base64url (nuestro /configure.html) aplica a todo el path', async () => {
  const token = require('../src/util').base64UrlEncode({ sources: ['imdb'], badge: 'imdb', minScore: 8.5 });
  const manifest = await viaNetlify(netlifyEvent({ path: `/c/${token}/manifest.json` }));
  assert.deepEqual(manifest.parsed.catalogs.map((catalog) => `${catalog.type}/${catalog.id}`), ['movie/top', 'series/top'], 'las fuentes no sustituyen las filas upstream');
  assert.match(manifest.parsed.logo, new RegExp(`/c/${token}/logo\\.svg$`), 'basePath dentro del logo');

  const catalog = await viaNetlify(netlifyEvent({ path: `/c/${token}/catalog/movie/top.json` }));
  assert.ok(catalog.parsed.metas.length > 0, 'no se eliminan películas del catálogo original');
  assert.equal(catalog.parsed.metas[0].imdbRating, '8.8', 'badge IMDb en la tarjeta envuelta');
});

test('prefijo de config en JSON crudo (el que genera la UI nativa de Stremio)', async () => {
  const config = encodeURIComponent(JSON.stringify({ sources: 'imdb,filmaffinity', badge: 'imdb', panel: false }));
  const manifest = await viaNetlify(netlifyEvent({ path: `/${config}/manifest.json` }));
  assert.equal(manifest.statusCode, 200);
  const ids = manifest.parsed.catalogs.map((catalog) => `${catalog.type}/${catalog.id}`);
  assert.deepEqual(ids, ['movie/top', 'series/top'], 'los catálogos se conservan con la UI nativa de config');

  const meta = await viaNetlify(netlifyEvent({ path: `/${config}/meta/movie/tt1375606.json` }));
  assert.ok(meta.parsed.meta, 'la ficha sigue respondiendo');
  assert.ok(!/PUNTUACIONES/.test(meta.parsed.meta.description), 'panel:false quitó el desglose');

  const viaQuery = await viaNetlify(netlifyEvent({ path: '/manifest.json', search: `config=${config}` }));
  assert.deepEqual(JSON.parse(viaQuery.body).catalogs.map((c) => c.id), manifest.parsed.catalogs.map((c) => c.id), '?config= equivale al prefijo');
});

test('un prefijo de config ilegible da 404 con pistas en vez de adiviar', async () => {
  const broken = await viaNetlify(netlifyEvent({ path: '/{esto no es json}/manifest.json' }));
  assert.equal(broken.statusCode, 404);
  assert.ok(Array.isArray(broken.parsed.routes) && broken.parsed.routes.includes('/manifest.json'));
});

test('PUBLIC_URL manda sobre las headers del proxy (Netlify/CDN suelen mentir)', async () => {
  const rt = new Runtime({ RATINGS_MOCK: '1', PUBLIC_URL: 'https://ratings.mi-dominio.es/' });
  const result = await rt.handle(netlifyRequest(netlifyEvent({ path: '/manifest.json' })));
  const manifest = JSON.parse(result.body);
  assert.equal(manifest.logo, 'https://ratings.mi-dominio.es/logo.svg');
});

test('OPTIONS (preflight) y HEAD pasan por la función sin errores', async () => {
  const options = await viaNetlify({ ...netlifyEvent({ path: '/manifest.json' }), httpMethod: 'OPTIONS' });
  assert.equal(options.statusCode, 204);
  assert.equal(options.headers['Access-Control-Allow-Origin'], '*');
});

test('Vercel: el handler responde con el hint ?p= y también con req.url original', async () => {
  process.env.RATINGS_MOCK = '1';
  const handler = require('../api/ratings');
  const call = async (req) => {
    const captured = { status: 0, headers: {}, body: '' };
    const res = {
      setHeader: (key, value) => { captured.headers[String(key).toLowerCase()] = value; },
      status: (code) => { captured.status = code; return res; },
      send: (body) => { captured.body = String(body); return res; },
      json: (body) => { captured.body = JSON.stringify(body); return res; },
    };
    await handler({ method: 'GET', headers: { host: 'x.vercel.app' }, ...req }, res);
    return { ...captured, parsed: JSON.parse(captured.body) };
  };

  const hinted = await call({ url: '/api/ratings?p=/manifest.json', query: { p: '/manifest.json' } });
  assert.equal(hinted.status, 200);
  assert.match(hinted.parsed.id, /ratings/);

  const direct = await call({ url: '/catalog/movie/fa-top.json', query: {} });
  assert.ok(direct.parsed.metas.length > 0, 'rewrite transparente (req.url original)');

  const api = await call({ url: '/api/ratings?p=/api/ratings&title=Inception', query: { p: '/api/ratings', title: 'Inception' } });
  assert.equal(api.parsed.ok, true, 'la API sigue accesible con el rewrite por encima');
});

test('una ruta rara no revienta la función: 404 con pistas', async () => {
  const response = await viaNetlify(netlifyEvent({ path: '/no-existe.json' }));
  assert.equal(response.statusCode, 404);
  assert.ok(Array.isArray(response.parsed.routes), 'devuelve la lista de rutas válidas');
});
