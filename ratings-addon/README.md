# ⭐ Stremio Ratings Scraper — addon de **solo puntuaciones**

Addon de Stremio que **no da streams**: únicamente scrapea/consulta la **puntuación** de
películas, series y anime en estas cinco fuentes y la mete en Stremio (badge `⭐ 8.4` en
tarjetas + desglose completo en la ficha).

| Fuente | Qué se saca | Cómo |
| --- | --- | --- |
| **IMDb** | nota /10, nº de votos, puesto Top 250 (y Metascore si IMDb lo publica) | ficha `imdb.com/title/tt…/` (JSON embebido + JSON-LD + badge visible) · respaldo opcional con `OMDB_API_KEY` |
| **Rotten Tomatoes** | Tomatometer %, puntuación del público %, nº de críticas, consenso | `/m/<slug>` o `/tv/<slug>` (blob `prs.init-data+json`) → buscador interno → `/search?…` |
| **Metacritic** | Metascore /100, User score /10, nº de críticas | endpoint JSON interno (`backend.metacritic.com`) → HTML de la ficha → buscador |
| **FilmAffinity** | nota /10 (coma decimal), votos, puesto Top 200 | `search.php?stext=…` → ficha (enlaza a IMDb: se aprovecha el `tt…`) |
| **TMDB** | `vote_average` + votos (y el rating de IMDb que TMDB expone en `/rating`) | **API oficial** v3/v4 con `TMDB_API_KEY` — además actúa de *resolvedor*: convierte `tt…` ⇄ título/año/tipo/póster |

Salida en Stremio (ficha de *Inception*, modo demo):

```text
— PUNTUACIONES —
⭐ IMDb 8.8/10 · 2,6 M votos · #13
🎞️ FilmAffinity 8.1/10 · 512 k votos · #9
🍅 Tomatometer 87% · 392 críticas
🍿 Público RT 91% · 250 k votos
🎯 Metascore 74% · 42 críticas
💻 Usuarios Metacritic 8.4/10 · 3,1 k votos
🎬 TMDB 8.4/10 · 645 k votos
————— ★★★★☆ 8.4/10 · muy buena
🍅 Consenso: Audaz, inteligente y visualmente deslumbrante…
```

* **0 dependencias**: `node server.js` y listo (ni `npm install`). Usa `fetch` de Node 18+.
* **Caché TTL + single-flight**: una nota se scrapea una vez cada 24 h por instancia y 20
  peticiones simultáneas del mismo título hacen 1 viaje.
* **Degradación elegante**: si IMDb te bloquea, el resto de fuentes sale igual y la ficha
  marca `🎯 Metascore — sin datos`. Nunca revienta: `meta:null` / `metas:[]`.
* **Stale-on-error**: si la web falla, se sirve el último dato conocido (con 30 días de gracia).
* **Modo demo** (`RATINGS_MOCK=1`): sirve HTML generado con el markup real de cada web, para
  probar el addon entero sin red (y para los tests deterministas).

---

## 1. Arranque rápido

```bash
cd ratings-addon

# a) demo local (sin tocar la red): todo funciona, con datos simulados
npm run demo                       # => http://localhost:7000/configure.html

# b) real
export TMDB_API_KEY='tu_key_tmdb'  # recomendado (sin esto se pierde título/año/poster y el imdb_id)
npm start                          # => http://localhost:7000

# c) pruebas (63 tests, no tocan la red)
npm test
```

Instalar en Stremio: abre `http://localhost:7000/configure.html` desde el navegador del
mismo dispositivo donde usas Stremio y pulsa **➕ Instalar addon** (o copia la URL del
manifiesto en Stremio → *Addons* → pegar). En Android hay que servirlo en la red local
(`HOST=0.0.0.0` + `http://IP-del-PC:7000/configure.html`).

## 2. Qué verás en Stremio

1. **Discover** → 18 catálogos del tipo `⭐ IMDb · Top 250`, `🍅 Rotten Tomatoes · Top crítica`,
   `🎯 Metacritic · Metascore`, `🎞️ FilmAffinity · Top 200/series`, `🌸 Anime · Top TMDB (sub/jp)`,
   `💀 TMDB · Las peor puntuadas`, `🇪🇸 Top en español`, etc. Cada tarjeta lleva el badge con la nota.
2. **Ficha**: al abrir un título que venga de estos catálogos, Stremio consulta el recurso
   `meta` de este addon (`idPrefixes: tt`, `tmdb:`, …) y pinta el desglose de arriba + enlaces
   directos a cada ficha (categoría *Puntuaciones*).
3. **Búsqueda dentro de un catálogo** (`extra.search`): escribe en la lupa de Stremio con un
   catálogo del addon activo y busca en IMDb/RT/Metacritic/FilmAffinity/TMDB.

> Stremio solo tiene **un** hueco numérico para notas, así que ahí va la métrica elegida en
> `BADGE_METRIC` (por defecto la **combinada**: media ponderada con confianza por nº de votos).
> El resto se lee en la descripción. Nada de esto añade streams: la pestaña *Streams* sigue
> siendo de tus otros addons.

## 3. Configuración

Dos capas, la de URL gana sobre las variables de entorno:

* **Por usuario (URL)** — la página `/configure.html` construye
  `/c/<base64>/manifest.json` con `{sources, badge, panel, unavailable, links, minScore, ttl, lang, weights}`.
  Cada usuario de tu instalación puede elegir sus fuentes sin que reinicies nada.
* **Por servidor (env)** — ver [`.env.example`](.env.example). Las importantes:

| Variable | Default | Para qué |
| --- | --- | --- |
| `TMDB_API_KEY` / `TMDB_API_TOKEN` | key del proyecto anterior | API oficial TMDB (resolución + nota). **Pon la tuya**: la heredada está pública en GitHub y puede estar rota/limitada |
| `OMDB_API_KEY` | – | Respaldo de IMDb/RT/Metacritic cuando el scraper está bloqueado (gratis, 1000 req/día) |
| `RATINGS_SOURCES` | las 5 | Desactiva fuentes lentas: p. ej. `imdb,tmdb,filmaffinity` |
| `BADGE_METRIC` | `combined` | `imdb`, `rt_tomatometer`, `mc_metascore`, `filmaffinity`, `tmdb` |
| `WEIGHT_*`, `MIN_VOTES_*` | ver `.env.example` | Pesos y umbral de votos de la nota combinada |
| `CACHE_TTL_HOURS` / `CHART_TTL_HOURS` | 24 / 6 | Caché RAM de fichas y listas |
| `FETCH_TIMEOUT_MS`, `FETCH_RETRIES`, `PER_HOST_MS` | 9000 / 1 / 700 | Presión sobre cada dominio (sube `PER_HOST_MS` si te bloquean) |
| `CATALOG_LIMIT`, `MIN_SCORE`, `MAX_SCORE` | 50 / 0 / 10 | Tamaño y filtro de los catálogos |
| `ENRICH_SEARCH` | `false` | Si `true`, en búsquedas se consultan las 5 fuentes por resultado (lento, ~8 items máx.) |
| `RATINGS_MOCK` | `0` | `1` = modo demo sin red |

## 4. API HTTP (usable fuera de Stremio)

```bash
curl 'localhost:7000/api/health'                       # estado, keys, stats de caché
curl 'localhost:7000/api/ratings?title=Parasite&type=movie&year=2019'
curl 'localhost:7000/api/ratings/tt1375606'            # por id (también tmdb:27205, rt:inception, fa:596263)
curl 'localhost:7000/api/search?q=breaking'            # búsqueda rápida TMDB
curl 'localhost:7000/api/chart?type=anime&id=tmdb-top' # catálogo en JSON
curl 'localhost:7000/api/sources'                      # fuentes, pesos y badge activo
```

`/api/ratings` responde, entre otras cosas, con el estado **por fuente** (útil para depurar):

```json
{
  "scores": { "imdb": { "value": 8.5, "scale": 10, "votes": 890123 }, … },
  "combined": { "value": 8.6, "verdict": "imprescindible", "used": [ … ] },
  "sources": [ { "source": "metacritic", "ok": false, "error": "…", "code": "blocked", "ms": 9012 } ],
  "stremio": { "id": "tt6751668", "imdbRating": "8.6", "description": "…" }
}
```

Añade `?debug=1` a `/catalog/...` o `/meta/...` para ver `diagnostics` (fuente usada, ms,
caché, cobertura) y `LOG_VERBOSE=1` en el servidor para el detalle de cada fetch.

## 5. Despliegue

| Plataforma | Pasos |
| --- | --- |
| **Netlify** (como tu proyecto actual) | Sube el repo y en *Site settings → Build & deploy* pon **Base directory = `ratings-addon`**. El [`netlify.toml`](netlify.toml) ya declara `netlify/functions` y un redirect `/*` → `/.netlify/functions/ratings`. Añade `TMDB_API_KEY` (y `OMDB_API_KEY`) en las env vars del sitio. |
| **Vercel** | Importa el repo, **Root directory = `ratings-addon`**. [`vercel.json`](vercel.json) reescribe todo a [`api/ratings.js`](api/ratings.js) (1024 MB, 60 s). |
| **Docker / NAS / Railway / Render** | `docker build -t stremio-ratings ./ratings-addon && docker run -p 7000:7000 -e TMDB_API_KEY=… stremio-ratings`. En Railway/Render: Start command `node server.js`, env `PORT` automática. |
| **protonet/VPS** | `pm2 start server.js --name ratings` con env. |

⚠️ **Lo más importante del despliegue**: IMDb, Rotten Tomatoes, Metacritic y FilmAffinity
ponen muros anti-bot que **bloquean IPs de datacenter** (Netlify/Vercel/Railway/Render…).
Síntoma: `/api/health` OK pero `sources[].ok:false` con `code:"blocked"` o `timeout`.
Remedios, de más a menos eficaz:

1. Servirlo en tu casa (`docker` en un NAS/PI/PC) o en un VPS con **IP residencial**.
2. Activar `OMDB_API_KEY` (IMDb + RT + Metacritic por API, sin scraping).
3. Dejar solo TMDB + FilmAffinity (`RATINGS_SOURCES=tmdb,filmaffinity`): TMDB es API oficial
   y no bloquea; FilmAffinity es el más tolerante.
4. Bajar presión: `PER_HOST_MS=2000`, `FETCH_RETRIES=0`, `CACHE_TTL_HOURS=72`.

## 6. Cómo está hecho (por si quieres tocar los parsers)

```
server.js                     nodo http sin dependencias (bind 0.0.0.0)
netlify/functions/ratings.js  adaptador Netlify   ·   api/ratings.js  adaptador Vercel
src/app.js                    router único: handle({method,path,query}) → {status,headers,body}
src/manifest.js               manifiesto Stremio + logo/bg SVG      src/configure.js  página /configure.html
src/resolve.js                id Stremio → work{title,year,type,ids} (TMDB find/search, arranque por IMDb)
src/providers/tmdb.js         API oficial: search/find/details/discover  (el "resolvedor")
src/providers/imdb.js         ficha IMDb + /find + respaldo OMDb
src/providers/rottentomatoes.js  slug adivinado → init-data → buscador
src/providers/metacritic.js   backend JSON → HTML → buscador
src/providers/filmaffinity.js search.php → ficha (+cruce al tt… de IMDb)
src/providers/index.js        orquesta, fusiona métricas, reintenta con ids nuevos, estados
src/parsers/*.js              funciones puras HTML/JSON → métricas (¡aquí se arregla un rediseño!)
src/match.js                  "¿es la misma obra?" (título+year) — evita dar la nota de otra peli
src/catalog.js                definición de catálogos y normalización 0-10
src/format.js                 meta de Stremio: badge, descripción, links
src/defs.js                   registro de fuentes/métricas, pesos, combinada, estrellas
src/cache.js src/http.js      TTL+LRU+single-flight · fetch con UA de navegador, timeout, throttle por dominio
src/mock/index.js             modo demo: HTML/JSON con el markup real de cada web
test/*.test.js                63 tests (parsers con fixtures, match, pesos, addon entero, linter oficial)
```

Reglas de oro al tocar un parser:

* Un parser **sólo** devuelve números plausibles (IMDb 1-10, RT/MC 0-100); si no, `ok:false`.
* Toda regex nueva va acompañada de un test con un fragmento de HTML real (mira
  `test/parsers.test.js`), y si puede ser, también la variante legacy del markup.
* Nunca aceptar un resultado de búsqueda sin pasar por `match.looksLikeSameWork`.

## 7. Limitaciones y aviso legal

* **No es una API oficial**: IMDb/RT/Metacritic/FilmAffinity no ofrecen acceso público a sus
  datos; el scraping directo puede dejar de funcionar en cualquier cambio de su HTML y puede
  incumplir sus términos de uso si lo usas para redifundir o para alta carga. Este addon está
  pensado para **uso personal, con caché y sin almacenar sus datos**. Para algo soportado y
  legalmente limpio, activa solo TMDB (`RATINGS_SOURCES=tmdb`).
* FilmAffinity puntúa en escala 0-10 con sesgo propio; combinarlo con Tomatometer (que mide
  *crítica*, no *gusto*) es un compromiso: de ahí los pesos configurables.
* Metacritic/RT no tienen listas de anime: los catálogos `🌸 Anime` salen de TMDB/IMDb/FilmAffinity.
* El badge de Stremio admite un solo número: si quieres IMDb puro en la tarjeta, pon
  `BADGE_METRIC=imdb` o el selector de la página de configuración.
* La key de TMDB por defecto está en el repo por herencia del addon anterior
  (`src/config.js` → `FALLBACK_TMDB_KEY`): **cámbiala** y no dejes la tuya hardcodeada.
