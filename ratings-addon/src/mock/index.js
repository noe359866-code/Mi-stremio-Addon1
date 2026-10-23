'use strict';

/**
 * mock/index.js — DEMO MODE (RATINGS_MOCK=1 o ?mock=1).
 *
 * No es un atajo de datos ya masticados: genera HTML/JSON con el markup REAL de
 * IMDb, Rotten Tomatoes, Metacritic, FilmAffinity y TMDB, y lo sirve por un
 * `http` falso. Así el modo demo ejercita los mismos parsers (regex, blobs
 * JSON, ranking) que la versión online, y los tests son deterministas sin red.
 */

const DEMO_TITLES = [
  {
    imdbId: 'tt1375606',
    tmdbId: 27205,
    type: 'movie',
    title: 'Inception',
    esTitle: 'Origen',
    year: 2010,
    posterPath: '/edv5CZWDQfzX9Wu9dE1Bql1rPAg.jpg',
    overview: 'Un ladrón que roba secretos dentro de los sueños acepta el trabajo inverso: implantar una idea.',
    genres: ['Ciencia ficción', 'Acción', 'Thriller'],
    imdb: { value: 8.8, votes: 2580123, rank: 13 },
    rt: { critics: 87, audience: 91, criticsCount: 392, audienceCount: 250000, consensus: 'Audaz, inteligente y visualmente deslumbrante, Inception convierte la ciencia ficción cerebral en un blockbuster.' },
    mc: { meta: 74, user: 8.4, critics: 42, users: 3120 },
    fa: { rating: 8.1, votes: 512340, id: '596263', top: 9 },
  },
  {
    imdbId: 'tt0903747',
    tmdbId: 1396,
    type: 'series',
    title: 'Breaking Bad',
    esTitle: 'Breaking Bad',
    year: 2008,
    posterPath: '/ggFHVNu6YYI5L9pCfOacjizRGt.jpg',
    overview: 'Un profesor de química con cáncer de pulmón se pasa a fabricar metanfetamina.',
    genres: ['Drama', 'Crimen', 'Suspense'],
    imdb: { value: 9.5, votes: 2010345, rank: 1 },
    rt: { critics: 96, audience: 98, criticsCount: 89, audienceCount: 120000, consensus: 'Pocas series han mantenido la tensión tanto tiempo: Breaking Bad es química pura.' },
    mc: { meta: 90, user: 9.0, critics: 27, users: 4210 },
    fa: { rating: 8.9, votes: 198220, id: '705487' },
  },
  {
    imdbId: 'tt6751668',
    tmdbId: 496243,
    type: 'movie',
    title: 'Parasite',
    esTitle: 'Parásitos',
    year: 2019,
    posterPath: '/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg',
    overview: 'Una familia sin ingresos se infiltra, uno a uno, en la vida de una familia rica.',
    genres: ['Thriller', 'Drama', 'Comedia'],
    imdb: { value: 8.5, votes: 890123, rank: 27 },
    rt: { critics: 99, audience: 98, criticsCount: 570, audienceCount: 15000, consensus: 'Una sátira de clases con giros imposibles: Bong Joon-ho en estado puro.' },
    mc: { meta: 96, user: 8.8, critics: 55, users: 2890 },
    fa: { rating: 8.2, votes: 231456, id: '664457', top: 21 },
  },
  {
    imdbId: 'tt2267968',
    tmdbId: 372058,
    type: 'movie',
    anime: true,
    title: 'Your Name.',
    esTitle: 'Your Name.',
    year: 2016,
    posterPath: '/q1x0X8vz3F2d3p2Q1Q0Yc8X.jpg',
    overview: 'Dos adolescentes japoneses descubren que intercambian cuerpos mientras un cometa se acerca.',
    genres: ['Anime', 'Romance', 'Fantasía'],
    imdb: { value: 8.4, votes: 289432, rank: 118 },
    rt: { critics: 97, audience: 96, criticsCount: 190, audienceCount: 12000, consensus: 'Visualmente preciosa y emocionalmente demoledora.' },
    mc: { meta: 79, user: 8.7, critics: 33, users: 1450 },
    fa: { rating: 8.3, votes: 78456, id: '660177' },
  },
  {
    imdbId: 'tt12343534',
    tmdbId: 94605,
    type: 'series',
    anime: true,
    title: 'Jujutsu Kaisen',
    esTitle: 'Jujutsu Kaisen',
    year: 2020,
    posterPath: '/fHp2R6AqF8Ah7g4MpYb0DFKcQY.jpg',
    overview: 'Un estudiante de preparatoria traga un talismán maldito y entra en una escuela de exorcistas.',
    genres: ['Anime', 'Acción', 'Fantasía'],
    imdb: { value: 8.6, votes: 132456, rank: null },
    rt: { critics: 100, audience: 95, criticsCount: 12, audienceCount: 5400, consensus: '' },
    mc: { meta: 81, user: 8.2, critics: 6, users: 780 },
    fa: { rating: 8.0, votes: 24310, id: '963385' },
  },
  {
    imdbId: 'tt0068646',
    tmdbId: 278,
    type: 'movie',
    title: 'The Shawshank Redemption',
    esTitle: 'Cadena perpetua',
    year: 1994,
    posterPath: '/q6y0Go1tsGEsmtFryDOJo3dEmqu.jpg',
    overview: 'Un banquero condenado a cadena perpetua forja amistad en la cárcel de Shawshank.',
    genres: ['Drama', 'Crimen'],
    imdb: { value: 9.3, votes: 2980123, rank: 1 },
    rt: { critics: 91, audience: 96, criticsCount: 120, audienceCount: 100000, consensus: 'La historia de esperanza carcelaria que nadie pedía y todos recuerdan.' },
    mc: { meta: 82, user: 8.9, critics: 22, users: 3400 },
    fa: { rating: 8.6, votes: 320145, id: '1281451', top: 2 },
  },
];

const byImdb = new Map(DEMO_TITLES.map((t) => [t.imdbId, t]));
const byTmdb = new Map(DEMO_TITLES.map((t) => [String(t.tmdbId), t]));

function esc(text) {
  return String(text === null || text === undefined ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function rtSlug(title) {
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function mcSlug(title) {
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-$/, '');
}

/* ------------------------------------------------------------------ fixtures */

function imdbTitleHtml(work) {
  const state = {
    pageData: {
      aboveTheTitle: { titleText: { text: work.title }, titleYearRange: { yearText: `${work.year}` } },
      titleMain: {
        ratings: {
          titleRating: { ratingValue: work.imdb.value, voteCount: work.imdb.votes },
          ...(work.imdb.rank ? { topRated: { rank: work.imdb.rank, link: '/chart/top/' } } : {}),
        },
        metascore: { link: '/news/industry/ARTKL9J5735', text: `${work.mc.meta}` },
      },
      meta: { title: `${work.title} (${work.year}) - IMDb`, image: 'https://m.media-amazon.com/images/M/fake_V1_SY1000_.jpg' },
    },
  };
  return `<!doctype html><html><head>
<title>${esc(work.title)} (${work.year}) - IMDb</title>
<link rel="canonical" href="https://www.imdb.com/title/${work.imdbId}/" />
<meta property="og:title" content="${esc(work.title)} (${work.year}) - IMDb" />
<meta property="og:image" content="https://m.media-amazon.com/images/M/fake_V1_SX640.jpg" />
<script type="application/ld+json">{"@type":"${work.type === 'series' ? 'TVSeries' : 'Movie'}","name":"${esc(work.title)}","aggregateRating":{"@type":"AggregateRating","ratingValue":"${String(work.imdb.value).replace('.', '.')}",${work.type === 'series' ? '' : `"bestRating":"10",`}"voteCount":${work.imdb.votes}}}</script>
</head><body>
<div class="_ipc-title_1f5il_1 ipc-title_1f5il_1 ipc-title--base">
  <a class="ipc-title-link-wrapper" href="/title/${work.imdbId}/">
    <h3 class="ipc-title__text">${esc(work.title)}</h3>
  </a>
  <span class="ipc-rating-star ipc-rating-star--base ipc-rating-star--imdb">
    <span class="ipc-rating-star--rating"><b>${work.imdb.value}</b></span>
    <span class="ipc-rating-star--vote-count">(${(work.imdb.votes / 1e6).toFixed(1)}M)</span>
  </span>
  ${work.imdb.rank ? `<span class="ipc-rating-badge__rank">#${work.imdb.rank} in Top 250 Movies</span>` : ''}
</div>
<script type="application/json">${JSON.stringify(state)}</script>
</body></html>`;
}

function imdbListHtml(works, { withRank = true } = {}) {
  const cards = works
    .map((work, index) => {
      const prefix = withRank ? `${index + 1}. ` : '';
      return `<li class="ipc-list__item" data-title-id="${work.imdbId}">
  <div class="ipc-title__metadata">
    <a class="ipc-title-link-wrapper" href="/title/${work.imdbId}/">
      <img class="ipc-image" src="https://m.media-amazon.com/images/M/${work.imdbId}_V1_UL266_CL80,0,185,266_.jpg" alt="${esc(work.title)}" />
      <h3 class="ipc-title__text">${prefix}${esc(work.title)} <span class="a-size-small">(${work.year})</span></h3>
    </a>
    <span class="ipc-rating-star ipc-rating-star--base ipc-rating-star--imdb">
      <span class="ipc-rating-star--rating"><b>${work.imdb.value}</b></span>
      <span class="ipc-rating-star--vote-count">(${(work.imdb.votes / 1e6).toFixed(1)}M)</span>
    </span>
  </div>
</li>`;
    })
    .join('\n');
  return `<!doctype html><html><head><title>IMDb Top Charts</title></head><body><ul class="ipc-list-container">${cards}</ul></body></html>`;
}

function rtPageHtml(work) {
  const blob = {
    contentInfo: {
      contentId: `10000${work.tmdbId}`,
      title: work.title,
      year: work.year,
      type: work.type === 'series' ? 'tv' : 'movie',
      criticsScore: work.rt.critics,
      criticsCount: work.rt.criticsCount,
      audienceScore: work.rt.audience,
      audienceScoreCount: work.rt.audienceCount,
      criticsConsensus: { consensus: work.rt.consensus || '' },
      runtime: 148,
      rating: 'PG-13',
    },
  };
  const kind = work.type === 'series' ? 'tv' : 'm';
  return `<!doctype html><html><head>
<meta property="og:title" content="${esc(work.title)} (${work.year}) - Rotten Tomatoes" />
<meta property="og:url" content="https://www.rottentomatoes.com/${kind}/${rtSlug(work.title)}" />
<meta property="og:image" content="https://resizing.flixster.com/xxx/poster.jpg" />
</head><body>
<div class="score-panel">
  <span class="score-icon"><span class="tMeterScore">${work.rt.critics}%</span></span>
  <a data-qa="critics-score" class="score">Tomatometer</a>
  <span data-qa="audience-score">${work.rt.audience}%</span>
</div>
<script type="application/prs.init-data+json">${JSON.stringify({ contentInfo: blob.contentInfo })}</script>
<script type="application/prs.init-data+json">${JSON.stringify(blob)}</script>
</body></html>`;
}

function matchesQuery(work, query) {
  const words = String(query || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2);
  if (!words.length) return true;
  const hay = `${work.title} ${work.esTitle} ${rtSlug(work.title)} ${mcSlug(work.title)}`.toLowerCase();
  return words.some((word) => hay.includes(word));
}

function rtSearchJson(worksSubset, query) {
  const list = (worksSubset || DEMO_TITLES)
    .filter((item) => matchesQuery(item, query))
    .map((item) => ({
    url: `/${item.type === 'series' ? 'tv' : 'm'}/${rtSlug(item.title)}`,
    title: item.title,
    year: item.year,
    criticScore: item.rt.critics,
  }));
  return {
    movies: list.filter((entry) => entry.url.startsWith('/m/')),
    tvShows: list.filter((entry) => entry.url.startsWith('/tv/')),
  };
}

function mcApiJson(work, component) {
  if (component === 'metascore') {
    return { code: 200, data: { metrics: { metascore: { value: work.mc.meta, url: `https://www.metacritic.com/movie/${mcSlug(work.title)}/`, displayStyle: 'metascore', count: work.mc.critics, positiveCount: 30, mixedCount: 5, negativeCount: 1 } } } };
  }
  return { code: 200, data: { metrics: { userscore: { value: work.mc.user, voteCount: work.mc.users, displayStyle: 'userscore', url: `https://www.metacritic.com/movie/${mcSlug(work.title)}/` } } } };
}

function mcBrowseJson(works) {
  return {
    code: 200,
    data: {
      items: works.map((work) => ({
        name: work.title,
        url: `https://www.metacritic.com/${work.type === 'series' ? 'tv' : 'movie'}/${mcSlug(work.title)}/`,
        publicationDate: `${work.year}-01-01`,
        image: { url: `https://img.metacritic.com/images/posters/${mcSlug(work.title)}.jpg` },
        metrics: { metascore: { value: work.mc.meta } },
      })),
    },
  };
}

function faSearchHtml(works) {
  const rows = works
    .map((work) => {
      const faId = work.fa.id;
      return `<div class="result">
  <dl class="wraper"><dt>
    <a href="https://www.filmaffinity.com/es/film${faId}.html"><img src="https://www.filmaffinity.com/es/images/mt${faId}.jpg" class="poster" /></a>
  </dt><dd>
    <a href="https://www.filmaffinity.com/es/film${faId}.html" class="gt hid esc search-res">${esc(work.esTitle || work.title)} <small>(${work.year})</small></a>
    <br /><span class="search-desc">Dir.: Alguien. Con Reparto. ${esc(work.genres.slice(0, 2).join(', '))}</span>
    <br /><span class="sr-pm">Rating: <b class="b">${work.fa.rating.toFixed(1).replace('.', ',')}</b>
      <span class="ratingv"><small>( ${work.fa.votes.toLocaleString('es-ES').replace(/,/g, '.')} votos )</small></span>
    </span>
  </dd></dl>
</div>`;
    })
    .join('\n');
  return `<!doctype html><html><head><title>FilmAffinity :: búsqueda</title></head><body><div id="content"><div class="search-results">${rows}</div></div></body></html>`;
}

function faFilmHtml(work) {
  return `<!doctype html><html><head>
<meta property="og:title" content="${esc(work.esTitle || work.title)} (${work.year}) | FilmAffinity" />
<meta property="og:image" content="https://www.filmaffinity.com/es/images/mt${work.fa.id}.jpg" />
</head><body>
<div id="movie-rat" class="movie-info">
  <div class="only-mobile"><span class="rating_b"><b>${work.fa.rating.toFixed(1).replace('.', ',')}</b></span>
    <span class="ratingv"> <small>( ${work.fa.votes.toLocaleString('es-ES').replace(/,/g, '.')} votos )</small></span></div>
  <div class="film-rating">
    <div class="frating-wraper"><div class="avg-rating"><span class="rating"><span class="value">${work.fa.rating.toFixed(1).replace('.', ',')}</span></span></div>
      <span class="rating-count">(${work.fa.votes.toLocaleString('es-ES').replace(/,/g, '.')} votos)</span></div>
  </div>
  ${work.fa.top ? `<div class="comp-top200"><div class="top200">Top 200 <span>Puesto #${work.fa.top}</span></div></div>` : ''}
</div>
<div class="avote">
  <span class="js-tablink a-fa-title">Título original: ${esc(work.title)}</span>
  <a href="https://www.imdb.com/title/${work.imdbId}/?ref_=fa_in_more" target="_blank">IMDb</a>
</div>
</body></html>`;
}

function tmdbFindJson(work) {
  return {
    movie_results: work.type === 'movie' ? [tmdbRaw(work)] : [],
    tv_results: work.type === 'series' ? [tmdbRaw(work)] : [],
  };
}

function tmdbRaw(work) {
  return {
    id: work.tmdbId,
    title: work.title,
    name: work.title,
    original_title: work.title,
    original_name: work.title,
    overview: work.overview,
    release_date: `${work.year}-01-01`,
    first_air_date: `${work.year}-01-01`,
    poster_path: work.posterPath,
    backdrop_path: work.posterPath,
    vote_average: work.rt ? Number(((work.imdb.value + work.fa.rating) / 2).toFixed(1)) : work.imdb.value,
    vote_count: Math.round(work.imdb.votes / 4),
    genre_ids: [],
    genres: work.genres.map((name, index) => ({ id: 1000 + index, name })),
    runtime: 148,
  };
}

function tmdbDetailJson(work) {
  const raw = tmdbRaw(work);
  raw.external_ids = { imdb_id: work.imdbId, tmdb_id: String(work.tmdbId) };
  raw.ratings = { imdb_rating: { value: work.imdb.value, vote_count: work.imdb.votes } };
  return raw;
}

function tmdbSearchJson(query, allWorks) {
  const needle = String(query || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .trim();
  const words = needle.split(/\s+/).filter((word) => word.length > 2);
  const matched = (allWorks || []).filter((work) => {
    if (!words.length) return true;
    const hay = `${work.title} ${work.esTitle}`.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ');
    return words.some((word) => hay.includes(word));
  });
  const results = matched.map((work) => tmdbRaw(work));
  return { page: 1, total_results: results.length, total_pages: 1, results };
}

function tmdbDiscoverJson(mediaType, allWorks, params = {}) {
  let list = allWorks.filter((work) => (mediaType === 'movie' ? work.type === 'movie' : work.type === 'series'));
  if (params.with_original_language === 'ja') list = list.filter((work) => work.anime);
  else if (params.with_original_language === 'es') list = list.filter((work) => work.esTitle !== work.title);
  else if (params.with_original_language) list = [];
  if (params.with_genres) {
    const wanted = String(params.with_genres).split(',');
    if (wanted.includes('16')) list = list.filter((work) => work.anime || work.genres.some((genre) => /anim/i.test(genre)));
    else list = list.filter((work) => work.genres.some((genre) => /anim/i.test(genre)) || (wanted.includes('99') && /doc/i.test(work.overview || '')));
  }
  if (params['vote_count.gte']) list = list.filter((work) => Math.round(work.imdb.votes / 4) >= Number(params['vote_count.gte']));
  const desc = !String(params.sort_by || 'vote_average.desc').endsWith('.asc');
  const results = list
    .sort((a, b) => (desc ? b.imdb.value - a.imdb.value : a.imdb.value - b.imdb.value))
    .map((work) => tmdbRaw(work));
  return { page: 1, total_results: results.length, total_pages: 1, results };
}

/* -------------------------------------------------------------- el transporte */

function notFound(url) {
  return { ok: false, status: 404, error: 'not_found', url, ms: 0 };
}

function createMockHttp(allWorks = DEMO_TITLES) {
  const works = allWorks.length ? allWorks : DEMO_TITLES;

  async function request(url, options = {}) {
    const full = new URL(url, 'http://mock.local');
    const search = Object.assign(Object.fromEntries(full.searchParams.entries()), options.query || {});
    const host = full.host;
    const path = full.pathname.replace(/\/+$/, '') || '/';
    const hit = (body, contentType = 'text/html; charset=utf-8') => ({ ok: true, status: 200, body: typeof body === 'string' ? body : JSON.stringify(body), contentType, url, ms: 1 });

    if (host === 'api.themoviedb.org') {
      const find = path.match(/^\/3\/find\/(tt\d{6,10})$/);
      if (find) {
        const work = byImdb.get(find[1]);
        return work ? hit(tmdbFindJson(work)) : notFound(url);
      }
      const detail = path.match(/^\/3\/(movie|tv)\/(\d+)$/);
      if (detail) {
        const work = byTmdb.get(detail[2]);
        return work ? hit(tmdbDetailJson(work)) : notFound(url);
      }
      if (path === '/3/search/movie') return hit(tmdbSearchJson(search.query, works.filter((w) => w.type === 'movie')));
      if (path === '/3/search/tv') return hit(tmdbSearchJson(search.query, works.filter((w) => w.type === 'series')));
      if (path === '/3/discover/movie') return hit(tmdbDiscoverJson('movie', works, search));
      if (path === '/3/discover/tv') return hit(tmdbDiscoverJson('tv', works, search));
      return notFound(url);
    }

    if (host === 'www.imdb.com') {
      const title = path.match(/\/title\/(tt\d{6,10})\/?/);
      if (title) {
        const work = byImdb.get(title[1]);
        return work ? hit(imdbTitleHtml(work)) : notFound(url);
      }
      if (/^\/chart\/(top|toptv|top-english-movies)\/?$/.test(path)) {
        const wanted = path.includes('toptv') ? 'series' : 'movie';
        const list = works.filter((w) => w.type === wanted).sort((a, b) => b.imdb.value - a.imdb.value);
        return hit(imdbListHtml(list));
      }
      if (path === '/find' || path === '/search/title') {
        const anime = /animation/.test(search.genres || '');
        const query = search.q || search.title || '';
        const wantSeries = /tv_series/.test(search.title_type || '');
        const list = works
          .filter((w) => (anime ? w.anime : wantSeries ? w.type === 'series' : w.type === 'movie'))
          .sort((a, b) => (search.sort === 'num_votes,desc' ? b.imdb.votes - a.imdb.votes : b.imdb.value - a.imdb.value))
          .filter((w) => matchesQuery(w, query));
        return hit(imdbListHtml(list, { withRank: false }));
      }
      return notFound(url);
    }

    if (host === 'www.rottentomatoes.com') {
      const page = path.match(/^\/(m|tv)\/([a-z0-9_\-]+)$/i);
      if (page) {
        const work = works.find((w) => rtSlug(w.title) === page[2].toLowerCase());
        return work ? hit(rtPageHtml(work)) : notFound(url);
      }
      if (/^\/api\/search\//.test(path) || path === '/api/private/v2.0/search') {
        return hit(rtSearchJson(works, search.q));
      }
      if (/^\/api\/private\/v2\.0\/browse\/(top-movies|movies)$/.test(path)) {
        return hit(rtSearchJson(works.filter((w) => w.type === 'movie'), search.q));
      }
      if (/^\/api\/private\/v2\.0\/browse\/(top-tv|tv)$/.test(path)) {
        return hit(rtSearchJson(works.filter((w) => w.type === 'series'), search.q));
      }
      if (path.startsWith('/browse/')) {
        const list = works
          .map((w) => `<li><a href="/${w.type === 'series' ? 'tv' : 'm'}/${rtSlug(w.title)}"><span class="tMeterScore">${w.rt.critics}%</span>${esc(w.title)} <span class="year">(${w.year})</span></a></li>`)
          .join('');
        return hit(`<!doctype html><html><body><ul>${list}</ul></body></html>`);
      }
      if (path === '/search') {
        const list = works
          .filter((w) => matchesQuery(w, search.search))
          .map((w) => `<a href="/${w.type === 'series' ? 'tv' : 'm'}/${rtSlug(w.title)}" class="result__title">${esc(w.title)}</a>`)
          .join('');
        return hit(`<!doctype html><html><body>${list}</body></html>`);
      }
      return notFound(url);
    }

    if (host === 'backend.metacritic.com' || host === 'internal-api.metacritic.com') {
      const component = path.match(/\/review\/(movie|tv)\/([a-z0-9\-]+)\/component\/score\/([a-z]+)\/?/i);
      if (component) {
        const work = works.find((w) => mcSlug(w.title) === component[2].toLowerCase());
        if (!work) return notFound(url);
        return hit(mcApiJson(work, component[3] === 'user' ? 'userscore' : component[3]));
      }
      if (/\/review\/(movie|tv)\/score\/metascore\/browse/.test(path)) {
        const wanted = path.includes('/tv/') ? 'series' : 'movie';
        return hit(mcBrowseJson(works.filter((w) => w.type === wanted)));
      }
      return notFound(url);
    }

    if (host === 'www.metacritic.com') {
      const page = path.match(/^\/(movie|tv)\/([a-z0-9\-]+)\/?$/i);
      if (page) {
        const work = works.find((w) => mcSlug(w.title) === page[2].toLowerCase());
        if (!work) return notFound(url);
        return hit(
          `<!doctype html><html><head><meta property="og:title" content="${esc(work.title)} (${work.year}) – Metacritic" /><meta property="og:url" content="https://www.metacritic.com/${page[1]}/${page[2]}/" /></head>
<body><div data-metric="metascore">${work.mc.meta}</div><div data-metric="userscore">${work.mc.user}</div></body></html>`
        );
      }
      if (path.startsWith('/search/')) {
        const wanted = decodeURIComponent(path.split('/search/')[1] || '');
        const list = works
          .filter((w) => matchesQuery(w, wanted))
          .map((w) => `<a href="/${w.type === 'series' ? 'tv' : 'movie'}/${mcSlug(w.title)}/"><span class="component-title">${esc(w.title)}</span><span data-metric="metascore">${w.mc.meta}</span></a>`)
          .join('');
        return hit(`<!doctype html><html><body>${list}</body></html>`);
      }
      if (path.startsWith('/browse/')) {
        const list = works
          .map((w) => `<a href="/${w.type === 'series' ? 'tv' : 'movie'}/${mcSlug(w.title)}/"><span class="c-media-object__title">${esc(w.title)}</span><span data-metric="metascore">${w.mc.meta}</span></a>`)
          .join('');
        return hit(`<!doctype html><html><body>${list}</body></html>`);
      }
      return notFound(url);
    }

    if (host === 'www.filmaffinity.com') {
      if (path === '/es/search.php' || path === '/es/busca.php') {
        const query = String(search.stext || search.titq || '').toLowerCase();
        const matched = works.filter((w) => !query || w.title.toLowerCase().includes(query.slice(0, 4)) || w.esTitle.toLowerCase().includes(query.slice(0, 4)) || query.includes(w.title.toLowerCase().split(' ')[0]));
        return hit(faSearchHtml(matched.length ? matched : works));
      }
      const film = path.match(/\/es\/(?:film|tv|tvseries)(\d+)\.html/);
      if (film) {
        const work = works.find((w) => w.fa.id === film[1]);
        return work ? hit(faFilmHtml(work)) : notFound(url);
      }
      if (path === '/es/tdtop.php') {
        const wanted = search['type-id'] === 'serie' ? 'series' : 'movie';
        let list = works.filter((w) => w.type === wanted);
        if (search.country === 'JP') list = list.filter((w) => w.anime);
        return hit(faSearchHtml(list.sort((a, b) => b.fa.rating - a.fa.rating)));
      }
      return notFound(url);
    }

    if (host === 'www.omdbapi.com') {
      const wanted = search.i || search.t || '';
      const work = works.find((w) => w.imdbId === wanted || w.title.toLowerCase() === String(wanted).toLowerCase());
      if (!work) return hit({ Response: 'False', Error: 'not found' }, 'application/json');
      return hit({
        Response: 'True',
        Title: work.title,
        Year: `${work.year}`,
        imdbID: work.imdbId,
        Type: work.type === 'series' ? 'series' : 'movie',
        imdbRating: `${work.imdb.value}`,
        imdbVotes: `${work.imdb.votes}`,
        Ratings: [
          { Source: 'Internet Movie Database', Value: `${work.imdb.value}/10` },
          { Source: 'Rotten Tomatoes', Value: `${work.rt.critics}%` },
          { Source: 'Metacritic', Value: `${work.mc.meta}/100` },
        ],
      });
    }

    return notFound(url);
  }

  async function getJson(url, options = {}, ctx = {}) {
    const res = await request(url, options, ctx);
    if (!res.ok) return res;
    try {
      return { ...res, json: JSON.parse(res.body) };
    } catch {
      return { ok: false, status: res.status, error: 'bad_json', url };
    }
  }

  return { request, getJson, mock: true };
}

module.exports = { DEMO_TITLES, createMockHttp, rtSlug, mcSlug, matchesQuery, imdbTitleHtml, imdbListHtml, rtPageHtml, faFilmHtml, faSearchHtml, mcApiJson, tmdbDetailJson, tmdbSearchJson };
