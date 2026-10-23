'use strict';

/**
 * Función de Netlify del addon de puntuaciones (misma lógica que server.js).
 *
 * El sitio debe tener "Base directory" = ratings-addon para que Netlify lea
 * ./../netlify.toml (funciones + proxy `/*` -> esta función).
 * Sin dependencias: no hace falta `npm install` para ejecutarla.
 */

const { Runtime } = require('../../src/app');
const { netlifyRequest, toLambdaResponse, applyServerlessDefaults } = require('../../src/serverless');

// Netlify corta las funciones a 10 s en el plan gratis, y los scrapers de IMDb/RT/
// Metacritic pueden tardar más si la IP del datacenter está siendo comprobada.
// Recortamos los timeouts para que la petición siempre responda (lo que falte, a
// la siguiente visita gracias a la caché). Se puede ajustar con las env vars.
applyServerlessDefaults(process.env, {
  FETCH_TIMEOUT_MS: '2500',
  FETCH_RETRIES: '1',
  PER_HOST_MS: '300',
});

// Una sola instancia por contenedor: así la caché TTL sobrevive entre invokes.
const runtime = new Runtime(process.env);

exports.handler = async (event) => {
  const request = netlifyRequest(event, { publicUrl: process.env.PUBLIC_URL });
  const result = await runtime.handle(request);
  if (process.env.LOG_VERBOSE) {
    console.log(`${event.httpMethod || 'GET'} ${request.path} -> ${result.statusCode || result.status}`);
  }
  return toLambdaResponse(result);
};
