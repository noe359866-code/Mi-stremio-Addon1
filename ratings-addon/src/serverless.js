'use strict';

/**
 * src/serverless.js — puente entre los eventos de Netlify/Vercel y Runtime.handle().
 *
 * Por qué existe: en serverless la URL que recibe tu código no es fiable.
 * Netlify puede entregar el path bonito (`/manifest.json`) o el path reescrito
 * de la función (`/.netlify/functions/ratings/manifest.json` o solo
 * `/.netlify/functions/ratings` cuando el proxy se come el resto), y Vercel hace
 * lo propio con sus rewrites. Aquí se normalizan las dos formas para que el
 * router solo vea rutas del addon.
 */

const { splitPath, parseQuery } = require('./util');

/** Rutas bajo las que estas plataformas montan la función. */
const FUNCTION_PREFIXES = ['/.netlify/functions/ratings', '/api/ratings'];
/**
 * `/api/ratings` es ALSO una ruta real del addon (la API JSON), así que esa forma
 * solo se quita cuando trae algo detrás; la de Netlify no coincide con ninguna ruta
 * propia, luego pelada significa «raíz».
 */
const BARE_MEANS_ROOT = new Set(['/.netlify/functions/ratings']);

/** Claves de header a minúsculas (Netlify las pasa tal cual, Node también varía). */
function lowerHeaders(headers = {}) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (typeof key === 'string') out[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
  }
  return out;
}

function hasFunctionPrefix(path) {
  return FUNCTION_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** '/.netlify/functions/ratings/manifest.json' -> '/manifest.json' (y '') -> '/' */
function stripFunctionPrefix(path) {
  for (const prefix of FUNCTION_PREFIXES) {
    if (path === prefix) return BARE_MEANS_ROOT.has(prefix) ? '/' : path;
    if (path.startsWith(`${prefix}/`)) return path.slice(prefix.length) || '/';
  }
  return path;
}

/** `'https://host/a/b?x=1'` -> `'/a/b'`; también acepta URLs relativas. */
function urlPathname(rawUrl) {
  if (!rawUrl) return '';
  const value = splitPath(rawUrl);
  if (!value) return '';
  return value.startsWith('/') ? value : `/${value}`;
}

/**
 * Elige el path del addon: el que NO lleve el prefijo de la función gana; si todos
 * lo llevan, se quita el prefijo (así el manifiesto también funciona instalando
 * con la URL cruda de la función).
 */
function pickPath({ rawUrl, eventPath }) {
  const candidates = [urlPathname(rawUrl), eventPath ? splitPath(eventPath) : '']
    .filter((value) => value && value !== '');
  const clean = candidates.find((value) => !hasFunctionPrefix(value));
  if (clean) return clean;
  const dirty = candidates.map(stripFunctionPrefix).find((value) => value && value !== '/');
  return dirty || (candidates.length ? stripFunctionPrefix(candidates[0]) : '/') || '/';
}

/** Une query de la URL + queryStringParameters (+ multiValue de API Gateway). */
function pickQuery({ rawUrl, queryStringParameters, multiValueQueryStringParameters }) {
  const out = { ...parseQuery(rawUrl) };
  if (multiValueQueryStringParameters && typeof multiValueQueryStringParameters === 'object') {
    for (const [key, value] of Object.entries(multiValueQueryStringParameters)) {
      out[key] = Array.isArray(value) ? value[value.length - 1] : value;
    }
  }
  if (queryStringParameters && typeof queryStringParameters === 'object') {
    Object.assign(out, queryStringParameters);
  }
  for (const [key, value] of Object.entries(out)) {
    if (value === null || value === undefined) delete out[key];
  }
  return out;
}

/** Origin público: PUBLIC_URL > x-forwarded-* > host. */
function pickOrigin(headers = {}, publicUrl = '') {
  if (publicUrl) return String(publicUrl).replace(/\/+$/, '');
  const host = headers['x-forwarded-host'] || headers.host;
  if (!host) return undefined;
  const proto = headers['x-forwarded-proto'] || headers['x-forwarded-protocol'] || (/^(localhost|127\.)/.test(String(host).split(':')[0]) ? 'http' : 'https');
  return `${proto}://${host}`;
}

/** Evento de Netlify (v1 o v2) -> argumento de Runtime.handle(). */
function netlifyRequest(event, options = {}) {
  const headers = lowerHeaders(event.headers);
  const rawUrl = event.rawUrl || event.url || '';
  const request = {
    method: event.httpMethod || (event.http && event.http.method) || 'GET',
    path: pickPath({ rawUrl, eventPath: event.path }),
    url: rawUrl || event.path || '/',
    query: pickQuery(event),
    headers,
  };
  const origin = pickOrigin(headers, options.publicUrl);
  if (origin) request.origin = origin;
  return request;
}

/** Request de Vercel (@vercel/node) -> argumento de Runtime.handle(). */
function vercelRequest(req, options = {}) {
  const headers = lowerHeaders(req.headers);
  const url = req.originalUrl || req.url || '/';
  // vercel.json manda también `?p=<ruta original>` por si el rewrite se come el path
  const hinted = req.query && req.query.p ? String(req.query.p) : '';
  const request = {
    method: req.method || 'GET',
    path: hinted || pickPath({ rawUrl: url, eventPath: req.path || req.url }),
    url,
    query: (() => {
      const merged = pickQuery({ rawUrl: url, queryStringParameters: req.query });
      delete merged.p;
      return merged;
    })(),
    headers,
  };
  const origin = pickOrigin(headers, options.publicUrl);
  if (origin) request.origin = origin;
  return request;
}

/** Resultado de Runtime.handle() -> respuesta lambda. */
function toLambdaResponse(result) {
  const status = result.statusCode || result.status || 200;
  const headers = { ...(result.headers || {}) };
  const body = typeof result.body === 'string' ? result.body : JSON.stringify(result.body === undefined ? '' : result.body);
  // Las respuestas sin cuerpo (204 de preflight, 304) no llevan Content-Type: si no,
  // el cliente intenta parsear una respuesta vacía.
  if (!headers['Content-Type'] && body) headers['Content-Type'] = 'application/json; charset=utf-8';
  return { statusCode: status, headers, body, isBase64Encoded: false };
}

/**
 * Ajustes por defecto para plataformas con timeout corto (Netlify gratis: 10 s).
 * No pisa nada que el usuario haya puesto en las variables de entorno.
 */
function applyServerlessDefaults(env, defaults) {
  const touched = [];
  for (const [key, value] of Object.entries(defaults)) {
    if (env[key] === undefined || env[key] === '') {
      env[key] = value;
      touched.push(`${key}=${value}`);
    }
  }
  return touched;
}

module.exports = {
  FUNCTION_PREFIXES,
  netlifyRequest,
  vercelRequest,
  toLambdaResponse,
  applyServerlessDefaults,
  pickPath,
  pickQuery,
  pickOrigin,
  stripFunctionPrefix,
  hasFunctionPrefix,
  urlPathname,
  lowerHeaders,
};
