import test from 'node:test';
import assert from 'node:assert/strict';
import { understandElderInput } from '../src/engine/understanding';

const TODAY = '2026-09-10';

test('splits unpunctuated multi-person speech before assigning claims', () => {
  const result = understandElderInput('我爸最近有点喘然后我老公昨天摔了一跤另外我自己刚才有点胸闷', TODAY);

  assert.equal(result.clarificationQuestion, undefined);
  assert.deepEqual(
    result.claims.map((claim) => [claim.subject, claim.status, claim.tags]),
    [
      ['father', 'occurred', ['dyspnea']],
      ['spouse', 'occurred', ['fall']],
      ['self', 'occurred', ['chestPain']],
    ],
  );
});

test('keeps separate family facts instead of inheriting the first family subject', () => {
  const result = understandElderInput('我爸有点喘，我老公也摔了一跤', TODAY);

  assert.equal(result.clarificationQuestion, undefined);
  assert.equal(result.claims.length, 2);
  assert.equal(result.claims[0]?.subject, 'father');
  assert.equal(result.claims[0]?.tags[0], 'dyspnea');
  assert.equal(result.claims[1]?.subject, 'spouse');
  assert.equal(result.claims[1]?.tags[0], 'fall');
});

test('clarifies a pronoun when multiple family subjects are active', () => {
  const result = understandElderInput('我爸最近喘，我老公今天也摔了，然后他现在不舒服', TODAY);

  assert.match(result.clarificationQuestion ?? '', /他\/她|指谁/);
  const ambiguous = result.claims.find((claim) => claim.subject === 'unknown');
  assert.ok(ambiguous);
  assert.equal(ambiguous?.text, '他现在不舒服');
});

test('does not choose one person when a single clause explicitly names multiple people', () => {
  const result = understandElderInput('我爸和我老公都摔了一跤', TODAY);

  assert.match(result.clarificationQuestion ?? '', /指谁|确认清楚/);
  assert.ok(result.claims.some((claim) => claim.subject === 'unknown'));
});

test('keeps a self claim separate from a nearby family claim', () => {
  const result = understandElderInput('我爸走路不稳然后我自己也有点头晕', TODAY);

  assert.equal(result.clarificationQuestion, undefined);
  assert.equal(result.claims[0]?.subject, 'father');
  assert.equal(result.claims[1]?.subject, 'self');
  assert.deepEqual(result.claims[1]?.tags, ['dizziness']);
});
