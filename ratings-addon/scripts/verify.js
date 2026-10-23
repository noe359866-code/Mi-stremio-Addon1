'use strict';

/**
 * scripts/verify.js — lista de comprobación post-despliegue.
 *
 *   node scripts/verify.js https://mi-addon.netlify.app
 *   npm run verify -- https://mi-addon.netlify.app
 *
 * Comprueba que la función responde por el proxy, que el manifiesto vale para
 * Stremio, que los catálogos/ficha traen notas y que la config por URL se aplica.
 * Sale con código != 0 si algo falla (vale como check en CI).
 */

const BASE = (process.argv[2] || 'http://localhost:7000').replace(/\/+$/, '');
const ONLY_GET = { method: 'GET', headers: { 'User-Agent': 'ratings-verify/1.0' } };

const checks = [
  { name: 'manifiesto', url: '/manifest.json', json: true, test: (m) => assert(m.id && Array.isArray(m.resources) && Array.isArray(m.catalogs) && m.catalogs.length >= 10, 'id/resources/catalogs'), info: (m) => `${m.catalogs.length} catálogos · ${m.name}` },
  { name: 'página de config', url: '/configure.html', test: (body) => assert(body.includes('Instalar addon'), 'botón de instalar'), info: (b) => `${b.length} bytes` },
  { name: 'logo', url: '/logo.svg', test: (body) => assert(body.trim().startsWith('<svg'), 'SVG'), info: () => 'svg' },
  { name: 'salud', url: '/api/health', json: true, test: (h) => assert(h.ok === true, 'ok:true'), info: (h) => `v${h.version} · mock=${h.mock ? 'sí' : 'no'} · fuentes ${(h.sources || []).length}` },
  { name: 'catálogo IMDb', url: '/catalog/movie/imdb-top.json', json: true, test: (c) => assert(c.metas && c.metas.length > 0, 'metas no vacío'), info: (c) => `${c.metas.length} ítems · 1º ${c.metas[0].name} ⭐${c.metas[0].imdbRating}` },
  { name: 'catálogo con extras (ruta)', url: '/catalog/movie/imdb-top/search%3Dinception.json', json: true, test: (c) => assert(c.metas && c.metas.length >= 1 && /inception/i.test(c.metas[0].name), 'el buscador de Discover filtra'), info: (c) => c.metas.map((m) => m.name).join(', ') },
  { name: 'catálogo FilmAffinity', url: '/catalog/movie/fa-top.json', json: true, test: (c) => assert(c.metas && c.metas.length > 0, 'metas no vacío'), info: (c) => `${c.metas.length} ítems` },
  { name: 'ficha de película', url: '/meta/movie/tt1375606.json', json: true, test: (m) => assert(m.meta && m.meta.description, 'meta.description'), info: (m) => `${m.meta.name} · ${m.meta.links ? m.meta.links.length : 0} enlaces` },
  { name: 'ficha de serie', url: '/meta/series/tt0903747.json', json: true, test: (m) => assert(m.meta, 'meta presente o null'), info: (m) => (m.meta ? m.meta.name : 'null (sin datos, no es error)') },
  { name: 'catálogo anime (AniList)', url: '/catalog/anime/anilist-top.json', json: true, test: (c) => assert(c.metas && c.metas.length > 0, 'metas no vacío'), info: (c) => `${c.metas.length} ítems · 1º ${c.metas[0].name} ⭐${c.metas[0].imdbRating}` },
  { name: 'catálogo anime (MAL)', url: '/catalog/anime/mal-top.json', json: true, test: (c) => assert(c.metas && c.metas.length > 0, 'metas no vacío'), info: (c) => `${c.metas.length} ítems` },
  { name: 'API de puntuaciones', url: '/api/ratings?title=Inception', json: true, test: (r) => assert(r.ok === true && r.scores && Object.keys(r.scores).length > 0, 'ok + scores'), info: (r) => `${Object.keys(r.scores).length} métricas · combinada ${r.combined && r.combined.value}` },
  { name: '404 útil', url: '/no-existe.json', expect: 404, test: (body, res) => assert(res.status === 404, 'status 404'), info: () => '404 con pistas' },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function fetchText(url) {
  const started = Date.now();
  const res = await fetch(url, ONLY_GET);
  const body = await res.text();
  return { res, body, ms: Date.now() - started };
}

// La config por URL (base64url de {sources:[...]}) se prueba con el formato nuestra página usa.
function base64UrlEncode(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function run() {
  console.log(`\nVerificando ${BASE}\n${'-'.repeat(72)}`);
  const token = base64UrlEncode({ sources: ['imdb', 'tmdb'], badge: 'imdb' });
  const all = [...checks, { name: 'notas de anime (AniList+MAL)', url: '/api/ratings?title=Jujutsu%20Kaisen&type=anime', json: true, test: (r) => assert(r.ok === true && r.scores.anilist && r.scores.mal, 'anilist y mal con nota'), info: (r) => `AniList ${r.scores.anilist.value}/100 · MAL ${r.scores.mal.value}/10` }, { name: 'config por ruta /c/<token>', url: `/c/${token}/manifest.json`, json: true, test: (m) => assert(m.catalogs.every((c) => /imdb|tmdb/.test(c.id)), 'catálogos filtrados por la config'), info: (m) => `${m.catalogs.length} catálogos (config de 2 fuentes)` }];

  let failed = 0;
  for (const check of all) {
    const url = BASE + check.url;
    try {
      const { res, body, ms } = await fetchText(url);
      if (check.expect && res.status !== check.expect) throw new Error(`HTTP ${res.status} (se esperaba ${check.expect})`);
      if (!res.ok && !check.expect) throw new Error(`HTTP ${res.status}`);
      let payload = body;
      if (check.json) {
        try {
          payload = JSON.parse(body);
        } catch {
          throw new Error('respuesta no-JSON (¿el proxy no apunta a la función?)');
        }
      }
      check.test(payload, res);
      console.log(`  ✔ ${check.name.padEnd(30)} ${String(ms).padStart(5)} ms  ${check.info ? check.info(payload) : ''}`);
    } catch (error) {
      failed += 1;
      console.log(`  ✖ ${check.name.padEnd(30)} ${error.message}`);
      console.log(`      ${url}`);
    }
  }

  console.log('-'.repeat(72));
  if (failed) {
    console.log(`${failed} comprobación(es) fallidas.\n`);
    process.exitCode = 1;
  } else {
    console.log('Todo OK — el addon está listo para instalarse en Stremio con:');
    console.log(`    ${BASE}/manifest.json\n`);
  }
}

run().catch((error) => {
  console.error(`No se pudo hablar con ${BASE}: ${error.message}`);
  console.error('Comprueba el site URL, el base directory (ratings-addon) y los logs de despliegue.');
  process.exitCode = 1;
});
