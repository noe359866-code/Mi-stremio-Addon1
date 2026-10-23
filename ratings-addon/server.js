#!/usr/bin/env node
'use strict';

/**
 * server.js — servidor propio (Node 18+, sin dependencias).
 * Es lo que usas en local, en Docker, Railway, Render o un NAS.
 *   RATINGS_MOCK=1 npm run demo   -> todo simulado, sin red
 *   TMDB_API_KEY=… npm start      -> scraping real
 */

const http = require('node:http');
const { Runtime, splitPath, parseQuery } = require('./src/app');

const runtime = new Runtime(process.env);
const port = Number(process.env.PORT || 7000);
const host = process.env.HOST || '0.0.0.0';

const server = http.createServer((req, res) => {
  const host = req.headers.host || `localhost:${port}`;
  const proto = req.headers['x-forwarded-proto'] || (/^(localhost|127\.|\[::1\]|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ? 'http' : 'https');
  runtime
    .handle({
      method: req.method,
      url: req.url,
      path: splitPath(req.url),
      query: parseQuery(req.url),
      headers: req.headers,
      origin: `${proto}://${host}`,
    })
    .then((result) => {
      const status = result.status || result.statusCode || 200;
      const headers = { ...(result.headers || {}) };
      if (status === 204) {
        res.writeHead(204, headers);
        res.end();
        return;
      }
      res.writeHead(status, headers);
      res.end(result.body === undefined ? '' : result.body);
    })
    .catch((error) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(error && error.message ? error.message : error) }));
    });
});

server.headersTimeout = 30000;
server.requestTimeout = 0;

server.listen(port, host, () => {
  const banner = [
    '',
    '  ⭐ Stremio Ratings Scraper',
    `  servidor   http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`,
    `  config     http://localhost:${port}/configure.html`,
    `  manifiesto http://localhost:${port}/manifest.json`,
    `  prueba     http://localhost:${port}/api/ratings?title=Inception`,
    `  modo       ${runtime.mock ? 'DEMO (sin red, markup simulado)' : 'online (scraping real)'}`,
    `  fuentes    ${runtime.baseCfg.sources.join(', ')}`,
    `  TMDB key   ${runtime.baseCfg.tmdbApiKey || runtime.baseCfg.tmdbToken ? 'sí' : 'NO (pon TMDB_API_KEY)'}`,
    '',
  ].join('\n');
  console.log(banner);
});

function shutdown(signal) {
  console.log(`\n${signal} recibido, cerrando…`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
