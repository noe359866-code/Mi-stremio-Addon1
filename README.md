# Mi-stremio-Addon1

Addons propios para Stremio. Dos proyectos independientes en el mismo repo:

| Carpeta | Qué hace | Arranque |
| --- | --- | --- |
| [`Mi Projecto/`](Mi%20Projecto/) | Addon de **streams** (Vimeos + respaldo Cuevana/La Movie), función de Netlify | `Mi Projecto/stremio.js` (`exports.handler`) |
| [`ratings-addon/`](ratings-addon/) | Addon de **solo puntuaciones**: IMDb · Rotten Tomatoes · Metacritic · FilmAffinity · TMDB + AniList y MyAnimeList para anime. Sin dependencias, con modo demo, 24 catálogos (6 de anime), ficha con desglose y API JSON | `cd ratings-addon && npm run demo` |

El addon de puntuaciones no toca los streams: añade notas (badge `⭐ 8.4`) y listas top a
Discover. Documentación completa, despliegue (Netlify/Vercel/Docker) y advertencias de
anti-bot en [`ratings-addon/README.md`](ratings-addon/README.md).
