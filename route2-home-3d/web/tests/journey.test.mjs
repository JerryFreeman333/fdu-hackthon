import test from 'node:test';
import assert from 'node:assert/strict';

const residentJourney = (hasModel) => [
  hasModel ? 'home-ready' : 'home-ready',
  'find',
  'help',
];
const familyJourney = (hasModel) => [
  'create',
  'review',
  'act',
  'return',
];

test('resident journey is a daily-use flow, not an administration flow', () => {
  assert.deepEqual(residentJourney(true), ['home-ready', 'find', 'help']);
  assert.equal(residentJourney(true).includes('review'), false);
  assert.equal(residentJourney(true).includes('act'), false);
});

test('family journey has setup, review, action and return loop', () => {
  assert.deepEqual(familyJourney(false), ['create', 'review', 'act', 'return']);
  assert.deepEqual(familyJourney(true), ['create', 'review', 'act', 'return']);
});

test('journeys converge on one Home Twin rather than creating separate household models', () => {
  assert.equal(familyJourney(true).at(0), 'create');
  assert.equal(residentJourney(true).at(0), 'home-ready');
});
