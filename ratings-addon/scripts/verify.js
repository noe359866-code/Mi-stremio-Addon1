'use strict';

/**
 * scripts/verify.js — comprobación post-despliegue del wrapper de catálogos.
 *   npm run verify -- https://mi-addon.netlify.app
 */

const BASE = (process.argv[2] || 'http://localhost:7000').replace(/\/+$/, '');
const ONLY_GET = { method: 'GET', headers: { 'User-Agent': 'ratings-verify/2.0' } };
let discoveredPoster = '';

const checks = [
  {
    name: 'manifiesto envuelto', url: '/manifest.json', json: true,
    test: (m) => {
      assert(m.id && Array.isArray(m.resources) && Array.isArray(m.catalogs) && m.catalogs.length > 0, 'id/resources/catalogs upstream');
      assert(!m.catalogs.some((c) => /^(imdb|rt|mc|fa|tmdb|mal|anilist)-/.test(c.id)), 'no publica listas top propias');
      assert(m.config.some((c) => c.key === 'nativeBadge') && m.config.some((c) => c.key === 'posterOverlay'), 'opciones nativa + póster');
    },
    info: (m) => `${m.catalogs.length} catálogos reutilizados · ${m.name}`,
  },
  { name: 'página de config', url: '/configure.html', test: (body) => assert(body.includes('Instalar addon') && body.includes('upstreams') && body.includes('posterOverlay'), 'instalar + upstreams + póster'), info: (b) => `${b.length} bytes` },
  { name: 'logo', url: '/logo.svg', test: (body) => assert(body.trim().startsWith('<svg'), 'SVG'), info: () => 'svg' },
  { name: 'salud', url: '/api/health', json: true, test: (h) => assert(h.ok === true && h.wrapper && h.wrapper.ownCatalogs === false, 'wrapper sin catálogos propios'), info: (h) => `v${h.version} · mock=${h.mock ? 'sí' : 'no'} · ${h.wrapper.upstreams.length} upstream(s)` },
  {
    name: 'catálogo Cinemeta', url: '/catalog/movie/top.json', json: true,
    test: (c) => {
      assert(c.metas && c.metas.length > 0, 'metas no vacío');
      const poster = c.metas.map((m) => m.poster).find((url) => /\/poster\/[A-Za-z0-9_-]+\.jpg/.test(url || ''));
      assert(poster, 'los pósters apuntan al generador de notas');
      discoveredPoster = poster;
    },
    info: (c) => `${c.metas.length} ítems · 1º ${c.metas[0].name} ⭐${c.metas[0].imdbRating || 'pendiente'}`,
  },
  {
    name: 'póster con puntuaciones', url: () => discoveredPoster, binary: true,
    test: (body, res) => {
      assert(discoveredPoster, 'URL de póster descubierta');
      assert(/^image\//i.test(res.headers.get('content-type') || ''), 'respuesta de imagen');
      assert(body.length > 1000, `imagen válida (${body.length} bytes)`);
    },
    info: (body, res) => `${body.length} bytes · ${res.headers.get('x-rating-poster') || 'imagen upstream'}`,
  },
  { name: 'búsqueda en catálogo', url: '/catalog/movie/top/search%3Dinception.json', json: true, test: (c) => assert(c.metas && c.metas.length >= 1 && /inception/i.test(c.metas[0].name), 'el buscador upstream sigue filtrando'), info: (c) => c.metas.map((m) => m.name).join(', ') },
  { name: 'ficha de película', url: '/meta/movie/tt1375606.json', json: true, test: (m) => assert(m.meta && m.meta.description && m.meta.poster, 'meta + descripción + póster'), info: (m) => `${m.meta.name} · ⭐${m.meta.imdbRating || 'pendiente'}` },
  { name: 'ficha de serie', url: '/meta/series/tt0903747.json', json: true, test: (m) => assert(m.meta, 'meta presente'), info: (m) => m.meta.name },
  { name: 'API de puntuaciones', url: '/api/ratings?title=Inception', json: true, test: (r) => assert(r.ok === true && r.scores && Object.keys(r.scores).length > 0, 'ok + scores'), info: (r) => `${Object.keys(r.scores).length} métricas · combinada ${r.combined && r.combined.value}` },
  { name: '404 útil', url: '/no-existe.json', expect: 404, test: (body, res) => assert(res.status === 404, 'status 404'), info: () => '404 con pistas' },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function fetchPayload(url, binary) {
  const started = Date.now();
  const res = await fetch(url, ONLY_GET);
  const body = binary ? Buffer.from(await res.arrayBuffer()) : await res.text();
  return { res, body, ms: Date.now() - started };
}

function base64UrlEncode(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function runCheck(check) {
  const rawUrl = typeof check.url === 'function' ? check.url() : check.url;
  const url = /^https?:\/\//.test(rawUrl || '') ? rawUrl : BASE + rawUrl;
  const { res, body, ms } = await fetchPayload(url, check.binary);
  if (check.expect && res.status !== check.expect) throw new Error(`HTTP ${res.status} (se esperaba ${check.expect})`);
  if (!res.ok && !check.expect) throw new Error(`HTTP ${res.status}`);
  let payload = body;
  if (check.json) {
    try { payload = JSON.parse(body); } catch { throw new Error('respuesta no-JSON (¿el proxy no apunta a la función?)'); }
  }
  check.test(payload, res);
  console.log(`  ✔ ${check.name.padEnd(30)} ${String(ms).padStart(5)} ms  ${check.info ? check.info(payload, res) : ''}`);
}

async function run() {
  console.log(`\nVerificando ${BASE}\n${'-'.repeat(72)}`);
  const token = base64UrlEncode({ sources: ['imdb', 'tmdb'], badge: 'imdb' });
  const all = [
    ...checks,
    { name: 'notas de anime (API)', url: '/api/ratings?title=Jujutsu%20Kaisen&type=anime', json: true, test: (r) => assert(r.ok === true && r.scores.anilist && r.scores.mal, 'anilist y mal con nota'), info: (r) => `AniList ${r.scores.anilist.value}/100 · MAL ${r.scores.mal.value}/10` },
    { name: 'config conserva catálogos', url: `/c/${token}/manifest.json`, json: true, test: (m) => assert(m.catalogs.length > 0 && !m.catalogs.some((c) => /^(imdb|rt|mc|fa|tmdb)-/.test(c.id)), 'mismos catálogos upstream'), info: (m) => `${m.catalogs.length} catálogos · config de 2 fuentes` },
  ];

  let failed = 0;
  for (const check of all) {
    try {
      await runCheck(check);
    } catch (error) {
      failed += 1;
      const rawUrl = typeof check.url === 'function' ? check.url() : check.url;
      console.log(`  ✖ ${check.name.padEnd(30)} ${error.message}`);
      console.log(`      ${/^https?:\/\//.test(rawUrl || '') ? rawUrl : BASE + rawUrl}`);
    }
  }

  console.log('-'.repeat(72));
  if (failed) {
    console.log(`${failed} comprobación(es) fallidas.\n`);
    process.exitCode = 1;
  } else {
    console.log('Todo OK — instala el manifiesto y después desactiva el addon original envuelto:');
    console.log(`    ${BASE}/manifest.json\n`);
  }
}

run().catch((error) => {
  console.error(`No se pudo hablar con ${BASE}: ${error.message}`);
  console.error('Comprueba la URL del sitio y los logs de despliegue de Netlify.');
  process.exitCode = 1;
});
