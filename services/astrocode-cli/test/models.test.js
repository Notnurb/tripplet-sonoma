import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MODELS, getModel, resolveModel, modelIds, modelNames, describeModel,
  commitAuthor, DEFAULT_MODEL_ID,
} from '../src/core/models.js';
import {
  EFFORTS, getEffort, resolveEffort, cycleEffort, effortIds, DEFAULT_EFFORT,
} from '../src/core/effort.js';

test('the four advertised models exist', () => {
  assert.deepEqual(modelNames(), ['Astro 5 Code', 'Taipei 4', 'Majuli 4', 'Suzhou 4']);
  assert.deepEqual(modelIds(), ['astro-5-code', 'taipei-4', 'majuli-4', 'suzhou-4']);
  assert.ok(getModel(DEFAULT_MODEL_ID));
});

test('every model carries the metadata the UI depends on', () => {
  for (const m of MODELS) {
    assert.ok(m.id && m.name && m.short && m.family, `${m.id} identity`);
    assert.ok(m.context > 0, `${m.id} context`);
    assert.ok(m.pricing.input >= 0 && m.pricing.output >= 0, `${m.id} pricing`);
    assert.match(m.accent, /^#[0-9a-f]{6}$/i, `${m.id} accent`);
    assert.ok(getEffort(m.defaultEffort), `${m.id} default effort is real`);
    assert.ok(m.persona.cps > 0 && m.persona.latency.length === 2, `${m.id} persona`);
  }
});

test('models resolve by id, display name and alias', () => {
  assert.equal(getModel('astro-5-code').id, 'astro-5-code');
  assert.equal(getModel('Astro 5 Code').id, 'astro-5-code');
  assert.equal(getModel('astro').id, 'astro-5-code');
  assert.equal(getModel('t4').id, 'taipei-4');
  assert.equal(getModel('Taipei 4').id, 'taipei-4');
  assert.equal(getModel('suzhou').id, 'suzhou-4');
  assert.equal(getModel('MAJULI').id, 'majuli-4');
  assert.equal(getModel('nope'), undefined);
});

test('resolveModel is forgiving about near-misses', () => {
  assert.equal(resolveModel('taipei').model.id, 'taipei-4');
  assert.equal(resolveModel('majul').model.id, 'majuli-4');
  const miss = resolveModel('zzzz');
  assert.equal(miss.model, undefined);
  assert.ok(Array.isArray(miss.suggestions));
});

test('describeModel and commitAuthor read correctly', () => {
  assert.match(describeModel(getModel('astro-5-code')), /Astro 5 Code · 500K ctx/);
  assert.match(describeModel(getModel('majuli-4')), /1M ctx/);
  assert.equal(commitAuthor(getModel('taipei-4')), 'Taipei 4 - Tripplet');
  assert.equal(commitAuthor(getModel('astro-5-code')), 'Astro 5 Code - Tripplet');
});

test('effort levels resolve and cycle', () => {
  assert.deepEqual(effortIds(), ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.equal(getEffort(DEFAULT_EFFORT).id, 'medium');
  assert.equal(getEffort('hi').id, 'high');
  assert.equal(getEffort('ultra').id, 'max');
  assert.equal(getEffort('3').id, 'high');
  assert.equal(getEffort('bogus'), undefined);
  assert.equal(resolveEffort('x').effort.id, 'xhigh');

  assert.equal(cycleEffort('low', 1).id, 'medium');
  assert.equal(cycleEffort('max', 1).id, 'low');       // wraps
  assert.equal(cycleEffort('low', -1).id, 'max');
});

test('think budget rises monotonically with effort', () => {
  for (let i = 1; i < EFFORTS.length; i++) {
    assert.ok(EFFORTS[i].thinkBudget > EFFORTS[i - 1].thinkBudget,
      `${EFFORTS[i].id} > ${EFFORTS[i - 1].id}`);
  }
});
