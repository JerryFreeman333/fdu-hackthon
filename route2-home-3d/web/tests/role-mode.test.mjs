import test from 'node:test';
import assert from 'node:assert/strict';

const ROLE_RULES = {
  resident: ['home', 'find'],
  family: ['family-home', 'family-hazards', 'family-paths'],
};

test('resident role exposes only resident surfaces', () => {
  assert.deepEqual(ROLE_RULES.resident, ['home', 'find']);
  assert.equal(ROLE_RULES.resident.includes('family-hazards'), false);
  assert.equal(ROLE_RULES.resident.includes('family-paths'), false);
});

test('family role exposes only family surfaces', () => {
  assert.deepEqual(ROLE_RULES.family, ['family-home', 'family-hazards', 'family-paths']);
  assert.equal(ROLE_RULES.family.includes('find'), false);
});

test('role model keeps Home Twin as underlying shared capability', () => {
  assert.deepEqual(new Set(['resident', 'family']), new Set(Object.keys(ROLE_RULES)));
});
