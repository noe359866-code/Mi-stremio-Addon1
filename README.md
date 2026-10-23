# Mi-stremio-Addon1

Addons propios para Stremio. Dos proyectos independientes en el mismo repo:

| Carpeta | Qué hace | Arranque |
| --- | --- | --- |
| [`Mi Projecto/`](Mi%20Projecto/) | Addon de **streams** (Vimeos + respaldo Cuevana/La Movie), función de Netlify | `Mi Projecto/stremio.js` (`exports.handler`) |
| [`ratings-addon/`](ratings-addon/) | Addon de **solo puntuaciones**: IMDb · Rotten Tomatoes · Metacritic · FilmAffinity · TMDB + AniList y MyAnimeList para anime. Sin dependencias, con modo demo, 24 catálogos (6 de anime), ficha con desglose y API JSON | `cd ratings-addon && npm run demo` |

El addon de puntuaciones no toca los streams: añade notas (badge `⭐ 8.4`) y listas top a
Discover. Documentación completa, despliegue (Netlify/Vercel/Docker) y advertencias de
anti-bot en [`ratings-addon/README.md`](ratings-addon/README.md).

## Publicar el addon de puntuaciones en Netlify

1. En Netlify: **Add new site → Import an existing project → GitHub** y elige este repositorio.
2. Deja **Base directory vacío** y **Build command vacío**. El [`netlify.toml`](netlify.toml)
   de la raíz ya configura la función y las rutas de Stremio.
3. Pulsa **Deploy site** y abre `https://<tu-sitio>.netlify.app/manifest.json`.
   Si responde un JSON con `id`, `resources` y `catalogs`, instala esa misma URL en Stremio.
4. La página `https://<tu-sitio>.netlify.app/configure.html` permite configurarlo e instalarlo.

Si el sitio ya existía y tenía **Base directory = `ratings-addon`**, también es válido;
Netlify usará la configuración alternativa de esa carpeta. Tras actualizar el código, haz
**Deploys → Trigger deploy → Clear cache and retry**.

> Netlify no publica el addon como una web estática: lo ejecuta mediante una **Netlify
> Function**. Cada addon del repositorio necesita su propio sitio; la configuración de la
> raíz corresponde al addon de puntuaciones, no al de streams de `Mi Projecto`.
