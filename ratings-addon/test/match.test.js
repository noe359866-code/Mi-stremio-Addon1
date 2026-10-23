'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { looksLikeSameWork, filterCandidates, bestTitleSimilarity } = require('../src/match');

test('bestTitleSimilarity entiende títulos parciales y acentos', () => {
  assert.ok(bestTitleSimilarity('The Shawshank Redemption', ['Shawshank']) >= 0.85);
  assert.ok(bestTitleSimilarity('Origen', ['Inception', 'Origen']) === 1);
  assert.equal(bestTitleSimilarity('El padrino', ['The Godfather']), 0);
});

test('looksLikeSameWork acepta equivalentes en otro idioma vía slugs', () => {
  assert.equal(looksLikeSameWork({ rtSlug: 'el_labrin_d_del_fauno' }, { title: 'El laberinto del fauno' }), true);
  assert.equal(looksLikeSameWork({ title: 'Pan’s Labyrinth', year: 2006 }, { title: 'El laberinto del fauno', year: 2006 }), false);
});

test('looksLikeSameWork rechaza la misma saga de otro año', () => {
  const work = { title: 'Spider-Man: No Way Home', year: 2021 };
  assert.equal(looksLikeSameWork({ title: 'Spider-Man: No Way Home', year: 2021 }, work), true);
  assert.equal(looksLikeSameWork({ title: 'Spider-Man: Far From Home', year: 2019 }, work), false);
  assert.equal(looksLikeSameWork({ title: 'Spider-Man: No Way Home', year: 1977 }, work), false, 'título idéntico pero de otra época');
});

test('looksLikeSameWork rechaza si no hay título de referencia (y sólo cede si se le pide)', () => {
  // sin con qué comparar, un buscador siempre devuelve "algo": hay que decir no
  assert.equal(looksLikeSameWork({ title: 'Cualquiera' }, {}), false);
  assert.equal(looksLikeSameWork({ title: 'Cualquiera' }, {}, { allowMissingWanted: true }), true);
  assert.equal(looksLikeSameWork(null, { title: 'Cualquiera' }), false);
  assert.equal(looksLikeSameWork({ rtSlug: 'x' }, { title: 'X' }), true);
});

test('filterCandidates deja sólo los que se parecen y los ordena por año', () => {
  const work = { title: 'Ghost', year: 1990 };
  const candidates = [
    { title: 'Ghost in the Shell', year: 1995 },
    { title: 'Ghost', year: 1990 },
    { title: 'Ghost', year: 2006 },
    { title: 'Totalmente distinto', year: 1990 },
  ];
  const filtered = filterCandidates(candidates, work);
  assert.equal(filtered.length, 1, `sólo la de 1990: ${JSON.stringify(filtered)}`);
  // con allowYearMismatch sí se dejan pasar las homónimas de otros años (para listas top)
  const lenient = filterCandidates(candidates, work, { allowYearMismatch: true });
  assert.ok(lenient.length >= 2);
  assert.equal(lenient[0].year, 1990, 'el del año pedido va primero');
});
