'use strict';

/**
 * match.js — "¿es de verdad la misma obra?" 
 *
 * Cuando un buscador de terceros (IMDb/RT/Metacritic) devuelve resultados hay
 * que validarlos: un addon de notas que se equivoca de película es peor que un
 * addon que no dice nada. Aquí está esa comprobación, usada por todos los
 * providers y por los tests.
 */

const { titleSimilarity, foldText } = require('./util');

/**
 * Similitud 0-1 entre un título de búsqueda y uno de resultado, entendiendo que
 * "Shawshank" sí coincide con "The Shawshank Redemption" (contención).
 */
function bestTitleSimilarity(candidateTitle, wantedTitles) {
  const { titleSimilarity, foldText: fold } = require('./util');
  let similarity = 0;
  const candidateFolded = fold(candidateTitle || '');
  for (const target of (wantedTitles || []).filter(Boolean)) {
    similarity = Math.max(similarity, titleSimilarity(candidateTitle, target));
    const folded = fold(target);
    if (candidateFolded && folded) {
      const short = candidateFolded.length <= folded.length ? candidateFolded : folded;
      const long = candidateFolded.length <= folded.length ? folded : candidateFolded;
      if (short.length >= 3 && long.includes(short)) similarity = Math.max(similarity, 0.85);
    }
  }
  return similarity;
}

/** 'the_shawshank_redemption' -> 'the shawshank redemption' */
function slugToWords(slug) {
  return foldText(String(slug || '').replace(/[_\-]+/g, ' '));
}

/**
 * @param {{title?:string,year?:number|null,rtSlug?:string,mcSlug?:string,imdbId?:string}} candidate
 * @param {{title?:string,originalTitle?:string,year?:number|null,ids?:object}} work
 * @param {{min?:number,strict?:boolean}} [options]
 */
function looksLikeSameWork(candidate, work, options = {}) {
  const min = options.min === undefined ? (options.strict ? 0.55 : 0.45) : options.min;
  if (!candidate || !work) return false;
  const wanted = [work.title, work.originalTitle].filter(Boolean);
  if (!wanted.length) {
    // sin título de referencia no podemos validar nada: mejor rechazar (un
    // buscador siempre devuelve "algo", y dar la nota de otra peli es peor)
    return Boolean(options.allowMissingWanted);
  }
  const candidateTitle = candidate.title || candidate.name || slugToWords(candidate.rtSlug || candidate.mcSlug || '');
  if (!candidateTitle) return true;
  const similarity = bestTitleSimilarity(candidateTitle, wanted);
  const candidateYear = Number(candidate.year) || null;
  const wantedYear = Number(work.year) || null;
  if (candidateYear && wantedYear && Math.abs(candidateYear - wantedYear) > 1) {
    // mismo título y año distinto = otra obra (remakes/TV movies), salvo que el
    // llamador diga lo contrario (p. ej. listas top donde el año no es fiable)
    return Boolean(options.allowYearMismatch);
  }
  if (candidateYear && wantedYear) return similarity >= min - 0.1;
  return similarity >= min;
}

/** Filtra + ordena candidatos de búsqueda por parecido. */
function filterCandidates(candidates, work, options = {}) {
  const { titleSimilarity: sim } = require('./util');
  return (candidates || [])
    .filter((candidate) => looksLikeSameWork(candidate, work, options))
    .map((candidate) => {
      let score = Math.max(sim(candidate.title, work.title), sim(candidate.title, work.originalTitle || ''));
      if (work.year && candidate.year) score += Number(candidate.year) === Number(work.year) ? 0.4 : options.allowYearMismatch ? -0.1 : -0.5;
      if (candidate.score) score += 0.05;
      return { candidate, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.candidate);
}

module.exports = { looksLikeSameWork, filterCandidates, slugToWords, bestTitleSimilarity };
