'use strict';

/** Handler de Vercel (Node runtime). Todas las rutas pasan por aquí (ver ../vercel.json). */

const { Runtime } = require('../src/app');

const runtime = new Runtime(process.env);

function originFrom(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return host ? `${proto}://${host}` : undefined;
}

module.exports = async (req, res) => {
  const query = {};
  for (const [key, value] of Object.entries(req.query || {})) query[key] = Array.isArray(value) ? value[0] : value;
  const result = await runtime.handle({
    method: req.method || 'GET',
    path: req.url ? String(req.url).split('?')[0] : '/',
    url: req.url || '/',
    query,
    headers: req.headers || {},
    origin: originFrom(req),
  });
  const status = result.status || result.statusCode || 200;
  for (const [key, value] of Object.entries(result.headers || {})) res.setHeader(key, value);
  res.status(status);
  res.send(typeof result.body === 'string' ? result.body : JSON.stringify(result.body || {}));
};
