import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldCommitElderTurn } from '../src/engine/elderTurnGuard';

describe('elder chat turn ordering', () => {
  it('commits N+2 while rejecting a delayed N+1 response', async () => {
    let latestTurnId = 0;
    const committed: string[] = [];

    const send = async (turnId: number, label: string, delayMs: number) => {
      latestTurnId = Math.max(latestTurnId, turnId);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (!shouldCommitElderTurn(turnId, latestTurnId)) return;
      committed.push(label);
    };

    const nPlus1 = send(1, 'N+1', 40);
    const nPlus2 = send(2, 'N+2', 5);
    await Promise.all([nPlus1, nPlus2]);

    assert.deepEqual(committed, ['N+2']);
  });

  it('keeps an already latest turn committable', () => {
    assert.equal(shouldCommitElderTurn(7, 7), true);
    assert.equal(shouldCommitElderTurn(6, 7), false);
  });
});
