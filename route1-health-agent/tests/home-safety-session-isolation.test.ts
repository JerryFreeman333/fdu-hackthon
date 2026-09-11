import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoHomeSafetyActions } from '../src/data/demoHomeSafetyActions';

test('home safety actions are treated as fresh session state', () => {
  const first = demoHomeSafetyActions.map((action) => ({ ...action, status: 'done' as const }));
  const second = demoHomeSafetyActions.map((action) => ({ ...action }));

  assert.equal(first[0]?.status, 'done');
  assert.equal(second[0]?.status, demoHomeSafetyActions[0]?.status);
  assert.notStrictEqual(first, second);
});

test('legacy home safety persistence key is not part of the app state contract', () => {
  const appStateKeys = ['events', 'familyEvents', 'chat', 'homeSafetyActions', 'role', 'familyView'];
  assert.ok(!appStateKeys.includes('ankang-route1-home-safety-actions-v1'));
});
