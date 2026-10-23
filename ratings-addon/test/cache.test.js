'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TTLCache, NotFoundForCache } = require('../src/cache');

test('TTLCache devuelve fresco y luego caducado (stale)', async () => {
  const cache = new TTLCache({ max: 10, ttlMs: 20, staleMs: 5000 });
  let calls = 0;
  const producer = async () => {
    calls += 1;
    return { value: 42 };
  };
  const first = await cache.wrap('k', producer);
  assert.equal(first.value.value, 42);
  assert.equal(first.fromCache, false, 'la primera vez se calcula');
  assert.equal(calls, 1);

  const second = await cache.wrap('k', producer);
  assert.equal(second.fromCache, true, 'la segunda sale de caché');
  assert.equal(calls, 1, 'segunda llamada resuelve en caché');

  await new Promise((resolve) => setTimeout(resolve, 30));
  const third = await cache.wrap('k', async () => {
    throw new Error('bloqueado por anti-bot');
  });
  assert.equal(third.stale, true, 'si la web falla, servimos el último dato conocido');
  assert.equal(third.value.value, 42);
  assert.match(third.error, /anti-bot/);
});

test('TTLCache deduplica peticiones simultáneas a la misma clave', async () => {
  const cache = new TTLCache({ ttlMs: 1000 });
  let calls = 0;
  const producer = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 15));
    return 'dato';
  };
  const results = await Promise.all([1, 2, 3, 4, 5].map(() => cache.wrap('misma', producer)));
  assert.equal(calls, 1, '5 peticiones = 1 fetch');
  assert.deepEqual(results.map((entry) => entry.value), ['dato', 'dato', 'dato', 'dato', 'dato']);
});

test('TTLCache no guarda null y limita entradas por LRU', async () => {
  const cache = new TTLCache({ max: 2, ttlMs: 1000 });
  await assert.rejects(() => cache.wrap('vacio', async () => null), (error) => error instanceof NotFoundForCache);
  assert.equal(cache.get('vacio'), undefined, 'un null no se cachea: se puede reintentar');
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3);
  assert.equal(cache.get('a'), undefined, 'el más viejo sale');
  assert.equal(cache.get('c'), 3);
  const stats = cache.stats();
  assert.equal(stats.entries, 2);
  assert.ok(stats.misses >= 1);
});

test('TTLCache propaga errores cuando no hay dato viejo', async () => {
  const cache = new TTLCache({ ttlMs: 1000 });
  await assert.rejects(
    () =>
      cache.wrap('nada', async () => {
        throw new Error('timeout');
      }),
    /timeout/
  );
  assert.equal(cache.stats().errors, 1);
});
