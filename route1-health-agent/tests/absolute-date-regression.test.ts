import test from 'node:test';
import assert from 'node:assert/strict';
import { understandElderInput } from '../src/engine/understanding';

for (const [text, date, scope] of [
  ['我2026年9月2日胸闷', '2026-09-02', 'historical'],
  ['我2026/9/10胸闷', '2026-09-10', 'today'],
  ['我2026-09-11胸闷', null, 'unknown'],
  ['我2026年2月30日胸闷', null, 'unknown'],
] as const) {
  test(`absolute health date: ${text}`, () => {
    const claim = understandElderInput(text, '2026-09-10').claims[0];
    assert.ok(claim);
    assert.equal(claim.eventDate, date);
    assert.equal(claim.timeScope, scope);
  });
}

test('explicit calendar date overrides the previous clause date', () => {
  const claims = understandElderInput('我昨天胸闷，2026年9月2日也胸闷', '2026-09-10').claims;
  assert.equal(claims.length, 2);
  assert.equal(claims[0]?.eventDate, '2026-09-09');
  assert.equal(claims[1]?.eventDate, '2026-09-02');
});
