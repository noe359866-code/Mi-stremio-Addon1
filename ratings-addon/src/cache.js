'use strict';

/**
 * cache.js — caché TTL en memoria con LRU simple y "stale-on-error".
 *
 * Es la pieza que mantiene el scraping educado: una puntuación no cambia cada
 * minuto, así que servimos de 12-48 h desde RAM y, si la web falla o nos
 * bloquea, devolvemos el último dato conocido aunque esté caducado.
 */

class NotFoundForCache extends Error {}

class TTLCache {
  constructor({ name = 'cache', max = 800, ttlMs = 24 * 3600 * 1000, staleMs = 30 * 24 * 3600 * 1000 } = {}) {
    this.name = name;
    this.max = max;
    this.ttlMs = ttlMs;
    this.staleMs = staleMs;
    this.store = new Map();
    this.inflight = new Map();
    this.hits = 0;
    this.misses = 0;
    this.staleHits = 0;
    this.errors = 0;
  }

  /** Devuelve el valor fresco o `undefined`. */
  get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    const now = Date.now();
    if (entry.expiresAt > now) {
      this.hits += 1;
      this.store.delete(key); // re-insertar => orden LRU
      this.store.set(key, entry);
      return entry.value;
    }
    if (entry.staleUntil && entry.staleUntil < now) this.store.delete(key);
    return undefined;
  }

  /** Devuelve el último valor conocido (aunque haya caducado) o `undefined`. */
  getStale(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.staleUntil && entry.staleUntil < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key, value, ttlMs) {
    const now = Date.now();
    const ttl = ttlMs || this.ttlMs;
    this.store.delete(key);
    this.store.set(key, { value, expiresAt: now + ttl, staleUntil: now + Math.max(ttl, this.staleMs), storedAt: now });
    while (this.store.size > this.max) {
      const oldest = this.store.keys().next();
      if (oldest.done) break;
      this.store.delete(oldest.value);
    }
    return value;
  }

  delete(key) {
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
    this.inflight.clear();
  }

  /**
   * Cache-aside con deduplicación: si N peticiones simultáneas piden la misma
   * clave, `producer()` corre una sola vez. Si falla y hay dato viejo, se
   * devuelve el dato viejo marcado como `stale`.
   *
   * @returns {Promise<{value:any, fromCache:boolean, stale:boolean, error?:string}>}
   */
  async wrap(key, producer, { allowStaleOnError = true, ttlMs } = {}) {
    const cached = this.get(key);
    if (cached !== undefined) return { value: cached, fromCache: true, stale: false };
    this.misses += 1;

    let promise = this.inflight.get(key);
    let shared = false;
    if (!promise) {
      promise = (async () => {
        try {
          const produced = await producer();
          if (produced !== null && produced !== undefined) {
            this.set(key, produced, produced.__ttlMs || ttlMs);
          }
          return { ok: true, value: produced === undefined ? null : produced };
        } catch (error) {
          return { ok: false, error: (error && error.message) || 'error' };
        } finally {
          this.inflight.delete(key);
        }
      })();
      this.inflight.set(key, promise);
    } else {
      shared = true;
    }

    const result = await promise;
    if (result.ok) {
      if (result.value === null) throw new NotFoundForCache('empty');
      return { value: result.value, fromCache: shared, stale: false, shared };
    }
    this.errors += 1;
    if (allowStaleOnError) {
      const stale = this.getStale(key);
      if (stale !== undefined) {
        this.staleHits += 1;
        return { value: stale, fresh: false, stale: true, error: result.error };
      }
    }
    throw new Error(result.error || 'fetch_failed');
  }

  stats() {
    return {
      name: this.name,
      entries: this.store.size,
      hits: this.hits,
      misses: this.misses,
      staleHits: this.staleHits,
      errors: this.errors,
      inflight: this.inflight.size,
    };
  }
}

module.exports = { TTLCache, NotFoundForCache };
