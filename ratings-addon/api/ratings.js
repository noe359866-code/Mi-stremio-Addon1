'use strict';

/**
 * Handler de Vercel (Node runtime). Todas las rutas pasan por aquí (ver ../vercel.json,
 * que reescribe también `?p=<ruta original>` para no depender de cómo Vercel entregue
 * `req.url` después del rewrite).
 */

const { Runtime } = require('../src/app');
const { vercelRequest, toLambdaResponse, applyServerlessDefaults } = require('../src/serverless');

applyServerlessDefaults(process.env, {
  FETCH_TIMEOUT_MS: '4000',
  FETCH_RETRIES: '1',
  PER_HOST_MS: '300',
});

const runtime = new Runtime(process.env);

module.exports = async (req, res) => {
  const result = await runtime.handle(vercelRequest(req, { publicUrl: process.env.PUBLIC_URL }));
  const status = result.statusCode || result.status || 200;
  for (const [key, value] of Object.entries(result.headers || {})) res.setHeader(key, value);
  res.status(status);
  if (Buffer.isBuffer(result.body) || result.body instanceof Uint8Array) res.send(Buffer.from(result.body));
  else res.send(typeof result.body === 'string' ? result.body : JSON.stringify(result.body === undefined ? '' : result.body));
};
