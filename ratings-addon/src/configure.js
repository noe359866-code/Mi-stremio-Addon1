'use strict';

/**
 * configure.js — página de instalación (HTML+JS vanilla, sin CDNs).
 * Sirve para elegir fuentes, ver la URL del manifiesto, instalar en Stremio y
 * probar el scraper en vivo contra cualquier título.
 */

const { CATALOGS } = require('./catalog');
const { SOURCES, METRICS } = require('./defs');
const { escapeHtml } = require('./util');
const { VERSION } = require('./manifest');

const CSS = `
:root{--bg:#0b0e17;--card:#131828;--card2:#0f1421;--line:#232c44;--txt:#e9edf8;--dim:#96a0bd;--accent:#f5c518;--good:#22c55e;--bad:#ef4444;--tomato:#ff5c39;--mc:#00c6ff;--fa:#2b7de9}
*{box-sizing:border-box}
body{margin:0;background:radial-gradient(1200px 700px at 15% -10%,#1d2745 0,transparent 60%),var(--bg);color:var(--txt);font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
a{color:var(--accent);text-decoration:none}
.wrap{max-width:1180px;margin:0 auto;padding:22px 18px 60px}
header{display:flex;gap:16px;align-items:center;padding:14px 0 22px;flex-wrap:wrap}
header img{width:60px;height:60px;border-radius:14px;background:#0f1220}
h1{font-size:22px;margin:0;line-height:1.2}
.sub{color:var(--dim);font-size:13px}
.pill{display:inline-block;padding:2px 9px;border:1px solid var(--line);border-radius:999px;font-size:11.5px;color:var(--dim);margin-right:6px}
.grid{display:grid;grid-template-columns:minmax(300px,390px) 1fr;gap:16px}
@media (max-width:900px){.grid{grid-template-columns:1fr}}
.card{background:linear-gradient(180deg,var(--card),var(--card2));border:1px solid var(--line);border-radius:16px;padding:16px;margin-bottom:16px}
.card h2{font-size:14px;margin:0 0 12px;text-transform:uppercase;letter-spacing:.09em;color:var(--dim)}
label.row{display:flex;gap:10px;align-items:flex-start;padding:9px 10px;border:1px solid var(--line);border-radius:12px;margin-bottom:8px;cursor:pointer;background:#0e1320}
label.row:hover{border-color:#39456b}
label.row input{margin-top:3px;accent-color:var(--accent)}
.src-name{font-weight:650}
.src-desc{color:var(--dim);font-size:12px}
.field{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:7px 0;border-bottom:1px dashed #1e2740}
.field:last-child{border-bottom:0}
select,input[type=number],input[type=text]{background:#0b1020;color:var(--txt);border:1px solid var(--line);border-radius:9px;padding:7px 9px;font:inherit;min-width:120px}
input[type=text]{width:100%;min-width:0}
button{background:var(--accent);color:#161300;border:0;border-radius:11px;padding:11px 15px;font-weight:750;font-size:14px;cursor:pointer}
button.sec{background:#1b2338;color:var(--txt);border:1px solid var(--line);font-weight:600}
button.ghost{background:transparent;color:var(--dim);border:1px dashed var(--line)}
button:hover{filter:brightness(1.08)}
.row2{display:flex;gap:8px;flex-wrap:wrap}
code.url{display:block;background:#080b14;border:1px solid var(--line);border-radius:10px;padding:10px;font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;word-break:break-all;color:#b9f5c9}
table.scores{width:100%;border-collapse:collapse;margin-top:10px;font-size:14px}
table.scores td{padding:7px 6px;border-bottom:1px solid #1b2338;vertical-align:middle}
td.src{white-space:nowrap;font-weight:600}
td.val{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
td.val small{color:var(--dim)}
td.bar{width:36%}
td.bar i{display:block;height:8px;border-radius:99px;background:linear-gradient(90deg,var(--bad),var(--accent),var(--good))}
td.votes,td.link{color:var(--dim);font-size:12.5px;white-space:nowrap}
.combined{display:flex;align-items:baseline;gap:9px;background:#0b1020;border:1px solid var(--line);border-radius:12px;padding:11px 13px;margin-top:4px}
.combined .big{font-size:30px;font-weight:800}
.combined .of{color:var(--dim)}
.combined .stars{color:var(--accent);letter-spacing:2px}
.combined .verdict{margin-left:auto;color:var(--dim);font-size:13px;text-transform:capitalize}
.combined.empty{color:var(--dim);justify-content:center}
.item{display:flex;gap:12px;align-items:flex-start;padding:12px;border:1px solid var(--line);border-radius:13px;background:#0d1220;margin-bottom:9px}
.item .poster{width:54px;height:80px;object-fit:cover;border-radius:7px;background:#111}
.badge{display:inline-block;background:#0b0f1a;border:1px solid var(--line);border-radius:8px;padding:1px 7px;font-size:12.5px;color:var(--accent);font-weight:700}
.pre{background:#080b14;border:1px solid var(--line);border-radius:11px;padding:11px;white-space:pre-wrap;font:12.5px/1.6 ui-monospace,Menlo,Consolas,monospace;color:#cbd6f5;max-height:330px;overflow:auto}
.status{font-size:12px;color:var(--dim)}
.status b{color:var(--txt)}
.ok{color:var(--good)}.ko{color:var(--bad)}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
.chip{border:1px solid var(--line);background:#0d1220;border-radius:999px;padding:5px 10px;font-size:12.5px;cursor:pointer;color:var(--dim)}
.chip:hover{color:var(--txt);border-color:#3b4770}
.notice{border-left:3px solid var(--accent);background:#0d1220;padding:10px 12px;border-radius:0 10px 10px 0;color:var(--dim);font-size:13px}
h3{font-size:15px;margin:2px 0 8px}
.small{font-size:12px;color:var(--dim)}
.right{margin-left:auto}
.stale{background:#2a2200;border:1px solid #594900;color:#f8e08a;padding:8px 11px;border-radius:10px;font-size:12.5px}
`;

const CLIENT_JS = `
var BASE = window.__BASE__ || '';
function $(sel){ return document.querySelector(sel); }
function $all(sel){ return Array.prototype.slice.call(document.querySelectorAll(sel)); }
function esc(s){ return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
function b64url(str){ return btoa(unescape(encodeURIComponent(str))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,''); }
function cfgFromForm(){
  var sources = $all('input[data-src]:checked').map(function(i){ return i.dataset.src; });
  return {
    sources: sources,
    badge: $('#badge').value,
    panel: $('#panel').checked,
    unavailable: $('#unavailable').checked,
    links: $('#links').checked,
    minScore: Number($('#minScore').value || 0),
    ttl: Number($('#ttl').value || 24),
    lang: $('#lang').value
  };
}
function token(){ return b64url(JSON.stringify(cfgFromForm())); }
function manifestUrl(){ return location.origin + '/c/' + token() + '/manifest.json'; }
function refresh(){
  var url = manifestUrl();
  $('#murl').textContent = url;
  $('#cfgcode').textContent = JSON.stringify(cfgFromForm());
  var list = $('#catlist');
  list.innerHTML = window.__CATALOGS__.map(function(cat){
    return '<span class="chip" data-type="'+cat.type+'" data-id="'+cat.id+'">'+esc(cat.name)+'</span>';
  }).join('');
  $all('#catlist .chip').forEach(function(chip){
    chip.onclick = function(){ loadCatalog(chip.dataset.type, chip.dataset.id); };
  });
}
// bare('https://host/path') -> 'host/path' (sin regex: evita líos de escapes en la plantilla)
function bare(u){ var i = String(u).indexOf('//'); return i >= 0 ? String(u).slice(i + 2) : String(u); }
// Igual que addAddonToStremio() del SDK: postMessage al servicio de Stremio con el manifiesto.
function installToStremio(){
  var url = manifestUrl();
  var service = location.protocol === 'https:' ? 'https://www.stremio.com/service' : 'http://127.0.0.1:11470/service';
  $('#install-status').textContent = 'Enviando a Stremio\u2026';
  fetch(url).then(function(r){ return r.json(); }).then(function(manifest){
    try {
      window.postMessage({ type: 'add-addon', transportUrl: url, manifest: manifest }, service);
      $('#install-status').innerHTML = 'Enviado a Stremio. Si no aparece en Addons, usa <a href="stremio://' + bare(url) + '">este enlace</a> o copia la URL.';
    } catch (e) {
      $('#install-status').innerHTML = 'Stremio no responde en ' + service + ' (\u00bfno est\u00e1 abierto?). <a href="stremio://' + bare(url) + '">Abrir stremio://</a>';
    }
  }).catch(function(){ location.href = 'stremio://' + bare(url); });
}
function copyUrl(){
  var url = manifestUrl();
  if (navigator.clipboard) navigator.clipboard.writeText(url).then(function(){ $('#install-status').textContent = 'URL copiada al portapapeles.'; });
}
function renderScores(data){
  var rows = Object.keys(data.scores || {}).map(function(key){
    var m = data.scores[key];
    var meta = (window.__METRICS__[key]) || { label: key, emoji: '•', scale: m.scale };
    var pct = Math.max(2, Math.min(100, (m.value / m.scale) * 100));
    return '<tr><td class="src"><span>'+esc(meta.emoji)+'</span> '+esc(meta.label)+'</td>'+
      '<td class="val">'+m.value.toFixed(1)+'<small>'+(m.scale===100?'/100':'/10')+'</small></td>'+
      '<td class="bar"><i style="width:'+pct+'%"></i></td>'+
      '<td class="votes">'+(m.votes? esc(fmtVotes(m.votes))+' votos' : '—')+'</td>'+
      '<td class="link">'+(m.url? '<a href="'+esc(m.url)+'" target="_blank" rel="noopener">abrir</a>' : '—')+'</td></tr>';
  }).join('');
  var comb = data.combined;
  var combined = comb ? '<div class="combined"><span class="big">'+comb.value.toFixed(1)+'</span><span class="of">/10</span><span class="stars">'+stars(comb.value)+'</span><span class="verdict">'+esc(comb.verdict||'')+'</span></div>'
    : '<div class="combined empty">Sin puntuaciones combinables</div>';
  var sources = (data.sources||[]).map(function(s){
    return '<span class="pill '+(s.ok?'ok':'ko')+'">'+esc(s.source)+' '+(s.ok?'✓':'✕ ')+ (s.ok? (s.ms+'ms') : esc(s.error||'')) +'</span>';
  }).join(' ');
  return combined + '<table class="scores">'+ (rows || '<tr><td>Ninguna fuente devolvió datos</td></tr>') +'</table>' +
    '<div class="chips">'+sources+'</div>';
}
function stars(v){ var n = Math.max(0, Math.min(5, Math.round(v/2))); return '★★★★★'.slice(0,n) + '☆☆☆☆☆'.slice(0, 5-n); }
function fmtVotes(n){ if(n>=1e6) return (n/1e6).toFixed(1).replace('.',',')+' M'; if(n>=1000) return Math.round(n/1000)+' k'; return String(n); }
async function loadCatalog(type, id){
  $('#cat-out').innerHTML = '<div class="status">Cargando <b>'+esc(type+'/'+id)+'</b> desde '+esc(origin())+'…</div>';
  try {
    var res = await fetch(origin() + '/api/chart?type=' + encodeURIComponent(type) + '&id=' + encodeURIComponent(id) + '&limit=12&cfg=' + token());
    var data = await res.json();
    if (data.error) { $('#cat-out').innerHTML = '<div class="stale">'+esc(data.error)+'</div>'; return; }
    var metas = data.metas || [];
    if (!metas.length) { $('#cat-out').innerHTML = '<div class="stale">Lista vacía (fuente bloqueada o sin datos). Prueba otra o activa el modo demo.</div>'; return; }
    $('#cat-out').innerHTML = metas.map(function(m){
      return '<div class="item">'+ (m.poster? '<img class="poster" src="'+esc(m.poster)+'" alt=""/>' : '<div class="poster"></div>') +
        '<div><b>'+esc(m.name)+'</b> '+(m.imdbRating?'<span class="badge">⭐ '+esc(m.imdbRating)+'</span>':'')+
        '<div class="pre" style="margin-top:7px;max-height:120px">'+esc(m.description||'')+'</div></div></div>';
    }).join('') + '<div class="status">URL Stremio: <code>'+esc('/catalog/'+type+'/'+id+'.json')+'</code> · '+esc(JSON.stringify(data.diagnostics||{}))+'</div>';
  } catch (e) { $('#cat-out').innerHTML = '<div class="stale">Error: '+esc(e.message)+'</div>'; }
}
function origin(){ return location.origin; }
async function searchRatings(){
  var title = $('#q').value.trim();
  if (!title) return;
  var url = origin() + '/api/ratings?title=' + encodeURIComponent(title) + '&type=' + encodeURIComponent($('#stype').value) + '&cfg=' + token();
  $('#out').innerHTML = '<div class="status">Buscando en '+esc($all('input[data-src]:checked').map(function(i){return i.dataset.src;}).join(', '))+'…</div>';
  try {
    var res = await fetch(url);
    var data = await res.json();
    if (data.error) { $('#out').innerHTML = '<div class="stale">'+esc(data.error)+'<div class="small">'+esc(data.hint||'')+'</div></div>'; return; }
    var q = data.query || {};
    $('#out').innerHTML = '<h3>'+esc(q.title||title)+' '+(q.year?'('+q.year+')':'')+' <span class="pill">'+esc(q.type||'')+'</span></h3>'+
      '<div class="small">resuelta por '+esc((q.resolvedVia||[]).join('+')||'input')+' · '+esc(data.ms)+' ms'+(data.stale?' · <b class="stale">dato en caché</b>':'')+'</div>'+
      renderScores(data)+
      '<h3 style="margin-top:14px">Así lo ve Stremio</h3><div class="pre">'+esc('id: '+(data.stremio&&data.stremio.id)+'\\nbadge ⭐: '+(data.stremio&&data.stremio.imdbRating)+'\\n\\n'+(data.stremio&&data.stremio.description))+'</div>';
  } catch (e) { $('#out').innerHTML = '<div class="stale">Fallo de red: '+esc(e.message)+'</div>'; }
}
async function health(){
  try {
    var res = await fetch(origin() + '/api/health');
    var data = await res.json();
    var keys = data.keys || {};
    $('#health').innerHTML = '<b>'+esc(data.mock?'MODO DEMO (datos simulados)':'online')+'</b> · v'+esc(data.version)+
      ' · TMDB '+(keys.tmdb?'<span class="ok">key ok</span>':'<span class="ko">sin key</span>')+
      ' · OMDb '+(keys.omdb?'<span class="ok">key ok</span>':'<span class="ko">sin key</span>')+
      ' · peticiones '+data.requests+' · cache ratings '+data.caches.ratings.entries+' ítems';
  } catch (e) { $('#health').innerHTML = '<span class="ko">servicio no responde</span>'; }
}
document.addEventListener('DOMContentLoaded', function(){
  $all('input[data-src]').forEach(function(i){ i.onchange = refresh; });
  ['#badge','#panel','#unavailable','#links','#minScore','#ttl','#lang'].forEach(function(sel){ var el=$(sel); if(el) el.onchange = refresh; });
  $('#install').onclick = function(e){ e.preventDefault(); installToStremio(); };
  $('#manual').onclick = function(){ this.href = 'stremio://' + bare(manifestUrl()); };
  $('#copy').onclick = copyUrl;
  $('#go').onclick = searchRatings;
  $('#q').addEventListener('keydown', function(e){ if (e.key === 'Enter') searchRatings(); });
  $all('.preset').forEach(function(b){ b.onclick = function(){ $('#q').value = b.dataset.title; $('#stype').value = b.dataset.type || 'movie'; searchRatings(); }; });
  refresh(); health();
  if (window.__CATALOGS__.length) loadCatalog(window.__CATALOGS__[0].type, window.__CATALOGS__[0].id);
});
`;

function sourceRows(cfg) {
  return Object.keys(SOURCES)
    .map((id) => {
      const source = SOURCES[id];
      const checked = cfg.sources.includes(id) ? 'checked' : '';
      return `<label class="row"><input type="checkbox" data-src="${id}" ${checked} />
        <span><span class="src-name">${source.emoji || ''} ${escapeHtml(source.label)}</span>
        <div class="src-desc">${escapeHtml(source.docs || '')}</div></span></label>`;
    })
    .join('');
}

function configureHtml({ cfg, origin, basePath = '' }) {
  const metricOptions = ['combined', ...Object.keys(METRICS)]
    .map((key) => {
      const label = key === 'combined' ? 'Combinada (media ponderada)' : `${METRICS[key].emoji} ${METRICS[key].label}`;
      return `<option value="${key}" ${cfg.badgeMetric === key ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    })
    .join('');

  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(cfg.addonName)} · Stremio</title>
<meta name="description" content="Addon de Stremio solo con puntuaciones: IMDb, Rotten Tomatoes, Metacritic, FilmAffinity, TMDB y, para anime, AniList y MyAnimeList." />
<link rel="icon" href="${basePath}/logo.svg" />
<style>${CSS}</style>
</head><body>
<div class="wrap">
  <header>
    <img src="${basePath}/logo.svg" alt="logo" />
    <div>
      <h1>${escapeHtml(cfg.addonName)}</h1>
      <div class="sub">v${VERSION} · solo puntuaciones, cero streams · ${escapeHtml(cfg.addonDescription)}</div>
      <div class="chips">
        <span class="pill">IMDb</span><span class="pill">Rotten Tomatoes</span><span class="pill">Metacritic</span><span class="pill">🌸 AniList</span><span class="pill">🎌 MyAnimeList</span>
        <span class="pill">FilmAffinity</span><span class="pill">TMDB</span><span class="pill">anime</span>
      </div>
    </div>
    <div class="right status" id="health">comprobando…</div>
  </header>

  ${cfg.mock ? '<div class="stale" style="margin-bottom:14px">Estás en <b>modo demo</b> (RATINGS_MOCK=1): se sirve HTML simulado con el markup real de cada web, para probar el addon sin red. Quítalo para scrapear de verdad.</div>' : ''}

  <div class="grid">
    <div>
      <section class="card">
        <h2>1 · Fuentes a scrapear</h2>
        ${sourceRows(cfg)}
        <div class="field"><span class="small">Badge ⭐ de Stremio</span><select id="badge">${metricOptions}</select></div>
        <div class="field"><span class="small">Desglose en la ficha</span><input type="checkbox" id="panel" ${cfg.showPanel ? 'checked' : ''} /></div>
        <div class="field"><span class="small">Marcar fuentes sin datos</span><input type="checkbox" id="unavailable" ${cfg.showUnavailable ? 'checked' : ''} /></div>
        <div class="field"><span class="small">Enlaces a cada ficha</span><input type="checkbox" id="links" ${cfg.showLinks ? 'checked' : ''} /></div>
        <div class="field"><span class="small">Nota mínima en catálogos</span><input type="number" id="minScore" min="0" max="10" step="0.5" value="${cfg.minScore}" /></div>
        <div class="field"><span class="small">Cache (horas)</span><input type="number" id="ttl" min="1" max="336" value="${cfg.cacheTtlHours}" /></div>
        <div class="field"><span class="small">Idioma TMDB</span><select id="lang">
          <option value="es-ES" ${cfg.language === 'es-ES' ? 'selected' : ''}>es-ES</option>
          <option value="es-MX" ${cfg.language === 'es-MX' ? 'selected' : ''}>es-MX</option>
          <option value="en-US" ${cfg.language === 'en-US' ? 'selected' : ''}>en-US</option>
        </select></div>
      </section>

      <section class="card">
        <h2>2 · Instalar en Stremio</h2>
        <div class="row2"><button id="install">➕ Instalar addon</button><button id="copy" class="sec">Copiar URL</button>
        <a class="sec" id="manual" href="#" style="padding:11px 12px;border:1px solid var(--line);border-radius:11px;font-size:14px">stremio://</a></div>
        <p class="small" id="install-status" style="margin:9px 0"></p>
        <div class="small" style="margin:6px 0 4px">URL del manifiesto (pégala en Stremio si el botón no hace nada):</div>
        <code class="url" id="murl">…</code>
        <div class="small" style="margin-top:8px">Config enviada: <code id="cfgcode" class="small"></code></div>
      </section>

      <section class="card">
        <h2>3 · Probador de puntuaciones</h2>
        <input type="text" id="q" placeholder="Origen, Breaking Bad, Jujutsu Kaisen…" />
        <div class="row2" style="margin-top:9px">
          <select id="stype"><option value="movie">película</option><option value="series">serie</option><option value="anime">anime</option></select>
          <button id="go">Buscar</button>
        </div>
        <div class="chips" style="margin-top:8px">
          <span class="preset chip" data-title="Inception">Inception</span>
          <span class="preset chip" data-title="Parasite">Parasite</span>
          <span class="preset chip" data-title="Breaking Bad" data-type="series">Breaking Bad</span>
          <span class="preset chip" data-title="Jujutsu Kaisen" data-type="anime">Jujutsu Kaisen</span>
          <span class="preset chip" data-title="Your Name." data-type="anime">Your Name.</span>
        </div>
        <div class="small" style="margin-top:8px">Atajo: <code>/api/ratings?title=…</code> devuelve JSON puro.</div>
      </section>
    </div>

    <div>
      <section class="card">
        <h2>Resultado</h2>
        <div id="out"><div class="notice">Elige una fuente arriba y dale a <b>Buscar</b>. Cada fuente muestra su estado (✓ ok / ✕ caída) para que sepas si IMDb te está bloqueando o si simplemente no hay datos.</div></div>
      </section>
      <section class="card">
        <h2>Catálogos (Discover de Stremio)</h2>
        <div class="small">Pulsa una lista para verla tal cual la recibiría Stremio:</div>
        <div id="catlist" class="chips" style="margin:8px 0 12px"></div>
        <div id="cat-out"><div class="status">…</div></div>
      </section>
      <section class="card">
        <h2>Notas legales y de uso</h2>
        <div class="small">
          <p>· IMDb, Rotten Tomatoes, Metacritic y FilmAffinity <b>no tienen API pública</b>: esto es scraping directo con caché (TTL), límite por dominio y degradación elegante. AniList usa su API GraphQL (sin key) y MyAnimeList su API oficial si pones <code>MAL_CLIENT_ID</code> o, si no, Jikan. Respeta sus términos de uso: uso personal, pocas peticiones, nada de reempaquetar sus datos.</p>
          <p>· Esos muros anti-bot suelen bloquear IPs de VPS/datacenter (Railway, Render, Netlify…). Si ves todo ✕, despliega en tu casa (Docker en un NAS/PC) o añade <code>OMDB_API_KEY</code> como respaldo.</p>
          <p>· TMDB sí es API oficial: pon tu <code>TMDB_API_KEY</code> (la del repo es la heredada del proyecto anterior, cámbiala).</p>
        </div>
      </section>
    </div>
  </div>
</div>
<script>
window.__BASE__ = ${JSON.stringify(basePath || '')};
window.__CATALOGS__ = ${JSON.stringify(CATALOGS.filter((catalog) => cfg.sources.includes(catalog.provider) || cfg.sources.length === Object.keys(SOURCES).length).map(({ type, id, name }) => ({ type, id, name })))};
window.__METRICS__ = ${JSON.stringify(
    Object.fromEntries(Object.entries(METRICS).map(([key, def]) => [key, { label: def.label, emoji: def.emoji, scale: def.scale }]))
  )};
${CLIENT_JS}
</script>
</body></html>`;
}

function indexHtml({ cfg, origin, basePath }) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(cfg.addonName)}</title>
<meta http-equiv="refresh" content="0; url=${basePath || ''}/configure.html"></head>
<body><p>Redirigiendo a la página de configuración… si no va, <a href="${basePath || ''}/configure.html">abre /configure.html</a>.</p>
<p>Manifiesto: <a href="${basePath || ''}/manifest.json">${basePath || ''}/manifest.json</a></p></body></html>`;
}

module.exports = { configureHtml, indexHtml, CSS, CLIENT_JS };
