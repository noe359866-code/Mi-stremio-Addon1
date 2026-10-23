# ⭐ Puntuaciones en tus catálogos de Stremio

Addon de Stremio que **envuelve los catálogos que ya tienes** y les añade puntuaciones. Usa **Cinemeta por defecto** y admite otros addons pegando sus URLs de `manifest.json`.

No crea una colección de listas top propias. Vuelve a servir las filas del addon elegido, conservando su contenido, orden e IDs, con dos mejoras independientes:

1. **Badge nativo ⭐**: rellena `imdbRating` en las tarjetas con la nota combinada o con una fuente concreta.
2. **Póster con notas**: genera una imagen JPEG de 500×750 con el póster original y hasta seis puntuaciones dibujadas encima.

También enriquece la ficha con el desglose y enlaces de las fuentes. **No da streams.**

## Por qué hay que reemplazar el addon original

Stremio no permite que un addon modifique directamente las respuestas de otro addon instalado. Para cambiar las tarjetas hay que servir una versión envuelta de esos mismos catálogos.

Después de instalar este manifiesto, **desactiva o desinstala los addons originales que hayas envuelto**. Si dejas Cinemeta y el wrapper activos a la vez, verás las filas duplicadas: una original y otra mejorada.

---

## 1. Arranque rápido

Requiere Node 18.17 o superior; Netlify está configurado con Node 22.

```bash
cd ratings-addon
npm ci

# Demo completa, sin red: Cinemeta y un segundo addon simulados, notas e imágenes
npm run demo
# http://localhost:7000/configure.html

# Datos reales
npm start

# 119 pruebas deterministas, incluidos linter de Stremio, Sharp y serverless
npm test
```

En la página de configuración:

1. Deja `https://v3-cinemeta.strem.io/manifest.json` o escribe hasta seis manifiestos, uno por línea.
2. Activa **Nota nativa**, **Póster con puntuaciones** o ambos.
3. Elige las fuentes y la métrica del badge.
4. Pulsa **Instalar addon** o copia la URL `/c/<config>/manifest.json` generada.
5. Desactiva los addons originales para evitar duplicados.

Para probarlo en otro dispositivo de la red local, usa `HOST=0.0.0.0` y abre `http://IP-del-PC:7000/configure.html`.

## 2. Qué conserva y qué cambia

| Elemento upstream | Resultado |
| --- | --- |
| Catálogos, tipos, IDs y orden | Se conservan; no se sustituyen por rankings propios |
| Búsqueda, género y paginación | Se reenvían al addon original |
| Nombre, año, descripción, fondo y enlaces | Se conservan |
| `imdbRating` de la tarjeta | Nota elegida si está activado el badge nativo |
| `poster` | URL del generador si está activado el póster con notas |
| Ficha `meta` | Metadatos originales + panel y enlaces de puntuaciones |
| Streams | No se copian ni se proporcionan; usa tus addons de streams |

Si dos manifiestos declaran el mismo `type/id` de catálogo, se usa el primero y no se duplica la fila. Los IDs distintos, como `tmdb:…`, `anilist:…` o IDs personalizados, se mantienen; cuando el upstream no puede resolverlos, el wrapper intenta identificarlos por sus propios metadatos o por título/año.

Si una fuente de notas o la composición de la imagen falla, se sirve el póster original en vez de una imagen rota.

## 3. Fuentes de puntuación

| Fuente | Datos principales | Acceso |
| --- | --- | --- |
| **IMDb** | Nota /10, votos y puesto Top 250 | Ficha pública + respaldo opcional OMDb |
| **Rotten Tomatoes** | Tomatometer, público, críticas y consenso | Ficha/buscador público + respaldo OMDb |
| **Metacritic** | Metascore, nota de usuarios y críticas | Backend/ficha pública + respaldo OMDb |
| **FilmAffinity** | Nota /10, votos y ranking | Buscador y ficha pública |
| **TMDB** | Nota /10 y votos; también resuelve IDs, títulos y años | API oficial con `TMDB_API_KEY` o token v4 |
| **AniList** | Nota /100, puntuaciones y cruce con MAL | GraphQL público, solo anime |
| **MyAnimeList** | Nota /10, votos y ranking | API oficial con `MAL_CLIENT_ID`, Jikan o ficha; solo anime |

La nota `combined` es una media ponderada con ajuste de confianza por número de votos. El badge de Stremio solo admite un número; el resto aparece en el póster y en la ficha.

## 4. Configuración

La configuración por URL tiene prioridad sobre las variables del servidor. `/configure.html` genera `/c/<base64url>/manifest.json` con opciones como:

```json
{
  "upstreams": [
    "https://v3-cinemeta.strem.io/manifest.json",
    "https://otro-addon.example/manifest.json"
  ],
  "nativeBadge": true,
  "posterOverlay": true,
  "sources": ["imdb", "tmdb", "filmaffinity"],
  "badge": "combined",
  "panel": true,
  "links": true
}
```

Variables principales (todas las demás están en [`.env.example`](.env.example)):

| Variable | Default | Para qué |
| --- | --- | --- |
| `UPSTREAM_MANIFEST_URLS` | Cinemeta | Manifiestos a envolver, separados por coma o nueva línea; máximo 6 |
| `WRAP_NATIVE_BADGE` | `true` | Activa la nota nativa en las tarjetas |
| `WRAP_POSTER_OVERLAY` | `true` | Activa los pósters generados |
| `WRAP_CATALOG_TIME_BUDGET_MS` | `4000` | Presupuesto para enriquecer una página de catálogo |
| `WRAP_CATALOG_CONCURRENCY` | `6` | Consultas de notas simultáneas por catálogo |
| `TMDB_API_KEY` / `TMDB_API_TOKEN` | key heredada / vacío | Resolución de obras y nota TMDB; usa tus propias credenciales |
| `OMDB_API_KEY` | vacío | Respaldo de IMDb/RT/Metacritic |
| `RATINGS_SOURCES` | las 7 | Fuentes activas, separadas por comas |
| `BADGE_METRIC` | `combined` | `imdb`, `tmdb`, `rt_tomatometer`, `mc_metascore`, `filmaffinity`, etc. |
| `MAL_CLIENT_ID` | vacío | API oficial de MyAnimeList |
| `CACHE_TTL_HOURS` | `24` | Caché de notas e imágenes por instancia |
| `FETCH_TIMEOUT_MS`, `FETCH_RETRIES`, `PER_HOST_MS` | `9000`, `1`, `700` | Timeouts, reintentos y pausa por dominio |
| `PUBLIC_URL` | vacío | Origin público si el proxy no envía headers correctas |
| `RATINGS_MOCK` | `0` | `1` activa la demo sin red |

`CATALOG_LIMIT`, `MIN_SCORE`, `MAX_SCORE` y `ENRICH_SEARCH` pertenecen a las rutas legacy de versiones anteriores; **no recortan ni reordenan los catálogos envueltos**.

## 5. Rutas HTTP

```text
/manifest.json
/catalog/{type}/{id}.json
/meta/{type}/{id}.json
/poster/{token}.jpg
/configure.html
/api/health
/api/catalogs
/api/ratings?title=Inception&type=movie
/api/ratings/tt1375606
/api/chart?type=movie&id=top&limit=10
/api/search?q=breaking
/api/sources
```

Todas aceptan el prefijo `/c/<config>` cuando corresponda. `/api/health` informa de los upstreams, ambos modos de presentación, claves y cachés. Añade `?debug=1` a una ficha para ver diagnósticos de las fuentes.

## 6. Despliegue en Netlify

1. **Add new site → Import an existing project → GitHub** y selecciona este repositorio.
2. Deja **Base directory vacío**. El [`netlify.toml` de la raíz](../netlify.toml) ya define:
   - base `ratings-addon`;
   - `npm ci --no-audit --no-fund`;
   - función `netlify/functions/ratings.js`;
   - Node 22 y `node_bundler = "esbuild"`;
   - `sharp` como módulo nativo externo;
   - proxy `/* → /.netlify/functions/ratings`.
3. Añade tus claves en **Site settings → Environment variables**. No las escribas en `netlify.toml`.
4. Despliega y abre:

   ```text
   https://<tu-sitio>.netlify.app/manifest.json
   https://<tu-sitio>.netlify.app/configure.html
   ```

5. Comprueba el despliegue:

   ```bash
   npm run verify -- https://<tu-sitio>.netlify.app
   ```

   El verificador comprueba manifiesto, ausencia de catálogos propios, catálogo Cinemeta, descarga de un póster, búsqueda, fichas, API y configuración por URL.

También se admite un sitio existente con **Base directory = `ratings-addon`**, mediante [`ratings-addon/netlify.toml`](netlify.toml). No combines esa base con **Configuration file = `ratings-addon/netlify.toml`**.

> `sharp` es necesario en producción: no uses `npm install --ignore-scripts` ni omitas sus paquetes opcionales. El build incluye `libvips` y el binario `.node` dentro del ZIP de la función.

## 7. Otras plataformas

### Vercel

Importa el repo con **Root directory = `ratings-addon`**. [`vercel.json`](vercel.json) dirige todas las rutas a [`api/ratings.js`](api/ratings.js). Las imágenes se envían como `Buffer`, sin convertirlas a texto.

### Docker / NAS / Railway / Render

```bash
docker build -t stremio-ratings ./ratings-addon
docker run -d -p 7000:7000 \
  -e TMDB_API_KEY='tu-key' \
  --name ratings stremio-ratings
```

En Railway/Render usa `npm ci` como build y `node server.js` como start. Estas plataformas de larga duración aprovechan mejor la caché en memoria que una función serverless.

## 8. Solución de problemas

| Síntoma | Causa y solución |
| --- | --- |
| Filas duplicadas | El original sigue instalado. Desactiva Cinemeta/el otro addon envuelto y conserva el wrapper |
| `bad_upstream` o manifiesto 502 | Revisa que cada URL sea pública, responda JSON y termine en `/manifest.json` |
| Póster original sin notas | Puede estar desactivado `posterOverlay`, faltar datos o haber fallado una fuente; la imagen original es el fallback deliberado |
| Badge vacío o nota incompleta | Revisa `/api/ratings`, las fuentes activas, las claves y los timeouts |
| `MODULE_NOT_FOUND: sharp` | Ejecuta `npm ci`; en Netlify conserva `external_node_modules = ["sharp"]` |
| `Task timed out` | Reduce fuentes, `WRAP_CATALOG_CONCURRENCY` o `FETCH_TIMEOUT_MS`; vuelve a abrir la fila para aprovechar la caché |
| Rutas devuelven HTML o 404 | Revisa el redirect de Netlify y haz **Clear cache and retry** |

## 9. Limitaciones importantes

- IMDb, Rotten Tomatoes, Metacritic y FilmAffinity pueden bloquear IPs de datacenter o cambiar su HTML. TMDB/OMDb con clave son alternativas más estables. Para uso personal, reduce fuentes y aumenta caché/pausas si recibes bloqueos.
- La caché es en memoria: Netlify/Vercel pueden perderla al congelar una instancia. Los pósters llevan cabeceras de caché HTTP, pero el origen puede tener que regenerarlos.
- Enriquecer una página grande tiene un presupuesto de tiempo. Las tarjetas que no alcancen nota conservan el contenido original; no se bloquea todo el catálogo por una fuente.
- AniList y Jikan tienen límites de peticiones. `MAL_CLIENT_ID` evita depender solo de Jikan.
- Las credenciales TMDB heredadas del proyecto anterior están públicas. Configura las tuyas y no añadas secretos al repositorio.
- Este software es para uso personal. Respeta los términos de cada fuente y del addon que envuelvas.

## 10. Estructura técnica

```text
server.js                     Servidor Node, bind 0.0.0.0
netlify/functions/ratings.js  Adaptador Netlify
api/ratings.js                Adaptador Vercel
src/app.js                    Router común y respuestas binarias
src/wrapper.js                Manifiestos upstream, proxy de catálogos/meta y deduplicación
src/poster.js                 Composición JPEG con Sharp
src/config.js                 Defaults, env y configuración por URL
src/resolve.js                IDs/título/año → obra
src/providers/                IMDb, TMDB, RT, Metacritic, FilmAffinity, AniList y MAL
src/format.js                 Badge, panel y enlaces de la ficha
src/cache.js                  TTL + LRU + single-flight
src/http.js                   Fetch, límites, timeout y throttle por dominio
src/serverless.js             Normalización Netlify/Vercel y base64 para imágenes
src/mock/                     Cinemeta, addon personalizado, fuentes e imágenes de demo
scripts/verify.js             Verificación post-despliegue
test/                         119 pruebas, sin red externa
```

Las rutas antiguas de catálogos top permanecen solo como fallback para instalaciones viejas; **el manifiesto público ya no las anuncia**.
