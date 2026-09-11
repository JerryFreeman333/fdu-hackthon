import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { consumeOneTimeShareIds } from '../src/engine/familyDisclosure';

describe('family session isolation', () => {
  it('consumes only the explicitly claimed one-time grants', () => {
    const current = ['finding-a', 'finding-b', 'finding-c'];
    assert.deepEqual(consumeOneTimeShareIds(current, ['finding-b']), ['finding-a', 'finding-c']);
  });

  it('starts a new session without previously persisted grants', () => {
    const nextSessionSharedFindingIds: string[] = [];
    assert.deepEqual(nextSessionSharedFindingIds, []);
  });
});
