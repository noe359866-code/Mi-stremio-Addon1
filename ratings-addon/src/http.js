'use strict';

/**
 * http.js — cliente HTTP mínimo (sobre `fetch` de Node 18+) pensado para
 * scrapear webs: user-agent de navegador, timeout duro, reintentos con
 * backoff, detección de bloqueo anti-bot y tamaño máximo de descarga.
 *
 * Nunca lanza excepciones por errores de red: devuelve { ok:false, error }
 * para que el addon pueda degradar con elegancia (fuente "no disponible").
 */

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
];

const BROWSER_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en-US;q=0.7,en;q=0.6',
  'Cache-Control': 'no-cache',
  'Upgrade-Insecure-Requests': '1',
  'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function pickUserAgent(seed) {
  const index = Math.abs(Number(seed) || Math.floor(Math.random() * 1e9)) % USER_AGENTS.length;
  return USER_AGENTS[index];
}

function buildUrl(url, query) {
  if (!query || !Object.keys(query).length) return url;
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === '') continue;
    parsed.searchParams.set(key, String(value));
  }
  return parsed.toString();
}

/**
 * @param {string} url
 * @param {{timeout?:number,retries?:number,headers?:object,query?:object,
 *          maxBytes?:number,method?:string,data?:string,raw?:boolean}} [options]
 * @param {{log?:Function, cache?:object, politeness?:object}} [ctx]
 * @returns {Promise<{ok:boolean,status?:number,body?:string,json?:any,error?:string,blocked?:boolean,ms:number}>}
 */
async function request(url, options = {}, ctx = {}) {
  const timeout = options.timeout || 9000;
  const retries = options.retries === undefined ? 1 : options.retries;
  const maxBytes = options.maxBytes || 2 * 1024 * 1024;
  const started = Date.now();

  if (ctx.politeness) await ctx.politeness.wait(url);

  let lastError = 'network_error';
  let lastStatus = 0;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(400 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 300));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('timeout')), timeout);
    try {
      const response = await fetch(buildUrl(url, options.query), {
        method: options.method || 'GET',
        redirect: 'follow',
        signal: controller.signal,
        compress: true,
        headers: {
          ...BROWSER_HEADERS,
          'User-Agent': options.userAgent || pickUserAgent(ctx.uaSeed),
          ...(ctx.headers || {}),
          ...(options.headers || {}),
        },
        body: options.data,
      });
      lastStatus = response.status;
      if (!response.ok) {
        lastError = response.status === 404 ? 'not_found' : `http_${response.status}`;
        if (isBlockedStatus(response.status)) {
          return { ok: false, status: response.status, blocked: true, error: lastError, ms: Date.now() - started, url };
        }
        if (response.status >= 500 && attempt < retries) continue;
        return { ok: false, status: response.status, error: lastError, ms: Date.now() - started, url };
      }

      const contentType = response.headers.get('content-type') || '';
      if (options.expectJson && !/json/i.test(contentType) && !/javascript/i.test(contentType)) {
        // nos devolvieron un HTML (típico wall anti-bot): lo tratamos como bloqueo
        const text = await readLimitedText(response, maxBytes);
        if (looksLikeBotWall(text)) {
          return { ok: false, status: response.status, blocked: true, error: 'bot_wall', ms: Date.now() - started, url };
        }
      }

      if (options.raw) {
        const buffer = Buffer.from(await response.arrayBuffer());
        return { ok: true, status: response.status, body: buffer, contentType, ms: Date.now() - started, url };
      }

      const text = await readLimitedText(response, maxBytes);
      if (looksLikeBotWall(text)) {
        lastError = 'bot_wall';
        if (attempt < retries) continue;
        return { ok: false, status: response.status, blocked: true, error: 'bot_wall', ms: Date.now() - started, url, body: text.slice(0, 2000) };
      }

      if (ctx.log) ctx.log(`GET ${response.status} ${truncate(url, 120)} (${Date.now() - started}ms)`);
      const out = { ok: true, status: response.status, body: text, ms: Date.now() - started, url };
      if (/json/i.test(contentType) || options.parseJson) {
        try {
          out.json = JSON.parse(text);
        } catch {
          out.json = null;
        }
      }
      return out;
    } catch (error) {
      lastError = error && error.name === 'AbortError' ? 'timeout' : String((error && error.message) || error).slice(0, 120);
      if (ctx.log) ctx.log(`GET fail ${lastError} ${truncate(url, 110)}`);
      if (attempt >= retries) break;
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, status: lastStatus || undefined, error: lastError, ms: Date.now() - started, url };
}

async function getJson(url, options = {}, ctx = {}) {
  const res = await request(url, { ...options, headers: { Accept: 'application/json, text/javascript, */*;q=0.8', ...(options.headers || {}) }, parseJson: true, expectJson: true }, ctx);
  if (!res.ok) return res;
  if (res.json === null || res.json === undefined) {
    try {
      res.json = JSON.parse(res.body);
    } catch {
      return { ok: false, status: res.status, error: 'bad_json', url, ms: res.ms };
    }
  }
  return res;
}

function isBlockedStatus(status) {
  return status === 403 || status === 401 || status === 429 || status === 503 || status === 999;
}

const BOT_WALL_MARKERS = [
  'Access to this page has been denied',
  'Please enable JS and disable any ad blocker',
  'px-captcha',
  'datadome',
  'CaptchaInterstitial',
  'Request blocked',
  'Blocked Request',
  'askcaptcha',
  'cf-browser-verification',
  'Just a moment...',
  'perimeterx',
];

function looksLikeBotWall(text) {
  if (!text || text.length > 400000) return false;
  // solo miramos la cabecera del documento, es donde está el muro
  const head = text.slice(0, 6000);
  if (!/<title|<!doctype|access denied|captcha/i.test(head)) return false;
  if (text.length > 100000) return false; // una página real grande no es un muro
  return BOT_WALL_MARKERS.some((marker) => head.toLowerCase().includes(marker.toLowerCase()));
}

async function readLimitedText(response, maxBytes) {
  if (!response.body) return (await response.text()).slice(0, maxBytes);
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let received = 0;
  let text = '';
  while (received < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value ? value.length : 0;
    text += decoder.decode(value, { stream: true });
  }
  try {
    await reader.cancel();
  } catch {
    /* da igual */
  }
  return text.slice(0, maxBytes);
}

function truncate(text, max) {
  return text && text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Rate-limit por dominio: evita martillear IMDb/Metacritic y reduce bloqueos.
 */
class DomainThrottle {
  constructor({ perHostMs = 700, jitter = 250 } = {}) {
    this.perHostMs = perHostMs;
    this.jitter = jitter;
    this.last = new Map();
    this.queues = new Map();
  }

  wait(url) {
    let host = 'unknown';
    try {
      host = new URL(url).host;
    } catch {
      /* url ya resuelta */
    }
    const now = Date.now();
    const lastAt = this.last.get(host) || 0;
    const minGap = this.perHostMs + Math.floor(Math.random() * this.jitter);
    const waitMs = Math.max(0, lastAt + minGap - now);

    const task = (async () => {
      const previous = this.queues.get(host) || Promise.resolve();
      await previous.catch(() => {});
      if (waitMs > 0) await sleep(waitMs);
      this.last.set(host, Date.now());
    })();
    this.queues.set(host, task);
    return task;
  }
}

module.exports = { request, getJson, DomainThrottle, USER_AGENTS, looksLikeBotWall, sleep };
