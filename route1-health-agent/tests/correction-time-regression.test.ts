import test from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage } from '../src/types';
import { acceptedSelfClaims, understandElderInput } from '../src/engine/understanding';

const TODAY = '2026-09-10';

const priorYesterdayMessage: ChatMessage = {
  id: 'elder-previous-1',
  role: 'elder',
  text: '我昨天胸闷',
  time: '2026-09-10T10:00:00.000Z',
};

test('correction points to the immediately previous elder turn and keeps the replacement fact occurred', () => {
  const input = understandElderInput('刚才说错了，不是胸闷，是喘', TODAY, [priorYesterdayMessage]);

  assert.equal(input.correction, true);
  assert.equal(input.correctionTargetMessageId, priorYesterdayMessage.id);
  assert.deepEqual(input.correctionTargetTags, ['dyspnea']);
  assert.equal(acceptedSelfClaims(input).length, 1);
  assert.equal(acceptedSelfClaims(input)[0]?.status, 'occurred');
  assert.equal(acceptedSelfClaims(input)[0]?.tags.includes('dyspnea'), true);
});

test('an explicit historical correction keeps the replacement event on the stated historical date', () => {
  const input = understandElderInput('昨天不是胸闷，是喘', TODAY, [priorYesterdayMessage]);

  assert.equal(input.correction, false);
  assert.equal(input.claims.length, 2);
  assert.equal(input.claims[0]?.status, 'negated');
  assert.equal(input.claims[0]?.eventDate, '2026-09-09');
  assert.equal(input.claims[1]?.status, 'occurred');
  assert.equal(input.claims[1]?.tags.includes('dyspnea'), true);
  assert.equal(input.claims[1]?.eventDate, '2026-09-09');
  assert.equal(acceptedSelfClaims(input).length, 1);
});

test('an explicit current correction does not inherit a historical date', () => {
  const input = understandElderInput('昨天胸闷，今天不是胸闷，是喘', TODAY);

  assert.equal(input.claims.length, 3);
  assert.equal(input.claims[0]?.eventDate, '2026-09-09');
  assert.equal(input.claims[1]?.status, 'negated');
  assert.equal(input.claims[1]?.eventDate, TODAY);
  assert.equal(input.claims[2]?.status, 'occurred');
  assert.equal(input.claims[2]?.eventDate, TODAY);
});
