'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseImdbPage, parseImdbList, parseOmdb } = require('../src/parsers/imdb');
const { parseRtPage, parseRtSearchJson } = require('../src/parsers/rottentomatoes');
const { parseMetacriticPage, parseMetacriticApi, parseMetacriticList } = require('../src/parsers/metacritic');
const { parseFilmaffinityPage, parseFilmaffinityList } = require('../src/parsers/filmaffinity');

/* ----------------------------------------------------------------- IMDb */

test('IMDb: lee la nota del estado JSON embebido (markup actual, React)', () => {
  const html = `<!doctype html><html><head>
  <title>Inception (2010) - IMDb</title>
  <link rel="canonical" href="https://www.imdb.com/title/tt1375606/" />
  <meta property="og:title" content="Inception (2010) - IMDb" />
  <meta property="og:image" content="https://m.media-amazon.com/images/M/movies1_V1_SY1000_.jpg" />
  <script type="application/json">{"serverRoot":{"hasServerData":true,"state":{"pageData":{"titleMain":{"ratings":{"titleRating":{"ratingValue":8.8,"voteCount":2474891},"topRated":{"rank":13,"link":"/chart/top/"}},"metascore":{"link":"/news/ARTKL9J5735","text":"74"}}}}}}</script>
  </head><body>
  <span class="ipc-rating-star ipc-rating-star--base ipc-rating-star--imdb"><span class="ipc-rating-star--rating"><b>8.8</b></span><span class="ipc-rating-star--vote-count">(2.4M)</span></span>
  </body></html>`;
  const parsed = parseImdbPage(html);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.imdbId, 'tt1375606');
  assert.equal(parsed.metrics.imdb.value, 8.8);
  assert.equal(parsed.metrics.imdb.votes, 2474891);
  assert.equal(parsed.metrics.imdb.rank, 13);
  assert.equal(parsed.metrics.mc_metascore.value, 74, 'IMDb también publica el Metascore: lo aprovechamos');
  assert.equal(parsed.title, 'Inception (2010)');
});

test('IMDb: fallback al markup visible cuando no hay JSON (subpágina /rating/)', () => {
  const html = `<html><head><title>Breaking Bad (TV Series 2008–2013) - IMDb</title></head><body>
  <div class="ipl-rating-star ipl-rating-star--small"><span class="ipl-rating-star__rating">9.5</span></div>
  <div>9.5 / 10</div>
  <span class="number-of-votes sr-only">1,842,311 votes</span>
  </body></html>`;
  const parsed = parseImdbPage(html);
  assert.equal(parsed.metrics.imdb.value, 9.5);
  assert.equal(parsed.metrics.imdb.votes, 1842311);
});

test('IMDb: ignora basura que no es una nota plausible', () => {
  const parsed = parseImdbPage('<html><body><p>2010 - IMDb</p></body></html>');
  assert.equal(parsed.ok, false);
  assert.equal(parsed.metrics.imdb, undefined);
});

test('IMDb: listas (Top 250) -> id, título, año y nota por posición', () => {
  const html = `<ul class="ipc-list">
  <li class="ipc-list__item" data-title-id="tt0068646"><div class="ipc-title__metadata">
    <a href="/title/tt0068646/" class="ipc-title-link-wrapper"><img src="https://m.media-amazon.com/images/M/tt0068646_V1_UL266.jpg" alt="x" /><h3 class="ipc-title__text">1. The Shawshank Redemption <span>(1994)</span></h3></a>
    <span class="ipc-rating-star ipc-rating-star--imdb"><span class="ipc-rating-star--rating"><b>9.3</b></span><span class="ipc-rating-star--vote-count">(2.9M)</span></span>
  </div></li>
  <li class="ipc-list__item" data-title-id="tt0068646"><h3 class="ipc-title__text">repetido</h3></li>
  <li class="ipc-list__item" data-title-id="tt1375606"><a href="/title/tt1375606/"><h3 class="ipc-title__text">2. Inception (2010)</h3>
    <span class="ipc-rating-star--rating"><b>8.8</b></span></a></li>
  </ul>`;
  const items = parseImdbList(html);
  assert.equal(items.length, 2, 'deduplica el mismo tt');
  assert.equal(items[0].imdbId, 'tt0068646');
  assert.equal(items[0].title, 'The Shawshank Redemption');
  assert.equal(items[0].year, 1994);
  assert.equal(items[0].score, 9.3);
  assert.equal(items[1].title, 'Inception');
  assert.ok(items[0].poster.includes('_V1_SY1000'), 'póster reescrito a tamaño grande');
});

test('OMDb (respaldo opcional) trae IMDb + RT + Metacritic de una', () => {
  const parsed = parseOmdb({
    Response: 'True',
    Title: 'Parasite',
    Year: '2019 (2020)',
    imdbID: 'tt6751668',
    Type: 'movie',
    imdbRating: '8.5',
    imdbVotes: '856,123',
    Ratings: [
      { Source: 'Internet Movie Database', Value: '8.5/10' },
      { Source: 'Rotten Tomatoes', Value: '99%' },
      { Source: 'Metacritic', Value: '96/100' },
    ],
  });
  assert.equal(parsed.found, true);
  assert.equal(parsed.metrics.imdb.value, 8.5);
  assert.equal(parsed.metrics.imdb.votes, 856123);
  assert.equal(parsed.metrics.rt_tomatometer.value, 99);
  assert.equal(parsed.metrics.mc_metascore.value, 96);
  assert.equal(parseOmdb({ Response: 'False', Error: 'not found' }).found, false);
});

/* ------------------------------------------------------ Rotten Tomatoes */

test('RT: Tomatometer, público, nº de críticas y consenso desde su init-data', () => {
  const html = `<html><head>
  <meta property="og:title" content="Spider-Man: No Way Home (2021) - Rotten Tomatoes" />
  <meta property="og:url" content="https://www.rottentomatoes.com/m/spider_man_no_way_home" />
  <meta property="og:image" content="https://resizing.flixster.com/spider/poster.jpg" />
  </head><body>
  <script type="application/prs.init-data+json">{"contentInfo":{"contentId":"100539849","title":"Spider-Man: No Way Home","year":2021,"type":"movie","criticsScore":93,"criticsCount":417,"audienceScore":98,"audienceScoreCount":5500,"criticsConsensus":{"consensus":"A blockbuster that delivers on nostalgia while standing up on its own."}}}</script>
  </body></html>`;
  const parsed = parseRtPage(html);
  assert.equal(parsed.metrics.rt_tomatometer.value, 93);
  assert.equal(parsed.metrics.rt_tomatometer.votes, 417);
  assert.equal(parsed.metrics.rt_audience.value, 98);
  assert.equal(parsed.metrics.rt_audience.votes, 5500);
  assert.match(parsed.metrics.rt_tomatometer.text, /nostalgia/);
  assert.equal(parsed.rtSlug, 'spider_man_no_way_home');
  assert.equal(parsed.type, 'movie');
  assert.equal(parsed.year, 2021);
});

test('RT: markup legacy (tMeterScore) sigue parseándose tras los rediseños', () => {
  const html = `<html><head><meta property="og:title" content="Everything Everywhere All at Once (2022) - Rotten Tomatoes" /></head>
  <body><div class="score-content"><span class="tMeterScore">94%</span></div>
  <div class="audience-info super-focus-box-noesc"><span class="tMeterScore">78%</span></div></body></html>`;
  const parsed = parseRtPage(html);
  assert.equal(parsed.metrics.rt_tomatometer.value, 94);
});

test('RT: parser tolerante a las distintas versiones del endpoint de búsqueda', () => {
  const v1 = { movies: [{ url: '/m/the_batman', title: 'The Batman', year: 2022, criticScore: 85 }] };
  const v2 = { results: [{ contentUrl: '/m/the_batman', name: 'The Batman', premiereDate: '2022-03-04', criticsScore: 85 }] };
  for (const payload of [v1, v2]) {
    const [best] = parseRtSearchJson(payload, { title: 'The Batman', year: 2022 });
    assert.equal(best.rtSlug, 'the_batman', JSON.stringify(payload));
    assert.equal(best.score, 85);
    assert.equal(best.type, 'movie');
  }
  assert.deepEqual(parseRtSearchJson({ unexpected: true }, { title: 'x' }), []);
});

/* ----------------------------------------------------------- Metacritic */

test('Metacritic: formato del API interno (backend.metacritic.com)', () => {
  const json = { code: 200, data: { metrics: { metascore: { value: 94, url: 'https://www.metacritic.com/movie/dune-part-two/', count: 62, positiveCount: 58 }, userscore: { value: 8.8, voteCount: 2401 } } } };
  const parsed = parseMetacriticApi(json);
  assert.equal(parsed.metrics.mc_metascore.value, 94);
  assert.equal(parsed.metrics.mc_metascore.votes, 62);
  assert.equal(parsed.metrics.mc_user.value, 8.8);
  assert.equal(parsed.metrics.mc_user.votes, 2401);
});

test('Metacritic: fallback al HTML de la ficha (data-metric y JSON)', () => {
  const html = `<html><head>
  <meta property="og:title" content="Severance (2022) – Metacritic" />
  <link rel="canonical" href="https://www.metacritic.com/tv/severance/" />
  </head><body>
  <div data-metric="metascore">88</div>
  <span class="component-user-score">User score <b>8.1</b>/10</span>
  </body></html>`;
  const parsed = parseMetacriticPage(html);
  assert.equal(parsed.metrics.mc_metascore.value, 88);
  assert.equal(parsed.metrics.mc_user.value, 8.1);
  assert.equal(parsed.mcSlug, 'severance');
  assert.equal(parsed.type, 'series');
  assert.equal(parsed.year, 2022);
});

test('Metacritic: listas de /browse con slugs y metascore', () => {
  const html = `<ul>
   <li><a href="/movie/dune-part-two/"><span class="c-media-object__title">Dune: Part Two</span><span data-metric="metascore">92</span><span>2024</span></a></li>
   <li><a href="/tv/the-last-of-us/"><span class="c-media-object__title">The Last of Us</span><span data-metric="metascore">84</span></a></li>
   <li><a href="/movie/aliases/"><span>descarta</span></a></li>
  </ul>`;
  const items = parseMetacriticList(html);
  assert.equal(items.length, 2);
  assert.equal(items[0].mcSlug, 'dune-part-two');
  assert.equal(items[0].score, 92);
  assert.equal(items[1].type, 'series');
});

/* -------------------------------------------------------- FilmAffinity */

test('FilmAffinity: coma decimal, miles con punto, top 200 y cruce a IMDb', () => {
  const html = `<html><head>
  <meta property="og:title" content="La sociedad de la nieve (2023) | FilmAffinity" />
  <meta property="og:image" content="https://www.filmaffinity.com/es/images/mt11436436.jpg" />
  </head><body>
  <h1 id="doctitle">La sociedad de la nieve <span class="year">(2023)</span></h1>
  <div id="movie-rat">
    <span class="rating_b"><b>7,7</b></span>
    <span class="ratingv"> <small>( 98.123 votos )</small></span>
    <div class="comp-top200"><span>Top 200 #145</span></div>
  </div>
  <a href="https://www.imdb.com/title/tt13341526/?ref_=fa_in_more">IMDb</a>
  </body></html>`;
  const parsed = parseFilmaffinityPage(html, { url: 'https://www.filmaffinity.com/es/film11436436.html' });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.metrics.filmaffinity.value, 7.7);
  assert.equal(parsed.metrics.filmaffinity.votes, 98123);
  assert.equal(parsed.metrics.filmaffinity.rank, 145);
  assert.equal(parsed.imdbId, 'tt13341526', 'la ficha enlaza a IMDb: lo usamos para cross-resolver');
  assert.equal(parsed.faId, '11436436');
});

test('FilmAffinity: resultados de búsqueda (markup clásico de search.php)', () => {
  const html = `<div class="search-results">
  <dl class="wraper"><dt><a href="https://www.filmaffinity.com/es/film596263.html"><img src="https://www.filmaffinity.com/es/images/mt596263.jpg" /></a></dt>
  <dd><a href="https://www.filmaffinity.com/es/film596263.html" class="gt hid esc search-res">Origen <small>(2010)</small></a>
  <br /><span class="sr-pm">Rating: <b class="b">8,1</b> <span class="ratingv"><small>( 512.340 votos )</small></span></span></dd></dl>
  <dl class="wraper"><dt><a href="https://www.filmaffinity.com/es/film395131.html"><img src="x.jpg" /></a></dt>
  <dd><a href="https://www.filmaffinity.com/es/film395131.html" class="gt hid esc search-res">El laberinto del fauno <small>(2006)</small></a>
  <br /><span class="sr-pm">Rating: <b class="b">7,1</b> <span class="ratingv"><small>( 143.220 votos )</small></span></span></dd></dl>
  </div>`;
  const items = parseFilmaffinityList(html);
  assert.equal(items.length, 2);
  assert.equal(items[0].faId, '596263');
  assert.equal(items[0].title, 'Origen');
  assert.equal(items[0].year, 2010);
  assert.equal(items[0].score, 8.1);
  assert.equal(items[0].votes, 512340);
  assert.equal(items[1].score, 7.1);
});
