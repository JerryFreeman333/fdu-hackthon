import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_SURFACES, surfacesForRole } from './role-mode.mjs';

test('resident role exposes only resident surfaces', () => {
  assert.deepEqual(surfacesForRole('resident'), ['home', 'find']);
  assert.equal(ROLE_SURFACES.resident.includes('family-hazards'), false);
  assert.equal(ROLE_SURFACES.resident.includes('family-paths'), false);
});

test('family role exposes only family surfaces', () => {
  assert.deepEqual(surfacesForRole('family'), ['family-home', 'family-hazards', 'family-paths']);
  assert.equal(ROLE_SURFACES.family.includes('find'), false);
});

test('unknown role is rejected', () => {
  assert.throws(() => surfacesForRole('unknown'), /unknown role/);
});
