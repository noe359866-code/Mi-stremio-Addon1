# Mi-stremio-Addon1

Addons propios para Stremio. Dos proyectos independientes en el mismo repositorio:

| Carpeta | Qué hace | Arranque |
| --- | --- | --- |
| [`Mi Projecto/`](Mi%20Projecto/) | Addon de **streams** (Vimeos + respaldo Cuevana/La Movie), función de Netlify | `Mi Projecto/stremio.js` (`exports.handler`) |
| [`ratings-addon/`](ratings-addon/) | **Envuelve los catálogos que ya usas** y añade puntuaciones: badge nativo de Stremio y pósters con las notas dibujadas. Cinemeta viene configurado y puedes añadir otros addons por URL de manifiesto | `cd ratings-addon && npm run demo` |

## Qué hace el addon de puntuaciones

- Reutiliza el contenido, el orden y los IDs de **Cinemeta** y de otros addons que indiques.
- **No publica las antiguas listas top propias**: no crea 24 filas nuevas ni duplica Discover.
- Puede mostrar una nota combinada en el campo nativo `imdbRating` (⭐ en la tarjeta).
- Puede sustituir la imagen por un póster generado con hasta seis puntuaciones visibles.
- Mantiene las fichas, descripciones, enlaces y búsqueda del addon original; añade el desglose de IMDb, TMDB, Rotten Tomatoes, Metacritic, FilmAffinity y, para anime, AniList/MAL.
- No proporciona streams.

> **Importante:** Stremio no permite editar directamente las respuestas de otro addon. Este addon las vuelve a servir ya mejoradas. Después de instalar el manifiesto envuelto, **desactiva o desinstala los addons originales que hayas envuelto** para no ver sus filas dos veces.

## Publicar en Netlify

1. En Netlify: **Add new site → Import an existing project → GitHub** y elige este repositorio.
2. Deja **Base directory vacío**. No hace falta escribir un comando manual: el [`netlify.toml`](netlify.toml) de la raíz configura `ratings-addon` como base, ejecuta `npm ci`, empaqueta la función e incluye los binarios nativos de `sharp` con Node 22.
3. Pulsa **Deploy site** y abre `https://<tu-sitio>.netlify.app/manifest.json`. Debe responder JSON con `id`, `resources` y `catalogs`.
4. Abre `https://<tu-sitio>.netlify.app/configure.html`:
   - deja Cinemeta o pega las URLs `/manifest.json` de los addons que quieras envolver;
   - activa el badge nativo, el póster con notas o ambos;
   - instala el manifiesto generado;
   - desactiva los originales para evitar duplicados.
5. Opcionalmente, configura tus claves de TMDB/OMDb en **Site settings → Environment variables** y ejecuta:

   ```bash
   cd ratings-addon
   npm run verify -- https://<tu-sitio>.netlify.app
   ```

Si el sitio ya existía con **Base directory = `ratings-addon`**, también se admite mediante la configuración de esa carpeta. Tras cambiar ajustes de build usa **Deploys → Trigger deploy → Clear cache and retry**.

> Cada addon del repositorio necesita su propio sitio de Netlify. La configuración de la raíz corresponde al wrapper de puntuaciones, no al addon de streams de `Mi Projecto`.

Documentación técnica, variables, API, límites y solución de problemas: [`ratings-addon/README.md`](ratings-addon/README.md).
