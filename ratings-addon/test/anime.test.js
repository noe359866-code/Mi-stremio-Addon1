'use strict';

/**
 * test/anime.test.js — AniList y MyAnimeList: parsers, cruce de ids, catálogos,
 * panel de la ficha y el salto automático en pelis/series de acción real.
 * Todo contra el transporte simulado (RATINGS_MOCK), que sirve el markup/JSON real
 * de cada sitio por las mismas funciones de red que se usan en producción.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAnilistMedia, parseAnilistList, listQuery, fallbackListQuery, MEDIA_QUERY, anilistTitles } = require('../src/parsers/anilist');
const { parseMalAnime, parseMalList, parseMalHtml } = require('../src/parsers/mal');
const { normalizeMetrics, METRICS, combine } = require('../src/defs');
const { metricValueText } = require('../src/format');
const { scoreToTen } = require('../src/catalog');
const { parseId, idsFromUrl } = require('../src/resolve');
const { Runtime } = require('../src/app');
const { appliesTo, ALL } = require('../src/providers');

const runtime = new Runtime({ RATINGS_MOCK: '1' });

async function jsonOf(path, query = {}) {
  const res = await runtime.handle({ method: 'GET', path, url: path, query, headers: { host: 'localhost:7000' } });
  return { status: res.statusCode, data: JSON.parse(res.body) };
}

const ANILIST_MEDIA = {
  id: 21495,
  idMal: 28851,
  type: 'ANIME',
  format: 'MOVIE',
  status: 'FINISHED',
  season: 'WINTER',
  seasonYear: 2016,
  episodes: 1,
  title: { romaji: 'Kimi no Na wa.', english: 'Your Name.', native: '君の名は。', userPreferred: 'Kimi no Na wa.' },
  coverImage: { large: 'https://s4.anilist.co/media/anime/cover/large/bx21495.jpg' },
  bannerImage: 'https://s4.anilist.co/media/anime/banner/21495.jpg',
  averageScore: 89,
  meanScore: 88,
  popularity: 128940,
  favourites: 45123,
  genres: ['Romance', 'Fantasía'],
  description: 'Dos adolescentes intercambian cuerpos mientras un cometa se acerca.',
  studios: { nodes: [{ name: 'CoMix Wave Films' }] },
  nextAiringEpisode: null,
  stats: { scoreRooms: 91234 },
  synonyms: ['Your Name.'],
};

// ------------------------------------------------------------------- parsers

test('parser de AniList: nota, votos, cruce con MAL y tipo por `format`', () => {
  const parsed = parseAnilistMedia(ANILIST_MEDIA);
  assert.equal(parsed.metrics.anilist.value, 89, 'AniList publica sobre 100 y se deja en su escala');
  assert.equal(parsed.metrics.anilist.votes, 91234, 'scoreRooms = nº de usuarios que puntuaron');
  assert.equal(parsed.metrics.anilist.url, 'https://anilist.co/anime/21495');
  assert.equal(parsed.resolved.anilistId, '21495');
  assert.equal(parsed.resolved.malId, '28851', 'AniList enlaza la ficha de MAL: nada de buscar a ciegas');
  assert.equal(parsed.resolved.title, 'Kimi no Na wa.', 'título original (romaji) primero');
  assert.equal(parsed.resolved.year, 2016);
  assert.equal(parsed.resolved.type, 'movie', 'format MOVIE => película');
  assert.match(parsed.resolved.poster, /s4\.anilist\.co/);
  assert.deepEqual(anilistTitles(ANILIST_MEDIA).slice(0, 2), ['Kimi no Na wa.', 'Your Name.']);
});

test('parser de AniList: sin nota no hay métrica (y se normaliza a 0-10 al entrar)', () => {
  assert.equal(parseAnilistMedia({ id: 1, title: { romaji: 'X' } }), null);
  const normalized = normalizeMetrics({ anilist: { value: 89, votes: 91234 } });
  assert.equal(normalized.anilist.value, 8.9);
  assert.equal(normalized.anilist.animeOnly, true);
  assert.equal(metricValueText('anilist', 89), '89/100', 'AniList no es un porcentaje');
  assert.equal(metricValueText('rt_tomatometer', 87), '87%', 'RT sí');
  assert.equal(metricValueText('mal', 8.62), '8.6/10');
});

test('listas de AniList -> items de catálogo con id `anilist:`', () => {
  const items = parseAnilistList({ data: { Page: { media: [ANILIST_MEDIA, { ...ANILIST_MEDIA, id: 9, averageScore: 70, format: 'TV' }] } } });
  assert.equal(items.length, 2);
  assert.equal(items[0].id, 'anilist:21495');
  assert.equal(items[0].score, 89);
  assert.equal(scoreToTen(items[0]), 8.9, 'la escala 0-100 se parte al medio para el badge');
  assert.equal(items[1].type, 'series');
});

test('las consultas GraphQL solo declaran las variables que usan (AniList lo exige)', () => {
  for (const query of [MEDIA_QUERY, listQuery(['sort', 'search', 'minScore']), listQuery(['sort']), fallbackListQuery(), fallbackListQuery({ withSearch: true })]) {
    const declared = new Set([...query.matchAll(/\$([a-zA-Z]+):/g)].map((match) => match[1]));
    const used = new Set([...query.matchAll(/\$([a-zA-Z]+)/g)].map((match) => match[1]));
    assert.deepEqual([...used].filter((name) => !declared.has(name)), [], 'variable usada sin declarar');
    assert.deepEqual([...declared].filter((name) => !used.has(name)), [], 'variable declarada sin usar (GraphQL la rechaza)');
  }
  assert.match(listQuery(['sort', 'season']), /season: \$season/);
  assert.ok(!listQuery(['sort']).includes('$status'), 'si no se filtra por status, no se declara');
});

test('parser de MAL: formatos Jikan y API oficial, y ficha HTML', () => {
  const jikan = parseMalAnime({ data: { mal_id: 41316, title: 'Jujutsu Kaisen', title_english: 'Jujutsu Kaisen', score: 8.62, scored_by: 2410234, rank: 8, popularity: 12, members: 4210345, favorites: 190234, type: 'TV', episodes: 24, year: 2020, synopsis: 'Un estudiante traga un talismán maldito.', images: { jpg: { large_image_url: 'https://cdn.myanimelist.net/l.jpg' } }, genres: [{ name: 'Acción' }] } });
  assert.equal(jikan.metrics.mal.value, 8.6);
  assert.equal(jikan.metrics.mal.votes, 2410234);
  assert.equal(jikan.metrics.mal.rank, 8);
  assert.equal(jikan.metrics.mal.url, 'https://myanimelist.net/anime/41316');
  assert.equal(jikan.resolved.malId, '41316');
  assert.equal(jikan.resolved.year, 2020);

  const official = parseMalAnime({ id: 41316, title: 'Jujutsu Kaisen', mean: 8.62, rank: 8, num_scoring_users: 2410234, media_type: 'TV', start_date: '2020-10-03T00:00:00+00:00', main_picture: { large: 'https://cdn.myanimelist.net/l.jpg' } });
  assert.equal(official.metrics.mal.value, 8.6, 'la API oficial usa `mean` y `num_scoring_users`');
  assert.equal(official.resolved.year, 2020);

  const html = parseMalHtml(
    '<html><head><meta property="og:title" content="Jujutsu Kaisen (2020)"/><meta property="og:url" content="https://myanimelist.net/anime/41316"/><meta property="og:image" content="https://cdn.myanimelist.net/x.jpg"/></head><body><span class="score-label font-bold"> 8.55</span><div>Scored by (2,410,234 users)</div><div>Ranked #8 on MyAnimeList</div></body></html>',
    { url: 'https://myanimelist.net/anime/41316' }
  );
  assert.equal(html.metrics.mal.value, 8.6, 'el HTML de la ficha también vale');
  assert.equal(html.metrics.mal.rank, 8);
  assert.equal(html.resolved.malId, '41316');

  const noScore = parseMalHtml('<html><body>sin datos</body></html>', { url: 'https://myanimelist.net/anime/1' });
  assert.deepEqual(noScore.metrics, {});
});

test('listas de MAL: envoltorio {rank, entry} y `data` plano, sin mezclar ranking global', () => {
  const top = parseMalList({ data: [{ rank: 1, entry: { mal_id: 28851, title: 'Kimi no Na wa.', title_english: 'Your Name.', score: 8.85, scored_by: 1420890, rank: 7, year: 2016, type: 'Movie' } }] });
  assert.equal(top[0].id, 'mal:28851');
  assert.equal(top[0].rank, 1, 'el puesto de ESTA lista, no el ranking global');
  assert.equal(top[0].type, 'movie');
  const flat = parseMalList({ data: [{ mal_id: 41316, title: 'Jujutsu Kaisen', score: 8.62, year: 2020 }] });
  assert.equal(flat.length, 1);
  assert.equal(flat[0].rank, null);
});

// ---------------------------------------------------------------- ids y tipos

test('ids de anime: `anilist:`, `mal:` y URLs de ficha fijan el tipo anime', () => {
  assert.deepEqual(parseId('anilist:21495'), { anilist: '21495', __anime: true });
  assert.deepEqual(parseId('mal:41316'), { mal: '41316', __anime: true });
  assert.deepEqual(idsFromUrl('https://anilist.co/anime/21495/Kimi-no-Na-Wa'), { anilist: '21495', __type: 'anime' });
  assert.deepEqual(idsFromUrl('https://myanimelist.net/anime/41316'), { mal: '41316', __type: 'anime' });
});

test('AniList y MAL solo aplican a anime (salvo que el id ya esté dado)', () => {
  assert.equal(appliesTo(ALL.anilist, { type: 'movie', ids: {} }), false);
  assert.equal(appliesTo(ALL.mal, { type: 'series', ids: {} }), false);
  assert.equal(appliesTo(ALL.anilist, { type: 'anime', ids: {} }), true);
  assert.equal(appliesTo(ALL.mal, { type: 'movie', ids: { mal: '41316' } }), true, 'un id explícito manda sobre el tipo');
  assert.equal(appliesTo(ALL.imdb, { type: 'anime', ids: {} }), true);
});

// ------------------------------------------------------------- flujo completo

test('/api/ratings de anime: las 7 fuentes, cruce de ids y nota combinada con MAL+AniList', async () => {
  const { data } = await jsonOf('/api/ratings', { title: 'Jujutsu Kaisen', type: 'anime' });
  assert.equal(data.ok, true);
  assert.equal(data.sources.length, 7);
  assert.ok(data.sources.some((source) => source.source === 'anilist' && source.ok), 'AniList OK');
  assert.ok(data.sources.some((source) => source.source === 'mal' && source.ok), 'MAL OK');
  assert.equal(data.scores.anilist.value, 84);
  assert.equal(data.scores.anilist.scale, 100);
  assert.equal(data.scores.mal.value, 8.6);
  assert.equal(data.scores.mal.rank, 8);
  assert.equal(data.query.ids.anilist, '100166', 'el id de AniList aparece en la búsqueda');
  assert.equal(data.query.ids.mal, '41316', 'y el de MAL, cruzado desde AniList');
  const used = data.combined.used.map((entry) => entry.key);
  assert.ok(used.includes('mal') && used.includes('anilist'), `ambas entran en la media: ${used.join(',')}`);
});

test('una peli no paga el pato: AniList/MAL se marcan como saltados y no ensucian la ficha', async () => {
  const { data } = await jsonOf('/api/ratings', { title: 'Parasite', type: 'movie' });
  assert.deepEqual(data.skipped.sort(), ['anilist', 'mal']);
  assert.equal(data.sources.length, 5);
  assert.ok(!/AniList|MyAnimeList/.test(data.stremio.description), 'ni en el panel ni como "sin datos"');
  const anime = await jsonOf('/meta/anime/mal:41316.json');
  assert.match(anime.data.meta.description, /🎌 MyAnimeList 8\.6\/10/);
  assert.match(anime.data.meta.description, /🌸 AniList 84\/100/);
});

test('sólo con el id de AniList (o el de MAL) la ficha se resuelve sola', async () => {
  const byAnilist = await jsonOf('/meta/anime/anilist:100166.json');
  assert.match(byAnilist.data.meta.name, /Jujutsu Kaisen/);
  assert.equal(byAnilist.data.meta.imdbRating, '8.7');
  const byMal = await jsonOf('/meta/anime/mal:28851.json');
  assert.match(byMal.data.meta.name, /Your Name|Kimi no Na/i);
  const byUrl = await jsonOf('/api/ratings', { url: 'https://anilist.co/anime/21495' });
  assert.equal(byUrl.data.ok, true, 'un link de AniList también vale');
  assert.equal(byUrl.data.scores.anilist.value, 89);
});

test('los catálogos nuevos de anime traen nota en 0-10, póster y enlace a la ficha', async () => {
  for (const id of ['mal-top', 'mal-popular', 'mal-airing', 'anilist-top', 'anilist-trending', 'anilist-season']) {
    const { status, data } = await jsonOf(`/catalog/anime/${id}.json`);
    assert.equal(status, 200, id);
    assert.ok(data.metas.length > 0, `${id} devuelve algo`);
    for (const item of data.metas) {
      const badge = Number(item.imdbRating);
      assert.ok(badge > 5 && badge <= 10, `${id}: badge razonable (${item.imdbRating})`);
      assert.match(item.id, /^(anilist|mal):\d+$/, `${id}: id enrutable`);
    }
  }
  const anilist = await jsonOf('/catalog/anime/anilist-top.json');
  assert.match(anilist.data.metas[0].poster, /anilist\.co/, 'el póster viene del CDN de AniList');
  const search = await jsonOf('/catalog/anime/anilist-top.json', { search: 'jujutsu' });
  assert.equal(search.data.metas.length, 1, 'la búsqueda de Discover filtra en AniList');
});

test('la configuración incluye fuentes anime sin publicar catálogos propios', async () => {
  const { data: manifest } = await jsonOf('/manifest.json');
  assert.deepEqual(manifest.catalogs.map((catalog) => `${catalog.type}/${catalog.id}`), ['movie/top', 'series/top']);
  assert.ok(!manifest.catalogs.some((catalog) => /mal-top|anilist/.test(catalog.id)), 'no hay filas anime propias');
  assert.ok(manifest.resources.some((resource) => resource.name === 'meta' && resource.idPrefixes.includes('tt')));

  const res = await runtime.handle({ method: 'GET', path: '/configure.html', url: '/configure.html', query: {}, headers: {} });
  assert.match(res.body, /data-src="anilist"/);
  assert.match(res.body, /data-src="mal"/);

  const sources = await jsonOf('/api/sources');
  assert.equal(sources.data.sources.length, 7);
  assert.ok(sources.data.sources.every((source) => source.docs && source.homepage));
  for (const key of ['mal', 'anilist']) assert.ok(METRICS[key] && METRICS[key].animeOnly, `métrica ${key} registrada como exclusiva de anime`);
});

test('combinada: AniList con pocos votos pesa menos (confianza por puntuaciones)', () => {
  const many = normalizeMetrics({ anilist: { value: 84, votes: 245678 }, mal: { value: 8.6, votes: 2400000 } });
  const few = normalizeMetrics({ anilist: { value: 95, votes: 4 } });
  const combinedMany = combine(many, {});
  const combinedFew = combine(few, {});
  assert.ok(combinedMany.value > 8 && combinedMany.value < 9);
  assert.equal(combinedFew.value, 9.5, 'sin otras fuentes la nota manda, con confianza baja');
  const weightFew = combinedFew.used[0].weight;
  const weightMany = combinedMany.used.find((entry) => entry.key === 'anilist').weight;
  assert.ok(weightFew < 0.1 && weightMany > 0.8, `confianza: ${weightFew} vs ${weightMany}`);
});

test('/api/chart también sirve las listas de anime', async () => {
  const { data } = await jsonOf('/api/chart', { type: 'anime', id: 'mal-top', limit: 2 });
  assert.ok(Array.isArray(data.items || data.metas || data.chart), 'respuesta con items: ' + Object.keys(data).join(','));
});
