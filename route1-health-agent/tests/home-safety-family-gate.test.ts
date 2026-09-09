import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

type FamilySharing = 'granted' | 'ask' | 'denied';

function visibleHomeSafetyActions<T>(actions: T[], familySharing: FamilySharing): T[] {
  return familySharing === 'granted' ? actions : [];
}

describe('family home safety authorization', () => {
  it('shows home safety actions only when family sharing is explicitly granted', () => {
    const actions = [{ id: 'home-1', title: '清理夜间通道' }];

    assert.deepEqual(visibleHomeSafetyActions(actions, 'granted'), actions);
    assert.deepEqual(visibleHomeSafetyActions(actions, 'ask'), []);
    assert.deepEqual(visibleHomeSafetyActions(actions, 'denied'), []);
  });

  it('revocation immediately removes previously visible home safety actions', () => {
    const actions = [{ id: 'home-1', title: '清理夜间通道' }];

    assert.equal(visibleHomeSafetyActions(actions, 'granted').length, 1);
    assert.equal(visibleHomeSafetyActions(actions, 'denied').length, 0);
  });
});
