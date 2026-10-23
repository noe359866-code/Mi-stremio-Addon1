'use strict';

/**
 * Función de Netlify (misma lógica que server.js, adaptada al evento).
 * Requiere que el "base directory" del sitio sea `ratings-addon`
 * (ver ../netlify.toml). Sin dependencias: ni hace falta `npm install`.
 */

const { Runtime } = require('../../src/app');

// Una sola instancia por contenedor: así la caché TTL sobrevive entre invokes.
const runtime = new Runtime(process.env);

function originFrom(event) {
  const headers = event.headers || {};
  const proto = headers['x-forwarded-proto'] || 'https';
  const host = headers['x-forwarded-host'] || headers.host;
  if (!host) return undefined;
  return `${proto}://${host}`;
}

exports.handler = async (event) => {
  const result = await runtime.handle({
    method: event.httpMethod || (event.http && event.http.method) || 'GET',
    path: event.path || '/',
    url: event.rawUrl || event.path || '/',
    query: event.multiValueQueryStringParameters
      ? Object.fromEntries(Object.entries(event.multiValueQueryStringParameters).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]))
      : event.queryStringParameters || {},
    headers: event.headers || {},
    origin: originFrom(event),
  });
  const status = result.status || result.statusCode || 200;
  return {
    statusCode: status,
    headers: { ...(result.headers || {}) },
    body: typeof result.body === 'string' ? result.body : JSON.stringify(result.body || {}),
    isBase64Encoded: false,
  };
};
