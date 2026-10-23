# ⭐ Stremio Ratings Scraper — addon de **solo puntuaciones**

Addon de Stremio que **no da streams**: únicamente scrapea/consulta la **puntuación** de
películas, series y anime en estas **siete fuentes** y la mete en Stremio (badge `⭐ 8.4` en
tarjetas + desglose completo en la ficha). AniList y MyAnimeList se añaden **solo en anime**,
así que no ensucian las fichas de pelis y series de acción real.

| Fuente | Qué se saca | Cómo |
| --- | --- | --- |
| **IMDb** | nota /10, nº de votos, puesto Top 250 (y Metascore si IMDb lo publica) | ficha `imdb.com/title/tt…/` (JSON embebido + JSON-LD + badge visible) · respaldo opcional con `OMDB_API_KEY` |
| **Rotten Tomatoes** | Tomatometer %, puntuación del público %, nº de críticas, consenso | `/m/<slug>` o `/tv/<slug>` (blob `prs.init-data+json`) → buscador interno → `/search?…` |
| **Metacritic** | Metascore /100, User score /10, nº de críticas | endpoint JSON interno (`backend.metacritic.com`) → HTML de la ficha → buscador |
| **FilmAffinity** | nota /10 (coma decimal), votos, puesto Top 200 | `search.php?stext=…` → ficha (enlaza a IMDb: se aprovecha el `tt…`) |
| **TMDB** | `vote_average` + votos (y el rating de IMDb que TMDB expone en `/rating`) | **API oficial** v3/v4 con `TMDB_API_KEY` — además actúa de *resolvedor*: convierte `tt…` ⇄ título/año/tipo/póster |
| **AniList** 🌸 | `averageScore` (0-100), nº de usuarios que puntuaron, popularidad, favoritos, formato/estado/temporada, póster y banner | **API GraphQL pública sin key** (`POST graphql.anilist.co`). Da `idMal` → cruce automático con MAL |
| **MyAnimeList** 🎌 | nota /10, `scored_by`, puesto en el ranking y popularidad | API oficial v2 si defines `MAL_CLIENT_ID` → si no, **Jikan** (`api.jikan.moe`, sin key) → si no, HTML de la ficha |

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

En anime (demo, *Jujutsu Kaisen*) el panel gana dos líneas y la combinada las usa:

```text
🎌 MyAnimeList 8.6/10 · 2,4 M votos · #8 (popularidad #12)
🌸 AniList 84/100 · 246 k puntuaciones (media 83)
————— ★★★★☆ 8.7/10 · imprescindible
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

# c) pruebas (91 tests, no tocan la red)
npm test
```

Instalar en Stremio: abre `http://localhost:7000/configure.html` desde el navegador del
mismo dispositivo donde usas Stremio y pulsa **➕ Instalar addon** (o copia la URL del
manifiesto en Stremio → *Addons* → pegar). En Android hay que servirlo en la red local
(`HOST=0.0.0.0` + `http://IP-del-PC:7000/configure.html`).

## 2. Qué verás en Stremio

1. **Discover** → 24 catálogos del tipo `⭐ IMDb · Top 250`, `🍅 Rotten Tomatoes · Top crítica`,
   `🎯 Metacritic · Metascore`, `🎞️ FilmAffinity · Top 200/series`, `🌸 Anime · Top TMDB (sub/jp)`,
   `💀 TMDB · Las peor puntuadas`, `🇪🇸 Top en español`, y en anime `🎌 Anime · Top MyAnimeList`,
   `🎌 Anime · Populares en MAL`, `📺 Anime · En emisión (MAL)`, `🌸 Anime · Top AniList`,
   `🔥 Anime · Tendencia AniList`, `🍂 Anime · Temporada actual (AniList)`. Cada tarjeta lleva el
   badge con la nota; las de AniList/MAL traen además su póster, así que Discover de anime se ve lleno.
2. **Ficha**: al abrir un título que venga de estos catálogos, Stremio consulta el recurso
   `meta` de este addon (`idPrefixes: tt`, `tmdb:`, `anilist:`, `mal:`, …) y pinta el desglose de arriba + enlaces
   directos a cada ficha (categoría *Puntuaciones*).
3. **Búsqueda dentro de un catálogo** (`extra.search`): escribe en la lupa de Stremio con un
   catálogo del addon activo y busca en IMDb/RT/Metacritic/FilmAffinity/TMDB/AniList/MAL
   (el `extra` llega como segmento de ruta, p. ej. `/catalog/anime/anilist-top/search%3Dfrieren.json`).
4. **Fichas por id de anime**: `anilist:21495` o `mal:28851` (o pegar la URL de la ficha) bastan
   para resolver título/año/póster sin pasar por TMDB.

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
| `RATINGS_SOURCES` | las 7 | Desactiva fuentes lentas: p. ej. `imdb,tmdb,filmaffinity` o `anilist,mal,tmdb` para solo anime |
| `MAL_CLIENT_ID` | – | API oficial de MyAnimeList (mejor que Jikan: sin cola de terceros). Se pide en *MyAnimeList → API* |
| `JIKAN_BASE_URL` / `ANILIST_GRAPHQL_URL` | – | Apunta a tu propio Jikan autohospedado o a otro endpoint de AniList |
| `BADGE_METRIC` | `combined` | `imdb`, `rt_tomatometer`, `mc_metascore`, `filmaffinity`, `mal`, `anilist`, `tmdb` |
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

### 5.1 Netlify (recomendado, es como ya tienes el otro addon)

1. **Sites → Add new site → Import an existing project → GitHub** → elige
   `noe359866-code/Mi-stremio-Addon1`.
2. **Deja el Base directory vacío** (no escribas `ratings-addon`) y no pongas ningún
   comando de build. El [`netlify.toml` de la raíz](../netlify.toml) ya localiza la
   función, usa una carpeta pública vacía y activa el proxy
   `/* → /.netlify/functions/ratings`.

   Si el sitio ya existía con **Base directory = `ratings-addon`**, esa forma también
   funciona: en ese caso Netlify usa [`ratings-addon/netlify.toml`](netlify.toml).
   No combines esa base con **Configuration file = `ratings-addon/netlify.toml`**;
   usa una de las dos formas, no las dos.
3. **Environment variables** (Site settings → Environment variables → Add a variable):

   | Variable | Valor | Para qué |
   | --- | --- | --- |
   | `TMDB_API_KEY` | tu key de TMDB | **casi obligatoria**: resuelve `tt…` → título/año/tipo y da la nota de TMDB |
   | `OMDB_API_KEY` | opcional | IMDb + RT + Metacritic por API (esquiva el scraping y sus bloqueos) |
   | `PUBLIC_URL` | `https://<tu-site>.netlify.app` | fija el origin del manifiesto si las headers del proxy mintieran |
   | `RATINGS_SOURCES` | `imdb,tmdb,filmaffinity` | recorta las fuentes lentas/bloqueadas |
   | `FETCH_TIMEOUT_MS` | `2500` (ya es el default en Netlify) | la función corta a 10 s en plan gratis |
   | `ADDON_NAME` | el que quieras | nombre que se ve en Stremio |

   El adaptador baja `FETCH_TIMEOUT_MS=2500`, `FETCH_RETRIES=1` y `PER_HOST_MS=300`
   **solo si tú no las pones**, para que una fuente lenta no haga que Netlify mate la
   petición. Lo que falta se rellena en la siguiente visita (caché + `stale-if-error`).
4. **Deploy site**. En los logs debe aparecer `Functions detected: 1 (ratings)` y
   `node_bundler = esbuild` empaquetando la función con su `src/`.
   Ese `node_bundler` **no es opcional**: sin él Netlify empaqueta solo la carpeta de
   funciones y `require('../../src/app')` reventaría en runtime con `MODULE_NOT_FOUND`.
   La versión de Node se define como `NODE_VERSION = "22"` en `[build.environment]`;
   no debe añadirse `node_version` dentro de `[functions]` porque Netlify rechaza esa
   configuración antes de desplegar.
5. URL que instalas en Stremio:

   ```
   https://<tu-site>.netlify.app/manifest.json
   ```

   (también vale `stremio://<tu-site>.netlify.app/manifest.json`, y el botón
   **Instalar addon** de `/configure.html` hace el `postMessage` al Stremio de escritorio).

6. **Comprueba el despliegue** con la lista de verificación incluida:

   ```bash
   npm run verify -- https://<tu-site>.netlify.app
   ```

   Revisa manifiesto, proxy, catálogos, búsqueda de Discover, ficha, `/api/ratings`,
   config por URL y el 404; sale con exit code distinto de 0 si algo falla.
   Salida esperada (en local, con `npm run demo`, es idéntica menos en `mock=sí`):

   ```
     ✔ manifiesto               24 catálogos · Puntuaciones · IMDb / RT / …
     ✔ catálogo con extras       Inception (2010)
     ✔ ficha de película         Inception (2010) · 5 enlaces
     ✔ API de puntuaciones       7 métricas · combinada 8.4
   ```

**Si el repo ya está conectado al sitio del addon de streams de `Mi Projecto`**: crea un
**sitio nuevo** para el addon de puntuaciones en vez de reutilizarlo. El `netlify.toml`
de la raíz despliega específicamente el addon de puntuaciones; cada addon debe tener su
propio sitio y su propia URL de manifiesto.

### 5.2 Vercel

Importa el repo, **Root directory = `ratings-addon`**. [`vercel.json`](vercel.json)
reescribe todo a [`api/ratings.js`](api/ratings.js) pasándole además `?p=<ruta original>`
(el adaptador la usa si Vercel entrega `req.url` ya reescrita; si no, da igual).
1024 MB y 60 s de duración máxima.

### 5.3 Docker / NAS / Railway / Render

```bash
docker build -t stremio-ratings ./ratings-addon
docker run -d -p 7000:7000 -e TMDB_API_KEY=… --name ratings stremio-ratings
```

En Railway/Render: Start command `node server.js`, `PORT` la pone la plataforma.
A diferencia de los serverless, aquí el scraper tiene más papeletas para pasar los
muros anti-bot si la IP no es de datacenter, y la caché en memoria se aprovecha de
verdad (en Netlify/Vercel solo vive mientras el contenedor no se congele).

### 5.4 Averías típicas de serverless

| Síntoma | Causa y arreglo |
| --- | --- |
| `MODULE_NOT_FOUND: ../../src/app` en los logs de la función | falta `node_bundler = "esbuild"` en `[functions]` del `netlify.toml` |
| Todas las rutas devuelven HTML del índice | el proxy no está: revisa que Netlify leyó el `netlify.toml` de la raíz (o el de `ratings-addon` si configuraste esa base) y sus `[[redirects]]` |
| `HTTP 404` en `/manifest.json` pero `/​.netlify/functions/ratings` responde | el `/*` no está aplicado (caché de Netlify): *Deploys → Trigger deploy → Clear cache and retry* |
| `Task timed out after 10 seconds` | baja `FETCH_TIMEOUT_MS`/`FETCH_RETRIES` o quita fuentes con `RATINGS_SOURCES` |
| `sources[].ok:false` con `code:"blocked"` | muro anti-bot del datacenter → ver 5.5 |
| El addon no se instala | la URL debe terminar en `/manifest.json` (sin `?` ni rutas después) |

### 5.5 ⚠️ Lo más importante del despliegue

IMDb, Rotten Tomatoes, Metacritic y FilmAffinity
ponen muros anti-bot que **bloquean IPs de datacenter** (Netlify/Vercel/Railway/Render…).
Síntoma: `/api/health` OK pero `sources[].ok:false` con `code:"blocked"` o `timeout`.
Remedios, de más a menos eficaz:

1. Servirlo en tu casa (`docker` en un NAS/PI/PC) o en un VPS con **IP residencial**.
2. Activar `OMDB_API_KEY` (IMDb + RT + Metacritic por API, sin scraping).
3. Dejar solo TMDB + FilmAffinity (`RATINGS_SOURCES=tmdb,filmaffinity`): TMDB es API oficial
   y no bloquea; FilmAffinity es el más tolerante.
4. Bajar presión: `PER_HOST_MS=2000`, `FETCH_RETRIES=0`, `CACHE_TTL_HOURS=72`.

En Netlify, además, los reintentos salen gratis: si una fuente no llegó a tiempo, la
siguida petición (o el propio Stremio al reabrir la ficha) la rellena desde la caché.

## 6. Cómo está hecho (por si quieres tocar los parsers)

```
server.js                     nodo http sin dependencias (bind 0.0.0.0)
netlify/functions/ratings.js  adaptador Netlify   ·   api/ratings.js  adaptador Vercel
src/app.js                    router único: handle({method,path,query}) → {status,headers,body}
src/serverless.js             normaliza eventos de Netlify/Vercel (path, query, origin) y responde lambda
src/manifest.js               manifiesto Stremio + logo/bg SVG      src/configure.js  página /configure.html
src/resolve.js                id Stremio → work{title,year,type,ids} (TMDB find/search, arranque por IMDb o por AniList en anime)
src/providers/tmdb.js         API oficial: search/find/details/discover  (el "resolvedor")
src/providers/imdb.js         ficha IMDb + /find + respaldo OMDb
src/providers/rottentomatoes.js  slug adivinado → init-data → buscador
src/providers/metacritic.js   backend JSON → HTML → buscador
src/providers/filmaffinity.js search.php → ficha (+cruce al tt… de IMDb)
src/providers/index.js        orquesta, fusiona métricas, reintenta con ids nuevos, estados
src/parsers/*.js              funciones puras HTML/JSON → métricas (¡aquí se arregla un rediseño!)
                              (anilist.js además genera los guiones GraphQL con sólo las
                              variables que se usan, que AniList rechaza si sobran)
src/match.js                  "¿es la misma obra?" (título+year) — evita dar la nota de otra peli
src/catalog.js                definición de catálogos y normalización 0-10
src/format.js                 meta de Stremio: badge, descripción, links
src/defs.js                   registro de fuentes/métricas (con `animeOnly`), pesos, combinada, estrellas
src/cache.js src/http.js      TTL+LRU+single-flight · fetch con UA de navegador, timeout, throttle por dominio
src/mock/index.js             modo demo: HTML/JSON con el markup real de cada web
test/*.test.js                106 tests (parsers con fixtures, match, pesos, addon entero, linter
                              oficial de Stremio, adaptadores serverless y el JS del navegador)
```

Reglas de oro al tocar un parser:

* Un parser **sólo** devuelve números plausibles (IMDb 1-10, RT/MC 0-100); si no, `ok:false`.
* Toda regex nueva va acompañada de un test con un fragmento de HTML real (mira
  `test/parsers.test.js`), y si puede ser, también la variante legacy del markup.
* Nunca aceptar un resultado de búsqueda sin pasar por `match.looksLikeSameWork`.

## 7. Limitaciones y aviso legal

**Rate limits de las fuentes de anime** (son API públicas sin key, así que tienen techo):

| Fuente | Límite orientativo | Cómo lo llevamos |
| --- | --- | --- |
| AniList GraphQL | ~90 peticiones/min por IP | `PER_HOST_MS` + caché; si devuelve 429 la fuente se marca `rate_limited` y el resto sigue OK |
| Jikan (espejo de MAL) | ~3 req/s y 60/min | una petición por título (el `idMal` de AniList evita buscar a ciegas) + caché |
| API oficial de MAL | más holgada, pide `MAL_CLIENT_ID` | recomendada si el addon va a tener tráfico |

Si Jikan se satura, lo limpio es poner `MAL_CLIENT_ID` o dejar
`RATINGS_SOURCES=anilist,mal,imdb,tmdb` (AniList solo ya da nota de anime decente).

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
